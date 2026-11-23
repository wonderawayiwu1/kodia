/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const KODIA_EVOLUTION_CHANNEL = 'void-channel-evolution';

// ============================================================================
// Hub Sections & Persistent Settings
// ============================================================================

export type EvolutionHubSection =
	| 'radar'
	| 'supply-chain'
	| 'iac-finops'
	| 'prod-release'
	| 'privacy-legacy'
	| 'proposals';

export interface EvolutionEngineSettings {
	readonly enablePeriodicCapabilityAudit: boolean;
	readonly auditIntervalHours: number;
	readonly blockCopyleftLicensesInCommercialMode: boolean;
	readonly requireApprovalBeforeDependencyIntegration: boolean;
	readonly defaultSloAvailabilityTarget: number;
	readonly defaultP95LatencyBudgetMs: number;
	readonly monthlyCloudBudgetUsd: number;
}

export const DEFAULT_EVOLUTION_ENGINE_SETTINGS: EvolutionEngineSettings = {
	enablePeriodicCapabilityAudit: true,
	auditIntervalHours: 168, // weekly
	blockCopyleftLicensesInCommercialMode: false,
	requireApprovalBeforeDependencyIntegration: true, // NEVER blindly install
	defaultSloAvailabilityTarget: 99.9,
	defaultP95LatencyBudgetMs: 400,
	monthlyCloudBudgetUsd: 500,
};

// ============================================================================
// 1. Software Supply-Chain Intelligence & CycloneDX 1.5 SBOM
// ============================================================================

export type PackageEcosystem = 'npm' | 'pypi' | 'go' | 'cargo';
export type LicenseRiskTier = 'permissive' | 'weak_copyleft' | 'strong_copyleft' | 'proprietary' | 'unknown';

export interface SbomComponent {
	readonly name: string;
	readonly version: string;
	readonly ecosystem: PackageEcosystem;
	readonly purl: string;
	readonly scope: 'runtime' | 'dev';
	readonly license?: string;
	readonly licenseRisk: LicenseRiskTier;
	readonly pinned: boolean;
	readonly sourceFile: string;
}

export interface SupplyChainFinding {
	readonly id: string;
	readonly severity: 'critical' | 'high' | 'medium' | 'low';
	readonly category: 'vulnerability' | 'license' | 'pinning' | 'typosquat' | 'lifecycle-script' | 'lockfile';
	readonly packageName: string;
	readonly file: string;
	readonly title: string;
	readonly detail: string;
	readonly remediation: string;
}

export interface SupplyChainAuditReport {
	readonly id: string;
	readonly generatedAt: string;
	readonly ecosystemsDetected: readonly PackageEcosystem[];
	readonly componentCount: number;
	readonly components: readonly SbomComponent[];
	readonly findings: readonly SupplyChainFinding[];
	readonly liveAuditExecuted: boolean;
	readonly liveAuditNote: string;
	readonly sbomPath?: string;
	readonly cyclonedxSbom: Record<string, unknown>;
	readonly summary: string;
}

// ============================================================================
// 2. Cloud, Infrastructure-as-Code (IaC) & FinOps Cost Intelligence
// ============================================================================

export type IacArtifactKind = 'dockerfile' | 'kubernetes' | 'terraform' | 'github-actions' | 'docker-compose';

export interface IacSecurityFinding {
	readonly id: string;
	readonly severity: 'critical' | 'high' | 'medium' | 'low';
	readonly kind: IacArtifactKind;
	readonly ruleId: string;
	readonly file: string;
	readonly line: number;
	readonly title: string;
	readonly detail: string;
	readonly remediation: string;
}

export interface FinOpsEstimateItem {
	readonly resource: string;
	readonly sourceFile: string;
	readonly estimatedMonthlyUsd: number;
	readonly rightSizingSavingsUsd: number;
	readonly recommendation: string;
}

export interface IacFinOpsReport {
	readonly id: string;
	readonly scannedAt: string;
	readonly artifactsScanned: number;
	readonly artifactKinds: readonly IacArtifactKind[];
	readonly findings: readonly IacSecurityFinding[];
	readonly estimatedMonthlyUsd: number;
	readonly potentialMonthlySavingsUsd: number;
	readonly costBreakdown: readonly FinOpsEstimateItem[];
	readonly budgetExceeded: boolean;
	readonly summary: string;
}

// ============================================================================
// 3. Production Intelligence, Incident Forensics & Autonomous Release Engine
// ============================================================================

export interface IncidentErrorCluster {
	readonly signature: string;
	readonly count: number;
	readonly severity: 'critical' | 'error' | 'warning';
	readonly sampleLine: string;
	readonly suspectedCause: string;
}

