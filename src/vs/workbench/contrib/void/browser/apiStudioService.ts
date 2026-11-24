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
	ApiCollection,
	ApiEnvironment,
	ApiFailureCorrelationReport,
	ApiHistoryEntry,
	ApiLiveEvent,
	ApiLoadTestResult,
	ApiManagedRuntimeInfo,
	ApiMockServerStatus,
	ApiMonitorConfig,
	ApiProductionReadinessReport,
	ApiProjectDiscoveryReport,
	ApiRequestSpec,
	ApiResponseResult,
	ApiSecurityReport,
	ApiStudioLayoutPreset,
	ApiStudioSection,
	ApiTestRunResult,
	ApiTestSuite,
	ApiWebSocketSessionInfo,
	IKodiaApiStudioMainService,
	KODIA_API_STUDIO_CHANNEL,
} from '../common/apiStudioTypes.js';

export const KODIA_OPEN_API_STUDIO_ACTION_ID = 'workbench.action.kodia.openApiStudio';
export const KODIA_TOGGLE_API_STUDIO_ACTION_ID = 'workbench.action.kodia.toggleApiStudio';

const API_STUDIO_UI_STORAGE_KEY = 'kodia.apiStudio.uiState.v1';

export const DEFAULT_API_REQUEST: ApiRequestSpec = {
	id: 'req-default',
	name: 'New API Request',
	protocol: 'http',
	method: 'GET',
	url: 'http://127.0.0.1:3000/health',
	params: [],
	headers: [{ id: 'h-accept', key: 'Accept', value: 'application/json', enabled: true }],
	auth: { type: 'none' },
	body: { mode: 'none' },
	assertions: [
		{ id: 'a-1', name: 'Status 2xx', kind: 'status_range', expected: '200-299', enabled: true },
	],
};

export interface ApiStudioWorkbenchState {
	readonly activeSection: ApiStudioSection;
	readonly layoutPreset: ApiStudioLayoutPreset;
	readonly activeRequest: ApiRequestSpec;
	readonly latestResponse: ApiResponseResult | null;
	readonly discovery: ApiProjectDiscoveryReport | null;
	readonly collections: readonly ApiCollection[];
	readonly environments: readonly ApiEnvironment[];
	readonly activeEnvironmentId: string | null;
	readonly history: readonly ApiHistoryEntry[];
	readonly suites: readonly ApiTestSuite[];
	readonly testRuns: readonly ApiTestRunResult[];
	readonly loadRuns: readonly ApiLoadTestResult[];
	readonly securityReports: readonly ApiSecurityReport[];
	readonly monitors: readonly ApiMonitorConfig[];
	readonly runtimes: readonly ApiManagedRuntimeInfo[];
	readonly mockServers: readonly ApiMockServerStatus[];
	readonly webSockets: readonly ApiWebSocketSessionInfo[];
	readonly latestReadiness: ApiProductionReadinessReport | null;
	readonly latestFailureCorrelation: ApiFailureCorrelationReport | null;
	readonly liveEvents: readonly ApiLiveEvent[];
	readonly lastOpenRequestId?: string;
}

export interface IApiStudioService {
	readonly _serviceBrand: undefined;
	readonly state: ApiStudioWorkbenchState;
	readonly onDidChange: Event<void>;
	readonly onDidReceiveLiveEvent: Event<ApiLiveEvent>;

	getWorkspaceRoot(): string;
	refreshFromDisk(): Promise<void>;
	openStudio(opts?: { section?: ApiStudioSection; request?: ApiRequestSpec; layoutPreset?: ApiStudioLayoutPreset }): Promise<void>;

	setActiveSection(section: ApiStudioSection): void;
	setLayoutPreset(preset: ApiStudioLayoutPreset): void;
	setActiveRequest(req: ApiRequestSpec): void;
	recordResponse(res: ApiResponseResult): void;
	recordDiscovery(discovery: ApiProjectDiscoveryReport): void;
	recordTestRun(run: ApiTestRunResult): void;
	recordLoadRun(run: ApiLoadTestResult): void;
	recordSecurityReport(rep: ApiSecurityReport): void;
	recordReadiness(rep: ApiProductionReadinessReport): void;
	recordFailureCorrelation(rep: ApiFailureCorrelationReport): void;
	recordRuntimes(runtimes: readonly ApiManagedRuntimeInfo[]): void;
	recordMockServers(mocks: readonly ApiMockServerStatus[]): void;
	recordWebSockets(sessions: readonly ApiWebSocketSessionInfo[]): void;
	recordCollections(collections: readonly ApiCollection[]): void;
	recordEnvironments(envs: readonly ApiEnvironment[], activeId: string | null): void;
	recordSuites(suites: readonly ApiTestSuite[]): void;
	recordMonitors(monitors: readonly ApiMonitorConfig[]): void;
	clearLiveEvents(): void;
}

