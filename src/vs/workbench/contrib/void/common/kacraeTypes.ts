/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const KODIA_KACRAE_CHANNEL = 'void-channel-kacrae';

// ============================================================================
// 1. Workbench Navigation (23 Sections — Part 4.3)
// ============================================================================

export type KacraeWorkbenchSection =
	| 'overview'
	| 'current_review'
	| 'change_review'
	| 'full_project_review'
	| 'pull_request_review'
	| 'security_intelligence'
	| 'architecture_intelligence'
	| 'correctness_analysis'
	| 'functional_completeness'
	| 'performance_analysis'
	| 'test_intelligence'
	| 'dependency_intelligence'
	| 'database_review'
	| 'api_contract_review'
	| 'technical_debt'
	| 'compliance_governance'
	| 'review_history'
	| 'review_reports'
	| 'coding_standards_rules'
	| 'review_automation'
	| 'ai_review_config'
	| 'provider_model_config'
	| 'enterprise_admin'
	| 'settings_diagnostics';

export const KACRAE_SECTION_ORDER: readonly KacraeWorkbenchSection[] = [
	'overview',
	'current_review',
	'change_review',
	'full_project_review',
	'pull_request_review',
	'security_intelligence',
	'architecture_intelligence',
	'correctness_analysis',
	'functional_completeness',
	'performance_analysis',
	'test_intelligence',
	'dependency_intelligence',
	'database_review',
	'api_contract_review',
	'technical_debt',
	'compliance_governance',
	'review_history',
	'review_reports',
	'coding_standards_rules',
	'review_automation',
	'ai_review_config',
	'provider_model_config',
	'enterprise_admin',
	'settings_diagnostics',
];

// ============================================================================
// 2. Universal Review Engine Scopes & Depths (Part 5)
// ============================================================================

export type KacraeReviewScope =
	| 'selected_code'
	| 'current_function'
	| 'current_class'
	| 'current_file'
	| 'related_files'
	| 'modified_files'
	| 'git_unstaged'
	| 'git_staged'
	| 'latest_commit'
	| 'commit_range'
	| 'branch_comparison'
	| 'pull_request'
	| 'entire_project'
	| 'monorepo'
	| 'multi_repo'
	| 'enterprise_workspace';

export type KacraeReviewDepth =
	| 'quick'
	| 'standard'
	| 'deep'
	| 'security'
	| 'enterprise_assurance'
	| 'continuous'
	| 'custom';

export type KacraeReviewStatus =
	| 'queued'
	| 'indexing'
	| 'analyzing'
	| 'verifying'
	| 'paused'
	| 'completed'
	| 'completed_partial'
	| 'cancelled'
	| 'failed';

// ============================================================================
// 3. Findings, Evidence, Classification & Lifecycle (Part 16)
// ============================================================================

export type KacraeSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type KacraeFindingCategory =
	| 'correctness'
	| 'business_logic'
	| 'concurrency'
	| 'security'
	| 'tenant_isolation'
	| 'secrets'
	| 'architecture'
	| 'database'
	| 'api_contract'
	| 'performance'
	| 'testing'
	| 'dependency'
	| 'technical_debt'
	| 'compliance'
	| 'prompt_injection';

export type KacraeFindingClassification =
	| 'confirmed_defect'
	| 'strongly_supported'
	| 'potential_issue'
	| 'informational'
	| 'improvement_suggestion'
	| 'unverified_hypothesis';

export type KacraeFindingLifecycleState =
	| 'new'
	| 'confirmed'
	| 'investigating'
	| 'accepted'
	| 'suppressed'
	| 'fix_proposed'
	| 'fix_applied'
	| 'awaiting_verification'
	| 'verified_resolved'
	| 'reopened'
	| 'false_positive';

export type KacraeDetectionMethod =
	| 'deterministic_static'
	| 'compiler'
	| 'taint_flow'
	| 'security_scanner'
	| 'architecture_graph'
	| 'database_analyzer'
	| 'api_contract'
	| 'test_analyzer'
	| 'performance_analyzer'
	| 'adversarial_reviewer'
	| 'ai_council'
	| 'hybrid';

export interface KacraeLifecycleTransition {
	readonly from: KacraeFindingLifecycleState;
	readonly to: KacraeFindingLifecycleState;
	readonly actor: string;
	readonly reason?: string;
	readonly timestamp: string;
}

export interface KacraeSourceRange {
	readonly file: string;
	readonly startLine: number;
	readonly endLine: number;
	readonly startColumn?: number;
	readonly endColumn?: number;
}

export interface KacraeSuggestedFix {
	readonly summary: string;
	readonly file: string;
	readonly originalSnippet: string;
	readonly replacementSnippet: string;
	readonly diffPreview: string;
	readonly safeForAutoApply: boolean;
	readonly rationale: string;
}

