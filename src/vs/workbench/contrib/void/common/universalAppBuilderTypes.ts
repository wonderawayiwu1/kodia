/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const KODIA_UABE_CHANNEL = 'void-channel-universalAppBuilder';

// ── Section 4: Project-Specific Build Modes ────────────────────────────────────────────

export type UabeBuildMode = 'autonomous_build' | 'plan_first' | 'user_chooses';

export type UabePlatformTarget =
	| 'web'
	| 'fullstack'
	| 'mobile_rn'
	| 'mobile_flutter'
	| 'mobile_android'
	| 'mobile_ios'
	| 'desktop_electron'
	| 'desktop_tauri'
	| 'desktop_native'
	| 'ai_app'
	| 'api_service'
	| 'enterprise_saas'
	| 'ecommerce'
	| 'iot'
	| 'game';

export type UabeWorkspaceTab =
	| 'create'
	| 'requirements'
	| 'preview'
	| 'integrations'
	| 'baas'
	| 'reliability'
	| 'handover'
	| 'activity';

// ── Section 5: Contract-to-Product Requirements & Traceability ─────────────────────────

export type UabeBriefSourceType =
	| 'idea'
	| 'client_brief'
	| 'contract'
	| 'sow'
	| 'prd'
	| 'api_spec'
	| 'figma_reference'
	| 'existing_code';

export type UabeRequirementCategory =
	| 'functional'
	| 'non_functional'
	| 'business_rule'
	| 'workflow'
	| 'data'
	| 'integration'
	| 'security'
	| 'performance'
	| 'platform'
	| 'acceptance';

export type UabeRequirementStatus =
	| 'captured'
	| 'planned'
	| 'implemented'
	| 'tested'
	| 'verified'
	| 'blocked';

export interface UabeRequirementItem {
	readonly id: string;
	readonly source: string;
	readonly category: UabeRequirementCategory;
	readonly title: string;
	readonly description: string;
	readonly acceptanceCriteria: readonly string[];
	readonly status: UabeRequirementStatus;
	readonly implementationFiles: readonly string[];
	readonly testFiles: readonly string[];
	readonly verificationEvidence?: string;
	readonly blockerReason?: string;
}

export interface UabeContractAnalysis {
	readonly id: string;
	readonly sourceType: UabeBriefSourceType;
	readonly projectTitle: string;
	readonly businessObjectives: readonly string[];
	readonly userRoles: readonly string[];
	readonly keyWorkflows: readonly string[];
	readonly requirements: readonly UabeRequirementItem[];
	readonly ambiguities: readonly string[];
	readonly detectedPlatforms: readonly UabePlatformTarget[];
	readonly detectedProviderHints: readonly string[];
	readonly generatedAtMs: number;
}

// ── Sections 6 & 7: Universal Architecture & Stack Intelligence ────────────────────────

export type UabeArchitectureStyle =
	| 'modular_monolith'
	| 'client_server'
	| 'serverless'
	| 'event_driven'
	| 'offline_first'
	| 'multi_tenant_saas'
	| 'microservices'
	| 'hybrid_desktop_local';

export interface UabeStackRecommendation {
	readonly architectureStyle: UabeArchitectureStyle;
	readonly frontend: string;
	readonly backend: string;
	readonly database: string;
	readonly mobile?: string;
	readonly desktop?: string;
	readonly aiLayer?: string;
	readonly baasOrCloud?: string;
	readonly testingStack: readonly string[];
	readonly rationale: string;
	readonly alternativesConsidered: readonly { name: string; whyNotChosen: string }[];
	readonly respectsExistingStack: boolean;
}

// ── Section 13: BaaS, Cloud & Hosting Provider Adapters ────────────────────────────────

export type UabePricingTierKind =
	| 'free_available'
	| 'free_with_billing'
	| 'trial_credits'
	| 'pay_as_you_go'
	| 'paid_subscription'
	| 'self_hosted_oss';

