/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const KODIA_KDRE_CHANNEL = 'void-channel-diagnosticReliability';

// ── Diagnostic Classification & Confidence (Phase 2B & 2D) ─────────────────────────────

export type KdreDiagnosticClassification =
	| 'compiler_confirmed'
	| 'type_checker_confirmed'
	| 'language_server'
	| 'linter'
	| 'framework_validation'
	| 'configuration_dependent'
	| 'dependency_resolution'
	| 'potentially_stale'
	| 'conflicting'
	| 'unverified'
	| 'suppressed_by_user_rule';

export type KdreConfidence = 'high' | 'medium' | 'low' | 'stale' | 'conflicting';

export type KdreSeverity = 'error' | 'warning' | 'info' | 'hint';

export type KdreSystemState =
	| 'ready'
	| 'initializing'
	| 'updating'
	| 'verifying'
	| 'degraded'
	| 'stale'
	| 'unavailable';

// ── Raw Editor / LSP Marker Input ──────────────────────────────────────────────────────

export interface KdreRawDiagnostic {
	readonly id?: string;
	readonly owner: string;
	readonly source: string;
	readonly code?: string;
	readonly severity: KdreSeverity;
	readonly message: string;
	readonly file: string; // workspace-relative or absolute normalized path
	readonly line: number;
	readonly column: number;
	readonly endLine?: number;
	readonly endColumn?: number;
	readonly modelVersionId?: number;
	readonly currentDocumentVersion?: number;
	readonly fileExists?: boolean;
	readonly inActiveWorkspace?: boolean;
	readonly timestamp?: number;
}

// ── Project Configuration & Dependency Resolution Intelligence (Phase 1C, 1D, 5) ───────

export type KdrePackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun' | 'pip' | 'poetry' | 'uv' | 'conda' | 'composer' | 'cargo' | 'go' | 'gradle' | 'maven' | 'dotnet' | 'pub' | 'unknown';

export interface KdreDiscoveredConfigFile {
	readonly path: string; // workspace-relative
	readonly kind:
		| 'tsconfig'
		| 'jsconfig'
		| 'package_json'
		| 'lockfile'
		| 'python_config'
		| 'php_config'
		| 'go_mod'
		| 'cargo_toml'
		| 'java_build'
		| 'dotnet_props'
		| 'editorconfig'
		| 'framework_config';
	readonly validJsonOrSyntax: boolean;
	readonly parseError?: string;
	readonly details?: string;
}

export interface KdreProjectConfigReport {
	readonly workspaceRoot: string;
	readonly scannedAtMs: number;
	readonly detectedLanguages: readonly string[];
	readonly detectedFrameworks: readonly string[];
	readonly packageManagers: readonly KdrePackageManager[];
	readonly isMonorepo: boolean;
	readonly subprojects: readonly string[];
	readonly configFiles: readonly KdreDiscoveredConfigFile[];
	readonly tsConfigPaths: readonly string[];
	readonly hasPathAliases: boolean;
	readonly hasProjectReferences: boolean;
	readonly workspaceTypeScriptVersion?: string;
	readonly workspaceTypeScriptPath?: string;
	readonly pythonInterpreterPath?: string;
	readonly pythonVenvDetected: boolean;
	readonly phpComposerDetected: boolean;
	readonly issues: readonly string[];
}

export interface KdreDependencyHealthReport {
	readonly workspaceRoot: string;
	readonly checkedAtMs: number;
	readonly nodeModulesPresent: boolean;
	readonly hasTypesPackages: boolean;
	readonly pnpmWorkspaceDetected: boolean;
	readonly yarnPnpDetected: boolean;
	readonly pythonSitePackagesPresent: boolean;
	readonly phpVendorAutoloadPresent: boolean;
	readonly missingDeclaredDeps: readonly string[];
	readonly resolutionWarnings: readonly string[];
	readonly healthy: boolean;
}

// ── Language Server Health & Self-Healing (Phase 4) ────────────────────────────────────

export type KdreServerStatus = 'healthy' | 'initializing' | 'degraded' | 'crashed' | 'unavailable' | 'not_applicable';

