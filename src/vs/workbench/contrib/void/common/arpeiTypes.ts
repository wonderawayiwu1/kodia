/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const KODIA_ARPEI_CHANNEL = 'void-channel-arpei';

// ============================================================================
// 1. Native ARPEI Workspace Sections (Part 21)
// ============================================================================

export type ArpeiWorkspaceSection =
	| 'overview'
	| 'reference_explorer'
	| 'live_browser'
	| 'screenshot_gallery'
	| 'design_intelligence'
	| 'asset_intelligence'
	| 'technical_research'
	| 'requirements_traceability'
	| 'research_history';

export const ARPEI_SECTION_ORDER: readonly ArpeiWorkspaceSection[] = [
	'overview',
	'reference_explorer',
	'live_browser',
	'screenshot_gallery',
	'design_intelligence',
	'asset_intelligence',
	'technical_research',
	'requirements_traceability',
	'research_history',
];

// ============================================================================
// 2. Research Modes & Intelligent Research Decision Engine (Part 4)
// ============================================================================

export type ArpeiResearchMode =
	| 'autonomous_research_and_build'
	| 'research_only'
	| 'plan_first'
	| 'user_directed_research'
	| 'existing_project_enhancement'
	| 'fast_implementation';

export type ArpeiResearchDepth = 'skip_trivial' | 'targeted' | 'standard' | 'deep_discovery';

export interface ArpeiResearchDecision {
	readonly shouldResearch: boolean;
	readonly recommendedMode: ArpeiResearchMode;
	readonly recommendedDepth: ArpeiResearchDepth;
	readonly signals: {
		readonly hasExplicitReference: boolean;
		readonly involvesChangingTech: boolean;
		readonly requiresDomainKnowledge: boolean;
		readonly needsVisualInspiration: boolean;
		readonly requiresExternalServices: boolean;
		readonly involvesStandardsOrSafety: boolean;
		readonly needsAssetsOrDatasets: boolean;
		readonly benefitsFromCompetitorResearch: boolean;
		readonly needsBrowserInspection: boolean;
		readonly requiresPlatformOrHardwareDocs: boolean;
	};
	readonly reasons: readonly string[];
	readonly proposedQueries: readonly string[];
	readonly skipReason?: string;
}

// ============================================================================
// 3. Universal Domain, Role & Deep Product Discovery (Part 2 & Master Addition)
// ============================================================================

export interface ArpeiUserRoleProfile {
	readonly role: string;
	readonly description: string;
	readonly capabilities: readonly string[];
	readonly permissionsBoundary: string;
	readonly distinctWorkflows: readonly string[];
	readonly observedOrDocumented: ArpeiEvidenceEpistemicStatus;
}

export interface ArpeiDomainDiscovery {
	readonly softwareCategory: string; // dynamically discovered — never limited to fixed templates
	readonly industry: string;
	readonly domain: string;
	readonly targetUsers: readonly string[];
	readonly userProblems: readonly string[];
	readonly userRoles: readonly ArpeiUserRoleProfile[];
	readonly operationalWorkflows: readonly string[];
	readonly regulationsAndStandards: readonly string[];
	readonly domainTerminology: readonly string[];
	readonly coreDataEntities: readonly string[];
	readonly businessRules: readonly string[];
	readonly technicalConstraints: readonly string[];
	readonly hardwareOrInfraRequirements: readonly string[];
	readonly externalServices: readonly string[];
	readonly securityAndPrivacyRequirements: readonly string[];
	readonly requiredTestingMethods: readonly string[];
	readonly productionExpectations: readonly string[];
	readonly requiresQualifiedHumanReview: boolean;
	readonly humanReviewReason?: string;
}

// ============================================================================
// 4. Evidence Epistemic Provenance, Freshness & Corroboration (Master Add. §5)
// ============================================================================

export type ArpeiEvidenceEpistemicStatus =
	| 'directly_observed'
	| 'officially_documented'
	| 'independently_corroborated'
	| 'strongly_inferred'
	| 'weakly_inferred'
	| 'unknown'
	| 'inaccessible_unverified';

