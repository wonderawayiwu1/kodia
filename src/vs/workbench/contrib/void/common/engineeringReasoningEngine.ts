/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ScannedSourceFile } from './projectHealth.js';
import {
	EricApiUsageIssue,
	EricApiVerificationReport,
	EricApproachEvaluation,
	EricApproachOption,
	EricBehavioralSpec,
	EricBenchmarkComparison,
	EricBenchmarkMetrics,
	EricEngineeringDomain,
	EricFailureLesson,
	EricIndependentReviewReport,
	EricReviewVerdict,
	EricSemanticFinding,
	EricSemanticReport,
} from './engineeringReasoningTypes.js';

function normPath(p: string): string {
	return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

function isTestFile(p: string): boolean {
	return /(?:^|\/)(?:__tests__|tests?|spec)\/|(?:\.test|\.spec|_test)\.[a-z0-9]+$/i.test(p);
}

// ── 1. Technical Approach Selection Evaluator (Section 4) ──────────────────────────────

export function evaluateTechnicalApproaches(
	problem: string,
	domain: EricEngineeringDomain,
	options: readonly EricApproachOption[],
	evidence: readonly string[] = [],
): EricApproachEvaluation {
	const scored = options.map(opt => {
		const s = opt.scores;
		// Correctness, reliability & security carry highest weight
		const weightedScore = Number((
			s.correctness * 0.24
			+ s.reliability * 0.18
			+ s.security * 0.16
			+ s.maintainability * 0.14
			+ s.frameworkCompatibility * 0.12
			+ s.performance * 0.08
			+ s.operationalSimplicity * 0.08
		).toFixed(2));
		return { ...opt, weightedScore };
	}).sort((a, b) => b.weightedScore - a.weightedScore);

	const winner = scored[0];
	const runnerUp = scored[1];
	const rationale = winner
		? `Selected "${winner.name}" (weighted score ${winner.weightedScore}/5${runnerUp ? ` vs ${runnerUp.name} ${runnerUp.weightedScore}/5` : ''}): ${winner.pros.slice(0, 2).join('; ') || winner.summary}.`
		: 'No candidate approaches supplied.';

	return {
		id: `eric-dec-${Date.now().toString(36)}`,
		problem,
		domain,
		evaluatedAtMs: Date.now(),
		options: scored,
		selectedOption: winner?.name ?? 'none',
		rationale,
		evidence,
	};
}

// ── 2. Real Installed API & Declaration Verifier (Section 5) ───────────────────────────

export interface InstalledPackageDeclarationInfo {
	readonly packageName: string;
	readonly version: string;
	readonly declarationSource: string;
	readonly exportedMembers: ReadonlySet<string>;
}

export function extractExportedMembersFromDeclarationText(dtsContent: string): Set<string> {
	const members = new Set<string>();
	const patterns = [
		/\bexport\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function|class|interface|type|enum|const|let|var|namespace)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
		/\bdeclare\s+(?:function|class|const|let|var|namespace)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
		/^\s*(?:readonly\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:\??\s*\(|\??\s*:)/gm,
	];
	for (const re of patterns) {
		let m: RegExpExecArray | null;
		while ((m = re.exec(dtsContent)) !== null) {
			if (m[1] && !/^(constructor|return|if|for|while|switch|catch|else|default|export|import|from|type|interface|class|function|const|let|var)$/.test(m[1])) {
				members.add(m[1]);
			}
			if (members.size >= 400) break;
		}
	}
	const braceRe = /\bexport\s+(?:type\s+)?\{([^}]+)\}/g;
	let bm: RegExpExecArray | null;
	while ((bm = braceRe.exec(dtsContent)) !== null) {
		for (const part of bm[1].split(',')) {
			const clean = part.replace(/\btype\s+/g, '').trim();
			const asM = /\bas\s+([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(clean);
			const sym = asM ? asM[1] : clean.split(/\s+/)[0];
			if (sym && sym !== 'default') members.add(sym);
		}
	}
	return members;
}

export function verifyApiUsageAgainstDeclarations(
	workspaceRoot: string,
	files: readonly ScannedSourceFile[],
	installedPackages: ReadonlyMap<string, InstalledPackageDeclarationInfo>,
): EricApiVerificationReport {
	const issues: EricApiUsageIssue[] = [];
	let usagesChecked = 0;
	let nextId = 1;

	for (const f of files) {
		const rel = normPath(f.relativePath);
		if (!/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i.test(rel)) continue;
		const lines = f.content.split(/\r?\n/);

		// Track namespace/default imports from verified installed packages: import * as pkg from 'pkg' | import pkg from 'pkg'
		const aliases = new Map<string, InstalledPackageDeclarationInfo>();

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const lineNo = i + 1;

			// Named imports: import { foo, bar } from 'pkg'
			const namedImp = /^\s*import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]([^'"./][^'"]*)['"]/.exec(line);
			if (namedImp) {
				const pkgSpec = namedImp[2];
				const pkgName = pkgSpec.startsWith('@') ? pkgSpec.split('/').slice(0, 2).join('/') : pkgSpec.split('/')[0];
				const info = installedPackages.get(pkgName);
				if (info && info.exportedMembers.size > 0) {
					for (const part of namedImp[1].split(',')) {
						const clean = part.replace(/\btype\s+/g, '').trim();
						if (!clean) continue;
						const orig = clean.split(/\s+as\s+/)[0]?.trim();
						if (!orig || orig === 'default') continue;
						usagesChecked++;
						if (!info.exportedMembers.has(orig)) {
							issues.push({
								id: `ERIC-API-${nextId++}`,
								severity: 'error',
								file: rel,
								line: lineNo,
								packageName: pkgName,
								installedVersion: info.version,
								referencedMember: orig,
								message: `Symbol "${orig}" is not found in installed "${pkgName}@${info.version}" declarations (${info.declarationSource}).`,
								availableMembersSample: [...info.exportedMembers].slice(0, 10),
								suggestedFix: `Inspect ${info.declarationSource} or run lei_research_technology for ${pkgName}@${info.version} to use a real exported API.`,
							});
						}
					}
				}
			}

			// Namespace or default alias: import * as X from 'pkg' | import X from 'pkg'
			const nsImp = /^\s*import\s+(?:\*\s+as\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s+from\s+['"]([^'"./][^'"]*)['"]/.exec(line);
			if (nsImp) {
				const pkgSpec = nsImp[2];
				const pkgName = pkgSpec.startsWith('@') ? pkgSpec.split('/').slice(0, 2).join('/') : pkgSpec.split('/')[0];
				const info = installedPackages.get(pkgName);
				if (info && info.exportedMembers.size > 0) {
					aliases.set(nsImp[1], info);
				}
			}

			// Member calls on imported package aliases: pkg.nonexistentMethod(...)
			for (const [alias, info] of aliases.entries()) {
				const callRe = new RegExp(`\\b${alias}\\.([A-Za-z_$][A-Za-z0-9_$]*)\\s*\\(`, 'g');
				let cm: RegExpExecArray | null;
				while ((cm = callRe.exec(line)) !== null) {
					const method = cm[1];
					usagesChecked++;
					if (!info.exportedMembers.has(method)) {
						issues.push({
							id: `ERIC-API-${nextId++}`,
							severity: 'error',
							file: rel,
							line: lineNo,
							packageName: info.packageName,
							installedVersion: info.version,
							referencedMember: `${alias}.${method}`,
							message: `Method "${alias}.${method}()" does not exist in installed "${info.packageName}@${info.version}" declarations (${info.declarationSource}).`,
							availableMembersSample: [...info.exportedMembers].slice(0, 10),
							suggestedFix: `Replace "${method}" with a real method from ${info.packageName}@${info.version}.`,
						});
					}
				}
			}
		}
	}

	const packagesInspected = [...installedPackages.values()].map(p => ({
		name: p.packageName,
		version: p.version,
		declarationSource: p.declarationSource,
		exportedCount: p.exportedMembers.size,
	}));

	return {
		workspaceRoot,
		checkedAtMs: Date.now(),
		packagesInspected,
		usagesChecked,
		issues,
		passed: issues.filter(i => i.severity === 'error').length === 0,
		summary: issues.length === 0
			? `Verified ${usagesChecked} API usage(s) against ${packagesInspected.length} installed package declaration(s) — 0 invented APIs detected.`
			: `Found ${issues.length} invalid/invented API usage(s) across ${packagesInspected.length} installed package(s).`,
	};
}

// ── 3. Semantic, Behavioral, Domain & Test-Oracle Correctness Analyzer (Sections 6–10) ─

export function analyzeSemanticCorrectness(
	workspaceRoot: string,
	files: readonly ScannedSourceFile[],
): EricSemanticReport {
	const findings: EricSemanticFinding[] = [];
	const domains = new Set<EricEngineeringDomain>();
	let nextId = 1;

	const pushFinding = (f: Omit<EricSemanticFinding, 'id'>) => {
		domains.add(f.domain);
		findings.push({ id: `ERIC-SEM-${nextId++}`, ...f });
	};

	for (const file of files) {
		const rel = normPath(file.relativePath);
		const isJsTs = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i.test(rel);
		const isPy = /\.py$/i.test(rel);
		const isMobile = /(?:mobile|screens?|react-native|expo|flutter|\.dart$|\.kt$|\.swift$)/i.test(rel) || /from\s+['"]react-native['"]/.test(file.content);
		const isAiMl = /(?:sklearn|torch|tensorflow|keras|transformers|openai|anthropic|nvidia|rag|train|model|dataset)/i.test(`${rel}\n${file.content}`);
		const isTest = isTestFile(rel);
		const lines = file.content.split(/\r?\n/);

		if (isMobile) domains.add('mobile');
		if (isAiMl) domains.add('ai_ml');
		if (/\.(tsx|jsx|vue|svelte)$/i.test(rel)) domains.add('frontend');
		if (/(?:routes?|controllers?|server|backend|api|db|sql)/i.test(rel)) domains.add('web_backend');

		// ── A. Test Oracle Quality Audit (Section 8: catch weak/tautological/skipped tests!) ──
		if (isTest && (isJsTs || isPy)) {
			const hasRealAssertion = /\b(assert\.|expect\(|toBe\(|toEqual\(|toThrow|toHaveBeenCalled|assertEqual|assertTrue|assertFalse|assertRaises|assert\s+[^\s])/m.test(file.content);
			if (!hasRealAssertion && /\b(test\(|it\(|def\s+test_)/m.test(file.content)) {
				pushFinding({
					category: 'weak_test_oracle',
					domain: 'general',
					severity: 'error',
					file: rel,
					line: 1,
					ruleId: 'ERIC-TEST-NO-ASSERT',
					title: 'Test file defines test cases with zero assertions',
					explanation: 'Tests without behavioral assertions pass trivially and create false confidence.',
					suggestedFix: 'Add explicit behavioral assertions verifying outputs, invariants, and failure conditions.',
				});
			}
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				if (/\bexpect\s*\(\s*(true|false|1|0)\s*\)\s*\.toBe\s*\(\s*\1\s*\)|assert\.strictEqual\s*\(\s*(true|1)\s*,\s*\2\s*\)/.test(line)) {
					pushFinding({
						category: 'weak_test_oracle',
						domain: 'general',
						severity: 'error',
						file: rel,
						line: i + 1,
						ruleId: 'ERIC-TEST-TAUTOLOGY',
						title: 'Tautological test assertion detected',
						explanation: 'Asserting a constant equals itself never tests real application behavior.',
						suggestedFix: 'Assert real return values, state transitions, or error behavior from the unit under test.',
					});
				}
				if (/\b(?:test|it|describe)\.skip\s*\(|\bxit\s*\(|\b@pytest\.mark\.skip\b/.test(line)) {
					pushFinding({
						category: 'weak_test_oracle',
						domain: 'general',
						severity: 'warning',
						file: rel,
						line: i + 1,
						ruleId: 'ERIC-TEST-SKIPPED',
						title: 'Skipped test case found',
						explanation: 'Skipped tests leave behavior unverified and can conceal regressions.',
						suggestedFix: 'Fix and re-enable the test rather than skipping it.',
					});
				}
			}
			continue; // Skip production-only heuristics on test files
		}

		// ── B. JS/TS Semantic, Async, Resource, Security & Algorithm Checks ──
		if (isJsTs) {
			let hasSetInterval = false;
			let hasClearInterval = /clearInterval\s*\(/.test(file.content);
			let hasAddListener = false;
			let hasRemoveListener = /removeEventListener\s*\(|off\s*\(|dispose\s*\(/.test(file.content);

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				const lineNo = i + 1;

				// 1. Async race bug: Array.forEach(async (...) => ...) does NOT await!
				if (/\.forEach\s*\(\s*async\b/.test(line)) {
					pushFinding({
						category: 'async_concurrency_race',
						domain: 'web_backend',
						severity: 'error',
						file: rel,
						line: lineNo,
						ruleId: 'ERIC-ASYNC-FOREACH',
						title: 'Async callback passed to Array.prototype.forEach',
						explanation: 'Array.forEach ignores returned promises, causing unhandled rejections and out-of-order race conditions.',
						suggestedFix: 'Use a for...of loop with await (sequential) or await Promise.all(items.map(async ...)) (bounded parallel).',
					});
				}

				// 2. Async executor inside new Promise(async ...)
				if (/new\s+Promise\s*\(\s*async\b/.test(line)) {
					pushFinding({
						category: 'async_concurrency_race',
						domain: 'web_backend',
						severity: 'error',
						file: rel,
						line: lineNo,
						ruleId: 'ERIC-ASYNC-PROMISE-EXEC',
						title: 'Async function passed to Promise constructor',
						explanation: 'Errors thrown inside an async Promise executor are not automatically rejected by the outer Promise.',
						suggestedFix: 'Remove the Promise wrapper and use an async function directly.',
					});
				}

				// 3. Empty swallowed catch block
				if (/catch\s*(?:\([^)]*\))?\s*\{\s*\}/.test(line)) {
					pushFinding({
						category: 'error_handling_defect',
						domain: 'general',
						severity: 'warning',
						file: rel,
						line: lineNo,
						ruleId: 'ERIC-EMPTY-CATCH',
						title: 'Empty catch block silently swallows exceptions',
						explanation: 'Silently ignoring runtime exceptions hides failures and leads to corrupted state.',
						suggestedFix: 'Log/surface the error, return a typed failure result, or explicitly document why the specific error is safe to ignore.',
					});
				}

				// 4. SQL injection via string interpolation/concatenation
				if (/\b(?:query|execute|prepare|raw)\s*\(\s*`[^`]*(?:SELECT|INSERT|UPDATE|DELETE)\b[^`]*\$\{/.test(line)) {
					pushFinding({
						category: 'security_auth_boundary',
						domain: 'web_backend',
						severity: 'critical',
						file: rel,
						line: lineNo,
						ruleId: 'ERIC-SQL-INJECTION',
						title: 'Parameterized query bypassed — SQL string interpolation detected',
						explanation: 'Interpolating variables into SQL templates exposes the application to SQL injection.',
						suggestedFix: 'Use parameterized query placeholders (?, $1, :param) with bound parameter arrays.',
					});
				}

				// 5. Weak password hashing (MD5/SHA1)
				if (/createHash\s*\(\s*['"](?:md5|sha1)['"]\s*\)[^\n]*(?:pass|pwd|secret|auth)/i.test(line)) {
					pushFinding({
						category: 'security_auth_boundary',
						domain: 'web_backend',
						severity: 'critical',
						file: rel,
						line: lineNo,
						ruleId: 'ERIC-WEAK-PASSWORD-HASH',
						title: 'Cryptographically weak hash (MD5/SHA1) used for credentials',
						explanation: 'MD5 and SHA1 are fast unsalted hashes unsuitable for password storage.',
						suggestedFix: 'Use argon2id, scrypt, or bcrypt with per-user salts.',
					});
				}

				// 6. Algorithm defect: numeric array .sort() without comparator
				if (/(?:nums|numbers|scores|prices|amounts|values|ids)\s*\.sort\s*\(\s*\)/.test(line)) {
					pushFinding({
						category: 'algorithm_boundary_defect',
						domain: 'general',
						severity: 'error',
						file: rel,
						line: lineNo,
						ruleId: 'ERIC-NUMERIC-SORT-LEX',
						title: 'Array.prototype.sort() called without numeric comparator',
						explanation: 'Default JS .sort() sorts lexicographically as strings (e.g. [10, 2] stays [10, 2]).',
						suggestedFix: 'Pass an explicit numeric comparator: .sort((a, b) => a - b).',
					});
				}

				// 7. Resource leak tracking
				if (/\bsetInterval\s*\(/.test(line) && !hasSetInterval) {
					hasSetInterval = true;
					if (!hasClearInterval) {
						pushFinding({
							category: 'resource_memory_leak',
							domain: isMobile ? 'mobile' : 'frontend',
							severity: 'warning',
							file: rel,
							line: lineNo,
							ruleId: 'ERIC-LEAK-INTERVAL',
							title: 'setInterval scheduled without clearInterval cleanup in module',
							explanation: 'Uncleaned intervals leak memory and continue executing after component unmount or service disposal.',
							suggestedFix: 'Store the interval handle and call clearInterval in cleanup/useEffect return/dispose.',
						});
					}
				}
				if (/\.addEventListener\s*\(/.test(line) && !hasAddListener) {
					hasAddListener = true;
					if (!hasRemoveListener) {
						pushFinding({
							category: 'resource_memory_leak',
							domain: isMobile ? 'mobile' : 'frontend',
							severity: 'warning',
							file: rel,
							line: lineNo,
							ruleId: 'ERIC-LEAK-LISTENER',
							title: 'addEventListener registered without matching removeEventListener/dispose',
							explanation: 'Event listeners that are never removed accumulate on re-render and cause memory leaks.',
							suggestedFix: 'Remove the listener in useEffect cleanup, AbortController signal, or Disposable.',
						});
					}
				}

				// 8. State mutation bug in React/React Native
				if (/\b(?:state|items|list)\s*\.\s*(?:push|splice|reverse)\s*\(/.test(line) && /\buseState\b/.test(file.content)) {
					pushFinding({
						category: 'state_management_defect',
						domain: isMobile ? 'mobile' : 'frontend',
						severity: 'error',
						file: rel,
						line: lineNo,
						ruleId: 'ERIC-REACT-STATE-MUTATION',
						title: 'In-place mutation of React state array',
						explanation: 'Mutating React state directly breaks referential equality and causes missed UI updates.',
						suggestedFix: 'Produce a new immutable array via spread/filter/map before calling the state setter.',
					});
				}
			}
		}

		// ── C. Python, AI/ML & Backend Semantic Checks (Section 10) ──
		if (isPy) {
			const hasTrainTestSplit = /\btrain_test_split\s*\(/.test(file.content);
			const fitTransformIdx = file.content.search(/\.fit_transform\s*\(\s*X\b/);
			const splitIdx = file.content.search(/\btrain_test_split\s*\(/);
			if (hasTrainTestSplit && fitTransformIdx >= 0 && splitIdx >= 0 && fitTransformIdx < splitIdx) {
				const lineNo = file.content.slice(0, fitTransformIdx).split(/\r?\n/).length;
				pushFinding({
					category: 'ai_ml_defect',
					domain: 'ai_ml',
					severity: 'critical',
					file: rel,
					line: lineNo,
					ruleId: 'ERIC-ML-DATA-LEAKAGE',
					title: 'ML Data Leakage: fit_transform(X) called before train_test_split()',
					explanation: 'Fitting a scaler/encoder on the full dataset before splitting leaks test-set statistics into training and invalidates evaluation metrics.',
					suggestedFix: 'Call train_test_split() first, then fit_transform(X_train) and transform(X_test) separately (or use an sklearn Pipeline).',
				});
			}

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				const lineNo = i + 1;

				// Mutable default argument in Python
				if (/^\s*def\s+[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*=\s*(\[\]|\{\})/.test(line)) {
					pushFinding({
						category: 'algorithm_boundary_defect',
						domain: 'web_backend',
						severity: 'error',
						file: rel,
						line: lineNo,
						ruleId: 'ERIC-PY-MUTABLE-DEFAULT',
						title: 'Mutable default argument ([] or {}) in Python function signature',
						explanation: 'Default mutable objects are shared across all calls to the function, causing subtle cross-request state corruption.',
						suggestedFix: 'Use None as the default and initialize a fresh list/dict inside the function body.',
					});
				}

				// Bare except: pass
				if (/^\s*except\s*:\s*pass\b/.test(line)) {
					pushFinding({
						category: 'error_handling_defect',
						domain: 'general',
						severity: 'warning',
						file: rel,
						line: lineNo,
						ruleId: 'ERIC-PY-BARE-EXCEPT',
						title: 'Bare "except: pass" silently catches and discards all exceptions including SystemExit',
						explanation: 'Swallowing all exceptions masks genuine bugs and breaks cancellation signals.',
						suggestedFix: 'Catch specific exception types and log or handle them explicitly.',
					});
				}

				// SQL injection via f-string in Python
				if (/\.execute\s*\(\s*f['"][^'"]*(?:SELECT|INSERT|UPDATE|DELETE)\b[^'"]*\{/i.test(line)) {
					pushFinding({
						category: 'security_auth_boundary',
						domain: 'web_backend',
						severity: 'critical',
						file: rel,
						line: lineNo,
						ruleId: 'ERIC-PY-SQL-INJECTION',
						title: 'SQL f-string interpolation in database execute()',
						explanation: 'Using Python f-strings to build SQL statements creates SQL injection vulnerabilities.',
						suggestedFix: 'Pass bound parameters as the second argument to cursor.execute("... WHERE id = ?", (user_id,)).',
					});
				}
			}
		}
	}

	const criticalCount = findings.filter(f => f.severity === 'critical').length;
	const errorCount = findings.filter(f => f.severity === 'error').length;
	const warningCount = findings.filter(f => f.severity === 'warning').length;
	const weakTestOracleCount = findings.filter(f => f.category === 'weak_test_oracle').length;
	const passed = criticalCount === 0 && errorCount === 0;

	return {
		workspaceRoot,
		analyzedAtMs: Date.now(),
		filesAnalyzed: files.length,
		domainsCovered: domains.size ? [...domains] : ['general'],
		findings,
		criticalCount,
		errorCount,
		warningCount,
		weakTestOracleCount,
		passed,
		summary: passed
			? `Semantic & behavioral analysis PASSED across ${files.length} file(s) (${warningCount} warning(s)).`
			: `Semantic & behavioral analysis found ${criticalCount} critical and ${errorCount} error finding(s) across ${files.length} file(s).`,
	};
}

// ── 4. Independent Engineering Review & False-Confidence Guard (Sections 9 & 11) ───────

export function buildIndependentEngineeringReview(params: {
	workspaceRoot: string;
	semanticReport: EricSemanticReport;
	apiVerificationReport: EricApiVerificationReport;
	spec?: EricBehavioralSpec;
	testsPassed: readonly string[];
	testsFailed: readonly string[];
	toolsUsed: readonly string[];
	whatRemainsUnverified: readonly string[];
	relevantPastLessons: readonly EricFailureLesson[];
}): EricIndependentReviewReport {
	const whatWasChecked: string[] = [
		`Semantic & behavioral code analysis (${params.semanticReport.filesAnalyzed} files across ${params.semanticReport.domainsCovered.join(', ')})`,
		`Installed API declaration verification (${params.apiVerificationReport.usagesChecked} usages against ${params.apiVerificationReport.packagesInspected.length} packages)`,
	];
	if (params.spec) {
		whatWasChecked.push(`Behavioral specification "${params.spec.featureName}" (${params.spec.acceptanceCriteria.length} acceptance criteria)`);
	}

	const acceptanceTotal = params.spec?.acceptanceCriteria.length ?? 0;
	const acceptanceVerified = params.spec?.acceptanceCriteria.filter(c => c.verified).length ?? 0;

	const remainingRisks: string[] = [];
	if (params.semanticReport.criticalCount > 0 || params.semanticReport.errorCount > 0) {
		remainingRisks.push(`${params.semanticReport.criticalCount} critical / ${params.semanticReport.errorCount} semantic error(s) must be resolved.`);
	}
	if (!params.apiVerificationReport.passed) {
		remainingRisks.push(`${params.apiVerificationReport.issues.length} invalid or unverified API call(s) detected.`);
	}
	if (params.semanticReport.weakTestOracleCount > 0) {
		remainingRisks.push(`${params.semanticReport.weakTestOracleCount} weak/tautological/skipped test oracle(s) weaken verification confidence.`);
	}
	if (params.testsFailed.length > 0) {
		remainingRisks.push(`${params.testsFailed.length} test check(s) failed.`);
	}
	if (params.spec && acceptanceVerified < acceptanceTotal) {
		remainingRisks.push(`${acceptanceTotal - acceptanceVerified} acceptance criteria remain unverified.`);
	}

	const unverified = [...params.whatRemainsUnverified];
	if (params.testsPassed.length === 0 && params.testsFailed.length === 0) {
		unverified.push('No runtime/behavioral test suite was executed during this review.');
	}

	let verdict: EricReviewVerdict = 'verified_with_evidence';
	if (params.semanticReport.criticalCount > 0 || params.semanticReport.errorCount > 0 || !params.apiVerificationReport.passed || params.testsFailed.length > 0) {
		verdict = 'needs_fixes';
	} else if (unverified.length > 0 || (acceptanceTotal > 0 && acceptanceVerified < acceptanceTotal)) {
		verdict = 'partially_verified';
	}

	return {
		reviewId: `eric-rev-${Date.now().toString(36)}`,
		workspaceRoot: params.workspaceRoot,
		reviewedAtMs: Date.now(),
		verdict,
		whatWasChecked,
		toolsUsed: params.toolsUsed,
		testsPassed: params.testsPassed,
		testsFailed: params.testsFailed,
		whatRemainsUnverified: unverified,
		knownAssumptions: params.spec?.inferredAssumptions ?? [],
		remainingRisks,
		semanticReport: params.semanticReport,
		apiVerificationReport: params.apiVerificationReport,
		acceptanceCriteriaTotal: acceptanceTotal,
		acceptanceCriteriaVerified: acceptanceVerified,
		relevantPastLessons: params.relevantPastLessons,
		summary: `Independent Review Verdict: ${verdict} — semantic: ${params.semanticReport.passed ? 'PASS' : 'FAIL'}, API check: ${params.apiVerificationReport.passed ? 'PASS' : 'FAIL'}, tests passed: ${params.testsPassed.length}, failed: ${params.testsFailed.length}, unverified items: ${unverified.length}.`,
	};
}

// ── 5. Repeatable Baseline-vs-ERIC Benchmark Helper (Section 13) ───────────────────────

export function compareBenchmarkRuns(
	scenarioName: string,
	baseline: EricBenchmarkMetrics,
	withEricAndFpere: EricBenchmarkMetrics,
): EricBenchmarkComparison {
	const totalDefects = (m: EricBenchmarkMetrics) =>
		m.importDependencyErrors + m.semanticDefects + m.apiUsageDefects + m.weakTestOracles + m.securityFindings + m.integrationDefects + m.testsFailed;
	const baseDef = totalDefects(baseline);
	const impDef = totalDefects(withEricAndFpere);
	const defectDelta = baseDef - impDef;
	return {
		scenarioName,
		baseline,
		withEricAndFpere,
		defectDelta,
		summary: `${scenarioName}: baseline defects=${baseDef} (build=${baseline.firstPassBuildPassed}, tests=${baseline.testsPassed}/${baseline.testsPassed + baseline.testsFailed}) → with ERIC+FPERE defects=${impDef} (build=${withEricAndFpere.firstPassBuildPassed}, tests=${withEricAndFpere.testsPassed}/${withEricAndFpere.testsPassed + withEricAndFpere.testsFailed}); measured defect reduction=${defectDelta}.`,
	};
}

// ── Concise LLM Formatters ─────────────────────────────────────────────────────────────

export function formatSemanticReportForLLM(r: EricSemanticReport): string {
	return [
		`## ERIC Semantic & Behavioral Correctness Report`,
		`- **Result:** ${r.summary} (Domains: ${r.domainsCovered.join(', ')})`,
		...r.findings.slice(0, 15).map(f => `  - [${f.severity.toUpperCase()}][${f.ruleId}] ${f.file}:${f.line} — ${f.title}: ${f.explanation} (Fix: ${f.suggestedFix})`),
	].join('\n');
}

export function formatApiVerificationForLLM(r: EricApiVerificationReport): string {
	return [
		`## ERIC Real Installed API Verification`,
		`- **Result:** ${r.summary}`,
		...r.issues.slice(0, 12).map(i => `  - [${i.severity.toUpperCase()}] ${i.file}:${i.line} (${i.packageName}@${i.installedVersion ?? '?'}): ${i.message}`),
	].join('\n');
}

export function formatIndependentReviewForLLM(r: EricIndependentReviewReport): string {
	return [
		`## ERIC Independent Engineering Review — \`${r.verdict}\``,
		`- **Summary:** ${r.summary}`,
		`- **Checked:** ${r.whatWasChecked.join('; ')}`,
		`- **Tools Used:** ${r.toolsUsed.join(', ')}`,
		r.whatRemainsUnverified.length ? `- **Remains Unverified:** ${r.whatRemainsUnverified.join('; ')}` : '- **Remains Unverified:** None noted',
		r.knownAssumptions.length ? `- **Recorded Assumptions:** ${r.knownAssumptions.join('; ')}` : '',
		r.remainingRisks.length ? `- **Remaining Risks:**\n${r.remainingRisks.map(x => `  - ${x}`).join('\n')}` : '',
		r.relevantPastLessons.length ? `- **Relevant Past Engineering Lessons (${r.relevantPastLessons.length}):**\n${r.relevantPastLessons.slice(0, 4).map(l => `  - [${l.category}] ${l.rootCause} → ${l.verifiedFixPattern}`).join('\n')}` : '',
	].filter(Boolean).join('\n');
}