export interface KdreLanguageServerHealth {
	readonly language: string;
	readonly serverName: string;
	readonly status: KdreServerStatus;
	readonly version?: string;
	readonly binaryPath?: string;
	readonly workspaceConfigured: boolean;
	readonly restartCount: number;
	readonly lastCheckedAtMs: number;
	readonly issue?: string;
	readonly recommendedAction?: KdreRecoveryActionKind;
}

export type KdreRecoveryActionKind =
	| 'restart_language_server'
	| 'reload_project_config'
	| 'refresh_document_sync'
	| 'purge_stale_markers'
	| 'recheck_dependencies'
	| 'run_compiler_verify';

export interface KdreRecoveryResult {
	readonly action: KdreRecoveryActionKind;
	readonly targetLanguage?: string;
	readonly executed: boolean;
	readonly summary: string;
	readonly affectedCount: number;
	readonly timestampMs: number;
}

// ── Independent Compiler / Type-Checker Verification (Phase 6) ─────────────────────────

export interface KdreCompilerDiagnostic {
	readonly engine: string;
	readonly language: string;
	readonly code: string;
	readonly severity: KdreSeverity;
	readonly file: string;
	readonly line: number;
	readonly column: number;
	readonly message: string;
}

export interface KdreCompilerToolRun {
	readonly engine: string;
	readonly language: string;
	readonly available: boolean;
	readonly version?: string;
	readonly command?: string;
	readonly cwd: string;
	readonly passed: boolean;
	readonly durationMs: number;
	readonly diagnostics: readonly KdreCompilerDiagnostic[];
	readonly errorNote?: string;
}

export interface KdreCompilerVerificationReport {
	readonly verificationId: string;
	readonly workspaceRoot: string;
	readonly executedAtMs: number;
	readonly runs: readonly KdreCompilerToolRun[];
	readonly totalErrors: number;
	readonly totalWarnings: number;
	readonly passed: boolean;
	readonly summary: string;
}

// ── Classified Diagnostics, Conflicts & Investigation (Phase 2 & 8) ────────────────────

export interface KdreDiagnosticConflict {
	readonly id: string;
	readonly file: string;
	readonly line: number;
	readonly kind:
		| 'lsp_error_compiler_clean'
		| 'compiler_error_lsp_missing'
		| 'ts_version_mismatch'
		| 'linter_vs_compiler'
		| 'dependency_resolution_mismatch'
		| 'stale_document_version';
	readonly lspSource?: string;
	readonly lspMessage?: string;
	readonly compilerEngine?: string;
	readonly compilerMessage?: string;
	readonly authoritativeSource: string;
	readonly explanation: string;
	readonly suggestedAction: KdreRecoveryActionKind;
}

export interface KdreClassifiedDiagnostic {
	readonly id: string;
	readonly raw: KdreRawDiagnostic;
	readonly classification: KdreDiagnosticClassification;
	readonly confidence: KdreConfidence;
	readonly verificationStatus: 'confirmed' | 'refuted_by_compiler' | 'stale' | 'unverified' | 'suppressed';
	readonly authoritativeTool?: string;
	readonly toolVersion?: string;
	readonly projectId: string;
	readonly timestampMs: number;
	readonly supportingEvidence: readonly string[];
	readonly conflict?: KdreDiagnosticConflict;
	readonly explanation: string;
	readonly suggestedFix?: string;
	readonly safeActions: readonly KdreRecoveryActionKind[];
}

export interface KdreInvestigationReport {
	readonly diagnosticId: string;
	readonly file: string;
	readonly line: number;
	readonly message: string;
	readonly classification: KdreDiagnosticClassification;
	readonly confidence: KdreConfidence;
	readonly isLikelyFalsePositive: boolean;
	readonly rootCauseCategory:
		| 'genuine_code_error'
		| 'stale_document_version'
		| 'deleted_or_outside_workspace'
		| 'typescript_version_mismatch'
		| 'missing_dependencies_or_env'
		| 'tsconfig_or_path_alias_config'
		| 'language_server_conflict'
		| 'unverified_needs_compiler';
	readonly checksPerformed: readonly { check: string; passed: boolean; detail: string }[];
	readonly conclusion: string;
	readonly recommendedFix: string;
	readonly safeRecoveryActions: readonly KdreRecoveryActionKind[];
}

