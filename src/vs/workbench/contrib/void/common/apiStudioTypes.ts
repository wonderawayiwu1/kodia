/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const KODIA_API_STUDIO_CHANNEL = 'void-channel-api-studio';

// ============================================================================
// Protocols, Frameworks & Navigation Sections
// ============================================================================

export type ApiProtocol = 'http' | 'graphql' | 'grpc' | 'websocket' | 'sse' | 'soap';

export type ApiHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export type ApiFrameworkId =
	| 'express'
	| 'nestjs'
	| 'fastify'
	| 'hono'
	| 'koa'
	| 'nextjs'
	| 'fastapi'
	| 'django'
	| 'flask'
	| 'spring-boot'
	| 'aspnet-core'
	| 'laravel'
	| 'gin'
	| 'fiber'
	| 'echo'
	| 'chi'
	| 'go-std'
	| 'axum'
	| 'actix-web'
	| 'rails'
	| 'phoenix'
	| 'generic';

export type ApiStudioSection =
	| 'overview'
	| 'requests'
	| 'collections'
	| 'explorer'
	| 'specs'
	| 'graphql'
	| 'grpc'
	| 'websockets'
	| 'environments'
	| 'auth'
	| 'suites'
	| 'runner'
	| 'performance'
	| 'security'
	| 'mocks'
	| 'monitors'
	| 'topology'
	| 'history'
	| 'readiness';

export type ApiStudioLayoutPreset =
	| 'request-builder'
	| 'live-runner'
	| 'performance'
	| 'security'
	| 'enterprise-topology';

export interface ApiStudioSettings {
	readonly autoOpenStudioOnApiTasks: boolean;
	readonly defaultTimeoutMs: number;
	readonly followRedirects: boolean;
	readonly maxResponseSizeMb: number;
	readonly enableScriptSandbox: boolean;
	readonly scriptTimeoutMs: number;
	readonly protectProductionEnvironments: boolean;
	readonly redactSecretsInHistory: boolean;
	readonly maxHistoryEntries: number;
	readonly defaultLoadConcurrency: number;
	readonly allowLiveSecurityProbesOnLocalhost: boolean;
}

export const DEFAULT_API_STUDIO_SETTINGS: ApiStudioSettings = {
	autoOpenStudioOnApiTasks: true,
	defaultTimeoutMs: 15_000,
	followRedirects: true,
	maxResponseSizeMb: 10,
	enableScriptSandbox: true,
	scriptTimeoutMs: 2_000,
	protectProductionEnvironments: true,
	redactSecretsInHistory: true,
	maxHistoryEntries: 200,
	defaultLoadConcurrency: 10,
	allowLiveSecurityProbesOnLocalhost: true,
};

// ============================================================================
// Request, Auth, Body, Scripting & Assertions
// ============================================================================

export interface ApiKeyValuePair {
	readonly id: string;
	readonly key: string;
	readonly value: string;
	readonly description?: string;
	readonly enabled: boolean;
	readonly secret?: boolean;
}

export type ApiAuthConfig =
	| { readonly type: 'none' }
	| { readonly type: 'basic'; readonly username: string; readonly password: string }
	| { readonly type: 'bearer'; readonly token: string; readonly prefix?: string }
	| { readonly type: 'api-key'; readonly key: string; readonly value: string; readonly addTo: 'header' | 'query' }
	| {
		readonly type: 'oauth2';
		readonly grantType: 'client_credentials' | 'authorization_code' | 'pkce' | 'device_code';
		readonly tokenUrl?: string;
		readonly clientId?: string;
		readonly clientSecret?: string;
		readonly scope?: string;
		readonly accessToken?: string;
		readonly expiresAt?: string;
	}
	| { readonly type: 'custom'; readonly headerName: string; readonly headerValue: string };

export type ApiBodyMode = 'none' | 'json' | 'xml' | 'text' | 'html' | 'form-urlencoded' | 'multipart' | 'binary' | 'graphql' | 'soap';

