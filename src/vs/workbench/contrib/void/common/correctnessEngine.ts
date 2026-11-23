/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { analyzeChangeImpact, buildProjectDigitalTwin } from './digitalTwin.js';
import { ScannedSourceFile } from './projectHealth.js';
import {
	CompilerCheckOutcome,
	CorrectnessDiagnostic,
	DiagnosticSuppression,
	GeneratedMutant,
	IndependentVerificationCheck,
	IndependentVerificationReport,
	IndependentVerdict,
	IncrementalAnalysisReport,
	ReleaseReadinessGate,
	ReleaseReadinessOutcome,
	ReleaseReadinessReport,
	RepairPlanRecord,
	RootCauseHypothesis,
	RootCauseInvestigationReport,
	TaintAnalysisReport,
	TaintFlowFinding,
	TaintFlowHop,
	TaintSinkKind,
	TaintSourceKind,
} from './correctnessTypes.js';

function normalizeRel(p: string): string {
	return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

function simpleHash(text: string): string {
	let h = 2166136261;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return (h >>> 0).toString(16);
}

// ============================================================================
// 1. MULTI-LAYER STATIC, CROSS-FILE, ASYNC, RESOURCE & AUTH DEFECT ANALYZER
// ============================================================================

function collectExportedNamesOfFile(content: string): Set<string> {
	const names = new Set<string>();
	for (const m of content.matchAll(/\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|enum|const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
		names.add(m[1]);
	}
	for (const m of content.matchAll(/\bexport\s*\{([^}]+)\}/g)) {
		for (const item of m[1].split(',')) {
			const clean = item.trim().split(/\s+as\s+/i).pop()?.trim();
			if (clean) { names.add(clean); }
		}
	}
	for (const m of content.matchAll(/^\s*(?:def|class)\s+([A-Za-z_][A-Za-z0-9_]*)/gm)) {
		names.add(m[1]);
	}
	return names;
}

function resolveRelativeImportTarget(fromPath: string, specifier: string, fileSet: ReadonlySet<string>): string | null {
	if (!specifier.startsWith('.')) { return null; }
	const baseParts = normalizeRel(fromPath).split('/');
	baseParts.pop();
	const relParts = specifier.split('/');
	const out = [...baseParts];
	for (const seg of relParts) {
		if (!seg || seg === '.') { continue; }
		if (seg === '..') { out.pop(); }
		else { out.push(seg); }
	}
	const joined = out.join('/');
	const strippedJs = joined.replace(/\.(?:js|mjs|cjs)$/i, '');
	const candidates = [
		joined,
		`${strippedJs}.ts`,
		`${strippedJs}.tsx`,
		`${strippedJs}.js`,
		`${strippedJs}.jsx`,
		`${strippedJs}.mjs`,
		`${strippedJs}.cjs`,
		`${strippedJs}/index.ts`,
		`${strippedJs}/index.tsx`,
		`${strippedJs}/index.js`,
		`${joined}.py`,
	];
	for (const c of candidates) {
		if (fileSet.has(c)) { return c; }
	}
	return null;
}

export function applySuppressions(
	diagnostics: readonly CorrectnessDiagnostic[],
	suppressions: readonly DiagnosticSuppression[],
): CorrectnessDiagnostic[] {
	if (suppressions.length === 0) { return [...diagnostics]; }
	return diagnostics.map(d => {
		const match = suppressions.find(s =>
			s.ruleId === d.ruleId
			&& (!s.filePattern || d.file.toLowerCase().includes(s.filePattern.toLowerCase())),
		);
		if (!match) { return d; }
		return { ...d, suppressed: true, suppressionReason: match.justification };
	});
}

export function analyzeWorkspaceCorrectness(
	files: readonly ScannedSourceFile[],
	opts?: {
		suppressions?: readonly DiagnosticSuppression[];
		targetFiles?: readonly string[];
	},
): CorrectnessDiagnostic[] {
	const normalizedFiles = files.map(f => ({ path: normalizeRel(f.relativePath), content: f.content }));
	const fileMap = new Map(normalizedFiles.map(f => [f.path, f.content]));
	const fileSet = new Set(fileMap.keys());
	const exportsByFile = new Map<string, Set<string>>();
	for (const f of normalizedFiles) {
		exportsByFile.set(f.path, collectExportedNamesOfFile(f.content));
	}

	const targetSet = opts?.targetFiles?.length
		? new Set(opts.targetFiles.map(normalizeRel))
		: null;

	const findings: CorrectnessDiagnostic[] = [];
	const add = (d: Omit<CorrectnessDiagnostic, 'id'>) => {
		findings.push({ id: `KD-${String(findings.length + 1).padStart(4, '0')}`, ...d });
	};

	for (const f of normalizedFiles) {
		if (targetSet && !targetSet.has(f.path)) { continue; }
		const lines = f.content.split(/\r?\n/);
		const isJsTs = /\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(f.path);
		const isPy = /\.py$/i.test(f.path);
		const isCode = isJsTs || isPy || /\.(go|rs|java|kt|cs|php|rb|c|cpp|h|hpp)$/i.test(f.path);
		if (!isCode) { continue; }

		// Track open/close resource balance for heuristic leak detection
		const opensStream = /\b(createReadStream|createWriteStream|open\s*\(|connect\s*\(|setInterval\s*\()/g.test(f.content);
		const closesStream = /\b(close\s*\(|destroy\s*\(|end\s*\(|clearInterval\s*\(|with\s+open\s*\(|dispose\s*\()/g.test(f.content);
		if (opensStream && !closesStream && !/\.test\.|\.spec\./i.test(f.path)) {
			const idx = lines.findIndex(l => /\b(createReadStream|createWriteStream|setInterval\s*\()/.test(l));
			if (idx >= 0) {
				add({
					ruleId: 'KODIA-RES-001',
					layer: 'deep',
					severity: 'warning',
					confidence: 'medium',
					category: 'resource-leak',
					engine: 'kodia-deep-analyzer',
					file: f.path,
					line: idx + 1,
					title: 'Potential resource/timer leak without corresponding cleanup',
					message: 'Opened stream or interval without matching close/destroy/clearInterval/dispose in module.',
					evidence: lines[idx].trim().slice(0, 140),
					remediation: 'Ensure streams, connections, and intervals are released in finally/dispose/onClose hooks.',
				});
			}
		}

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const lineNum = i + 1;

			// 1. Cross-file broken imports & missing named exports (JS/TS)
			if (isJsTs) {
				const impMatch = /^\s*import\s+(?:type\s+)?(?:\{([^}]+)\}|([A-Za-z_$][A-Za-z0-9_$]*))?\s*from\s*['"](\.[^'"]+)['"]/.exec(line);
				if (impMatch) {
					const namedRaw = impMatch[1];
					const spec = impMatch[3];
					const target = resolveRelativeImportTarget(f.path, spec, fileSet);
					if (!target) {
						add({
							ruleId: 'KODIA-XFILE-001',
							layer: 'deep',
							severity: 'error',
							confidence: 'confirmed',
							category: 'cross-file-contract',
							engine: 'kodia-cross-file',
							file: f.path,
							line: lineNum,
							title: `Unresolved relative module import "${spec}"`,
							message: `Imported module "${spec}" does not resolve to any file in the scanned workspace.`,
							evidence: line.trim().slice(0, 140),
							remediation: 'Fix the import path or restore the missing target module.',
						});
					} else if (namedRaw) {
						const targetExports = exportsByFile.get(target);
						if (targetExports && targetExports.size > 0 && !/export\s+\*\s+from/.test(fileMap.get(target) ?? '')) {
							for (const symRaw of namedRaw.split(',')) {
								const clean = symRaw.trim().replace(/^type\s+/, '').split(/\s+as\s+/i)[0]?.trim();
								if (clean && !targetExports.has(clean)) {
									add({
										ruleId: 'KODIA-XFILE-002',
										layer: 'deep',
										severity: 'error',
										confidence: 'high',
										category: 'cross-file-contract',
										engine: 'kodia-cross-file',
										file: f.path,
										line: lineNum,
										title: `Cross-file contract mismatch: "${clean}" not exported by ${target}`,
										message: `Module ${f.path} imports named symbol "${clean}" from ${target}, which does not export it.`,
										evidence: line.trim().slice(0, 140),
										remediation: `Export "${clean}" from ${target} or update the import in ${f.path}.`,
									});
								}
							}
						}
					}
				}

				// 2. Empty catch block swallowing errors silently
				if (/catch\s*(?:\([^)]*\))?\s*\{\s*\}/.test(line) && !/ignore|intentional/i.test(line)) {
					add({
						ruleId: 'KODIA-LOGIC-001',
						layer: 'instant',
						severity: 'warning',
						confidence: 'high',
						category: 'logic-defect',
						engine: 'kodia-deep-analyzer',
						file: f.path,
						line: lineNum,
						title: 'Empty catch block silently swallows exceptions',
						message: 'Exceptions caught here are discarded without logging, recovery, or rethrowing.',
						evidence: line.trim().slice(0, 140),
						remediation: 'Log or propagate the error, or document explicitly why it is safe to ignore.',
					});
				}

				// 3. Async / Concurrency: async function passed to Array.forEach
				if (/\.forEach\s*\(\s*async\b/.test(line)) {
					add({
						ruleId: 'KODIA-ASYNC-001',
						layer: 'deep',
						severity: 'error',
						confidence: 'high',
						category: 'async-concurrency',
						engine: 'kodia-deep-analyzer',
						file: f.path,
						line: lineNum,
						title: 'Async callback passed to Array.prototype.forEach (unawaited promises)',
						message: 'forEach does not await returned Promises, causing race conditions and unhandled rejections.',
						evidence: line.trim().slice(0, 140),
						remediation: 'Use `for (const item of list) { await ... }` or `await Promise.all(list.map(async ...))`.',
					});
				}
			}

			// 4. Auth & Authorization defects (Cross-language)
			if (/\bjwt\.decode\s*\(/i.test(line) && !/\bjwt\.verify\b/i.test(f.content)) {
				add({
					ruleId: 'KODIA-AUTH-001',
					layer: 'deep',
					severity: 'critical',
					confidence: 'high',
					category: 'auth-authz',
					engine: 'kodia-security-correctness',
					file: f.path,
					line: lineNum,
					title: 'JWT decoded without cryptographic signature verification',
					message: 'Using jwt.decode() trusts unverified token payloads, allowing forged identities and privilege escalation.',
					evidence: line.trim().slice(0, 140),
					remediation: 'Replace jwt.decode() with jwt.verify(token, secretOrPublicKey, { algorithms, issuer, audience }).',
				});
			}

			if (/\b(?:app|router)\.(?:post|put|patch|delete)\s*\(\s*['"`][^'"`]*(?:admin|billing|delete|role|permission|users?\/:)[^'"`]*['"`]\s*,\s*(?:async\s*)?\(\s*req\b/i.test(line)) {
				const surrounding = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 6)).join('\n');
				if (!/auth|jwt|session|verify|guard|role|permission|401|403/i.test(surrounding)) {
					add({
						ruleId: 'KODIA-AUTH-002',
						layer: 'deep',
						severity: 'critical',
						confidence: 'medium',
						category: 'auth-authz',
						engine: 'kodia-security-correctness',
						file: f.path,
						line: lineNum,
						title: 'Sensitive mutating/admin route appears to lack authentication/authorization guard',
						message: 'Mutating or privileged route handler accepts requests directly without visible auth/RBAC middleware or session check.',
						evidence: line.trim().slice(0, 140),
						remediation: 'Attach authentication + role/object-level authorization middleware before handling sensitive mutations.',
					});
				}
			}

			// 5. Crypto / Secrets / Insecure Randomness
			if (/\b(?:createHash\s*\(\s*['"](?:md5|sha1)['"]\)|hashlib\.(?:md5|sha1)\s*\()/i.test(line) && /pass|token|secret|auth|sign/i.test(f.content)) {
				add({
					ruleId: 'KODIA-CRYPTO-001',
					layer: 'deep',
					severity: 'error',
					confidence: 'high',
					category: 'crypto-secrets',
					engine: 'kodia-security-correctness',
					file: f.path,
					line: lineNum,
					title: 'Weak cryptographic hash (MD5/SHA1) used in security-sensitive module',
					message: 'MD5/SHA1 is cryptographically broken for passwords, tokens, or integrity verification.',
					evidence: line.trim().slice(0, 140),
					remediation: 'Use Argon2id/scrypt/bcrypt for passwords and SHA-256/SHA-512/HMAC for integrity.',
				});
			}

			// 6. Python bare except / mutable default arg
			if (isPy) {
				if (/^\s*except\s*:\s*$/.test(line)) {
					add({
						ruleId: 'KODIA-PY-001',
						layer: 'instant',
						severity: 'warning',
						confidence: 'high',
						category: 'logic-defect',
						engine: 'kodia-deep-analyzer',
						file: f.path,
						line: lineNum,
						title: 'Bare except clause catches KeyboardInterrupt/SystemExit',
						message: 'Bare `except:` masks system exits and programming errors.',
						evidence: line.trim().slice(0, 140),
						remediation: 'Catch specific exception classes (e.g. `except ValueError as exc:`).',
					});
				}
				if (/^\s*def\s+[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*=\s*(?:\[\]|\{\})/.test(line)) {
					add({
						ruleId: 'KODIA-PY-002',
						layer: 'deep',
						severity: 'error',
						confidence: 'confirmed',
						category: 'logic-defect',
						engine: 'kodia-deep-analyzer',
						file: f.path,
						line: lineNum,
						title: 'Mutable default argument in Python function definition',
						message: 'Default list/dict arguments are shared across all calls, causing cross-request state corruption.',
						evidence: line.trim().slice(0, 140),
						remediation: 'Use `None` as default and initialize inside the function body (`if items is None: items = []`).',
					});
				}
			}
		}
	}

	return applySuppressions(findings, opts?.suppressions ?? []);
}

// ============================================================================
// 2. DATA-FLOW & TAINT ANALYSIS (Source -> Propagation -> Sanitizer -> Sink)
// ============================================================================

const TAINT_SOURCE_RULES: readonly { kind: TaintSourceKind; regex: RegExp }[] = [
	{ kind: 'http_input', regex: /\b(?:req\.(?:body|query|params|headers)|request\.(?:args|form|json|headers|GET|POST|query_params)|ctx\.query|ctx\.params|c\.req\.query|r\.URL\.Query|\$_GET|\$_POST)\b/ },
	{ kind: 'file_upload', regex: /\b(?:req\.file|req\.files|request\.files|uploaded_file|multipart)\b/ },
	{ kind: 'env_secret', regex: /\b(?:process\.env\.[A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASS)|os\.environ\[['"][^'"]*(?:KEY|SECRET|TOKEN|PASS))/i },
	{ kind: 'ai_output', regex: /\b(?:llmOutput|llm_output|llmResponse|llm_response|modelOutput|model_output|completionText|aiResponse|choices\s*\[\s*0\s*\]\.message\.content)\b/ },
];

const SANITIZER_RE = /\b(?:sanitize|escape|encodeURIComponent|DOMPurify|validator|zod|parseInt|Number\(|Boolean\(|path\.basename|allowlist|whitelist|redact|maskSecret|parameterize|prepared)\b/i;

const TAINT_SINK_RULES: readonly { kind: TaintSinkKind; severity: 'critical' | 'high' | 'medium'; regex: RegExp; title: string; remediation: string }[] = [
	{
		kind: 'sql_query',
		severity: 'critical',
		regex: /\b(?:(?:db|pool|client|conn|connection|sequelize|knex|cursor)\.(?:query|execute|raw)\s*\(\s*[A-Za-z_$][A-Za-z0-9_$]*\s*[,)]|(?:query|execute|exec|raw)\s*\(\s*(?:`[^`]*\$\{|f["'][^"']*\{|["'][^"']*(?:SELECT|INSERT|UPDATE|DELETE)[^"']*["']\s*\+))/i,
		title: 'Unsanitized tainted input flows into dynamic SQL query (SQL Injection)',
		remediation: 'Use parameterized queries / prepared statements ($1, ?) instead of string interpolation.',
	},
	{
		kind: 'shell_exec',
		severity: 'critical',
		regex: /\b(?:execSync|exec|spawnSync|os\.system|subprocess\.(?:run|Popen|call))\s*\([^)]*(?:shell\s*:\s*true|shell\s*=\s*True|\$\{|\+\s*[A-Za-z_])/i,
		title: 'Unsanitized tainted input flows into OS command execution (Command Injection)',
		remediation: 'Avoid shell=true; invoke execFile/spawn with an explicit argument array and strict allowlist validation.',
	},
	{
		kind: 'code_eval',
		severity: 'critical',
		regex: /\b(?:eval|exec|new\s+Function)\s*\(/,
		title: 'Tainted or model-generated data flows into eval()/exec()',
		remediation: 'Eliminate dynamic eval/exec; use structured parsers or an isolated sandbox with strict schema validation.',
	},
	{
		kind: 'html_render',
		severity: 'high',
		regex: /\b(?:innerHTML|outerHTML|document\.write|dangerouslySetInnerHTML)\b|\bres\.send\s*\([^)]*<[a-z]/i,
		title: 'Unsanitized tainted input flows into raw HTML sink (XSS risk)',
		remediation: 'Use textContent/auto-escaped templates or sanitize with DOMPurify before rendering HTML.',
	},
	{
		kind: 'file_path',
		severity: 'high',
		regex: /\b(?:readFileSync|readFile|writeFileSync|writeFile|createReadStream|unlinkSync|open)\s*\(/,
		title: 'Unsanitized tainted input flows into filesystem path (Path Traversal risk)',
		remediation: 'Normalize with path.resolve(baseDir, path.basename(input)) and verify target stays inside baseDir.',
	},
	{
		kind: 'ssrf_request',
		severity: 'high',
		regex: /\b(?:fetch|axios\.(?:get|post|request)|http\.get|requests\.(?:get|post))\s*\(/,
		title: 'Unsanitized user URL flows into outbound HTTP request (SSRF risk)',
		remediation: 'Validate target URLs against an explicit host/scheme allowlist and block private/metadata IP ranges.',
	},
	{
		kind: 'secret_log',
		severity: 'high',
		regex: /\b(?:console\.(?:log|info|warn|error)|logger\.(?:info|debug|warn|error)|print)\s*\(/,
		title: 'Secret/credential variable flows directly into logs',
		remediation: 'Redact secrets and tokens before logging or telemetry emission.',
	},
];

export function analyzeTaintFlows(files: readonly ScannedSourceFile[]): TaintAnalysisReport {
	const unsafeFlows: TaintFlowFinding[] = [];
	let sanitizedFlowsCount = 0;

	for (const rawFile of files) {
		const fPath = normalizeRel(rawFile.relativePath);
		if (!/\.(ts|tsx|js|jsx|mjs|cjs|py|go|php|rb|java|cs)$/i.test(fPath)) { continue; }
		const lines = rawFile.content.split(/\r?\n/);

		// Map variable name -> taint provenance
		const taintedVars = new Map<string, { sourceKind: TaintSourceKind; source: TaintFlowHop; path: TaintFlowHop[] }>();

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const lineNum = i + 1;

			// Detect direct assignment from taint source
			const assignMatch = /^\s*(?:(?:const|let|var)\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(.+)$/.exec(line);
			if (assignMatch) {
				const lhs = assignMatch[1];
				const rhs = assignMatch[2];

				// If sanitizer wraps the RHS, clear taint & count sanitized flow
				if (SANITIZER_RE.test(rhs)) {
					let cleared = false;
					for (const src of TAINT_SOURCE_RULES) {
						if (src.regex.test(rhs)) { sanitizedFlowsCount++; cleared = true; break; }
					}
					if (!cleared) {
						for (const tv of taintedVars.keys()) {
							if (new RegExp(`\\b${tv}\\b`).test(rhs)) { sanitizedFlowsCount++; cleared = true; break; }
						}
					}
					if (cleared) {
						taintedVars.delete(lhs);
						continue;
					}
				}

				let matchedDirect = false;
				for (const src of TAINT_SOURCE_RULES) {
					if (src.regex.test(rhs)) {
						taintedVars.set(lhs, {
							sourceKind: src.kind,
							source: { file: fPath, line: lineNum, symbol: lhs, expression: line.trim().slice(0, 120) },
							path: [],
						});
						matchedDirect = true;
						break;
					}
				}
				if (!matchedDirect) {
					// Propagation: lhs = transform(taintedVar)
					for (const [tv, info] of taintedVars.entries()) {
						if (tv !== lhs && new RegExp(`\\b${tv}\\b`).test(rhs)) {
							taintedVars.set(lhs, {
								sourceKind: info.sourceKind,
								source: info.source,
								path: [...info.path, { file: fPath, line: lineNum, symbol: lhs, expression: line.trim().slice(0, 120) }],
							});
							break;
						}
					}
				}
			}

			// Check sinks on this line
			for (const sinkRule of TAINT_SINK_RULES) {
				if (!sinkRule.regex.test(line)) { continue; }
				if (SANITIZER_RE.test(line)) {
					sanitizedFlowsCount++;
					continue;
				}

				// Match either a tracked tainted var or direct source inside the sink line
				let hit: { sourceKind: TaintSourceKind; source: TaintFlowHop; path: TaintFlowHop[] } | undefined;
				for (const [tv, info] of taintedVars.entries()) {
					// Only flag secret_log for env_secret sources!
					if (sinkRule.kind === 'secret_log' && info.sourceKind !== 'env_secret') { continue; }
					if (sinkRule.kind !== 'secret_log' && info.sourceKind === 'env_secret') { continue; }
					if (new RegExp(`\\b${tv}\\b`).test(line)) {
						hit = info;
						break;
					}
				}
				if (!hit) {
					for (const src of TAINT_SOURCE_RULES) {
						if (sinkRule.kind === 'secret_log' && src.kind !== 'env_secret') { continue; }
						if (sinkRule.kind !== 'secret_log' && src.kind === 'env_secret') { continue; }
						if (src.regex.test(line)) {
							hit = {
								sourceKind: src.kind,
								source: { file: fPath, line: lineNum, symbol: src.kind, expression: line.trim().slice(0, 120) },
								path: [],
							};
							break;
						}
					}
				}

				if (hit) {
					unsafeFlows.push({
						id: `TAINT-${String(unsafeFlows.length + 1).padStart(3, '0')}`,
						severity: sinkRule.severity,
						confidence: hit.path.length === 0 ? 'high' : 'medium',
						sourceKind: hit.sourceKind,
						sinkKind: sinkRule.kind,
						source: hit.source,
						propagationPath: hit.path,
						sink: { file: fPath, line: lineNum, symbol: sinkRule.kind, expression: line.trim().slice(0, 120) },
						sanitizerDetected: false,
						title: sinkRule.title,
						explanation: `Data from ${hit.sourceKind} (${hit.source.file}:${hit.source.line}) reaches ${sinkRule.kind} (${fPath}:${lineNum}) across ${hit.path.length + 1} step(s) with no detected sanitizer.`,
						remediation: sinkRule.remediation,
					});
				}
			}
		}
	}

	return {
		id: `taint-${Date.now().toString(36)}`,
		scannedAt: new Date().toISOString(),
		filesScanned: files.length,
		unsafeFlows,
		sanitizedFlowsCount,
		summary: `Taint Analysis: ${unsafeFlows.length} unsafe data flow(s) and ${sanitizedFlowsCount} sanitized flow(s) across ${files.length} file(s).`,
	};
}

// ============================================================================
// 3. INCREMENTAL DEPENDENCY-AWARE ANALYSIS & SARIF 2.1.0 EXPORT
// ============================================================================

export function runIncrementalCorrectnessAnalysis(opts: {
	files: readonly ScannedSourceFile[];
	previousHashes?: Readonly<Record<string, string>>;
	previousDiagnosticsByFile?: Readonly<Record<string, readonly CorrectnessDiagnostic[]>>;
	suppressions?: readonly DiagnosticSuppression[];
}): {
	report: IncrementalAnalysisReport;
	nextHashes: Record<string, string>;
	nextDiagnosticsByFile: Record<string, CorrectnessDiagnostic[]>;
} {
	const nextHashes: Record<string, string> = {};
	const changedFiles: string[] = [];
	for (const f of opts.files) {
		const norm = normalizeRel(f.relativePath);
		const h = simpleHash(f.content);
		nextHashes[norm] = h;
		if (!opts.previousHashes || opts.previousHashes[norm] !== h) {
			changedFiles.push(norm);
		}
	}

	const isIncremental = Boolean(opts.previousHashes && Object.keys(opts.previousHashes).length > 0 && changedFiles.length < opts.files.length);
	const invalidatedSet = new Set<string>(changedFiles);

	if (isIncremental && changedFiles.length > 0) {
		const twin = buildProjectDigitalTwin(opts.files);
		for (const cf of changedFiles) {
			const impact = analyzeChangeImpact(twin, cf);
			for (const dep of impact.transitiveDependents) {
				invalidatedSet.add(dep);
			}
		}
	}

	const toAnalyze = isIncremental ? [...invalidatedSet] : undefined;
	const freshDiagnostics = analyzeWorkspaceCorrectness(opts.files, {
		suppressions: opts.suppressions,
		targetFiles: toAnalyze,
	});

	const nextDiagnosticsByFile: Record<string, CorrectnessDiagnostic[]> = {};
	for (const f of opts.files) {
		const norm = normalizeRel(f.relativePath);
		if (!isIncremental || invalidatedSet.has(norm)) {
			nextDiagnosticsByFile[norm] = freshDiagnostics.filter(d => d.file === norm);
		} else {
			nextDiagnosticsByFile[norm] = [...(opts.previousDiagnosticsByFile?.[norm] ?? [])];
		}
	}

	const mergedDiagnostics = Object.values(nextDiagnosticsByFile).flat();
	const analyzedCount = isIncremental ? invalidatedSet.size : opts.files.length;
	const cachedSkipped = Math.max(0, opts.files.length - analyzedCount);

	return {
		report: {
			id: `inc-${Date.now().toString(36)}`,
			analyzedAt: new Date().toISOString(),
			mode: isIncremental ? 'incremental' : 'full',
			totalWorkspaceFiles: opts.files.length,
			analyzedFilesCount: analyzedCount,
			cachedSkippedFilesCount: cachedSkipped,
			changedFiles,
			invalidatedDependents: [...invalidatedSet].filter(x => !changedFiles.includes(x)),
			partialNotice: isIncremental
				? `Incremental scan analyzed ${analyzedCount}/${opts.files.length} changed + dependent file(s); ${cachedSkipped} unchanged file(s) reused cached diagnostics.`
				: undefined,
			diagnostics: mergedDiagnostics,
			summary: `${isIncremental ? 'Incremental' : 'Full'} correctness scan: ${mergedDiagnostics.filter(d => !d.suppressed).length} active finding(s) (${analyzedCount} analyzed, ${cachedSkipped} cached).`,
		},
		nextHashes,
		nextDiagnosticsByFile,
	};
}

export function exportDiagnosticsToSarif(
	diagnostics: readonly CorrectnessDiagnostic[],
	taintFlows: readonly TaintFlowFinding[] = [],
): Record<string, unknown> {
	const results = [
		...diagnostics.filter(d => !d.suppressed).map(d => ({
			ruleId: d.ruleId,
			level: d.severity === 'critical' || d.severity === 'error' ? 'error' : d.severity === 'warning' ? 'warning' : 'note',
			message: { text: `${d.title}: ${d.message}` },
			locations: [{
				physicalLocation: {
					artifactLocation: { uri: d.file },
					region: { startLine: d.line, ...(d.column ? { startColumn: d.column } : {}) },
				},
			}],
		})),
		...taintFlows.map(t => ({
			ruleId: `KODIA-TAINT-${t.sinkKind.toUpperCase()}`,
			level: t.severity === 'critical' || t.severity === 'high' ? 'error' : 'warning',
			message: { text: `${t.title}: ${t.explanation}` },
			locations: [{
				physicalLocation: {
					artifactLocation: { uri: t.sink.file },
					region: { startLine: t.sink.line },
				},
			}],
		})),
	];

	return {
		$schema: 'https://json.schemastore.org/sarif-2.1.0.json',
		version: '2.1.0',
		runs: [
			{
				tool: {
					driver: {
						name: 'Kodia Software Correctness Engine',
						version: '1.0.0',
					},
				},
				results,
			},
		],
	};
}

// ============================================================================
// 4. CONTROLLED MUTANT GENERATOR & ROOT-CAUSE INVESTIGATION ENGINE
// ============================================================================

export function generateControlledMutants(filePath: string, content: string, maxMutants = 20): GeneratedMutant[] {
	const lines = content.split(/\r?\n/);
	const mutants: GeneratedMutant[] = [];

	const replacements: readonly { op: GeneratedMutant['operator']; regex: RegExp; swap: (m: string) => string }[] = [
		{ op: 'equality', regex: /===/, swap: () => '!==' },
		{ op: 'equality', regex: /!==/, swap: () => '===' },
		{ op: 'relational', regex: />=/, swap: () => '>' },
		{ op: 'relational', regex: /<=/, swap: () => '<' },
		{ op: 'relational', regex: /(?<![=!<>-])>(?![=>])/, swap: () => '>=' },
		{ op: 'relational', regex: /(?<![=<])<(?![=<])/, swap: () => '<=' },
		{ op: 'logical', regex: /&&/, swap: () => '||' },
		{ op: 'logical', regex: /\|\|/, swap: () => '&&' },
		{ op: 'arithmetic', regex: /\s\+\s/, swap: () => ' - ' },
		{ op: 'arithmetic', regex: /\s-\s/, swap: () => ' + ' },
		{ op: 'boolean-flip', regex: /\breturn\s+true\b/, swap: () => 'return false' },
		{ op: 'boolean-flip', regex: /\breturn\s+false\b/, swap: () => 'return true' },
	];

	for (let i = 0; i < lines.length && mutants.length < maxMutants; i++) {
		const line = lines[i];
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('import ') || trimmed.startsWith('#')) {
			continue;
		}
		let lineMutants = 0;
		for (const rep of replacements) {
			if (mutants.length >= maxMutants || lineMutants >= 3) { break; }
			if (rep.regex.test(line)) {
				const mutatedLine = line.replace(rep.regex, rep.swap);
				if (mutatedLine !== line) {
					mutants.push({
						id: `MUT-${String(mutants.length + 1).padStart(3, '0')}`,
						file: normalizeRel(filePath),
						line: i + 1,
						operator: rep.op,
						originalCode: trimmed.slice(0, 120),
						mutatedCode: mutatedLine.trim().slice(0, 120),
					});
					lineMutants++;
				}
			}
		}
	}

	return mutants;
}

export function applyMutantToSource(content: string, mutant: GeneratedMutant): string {
	const lines = content.split(/\r?\n/);
	const idx = mutant.line - 1;
	if (idx < 0 || idx >= lines.length) { return content; }
	const indent = lines[idx].match(/^\s*/)?.[0] ?? '';
	lines[idx] = `${indent}${mutant.mutatedCode}`;
	return lines.join('\n');
}

export function investigateRootCause(opts: {
	symptom: string;
	stackTraceOrLogs?: string;
	files: readonly ScannedSourceFile[];
	diagnostics?: readonly CorrectnessDiagnostic[];
	taintReport?: TaintAnalysisReport | null;
	compilerOutcomes?: readonly CompilerCheckOutcome[];
}): RootCauseInvestigationReport {
	const hypotheses: RootCauseHypothesis[] = [];
	const affectedFiles = new Set<string>();
	const uncertaintyNotes: string[] = [];

	const combined = `${opts.symptom}\n${opts.stackTraceOrLogs ?? ''}`;
	const twin = buildProjectDigitalTwin(opts.files);

	// Extract referenced files/lines from stack trace
	for (const m of combined.matchAll(/([A-Za-z0-9_./\\-]+\.(?:ts|tsx|js|jsx|cjs|mjs|py|go|rs|java|cs)):(\d+)/g)) {
		const norm = normalizeRel(m[1]);
		const matchingNode = twin.nodes.find(n => norm.endsWith(n.id) || n.id.endsWith(norm));
		if (matchingNode) { affectedFiles.add(matchingNode.id); }
	}

	// 1. Confirmed compiler/syntax/type errors
	const compilerDiags = (opts.compilerOutcomes ?? []).flatMap(c => c.diagnostics).filter(d => d.severity === 'error' || d.severity === 'critical');
	if (compilerDiags.length > 0) {
		const first = compilerDiags[0];
		affectedFiles.add(first.file);
		hypotheses.push({
			rank: hypotheses.length + 1,
			certainty: 'confirmed_root_cause',
			confidenceScore: 0.96,
			title: `Compiler/Type failure in ${first.file}:${first.line} — ${first.message}`,
			location: { file: first.file, line: first.line },
			supportingEvidence: compilerDiags.slice(0, 5).map(d => `[${d.engine}] ${d.file}:${d.line} ${d.message}`),
			contradictingOrMissingEvidence: [],
			nextVerificationStep: `Fix ${first.file}:${first.line} and re-run compiler check (${first.engine}).`,
			proposedRepair: first.remediation,
		});
	}

	// 2. Cross-file contract or auth/async static defects
	const severeDiags = (opts.diagnostics ?? []).filter(d => !d.suppressed && (d.severity === 'critical' || d.severity === 'error'));
	for (const d of severeDiags.slice(0, 3)) {
		affectedFiles.add(d.file);
		hypotheses.push({
			rank: hypotheses.length + 1,
			certainty: d.confidence === 'confirmed' ? 'confirmed_root_cause' : 'strongly_supported',
			confidenceScore: d.confidence === 'confirmed' ? 0.92 : 0.8,
			title: `${d.title} (${d.file}:${d.line})`,
			location: { file: d.file, line: d.line },
			supportingEvidence: [`[${d.ruleId}] ${d.message}`, ...(d.evidence ? [`Code: ${d.evidence}`] : [])],
			contradictingOrMissingEvidence: d.confidence === 'confirmed' ? [] : ['Confirm by reproducing failing test or runtime trace.'],
			nextVerificationStep: `Inspect ${d.file}:${d.line} and run targeted regression tests.`,
			proposedRepair: d.remediation,
		});
	}

	// 3. Unsafe taint flows
	for (const tf of (opts.taintReport?.unsafeFlows ?? []).slice(0, 2)) {
		affectedFiles.add(tf.sink.file);
		hypotheses.push({
			rank: hypotheses.length + 1,
			certainty: 'strongly_supported',
			confidenceScore: 0.84,
			title: `${tf.title} (${tf.sink.file}:${tf.sink.line})`,
			location: { file: tf.sink.file, line: tf.sink.line },
			supportingEvidence: [tf.explanation],
			contradictingOrMissingEvidence: ['Verify whether upstream middleware sanitizes input outside this module.'],
			nextVerificationStep: `Add input validation/sanitization between ${tf.source.file}:${tf.source.line} and ${tf.sink.file}:${tf.sink.line}.`,
			proposedRepair: tf.remediation,
		});
	}

	// 4. Runtime / exception pattern heuristics when no static/compiler cause matched
	if (hypotheses.length === 0) {
		const isAuth = /401|403|unauthorized|forbidden|jwt|token/i.test(combined);
		const isNull = /TypeError|Cannot read propert|undefined|null|AttributeError|NullPointer/i.test(combined);
		const isConn = /ECONNREFUSED|ETIMEDOUT|timeout|socket hang up|502|503/i.test(combined);
		hypotheses.push({
			rank: 1,
			certainty: 'possible_factor',
			confidenceScore: 0.55,
			title: isAuth ? 'Authentication or RBAC permission rejection' : isNull ? 'Null/undefined dereference or schema mismatch' : isConn ? 'Downstream service unreachable or timeout' : 'Runtime logic defect requiring live debugger/test reproduction',
			supportingEvidence: [`Symptom text: ${opts.symptom.slice(0, 160)}`],
			contradictingOrMissingEvidence: ['No direct compiler or static error matched; live execution trace or DAP breakpoint inspection is needed to confirm.'],
			nextVerificationStep: 'Run failing test under real debugger (test_debug / debug_start_session) or capture live API trace (api_send_request).',
			proposedRepair: 'Reproduce failure deterministically first before applying targeted code fix.',
		});
		uncertaintyNotes.push('Root cause is not yet confirmed by deterministic compiler/test execution — run live reproduction before concluding.');
	}

	const correlatedEndpoints = new Set<string>();
	const correlatedTests = new Set<string>();
	for (const af of affectedFiles) {
		const impact = analyzeChangeImpact(twin, af);
		for (const ep of impact.affectedApiEndpoints) { correlatedEndpoints.add(ep); }
		for (const t of impact.affectedTests) { correlatedTests.add(t); }
	}

	const top = hypotheses[0];
	return {
		id: `inv-${Date.now().toString(36)}`,
		createdAt: new Date().toISOString(),
		symptom: opts.symptom,
		affectedFiles: [...affectedFiles],
		correlatedEndpoints: [...correlatedEndpoints],
		correlatedTests: [...correlatedTests],
		hypotheses: hypotheses.map((h, idx) => ({ ...h, rank: idx + 1 })),
		uncertaintyNotes,
		recommendedSmallestRepair: top.proposedRepair,
		summary: `Investigation (${hypotheses.length} hypothesis/es): Top [${top.certainty}] ${top.title}`,
	};
}

export function buildControlledRepairPlan(opts: {
	defectSummary: string;
	targetFiles: readonly string[];
	files: readonly ScannedSourceFile[];
	smallestFixStrategy: string;
}): RepairPlanRecord {
	const twin = buildProjectDigitalTwin(opts.files);
	const blast = new Set<string>();
	const tests = new Set<string>();
	const sideEffects: string[] = [];

	for (const tf of opts.targetFiles) {
		const impact = analyzeChangeImpact(twin, normalizeRel(tf));
		for (const dep of impact.transitiveDependents) { blast.add(dep); }
		for (const t of impact.affectedTests) { tests.add(t); }
		if (impact.affectedApiEndpoints.length > 0) {
			sideEffects.push(`Touches API endpoints: ${impact.affectedApiEndpoints.slice(0, 5).join(', ')}`);
		}
		if (impact.affectedDbEntities.length > 0) {
			sideEffects.push(`Touches DB entities: ${impact.affectedDbEntities.slice(0, 5).join(', ')}`);
		}
	}

	return {
		id: `rep-${Date.now().toString(36)}`,
		createdAt: new Date().toISOString(),
		defectSummary: opts.defectSummary,
		targetFiles: opts.targetFiles.map(normalizeRel),
		blastRadiusFiles: [...blast],
		targetedTests: [...tests],
		smallestFixStrategy: opts.smallestFixStrategy,
		sideEffectRisks: sideEffects.length > 0 ? sideEffects : ['Low blast radius; verify unit & targeted regression tests after edit.'],
		rollbackStrategy: 'Retain git diff / Kodia checkpoint before editing; revert changed files cleanly if Independent Verification rejects the repair.',
	};
}

// ============================================================================
// 5. INDEPENDENT VERIFICATION & RISK-BASED RELEASE READINESS
// ============================================================================

export function evaluateIndependentVerification(opts: {
	changeDescription: string;
	changedFiles: readonly string[];
	checks: readonly IndependentVerificationCheck[];
	requireTests?: boolean;
}): IndependentVerificationReport {
	const rejectionReasons: string[] = [];
	const untestedRisks: string[] = [];

	for (const c of opts.checks) {
		if (c.status === 'failed') {
			rejectionReasons.push(`[${c.category}] ${c.name} FAILED: ${c.detail}`);
		} else if (c.status === 'not_run' || c.status === 'skipped') {
			untestedRisks.push(`[${c.category}] ${c.name} was ${c.status}: ${c.detail}`);
		}
	}

	const testChecks = opts.checks.filter(c => c.category === 'tests' || c.category === 'regression');
	const hasPassedTest = testChecks.some(c => c.status === 'passed');
	if (opts.requireTests !== false && !hasPassedTest) {
		rejectionReasons.push('No deterministic automated test check passed for the modified files; independent verification refuses unverified completion claims.');
	}

	let verdict: IndependentVerdict;
	if (rejectionReasons.length > 0) {
		verdict = 'REJECTED';
	} else if (untestedRisks.length > 0) {
		verdict = 'CONDITIONAL';
	} else {
		verdict = 'APPROVED';
	}

	return {
		id: `iver-${Date.now().toString(36)}`,
		verifiedAt: new Date().toISOString(),
		changeDescription: opts.changeDescription,
		verdict,
		changedFiles: opts.changedFiles.map(normalizeRel),
		checks: [...opts.checks],
		rejectionReasons,
		untestedRisks,
		summary: `Independent Verification Verdict: **${verdict}** (${opts.checks.filter(c => c.status === 'passed').length}/${opts.checks.length} checks passed${rejectionReasons.length ? `, ${rejectionReasons.length} rejection reason(s)` : ''}).`,
	};
}

export function assessReleaseReadiness(opts: {
	compilerOutcomes?: readonly CompilerCheckOutcome[];
	diagnostics?: readonly CorrectnessDiagnostic[];
	taintReport?: TaintAnalysisReport | null;
	latestVerification?: IndependentVerificationReport | null;
	testsExecutedCount?: number;
	testsPassed?: boolean;
	infrastructureBlockedReason?: string;
}): ReleaseReadinessReport {
	const gates: ReleaseReadinessGate[] = [];
	const blockers: string[] = [];
	const unverified: string[] = [];

	// 1. Build / Compiler
	const compilersRun = (opts.compilerOutcomes ?? []).filter(c => c.available);
	if (compilersRun.length === 0) {
		gates.push({ id: 'compiler', label: 'Compiler & Type Checks', status: 'incomplete', evidence: 'No compiler check executed yet.', gap: 'Run correctness_run_compilers.' });
		unverified.push('Compiler / type-check execution not recorded.');
	} else {
		const allOk = compilersRun.every(c => c.passed);
		gates.push({
			id: 'compiler',
			label: 'Compiler & Type Checks',
			status: allOk ? 'passed' : 'failed',
			evidence: compilersRun.map(c => `${c.engine}: ${c.passed ? 'PASS' : 'FAIL'} (${c.diagnostics.length} diags)`).join('; '),
			gap: allOk ? undefined : 'Resolve all compiler/type errors before release.',
		});
		if (!allOk) { blockers.push('Compiler/type check failures exist.'); }
	}

	// 2. Static & Cross-File Correctness
	const activeDiags = (opts.diagnostics ?? []).filter(d => !d.suppressed);
	const critErrs = activeDiags.filter(d => d.severity === 'critical' || d.severity === 'error');
	if (!opts.diagnostics) {
		gates.push({ id: 'static', label: 'Static & Cross-File Analysis', status: 'incomplete', evidence: 'Not yet scanned.', gap: 'Run correctness_analyze_workspace.' });
		unverified.push('Static and cross-file defect analysis not run.');
	} else {
		gates.push({
			id: 'static',
			label: 'Static & Cross-File Analysis',
			status: critErrs.length === 0 ? 'passed' : 'failed',
			evidence: `${activeDiags.length} active findings (${critErrs.length} critical/error).`,
			gap: critErrs.length > 0 ? `Resolve ${critErrs.length} critical/error finding(s).` : undefined,
		});
		if (critErrs.length > 0) { blockers.push(`${critErrs.length} critical/error static correctness finding(s).`); }
	}

	// 3. Data-Flow & Taint Security
	if (!opts.taintReport) {
		gates.push({ id: 'taint', label: 'Data-Flow & Security Taint Analysis', status: 'incomplete', evidence: 'Taint scan not executed.', gap: 'Run correctness_taint_analysis.' });
		unverified.push('Data-flow / taint security analysis not run.');
	} else {
		const critHigh = opts.taintReport.unsafeFlows.filter(f => f.severity === 'critical' || f.severity === 'high');
		gates.push({
			id: 'taint',
			label: 'Data-Flow & Security Taint Analysis',
			status: critHigh.length === 0 ? 'passed' : 'failed',
			evidence: opts.taintReport.summary,
			gap: critHigh.length > 0 ? `Sanitize ${critHigh.length} critical/high unsafe taint flow(s).` : undefined,
		});
		if (critHigh.length > 0) { blockers.push(`${critHigh.length} critical/high unsanitized taint flow(s).`); }
	}

	// 4. Automated Tests & Independent Verification
	if (opts.infrastructureBlockedReason) {
		gates.push({ id: 'verification', label: 'Independent Verification & Tests', status: 'blocked', evidence: opts.infrastructureBlockedReason, gap: opts.infrastructureBlockedReason });
		blockers.push(`Blocked by unavailable infrastructure: ${opts.infrastructureBlockedReason}`);
	} else if (!opts.latestVerification && !opts.testsExecutedCount) {
		gates.push({ id: 'verification', label: 'Independent Verification & Tests', status: 'incomplete', evidence: 'No independent verification or test run recorded.', gap: 'Run correctness_independent_verify.' });
		unverified.push('Independent verification & automated test suite not executed.');
	} else {
		const v = opts.latestVerification;
		const passed = v ? v.verdict === 'APPROVED' : Boolean(opts.testsPassed);
		gates.push({
			id: 'verification',
			label: 'Independent Verification & Tests',
			status: v?.verdict === 'REJECTED' || opts.testsPassed === false ? 'failed' : passed ? 'passed' : 'incomplete',
			evidence: v ? v.summary : `Tests executed: ${opts.testsExecutedCount}`,
			gap: v?.verdict === 'REJECTED' ? v.rejectionReasons.join('; ') : undefined,
		});
		if (v?.verdict === 'REJECTED' || opts.testsPassed === false) {
			blockers.push('Independent verification rejected the change or tests failed.');
		}
	}

	let outcome: ReleaseReadinessOutcome;
	if (gates.some(g => g.status === 'blocked')) {
		outcome = 'blocked_infrastructure';
	} else if (gates.some(g => g.status === 'failed')) {
		outcome = 'not_ready_failures';
	} else if (gates.filter(g => g.status === 'incomplete').length >= 2) {
		outcome = 'verification_incomplete';
	} else if (gates.some(g => g.status === 'incomplete')) {
		outcome = 'conditionally_ready';
	} else {
		outcome = 'verified_against_checks';
	}

	return {
		id: `rel-${Date.now().toString(36)}`,
		generatedAt: new Date().toISOString(),
		outcome,
		gates,
		blockers,
		unverifiedDimensions: unverified,
		explicitDisclaimer: 'Passing configured automated checks increases confidence but does not guarantee the absence of all software defects; review unverified dimensions before production release.',
		summary: `Release Readiness: **${outcome.toUpperCase()}** (${gates.filter(g => g.status === 'passed').length}/${gates.length} gates passed, ${blockers.length} blocker(s), ${unverified.length} unverified dimension(s)).`,
	};
}

// ============================================================================
// 6. LLM FORMATTERS
// ============================================================================

export function formatInvestigationForLLM(inv: RootCauseInvestigationReport): string {
	return [
		`# Kodia Root-Cause Investigation (${inv.id})`,
		`Symptom: ${inv.symptom}`,
		`Affected Files: ${inv.affectedFiles.join(', ') || 'none isolated yet'}`,
		...(inv.correlatedEndpoints.length ? [`Correlated Endpoints: ${inv.correlatedEndpoints.join(', ')}`] : []),
		...(inv.correlatedTests.length ? [`Correlated Tests: ${inv.correlatedTests.join(', ')}`] : []),
		`## Ranked Hypotheses`,
		...inv.hypotheses.map(h => `${h.rank}. **[${h.certainty}] (${Math.round(h.confidenceScore * 100)}%) ${h.title}**\n   Evidence: ${h.supportingEvidence.join('; ')}\n   Next Step: ${h.nextVerificationStep}\n   Proposed Repair: ${h.proposedRepair}`),
		...(inv.uncertaintyNotes.length ? [`## Unresolved Uncertainty\n${inv.uncertaintyNotes.map(u => `- ${u}`).join('\n')}`] : []),
	].join('\n');
}
