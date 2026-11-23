/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const KODIA_CORRECTNESS_CHANNEL = 'void-channel-correctness';

// ============================================================================
// Settings & Navigation Sections
// ============================================================================

export type CorrectnessHubSection =
	| 'diagnostics'
	| 'taint'
	| 'investigate'
	| 'impact'
	| 'fuzz'
	| 'mutation'
	| 'verify'
	| 'readiness';

export interface CorrectnessEngineSettings {
	readonly enableIncrementalAnalysis: boolean;
	readonly enableTaintAnalysis: boolean;
	readonly requireIndependentVerificationForRepairs: boolean;
	readonly autoOpenHubOnDeepInvestigation: boolean;
	readonly fuzzDefaultIterations: number;
	readonly mutationMaxMutantsPerRun: number;
	readonly mutationTimeoutMs: number;
	readonly blockReleaseOnCriticalFindings: boolean;
}

export const DEFAULT_CORRECTNESS_ENGINE_SETTINGS: CorrectnessEngineSettings = {
	enableIncrementalAnalysis: true,
	enableTaintAnalysis: true,
	requireIndependentVerificationForRepairs: true,
	autoOpenHubOnDeepInvestigation: true,
	fuzzDefaultIterations: 150,
	mutationMaxMutantsPerRun: 25,
	mutationTimeoutMs: 12_000,
	blockReleaseOnCriticalFindings: true,
};

// ============================================================================
// Multi-Layer Diagnostics, Suppressions & Incremental Analysis
// ============================================================================

export type DiagnosticLayer = 'instant' | 'incremental' | 'deep' | 'compiler' | 'taint' | 'runtime';
export type DiagnosticSeverity = 'critical' | 'error' | 'warning' | 'info';
export type DiagnosticConfidence = 'confirmed' | 'high' | 'medium' | 'heuristic';

export type CorrectnessCategory =
	| 'syntax-type'
	| 'cross-file-contract'
	| 'async-concurrency'
	| 'resource-leak'
	| 'data-flow-taint'
	| 'auth-authz'
	| 'injection'
	| 'crypto-secrets'
	| 'api-integration'
	| 'logic-defect'
	| 'performance'
	| 'dependency';

export interface CorrectnessDiagnostic {
	readonly id: string;
	readonly ruleId: string;
	readonly layer: DiagnosticLayer;
	readonly severity: DiagnosticSeverity;
	readonly confidence: DiagnosticConfidence;
	readonly category: CorrectnessCategory;
	readonly engine: string;
	readonly file: string;
	readonly line: number;
	readonly column?: number;
	readonly title: string;
	readonly message: string;
	readonly evidence?: string;
	readonly remediation: string;
	readonly suppressed?: boolean;
	readonly suppressionReason?: string;
}

export interface DiagnosticSuppression {
	readonly id: string;
	readonly ruleId: string;
	readonly filePattern?: string;
	readonly justification: string;
	readonly createdAt: string;
}

export interface CompilerCheckOutcome {
	readonly engine: string;
	readonly language: string;
	readonly available: boolean;
	readonly command?: string;
	readonly passed: boolean;
	readonly durationMs: number;
	readonly diagnostics: readonly CorrectnessDiagnostic[];
	readonly rawOutput?: string;
	readonly note?: string;
}

export interface IncrementalAnalysisReport {
	readonly id: string;
	readonly analyzedAt: string;
	readonly mode: 'full' | 'incremental';
	readonly totalWorkspaceFiles: number;
	readonly analyzedFilesCount: number;
	readonly cachedSkippedFilesCount: number;
	readonly changedFiles: readonly string[];
	readonly invalidatedDependents: readonly string[];
	readonly partialNotice?: string;
	readonly diagnostics: readonly CorrectnessDiagnostic[];
	readonly summary: string;
}

// ============================================================================
// Data-Flow & Taint Analysis
// ============================================================================

export type TaintSourceKind = 'http_input' | 'user_input' | 'file_upload' | 'env_secret' | 'ai_output' | 'external_api' | 'auth_token';
export type TaintSinkKind = 'sql_query' | 'shell_exec' | 'code_eval' | 'html_render' | 'file_path' | 'ssrf_request' | 'secret_log' | 'authz_decision';

export interface TaintFlowHop {
	readonly file: string;
	readonly line: number;
	readonly symbol: string;
	readonly expression: string;
}

export interface TaintFlowFinding {
	readonly id: string;
	readonly severity: 'critical' | 'high' | 'medium';
	readonly confidence: DiagnosticConfidence;
	readonly sourceKind: TaintSourceKind;
	readonly sinkKind: TaintSinkKind;
	readonly source: TaintFlowHop;
	readonly propagationPath: readonly TaintFlowHop[];
	readonly sink: TaintFlowHop;
	readonly sanitizerDetected: boolean;
	readonly title: string;
	readonly explanation: string;
	readonly remediation: string;
}