export interface KacraeVerificationEvidence {
	readonly verifiedAt: string;
	readonly verdict: 'verified_resolved' | 'still_failing' | 'unverified' | 'inconclusive';
	readonly command?: string;
	readonly tool: string;
	readonly exitCode?: number;
	readonly outputSnippet: string;
	readonly testRefs: readonly string[];
	readonly remainingUncertainty: readonly string[];
}

export interface KacraeFinding {
	readonly id: string;
	readonly ruleId: string;
	readonly title: string;
	readonly category: KacraeFindingCategory;
	readonly severity: KacraeSeverity;
	readonly classification: KacraeFindingClassification;
	readonly confidence: number; // 0..1 calibrated confidence
	readonly location: KacraeSourceRange;
	readonly codeContext: string;
	readonly explanation: string;
	readonly whyItMatters: string;
	readonly preconditions: readonly string[];
	readonly impact: string;
	readonly reproduction?: string;
	readonly evidence: readonly string[];
	readonly suggestedFix?: KacraeSuggestedFix;
	readonly verification?: KacraeVerificationEvidence;
	readonly relatedFindingIds: readonly string[];
	readonly affectedComponents: readonly string[];
	readonly detectionMethod: KacraeDetectionMethod;
	readonly cwe?: string;
	readonly owasp?: string;
	readonly lifecycle: KacraeFindingLifecycleState;
	readonly lifecycleHistory: readonly KacraeLifecycleTransition[];
	readonly suppressionJustification?: string;
	readonly requirementIds?: readonly string[];
	readonly createdAt: string;
}

// ============================================================================
// 4. Security Attack Paths & Secret Redaction (Part 8 & Part 24.4)
// ============================================================================

export type KacraeAttackStepKind =
	| 'entry_point'
	| 'untrusted_input'
	| 'validation'
	| 'authentication'
	| 'authorization'
	| 'internal_service'
	| 'sensitive_sink';

export interface KacraeAttackPathStep {
	readonly kind: KacraeAttackStepKind;
	readonly label: string;
	readonly file: string;
	readonly line: number;
	readonly detail: string;
	readonly present: boolean; // e.g., false if auth/validation missing on path
}

export interface KacraeAttackPath {
	readonly id: string;
	readonly findingId: string;
	readonly title: string;
	readonly severity: KacraeSeverity;
	readonly confirmed: boolean; // confirmed vs theoretical path
	readonly steps: readonly KacraeAttackPathStep[];
	readonly impactSummary: string;
}

// ============================================================================
// 5. Enterprise Repository Intelligence, Indexing & Graph (Part 6 & Part 9)
// ============================================================================

export type KacraeRepoKind =
	| 'monorepo'
	| 'polyglot'
	| 'microservices'
	| 'multi_package'
	| 'web_app'
	| 'backend_service'
	| 'library'
	| 'infrastructure'
	| 'documentation'
	| 'legacy';

export interface KacraeRepoClassification {
	readonly kinds: readonly KacraeRepoKind[];
	readonly languages: Readonly<Record<string, number>>; // language -> file count
	readonly frameworks: readonly string[];
	readonly packageManagers: readonly string[];
	readonly testFrameworks: readonly string[];
	readonly generatedDirs: readonly string[];
	readonly vendorDirs: readonly string[];
	readonly binaryFileCount: number;
	readonly largeFileCount: number;
}

export interface KacraeRepoIndexStats {
	readonly workspaceRoot: string;
	readonly indexDir: string;
	readonly startedAt: string;
	readonly completedAt: string;
	readonly durationMs: number;
	readonly totalDiscoveredFiles: number;
	readonly indexedFiles: number;
	readonly unchangedCachedFiles: number;
	readonly skippedExcludedFiles: number;
	readonly skippedBinaryOrLargeFiles: number;
	readonly totalSymbols: number;
	readonly totalEdges: number;
	readonly throughputFilesPerSec: number;
	readonly peakHeapMb: number;
	readonly peakRssMb: number;
	readonly partial: boolean;
	readonly interrupted: boolean;
	readonly partialReason?: string;
	readonly checkpointId?: string;
	readonly classification: KacraeRepoClassification;
}

export type KacraeGraphNodeKind =
	| 'repository'
	| 'package'
	| 'module'
	| 'file'
	| 'api'
	| 'database'
	| 'test'
	| 'config'
	| 'auth'
	| 'worker'
	| 'external';

export interface KacraeRepoGraphNode {
	readonly id: string;
	readonly label: string;
	readonly kind: KacraeGraphNodeKind;
	readonly layer: 'frontend' | 'backend' | 'api' | 'data' | 'auth' | 'test' | 'infra' | 'shared';
	readonly language: string;
	readonly lines: number;
	readonly symbolCount: number;
	readonly exportedSymbols: readonly string[];
	readonly apiEndpoints: readonly string[];
	readonly dbTables: readonly string[];
	readonly imports: readonly string[];
	readonly importedBy: readonly string[];
	readonly relatedTests: readonly string[];
	readonly findingCount: number;
	readonly highestSeverity?: KacraeSeverity;
	readonly couplingInstability: number; // Ce / (Ca + Ce)
}

