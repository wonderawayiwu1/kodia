/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// ── Section 3: Requirement Understanding & Behavioral Specification ────────────────────

export interface EricBehavioralSpec {
	readonly id: string;
	readonly featureName: string;
	readonly domain: EricEngineeringDomain;
	readonly createdAtMs: number;
	readonly explicitRequirements: readonly string[];
	readonly inferredAssumptions: readonly string[];
	readonly constraints: readonly string[];
	readonly inputsAndOutputs: readonly { name: string; inputShape: string; outputShape: string }[];
	readonly edgeCases: readonly string[];
	readonly failureConditions: readonly string[];
	readonly securityRequirements: readonly string[];
	readonly performanceRequirements: readonly string[];
	readonly integrationRequirements: readonly string[];
	readonly acceptanceCriteria: readonly { id: string; criterion: string; verificationMethod: string; verified?: boolean }[];
	readonly openAmbiguities: readonly string[];
}

// ── Section 4: Technical Approach Selection ────────────────────────────────────────────

export interface EricApproachOption {
	readonly name: string;
	readonly summary: string;
	readonly scores: {
		readonly correctness: number;            // 1..5
		readonly reliability: number;            // 1..5
		readonly maintainability: number;        // 1..5
		readonly security: number;               // 1..5
		readonly performance: number;            // 1..5
		readonly frameworkCompatibility: number; // 1..5
		readonly operationalSimplicity: number;  // 1..5
	};
	readonly dependenciesRequired: readonly string[];
	readonly pros: readonly string[];
	readonly cons: readonly string[];
}

export interface EricApproachEvaluation {
	readonly id: string;
	readonly problem: string;
	readonly domain: EricEngineeringDomain;
	readonly evaluatedAtMs: number;
	readonly options: readonly (EricApproachOption & { weightedScore: number })[];
	readonly selectedOption: string;
	readonly rationale: string;
	readonly evidence: readonly string[];
}

// ── Section 5: Real Installed API & Framework Verification ─────────────────────────────

export interface EricApiUsageIssue {
	readonly id: string;
	readonly severity: 'error' | 'warning';
	readonly file: string;
	readonly line: number;
	readonly packageName: string;
	readonly installedVersion?: string;
	readonly referencedMember: string;
	readonly message: string;
	readonly availableMembersSample: readonly string[];
	readonly suggestedFix: string;
}

export interface EricApiVerificationReport {
	readonly workspaceRoot: string;
	readonly checkedAtMs: number;
	readonly packagesInspected: readonly { name: string; version: string; declarationSource: string; exportedCount: number }[];
	readonly usagesChecked: number;
	readonly issues: readonly EricApiUsageIssue[];
	readonly passed: boolean;
	readonly summary: string;
}

// ── Sections 6, 7, 8, 10: Semantic, Behavioral, Algorithm, Domain & Test-Oracle Checks ─

export type EricEngineeringDomain =
	| 'web_backend'
	| 'frontend'
	| 'mobile'
	| 'ai_ml'
	| 'systems_desktop'
	| 'games_embedded'
	| 'general';

export type EricSemanticCategory =
	| 'async_concurrency_race'
	| 'resource_memory_leak'
	| 'error_handling_defect'
	| 'security_auth_boundary'
	| 'algorithm_boundary_defect'
	| 'ai_ml_defect'
	| 'mobile_lifecycle_defect'
	| 'state_management_defect'
	| 'weak_test_oracle';

export interface EricSemanticFinding {
	readonly id: string;
	readonly category: EricSemanticCategory;
	readonly domain: EricEngineeringDomain;
	readonly severity: 'critical' | 'error' | 'warning';
	readonly file: string;
	readonly line: number;
	readonly ruleId: string;
	readonly title: string;
	readonly explanation: string;
	readonly suggestedFix: string;
}

export interface EricSemanticReport {
	readonly workspaceRoot: string;
	readonly analyzedAtMs: number;
	readonly filesAnalyzed: number;
	readonly domainsCovered: readonly EricEngineeringDomain[];
	readonly findings: readonly EricSemanticFinding[];
	readonly criticalCount: number;
	readonly errorCount: number;
	readonly warningCount: number;
	readonly weakTestOracleCount: number;
	readonly passed: boolean;
	readonly summary: string;
}

// ── Sections 9 & 11: Independent Engineering Review & Anti-False-Confidence Evidence ──

export type EricReviewVerdict = 'verified_with_evidence' | 'needs_fixes' | 'partially_verified' | 'blocked';

export interface EricIndependentReviewReport {
	readonly reviewId: string;
	readonly workspaceRoot: string;
	readonly reviewedAtMs: number;
	readonly verdict: EricReviewVerdict;
	readonly whatWasChecked: readonly string[];
	readonly toolsUsed: readonly string[];
	readonly testsPassed: readonly string[];
	readonly testsFailed: readonly string[];
	readonly whatRemainsUnverified: readonly string[];
	readonly knownAssumptions: readonly string[];
	readonly remainingRisks: readonly string[];
	readonly semanticReport: EricSemanticReport;
	readonly apiVerificationReport: EricApiVerificationReport;
	readonly acceptanceCriteriaTotal: number;
	readonly acceptanceCriteriaVerified: number;
	readonly relevantPastLessons: readonly EricFailureLesson[];
	readonly summary: string;
}

// ── Section 12: Continuous Learning From Verified Engineering Failures ─────────────────

export type EricFailureCategory =
	| 'requirement_misunderstanding'
	| 'incorrect_technical_approach'
	| 'outdated_api_knowledge'
	| 'incorrect_api_usage'
	| 'algorithm_error'
	| 'business_logic_error'
	| 'repository_context_failure'
	| 'dependency_mismatch'
	| 'type_inconsistency'
	| 'integration_failure'
	| 'insufficient_testing'
	| 'model_limitation'
	| 'tool_execution_failure';

export interface EricFailureLesson {
	readonly id: string;
	readonly category: EricFailureCategory;
	readonly domain: EricEngineeringDomain;
	readonly technology: string;
	readonly symptom: string;
	readonly rootCause: string;
	readonly verifiedFixPattern: string;
	readonly verificationEvidence: string;
	readonly verifiedFix: boolean;
	readonly recordedAtMs: number;
	readonly occurrences: number;
}

// ── Section 13: Repeatable Baseline-vs-Post Evaluation Benchmark ───────────────────────

export interface EricBenchmarkMetrics {
	readonly label: string;
	readonly firstPassBuildPassed: boolean;
	readonly firstPassTypeCheckPassed: boolean;
	readonly importDependencyErrors: number;
	readonly semanticDefects: number;
	readonly apiUsageDefects: number;
	readonly weakTestOracles: number;
	readonly securityFindings: number;
	readonly integrationDefects: number;
	readonly testsPassed: number;
	readonly testsFailed: number;
	readonly requirementsSatisfied: number;
	readonly requirementsTotal: number;
	readonly repairCycles: number;
	readonly durationMs: number;
}

export interface EricBenchmarkComparison {
	readonly scenarioName: string;
	readonly baseline: EricBenchmarkMetrics;
	readonly withEricAndFpere: EricBenchmarkMetrics;
	readonly defectDelta: number; // baseline total defects - improved total defects
	readonly summary: string;
}