export interface ApiMultipartPart {
	readonly id: string;
	readonly key: string;
	readonly kind: 'text' | 'file';
	readonly value: string;
	readonly filePath?: string;
	readonly contentType?: string;
	readonly enabled: boolean;
}

export interface ApiRequestBody {
	readonly mode: ApiBodyMode;
	readonly raw?: string;
	readonly formFields?: readonly ApiKeyValuePair[];
	readonly multipartParts?: readonly ApiMultipartPart[];
	readonly binaryFilePath?: string;
	readonly graphqlQuery?: string;
	readonly graphqlVariables?: string;
	readonly graphqlOperationName?: string;
	readonly soapAction?: string;
}

export type ApiAssertionKind =
	| 'status_equals'
	| 'status_range'
	| 'header_exists'
	| 'header_contains'
	| 'body_contains'
	| 'body_regex'
	| 'jsonpath_equals'
	| 'jsonpath_exists'
	| 'jsonpath_type'
	| 'jsonpath_length_gte'
	| 'response_time_lt'
	| 'size_lt'
	| 'cookie_exists'
	| 'json_schema_keys';

export interface ApiAssertionSpec {
	readonly id: string;
	readonly name?: string;
	readonly kind: ApiAssertionKind;
	readonly target?: string;
	readonly expected?: string;
	readonly enabled?: boolean;
}

export interface ApiAssertionResult {
	readonly id: string;
	readonly name: string;
	readonly kind: ApiAssertionKind;
	readonly passed: boolean;
	readonly expected: string;
	readonly actual: string;
	readonly message: string;
}

export interface ApiRequestSpec {
	readonly id: string;
	readonly name: string;
	readonly protocol: ApiProtocol;
	readonly method: ApiHttpMethod;
	readonly url: string;
	readonly description?: string;
	readonly tags?: readonly string[];
	readonly folderPath?: string;
	readonly collectionId?: string;
	readonly params: readonly ApiKeyValuePair[];
	readonly headers: readonly ApiKeyValuePair[];
	readonly auth: ApiAuthConfig;
	readonly body: ApiRequestBody;
	readonly preRequestScript?: string;
	readonly testScript?: string;
	readonly assertions?: readonly ApiAssertionSpec[];
	readonly timeoutMs?: number;
	readonly followRedirects?: boolean;
	readonly extractVariables?: readonly { readonly variableName: string; readonly jsonPath: string }[];
}

export interface ApiTimingBreakdown {
	readonly dnsMs: number | null;
	readonly connectMs: number | null;
	readonly tlsMs: number | null;
	readonly ttfbMs: number | null;
	readonly downloadMs: number | null;
	readonly totalMs: number;
	readonly measuredPhases: boolean;
}

export interface ApiCookieEntry {
	readonly name: string;
	readonly value: string;
	readonly domain?: string;
	readonly path?: string;
	readonly expires?: string;
	readonly httpOnly?: boolean;
	readonly secure?: boolean;
	readonly sameSite?: string;
}

export interface ApiResponseResult {
	readonly requestId: string;
	readonly executionId: string;
	readonly timestamp: string;
	readonly protocol: ApiProtocol;
	readonly method: ApiHttpMethod;
	readonly resolvedUrl: string;
	readonly status: number;
	readonly statusText: string;
	readonly ok: boolean;
	readonly headers: Readonly<Record<string, string>>;
	readonly transmittedHeaders: Readonly<Record<string, string>>;
	readonly cookies: readonly ApiCookieEntry[];
	readonly contentType: string;
	readonly body: string;
	readonly bodyTruncated?: boolean;
	readonly sizeBytes: number;
	readonly timing: ApiTimingBreakdown;
	readonly redirects: readonly { readonly from: string; readonly to: string; readonly status: number }[];
	readonly remoteAddress?: string;
	readonly httpVersion?: string;
	readonly assertionResults: readonly ApiAssertionResult[];
	readonly scriptLogs: readonly string[];
	readonly scriptErrors: readonly string[];
	readonly variableUpdates: Readonly<Record<string, string>>;
	readonly sseEvents?: readonly { readonly id?: string; readonly event?: string; readonly data: string; readonly timestamp: string }[];
	readonly isMock?: boolean;
	readonly error?: string;
}