export interface TaintAnalysisReport {
	readonly id: string;
	readonly scannedAt: string;
	readonly filesScanned: number;
	readonly unsafeFlows: readonly TaintFlowFinding[];
	readonly sanitizedFlowsCount: number;
	readonly summary: string;
}

// ============================================================================
// Root-Cause Investigation Engine
// ============================================================================

export type HypothesisCertainty = 'confirmed_root_cause' | 'strongly_supported' | 'possible_factor' | 'unresolved_uncertainty';

export interface RootCauseHypothesis {
	readonly rank: number;
	readonly certainty: HypothesisCertainty;
	readonly confidenceScore: number;
	readonly title: string;
	readonly location?: { readonly file: string; readonly line?: number };
	readonly supportingEvidence: readonly string[];
	readonly contradictingOrMissingEvidence: readonly string[];
	readonly nextVerificationStep: string;
	readonly proposedRepair: string;
}

export interface RootCauseInvestigationReport {
	readonly id: string;
	readonly createdAt: string;
	readonly symptom: string;
	readonly affectedFiles: readonly string[];
	readonly correlatedEndpoints: readonly string[];
	readonly correlatedTests: readonly string[];
	readonly hypotheses: readonly RootCauseHypothesis[];
	readonly uncertaintyNotes: readonly string[];
	readonly recommendedSmallestRepair: string;
	readonly summary: string;
}

// ============================================================================
// Property-Based / Fuzz Testing & Mutation Testing
// ============================================================================

export interface FuzzTestConfig {
	readonly targetFile: string;
	readonly exportName: string;
	readonly propertyExpression: string;
	readonly argSchema: readonly ('number' | 'integer' | 'string' | 'boolean' | 'json-object' | 'array-number')[];
	readonly iterations?: number;
	readonly seed?: number;
}

export interface FuzzCounterexample {
	readonly rawArgs: readonly unknown[];
	readonly minimizedArgs: readonly unknown[];
	readonly errorOrViolation: string;
	readonly iterationFound: number;
	readonly seed: number;
	readonly regressionTestSnippet: string;
}

export interface FuzzTestReport {
	readonly id: string;
	readonly createdAt: string;
	readonly targetFile: string;
	readonly exportName: string;
	readonly seed: number;
	readonly iterationsRun: number;
	readonly passed: boolean;
	readonly durationMs: number;
	readonly counterexample?: FuzzCounterexample;
	readonly corpusPath?: string;
	readonly summary: string;
	readonly error?: string;
}

export type MutantStatus = 'killed' | 'survived' | 'timeout' | 'error' | 'equivalent_or_untested';

export interface GeneratedMutant {
	readonly id: string;
	readonly file: string;
	readonly line: number;
	readonly operator: 'relational' | 'equality' | 'logical' | 'arithmetic' | 'guard-removal' | 'boolean-flip';
	readonly originalCode: string;
	readonly mutatedCode: string;
}

export interface MutantOutcome extends GeneratedMutant {
	readonly status: MutantStatus;
	readonly durationMs: number;
	readonly detail: string;
}

export interface MutationTestReport {
	readonly id: string;
	readonly createdAt: string;
	readonly targetFile: string;
	readonly testCommand: string;
	readonly totalMutants: number;
	readonly killed: number;
	readonly survived: number;
	readonly timedOut: number;
	readonly errors: number;
	readonly mutationScore: number;
	readonly outcomes: readonly MutantOutcome[];
	readonly limitationsNote: string;
	readonly summary: string;
	readonly error?: string;
}

// ============================================================================
// Repair Planning, Independent Verification, Proof-Carrying Changes & Readiness
// ============================================================================

export interface RepairPlanRecord {
	readonly id: string;
	readonly createdAt: string;
	readonly defectSummary: string;
	readonly targetFiles: readonly string[];
	readonly blastRadiusFiles: readonly string[];
	readonly targetedTests: readonly string[];
	readonly smallestFixStrategy: string;
	readonly sideEffectRisks: readonly string[];
	readonly rollbackStrategy: string;
}

export type IndependentVerdict = 'APPROVED' | 'REJECTED' | 'CONDITIONAL';

export interface IndependentVerificationCheck {
	readonly name: string;
	readonly category: 'compiler' | 'static-analysis' | 'taint' | 'tests' | 'requirement-coverage' | 'regression';
	readonly status: 'passed' | 'failed' | 'skipped' | 'not_run';
	readonly detail: string;
	readonly command?: string;
}

export interface IndependentVerificationReport {
	readonly id: string;
	readonly verifiedAt: string;
	readonly changeDescription: string;
	readonly verdict: IndependentVerdict;
	readonly changedFiles: readonly string[];
	readonly checks: readonly IndependentVerificationCheck[];
	readonly rejectionReasons: readonly string[];
	readonly untestedRisks: readonly string[];
	readonly proofRecordId?: string;
	readonly summary: string;
}

