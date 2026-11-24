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
	CapabilityRadarReport,
	EvolutionHubSection,
	EvolutionLiveEvent,
	EvolutionProposal,
	IacFinOpsReport,
	IKodiaEvolutionMainService,
	IncidentForensicsReport,
	KODIA_EVOLUTION_CHANNEL,
	LegacyModernizationReport,
	PrivacyComplianceReport,
	ReleasePlanReport,
	SupplyChainAuditReport,
} from '../common/evolutionTypes.js';

export const KODIA_OPEN_EVOLUTION_HUB_ACTION_ID = 'workbench.action.kodia.openEvolutionHub';
const EVOLUTION_UI_STORAGE_KEY = 'kodia.evolutionHub.uiState.v1';

export interface EvolutionWorkbenchState {
	readonly activeSection: EvolutionHubSection;
	readonly supplyChainReports: readonly SupplyChainAuditReport[];
	readonly iacFinOpsReports: readonly IacFinOpsReport[];
	readonly incidentReports: readonly IncidentForensicsReport[];
	readonly releasePlans: readonly ReleasePlanReport[];
	readonly privacyReports: readonly PrivacyComplianceReport[];
	readonly modernizationReports: readonly LegacyModernizationReport[];
	readonly radarReports: readonly CapabilityRadarReport[];
	readonly proposals: readonly EvolutionProposal[];
	readonly liveEvents: readonly EvolutionLiveEvent[];
}

export interface IEvolutionService {
	readonly _serviceBrand: undefined;
	readonly state: EvolutionWorkbenchState;
	readonly onDidChange: Event<void>;
	readonly onDidReceiveLiveEvent: Event<EvolutionLiveEvent>;

	getWorkspaceRoot(): string;
	refreshFromDisk(): Promise<void>;
	openHub(section?: EvolutionHubSection): Promise<void>;
	setActiveSection(section: EvolutionHubSection): void;
	recordSupplyChain(report: SupplyChainAuditReport): void;
	recordIacFinOps(report: IacFinOpsReport): void;
	recordIncident(report: IncidentForensicsReport): void;
	recordReleasePlan(report: ReleasePlanReport): void;
	recordPrivacy(report: PrivacyComplianceReport): void;
	recordModernization(report: LegacyModernizationReport): void;
	recordRadar(report: CapabilityRadarReport): void;
	recordProposals(proposals: readonly EvolutionProposal[]): void;
	clearLiveEvents(): void;
}

export const IEvolutionService = createDecorator<IEvolutionService>('kodiaEvolutionService');

const EMPTY_STATE: EvolutionWorkbenchState = {
	activeSection: 'radar',
	supplyChainReports: [],
	iacFinOpsReports: [],
	incidentReports: [],
	releasePlans: [],
	privacyReports: [],
	modernizationReports: [],
	radarReports: [],
	proposals: [],
	liveEvents: [],
};

export class EvolutionService extends Disposable implements IEvolutionService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _onDidReceiveLiveEvent = this._register(new Emitter<EvolutionLiveEvent>());
	readonly onDidReceiveLiveEvent: Event<EvolutionLiveEvent> = this._onDidReceiveLiveEvent.event;

	private readonly _mainService: IKodiaEvolutionMainService | undefined;
	private _state: EvolutionWorkbenchState = { ...EMPTY_STATE };
	private _seenIds = new Set<string>();

	get state(): EvolutionWorkbenchState { return this._state; }

	constructor(
		@IStorageService private readonly _storageService: IStorageService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@ICommandService private readonly _commandService: ICommandService,
		@IMainProcessService mainProcessService: IMainProcessService,
	) {
		super();
		try {
			const raw = this._storageService.get(EVOLUTION_UI_STORAGE_KEY, StorageScope.WORKSPACE);
			if (raw) {
				const parsed = JSON.parse(raw) as Partial<EvolutionWorkbenchState>;
				if (parsed.activeSection) { this._state = { ...EMPTY_STATE, activeSection: parsed.activeSection }; }
			}
		} catch { /* ignore */ }
		try {
			this._mainService = ProxyChannel.toService<IKodiaEvolutionMainService>(mainProcessService.getChannel(KODIA_EVOLUTION_CHANNEL));
			this._register(this._mainService.onDidEmitEvent(ev => this._handleEvent(ev)));
		} catch {
			this._mainService = undefined;
		}
	}

	getWorkspaceRoot(): string {
		return this._workspaceContextService.getWorkspace().folders[0]?.uri.fsPath ?? '';
	}

	private _update(patch: Partial<EvolutionWorkbenchState>, persist = false): void {
		this._state = { ...this._state, ...patch };
		if (persist) {
			try {
				this._storageService.store(EVOLUTION_UI_STORAGE_KEY, JSON.stringify({ activeSection: this._state.activeSection }), StorageScope.WORKSPACE, StorageTarget.MACHINE);
			} catch { /* ignore */ }
		}
		this._onDidChange.fire();
	}

	private _handleEvent(ev: EvolutionLiveEvent): void {
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
				supplyChainReports: snap.supplyChainReports,
				iacFinOpsReports: snap.iacFinOpsReports,
				incidentReports: snap.incidentReports,
				releasePlans: snap.releasePlans,
				privacyReports: snap.privacyReports,
				modernizationReports: snap.modernizationReports,
				radarReports: snap.radarReports,
				proposals: snap.proposals,
				liveEvents: recent.length > 0 ? recent : this._state.liveEvents,
			});
		} catch { /* ignore */ }
	}

	async openHub(section?: EvolutionHubSection): Promise<void> {
		if (section) { this._update({ activeSection: section }, true); }
		try {
			await this._commandService.executeCommand(KODIA_OPEN_EVOLUTION_HUB_ACTION_ID);
		} catch { /* headless test env */ }
	}

	setActiveSection(activeSection: EvolutionHubSection): void { this._update({ activeSection }, true); }
	recordSupplyChain(r: SupplyChainAuditReport): void { this._update({ supplyChainReports: [r, ...this._state.supplyChainReports.filter(x => x.id !== r.id)].slice(0, 20) }); }
	recordIacFinOps(r: IacFinOpsReport): void { this._update({ iacFinOpsReports: [r, ...this._state.iacFinOpsReports.filter(x => x.id !== r.id)].slice(0, 20) }); }
	recordIncident(r: IncidentForensicsReport): void { this._update({ incidentReports: [r, ...this._state.incidentReports.filter(x => x.id !== r.id)].slice(0, 25) }); }
	recordReleasePlan(r: ReleasePlanReport): void { this._update({ releasePlans: [r, ...this._state.releasePlans.filter(x => x.id !== r.id)].slice(0, 20) }); }
	recordPrivacy(r: PrivacyComplianceReport): void { this._update({ privacyReports: [r, ...this._state.privacyReports.filter(x => x.id !== r.id)].slice(0, 20) }); }
	recordModernization(r: LegacyModernizationReport): void { this._update({ modernizationReports: [r, ...this._state.modernizationReports.filter(x => x.id !== r.id)].slice(0, 20) }); }
	recordRadar(r: CapabilityRadarReport): void { this._update({ radarReports: [r, ...this._state.radarReports.filter(x => x.id !== r.id)].slice(0, 20) }); }
	recordProposals(proposals: readonly EvolutionProposal[]): void { this._update({ proposals: [...proposals] }); }
	clearLiveEvents(): void { this._seenIds.clear(); this._update({ liveEvents: [] }); }
}

registerSingleton(IEvolutionService, EvolutionService, InstantiationType.Delayed);