export interface UabeCloudAdapterInfo {
	readonly id: string;
	readonly name: string;
	readonly category: 'baas' | 'database' | 'cloud_serverless' | 'hosting' | 'ai_inference' | 'payments' | 'communications';
	readonly pricingTier: UabePricingTierKind;
	readonly pricingDisclosure: string;
	readonly capabilities: readonly string[];
	readonly officialSignupUrl: string;
	readonly officialDocsUrl: string;
	readonly officialKeysUrl: string;
	readonly requiresBillingCard: boolean;
	readonly selfHostable: boolean;
	readonly localEmulatorAvailable: boolean;
}

// ── Section 14: IRIRE (Intelligent Requirements & Integration Readiness Engine) ────────

export type IrireClassification =
	| 'mandatory'
	| 'optional'
	| 'alternative'
	| 'development_only'
	| 'production_only'
	| 'user_dependent'
	| 'pending_verification';

export type IrireIntegrationMode =
	| 'live_verified'
	| 'local_dev'
	| 'sandbox'
	| 'mock_substitute'
	| 'pending_credentials'
	| 'failed';

export interface IrireExternalRequirement {
	readonly id: string;
	readonly providerId: string;
	readonly providerName: string;
	readonly category: 'ai_provider' | 'database' | 'baas' | 'payment' | 'auth_oauth' | 'email' | 'sms' | 'storage' | 'maps' | 'hosting' | 'mobile_store' | 'custom';
	readonly envVarName: string;
	readonly classification: IrireClassification;
	readonly mode: IrireIntegrationMode;
	readonly reason: string;
	readonly dependentFeatures: readonly string[];
	readonly officialSignupUrl: string;
	readonly officialDocsUrl: string;
	readonly officialApiKeysUrl: string;
	readonly urlVerificationStatus: 'verified_official' | 'unverified';
	readonly retrievedAtMs: number;
	readonly billingRequirement: string;
	readonly setupSteps: readonly string[];
	readonly alternatives: readonly { providerName: string; note: string; isLocalOrFree: boolean }[];
	readonly configured: boolean;
	readonly maskedValue?: string;
	readonly lastTestedAtMs?: number;
	readonly lastTestMessage?: string;
}

export interface IrireConnectionTestResult {
	readonly requirementId: string;
	readonly providerName: string;
	readonly envVarName: string;
	readonly ok: boolean;
	readonly mode: IrireIntegrationMode;
	readonly formatValid: boolean;
	readonly liveChecked: boolean;
	readonly message: string;
	readonly testedAtMs: number;
}

// ── Section 9 & 19: Visual Editing with Real Source-Code Sync & Live Preview ───────────

export type UabeViewportPreset = 'mobile' | 'tablet' | 'laptop' | 'desktop' | 'wide' | 'custom';

export interface UabeVisualEditRequest {
	readonly filePath: string;
	readonly selectorOrText: string;
	readonly newText?: string;
	readonly styleChanges?: Readonly<Record<string, string>>;
	readonly addClasses?: readonly string[];
	readonly removeClasses?: readonly string[];
	readonly attributeChanges?: Readonly<Record<string, string>>;
}

export interface UabeVisualEditResult {
	readonly applied: boolean;
	readonly filePath: string;
	readonly checkpointId?: string;
	readonly matchedLine?: number;
	readonly summary: string;
	readonly limitationReason?: string;
	readonly beforeSnippet?: string;
	readonly afterSnippet?: string;
}

export interface UabePreviewState {
	readonly url: string;
	readonly port?: number;
	readonly pid?: number;
	readonly framework?: string;
	readonly status: 'stopped' | 'starting' | 'running' | 'error';
	readonly viewport: UabeViewportPreset;
	readonly width: number;
	readonly height: number;
	readonly visualEditEnabled: boolean;
	readonly consoleErrors: readonly string[];
	readonly networkFailures: readonly string[];
	readonly lastCheckedAtMs?: number;
}

// ── Section 27: Honest Application Reliability Dashboard (Anti-False-Confidence) ───────

