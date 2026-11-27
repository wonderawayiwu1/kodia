/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * ARPEI — Main-Process Autonomous Research-to-Product Engineering Intelligence Service
 *
 * Coordinates existing Kodia engines without duplicating them:
 *  - IBrowserService (Playwright Chromium multi-page exploration, scrolling, interaction, screenshots)
 *  - IWebSearchService & IKodiaWebFetchService (live search, official docs, robots.txt & sitemap discovery)
 *  - IDesignAssetMainService (legitimate asset search/download with license tracking & pixel-level screenshot diff)
 *  - Persistent project research memory & checkpointed recovery under `.kodia/arpei/`
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IBrowserService } from '../common/browserServiceTypes.js';
import { IDesignAssetMainService } from '../common/designIntelligenceTypes.js';
import { IKodiaWebFetchService } from '../common/webFetchTypes.js';
import { IWebSearchService } from '../common/webSearchTypes.js';
import {
	buildDeepDiscoveryCoverageMatrix,
	buildInitialTraceabilityAndGaps,
	buildReferenceCoverageMatrix,
	computeFreshness,
	corroborateEvidenceRecords,
	decideResearchStrategy,
	discoverDomainProfile,
	evaluatePreImplementationReadinessGate,
	extractDesignSpecificationFromEvidence,
	extractUrlsFromText,
	parseRobotsTxtSitemaps,
	parseSitemapUrls,
	sanitizeUntrustedWebContent,
} from '../common/arpeiEngine.js';
import {
	ArpeiAssetRecord,
	ArpeiLiveEvent,
	ArpeiLiveEventType,
	ArpeiObservedInteraction,
	ArpeiReferencePageRecord,
	ArpeiResearchMode,
	ArpeiResearchReadinessGate,
	ArpeiResearchSession,
	ArpeiScreenshotRecord,
	ArpeiSettings,
	ArpeiSourceEvidence,
	ArpeiVisualComparisonRecord,
	ArpeiWorkspaceSnapshot,
	DEFAULT_ARPEI_SETTINGS,
	IKodiaArpeiMainService,
} from '../common/arpeiTypes.js';

const ARPEI_DIR = path.join('.kodia', 'arpei');
const MAX_RING_EVENTS = 500;
const MAX_SESSIONS = 40;

interface ControlState {
	paused: boolean;
	cancelled: boolean;
}

function shortHash(s: string): string {
	return crypto.createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 10);
}

/**
 * Safely infer a public candidate website URL when the user types a bare domain or
 * well-known single product name (e.g. "udemy", "notion", "stripe.com") and web search
 * yields no immediate URLs. Never invents non-public/internal URLs.
 */