export interface KacraeRepoGraphEdge {
	readonly from: string;
	readonly to: string;
	readonly kind: 'imports' | 'calls' | 'tests' | 'queries_table' | 'exposes_api' | 'auth_boundary';
}

export interface KacraeArchitectureTopology {
	readonly layers: Readonly<Record<KacraeRepoGraphNode['layer'], readonly string[]>>;
	readonly cycles: readonly (readonly string[])[];
	readonly layeringViolations: readonly { readonly from: string; readonly to: string; readonly reason: string }[];
	readonly highCouplingModules: readonly { readonly id: string; readonly fanIn: number; readonly fanOut: number; readonly instability: number }[];
	readonly singlePointsOfFailure: readonly string[];
	readonly securityBoundaries: readonly { readonly file: string; readonly kind: string; readonly routes: readonly string[] }[];
}

export interface KacraeRepoGraph {
	readonly builtAt: string;
	readonly totalNodeCount: number;
	readonly totalEdgeCount: number;
	readonly truncatedForRender: boolean;
	readonly nodes: readonly KacraeRepoGraphNode[];
	readonly edges: readonly KacraeRepoGraphEdge[];
	readonly topology: KacraeArchitectureTopology;
}

export interface KacraeBlastRadiusReport {
	readonly target: string;
	readonly found: boolean;
	readonly riskLevel: 'low' | 'medium' | 'high' | 'critical';
	readonly directlyAffectedFiles: readonly string[];
	readonly indirectlyAffectedFiles: readonly string[];
	readonly affectedApis: readonly string[];
	readonly affectedDbTables: readonly string[];
	readonly coveringTests: readonly string[];
	readonly securityBoundaryCrossed: boolean;
	readonly summary: string;
}

// ============================================================================
// 6. Specialized Domain Reports (DB, API, Tests, Performance, Adversarial)
// ============================================================================

export interface KacraeDatabaseReviewReport {
	readonly databasesDetected: readonly string[];
	readonly migrationsInspected: number;
	readonly queriesInspected: number;
	readonly destructiveMigrations: number;
	readonly lockingMigrations: number;
	readonly nPlusOneRisks: number;
	readonly tenantIsolationRisks: number;
	readonly findings: readonly KacraeFinding[];
}

export interface KacraeApiContractReport {
	readonly protocolsDetected: readonly string[];
	readonly specFiles: readonly string[];
	readonly specEndpoints: readonly string[];
	readonly implementedEndpoints: readonly string[];
	readonly undocumentedEndpoints: readonly string[];
	readonly unimplementedSpecEndpoints: readonly string[];
	readonly breakingChanges: readonly string[];
	readonly findings: readonly KacraeFinding[];
}

export interface KacraeGeneratedTestSuggestion {
	readonly id: string;
	readonly targetFile: string;
	readonly targetSymbol?: string;
	readonly testKind: 'unit' | 'integration' | 'regression' | 'concurrency' | 'security' | 'contract' | 'property';
	readonly framework: string;
	readonly suggestedTestPath: string;
	readonly rationale: string;
	readonly testCode: string;
	readonly linkedFindingId?: string;
}

export interface KacraeTestIntelligenceReport {
	readonly testFilesCount: number;
	readonly sourceFilesCount: number;
	readonly untestedCriticalFiles: readonly string[];
	readonly weakOrTautologicalTests: readonly { readonly file: string; readonly line: number; readonly reason: string }[];
	readonly flakyTestPatterns: readonly { readonly file: string; readonly line: number; readonly reason: string }[];
	readonly generatedTests: readonly KacraeGeneratedTestSuggestion[];
	readonly mutationScore?: number;
	readonly testExecutionPassed?: boolean;
	readonly testExecutionOutput?: string;
}

export interface KacraePerformanceObservation {
	readonly id: string;
	readonly kind: 'theoretical_risk' | 'measured_bottleneck';
	readonly category: 'complexity' | 'database' | 'memory' | 'event_loop' | 'io_network' | 'concurrency' | 'serialization';
	readonly file: string;
	readonly line: number;
	readonly title: string;
	readonly detail: string;
	readonly measuredValue?: string;
	readonly remediation: string;
}

export interface KacraePerformanceReport {
	readonly observations: readonly KacraePerformanceObservation[];
	readonly measuredMetrics: readonly { readonly label: string; readonly value: string; readonly unit: string }[];
	readonly disclaimer: string;
}

