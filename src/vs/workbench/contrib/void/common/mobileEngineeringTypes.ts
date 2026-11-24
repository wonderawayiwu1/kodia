/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const KODIA_MOBILE_CHANNEL = 'void-channel-mobileEngineering';

export type MobileStudioSection =
	| 'overview'
	| 'architecture'
	| 'devices'
	| 'build'
	| 'security'
	| 'release';

export type MobileFrameworkId =
	| 'react-native-expo'
	| 'react-native-cli'
	| 'flutter'
	| 'android-kotlin'
	| 'ios-swift'
	| 'kotlin-multiplatform'
	| 'dotnet-maui'
	| 'ionic-capacitor'
	| 'pwa'
	| 'custom';

export type MobileTargetPlatform = 'android' | 'ios' | 'both';

export type MobileAppCategory =
	| 'general'
	| 'ai-powered'
	| 'enterprise'
	| 'ecommerce'
	| 'fintech'
	| 'social'
	| 'on-demand'
	| 'healthcare'
	| 'education'
	| 'iot-companion'
	| 'offline-first'
	| 'game'
	| 'custom';

export type MobileBackendStack =
	| 'none'
	| 'node-express'
	| 'node-nestjs'
	| 'node-fastify'
	| 'python-fastapi'
	| 'python-django'
	| 'go-gin'
	| 'rust-axum'
	| 'java-spring'
	| 'php-laravel'
	| 'dotnet-aspnet'
	| 'supabase'
	| 'firebase'
	| 'custom';

export type MobileDatabaseId =
	| 'none'
	| 'postgresql'
	| 'mysql'
	| 'sqlite'
	| 'mongodb'
	| 'redis'
	| 'firestore'
	| 'supabase';

export type MobileArchitecturePattern =
	| 'clean-architecture'
	| 'mvvm'
	| 'mvi'
	| 'feature-based'
	| 'modular-monolith'
	| 'offline-first-cqrs'
	| 'redux-unidirectional'
	| 'hexagonal';

export type VerificationStatus =
	| 'verified'
	| 'failed'
	| 'partial'
	| 'not_tested'
	| 'blocked_by_env'
	| 'requires_external_creds_or_hardware';

export interface MobileToolchainItem {
	readonly id: string;
	readonly name: string;
	readonly category: 'android' | 'ios' | 'cross-platform' | 'general';
	readonly installed: boolean;
	readonly version?: string;
	readonly path?: string;
	readonly note?: string;
}

export interface MobileDiscoveredDevice {
	readonly id: string;
	readonly name: string;
	readonly platform: 'android' | 'ios';
	readonly kind: 'emulator' | 'simulator' | 'physical';
	readonly state: 'online' | 'offline' | 'booted' | 'shutdown' | 'unauthorized';
	readonly osVersion?: string;
	readonly architecture?: string;
}

export interface MobileEnvironmentProbeReport {
	readonly probedAt: string;
	readonly hostPlatform: string;
	readonly hostArch: string;
	readonly toolchains: readonly MobileToolchainItem[];
	readonly androidAvds: readonly string[];
	readonly devices: readonly MobileDiscoveredDevice[];
	readonly capabilities: {
		readonly canBuildReactNativeJS: boolean;
		readonly canBuildAndroidNative: boolean;
		readonly canBuildFlutter: boolean;
		readonly canBuildIosNative: boolean;
		readonly canRunAndroidEmulator: boolean;
		readonly canRunIosSimulator: boolean;
		readonly canRunPythonBackend: boolean;
		readonly canRunNodeBackend: boolean;
	};
	readonly missingPrerequisites: readonly string[];
	readonly platformLimitations: readonly string[];
}

export interface MobileProjectIntelligenceReport {
	readonly analyzedAt: string;
	readonly workspaceRoot: string;
	readonly detected: boolean;
	readonly framework: MobileFrameworkId | 'unknown';
	readonly frameworkLabel: string;
	readonly languages: readonly string[];
	readonly targets: readonly ('android' | 'ios' | 'web')[];
	readonly architectureStyle: string;
	readonly entryPoints: readonly string[];
	readonly screens: readonly string[];
	readonly navigationLibraries: readonly string[];
	readonly stateManagement: readonly string[];
	readonly apiClients: readonly string[];
	readonly localDatabases: readonly string[];
	readonly nativeModules: readonly string[];
	readonly permissionsDeclared: readonly string[];
	readonly backendDetected?: {
		readonly path: string;
		readonly stack: string;
	};
	readonly testFiles: readonly string[];
	readonly buildConfigs: readonly string[];
	readonly signingConfigs: readonly string[];
	readonly defects: readonly {
		readonly severity: 'high' | 'medium' | 'low';
		readonly file: string;
		readonly message: string;
	}[];
	readonly totalFilesScanned: number;
}