export type ArpeiFreshnessState = 'fresh' | 'aging' | 'stale';

export interface ArpeiSourceEvidence {
	readonly id: string;
	readonly topic: string;
	readonly sourceUrl: string;
	readonly sourceTitle: string;
	readonly sourceKind: 'live_product' | 'official_docs' | 'api_spec' | 'sitemap_robots' | 'changelog' | 'help_center' | 'web_search' | 'open_source' | 'user_provided';
	readonly retrievedAt: string;
	readonly version?: string;
	readonly epistemicStatus: ArpeiEvidenceEpistemicStatus;
	readonly freshness: ArpeiFreshnessState;
	readonly confidence: number; // 0..1
	readonly summary: string;
	readonly corroboratedByIds: readonly string[];
	readonly conflictingNotes?: readonly string[];
	readonly untrustedInstructionsStripped: number;
}

// ============================================================================
// 5. Reference Exploration, Interaction Discovery & Coverage Matrices (Parts 6, 7 & Master Add. §6)
// ============================================================================

export interface ArpeiObservedInteraction {
	readonly id: string;
	readonly pageUrl: string;
	readonly selector: string;
	readonly actionKind: 'click' | 'fill' | 'select' | 'scroll' | 'hover' | 'submit' | 'navigate';
	readonly label: string;
	readonly expectedBehavior: string;
	readonly observedBehavior: string;
	readonly outcomeChangedDomOrUrl: boolean;
	readonly timestamp: string;
}

export interface ArpeiReferencePageRecord {
	readonly url: string;
	readonly title: string;
	readonly layer: 'public_landing' | 'navigation_nested' | 'authenticated' | 'workflow' | 'documentation' | 'api_portal';
	readonly status: 'inspected' | 'restricted' | 'inaccessible' | 'not_inspected' | 'failed';
	readonly httpStatus?: number;
	readonly visitedAt?: string;
	readonly discoveredLinksCount: number;
	readonly interactiveElementsCount: number;
	readonly formsCount: number;
	readonly consoleErrorsCount: number;
	readonly networkFailuresCount: number;
	readonly extractedFeatures: readonly string[];
	readonly navigationItems: readonly string[];
	readonly screenshotIds: readonly string[];
	readonly restrictionReason?: string;
}

export interface ArpeiReferenceCoverageRow {
	readonly area: string;
	readonly status: 'inspected' | 'partially_inspected' | 'restricted' | 'not_inspected' | 'not_found';
	readonly pagesCount: number;
	readonly screenshotsCount: number;
	readonly interactionsCount: number;
	readonly notes: string;
}

export interface ArpeiReferenceCoverageMatrix {
	readonly referenceProduct: string;
	readonly rootUrl: string;
	readonly discoveredPagesCount: number;
	readonly visitedPagesCount: number;
	readonly inspectedPagesCount: number;
	readonly restrictedPagesCount: number;
	readonly unavailablePagesCount: number;
	readonly screenshotsCapturedCount: number;
	readonly interactionsTestedCount: number;
	readonly featuresIdentified: readonly string[];
	readonly unverifiedAreas: readonly string[];
	readonly rows: readonly ArpeiReferenceCoverageRow[];
}

export type ArpeiDeepCoverageStatus =
	| 'not_investigated'
	| 'discovered'
	| 'partially_investigated'
	| 'directly_observed'
	| 'documented'
	| 'corroborated'
	| 'inferred'
	| 'inaccessible'
	| 'unverified'
	| 'not_applicable';

export interface ArpeiDeepDiscoveryCoverageEntry {
	readonly category:
		| 'product_overview'
		| 'user_roles'
		| 'pages'
		| 'features'
		| 'workflows'
		| 'business_rules'
		| 'integrations'
		| 'apis'
		| 'data_entities'
		| 'permissions'
		| 'technical_requirements'
		| 'security_requirements'
		| 'operational_requirements'
		| 'mobile_experiences'
		| 'edge_cases'
		| 'error_and_recovery_flows'
		| 'current_changes'
		| 'unverified_areas';
	readonly label: string;
	readonly status: ArpeiDeepCoverageStatus;
	readonly evidenceCount: number;
	readonly summary: string;
}

