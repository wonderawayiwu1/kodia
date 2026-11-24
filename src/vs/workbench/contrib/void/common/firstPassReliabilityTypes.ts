/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import type {
	EricApiVerificationReport,
	EricApproachEvaluation,
	EricApproachOption,
	EricBehavioralSpec,
	EricEngineeringDomain,
	EricFailureCategory,
	EricFailureLesson,
	EricIndependentReviewReport,
	EricSemanticReport,
} from './engineeringReasoningTypes.js';

export const KODIA_FPERE_CHANNEL = 'void-channel-firstPassReliability';

// ── Quality Gate Classifications (Section 8) ───────────────────────────────────────────

export type FpereQualityStage =
	| 'implemented'
	| 'static_checks_passed'
	| 'type_checks_passed'
	| 'integrated'
	| 'tests_passed'
	| 'build_verified'
	| 'runtime_verified'
	| 'partially_verified'
	| 'blocked'
	| 'failed';

export type FpereCheckpointKind =
	| 'project_foundation'
	| 'database_layer'
	| 'backend_services'
	| 'api_layer'
	| 'frontend_foundation'
	| 'authentication'
	| 'ai_integration'
	| 'background_processing'
	| 'mobile_integration'
	| 'full_stack_workflow';

// ── Deep Repository Architecture Understanding (Section 4) ─────────────────────────────

export interface FpereModuleSummary {
	readonly path: string;
	readonly layer: 'frontend' | 'backend' | 'api' | 'database' | 'auth' | 'shared' | 'mobile' | 'ai' | 'config' | 'test' | 'other';
	readonly language: string;
	readonly exportedSymbols: readonly string[];
	readonly hasDefaultExport: boolean;
	readonly importedModules: readonly string[];
	readonly apiEndpoints: readonly string[];
	readonly dbEntities: readonly string[];
	readonly envVarsUsed: readonly string[];
}

export interface FpereArchitectureReport {
	readonly workspaceRoot: string;
	readonly analyzedAtMs: number;
	readonly languages: readonly string[];
	readonly frameworks: readonly string[];
	readonly entryPoints: readonly string[];
	readonly declaredPackages: readonly string[];
	readonly totalFiles: number;
	readonly totalExports: number;
	readonly totalApiEndpoints: number;
	readonly totalDbEntities: number;
	readonly envVarsDeclared: readonly string[];
	readonly envVarsReferenced: readonly string[];
	readonly modules: readonly FpereModuleSummary[];
	readonly namingConvention: 'camelCase' | 'snake_case' | 'kebab-case' | 'mixed';
	readonly circularDependencies: readonly (readonly string[])[];
	readonly summary: string;
}

// ── Contract-First Engineering Blueprint & Task DAG (Section 5) ────────────────────────

export interface FpereApiContract {
	readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'WS' | 'SSE';
	readonly path: string;
	readonly requestFields?: readonly string[];
	readonly responseFields?: readonly string[];
	readonly requiresAuth?: boolean;
	readonly backendFile?: string;
	readonly frontendConsumerFiles?: readonly string[];
}

export interface FpereDbModelContract {
	readonly name: string;
	readonly fields: readonly string[];
	readonly relations?: readonly string[];
	readonly schemaFile?: string;
}

export interface FpereSharedInterfaceContract {
	readonly name: string;
	readonly definedIn: string;
	readonly exportedSymbols: readonly string[];
	readonly consumers: readonly string[];
}

export interface FpereTaskDagNode {
	readonly id: string;
	readonly title: string;
	readonly checkpoint: FpereCheckpointKind;
	readonly ownerAgent?: string;
	readonly ownedFiles: readonly string[];
	readonly dependsOn: readonly string[];
	readonly requiredContracts: readonly string[];
	readonly status: 'pending' | 'ready' | 'in_progress' | 'verified' | 'blocked' | 'failed';
	readonly qualityStage?: FpereQualityStage;
}

export interface FpereBlueprint {
	readonly id: string;
	readonly title: string;
	readonly objective: string;
	readonly createdAtMs: number;
	readonly updatedAtMs: number;
	readonly stack: readonly string[];
	readonly moduleBoundaries: readonly { name: string; directory: string; responsibility: string }[];
	readonly sharedInterfaces: readonly FpereSharedInterfaceContract[];
	readonly apiContracts: readonly FpereApiContract[];
	readonly dbModels: readonly FpereDbModelContract[];
	readonly requiredEnvVars: readonly string[];
	readonly buildCommand?: string;
	readonly testCommand?: string;
	readonly acceptanceCriteria: readonly string[];
	readonly tasks: readonly FpereTaskDagNode[];
}

