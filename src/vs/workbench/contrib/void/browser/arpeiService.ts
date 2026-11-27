/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import {
	ArpeiAssetRecord,
	ArpeiLiveEvent,
	ArpeiResearchMode,
	ArpeiResearchReadinessGate,
	ArpeiResearchSession,
	ArpeiScreenshotRecord,
	ArpeiSettings,
	ArpeiVisualComparisonRecord,
	ArpeiWorkspaceSection,
	ArpeiWorkspaceSnapshot,
	DEFAULT_ARPEI_SETTINGS,
	IKodiaArpeiMainService,
	KODIA_ARPEI_CHANNEL,
} from '../common/arpeiTypes.js';
import { IVoidSettingsService } from '../common/voidSettingsService.js';

export const KODIA_OPEN_ARPEI_ACTION_ID = 'workbench.action.kodia.openArpeiWorkspace';
export const KODIA_ARPEI_VIEW_CONTAINER_ID = 'workbench.view.kodiaArpei';
export const KODIA_ARPEI_SIDEBAR_VIEW_ID = 'workbench.view.kodiaArpei.explorer';

const ARPEI_UI_STORAGE_KEY = 'kodia.arpei.uiState.v1';

export interface ArpeiWorkbenchState {
	readonly activeSection: ArpeiWorkspaceSection;
	readonly activeSessionId: string | null;
	readonly isRunning: boolean;
	readonly activeStage: string | null;
	readonly progressPct: number;
	readonly sessions: readonly ArpeiResearchSession[];
	readonly activeBrowserStatus: ArpeiWorkspaceSnapshot['activeBrowserStatus'];
	readonly allScreenshots: readonly ArpeiScreenshotRecord[];
	readonly allAssets: readonly ArpeiAssetRecord[];
	readonly liveEvents: readonly ArpeiLiveEvent[];
	readonly lastError: string | null;
}

export interface IArpeiService {
	readonly _serviceBrand: undefined;
	readonly state: ArpeiWorkbenchState;
	readonly onDidChange: Event<void>;
	readonly onDidReceiveLiveEvent: Event<ArpeiLiveEvent>;

	getWorkspaceRoot(): string;
	getSettings(): ArpeiSettings;
	getActiveSession(): ArpeiResearchSession | null;

	openWorkspace(section?: ArpeiWorkspaceSection): Promise<void>;
	setActiveSection(section: ArpeiWorkspaceSection): void;
	setActiveSession(sessionId: string): void;
	refreshFromDisk(): Promise<void>;

	/**
	 * 1-click full end-to-end live investigation pipeline:
	 * 1. Domain & Strategy Plan -> 2. Live Web & Docs Search -> 3. Live Playwright Browser & Screenshots -> 4. Licensed Assets -> 5. 13-Point Readiness Gate.
	 */
	runFullLiveInvestigation(opts: {
		userPrompt: string;
		referenceUrl?: string;
		mode?: ArpeiResearchMode;
		maxPages?: number;
	}): Promise<ArpeiResearchSession>;

	planAndInitResearch(opts: { userPrompt: string; referenceUrls?: readonly string[]; mode?: ArpeiResearchMode; openWorkspace?: boolean }): Promise<ArpeiResearchSession>;
	exploreReferenceProduct(opts: { sessionId: string; rootUrl?: string; discoverReferences?: boolean; maxPages?: number; captureScreenshots?: boolean; testInteractions?: boolean }): Promise<ArpeiResearchSession>;
	researchTechnicalAndDomain(opts: { sessionId: string; queries: readonly string[]; docUrls?: readonly string[] }): Promise<ArpeiResearchSession>;
	discoverAndDownloadAssets(opts: { sessionId: string; queries: readonly { readonly query: string; readonly usage: string; readonly altText: string }[]; downloadToLocal?: boolean }): Promise<ArpeiAssetRecord[]>;
	evaluateReadinessGate(sessionId: string, userFastTrack?: boolean): Promise<ArpeiResearchReadinessGate>;
	compareReferenceVsImplementation(opts: { sessionId: string; referenceScreenshotId: string; implementationUrl: string; pageLabel?: string }): Promise<ArpeiVisualComparisonRecord>;
	queryResearchMemory(query: string, sessionId?: string): ReturnType<IKodiaArpeiMainService['queryResearchMemory']>;