export interface ApiResponseDiffReport {
	readonly leftLabel: string;
	readonly rightLabel: string;
	readonly statusChanged: boolean;
	readonly leftStatus: number;
	readonly rightStatus: number;
	readonly latencyDeltaMs: number;
	readonly sizeDeltaBytes: number;
	readonly headerDiffs: readonly { readonly key: string; readonly left?: string; readonly right?: string; readonly kind: 'added' | 'removed' | 'changed' }[];
	readonly bodyDiffs: readonly { readonly path: string; readonly left?: string; readonly right?: string; readonly kind: 'added' | 'removed' | 'changed' | 'type_changed' }[];
	readonly identical: boolean;
	readonly summary: string;
}

// ============================================================================
// Collections, Environments, Auth Profiles & History
// ============================================================================

export interface ApiCollection {
	readonly id: string;
	readonly name: string;
	readonly description?: string;
	readonly baseUrl?: string;
	readonly auth?: ApiAuthConfig;
	readonly variables: readonly ApiKeyValuePair[];
	readonly requests: readonly ApiRequestSpec[];
	readonly createdAt: string;
	readonly updatedAt: string;
}

export interface ApiEnvironment {
	readonly id: string;
	readonly name: string;
	readonly kind: 'local' | 'development' | 'testing' | 'staging' | 'production' | 'custom';
	readonly baseUrl?: string;
	readonly isProtected?: boolean;
	readonly variables: readonly ApiKeyValuePair[];
	readonly updatedAt: string;
}

export interface ApiHistoryEntry {
	readonly id: string;
	readonly executionId: string;
	readonly timestamp: string;
	readonly request: ApiRequestSpec;
	readonly response: ApiResponseResult;
	readonly environmentId?: string;
	readonly suiteId?: string;
}

// ============================================================================
// WebSocket & gRPC Sessions
// ============================================================================

export interface ApiWebSocketMessage {
	readonly id: string;
	readonly direction: 'sent' | 'received' | 'system';
	readonly kind: 'text' | 'json' | 'binary' | 'ping' | 'pong' | 'error';
	readonly data: string;
	readonly sizeBytes: number;
	readonly timestamp: string;
}

export interface ApiWebSocketSessionInfo {
	readonly sessionId: string;
	readonly url: string;
	readonly status: 'connecting' | 'open' | 'closed' | 'error';
	readonly handshakeStatus?: number;
	readonly handshakeHeaders?: Readonly<Record<string, string>>;
	readonly messages: readonly ApiWebSocketMessage[];
	readonly connectedAt: string;
	readonly closedAt?: string;
	readonly error?: string;
}

export interface ApiGrpcMethodInfo {
	readonly serviceName: string;
	readonly methodName: string;
	readonly requestType: string;
	readonly responseType: string;
	readonly streaming: 'unary' | 'server_streaming' | 'client_streaming' | 'bidirectional';
	readonly protoFile: string;
}

// ============================================================================
// Discovery, Project Intelligence & Multi-Service Runtime Manager
// ============================================================================

export interface DiscoveredApiRoute {
	readonly id: string;
	readonly method: ApiHttpMethod | 'WS' | 'GRAPHQL' | 'GRPC' | 'ALL';
	readonly path: string;
	readonly protocol: ApiProtocol;
	readonly framework: ApiFrameworkId;
	readonly filePath: string;
	readonly line: number;
	readonly handlerName?: string;
	readonly serviceName?: string;
	readonly requiresAuth?: boolean;
	readonly middleware?: readonly string[];
	readonly queryParams?: readonly string[];
	readonly pathParams?: readonly string[];
}

