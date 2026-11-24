/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IKodiaWebFetchService, WebFetchResult } from '../common/webFetchTypes.js';
import { IWebSearchService, SearchResponse } from '../common/webSearchTypes.js';
import {
	DEFAULT_LEI_FRESHNESS_POLICIES,
	IKodiaLiveIntelligenceMainService,
	LeiDependencyCheckRequest,
	LeiDependencyReport,
	LeiDiscoveredModel,
	LeiDomain,
	LeiEvent,
	LeiEventType,
	LeiEvidenceConflict,
	LeiEvidenceRecord,
	LeiFailureDiagnosisReport,
	LeiFailureDiagnosisRequest,
	LeiFreshnessAssessment,
	LeiFreshnessPolicies,
	LeiLiveSnapshot,
	LeiModelDiscoveryReport,
	LeiModelDiscoveryRequest,
	LeiModelVerificationReport,
	LeiModelVerificationRequest,
	LeiOperationSummary,
	LeiPackageEcosystem,
	LeiProviderId,
	LeiResearchRequest,
	LeiResearchResult,
	LeiSecurityAdvisory,
	LeiSecurityAuditReport,
	LeiSecurityCheckRequest,
	LeiSourceReference,
	LeiSystemStatus,
	LeiVerificationStatus,
} from '../common/liveIntelligenceTypes.js';
import {
	assessEngineeringFreshness,
	computeKnowledgeFreshness,
	evaluateVerificationEvidence,
	extractDocumentMetadata,
	extractDomain,
	getTtlForDomain,
	inferCapabilitiesFromModelId,
	normalizeTechnologyKey,
	rankSources,
	sanitizeExternalContent,
	scoreSourceCredibility,
	scrubSecretsFromQuery,
	selectBestModelForTask,
} from '../common/liveIntelligenceEngine.js';

export interface LeiNetworkTransport {
	fetchJson(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number; signal?: AbortSignal }): Promise<{ ok: boolean; status: number; data: any }>;
	fetchPage(url: string, signal?: AbortSignal): Promise<WebFetchResult>;
	webSearch(query: string, maxResults?: number): Promise<SearchResponse>;
	getProviderApiKey(provider: LeiProviderId): Promise<string | undefined>;
}

interface PersistedLeiStore {
	version: 1;
	policies: LeiFreshnessPolicies;
	evidence: LeiEvidenceRecord[];
	history: LeiOperationSummary[];
}

const PROVIDER_MODEL_ENDPOINTS: Readonly<Record<string, { url: string; docsUrl: string; authHeader: (key: string) => Record<string, string>; allowPublic?: boolean }>> = {
	nvidia: {
		url: 'https://integrate.api.nvidia.com/v1/models',
		docsUrl: 'https://docs.api.nvidia.com/nim/reference/llm-apis',
		authHeader: (k): Record<string, string> => (k ? { Authorization: `Bearer ${k}` } : {}),
		allowPublic: true,
	},
	openai: {
		url: 'https://api.openai.com/v1/models',
		docsUrl: 'https://platform.openai.com/docs/models',
		authHeader: k => ({ Authorization: `Bearer ${k}` }),
	},
	anthropic: {
		url: 'https://api.anthropic.com/v1/models',
		docsUrl: 'https://docs.anthropic.com/en/docs/about-claude/models/overview',
		authHeader: k => ({ 'x-api-key': k, 'anthropic-version': '2023-06-01' }),
	},
	gemini: {
		url: 'https://generativelanguage.googleapis.com/v1beta/models',
		docsUrl: 'https://ai.google.dev/gemini-api/docs/models',
		authHeader: k => ({ 'x-goog-api-key': k }),
	},
	groq: {
		url: 'https://api.groq.com/openai/v1/models',
		docsUrl: 'https://console.groq.com/docs/models',
		authHeader: k => ({ Authorization: `Bearer ${k}` }),
	},
	mistral: {
		url: 'https://api.mistral.ai/v1/models',
		docsUrl: 'https://docs.mistral.ai/getting-started/models/models_overview/',
		authHeader: k => ({ Authorization: `Bearer ${k}` }),
	},
	deepseek: {
		url: 'https://api.deepseek.com/models',
		docsUrl: 'https://api-docs.deepseek.com/quick_start/pricing',
		authHeader: k => ({ Authorization: `Bearer ${k}` }),
	},
	openrouter: {
		url: 'https://openrouter.ai/api/v1/models',
		docsUrl: 'https://openrouter.ai/models',
		authHeader: (k): Record<string, string> => (k ? { Authorization: `Bearer ${k}` } : {}),
		allowPublic: true,
	},
	ollama: {
		url: 'http://127.0.0.1:11434/api/tags',
		docsUrl: 'https://ollama.com/library',
		authHeader: () => ({}),
		allowPublic: true,
	},
};

const OSV_ECOSYSTEM_MAP: Readonly<Record<LeiPackageEcosystem, string>> = {
	npm: 'npm',
	pypi: 'PyPI',
	pub: 'Pub',
	crates: 'crates.io',
	packagist: 'Packagist',
	maven: 'Maven',
	nuget: 'NuGet',
};

export interface LiveIntelligenceCoreOptions {
	readonly webSearchService?: IWebSearchService;
	readonly webFetchService?: IKodiaWebFetchService;
	readonly readEncryptedProviderKey?: (provider: LeiProviderId) => Promise<string | undefined>;
	readonly globalStorePath?: string;
	readonly transport?: LeiNetworkTransport;
}

export class LiveIntelligenceCoreService extends Disposable implements IKodiaLiveIntelligenceMainService {
	readonly _serviceBrand: undefined;

	private readonly _onDidEmitEvent = this._register(new Emitter<LeiEvent>());
	readonly onDidEmitEvent = this._onDidEmitEvent.event;

	private readonly _onDidChangeSnapshot = this._register(new Emitter<LeiLiveSnapshot>());
	readonly onDidChangeSnapshot = this._onDidChangeSnapshot.event;

	private _policies: LeiFreshnessPolicies = { ...DEFAULT_LEI_FRESHNESS_POLICIES };
	private _evidence = new Map<string, LeiEvidenceRecord>();
	private _history: LeiOperationSummary[] = [];
	private _activeOps = new Map<string, { summary: LeiOperationSummary; abort: AbortController }>();
	private _recentEvents: LeiEvent[] = [];
	private _eventSeq = 0;
	private _networkAvailable = true;
	private _webSearchConfigured = true;
	private _inFlightResearch = new Map<string, Promise<LeiResearchResult>>();
	private readonly _globalStorePath: string;
	private readonly _transport: LeiNetworkTransport;
	private readonly _webSearchService?: IWebSearchService;
	private readonly _webFetchService?: IKodiaWebFetchService;
	private readonly _readEncryptedProviderKey?: (provider: LeiProviderId) => Promise<string | undefined>;

	constructor(options: LiveIntelligenceCoreOptions = {}) {
		super();
		this._webSearchService = options.webSearchService;
		this._webFetchService = options.webFetchService;
		this._readEncryptedProviderKey = options.readEncryptedProviderKey;
		this._globalStorePath = options.globalStorePath ?? path.join(os.homedir(), '.kodia', 'live-intelligence-store.json');
		this._transport = options.transport ?? this._createDefaultTransport();
		this._loadGlobalStore();
	}

	private _createDefaultTransport(): LeiNetworkTransport {
		return {
			fetchJson: async (url, init) => {
				const timeoutMs = init?.timeoutMs ?? this._policies.requestTimeoutMs;
				const ctrl = new AbortController();
				const timer = setTimeout(() => ctrl.abort(), timeoutMs);
				const onExternalAbort = () => ctrl.abort();
				init?.signal?.addEventListener('abort', onExternalAbort, { once: true });
				try {
					const res = await fetch(url, {
						method: init?.method ?? 'GET',
						headers: {
							'User-Agent': 'Kodia-Live-Engineering-Intelligence/2.0',
							'Accept': 'application/json',
							...(init?.headers ?? {}),
						},
						body: init?.body,
						signal: ctrl.signal,
					});
					const text = await res.text();
					let data: any = null;
					try { data = JSON.parse(text); } catch { data = { raw: text }; }
					return { ok: res.ok, status: res.status, data };
				} finally {
					clearTimeout(timer);
					init?.signal?.removeEventListener('abort', onExternalAbort);
				}
			},
			fetchPage: async (url) => {
				if (this._webFetchService) {
					return this._webFetchService.fetchURL(url);
				}
				const res = await fetch(url, {
					redirect: 'follow',
					signal: AbortSignal.timeout(this._policies.requestTimeoutMs),
					headers: {
						'User-Agent': 'Mozilla/5.0 (compatible; Kodia-LEI/2.0)',
						'Accept': 'text/html,application/json,text/plain;q=0.9,*/*;q=0.5',
					},
				});
				if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
				const text = await res.text();
				const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
				const stripped = text.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
				return { url: res.url || url, title: titleMatch?.[1]?.trim() ?? null, text: stripped.slice(0, 40_000) };
			},
			webSearch: async (query, maxResults = 6) => {
				if (this._webSearchService) {
					try {
						return await this._webSearchService.search({ query, maxResults });
					} catch {
						// Fall through to DuckDuckGo Lite HTML extraction when paid providers are not configured
					}
				}
				return this._fallbackDuckDuckGoSearch(query, maxResults);
			},
			getProviderApiKey: async (provider) => this._resolveProviderApiKey(provider),
		};
	}

