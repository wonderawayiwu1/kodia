/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const KODIA_UAEP_CHANNEL = 'void-channel-universalAutomation';

// ── Section 6 & 8: Studio Navigation & Complete Visual Node System ─────────────────────

export type UaepStudioSection =
	| 'overview'
	| 'canvas'
	| 'templates'
	| 'executions'
	| 'ai_agents'
	| 'connectors'
	| 'credentials'
	| 'triggers'
	| 'testing'
	| 'monitoring'
	| 'deployment'
	| 'embedded'
	| 'security';

export type UaepNodeCategory = 'trigger' | 'action' | 'logic' | 'data' | 'developer' | 'ai';

export type UaepWorkflowLifecycleStatus =
	| 'draft'
	| 'validated'
	| 'tested'
	| 'published'
	| 'active'
	| 'paused'
	| 'archived';

export interface UaepRetryPolicy {
	readonly maxAttempts: number;
	readonly initialDelayMs: number;
	readonly backoffMultiplier: number;
	readonly maxDelayMs: number;
}

export interface UaepNodeTypeSpec {
	readonly type: string;
	readonly label: string;
	readonly category: UaepNodeCategory;
	readonly description: string;
	readonly inputs: readonly string[];
	readonly outputs: readonly string[];
	readonly defaultConfig: Readonly<Record<string, unknown>>;
	readonly requiresCredential?: boolean;
	readonly sensitiveAction?: boolean;
	readonly version: string;
}

export interface UaepWorkflowNode {
	readonly id: string;
	readonly type: string;
	readonly category: UaepNodeCategory;
	readonly label: string;
	readonly description?: string;
	readonly position: { readonly x: number; readonly y: number };
	readonly config: Readonly<Record<string, unknown>>;
	readonly credentialRef?: string;
	readonly retryPolicy?: UaepRetryPolicy;
	readonly timeoutMs?: number;
	readonly idempotencyKeyExpr?: string;
	readonly breakpoint?: boolean;
	readonly disabled?: boolean;
}

export interface UaepWorkflowEdge {
	readonly id: string;
	readonly sourceNodeId: string;
	readonly sourcePort?: string; // 'default' | 'true' | 'false' | 'error' | branch name
	readonly targetNodeId: string;
	readonly targetPort?: string;
	readonly conditionExpr?: string;
}

export interface UaepWorkflowVersion {
	readonly version: number;
	readonly savedAtMs: number;
	readonly summary: string;
	readonly nodeCount: number;
	readonly edgeCount: number;
	readonly hash: string;
}

export interface UaepWorkflowDefinition {
	readonly id: string;
	readonly tenantId: string;
	readonly name: string;
	readonly description: string;
	readonly version: number;
	readonly status: UaepWorkflowLifecycleStatus;
	readonly executionModel: 'interpreted' | 'generated_code';
	readonly nodes: readonly UaepWorkflowNode[];
	readonly edges: readonly UaepWorkflowEdge[];
	readonly environment: 'development' | 'testing' | 'staging' | 'production';
	readonly tags: readonly string[];
	readonly versionHistory: readonly UaepWorkflowVersion[];
	readonly createdAtMs: number;
	readonly updatedAtMs: number;
}

// ── Section 9: Visual-to-Code Compiler & Bidirectional Sync ────────────────────────────

export interface UaepCompilerDiagnostic {
	readonly code: string;
	readonly severity: 'error' | 'warning' | 'info';
	readonly nodeId?: string;
	readonly message: string;
	readonly suggestedFix?: string;
}

export type UaepCodegenTarget = 'typescript' | 'javascript' | 'python';

export interface UaepCompileReport {
	readonly workflowId: string;
	readonly workflowVersion: number;
	readonly compiledAtMs: number;
	readonly valid: boolean;
	readonly executionOrder: readonly string[];
	readonly diagnostics: readonly UaepCompilerDiagnostic[];
	readonly requiredCredentials: readonly string[];
	readonly securityWarnings: readonly string[];
	readonly targetLanguage: UaepCodegenTarget;
	readonly generatedFiles: Readonly<Record<string, string>>;
	readonly irHash: string;
	readonly summary: string;
}

export interface UaepCodeSyncReport {
	readonly inSync: boolean;
	readonly expectedIrHash: string;
	readonly actualFileHash?: string;
	readonly manualModificationsDetected: boolean;
	readonly conflicts: readonly string[];
	readonly message: string;
}

// ── Section 12 & 20: Durable Execution Runtime, Recovery & Step Debugging ──────────────

export type UaepExecutionStatus =
	| 'queued'
	| 'running'
	| 'paused_breakpoint'
	| 'waiting_approval'
	| 'interrupted'
	| 'completed'
	| 'failed'
	| 'cancelled';

export interface UaepStepExecutionRecord {
	readonly nodeId: string;
	readonly nodeType: string;
	readonly label: string;
	readonly status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'waiting_approval' | 'paused_breakpoint';
	readonly attempts: number;
	readonly startedAtMs: number;
	readonly finishedAtMs?: number;
	readonly durationMs?: number;
	readonly input: unknown;
	readonly output?: unknown;
	readonly error?: string;
	readonly idempotencyKey?: string;
	readonly idempotencyHit?: boolean;
}

