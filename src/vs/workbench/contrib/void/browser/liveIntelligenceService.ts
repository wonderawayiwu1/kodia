/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import {
	DEFAULT_LEI_FRESHNESS_POLICIES,
	IKodiaLiveIntelligenceMainService,
	LeiDependencyCheckRequest,
	LeiDependencyReport,
	LeiDomain,
	LeiEvent,
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
	LeiResearchRequest,
	LeiResearchResult,
	LeiSecurityAuditReport,
	LeiSecurityCheckRequest,
} from '../common/liveIntelligenceTypes.js';

export const KODIA_OPEN_LIVE_INTELLIGENCE_ACTION_ID = 'kodia.openLiveEngineeringIntelligence';

export type LeiDashboardTab = 'overview' | 'research' | 'models' | 'dependencies' | 'evidence' | 'policies';

export interface ILiveIntelligenceService {
	readonly _serviceBrand: undefined;
	readonly onDidEmitEvent: Event<LeiEvent>;
	readonly onDidChangeSnapshot: Event<LeiLiveSnapshot>;
	readonly onDidChangeActiveTab: Event<LeiDashboardTab>;

	getActiveTab(): LeiDashboardTab;
	setActiveTab(tab: LeiDashboardTab): void;
	openDashboard(tab?: LeiDashboardTab): Promise<void>;

	getCachedSnapshot(): LeiLiveSnapshot;
	getSnapshot(): Promise<LeiLiveSnapshot>;
	assessFreshness(topic: string, technology?: string, currentVersionOrId?: string): Promise<LeiFreshnessAssessment>;
	researchTechnology(req: LeiResearchRequest): Promise<LeiResearchResult>;
	discoverProviderModels(req: LeiModelDiscoveryRequest): Promise<LeiModelDiscoveryReport>;
	verifyModelSelection(req: LeiModelVerificationRequest): Promise<LeiModelVerificationReport>;
	checkDependency(req: LeiDependencyCheckRequest): Promise<LeiDependencyReport>;
	checkSecurityAdvisories(req: LeiSecurityCheckRequest): Promise<LeiSecurityAuditReport>;
	diagnoseFailureWithResearch(req: LeiFailureDiagnosisRequest): Promise<LeiFailureDiagnosisReport>;
	inspectEvidence(filter?: { technology?: string; domain?: LeiDomain; includeStale?: boolean }): Promise<readonly LeiEvidenceRecord[]>;
	refreshStaleKnowledge(): Promise<{ refreshed: number; failed: number; snapshot: LeiLiveSnapshot }>;
	invalidateKnowledge(filter: { technology?: string; evidenceId?: string; reason: string }): Promise<{ invalidated: number }>;
	cancelOperation(operationId: string): Promise<{ cancelled: boolean }>;
	updatePolicies(patch: Partial<LeiFreshnessPolicies>): Promise<LeiFreshnessPolicies>;
	getResearchHistory(limit?: number): Promise<readonly LeiOperationSummary[]>;
}

export const ILiveIntelligenceService = createDecorator<ILiveIntelligenceService>('kodiaLiveIntelligenceService');

const INITIAL_SNAPSHOT: LeiLiveSnapshot = {
	systemStatus: 'initializing',
	researchMode: 'live_research_enabled',
	currentTask: 'Connecting to Live Engineering Intelligence engine…',
	activeTechnologies: [],
	sources: [],
	verificationStatus: 'not_applicable',
	knowledgeFreshness: 'unknown_freshness',
	networkAvailable: true,
	webSearchConfigured: true,
	evidenceCount: 0,
	verifiedEvidenceCount: 0,
	staleEvidenceCount: 0,
	conflictCount: 0,
	activeOperations: [],
	recentOperations: [],
	recentEvents: [],
	policies: DEFAULT_LEI_FRESHNESS_POLICIES,
};

export class LiveIntelligenceService extends Disposable implements ILiveIntelligenceService {
	readonly _serviceBrand: undefined;

	private readonly _onDidEmitEvent = this._register(new Emitter<LeiEvent>());
	readonly onDidEmitEvent = this._onDidEmitEvent.event;

	private readonly _onDidChangeSnapshot = this._register(new Emitter<LeiLiveSnapshot>());
	readonly onDidChangeSnapshot = this._onDidChangeSnapshot.event;

	private readonly _onDidChangeActiveTab = this._register(new Emitter<LeiDashboardTab>());
	readonly onDidChangeActiveTab = this._onDidChangeActiveTab.event;

	private _activeTab: LeiDashboardTab = 'overview';
	private _snapshot: LeiLiveSnapshot = INITIAL_SNAPSHOT;
	private _seenEventIds = new Set<string>();