// ── Import/Export, Code Hygiene & Full-Stack Integration Checks (Sections 6, 7, 10) ────

export type FpereIssueKind =
	| 'broken_relative_import'
	| 'missing_named_export'
	| 'missing_default_export'
	| 'undeclared_package_import'
	| 'circular_dependency'
	| 'type_suppression_abuse'
	| 'unimplemented_placeholder'
	| 'api_contract_mismatch'
	| 'db_contract_mismatch'
	| 'missing_env_declaration'
	| 'ai_client_secret_leak'
	| 'syntax_or_type_error';

export interface FpereValidationIssue {
	readonly id: string;
	readonly kind: FpereIssueKind;
	readonly severity: 'error' | 'warning';
	readonly file: string;
	readonly line: number;
	readonly symbolOrTarget?: string;
	readonly message: string;
	readonly suggestedFix: string;
}

export interface FpereImportExportReport {
	readonly workspaceRoot: string;
	readonly checkedAtMs: number;
	readonly filesChecked: number;
	readonly errorCount: number;
	readonly warningCount: number;
	readonly passed: boolean;
	readonly issues: readonly FpereValidationIssue[];
	readonly summary: string;
}

export interface FpereIntegrationReport {
	readonly workspaceRoot: string;
	readonly checkedAtMs: number;
	readonly checkpoint: FpereCheckpointKind;
	readonly frontendApiCallsFound: number;
	readonly backendRoutesFound: number;
	readonly matchedApiContracts: number;
	readonly dbModelsFound: number;
	readonly envVarsChecked: number;
	readonly passed: boolean;
	readonly issues: readonly FpereValidationIssue[];
	readonly summary: string;
}

// ── First-Pass Quality Gate & Controlled Root-Cause Repair (Sections 8 & 9) ───────────

export interface FpereQualityGateReport {
	readonly gateId: string;
	readonly workspaceRoot: string;
	readonly evaluatedAtMs: number;
	readonly unitLabel: string;
	readonly stage: FpereQualityStage;
	readonly passed: boolean;
	readonly checks: readonly {
		readonly name: string;
		readonly executed: boolean;
		readonly passed: boolean;
		readonly detail: string;
	}[];
	readonly importExportReport: FpereImportExportReport;
	readonly integrationReport: FpereIntegrationReport;
	readonly compilerErrors: number;
	readonly testPassed?: boolean;
	readonly buildPassed?: boolean;
	readonly blockingIssues: readonly FpereValidationIssue[];
	readonly summary: string;
}

export interface FpereRepairPlan {
	readonly repairId: string;
	readonly attemptNumber: number;
	readonly maxRetries: number;
	readonly escalated: boolean;
	readonly rootCauseClass:
		| 'model_code_defect'
		| 'broken_import_or_export'
		| 'missing_dependency'
		| 'api_or_db_contract_mismatch'
		| 'config_or_env_error'
		| 'compiler_or_lsp_issue'
		| 'external_or_blocked';
	readonly affectedFiles: readonly string[];
	readonly rootCauseSummary: string;
	readonly smallestCoherentFix: string;
	readonly verificationSteps: readonly string[];
}

// ── Multi-Agent Coordination & File Ownership (Section 11) ─────────────────────────────

export interface FpereOwnershipLease {
	readonly agentId: string;
	readonly taskId: string;
	readonly files: readonly string[];
	readonly acquiredAtMs: number;
}

export interface FpereCoordinationResult {
	readonly granted: boolean;
	readonly conflicts: readonly { file: string; heldByAgent: string; heldByTask: string }[];
	readonly readyTaskIds: readonly string[];
	readonly blockedTaskIds: readonly string[];
	readonly activeLeases: readonly FpereOwnershipLease[];
	readonly message: string;
}

// ── Live Observability Snapshot & Events (Section 16) ──────────────────────────────────

export type FpereEventType =
	| 'architecture_analyzed'
	| 'blueprint_created'
	| 'imports_validated'
	| 'integration_checkpoint'
	| 'quality_gate_evaluated'
	| 'agent_lease_updated'
	| 'repair_planned'
	| 'write_time_guard_triggered'
	| 'eric_spec_saved'
	| 'eric_approach_evaluated'
	| 'eric_api_verified'
	| 'eric_semantics_analyzed'
	| 'eric_review_completed'
	| 'eric_lesson_recorded';