export interface UaepExecutionRecord {
	readonly executionId: string;
	readonly workflowId: string;
	readonly workflowName: string;
	readonly workflowVersion: number;
	readonly tenantId: string;
	readonly correlationId: string;
	readonly triggerKind: string;
	readonly status: UaepExecutionStatus;
	readonly startedAtMs: number;
	readonly updatedAtMs: number;
	readonly finishedAtMs?: number;
	readonly currentNodeId?: string;
	readonly remainingNodeIds: readonly string[];
	readonly steps: readonly UaepStepExecutionRecord[];
	readonly contextData: Readonly<Record<string, unknown>>;
	readonly logs: readonly { timestampMs: number; level: 'info' | 'warn' | 'error'; nodeId?: string; message: string }[];
	readonly aiTokensUsed: number;
	readonly error?: string;
}

// ── Section 14, 18, 21: Connectors, Multi-Tenant Vault & Audit Log ─────────────────────

export interface UaepConnectorSpec {
	readonly id: string;
	readonly name: string;
	readonly category: 'communication' | 'business' | 'developer' | 'cloud' | 'database' | 'ai' | 'protocol' | 'iot';
	readonly version: string;
	readonly authType: 'none' | 'api_key' | 'oauth2' | 'bearer' | 'connection_string' | 'basic';
	readonly operations: readonly string[];
	readonly description: string;
	readonly officialDocsUrl: string;
	readonly supportsSandbox: boolean;
}

export interface UaepTenantCredentialMeta {
	readonly id: string;
	readonly tenantId: string;
	readonly name: string;
	readonly provider: string;
	readonly envKey: string;
	readonly maskedPreview: string;
	readonly createdAtMs: number;
	readonly updatedAtMs: number;
}

export interface UaepAuditLogEntry {
	readonly id: string;
	readonly timestampMs: number;
	readonly tenantId: string;
	readonly actor: string;
	readonly action: string;
	readonly resourceType: 'workflow' | 'execution' | 'credential' | 'deployment' | 'security';
	readonly resourceId: string;
	readonly outcome: 'allowed' | 'denied' | 'error';
	readonly detail: string;
	readonly prevHash: string;
	readonly entryHash: string;
}

// ── Section 15, 16, 17, 22, 30: Deployment, Embedded Platform & Operations ─────────────

export type UaepDeploymentTarget =
	| 'local_standalone'
	| 'docker_compose'
	| 'serverless_cloudflare'
	| 'free_cloud_render'
	| 'vps_linux'
	| 'private_cloud_onprem'
	| 'air_gapped_regulated';

export interface UaepHostingOptionAssessment {
	readonly target: UaepDeploymentTarget;
	readonly label: string;
	readonly pricingClass: 'free_local' | 'free_tier_limited' | 'low_cost_vps' | 'enterprise_self_hosted';
	readonly supportsPermanentWorkers: boolean;
	readonly supportsAirGapped: boolean;
	readonly compatible: boolean;
	readonly caveats: readonly string[];
	readonly recommendedFor: string;
}

export interface UaepPortablePackageResult {
	readonly outputDir: string;
	readonly workflowId: string;
	readonly target: UaepDeploymentTarget;
	readonly filesWritten: readonly string[];
	readonly zeroSecretsVerified: boolean;
	readonly startCommand: string;
	readonly summary: string;
}

export interface UaepEmbeddedPlatformResult {
	readonly outputDir: string;
	readonly appName: string;
	readonly multiTenant: boolean;
	readonly filesWritten: readonly string[];
	readonly startCommand: string;
	readonly testCommand: string;
	readonly summary: string;
}

export interface UaepActivityEvent {
	readonly id: string;
	readonly sequence: number;
	readonly timestampMs: number;
	readonly severity: 'info' | 'success' | 'warning' | 'error';
	readonly category: 'workflow' | 'compiler' | 'execution' | 'security' | 'deployment' | 'embedded';
	readonly message: string;
}

export interface UaepOperationsSnapshot {
	readonly workspaceRoot: string;
	readonly activeTenantId: string;
	readonly totalWorkflows: number;
	readonly activeWorkflows: number;
	readonly totalExecutions: number;
	readonly completedExecutions: number;
	readonly failedExecutions: number;
	readonly pausedOrWaitingExecutions: number;
	readonly deadLetterCount: number;
	readonly workerHealth: { readonly status: 'healthy' | 'degraded'; readonly activeWorkers: number; readonly persistenceMode: 'file_durable_json' };
	readonly totalAiTokensUsed: number;
	readonly workflows: readonly UaepWorkflowDefinition[];
	readonly recentExecutions: readonly UaepExecutionRecord[];
	readonly credentials: readonly UaepTenantCredentialMeta[];
	readonly recentAuditLogs: readonly UaepAuditLogEntry[];
	readonly recentEvents: readonly UaepActivityEvent[];
	readonly updatedAtMs: number;
}

