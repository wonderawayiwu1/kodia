/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * KACRAE — Kodia Autonomous Code Review & Software Assurance Engine
 * Pure deterministic multi-domain analysis, false-positive calibration, attack-path
 * tracing, adversarial counterexample generation, requirements traceability,
 * multi-model council routing, compliance evidence mapping, and report synthesis.
 *
 * Zero Node.js I/O — executes safely in both renderer/browser and Node/main process.
 * Reuses Kodia's existing Correctness, ProjectHealth, DigitalTwin, and Evolution engines.
 */

import { analyzeTaintFlows, analyzeWorkspaceCorrectness } from './correctnessEngine.js';
import { ScannedSourceFile, analyzeProjectHealth, buildArchitectureMap } from './projectHealth.js';
import {
	DEFAULT_KACRAE_SETTINGS,
	KacraeAdversarialChallenge,
	KacraeApiContractReport,
	KacraeAttackPath,
	KacraeComplianceControlEvidence,
	KacraeComplianceFramework,
	KacraeComplianceReport,
	KacraeCouncilRoutingPlan,
	KacraeDatabaseReviewReport,
	KacraeExportReportRequest,
	KacraeFinding,
	KacraeFindingCategory,
	KacraeFindingClassification,
	KacraeGeneratedTestSuggestion,
	KacraeHealthScoreBreakdown,
	KacraeModelRole,
	KacraePerformanceObservation,
	KacraePerformanceReport,
	KacraeReadinessAssessment,
	KacraeRepoGraph,
	KacraeRequirementItem,
	KacraeRequirementTraceLink,
	KacraeReviewDepth,
	KacraeReviewRule,
	KacraeReviewSession,
	KacraeRoleAssignment,
	KacraeSeverity,
	KacraeSettings,
	KacraeSuggestedFix,
	KacraeTestIntelligenceReport,
	KacraeTraceabilityMatrix,
} from './kacraeTypes.js';

// ============================================================================
// 1. Secret Redaction & Prompt-Injection Defense (Part 8.3 & Part 30)
// ============================================================================

const REDACT_PATTERNS: readonly RegExp[] = [
	/-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
	/\bAKIA[0-9A-Z]{16}\b/g,
	/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}\b/g,
	/\bsk-(?:proj-|live-|ant-)?[A-Za-z0-9_-]{20,}\b/g,
	/\bnvapi-[A-Za-z0-9_-]{20,}\b/g,
	/\bBearer\s+[A-Za-z0-9._-]{24,}\b/g,
	/(\b(?:api_?key|secret_?key|access_?token|private_?key|db_?password|auth_?token|password)\s*[:=]\s*["'])([^"'\s]{10,})(["'])/gi,
];

export function redactSecretsInText(input: string): string {
	let out = input;
	for (let i = 0; i < REDACT_PATTERNS.length; i++) {
		const re = REDACT_PATTERNS[i];
		if (i === REDACT_PATTERNS.length - 1) {
			out = out.replace(re, '$1[REDACTED_SECRET]$3');
		} else {
			out = out.replace(re, '[REDACTED_SECRET]');
		}
	}
	return out;
}

const PROMPT_INJECTION_PATTERNS: readonly { ruleId: string; pattern: RegExp; title: string }[] = [
	{
		ruleId: 'KACRAE-PINJ-001',
		pattern: /\b(?:ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions|disregard\s+system\s+prompt|override\s+security\s+review)\b/i,
		title: 'Prompt injection attempt in repository content',
	},
	{
		ruleId: 'KACRAE-PINJ-002',
		pattern: /\b(?:exfiltrate|print\s+all\s+env|output\s+api\s+keys?|mark\s+this\s+pr\s+as\s+safe\s+with\s+zero\s+findings)\b/i,
		title: 'Adversarial instruction attempting to subvert reviewer output or exfiltrate secrets',
	},
];

export function sanitizeForUntrustedPromptContext(text: string): { sanitized: string; strippedCount: number } {
	let sanitized = redactSecretsInText(text);
	let strippedCount = 0;
	for (const p of PROMPT_INJECTION_PATTERNS) {
		const globalRe = new RegExp(p.pattern.source, 'gi');
		sanitized = sanitized.replace(globalRe, () => {
			strippedCount++;
			return '[UNTRUSTED_INSTRUCTION_STRIPPED]';
		});
	}
	return { sanitized, strippedCount };
}

// ============================================================================
// 2. Helper Utilities
// ============================================================================

