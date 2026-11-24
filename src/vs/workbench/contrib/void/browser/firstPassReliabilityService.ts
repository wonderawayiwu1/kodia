/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import {
	EricRecordLessonResult,
	FpereArchitectureReport,
	FpereBlueprint,
	FpereCheckpointKind,
	FpereCoordinationResult,
	FpereEvent,
	FpereImportExportReport,
	FpereIntegrationReport,
	FpereLiveSnapshot,
	FpereQualityGateReport,
	FpereRepairPlan,
	IKodiaFirstPassReliabilityMainService,
} from '../common/firstPassReliabilityTypes.js';
import type {
	EricApiVerificationReport,
	EricApproachEvaluation,
	EricApproachOption,
	EricBehavioralSpec,
	EricEngineeringDomain,
	EricFailureCategory,
	EricIndependentReviewReport,
	EricSemanticReport,
} from '../common/engineeringReasoningTypes.js';

export interface IFirstPassReliabilityService {
	readonly _serviceBrand: undefined;
	readonly onDidEmitEvent: Event<FpereEvent>;
	readonly onDidChangeSnapshot: Event<FpereLiveSnapshot>;

	getCachedSnapshot(): FpereLiveSnapshot;
	getSnapshot(): Promise<FpereLiveSnapshot>;
	analyzeArchitecture(): Promise<FpereArchitectureReport>;
	saveBlueprint(bp: Omit<FpereBlueprint, 'id' | 'createdAtMs' | 'updatedAtMs'> & { id?: string }): Promise<FpereBlueprint>;
	validateImportsAndExports(targetFiles?: readonly string[]): Promise<FpereImportExportReport>;
	checkFullStackIntegration(checkpoint?: FpereCheckpointKind): Promise<FpereIntegrationReport>;
	runFirstPassQualityGate(opts?: { unitLabel?: string; targetFiles?: readonly string[]; checkpoint?: FpereCheckpointKind; runCompiler?: boolean; runTestCommand?: string; runBuildCommand?: string }): Promise<FpereQualityGateReport>;
	coordinateAgents(req: { action: 'acquire' | 'release' | 'status'; agentId?: string; taskId?: string; files?: readonly string[] }): Promise<FpereCoordinationResult>;
	planControlledRepair(req: { errorSummary: string; files?: readonly string[]; maxRetries?: number }): Promise<FpereRepairPlan>;
	// ERIC methods
	saveBehavioralSpec(spec: Omit<EricBehavioralSpec, 'id' | 'createdAtMs'> & { id?: string }): Promise<EricBehavioralSpec>;
	evaluateApproaches(req: { problem: string; domain: EricEngineeringDomain; options: readonly EricApproachOption[]; evidence?: readonly string[] }): Promise<EricApproachEvaluation>;
	verifyInstalledApiUsage(): Promise<EricApiVerificationReport>;
	analyzeSemanticCorrectness(): Promise<EricSemanticReport>;
	runIndependentReview(opts?: { testCommand?: string }): Promise<EricIndependentReviewReport>;
	recordFailureLesson(req: {
		category: EricFailureCategory;
		domain: EricEngineeringDomain;
		technology: string;
		symptom: string;
		rootCause: string;
		verifiedFixPattern: string;
		verificationEvidence: string;
		verifiedFix: boolean;
	}): Promise<EricRecordLessonResult>;
}

export const IFirstPassReliabilityService = createDecorator<IFirstPassReliabilityService>('kodiaFirstPassReliabilityService');

export class FirstPassReliabilityService extends Disposable implements IFirstPassReliabilityService {
	readonly _serviceBrand: undefined;

	private readonly _onDidEmitEvent = this._register(new Emitter<FpereEvent>());
	readonly onDidEmitEvent = this._onDidEmitEvent.event;

	private readonly _onDidChangeSnapshot = this._register(new Emitter<FpereLiveSnapshot>());
	readonly onDidChangeSnapshot = this._onDidChangeSnapshot.event;

	private _snapshot: FpereLiveSnapshot;