export type UabePillarStatus =
	| 'passed'
	| 'failed'
	| 'warning'
	| 'blocked'
	| 'not_tested'
	| 'not_applicable'
	| 'unverified';

export interface UabeReliabilityPillar {
	readonly id: string;
	readonly label: string;
	readonly status: UabePillarStatus;
	readonly detail: string;
	readonly evidence?: string;
	readonly checkedAtMs: number;
}

export interface UabeReliabilityDashboardReport {
	readonly evaluatedAtMs: number;
	readonly workspaceRoot: string;
	readonly overallStatus: 'verified_against_executed_checks' | 'needs_fixes' | 'partially_verified' | 'blocked';
	readonly pillars: readonly UabeReliabilityPillar[];
	readonly unresolvedDefectsCount: number;
	readonly blockedRequirementsCount: number;
	readonly unverifiedFeatures: readonly string[];
	readonly verifiedChecksCount: number;
	readonly totalChecksCount: number;
	readonly summary: string;
}

// ── Section 33: Client Delivery & Handover Package ─────────────────────────────────────

export interface UabeHandoverPackageResult {
	readonly generatedAtMs: number;
	readonly outputDir: string;
	readonly filesGenerated: readonly { relativePath: string; kind: 'docs' | 'ops' | 'qa_report' | 'presentation' | 'env_template' | 'manifest'; description: string }[];
	readonly secretsRedactedCount: number;
	readonly zeroSecretsVerified: boolean;
	readonly summary: string;
}

// ── Section 34: Project Checkpoints & Rollback ─────────────────────────────────────────

export interface UabeCheckpointRecord {
	readonly id: string;
	readonly label: string;
	readonly createdAtMs: number;
	readonly files: readonly string[];
}

// ── Section 21 & 31: Persistent Execution State & Live Activity Events ─────────────────

export type UabeExecutionPhase =
	| 'idle'
	| 'understanding_requirements'
	| 'researching_technology'
	| 'designing_architecture'
	| 'configuring_integrations'
	| 'waiting_for_credentials'
	| 'implementing'
	| 'preview_running'
	| 'testing'
	| 'investigating_errors'
	| 'repairing'
	| 'verifying'
	| 'preparing_handover'
	| 'ready_for_review';

export interface UabeActivityEvent {
	readonly id: string;
	readonly sequence: number;
	readonly timestampMs: number;
	readonly phase: UabeExecutionPhase;
	readonly severity: 'info' | 'success' | 'warning' | 'error';
	readonly message: string;
}

export interface UabeProjectState {
	readonly projectId: string;
	readonly name: string;
	readonly brief: string;
	readonly workspaceRoot: string;
	readonly buildMode: UabeBuildMode;
	readonly phase: UabeExecutionPhase;
	readonly platforms: readonly UabePlatformTarget[];
	readonly contractAnalysis?: UabeContractAnalysis;
	readonly stack?: UabeStackRecommendation;
	readonly integrations: readonly IrireExternalRequirement[];
	readonly preview: UabePreviewState;
	readonly reliability?: UabeReliabilityDashboardReport;
	readonly lastHandover?: UabeHandoverPackageResult;
	readonly checkpoints: readonly UabeCheckpointRecord[];
	readonly recentEvents: readonly UabeActivityEvent[];
	readonly createdAtMs: number;
	readonly updatedAtMs: number;
}

// ── Global Settings for Kodia Settings UI ──────────────────────────────────────────────

export interface UabeEngineSettings {
	readonly defaultBuildMode: UabeBuildMode;
	readonly autoOpenAppBuilderOnBuildIntent: boolean;
	readonly autoDiscoverExternalRequirements: boolean;
	readonly autoOpenLivePreviewOnServerStart: boolean;
	readonly enableVisualEditSourceSync: boolean;
	readonly requireEvidenceBeforeCompletion: boolean;
	readonly enforceSecretRedactionInHandover: boolean;
	readonly preferFreeLocalDefaultsWhenNoCredentials: boolean;
	readonly showEngineStatusInChat: boolean;
}

