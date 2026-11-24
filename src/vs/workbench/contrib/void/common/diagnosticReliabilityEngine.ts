/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import {
	KdreClassifiedDiagnostic,
	KdreCompilerDiagnostic,
	KdreCompilerVerificationReport,
	KdreConfidence,
	KdreCrossEditorComparisonReport,
	KdreDependencyHealthReport,
	KdreDiagnosticClassification,
	KdreDiagnosticConflict,
	KdreInvestigationReport,
	KdreLanguageServerHealth,
	KdreProjectConfigReport,
	KdreRawDiagnostic,
	KdreRecoveryActionKind,
} from './diagnosticReliabilityTypes.js';

function normPath(p: string): string {
	return p.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

function sameFile(a: string, b: string): boolean {
	const na = normPath(a);
	const nb = normPath(b);
	return na === nb || na.endsWith('/' + nb) || nb.endsWith('/' + na);
}

function isLinterSource(source: string, owner: string): boolean {
	return /\b(eslint|tslint|biome|oxlint|ruff|flake8|pylint|stylelint|prettier|rubocop|phpcs|shellcheck|sonar|markdownlint)\b/i.test(`${source} ${owner}`);
}

function isFrameworkSource(source: string, owner: string): boolean {
	return /\b(angular|vue|volar|svelte|astro|prisma|graphql|tailwind|next|expo|flutter|android-lint)\b/i.test(`${source} ${owner}`);
}

function isDependencyResolutionMessage(message: string, code?: string): boolean {
	const c = String(code ?? '').toUpperCase();
	if (/^(2307|2304|2792|2688|7016|TS2307|TS2304|TS2792|TS2688|TS7016|REPORTMISSINGIMPORTS|REPORTMISSINGMODULESOURCE)$/.test(c)) {
		return true;
	}
	return /\b(cannot find module|cannot find name|could not find a declaration file|import .* could not be resolved|no module named|unresolved import|module not found|package .* is not installed)\b/i.test(message);
}

function isConfigDependentMessage(message: string, code?: string): boolean {
	const c = String(code ?? '').toUpperCase();
	if (/^(5101|5107|TS5101|TS5107|17004|TS17004|1219|TS1219|2792|TS2792|5095|TS5095)$/.test(c)) {
		return true;
	}
	return /\b(tsconfig|jsconfig|experimentalDecorators|jsx flag|moduleResolution|baseUrl|strictNullChecks|outFile|deprecated in TypeScript 6)\b/i.test(message);
}

function isLanguageCoveredByCompilerRun(file: string, verification?: KdreCompilerVerificationReport): KdreCompilerVerificationReport['runs'][number] | undefined {
	if (!verification) return undefined;
	const lower = file.toLowerCase();
	if (/\.(ts|tsx|mts|cts)$/.test(lower)) {
		return verification.runs.find(r => r.available && r.engine.toLowerCase().includes('tsc'));
	}
	if (/\.(js|jsx|mjs|cjs)$/.test(lower)) {
		return verification.runs.find(r => r.available && (r.engine.includes('node') || r.engine.includes('tsc')));
	}
	if (/\.py$/.test(lower)) {
		return verification.runs.find(r => r.available && /pyright|mypy|py_compile/i.test(r.engine));
	}
	if (/\.php$/.test(lower)) {
		return verification.runs.find(r => r.available && /php/i.test(r.engine));
	}
	if (/\.go$/.test(lower)) {
		return verification.runs.find(r => r.available && /go/i.test(r.engine));
	}
	if (/\.rs$/.test(lower)) {
		return verification.runs.find(r => r.available && /cargo/i.test(r.engine));
	}
	if (/\.dart$/.test(lower)) {
		return verification.runs.find(r => r.available && /dart/i.test(r.engine));
	}
	return undefined;
}

// ── Evidence-Based Diagnostic Classifier & Conflict Detector (Phase 2B, 2D, 2E) ───────

export function classifyDiagnosticsWithEvidence(params: {
	workspaceRoot: string;
	rawDiagnostics: readonly KdreRawDiagnostic[];
	projectConfig?: KdreProjectConfigReport;
	dependencyHealth?: KdreDependencyHealthReport;
	serverHealth?: readonly KdreLanguageServerHealth[];
	compilerVerification?: KdreCompilerVerificationReport;
	suppressions?: readonly { ruleId: string; filePattern?: string; justification: string }[];
	nowMs?: number;
}): {
	classified: KdreClassifiedDiagnostic[];
	conflicts: KdreDiagnosticConflict[];
	comparison: KdreCrossEditorComparisonReport;
} {
	const nowMs = params.nowMs ?? Date.now();
	const allCompilerDiags: KdreCompilerDiagnostic[] = [];
	for (const run of params.compilerVerification?.runs ?? []) {
		if (run.available) allCompilerDiags.push(...run.diagnostics);
	}

	const classified: KdreClassifiedDiagnostic[] = [];
	const conflicts: KdreDiagnosticConflict[] = [];
	const matchedCompilerIds = new Set<number>();

	for (let idx = 0; idx < params.rawDiagnostics.length; idx++) {
		const raw = params.rawDiagnostics[idx];
		const id = raw.id ?? `kdre-diag-${idx + 1}`;
		const evidence: string[] = [];
		const safeActions: KdreRecoveryActionKind[] = [];

		// 1. Check explicit user suppression rule
		const sup = params.suppressions?.find(s => {
			const codeMatch = raw.code && s.ruleId.toLowerCase() === String(raw.code).toLowerCase();
			const fileOk = !s.filePattern || normPath(raw.file).includes(normPath(s.filePattern));
			return codeMatch && fileOk;
		});
		if (sup) {
			classified.push({
				id,
				raw,
				classification: 'suppressed_by_user_rule',
				confidence: 'medium',
				verificationStatus: 'suppressed',
				projectId: params.workspaceRoot,
				timestampMs: raw.timestamp ?? nowMs,
				supportingEvidence: [`Explicit user suppression rule for ${sup.ruleId}: ${sup.justification}`],
				explanation: `Suppressed by explicit user rule (${sup.justification}).`,
				safeActions: [],
			});
			continue;
		}

		// 2. Check staleness (deleted file, outside workspace, or outdated document version)
		const isDeleted = raw.fileExists === false;
		const isOutsideWorkspace = raw.inActiveWorkspace === false;
		const isOutdatedVersion = typeof raw.modelVersionId === 'number'
			&& typeof raw.currentDocumentVersion === 'number'
			&& raw.modelVersionId < raw.currentDocumentVersion;

		if (isDeleted || isOutsideWorkspace || isOutdatedVersion) {
			if (isDeleted) evidence.push(`Target file "${raw.file}" no longer exists on disk.`);
			if (isOutsideWorkspace) evidence.push(`Diagnostic belongs to a file outside the active workspace "${params.workspaceRoot}".`);
			if (isOutdatedVersion) evidence.push(`Diagnostic version (v${raw.modelVersionId}) is older than the open document version (v${raw.currentDocumentVersion}).`);

			const conflict: KdreDiagnosticConflict | undefined = isOutdatedVersion ? {
				id: `kdre-conf-${conflicts.length + 1}`,
				file: raw.file,
				line: raw.line,
				kind: 'stale_document_version',
				lspSource: raw.source || raw.owner,
				lspMessage: raw.message,
				authoritativeSource: 'Editor Document Model',
				explanation: `LSP diagnostic was computed for document v${raw.modelVersionId}, but the editor is at v${raw.currentDocumentVersion}.`,
				suggestedAction: 'refresh_document_sync',
			} : undefined;
			if (conflict) conflicts.push(conflict);

			classified.push({
				id,
				raw,
				classification: 'potentially_stale',
				confidence: 'stale',
				verificationStatus: 'stale',
				projectId: params.workspaceRoot,
				timestampMs: raw.timestamp ?? nowMs,
				supportingEvidence: evidence,
				conflict,
				explanation: evidence.join(' '),
				suggestedFix: 'Purge stale markers and refresh document synchronization with the language server.',
				safeActions: ['purge_stale_markers', 'refresh_document_sync'],
			});
			continue;
		}

		// 3. Cross-check against independent compiler/type-checker verification if run
		const matchedCompilerIdx = allCompilerDiags.findIndex(cd => {
			if (!sameFile(raw.file, cd.file)) return false;
			if (Math.abs(cd.line - raw.line) > 2) return false;
			const rawCode = String(raw.code ?? '').replace(/^TS/i, '');
			const cmpCode = String(cd.code ?? '').replace(/^TS/i, '');
			if (rawCode && cmpCode && rawCode === cmpCode) return true;
			const head = raw.message.toLowerCase().slice(0, 32);
			return head.length > 8 && cd.message.toLowerCase().includes(head);
		});
		const matchedCompiler = matchedCompilerIdx >= 0 ? allCompilerDiags[matchedCompilerIdx] : undefined;
		if (matchedCompilerIdx >= 0) matchedCompilerIds.add(matchedCompilerIdx);

		const coveringRun = isLanguageCoveredByCompilerRun(raw.file, params.compilerVerification);
		const isLinter = isLinterSource(raw.source, raw.owner);
		const isFramework = isFrameworkSource(raw.source, raw.owner);
		const isDepIssue = isDependencyResolutionMessage(raw.message, raw.code);
		const isCfgIssue = isConfigDependentMessage(raw.message, raw.code);

		let classification: KdreDiagnosticClassification = 'language_server';
		let confidence: KdreConfidence = 'medium';
		let verificationStatus: KdreClassifiedDiagnostic['verificationStatus'] = 'unverified';
		let authoritativeTool: string | undefined;
		let toolVersion: string | undefined;
		let conflict: KdreDiagnosticConflict | undefined;
		let explanation = '';
		let suggestedFix: string | undefined;

		if (matchedCompiler) {
			const isTypeChecker = /tsc|pyright|mypy|phpstan|psalm|dart analyze/i.test(matchedCompiler.engine);
			classification = isTypeChecker ? 'type_checker_confirmed' : 'compiler_confirmed';
			confidence = 'high';
			verificationStatus = 'confirmed';
			authoritativeTool = matchedCompiler.engine;
			toolVersion = coveringRun?.version;
			evidence.push(`Independently confirmed by ${matchedCompiler.engine}${toolVersion ? ` (${toolVersion})` : ''} at ${matchedCompiler.file}:${matchedCompiler.line}.`);
			explanation = `Genuine defect independently confirmed by ${matchedCompiler.engine}.`;
			suggestedFix = `Fix the reported ${matchedCompiler.code} issue in ${raw.file}:${raw.line}.`;
			safeActions.push('run_compiler_verify');
		} else if (coveringRun && coveringRun.passed && !isLinter && raw.severity === 'error') {
			// CONFLICT: Editor LSP reports an error, yet the project's actual compiler passed with 0 errors!
			classification = 'conflicting';
			confidence = 'conflicting';
			verificationStatus = 'refuted_by_compiler';
			authoritativeTool = coveringRun.engine;
			toolVersion = coveringRun.version;

			const tsMismatch = /\.(ts|tsx)$/i.test(raw.file)
				&& Boolean(params.projectConfig?.workspaceTypeScriptVersion)
				&& isCfgIssue;
			const conflictKind: KdreDiagnosticConflict['kind'] = tsMismatch
				? 'ts_version_mismatch'
				: isDepIssue
					? 'dependency_resolution_mismatch'
					: 'lsp_error_compiler_clean';

			evidence.push(`Editor source "${raw.source || raw.owner}" reported error, but independent compiler "${coveringRun.engine}"${coveringRun.version ? ` (${coveringRun.version})` : ''} PASSED with 0 errors.`);
			if (tsMismatch) {
				evidence.push(`Workspace TypeScript is ${params.projectConfig!.workspaceTypeScriptVersion}; ensure the TypeScript Language Server is using the workspace tsdk instead of a different bundled version.`);
			} else if (isDepIssue && params.dependencyHealth?.nodeModulesPresent) {
				evidence.push(`Project dependencies exist on disk, indicating LSP module-resolution cache or workspace root drift.`);
			}

			conflict = {
				id: `kdre-conf-${conflicts.length + 1}`,
				file: raw.file,
				line: raw.line,
				kind: conflictKind,
				lspSource: raw.source || raw.owner,
				lspMessage: raw.message,
				compilerEngine: coveringRun.engine,
				compilerMessage: '0 errors (clean compiler pass)',
				authoritativeSource: coveringRun.engine,
				explanation: evidence.join(' '),
				suggestedAction: tsMismatch || isCfgIssue ? 'reload_project_config' : 'restart_language_server',
			};
			conflicts.push(conflict);
			explanation = `Diagnostic conflict: ${raw.source || raw.owner} reports an error that ${coveringRun.engine} does NOT reproduce.`;
			suggestedFix = tsMismatch
				? 'Reload project configuration and switch TS Server to the workspace TypeScript version.'
				: 'Restart the affected language server and reload project configuration to re-sync diagnostics.';
			safeActions.push('restart_language_server', 'reload_project_config', 'recheck_dependencies');
		} else if (isLinter) {
			classification = 'linter';
			confidence = 'medium';
			verificationStatus = 'unverified';
			evidence.push(`Reported by linter "${raw.source || raw.owner}" (not a compiler error).`);
			if (coveringRun?.passed) {
				evidence.push(`Independent compiler (${coveringRun.engine}) succeeded; this is a lint/style rule violation.`);
			}
			explanation = `Linter diagnostic from ${raw.source || raw.owner}.`;
			safeActions.push('run_compiler_verify');
		} else if (isFramework) {
			classification = 'framework_validation';
			confidence = 'medium';
			verificationStatus = 'unverified';
			evidence.push(`Reported by framework validator "${raw.source || raw.owner}".`);
			explanation = `Framework-specific validation diagnostic from ${raw.source || raw.owner}.`;
			safeActions.push('reload_project_config', 'run_compiler_verify');
		} else if (isDepIssue) {
			classification = 'dependency_resolution';
			const missingEnv = (params.dependencyHealth && !params.dependencyHealth.nodeModulesPresent && /\.(ts|tsx|js|jsx)$/i.test(raw.file))
				|| (params.dependencyHealth && !params.dependencyHealth.pythonSitePackagesPresent && /\.py$/i.test(raw.file));
			confidence = missingEnv ? 'low' : 'medium';
			verificationStatus = 'unverified';
			evidence.push(missingEnv
				? 'Project dependencies/environment appear uninstalled or unactivated — diagnostic may be caused by missing local packages.'
				: 'Module/type resolution diagnostic; run independent compiler verification to confirm.');
			explanation = evidence[0];
			suggestedFix = missingEnv
				? 'Install project dependencies (e.g. npm/pnpm/yarn install or activate Python virtualenv) and reload the language server.'
				: 'Verify import path, tsconfig path aliases, and installed @types packages.';
			safeActions.push('recheck_dependencies', 'reload_project_config', 'run_compiler_verify');
		} else if (isCfgIssue) {
			classification = 'configuration_dependent';
			confidence = 'low';
			verificationStatus = 'unverified';
			evidence.push(`Configuration-dependent diagnostic (${raw.code ?? 'config'}) sensitive to tsconfig/jsconfig or compiler version.`);
			explanation = evidence[0];
			suggestedFix = 'Verify active tsconfig.json / workspace TypeScript version and run independent compiler check.';
			safeActions.push('reload_project_config', 'run_compiler_verify', 'restart_language_server');
		} else {
			const serverDegraded = params.serverHealth?.some(s => s.status === 'degraded' || s.status === 'crashed');
			classification = serverDegraded ? 'unverified' : 'language_server';
			confidence = serverDegraded ? 'low' : 'medium';
			verificationStatus = 'unverified';
			evidence.push(`Reported by language service "${raw.source || raw.owner}"${coveringRun ? '' : ' (independent compiler not yet run)'}.`);
			explanation = `Language server diagnostic from ${raw.source || raw.owner}.`;
			safeActions.push('run_compiler_verify', 'restart_language_server');
		}

		classified.push({
			id,
			raw,
			classification,
			confidence,
			verificationStatus,
			authoritativeTool,
			toolVersion,
			projectId: params.workspaceRoot,
			timestampMs: raw.timestamp ?? nowMs,
			supportingEvidence: evidence,
			conflict,
			explanation,
			suggestedFix,
			safeActions,
		});
	}

	// Detect reverse conflicts: Compiler reported errors that the editor LSP missed!
	let compilerOnlyCount = 0;
	for (let i = 0; i < allCompilerDiags.length; i++) {
		if (matchedCompilerIds.has(i)) continue;
		const cd = allCompilerDiags[i];
		if (cd.severity !== 'error') continue;
		compilerOnlyCount++;
		conflicts.push({
			id: `kdre-conf-${conflicts.length + 1}`,
			file: cd.file,
			line: cd.line,
			kind: 'compiler_error_lsp_missing',
			compilerEngine: cd.engine,
			compilerMessage: `${cd.code}: ${cd.message}`,
			authoritativeSource: cd.engine,
			explanation: `Authoritative compiler "${cd.engine}" reported ${cd.code} at ${cd.file}:${cd.line}, which was not present in current editor LSP markers.`,
			suggestedAction: 'refresh_document_sync',
		});
	}

	const matchedCount = matchedCompilerIds.size;
	const editorOnlyCount = classified.filter(c => c.verificationStatus === 'refuted_by_compiler' || c.classification === 'potentially_stale').length;
	const totalCompared = Math.max(1, matchedCount + editorOnlyCount + compilerOnlyCount);
	const parityPercent = (matchedCount + editorOnlyCount + compilerOnlyCount) === 0
		? 100
		: Math.round((matchedCount / totalCompared) * 100);

	const authoritativeEngines = (params.compilerVerification?.runs ?? []).filter(r => r.available).map(r => r.engine);
	const comparison: KdreCrossEditorComparisonReport = {
		workspaceRoot: params.workspaceRoot,
		comparedAtMs: nowMs,
		compilerAvailable: authoritativeEngines.length > 0,
		authoritativeEngines,
		editorDiagnosticCount: params.rawDiagnostics.length,
		compilerDiagnosticCount: allCompilerDiags.length,
		matchedCount,
		editorOnlyCount,
		compilerOnlyCount,
		parityPercent,
		conflicts,
		summary: authoritativeEngines.length === 0
			? `No local compiler available to independently cross-check ${params.rawDiagnostics.length} editor diagnostic(s).`
			: `Cross-checked ${params.rawDiagnostics.length} editor diagnostic(s) against ${authoritativeEngines.join(', ')}: ${matchedCount} confirmed, ${editorOnlyCount} editor-only/stale conflicts, ${compilerOnlyCount} compiler-only misses.`,
	};

	return { classified, conflicts, comparison };
}

// ── Deep Suspicious Diagnostic Investigator (Phase 2C & Phase 8) ───────────────────────

export function investigateSuspiciousDiagnostic(params: {
	workspaceRoot: string;
	raw: KdreRawDiagnostic;
	projectConfig?: KdreProjectConfigReport;
	dependencyHealth?: KdreDependencyHealthReport;
	serverHealth?: readonly KdreLanguageServerHealth[];
	compilerVerification?: KdreCompilerVerificationReport;
}): KdreInvestigationReport {
	const { classified } = classifyDiagnosticsWithEvidence({
		workspaceRoot: params.workspaceRoot,
		rawDiagnostics: [params.raw],
		projectConfig: params.projectConfig,
		dependencyHealth: params.dependencyHealth,
		serverHealth: params.serverHealth,
		compilerVerification: params.compilerVerification,
	});
	const item = classified[0];
	const checks: { check: string; passed: boolean; detail: string }[] = [];

	const versionSynced = !(typeof params.raw.modelVersionId === 'number' && typeof params.raw.currentDocumentVersion === 'number' && params.raw.modelVersionId < params.raw.currentDocumentVersion);
	checks.push({
		check: 'Document version synchronization',
		passed: versionSynced,
		detail: versionSynced ? 'Diagnostic matches current document version.' : `Stale diagnostic v${params.raw.modelVersionId} vs open editor v${params.raw.currentDocumentVersion}.`,
	});

	const fileExists = params.raw.fileExists !== false;
	checks.push({
		check: 'File exists in active workspace',
		passed: fileExists && params.raw.inActiveWorkspace !== false,
		detail: fileExists ? `File "${params.raw.file}" is present.` : `File "${params.raw.file}" does not exist on disk.`,
	});

	const cfgLoaded = !params.projectConfig || params.projectConfig.issues.length === 0;
	checks.push({
		check: 'Project configuration validity',
		passed: cfgLoaded,
		detail: params.projectConfig
			? (cfgLoaded ? `Loaded ${params.projectConfig.configFiles.length} config file(s).` : params.projectConfig.issues.join('; '))
			: 'Project configuration not yet scanned.',
	});

	const depsOk = !params.dependencyHealth || params.dependencyHealth.healthy;
	checks.push({
		check: 'Dependency & module resolution',
		passed: depsOk,
		detail: params.dependencyHealth
			? (depsOk ? 'Dependencies & resolution paths look healthy.' : params.dependencyHealth.resolutionWarnings.join('; '))
			: 'Dependency health not yet checked.',
	});

	const compilerMatch = item.verificationStatus === 'confirmed';
	const compilerRefuted = item.verificationStatus === 'refuted_by_compiler';
	checks.push({
		check: 'Independent compiler confirmation',
		passed: compilerMatch,
		detail: compilerMatch
			? `Confirmed by ${item.authoritativeTool}.`
			: compilerRefuted
				? `Refuted: ${item.authoritativeTool} succeeded with 0 errors.`
				: 'No matching compiler diagnostic confirmed.',
	});

	let rootCauseCategory: KdreInvestigationReport['rootCauseCategory'] = 'unverified_needs_compiler';
	let isLikelyFalsePositive = false;

	if (!versionSynced) {
		rootCauseCategory = 'stale_document_version';
		isLikelyFalsePositive = true;
	} else if (!fileExists || params.raw.inActiveWorkspace === false) {
		rootCauseCategory = 'deleted_or_outside_workspace';
		isLikelyFalsePositive = true;
	} else if (compilerMatch) {
		rootCauseCategory = 'genuine_code_error';
		isLikelyFalsePositive = false;
	} else if (item.conflict?.kind === 'ts_version_mismatch') {
		rootCauseCategory = 'typescript_version_mismatch';
		isLikelyFalsePositive = true;
	} else if (compilerRefuted) {
		rootCauseCategory = 'language_server_conflict';
		isLikelyFalsePositive = true;
	} else if (item.classification === 'dependency_resolution' && !depsOk) {
		rootCauseCategory = 'missing_dependencies_or_env';
		isLikelyFalsePositive = true;
	} else if (item.classification === 'configuration_dependent') {
		rootCauseCategory = 'tsconfig_or_path_alias_config';
		isLikelyFalsePositive = true;
	}

	return {
		diagnosticId: item.id,
		file: params.raw.file,
		line: params.raw.line,
		message: params.raw.message,
		classification: item.classification,
		confidence: item.confidence,
		isLikelyFalsePositive,
		rootCauseCategory,
		checksPerformed: checks,
		conclusion: isLikelyFalsePositive
			? `Likely false positive (${rootCauseCategory}): ${item.explanation}`
			: compilerMatch
				? `Confirmed genuine error (${item.authoritativeTool}): ${params.raw.message}`
				: `Unverified diagnostic (${item.classification}): run independent compiler verification before dismissing or suppressing.`,
		recommendedFix: item.suggestedFix ?? 'Inspect source location and run independent compiler verification.',
		safeRecoveryActions: item.safeActions,
	};
}

// ── Concise LLM Formatters ─────────────────────────────────────────────────────────────

export function formatProjectConfigForLLM(r: KdreProjectConfigReport): string {
	return [
		`## Kodia Diagnostic Reliability — Project Configuration Intelligence`,
		`- **Workspace:** \`${r.workspaceRoot}\`${r.isMonorepo ? ` (Monorepo: ${r.subprojects.slice(0, 6).join(', ')})` : ''}`,
		`- **Languages:** ${r.detectedLanguages.join(', ') || 'none'} | **Frameworks:** ${r.detectedFrameworks.join(', ') || 'none'}`,
		`- **Package Managers:** ${r.packageManagers.join(', ') || 'unknown'}`,
		r.workspaceTypeScriptVersion ? `- **Workspace TypeScript:** \`${r.workspaceTypeScriptVersion}\` (${r.workspaceTypeScriptPath})` : '',
		r.pythonInterpreterPath ? `- **Python Interpreter:** \`${r.pythonInterpreterPath}\` (venv: ${r.pythonVenvDetected})` : '',
		`- **Config Files (${r.configFiles.length}):** ${r.configFiles.slice(0, 12).map(c => `\`${c.path}\`${c.validJsonOrSyntax ? '' : ' [PARSE ERROR]'}`).join(', ')}`,
		r.issues.length ? `- **Configuration Issues:**\n${r.issues.map(i => `  - ${i}`).join('\n')}` : '- **Configuration Issues:** None detected',
	].filter(Boolean).join('\n');
}

export function formatCompilerVerificationForLLM(r: KdreCompilerVerificationReport): string {
	return [
		`## Kodia Diagnostic Reliability — Independent Compiler Verification`,
		`- **Overall:** ${r.passed ? 'PASSED (0 errors)' : `FAILED (${r.totalErrors} error(s), ${r.totalWarnings} warning(s))`}`,
		...r.runs.map(run => `- **${run.engine}** (${run.language}${run.version ? ` ${run.version}` : ''}): ${!run.available ? `Unavailable (${run.errorNote ?? 'not installed'})` : run.passed ? `PASS (${run.durationMs}ms)` : `FAIL — ${run.diagnostics.length} diagnostic(s) (${run.durationMs}ms)`}`),
		...r.runs.flatMap(run => run.diagnostics.slice(0, 8).map(d => `  - [${d.engine} ${d.code}] ${d.file}:${d.line}:${d.column} — ${d.message}`)),
	].join('\n');
}

export function formatInvestigationForLLM(r: KdreInvestigationReport): string {
	return [
		`## Kodia Diagnostic Reliability — Diagnostic Investigation`,
		`- **Location:** \`${r.file}:${r.line}\` | **Classification:** \`${r.classification}\` | **Confidence:** \`${r.confidence}\``,
		`- **Likely False Positive:** ${r.isLikelyFalsePositive ? 'YES' : 'NO'} | **Root Cause:** \`${r.rootCauseCategory}\``,
		`- **Conclusion:** ${r.conclusion}`,
		`- **Recommended Action:** ${r.recommendedFix}`,
		`- **Checks Performed:**\n${r.checksPerformed.map(c => `  - [${c.passed ? 'OK' : 'ISSUE'}] ${c.check}: ${c.detail}`).join('\n')}`,
	].join('\n');
}