export interface KacraeAdversarialChallenge {
	readonly id: string;
	readonly targetFile: string;
	readonly line: number;
	readonly hypothesis: string;
	readonly counterexampleInput: string;
	readonly expectedSafeBehavior: string;
	readonly observedOrRiskBehavior: string;
	readonly executableTestSnippet: string;
	readonly severity: KacraeSeverity;
	readonly status: 'open' | 'confirmed_by_test' | 'refuted';
}

export type KacraeFeatureStatus =
	| 'complete'
	| 'partially_implemented'
	| 'nonfunctional'
	| 'placeholder'
	| 'broken'
	| 'unverified';

export interface KacraeFunctionalMatrixRow {
	readonly id: string;
	readonly feature: string;
	readonly expectedBehavior: string;
	readonly sourceFiles: readonly string[];
	readonly uiComponents: readonly string[];
	readonly backendDependencies: readonly string[];
	readonly verificationMethod: 'static_call_graph' | 'api_probe' | 'browser_e2e' | 'automated_test' | 'blocked_external';
	readonly evidence: readonly string[];
	readonly testResults: string;
	readonly status: KacraeFeatureStatus;
	readonly certainty: 'confirmed_failure' | 'suspected_issue' | 'verified_working' | 'blocked_unavailable';
	readonly severity: KacraeSeverity;
	readonly remediation: string;
	readonly blockedReason?: string;
}

export interface KacraeFunctionalCompletenessReport {
	readonly analyzedAt: string;
	readonly appUrl?: string;
	readonly browserVerified: boolean;
	readonly apiVerified: boolean;
	readonly counts: {
		readonly complete: number;
		readonly partially_implemented: number;
		readonly nonfunctional: number;
		readonly placeholder: number;
		readonly broken: number;
		readonly unverified: number;
	};
	readonly staticUiDefectsCount: number;
	readonly disconnectedFrontendCount: number;
	readonly stubBackendCount: number;
	readonly hardcodedDataCount: number;
	readonly requirementBlockingTodosCount: number;
	readonly informationalTodosIgnored: number;
	readonly matrix: readonly KacraeFunctionalMatrixRow[];
	readonly findings: readonly KacraeFinding[];
	readonly summary: string;
	readonly honestLimitations: readonly string[];
}

// ============================================================================
// 7. Requirements Traceability (Part 19)
// ============================================================================

export interface KacraeRequirementItem {
	readonly id: string;
	readonly title: string;
	readonly description: string;
	readonly sourceDoc: string;
	readonly acceptanceCriteria: readonly string[];
	readonly keywords: readonly string[];
}

export interface KacraeRequirementTraceLink {
	readonly requirement: KacraeRequirementItem;
	readonly status: 'covered_and_tested' | 'implemented_untested' | 'partial' | 'missing' | 'contradicted';
	readonly implementationFiles: readonly string[];
	readonly testFiles: readonly string[];
	readonly relatedFindingIds: readonly string[];
	readonly verificationEvidence: readonly string[];
}

export interface KacraeTraceabilityMatrix {
	readonly generatedAt: string;
	readonly totalRequirements: number;
	readonly coveredAndTested: number;
	readonly implementedUntested: number;
	readonly missingOrPartial: number;
	readonly links: readonly KacraeRequirementTraceLink[];
}

// ============================================================================
// 8. Multi-Model Review Council & Local Inference (Part 14 & Part 15)
// ============================================================================

export type KacraeModelRole =
	| 'primary_reviewer'
	| 'security_reviewer'
	| 'architecture_reviewer'
	| 'correctness_reviewer'
	| 'performance_reviewer'
	| 'test_reviewer'
	| 'adversarial_reviewer'
	| 'independent_verifier'
	| 'review_summarizer';

export type KacraeInferenceTier =
	| 'deterministic_only'
	| 'local_inference'
	| 'free_hosted_inference'
	| 'user_byok_paid';

export interface KacraeRoleAssignment {
	readonly role: KacraeModelRole;
	readonly tier: KacraeInferenceTier;
	readonly providerName?: string;
	readonly modelName?: string;
	readonly contextBudgetTokens: number;
	readonly estimatedCostUsd: number;
	readonly rationale: string;
}

export interface KacraeCouncilRoutingPlan {
	readonly localOnlyEnforced: boolean;
	readonly externalAiAvailable: boolean;
	readonly deterministicAlwaysActive: boolean;
	readonly assignments: readonly KacraeRoleAssignment[];
	readonly totalEstimatedCostUsd: number;
	readonly fallbackNote: string;
}

export interface KacraeLocalRuntimeStatus {
	readonly runtime: 'ollama' | 'lmStudio' | 'vLLM';
	readonly installed: boolean;
	readonly endpoint: string;
	readonly reachable: boolean;
	readonly models: readonly { readonly name: string; readonly sizeGb?: number; readonly contextLength?: number }[];
	readonly recommendedModel?: string;
	readonly hardwareNote: string;
	readonly setupSteps: readonly string[];
	readonly checkedAt: string;
}