// ============================================================================
// 6. Persistent Visual Memory, Design Spec & Asset Intelligence (Parts 8, 9, 10)
// ============================================================================

export interface ArpeiScreenshotRecord {
	readonly id: string;
	readonly sessionId: string;
	readonly kind: 'reference' | 'implementation' | 'responsive' | 'interaction' | 'comparison';
	readonly sourceUrl: string;
	readonly pageTitle: string;
	readonly filePath: string;
	/** Optional base64 PNG data URL hydrated for live UI preview (stripped before writing sessions.json). */
	readonly thumbnailDataUrl?: string;
	readonly capturedAt: string;
	readonly viewport: { readonly width: number; readonly height: number };
	readonly interactionLabel?: string;
	readonly description: string;
	readonly componentObservations: readonly string[];
	readonly designObservations: readonly string[];
	readonly linkedRequirementIds: readonly string[];
	readonly confidence: number;
	readonly stale: boolean;
}

export interface ArpeiDesignSpecification {
	readonly fidelityMode: 'close_authorized_reference' | 'original_inspired_by_research';
	readonly visualDirection: string;
	readonly palette: readonly { readonly token: string; readonly hex: string; readonly usage: string }[];
	readonly typography: { readonly headingFont: string; readonly bodyFont: string; readonly scaleNotes: string };
	readonly spacingAndGrid: string;
	readonly navigationPattern: string;
	readonly componentPatterns: readonly string[];
	readonly motionAndResponsive: string;
	readonly accessibilityPatterns: readonly string[];
	readonly originalityDisclaimer: string;
}

export interface ArpeiAssetRecord {
	readonly id: string;
	readonly source: string;
	readonly originalUrl: string;
	readonly license: string;
	readonly attribution: string;
	readonly downloadStatus: 'discovered' | 'downloaded' | 'generated_fallback' | 'failed';
	readonly localPath?: string;
	readonly intendedUsage: string;
	readonly optimizationStatus: 'pending' | 'optimized' | 'original';
	readonly dimensions?: { readonly width: number; readonly height: number };
	readonly format?: string;
	readonly altText: string;
	readonly verifiedAvailable: boolean;
}

// ============================================================================
// 7. Research Gaps, Readiness Gate, Traceability & Visual Comparison (Parts 13, 17 & Master Add. §7-9)
// ============================================================================

export interface ArpeiResearchGap {
	readonly id: string;
	readonly question: string;
	readonly impact: 'high' | 'medium' | 'low';
	readonly status: 'open' | 'investigated' | 'assumed_explicitly' | 'inaccessible';
	readonly assumptionMade?: string;
	readonly resolutionEvidence?: string;
}

export interface ArpeiReadinessGateCheck {
	readonly id: string;
	readonly label: string;
	readonly status: 'satisfied' | 'satisfied_with_documented_gaps' | 'incomplete' | 'bypassed_by_user';
	readonly detail: string;
}

export interface ArpeiResearchReadinessGate {
	readonly evaluatedAt: string;
	readonly readyToImplement: boolean;
	readonly verdict: 'ready' | 'ready_with_assumptions' | 'more_research_recommended' | 'user_fast_track';
	readonly checks: readonly ArpeiReadinessGateCheck[];
	readonly highImpactUnknowns: readonly string[];
	readonly explicitAssumptions: readonly string[];
	readonly summary: string;
}

export interface ArpeiRequirementTraceNode {
	readonly requirementId: string;
	readonly origin: 'explicit_user' | 'observed_reference' | 'research_recommendation' | 'engineering_assumption';
	readonly researchQuestion: string;
	readonly sourceEvidenceIds: readonly string[];
	readonly verifiedFinding: string;
	readonly productRequirement: string;
	readonly architecturalDecision: string;
	readonly designComponents: readonly string[];
	readonly implementationFiles: readonly string[];
	readonly testCases: readonly string[];
	readonly verificationStatus:
		| 'implemented_and_verified'
		| 'implemented_partially_verified'
		| 'partially_implemented'
		| 'placeholder'
		| 'mocked'
		| 'nonfunctional'
		| 'blocked_external'
		| 'not_implemented'
		| 'not_applicable';
	readonly verifiedResult?: string;
}