export interface MobileArchitectureRequest {
	readonly objective: string;
	readonly platform?: MobileTargetPlatform;
	readonly framework?: MobileFrameworkId;
	readonly appCategory?: MobileAppCategory;
	readonly backend?: MobileBackendStack;
	readonly database?: MobileDatabaseId;
	readonly includeAuth?: boolean;
	readonly includeAI?: boolean;
	readonly includeOffline?: boolean;
	readonly includeRealtime?: boolean;
	readonly deviceCapabilities?: readonly string[];
}

export interface MobileArchitectureDesignReport {
	readonly generatedAt: string;
	readonly objective: string;
	readonly engineMode: 'mobile-only' | 'mobile-plus-universal' | 'unified-three-engine';
	readonly enginesEngaged: readonly ('Universal Software Engineering Engine' | 'Mobile Application Engineering Engine' | 'AI Engineering Engine')[];
	readonly targetPlatform: MobileTargetPlatform;
	readonly framework: MobileFrameworkId;
	readonly frameworkRationale: string;
	readonly appCategory: MobileAppCategory;
	readonly architecturePattern: MobileArchitecturePattern;
	readonly backendStack: MobileBackendStack;
	readonly backendRationale: string;
	readonly database: MobileDatabaseId;
	readonly stateManagement: string;
	readonly navigationStrategy: string;
	readonly uiDesignSystem: {
		readonly androidDesign: string;
		readonly iosDesign: string;
		readonly tokensStrategy: string;
		readonly keyComponents: readonly string[];
	};
	readonly offlineStrategy: {
		readonly enabled: boolean;
		readonly localStore: string;
		readonly syncProtocol: string;
		readonly conflictResolution: string;
	};
	readonly aiStrategy: {
		readonly enabled: boolean;
		readonly mode: 'none' | 'cloud-proxy' | 'on-device' | 'hybrid';
		readonly runtimes: readonly string[];
		readonly securityRule: string;
	};
	readonly deviceCapabilities: readonly string[];
	readonly screens: readonly { readonly name: string; readonly route: string; readonly purpose: string }[];
	readonly apiEndpoints: readonly { readonly method: string; readonly path: string; readonly purpose: string }[];
	readonly specialistAgents: readonly string[];
	readonly adrs: readonly { readonly title: string; readonly decision: string; readonly tradeOff: string }[];
	readonly mermaidDiagram: string;
	readonly executionPhases: readonly string[];
}

export interface MobileScaffoldRequest {
	readonly projectName: string;
	readonly targetDir?: string;
	readonly objective?: string;
	readonly framework: MobileFrameworkId;
	readonly platform?: MobileTargetPlatform;
	readonly appCategory?: MobileAppCategory;
	readonly backend?: MobileBackendStack;
	readonly database?: MobileDatabaseId;
	readonly includeAI?: boolean;
	readonly includeOffline?: boolean;
	readonly includeAuth?: boolean;
	readonly overwrite?: boolean;
}

export interface MobileScaffoldResult {
	readonly createdAt: string;
	readonly projectDir: string;
	readonly framework: MobileFrameworkId;
	readonly backendStack: MobileBackendStack;
	readonly createdFiles: readonly string[];
	readonly skippedFiles: readonly string[];
	readonly nextSteps: readonly string[];
}

export type MobileDeviceActionType =
	| 'list_devices'
	| 'start_emulator'
	| 'install_app'
	| 'launch_app'
	| 'stop_app'
	| 'screenshot'
	| 'logcat'
	| 'diagnostics';

export interface MobileDeviceActionRequest {
	readonly action: MobileDeviceActionType;
	readonly deviceId?: string;
	readonly avdName?: string;
	readonly packageName?: string;
	readonly artifactPath?: string;
	readonly lines?: number;
}

export interface MobileDeviceActionResult {
	readonly action: MobileDeviceActionType;
	readonly status: VerificationStatus;
	readonly exitCode: number | null;
	readonly durationMs: number;
	readonly output: string;
	readonly error?: string;
	readonly devices?: readonly MobileDiscoveredDevice[];
	readonly screenshotPath?: string;
}

export interface MobileBuildTestRequest {
	readonly mode: 'test' | 'build' | 'typecheck' | 'lint' | 'backend_test';
	readonly targetDir?: string;
	readonly framework?: MobileFrameworkId;
	readonly platform?: 'android' | 'ios' | 'all';
	readonly customCommand?: string;
	readonly timeoutMs?: number;
}

export interface MobileBuildTestResult {
	readonly executedAt: string;
	readonly mode: MobileBuildTestRequest['mode'];
	readonly status: VerificationStatus;
	readonly command: string;
	readonly cwd: string;
	readonly exitCode: number | null;
	readonly durationMs: number;
	readonly stdout: string;
	readonly stderr: string;
	readonly summary: string;
	readonly blockingReason?: string;
}