// ============================================================================
// 9. Autonomous Repair, Rules, Memory, Compliance & Enterprise (Part 17, 23, 25, 26)
// ============================================================================

export interface KacraeRepairRecord {
	readonly id: string;
	readonly findingId: string;
	readonly file: string;
	readonly status: 'proposed' | 'applied' | 'verified' | 'verification_failed' | 'reverted' | 'rejected';
	readonly originalContentHash: string;
	readonly diffPreview: string;
	readonly appliedAt?: string;
	readonly revertedAt?: string;
	readonly backupPath?: string;
	readonly verification?: KacraeVerificationEvidence;
	readonly independentVerdict?: 'APPROVED' | 'REJECTED' | 'CONDITIONAL';
	readonly actor: string;
}

export type KacraeRuleScope = 'global' | 'organization' | 'workspace' | 'repository' | 'directory' | 'language' | 'file';

export interface KacraeReviewRule {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly scope: KacraeRuleScope;
	readonly enabled: boolean;
	readonly severity: KacraeSeverity;
	readonly category: KacraeFindingCategory;
	readonly pattern: string; // regex string
	readonly fileGlobs?: readonly string[];
	readonly languages?: readonly string[];
	readonly remediation: string;
	readonly exceptions?: readonly string[];
	readonly updatedAt: string;
}

export type KacraeMemoryEpistemicKind =
	| 'verified_fact'
	| 'user_convention'
	| 'model_suggestion'
	| 'unverified_assumption';

export interface KacraeMemoryEntry {
	readonly id: string;
	readonly kind: KacraeMemoryEpistemicKind;
	readonly topic: string;
	readonly statement: string;
	readonly source: string;
	readonly approvedByUser: boolean;
	readonly createdAt: string;
}

export type KacraeComplianceFramework =
	| 'ISO_27001'
	| 'SOC_2'
	| 'NIST_CSF'
	| 'NIST_SSDF'
	| 'OWASP_ASVS'
	| 'OWASP_SAMM'
	| 'CIS_CONTROLS';

export interface KacraeComplianceControlEvidence {
	readonly framework: KacraeComplianceFramework;
	readonly controlId: string;
	readonly controlTitle: string;
	readonly status: 'evidence_present' | 'gap_detected' | 'not_assessed';
	readonly evidenceSummary: string;
	readonly relatedFindingIds: readonly string[];
}

export interface KacraeComplianceReport {
	readonly generatedAt: string;
	readonly disclaimer: string; // Never claim certification solely from automated scanning
	readonly frameworksEvaluated: readonly KacraeComplianceFramework[];
	readonly controls: readonly KacraeComplianceControlEvidence[];
	readonly summary: string;
}

export type KacraeEnterpriseRole = 'viewer' | 'reviewer' | 'approver' | 'security_officer' | 'admin';

export interface KacraeAuditRecord {
	readonly id: string;
	readonly timestamp: string;
	readonly actor: string;
	readonly role: KacraeEnterpriseRole;
	readonly action:
		| 'review_started'
		| 'review_completed'
		| 'review_cancelled'
		| 'finding_updated'
		| 'finding_suppressed'
		| 'repair_proposed'
		| 'repair_applied'
		| 'repair_reverted'
		| 'verification_executed'
		| 'policy_evaluated'
		| 'rule_updated'
		| 'report_exported'
		| 'pr_reviewed';
	readonly repository: string;
	readonly revision?: string;
	readonly sessionId?: string;
	readonly toolsUsed: readonly string[];
	readonly modelsUsed: readonly string[];
	readonly filesAffected: readonly string[];
	readonly policyVerdict?: 'pass' | 'warn' | 'block';
	readonly detail: string;
}

// ============================================================================
// 10. Health Methodology, Release Readiness & Sessions (Part 24 & Part 35)
// ============================================================================

export interface KacraeHealthScoreBreakdown {
	readonly score: number; // 0..100 documented weighted methodology
	readonly methodology: string;
	readonly components: readonly {
		readonly dimension: string;
		readonly weightPct: number;
		readonly score: number;
		readonly basis: string;
		readonly missingData?: string;
	}[];
	readonly missingDataNotes: readonly string[];
}

export type KacraeReadinessVerdict =
	| 'ready_per_policy_checks'
	| 'conditional_review_required'
	| 'blocked_by_findings'
	| 'incomplete_evidence';

export interface KacraeReadinessAssessment {
	readonly generatedAt: string;
	readonly verdict: KacraeReadinessVerdict;
	readonly checkedItems: readonly string[];
	readonly passedPolicies: readonly string[];
	readonly failedPolicies: readonly string[];
	readonly notChecked: readonly string[];
	readonly remainingUncertainty: readonly string[];
	readonly explicitDisclaimer: string;
}