export interface ArpeiVisualComparisonRecord {
	readonly id: string;
	readonly createdAt: string;
	readonly pageLabel: string;
	readonly viewport: { readonly width: number; readonly height: number };
	readonly referenceScreenshotPath: string;
	readonly implementationScreenshotPath: string;
	readonly diffPercentage: number;
	readonly similarityPct: number;
	readonly dimensionMismatch: boolean;
	readonly layoutDiscrepancies: readonly string[];
	readonly functionalVerificationNote: string; // Explicitly separates visual similarity from functional correctness!
	readonly passedVisualThreshold: boolean;
}

// ============================================================================
// 8. Live Activity Events (21 Truthful Event Types — Part 23)
// ============================================================================

export type ArpeiLiveEventType =
	| 'research_started'
	| 'search_performed'
	| 'source_discovered'
	| 'website_opened'
	| 'page_visited'
	| 'scroll_performed'
	| 'interaction_performed'
	| 'screenshot_captured'
	| 'finding_extracted'
	| 'source_verified'
	| 'asset_discovered'
	| 'asset_downloaded'
	| 'requirement_identified'
	| 'architecture_selected'
	| 'implementation_started'
	| 'visual_comparison_completed'
	| 'test_executed'
	| 'defect_discovered'
	| 'repair_applied'
	| 'verification_completed'
	| 'research_blocked_or_failed';

export interface ArpeiLiveEvent {
	readonly seq: number;
	readonly eventId: string;
	readonly sessionId: string;
	readonly type: ArpeiLiveEventType;
	readonly timestamp: string;
	readonly url?: string;
	readonly detail: string;
	readonly status: 'ok' | 'warning' | 'blocked' | 'error';
}

// ============================================================================
// 9. Research Session, Settings & Main-Process Service Contract
// ============================================================================

export interface ArpeiResearchSession {
	readonly id: string;
	readonly title: string;
	readonly userPrompt: string;
	readonly workspaceRoot: string;
	readonly mode: ArpeiResearchMode;
	readonly status: 'running' | 'paused' | 'completed' | 'completed_partial' | 'cancelled' | 'blocked' | 'failed';
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly completedAt?: string;
	readonly decision: ArpeiResearchDecision;
	readonly domainDiscovery: ArpeiDomainDiscovery;
	readonly referenceUrls: readonly string[];
	readonly pages: readonly ArpeiReferencePageRecord[];
	readonly interactions: readonly ArpeiObservedInteraction[];
	readonly referenceCoverage: readonly ArpeiReferenceCoverageMatrix[];
	readonly deepDiscoveryCoverage: readonly ArpeiDeepDiscoveryCoverageEntry[];
	readonly evidence: readonly ArpeiSourceEvidence[];
	readonly screenshots: readonly ArpeiScreenshotRecord[];
	readonly designSpec?: ArpeiDesignSpecification;
	readonly assets: readonly ArpeiAssetRecord[];
	readonly gaps: readonly ArpeiResearchGap[];
	readonly readinessGate: ArpeiResearchReadinessGate;
	readonly traceability: readonly ArpeiRequirementTraceNode[];
	readonly visualComparisons: readonly ArpeiVisualComparisonRecord[];
	readonly architectureDecisions: readonly string[];
	readonly checkpointStep?: string;
	readonly summary: string;
}

export interface ArpeiSettings {
	readonly enabled: boolean;
	readonly defaultResearchMode: ArpeiResearchMode;
	readonly autoResearchSubstantialApps: boolean;
	readonly enforcePreImplementationReadinessGate: boolean;
	readonly maxReferencePagesPerSession: number;
	readonly maxInteractionsPerPage: number;
	readonly captureResponsiveScreenshots: boolean;
	readonly enableVisualComparison: boolean;
	readonly freshnessMaxAgeHours: number;
	readonly blockExternalSearchInOfflineMode: boolean;
	readonly confirmConsequentialExternalActions: boolean;
}