export interface IncidentForensicsReport {
	readonly id: string;
	readonly analyzedAt: string;
	readonly serviceName: string;
	readonly totalLogLines: number;
	readonly errorCount: number;
	readonly errorRatePct: number;
	readonly latencyMs?: { readonly p50: number; readonly p95: number; readonly p99: number; readonly sampleCount: number };
	readonly sloTargetPct: number;
	readonly errorBudgetBurnRate: number;
	readonly sloBreached: boolean;
	readonly clusters: readonly IncidentErrorCluster[];
	readonly runbookSteps: readonly string[];
	readonly postmortemDraft: string;
	readonly summary: string;
}

export interface MigrationSafetyFinding {
	readonly id: string;
	readonly severity: 'critical' | 'high' | 'medium';
	readonly file: string;
	readonly line: number;
	readonly operation: string;
	readonly risk: string;
	readonly zeroDowntimeAlternative: string;
}

export interface ReleasePlanReport {
	readonly id: string;
	readonly createdAt: string;
	readonly currentVersion: string;
	readonly recommendedBump: 'major' | 'minor' | 'patch' | 'none';
	readonly nextVersion: string;
	readonly commitsAnalyzed: number;
	readonly breakingChanges: readonly string[];
	readonly features: readonly string[];
	readonly fixes: readonly string[];
	readonly migrationFindings: readonly MigrationSafetyFinding[];
	readonly releaseSafe: boolean;
	readonly canaryRolloutPlan: readonly string[];
	readonly rollbackPlaybook: readonly string[];
	readonly changelogMarkdown: string;
	readonly summary: string;
}

// ============================================================================
// 4. Data Governance, Privacy Compliance & Legacy Modernization Planner
// ============================================================================

export type ComplianceFramework = 'GDPR' | 'SOC2' | 'HIPAA' | 'EU_AI_ACT';

export interface PrivacyComplianceFinding {
	readonly id: string;
	readonly severity: 'critical' | 'high' | 'medium';
	readonly frameworks: readonly ComplianceFramework[];
	readonly piiKind: string;
	readonly file: string;
	readonly line: number;
	readonly title: string;
	readonly detail: string;
	readonly remediation: string;
}

export interface PrivacyComplianceReport {
	readonly id: string;
	readonly scannedAt: string;
	readonly filesScanned: number;
	readonly findings: readonly PrivacyComplianceFinding[];
	readonly frameworkSummary: Readonly<Record<ComplianceFramework, { readonly findings: number; readonly status: 'pass' | 'attention' | 'blocker' }>>;
	readonly missingControls: readonly string[];
	readonly summary: string;
}

export interface ModernizationWave {
	readonly wave: number;
	readonly title: string;
	readonly targetModules: readonly string[];
	readonly risk: 'low' | 'medium' | 'high';
	readonly strategy: string;
	readonly verificationGate: string;
}

export interface LegacyModernizationReport {
	readonly id: string;
	readonly analyzedAt: string;
	readonly totalModules: number;
	readonly monolithHotspots: readonly { readonly file: string; readonly fanIn: number; readonly lines: number; readonly reason: string }[];
	readonly deprecatedPatterns: readonly { readonly file: string; readonly line: number; readonly pattern: string; readonly replacement: string }[];
	readonly waves: readonly ModernizationWave[];
	readonly summary: string;
}

// ============================================================================
// 5. Permanent Continuous Capability Evolution & Signal-vs-Hype Radar (§6)
// ============================================================================

export type EvolutionDomain =
	| 'engineering-techniques'
	| 'languages-frameworks'
	| 'testing-verification'
	| 'ai-agents'
	| 'security-threats'
	| 'developer-workflows'
	| 'infrastructure-cloud'
	| 'hardware-embedded'
	| 'kodia-self-improvement';

export type EvolutionVerdict =
	| 'ADOPT_CANDIDATE'
	| 'MONITOR'
	| 'DEFER'
	| 'REJECT_HYPE'
	| 'REJECT_INCOMPATIBLE';

export interface TechnologyEvaluationInput {
	readonly name: string;
	readonly domain: EvolutionDomain;
	readonly summary: string;
	readonly license?: string;
	readonly maturity: 'experimental' | 'emerging' | 'production-proven' | 'declining';
	readonly benchmarksOrEvidenceCount?: number;
	readonly requiresNewRuntimeDependency?: boolean;
	readonly requiresSpecialHardware?: boolean;
	readonly knownSecurityConcerns?: readonly string[];
	readonly overlapsExistingKodiaCapability?: string;
}

export interface TechnologyEvaluationResult {
	readonly id: string;
	readonly evaluatedAt: string;
	readonly name: string;
	readonly domain: EvolutionDomain;
	readonly signalScore: number; // 0-100
	readonly hypeRiskScore: number; // 0-100
	readonly licenseCompatible: boolean;
	readonly licenseNote: string;
	readonly verdict: EvolutionVerdict;
	readonly autoInstallAllowed: false; // Hard invariant: NEVER blindly integrate/install
	readonly rationale: readonly string[];
	readonly recommendedAction: string;
}