	constructor(
		@IKodiaFirstPassReliabilityMainService private readonly mainService: IKodiaFirstPassReliabilityMainService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
	) {
		super();
		const root = this._root();
		this._snapshot = {
			workspaceRoot: root,
			updatedAtMs: Date.now(),
			currentPhase: 'analyzing',
			currentStage: 'implemented',
			activeLeases: [],
			repairHistory: [],
			recentEvents: [],
		};

		this._register(this.mainService.onDidEmitEvent(ev => this._onDidEmitEvent.fire(ev)));
		this._register(this.mainService.onDidChangeSnapshot(snap => {
			this._snapshot = snap;
			this._onDidChangeSnapshot.fire(snap);
		}));

		if (root) {
			void this.getSnapshot();
		}
	}

	private _root(): string {
		return this.workspaceContextService.getWorkspace().folders[0]?.uri.fsPath ?? '';
	}

	getCachedSnapshot(): FpereLiveSnapshot { return this._snapshot; }

	async getSnapshot(): Promise<FpereLiveSnapshot> {
		try {
			const snap = await this.mainService.getSnapshot(this._root());
			this._snapshot = snap;
			this._onDidChangeSnapshot.fire(snap);
			return snap;
		} catch {
			return this._snapshot;
		}
	}

	async analyzeArchitecture(): Promise<FpereArchitectureReport> {
		return this.mainService.analyzeArchitecture(this._root());
	}

	async saveBlueprint(bp: Omit<FpereBlueprint, 'id' | 'createdAtMs' | 'updatedAtMs'> & { id?: string }): Promise<FpereBlueprint> {
		return this.mainService.saveBlueprint(this._root(), bp);
	}

	async validateImportsAndExports(targetFiles?: readonly string[]): Promise<FpereImportExportReport> {
		return this.mainService.validateImportsAndExports(this._root(), targetFiles);
	}

	async checkFullStackIntegration(checkpoint?: FpereCheckpointKind): Promise<FpereIntegrationReport> {
		return this.mainService.checkFullStackIntegration(this._root(), checkpoint);
	}

	async runFirstPassQualityGate(opts?: { unitLabel?: string; targetFiles?: readonly string[]; checkpoint?: FpereCheckpointKind; runCompiler?: boolean; runTestCommand?: string; runBuildCommand?: string }): Promise<FpereQualityGateReport> {
		return this.mainService.runFirstPassQualityGate(this._root(), opts);
	}

	async coordinateAgents(req: { action: 'acquire' | 'release' | 'status'; agentId?: string; taskId?: string; files?: readonly string[] }): Promise<FpereCoordinationResult> {
		return this.mainService.coordinateAgents(this._root(), req);
	}

	async planControlledRepair(req: { errorSummary: string; files?: readonly string[]; maxRetries?: number }): Promise<FpereRepairPlan> {
		return this.mainService.planControlledRepair(this._root(), req);
	}

	async saveBehavioralSpec(spec: Omit<EricBehavioralSpec, 'id' | 'createdAtMs'> & { id?: string }): Promise<EricBehavioralSpec> {
		return this.mainService.saveBehavioralSpec(this._root(), spec);
	}

	async evaluateApproaches(req: { problem: string; domain: EricEngineeringDomain; options: readonly EricApproachOption[]; evidence?: readonly string[] }): Promise<EricApproachEvaluation> {
		return this.mainService.evaluateApproaches(this._root(), req);
	}

	async verifyInstalledApiUsage(): Promise<EricApiVerificationReport> {
		return this.mainService.verifyInstalledApiUsage(this._root());
	}

	async analyzeSemanticCorrectness(): Promise<EricSemanticReport> {
		return this.mainService.analyzeSemanticCorrectness(this._root());
	}

	async runIndependentReview(opts?: { testCommand?: string }): Promise<EricIndependentReviewReport> {
		return this.mainService.runIndependentReview(this._root(), opts);
	}

	async recordFailureLesson(req: {
		category: EricFailureCategory;
		domain: EricEngineeringDomain;
		technology: string;
		symptom: string;
		rootCause: string;
		verifiedFixPattern: string;
		verificationEvidence: string;
		verifiedFix: boolean;
	}): Promise<EricRecordLessonResult> {
		return this.mainService.recordFailureLesson(this._root(), req);
	}
}

registerSingleton(IFirstPassReliabilityService, FirstPassReliabilityService, InstantiationType.Delayed);