export const IApiStudioService = createDecorator<IApiStudioService>('kodiaApiStudioService');

const EMPTY_STATE: ApiStudioWorkbenchState = {
	activeSection: 'requests',
	layoutPreset: 'request-builder',
	activeRequest: DEFAULT_API_REQUEST,
	latestResponse: null,
	discovery: null,
	collections: [],
	environments: [],
	activeEnvironmentId: null,
	history: [],
	suites: [],
	testRuns: [],
	loadRuns: [],
	securityReports: [],
	monitors: [],
	runtimes: [],
	mockServers: [],
	webSockets: [],
	latestReadiness: null,
	latestFailureCorrelation: null,
	liveEvents: [],
};

export class ApiStudioService extends Disposable implements IApiStudioService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _onDidReceiveLiveEvent = this._register(new Emitter<ApiLiveEvent>());
	readonly onDidReceiveLiveEvent: Event<ApiLiveEvent> = this._onDidReceiveLiveEvent.event;

	private _state: ApiStudioWorkbenchState = { ...EMPTY_STATE };
	private _seenEventIds = new Set<string>();

	get state(): ApiStudioWorkbenchState {
		return this._state;
	}

	private readonly _mainService: IKodiaApiStudioMainService | undefined;

	constructor(
		@IStorageService private readonly _storageService: IStorageService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@ICommandService private readonly _commandService: ICommandService,
		@IMainProcessService mainProcessService: IMainProcessService,
	) {
		super();
		this._loadPersistedUiState();
		try {
			const channel = mainProcessService.getChannel(KODIA_API_STUDIO_CHANNEL);
			this._mainService = ProxyChannel.toService<IKodiaApiStudioMainService>(channel);
			this._register(this._mainService.onDidEmitEvent(ev => this._handleLiveEvent(ev)));
		} catch {
			this._mainService = undefined;
		}
	}

	getWorkspaceRoot(): string {
		return this._workspaceContextService.getWorkspace().folders[0]?.uri.fsPath ?? '';
	}

	private _loadPersistedUiState(): void {
		try {
			const raw = this._storageService.get(API_STUDIO_UI_STORAGE_KEY, StorageScope.WORKSPACE);
			if (!raw) { return; }
			const parsed = JSON.parse(raw) as Partial<ApiStudioWorkbenchState>;
			if (parsed && typeof parsed === 'object') {
				this._state = {
					...EMPTY_STATE,
					activeSection: parsed.activeSection ?? 'requests',
					layoutPreset: parsed.layoutPreset ?? 'request-builder',
					activeRequest: parsed.activeRequest ?? DEFAULT_API_REQUEST,
					discovery: parsed.discovery ?? null,
					latestReadiness: parsed.latestReadiness ?? null,
				};
			}
		} catch { /* ignore */ }
	}

	private _persistUiState(): void {
		try {
			const compact = {
				activeSection: this._state.activeSection,
				layoutPreset: this._state.layoutPreset,
				activeRequest: this._state.activeRequest,
				discovery: this._state.discovery,
				latestReadiness: this._state.latestReadiness,
			};
			this._storageService.store(API_STUDIO_UI_STORAGE_KEY, JSON.stringify(compact), StorageScope.WORKSPACE, StorageTarget.MACHINE);
		} catch { /* ignore */ }
	}

	private _update(patch: Partial<ApiStudioWorkbenchState>, persist = false): void {
		this._state = { ...this._state, ...patch };
		if (persist) { this._persistUiState(); }
		this._onDidChange.fire();
	}

	private _handleLiveEvent(ev: ApiLiveEvent): void {
		if (this._seenEventIds.has(ev.eventId)) { return; }
		this._seenEventIds.add(ev.eventId);
		if (this._seenEventIds.size > 1000) {
			const first = this._seenEventIds.values().next().value;
			if (first) { this._seenEventIds.delete(first); }
		}
		const merged = [...this._state.liveEvents, ev]
			.sort((a, b) => a.seq - b.seq)
			.slice(-400);
		this._state = { ...this._state, liveEvents: merged };
		this._onDidReceiveLiveEvent.fire(ev);
		this._onDidChange.fire();
	}

	async refreshFromDisk(): Promise<void> {
		if (!this._mainService) { return; }
		const root = this.getWorkspaceRoot();
		try {
			const [snap, recentEvents] = await Promise.all([
				this._mainService.loadWorkspaceSnapshot(root),
				this._mainService.getRecentEvents(200),
			]);
			for (const ev of recentEvents) { this._seenEventIds.add(ev.eventId); }
			this._update({
				collections: snap.collections,
				environments: snap.environments,
				activeEnvironmentId: snap.activeEnvironmentId,
				history: snap.history,
				suites: snap.suites,
				testRuns: snap.testRuns,
				loadRuns: snap.loadRuns,
				securityReports: snap.securityReports,
				monitors: snap.monitors,
				runtimes: snap.runtimes,
				mockServers: snap.mockServers,
				webSockets: snap.webSockets,
				liveEvents: recentEvents.length > 0 ? recentEvents : this._state.liveEvents,
				latestResponse: snap.history[0]?.response ?? this._state.latestResponse,
			});
		} catch { /* ignore when workspace closed */ }
	}

	async openStudio(opts?: { section?: ApiStudioSection; request?: ApiRequestSpec; layoutPreset?: ApiStudioLayoutPreset }): Promise<void> {
		const patch: Partial<ApiStudioWorkbenchState> = {
			...(opts?.section ? { activeSection: opts.section } : {}),
			...(opts?.request ? { activeRequest: opts.request } : {}),
			...(opts?.layoutPreset ? { layoutPreset: opts.layoutPreset } : {}),
		};
		if (Object.keys(patch).length > 0) {
			this._update(patch, true);
		}
		try {
			await this._commandService.executeCommand(KODIA_OPEN_API_STUDIO_ACTION_ID);
		} catch {
			// In headless unit/test harnesses without registered workbench editor pane, state still updates cleanly.
		}
	}

	setActiveSection(activeSection: ApiStudioSection): void { this._update({ activeSection }, true); }
	setLayoutPreset(layoutPreset: ApiStudioLayoutPreset): void { this._update({ layoutPreset }, true); }
	setActiveRequest(activeRequest: ApiRequestSpec): void { this._update({ activeRequest }, true); }
	recordResponse(latestResponse: ApiResponseResult): void { this._update({ latestResponse }); }
	recordDiscovery(discovery: ApiProjectDiscoveryReport): void { this._update({ discovery }, true); }
	recordTestRun(run: ApiTestRunResult): void {
		this._update({ testRuns: [run, ...this._state.testRuns.filter(r => r.runId !== run.runId)].slice(0, 50) });
	}
	recordLoadRun(run: ApiLoadTestResult): void {
		this._update({ loadRuns: [run, ...this._state.loadRuns.filter(r => r.runId !== run.runId)].slice(0, 30) });
	}
	recordSecurityReport(rep: ApiSecurityReport): void {
		this._update({ securityReports: [rep, ...this._state.securityReports.filter(r => r.id !== rep.id)].slice(0, 30) });
	}
	recordReadiness(latestReadiness: ApiProductionReadinessReport): void { this._update({ latestReadiness }, true); }
	recordFailureCorrelation(latestFailureCorrelation: ApiFailureCorrelationReport): void { this._update({ latestFailureCorrelation }); }
	recordRuntimes(runtimes: readonly ApiManagedRuntimeInfo[]): void { this._update({ runtimes: [...runtimes] }); }
	recordMockServers(mockServers: readonly ApiMockServerStatus[]): void { this._update({ mockServers: [...mockServers] }); }
	recordWebSockets(webSockets: readonly ApiWebSocketSessionInfo[]): void { this._update({ webSockets: [...webSockets] }); }
	recordCollections(collections: readonly ApiCollection[]): void { this._update({ collections: [...collections] }); }
	recordEnvironments(environments: readonly ApiEnvironment[], activeEnvironmentId: string | null): void {
		this._update({ environments: [...environments], activeEnvironmentId });
	}
	recordSuites(suites: readonly ApiTestSuite[]): void { this._update({ suites: [...suites] }); }
	recordMonitors(monitors: readonly ApiMonitorConfig[]): void { this._update({ monitors: [...monitors] }); }
	clearLiveEvents(): void {
		this._seenEventIds.clear();
		this._update({ liveEvents: [] });
	}
}

registerSingleton(IApiStudioService, ApiStudioService, InstantiationType.Delayed);
