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
	IKodiaMobileMainService,
	KODIA_MOBILE_CHANNEL,
	MobileArchitectureDesignReport,
	MobileBuildTestResult,
	MobileEnvironmentProbeReport,
	MobileLiveEvent,
	MobilePerformanceAuditReport,
	MobileProductionReadinessReport,
	MobileProjectIntelligenceReport,
	MobileScaffoldResult,
	MobileSecurityAuditReport,
	MobileStudioSection,
} from '../common/mobileEngineeringTypes.js';

export const KODIA_OPEN_MOBILE_STUDIO_ACTION_ID = 'workbench.action.kodia.openMobileStudio';
const MOBILE_UI_STORAGE_KEY = 'kodia.mobileStudio.uiState.v1';

export interface MobileWorkbenchState {
	readonly activeSection: MobileStudioSection;
	readonly environment?: MobileEnvironmentProbeReport;
	readonly projectIntel?: MobileProjectIntelligenceReport;
	readonly architecture?: MobileArchitectureDesignReport;
	readonly lastScaffold?: MobileScaffoldResult;
	readonly lastBuildTest?: MobileBuildTestResult;
	readonly securityAudit?: MobileSecurityAuditReport;
	readonly performanceAudit?: MobilePerformanceAuditReport;
	readonly readinessReport?: MobileProductionReadinessReport;
	readonly liveEvents: readonly MobileLiveEvent[];
}

export interface IMobileEngineeringService {
	readonly _serviceBrand: undefined;
	readonly state: MobileWorkbenchState;
	readonly onDidChange: Event<void>;
	readonly onDidReceiveLiveEvent: Event<MobileLiveEvent>;

	getWorkspaceRoot(): string;
	refreshFromDisk(): Promise<void>;
	openStudio(section?: MobileStudioSection): Promise<void>;
	setActiveSection(section: MobileStudioSection): void;
	recordEnvironment(report: MobileEnvironmentProbeReport): void;
	recordProjectIntel(report: MobileProjectIntelligenceReport): void;
	recordArchitecture(report: MobileArchitectureDesignReport): void;
	recordScaffold(result: MobileScaffoldResult): void;
	recordBuildTest(result: MobileBuildTestResult): void;
	recordSecurityAudit(report: MobileSecurityAuditReport): void;
	recordPerformanceAudit(report: MobilePerformanceAuditReport): void;
	recordReadiness(report: MobileProductionReadinessReport): void;
	clearLiveEvents(): void;
}

export const IMobileEngineeringService = createDecorator<IMobileEngineeringService>('kodiaMobileEngineeringService');

const EMPTY_STATE: MobileWorkbenchState = {
	activeSection: 'overview',
	liveEvents: [],
};

export class MobileEngineeringService extends Disposable implements IMobileEngineeringService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _onDidReceiveLiveEvent = this._register(new Emitter<MobileLiveEvent>());
	readonly onDidReceiveLiveEvent: Event<MobileLiveEvent> = this._onDidReceiveLiveEvent.event;

	private readonly _mainService: IKodiaMobileMainService | undefined;
	private _state: MobileWorkbenchState = { ...EMPTY_STATE };
	private _seenIds = new Set<string>();

	get state(): MobileWorkbenchState { return this._state; }

	constructor(
		@IStorageService private readonly _storageService: IStorageService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@ICommandService private readonly _commandService: ICommandService,
		@IMainProcessService mainProcessService: IMainProcessService,
	) {
		super();
		try {
			const raw = this._storageService.get(MOBILE_UI_STORAGE_KEY, StorageScope.WORKSPACE);
			if (raw) {
				const parsed = JSON.parse(raw) as Partial<MobileWorkbenchState>;
				if (parsed.activeSection) {
					this._state = { ...EMPTY_STATE, activeSection: parsed.activeSection };
				}
			}
		} catch { /* ignore */ }
		try {
			this._mainService = ProxyChannel.toService<IKodiaMobileMainService>(mainProcessService.getChannel(KODIA_MOBILE_CHANNEL));
			this._register(this._mainService.onDidEmitEvent(ev => this._handleEvent(ev)));
		} catch {
			this._mainService = undefined;
		}
	}

	getWorkspaceRoot(): string {
		return this._workspaceContextService.getWorkspace().folders[0]?.uri.fsPath ?? '';
	}

	private _update(patch: Partial<MobileWorkbenchState>, persist = false): void {
		this._state = { ...this._state, ...patch };
		if (persist) {
			try {
				this._storageService.store(MOBILE_UI_STORAGE_KEY, JSON.stringify({ activeSection: this._state.activeSection }), StorageScope.WORKSPACE, StorageTarget.MACHINE);
			} catch { /* ignore */ }
		}
		this._onDidChange.fire();
	}

	private _handleEvent(ev: MobileLiveEvent): void {
		if (this._seenIds.has(ev.eventId)) { return; }
		this._seenIds.add(ev.eventId);
		const liveEvents = [...this._state.liveEvents, ev].sort((a, b) => a.seq - b.seq).slice(-300);
		this._state = { ...this._state, liveEvents };
		this._onDidReceiveLiveEvent.fire(ev);
		this._onDidChange.fire();
	}

	async refreshFromDisk(): Promise<void> {
		if (!this._mainService) { return; }
		const root = this.getWorkspaceRoot();
		try {
			const [snap, recent] = await Promise.all([
				this._mainService.loadWorkspaceSnapshot(root),
				this._mainService.getRecentEvents(150),
			]);
			for (const ev of recent) { this._seenIds.add(ev.eventId); }
			this._update({
				environment: snap.environment ?? this._state.environment,
				projectIntel: snap.projectIntel ?? this._state.projectIntel,
				architecture: snap.architecture ?? this._state.architecture,
				lastScaffold: snap.lastScaffold ?? this._state.lastScaffold,
				lastBuildTest: snap.lastBuildTest ?? this._state.lastBuildTest,
				securityAudit: snap.securityAudit ?? this._state.securityAudit,
				performanceAudit: snap.performanceAudit ?? this._state.performanceAudit,
				readinessReport: snap.readinessReport ?? this._state.readinessReport,
				liveEvents: recent.length > 0 ? recent : this._state.liveEvents,
			});
		} catch { /* ignore */ }
	}

	async openStudio(section?: MobileStudioSection): Promise<void> {
		if (section) { this.setActiveSection(section); }
		await this._commandService.executeCommand(KODIA_OPEN_MOBILE_STUDIO_ACTION_ID);
	}

	setActiveSection(section: MobileStudioSection): void {
		this._update({ activeSection: section }, true);
	}

	recordEnvironment(environment: MobileEnvironmentProbeReport): void { this._update({ environment }); }
	recordProjectIntel(projectIntel: MobileProjectIntelligenceReport): void { this._update({ projectIntel }); }
	recordArchitecture(architecture: MobileArchitectureDesignReport): void { this._update({ architecture }); }
	recordScaffold(lastScaffold: MobileScaffoldResult): void { this._update({ lastScaffold }); }
	recordBuildTest(lastBuildTest: MobileBuildTestResult): void { this._update({ lastBuildTest }); }
	recordSecurityAudit(securityAudit: MobileSecurityAuditReport): void { this._update({ securityAudit }); }
	recordPerformanceAudit(performanceAudit: MobilePerformanceAuditReport): void { this._update({ performanceAudit }); }
	recordReadiness(readinessReport: MobileProductionReadinessReport): void { this._update({ readinessReport }); }
	clearLiveEvents(): void { this._update({ liveEvents: [] }); }
}

registerSingleton(IMobileEngineeringService, MobileEngineeringService, InstantiationType.Delayed);