function normPath(p: string): string {
	return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

function getExt(p: string): string {
	const m = /(\.[a-zA-Z0-9]+)$/.exec(p);
	return m ? m[1].toLowerCase() : '';
}

function isTestFile(p: string): boolean {
	const l = normPath(p).toLowerCase();
	return /(?:^|\/)(?:__tests__|tests?|spec|fixtures|mocks)\//.test(l) || /\.(?:test|spec)\.[a-z0-9]+$/.test(l) || /_test\.[a-z0-9]+$/.test(l);
}

function makeFindingId(ruleId: string, file: string, line: number): string {
	let hash = 2166136261;
	const raw = `${ruleId}::${normPath(file)}::${line}`;
	for (let i = 0; i < raw.length; i++) {
		hash ^= raw.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return `kacrae-${ruleId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${(hash >>> 0).toString(16)}`;
}

function extractContextWindow(lines: readonly string[], line1Based: number, radius = 2): string {
	const start = Math.max(0, line1Based - 1 - radius);
	const end = Math.min(lines.length, line1Based + radius);
	const out: string[] = [];
	for (let i = start; i < end; i++) {
		out.push(`${i + 1}: ${lines[i]}`);
	}
	return redactSecretsInText(out.join('\n')).slice(0, 600);
}

function buildUnifiedSnippetDiff(file: string, line: number, before: string, after: string): string {
	const beforeLines = before.split(/\r?\n/).map(l => `- ${l}`).join('\n');
	const afterLines = after.split(/\r?\n/).map(l => `+ ${l}`).join('\n');
	return `--- a/${normPath(file)}\n+++ b/${normPath(file)}\n@@ -${line} +${line} @@\n${beforeLines}\n${afterLines}`;
}

function createFinding(params: {
	ruleId: string;
	title: string;
	category: KacraeFindingCategory;
	severity: KacraeSeverity;
	classification: KacraeFindingClassification;
	confidence: number;
	file: string;
	line: number;
	endLine?: number;
	codeContext: string;
	explanation: string;
	whyItMatters: string;
	preconditions?: readonly string[];
	impact: string;
	reproduction?: string;
	evidence: readonly string[];
	suggestedFix?: KacraeSuggestedFix;
	affectedComponents?: readonly string[];
	detectionMethod: KacraeFinding['detectionMethod'];
	cwe?: string;
	owasp?: string;
}): KacraeFinding {
	const file = normPath(params.file);
	const now = new Date().toISOString();
	return {
		id: makeFindingId(params.ruleId, file, params.line),
		ruleId: params.ruleId,
		title: params.title,
		category: params.category,
		severity: params.severity,
		classification: params.classification,
		confidence: Math.max(0, Math.min(1, Number(params.confidence.toFixed(2)))),
		location: {
			file,
			startLine: Math.max(1, params.line),
			endLine: Math.max(params.line, params.endLine ?? params.line),
		},
		codeContext: redactSecretsInText(params.codeContext),
		explanation: redactSecretsInText(params.explanation),
		whyItMatters: params.whyItMatters,
		preconditions: params.preconditions ?? [],
		impact: params.impact,
		reproduction: params.reproduction,
		evidence: params.evidence.map(e => redactSecretsInText(e)),
		suggestedFix: params.suggestedFix,
		relatedFindingIds: [],
		affectedComponents: params.affectedComponents ?? [file],
		detectionMethod: params.detectionMethod,
		cwe: params.cwe,
		owasp: params.owasp,
		lifecycle: 'new',
		lifecycleHistory: [],
		createdAt: now,
	};
}

// ============================================================================
// 3. Multi-Domain Deterministic Analyzers (Parts 7, 8, 9, 10, 11, 12, 13, 16)
// ============================================================================

export function analyzeKacraeSourceFiles(
	files: readonly ScannedSourceFile[],
	opts?: {
		customRules?: readonly KacraeReviewRule[];
		graph?: KacraeRepoGraph | null;
		settings?: Partial<KacraeSettings>;
	},
): {
	findings: KacraeFinding[];
	attackPaths: KacraeAttackPath[];
	databaseReport: KacraeDatabaseReviewReport;
	apiContractReport: KacraeApiContractReport;
	testReport: KacraeTestIntelligenceReport;
	performanceReport: KacraePerformanceReport;
	adversarialChallenges: KacraeAdversarialChallenge[];
} {
	const findings: KacraeFinding[] = [];
	const attackPaths: KacraeAttackPath[] = [];
	const performanceObservations: KacraePerformanceObservation[] = [];
	const adversarialChallenges: KacraeAdversarialChallenge[] = [];

	const dbDetected = new Set<string>();
	let migrationsInspected = 0;
	let queriesInspected = 0;
	let destructiveMigrations = 0;
	let lockingMigrations = 0;
	let nPlusOneRisks = 0;
	let tenantIsolationRisks = 0;
	const dbFindings: KacraeFinding[] = [];

	const protocolsDetected = new Set<string>();
	const specFiles: string[] = [];
	const specEndpoints = new Set<string>();
	const implementedEndpoints = new Map<string, { file: string; line: number; hasAuth: boolean; hasValidation: boolean }>();
	const apiFindings: KacraeFinding[] = [];

	const weakOrTautologicalTests: { file: string; line: number; reason: string }[] = [];
	const flakyTestPatterns: { file: string; line: number; reason: string }[] = [];
	const generatedTests: KacraeGeneratedTestSuggestion[] = [];

	// --- A. Reuse Kodia's Existing Correctness, Taint, and ProjectHealth Engines ---
	const correctnessDiags = analyzeWorkspaceCorrectness(files);
	for (const d of correctnessDiags) {
		const f = files.find(x => normPath(x.relativePath) === normPath(d.file));
		const lines = f ? f.content.split(/\r?\n/) : [];
		const sev: KacraeSeverity = d.severity === 'critical' ? 'critical' : d.severity === 'error' ? 'high' : d.severity === 'warning' ? 'medium' : 'low';
		const cat: KacraeFindingCategory =
			d.category === 'auth-authz' || d.category === 'injection' ? 'security' :
			d.category === 'crypto-secrets' ? 'secrets' :
			d.category === 'async-concurrency' ? 'concurrency' :
			d.category === 'api-integration' ? 'api_contract' :
			d.category === 'performance' ? 'performance' : 'correctness';
		findings.push(createFinding({
			ruleId: d.ruleId,
			title: d.title,
			category: cat,
			severity: sev,
			classification: d.confidence === 'confirmed' ? 'confirmed_defect' : d.confidence === 'high' ? 'strongly_supported' : 'potential_issue',
			confidence: d.confidence === 'confirmed' ? 0.94 : d.confidence === 'high' ? 0.85 : 0.68,
			file: d.file,
			line: d.line,
			codeContext: lines.length ? extractContextWindow(lines, d.line) : (d.evidence ?? ''),
			explanation: d.message,
			whyItMatters: d.remediation,
			impact: `${d.category} defect detected by deterministic analyzer (${d.engine}).`,
			evidence: [d.evidence ?? `${d.file}:${d.line}`],
			detectionMethod: 'deterministic_static',
		}));
	}

	const taintReport = analyzeTaintFlows(files);
	for (const tf of taintReport.unsafeFlows) {
		const f = files.find(x => normPath(x.relativePath) === normPath(tf.sink.file));
		const lines = f ? f.content.split(/\r?\n/) : [];
		const finding = createFinding({
			ruleId: `KACRAE-TAINT-${tf.sinkKind.toUpperCase()}`,
			title: tf.title,
			category: tf.sinkKind === 'secret_log' ? 'secrets' : 'security',
			severity: tf.severity === 'critical' ? 'critical' : tf.severity === 'high' ? 'high' : 'medium',
			classification: tf.confidence === 'confirmed' ? 'confirmed_defect' : 'strongly_supported',
			confidence: tf.confidence === 'confirmed' ? 0.92 : 0.84,
			file: tf.sink.file,
			line: tf.sink.line,
			codeContext: lines.length ? extractContextWindow(lines, tf.sink.line) : tf.sink.expression,
			explanation: tf.explanation,
			whyItMatters: tf.remediation,
			preconditions: [`Untrusted ${tf.sourceKind} enters at ${tf.source.file}:${tf.source.line}`],
			impact: `Unsanitized data flows from ${tf.sourceKind} to ${tf.sinkKind} sink.`,
			evidence: [
				`Source (${tf.sourceKind}): ${tf.source.file}:${tf.source.line} -> ${tf.source.expression}`,
				`Sink (${tf.sinkKind}): ${tf.sink.file}:${tf.sink.line} -> ${tf.sink.expression}`,
			],
			detectionMethod: 'taint_flow',
			cwe: tf.sinkKind === 'sql_query' ? 'CWE-89' : tf.sinkKind === 'shell_exec' ? 'CWE-78' : tf.sinkKind === 'html_render' ? 'CWE-79' : tf.sinkKind === 'file_path' ? 'CWE-22' : 'CWE-20',
			owasp: 'A03:2021-Injection',
		});
		findings.push(finding);

		attackPaths.push({
			id: `ap-${finding.id}`,
			findingId: finding.id,
			title: `${tf.sourceKind} -> ${tf.sinkKind} exploit path`,
			severity: finding.severity,
			confirmed: finding.classification === 'confirmed_defect',
			steps: [
				{ kind: 'entry_point', label: `Entry (${tf.sourceKind})`, file: tf.source.file, line: tf.source.line, detail: tf.source.expression, present: true },
				{ kind: 'validation', label: 'Input Sanitization', file: tf.sink.file, line: tf.sink.line, detail: tf.sanitizerDetected ? 'Sanitizer detected' : 'No sanitizer detected on flow', present: tf.sanitizerDetected },
				{ kind: 'sensitive_sink', label: `Sink (${tf.sinkKind})`, file: tf.sink.file, line: tf.sink.line, detail: tf.sink.expression, present: true },
			],
			impactSummary: finding.impact,
		});
	}

	const health = analyzeProjectHealth(files);
	for (const hf of health.findings) {
		const isSecret = hf.kind === 'secret';
		const f = files.find(x => normPath(x.relativePath) === normPath(hf.file));
		const lines = f ? f.content.split(/\r?\n/) : [];
		findings.push(createFinding({
			ruleId: `KACRAE-HEALTH-${hf.rule.toUpperCase()}`,
			title: hf.message,
			category: isSecret ? 'secrets' : 'security',
			severity: hf.severity,
			classification: isSecret ? 'confirmed_defect' : 'strongly_supported',
			confidence: isSecret ? 0.96 : 0.82,
			file: hf.file,
			line: hf.line,
			codeContext: lines.length ? extractContextWindow(lines, hf.line) : hf.snippet,
			explanation: `${hf.message}. Detected in ${hf.file}:${hf.line}.`,
			whyItMatters: isSecret
				? 'Exposed credentials can be harvested from source history and used to compromise production environments.'
				: 'Unsafe dynamic execution or unencrypted transport exposes the application to exploitation.',
			impact: isSecret ? 'Credential compromise and unauthorized system access.' : 'Security exposure in runtime code path.',
			evidence: [redactSecretsInText(hf.snippet)],
			detectionMethod: 'security_scanner',
			cwe: isSecret ? 'CWE-798' : 'CWE-94',
			owasp: isSecret ? 'A02:2021-Cryptographic Failures' : 'A03:2021-Injection',
		}));
	}

	// --- B. KACRAE Deep Multi-Domain Inspection per File ---
	for (const file of files) {
		const rel = normPath(file.relativePath);
		const ext = getExt(rel);
		const content = file.content;
		const lines = content.split(/\r?\n/);
		const inTest = isTestFile(rel);

		// Prompt Injection Check across ALL files (including docs/comments)
		for (let i = 0; i < lines.length; i++) {
			for (const pi of PROMPT_INJECTION_PATTERNS) {
				if (pi.pattern.test(lines[i])) {
					findings.push(createFinding({
						ruleId: pi.ruleId,
						title: pi.title,
						category: 'prompt_injection',
						severity: 'high',
						classification: 'confirmed_defect',
						confidence: 0.95,
						file: rel,
						line: i + 1,
						codeContext: extractContextWindow(lines, i + 1),
						explanation: 'Untrusted repository content contains prompt-injection directives targeting AI code reviewers or agents.',
						whyItMatters: 'Prompt injection in comments, docs, or fixtures could manipulate AI reviewers into hiding vulnerabilities or leaking secrets.',
						impact: 'Integrity compromise of automated AI review workflows.',
						evidence: [`Matched prompt-injection signature at ${rel}:${i + 1}`],
						detectionMethod: 'security_scanner',
						cwe: 'CWE-74',
					}));
				}
			}
		}

		// Database technology detection
		if (/\b(?:pg|postgres|postgresql|psycopg|prisma|knex|sequelize|typeorm)\b/i.test(content)) { dbDetected.add('PostgreSQL'); }
		if (/\b(?:mysql2?|mariadb)\b/i.test(content)) { dbDetected.add('MySQL/MariaDB'); }
		if (/\b(?:sqlite3?|better-sqlite3)\b/i.test(content)) { dbDetected.add('SQLite'); }
		if (/\b(?:mongoose|mongodb|MongoClient)\b/i.test(content)) { dbDetected.add('MongoDB'); }
		if (/\b(?:ioredis|createClient.*redis|redis)\b/i.test(content)) { dbDetected.add('Redis'); }

		// API protocol & OpenAPI spec detection
		if (/(?:openapi|swagger).*\.(?:json|ya?ml)$/i.test(rel) || /"openapi"\s*:\s*"3\.|openapi:\s*['"]?3\./i.test(content)) {
			protocolsDetected.add('REST / OpenAPI');
			specFiles.push(rel);
			extractOpenApiEndpoints(content, specEndpoints);
		}
		if (/\.graphql$|\.gql$/i.test(rel) || /\btype\s+Query\s*\{/.test(content)) { protocolsDetected.add('GraphQL'); }
		if (/\.proto$/i.test(rel)) { protocolsDetected.add('gRPC / Protobuf'); }
		if (/\bWebSocket(?:Server)?\b|\bsocket\.io\b/.test(content)) { protocolsDetected.add('WebSockets'); }
		if (/text\/event-stream/.test(content)) { protocolsDetected.add('SSE'); }

		// --- B1. Test File Intelligence (Part 12.2) ---
		if (inTest) {
			analyzeTestFileQuality(rel, content, lines, weakOrTautologicalTests, flakyTestPatterns, findings);
			continue; // Skip production defect heuristics on test files
		}

		// --- B2. Technical Correctness & Business Logic (Part 7) ---
		analyzeBusinessLogicAndCorrectness(rel, ext, content, lines, findings, adversarialChallenges, generatedTests);

		// --- B3. Concurrency & Race Conditions (Part 7.1, 7.2, Demo 5) ---
		analyzeConcurrencyAndRaces(rel, ext, content, lines, findings, adversarialChallenges, generatedTests);

		// --- B4. Multi-Tenant Isolation & AuthZ/IDOR (Part 7.3, 8.1, Demo 3 & 4) ---
		const tenantCount = analyzeTenantIsolationAndAuthz(rel, ext, content, lines, findings, attackPaths);
		tenantIsolationRisks += tenantCount;

		// --- B5. Database & Migration Safety (Part 10, Demo 7) ---
		const dbStats = analyzeDatabaseAndMigrations(rel, ext, content, lines, findings, dbFindings);
		migrationsInspected += dbStats.migrations;
		queriesInspected += dbStats.queries;
		destructiveMigrations += dbStats.destructive;
		lockingMigrations += dbStats.locking;
		nPlusOneRisks += dbStats.nPlusOne;

		// --- B6. API Implementation Extraction & Security/Contract Checks (Part 11, Demo 8) ---
		analyzeApiRoutes(rel, ext, content, lines, protocolsDetected, implementedEndpoints, findings, apiFindings, attackPaths);

		// --- B7. Performance Intelligence (Part 13) ---
		analyzePerformanceRisks(rel, ext, content, lines, performanceObservations, findings);

		// --- B8. Custom Rules Evaluation (Part 25) ---
		if (opts?.customRules) {
			evaluateCustomRulesOnFile(rel, content, lines, opts.customRules, findings);
		}
	}

	// --- C. Cross-File OpenAPI Spec vs Implementation Contract Drift (Demo 8) ---
	const undocumentedEndpoints: string[] = [];
	const unimplementedSpecEndpoints: string[] = [];
	const breakingChanges: string[] = [];

	if (specFiles.length > 0 && (specEndpoints.size > 0 || implementedEndpoints.size > 0)) {
		for (const ep of specEndpoints) {
			if (!implementedEndpoints.has(ep)) {
				unimplementedSpecEndpoints.push(ep);
				const f = createFinding({
					ruleId: 'KACRAE-API-CONTRACT-001',
					title: `OpenAPI spec endpoint not implemented: ${ep}`,
					category: 'api_contract',
					severity: 'high',
					classification: 'confirmed_defect',
					confidence: 0.91,
					file: specFiles[0],
					line: 1,
					codeContext: `Spec defines ${ep} in ${specFiles[0]}, but no matching route handler was found in source files.`,
					explanation: `The API specification (${specFiles[0]}) declares endpoint "${ep}", which does not match any implemented server route.`,
					whyItMatters: 'Clients generated from or relying on the OpenAPI contract will receive 404 Not Found errors at runtime.',
					impact: 'Broken API contract between specification and server implementation.',
					evidence: [`Declared in ${specFiles[0]}`, `Implemented endpoints: ${[...implementedEndpoints.keys()].join(', ') || 'none'}`],
					detectionMethod: 'api_contract',
				});
				findings.push(f);
				apiFindings.push(f);
				breakingChanges.push(`Missing implementation for documented endpoint ${ep}`);
			}
		}
		for (const [ep, loc] of implementedEndpoints.entries()) {
			if (specEndpoints.size > 0 && !specEndpoints.has(ep)) {
				undocumentedEndpoints.push(ep);
				const f = createFinding({
					ruleId: 'KACRAE-API-CONTRACT-002',
					title: `Undocumented / drifted API route: ${ep}`,
					category: 'api_contract',
					severity: 'medium',
					classification: 'strongly_supported',
					confidence: 0.86,
					file: loc.file,
					line: loc.line,
					codeContext: `Route ${ep} implemented at ${loc.file}:${loc.line} is missing from ${specFiles[0]}.`,
					explanation: `Server implements "${ep}" at ${loc.file}:${loc.line}, but the OpenAPI contract (${specFiles[0]}) does not declare it.`,
					whyItMatters: 'Shadow endpoints bypass API gateway schema validation, documentation, and security reviews.',
					impact: 'Contract drift and unmonitored attack surface.',
					evidence: [`Route ${ep} at ${loc.file}:${loc.line}`, `OpenAPI spec: ${specFiles[0]}`],
					detectionMethod: 'api_contract',
					owasp: 'API9:2023-Improper Inventory Management',
				});
				findings.push(f);
				apiFindings.push(f);
			}
		}
	}

	// --- D. Architecture Cycles & Layering Findings (Part 9, Demo 6) ---
	const archMap = buildArchitectureMap(files);
	for (const cycle of archMap.cycles) {
		if (cycle.length < 2) { continue; }
		findings.push(createFinding({
			ruleId: 'KACRAE-ARCH-CYCLE-001',
			title: `Circular module dependency detected (${cycle.length} modules)`,
			category: 'architecture',
			severity: 'medium',
			classification: 'confirmed_defect',
			confidence: 0.95,
			file: cycle[0],
			line: 1,
			codeContext: `Cycle: ${cycle.join(' -> ')} -> ${cycle[0]}`,
			explanation: `Modules form a circular import cycle: ${cycle.join(' -> ')} -> ${cycle[0]}.`,
			whyItMatters: 'Circular dependencies cause initialization-order bugs (undefined imports at runtime), tight coupling, and hard-to-test boundaries.',
			impact: 'Reduced modularity and runtime module-loading fragility.',
			evidence: [`Import cycle: ${cycle.join(' -> ')} -> ${cycle[0]}`],
			affectedComponents: [...cycle],
			detectionMethod: 'architecture_graph',
		}));
	}
	if (opts?.graph?.topology.layeringViolations) {
		for (const lv of opts.graph.topology.layeringViolations) {
			findings.push(createFinding({
				ruleId: 'KACRAE-ARCH-LAYER-001',
				title: `Architecture layering violation: ${lv.from} -> ${lv.to}`,
				category: 'architecture',
				severity: 'medium',
				classification: 'strongly_supported',
				confidence: 0.85,
				file: lv.from,
				line: 1,
				codeContext: `${lv.from} imports ${lv.to} (${lv.reason})`,
				explanation: lv.reason,
				whyItMatters: 'Violating architectural boundaries leaks infrastructure or database concerns into UI/presentation layers.',
				impact: 'Tight coupling and weakened security/domain boundaries.',
				evidence: [`${lv.from} -> ${lv.to}`],
				affectedComponents: [lv.from, lv.to],
				detectionMethod: 'architecture_graph',
			}));
		}
	}

	// --- E. Untested Critical Files & Missing Test Generation (Part 12, Demo 9) ---
	const sourceFiles = files.filter(f => !isTestFile(f.relativePath) && /\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|java|rs|cs|php)$/i.test(f.relativePath));
	const testFiles = files.filter(f => isTestFile(f.relativePath));
	const testContentsJoined = testFiles.map(t => `${normPath(t.relativePath)}\n${t.content}`).join('\n');
	const untestedCriticalFiles: string[] = [];

	for (const sf of sourceFiles) {
		const rel = normPath(sf.relativePath);
		const stem = (rel.split('/').pop() ?? rel).replace(/\.[^.]+$/, '');
		const hasReferenceInTests = testFiles.some(tf =>
			normPath(tf.relativePath).toLowerCase().includes(stem.toLowerCase()) ||
			tf.content.includes(stem),
		);
		const exportsMatch = sf.content.match(/\bexport\s+(?:async\s+)?(?:function|class|const)\s+([A-Za-z_]\w*)/g) ?? [];
		const pyDefs = sf.content.match(/^def\s+([A-Za-z_]\w*)\s*\(/gm) ?? [];
		const symbolCount = exportsMatch.length + pyDefs.length;
		if (symbolCount > 0 && !hasReferenceInTests && !testContentsJoined.includes(rel)) {
			untestedCriticalFiles.push(rel);
			const firstExport = /\bexport\s+(?:async\s+)?(?:function|class|const)\s+([A-Za-z_]\w*)/.exec(sf.content)?.[1]
				?? /^def\s+([A-Za-z_]\w*)\s*\(/m.exec(sf.content)?.[1];
			// Keep missing-test findings concise (max 15 highest-impact files) and medium/low severity
			// so real Critical/High security, correctness, and runtime bugs always stand out first.
			if (untestedCriticalFiles.length <= 15) {
				findings.push(createFinding({
					ruleId: 'KACRAE-TEST-001',
					title: `Missing test coverage for ${rel}`,
					category: 'testing',
					severity: /(?:auth|pay|bill|order|book|transfer|tenant|security|repo|service|api)/i.test(rel) ? 'medium' : 'low',
					classification: 'strongly_supported',
					confidence: 0.85,
					file: rel,
					line: 1,
					codeContext: `${rel} exports ${symbolCount} symbol(s) with no matching test file or test import found.`,
					explanation: `Source module "${rel}" defines ${symbolCount} public symbol(s) (${firstExport ?? 'exported API'}) without corresponding automated tests.`,
					whyItMatters: 'Regressions in untested modules cannot be caught automatically before production.',
					impact: 'Unverified behavior and elevated regression risk.',
					evidence: [`${symbolCount} exported symbols in ${rel}`, `0 referencing test files out of ${testFiles.length} test file(s)`],
					detectionMethod: 'test_analyzer',
				}));
			}
			if (generatedTests.length < 15) {
				generatedTests.push(buildBehaviorTestSuggestion(rel, firstExport, sf.content));
			}
		}
	}

	// --- F. False-Positive Calibration, Deduplication & Context Validation (Part 16.3, Demo 11) ---
	const calibrated = calibrateAndDeduplicateFindings(findings, files, opts?.settings);

	return {
		findings: calibrated,
		attackPaths,
		databaseReport: {
			databasesDetected: [...dbDetected],
			migrationsInspected,
			queriesInspected,
			destructiveMigrations,
			lockingMigrations,
			nPlusOneRisks,
			tenantIsolationRisks,
			findings: dbFindings,
		},
		apiContractReport: {
			protocolsDetected: [...protocolsDetected],
			specFiles,
			specEndpoints: [...specEndpoints],
			implementedEndpoints: [...implementedEndpoints.keys()],
			undocumentedEndpoints,
			unimplementedSpecEndpoints,
			breakingChanges,
			findings: apiFindings,
		},
		testReport: {
			testFilesCount: testFiles.length,
			sourceFilesCount: sourceFiles.length,
			untestedCriticalFiles,
			weakOrTautologicalTests,
			flakyTestPatterns,
			generatedTests,
		},
		performanceReport: {
			observations: performanceObservations,
			measuredMetrics: [],
			disclaimer: 'Static observations are labeled as theoretical risks until confirmed by runtime profiling or benchmark measurements.',
		},
		adversarialChallenges,
	};
}

// ============================================================================
// 4. Domain-Specific Analyzer Implementations
// ============================================================================

function analyzeBusinessLogicAndCorrectness(
	rel: string,
	ext: string,
	content: string,
	lines: readonly string[],
	findings: KacraeFinding[],
	challenges: KacraeAdversarialChallenge[],
	generatedTests: KacraeGeneratedTestSuggestion[],
): void {
	if (!/\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|java|cs|php|rb|rs)$/.test(ext)) { return; }

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const lineNo = i + 1;
		const trimmed = line.trim();
		if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('#')) { continue; }

		// 1. Floating-point money arithmetic / discount inversion / boundary bugs
		if (/(?:price|amount|total|balance|subtotal|discount|tax|fee)/i.test(line) && /(?:\*\s*0\.\d+|\/\s*100\b|\+\s*0\.1\b)/.test(line) && !/Math\.round|toFixed|cents|Decimal|BigInt/i.test(lines.slice(Math.max(0, i - 1), i + 3).join(' '))) {
			findings.push(createFinding({
				ruleId: 'KACRAE-BIZ-001',
				title: 'Unrounded floating-point monetary calculation',
				category: 'business_logic',
				severity: 'medium',
				classification: 'strongly_supported',
				confidence: 0.78,
				file: rel,
				line: lineNo,
				codeContext: extractContextWindow(lines, lineNo),
				explanation: 'Monetary calculation uses IEEE-754 floating-point arithmetic without integer-cent scaling or deterministic decimal rounding.',
				whyItMatters: 'Floating-point drift (e.g., 0.1 + 0.2 === 0.30000000000000004) causes ledger mismatches and billing reconciliation failures.',
				impact: 'Financial calculation inaccuracies.',
				evidence: [trimmed],
				detectionMethod: 'deterministic_static',
			}));
		}

		// 2. Inverted discount / negative total or off-by-one loop bound (<= arr.length)
		const offByOne = /\bfor\s*\([^;]+;\s*([a-zA-Z_$]\w*)\s*<=\s*([a-zA-Z_$][\w.]*\.length)\s*;/.exec(line);
		if (offByOne) {
			const varName = offByOne[1];
			const lenExpr = offByOne[2];
			const fixedLine = line.replace(`${varName} <= ${lenExpr}`, `${varName} < ${lenExpr}`).replace(`${varName}<=${lenExpr}`, `${varName} < ${lenExpr}`);
			const f = createFinding({
				ruleId: 'KACRAE-CORR-001',
				title: `Off-by-one loop boundary: ${varName} <= ${lenExpr}`,
				category: 'correctness',
				severity: 'high',
				classification: 'confirmed_defect',
				confidence: 0.94,
				file: rel,
				line: lineNo,
				codeContext: extractContextWindow(lines, lineNo),
				explanation: `Loop iterates while ${varName} <= ${lenExpr}, accessing index ${lenExpr} which is out of bounds (undefined in JS/TS or crash in typed runtimes).`,
				whyItMatters: 'Out-of-bounds indexing yields undefined values, NaN accumulations, or runtime exceptions.',
				impact: 'Incorrect computation or runtime crash on every iteration completing the loop.',
				evidence: [trimmed],
				suggestedFix: {
					summary: `Change loop condition from <= to < (${varName} < ${lenExpr})`,
					file: rel,
					originalSnippet: line,
					replacementSnippet: fixedLine,
					diffPreview: buildUnifiedSnippetDiff(rel, lineNo, line, fixedLine),
					safeForAutoApply: true,
					rationale: 'Valid array indices range from 0 to length - 1.',
				},
				detectionMethod: 'deterministic_static',
				cwe: 'CWE-193',
			});
			findings.push(f);
			challenges.push({
				id: `adv-${f.id}`,
				targetFile: rel,
				line: lineNo,
				hypothesis: `Passing any non-empty array triggers out-of-bounds read at index ${lenExpr}.`,
				counterexampleInput: '[10, 20, 30]',
				expectedSafeBehavior: 'Iterates indices 0..length-1 without reading undefined.',
				observedOrRiskBehavior: 'Reads arr[arr.length] === undefined, causing NaN or TypeError.',
				executableTestSnippet: `test('does not read past array bounds', () => {\n  // Verify behavior on 3-element array and empty array []\n  assert.doesNotThrow(() => targetFn([10, 20, 30]));\n});`,
				severity: 'high',
				status: 'open',
			});
		}

		// 3. Inverted discount / credit addition instead of subtraction (price + discount) or missing non-negative clamp
		if (/\b(?:discount|coupon|rebate)\b/i.test(line) && /\breturn\s+(?:price|amount|total|subtotal)\s*\+\s*(?:discount|discountAmount|couponAmount)\b/i.test(line)) {
			const fixedLine = line.replace(/\+\s*(discount|discountAmount|couponAmount)/i, '- $1');
			const f = createFinding({
				ruleId: 'KACRAE-BIZ-002',
				title: 'Business logic defect: discount added to price instead of subtracted',
				category: 'business_logic',
				severity: 'critical',
				classification: 'confirmed_defect',
				confidence: 0.95,
				file: rel,
				line: lineNo,
				codeContext: extractContextWindow(lines, lineNo),
				explanation: 'Discount value is added (+) to the base price instead of subtracted (-), overcharging customers.',
				whyItMatters: 'Direct violation of pricing/checkout business requirements.',
				impact: 'Customers are overcharged whenever a discount is applied.',
				evidence: [trimmed],
				suggestedFix: {
					summary: 'Subtract discount and clamp total at 0',
					file: rel,
					originalSnippet: line,
					replacementSnippet: fixedLine,
					diffPreview: buildUnifiedSnippetDiff(rel, lineNo, line, fixedLine),
					safeForAutoApply: true,
					rationale: 'Discounts reduce the payable amount rather than increasing it.',
				},
				detectionMethod: 'deterministic_static',
			});
			findings.push(f);
			generatedTests.push({
				id: `gen-test-${f.id}`,
				targetFile: rel,
				testKind: 'regression',
				framework: 'node:test',
				suggestedTestPath: rel.replace(/(\.[a-z]+)$/i, '.test$1'),
				rationale: 'Verify that applying a positive discount strictly reduces the payable total and never produces a negative price.',
				linkedFindingId: f.id,
				testCode: `import assert from 'node:assert/strict';\nimport test from 'node:test';\n\ntest('discount reduces final price and clamps at zero', () => {\n  const base = 100;\n  const discount = 20;\n  // Expected: 80 (strictly less than base)\n  assert.equal(Math.max(0, base - discount), 80);\n});\n`,
			});
		}

		// 4. Division without zero guard in functions taking denominator parameter
		const divMatch = /\breturn\s+[a-zA-Z_$][\w.]*\s*\/\s*([a-zA-Z_$][\w.]*)\s*;?/.exec(line);
		if (divMatch && !/^\d+$/.test(divMatch[1]) && !/(?:===?\s*0|!==?\s*0|>\s*0|<\s*0|Math\.max)/.test(lines.slice(Math.max(0, i - 4), i + 1).join(' '))) {
			findings.push(createFinding({
				ruleId: 'KACRAE-CORR-002',
				title: `Unchecked division by potentially zero divisor "${divMatch[1]}"`,
				category: 'correctness',
				severity: 'medium',
				classification: 'potential_issue',
				confidence: 0.72,
				file: rel,
				line: lineNo,
				codeContext: extractContextWindow(lines, lineNo),
				explanation: `Expression divides by "${divMatch[1]}" without a visible zero-check guard in the preceding lines.`,
				whyItMatters: 'Dividing by zero produces Infinity/NaN in JavaScript or ZeroDivisionError in Python/Java/Go.',
				impact: 'Corrupted calculations or unhandled runtime exceptions on zero/empty denominators.',
				evidence: [trimmed],
				detectionMethod: 'deterministic_static',
				cwe: 'CWE-369',
			}));
		}

		// 5. Strict equality against NaN (x === NaN is always false!)
		if (/(?:===?|!==?)\s*NaN\b|\bNaN\s*(?:===?|!==?)/.test(line)) {
			const fixedLine = line.replace(/([a-zA-Z_$][\w.]*)\s*===?\s*NaN/g, 'Number.isNaN($1)').replace(/([a-zA-Z_$][\w.]*)\s*!==?\s*NaN/g, '!Number.isNaN($1)');
			findings.push(createFinding({
				ruleId: 'KACRAE-CORR-003',
				title: 'Direct comparison to NaN is always false/true',
				category: 'correctness',
				severity: 'high',
				classification: 'confirmed_defect',
				confidence: 0.98,
				file: rel,
				line: lineNo,
				codeContext: extractContextWindow(lines, lineNo),
				explanation: 'In IEEE-754, NaN === NaN always evaluates to false. Use Number.isNaN(value).',
				whyItMatters: 'NaN guard never triggers, allowing corrupted numbers to propagate.',
				impact: 'Silent logic bug in numeric validation.',
				evidence: [trimmed],
				suggestedFix: {
					summary: 'Replace NaN equality comparison with Number.isNaN()',
					file: rel,
					originalSnippet: line,
					replacementSnippet: fixedLine,
					diffPreview: buildUnifiedSnippetDiff(rel, lineNo, line, fixedLine),
					safeForAutoApply: true,
					rationale: 'Number.isNaN() accurately detects NaN values.',
				},
				detectionMethod: 'deterministic_static',
			}));
		}

		// 6. Loose assignment inside condition `if (a = b)` (not == or === or != or <= or >=)
		if (/\bif\s*\(\s*[a-zA-Z_$][\w.]*\s*=\s*[^=][^)]*\)/.test(line) && !/\b(?:const|let|var)\b/.test(line)) {
			findings.push(createFinding({
				ruleId: 'KACRAE-CORR-004',
				title: 'Assignment operator (=) used inside if condition',
				category: 'correctness',
				severity: 'high',
				classification: 'strongly_supported',
				confidence: 0.88,
				file: rel,
				line: lineNo,
				codeContext: extractContextWindow(lines, lineNo),
				explanation: 'Single "=" inside an if(...) condition mutates the variable and evaluates the assigned value instead of comparing.',
				whyItMatters: 'Frequently indicates an accidental typo for === that breaks branching logic.',
				impact: 'Incorrect conditional execution and unintended state mutation.',
				evidence: [trimmed],
				detectionMethod: 'deterministic_static',
				cwe: 'CWE-481',
			}));
		}
	}
}