export interface DiscoveredApiSpecFile {
	readonly path: string;
	readonly kind: 'openapi' | 'swagger' | 'graphql' | 'protobuf' | 'asyncapi' | 'wsdl';
	readonly title?: string;
	readonly version?: string;
	readonly operationCount: number;
}

export interface DiscoveredApiService {
	readonly id: string;
	readonly name: string;
	readonly rootPath: string;
	readonly language: string;
	readonly framework: ApiFrameworkId;
	readonly startCommand?: string;
	readonly defaultPort?: number;
	readonly healthPath?: string;
	readonly routeCount: number;
	readonly dependencies: readonly string[];
}

export interface ApiProjectDiscoveryReport {
	readonly scannedAt: string;
	readonly workspaceRoot: string;
	readonly filesScanned: number;
	readonly frameworks: readonly ApiFrameworkId[];
	readonly languages: readonly string[];
	readonly protocols: readonly ApiProtocol[];
	readonly services: readonly DiscoveredApiService[];
	readonly routes: readonly DiscoveredApiRoute[];
	readonly specFiles: readonly DiscoveredApiSpecFile[];
	readonly grpcMethods: readonly ApiGrpcMethodInfo[];
	readonly authMechanisms: readonly string[];
	readonly databases: readonly string[];
	readonly queuesAndCaches: readonly string[];
	readonly envVariables: readonly string[];
	readonly mermaidTopology: string;
	readonly summary: string;
}

export interface ApiManagedRuntimeInfo {
	readonly runtimeId: string;
	readonly name: string;
	readonly command: string;
	readonly cwd: string;
	readonly pid?: number;
	readonly port?: number;
	readonly baseUrl?: string;
	readonly healthUrl?: string;
	readonly status: 'starting' | 'ready' | 'unhealthy' | 'stopped' | 'failed';
	readonly startedAt: string;
	readonly stoppedAt?: string;
	readonly exitCode?: number | null;
	readonly recentLogs: readonly string[];
	readonly error?: string;
}

// ============================================================================
// Automated Test Suites, Performance / Load, Security, Mocks & Monitors
// ============================================================================

export type ApiTestStatus = 'passed' | 'failed' | 'skipped' | 'blocked' | 'timed_out';

export interface ApiTestSuite {
	readonly id: string;
	readonly name: string;
	readonly description?: string;
	readonly environmentId?: string;
	readonly baseUrl?: string;
	readonly requests: readonly ApiRequestSpec[];
	readonly createdAt: string;
	readonly updatedAt: string;
}

export interface ApiTestCaseResult {
	readonly requestId: string;
	readonly name: string;
	readonly method: ApiHttpMethod;
	readonly url: string;
	readonly status: ApiTestStatus;
	readonly httpStatus?: number;
	readonly durationMs: number;
	readonly assertions: readonly ApiAssertionResult[];
	readonly response?: ApiResponseResult;
	readonly failureReason?: string;
	readonly sourceFile?: string;
	readonly sourceLine?: number;
}

export interface ApiTestRunResult {
	readonly runId: string;
	readonly suiteId: string;
	readonly suiteName: string;
	readonly environmentId?: string;
	readonly startedAt: string;
	readonly completedAt: string;
	readonly durationMs: number;
	readonly total: number;
	readonly passed: number;
	readonly failed: number;
	readonly skipped: number;
	readonly blocked: number;
	readonly timedOut: number;
	readonly passRate: number;
	readonly cancelled?: boolean;
	readonly cases: readonly ApiTestCaseResult[];
	readonly summary: string;
}

export interface ApiLoadTestConfig {
	readonly name: string;
	readonly request: ApiRequestSpec;
	readonly virtualUsers: number;
	readonly durationSeconds: number;
	readonly rampUpSeconds?: number;
	readonly thinkTimeMs?: number;
	readonly maxErrorRate?: number;
	readonly p95ThresholdMs?: number;
	readonly environmentId?: string;
	readonly allowNonLocalTarget?: boolean;
}