export interface MobileSecurityFinding {
	readonly id: string;
	readonly masvsCategory: string;
	readonly severity: 'critical' | 'high' | 'medium' | 'low';
	readonly file: string;
	readonly line: number;
	readonly title: string;
	readonly evidence: string;
	readonly remediation: string;
}

export interface MobileSecurityAuditReport {
	readonly auditedAt: string;
	readonly filesScanned: number;
	readonly score: number;
	readonly criticalCount: number;
	readonly highCount: number;
	readonly mediumCount: number;
	readonly lowCount: number;
	readonly findings: readonly MobileSecurityFinding[];
	readonly passedChecks: readonly string[];
}

export interface MobilePerformanceFinding {
	readonly id: string;
	readonly category: 'startup' | 'rendering' | 'memory' | 'network' | 'bundle' | 'storage' | 'ai-latency';
	readonly severity: 'high' | 'medium' | 'low';
	readonly file: string;
	readonly line: number;
	readonly title: string;
	readonly recommendation: string;
}

export interface MobilePerformanceAuditReport {
	readonly auditedAt: string;
	readonly filesScanned: number;
	readonly score: number;
	readonly findings: readonly MobilePerformanceFinding[];
	readonly recommendations: readonly string[];
}

export interface MobileReadinessDimension {
	readonly dimension: string;
	readonly status: VerificationStatus;
	readonly evidence: string;
	readonly actionRequired?: string;
}

export interface MobileProductionReadinessReport {
	readonly evaluatedAt: string;
	readonly framework: MobileFrameworkId | 'unknown';
	readonly overallStatus: 'ready' | 'conditionally_ready' | 'not_ready';
	readonly readinessScore: number;
	readonly dimensions: readonly MobileReadinessDimension[];
	readonly androidStoreChecklist: readonly { readonly item: string; readonly status: VerificationStatus; readonly note: string }[];
	readonly iosStoreChecklist: readonly { readonly item: string; readonly status: VerificationStatus; readonly note: string }[];
	readonly blockingIssues: readonly string[];
	readonly environmentalLimitations: readonly string[];
}

export interface MobileCapabilityEntry {
	readonly id: string;
	readonly name: string;
	readonly category: 'framework' | 'ai-runtime' | 'testing' | 'device-api' | 'build-release' | 'architecture';
	readonly maturity: 'production-proven' | 'emerging' | 'experimental';
	readonly license: string;
	readonly platforms: readonly string[];
	readonly summary: string;
	readonly recommendedWhen: string;
}

export interface MobileLiveEvent {
	readonly eventId: string;
	readonly seq: number;
	readonly timestamp: string;
	readonly kind: 'probe' | 'inspect' | 'architecture' | 'scaffold' | 'device' | 'build' | 'test' | 'security' | 'performance' | 'readiness' | 'info' | 'error';
	readonly title: string;
	readonly detail: string;
}

export interface MobileWorkspaceSnapshot {
	readonly workspaceRoot: string;
	readonly environment?: MobileEnvironmentProbeReport;
	readonly projectIntel?: MobileProjectIntelligenceReport;
	readonly architecture?: MobileArchitectureDesignReport;
	readonly lastScaffold?: MobileScaffoldResult;
	readonly lastBuildTest?: MobileBuildTestResult;
	readonly securityAudit?: MobileSecurityAuditReport;
	readonly performanceAudit?: MobilePerformanceAuditReport;
	readonly readinessReport?: MobileProductionReadinessReport;
}

export const IKodiaMobileMainService = createDecorator<IKodiaMobileMainService>('kodiaMobileMainService');

export interface IKodiaMobileMainService {
	readonly _serviceBrand: undefined;
	readonly onDidEmitEvent: Event<MobileLiveEvent>;

	probeEnvironment(workspaceRoot: string): Promise<MobileEnvironmentProbeReport>;
	inspectWorkspace(workspaceRoot: string): Promise<MobileProjectIntelligenceReport>;
	designArchitecture(workspaceRoot: string, req: MobileArchitectureRequest): Promise<MobileArchitectureDesignReport>;
	scaffoldProject(workspaceRoot: string, req: MobileScaffoldRequest): Promise<MobileScaffoldResult>;
	runDeviceAction(workspaceRoot: string, req: MobileDeviceActionRequest): Promise<MobileDeviceActionResult>;
	runBuildOrTest(workspaceRoot: string, req: MobileBuildTestRequest): Promise<MobileBuildTestResult>;
	runSecurityAudit(workspaceRoot: string): Promise<MobileSecurityAuditReport>;
	runPerformanceAudit(workspaceRoot: string): Promise<MobilePerformanceAuditReport>;
	assessProductionReadiness(workspaceRoot: string): Promise<MobileProductionReadinessReport>;
	loadWorkspaceSnapshot(workspaceRoot: string): Promise<MobileWorkspaceSnapshot>;
	getRecentEvents(limit?: number): Promise<MobileLiveEvent[]>;
}