export interface KdreCrossEditorComparisonReport {
	readonly workspaceRoot: string;
	readonly comparedAtMs: number;
	readonly compilerAvailable: boolean;
	readonly authoritativeEngines: readonly string[];
	readonly editorDiagnosticCount: number;
	readonly compilerDiagnosticCount: number;
	readonly matchedCount: number;
	readonly editorOnlyCount: number; // potential false positives or non-compiler linter hints
	readonly compilerOnlyCount: number; // missed by editor LSP
	readonly parityPercent: number;
	readonly conflicts: readonly KdreDiagnosticConflict[];
	readonly summary: string;
}

// ── Live Snapshot & Event Stream (Phase 7D) ────────────────────────────────────────────

export interface KdreEvent {
	readonly eventId: string;
	readonly sequence: number;
	readonly timestampMs: number;
	readonly type:
		| 'config_scanned'
		| 'dependencies_checked'
		| 'server_health_updated'
		| 'compiler_verification_started'
		| 'compiler_verification_completed'
		| 'diagnostics_classified'
		| 'conflict_detected'
		| 'stale_markers_purged'
		| 'recovery_executed';
	readonly message: string;
	readonly severity: 'info' | 'success' | 'warning' | 'error';
}

export interface KdreLiveSnapshot {
	readonly workspaceRoot: string;
	readonly systemState: KdreSystemState;
	readonly statusLabel: string;
	readonly updatedAtMs: number;
	readonly totalEditorDiagnostics: number;
	readonly confirmedErrorCount: number;
	readonly potentialFalsePositiveCount: number;
	readonly staleCount: number;
	readonly conflictCount: number;
	readonly projectConfig?: KdreProjectConfigReport;
	readonly dependencyHealth?: KdreDependencyHealthReport;
	readonly serverHealth: readonly KdreLanguageServerHealth[];
	readonly lastVerification?: KdreCompilerVerificationReport;
	readonly classifiedDiagnostics: readonly KdreClassifiedDiagnostic[];
	readonly conflicts: readonly KdreDiagnosticConflict[];
	readonly recentEvents: readonly KdreEvent[];
}

// ── IPC Main Service Interface ─────────────────────────────────────────────────────────

export interface IKodiaDiagnosticReliabilityMainService {
	readonly _serviceBrand: undefined;
	readonly onDidEmitEvent: Event<KdreEvent>;
	readonly onDidChangeSnapshot: Event<KdreLiveSnapshot>;

	getSnapshot(workspaceRoot: string): Promise<KdreLiveSnapshot>;
	inspectProjectConfiguration(workspaceRoot: string): Promise<KdreProjectConfigReport>;
	verifyDependencyResolution(workspaceRoot: string): Promise<KdreDependencyHealthReport>;
	probeLanguageServerHealth(workspaceRoot: string): Promise<readonly KdreLanguageServerHealth[]>;
	runIndependentVerification(workspaceRoot: string, opts?: { targetFiles?: readonly string[]; languages?: readonly string[] }): Promise<KdreCompilerVerificationReport>;
	evaluateDiagnostics(
		workspaceRoot: string,
		rawDiagnostics: readonly KdreRawDiagnostic[],
		opts?: { runCompiler?: boolean; suppressions?: readonly { ruleId: string; filePattern?: string; justification: string }[] },
	): Promise<{
		classified: readonly KdreClassifiedDiagnostic[];
		conflicts: readonly KdreDiagnosticConflict[];
		comparison: KdreCrossEditorComparisonReport;
		snapshot: KdreLiveSnapshot;
	}>;
	investigateDiagnostic(
		workspaceRoot: string,
		diagnostic: KdreRawDiagnostic,
		opts?: { runCompiler?: boolean },
	): Promise<KdreInvestigationReport>;
	recordRecoveryAction(workspaceRoot: string, result: KdreRecoveryResult): Promise<KdreLiveSnapshot>;
}

export const IKodiaDiagnosticReliabilityMainService = createDecorator<IKodiaDiagnosticReliabilityMainService>('kodiaDiagnosticReliabilityMainService');