export interface ApiLoadTimelineBucket {
	readonly second: number;
	readonly rps: number;
	readonly activeVUs: number;
	readonly avgLatencyMs: number;
	readonly p95LatencyMs: number;
	readonly errors: number;
}

export interface ApiLoadTestResult {
	readonly runId: string;
	readonly name: string;
	readonly targetUrl: string;
	readonly method: ApiHttpMethod;
	readonly startedAt: string;
	readonly completedAt: string;
	readonly durationMs: number;
	readonly virtualUsers: number;
	readonly totalRequests: number;
	readonly successfulRequests: number;
	readonly failedRequests: number;
	readonly errorRate: number;
	readonly rps: number;
	readonly throughputBytesPerSec: number;
	readonly latencyMs: {
		readonly min: number;
		readonly avg: number;
		readonly p50: number;
		readonly p90: number;
		readonly p95: number;
		readonly p99: number;
		readonly max: number;
	};
	readonly statusCodes: Readonly<Record<string, number>>;
	readonly timeline: readonly ApiLoadTimelineBucket[];
	readonly generatorSaturated: boolean;
	readonly engine: 'kodia-native-concurrent' | 'k6';
	readonly passedThresholds: boolean;
	readonly thresholdDetails: readonly string[];
	readonly summary: string;
	readonly error?: string;
}

export interface ApiSecurityFinding {
	readonly id: string;
	readonly severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
	readonly confidence: 'confirmed' | 'heuristic';
	readonly category: 'authentication' | 'authorization' | 'headers' | 'cors' | 'injection' | 'secret-exposure' | 'error-leakage' | 'rate-limiting' | 'transport' | 'spec-security';
	readonly title: string;
	readonly endpoint?: string;
	readonly file?: string;
	readonly line?: number;
	readonly evidence: string;
	readonly remediation: string;
}

export interface ApiSecurityReport {
	readonly id: string;
	readonly scannedAt: string;
	readonly score: number;
	readonly targetBaseUrl?: string;
	readonly filesScanned: number;
	readonly liveEndpointsProbed: number;
	readonly criticalCount: number;
	readonly highCount: number;
	readonly findings: readonly ApiSecurityFinding[];
	readonly passedControls: readonly string[];
	readonly summary: string;
}

export interface ApiMockRoute {
	readonly id: string;
	readonly method: ApiHttpMethod | 'ALL';
	readonly path: string;
	readonly status: number;
	readonly headers?: Readonly<Record<string, string>>;
	readonly body: string;
	readonly delayMs?: number;
}

export interface ApiMockServerStatus {
	readonly mockId: string;
	readonly name: string;
	readonly port: number;
	readonly baseUrl: string;
	readonly running: boolean;
	readonly isMock: true;
	readonly routes: readonly ApiMockRoute[];
	readonly requestCount: number;
	readonly recentRequests: readonly { readonly method: string; readonly path: string; readonly status: number; readonly timestamp: string }[];
}

export interface ApiMonitorConfig {
	readonly id: string;
	readonly name: string;
	readonly request: ApiRequestSpec;
	readonly intervalMinutes: number;
	readonly expectedStatus: number;
	readonly maxLatencyMs: number;
	readonly enabled: boolean;
	readonly lastRunAt?: string;
	readonly lastStatus?: 'healthy' | 'degraded' | 'down';
	readonly lastLatencyMs?: number;
	readonly uptimePercent?: number;
}

export type ReadinessStatus = 'passed' | 'failed' | 'blocked' | 'not_tested' | 'requires_review';

export interface ApiReadinessPillar {
	readonly pillar: 'functional' | 'security' | 'performance' | 'reliability' | 'operational' | 'documentation';
	readonly status: ReadinessStatus;
	readonly score: number;
	readonly evidence: readonly string[];
	readonly gaps: readonly string[];
}