export interface KacraeReviewSession {
	readonly id: string;
	readonly title: string;
	readonly workspaceRoot: string;
	readonly scope: KacraeReviewScope;
	readonly depth: KacraeReviewDepth;
	readonly status: KacraeReviewStatus;
	readonly createdAt: string;
	readonly completedAt?: string;
	readonly durationMs: number;
	readonly gitBranch?: string;
	readonly gitRevision?: string;
	readonly targetFiles: readonly string[];
	readonly filesAnalyzedCount: number;
	readonly partialScan: boolean;
	readonly partialReason?: string;
	readonly findings: readonly KacraeFinding[];
	readonly counts: {
		readonly critical: number;
		readonly high: number;
		readonly medium: number;
		readonly low: number;
		readonly info: number;
		readonly confirmed: number;
		readonly suppressed: number;
		readonly resolved: number;
	};
	readonly attackPaths: readonly KacraeAttackPath[];
	readonly databaseReport: KacraeDatabaseReviewReport;
	readonly apiContractReport: KacraeApiContractReport;
	readonly testReport: KacraeTestIntelligenceReport;
	readonly performanceReport: KacraePerformanceReport;
	readonly functionalCompleteness?: KacraeFunctionalCompletenessReport;
	readonly adversarialChallenges: readonly KacraeAdversarialChallenge[];
	readonly traceability?: KacraeTraceabilityMatrix;
	readonly complianceReport: KacraeComplianceReport;
	readonly healthScore: KacraeHealthScoreBreakdown;
	readonly readiness: KacraeReadinessAssessment;
	readonly councilPlan: KacraeCouncilRoutingPlan;
	readonly toolsExecuted: readonly string[];
	readonly modelsUsed: readonly string[];
	readonly aiNotes?: string;
	readonly summary: string;
}

// ============================================================================
// 11. Live Event Architecture (23 Event Types — Part 33)
// ============================================================================

export type KacraeLiveEventType =
	| 'review_created'
	| 'review_queued'
	| 'indexing_started'
	| 'indexing_progress'
	| 'indexing_completed'
	| 'analyzer_started'
	| 'analyzer_completed'
	| 'finding_discovered'
	| 'finding_updated'
	| 'finding_confirmed'
	| 'finding_dismissed'
	| 'repair_proposed'
	| 'repair_approved'
	| 'repair_applied'
	| 'test_started'
	| 'test_completed'
	| 'verification_started'
	| 'verification_completed'
	| 'review_paused'
	| 'review_resumed'
	| 'review_cancelled'
	| 'review_failed'
	| 'review_completed';

export interface KacraeLiveEvent {
	readonly seq: number;
	readonly eventId: string;
	readonly sessionId: string;
	readonly type: KacraeLiveEventType;
	readonly timestamp: string;
	readonly phase: string;
	readonly message: string;
	readonly progressPct?: number;
	readonly file?: string;
	readonly line?: number;
	readonly severity?: KacraeSeverity;
	readonly findingId?: string;
	readonly durationMs?: number;
}

// ============================================================================
// 12. Quality Benchmark Metrics (Part 41)
// ============================================================================

export interface KacraeBenchmarkCaseResult {
	readonly id: string;
	readonly kind: 'true_defect' | 'valid_benign';
	readonly expectedRuleOrCategory: string;
	readonly detected: boolean;
	readonly falsePositiveConfirmed: boolean;
	readonly latencyMs: number;
	readonly findingCount: number;
}

export interface KacraeBenchmarkReport {
	readonly runAt: string;
	readonly corpusSize: number;
	readonly truePositives: number;
	readonly falsePositives: number;
	readonly trueNegatives: number;
	readonly falseNegatives: number;
	readonly precision: number;
	readonly recall: number;
	readonly falsePositiveRate: number;
	readonly f1Score: number;
	readonly avgLatencyMs: number;
	readonly scaleBenchmark?: {
		readonly fileCount: number;
		readonly fullIndexMs: number;
		readonly incrementalRescanMs: number;
		readonly throughputFilesPerSec: number;
		readonly peakHeapMb: number;
		readonly unchangedSkipped: number;
	};
	readonly cases: readonly KacraeBenchmarkCaseResult[];
	readonly note: string;
}

// ============================================================================
// 13. Native KACRAE Settings (7 Groups — Part 31)
// ============================================================================

export type KacraeDecorationDensity = 'off' | 'compact' | 'standard' | 'detailed';

export interface KacraeSettings {
	// General
	readonly enabled: boolean;
	readonly defaultDepth: KacraeReviewDepth;
	readonly defaultScope: KacraeReviewScope;
	readonly notificationsEnabled: boolean;
	readonly reviewOnSave: boolean;
	readonly backgroundReviewEnabled: boolean;
	readonly decorationDensity: KacraeDecorationDensity;

