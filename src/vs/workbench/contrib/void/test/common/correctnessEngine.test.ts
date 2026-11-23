/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { assessRisk } from '../../common/autonomyPolicy.js';
import {
	analyzeTaintFlows,
	analyzeWorkspaceCorrectness,
	applySuppressions,
	assessReleaseReadiness,
	buildControlledRepairPlan,
	evaluateIndependentVerification,
	exportDiagnosticsToSarif,
	generateControlledMutants,
	investigateRootCause,
	runIncrementalCorrectnessAnalysis,
} from '../../common/correctnessEngine.js';
import { routingRoleForContext } from '../../common/modelRouting.js';
import { builtinTools } from '../../common/prompt/prompts.js';
import { ScannedSourceFile } from '../../common/projectHealth.js';
import { SUBAGENT_TYPES } from '../../common/subagents.js';
import { getToolCategory } from '../../common/toolDisplayMeta.js';

const EXPECTED_CORRECTNESS_TOOLS = [
	'correctness_open_hub',
	'correctness_analyze_workspace',
	'correctness_run_compilers',
	'correctness_taint_analysis',
	'correctness_investigate_root_cause',
	'correctness_run_fuzz_test',
	'correctness_run_mutation_test',
	'correctness_plan_repair',
	'correctness_independent_verify',
	'correctness_create_proof_record',
	'correctness_assess_release_readiness',
	'correctness_export_sarif',
	'correctness_list_proofs',
	'correctness_manage_suppressions',
] as const;