export interface ProofCarryingChangeRecord {
	readonly id: string;
	readonly createdAt: string;
	readonly title: string;
	readonly requirementsCovered: readonly string[];
	readonly changedFiles: readonly string[];
	readonly originalFailureOrGoal: string;
	readonly analyzersRun: readonly string[];
	readonly testsExecuted: readonly { readonly command: string; readonly passed: boolean; readonly outputSnippet: string }[];
	readonly staticFindingsCount: number;
	readonly taintFindingsCount: number;
	readonly independentVerdict: IndependentVerdict;
	readonly knownLimitations: readonly string[];
	readonly unresolvedRisks: readonly string[];
	readonly summary: string;
}

export type ReleaseReadinessOutcome =
	| 'verified_against_checks'
	| 'conditionally_ready'
	| 'not_ready_failures'
	| 'verification_incomplete'
	| 'blocked_infrastructure';

export interface ReleaseReadinessGate {
	readonly id: string;
	readonly label: string;
	readonly status: 'passed' | 'failed' | 'incomplete' | 'blocked';
	readonly evidence: string;
	readonly gap?: string;
}

export interface ReleaseReadinessReport {
	readonly id: string;
	readonly generatedAt: string;
	readonly outcome: ReleaseReadinessOutcome;
	readonly gates: readonly ReleaseReadinessGate[];
	readonly blockers: readonly string[];
	readonly unverifiedDimensions: readonly string[];
	readonly explicitDisclaimer: string;
	readonly summary: string;
}

// ============================================================================
// Live Correctness & Investigation Event Stream
// ============================================================================

export type CorrectnessLiveEventType =
	| 'scan_started'
	| 'compiler_check_completed'
	| 'taint_scan_completed'
	| 'investigation_started'
	| 'hypothesis_ranked'
	| 'fuzz_started'
	| 'fuzz_counterexample_found'
	| 'fuzz_completed'
	| 'mutation_started'
	| 'mutant_evaluated'
	| 'mutation_completed'
	| 'independent_verification_started'
	| 'independent_verification_verdict'
	| 'proof_recorded'
	| 'readiness_assessed'
	| 'error';

export interface CorrectnessLiveEvent {
	readonly seq: number;
	readonly eventId: string;
	readonly timestamp: string;
	readonly type: CorrectnessLiveEventType;
	readonly executionId: string;
	readonly message: string;
	readonly passed?: boolean;
	readonly file?: string;
	readonly line?: number;
	readonly durationMs?: number;
}

export interface CorrectnessWorkspaceSnapshot {
	readonly suppressions: readonly DiagnosticSuppression[];
	readonly investigations: readonly RootCauseInvestigationReport[];
	readonly fuzzRuns: readonly FuzzTestReport[];
	readonly mutationRuns: readonly MutationTestReport[];
	readonly verifications: readonly IndependentVerificationReport[];
	readonly proofs: readonly ProofCarryingChangeRecord[];
	readonly readinessReports: readonly ReleaseReadinessReport[];
}

export interface IKodiaCorrectnessMainService {
	readonly _serviceBrand: undefined;

	readonly onDidEmitEvent: Event<CorrectnessLiveEvent>;

	loadWorkspaceSnapshot(workspaceRoot: string): Promise<CorrectnessWorkspaceSnapshot>;
	getRecentEvents(limit?: number): Promise<CorrectnessLiveEvent[]>;

	runCompilerAndAnalyzers(workspaceRoot: string, opts?: {
		targetFiles?: readonly string[];
		languages?: readonly string[];
	}): Promise<CompilerCheckOutcome[]>;

	runPropertyFuzzTest(workspaceRoot: string, config: FuzzTestConfig): Promise<FuzzTestReport>;

	runMutationTesting(workspaceRoot: string, opts: {
		targetFile: string;
		testCommand: string;
		maxMutants?: number;
		timeoutMs?: number;
	}): Promise<MutationTestReport>;

	runIndependentVerification(workspaceRoot: string, opts: {
		changeDescription: string;
		requirements?: readonly string[];
		changedFiles: readonly string[];
		testCommands?: readonly string[];
		staticDiagnostics?: readonly CorrectnessDiagnostic[];
		taintFindings?: readonly TaintFlowFinding[];
		requireTests?: boolean;
	}): Promise<IndependentVerificationReport>;

	saveProofRecord(workspaceRoot: string, record: ProofCarryingChangeRecord): Promise<ProofCarryingChangeRecord[]>;
	saveInvestigation(workspaceRoot: string, report: RootCauseInvestigationReport): Promise<RootCauseInvestigationReport[]>;
	saveReadinessReport(workspaceRoot: string, report: ReleaseReadinessReport): Promise<ReleaseReadinessReport[]>;
	manageSuppressions(workspaceRoot: string, opts: {
		action: 'list' | 'add' | 'remove';
		id?: string;
		ruleId?: string;
		filePattern?: string;
		justification?: string;
	}): Promise<DiagnosticSuppression[]>;
}

export const IKodiaCorrectnessMainService = createDecorator<IKodiaCorrectnessMainService>('kodiaCorrectnessMainService');