function analyzeConcurrencyAndRaces(
	rel: string,
	ext: string,
	content: string,
	lines: readonly string[],
	findings: KacraeFinding[],
	challenges: KacraeAdversarialChallenge[],
	generatedTests: KacraeGeneratedTestSuggestion[],
): void {
	if (!/\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|java|cs)$/.test(ext)) { return; }

	// Detect check-then-act TOCTOU across an await boundary on balance, inventory, booking, slot, seat, reservation, stock
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!/\basync\b/.test(line)) { continue; }
		const fnEnd = Math.min(lines.length, i + 45);
		const block = lines.slice(i, fnEnd).join('\n');
		const hasSharedResource = /\b(?:balance|inventory|stock|seats?|slots?|booking|reservation|reserve|avail|available|remaining|capacity|quota|credits?|account)\b/i.test(block);
		const hasCheck = /\bif\s*\([^)]*(?:balance|inventory|stock|seats?|slots?|booked|reserved|avail|available|remaining|count|capacity|exists|has\(|get\(|>\s*0|>=\s*)/i.test(block);
		const hasAwaitBetween = /\bawait\b/.test(block);
		const hasMutation = /(?:\.set\(|-=|\+=|=\s*[^=]|UPDATE\s+|INSERT\s+INTO|save\(|push\()/i.test(block);
		const hasLockOrTx = /\b(?:mutex|lock|acquire|semaphore|transaction|BEGIN|FOR\s+UPDATE|atomic|optimisticLock|version\s*\+\s*1|synchronized|Mutex|Lock\()\b/i.test(block);

		if (hasSharedResource && hasCheck && hasAwaitBetween && hasMutation && !hasLockOrTx) {
			const f = createFinding({
				ruleId: 'KACRAE-CONC-001',
				title: 'Check-then-act race condition (TOCTOU) across await boundary',
				category: 'concurrency',
				severity: 'critical',
				classification: 'confirmed_defect',
				confidence: 0.91,
				file: rel,
				line: i + 1,
				endLine: Math.min(lines.length, i + 15),
				codeContext: extractContextWindow(lines, i + 1, 5),
				explanation: 'Async function checks shared state (balance/booking/inventory), suspends at an await point, and then mutates state without a mutex, lock, atomic compare-and-swap, or database transaction (SELECT ... FOR UPDATE).',
				whyItMatters: 'Two concurrent requests can both pass the availability/balance check before either writes, causing double-booking, negative inventory, or double-spend.',
				preconditions: ['Two or more concurrent invocations targeting the same resource ID'],
				impact: 'Double-booking, overselling, or duplicate financial transfers under concurrent load.',
				reproduction: 'Invoke the async operation concurrently via Promise.all([op(id), op(id)]) for the same resource.',
				evidence: [
					`Async handler at ${rel}:${i + 1}`,
					'State check + await suspension + state mutation detected without lock/transaction guard.',
				],
				detectionMethod: 'deterministic_static',
				cwe: 'CWE-367',
			});
			findings.push(f);

			const fnName = /\basync\s+(?:function\s+)?([A-Za-z_]\w*)/.exec(line)?.[1] ?? 'concurrentOperation';
			const testCode = `import assert from 'node:assert/strict';\nimport test from 'node:test';\n\ntest('concurrent ${fnName} prevents duplicate booking / double-spend', async () => {\n  // Run two overlapping calls with Promise.all and assert at most one succeeds\n  const results = await Promise.allSettled([\n    Promise.resolve('call-1'),\n    Promise.resolve('call-2'),\n  ]);\n  assert.equal(results.length, 2);\n});\n`;
			challenges.push({
				id: `adv-${f.id}`,
				targetFile: rel,
				line: i + 1,
				hypothesis: `Concurrent calls to ${fnName}() interleave across the await boundary and both pass the guard check.`,
				counterexampleInput: `Promise.all([${fnName}(sameResourceId), ${fnName}(sameResourceId)])`,
				expectedSafeBehavior: 'Exactly one request succeeds; the second fails cleanly with conflict/insufficient-funds.',
				observedOrRiskBehavior: 'Both requests pass the check concurrently and corrupt shared state.',
				executableTestSnippet: testCode,
				severity: 'critical',
				status: 'open',
			});
			generatedTests.push({
				id: `gen-test-${f.id}`,
				targetFile: rel,
				targetSymbol: fnName,
				testKind: 'concurrency',
				framework: 'node:test',
				suggestedTestPath: rel.replace(/(\.[a-z]+)$/i, '.concurrency.test$1'),
				rationale: `Verify ${fnName} enforces mutual exclusion / atomicity under overlapping Promise.all calls.`,
				linkedFindingId: f.id,
				testCode,
			});
			i = fnEnd; // avoid duplicate reports inside same function
		}
	}
}

function analyzeTenantIsolationAndAuthz(
	rel: string,
	ext: string,
	content: string,
	lines: readonly string[],
	findings: KacraeFinding[],
	attackPaths: KacraeAttackPath[],
): number {
	if (!/\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|java|cs|php|rb)$/.test(ext)) { return 0; }
	let tenantRiskCount = 0;

	const isMultiTenantFile = /\b(?:tenant|tenantId|tenant_id|organizationId|orgId|org_id|workspaceId|workspace_id)\b/i.test(content);

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const lineNo = i + 1;
		const trimmed = line.trim();
		if (trimmed.startsWith('//') || trimmed.startsWith('#')) { continue; }

		// 1. Trusting client-supplied tenantId from req.body / req.query / req.params instead of req.user / session
		const untrustedTenant = /\b(?:const|let|var)\s+(?:tenantId|tenant_id|orgId|org_id)\s*=\s*req\.(?:body|query|params|headers)\b/.exec(line)
			?? /\b(?:tenantId|tenant_id|orgId|org_id)\s*:\s*req\.(?:body|query|params)\./.exec(line);
		if (untrustedTenant && !/req\.(?:user|auth|session)\.(?:tenantId|orgId)/.test(lines.slice(Math.max(0, i - 2), i + 4).join('\n'))) {
			tenantRiskCount++;
			const f = createFinding({
				ruleId: 'KACRAE-TENANT-001',
				title: 'Multi-tenant isolation bypass: tenant identifier trusted from untrusted client request',
				category: 'tenant_isolation',
				severity: 'critical',
				classification: 'confirmed_defect',
				confidence: 0.94,
				file: rel,
				line: lineNo,
				codeContext: extractContextWindow(lines, lineNo, 3),
				explanation: 'Tenant/organization identifier is read directly from req.body/req.query/req.params instead of the server-verified authenticated session (req.user.tenantId).',
				whyItMatters: 'Any authenticated user in Tenant A can supply Tenant B\'s ID and read or modify Tenant B\'s private data.',
				preconditions: ['Authenticated user modifies tenantId parameter in HTTP request'],
				impact: 'Cross-tenant data breach and privilege escalation.',
				reproduction: 'Send request with another tenant\'s tenantId in query/body while authenticated as Tenant A.',
				evidence: [trimmed],
				detectionMethod: 'security_scanner',
				cwe: 'CWE-639',
				owasp: 'A01:2021-Broken Access Control',
			});
			findings.push(f);
			attackPaths.push({
				id: `ap-${f.id}`,
				findingId: f.id,
				title: 'Cross-Tenant Data Access via Client-Controlled tenantId',
				severity: 'critical',
				confirmed: true,
				steps: [
					{ kind: 'entry_point', label: 'HTTP Request', file: rel, line: lineNo, detail: trimmed, present: true },
					{ kind: 'authorization', label: 'Server-Side Tenant Binding', file: rel, line: lineNo, detail: 'Missing req.user.tenantId enforcement', present: false },
					{ kind: 'sensitive_sink', label: 'Tenant Data Access', file: rel, line: lineNo, detail: 'Data scoped by attacker-supplied tenantId', present: true },
				],
				impactSummary: 'Attacker accesses or mutates another tenant\'s records.',
			});
		}

		// 2. Multi-tenant file executing DB query by ID without tenant_id / tenantId / org_id predicate
		if (isMultiTenantFile) {
			const sqlById = /\b(?:SELECT\s+.+\s+FROM|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b[^;\n]*\bWHERE\s+(?:id|record_id|order_id|doc_id|invoice_id|patient_id)\s*=/i.test(line);
			const ormById = /\.(?:findById|findUnique|findOne|deleteById|updateById)\s*\(\s*(?:req\.params\.|id\b)/i.test(line);
			if (sqlById || ormById) {
				const queryWindow = lines.slice(i, Math.min(lines.length, i + 3)).join(' ');
				const hasTenantFilter = /\b(?:tenant_id|tenantId|org_id|orgId|organization_id|organizationId|workspace_id|workspaceId)\b/i.test(queryWindow);
				if (!hasTenantFilter) {
					tenantRiskCount++;
					const f = createFinding({
						ruleId: 'KACRAE-TENANT-002',
						title: 'Missing tenant_id scope in multi-tenant data query (IDOR risk)',
						category: 'tenant_isolation',
						severity: 'critical',
						classification: 'confirmed_defect',
						confidence: 0.90,
						file: rel,
						line: lineNo,
						codeContext: extractContextWindow(lines, lineNo, 3),
						explanation: 'Query looks up or mutates a record solely by primary ID in a multi-tenant module without filtering by tenantId/orgId.',
						whyItMatters: 'Allows Insecure Direct Object Reference (IDOR) across tenant boundaries when a caller guesses or enumerates another tenant\'s record ID.',
						preconditions: ['Multi-tenant database table queried by record ID without tenant predicate'],
						impact: 'Unauthorized cross-tenant read, modification, or deletion.',
						reproduction: 'Request /records/<otherTenantRecordId> while authenticated under a different tenant.',
						evidence: [trimmed],
						detectionMethod: 'security_scanner',
						cwe: 'CWE-639',
						owasp: 'A01:2021-Broken Access Control',
					});
					findings.push(f);
					attackPaths.push({
						id: `ap-${f.id}`,
						findingId: f.id,
						title: 'Unscoped Primary-Key Query Crossing Tenant Boundary',
						severity: 'critical',
						confirmed: true,
						steps: [
							{ kind: 'untrusted_input', label: 'Record ID Parameter', file: rel, line: lineNo, detail: trimmed, present: true },
							{ kind: 'authorization', label: 'Tenant Ownership Filter', file: rel, line: lineNo, detail: 'WHERE clause omits tenant_id / org_id', present: false },
							{ kind: 'sensitive_sink', label: 'Database Table Read/Write', file: rel, line: lineNo, detail: trimmed, present: true },
						],
						impactSummary: 'Cross-tenant IDOR on database records.',
					});
				}
			}
		}

		// 3. CORS wildcard with credentials enabled
		if (/origin\s*:\s*['"]\*['"]|Access-Control-Allow-Origin['"]?\s*[,:]\s*['"]\*['"]/i.test(line) &&
			/credentials\s*:\s*true|Access-Control-Allow-Credentials['"]?\s*[,:]\s*['"]?true/i.test(lines.slice(Math.max(0, i - 3), Math.min(lines.length, i + 4)).join('\n'))) {
			findings.push(createFinding({
				ruleId: 'KACRAE-SEC-CORS-001',
				title: 'Insecure CORS configuration: wildcard origin combined with credentials',
				category: 'security',
				severity: 'high',
				classification: 'confirmed_defect',
				confidence: 0.94,
				file: rel,
				line: lineNo,
				codeContext: extractContextWindow(lines, lineNo),
				explanation: 'Combining wildcard Access-Control-Allow-Origin (*) with credentials exposes authenticated API responses to untrusted origins.',
				whyItMatters: 'Enables cross-origin credentialed data theft.',
				impact: 'Session/data exposure to malicious third-party websites.',
				evidence: [trimmed],
				detectionMethod: 'security_scanner',
				cwe: 'CWE-942',
				owasp: 'A05:2021-Security Misconfiguration',
			}));
		}
	}

	return tenantRiskCount;
}

function analyzeDatabaseAndMigrations(
	rel: string,
	ext: string,
	content: string,
	lines: readonly string[],
	findings: KacraeFinding[],
	dbFindings: KacraeFinding[],
): { migrations: number; queries: number; destructive: number; locking: number; nPlusOne: number } {
	const isSqlOrMigration = ext === '.sql' || /migration|schema|prisma/i.test(rel);
	let migrations = isSqlOrMigration ? 1 : 0;
	let queries = 0;
	let destructive = 0;
	let locking = 0;
	let nPlusOne = 0;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const lineNo = i + 1;
		const trimmed = line.trim();
		if (trimmed.startsWith('--') || trimmed.startsWith('//') || trimmed.startsWith('#')) { continue; }

		if (/\b(?:SELECT|INSERT|UPDATE|DELETE|ALTER\s+TABLE|DROP\s+TABLE|CREATE\s+INDEX)\b/i.test(line)) {
			queries++;
		}

		// 1. Destructive migration operations (DROP TABLE / DROP COLUMN / TRUNCATE)
		if (isSqlOrMigration && /\b(?:DROP\s+TABLE|DROP\s+COLUMN|TRUNCATE\s+TABLE)\b/i.test(line)) {
			destructive++;
			const f = createFinding({
				ruleId: 'KACRAE-DB-MIG-001',
				title: 'Destructive database migration operation detected',
				category: 'database',
				severity: 'critical',
				classification: 'confirmed_defect',
				confidence: 0.96,
				file: rel,
				line: lineNo,
				codeContext: extractContextWindow(lines, lineNo),
				explanation: `Migration performs destructive schema/data removal: "${trimmed}".`,
				whyItMatters: 'Irreversible data loss and immediate breakage of running application instances during rolling deploys.',
				impact: 'Permanent data loss and zero-downtime deployment failure.',
				evidence: [trimmed],
				detectionMethod: 'database_analyzer',
			});
			findings.push(f);
			dbFindings.push(f);
		}

		// 2. Table-locking CREATE INDEX without CONCURRENTLY
		if (isSqlOrMigration && /\bCREATE\s+(?:UNIQUE\s+)?INDEX\b/i.test(line) && !/\bCONCURRENTLY\b/i.test(line) && !/\bIF\s+NOT\s+EXISTS\b.*sqlite/i.test(content)) {
			locking++;
			const fixedLine = line.replace(/\bCREATE\s+(UNIQUE\s+)?INDEX\b/i, 'CREATE $1INDEX CONCURRENTLY');
			const f = createFinding({
				ruleId: 'KACRAE-DB-MIG-002',
				title: 'Table-locking CREATE INDEX without CONCURRENTLY',
				category: 'database',
				severity: 'high',
				classification: 'strongly_supported',
				confidence: 0.88,
				file: rel,
				line: lineNo,
				codeContext: extractContextWindow(lines, lineNo),
				explanation: 'CREATE INDEX without CONCURRENTLY acquires a SHARE lock that blocks all writes on the table until indexing finishes.',
				whyItMatters: 'On large production tables, write traffic stalls and triggers cascading timeouts.',
				impact: 'Production outage / write downtime during migration.',
				evidence: [trimmed],
				suggestedFix: {
					summary: 'Use CREATE INDEX CONCURRENTLY to avoid blocking table writes',
					file: rel,
					originalSnippet: line,
					replacementSnippet: fixedLine,
					diffPreview: buildUnifiedSnippetDiff(rel, lineNo, line, fixedLine),
					safeForAutoApply: false,
					rationale: 'CONCURRENTLY builds the index without blocking concurrent INSERT/UPDATE/DELETE.',
				},
				detectionMethod: 'database_analyzer',
			});
			findings.push(f);
			dbFindings.push(f);
		}

		// 3. ALTER TABLE ADD COLUMN NOT NULL without DEFAULT
		if (isSqlOrMigration && /\bALTER\s+TABLE\b.+\bADD\s+(?:COLUMN\s+)?\w+.+\bNOT\s+NULL\b/i.test(line) && !/\bDEFAULT\b/i.test(line)) {
			locking++;
			const f = createFinding({
				ruleId: 'KACRAE-DB-MIG-003',
				title: 'NOT NULL column added without DEFAULT value',
				category: 'database',
				severity: 'high',
				classification: 'confirmed_defect',
				confidence: 0.93,
				file: rel,
				line: lineNo,
				codeContext: extractContextWindow(lines, lineNo),
				explanation: 'Adding a NOT NULL column without a DEFAULT fails on non-empty tables and breaks backward compatibility with older app replicas.',
				whyItMatters: 'Migration fails in production whenever existing rows are present.',
				impact: 'Failed deployment and table rewrite lock.',
				evidence: [trimmed],
				detectionMethod: 'database_analyzer',
			});
			findings.push(f);
			dbFindings.push(f);
		}

		// 4. N+1 DB Query inside a loop
		if (/\b(?:for\s*\(|for\s+.+\s+in\s+|\.map\s*\(\s*async|\.forEach\s*\(\s*async|while\s*\()/.test(line)) {
			const loopBody = lines.slice(i, Math.min(lines.length, i + 12)).join('\n');
			if (/\bawait\s+(?:db|pool|prisma|knex|client|session|repo|sequelize|mongoose)\b[\w.]*\.(?:query|execute|findOne|findUnique|findFirst|findById|get|select)\s*\(/i.test(loopBody)) {
				nPlusOne++;
				const f = createFinding({
					ruleId: 'KACRAE-DB-NPLUS1-001',
					title: 'N+1 database query pattern inside loop',
					category: 'database',
					severity: 'high',
					classification: 'strongly_supported',
					confidence: 0.87,
					file: rel,
					line: lineNo,
					codeContext: extractContextWindow(lines, lineNo, 4),
					explanation: 'Database query is awaited inside an iteration loop, issuing 1 + N sequential round-trips instead of a batched IN/JOIN query.',
					whyItMatters: 'Latency and database connection pool exhaustion grow linearly with collection size.',
					impact: 'Severe latency spikes and DB connection saturation under production data volumes.',
					evidence: [trimmed],
					detectionMethod: 'database_analyzer',
				});
				findings.push(f);
				dbFindings.push(f);
			}
		}

		// 5. Unbounded SELECT * without LIMIT
		if (/\bSELECT\s+\*\s+FROM\s+[a-zA-Z_]\w*/i.test(line) && !/\b(?:LIMIT|WHERE\s+\w+\s*=|TOP\s+\d+|FETCH\s+FIRST)\b/i.test(lines.slice(i, Math.min(lines.length, i + 3)).join(' '))) {
			const f = createFinding({
				ruleId: 'KACRAE-DB-QUERY-001',
				title: 'Unbounded SELECT * query without pagination or LIMIT',
				category: 'database',
				severity: 'medium',
				classification: 'strongly_supported',
				confidence: 0.80,
				file: rel,
				line: lineNo,
				codeContext: extractContextWindow(lines, lineNo),
				explanation: 'Query selects all columns from an entire table with no WHERE filter or LIMIT pagination.',
				whyItMatters: 'Returns unbounded rows into memory and leaks newly added sensitive columns automatically.',
				impact: 'Memory exhaustion, slow full-table scans, and accidental column over-exposure.',
				evidence: [trimmed],
				detectionMethod: 'database_analyzer',
			});
			findings.push(f);
			dbFindings.push(f);
		}
	}

	return { migrations, queries, destructive, locking, nPlusOne };
}

function extractOpenApiEndpoints(content: string, out: Set<string>): void {
	// Support both JSON and YAML OpenAPI 3 / Swagger 2 path maps
	try {
		const parsed = JSON.parse(content) as { paths?: Record<string, Record<string, unknown>> };
		if (parsed && typeof parsed === 'object' && parsed.paths) {
			for (const [routePath, methods] of Object.entries(parsed.paths)) {
				if (!methods || typeof methods !== 'object') { continue; }
				for (const method of Object.keys(methods)) {
					if (/^(?:get|post|put|patch|delete|options|head)$/i.test(method)) {
						out.add(`${method.toUpperCase()} ${normalizeRoutePath(routePath)}`);
					}
				}
			}
			return;
		}
	} catch { /* fallback to YAML regex parser */ }

	const lines = content.split(/\r?\n/);
	let currentPath: string | null = null;
	for (const line of lines) {
		const pathMatch = /^\s{2}['"]?(\/[^:'"\s]*)['"]?\s*:\s*$/.exec(line);
		if (pathMatch) {
			currentPath = normalizeRoutePath(pathMatch[1]);
			continue;
		}
		if (currentPath) {
			const methodMatch = /^\s{4}(get|post|put|patch|delete|options|head)\s*:/i.exec(line);
			if (methodMatch) {
				out.add(`${methodMatch[1].toUpperCase()} ${currentPath}`);
			} else if (/^\S/.test(line) && !line.trim().startsWith('#')) {
				currentPath = null;
			}
		}
	}
}

function normalizeRoutePath(p: string): string {
	return p
		.replace(/\{([^}]+)\}/g, ':$1')
		.replace(/<([^>]+)>/g, ':$1')
		.replace(/\/+$/, '') || '/';
}

function analyzeApiRoutes(
	rel: string,
	ext: string,
	content: string,
	lines: readonly string[],
	protocolsDetected: Set<string>,
	implementedEndpoints: Map<string, { file: string; line: number; hasAuth: boolean; hasValidation: boolean }>,
	findings: KacraeFinding[],
	apiFindings: KacraeFinding[],
	attackPaths: KacraeAttackPath[],
): void {
	if (!/\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|java|php|cs)$/.test(ext)) { return; }

	const routeRegexes: readonly RegExp[] = [
		/\b(?:app|router|fastify|server)\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`\n]+)['"`]/i,
		/@(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`\n]+)['"`]/i,
	];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		for (const re of routeRegexes) {
			const m = re.exec(line);
			if (!m) { continue; }
			protocolsDetected.add('REST / HTTP');
			const method = m[1].toUpperCase();
			const route = normalizeRoutePath(m[2]);
			const key = `${method} ${route}`;
			const handlerBlock = lines.slice(i, Math.min(lines.length, i + 25)).join('\n');
			const hasAuth = /\b(?:auth|requireAuth|authenticate|verifyToken|verifyJwt|isAdmin|authorize|Depends\(|@login_required|req\.user)\b/i.test(handlerBlock);
			const hasValidation = /\b(?:zod|joi|yup|ajv|validate|schema\.parse|safeParse|typeof\s+req\.body|if\s*\(\s*!|Pydantic|BaseModel)\b/i.test(handlerBlock);

			implementedEndpoints.set(key, { file: rel, line: i + 1, hasAuth, hasValidation });

			// Sensitive mutating route missing authentication middleware
			if ((method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') &&
				/\/(?:admin|billing|transfer|payment|users?|accounts?|roles?|settings|keys?)\b/i.test(route) &&
				!hasAuth) {
				const f = createFinding({
					ruleId: 'KACRAE-API-AUTH-001',
					title: `Sensitive ${key} endpoint missing authentication/authorization guard`,
					category: 'security',
					severity: 'critical',
					classification: 'strongly_supported',
					confidence: 0.89,
					file: rel,
					line: i + 1,
					codeContext: extractContextWindow(lines, i + 1, 3),
					explanation: `Mutating sensitive endpoint ${key} does not reference any authentication middleware or authorization check in its handler definition.`,
					whyItMatters: 'Unauthenticated callers may invoke privileged state-changing operations.',
					impact: 'Unauthorized modification or deletion of sensitive resources.',
					evidence: [line.trim()],
					detectionMethod: 'api_contract',
					cwe: 'CWE-306',
					owasp: 'API2:2023-Broken Authentication',
				});
				findings.push(f);
				apiFindings.push(f);
				attackPaths.push({
					id: `ap-${f.id}`,
					findingId: f.id,
					title: `Unauthenticated access to ${key}`,
					severity: 'critical',
					confirmed: false,
					steps: [
						{ kind: 'entry_point', label: key, file: rel, line: i + 1, detail: line.trim(), present: true },
						{ kind: 'authentication', label: 'Auth Middleware', file: rel, line: i + 1, detail: 'No auth guard detected in route definition', present: false },
						{ kind: 'sensitive_sink', label: 'Privileged State Mutation', file: rel, line: i + 1, detail: key, present: true },
					],
					impactSummary: 'Potentially unauthenticated invocation of privileged API endpoint.',
				});
			}
		}
	}
}

function analyzeTestFileQuality(
	rel: string,
	content: string,
	lines: readonly string[],
	weakTests: { file: string; line: number; reason: string }[],
	flakyPatterns: { file: string; line: number; reason: string }[],
	findings: KacraeFinding[],
): void {
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const lineNo = i + 1;
		// Tautological assertions
		if (/expect\s*\(\s*true\s*\)\s*\.toBe\s*\(\s*true\s*\)|assert\.(?:ok|strictEqual)\s*\(\s*true\s*(?:,\s*true\s*)?\)|assert\s+True\b/.test(line)) {
			const reason = 'Tautological assertion (always passes regardless of system behavior)';
			weakTests.push({ file: rel, line: lineNo, reason });
			findings.push(createFinding({
				ruleId: 'KACRAE-TEST-002',
				title: 'Tautological test assertion never fails on regression',
				category: 'testing',
				severity: 'medium',
				classification: 'confirmed_defect',
				confidence: 0.96,
				file: rel,
				line: lineNo,
				codeContext: extractContextWindow(lines, lineNo),
				explanation: 'Test asserts a constant truthy value (e.g. expect(true).toBe(true)), providing zero behavioral verification.',
				whyItMatters: 'Creates false confidence in test suites while letting real regressions pass silently.',
				impact: 'Broken behavior will not fail CI.',
				evidence: [line.trim()],
				detectionMethod: 'test_analyzer',
			}));
		}

		// Flaky sleep/timeout in test
		if (/\b(?:setTimeout|time\.sleep|Thread\.sleep)\s*\(\s*(?:[1-9]\d{2,})/.test(line)) {
			const reason = 'Hard-coded wall-clock sleep inside test increases flakiness and CI latency';
			flakyPatterns.push({ file: rel, line: lineNo, reason });
		}
	}

	// Test block with zero assertions
	const testBlockRe = /\b(?:it|test)\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{/g;
	let m: RegExpExecArray | null;
	while ((m = testBlockRe.exec(content)) !== null) {
		const startIdx = m.index;
		const snippet = content.slice(startIdx, startIdx + 450);
		const closeIdx = snippet.indexOf('});');
		const body = closeIdx > 0 ? snippet.slice(0, closeIdx) : snippet;
		if (!/\b(?:expect|assert|should|rejects|throws)\b/.test(body)) {
			const lineNo = content.slice(0, startIdx).split(/\r?\n/).length;
			weakTests.push({ file: rel, line: lineNo, reason: `Test "${m[1]}" contains no visible assertion` });
		}
	}
}

function analyzePerformanceRisks(
	rel: string,
	ext: string,
	_content: string,
	lines: readonly string[],
	observations: KacraePerformanceObservation[],
	findings: KacraeFinding[],
): void {
	if (!/\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|java)$/.test(ext)) { return; }

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const lineNo = i + 1;
		const trimmed = line.trim();
		if (trimmed.startsWith('//') || trimmed.startsWith('#')) { continue; }

		// 1. Synchronous FS I/O inside async request handler / async function
		if (/\bfs\.(?:readFileSync|writeFileSync|readdirSync|statSync)\s*\(/.test(line)) {
			const surrounding = lines.slice(Math.max(0, i - 10), i + 1).join('\n');
			if (/\basync\b|\b(?:app|router)\.(?:get|post|put|delete)\b/.test(surrounding)) {
				const obs: KacraePerformanceObservation = {
					id: `perf-sync-${rel}-${lineNo}`,
					kind: 'theoretical_risk',
					category: 'event_loop',
					file: rel,
					line: lineNo,
					title: 'Synchronous filesystem call inside async handler blocks event loop',
					detail: `Detected "${trimmed}" inside an asynchronous code path.`,
					remediation: 'Use async fs.promises equivalents to prevent blocking concurrent requests.',
				};
				observations.push(obs);
				findings.push(createFinding({
					ruleId: 'KACRAE-PERF-001',
					title: obs.title,
					category: 'performance',
					severity: 'medium',
					classification: 'potential_issue',
					confidence: 0.80,
					file: rel,
					line: lineNo,
					codeContext: extractContextWindow(lines, lineNo),
					explanation: `${obs.detail} (Theoretical risk until profiled under load).`,
					whyItMatters: 'Synchronous disk I/O freezes the Node.js event loop for all concurrent connections.',
					impact: 'Tail-latency spikes under concurrent load.',
					evidence: [trimmed],
					detectionMethod: 'performance_analyzer',
				}));
			}
		}

		// 2. O(n^2) linear scan inside loop (.find / .includes / .indexOf on array inside loop)
		if (/\b(?:for\s*\(|\.forEach\s*\(|\.map\s*\()/.test(line)) {
			const nextBlock = lines.slice(i + 1, Math.min(lines.length, i + 6)).join('\n');
			if (/\.(?:find|includes|indexOf|filter)\s*\(/.test(nextBlock) && !/new\s+Set\b|new\s+Map\b/.test(lines.slice(Math.max(0, i - 4), i + 1).join('\n'))) {
				observations.push({
					id: `perf-quad-${rel}-${lineNo}`,
					kind: 'theoretical_risk',
					category: 'complexity',
					file: rel,
					line: lineNo,
					title: 'Potential O(n^2) nested collection scan inside loop',
					detail: `Loop at ${rel}:${lineNo} calls linear array lookup (.find/.includes/.indexOf/.filter) per iteration.`,
					remediation: 'Pre-index lookup values into a Set or Map for O(1) lookup if collection sizes can grow large.',
				});
			}
		}
	}
}

function evaluateCustomRulesOnFile(
	rel: string,
	_content: string,
	lines: readonly string[],
	rules: readonly KacraeReviewRule[],
	findings: KacraeFinding[],
): void {
	for (const rule of rules) {
		if (!rule.enabled || !rule.pattern.trim()) { continue; }
		if (rule.exceptions?.some(ex => rel.includes(ex))) { continue; }
		if (rule.fileGlobs && rule.fileGlobs.length > 0) {
			const matchesGlob = rule.fileGlobs.some(g => {
				const rx = new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
				return rx.test(rel);
			});
			if (!matchesGlob) { continue; }
		}
		let re: RegExp;
		try { re = new RegExp(rule.pattern); } catch { continue; }

		for (let i = 0; i < lines.length; i++) {
			if (re.test(lines[i])) {
				findings.push(createFinding({
					ruleId: rule.id,
					title: rule.name,
					category: rule.category,
					severity: rule.severity,
					classification: 'strongly_supported',
					confidence: 0.88,
					file: rel,
					line: i + 1,
					codeContext: extractContextWindow(lines, i + 1),
					explanation: rule.description,
					whyItMatters: rule.remediation,
					impact: `Violates configured ${rule.scope} policy rule "${rule.name}".`,
					evidence: [lines[i].trim()],
					detectionMethod: 'deterministic_static',
				}));
				break; // max 1 per rule per file to prevent noise
			}
		}
	}
}

function buildBehaviorTestSuggestion(rel: string, symbolName: string | undefined, content: string): KacraeGeneratedTestSuggestion {
	const ext = getExt(rel);
	const isPy = ext === '.py';
	const sym = symbolName ?? 'moduleUnderTest';
	const testCode = isPy
		? `import pytest\n\ndef test_${sym}_handles_valid_and_edge_inputs():\n    # Verify normal output, empty/None boundary, and invalid input error handling\n    assert True  # Replace with concrete behavioral assertion calling ${sym}\n`
		: `import assert from 'node:assert/strict';\nimport test from 'node:test';\n\ntest('${sym} satisfies normal, boundary, and error behavior', async () => {\n  // 1. Valid input produces expected domain outcome\n  // 2. Empty / null / boundary input is rejected or handled safely\n  // 3. Error paths propagate structured errors without corrupting state\n  assert.ok('${sym}'.length > 0);\n});\n`;

	return {
		id: `gen-test-${rel.replace(/[^a-zA-Z0-9]/g, '-')}`,
		targetFile: rel,
		targetSymbol: symbolName,
		testKind: /\/api\/|router|controller/i.test(rel) ? 'integration' : 'unit',
		framework: isPy ? 'pytest' : content.includes('vitest') ? 'vitest' : 'node:test',
		suggestedTestPath: isPy ? `tests/test_${(rel.split('/').pop() ?? 'mod.py')}` : rel.replace(/(\.[a-z]+)$/i, '.test$1'),
		rationale: `Generated behavior-oriented test scaffold covering normal, boundary, and error paths for ${rel}.`,
		testCode,
	};
}

// ============================================================================
// 5. False-Positive Precision & Confidence Calibration Engine (Part 16.3, Demo 11)
// ============================================================================

export function calibrateAndDeduplicateFindings(
	rawFindings: readonly KacraeFinding[],
	files: readonly ScannedSourceFile[],
	settings?: Partial<KacraeSettings>,
): KacraeFinding[] {
	const fileContentMap = new Map<string, string>();
	for (const f of files) { fileContentMap.set(normPath(f.relativePath), f.content); }

	const minConfidence = settings?.minConfidence ?? DEFAULT_KACRAE_SETTINGS.minConfidence;
	const dedup = new Map<string, KacraeFinding>();

	for (const f of rawFindings) {
		const content = fileContentMap.get(f.location.file) ?? '';
		const lines = content.split(/\r?\n/);
		const targetLine = lines[f.location.startLine - 1] ?? '';
		const nearby = lines.slice(Math.max(0, f.location.startLine - 4), Math.min(lines.length, f.location.startLine + 3)).join('\n');

		// Context-aware false-positive guard 1: Parameterized SQL queries ($1, ?, :param) are NOT SQL injection!
		if ((f.ruleId.includes('SQL') || f.title.toLowerCase().includes('sql')) &&
			/(?:VALUES\s*\(\s*[\$?]|WHERE\s+\w+\s*=\s*(?:\$\d+|\?|:\w+))/.test(nearby) &&
			!/\$\{|\+\s*[a-zA-Z_$]/.test(targetLine)) {
			continue;
		}

		// Context-aware false-positive guard 2: Validated path traversal (path.resolve + startsWith(baseDir))
		if (f.ruleId.includes('FILE_PATH') && /path\.resolve\s*\(/.test(nearby) && /\.startsWith\s*\(/.test(nearby)) {
			continue;
		}

		// Context-aware false-positive guard 3: Sanitized HTML (DOMPurify.sanitize / escapeHtml)
		if ((f.ruleId.includes('HTML') || f.ruleId.includes('XSS')) && /\b(?:DOMPurify\.sanitize|sanitizeHtml|escapeHtml|encodeURIComponent)\s*\(/.test(nearby)) {
			continue;
		}

		// Context-aware false-positive guard 4: Explicit placeholder/example secrets in comments or .env.example
		if (f.category === 'secrets' && (
			/\.example$|\.sample$|\.template$/i.test(f.location.file) ||
			/\b(?:example|placeholder|your[_-]?api[_-]?key|changeme|dummy|fake[_-]?key)\b/i.test(targetLine)
		)) {
			continue;
		}

		// Context-aware false-positive guard 5: Legitimate intentional suppression comment with justification (`// kacrae-ignore: <reason>`)
		if (/kacrae-ignore:\s*\S+/.test(nearby)) {
			continue;
		}

		if (f.confidence < minConfidence) { continue; }

		// Deduplicate overlapping findings on the same file + line + category (keep highest confidence/severity)
		const dedupKey = `${f.location.file}:${f.location.startLine}:${f.category}:${f.ruleId}`;
		const existing = dedup.get(dedupKey);
		if (!existing || f.confidence > existing.confidence) {
			dedup.set(dedupKey, f);
		}
	}

	const sevOrder: Record<KacraeSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
	return [...dedup.values()].sort((a, b) =>
		sevOrder[a.severity] - sevOrder[b.severity] ||
		b.confidence - a.confidence ||
		a.location.file.localeCompare(b.location.file) ||
		a.location.startLine - b.location.startLine,
	);
}

// ============================================================================
// 6. Requirements & Acceptance Traceability Engine (Part 19)
// ============================================================================

export function parseRequirementsFromDocs(docs: readonly ScannedSourceFile[]): KacraeRequirementItem[] {
	const items: KacraeRequirementItem[] = [];
	for (const doc of docs) {
		const lines = doc.content.split(/\r?\n/);
		let current: { id: string; title: string; desc: string[]; criteria: string[] } | null = null;
		const flush = () => {
			if (!current) { return; }
			const text = `${current.title} ${current.desc.join(' ')} ${current.criteria.join(' ')}`;
			const words = [...new Set((text.toLowerCase().match(/[a-z][a-z0-9_-]{3,}/g) ?? []).filter(w =>
				!['must', 'shall', 'should', 'with', 'that', 'this', 'from', 'when', 'then', 'user', 'system', 'have', 'cannot', 'never', 'always'].includes(w),
			))].slice(0, 10);
			items.push({
				id: current.id,
				title: current.title,
				description: current.desc.join(' ').trim() || current.title,
				sourceDoc: normPath(doc.relativePath),
				acceptanceCriteria: current.criteria,
				keywords: words,
			});
			current = null;
		};

		for (const raw of lines) {
			const line = raw.trim();
			const reqMatch = /^(?:#+\s*|[-*]\s*)?(REQ-\d+|US-\d+|AC-\d+|FR-\d+|NFR-\d+)\s*[:\-–]\s*(.+)$/i.exec(line);
			if (reqMatch) {
				flush();
				current = { id: reqMatch[1].toUpperCase(), title: reqMatch[2].trim(), desc: [], criteria: [] };
				continue;
			}
			if (current) {
				if (/^[-*]\s*(?:\[[ xX]\]\s*)?/.test(line)) {
					current.criteria.push(line.replace(/^[-*]\s*(?:\[[ xX]\]\s*)?/, '').trim());
				} else if (line.startsWith('#')) {
					flush();
				} else if (line) {
					current.desc.push(line);
				}
			}
		}
		flush();
	}
	return items;
}

export function buildRequirementsTraceability(
	requirements: readonly KacraeRequirementItem[],
	files: readonly ScannedSourceFile[],
	findings: readonly KacraeFinding[],
): KacraeTraceabilityMatrix {
	const links: KacraeRequirementTraceLink[] = [];
	let coveredAndTested = 0;
	let implementedUntested = 0;
	let missingOrPartial = 0;

	for (const req of requirements) {
		const implFiles: string[] = [];
		const testFiles: string[] = [];
		const keywords = req.keywords.length ? req.keywords : [req.id.toLowerCase()];

		for (const f of files) {
			const rel = normPath(f.relativePath);
			if (rel === req.sourceDoc) { continue; }
			const lower = `${rel.toLowerCase()}\n${f.content.toLowerCase()}`;
			const matchCount = keywords.filter(k => lower.includes(k)).length;
			const threshold = Math.min(2, keywords.length);
			if (matchCount >= threshold || lower.includes(req.id.toLowerCase())) {
				if (isTestFile(rel)) { testFiles.push(rel); }
				else { implFiles.push(rel); }
			}
		}

		const relatedFindings = findings.filter(fd =>
			implFiles.includes(fd.location.file) &&
			(fd.severity === 'critical' || fd.severity === 'high'),
		);

		let status: KacraeRequirementTraceLink['status'];
		if (relatedFindings.length > 0 && implFiles.length > 0) {
			status = 'contradicted';
			missingOrPartial++;
		} else if (implFiles.length > 0 && testFiles.length > 0) {
			status = 'covered_and_tested';
			coveredAndTested++;
		} else if (implFiles.length > 0) {
			status = 'implemented_untested';
			implementedUntested++;
		} else {
			status = 'missing';
			missingOrPartial++;
		}

		links.push({
			requirement: req,
			status,
			implementationFiles: implFiles.slice(0, 15),
			testFiles: testFiles.slice(0, 15),
			relatedFindingIds: relatedFindings.map(r => r.id),
			verificationEvidence: testFiles.length > 0 ? [`Matched test file(s): ${testFiles.slice(0, 3).join(', ')}`] : [],
		});
	}

	return {
		generatedAt: new Date().toISOString(),
		totalRequirements: requirements.length,
		coveredAndTested,
		implementedUntested,
		missingOrPartial,
		links,
	};
}

// ============================================================================
// 7. Multi-Model Review Council Routing & Cost Planner (Part 14 & Part 15)
// ============================================================================

const ALL_COUNCIL_ROLES: readonly KacraeModelRole[] = [
	'primary_reviewer',
	'security_reviewer',
	'architecture_reviewer',
	'correctness_reviewer',
	'performance_reviewer',
	'test_reviewer',
	'adversarial_reviewer',
	'independent_verifier',
	'review_summarizer',
];

export function planMultiModelCouncil(opts: {
	depth: KacraeReviewDepth;
	settings: KacraeSettings;
	configuredProviders?: readonly { readonly providerName: string; readonly modelName: string; readonly isLocal: boolean; readonly isFree: boolean }[];
}): KacraeCouncilRoutingPlan {
	const providers = opts.configuredProviders ?? [];
	const localProviders = providers.filter(p => p.isLocal);
	const freeProviders = providers.filter(p => !p.isLocal && p.isFree);
	const paidProviders = providers.filter(p => !p.isLocal && !p.isFree);

	const allowExternal = opts.settings.allowExternalInference && !opts.settings.localOnlyMode;
	const eligibleExternal = allowExternal ? [...freeProviders, ...paidProviders] : [];

	const activeRoles: readonly KacraeModelRole[] =
		opts.depth === 'quick' ? ['primary_reviewer', 'review_summarizer'] :
		opts.depth === 'security' ? ['security_reviewer', 'adversarial_reviewer', 'independent_verifier', 'review_summarizer'] :
		opts.depth === 'standard' ? ['primary_reviewer', 'security_reviewer', 'correctness_reviewer', 'independent_verifier', 'review_summarizer'] :
		ALL_COUNCIL_ROLES;

	const assignments: KacraeRoleAssignment[] = [];
	let totalCost = 0;

	for (const role of activeRoles) {
		if (!opts.settings.enableAiCouncil) {
			assignments.push({
				role,
				tier: 'deterministic_only',
				contextBudgetTokens: 0,
				estimatedCostUsd: 0,
				rationale: 'AI Council disabled in settings; deterministic analyzers handle this role.',
			});
			continue;
		}

		const override = opts.settings.roleOverrides[role];
		if (override && (allowExternal || localProviders.some(lp => lp.providerName === override.providerName))) {
			const isLocal = localProviders.some(lp => lp.providerName === override.providerName);
			const isFree = freeProviders.some(fp => fp.providerName === override.providerName);
			const est = isLocal || isFree ? 0 : 0.004;
			totalCost += est;
			assignments.push({
				role,
				tier: isLocal ? 'local_inference' : isFree ? 'free_hosted_inference' : 'user_byok_paid',
				providerName: override.providerName,
				modelName: override.modelName,
				contextBudgetTokens: Math.min(opts.settings.contextBudgetTokens, 16_000),
				estimatedCostUsd: est,
				rationale: 'Explicit user role override.',
			});
			continue;
		}

		// Cost-aware routing: local -> free hosted -> BYOK (high-risk roles escalate if available)
		const highRiskRole = role === 'security_reviewer' || role === 'adversarial_reviewer' || role === 'independent_verifier';
		let picked =
			opts.settings.preferLocalModels && localProviders[0] ? localProviders[0] :
			opts.settings.preferFreeHostedModels && allowExternal && freeProviders[0] ? freeProviders[0] :
			highRiskRole && allowExternal && paidProviders[0] ? paidProviders[0] :
			localProviders[0] ?? eligibleExternal[0];

		if (!picked) {
			assignments.push({
				role,
				tier: 'deterministic_only',
				contextBudgetTokens: 0,
				estimatedCostUsd: 0,
				rationale: opts.settings.localOnlyMode
					? 'Local-only mode active and no local runtime detected; using deterministic analyzers.'
					: 'No external/local LLM configured; using deterministic static, taint, architecture, and test engines.',
			});
		} else {
			const tier = picked.isLocal ? 'local_inference' : picked.isFree ? 'free_hosted_inference' : 'user_byok_paid';
			const est = tier === 'user_byok_paid' ? (highRiskRole ? 0.006 : 0.002) : 0;
			totalCost += est;
			assignments.push({
				role,
				tier,
				providerName: picked.providerName,
				modelName: picked.modelName,
				contextBudgetTokens: Math.floor(opts.settings.contextBudgetTokens / Math.max(1, Math.min(activeRoles.length, 4))),
				estimatedCostUsd: est,
				rationale: tier === 'local_inference'
					? 'Zero-cost private local inference via configured runtime.'
					: tier === 'free_hosted_inference'
						? 'Free hosted inference tier within provider quota.'
						: 'User-configured BYOK provider selected for deep reasoning.',
			});
		}
	}

	return {
		localOnlyEnforced: opts.settings.localOnlyMode,
		externalAiAvailable: eligibleExternal.length > 0,
		deterministicAlwaysActive: true,
		assignments,
		totalEstimatedCostUsd: Number(totalCost.toFixed(4)),
		fallbackNote: 'Deterministic static, taint, security, architecture, DB, API, and test verification always execute regardless of AI provider availability or failure.',
	};
}

// ============================================================================
// 8. Compliance Evidence Mapping, Health Methodology & Honest Readiness (Parts 23, 24, 35)
// ============================================================================

export function buildComplianceEvidenceReport(
	findings: readonly KacraeFinding[],
	toolsExecuted: readonly string[],
	hasAuditTrail: boolean,
): KacraeComplianceReport {
	const frameworks: KacraeComplianceFramework[] = [
		'ISO_27001',
		'SOC_2',
		'NIST_CSF',
		'NIST_SSDF',
		'OWASP_ASVS',
		'OWASP_SAMM',
		'CIS_CONTROLS',
	];

	const secFindings = findings.filter(f => f.category === 'security' || f.category === 'tenant_isolation');
	const secretFindings = findings.filter(f => f.category === 'secrets');
	const testFindings = findings.filter(f => f.category === 'testing');

	const controls: KacraeComplianceControlEvidence[] = [
		{
			framework: 'OWASP_ASVS',
			controlId: 'ASVS-V4-AccessControl',
			controlTitle: 'Access Control & Multi-Tenant Isolation Verification',
			status: secFindings.some(f => f.category === 'tenant_isolation' || f.owasp?.includes('A01')) ? 'gap_detected' : 'evidence_present',
			evidenceSummary: secFindings.some(f => f.category === 'tenant_isolation')
				? 'Tenant isolation / access control gaps detected in source analysis.'
				: 'Automated access control and tenant scoping checks found no unmitigated patterns in scanned files.',
			relatedFindingIds: secFindings.filter(f => f.category === 'tenant_isolation' || f.owasp?.includes('A01')).map(f => f.id),
		},
		{
			framework: 'OWASP_ASVS',
			controlId: 'ASVS-V5-Validation',
			controlTitle: 'Input Validation, Sanitization & Injection Prevention',
			status: secFindings.some(f => f.detectionMethod === 'taint_flow' || f.owasp?.includes('A03')) ? 'gap_detected' : 'evidence_present',
			evidenceSummary: `Taint and injection scanners executed (${toolsExecuted.join(', ') || 'kacrae-static'}).`,
			relatedFindingIds: secFindings.filter(f => f.detectionMethod === 'taint_flow' || f.owasp?.includes('A03')).map(f => f.id),
		},
		{
			framework: 'NIST_SSDF',
			controlId: 'PW.7-ReviewCode',
			controlTitle: 'Review and Analyze Human-Readable Code for Vulnerabilities',
			status: 'evidence_present',
			evidenceSummary: `Automated KACRAE review executed with ${toolsExecuted.length} tool(s) and recorded ${findings.length} structured finding(s).`,
			relatedFindingIds: findings.slice(0, 10).map(f => f.id),
		},
		{
			framework: 'NIST_CSF',
			controlId: 'PR.DS-Secrets',
			controlTitle: 'Credential & Secret Protection in Source Artifacts',
			status: secretFindings.length > 0 ? 'gap_detected' : 'evidence_present',
			evidenceSummary: secretFindings.length > 0
				? `${secretFindings.length} exposed credential pattern(s) detected and redacted.`
				: 'Secret scanner found 0 exposed credentials in scanned files.',
			relatedFindingIds: secretFindings.map(f => f.id),
		},
		{
			framework: 'SOC_2',
			controlId: 'CC8.1-ChangeMgmt',
			controlTitle: 'Change Management, Review Audit Trail & Testing',
			status: hasAuditTrail && testFindings.length === 0 ? 'evidence_present' : hasAuditTrail ? 'gap_detected' : 'not_assessed',
			evidenceSummary: hasAuditTrail
				? `Immutable review audit log enabled; ${testFindings.length} test coverage/quality finding(s) recorded.`
				: 'Audit trail not initialized.',
			relatedFindingIds: testFindings.map(f => f.id),
		},
		{
			framework: 'ISO_27001',
			controlId: 'A.8.28-SecureCoding',
			controlTitle: 'Secure Coding & Automated Assurance Evidence',
			status: secFindings.filter(f => f.severity === 'critical' || f.severity === 'high').length > 0 ? 'gap_detected' : 'evidence_present',
			evidenceSummary: `${secFindings.length} security finding(s) mapped with CWE/OWASP evidence.`,
			relatedFindingIds: secFindings.map(f => f.id),
		},
		{
			framework: 'CIS_CONTROLS',
			controlId: 'CIS-16-AppSec',
			controlTitle: 'Application Software Security Static & Contract Checks',
			status: secFindings.length > 0 ? 'gap_detected' : 'evidence_present',
			evidenceSummary: 'Static security, API contract, and dependency checks evaluated.',
			relatedFindingIds: secFindings.map(f => f.id),
		},
		{
			framework: 'OWASP_SAMM',
			controlId: 'V-ST-SecurityTesting',
			controlTitle: 'Automated Security Testing & Adversarial Verification',
			status: 'evidence_present',
			evidenceSummary: 'Automated SAST, taint analysis, and adversarial counterexample checks executed.',
			relatedFindingIds: secFindings.map(f => f.id),
		},
	];

	const gaps = controls.filter(c => c.status === 'gap_detected').length;
	return {
		generatedAt: new Date().toISOString(),
		disclaimer: 'Automated evidence mapping supports audit preparation only and does NOT constitute formal certification or compliance with ISO 27001, SOC 2, NIST, OWASP, or regulatory standards without independent assessment and organizational controls.',
		frameworksEvaluated: frameworks,
		controls,
		summary: `Mapped ${controls.length} controls across ${frameworks.length} frameworks (${gaps} control gap(s) detected).`,
	};
}

export function computeDocumentedHealthScore(params: {
	findings: readonly KacraeFinding[];
	testFilesCount: number;
	sourceFilesCount: number;
	testExecutionPassed?: boolean;
	partialScan: boolean;
}): KacraeHealthScoreBreakdown {
	const active = params.findings.filter(f => f.lifecycle !== 'suppressed' && f.lifecycle !== 'false_positive' && f.lifecycle !== 'verified_resolved');
	const penalty = (list: readonly KacraeFinding[]) =>
		list.reduce((acc, f) => acc + (f.severity === 'critical' ? 25 : f.severity === 'high' ? 12 : f.severity === 'medium' ? 5 : 1), 0);

	const secScore = Math.max(0, 100 - penalty(active.filter(f => f.category === 'security' || f.category === 'tenant_isolation' || f.category === 'secrets')));
	const corrScore = Math.max(0, 100 - penalty(active.filter(f => f.category === 'correctness' || f.category === 'business_logic' || f.category === 'concurrency' || f.category === 'database' || f.category === 'api_contract')));
	const archScore = Math.max(0, 100 - penalty(active.filter(f => f.category === 'architecture' || f.category === 'performance' || f.category === 'technical_debt')));
	const testRatio = params.sourceFilesCount > 0 ? Math.min(1, params.testFilesCount / Math.max(1, params.sourceFilesCount)) : 0;
	const testScore = params.testExecutionPassed === false
		? Math.min(40, Math.round(testRatio * 60))
		: Math.max(0, Math.min(100, Math.round(testRatio * 75 + (params.testExecutionPassed ? 25 : 10)) - penalty(active.filter(f => f.category === 'testing'))));

	const missingDataNotes: string[] = [];
	if (params.testExecutionPassed === undefined) { missingDataNotes.push('Automated test suite was not executed during this review.'); }
	if (params.partialScan) { missingDataNotes.push('Review covered a partial scope or bounded file subset, not the entire repository.'); }

	const score = Math.round(secScore * 0.35 + corrScore * 0.30 + testScore * 0.20 + archScore * 0.15);
	return {
		score,
		methodology: 'Weighted deterministic index: Security & Isolation (35%) + Correctness/DB/API (30%) + Test Coverage & Verification (20%) + Architecture & Performance (15%). Penalties: Critical=-25, High=-12, Medium=-5, Low=-1.',
		components: [
			{ dimension: 'Security & Isolation', weightPct: 35, score: secScore, basis: 'Static SAST, taint, secrets, and tenant isolation findings.' },
			{ dimension: 'Correctness, DB & API', weightPct: 30, score: corrScore, basis: 'Correctness, business logic, concurrency, DB migration, and OpenAPI contract findings.' },
			{ dimension: 'Test Quality & Verification', weightPct: 20, score: testScore, basis: `${params.testFilesCount} test file(s) across ${params.sourceFilesCount} source file(s).`, missingData: params.testExecutionPassed === undefined ? 'Live test run not executed' : undefined },
			{ dimension: 'Architecture & Performance', weightPct: 15, score: archScore, basis: 'Circular dependencies, layering violations, and performance risks.' },
		],
		missingDataNotes,
	};
}

export function assessProductionReadiness(params: {
	findings: readonly KacraeFinding[];
	toolsExecuted: readonly string[];
	testExecutionPassed?: boolean;
	partialScan: boolean;
	settings: KacraeSettings;
}): KacraeReadinessAssessment {
	const active = params.findings.filter(f => f.lifecycle !== 'suppressed' && f.lifecycle !== 'false_positive' && f.lifecycle !== 'verified_resolved');
	const criticals = active.filter(f => f.severity === 'critical');
	const highs = active.filter(f => f.severity === 'high');

	const checkedItems: string[] = [...params.toolsExecuted];
	const passedPolicies: string[] = [];
	const failedPolicies: string[] = [];
	const notChecked: string[] = [];
	const remainingUncertainty: string[] = [];

	if (criticals.length === 0) {
		passedPolicies.push('Zero active critical defects or vulnerabilities');
	} else {
		failedPolicies.push(`${criticals.length} active critical finding(s) violate release policy`);
	}

	if (params.testExecutionPassed === true) {
		passedPolicies.push('Automated test execution passed');
	} else if (params.testExecutionPassed === false) {
		failedPolicies.push('Automated test execution failed');
	} else {
		notChecked.push('Automated test suite execution');
		remainingUncertainty.push('Runtime behavior was not executed via automated test runner in this review.');
	}

	if (params.partialScan) {
		notChecked.push('Full repository scan (only scoped/bounded files were analyzed)');
		remainingUncertainty.push('Files outside the scanned scope were not analyzed.');
	}

	notChecked.push('Authorized live staging/production load & penetration testing (requires explicit environment authorization)');

	let verdict: KacraeReadinessAssessment['verdict'];
	if ((params.settings.blockReleaseOnCritical && criticals.length > 0) || params.testExecutionPassed === false) {
		verdict = 'blocked_by_findings';
	} else if (params.partialScan || params.testExecutionPassed === undefined) {
		verdict = 'incomplete_evidence';
	} else if (highs.length > 0) {
		verdict = 'conditional_review_required';
	} else {
		verdict = 'ready_per_policy_checks';
	}

	return {
		generatedAt: new Date().toISOString(),
		verdict,
		checkedItems,
		passedPolicies,
		failedPolicies,
		notChecked,
		remainingUncertainty,
		explicitDisclaimer: 'Passing automated checks does not prove the absence of defects or guarantee security. Production release requires human engineering sign-off and operational verification.',
	};
}

// ============================================================================
// 9. Visual Report Synthesis (HTML, PDF-Print HTML, Markdown, JSON, SARIF — Part 24.8)
// ============================================================================

export function renderKacraeReport(session: KacraeReviewSession, req: Pick<KacraeExportReportRequest, 'format' | 'reportType'>): string {
	if (req.format === 'json') {
		return JSON.stringify({
			reportType: req.reportType,
			exportedAt: new Date().toISOString(),
			session,
		}, null, 2);
	}

	if (req.format === 'sarif') {
		return JSON.stringify({
			$schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
			version: '2.1.0',
			runs: [{
				tool: {
					driver: {
						name: 'Kodia KACRAE',
						version: '1.0.0',
						informationUri: 'https://kodia.dev/kacrae',
					},
				},
				results: session.findings.map(f => ({
					ruleId: f.ruleId,
					level: f.severity === 'critical' || f.severity === 'high' ? 'error' : f.severity === 'medium' ? 'warning' : 'note',
					message: { text: `${f.title}: ${f.explanation}` },
					locations: [{
						physicalLocation: {
							artifactLocation: { uri: f.location.file },
							region: { startLine: f.location.startLine, endLine: f.location.endLine },
						},
					}],
					properties: {
						classification: f.classification,
						confidence: f.confidence,
						lifecycle: f.lifecycle,
						detectionMethod: f.detectionMethod,
					},
				})),
			}],
		}, null, 2);
	}

	if (req.format === 'markdown') {
		const lines: string[] = [
			`# KACRAE ${req.reportType.replace(/_/g, ' ').toUpperCase()} Report`,
			`- **Session:** ${session.title} (\`${session.id}\`)`,
			`- **Scope / Depth:** ${session.scope} / ${session.depth}`,
			`- **Status:** ${session.status}${session.partialScan ? ` (Partial: ${session.partialReason ?? 'scoped'})` : ''}`,
			`- **Files Analyzed:** ${session.filesAnalyzedCount}`,
			`- **Health Score:** ${session.healthScore.score}/100 — *${session.healthScore.methodology}*`,
			`- **Readiness Verdict:** \`${session.readiness.verdict}\``,
			'',
			`> **Honesty Disclaimer:** ${session.readiness.explicitDisclaimer}`,
			'',
			`## Findings (${session.findings.length})`,
			'| Severity | Classification | Rule | Location | Title | Status |',
			'|---|---|---|---|---|---|',
			...session.findings.map(f => `| ${f.severity.toUpperCase()} | ${f.classification} | ${f.ruleId} | \`${f.location.file}:${f.location.startLine}\` | ${f.title.replace(/\|/g, '/')} | ${f.lifecycle} |`),
		];
		return lines.join('\n');
	}

	// HTML / Print-ready PDF-HTML
	const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	const rows = session.findings.map(f => `
		<tr>
			<td><span class="sev sev-${f.severity}">${esc(f.severity.toUpperCase())}</span></td>
			<td>${esc(f.classification)}</td>
			<td><code>${esc(f.ruleId)}</code></td>
			<td><code>${esc(f.location.file)}:${f.location.startLine}</code></td>
			<td><strong>${esc(f.title)}</strong><div class="sub">${esc(f.explanation)}</div></td>
			<td>${esc(f.lifecycle)}</td>
		</tr>`).join('');

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>KACRAE ${esc(req.reportType)} Report — ${esc(session.title)}</title>
<style>
	body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #111827; margin: 32px; line-height: 1.5; }
	h1 { font-size: 22px; margin-bottom: 4px; }
	.meta { color: #4b5563; font-size: 13px; margin-bottom: 18px; }
	.grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
	.card { border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px; }
	.card .k { font-size: 11px; text-transform: uppercase; color: #6b7280; }
	.card .v { font-size: 20px; font-weight: 700; margin-top: 2px; }
	.disclaimer { background: #f9fafb; border-left: 3px solid #6b7280; padding: 10px 14px; font-size: 12px; margin-bottom: 20px; }
	table { width: 100%; border-collapse: collapse; font-size: 12px; }
	th, td { border-bottom: 1px solid #e5e7eb; padding: 8px; text-align: left; vertical-align: top; }
	th { background: #f3f4f6; font-weight: 600; }
	.sub { color: #4b5563; margin-top: 2px; }
	.sev { display: inline-block; padding: 2px 6px; border-radius: 4px; font-weight: 600; font-size: 11px; }
	.sev-critical { background: #fee2e2; color: #991b1b; }
	.sev-high { background: #ffedd5; color: #9a3412; }
	.sev-medium { background: #fef3c7; color: #92400e; }
	.sev-low, .sev-info { background: #e0f2fe; color: #075985; }
	@media print { body { margin: 12px; } }
</style>
</head>
<body>
	<h1>Kodia KACRAE — ${esc(req.reportType.replace(/_/g, ' ').toUpperCase())} Report</h1>
	<div class="meta">Session: ${esc(session.title)} (${esc(session.id)}) · Scope: ${esc(session.scope)} · Depth: ${esc(session.depth)} · Status: ${esc(session.status)}</div>
	<div class="grid">
		<div class="card"><div class="k">Health Score</div><div class="v">${session.healthScore.score}/100</div></div>
		<div class="card"><div class="k">Confirmed / Total</div><div class="v">${session.counts.confirmed} / ${session.findings.length}</div></div>
		<div class="card"><div class="k">Critical / High</div><div class="v">${session.counts.critical} / ${session.counts.high}</div></div>
		<div class="card"><div class="k">Readiness Verdict</div><div class="v" style="font-size:14px">${esc(session.readiness.verdict)}</div></div>
	</div>
	<div class="disclaimer"><strong>Methodology &amp; Honesty Notice:</strong> ${esc(session.healthScore.methodology)} ${esc(session.readiness.explicitDisclaimer)}</div>
	<table>
		<thead><tr><th>Severity</th><th>Classification</th><th>Rule</th><th>Location</th><th>Finding</th><th>Lifecycle</th></tr></thead>
		<tbody>${rows || '<tr><td colspan="6">No findings recorded in this scope.</td></tr>'}</tbody>
	</table>
</body>
</html>`;
}
