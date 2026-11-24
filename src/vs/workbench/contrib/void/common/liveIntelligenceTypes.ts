/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const KODIA_LEI_CHANNEL = 'void-channel-liveIntelligence';

// ── Freshness Classification (Part 3) ──────────────────────────────────────────────────

export type FreshnessCategory =
	| 'A_stable'
	| 'B_version_sensitive'
	| 'C_rapidly_changing'
	| 'D_critical';

export type LeiDomain =
	| 'ai_models'
	| 'model_deprecation'
	| 'package_versions'
	| 'security_advisories'
	| 'framework_releases'
	| 'sdk_compatibility'
	| 'api_endpoints'
	| 'cloud_services'
	| 'mobile_platform'
	| 'database_infra'
	| 'stable_concepts';

export interface LeiFreshnessAssessment {
	readonly topic: string;
	readonly technology: string;
	readonly category: FreshnessCategory;
	readonly domain: LeiDomain;
	readonly needsLiveResearch: boolean;
	readonly riskLevel: 'low' | 'medium' | 'high' | 'critical';
	readonly reasons: readonly string[];
	readonly detectedLegacySignals: readonly string[];
	readonly recommendedOfficialUrls: readonly string[];
	readonly suggestedSearchQueries: readonly string[];
	readonly cacheStatus: 'none' | 'fresh' | 'stale' | 'expired';
	readonly lastVerifiedAt?: number;
	readonly recommendedTtlMs: number;
}

// ── Verification & Source Credibility (Parts 5 & 8) ────────────────────────────────────

export type LeiVerificationStatus =
	| 'verified_official_docs'
	| 'verified_official_api'
	| 'cross_checked'
	| 'provisionally_verified'
	| 'conflicting_sources'
	| 'unverified'
	| 'deprecated'
	| 'unavailable'
	| 'superseded';

export type LeiSourceTier =
	| 1  // Official vendor documentation
	| 2  // Official API reference
	| 3  // Official release notes / changelog
	| 4  // Official model catalog / model card
	| 5  // Official GitHub repository & releases
	| 6  // Official package registry (npm, PyPI, pub.dev, crates.io, Maven, NuGet, Packagist)
	| 7  // Official security advisory (OSV, NVD, GHSA, OWASP)
	| 8  // Standards organization (W3C, IETF, RFC, ECMA, ISO)
	| 9  // Maintainer announcement / official blog
	| 10 // Reputable technical publication
	| 11 // Independent technical research
	| 12; // Community discussion

export interface LeiSourceReference {
	readonly title: string;
	readonly url: string;
	readonly domain: string;
	readonly tier: LeiSourceTier;
	readonly authorityLabel: string;
	readonly authorityScore: number; // 0..100
	readonly publishedDate?: string;
	readonly lastUpdatedDate?: string;
	readonly fetchedAt: number;
	readonly snippet: string;
	readonly inspectedFullDocument: boolean;
	readonly promptInjectionSignalsStripped: number;
}

export type LeiKnowledgeScope =
	| 'general'
	| 'verified_current'
	| 'project_specific'
	| 'user_preference'
	| 'historical';

export interface LeiEvidenceConflict {
	readonly aspect: string;
	readonly claimA: string;
	readonly sourceA: string;
	readonly claimB: string;
	readonly sourceB: string;
	readonly resolutionHint: string;
}

export interface LeiEvidenceRecord {
	readonly id: string;
	readonly technology: string;
	readonly domain: LeiDomain;
	readonly category: FreshnessCategory;
	readonly finding: string;
	readonly exactIdentifierOrVersion: string;
	readonly sources: readonly LeiSourceReference[];
	readonly publicationDate?: string;
	readonly lastUpdatedDate?: string;
	readonly researchDate: string; // ISO timestamp
	readonly researchedAtMs: number;
	readonly versionApplicability: string;
	readonly confidence: number; // 0..1
	readonly supportingEvidence: readonly string[];
	readonly conflictingEvidence: readonly LeiEvidenceConflict[];
	readonly verificationStatus: LeiVerificationStatus;
	readonly knowledgeScope: LeiKnowledgeScope;
	readonly cachePolicyMs: number;
	readonly expiresAtMs: number;
	readonly invalidated?: boolean;
	readonly invalidationReason?: string;
	readonly projectId?: string;
	readonly recommendation?: string;
	readonly migrationGuidance?: string;
}