	// Review Behavior
	readonly minSeverity: KacraeSeverity;
	readonly minConfidence: number; // 0.0 - 1.0
	readonly excludePatterns: readonly string[];
	readonly requireSuppressionJustification: boolean;
	readonly historyRetentionDays: number;

	// AI Council
	readonly enableAiCouncil: boolean;
	readonly preferLocalModels: boolean;
	readonly preferFreeHostedModels: boolean;
	readonly contextBudgetTokens: number;
	readonly maxMonthlyAiSpendUsd: number;
	readonly roleOverrides: Readonly<Partial<Record<KacraeModelRole, { readonly providerName: string; readonly modelName: string }>>>;

	// Analysis Tools
	readonly enableCompilerChecks: boolean;
	readonly enableSecurityScanners: boolean;
	readonly enableDependencyScanning: boolean;
	readonly enableDatabaseReview: boolean;
	readonly enableApiContractReview: boolean;
	readonly enableTestExecution: boolean;
	readonly enableAdversarialReview: boolean;

	// Performance & Large Repository
	readonly indexingConcurrency: number;
	readonly maxFilesPerStandardReview: number;
	readonly memoryBudgetMb: number;
	readonly cacheMaxSizeMb: number;
	readonly largeRepositoryMode: boolean;

	// Security & Privacy
	readonly localOnlyMode: boolean; // Zero external inference
	readonly allowExternalInference: boolean;
	readonly redactSecretsStrictly: boolean;
	readonly auditRetentionDays: number;

	// Enterprise
	readonly enterpriseRole: KacraeEnterpriseRole;
	readonly requireApprovalForRepairs: boolean;
	readonly requireIndependentVerification: boolean;
	readonly blockReleaseOnCritical: boolean;
	readonly organizationPolicyName: string;
}

export const DEFAULT_KACRAE_SETTINGS: KacraeSettings = {
	enabled: true,
	defaultDepth: 'standard',
	defaultScope: 'modified_files',
	notificationsEnabled: true,
	reviewOnSave: false,
	backgroundReviewEnabled: true,
	decorationDensity: 'standard',

	minSeverity: 'low',
	minConfidence: 0.45,
	excludePatterns: ['node_modules', '.git', 'dist', 'build', 'out', '.next', 'coverage', '.venv', 'vendor', 'target'],
	requireSuppressionJustification: true,
	historyRetentionDays: 90,

	enableAiCouncil: true,
	preferLocalModels: true,
	preferFreeHostedModels: true,
	contextBudgetTokens: 24_000,
	maxMonthlyAiSpendUsd: 25,
	roleOverrides: {},

	enableCompilerChecks: true,
	enableSecurityScanners: true,
	enableDependencyScanning: true,
	enableDatabaseReview: true,
	enableApiContractReview: true,
	enableTestExecution: true,
	enableAdversarialReview: true,

	indexingConcurrency: 8,
	maxFilesPerStandardReview: 500,
	memoryBudgetMb: 512,
	cacheMaxSizeMb: 256,
	largeRepositoryMode: false,

	localOnlyMode: false,
	allowExternalInference: true,
	redactSecretsStrictly: true,
	auditRetentionDays: 365,

	enterpriseRole: 'approver',
	requireApprovalForRepairs: true,
	requireIndependentVerification: true,
	blockReleaseOnCritical: true,
	organizationPolicyName: 'Kodia Standard Software Assurance Policy',
};

// ============================================================================
// 14. Workspace Snapshot & Main Process IPC Service Contract
// ============================================================================

export interface KacraeExternalToolStatus {
	readonly id: string;
	readonly name: string;
	readonly category: 'compiler' | 'linter' | 'sast' | 'secrets' | 'dependency' | 'iac' | 'test';
	readonly available: boolean;
	readonly version?: string;
	readonly licenseNote: string;
	readonly installHint?: string;
}

export interface KacraeWorkspaceSnapshot {
	readonly workspaceRoot: string;
	readonly sessions: readonly KacraeReviewSession[];
	readonly latestIndexStats: KacraeRepoIndexStats | null;
	readonly latestGraph: KacraeRepoGraph | null;
	readonly rules: readonly KacraeReviewRule[];
	readonly memory: readonly KacraeMemoryEntry[];
	readonly repairs: readonly KacraeRepairRecord[];
	readonly auditLog: readonly KacraeAuditRecord[];
	readonly externalTools: readonly KacraeExternalToolStatus[];
	readonly localRuntimes: readonly KacraeLocalRuntimeStatus[];
	readonly latestBenchmark: KacraeBenchmarkReport | null;
}