export interface ApiProductionReadinessReport {
	readonly generatedAt: string;
	readonly overallStatus: ReadinessStatus;
	readonly overallScore: number;
	readonly pillars: readonly ApiReadinessPillar[];
	readonly blockers: readonly string[];
	readonly recommendations: readonly string[];
	readonly summary: string;
}

export interface ApiSpecDiffReport {
	readonly baseSpec: string;
	readonly targetSpec: string;
	readonly breakingChanges: readonly string[];
	readonly nonBreakingChanges: readonly string[];
	readonly addedEndpoints: readonly string[];
	readonly removedEndpoints: readonly string[];
	readonly summary: string;
}

export interface ApiFailureCorrelationReport {
	readonly requestId: string;
	readonly endpoint: string;
	readonly status: number;
	readonly failedAssertions: readonly string[];
	readonly matchedRoute?: DiscoveredApiRoute;
	readonly matchedLogLines: readonly string[];
	readonly likelyRootCauses: readonly string[];
	readonly repairSteps: readonly string[];
	readonly summary: string;
}

// ============================================================================
// Live Execution Event Contract (Real-Time Main -> Renderer Streaming)
// ============================================================================

export type ApiLiveEventType =
	| 'runtime_starting'
	| 'runtime_ready'
	| 'runtime_failed'
	| 'runtime_log'
	| 'runtime_stopped'
	| 'health_check'
	| 'request_queued'
	| 'request_dispatched'
	| 'connection_established'
	| 'response_headers_received'
	| 'response_completed'
	| 'stream_message'
	| 'assertion_result'
	| 'test_suite_started'
	| 'test_case_completed'
	| 'test_suite_completed'
	| 'load_metric_tick'
	| 'load_completed'
	| 'security_finding'
	| 'mock_request_received'
	| 'execution_error'
	| 'execution_cancelled'
	| 'execution_stopped';

export interface ApiLiveEvent {
	readonly seq: number;
	readonly eventId: string;
	readonly timestamp: string;
	readonly type: ApiLiveEventType;
	readonly executionId: string;
	readonly requestId?: string;
	readonly testRunId?: string;
	readonly runtimeId?: string;
	readonly serviceName?: string;
	readonly environmentId?: string;
	readonly method?: string;
	readonly url?: string;
	readonly status?: number;
	readonly durationMs?: number;
	readonly passed?: boolean;
	readonly message: string;
	readonly payload?: Readonly<Record<string, unknown>>;
}

// ============================================================================
// Main-Process IPC Service Interface
// ============================================================================

export interface ApiStudioWorkspaceSnapshot {
	readonly collections: readonly ApiCollection[];
	readonly environments: readonly ApiEnvironment[];
	readonly activeEnvironmentId: string | null;
	readonly history: readonly ApiHistoryEntry[];
	readonly suites: readonly ApiTestSuite[];
	readonly testRuns: readonly ApiTestRunResult[];
	readonly loadRuns: readonly ApiLoadTestResult[];
	readonly securityReports: readonly ApiSecurityReport[];
	readonly monitors: readonly ApiMonitorConfig[];
	readonly runtimes: readonly ApiManagedRuntimeInfo[];
	readonly mockServers: readonly ApiMockServerStatus[];
	readonly webSockets: readonly ApiWebSocketSessionInfo[];
}

export interface IKodiaApiStudioMainService {
	readonly _serviceBrand: undefined;

	readonly onDidEmitEvent: Event<ApiLiveEvent>;

	loadWorkspaceSnapshot(workspaceRoot: string): Promise<ApiStudioWorkspaceSnapshot>;
	getRecentEvents(limit?: number): Promise<ApiLiveEvent[]>;