// ── Section 38: Automation Studio Global Settings ──────────────────────────────────────

export interface UaepEngineSettings {
	readonly defaultExecutionModel: 'interpreted' | 'generated_code';
	readonly defaultCodegenTarget: UaepCodegenTarget;
	readonly defaultRetryAttempts: number;
	readonly defaultNodeTimeoutMs: number;
	readonly enforceSandboxedCodeNodes: boolean;
	readonly enforceTenantIsolation: boolean;
	readonly enableTamperEvidentAuditLogs: boolean;
	readonly requireHumanApprovalForSensitiveAiActions: boolean;
	readonly preventSecretsInExports: boolean;
}

export const DEFAULT_UAEP_ENGINE_SETTINGS: UaepEngineSettings = {
	defaultExecutionModel: 'interpreted',
	defaultCodegenTarget: 'typescript',
	defaultRetryAttempts: 3,
	defaultNodeTimeoutMs: 15_000,
	enforceSandboxedCodeNodes: true,
	enforceTenantIsolation: true,
	enableTamperEvidentAuditLogs: true,
	requireHumanApprovalForSensitiveAiActions: true,
	preventSecretsInExports: true,
};

// ── Main-Process IPC Contract ──────────────────────────────────────────────────────────

export interface IKodiaUniversalAutomationMainService {
	readonly _serviceBrand: undefined;
	readonly onDidEmitEvent: Event<UaepActivityEvent>;
	readonly onDidChangeSnapshot: Event<UaepOperationsSnapshot>;

	getSnapshot(workspaceRoot: string, tenantId?: string): Promise<UaepOperationsSnapshot>;
	getNodeLibrary(): Promise<readonly UaepNodeTypeSpec[]>;
	getConnectorCatalog(): Promise<readonly UaepConnectorSpec[]>;
	getWorkflowTemplates(): Promise<readonly UaepWorkflowDefinition[]>;
	assessDeploymentTargets(workspaceRoot: string, workflowId?: string): Promise<readonly UaepHostingOptionAssessment[]>;

	saveWorkflow(workspaceRoot: string, workflow: Omit<UaepWorkflowDefinition, 'id' | 'version' | 'versionHistory' | 'createdAtMs' | 'updatedAtMs'> & { id?: string; versionSummary?: string }): Promise<UaepWorkflowDefinition>;
	deleteWorkflow(workspaceRoot: string, workflowId: string, tenantId: string): Promise<{ deleted: boolean; message: string }>;
	generateWorkflowFromPrompt(workspaceRoot: string, req: { prompt: string; tenantId?: string; name?: string }): Promise<{ workflow: UaepWorkflowDefinition; compileReport: UaepCompileReport }>;
	modifyWorkflowFromPrompt(workspaceRoot: string, req: { workflowId: string; tenantId?: string; instruction: string }): Promise<{ workflow: UaepWorkflowDefinition; compileReport: UaepCompileReport; changeSummary: string }>;

	compileWorkflow(workspaceRoot: string, req: { workflowId: string; tenantId?: string; targetLanguage?: UaepCodegenTarget; writeToDir?: string }): Promise<UaepCompileReport>;
	checkWorkflowCodeSync(workspaceRoot: string, req: { workflowId: string; tenantId?: string; generatedFilePath: string }): Promise<UaepCodeSyncReport>;

	executeWorkflow(workspaceRoot: string, req: { workflowId: string; tenantId?: string; triggerInput?: Record<string, unknown>; triggerKind?: string; stopAtBreakpoints?: boolean }): Promise<UaepExecutionRecord>;
	testSingleNode(workspaceRoot: string, req: { workflowId: string; nodeId: string; tenantId?: string; sampleInput?: Record<string, unknown> }): Promise<UaepStepExecutionRecord>;
	interruptExecution(workspaceRoot: string, executionId: string, tenantId?: string): Promise<UaepExecutionRecord>;
	resumeExecution(workspaceRoot: string, req: { executionId: string; tenantId?: string; approvalGranted?: boolean; overrideInput?: Record<string, unknown> }): Promise<UaepExecutionRecord>;

	saveTenantCredential(workspaceRoot: string, req: { tenantId: string; name: string; provider: string; envKey: string; secretValue: string }): Promise<UaepTenantCredentialMeta>;
	verifyTenantIsolation(workspaceRoot: string, req: { requestingTenantId: string; targetWorkflowId?: string; targetCredentialId?: string }): Promise<{ allowed: boolean; reason: string }>;

	exportPortablePackage(workspaceRoot: string, req: { workflowId: string; tenantId?: string; target: UaepDeploymentTarget; outputDir?: string }): Promise<UaepPortablePackageResult>;
	generateEmbeddedPlatform(workspaceRoot: string, req: { appName: string; outputDir?: string; multiTenant?: boolean; brandingColor?: string }): Promise<UaepEmbeddedPlatformResult>;
}

export const IKodiaUniversalAutomationMainService = createDecorator<IKodiaUniversalAutomationMainService>('kodiaUniversalAutomationMainService');
