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
	CompilerCheckOutcome,
	CorrectnessDiagnostic,
	CorrectnessHubSection,
	CorrectnessLiveEvent,
	DiagnosticSuppression,
	FuzzTestReport,
	IKodiaCorrectnessMainService,
	IncrementalAnalysisReport,
	IndependentVerificationReport,
	KODIA_CORRECTNESS_CHANNEL,
	MutationTestReport,
	ProofCarryingChangeRecord,
	ReleaseReadinessReport,
	RepairPlanRecord,
	RootCauseInvestigationReport,
	TaintAnalysisReport,
} from '../common/correctnessTypes.js';

export const KODIA_OPEN_CORRECTNESS_HUB_ACTION_ID = 'workbench.action.kodia.openCorrectnessHub';

const CORRECTNESS_UI_STORAGE_KEY = 'kodia.correctnessHub.uiState.v1';

export interface CorrectnessWorkbenchState {
	readonly activeSection: CorrectnessHubSection;
	readonly latestIncremental: IncrementalAnalysisReport | null;
	readonly latestCompilerOutcomes: readonly CompilerCheckOutcome[];
	readonly latestTaint: TaintAnalysisReport | null;
	readonly latestRepairPlan: RepairPlanRecord | null;
	readonly suppressions: readonly DiagnosticSuppression[];
	readonly investigations: readonly RootCauseInvestigationReport[];
	readonly fuzzRuns: readonly FuzzTestReport[];
	readonly mutationRuns: readonly MutationTestReport[];
	readonly verifications: readonly IndependentVerificationReport[];
	readonly proofs: readonly ProofCarryingChangeRecord[];
	readonly readinessReports: readonly ReleaseReadinessReport[];
	readonly liveEvents: readonly CorrectnessLiveEvent[];
}

export interface ICorrectnessService {
	readonly _serviceBrand: undefined;
	readonly state: CorrectnessWorkbenchState;
	readonly onDidChange: Event<void>;
	readonly onDidReceiveLiveEvent: Event<CorrectnessLiveEvent>;

	// Incremental cache kept in memory per workspace session
	getIncrementalCache(): { hashes: Record<string, string>; diagnosticsByFile: Record<string, CorrectnessDiagnostic[]> };
	setIncrementalCache(hashes: Record<string, string>, diagnosticsByFile: Record<string, CorrectnessDiagnostic[]>): void;

	getWorkspaceRoot(): string;
	refreshFromDisk(): Promise<void>;
	openHub(section?: CorrectnessHubSection): Promise<void>;

	setActiveSection(section: CorrectnessHubSection): void;
	recordIncremental(report: IncrementalAnalysisReport): void;
	recordCompilerOutcomes(outcomes: readonly CompilerCheckOutcome[]): void;
	recordTaint(report: TaintAnalysisReport): void;
	recordRepairPlan(plan: RepairPlanRecord): void;
	recordInvestigation(report: RootCauseInvestigationReport): void;
	recordFuzzRun(report: FuzzTestReport): void;
	recordMutationRun(report: MutationTestReport): void;
	recordVerification(report: IndependentVerificationReport): void;
	recordProofs(proofs: readonly ProofCarryingChangeRecord[]): void;
	recordReadiness(report: ReleaseReadinessReport): void;
	recordSuppressions(suppressions: readonly DiagnosticSuppression[]): void;
	clearLiveEvents(): void;
}

export const ICorrectnessService = createDecorator<ICorrectnessService>('kodiaCorrectnessService');

const EMPTY_STATE: CorrectnessWorkbenchState = {
	activeSection: 'diagnostics',
	latestIncremental: null,
	latestCompilerOutcomes: [],
	latestTaint: null,
	latestRepairPlan: null,
	suppressions: [],
	investigations: [],
	fuzzRuns: [],
	mutationRuns: [],
	verifications: [],
	proofs: [],
	readinessReports: [],
	liveEvents: [],
};