// ── AI Model Intelligence (Parts 4.1, 6, 11) ───────────────────────────────────────────

export type LeiProviderId =
	| 'nvidia'
	| 'openai'
	| 'anthropic'
	| 'gemini'
	| 'groq'
	| 'mistral'
	| 'deepseek'
	| 'qwen'
	| 'meta'
	| 'huggingface'
	| 'openrouter'
	| 'ollama'
	| 'vllm'
	| 'lmstudio'
	| string;

export interface LeiModelCapabilities {
	readonly contextWindow?: number;
	readonly maxOutputTokens?: number;
	readonly coding?: boolean;
	readonly vision?: boolean;
	readonly video?: boolean;
	readonly audio?: boolean;
	readonly reasoning?: boolean;
	readonly toolCalling?: boolean;
	readonly structuredOutput?: boolean;
	readonly streaming?: boolean;
	readonly embeddings?: boolean;
	readonly inputModalities: readonly string[];
	readonly outputModalities: readonly string[];
}

export interface LeiModelAvailabilityLevels {
	readonly documented: boolean;
	readonly publiclyListed: boolean;
	readonly accountAccessible: boolean | 'unknown';
	readonly endpointTested: boolean;
	readonly endpointTestResult?: 'passed' | 'failed' | 'not_run';
	readonly endpointTestMessage?: string;
}

export interface LeiDiscoveredModel {
	readonly provider: LeiProviderId;
	readonly modelId: string;
	readonly displayName?: string;
	readonly releaseDate?: string;
	readonly deprecated: boolean;
	readonly deprecationReason?: string;
	readonly replacementModelId?: string;
	readonly capabilities: LeiModelCapabilities;
	readonly availability: LeiModelAvailabilityLevels;
	readonly pricingHint?: string;
	readonly rateLimitHint?: string;
	readonly sources: readonly LeiSourceReference[];
	readonly verificationStatus: LeiVerificationStatus;
	readonly verifiedAtMs: number;
}

export interface LeiModelTaskRequirements {
	readonly taskType?: 'coding' | 'vision' | 'reasoning' | 'chat' | 'classification' | 'agentic' | 'long_context' | 'embeddings' | 'general';
	readonly requiresVision?: boolean;
	readonly requiresAudio?: boolean;
	readonly requiresToolCalling?: boolean;
	readonly requiresStructuredOutput?: boolean;
	readonly requiresReasoning?: boolean;
	readonly minContextWindow?: number;
	readonly preferLowLatency?: boolean;
	readonly preferLowCost?: boolean;
	readonly currentModelId?: string;
	readonly userSelectedModelId?: string;
}

export interface LeiModelDiscoveryReport {
	readonly operationId: string;
	readonly provider: LeiProviderId;
	readonly discoveredAtMs: number;
	readonly discoveryMethod: 'provider_api' | 'official_docs_and_catalog' | 'cached_verified' | 'unavailable';
	readonly models: readonly LeiDiscoveredModel[];
	readonly deprecatedDetected: readonly LeiDiscoveredModel[];
	readonly recommendedModel?: LeiDiscoveredModel;
	readonly recommendationReason: string;
	readonly preserveUserModel?: boolean;
	readonly sources: readonly LeiSourceReference[];
	readonly verificationStatus: LeiVerificationStatus;
	readonly evidenceId?: string;
	readonly error?: string;
}

export interface LeiModelVerificationReport {
	readonly operationId: string;
	readonly provider: LeiProviderId;
	readonly requestedModelId: string;
	readonly isCurrent: boolean;
	readonly isDeprecated: boolean;
	readonly isLegacyPattern: boolean;
	readonly availability: LeiModelAvailabilityLevels;
	readonly capabilityMatch: boolean;
	readonly missingCapabilities: readonly string[];
	readonly verificationStatus: LeiVerificationStatus;
	readonly recommendedAlternative?: LeiDiscoveredModel;
	readonly explanation: string;
	readonly sources: readonly LeiSourceReference[];
	readonly evidenceId?: string;
}