export interface EvolutionProposal {
	readonly id: string;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly title: string;
	readonly domain: EvolutionDomain;
	readonly verdict: EvolutionVerdict;
	readonly signalScore: number;
	readonly status: 'proposed' | 'approved' | 'deferred' | 'rejected' | 'implemented';
	readonly autoInstallAllowed: false;
	readonly justification: string;
	readonly acceptanceCriteria: readonly string[];
}

export interface CapabilityRadarReport {
	readonly id: string;
	readonly auditedAt: string;
	readonly workspaceEcosystems: readonly string[];
	readonly kodiaCapabilitiesAudited: number;
	readonly evaluations: readonly TechnologyEvaluationResult[];
	readonly topAdoptionCandidates: readonly string[];
	readonly rejectedAsHypeOrIncompatible: readonly string[];
	readonly nextRecommendedAuditAt: string;
	readonly summary: string;
}

// ============================================================================
// Live Event Stream & Main Service Interface
// ============================================================================

export type EvolutionLiveEventType =
	| 'supply_chain_completed'
	| 'iac_finops_completed'
	| 'incident_analyzed'
	| 'release_planned'
	| 'privacy_audited'
	| 'modernization_planned'
	| 'capability_radar_completed'
	| 'technology_evaluated'
	| 'proposal_updated'
	| 'error';

export interface EvolutionLiveEvent {
	readonly seq: number;
	readonly eventId: string;
	readonly timestamp: string;
	readonly type: EvolutionLiveEventType;
	readonly message: string;
	readonly ok?: boolean;
	readonly durationMs?: number;
}

export interface EvolutionWorkspaceSnapshot {
	readonly supplyChainReports: readonly SupplyChainAuditReport[];
	readonly iacFinOpsReports: readonly IacFinOpsReport[];
	readonly incidentReports: readonly IncidentForensicsReport[];
	readonly releasePlans: readonly ReleasePlanReport[];
	readonly privacyReports: readonly PrivacyComplianceReport[];
	readonly modernizationReports: readonly LegacyModernizationReport[];
	readonly radarReports: readonly CapabilityRadarReport[];
	readonly proposals: readonly EvolutionProposal[];
}

export interface IKodiaEvolutionMainService {
	readonly _serviceBrand: undefined;

	readonly onDidEmitEvent: Event<EvolutionLiveEvent>;

	loadWorkspaceSnapshot(workspaceRoot: string): Promise<EvolutionWorkspaceSnapshot>;
	getRecentEvents(limit?: number): Promise<EvolutionLiveEvent[]>;

	runSupplyChainAudit(workspaceRoot: string, opts?: {
		runLiveAudit?: boolean;
		blockCopyleft?: boolean;
	}): Promise<SupplyChainAuditReport>;

	runIacFinOpsAudit(workspaceRoot: string, opts?: {
		monthlyBudgetUsd?: number;
	}): Promise<IacFinOpsReport>;

	analyzeProductionIncident(workspaceRoot: string, opts: {
		serviceName: string;
		logText?: string;
		logFile?: string;
		sloTargetPct?: number;
		p95BudgetMs?: number;
	}): Promise<IncidentForensicsReport>;

	planAutonomousRelease(workspaceRoot: string, opts?: {
		sinceRef?: string;
		currentVersion?: string;
	}): Promise<ReleasePlanReport>;

	auditPrivacyAndModernization(workspaceRoot: string, opts?: {
		subPath?: string;
	}): Promise<{ privacy: PrivacyComplianceReport; modernization: LegacyModernizationReport }>;

	runCapabilityEvolutionRadar(workspaceRoot: string, opts?: {
		additionalCandidates?: readonly TechnologyEvaluationInput[];
		auditIntervalHours?: number;
	}): Promise<CapabilityRadarReport>;

	evaluateTechnologyCandidate(workspaceRoot: string, input: TechnologyEvaluationInput): Promise<TechnologyEvaluationResult>;

	manageProposals(workspaceRoot: string, opts: {
		action: 'list' | 'add' | 'update_status' | 'remove';
		id?: string;
		status?: EvolutionProposal['status'];
		title?: string;
		domain?: EvolutionDomain;
		verdict?: EvolutionVerdict;
		signalScore?: number;
		justification?: string;
		acceptanceCriteria?: readonly string[];
	}): Promise<EvolutionProposal[]>;
}

export const IKodiaEvolutionMainService = createDecorator<IKodiaEvolutionMainService>('kodiaEvolutionMainService');