export const DEFAULT_UABE_ENGINE_SETTINGS: UabeEngineSettings = {
	defaultBuildMode: 'autonomous_build',
	autoOpenAppBuilderOnBuildIntent: true,
	autoDiscoverExternalRequirements: true,
	autoOpenLivePreviewOnServerStart: true,
	enableVisualEditSourceSync: true,
	requireEvidenceBeforeCompletion: true,
	enforceSecretRedactionInHandover: true,
	preferFreeLocalDefaultsWhenNoCredentials: true,
	showEngineStatusInChat: true,
};

// ── Main-Process IPC Contract ──────────────────────────────────────────────────────────

export interface UabeInitProjectRequest {
	readonly name?: string;
	readonly brief: string;
	readonly sourceType?: UabeBriefSourceType;
	readonly buildMode?: UabeBuildMode;
	readonly preferredPlatforms?: readonly UabePlatformTarget[];
	readonly preferredStack?: string;
}

export interface UabeScaffoldResult {
	readonly template: string;
	readonly filesWritten: readonly string[];
	readonly checkpointId: string;
	readonly testCommand: string;
	readonly startCommand: string;
	readonly summary: string;
}

export interface IKodiaUniversalAppBuilderMainService {
	readonly _serviceBrand: undefined;
	readonly onDidEmitEvent: Event<UabeActivityEvent>;
	readonly onDidChangeProject: Event<UabeProjectState>;

	getProjectState(workspaceRoot: string): Promise<UabeProjectState>;
	initializeProject(workspaceRoot: string, req: UabeInitProjectRequest): Promise<UabeProjectState>;
	setProjectBuildMode(workspaceRoot: string, mode: UabeBuildMode): Promise<UabeProjectState>;
	analyzeContractOrBrief(workspaceRoot: string, req: { brief: string; sourceType?: UabeBriefSourceType }): Promise<UabeContractAnalysis>;
	recommendStack(workspaceRoot: string, req?: { preferredStack?: string; preferredPlatforms?: readonly UabePlatformTarget[] }): Promise<UabeStackRecommendation>;
	discoverExternalRequirements(workspaceRoot: string, briefOverride?: string): Promise<readonly IrireExternalRequirement[]>;
	configureIntegrationSecret(workspaceRoot: string, req: { requirementId: string; envVarName: string; secretValue: string; mode?: IrireIntegrationMode }): Promise<{ ok: boolean; requirement?: IrireExternalRequirement; message: string }>;
	testIntegrationConnection(workspaceRoot: string, requirementId: string): Promise<IrireConnectionTestResult>;
	listCloudAdapters(): Promise<readonly UabeCloudAdapterInfo[]>;
	applyVisualEdit(workspaceRoot: string, req: UabeVisualEditRequest): Promise<UabeVisualEditResult>;
	updatePreviewState(workspaceRoot: string, patch: Partial<UabePreviewState>): Promise<UabePreviewState>;
	scaffoldApplication(workspaceRoot: string, req: { template: 'website' | 'fullstack_business' | 'ai_app' | 'mobile_rn' | 'desktop_electron'; appName: string }): Promise<UabeScaffoldResult>;
	evaluateReliabilityDashboard(workspaceRoot: string, opts?: { runCompiler?: boolean; testCommand?: string; buildCommand?: string }): Promise<UabeReliabilityDashboardReport>;
	generateClientHandover(workspaceRoot: string, opts?: { clientName?: string; projectTitle?: string }): Promise<UabeHandoverPackageResult>;
	createCheckpoint(workspaceRoot: string, label: string, files: readonly string[]): Promise<UabeCheckpointRecord>;
	rollbackCheckpoint(workspaceRoot: string, checkpointId: string): Promise<{ restored: boolean; filesRestored: readonly string[]; message: string }>;
}

export const IKodiaUniversalAppBuilderMainService = createDecorator<IKodiaUniversalAppBuilderMainService>('kodiaUniversalAppBuilderMainService');