// ── Dependency, Registry & Security Advisory Intelligence (Parts 4.4, 4.7, 12) ─────────

export type LeiPackageEcosystem = 'npm' | 'pypi' | 'pub' | 'crates' | 'packagist' | 'maven' | 'nuget';

export interface LeiSecurityAdvisory {
	readonly id: string; // CVE-... or GHSA-...
	readonly aliases: readonly string[];
	readonly summary: string;
	readonly severity: 'low' | 'moderate' | 'high' | 'critical' | 'unknown';
	readonly affectedPackage: string;
	readonly ecosystem: LeiPackageEcosystem | string;
	readonly affectedRange?: string;
	readonly fixedVersions: readonly string[];
	readonly publishedDate?: string;
	readonly modifiedDate?: string;
	readonly sourceUrl: string;
	readonly authorityLabel: string;
}

export interface LeiDependencyReport {
	readonly operationId: string;
	readonly packageName: string;
	readonly ecosystem: LeiPackageEcosystem;
	readonly currentProjectVersion?: string;
	readonly latestVersion?: string;
	readonly recommendedVersion?: string;
	readonly deprecated: boolean;
	readonly deprecationMessage?: string;
	readonly license?: string;
	readonly lastPublishedDate?: string;
	readonly homepage?: string;
	readonly repositoryUrl?: string;
	readonly runtimeRequirement?: string;
	readonly peerDependencies: Readonly<Record<string, string>>;
	readonly vulnerabilities: readonly LeiSecurityAdvisory[];
	readonly compatibilityVerdict: 'compatible' | 'caution_breaking_change' | 'incompatible' | 'vulnerable' | 'deprecated' | 'unverified';
	readonly installCommand?: string;
	readonly notes: readonly string[];
	readonly sources: readonly LeiSourceReference[];
	readonly verificationStatus: LeiVerificationStatus;
	readonly evidenceId?: string;
	readonly error?: string;
}

export interface LeiSecurityAuditReport {
	readonly operationId: string;
	readonly target: string;
	readonly ecosystem?: LeiPackageEcosystem | string;
	readonly version?: string;
	readonly advisories: readonly LeiSecurityAdvisory[];
	readonly criticalCount: number;
	readonly highCount: number;
	readonly moderateCount: number;
	readonly lowCount: number;
	readonly owaspGuidance: readonly string[];
	readonly upgradeImpactNotes: readonly string[];
	readonly sources: readonly LeiSourceReference[];
	readonly verificationStatus: LeiVerificationStatus;
	readonly evidenceId?: string;
	readonly error?: string;
}

export interface LeiResearchResult {
	readonly operationId: string;
	readonly topic: string;
	readonly technology: string;
	readonly freshness: LeiFreshnessAssessment;
	readonly verificationStatus: LeiVerificationStatus;
	readonly summary: string;
	readonly keyFindings: readonly string[];
	readonly detectedVersions: readonly string[];
	readonly deprecationNotices: readonly string[];
	readonly recommendations: readonly string[];
	readonly sources: readonly LeiSourceReference[];
	readonly conflicts: readonly LeiEvidenceConflict[];
	readonly evidence?: LeiEvidenceRecord;
	readonly fromCache: boolean;
	readonly durationMs: number;
	readonly error?: string;
}

export interface LeiFailureDiagnosisReport {
	readonly operationId: string;
	readonly errorMessage: string;
	readonly technology: string;
	readonly detectedVersion?: string;
	readonly likelyOutdatedCause: boolean;
	readonly rootCauseSummary: string;
	readonly recommendedFix: string;
	readonly migrationSteps: readonly string[];
	readonly research: LeiResearchResult;
}

// ── Freshness Policies & Cache (Part 9) ────────────────────────────────────────────────

export interface LeiFreshnessPolicies {
	readonly enabled: boolean;
	readonly aiModelsTtlMs: number;
	readonly modelDeprecationTtlMs: number;
	readonly packageVersionsTtlMs: number;
	readonly securityAdvisoriesTtlMs: number;
	readonly frameworkReleasesTtlMs: number;
	readonly sdkCompatibilityTtlMs: number;
	readonly apiEndpointsTtlMs: number;
	readonly cloudServicesTtlMs: number;
	readonly maxSourcesToInspect: number;
	readonly requestTimeoutMs: number;
}