export const DEFAULT_ARPEI_SETTINGS: ArpeiSettings = {
	enabled: true,
	defaultResearchMode: 'autonomous_research_and_build',
	autoResearchSubstantialApps: true,
	enforcePreImplementationReadinessGate: true,
	maxReferencePagesPerSession: 8,
	maxInteractionsPerPage: 6,
	captureResponsiveScreenshots: true,
	enableVisualComparison: true,
	freshnessMaxAgeHours: 168, // 7 days
	blockExternalSearchInOfflineMode: false,
	confirmConsequentialExternalActions: true,
};

export interface ArpeiWorkspaceSnapshot {
	readonly workspaceRoot: string;
	readonly sessions: readonly ArpeiResearchSession[];
	readonly activeBrowserStatus: {
		readonly running: boolean;
		readonly currentUrl?: string;
		readonly currentAction?: string;
		readonly paused: boolean;
	};
	readonly allScreenshots: readonly ArpeiScreenshotRecord[];
	readonly allAssets: readonly ArpeiAssetRecord[];
	readonly liveEvents: readonly ArpeiLiveEvent[];
}

export interface IKodiaArpeiMainService {
	readonly _serviceBrand: undefined;
	readonly onDidEmitEvent: Event<ArpeiLiveEvent>;

	loadWorkspaceSnapshot(workspaceRoot: string): Promise<ArpeiWorkspaceSnapshot>;
	getRecentEvents(limit?: number): Promise<ArpeiLiveEvent[]>;

	planAndInitResearch(opts: {
		workspaceRoot: string;
		userPrompt: string;
		referenceUrls?: readonly string[];
		mode?: ArpeiResearchMode;
		settings?: Partial<ArpeiSettings>;
	}): Promise<ArpeiResearchSession>;

	exploreReferenceProduct(opts: {
		workspaceRoot: string;
		sessionId: string;
		rootUrl?: string;
		discoverReferences?: boolean;
		maxPages?: number;
		captureScreenshots?: boolean;
		testInteractions?: boolean;
		viewports?: readonly { readonly width: number; readonly height: number }[];
	}): Promise<ArpeiResearchSession>;

	researchTechnicalAndDomain(opts: {
		workspaceRoot: string;
		sessionId: string;
		queries: readonly string[];
		docUrls?: readonly string[];
	}): Promise<ArpeiResearchSession>;

	discoverAndDownloadAssets(opts: {
		workspaceRoot: string;
		sessionId: string;
		queries: readonly { readonly query: string; readonly usage: string; readonly altText: string }[];
		downloadToLocal?: boolean;
	}): Promise<ArpeiAssetRecord[]>;

	evaluateReadinessGate(opts: {
		workspaceRoot: string;
		sessionId: string;
		userFastTrack?: boolean;
	}): Promise<ArpeiResearchReadinessGate>;

	compareReferenceVsImplementation(opts: {
		workspaceRoot: string;
		sessionId: string;
		referenceScreenshotId: string;
		implementationUrl: string;
		pageLabel?: string;
		viewport?: { readonly width: number; readonly height: number };
	}): Promise<ArpeiVisualComparisonRecord>;

	queryResearchMemory(opts: {
		workspaceRoot: string;
		query: string;
		sessionId?: string;
	}): Promise<{
		readonly matchedEvidence: readonly ArpeiSourceEvidence[];
		readonly matchedScreenshots: readonly ArpeiScreenshotRecord[];
		readonly matchedRequirements: readonly ArpeiRequirementTraceNode[];
		readonly matchedAssets: readonly ArpeiAssetRecord[];
		readonly staleEvidenceCount: number;
	}>;

	pauseResearch(sessionId: string): Promise<boolean>;
	resumeResearch(sessionId: string): Promise<boolean>;
	cancelResearch(sessionId: string): Promise<boolean>;
}

export const IKodiaArpeiMainService = createDecorator<IKodiaArpeiMainService>('kodiaArpeiMainService');