export interface FpereEvent {
	readonly eventId: string;
	readonly sequence: number;
	readonly timestampMs: number;
	readonly type: FpereEventType;
	readonly phase: 'analyzing' | 'planning' | 'implementing' | 'integrating' | 'validating' | 'repairing' | 'verified' | 'blocked';
	readonly message: string;
	readonly severity: 'info' | 'success' | 'warning' | 'error';
}

export interface FpereLiveSnapshot {
	readonly workspaceRoot: string;
	readonly updatedAtMs: number;
	readonly currentPhase: FpereEvent['phase'];
	readonly currentStage: FpereQualityStage;
	readonly blueprint?: FpereBlueprint;
	readonly architecture?: FpereArchitectureReport;
	readonly lastImportReport?: FpereImportExportReport;
	readonly lastIntegrationReport?: FpereIntegrationReport;
	readonly lastQualityGate?: FpereQualityGateReport;
	readonly activeLeases: readonly FpereOwnershipLease[];
	readonly repairHistory: readonly FpereRepairPlan[];
	readonly recentEvents: readonly FpereEvent[];
	// ERIC (Engineering Reasoning & Technical Correctness) live state
	readonly behavioralSpec?: EricBehavioralSpec;
	readonly lastApproachEvaluation?: EricApproachEvaluation;
	readonly lastSemanticReport?: EricSemanticReport;
	readonly lastApiVerification?: EricApiVerificationReport;
	readonly lastIndependentReview?: EricIndependentReviewReport;
	readonly engineeringLessonsCount?: number;
}

export interface EricRecordLessonResult {
	readonly recorded: boolean;
	readonly reason: string;
	readonly lesson?: EricFailureLesson;
	readonly totalLessons: number;
}

// ── Main-Process IPC Service Contract ──────────────────────────────────────────────────

export interface IKodiaFirstPassReliabilityMainService {
	readonly _serviceBrand: undefined;
	readonly onDidEmitEvent: Event<FpereEvent>;
	readonly onDidChangeSnapshot: Event<FpereLiveSnapshot>;

	getSnapshot(workspaceRoot: string): Promise<FpereLiveSnapshot>;
	analyzeArchitecture(workspaceRoot: string): Promise<FpereArchitectureReport>;
	saveBlueprint(workspaceRoot: string, blueprint: Omit<FpereBlueprint, 'id' | 'createdAtMs' | 'updatedAtMs'> & { id?: string }): Promise<FpereBlueprint>;
	validateImportsAndExports(workspaceRoot: string, targetFiles?: readonly string[]): Promise<FpereImportExportReport>;
	checkFullStackIntegration(workspaceRoot: string, checkpoint?: FpereCheckpointKind): Promise<FpereIntegrationReport>;
	runFirstPassQualityGate(workspaceRoot: string, opts?: { unitLabel?: string; targetFiles?: readonly string[]; checkpoint?: FpereCheckpointKind; runCompiler?: boolean; runTestCommand?: string; runBuildCommand?: string }): Promise<FpereQualityGateReport>;
	coordinateAgents(workspaceRoot: string, req: { action: 'acquire' | 'release' | 'status'; agentId?: string; taskId?: string; files?: readonly string[] }): Promise<FpereCoordinationResult>;
	planControlledRepair(workspaceRoot: string, req: { errorSummary: string; files?: readonly string[]; maxRetries?: number }): Promise<FpereRepairPlan>;

	// ERIC (Engineering Reasoning & Technical Correctness) methods
	saveBehavioralSpec(workspaceRoot: string, spec: Omit<EricBehavioralSpec, 'id' | 'createdAtMs'> & { id?: string }): Promise<EricBehavioralSpec>;
	evaluateApproaches(workspaceRoot: string, req: { problem: string; domain: EricEngineeringDomain; options: readonly EricApproachOption[]; evidence?: readonly string[] }): Promise<EricApproachEvaluation>;
	verifyInstalledApiUsage(workspaceRoot: string): Promise<EricApiVerificationReport>;
	analyzeSemanticCorrectness(workspaceRoot: string): Promise<EricSemanticReport>;
	runIndependentReview(workspaceRoot: string, opts?: { testCommand?: string }): Promise<EricIndependentReviewReport>;
	recordFailureLesson(workspaceRoot: string, req: {
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

export const IKodiaFirstPassReliabilityMainService = createDecorator<IKodiaFirstPassReliabilityMainService>('kodiaFirstPassReliabilityMainService');