export const DEFAULT_LEI_FRESHNESS_POLICIES: LeiFreshnessPolicies = {
	enabled: true,
	aiModelsTtlMs: 6 * 60 * 60 * 1000,           // 6 hours
	modelDeprecationTtlMs: 12 * 60 * 60 * 1000,  // 12 hours
	packageVersionsTtlMs: 12 * 60 * 60 * 1000,   // 12 hours
	securityAdvisoriesTtlMs: 3 * 60 * 60 * 1000, // 3 hours
	frameworkReleasesTtlMs: 24 * 60 * 60 * 1000, // 24 hours
	sdkCompatibilityTtlMs: 24 * 60 * 60 * 1000,  // 24 hours
	apiEndpointsTtlMs: 12 * 60 * 60 * 1000,      // 12 hours
	cloudServicesTtlMs: 24 * 60 * 60 * 1000,     // 24 hours
	maxSourcesToInspect: 4,
	requestTimeoutMs: 12_000,
};

// ── Real-Time Event System & Live UI Status (Parts 14 & 15) ────────────────────────────

export type LeiSystemStatus = 'active' | 'disabled' | 'initializing' | 'degraded' | 'unavailable';

export type LeiResearchMode =
	| 'live_research_enabled'
	| 'research_in_progress'
	| 'cached_verified'
	| 'research_not_required'
	| 'research_unavailable';

export type LeiKnowledgeFreshness =
	| 'current_research'
	| 'fresh_verified_cache'
	| 'refresh_recommended'
	| 'stale_information'
	| 'expired_information'
	| 'unknown_freshness';

export type LeiEventType =
	| 'research_started'
	| 'query_submitted'
	| 'source_discovered'
	| 'source_opened'
	| 'evidence_extracted'
	| 'verification_started'
	| 'verification_completed'
	| 'conflict_discovered'
	| 'cache_hit'
	| 'cache_expired'
	| 'research_completed'
	| 'research_failed'
	| 'research_cancelled'
	| 'recommendation_generated'
	| 'technical_decision_made';

export interface LeiEvent {
	readonly eventId: string;
	readonly sequence: number;
	readonly operationId: string;
	readonly projectId?: string;
	readonly timestamp: number;
	readonly type: LeiEventType;
	readonly technology: string;
	readonly taskSummary: string;
	readonly status: 'running' | 'success' | 'warning' | 'error' | 'cancelled';
	readonly detail?: string;
	readonly sourceRef?: LeiSourceReference;
	readonly verificationStatus?: LeiVerificationStatus;
	readonly error?: string;
}

export interface LeiOperationSummary {
	readonly operationId: string;
	readonly kind: 'technology_research' | 'model_discovery' | 'model_verification' | 'dependency_check' | 'security_audit' | 'failure_diagnosis' | 'refresh';
	readonly technology: string;
	readonly taskLabel: string;
	readonly status: 'running' | 'completed' | 'failed' | 'cancelled';
	readonly startedAtMs: number;
	readonly completedAtMs?: number;
	readonly sourcesDiscovered: number;
	readonly sourcesOpened: number;
	readonly sources: readonly LeiSourceReference[];
	readonly verificationStatus: LeiVerificationStatus;
	readonly selectedIdentifierOrVersion?: string;
	readonly findingSummary?: string;
	readonly recommendation?: string;
	readonly conflictCount: number;
	readonly fromCache: boolean;
	readonly error?: string;
}

export interface LeiLiveSnapshot {
	readonly systemStatus: LeiSystemStatus;
	readonly researchMode: LeiResearchMode;
	readonly currentTask: string;
	readonly activeOperationId?: string;
	readonly activeTechnologies: readonly string[];
	readonly sources: readonly LeiSourceReference[];
	readonly verificationStatus: LeiVerificationStatus | 'not_applicable';
	readonly knowledgeFreshness: LeiKnowledgeFreshness;
	readonly lastVerifiedAtMs?: number;
	readonly networkAvailable: boolean;
	readonly webSearchConfigured: boolean;
	readonly evidenceCount: number;
	readonly verifiedEvidenceCount: number;
	readonly staleEvidenceCount: number;
	readonly conflictCount: number;
	readonly activeOperations: readonly LeiOperationSummary[];
	readonly recentOperations: readonly LeiOperationSummary[];
	readonly recentEvents: readonly LeiEvent[];
	readonly policies: LeiFreshnessPolicies;
}