export class CorrectnessService extends Disposable implements ICorrectnessService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _onDidReceiveLiveEvent = this._register(new Emitter<CorrectnessLiveEvent>());
	readonly onDidReceiveLiveEvent: Event<CorrectnessLiveEvent> = this._onDidReceiveLiveEvent.event;

	private readonly _mainService: IKodiaCorrectnessMainService | undefined;
	private _state: CorrectnessWorkbenchState = { ...EMPTY_STATE };
	private _seenIds = new Set<string>();
	private _incHashes: Record<string, string> = {};
	private _incDiagsByFile: Record<string, CorrectnessDiagnostic[]> = {};

	get state(): CorrectnessWorkbenchState {
		return this._state;
	}

	constructor(
		@IStorageService private readonly _storageService: IStorageService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@ICommandService private readonly _commandService: ICommandService,
		@IMainProcessService mainProcessService: IMainProcessService,
	) {
		super();
		try {
			const raw = this._storageService.get(CORRECTNESS_UI_STORAGE_KEY, StorageScope.WORKSPACE);
			if (raw) {
				const parsed = JSON.parse(raw) as Partial<CorrectnessWorkbenchState>;
				if (parsed.activeSection) { this._state = { ...EMPTY_STATE, activeSection: parsed.activeSection }; }
			}
		} catch { /* ignore */ }
		try {
			this._mainService = ProxyChannel.toService<IKodiaCorrectnessMainService>(mainProcessService.getChannel(KODIA_CORRECTNESS_CHANNEL));
			this._register(this._mainService.onDidEmitEvent(ev => this._handleEvent(ev)));
		} catch {
			this._mainService = undefined;
		}
	}

	getWorkspaceRoot(): string {
		return this._workspaceContextService.getWorkspace().folders[0]?.uri.fsPath ?? '';
	}

	getIncrementalCache() {
		return { hashes: this._incHashes, diagnosticsByFile: this._incDiagsByFile };
	}

	setIncrementalCache(hashes: Record<string, string>, diagnosticsByFile: Record<string, CorrectnessDiagnostic[]>): void {
		this._incHashes = hashes;
		this._incDiagsByFile = diagnosticsByFile;
	}

	private _update(patch: Partial<CorrectnessWorkbenchState>, persist = false): void {
		this._state = { ...this._state, ...patch };
		if (persist) {
			try {
				this._storageService.store(CORRECTNESS_UI_STORAGE_KEY, JSON.stringify({ activeSection: this._state.activeSection }), StorageScope.WORKSPACE, StorageTarget.MACHINE);
			} catch { /* ignore */ }
		}
		this._onDidChange.fire();
	}

	private _handleEvent(ev: CorrectnessLiveEvent): void {
		if (this._seenIds.has(ev.eventId)) { return; }
		this._seenIds.add(ev.eventId);
		const liveEvents = [...this._state.liveEvents, ev].sort((a, b) => a.seq - b.seq).slice(-350);
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
				suppressions: snap.suppressions,
				investigations: snap.investigations,
				fuzzRuns: snap.fuzzRuns,
				mutationRuns: snap.mutationRuns,
				verifications: snap.verifications,
				proofs: snap.proofs,
				readinessReports: snap.readinessReports,
				liveEvents: recent.length > 0 ? recent : this._state.liveEvents,
			});
		} catch { /* ignore */ }
	}

	async openHub(section?: CorrectnessHubSection): Promise<void> {
		if (section) { this._update({ activeSection: section }, true); }
		try {
			await this._commandService.executeCommand(KODIA_OPEN_CORRECTNESS_HUB_ACTION_ID);
		} catch { /* headless test environment */ }
	}

	setActiveSection(activeSection: CorrectnessHubSection): void { this._update({ activeSection }, true); }
	recordIncremental(latestIncremental: IncrementalAnalysisReport): void { this._update({ latestIncremental }); }
	recordCompilerOutcomes(latestCompilerOutcomes: readonly CompilerCheckOutcome[]): void { this._update({ latestCompilerOutcomes: [...latestCompilerOutcomes] }); }
	recordTaint(latestTaint: TaintAnalysisReport): void { this._update({ latestTaint }); }
	recordRepairPlan(latestRepairPlan: RepairPlanRecord): void { this._update({ latestRepairPlan }); }
	recordInvestigation(report: RootCauseInvestigationReport): void {
		this._update({ investigations: [report, ...this._state.investigations.filter(i => i.id !== report.id)].slice(0, 40) });
	}
	recordFuzzRun(report: FuzzTestReport): void {
		this._update({ fuzzRuns: [report, ...this._state.fuzzRuns.filter(f => f.id !== report.id)].slice(0, 40) });
	}
	recordMutationRun(report: MutationTestReport): void {
		this._update({ mutationRuns: [report, ...this._state.mutationRuns.filter(m => m.id !== report.id)].slice(0, 30) });
	}
	recordVerification(report: IndependentVerificationReport): void {
		this._update({ verifications: [report, ...this._state.verifications.filter(v => v.id !== report.id)].slice(0, 50) });
	}
	recordProofs(proofs: readonly ProofCarryingChangeRecord[]): void { this._update({ proofs: [...proofs] }); }
	recordReadiness(report: ReleaseReadinessReport): void {
		this._update({ readinessReports: [report, ...this._state.readinessReports.filter(r => r.id !== report.id)].slice(0, 30) });
	}
	recordSuppressions(suppressions: readonly DiagnosticSuppression[]): void { this._update({ suppressions: [...suppressions] }); }
	clearLiveEvents(): void { this._seenIds.clear(); this._update({ liveEvents: [] }); }
}

registerSingleton(ICorrectnessService, CorrectnessService, InstantiationType.Eager);