	pauseActiveResearch(): Promise<void>;
	resumeActiveResearch(): Promise<void>;
	cancelActiveResearch(): Promise<void>;
}

export const IArpeiService = createDecorator<IArpeiService>('kodiaArpeiService');

const EMPTY_STATE: ArpeiWorkbenchState = {
	activeSection: 'overview',
	activeSessionId: null,
	isRunning: false,
	activeStage: null,
	progressPct: 0,
	sessions: [],
	activeBrowserStatus: { running: false, paused: false },
	allScreenshots: [],
	allAssets: [],
	liveEvents: [],
	lastError: null,
};

export class ArpeiService extends Disposable implements IArpeiService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _onDidReceiveLiveEvent = this._register(new Emitter<ArpeiLiveEvent>());
	readonly onDidReceiveLiveEvent: Event<ArpeiLiveEvent> = this._onDidReceiveLiveEvent.event;

	private readonly _mainService: IKodiaArpeiMainService | undefined;
	private _state: ArpeiWorkbenchState = { ...EMPTY_STATE };
	private _seenIds = new Set<string>();
	private _runningSessionId: string | null = null;
	private _cancelRequested = false;
	private _liveRefreshTimer: ReturnType<typeof setTimeout> | null = null;
	private _orchestrating = false;

	get state(): ArpeiWorkbenchState {
		return this._state;
	}

	constructor(
		@IStorageService private readonly _storageService: IStorageService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@ICommandService private readonly _commandService: ICommandService,
		@IVoidSettingsService private readonly _voidSettingsService: IVoidSettingsService,
		@IMainProcessService mainProcessService: IMainProcessService,
	) {
		super();
		try {
			const raw = this._storageService.get(ARPEI_UI_STORAGE_KEY, StorageScope.WORKSPACE);
			if (raw) {
				const parsed = JSON.parse(raw) as Partial<ArpeiWorkbenchState>;
				this._state = {
					...EMPTY_STATE,
					activeSection: parsed.activeSection ?? 'overview',
					activeSessionId: parsed.activeSessionId ?? null,
				};
			}
		} catch { /* ignore */ }

		try {
			this._mainService = ProxyChannel.toService<IKodiaArpeiMainService>(mainProcessService.getChannel(KODIA_ARPEI_CHANNEL));
			this._register(this._mainService.onDidEmitEvent(ev => this._handleEvent(ev)));
		} catch {
			this._mainService = undefined;
		}
		void this.refreshFromDisk();
	}

	getWorkspaceRoot(): string {
		return this._workspaceContextService.getWorkspace().folders[0]?.uri.fsPath ?? '';
	}

	getSettings(): ArpeiSettings {
		return { ...DEFAULT_ARPEI_SETTINGS, ...(this._voidSettingsService.state.globalSettings.arpei ?? {}) };
	}

	getActiveSession(): ArpeiResearchSession | null {
		if (!this._state.sessions.length) { return null; }
		return this._state.sessions.find(s => s.id === this._state.activeSessionId) ?? this._state.sessions[0] ?? null;
	}

	private _update(patch: Partial<ArpeiWorkbenchState>, persist = false): void {
		this._state = { ...this._state, ...patch };
		if (persist) {
			try {
				this._storageService.store(ARPEI_UI_STORAGE_KEY, JSON.stringify({
					activeSection: this._state.activeSection,
					activeSessionId: this._state.activeSessionId,
				}), StorageScope.WORKSPACE, StorageTarget.MACHINE);
			} catch { /* ignore */ }
		}
		this._onDidChange.fire();
	}

	private _scheduleLiveRefresh(): void {
		if (this._liveRefreshTimer) { return; }
		this._liveRefreshTimer = setTimeout(() => {
			this._liveRefreshTimer = null;
			void this.refreshFromDisk();
		}, 650);
	}

	private _handleEvent(ev: ArpeiLiveEvent): void {
		if (this._seenIds.has(ev.eventId)) { return; }
		this._seenIds.add(ev.eventId);
		const liveEvents = [...this._state.liveEvents, ev].slice(-300);
		let isRunning = this._state.isRunning;
		if (ev.type === 'website_opened') {
			isRunning = true;
			this._runningSessionId = ev.sessionId;
		} else if (ev.type === 'verification_completed' && !this._orchestrating) {
			isRunning = false;
			this._runningSessionId = null;
		}
		this._update({
			liveEvents,
			isRunning,
			activeBrowserStatus: {
				running: isRunning,
				currentUrl: ev.url ?? this._state.activeBrowserStatus.currentUrl,
				currentAction: ev.detail,
				paused: this._state.activeBrowserStatus.paused,
			},
		});
		if (
			ev.type === 'page_visited' ||
			ev.type === 'screenshot_captured' ||
			ev.type === 'source_discovered' ||
			ev.type === 'source_verified' ||
			ev.type === 'asset_downloaded' ||
			ev.type === 'finding_extracted' ||
			ev.type === 'verification_completed'
		) {
			this._scheduleLiveRefresh();
		}
		this._onDidReceiveLiveEvent.fire(ev);
	}

	async openWorkspace(section?: ArpeiWorkspaceSection): Promise<void> {
		if (section) { this.setActiveSection(section); }
		await this._commandService.executeCommand(KODIA_OPEN_ARPEI_ACTION_ID);
	}

	setActiveSection(section: ArpeiWorkspaceSection): void {
		this._update({ activeSection: section }, true);
	}

	setActiveSession(sessionId: string): void {
		this._update({ activeSessionId: sessionId }, true);
	}

	async refreshFromDisk(): Promise<void> {
		if (!this._mainService) { return; }
		const root = this.getWorkspaceRoot();
		if (!root) { return; }
		try {
			const snap = await this._mainService.loadWorkspaceSnapshot(root);
			for (const ev of snap.liveEvents) { this._seenIds.add(ev.eventId); }
			this._update({
				sessions: snap.sessions,
				activeSessionId: this._state.activeSessionId ?? snap.sessions[0]?.id ?? null,
				activeBrowserStatus: snap.activeBrowserStatus,
				allScreenshots: snap.allScreenshots,
				allAssets: snap.allAssets,
				liveEvents: snap.liveEvents.length > this._state.liveEvents.length ? snap.liveEvents : this._state.liveEvents,
				lastError: null,
			});
		} catch (e) {
			this._update({ lastError: e instanceof Error ? e.message : String(e) });
		}
	}

	async runFullLiveInvestigation(opts: {
		userPrompt: string;
		referenceUrl?: string;
		mode?: ArpeiResearchMode;
		maxPages?: number;
	}): Promise<ArpeiResearchSession> {
		if (!this._mainService) { throw new Error('ARPEI main process service unavailable.'); }
		const cleanPrompt = opts.userPrompt.trim();
		const cleanRef = opts.referenceUrl?.trim() || undefined;
		this._cancelRequested = false;
		this._orchestrating = true;
		this._update({
			isRunning: true,
			activeStage: 'Step 1/5: Analyzing domain, roles & research strategy...',
			progressPct: 10,
			lastError: null,
			activeBrowserStatus: { running: true, currentAction: 'Analyzing domain & strategy...', paused: false },
		});

		let session: ArpeiResearchSession | null = null;
		try {
			// Stage 1: Plan & Domain Discovery
			session = await this._mainService.planAndInitResearch({
				workspaceRoot: this.getWorkspaceRoot(),
				userPrompt: cleanPrompt,
				referenceUrls: cleanRef ? [cleanRef] : [],
				mode: opts.mode,
				settings: this.getSettings(),
			});
			this._runningSessionId = session.id;
			this._update({ activeSessionId: session.id, progressPct: 20, activeStage: 'Step 2/5: Running live web & official documentation search...' }, true);
			await this.refreshFromDisk();
			if (this._cancelRequested) { return session; }

			// Stage 2: Live Web Search & Official Documentation Corroboration
			const searchQueries = [
				cleanPrompt.length <= 32 ? `${cleanPrompt} official website core features` : cleanPrompt.slice(0, 96),
				`${session.domainDiscovery.softwareCategory} architecture best practices`,
			];
			try {
				session = await this._mainService.researchTechnicalAndDomain({
					workspaceRoot: this.getWorkspaceRoot(),
					sessionId: session.id,
					queries: searchQueries,
				});
			} catch { /* non-fatal — proceed to browser exploration */ }
			await this.refreshFromDisk();
			if (this._cancelRequested) { return session; }

			// Stage 3: Live Playwright Browser Exploration, Interaction Testing & Screenshot Capture
			this._update({
				progressPct: 45,
				activeStage: 'Step 3/5: Exploring live website in Playwright Chromium & capturing screenshots...',
				activeBrowserStatus: { running: true, currentUrl: cleanRef, currentAction: 'Launching live browser & capturing screenshots...', paused: false },
			});
			try {
				session = await this._mainService.exploreReferenceProduct({
					workspaceRoot: this.getWorkspaceRoot(),
					sessionId: session.id,
					rootUrl: cleanRef,
					discoverReferences: !cleanRef,
					maxPages: opts.maxPages ?? 4,
					captureScreenshots: true,
					testInteractions: true,
				});
			} catch (err) {
				this._update({ lastError: `Browser inspection warning: ${err instanceof Error ? err.message : String(err)}` });
			}
			await this.refreshFromDisk();
			if (this._cancelRequested) { return session; }

			// Stage 4: Licensed Visual Assets Discovery
			this._update({
				progressPct: 80,
				activeStage: 'Step 4/5: Discovering verified visual assets & design tokens...',
			});
			try {
				await this._mainService.discoverAndDownloadAssets({
					workspaceRoot: this.getWorkspaceRoot(),
					sessionId: session.id,
					queries: [
						{
							query: `${cleanPrompt.slice(0, 48)} ${session.domainDiscovery.softwareCategory}`.trim(),
							usage: 'hero-banner',
							altText: `${session.title} hero visual`,
						},
					],
					downloadToLocal: true,
				});
			} catch { /* non-fatal */ }
			await this.refreshFromDisk();
			if (this._cancelRequested) { return session; }

			// Stage 5: Finalize 13-Point Pre-Implementation Readiness Gate
			this._update({
				progressPct: 95,
				activeStage: 'Step 5/5: Evaluating 13-point Pre-Implementation Readiness Gate...',
			});
			try {
				await this._mainService.evaluateReadinessGate({
					workspaceRoot: this.getWorkspaceRoot(),
					sessionId: session.id,
				});
			} catch { /* non-fatal */ }

			await this.refreshFromDisk();
			return this.getActiveSession() ?? session;
		} catch (e) {
			this._update({ lastError: e instanceof Error ? e.message : String(e) });
			throw e;
		} finally {
			this._orchestrating = false;
			this._runningSessionId = null;
			this._cancelRequested = false;
			this._update({
				isRunning: false,
				activeStage: null,
				progressPct: 100,
				activeBrowserStatus: { running: false, paused: false },
			});
			await this.refreshFromDisk();
		}
	}

	async planAndInitResearch(opts: { userPrompt: string; referenceUrls?: readonly string[]; mode?: ArpeiResearchMode; openWorkspace?: boolean }): Promise<ArpeiResearchSession> {
		if (!this._mainService) { throw new Error('ARPEI main process service unavailable.'); }
		if (opts.openWorkspace) { await this.openWorkspace('overview'); }
		const session = await this._mainService.planAndInitResearch({
			workspaceRoot: this.getWorkspaceRoot(),
			userPrompt: opts.userPrompt,
			referenceUrls: opts.referenceUrls,
			mode: opts.mode,
			settings: this.getSettings(),
		});
		await this.refreshFromDisk();
		this._update({ activeSessionId: session.id }, true);
		return session;
	}

	async exploreReferenceProduct(opts: { sessionId: string; rootUrl?: string; discoverReferences?: boolean; maxPages?: number; captureScreenshots?: boolean; testInteractions?: boolean }): Promise<ArpeiResearchSession> {
		if (!this._mainService) { throw new Error('ARPEI main process service unavailable.'); }
		this._runningSessionId = opts.sessionId;
		this._update({ isRunning: true, activeStage: 'Exploring reference website in live browser...', progressPct: 50 });
		try {
			const session = await this._mainService.exploreReferenceProduct({ workspaceRoot: this.getWorkspaceRoot(), ...opts });
			await this.refreshFromDisk();
			this._update({ isRunning: false, activeStage: null, progressPct: 100, activeSessionId: session.id }, true);
			return session;
		} catch (e) {
			this._update({ isRunning: false, activeStage: null, lastError: e instanceof Error ? e.message : String(e) });
			throw e;
		} finally {
			this._runningSessionId = null;
		}
	}

	async researchTechnicalAndDomain(opts: { sessionId: string; queries: readonly string[]; docUrls?: readonly string[] }): Promise<ArpeiResearchSession> {
		if (!this._mainService) { throw new Error('ARPEI main process service unavailable.'); }
		this._update({ isRunning: true, activeStage: 'Running live web & documentation search...', progressPct: 50 });
		try {
			const session = await this._mainService.researchTechnicalAndDomain({ workspaceRoot: this.getWorkspaceRoot(), ...opts });
			await this.refreshFromDisk();
			return session;
		} finally {
			this._update({ isRunning: false, activeStage: null, progressPct: 100 });
		}
	}

	async discoverAndDownloadAssets(opts: { sessionId: string; queries: readonly { readonly query: string; readonly usage: string; readonly altText: string }[]; downloadToLocal?: boolean }): Promise<ArpeiAssetRecord[]> {
		if (!this._mainService) { throw new Error('ARPEI main process service unavailable.'); }
		this._update({ isRunning: true, activeStage: 'Discovering licensed visual assets...', progressPct: 60 });
		try {
			const assets = await this._mainService.discoverAndDownloadAssets({ workspaceRoot: this.getWorkspaceRoot(), ...opts });
			await this.refreshFromDisk();
			return assets;
		} finally {
			this._update({ isRunning: false, activeStage: null, progressPct: 100 });
		}
	}

	async evaluateReadinessGate(sessionId: string, userFastTrack?: boolean): Promise<ArpeiResearchReadinessGate> {
		if (!this._mainService) { throw new Error('ARPEI main process service unavailable.'); }
		const gate = await this._mainService.evaluateReadinessGate({ workspaceRoot: this.getWorkspaceRoot(), sessionId, userFastTrack });
		await this.refreshFromDisk();
		return gate;
	}

	async compareReferenceVsImplementation(opts: { sessionId: string; referenceScreenshotId: string; implementationUrl: string; pageLabel?: string }): Promise<ArpeiVisualComparisonRecord> {
		if (!this._mainService) { throw new Error('ARPEI main process service unavailable.'); }
		const cmp = await this._mainService.compareReferenceVsImplementation({ workspaceRoot: this.getWorkspaceRoot(), ...opts });
		await this.refreshFromDisk();
		return cmp;
	}

	async queryResearchMemory(query: string, sessionId?: string) {
		if (!this._mainService) { throw new Error('ARPEI main process service unavailable.'); }
		return this._mainService.queryResearchMemory({ workspaceRoot: this.getWorkspaceRoot(), query, sessionId });
	}

	async pauseActiveResearch(): Promise<void> {
		if (this._mainService && this._runningSessionId) { await this._mainService.pauseResearch(this._runningSessionId); }
	}

	async resumeActiveResearch(): Promise<void> {
		if (this._mainService && this._runningSessionId) { await this._mainService.resumeResearch(this._runningSessionId); }
	}

	async cancelActiveResearch(): Promise<void> {
		this._cancelRequested = true;
		if (this._mainService && this._runningSessionId) {
			try { await this._mainService.cancelResearch(this._runningSessionId); } catch { /* ignore */ }
		}
		this._runningSessionId = null;
		this._orchestrating = false;
		this._update({
			isRunning: false,
			activeStage: null,
			activeBrowserStatus: { running: false, paused: false },
		});
	}
}

registerSingleton(IArpeiService, ArpeiService, InstantiationType.Delayed);