export interface KacraeStartReviewRequest {
	readonly workspaceRoot: string;
	readonly scope: KacraeReviewScope;
	readonly depth: KacraeReviewDepth;
	readonly title?: string;
	readonly targetFiles?: readonly string[];
	readonly selectedSnippet?: { readonly file: string; readonly startLine: number; readonly endLine: number; readonly code: string };
	readonly gitBaseRef?: string;
	readonly gitHeadRef?: string;
	readonly requirementsDocs?: readonly string[];
	readonly testCommand?: string;
	readonly settings?: Partial<KacraeSettings>;
	readonly actor?: string;
	readonly configuredProviders?: readonly { readonly providerName: string; readonly modelName: string; readonly isLocal: boolean; readonly isFree: boolean }[];
}

export interface KacraeApplyRepairRequest {
	readonly workspaceRoot: string;
	readonly sessionId: string;
	readonly findingId: string;
	readonly customReplacement?: string;
	readonly dryRun?: boolean;
	readonly testCommand?: string;
	readonly actor?: string;
	readonly role?: KacraeEnterpriseRole;
}

export interface KacraeExportReportRequest {
	readonly workspaceRoot: string;
	readonly sessionId: string;
	readonly format: 'html' | 'pdf_html' | 'json' | 'markdown' | 'sarif';
	readonly reportType: 'executive' | 'technical' | 'security' | 'architecture' | 'compliance' | 'release_readiness';
	readonly outputPath?: string;
}

export interface KacraeExportReportResult {
	readonly format: KacraeExportReportRequest['format'];
	readonly filePath: string;
	readonly content: string;
	readonly bytes: number;
}

export interface IKodiaKacraeMainService {
	readonly _serviceBrand: undefined;
	readonly onDidEmitEvent: Event<KacraeLiveEvent>;

	loadWorkspaceSnapshot(workspaceRoot: string): Promise<KacraeWorkspaceSnapshot>;
	getRecentEvents(limit?: number): Promise<KacraeLiveEvent[]>;

	indexRepository(workspaceRoot: string, opts?: {
		concurrency?: number;
		maxFiles?: number;
		excludePatterns?: readonly string[];
		incremental?: boolean;
		resumeCheckpoint?: boolean;
		sessionId?: string;
	}): Promise<{ stats: KacraeRepoIndexStats; graph: KacraeRepoGraph }>;

	queryRepositoryGraph(workspaceRoot: string, query: {
		kind: 'dependents' | 'apis' | 'tests' | 'db_table' | 'blast_radius' | 'cycles';
		target?: string;
	}): Promise<{ answer: string; files: readonly string[]; blastRadius?: KacraeBlastRadiusReport }>;

	startReview(request: KacraeStartReviewRequest): Promise<KacraeReviewSession>;
	cancelReview(sessionId: string): Promise<boolean>;
	pauseReview(sessionId: string): Promise<boolean>;
	resumeReview(sessionId: string): Promise<boolean>;

	updateFindingLifecycle(workspaceRoot: string, opts: {
		sessionId: string;
		findingId: string;
		nextState: KacraeFindingLifecycleState;
		actor?: string;
		reason?: string;
	}): Promise<KacraeFinding | null>;

	proposeOrApplyRepair(request: KacraeApplyRepairRequest): Promise<KacraeRepairRecord>;
	revertRepair(workspaceRoot: string, repairId: string, actor?: string): Promise<KacraeRepairRecord | null>;

	manageRules(workspaceRoot: string, opts: {
		action: 'list' | 'upsert' | 'delete' | 'toggle';
		rule?: KacraeReviewRule;
		ruleId?: string;
		enabled?: boolean;
	}): Promise<KacraeReviewRule[]>;

	manageMemory(workspaceRoot: string, opts: {
		action: 'list' | 'add' | 'approve' | 'delete';
		entry?: Omit<KacraeMemoryEntry, 'id' | 'createdAt'>;
		entryId?: string;
	}): Promise<KacraeMemoryEntry[]>;

	detectExternalTools(workspaceRoot: string): Promise<KacraeExternalToolStatus[]>;
	detectLocalRuntimes(): Promise<KacraeLocalRuntimeStatus[]>;

	exportReport(request: KacraeExportReportRequest): Promise<KacraeExportReportResult>;
	runQualityBenchmark(workspaceRoot: string, opts?: { includeScaleFiles?: number }): Promise<KacraeBenchmarkReport>;
	verifyFunctionalCompleteness(workspaceRoot: string, opts?: {
		appUrl?: string;
		apiBaseUrl?: string;
		useBrowser?: boolean;
		testCommand?: string;
		targetFiles?: readonly string[];
	}): Promise<KacraeFunctionalCompletenessReport>;
}

export const IKodiaKacraeMainService = createDecorator<IKodiaKacraeMainService>('kodiaKacraeMainService');