	constructor(
		@IKodiaLiveIntelligenceMainService private readonly mainService: IKodiaLiveIntelligenceMainService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super();

		this._register(this.mainService.onDidEmitEvent(ev => {
			if (this._seenEventIds.has(ev.eventId)) return;
			this._seenEventIds.add(ev.eventId);
			if (this._seenEventIds.size > 400) {
				const first = this._seenEventIds.values().next().value;
				if (first) this._seenEventIds.delete(first);
			}
			this._onDidEmitEvent.fire(ev);
		}));

		this._register(this.mainService.onDidChangeSnapshot(snap => {
			this._snapshot = snap;
			this._onDidChangeSnapshot.fire(snap);
		}));

		void this.getSnapshot();
	}

	private _projectRoot(): string | undefined {
		return this.workspaceContextService.getWorkspace().folders[0]?.uri.fsPath;
	}

	getActiveTab(): LeiDashboardTab { return this._activeTab; }
	setActiveTab(tab: LeiDashboardTab): void {
		this._activeTab = tab;
		this._onDidChangeActiveTab.fire(tab);
	}

	async openDashboard(tab?: LeiDashboardTab): Promise<void> {
		if (tab) this.setActiveTab(tab);
		await this.commandService.executeCommand(KODIA_OPEN_LIVE_INTELLIGENCE_ACTION_ID);
	}

	getCachedSnapshot(): LeiLiveSnapshot { return this._snapshot; }

	async getSnapshot(): Promise<LeiLiveSnapshot> {
		try {
			const snap = await this.mainService.getSnapshot(this._projectRoot());
			this._snapshot = snap;
			this._onDidChangeSnapshot.fire(snap);
			return snap;
		} catch {
			return this._snapshot;
		}
	}

	async assessFreshness(topic: string, technology?: string, currentVersionOrId?: string): Promise<LeiFreshnessAssessment> {
		return this.mainService.assessFreshness(topic, technology, currentVersionOrId, this._projectRoot());
	}

	async researchTechnology(req: LeiResearchRequest): Promise<LeiResearchResult> {
		return this.mainService.researchTechnology({ ...req, projectRoot: req.projectRoot ?? this._projectRoot() });
	}

	async discoverProviderModels(req: LeiModelDiscoveryRequest): Promise<LeiModelDiscoveryReport> {
		return this.mainService.discoverProviderModels({ ...req, projectRoot: req.projectRoot ?? this._projectRoot() });
	}

	async verifyModelSelection(req: LeiModelVerificationRequest): Promise<LeiModelVerificationReport> {
		return this.mainService.verifyModelSelection({ ...req, projectRoot: req.projectRoot ?? this._projectRoot() });
	}

	async checkDependency(req: LeiDependencyCheckRequest): Promise<LeiDependencyReport> {
		return this.mainService.checkDependency({ ...req, projectRoot: req.projectRoot ?? this._projectRoot() });
	}

	async checkSecurityAdvisories(req: LeiSecurityCheckRequest): Promise<LeiSecurityAuditReport> {
		return this.mainService.checkSecurityAdvisories({ ...req, projectRoot: req.projectRoot ?? this._projectRoot() });
	}

	async diagnoseFailureWithResearch(req: LeiFailureDiagnosisRequest): Promise<LeiFailureDiagnosisReport> {
		return this.mainService.diagnoseFailureWithResearch({ ...req, projectRoot: req.projectRoot ?? this._projectRoot() });
	}

	async inspectEvidence(filter?: { technology?: string; domain?: LeiDomain; includeStale?: boolean }): Promise<readonly LeiEvidenceRecord[]> {
		return this.mainService.inspectEvidence({ ...filter, projectRoot: this._projectRoot() });
	}

	async refreshStaleKnowledge(): Promise<{ refreshed: number; failed: number; snapshot: LeiLiveSnapshot }> {
		const res = await this.mainService.refreshStaleKnowledge(this._projectRoot());
		this._snapshot = res.snapshot;
		this._onDidChangeSnapshot.fire(res.snapshot);
		return res;
	}

	async invalidateKnowledge(filter: { technology?: string; evidenceId?: string; reason: string }): Promise<{ invalidated: number }> {
		return this.mainService.invalidateKnowledge({ ...filter, projectRoot: this._projectRoot() });
	}

	async cancelOperation(operationId: string): Promise<{ cancelled: boolean }> {
		return this.mainService.cancelOperation(operationId);
	}

	async updatePolicies(patch: Partial<LeiFreshnessPolicies>): Promise<LeiFreshnessPolicies> {
		return this.mainService.updatePolicies(patch);
	}

	async getResearchHistory(limit?: number): Promise<readonly LeiOperationSummary[]> {
		return this.mainService.getResearchHistory(limit);
	}
}

registerSingleton(ILiveIntelligenceService, LiveIntelligenceService, InstantiationType.Delayed);