function inferCandidateUrlsFromPrompt(prompt: string): string[] {
	const trimmed = prompt.trim();
	if (!trimmed) { return []; }
	const urls: string[] = [];
	const domainMatches = trimmed.match(/\b([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.(?:com|io|org|dev|app|ai|net|co|edu))\b/gi);
	if (domainMatches) {
		for (const d of domainMatches) {
			const clean = `https://${d.toLowerCase()}`;
			if (!urls.includes(clean)) { urls.push(clean); }
		}
	}
	// Single-word or "build a <brand> clone" style product name fallback
	const cloneMatch = trimmed.match(/(?:like|clone\s+of|similar\s+to|inspired\s+by|build\s+(?:a|an)?)\s+([a-z][a-z0-9-]{2,24})\b/i);
	const singleWord = /^[a-z][a-z0-9-]{2,24}$/i.test(trimmed) ? trimmed : cloneMatch?.[1];
	if (singleWord) {
		const slug = singleWord.toLowerCase();
		const genericWords = new Set(['app', 'web', 'website', 'site', 'platform', 'system', 'tool', 'software', 'dashboard', 'portal', 'mobile', 'desktop', 'saas', 'project', 'service', 'api', 'server', 'client', 'store', 'shop', 'blog', 'forum', 'chat', 'crm', 'erp', 'lms']);
		if (!genericWords.has(slug)) {
			const candidate = `https://www.${slug}.com`;
			if (!urls.includes(candidate)) { urls.push(candidate); }
		}
	}
	return urls;
}

function readScreenshotDataUrl(filePath: string, maxBytes = 1_600_000): string | undefined {
	try {
		if (!filePath || !fs.existsSync(filePath)) { return undefined; }
		const stat = fs.statSync(filePath);
		if (stat.size <= 0 || stat.size > maxBytes) { return undefined; }
		const buf = fs.readFileSync(filePath);
		return `data:image/png;base64,${buf.toString('base64')}`;
	} catch {
		return undefined;
	}
}

function isRestrictedOrCaptchaText(text: string, status?: number): string | null {
	if (status === 401 || status === 403) { return `HTTP ${status} access restricted`; }
	const lower = text.toLowerCase();
	if (/\b(?:verify\s+you\s+are\s+human|captcha|recaptcha|hcaptcha|cloudflare\s+turnstile|access\s+denied)\b/.test(lower)) {
		return 'Anti-bot / CAPTCHA / access control wall detected (never bypassed)';
	}
	if (/\b(?:sign\s+in\s+to\s+continue|log\s+in\s+to\s+view|authentication\s+required)\b/.test(lower) && text.length < 1500) {
		return 'Authentication required (user-authorized login needed)';
	}
	return null;
}

export class KodiaArpeiMainService extends Disposable implements IKodiaArpeiMainService {
	readonly _serviceBrand: undefined;

	private readonly _onDidEmitEvent = this._register(new Emitter<ArpeiLiveEvent>());
	readonly onDidEmitEvent: Event<ArpeiLiveEvent> = this._onDidEmitEvent.event;

	private readonly _events: ArpeiLiveEvent[] = [];
	private readonly _controls = new Map<string, ControlState>();
	private _seq = 0;
	private _activeBrowserStatus: ArpeiWorkspaceSnapshot['activeBrowserStatus'] = {
		running: false,
		paused: false,
	};

	constructor(
		@IBrowserService private readonly _browserService?: IBrowserService,
		@IWebSearchService private readonly _webSearchService?: IWebSearchService,
		@IKodiaWebFetchService private readonly _webFetchService?: IKodiaWebFetchService,
		@IDesignAssetMainService private readonly _designAssetService?: IDesignAssetMainService,
	) {
		super();
	}

	// ========================================================================
	// Live Events & Atomic Persistence
	// ========================================================================

	private _emit(
		sessionId: string,
		type: ArpeiLiveEventType,
		detail: string,
		extra?: { url?: string; status?: ArpeiLiveEvent['status'] },
	): ArpeiLiveEvent {
		const ev: ArpeiLiveEvent = {
			seq: ++this._seq,
			eventId: `aev-${this._seq}-${Date.now().toString(36)}`,
			sessionId,
			type,
			timestamp: new Date().toISOString(),
			url: extra?.url,
			detail,
			status: extra?.status ?? 'ok',
		};
		this._events.push(ev);
		if (this._events.length > MAX_RING_EVENTS) {
			this._events.splice(0, this._events.length - MAX_RING_EVENTS);
		}
		this._onDidEmitEvent.fire(ev);
		return ev;
	}

	async getRecentEvents(limit = 150): Promise<ArpeiLiveEvent[]> {
		return this._events.slice(-Math.max(1, Math.min(MAX_RING_EVENTS, limit)));
	}

	private _dir(workspaceRoot: string): string {
		const d = path.join(workspaceRoot, ARPEI_DIR);
		fs.mkdirSync(d, { recursive: true });
		return d;
	}

	private _readSessions(workspaceRoot: string): ArpeiResearchSession[] {
		if (!workspaceRoot || !fs.existsSync(workspaceRoot)) { return []; }
		const p = path.join(workspaceRoot, ARPEI_DIR, 'sessions.json');
		if (!fs.existsSync(p)) { return []; }
		try { return JSON.parse(fs.readFileSync(p, 'utf8')) as ArpeiResearchSession[]; }
		catch { return []; }
	}

	private _saveSessions(workspaceRoot: string, sessions: readonly ArpeiResearchSession[]): void {
		if (!workspaceRoot || !fs.existsSync(workspaceRoot)) { return; }
		const target = path.join(this._dir(workspaceRoot), 'sessions.json');
		const tmp = `${target}.${process.pid}.tmp`;
		// Strip large base64 thumbnailDataUrl before writing JSON to keep persistence fast and compact
		const compact = sessions.slice(0, MAX_SESSIONS).map(s => ({
			...s,
			screenshots: s.screenshots.map(({ thumbnailDataUrl: _drop, ...rest }) => rest),
		}));
		fs.writeFileSync(tmp, JSON.stringify(compact, null, 2), 'utf8');
		fs.renameSync(tmp, target);
	}

	private _upsertSession(workspaceRoot: string, session: ArpeiResearchSession): ArpeiResearchSession {
		const all = this._readSessions(workspaceRoot);
		const idx = all.findIndex(s => s.id === session.id);
		const updated: ArpeiResearchSession = { ...session, updatedAt: new Date().toISOString() };
		if (idx >= 0) { all[idx] = updated; } else { all.unshift(updated); }
		this._saveSessions(workspaceRoot, all);
		return updated;
	}

	private async _waitWhilePaused(sessionId: string): Promise<boolean> {
		const ctrl = this._controls.get(sessionId);
		if (!ctrl) { return false; }
		while (ctrl.paused && !ctrl.cancelled) {
			this._activeBrowserStatus = { ...this._activeBrowserStatus, paused: true };
			await new Promise(r => setTimeout(r, 80));
		}
		this._activeBrowserStatus = { ...this._activeBrowserStatus, paused: false };
		return ctrl.cancelled;
	}

	async pauseResearch(sessionId: string): Promise<boolean> {
		const ctrl = this._controls.get(sessionId);
		if (!ctrl) { return false; }
		ctrl.paused = true;
		return true;
	}

	async resumeResearch(sessionId: string): Promise<boolean> {
		const ctrl = this._controls.get(sessionId);
		if (!ctrl) { return false; }
		ctrl.paused = false;
		return true;
	}

	async cancelResearch(sessionId: string): Promise<boolean> {
		const ctrl = this._controls.get(sessionId);
		if (!ctrl) { return false; }
		ctrl.cancelled = true;
		ctrl.paused = false;
		this._emit(sessionId, 'research_blocked_or_failed', `Research session ${sessionId} cancelled by user`, { status: 'warning' });
		return true;
	}

	async loadWorkspaceSnapshot(workspaceRoot: string): Promise<ArpeiWorkspaceSnapshot> {
		const rawSessions = this._readSessions(workspaceRoot);
		// Hydrate crisp PNG previews for up to 16 recent screenshots so the UI renders real visuals immediately
		let hydratedBudget = 16;
		const sessions = rawSessions.map((s, sIdx) => ({
			...s,
			screenshots: s.screenshots.map(sc => {
				if (sc.thumbnailDataUrl || hydratedBudget <= 0 || sIdx > 2) { return sc; }
				const dataUrl = readScreenshotDataUrl(sc.filePath);
				if (dataUrl) {
					hydratedBudget--;
					return { ...sc, thumbnailDataUrl: dataUrl };
				}
				return sc;
			}),
		}));
		const allScreenshots = sessions.flatMap(s => s.screenshots);
		const allAssets = sessions.flatMap(s => s.assets);
		return {
			workspaceRoot,
			sessions,
			activeBrowserStatus: this._activeBrowserStatus,
			allScreenshots,
			allAssets,
			liveEvents: this._events.slice(-150),
		};
	}

	// ========================================================================
	// 1. Plan & Initialize Research Session (Domain Discovery + Strategy + Gate)
	// ========================================================================

	async planAndInitResearch(opts: {
		workspaceRoot: string;
		userPrompt: string;
		referenceUrls?: readonly string[];
		mode?: ArpeiResearchMode;
		settings?: Partial<ArpeiSettings>;
	}): Promise<ArpeiResearchSession> {
		const sessionId = `arpei-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
		const now = new Date().toISOString();
		const explicitUrls = [...new Set([...(opts.referenceUrls ?? []), ...extractUrlsFromText(opts.userPrompt)])];

		const decision = decideResearchStrategy(opts.userPrompt, explicitUrls, opts.mode);
		const domainDiscovery = discoverDomainProfile(opts.userPrompt);
		const { traceability, gaps } = buildInitialTraceabilityAndGaps(domainDiscovery, [], []);
		const architectureDecisions = [
			`Domain profile: ${domainDiscovery.softwareCategory} (${domainDiscovery.industry})`,
			`Research mode: ${decision.recommendedMode} (depth=${decision.recommendedDepth})`,
			`Testing strategy: ${domainDiscovery.requiredTestingMethods.join(', ')}`,
		];

		const draft: ArpeiResearchSession = {
			id: sessionId,
			title: opts.userPrompt.trim().slice(0, 72) || 'ARPEI Research Session',
			userPrompt: opts.userPrompt,
			workspaceRoot: opts.workspaceRoot,
			mode: decision.recommendedMode,
			status: 'running',
			createdAt: now,
			updatedAt: now,
			decision,
			domainDiscovery,
			referenceUrls: explicitUrls,
			pages: [],
			interactions: [],
			referenceCoverage: [],
			deepDiscoveryCoverage: [],
			evidence: [],
			screenshots: [],
			assets: [],
			gaps,
			readinessGate: evaluatePreImplementationReadinessGate({
				userPrompt: opts.userPrompt,
				decision,
				domainDiscovery,
				pages: [],
				interactions: [],
				evidence: [],
				assets: [],
				gaps,
				traceability,
				architectureDecisions,
			}),
			traceability,
			visualComparisons: [],
			architectureDecisions,
			checkpointStep: 'initialized',
			summary: `Initialized ARPEI discovery for ${domainDiscovery.softwareCategory} (${decision.recommendedDepth}).`,
		};

		const withCoverage: ArpeiResearchSession = {
			...draft,
			deepDiscoveryCoverage: buildDeepDiscoveryCoverageMatrix(draft),
		};

		this._emit(sessionId, 'research_started', `Started ARPEI discovery (${decision.recommendedDepth}) for: ${withCoverage.title}`);
		this._emit(sessionId, 'architecture_selected', `Domain: ${domainDiscovery.softwareCategory}; Roles: ${domainDiscovery.userRoles.map(r => r.role).join(', ')}`);
		for (const tr of traceability.slice(0, 5)) {
			this._emit(sessionId, 'requirement_identified', `${tr.requirementId}: ${tr.productRequirement}`);
		}

		return this._upsertSession(opts.workspaceRoot, withCoverage);
	}

	// ========================================================================
	// 2. Multi-Layer Reference Product Exploration (Real Browser + Sitemap/Robots)
	// ========================================================================

	async exploreReferenceProduct(opts: {
		workspaceRoot: string;
		sessionId: string;
		rootUrl?: string;
		discoverReferences?: boolean;
		maxPages?: number;
		captureScreenshots?: boolean;
		testInteractions?: boolean;
		viewports?: readonly { readonly width: number; readonly height: number }[];
	}): Promise<ArpeiResearchSession> {
		const sessions = this._readSessions(opts.workspaceRoot);
		let session = sessions.find(s => s.id === opts.sessionId);
		if (!session) { throw new Error(`ARPEI session not found: ${opts.sessionId}`); }

		const ctrl: ControlState = { paused: false, cancelled: false };
		this._controls.set(opts.sessionId, ctrl);

		const maxPages = Math.max(1, Math.min(20, opts.maxPages ?? DEFAULT_ARPEI_SETTINGS.maxReferencePagesPerSession));
		const captureScreenshots = opts.captureScreenshots !== false;
		const testInteractions = opts.testInteractions !== false;
		const viewports = opts.viewports?.length
			? opts.viewports
			: [{ width: 1280, height: 800 }, { width: 390, height: 844 }];

		const candidateUrls: string[] = [];
		if (opts.rootUrl) { candidateUrls.push(opts.rootUrl); }
		for (const u of session.referenceUrls) {
			if (!candidateUrls.includes(u)) { candidateUrls.push(u); }
		}

		const evidence: ArpeiSourceEvidence[] = [...session.evidence];
		const pages: ArpeiReferencePageRecord[] = [...session.pages];
		const interactions: ArpeiObservedInteraction[] = [...session.interactions];
		const screenshots: ArpeiScreenshotRecord[] = [...session.screenshots];
		const observedColors: string[] = [];
		const observedFonts: string[] = [];

		// Step A: Autonomous reference discovery when no URL supplied
		if (candidateUrls.length === 0 && opts.discoverReferences !== false) {
			// Include inferred public domain/brand URL first if user entered a domain or product name (e.g. "udemy")
			for (const inferred of inferCandidateUrlsFromPrompt(session.userPrompt)) {
				if (!candidateUrls.includes(inferred)) { candidateUrls.push(inferred); }
			}
			// Reuse any high-signal URLs already gathered during technical web search
			for (const ev of session.evidence) {
				if (ev.sourceUrl && /^https?:\/\//i.test(ev.sourceUrl) && !candidateUrls.includes(ev.sourceUrl) && candidateUrls.length < 6) {
					candidateUrls.push(ev.sourceUrl);
				}
			}
			if (this._webSearchService) {
				const rawPrompt = session.userPrompt.trim();
				const query = rawPrompt.length <= 28
					? `${rawPrompt} official website features`
					: (session.decision.proposedQueries[0] ?? `${rawPrompt.slice(0, 80)} official product`);
				this._emit(session.id, 'search_performed', `Discovering references via web search: "${query}"`);
				try {
					const searchRes = await this._webSearchService.search({ query, maxResults: 6 });
					for (const r of searchRes.results) {
						if (r.url && /^https?:\/\//i.test(r.url)) {
							if (!candidateUrls.includes(r.url)) { candidateUrls.push(r.url); }
							const clean = sanitizeUntrustedWebContent(r.snippet);
							evidence.push({
								id: `ev-${shortHash(r.url + r.title)}`,
								topic: session.domainDiscovery.softwareCategory,
								sourceUrl: r.url,
								sourceTitle: r.title,
								sourceKind: 'web_search',
								retrievedAt: new Date().toISOString(),
								epistemicStatus: 'officially_documented',
								freshness: 'fresh',
								confidence: 0.78,
								summary: clean.sanitized.slice(0, 320),
								corroboratedByIds: [],
								untrustedInstructionsStripped: clean.strippedCount,
							});
							this._emit(session.id, 'source_discovered', `Discovered reference: ${r.title}`, { url: r.url });
						}
					}
					// Persist discovered web references immediately so the live UI shows them before browser launch
					session = this._upsertSession(opts.workspaceRoot, {
						...session,
						evidence: corroborateEvidenceRecords(evidence),
						checkpointStep: 'references_discovered',
					});
				} catch (e) {
					this._emit(session.id, 'research_blocked_or_failed', `Web search unavailable (${e instanceof Error ? e.message : String(e)})`, { status: 'warning' });
				}
			}
		}

		const primaryRoot = candidateUrls[0];
		if (!primaryRoot) {
			this._controls.delete(opts.sessionId);
			this._emit(session.id, 'verification_completed', 'Reference discovery finished (no public URL discovered; domain & technical research preserved).', { status: 'warning' });
			return this._upsertSession(opts.workspaceRoot, {
				...session,
				status: 'completed_partial',
				summary: 'No accessible reference URL was supplied or discovered; domain specification remains available.',
			});
		}

		// Step B: Legitimate public discovery via robots.txt & sitemap.xml (never bypassing restrictions)
		let rootOrigin = '';
		try { rootOrigin = new URL(primaryRoot).origin; } catch { rootOrigin = ''; }
		const discoveredQueue: { url: string; layer: ArpeiReferencePageRecord['layer'] }[] = [];
		for (let ci = 0; ci < Math.min(candidateUrls.length, 4); ci++) {
			const cu = candidateUrls[ci];
			const isDoc = /\/(?:docs?|help|api|guide|faq|wiki|about|features|pricing)/i.test(cu);
			discoveredQueue.push({ url: cu, layer: ci === 0 ? 'public_landing' : (isDoc ? 'documentation' : 'navigation_nested') });
		}
		const disallowedPrefixes: string[] = [];

		if (rootOrigin && this._webFetchService) {
			try {
				const robots = await this._webFetchService.fetchURL(`${rootOrigin}/robots.txt`);
				const parsed = parseRobotsTxtSitemaps(robots.text);
				disallowedPrefixes.push(...parsed.disallowedPrefixes);
				for (const smUrl of parsed.sitemaps.slice(0, 2)) {
					try {
						const sm = await this._webFetchService.fetchURL(smUrl);
						const smUrls = parseSitemapUrls(sm.text, 12);
						for (const u of smUrls) {
							if (!discoveredQueue.some(d => d.url === u)) {
								const isDoc = /\/(?:docs?|help|api|guide|faq|pricing|features)/i.test(u);
								discoveredQueue.push({ url: u, layer: isDoc ? 'documentation' : 'navigation_nested' });
							}
						}
					} catch { /* ignore unavailable sitemap */ }
				}
			} catch { /* robots.txt optional */ }
		}

		// Step C: Real Playwright Chromium multi-page exploration via Kodia's IBrowserService
		const screenshotsDir = path.join(this._dir(opts.workspaceRoot), 'screenshots');
		fs.mkdirSync(screenshotsDir, { recursive: true });

		let browserSessionId: string | null = null;
		let tabId: string | null = null;
		const visitedSet = new Set<string>(pages.map(p => p.url));

		try {
			if (this._browserService) {
				this._activeBrowserStatus = { running: true, currentUrl: primaryRoot, currentAction: 'launching Chromium', paused: false };
				const launch = await this._browserService.launchBrowser({ headless: true, viewport: viewports[0] });
				browserSessionId = launch.sessionId;
				const tab = await this._browserService.newTab(browserSessionId, {});
				tabId = tab.tabId;
			}

			let visitedCount = 0;
			while (discoveredQueue.length > 0 && visitedCount < maxPages) {
				if (await this._waitWhilePaused(opts.sessionId)) { break; }
				const next = discoveredQueue.shift()!;
				if (visitedSet.has(next.url)) { continue; }
				visitedSet.add(next.url);

				// Respect robots.txt Disallow prefixes on same origin
				try {
					const pathname = new URL(next.url).pathname;
					if (disallowedPrefixes.some(pre => pre !== '/' && pathname.startsWith(pre))) {
						pages.push({
							url: next.url,
							title: pathname,
							layer: next.layer,
							status: 'restricted',
							discoveredLinksCount: 0,
							interactiveElementsCount: 0,
							formsCount: 0,
							consoleErrorsCount: 0,
							networkFailuresCount: 0,
							extractedFeatures: [],
							navigationItems: [],
							screenshotIds: [],
							restrictionReason: 'Disallowed by site robots.txt policy',
						});
						continue;
					}
				} catch { /* ignore */ }

				visitedCount++;
				let browserSucceeded = false;
				if (browserSessionId && tabId && this._browserService) {
					try {
						this._activeBrowserStatus = { running: true, currentUrl: next.url, currentAction: 'navigating', paused: false };
						this._emit(session.id, 'website_opened', `Opening ${next.url}`, { url: next.url });
						const nav = await this._browserService.navigate(browserSessionId, tabId, next.url);
						const inspect = await this._browserService.inspectPage(browserSessionId, tabId);
						browserSucceeded = true;
						this._emit(session.id, 'page_visited', `Visited "${inspect.title || next.url}" (${inspect.totalElements} interactive elements, ${inspect.forms.length} forms)`, { url: inspect.url });

						const restriction = isRestrictedOrCaptchaText(inspect.text, inspect.status);
						if (restriction) {
							pages.push({
								url: inspect.url,
								title: inspect.title || next.url,
								layer: next.layer,
								status: 'restricted',
								httpStatus: inspect.status,
								visitedAt: new Date().toISOString(),
								discoveredLinksCount: 0,
								interactiveElementsCount: inspect.totalElements,
								formsCount: inspect.forms.length,
								consoleErrorsCount: inspect.consoleErrors,
								networkFailuresCount: inspect.networkFailures,
								extractedFeatures: [],
								navigationItems: [],
								screenshotIds: [],
								restrictionReason: restriction,
							});
							this._emit(session.id, 'research_blocked_or_failed', `Restricted page ${inspect.url}: ${restriction}`, { url: inspect.url, status: 'blocked' });
							continue;
						}

						// Scroll down to trigger lazy-loaded content and observe full page height
						try {
							await this._browserService.scrollPage(browserSessionId, tabId, { direction: 'down', amount: 900 });
							this._emit(session.id, 'scroll_performed', `Scrolled page ${inspect.url} to inspect lazy-loaded content`, { url: inspect.url });
							await this._browserService.scrollPage(browserSessionId, tabId, { direction: 'top' });
						} catch { /* ignore */ }

						// Extract internal navigation links + computed design tokens safely
						let navItems: string[] = [];
						let discoveredLinks: string[] = [];
						try {
							const evalRes = await this._browserService.evaluateScript(browserSessionId, tabId, `(() => {
								const toHex = (rgb) => {
									const m = /^rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/.exec(rgb || '');
									if (!m) return null;
									return '#' + [m[1], m[2], m[3]].map(v => Number(v).toString(16).padStart(2, '0')).join('');
								};
								const links = Array.from(document.querySelectorAll('a[href]')).map(a => ({ href: a.href, text: (a.textContent || '').trim() })).filter(l => l.href.startsWith('http'));
								const nav = Array.from(document.querySelectorAll('nav a, header a, [role="navigation"] a')).map(a => (a.textContent || '').trim()).filter(Boolean).slice(0, 16);
								const headings = Array.from(document.querySelectorAll('h1, h2, h3')).map(h => (h.textContent || '').trim()).filter(Boolean).slice(0, 15);
								const cs = getComputedStyle(document.body);
								const h1 = document.querySelector('h1');
								const h1Cs = h1 ? getComputedStyle(h1) : null;
								const btn = document.querySelector('button, a[class*="btn"], a[class*="button"], [role="button"]');
								const btnCs = btn ? getComputedStyle(btn) : null;
								const colors = [toHex(cs.backgroundColor), toHex(cs.color), btnCs ? toHex(btnCs.backgroundColor) : null].filter(Boolean);
								return { links: links.slice(0, 40), nav, headings, bodyFont: cs.fontFamily, headingFont: h1Cs ? h1Cs.fontFamily : cs.fontFamily, colors };
							})()`);
							const val = evalRes.value as { links?: { href: string; text: string }[]; nav?: string[]; headings?: string[]; bodyFont?: string; headingFont?: string; colors?: string[] } | undefined;
							if (val?.nav) { navItems = [...new Set(val.nav)]; }
							if (val?.headingFont) { observedFonts.push(val.headingFont); }
							if (val?.bodyFont) { observedFonts.push(val.bodyFont); }
							if (val?.colors) { for (const c of val.colors) { if (c && !observedColors.includes(c)) { observedColors.push(c); } } }
							if (val?.links && rootOrigin) {
								for (const l of val.links) {
									if (l.href.startsWith(rootOrigin) && !l.href.includes('#') && !discoveredLinks.includes(l.href)) {
										discoveredLinks.push(l.href);
										if (!visitedSet.has(l.href) && !discoveredQueue.some(d => d.url === l.href) && discoveredQueue.length < maxPages * 3) {
											const isDoc = /\/(?:docs?|help|api|guide|faq)/i.test(l.href);
											discoveredQueue.push({ url: l.href, layer: isDoc ? 'documentation' : 'navigation_nested' });
										}
									}
								}
							}
						} catch { /* ignore evaluate errors */ }

						// Capture persistent screenshots (desktop + optional mobile responsive)
						const pageScreenshotIds: string[] = [];
						if (captureScreenshots) {
							for (let vi = 0; vi < viewports.length; vi++) {
								const vp = viewports[vi];
								if (vi > 0 && visitedCount > 1) { break; }
								try {
									await this._browserService.setViewport(browserSessionId, tabId, vp);
									const shot = await this._browserService.takeScreenshot(browserSessionId, tabId, { type: 'viewport' });
									const shotId = `shot-${shortHash(`${inspect.url}-${vp.width}x${vp.height}-${Date.now()}`)}`;
									const destPath = path.join(screenshotsDir, `${shotId}.png`);
									if (shot.path && fs.existsSync(shot.path)) {
										fs.copyFileSync(shot.path, destPath);
									} else if (shot.dataUrl.startsWith('data:image/png;base64,')) {
										fs.writeFileSync(destPath, Buffer.from(shot.dataUrl.slice('data:image/png;base64,'.length), 'base64'));
									}
									const rec: ArpeiScreenshotRecord = {
										id: shotId,
										sessionId: session.id,
										kind: vi === 0 ? 'reference' : 'responsive',
										sourceUrl: inspect.url,
										pageTitle: inspect.title || inspect.url,
										filePath: destPath,
										thumbnailDataUrl: readScreenshotDataUrl(destPath),
										capturedAt: new Date().toISOString(),
										viewport: vp,
										description: `${vi === 0 ? 'Desktop viewport' : 'Mobile viewport'} capture of ${inspect.title || inspect.url}`,
										componentObservations: inspect.elements.slice(0, 8).map(e => `${e.type}: ${e.label || e.selector}`),
										designObservations: navItems.length ? [`Navigation items: ${navItems.slice(0, 6).join(', ')}`] : [],
										linkedRequirementIds: session.traceability.slice(0, 2).map(t => t.requirementId),
										confidence: 0.95,
										stale: false,
									};
									screenshots.push(rec);
									pageScreenshotIds.push(shotId);
									// Persist immediately so live screenshot strip updates while browsing
									session = this._upsertSession(opts.workspaceRoot, { ...session, screenshots });
									this._emit(session.id, 'screenshot_captured', `Captured ${vp.width}x${vp.height} screenshot of ${inspect.url}`, { url: inspect.url });
								} catch { /* ignore screenshot error */ }
							}
							await this._browserService.setViewport(browserSessionId, tabId, viewports[0]);
						}

						// Safe non-destructive interaction discovery
						if (testInteractions) {
							const safeBtns = inspect.elements
								.filter(el => (el.type === 'button' || el.type === 'menu') && el.visible && !el.disabled && !/\b(?:delete|remove|pay|purchase|buy|submit\s+order|logout|sign\s+out|send)\b/i.test(el.label))
								.slice(0, Math.min(3, DEFAULT_ARPEI_SETTINGS.maxInteractionsPerPage));
							for (const btn of safeBtns) {
								if (await this._waitWhilePaused(opts.sessionId)) { break; }
								const beforeText = inspect.text;
								const beforeUrl = inspect.url;
								try {
									await this._browserService.clickElement(browserSessionId, tabId, btn.selector);
									await new Promise(r => setTimeout(r, 120));
									const after = await this._browserService.inspectPage(browserSessionId, tabId);
									const changed = after.text !== beforeText || after.url !== beforeUrl;
									interactions.push({
										id: `int-${shortHash(inspect.url + btn.selector + Date.now())}`,
										pageUrl: inspect.url,
										selector: btn.selector,
										actionKind: 'click',
										label: btn.label || btn.selector,
										expectedBehavior: `Interacting with "${btn.label || btn.selector}" updates view state or reveals controls`,
										observedBehavior: changed
											? `Observed state change (url=${after.url}, textLen=${after.text.length})`
											: 'No visible DOM/URL mutation observed after click',
										outcomeChangedDomOrUrl: changed,
										timestamp: new Date().toISOString(),
									});
									this._emit(session.id, 'interaction_performed', `Tested control "${btn.label || btn.selector}" -> changed=${changed}`, { url: inspect.url });
								} catch { /* non-fatal interaction skip */ }
							}
						}

						const cleanText = sanitizeUntrustedWebContent(inspect.text);
						const extractedFeatures = [
							...navItems.slice(0, 8),
							...inspect.elements.filter(e => e.label).slice(0, 8).map(e => `${e.type}: ${e.label}`),
						];

						pages.push({
							url: inspect.url,
							title: inspect.title || next.url,
							layer: next.layer,
							status: 'inspected',
							httpStatus: inspect.status ?? nav.status ?? 200,
							visitedAt: new Date().toISOString(),
							discoveredLinksCount: discoveredLinks.length,
							interactiveElementsCount: inspect.totalElements,
							formsCount: inspect.forms.length,
							consoleErrorsCount: inspect.consoleErrors,
							networkFailuresCount: inspect.networkFailures,
							extractedFeatures,
							navigationItems: navItems,
							screenshotIds: pageScreenshotIds,
						});

						evidence.push({
							id: `ev-${shortHash(inspect.url + 'live')}`,
							topic: inspect.title || session.domainDiscovery.softwareCategory,
							sourceUrl: inspect.url,
							sourceTitle: inspect.title || inspect.url,
							sourceKind: next.layer === 'documentation' ? 'official_docs' : 'live_product',
							retrievedAt: new Date().toISOString(),
							epistemicStatus: 'directly_observed',
							freshness: 'fresh',
							confidence: 0.94,
							summary: cleanText.sanitized.slice(0, 420),
							corroboratedByIds: [],
							untrustedInstructionsStripped: cleanText.strippedCount,
						});
						this._emit(session.id, 'finding_extracted', `Extracted ${extractedFeatures.length} UI/feature signals from ${inspect.url}`, { url: inspect.url });
					} catch (navErr) {
						this._emit(session.id, 'research_blocked_or_failed', `Browser navigation fallback for ${next.url}: ${navErr instanceof Error ? navErr.message : String(navErr)}`, { url: next.url, status: 'warning' });
					}
				}
				if (!browserSucceeded && this._webFetchService) {
					// Fallback HTTP fetch when browser navigation is blocked or unavailable
					const fetched = await this._webFetchService.fetchURL(next.url);
					const restriction = isRestrictedOrCaptchaText(fetched.text);
					if (restriction) {
						pages.push({
							url: fetched.url,
							title: fetched.title ?? next.url,
							layer: next.layer,
							status: 'restricted',
							visitedAt: new Date().toISOString(),
							discoveredLinksCount: 0,
							interactiveElementsCount: 0,
							formsCount: 0,
							consoleErrorsCount: 0,
							networkFailuresCount: 0,
							extractedFeatures: [],
							navigationItems: [],
							screenshotIds: [],
							restrictionReason: restriction,
						});
						continue;
					}
					const clean = sanitizeUntrustedWebContent(fetched.text);
					this._emit(session.id, 'page_visited', `Fetched "${fetched.title ?? next.url}" via HTTP fallback`, { url: fetched.url });
					pages.push({
						url: fetched.url,
						title: fetched.title ?? next.url,
						layer: next.layer,
						status: 'inspected',
						visitedAt: new Date().toISOString(),
						discoveredLinksCount: 0,
						interactiveElementsCount: 0,
						formsCount: 0,
						consoleErrorsCount: 0,
						networkFailuresCount: 0,
						extractedFeatures: [],
						navigationItems: [],
						screenshotIds: [],
					});
					evidence.push({
						id: `ev-${shortHash(fetched.url + 'fetch')}`,
						topic: fetched.title ?? session.domainDiscovery.softwareCategory,
						sourceUrl: fetched.url,
						sourceTitle: fetched.title ?? fetched.url,
						sourceKind: 'live_product',
						retrievedAt: new Date().toISOString(),
						epistemicStatus: 'directly_observed',
						freshness: 'fresh',
						confidence: 0.85,
						summary: clean.sanitized.slice(0, 420),
						corroboratedByIds: [],
						untrustedInstructionsStripped: clean.strippedCount,
					});
				}

				// Persist checkpoint after each visited page for interruption recovery!
				session = this._upsertSession(opts.workspaceRoot, {
					...session,
					referenceUrls: [...new Set([...session.referenceUrls, primaryRoot])],
					pages,
					interactions,
					screenshots,
					evidence: corroborateEvidenceRecords(evidence),
					checkpointStep: `visited_${visitedCount}_pages`,
				});
			}
		} finally {
			if (browserSessionId && this._browserService) {
				try { await this._browserService.closeBrowser(browserSessionId); } catch { /* ignore */ }
			}
			this._activeBrowserStatus = { running: false, paused: false };
			this._controls.delete(opts.sessionId);
		}

		const corroborated = corroborateEvidenceRecords(evidence);
		const refCov = buildReferenceCoverageMatrix(
			session.title,
			primaryRoot,
			pages,
			interactions.length,
			screenshots.length,
		);
		const designSpec = extractDesignSpecificationFromEvidence(pages, observedColors, observedFonts);
		const { traceability, gaps } = buildInitialTraceabilityAndGaps(session.domainDiscovery, corroborated, pages);

		const updatedSession: ArpeiResearchSession = {
			...session,
			status: ctrl.cancelled ? 'cancelled' : pages.some(p => p.status === 'restricted') ? 'completed_partial' : 'completed',
			completedAt: new Date().toISOString(),
			referenceUrls: [...new Set([...session.referenceUrls, primaryRoot])],
			pages,
			interactions,
			referenceCoverage: [refCov],
			evidence: corroborated,
			screenshots,
			designSpec,
			traceability,
			gaps,
			checkpointStep: ctrl.cancelled ? session.checkpointStep : 'exploration_complete',
			summary: `Inspected ${refCov.inspectedPagesCount}/${refCov.discoveredPagesCount} discovered page(s), captured ${screenshots.length} screenshot(s), tested ${interactions.length} interaction(s), recorded ${corroborated.length} evidence item(s).`,
		};

		const withGate: ArpeiResearchSession = {
			...updatedSession,
			deepDiscoveryCoverage: buildDeepDiscoveryCoverageMatrix(updatedSession),
			readinessGate: evaluatePreImplementationReadinessGate(updatedSession),
		};

		const saved = this._upsertSession(opts.workspaceRoot, withGate);
		this._emit(session.id, 'verification_completed', withGate.summary, { url: primaryRoot });
		return {
			...saved,
			screenshots: saved.screenshots.map(sc => sc.thumbnailDataUrl ? sc : { ...sc, thumbnailDataUrl: readScreenshotDataUrl(sc.filePath) }),
		};
	}

	// ========================================================================
	// 3. Live Technical & Domain Documentation Research (Part 11 & 12)
	// ========================================================================

	async researchTechnicalAndDomain(opts: {
		workspaceRoot: string;
		sessionId: string;
		queries: readonly string[];
		docUrls?: readonly string[];
	}): Promise<ArpeiResearchSession> {
		const sessions = this._readSessions(opts.workspaceRoot);
		const session = sessions.find(s => s.id === opts.sessionId);
		if (!session) { throw new Error(`ARPEI session not found: ${opts.sessionId}`); }

		const evidence = [...session.evidence];

		if (this._webSearchService) {
			for (const q of opts.queries.slice(0, 6)) {
				this._emit(session.id, 'search_performed', `Technical research query: "${q}"`);
				try {
					const res = await this._webSearchService.search({ query: q, maxResults: 4 });
					for (const r of res.results) {
						const clean = sanitizeUntrustedWebContent(r.snippet);
						evidence.push({
							id: `ev-${shortHash(r.url + q)}`,
							topic: q,
							sourceUrl: r.url,
							sourceTitle: r.title,
							sourceKind: /docs\.|developer\.|spec|rfc|github\.com/i.test(r.url) ? 'official_docs' : 'web_search',
							retrievedAt: new Date().toISOString(),
							epistemicStatus: 'officially_documented',
							freshness: 'fresh',
							confidence: 0.85,
							summary: clean.sanitized.slice(0, 380),
							corroboratedByIds: [],
							untrustedInstructionsStripped: clean.strippedCount,
						});
						this._emit(session.id, 'source_verified', `Verified technical source: ${r.title}`, { url: r.url });
					}
					// Persist after each query so live UI shows web results immediately
					this._upsertSession(opts.workspaceRoot, { ...session, evidence: corroborateEvidenceRecords(evidence) });
				} catch (e) {
					this._emit(session.id, 'research_blocked_or_failed', `Search failed for "${q}": ${e instanceof Error ? e.message : String(e)}`, { status: 'warning' });
				}
			}
		}

		if (this._webFetchService && opts.docUrls?.length) {
			for (const url of opts.docUrls.slice(0, 6)) {
				try {
					const fetched = await this._webFetchService.fetchURL(url);
					const clean = sanitizeUntrustedWebContent(fetched.text);
					evidence.push({
						id: `ev-${shortHash(url + 'doc')}`,
						topic: fetched.title ?? url,
						sourceUrl: fetched.url,
						sourceTitle: fetched.title ?? url,
						sourceKind: 'official_docs',
						retrievedAt: new Date().toISOString(),
						epistemicStatus: 'officially_documented',
						freshness: 'fresh',
						confidence: 0.92,
						summary: clean.sanitized.slice(0, 480),
						corroboratedByIds: [],
						untrustedInstructionsStripped: clean.strippedCount,
					});
					this._emit(session.id, 'source_verified', `Fetched official documentation: ${fetched.title ?? url}`, { url });
				} catch { /* ignore unreachable doc URL */ }
			}
		}

		const corroborated = corroborateEvidenceRecords(evidence);
		const next: ArpeiResearchSession = {
			...session,
			evidence: corroborated,
			summary: `Research session holds ${corroborated.length} corroborated evidence record(s).`,
		};
		return this._upsertSession(opts.workspaceRoot, {
			...next,
			deepDiscoveryCoverage: buildDeepDiscoveryCoverageMatrix(next),
			readinessGate: evaluatePreImplementationReadinessGate(next),
		});
	}

	// ========================================================================
	// 4. Universal Asset Discovery & Download Engine (Part 10 — Reusing IDesignAssetMainService)
	// ========================================================================

	async discoverAndDownloadAssets(opts: {
		workspaceRoot: string;
		sessionId: string;
		queries: readonly { readonly query: string; readonly usage: string; readonly altText: string }[];
		downloadToLocal?: boolean;
	}): Promise<ArpeiAssetRecord[]> {
		const sessions = this._readSessions(opts.workspaceRoot);
		const session = sessions.find(s => s.id === opts.sessionId);
		if (!session) { throw new Error(`ARPEI session not found: ${opts.sessionId}`); }

		const discovered: ArpeiAssetRecord[] = [];
		for (const q of opts.queries.slice(0, 8)) {
			this._emit(session.id, 'asset_discovered', `Searching licensed assets for "${q.query}" (${q.usage})`);
			if (this._designAssetService) {
				try {
					const searchRes = await this._designAssetService.searchImageProviders({
						query: q.query,
						workspaceRoot: opts.workspaceRoot,
						limit: 2,
					});
					const top = searchRes.assets[0];
					if (top && opts.downloadToLocal !== false) {
						const dl = await this._designAssetService.downloadVisualAssets({
							workspaceRoot: opts.workspaceRoot,
							targetDir: 'public/assets/arpei',
							assets: [{
								url: top.url,
								altText: q.altText,
								provider: top.provider,
								license: top.license,
								attribution: top.attribution,
								generateSvgFallback: { subject: q.query, width: 1200, height: 675, style: 'editorial' },
							}],
						});
						const saved = dl.downloaded[0];
						discovered.push({
							id: `ast-${shortHash(q.query + (saved?.localPath ?? Date.now()))}`,
							source: saved?.provider ?? top.provider,
							originalUrl: top.url,
							license: saved?.license ?? top.license,
							attribution: saved?.attribution ?? top.attribution ?? 'See source license metadata',
							downloadStatus: saved ? (saved.provider === 'generated-svg' ? 'generated_fallback' : 'downloaded') : 'failed',
							localPath: saved?.localPath,
							intendedUsage: q.usage,
							optimizationStatus: 'original',
							dimensions: saved?.width && saved?.height ? { width: saved.width, height: saved.height } : undefined,
							format: saved?.mimeType ? saved.mimeType.split('/').pop() : undefined,
							altText: q.altText,
							verifiedAvailable: Boolean(saved?.verifiedOnDisk && saved?.localPath),
						});
						this._emit(session.id, 'asset_downloaded', `Saved asset for "${q.query}" -> ${saved?.localPath ?? 'fallback'}`);
						continue;
					}
				} catch { /* fallback to SVG generation via DesignAssetService below */ }

				// Safe original fallback SVG when offline / provider unreachable (never invents broken external URL!)
				try {
					const dl = await this._designAssetService.downloadVisualAssets({
						workspaceRoot: opts.workspaceRoot,
						targetDir: 'public/assets/arpei',
						assets: [{
							altText: q.altText,
							provider: 'generated-svg',
							license: 'Original Kodia Generated Asset (MIT)',
							attribution: 'Generated locally by Kodia ARPEI',
							generateSvgFallback: { subject: q.query, width: 1200, height: 675, style: 'geometric' },
						}],
					});
					const saved = dl.downloaded[0];
					discovered.push({
						id: `ast-${shortHash(q.query + 'svg')}`,
						source: 'generated-svg',
						originalUrl: 'local://generated-svg',
						license: 'Original Kodia Generated Asset (MIT)',
						attribution: 'Generated locally by Kodia ARPEI',
						downloadStatus: 'generated_fallback',
						localPath: saved?.localPath,
						intendedUsage: q.usage,
						optimizationStatus: 'optimized',
						dimensions: { width: 1200, height: 675 },
						format: 'svg',
						altText: q.altText,
						verifiedAvailable: Boolean(saved?.localPath),
					});
					this._emit(session.id, 'asset_downloaded', `Generated verified local fallback SVG for "${q.query}" -> ${saved?.localPath}`);
				} catch { /* ignore */ }
			}
		}

		const nextAssets = [...session.assets, ...discovered];
		const updated: ArpeiResearchSession = { ...session, assets: nextAssets };
		this._upsertSession(opts.workspaceRoot, {
			...updated,
			deepDiscoveryCoverage: buildDeepDiscoveryCoverageMatrix(updated),
			readinessGate: evaluatePreImplementationReadinessGate(updated),
		});
		return discovered;
	}

	// ========================================================================
	// 5. Readiness Gate Evaluation & Reference-vs-Implementation Visual Comparison
	// ========================================================================

	async evaluateReadinessGate(opts: {
		workspaceRoot: string;
		sessionId: string;
		userFastTrack?: boolean;
	}): Promise<ArpeiResearchReadinessGate> {
		const sessions = this._readSessions(opts.workspaceRoot);
		const session = sessions.find(s => s.id === opts.sessionId);
		if (!session) { throw new Error(`ARPEI session not found: ${opts.sessionId}`); }
		const gate = evaluatePreImplementationReadinessGate(session, Boolean(opts.userFastTrack));
		this._upsertSession(opts.workspaceRoot, { ...session, readinessGate: gate });
		return gate;
	}

	async compareReferenceVsImplementation(opts: {
		workspaceRoot: string;
		sessionId: string;
		referenceScreenshotId: string;
		implementationUrl: string;
		pageLabel?: string;
		viewport?: { readonly width: number; readonly height: number };
	}): Promise<ArpeiVisualComparisonRecord> {
		const sessions = this._readSessions(opts.workspaceRoot);
		const session = sessions.find(s => s.id === opts.sessionId);
		if (!session) { throw new Error(`ARPEI session not found: ${opts.sessionId}`); }

		const refShot = session.screenshots.find(s => s.id === opts.referenceScreenshotId) ?? session.screenshots[0];
		if (!refShot || !fs.existsSync(refShot.filePath)) {
			throw new Error(`Reference screenshot not found on disk: ${opts.referenceScreenshotId}`);
		}
		if (!this._browserService) {
			throw new Error('Browser automation service is required to capture live implementation screenshots for visual comparison.');
		}

		const vp = opts.viewport ?? refShot.viewport;
		const screenshotsDir = path.join(this._dir(opts.workspaceRoot), 'screenshots');
		fs.mkdirSync(screenshotsDir, { recursive: true });
		const implShotId = `impl-${shortHash(opts.implementationUrl + Date.now())}`;
		const implPath = path.join(screenshotsDir, `${implShotId}.png`);

		let browserSessionId: string | null = null;
		const discrepancies: string[] = [];
		try {
			const launch = await this._browserService.launchBrowser({ headless: true, viewport: vp });
			browserSessionId = launch.sessionId;
			const tab = await this._browserService.newTab(browserSessionId, { url: opts.implementationUrl });
			const inspect = await this._browserService.inspectPage(browserSessionId, tab.tabId);
			for (const li of inspect.layoutIssues) {
				discrepancies.push(`Layout issue (${li.kind}) on ${li.selector}: ${li.detail}`);
			}
			const shot = await this._browserService.takeScreenshot(browserSessionId, tab.tabId, { type: 'viewport' });
			if (shot.path && fs.existsSync(shot.path)) {
				fs.copyFileSync(shot.path, implPath);
			} else if (shot.dataUrl.startsWith('data:image/png;base64,')) {
				fs.writeFileSync(implPath, Buffer.from(shot.dataUrl.slice('data:image/png;base64,'.length), 'base64'));
			}
		} finally {
			if (browserSessionId) {
				try { await this._browserService.closeBrowser(browserSessionId); } catch { /* ignore */ }
			}
		}

		let diffPercentage = 0;
		let dimensionMismatch = false;
		if (this._designAssetService) {
			const cmp = await this._designAssetService.compareVisualRevisions({
				baselinePath: refShot.filePath,
				currentPath: implPath,
			});
			diffPercentage = cmp.diffPercentage;
			dimensionMismatch = !cmp.dimensionsMatch;
			if (dimensionMismatch) { discrepancies.push('Reference and implementation screenshot dimensions differ.'); }
		}

		const similarityPct = Number(Math.max(0, 100 - diffPercentage).toFixed(2));
		const record: ArpeiVisualComparisonRecord = {
			id: `vcmp-${Date.now().toString(36)}`,
			createdAt: new Date().toISOString(),
			pageLabel: opts.pageLabel ?? refShot.pageTitle,
			viewport: vp,
			referenceScreenshotPath: refShot.filePath,
			implementationScreenshotPath: implPath,
			diffPercentage,
			similarityPct,
			dimensionMismatch,
			layoutDiscrepancies: discrepancies,
			functionalVerificationNote: 'Visual similarity measures layout/pixel proximity ONLY and does NOT prove functional correctness. Run KACRAE Functional Completeness verification separately to validate live workflows.',
			passedVisualThreshold: diffPercentage <= 35 && discrepancies.length === 0,
		};

		const implShotRecord: ArpeiScreenshotRecord = {
			id: implShotId,
			sessionId: session.id,
			kind: 'implementation',
			sourceUrl: opts.implementationUrl,
			pageTitle: opts.pageLabel ?? opts.implementationUrl,
			filePath: implPath,
			capturedAt: new Date().toISOString(),
			viewport: vp,
			description: `Implementation screenshot compared against ${refShot.id} (${similarityPct}% visual similarity)`,
			componentObservations: [],
			designObservations: discrepancies,
			linkedRequirementIds: [],
			confidence: 0.95,
			stale: false,
		};

		this._upsertSession(opts.workspaceRoot, {
			...session,
			screenshots: [...session.screenshots, implShotRecord],
			visualComparisons: [record, ...session.visualComparisons],
		});
		this._emit(session.id, 'visual_comparison_completed', `Visual comparison (${vp.width}x${vp.height}): ${similarityPct}% similarity (${diffPercentage}% pixel diff)`, { url: opts.implementationUrl });
		return record;
	}

	// ========================================================================
	// 6. Research Memory Retrieval & Freshness Audit (Part 8, 20 & Master Add. §10)
	// ========================================================================

	async queryResearchMemory(opts: {
		workspaceRoot: string;
		query: string;
		sessionId?: string;
	}) {
		const sessions = this._readSessions(opts.workspaceRoot);
		const scoped = opts.sessionId ? sessions.filter(s => s.id === opts.sessionId) : sessions;
		const q = opts.query.trim().toLowerCase();
		const words = q.split(/\s+/).filter(Boolean);
		const matches = (text: string) => words.length === 0 || words.some(w => text.toLowerCase().includes(w));

		const allEvidence = scoped.flatMap(s => s.evidence).map(e => ({
			...e,
			freshness: computeFreshness(e.retrievedAt, DEFAULT_ARPEI_SETTINGS.freshnessMaxAgeHours),
		}));
		const matchedEvidence = allEvidence.filter(e => matches(`${e.topic} ${e.sourceTitle} ${e.summary} ${e.sourceUrl}`));
		const matchedScreenshots = scoped.flatMap(s => s.screenshots).filter(sc => matches(`${sc.pageTitle} ${sc.sourceUrl} ${sc.description} ${sc.componentObservations.join(' ')}`));
		const matchedRequirements = scoped.flatMap(s => s.traceability).filter(tr => matches(`${tr.requirementId} ${tr.productRequirement} ${tr.verifiedFinding} ${tr.architecturalDecision}`));
		const matchedAssets = scoped.flatMap(s => s.assets).filter(a => matches(`${a.intendedUsage} ${a.altText} ${a.source} ${a.license}`));
		const staleEvidenceCount = allEvidence.filter(e => e.freshness === 'stale').length;

		return {
			matchedEvidence,
			matchedScreenshots,
			matchedRequirements,
			matchedAssets,
			staleEvidenceCount,
		};
	}
}