// ── Service Contract ───────────────────────────────────────────────────────────────────

export interface LeiResearchRequest {
	readonly topic: string;
	readonly technology?: string;
	readonly domain?: LeiDomain;
	readonly projectRoot?: string;
	readonly currentVersionOrId?: string;
	readonly forceRefresh?: boolean;
	readonly officialUrls?: readonly string[];
}

export interface LeiModelDiscoveryRequest {
	readonly provider: LeiProviderId;
	readonly requirements?: LeiModelTaskRequirements;
	readonly forceRefresh?: boolean;
	readonly testTopCandidate?: boolean;
	readonly projectRoot?: string;
}

export interface LeiModelVerificationRequest {
	readonly provider: LeiProviderId;
	readonly modelId: string;
	readonly requirements?: LeiModelTaskRequirements;
	readonly testEndpoint?: boolean;
	readonly forceRefresh?: boolean;
	readonly projectRoot?: string;
}

export interface LeiDependencyCheckRequest {
	readonly packageName: string;
	readonly ecosystem: LeiPackageEcosystem;
	readonly currentVersion?: string;
	readonly projectRoot?: string;
	readonly forceRefresh?: boolean;
}

export interface LeiSecurityCheckRequest {
	readonly target: string;
	readonly ecosystem?: LeiPackageEcosystem;
	readonly version?: string;
	readonly projectRoot?: string;
	readonly forceRefresh?: boolean;
}

export interface LeiFailureDiagnosisRequest {
	readonly errorMessage: string;
	readonly technology?: string;
	readonly currentVersion?: string;
	readonly projectRoot?: string;
}

export interface IKodiaLiveIntelligenceMainService {
	readonly _serviceBrand: undefined;

	readonly onDidEmitEvent: Event<LeiEvent>;
	readonly onDidChangeSnapshot: Event<LeiLiveSnapshot>;

	getSnapshot(projectRoot?: string): Promise<LeiLiveSnapshot>;
	assessFreshness(topic: string, technology?: string, currentVersionOrId?: string, projectRoot?: string): Promise<LeiFreshnessAssessment>;
	researchTechnology(req: LeiResearchRequest): Promise<LeiResearchResult>;
	discoverProviderModels(req: LeiModelDiscoveryRequest): Promise<LeiModelDiscoveryReport>;
	verifyModelSelection(req: LeiModelVerificationRequest): Promise<LeiModelVerificationReport>;
	checkDependency(req: LeiDependencyCheckRequest): Promise<LeiDependencyReport>;
	checkSecurityAdvisories(req: LeiSecurityCheckRequest): Promise<LeiSecurityAuditReport>;
	diagnoseFailureWithResearch(req: LeiFailureDiagnosisRequest): Promise<LeiFailureDiagnosisReport>;
	inspectEvidence(filter?: { technology?: string; domain?: LeiDomain; projectRoot?: string; includeStale?: boolean }): Promise<readonly LeiEvidenceRecord[]>;
	refreshStaleKnowledge(projectRoot?: string): Promise<{ refreshed: number; failed: number; snapshot: LeiLiveSnapshot }>;
	invalidateKnowledge(filter: { technology?: string; evidenceId?: string; reason: string; projectRoot?: string }): Promise<{ invalidated: number }>;
	cancelOperation(operationId: string): Promise<{ cancelled: boolean }>;
	updatePolicies(patch: Partial<LeiFreshnessPolicies>): Promise<LeiFreshnessPolicies>;
	getResearchHistory(limit?: number): Promise<readonly LeiOperationSummary[]>;
}

export const IKodiaLiveIntelligenceMainService = createDecorator<IKodiaLiveIntelligenceMainService>('kodiaLiveIntelligenceMainService');