suite('Kodia - Deep Debugging & Software Correctness Engine (Common)', () => {

	test('registers all 14 correctness_* tools, metadata, risk tiers & independent verifier specialist', () => {
		for (const name of EXPECTED_CORRECTNESS_TOOLS) {
			assert.ok(name in builtinTools, `Missing builtin tool schema: ${name}`);
			assert.strictEqual(getToolCategory(name), 'debug', `${name} must belong to debug display category`);
			const risk = assessRisk(name, {});
			assert.ok(risk === 'low' || risk === 'medium', `${name} must have explicit low/medium risk tier, got ${risk}`);
		}
		assert.ok('verifier' in SUBAGENT_TYPES, 'Independent verifier subagent must be registered');
		assert.strictEqual(SUBAGENT_TYPES.verifier.canChangeFiles, false, 'Independent verifier specialist must be strictly read-only');
		assert.strictEqual(routingRoleForContext({ subagentRole: 'verifier' }), 'review', 'verifier specialist must route to review role');
	});

	test('Demo 2 & 4: detects cross-file contract mismatches, auth/authz flaws, async/resource & Python defects', () => {
		const files: ScannedSourceFile[] = [
			{
				relativePath: 'src/math.ts',
				content: `export function add(a: number, b: number) { return a + b; }\n`,
			},
			{
				relativePath: 'src/consumer.ts',
				content: [
					`import { add, missingHelper } from './math.js';`,
					`import { ghost } from './doesNotExist.js';`,
					`export async function run(items: string[]) {`,
					`  items.forEach(async (item) => { await fetch(item); });`,
					`  try { add(1, 2); } catch (e) {}`,
					`}`,
				].join('\n'),
			},
			{
				relativePath: 'src/authRoutes.ts',
				content: [
					`import jwt from 'jsonwebtoken';`,
					`import crypto from 'crypto';`,
					`export function parseUser(token: string) {`,
					`  const payload = jwt.decode(token);`,
					`  const pwHash = crypto.createHash('md5').update(token).digest('hex');`,
					`  return { payload, pwHash };`,
					`}`,
					`app.post('/admin/users/delete', async (req, res) => {`,
					`  res.json({ deleted: true });`,
					`});`,
				].join('\n'),
			},
			{
				relativePath: 'scripts/worker.py',
				content: [
					`def accumulate(item, bucket=[]):`,
					`    try:`,
					`        bucket.append(item)`,
					`    except:`,
					`        pass`,
					`    return bucket`,
				].join('\n'),
			},
		];

		const diags = analyzeWorkspaceCorrectness(files);
		const ruleIds = new Set(diags.map(d => d.ruleId));

		assert.ok(ruleIds.has('KODIA-XFILE-001'), 'Must detect unresolved relative import ./doesNotExist.js');
		assert.ok(ruleIds.has('KODIA-XFILE-002'), 'Must detect missing named export missingHelper');
		assert.ok(ruleIds.has('KODIA-ASYNC-001'), 'Must detect async callback inside forEach');
		assert.ok(ruleIds.has('KODIA-LOGIC-001'), 'Must detect empty catch block');
		assert.ok(ruleIds.has('KODIA-AUTH-001'), 'Must detect jwt.decode without signature verification');
		assert.ok(ruleIds.has('KODIA-AUTH-002'), 'Must detect unprotected admin POST route');
		assert.ok(ruleIds.has('KODIA-CRYPTO-001'), 'Must detect weak MD5 hashing in auth context');
		assert.ok(ruleIds.has('KODIA-PY-001'), 'Must detect Python bare except:');
		assert.ok(ruleIds.has('KODIA-PY-002'), 'Must detect Python mutable default argument');

		// Suppressions with justification mark matching diagnostics without deleting audit trail
		const withSup = applySuppressions(diags, [{
			id: 'sup-1',
			ruleId: 'KODIA-LOGIC-001',
			filePattern: 'consumer.ts',
			justification: 'Intentional best-effort cleanup in test fixture',
			createdAt: new Date().toISOString(),
		}]);
		const suppressedErr = withSup.find(d => d.ruleId === 'KODIA-LOGIC-001');
		assert.strictEqual(suppressedErr?.suppressed, true);
		assert.match(suppressedErr?.suppressionReason ?? '', /best-effort/);

		// SARIF 2.1.0 excludes suppressed findings and contains active ones
		const sarif = exportDiagnosticsToSarif(withSup);
		assert.strictEqual(sarif.version, '2.1.0');
		const runs = sarif.runs as Array<{ results: Array<{ ruleId: string }> }>;
		assert.ok(runs[0].results.some(r => r.ruleId === 'KODIA-AUTH-001'));
		assert.ok(!runs[0].results.some(r => r.ruleId === 'KODIA-LOGIC-001'));
	});

	test('Demo 5: Data-Flow & Taint Analysis detects SQLi, Shell, AI->eval, XSS, Path Traversal, Secret logging & respects sanitizers', () => {
		const files: ScannedSourceFile[] = [
			{
				relativePath: 'src/vulnerable.ts',
				content: [
					`const userId = req.query.id;`,
					`const sql = "SELECT * FROM users WHERE id = " + userId;`,
					`db.query(sql);`,
					`const cmd = req.body.cmd;`,
					`exec("ls " + cmd);`,
					`const llmCode = response.choices[0].message.content;`,
					`eval(llmCode);`,
					`const bio = req.body.bio;`,
					`res.send("<div>" + bio + "</div>");`,
					`const fileName = req.params.file;`,
					`fs.readFileSync(path.join('/uploads', fileName));`,
					`const secret = process.env.JWT_SECRET;`,
					`console.log("loaded", secret);`,
				].join('\n'),
			},
			{
				relativePath: 'src/safe.ts',
				content: [
					`const raw = req.body.html;`,
					`const clean = DOMPurify.sanitize(raw);`,
					`res.send("<div>" + clean + "</div>");`,
				].join('\n'),
			},
		];

		const report = analyzeTaintFlows(files);
		const sinks = new Set(report.unsafeFlows.map(f => f.sinkKind));

		assert.ok(sinks.has('sql_query'), 'Must flag HTTP -> SQLi');
		assert.ok(sinks.has('shell_exec'), 'Must flag HTTP -> Shell exec');
		assert.ok(sinks.has('code_eval'), 'Must flag AI output -> eval');
		assert.ok(sinks.has('html_render'), 'Must flag HTTP -> HTML XSS');
		assert.ok(sinks.has('file_path'), 'Must flag HTTP -> Path traversal');
		assert.ok(sinks.has('secret_log'), 'Must flag Env secret -> console.log');

		// Safe sanitized file must NOT produce an unsafe flow and must increment sanitizedFlowsCount
		assert.ok(!report.unsafeFlows.some(f => f.sink.file === 'src/safe.ts'), 'Sanitized flow must not be reported as unsafe');
		assert.ok(report.sanitizedFlowsCount >= 1, `Must count sanitized flow, got ${report.sanitizedFlowsCount}`);
	});

	test('Demo 12: Incremental Dependency-Aware Analysis caches unchanged files across 60-file workspace', () => {
		const files: ScannedSourceFile[] = [];
		files.push({ relativePath: 'src/shared.ts', content: `export function sharedValue() { return 1; }\n` });
		files.push({ relativePath: 'src/depA.ts', content: `import { sharedValue } from './shared.js';\nexport const a = sharedValue();\n` });
		files.push({ relativePath: 'src/depB.ts', content: `import { a } from './depA.js';\nexport const b = a + 1;\n` });
		for (let i = 0; i < 57; i++) {
			files.push({ relativePath: `src/leaf_${i}.ts`, content: `export const leaf${i} = ${i};\n` });
		}

		// Initial scan -> full 60 files
		const first = runIncrementalCorrectnessAnalysis({ files });
		assert.strictEqual(first.report.mode, 'full');
		assert.strictEqual(first.report.analyzedFilesCount, 60);
		assert.strictEqual(first.report.cachedSkippedFilesCount, 0);

		// Modify ONLY src/shared.ts -> second scan must be incremental and invalidate ONLY shared + depA + depB!
		const updated = files.map(f =>
			f.relativePath === 'src/shared.ts'
				? { ...f, content: `export function sharedValueRenamed() { return 2; }\n` }
				: f,
		);
		const second = runIncrementalCorrectnessAnalysis({
			files: updated,
			previousHashes: first.nextHashes,
			previousDiagnosticsByFile: first.nextDiagnosticsByFile,
		});

		assert.strictEqual(second.report.mode, 'incremental');
		assert.deepStrictEqual(second.report.changedFiles, ['src/shared.ts']);
		assert.ok(second.report.invalidatedDependents.includes('src/depA.ts'), 'Must invalidate direct dependent depA.ts');
		assert.ok(second.report.invalidatedDependents.includes('src/depB.ts'), 'Must invalidate transitive dependent depB.ts');
		assert.strictEqual(second.report.analyzedFilesCount, 3, 'Must re-analyze ONLY changed + 2 dependents');
		assert.strictEqual(second.report.cachedSkippedFilesCount, 57, 'Must reuse cache for 57 unchanged leaf files');
		// And it caught the newly broken cross-file import in depA.ts!
		assert.ok(
			second.report.diagnostics.some(d => d.file === 'src/depA.ts' && d.ruleId === 'KODIA-XFILE-002'),
			'Incremental re-analysis of dependent depA.ts must immediately catch missing export sharedValue',
		);
	});

	test('Demo 10 & 11: Root-Cause ranking, Repair Blast Radius, Mutation Generation, Independent Verification & Honest 5-Outcome Readiness', () => {
		const files: ScannedSourceFile[] = [
			{ relativePath: 'src/pricing.ts', content: `export function discount(total: number) { if (total >= 100 && total !== 0) { return total - 10; } return total; }\n` },
			{ relativePath: 'src/checkout.ts', content: `import { discount } from './pricing.js';\nexport function checkout(t: number) { return discount(t); }\n` },
			{ relativePath: 'test/checkout.test.ts', content: `import { checkout } from '../src/checkout.js';\nconsole.log(checkout(120));\n` },
		];

		// Controlled mutants generated cleanly
		const mutants = generateControlledMutants('src/pricing.ts', files[0].content, 10);
		assert.ok(mutants.length >= 2, `Must generate mutants for relational/logical/arithmetic operators, got ${mutants.length}`);

		// Controlled repair plan computes transitive blast radius & targeted tests
		const plan = buildControlledRepairPlan({
			defectSummary: 'Off-by-one threshold in discount()',
			targetFiles: ['src/pricing.ts'],
			files,
			smallestFixStrategy: 'Adjust threshold guard in src/pricing.ts',
		});
		assert.ok(plan.blastRadiusFiles.includes('src/checkout.ts'), 'Blast radius must include checkout.ts');
		assert.ok(plan.targetedTests.includes('test/checkout.test.ts'), 'Targeted tests must include checkout.test.ts');

		// Root-cause investigator produces ranked hypotheses + uncertainty when no compiler errors exist
		const inv = investigateRootCause({
			symptom: 'Checkout total returns unexpected discount on boundary value 100',
			stackTraceOrLogs: 'AssertionError at src/pricing.ts:1',
			files,
		});
		assert.ok(inv.hypotheses.length >= 1);
		assert.ok(inv.affectedFiles.includes('src/pricing.ts'));

		// Independent Verification REJECTS when no test ran or a check failed
		const rejectedNoTests = evaluateIndependentVerification({
			changeDescription: 'Fixed discount',
			changedFiles: ['src/pricing.ts'],
			checks: [
				{ name: 'tsc', category: 'compiler', status: 'passed', detail: 'ok' },
			],
			requireTests: true,
		});
		assert.strictEqual(rejectedNoTests.verdict, 'REJECTED');
		assert.ok(rejectedNoTests.rejectionReasons.length >= 1);

		const approved = evaluateIndependentVerification({
			changeDescription: 'Fixed discount with tests',
			changedFiles: ['src/pricing.ts'],
			checks: [
				{ name: 'tsc', category: 'compiler', status: 'passed', detail: 'ok' },
				{ name: 'checkout.test', category: 'tests', status: 'passed', detail: '1/1 passed' },
			],
			requireTests: true,
		});
		assert.strictEqual(approved.verdict, 'APPROVED');

		// 5-outcome honest Release Readiness
		const incomplete = assessReleaseReadiness({});
		assert.strictEqual(incomplete.outcome, 'verification_incomplete');
		assert.ok(incomplete.unverifiedDimensions.length >= 3);

		const blocked = assessReleaseReadiness({ infrastructureBlockedReason: 'Staging DB unreachable' });
		assert.strictEqual(blocked.outcome, 'blocked_infrastructure');

		const failed = assessReleaseReadiness({
			compilerOutcomes: [{ engine: 'tsc', language: 'typescript', available: true, passed: false, durationMs: 10, diagnostics: [] }],
			diagnostics: [],
			taintReport: { id: 't1', scannedAt: '', filesScanned: 3, unsafeFlows: [], sanitizedFlowsCount: 0, summary: 'clean' },
			latestVerification: approved,
		});
		assert.strictEqual(failed.outcome, 'not_ready_failures');

		const verified = assessReleaseReadiness({
			compilerOutcomes: [{ engine: 'tsc', language: 'typescript', available: true, passed: true, durationMs: 10, diagnostics: [] }],
			diagnostics: [],
			taintReport: { id: 't1', scannedAt: '', filesScanned: 3, unsafeFlows: [], sanitizedFlowsCount: 0, summary: 'clean' },
			latestVerification: approved,
		});
		assert.strictEqual(verified.outcome, 'verified_against_checks');
		assert.match(verified.explicitDisclaimer, /does not guarantee the absence of all software defects/i);
	});
});