	private async _fallbackDuckDuckGoSearch(query: string, maxResults: number): Promise<SearchResponse> {
		const started = Date.now();
		const encoded = encodeURIComponent(scrubSecretsFromQuery(query));
		const res = await fetch(`https://html.duckduckgo.com/html/?q=${encoded}`, {
			signal: AbortSignal.timeout(this._policies.requestTimeoutMs),
			headers: {
				'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Kodia-LEI/2.0',
				'Accept': 'text/html',
			},
		});
		if (!res.ok) {
			throw new Error(`Search fallback returned HTTP ${res.status}`);
		}
		const html = await res.text();
		const results: SearchResponse['results'] = [];
		const linkRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
		const snippetRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
		const snippets: string[] = [];
		let sm: RegExpExecArray | null;
		while ((sm = snippetRe.exec(html)) !== null) {
			snippets.push(sm[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
		}
		let lm: RegExpExecArray | null;
		let idx = 0;
		while ((lm = linkRe.exec(html)) !== null && results.length < maxResults) {
			let href = lm[1];
			const uddg = href.match(/[?&]uddg=([^&]+)/);
			if (uddg) {
				try { href = decodeURIComponent(uddg[1]); } catch { /* ignore */ }
			}
			const title = lm[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
			if (/^https?:\/\//i.test(href) && title) {
				results.push({
					title,
					url: href,
					displayUrl: extractDomain(href) || href,
					snippet: snippets[idx] ?? '',
					source: 'duckduckgo',
					retrievalTimestamp: Date.now(),
				});
			}
			idx++;
		}
		return {
			results,
			provider: 'duckduckgo',
			query,
			totalResults: results.length,
			responseTimeMs: Date.now() - started,
		};
	}

	private async _resolveProviderApiKey(provider: LeiProviderId): Promise<string | undefined> {
		const envMap: Record<string, string> = {
			nvidia: 'NVIDIA_API_KEY',
			openai: 'OPENAI_API_KEY',
			anthropic: 'ANTHROPIC_API_KEY',
			gemini: 'GEMINI_API_KEY',
			groq: 'GROQ_API_KEY',
			mistral: 'MISTRAL_API_KEY',
			deepseek: 'DEEPSEEK_API_KEY',
			openrouter: 'OPENROUTER_API_KEY',
		};
		const envName = envMap[provider.toLowerCase()];
		if (envName && process.env[envName]) {
			return process.env[envName];
		}
		if (this._readEncryptedProviderKey) {
			return this._readEncryptedProviderKey(provider);
		}
		return undefined;
	}

	// ── Persistence & Knowledge Repository (Part 10) ──────────────────────────────────

	private _loadGlobalStore(): void {
		try {
			if (!fs.existsSync(this._globalStorePath)) return;
			const raw = JSON.parse(fs.readFileSync(this._globalStorePath, 'utf8')) as Partial<PersistedLeiStore>;
			if (raw.policies) {
				this._policies = { ...DEFAULT_LEI_FRESHNESS_POLICIES, ...raw.policies };
			}
			if (Array.isArray(raw.evidence)) {
				for (const rec of raw.evidence) {
					if (rec && rec.id) this._evidence.set(rec.id, rec);
				}
			}
			if (Array.isArray(raw.history)) {
				this._history = raw.history.slice(0, 60);
			}
		} catch { /* ignore */ }
	}

	private _saveStore(projectRoot?: string): void {
		const payload: PersistedLeiStore = {
			version: 1,
			policies: this._policies,
			evidence: [...this._evidence.values()].slice(-250),
			history: this._history.slice(0, 60),
		};
		try {
			fs.mkdirSync(path.dirname(this._globalStorePath), { recursive: true });
			fs.writeFileSync(this._globalStorePath, JSON.stringify(payload, null, 2), 'utf8');
		} catch { /* non-fatal */ }

		if (projectRoot) {
			try {
				const projDir = path.join(projectRoot, '.kodia', 'intelligence');
				fs.mkdirSync(projDir, { recursive: true });
				const projEvidence = [...this._evidence.values()].filter(e => !e.projectId || e.projectId === projectRoot);
				fs.writeFileSync(
					path.join(projDir, 'knowledge.json'),
					JSON.stringify({ updatedAt: new Date().toISOString(), evidence: projEvidence.slice(-100), history: this._history.slice(0, 25) }, null, 2),
					'utf8',
				);
			} catch { /* non-fatal */ }
		}
	}

	private _upsertEvidence(record: LeiEvidenceRecord, projectRoot?: string): LeiEvidenceRecord {
		const existing = this._evidence.get(record.id);
		if (existing && !existing.invalidated) {
			const existingVerified = existing.verificationStatus === 'verified_official_docs' || existing.verificationStatus === 'verified_official_api' || existing.verificationStatus === 'cross_checked';
			const nextVerified = record.verificationStatus === 'verified_official_docs' || record.verificationStatus === 'verified_official_api' || record.verificationStatus === 'cross_checked';
			if (existingVerified && !nextVerified && existing.researchedAtMs >= record.researchedAtMs) {
				return existing;
			}
		}
		this._evidence.set(record.id, record);
		this._saveStore(projectRoot);
		return record;
	}

	private _findFreshEvidence(technology: string, domain?: LeiDomain): LeiEvidenceRecord | undefined {
		let best: LeiEvidenceRecord | undefined;
		for (const rec of this._evidence.values()) {
			if (rec.invalidated) continue;
			if (rec.technology !== technology) continue;
			if (domain && rec.domain !== domain) continue;
			if (!best || rec.researchedAtMs > best.researchedAtMs) {
				best = rec;
			}
		}
		return best;
	}

	// ── Real-Time Event System (Part 15) ──────────────────────────────────────────────

	private _emit(
		type: LeiEventType,
		operationId: string,
		technology: string,
		taskSummary: string,
		status: LeiEvent['status'],
		extras?: { detail?: string; sourceRef?: LeiSourceReference; verificationStatus?: LeiVerificationStatus; error?: string; projectId?: string },
	): void {
		const ev: LeiEvent = {
			eventId: `lei-ev-${++this._eventSeq}-${Date.now()}`,
			sequence: this._eventSeq,
			operationId,
			projectId: extras?.projectId,
			timestamp: Date.now(),
			type,
			technology,
			taskSummary,
			status,
			detail: extras?.detail,
			sourceRef: extras?.sourceRef,
			verificationStatus: extras?.verificationStatus,
			error: extras?.error,
		};
		this._recentEvents.unshift(ev);
		if (this._recentEvents.length > 100) this._recentEvents.length = 100;
		this._onDidEmitEvent.fire(ev);
		this._onDidChangeSnapshot.fire(this._buildSnapshot());
	}

	private _startOp(kind: LeiOperationSummary['kind'], technology: string, taskLabel: string, projectId?: string): { opId: string; abort: AbortController } {
		const opId = `lei-op-${crypto.randomBytes(4).toString('hex')}`;
		const abort = new AbortController();
		const summary: LeiOperationSummary = {
			operationId: opId,
			kind,
			technology,
			taskLabel,
			status: 'running',
			startedAtMs: Date.now(),
			sourcesDiscovered: 0,
			sourcesOpened: 0,
			sources: [],
			verificationStatus: 'unverified',
			conflictCount: 0,
			fromCache: false,
		};
		this._activeOps.set(opId, { summary, abort });
		this._emit('research_started', opId, technology, taskLabel, 'running', { projectId });
		return { opId, abort };
	}

	private _updateOp(opId: string, patch: Partial<LeiOperationSummary>): void {
		const entry = this._activeOps.get(opId);
		if (!entry) return;
		entry.summary = { ...entry.summary, ...patch };
		this._onDidChangeSnapshot.fire(this._buildSnapshot());
	}

	private _finishOp(opId: string, patch: Partial<LeiOperationSummary>, projectId?: string): LeiOperationSummary | undefined {
		const entry = this._activeOps.get(opId);
		if (!entry) return undefined;
		const finalSummary: LeiOperationSummary = {
			...entry.summary,
			...patch,
			completedAtMs: Date.now(),
		};
		this._activeOps.delete(opId);
		this._history.unshift(finalSummary);
		if (this._history.length > 60) this._history.length = 60;
		const evType: LeiEventType = finalSummary.status === 'cancelled'
			? 'research_cancelled'
			: finalSummary.status === 'failed'
				? 'research_failed'
				: 'research_completed';
		const evStatus: LeiEvent['status'] = finalSummary.status === 'cancelled'
			? 'cancelled'
			: finalSummary.status === 'failed'
				? 'error'
				: 'success';
		this._emit(evType, opId, finalSummary.technology, finalSummary.taskLabel, evStatus, {
			verificationStatus: finalSummary.verificationStatus,
			error: finalSummary.error,
			detail: finalSummary.findingSummary,
			projectId,
		});
		return finalSummary;
	}

	private _buildSnapshot(): LeiLiveSnapshot {
		const now = Date.now();
		const activeOps = [...this._activeOps.values()].map(v => v.summary);
		const allEvidence = [...this._evidence.values()].filter(e => !e.invalidated);
		const verifiedEvidence = allEvidence.filter(e =>
			e.verificationStatus === 'verified_official_docs'
			|| e.verificationStatus === 'verified_official_api'
			|| e.verificationStatus === 'cross_checked'
		);
		const staleEvidence = allEvidence.filter(e => now >= e.expiresAtMs || (now - e.researchedAtMs) > e.cachePolicyMs * 0.75);
		const conflictCount = allEvidence.reduce((sum, e) => sum + e.conflictingEvidence.length, 0);

		const latestOp = activeOps[0] ?? this._history[0];
		const systemStatus: LeiSystemStatus = !this._policies.enabled
			? 'disabled'
			: !this._networkAvailable
				? 'unavailable'
				: latestOp?.status === 'failed' && activeOps.length === 0
					? 'degraded'
					: 'active';

		const researchMode: LeiLiveSnapshot['researchMode'] = !this._policies.enabled
			? 'research_not_required'
			: activeOps.length > 0
				? 'research_in_progress'
				: !this._networkAvailable || (latestOp?.status === 'failed' && latestOp.verificationStatus === 'unavailable')
					? 'research_unavailable'
					: latestOp?.fromCache
						? 'cached_verified'
						: 'live_research_enabled';

		const currentTask = activeOps[0]?.taskLabel
			?? latestOp?.taskLabel
			?? 'Monitoring engineering decisions for freshness';

		const sources = activeOps[0]?.sources.length
			? activeOps[0].sources
			: latestOp?.sources ?? [];

		const verificationStatus: LeiLiveSnapshot['verificationStatus'] = activeOps.length > 0
			? 'unverified'
			: latestOp?.verificationStatus ?? 'not_applicable';

		const lastVerifiedAtMs = verifiedEvidence.reduce<number | undefined>(
			(max, e) => (!max || e.researchedAtMs > max ? e.researchedAtMs : max),
			undefined,
		);

		return {
			systemStatus,
			researchMode,
			currentTask,
			activeOperationId: activeOps[0]?.operationId,
			activeTechnologies: [...new Set(activeOps.map(o => o.technology))],
			sources: sources.slice(0, 8),
			verificationStatus,
			knowledgeFreshness: computeKnowledgeFreshness(allEvidence, activeOps.length > 0, this._networkAvailable, now),
			lastVerifiedAtMs,
			networkAvailable: this._networkAvailable,
			webSearchConfigured: this._webSearchConfigured,
			evidenceCount: allEvidence.length,
			verifiedEvidenceCount: verifiedEvidence.length,
			staleEvidenceCount: staleEvidence.length,
			conflictCount,
			activeOperations: activeOps,
			recentOperations: this._history.slice(0, 15),
			recentEvents: this._recentEvents.slice(0, 30),
			policies: this._policies,
		};
	}

	async getSnapshot(): Promise<LeiLiveSnapshot> {
		return this._buildSnapshot();
	}

	async assessFreshness(topic: string, technology?: string, currentVersionOrId?: string, _projectRoot?: string): Promise<LeiFreshnessAssessment> {
		const techKey = normalizeTechnologyKey(topic, technology);
		const existing = this._findFreshEvidence(techKey);
		return assessEngineeringFreshness(topic, {
			technology: techKey,
			currentVersionOrId,
			existingEvidence: existing,
			policies: this._policies,
		});
	}

	async researchTechnology(req: LeiResearchRequest): Promise<LeiResearchResult> {
		const startedAt = Date.now();
		const techKey = normalizeTechnologyKey(req.topic, req.technology);
		const dedupKey = `${techKey}::${req.topic.toLowerCase()}::${req.forceRefresh ? 'force' : 'cache'}`;
		const existingInFlight = this._inFlightResearch.get(dedupKey);
		if (existingInFlight) return existingInFlight;

		const runPromise = this._executeResearchTechnology(req, techKey, startedAt);
		this._inFlightResearch.set(dedupKey, runPromise);
		try {
			return await runPromise;
		} finally {
			this._inFlightResearch.delete(dedupKey);
		}
	}

	private async _executeResearchTechnology(req: LeiResearchRequest, techKey: string, startedAt: number): Promise<LeiResearchResult> {
		const existing = this._findFreshEvidence(techKey, req.domain);
		const freshness = assessEngineeringFreshness(req.topic, {
			technology: techKey,
			currentVersionOrId: req.currentVersionOrId,
			existingEvidence: existing,
			policies: this._policies,
		});

		const taskLabel = `${techKey}: ${scrubSecretsFromQuery(req.topic).slice(0, 80)}`;
		const { opId, abort } = this._startOp('technology_research', techKey, taskLabel, req.projectRoot);

		if (!req.forceRefresh && freshness.category === 'A_stable' && !freshness.needsLiveResearch) {
			this._finishOp(opId, {
				status: 'completed',
				verificationStatus: 'provisionally_verified',
				findingSummary: 'Stable engineering concept (Category A) — live web lookup not required.',
				fromCache: true,
			}, req.projectRoot);
			return {
				operationId: opId,
				topic: freshness.topic,
				technology: techKey,
				freshness,
				verificationStatus: 'provisionally_verified',
				summary: 'Fundamental/stable engineering concept (Category A); live web search skipped to avoid unnecessary lookups.',
				keyFindings: freshness.reasons,
				detectedVersions: [],
				deprecationNotices: [],
				recommendations: ['Apply standard engineering best practices; pass forceRefresh=true if version-specific confirmation is needed.'],
				sources: [],
				conflicts: [],
				fromCache: true,
				durationMs: Date.now() - startedAt,
			};
		}

		if (!req.forceRefresh && existing && !existing.invalidated && Date.now() < existing.expiresAtMs && freshness.cacheStatus === 'fresh') {
			this._emit('cache_hit', opId, techKey, taskLabel, 'success', {
				verificationStatus: existing.verificationStatus,
				detail: `Reused fresh verified cache from ${existing.researchDate}`,
				projectId: req.projectRoot,
			});
			this._finishOp(opId, {
				status: 'completed',
				sourcesDiscovered: existing.sources.length,
				sourcesOpened: existing.sources.filter(s => s.inspectedFullDocument).length,
				sources: existing.sources,
				verificationStatus: existing.verificationStatus,
				selectedIdentifierOrVersion: existing.exactIdentifierOrVersion,
				findingSummary: existing.finding,
				recommendation: existing.recommendation,
				fromCache: true,
			}, req.projectRoot);
			return {
				operationId: opId,
				topic: freshness.topic,
				technology: techKey,
				freshness,
				verificationStatus: existing.verificationStatus,
				summary: existing.finding,
				keyFindings: existing.supportingEvidence,
				detectedVersions: existing.exactIdentifierOrVersion ? [existing.exactIdentifierOrVersion] : [],
				deprecationNotices: [],
				recommendations: existing.recommendation ? [existing.recommendation] : [],
				sources: existing.sources,
				conflicts: existing.conflictingEvidence,
				evidence: existing,
				fromCache: true,
				durationMs: Date.now() - startedAt,
			};
		}

		if (existing && Date.now() >= existing.expiresAtMs) {
			this._emit('cache_expired', opId, techKey, taskLabel, 'warning', { detail: `Previous cache expired at ${new Date(existing.expiresAtMs).toISOString()}`, projectId: req.projectRoot });
		}

		const candidateUrls = new Map<string, { title: string; snippet: string }>();
		for (const u of [...(req.officialUrls ?? []), ...freshness.recommendedOfficialUrls]) {
			candidateUrls.set(u, { title: `${techKey} official documentation`, snippet: '' });
		}

		let searchFailureMessage: string | undefined;
		const query = freshness.suggestedSearchQueries[0] || `${freshness.topic} official documentation`;
		this._emit('query_submitted', opId, techKey, taskLabel, 'running', { detail: query, projectId: req.projectRoot });

		try {
			const searchRes = await this._transport.webSearch(query, 6);
			this._networkAvailable = true;
			for (const item of searchRes.results) {
				if (!candidateUrls.has(item.url)) {
					candidateUrls.set(item.url, { title: item.title, snippet: item.snippet });
				}
			}
		} catch (err) {
			searchFailureMessage = err instanceof Error ? err.message : String(err);
		}

		if (abort.signal.aborted) {
			this._finishOp(opId, { status: 'cancelled', verificationStatus: 'unavailable', error: 'Cancelled by user' }, req.projectRoot);
			return {
				operationId: opId,
				topic: freshness.topic,
				technology: techKey,
				freshness,
				verificationStatus: 'unavailable',
				summary: 'Research cancelled before completion.',
				keyFindings: [],
				detectedVersions: [],
				deprecationNotices: [],
				recommendations: [],
				sources: [],
				conflicts: [],
				fromCache: false,
				durationMs: Date.now() - startedAt,
				error: 'Cancelled',
			};
		}

		const discoveredSources: LeiSourceReference[] = [...candidateUrls.entries()].map(([url, meta]) => {
			const cred = scoreSourceCredibility(url, meta.title);
			const { sanitized, strippedCount } = sanitizeExternalContent(meta.snippet, 500);
			return {
				title: meta.title || extractDomain(url),
				url,
				domain: extractDomain(url),
				tier: cred.tier,
				authorityLabel: cred.authorityLabel,
				authorityScore: cred.authorityScore,
				fetchedAt: Date.now(),
				snippet: sanitized,
				inspectedFullDocument: false,
				promptInjectionSignalsStripped: strippedCount,
			};
		});

		const ranked = rankSources(discoveredSources);
		this._updateOp(opId, { sourcesDiscovered: ranked.length, sources: ranked.slice(0, 6) });
		for (const src of ranked.slice(0, 4)) {
			this._emit('source_discovered', opId, techKey, taskLabel, 'running', { sourceRef: src, projectId: req.projectRoot });
		}

		const inspectedSources: LeiSourceReference[] = [];
		const allVersions = new Set<string>();
		const allDeprecations: string[] = [];
		const allFindings: string[] = [];
		let fetchSuccessCount = 0;
		let lastFetchError: string | undefined;

		const toInspect = ranked.slice(0, this._policies.maxSourcesToInspect);
		for (const src of toInspect) {
			if (abort.signal.aborted) break;
			try {
				const page = await this._transport.fetchPage(src.url, abort.signal);
				fetchSuccessCount++;
				this._networkAvailable = true;
				const { sanitized, strippedCount } = sanitizeExternalContent(page.text);
				const meta = extractDocumentMetadata(sanitized);
				for (const v of meta.versions) allVersions.add(v);
				for (const d of meta.deprecationNotices) if (!allDeprecations.includes(d)) allDeprecations.push(d);
				for (const f of meta.findings) if (!allFindings.includes(f)) allFindings.push(f);

				const enriched: LeiSourceReference = {
					...src,
					title: page.title || src.title,
					url: page.url || src.url,
					lastUpdatedDate: meta.publishedOrUpdatedDate ?? src.lastUpdatedDate,
					snippet: sanitized.slice(0, 420),
					inspectedFullDocument: true,
					promptInjectionSignalsStripped: src.promptInjectionSignalsStripped + strippedCount,
				};
				inspectedSources.push(enriched);
				this._emit('source_opened', opId, techKey, taskLabel, 'running', { sourceRef: enriched, detail: `Inspected ${sanitized.length} chars`, projectId: req.projectRoot });
			} catch (err) {
				lastFetchError = err instanceof Error ? err.message : String(err);
				inspectedSources.push(src);
			}
		}

		const finalSources = rankSources([...inspectedSources, ...ranked.slice(toInspect.length)]);
		this._updateOp(opId, { sourcesOpened: fetchSuccessCount, sources: finalSources.slice(0, 8) });

		if (fetchSuccessCount === 0 && (searchFailureMessage || finalSources.length === 0)) {
			this._networkAvailable = false;
			const errMsg = `Live research unavailable: ${searchFailureMessage ?? lastFetchError ?? 'no reachable sources'}`;
			this._finishOp(opId, {
				status: 'failed',
				sources: finalSources,
				verificationStatus: 'unavailable',
				error: errMsg,
			}, req.projectRoot);
			return {
				operationId: opId,
				topic: freshness.topic,
				technology: techKey,
				freshness,
				verificationStatus: 'unavailable',
				summary: `${errMsg}. Do not assume cached or unverified knowledge is current.`,
				keyFindings: [],
				detectedVersions: [],
				deprecationNotices: freshness.detectedLegacySignals,
				recommendations: ['Restore network connectivity or configure a search provider (Brave/Tavily/Exa/You) in Kodia Settings, then re-run research.'],
				sources: finalSources,
				conflicts: [],
				fromCache: false,
				durationMs: Date.now() - startedAt,
				error: errMsg,
			};
		}

		this._emit('verification_started', opId, techKey, taskLabel, 'running', { projectId: req.projectRoot });

		const conflicts: LeiEvidenceConflict[] = [];
		const activeDocs = finalSources.filter(s => s.inspectedFullDocument && /\b(supported|recommended|current|active)\b/i.test(s.snippet) && !/\bdeprecat/i.test(s.snippet));
		const deprecatedDocs = finalSources.filter(s => s.inspectedFullDocument && /\b(deprecated|retired|removed|sunset)\b/i.test(s.snippet));
		if (activeDocs.length > 0 && deprecatedDocs.length > 0 && req.currentVersionOrId) {
			conflicts.push({
				aspect: `Support status of ${req.currentVersionOrId}`,
				claimA: 'Described as deprecated / retired / sunset',
				sourceA: deprecatedDocs[0].url,
				claimB: 'Described as active / supported',
				sourceB: activeDocs[0].url,
				resolutionHint: 'Prefer the more recent official release notes or live provider API response.',
			});
			this._emit('conflict_discovered', opId, techKey, taskLabel, 'warning', { detail: conflicts[0].aspect, projectId: req.projectRoot });
		}

		const evalRes = evaluateVerificationEvidence({
			sources: finalSources,
			conflicts,
			isDeprecated: allDeprecations.length > 0 && !!req.currentVersionOrId && allDeprecations.some(d => d.toLowerCase().includes(req.currentVersionOrId!.toLowerCase())),
		});

		const versionsArr = [...allVersions].slice(0, 10);
		const summary = allFindings[0]
			?? (allDeprecations[0] ? `Deprecation notice found: ${allDeprecations[0]}` : `Inspected ${fetchSuccessCount} authoritative source(s) for ${techKey}.`);
		const recommendation = allDeprecations.length > 0
			? `Review official deprecation notice before proceeding: ${allDeprecations[0]}`
			: versionsArr.length > 0
				? `Use verified current release/identifier from official docs (${versionsArr[0]}).`
				: `Follow official ${finalSources[0]?.authorityLabel ?? 'vendor documentation'} guidance.`;

		const ttlMs = getTtlForDomain(freshness.domain, this._policies);
		const nowMs = Date.now();
		const evidence: LeiEvidenceRecord = {
			id: `ev-${techKey}-${freshness.domain}`,
			technology: techKey,
			domain: freshness.domain,
			category: freshness.category,
			finding: summary,
			exactIdentifierOrVersion: versionsArr[0] ?? req.currentVersionOrId ?? 'latest-documented',
			sources: finalSources.slice(0, 6),
			lastUpdatedDate: finalSources.find(s => s.lastUpdatedDate)?.lastUpdatedDate,
			researchDate: new Date(nowMs).toISOString(),
			researchedAtMs: nowMs,
			versionApplicability: req.currentVersionOrId ?? 'current',
			confidence: evalRes.confidence,
			supportingEvidence: allFindings.slice(0, 6),
			conflictingEvidence: conflicts,
			verificationStatus: evalRes.status,
			knowledgeScope: req.projectRoot ? 'project_specific' : 'verified_current',
			cachePolicyMs: ttlMs,
			expiresAtMs: nowMs + ttlMs,
			projectId: req.projectRoot,
			recommendation,
		};

		this._upsertEvidence(evidence, req.projectRoot);
		this._emit('evidence_extracted', opId, techKey, taskLabel, 'success', { verificationStatus: evalRes.status, detail: summary, projectId: req.projectRoot });
		this._emit('verification_completed', opId, techKey, taskLabel, evalRes.status === 'conflicting_sources' ? 'warning' : 'success', { verificationStatus: evalRes.status, projectId: req.projectRoot });
		this._finishOp(opId, {
			status: 'completed',
			sourcesDiscovered: finalSources.length,
			sourcesOpened: fetchSuccessCount,
			sources: finalSources.slice(0, 8),
			verificationStatus: evalRes.status,
			selectedIdentifierOrVersion: evidence.exactIdentifierOrVersion,
			findingSummary: summary,
			recommendation,
			conflictCount: conflicts.length,
			fromCache: false,
		}, req.projectRoot);

		return {
			operationId: opId,
			topic: freshness.topic,
			technology: techKey,
			freshness,
			verificationStatus: evalRes.status,
			summary,
			keyFindings: allFindings.slice(0, 8),
			detectedVersions: versionsArr,
			deprecationNotices: allDeprecations,
			recommendations: [recommendation],
			sources: finalSources.slice(0, 8),
			conflicts,
			evidence,
			fromCache: false,
			durationMs: Date.now() - startedAt,
		};
	}

	async discoverProviderModels(req: LeiModelDiscoveryRequest): Promise<LeiModelDiscoveryReport> {
		const provider = req.provider.toLowerCase();
		const taskLabel = `${provider.toUpperCase()} model catalog discovery & capability verification`;
		const { opId, abort } = this._startOp('model_discovery', provider, taskLabel, req.projectRoot);
		const cfg = PROVIDER_MODEL_ENDPOINTS[provider];
		const sources: LeiSourceReference[] = [];
		const models: LeiDiscoveredModel[] = [];
		const deprecatedDetected: LeiDiscoveredModel[] = [];
		let discoveryMethod: LeiModelDiscoveryReport['discoveryMethod'] = 'unavailable';
		let apiError: string | undefined;

		const apiKey = await this._transport.getProviderApiKey(provider);

		if (cfg && (apiKey || cfg.allowPublic)) {
			this._emit('query_submitted', opId, provider, taskLabel, 'running', { detail: `GET ${cfg.url}`, projectId: req.projectRoot });
			try {
				const res = await this._transport.fetchJson(cfg.url, { headers: cfg.authHeader(apiKey ?? ''), signal: abort.signal });
				if (res.ok && res.data) {
					this._networkAvailable = true;
					const rawList: any[] = Array.isArray(res.data?.data) ? res.data.data
						: Array.isArray(res.data?.models) ? res.data.models
							: Array.isArray(res.data) ? res.data : [];

					const cred = scoreSourceCredibility(cfg.url, `${provider} models API`);
					const apiSrc: LeiSourceReference = {
						title: `${provider.toUpperCase()} Models API`,
						url: cfg.url,
						domain: extractDomain(cfg.url),
						tier: cred.tier,
						authorityLabel: `Official ${provider.toUpperCase()} API response`,
						authorityScore: Math.max(cred.authorityScore, 96),
						fetchedAt: Date.now(),
						snippet: `Returned ${rawList.length} model entries from ${cfg.url}`,
						inspectedFullDocument: true,
						promptInjectionSignalsStripped: 0,
					};
					sources.push(apiSrc);
					this._emit('source_opened', opId, provider, taskLabel, 'success', { sourceRef: apiSrc, projectId: req.projectRoot });

					discoveryMethod = 'provider_api';
					for (const raw of rawList) {
						const id = String(raw?.id ?? raw?.name ?? '').replace(/^models\//, '').trim();
						if (!id) continue;
						const deprecated = Boolean(raw?.deprecated || raw?.deprecation || raw?.shutdown_date || raw?.lifecycle === 'deprecated' || raw?.lifecycle === 'retired' || raw?.archived);
						const inferred = inferCapabilitiesFromModelId(id);
						const ctx = Number(raw?.context_length ?? raw?.context_window ?? raw?.max_context_length ?? raw?.inputTokenLimit ?? raw?.max_input_tokens ?? 0) || undefined;
						const maxOut = Number(raw?.max_output_tokens ?? raw?.max_tokens ?? raw?.outputTokenLimit ?? raw?.max_completion_tokens ?? 0) || undefined;
						const vision = typeof raw?.capabilities?.vision === 'boolean' ? raw.capabilities.vision
							: typeof raw?.capabilities?.image_input?.supported === 'boolean' ? raw.capabilities.image_input.supported
								: Array.isArray(raw?.input_modalities) ? raw.input_modalities.includes('image')
									: inferred.vision;
						const toolCalling = typeof raw?.capabilities?.function_calling === 'boolean' ? raw.capabilities.function_calling
							: typeof raw?.supports_tools === 'boolean' ? raw.supports_tools
								: inferred.toolCalling;

						const entry: LeiDiscoveredModel = {
							provider,
							modelId: id,
							displayName: raw?.display_name ?? raw?.name ?? id,
							releaseDate: raw?.created ? (typeof raw.created === 'number' ? new Date(raw.created * 1000).toISOString().slice(0, 10) : String(raw.created)) : undefined,
							deprecated,
							deprecationReason: typeof raw?.deprecation === 'string' ? raw.deprecation : raw?.shutdown_date ? `Shutdown date: ${raw.shutdown_date}` : undefined,
							capabilities: {
								...inferred,
								contextWindow: ctx ?? inferred.contextWindow,
								maxOutputTokens: maxOut ?? inferred.maxOutputTokens,
								vision,
								toolCalling,
								inputModalities: vision && !inferred.inputModalities.includes('image') ? [...inferred.inputModalities, 'image'] : inferred.inputModalities,
							},
							availability: {
								documented: true,
								publiclyListed: true,
								accountAccessible: apiKey ? true : 'unknown',
								endpointTested: false,
								endpointTestResult: 'not_run',
							},
							sources: [apiSrc],
							verificationStatus: deprecated ? 'deprecated' : 'verified_official_api',
							verifiedAtMs: Date.now(),
						};
						if (deprecated) deprecatedDetected.push(entry);
						else models.push(entry);
					}
				} else {
					apiError = `${cfg.url} returned HTTP ${res.status}`;
				}
			} catch (err) {
				apiError = err instanceof Error ? err.message : String(err);
			}
		}

		if (models.length === 0 && cfg?.docsUrl && !abort.signal.aborted) {
			try {
				const page = await this._transport.fetchPage(cfg.docsUrl, abort.signal);
				this._networkAvailable = true;
				const { sanitized, strippedCount } = sanitizeExternalContent(page.text);
				const cred = scoreSourceCredibility(page.url || cfg.docsUrl, page.title ?? '');
				const docSrc: LeiSourceReference = {
					title: page.title || `${provider.toUpperCase()} Official Model Documentation`,
					url: page.url || cfg.docsUrl,
					domain: extractDomain(page.url || cfg.docsUrl),
					tier: cred.tier,
					authorityLabel: cred.authorityLabel,
					authorityScore: cred.authorityScore,
					fetchedAt: Date.now(),
					snippet: sanitized.slice(0, 360),
					inspectedFullDocument: true,
					promptInjectionSignalsStripped: strippedCount,
				};
				sources.push(docSrc);
				this._emit('source_opened', opId, provider, taskLabel, 'success', { sourceRef: docSrc, projectId: req.projectRoot });

				const extractedIds = this._extractModelIdsFromDocs(provider, sanitized);
				for (const id of extractedIds) {
					const isDep = new RegExp(`${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^.\\n]{0,80}(deprecated|retired|sunset|legacy)`, 'i').test(sanitized);
					const m: LeiDiscoveredModel = {
						provider,
						modelId: id,
						deprecated: isDep,
						capabilities: inferCapabilitiesFromModelId(id),
						availability: {
							documented: true,
							publiclyListed: false,
							accountAccessible: 'unknown',
							endpointTested: false,
							endpointTestResult: 'not_run',
						},
						sources: [docSrc],
						verificationStatus: isDep ? 'deprecated' : 'verified_official_docs',
						verifiedAtMs: Date.now(),
					};
					if (isDep) deprecatedDetected.push(m);
					else models.push(m);
				}
				if (models.length > 0 || deprecatedDetected.length > 0) {
					discoveryMethod = 'official_docs_and_catalog';
				}
			} catch (err) {
				apiError = `${apiError ? apiError + '; ' : ''}docs fetch failed: ${err instanceof Error ? err.message : String(err)}`;
			}
		}

		this._emit('verification_started', opId, provider, taskLabel, 'running', { projectId: req.projectRoot });
		const selection = selectBestModelForTask(models, req.requirements);

		const evalRes = evaluateVerificationEvidence({
			sources,
			hasOfficialApiResponse: discoveryMethod === 'provider_api',
			isUnavailable: models.length === 0 && deprecatedDetected.length === 0,
		});

		let evidenceId: string | undefined;
		if (evalRes.status !== 'unavailable') {
			const ttlMs = this._policies.aiModelsTtlMs;
			const nowMs = Date.now();
			const rec: LeiEvidenceRecord = {
				id: `ev-models-${provider}`,
				technology: provider,
				domain: 'ai_models',
				category: 'C_rapidly_changing',
				finding: `Discovered ${models.length} active and ${deprecatedDetected.length} deprecated model(s) for ${provider} via ${discoveryMethod}.`,
				exactIdentifierOrVersion: selection.selected?.modelId ?? models[0]?.modelId ?? 'none',
				sources,
				researchDate: new Date(nowMs).toISOString(),
				researchedAtMs: nowMs,
				versionApplicability: `${provider} current catalog`,
				confidence: evalRes.confidence,
				supportingEvidence: models.slice(0, 6).map(m => `${m.modelId} (${m.capabilities.inputModalities.join('+')})`),
				conflictingEvidence: [],
				verificationStatus: evalRes.status,
				knowledgeScope: 'verified_current',
				cachePolicyMs: ttlMs,
				expiresAtMs: nowMs + ttlMs,
				projectId: req.projectRoot,
				recommendation: selection.reason,
			};
			this._upsertEvidence(rec, req.projectRoot);
			evidenceId = rec.id;
		} else {
			this._networkAvailable = false;
		}

		this._emit('verification_completed', opId, provider, taskLabel, evalRes.status === 'unavailable' ? 'error' : 'success', {
			verificationStatus: evalRes.status,
			detail: selection.reason,
			projectId: req.projectRoot,
		});

		this._finishOp(opId, {
			status: evalRes.status === 'unavailable' ? 'failed' : 'completed',
			sourcesDiscovered: sources.length,
			sourcesOpened: sources.filter(s => s.inspectedFullDocument).length,
			sources,
			verificationStatus: evalRes.status,
			selectedIdentifierOrVersion: selection.selected?.modelId,
			findingSummary: `Discovered ${models.length} active ${provider} model(s)`,
			recommendation: selection.reason,
			error: evalRes.status === 'unavailable' ? (apiError ?? `Could not reach ${provider} catalog or documentation`) : undefined,
		}, req.projectRoot);

		return {
			operationId: opId,
			provider,
			discoveredAtMs: Date.now(),
			discoveryMethod,
			models,
			deprecatedDetected,
			recommendedModel: selection.selected,
			recommendationReason: selection.reason,
			preserveUserModel: selection.preserveUserModel,
			sources,
			verificationStatus: evalRes.status,
			evidenceId,
			error: evalRes.status === 'unavailable' ? (apiError ?? `Could not reach ${provider} catalog or documentation`) : undefined,
		};
	}

	private _extractModelIdsFromDocs(provider: string, text: string): string[] {
		const found = new Set<string>();
		if (provider === 'nvidia') {
			const re = /\b(?:nvidia|meta|mistralai|deepseek-ai|qwen|google|microsoft)\/[a-z0-9][a-z0-9._-]{3,64}\b/gi;
			for (const m of text.match(re) ?? []) found.add(m.toLowerCase());
		} else if (provider === 'openai') {
			for (const m of text.match(/\b(?:gpt-[456][a-z0-9.-]*|o[134](?:-[a-z0-9.-]+)?)\b/gi) ?? []) found.add(m.toLowerCase());
		} else if (provider === 'anthropic') {
			for (const m of text.match(/\bclaude-[a-z0-9.-]{3,40}\b/gi) ?? []) found.add(m.toLowerCase());
		} else if (provider === 'gemini') {
			for (const m of text.match(/\bgemini-[0-9][a-z0-9.-]{2,35}\b/gi) ?? []) found.add(m.toLowerCase());
		} else {
			for (const m of text.match(/\b[a-z0-9-]+\/[a-z0-9._-]{3,50}\b/gi) ?? []) found.add(m.toLowerCase());
		}
		return [...found].slice(0, 30);
	}

	async verifyModelSelection(req: LeiModelVerificationRequest): Promise<LeiModelVerificationReport> {
		const provider = req.provider.toLowerCase();
		const freshness = await this.assessFreshness(`Verify ${provider} model ${req.modelId}`, provider, req.modelId);
		const discovery = await this.discoverProviderModels({
			provider,
			requirements: { ...(req.requirements ?? {}), currentModelId: req.modelId },
			forceRefresh: req.forceRefresh,
			projectRoot: req.projectRoot,
		});

		const lowerReq = req.modelId.toLowerCase();
		const activeMatch = discovery.models.find(m => m.modelId.toLowerCase() === lowerReq);
		const deprecatedMatch = discovery.deprecatedDetected.find(m => m.modelId.toLowerCase() === lowerReq);
		const isLegacyPattern = freshness.detectedLegacySignals.length > 0;
		const isDeprecated = Boolean(deprecatedMatch) || (isLegacyPattern && !activeMatch);

		const missingCapabilities: string[] = [];
		const targetCaps = activeMatch?.capabilities ?? inferCapabilitiesFromModelId(req.modelId);
		if ((req.requirements?.requiresVision || req.requirements?.taskType === 'vision') && !targetCaps.vision) {
			missingCapabilities.push('vision/image input');
		}
		if (req.requirements?.requiresAudio && !targetCaps.audio) {
			missingCapabilities.push('audio input');
		}
		if (req.requirements?.requiresToolCalling && targetCaps.toolCalling === false) {
			missingCapabilities.push('tool calling');
		}

		let availability = activeMatch?.availability ?? {
			documented: Boolean(deprecatedMatch),
			publiclyListed: false,
			accountAccessible: 'unknown' as const,
			endpointTested: false,
			endpointTestResult: 'not_run' as const,
		};

		if (req.testEndpoint && provider === 'nvidia') {
			const apiKey = await this._transport.getProviderApiKey('nvidia');
			if (apiKey) {
				try {
					const probe = await this._transport.fetchJson('https://integrate.api.nvidia.com/v1/chat/completions', {
						method: 'POST',
						headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
						body: JSON.stringify({ model: req.modelId, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
						timeoutMs: 10_000,
					});
					availability = {
						...availability,
						accountAccessible: probe.ok,
						endpointTested: true,
						endpointTestResult: probe.ok ? 'passed' : 'failed',
						endpointTestMessage: probe.ok ? 'Live chat/completions check succeeded' : `HTTP ${probe.status}`,
					};
				} catch (err) {
					availability = {
						...availability,
						endpointTested: true,
						endpointTestResult: 'failed',
						endpointTestMessage: err instanceof Error ? err.message : String(err),
					};
				}
			}
		}

		const isCurrent = Boolean(activeMatch) && !isDeprecated && missingCapabilities.length === 0;
		const verificationStatus: LeiVerificationStatus = discovery.verificationStatus === 'unavailable'
			? 'unavailable'
			: isDeprecated
				? (discovery.recommendedModel ? 'superseded' : 'deprecated')
				: !activeMatch
					? 'unverified'
					: availability.endpointTested && availability.endpointTestResult === 'passed'
						? 'cross_checked'
						: activeMatch.verificationStatus;

		const explanationParts: string[] = [];
		if (discovery.verificationStatus === 'unavailable') {
			explanationParts.push(`Unable to reach ${provider} catalog/documentation to verify "${req.modelId}".`);
		} else if (isDeprecated) {
			explanationParts.push(`"${req.modelId}" is deprecated, retired, or absent from the current active ${provider} catalog.`);
		} else if (!activeMatch) {
			explanationParts.push(`"${req.modelId}" was not found in the active ${provider} catalog (${discovery.models.length} active models discovered).`);
		} else {
			explanationParts.push(`"${req.modelId}" is present in the active ${provider} catalog (${discovery.discoveryMethod}).`);
		}
		if (missingCapabilities.length > 0) {
			explanationParts.push(`Does not satisfy required capabilities: ${missingCapabilities.join(', ')}.`);
		}
		if (!isCurrent && discovery.recommendedModel && discovery.recommendedModel.modelId.toLowerCase() !== lowerReq) {
			explanationParts.push(`Recommended verified alternative: "${discovery.recommendedModel.modelId}" — ${discovery.recommendationReason}`);
		}

		return {
			operationId: discovery.operationId,
			provider,
			requestedModelId: req.modelId,
			isCurrent,
			isDeprecated,
			isLegacyPattern,
			availability,
			capabilityMatch: missingCapabilities.length === 0,
			missingCapabilities,
			verificationStatus,
			recommendedAlternative: !isCurrent ? discovery.recommendedModel : undefined,
			explanation: explanationParts.join(' '),
			sources: discovery.sources,
			evidenceId: discovery.evidenceId,
		};
	}

	async checkDependency(req: LeiDependencyCheckRequest): Promise<LeiDependencyReport> {
		const pkg = req.packageName.trim();
		const eco = req.ecosystem;
		const taskLabel = `${eco}:${pkg} registry & security verification`;
		const { opId, abort } = this._startOp('dependency_check', `${eco}:${pkg}`, taskLabel, req.projectRoot);
		const sources: LeiSourceReference[] = [];
		const notes: string[] = [];

		let latestVersion: string | undefined;
		let deprecated = false;
		let deprecationMessage: string | undefined;
		let license: string | undefined;
		let lastPublishedDate: string | undefined;
		let homepage: string | undefined;
		let repositoryUrl: string | undefined;
		let runtimeRequirement: string | undefined;
		let peerDependencies: Record<string, string> = {};
		let registryUrl = '';
		let installCommand = '';
		let apiError: string | undefined;

		try {
			if (eco === 'npm') {
				registryUrl = `https://registry.npmjs.org/${encodeURIComponent(pkg)}`;
				installCommand = `npm install ${pkg}`;
				this._emit('query_submitted', opId, `${eco}:${pkg}`, taskLabel, 'running', { detail: `GET ${registryUrl}`, projectId: req.projectRoot });
				const res = await this._transport.fetchJson(registryUrl, { signal: abort.signal });
				if (!res.ok) throw new Error(`npm registry returned HTTP ${res.status}`);
				this._networkAvailable = true;
				const data = res.data;
				latestVersion = data?.['dist-tags']?.latest;
				const latestMeta = latestVersion ? data?.versions?.[latestVersion] : undefined;
				deprecated = Boolean(latestMeta?.deprecated);
				deprecationMessage = typeof latestMeta?.deprecated === 'string' ? latestMeta.deprecated : undefined;
				license = typeof latestMeta?.license === 'string' ? latestMeta.license : typeof data?.license === 'string' ? data.license : undefined;
				lastPublishedDate = latestVersion ? data?.time?.[latestVersion] : data?.time?.modified;
				homepage = latestMeta?.homepage ?? data?.homepage;
				repositoryUrl = typeof latestMeta?.repository === 'string' ? latestMeta.repository : latestMeta?.repository?.url;
				runtimeRequirement = latestMeta?.engines?.node ? `Node ${latestMeta.engines.node}` : undefined;
				peerDependencies = latestMeta?.peerDependencies ?? {};
				if (latestVersion) installCommand = `npm install ${pkg}@^${latestVersion}`;
			} else if (eco === 'pypi') {
				registryUrl = `https://pypi.org/pypi/${encodeURIComponent(pkg)}/json`;
				installCommand = `pip install ${pkg}`;
				this._emit('query_submitted', opId, `${eco}:${pkg}`, taskLabel, 'running', { detail: `GET ${registryUrl}`, projectId: req.projectRoot });
				const res = await this._transport.fetchJson(registryUrl, { signal: abort.signal });
				if (!res.ok) throw new Error(`PyPI returned HTTP ${res.status}`);
				this._networkAvailable = true;
				const info = res.data?.info ?? {};
				latestVersion = info.version;
				license = info.license || (Array.isArray(info.classifiers) ? info.classifiers.find((c: string) => c.startsWith('License ::')) : undefined);
				runtimeRequirement = info.requires_python ? `Python ${info.requires_python}` : undefined;
				homepage = info.home_page || info.project_urls?.Homepage || info.project_url;
				const releases = latestVersion ? res.data?.releases?.[latestVersion] : undefined;
				lastPublishedDate = Array.isArray(releases) && releases[0]?.upload_time_iso_8601 ? releases[0].upload_time_iso_8601 : undefined;
				deprecated = Boolean(info.yanked) || /deprecated/i.test(String(info.summary ?? ''));
				deprecationMessage = info.yanked_reason || (deprecated ? String(info.summary ?? '') : undefined);
				if (latestVersion) installCommand = `pip install "${pkg}==${latestVersion}"`;
			} else if (eco === 'pub') {
				registryUrl = `https://pub.dev/api/packages/${encodeURIComponent(pkg)}`;
				installCommand = `flutter pub add ${pkg}`;
				this._emit('query_submitted', opId, `${eco}:${pkg}`, taskLabel, 'running', { detail: `GET ${registryUrl}`, projectId: req.projectRoot });
				const res = await this._transport.fetchJson(registryUrl, { signal: abort.signal });
				if (!res.ok) throw new Error(`pub.dev returned HTTP ${res.status}`);
				this._networkAvailable = true;
				latestVersion = res.data?.latest?.version;
				lastPublishedDate = res.data?.latest?.published;
				deprecated = Boolean(res.data?.isDiscontinued);
				deprecationMessage = deprecated ? 'Package marked discontinued on pub.dev' : undefined;
				runtimeRequirement = res.data?.latest?.pubspec?.environment?.sdk ? `Dart SDK ${res.data.latest.pubspec.environment.sdk}` : undefined;
				if (latestVersion) installCommand = `flutter pub add ${pkg}:^${latestVersion}`;
			} else if (eco === 'crates') {
				registryUrl = `https://crates.io/api/v1/crates/${encodeURIComponent(pkg)}`;
				installCommand = `cargo add ${pkg}`;
				this._emit('query_submitted', opId, `${eco}:${pkg}`, taskLabel, 'running', { detail: `GET ${registryUrl}`, projectId: req.projectRoot });
				const res = await this._transport.fetchJson(registryUrl, { signal: abort.signal });
				if (!res.ok) throw new Error(`crates.io returned HTTP ${res.status}`);
				this._networkAvailable = true;
				const crate = res.data?.crate ?? {};
				latestVersion = crate.max_stable_version ?? crate.max_version;
				lastPublishedDate = crate.updated_at;
				homepage = crate.homepage ?? crate.documentation;
				repositoryUrl = crate.repository;
				if (latestVersion) installCommand = `cargo add ${pkg}@${latestVersion}`;
			} else if (eco === 'packagist') {
				registryUrl = `https://repo.packagist.org/p2/${pkg}.json`;
				installCommand = `composer require ${pkg}`;
				this._emit('query_submitted', opId, `${eco}:${pkg}`, taskLabel, 'running', { detail: `GET ${registryUrl}`, projectId: req.projectRoot });
				const res = await this._transport.fetchJson(registryUrl, { signal: abort.signal });
				if (!res.ok) throw new Error(`Packagist returned HTTP ${res.status}`);
				this._networkAvailable = true;
				const versions: any[] = res.data?.packages?.[pkg] ?? [];
				const stable = versions.find(v => !/dev|alpha|beta|rc/i.test(String(v.version ?? ''))) ?? versions[0];
				latestVersion = stable?.version;
				license = Array.isArray(stable?.license) ? stable.license.join(', ') : undefined;
				deprecated = Boolean(stable?.abandoned);
				deprecationMessage = typeof stable?.abandoned === 'string' ? `Abandoned — replacement: ${stable.abandoned}` : deprecated ? 'Marked abandoned on Packagist' : undefined;
				lastPublishedDate = stable?.time;
			} else {
				throw new Error(`Direct registry client for ${eco} not configured; use lei_research_technology.`);
			}

			const cred = scoreSourceCredibility(registryUrl, `${eco} registry ${pkg}`);
			const regSrc: LeiSourceReference = {
				title: `${eco} registry — ${pkg}`,
				url: registryUrl,
				domain: extractDomain(registryUrl),
				tier: cred.tier,
				authorityLabel: cred.authorityLabel,
				authorityScore: cred.authorityScore,
				lastUpdatedDate: lastPublishedDate,
				fetchedAt: Date.now(),
				snippet: `${pkg}@${latestVersion ?? 'unknown'} (${license ?? 'license unspecified'})`,
				inspectedFullDocument: true,
				promptInjectionSignalsStripped: 0,
			};
			sources.push(regSrc);
			this._emit('source_opened', opId, `${eco}:${pkg}`, taskLabel, 'success', { sourceRef: regSrc, projectId: req.projectRoot });
		} catch (err) {
			apiError = err instanceof Error ? err.message : String(err);
		}

		const secAudit = await this._queryOsvAdvisories(pkg, eco, req.currentVersion ?? latestVersion, abort.signal);
		if (secAudit.source) sources.push(secAudit.source);
		const vulnerabilities = secAudit.advisories;

		let compatibilityVerdict: LeiDependencyReport['compatibilityVerdict'] = 'compatible';
		if (apiError && !latestVersion) {
			compatibilityVerdict = 'unverified';
		} else if (deprecated) {
			compatibilityVerdict = 'deprecated';
			notes.push(`Package is marked deprecated in ${eco}. Select a maintained replacement before installing.`);
		} else if (vulnerabilities.some(v => v.severity === 'critical' || v.severity === 'high')) {
			compatibilityVerdict = 'vulnerable';
			notes.push(`Found ${vulnerabilities.length} known advisory(ies) in OSV. Review fixed versions before installing or upgrading.`);
		} else if (req.currentVersion && latestVersion) {
			const curMajor = parseInt(req.currentVersion.replace(/^[^0-9]*/, ''), 10);
			const latMajor = parseInt(latestVersion.replace(/^[^0-9]*/, ''), 10);
			if (!Number.isNaN(curMajor) && !Number.isNaN(latMajor) && latMajor > curMajor) {
				compatibilityVerdict = 'caution_breaking_change';
				notes.push(`Latest version (${latestVersion}) is a new major release vs current (${req.currentVersion}); review release notes and run tests before upgrading.`);
			}
		}

		if (Object.keys(peerDependencies).length > 0) {
			notes.push(`Peer dependencies: ${Object.entries(peerDependencies).map(([k, v]) => `${k}@${v}`).join(', ')}`);
		}

		const evalRes = evaluateVerificationEvidence({
			sources,
			hasOfficialApiResponse: Boolean(latestVersion),
			isDeprecated: deprecated,
			isUnavailable: !latestVersion && Boolean(apiError),
		});

		let evidenceId: string | undefined;
		if (evalRes.status !== 'unavailable') {
			const nowMs = Date.now();
			const ttlMs = this._policies.packageVersionsTtlMs;
			const rec: LeiEvidenceRecord = {
				id: `ev-dep-${eco}-${pkg}`,
				technology: `${eco}:${pkg}`,
				domain: 'package_versions',
				category: vulnerabilities.length > 0 ? 'D_critical' : 'B_version_sensitive',
				finding: `${pkg}@${latestVersion ?? 'unknown'} (${compatibilityVerdict}, ${vulnerabilities.length} advisories, license: ${license ?? 'unknown'})`,
				exactIdentifierOrVersion: latestVersion ?? req.currentVersion ?? 'unknown',
				sources,
				lastUpdatedDate: lastPublishedDate,
				researchDate: new Date(nowMs).toISOString(),
				researchedAtMs: nowMs,
				versionApplicability: latestVersion ?? 'latest',
				confidence: evalRes.confidence,
				supportingEvidence: notes,
				conflictingEvidence: [],
				verificationStatus: evalRes.status,
				knowledgeScope: req.projectRoot ? 'project_specific' : 'verified_current',
				cachePolicyMs: ttlMs,
				expiresAtMs: nowMs + ttlMs,
				projectId: req.projectRoot,
				recommendation: deprecated ? 'Replace deprecated package' : installCommand,
			};
			this._upsertEvidence(rec, req.projectRoot);
			evidenceId = rec.id;
		} else {
			this._networkAvailable = false;
		}

		this._finishOp(opId, {
			status: evalRes.status === 'unavailable' ? 'failed' : 'completed',
			sourcesDiscovered: sources.length,
			sourcesOpened: sources.length,
			sources,
			verificationStatus: evalRes.status,
			selectedIdentifierOrVersion: latestVersion,
			findingSummary: `${pkg}@${latestVersion ?? 'unavailable'} (${compatibilityVerdict})`,
			recommendation: installCommand,
			error: apiError,
		}, req.projectRoot);

		return {
			operationId: opId,
			packageName: pkg,
			ecosystem: eco,
			currentProjectVersion: req.currentVersion,
			latestVersion,
			recommendedVersion: latestVersion,
			deprecated,
			deprecationMessage,
			license,
			lastPublishedDate,
			homepage,
			repositoryUrl,
			runtimeRequirement,
			peerDependencies,
			vulnerabilities,
			compatibilityVerdict,
			installCommand: deprecated ? undefined : installCommand,
			notes,
			sources,
			verificationStatus: evalRes.status,
			evidenceId,
			error: apiError,
		};
	}

	private async _queryOsvAdvisories(
		pkg: string,
		ecosystem?: LeiPackageEcosystem,
		version?: string,
		signal?: AbortSignal,
	): Promise<{ advisories: LeiSecurityAdvisory[]; source?: LeiSourceReference; error?: string }> {
		const url = 'https://api.osv.dev/v1/query';
		const body: Record<string, any> = {
			package: ecosystem ? { name: pkg, ecosystem: OSV_ECOSYSTEM_MAP[ecosystem] } : { name: pkg },
		};
		if (version) {
			const cleanVer = version.replace(/^[\^~>=<v\s]+/, '').trim();
			if (cleanVer && /^\d/.test(cleanVer)) body.version = cleanVer;
		}
		try {
			const res = await this._transport.fetchJson(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
				signal,
			});
			if (!res.ok) return { advisories: [], error: `OSV API returned HTTP ${res.status}` };
			this._networkAvailable = true;
			const vulns: any[] = Array.isArray(res.data?.vulns) ? res.data.vulns : [];
			const advisories: LeiSecurityAdvisory[] = vulns.map(v => {
				const fixedVersions: string[] = [];
				for (const aff of v.affected ?? []) {
					for (const rng of aff.ranges ?? []) {
						for (const ev of rng.events ?? []) {
							if (ev.fixed && !fixedVersions.includes(ev.fixed)) fixedVersions.push(ev.fixed);
						}
					}
				}
				const rawSev = String(v.database_specific?.severity ?? v.severity?.[0]?.score ?? '').toLowerCase();
				const severity: LeiSecurityAdvisory['severity'] = /critical/.test(rawSev) ? 'critical'
					: /high/.test(rawSev) ? 'high'
						: /moderate|medium/.test(rawSev) ? 'moderate'
							: /low/.test(rawSev) ? 'low' : 'unknown';
				const refUrl = v.references?.find((r: any) => r.type === 'ADVISORY')?.url
					?? v.references?.[0]?.url
					?? `https://osv.dev/vulnerability/${v.id}`;
				return {
					id: String(v.id ?? 'OSV-UNKNOWN'),
					aliases: Array.isArray(v.aliases) ? v.aliases : [],
					summary: String(v.summary || v.details?.slice(0, 180) || 'Security advisory reported'),
					severity,
					affectedPackage: pkg,
					ecosystem: ecosystem ?? 'unknown',
					fixedVersions,
					publishedDate: v.published,
					modifiedDate: v.modified,
					sourceUrl: refUrl,
					authorityLabel: 'Official OSV / GHSA / CVE Security Advisory',
				};
			});

			const osvSrc: LeiSourceReference = {
				title: `OSV Security Advisory Database — ${pkg}`,
				url: `https://osv.dev/list?q=${encodeURIComponent(pkg)}`,
				domain: 'osv.dev',
				tier: 7,
				authorityLabel: 'Official security advisory',
				authorityScore: 97,
				fetchedAt: Date.now(),
				snippet: `${advisories.length} advisory(ies) matched for ${pkg}${version ? '@' + version : ''}`,
				inspectedFullDocument: true,
				promptInjectionSignalsStripped: 0,
			};
			return { advisories, source: osvSrc };
		} catch (err) {
			return { advisories: [], error: err instanceof Error ? err.message : String(err) };
		}
	}

	async checkSecurityAdvisories(req: LeiSecurityCheckRequest): Promise<LeiSecurityAuditReport> {
		const taskLabel = `Security advisory audit for ${req.target}${req.version ? '@' + req.version : ''}`;
		const { opId, abort } = this._startOp('security_audit', req.target, taskLabel, req.projectRoot);
		this._emit('query_submitted', opId, req.target, taskLabel, 'running', { detail: 'POST https://api.osv.dev/v1/query', projectId: req.projectRoot });

		const osv = await this._queryOsvAdvisories(req.target, req.ecosystem, req.version, abort.signal);
		const sources: LeiSourceReference[] = osv.source ? [osv.source] : [];
		if (osv.source) {
			this._emit('source_opened', opId, req.target, taskLabel, 'success', { sourceRef: osv.source, projectId: req.projectRoot });
		}

		const criticalCount = osv.advisories.filter(a => a.severity === 'critical').length;
		const highCount = osv.advisories.filter(a => a.severity === 'high').length;
		const moderateCount = osv.advisories.filter(a => a.severity === 'moderate').length;
		const lowCount = osv.advisories.filter(a => a.severity === 'low').length;

		const owaspGuidance = [
			'Verify dependency provenance and lockfile integrity before upgrading.',
			'Review breaking changes and run automated regression tests prior to updating production dependencies.',
		];
		const upgradeImpactNotes = osv.advisories.length > 0
			? [
				`Found ${osv.advisories.length} advisory(ies) (${criticalCount} critical, ${highCount} high).`,
				'Do not auto-upgrade production dependencies without checking peer-dependency compatibility and running the test suite.',
			]
			: ['No advisories matched in OSV for this package/version.'];

		const evalRes = evaluateVerificationEvidence({
			sources,
			hasOfficialApiResponse: Boolean(osv.source),
			isUnavailable: Boolean(osv.error) && !osv.source,
		});

		let evidenceId: string | undefined;
		if (evalRes.status !== 'unavailable') {
			const nowMs = Date.now();
			const ttlMs = this._policies.securityAdvisoriesTtlMs;
			const rec: LeiEvidenceRecord = {
				id: `ev-sec-${req.ecosystem ?? 'any'}-${req.target}`,
				technology: req.target,
				domain: 'security_advisories',
				category: 'D_critical',
				finding: `${osv.advisories.length} security advisory(ies) found for ${req.target}${req.version ? '@' + req.version : ''} (${criticalCount} critical, ${highCount} high).`,
				exactIdentifierOrVersion: req.version ?? 'all-versions',
				sources,
				researchDate: new Date(nowMs).toISOString(),
				researchedAtMs: nowMs,
				versionApplicability: req.version ?? 'any',
				confidence: evalRes.confidence,
				supportingEvidence: osv.advisories.slice(0, 5).map(a => `${a.id} (${a.severity}): ${a.summary}`),
				conflictingEvidence: [],
				verificationStatus: evalRes.status,
				knowledgeScope: 'verified_current',
				cachePolicyMs: ttlMs,
				expiresAtMs: nowMs + ttlMs,
				projectId: req.projectRoot,
				recommendation: upgradeImpactNotes.join(' '),
			};
			this._upsertEvidence(rec, req.projectRoot);
			evidenceId = rec.id;
		} else {
			this._networkAvailable = false;
		}

		this._finishOp(opId, {
			status: evalRes.status === 'unavailable' ? 'failed' : 'completed',
			sourcesDiscovered: sources.length,
			sourcesOpened: sources.length,
			sources,
			verificationStatus: evalRes.status,
			findingSummary: `${osv.advisories.length} advisory(ies) for ${req.target}`,
			error: osv.error,
		}, req.projectRoot);

		return {
			operationId: opId,
			target: req.target,
			ecosystem: req.ecosystem,
			version: req.version,
			advisories: osv.advisories,
			criticalCount,
			highCount,
			moderateCount,
			lowCount,
			owaspGuidance,
			upgradeImpactNotes,
			sources,
			verificationStatus: evalRes.status,
			evidenceId,
			error: osv.error,
		};
	}

	async diagnoseFailureWithResearch(req: LeiFailureDiagnosisRequest): Promise<LeiFailureDiagnosisReport> {
		const cleanErr = scrubSecretsFromQuery(req.errorMessage);
		const tech = normalizeTechnologyKey(cleanErr, req.technology);
		const likelyOutdatedCause = /\b(deprecated|removed|not\s+found|404|410|invalid\s+model|model\s+.*not\s+exist|unsupported|ERESOLVE|peer\s+dep|no\s+longer\s+supported|v1\/completions|ChatCompletion|migration)\b/i.test(cleanErr);

		if (likelyOutdatedCause) {
			await this.invalidateKnowledge({ technology: tech, reason: `Runtime failure detected: ${cleanErr.slice(0, 120)}`, projectRoot: req.projectRoot });
		}

		const research = await this.researchTechnology({
			topic: `${tech} error migration fix: ${cleanErr.slice(0, 140)}`,
			technology: tech,
			currentVersionOrId: req.currentVersion,
			forceRefresh: true,
			projectRoot: req.projectRoot,
		});

		const migrationSteps: string[] = [
			`Confirm the exact installed version/identifier for ${tech}${req.currentVersion ? ` (${req.currentVersion})` : ''}.`,
			research.deprecationNotices[0]
				? `Apply official migration guidance: ${research.deprecationNotices[0]}`
				: `Cross-check the failing call against the inspected official documentation (${research.sources[0]?.url ?? 'official docs'}).`,
			'Implement the smallest controlled fix without upgrading unrelated dependencies.',
			'Re-run the exact failing command/request to verify the repair.',
		];

		return {
			operationId: research.operationId,
			errorMessage: cleanErr,
			technology: tech,
			detectedVersion: req.currentVersion ?? research.detectedVersions[0],
			likelyOutdatedCause,
			rootCauseSummary: likelyOutdatedCause
				? `Failure signature indicates an outdated/deprecated API, model identifier, or dependency mismatch in ${tech}.`
				: `Investigated current ${tech} documentation for error: ${cleanErr.slice(0, 140)}`,
			recommendedFix: research.recommendations[0] ?? 'Follow the verified official documentation to migrate the failing call.',
			migrationSteps,
			research,
		};
	}

	async inspectEvidence(filter?: { technology?: string; domain?: LeiDomain; projectRoot?: string; includeStale?: boolean }): Promise<readonly LeiEvidenceRecord[]> {
		const now = Date.now();
		return [...this._evidence.values()]
			.filter(rec => {
				if (rec.invalidated && !filter?.includeStale) return false;
				if (!filter?.includeStale && now >= rec.expiresAtMs) return false;
				if (filter?.technology && !rec.technology.toLowerCase().includes(filter.technology.toLowerCase())) return false;
				if (filter?.domain && rec.domain !== filter.domain) return false;
				return true;
			})
			.sort((a, b) => b.researchedAtMs - a.researchedAtMs);
	}

	async refreshStaleKnowledge(projectRoot?: string): Promise<{ refreshed: number; failed: number; snapshot: LeiLiveSnapshot }> {
		const now = Date.now();
		const stale = [...this._evidence.values()].filter(e => !e.invalidated && (now >= e.expiresAtMs || (now - e.researchedAtMs) > e.cachePolicyMs * 0.75));
		let refreshed = 0;
		let failed = 0;
		for (const item of stale.slice(0, 6)) {
			const res = await this.researchTechnology({
				topic: item.technology,
				technology: item.technology,
				domain: item.domain,
				currentVersionOrId: item.exactIdentifierOrVersion,
				forceRefresh: true,
				projectRoot,
			});
			if (res.verificationStatus === 'unavailable') failed++;
			else refreshed++;
		}
		return { refreshed, failed, snapshot: this._buildSnapshot() };
	}

	async invalidateKnowledge(filter: { technology?: string; evidenceId?: string; reason: string; projectRoot?: string }): Promise<{ invalidated: number }> {
		let count = 0;
		for (const [id, rec] of this._evidence.entries()) {
			if (filter.evidenceId && id !== filter.evidenceId) continue;
			if (filter.technology && !rec.technology.toLowerCase().includes(filter.technology.toLowerCase())) continue;
			this._evidence.set(id, { ...rec, invalidated: true, invalidationReason: filter.reason });
			count++;
		}
		if (count > 0) {
			this._saveStore(filter.projectRoot);
			this._onDidChangeSnapshot.fire(this._buildSnapshot());
		}
		return { invalidated: count };
	}

	async cancelOperation(operationId: string): Promise<{ cancelled: boolean }> {
		const entry = this._activeOps.get(operationId);
		if (!entry) return { cancelled: false };
		entry.abort.abort();
		this._finishOp(operationId, { status: 'cancelled', verificationStatus: 'unavailable', error: 'Cancelled by user' });
		return { cancelled: true };
	}

	async updatePolicies(patch: Partial<LeiFreshnessPolicies>): Promise<LeiFreshnessPolicies> {
		this._policies = { ...this._policies, ...patch };
		this._saveStore();
		this._onDidChangeSnapshot.fire(this._buildSnapshot());
		return this._policies;
	}

	async getResearchHistory(limit = 30): Promise<readonly LeiOperationSummary[]> {
		return this._history.slice(0, Math.max(1, limit));
	}
}