	// Requests & Protocols
	executeRequest(workspaceRoot: string, opts: {
		request: ApiRequestSpec;
		environmentId?: string;
		extraVariables?: Record<string, string>;
		allowProtectedEnvironment?: boolean;
		executionId?: string;
		suiteId?: string;
		persistHistory?: boolean;
	}): Promise<ApiResponseResult>;
	cancelExecution(executionId: string): Promise<boolean>;

	// WebSocket
	connectWebSocket(workspaceRoot: string, opts: { url: string; headers?: Record<string, string>; protocols?: string[] }): Promise<ApiWebSocketSessionInfo>;
	sendWebSocketMessage(sessionId: string, data: string, kind?: 'text' | 'json' | 'ping'): Promise<ApiWebSocketSessionInfo>;
	closeWebSocket(sessionId: string): Promise<ApiWebSocketSessionInfo | null>;
	listWebSockets(): Promise<ApiWebSocketSessionInfo[]>;

	// gRPC optional native invocation (grpcurl if installed)
	invokeGrpc(workspaceRoot: string, opts: {
		address: string;
		serviceMethod: string;
		payloadJson: string;
		protoPath?: string;
		plaintext?: boolean;
		metadata?: Record<string, string>;
	}): Promise<{ ok: boolean; output: string; durationMs: number; engine: string; error?: string }>;

	// Runtime Manager
	startRuntime(workspaceRoot: string, opts: {
		name: string;
		command: string;
		cwd?: string;
		port?: number;
		healthUrl?: string;
		env?: Record<string, string>;
		readyTimeoutMs?: number;
	}): Promise<ApiManagedRuntimeInfo>;
	stopRuntime(runtimeId: string): Promise<ApiManagedRuntimeInfo | null>;
	stopAllRuntimes(): Promise<number>;
	listRuntimes(): Promise<ApiManagedRuntimeInfo[]>;

	// Collections & Environments
	saveCollection(workspaceRoot: string, collection: ApiCollection): Promise<ApiCollection[]>;
	deleteCollection(workspaceRoot: string, collectionId: string): Promise<ApiCollection[]>;
	saveEnvironment(workspaceRoot: string, env: ApiEnvironment, setActive?: boolean): Promise<{ environments: ApiEnvironment[]; activeEnvironmentId: string | null }>;
	setActiveEnvironment(workspaceRoot: string, environmentId: string | null): Promise<string | null>;

	// Automated Testing
	saveTestSuite(workspaceRoot: string, suite: ApiTestSuite): Promise<ApiTestSuite[]>;
	runTestSuite(workspaceRoot: string, opts: {
		suiteId?: string;
		suite?: ApiTestSuite;
		environmentId?: string;
		baseUrlOverride?: string;
		allowProtectedEnvironment?: boolean;
	}): Promise<ApiTestRunResult>;

	// Performance / Load Testing
	runLoadTest(workspaceRoot: string, config: ApiLoadTestConfig): Promise<ApiLoadTestResult>;

	// Live + Static Security Assessment
	runSecurityAudit(workspaceRoot: string, opts: {
		baseUrl?: string;
		routes?: readonly DiscoveredApiRoute[];
		staticFindings?: readonly ApiSecurityFinding[];
		filesScanned?: number;
		allowLiveProbes?: boolean;
	}): Promise<ApiSecurityReport>;

	// Mock Server
	startMockServer(workspaceRoot: string, opts: { name: string; port?: number; routes: readonly ApiMockRoute[] }): Promise<ApiMockServerStatus>;
	stopMockServer(mockId: string): Promise<boolean>;
	listMockServers(): Promise<ApiMockServerStatus[]>;

	// Monitors
	saveMonitor(workspaceRoot: string, monitor: ApiMonitorConfig): Promise<ApiMonitorConfig[]>;
	runMonitorNow(workspaceRoot: string, monitorId: string): Promise<ApiMonitorConfig | null>;
}

export const IKodiaApiStudioMainService = createDecorator<IKodiaApiStudioMainService>('kodiaApiStudioMainService');
