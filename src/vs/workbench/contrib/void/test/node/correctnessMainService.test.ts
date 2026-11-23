/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assessReleaseReadiness } from '../../common/correctnessEngine.js';
import { CorrectnessLiveEvent } from '../../common/correctnessTypes.js';
import { KodiaCorrectnessMainService } from '../../electron-main/correctnessMainService.js';

suite('Kodia - Deep Debugging, Correctness, Fuzz, Mutation & Independent Verification (Node Main Service)', function () {
	this.timeout(90_000);

	let service: KodiaCorrectnessMainService;
	let dir: string;
	let events: CorrectnessLiveEvent[];
	const p = (rel: string) => path.join(dir, rel);

	setup(() => {
		service = new KodiaCorrectnessMainService();
		events = [];
		service.onDidEmitEvent(ev => events.push(ev));
		dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kodia-correctness-node-')));
	});

	teardown(() => {
		service.dispose();
		fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
	});

	test('Demo 1 & 14: real multi-language compilers detect syntax/type defects in JS, TS & Python and confirm clean repair', async () => {
		// Broken JS
		fs.writeFileSync(p('broken.js'), `function bad( { return 1;\n`, 'utf8');
		// Broken TS + tsconfig
		fs.writeFileSync(p('tsconfig.json'), JSON.stringify({
			compilerOptions: { strict: true, noEmit: true, target: 'ES2022', module: 'CommonJS', skipLibCheck: true },
			include: ['broken.ts'],
		}), 'utf8');
		fs.writeFileSync(p('broken.ts'), `export function greet(name: string): number { return name; }\n`, 'utf8');
		// Broken Python
		fs.writeFileSync(p('broken.py'), `def bad(:\n    return 1\n`, 'utf8');

		const initial = await service.runCompilerAndAnalyzers(dir);
		const jsCheck = initial.find(c => c.language.toLowerCase() === 'javascript');
		const tsCheck = initial.find(c => c.language.toLowerCase() === 'typescript');
		const pyCheck = initial.find(c => c.language.toLowerCase() === 'python');

		assert.ok(jsCheck && jsCheck.available, 'node --check must be available');
		assert.strictEqual(jsCheck.passed, false, 'node --check must fail on broken.js');
		assert.ok(jsCheck.diagnostics.some(d => d.file.includes('broken.js')), 'Must report broken.js diagnostic');

		assert.ok(tsCheck && tsCheck.available, 'tsc must be available');
		assert.strictEqual(tsCheck.passed, false, 'tsc --noEmit must fail on broken.ts');
		assert.ok(tsCheck.diagnostics.some(d => d.file.includes('broken.ts')), 'Must report broken.ts line diagnostic');

		if (pyCheck && pyCheck.available) {
			assert.strictEqual(pyCheck.passed, false, 'python py_compile must fail on broken.py');
			assert.ok(pyCheck.diagnostics.some(d => d.file.includes('broken.py')), 'Must report broken.py diagnostic');
		}

		// Fix all files and re-run compilers
		fs.writeFileSync(p('broken.js'), `function ok() { return 1; }\nmodule.exports = { ok };\n`, 'utf8');
		fs.writeFileSync(p('broken.ts'), `export function greet(name: string): string { return name; }\n`, 'utf8');
		fs.writeFileSync(p('broken.py'), `def ok():\n    return 1\n`, 'utf8');

		const repaired = await service.runCompilerAndAnalyzers(dir);
		for (const c of repaired.filter(o => o.available)) {
			assert.strictEqual(c.passed, true, `Compiler ${c.engine} (${c.language}) must pass after fix: ${c.rawOutput}`);
		}
		assert.ok(events.some(e => e.type === 'compiler_check_completed'), 'Must emit live compiler_check_completed events');
	});

	test('Demo 9: real Property/Fuzz Testing discovers edge-case counterexample, minimizes input, saves corpus & passes after fix', async () => {
		fs.writeFileSync(p('calc.cjs'), `exports.safeDivide = function safeDivide(a, b) {
  return a / b; // BUG: fails when b === 0 (Infinity/NaN)
};
`, 'utf8');

		const failReport = await service.runPropertyFuzzTest(dir, {
			targetFile: 'calc.cjs',
			exportName: 'safeDivide',
			propertyExpression: 'Number.isFinite(result)',
			argSchema: ['number', 'number'],
			iterations: 80,
			seed: 1337,
		});

		assert.strictEqual(failReport.passed, false, 'Fuzz runner MUST catch division-by-zero edge case');
		assert.ok(failReport.counterexample, 'Must produce counterexample');
		assert.strictEqual(failReport.counterexample.minimizedArgs[1], 0, 'Minimizer must shrink divisor to 0');
		assert.match(failReport.counterexample.regressionTestSnippet, /safeDivide/);
		assert.ok(fs.existsSync(p('.kodia/correctness/fuzz-corpus.json')), 'Must persist fuzz corpus to disk');

		// Fix the edge case and re-run with exact same seed
		fs.writeFileSync(p('calc.cjs'), `exports.safeDivide = function safeDivide(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return 0;
  return a / b;
};
`, 'utf8');

		const passReport = await service.runPropertyFuzzTest(dir, {
			targetFile: 'calc.cjs',
			exportName: 'safeDivide',
			propertyExpression: 'Number.isFinite(result)',
			argSchema: ['number', 'number'],
			iterations: 80,
			seed: 1337,
		});

		assert.strictEqual(passReport.passed, true, `Fuzz test must pass after edge-case repair: ${passReport.summary}`);
		assert.strictEqual(passReport.counterexample, undefined);
	});

	test('Mutation Testing (§12): executes mutants in isolated temp copy without ever touching original workspace', async () => {
		const originalSource = `exports.isEligible = function isEligible(age, active) {
  if (age >= 18 && active === true) {
    return true;
  }
  return false;
};
`;
		fs.writeFileSync(p('elig.cjs'), originalSource, 'utf8');
		fs.writeFileSync(p('elig.test.cjs'), `const assert = require('assert');
const { isEligible } = require('./elig.cjs');
assert.strictEqual(isEligible(20, true), true);
assert.strictEqual(isEligible(15, true), false);
assert.strictEqual(isEligible(20, false), false);
console.log('ok');
`, 'utf8');

		const mutReport = await service.runMutationTesting(dir, {
			targetFile: 'elig.cjs',
			testCommand: 'node elig.test.cjs',
			maxMutants: 6,
			timeoutMs: 10_000,
		});

		assert.strictEqual(mutReport.error, undefined, `Mutation run failed unexpectedly: ${mutReport.error}`);
		assert.ok(mutReport.totalMutants >= 2, `Expected at least 2 mutants, got ${mutReport.totalMutants}`);
		assert.ok(mutReport.killed >= 1, 'Strong assertions must kill at least 1 mutant');
		// Boundary age === 18 is NOT tested by elig.test.cjs, so >= -> > mutant MUST survive!
		assert.ok(mutReport.survived >= 1, 'Untested boundary (age === 18) must reveal surviving mutant');
		assert.strictEqual(fs.readFileSync(p('elig.cjs'), 'utf8'), originalSource, 'Original user workspace file must NEVER be mutated');
		assert.ok(fs.existsSync(p('.kodia/correctness/mutation-runs.json')), 'Must persist mutation run report');
	});

	test('Demos 7, 8, 11, 13: Independent Verification actively REJECTS broken/tainted repairs, APPROVES clean fix, writes Proof Record & Readiness', async () => {
		fs.writeFileSync(p('service.cjs'), `exports.total = function total(price, qty) {
  return price + qty; // BUG: should multiply
};
`, 'utf8');
		fs.writeFileSync(p('service.test.cjs'), `const assert = require('assert');
const { total } = require('./service.cjs');
assert.strictEqual(total(10, 3), 30);
`, 'utf8');

		// 1. Broken repair attempt -> MUST be REJECTED by Independent Verification!
		const rejected = await service.runIndependentVerification(dir, {
			changeDescription: 'Attempted fix for total() calculation',
			changedFiles: ['service.cjs'],
			requirements: ['total(price, qty) must return price * qty'],
			testCommands: ['node service.test.cjs'],
			requireTests: true,
		});

		assert.strictEqual(rejected.verdict, 'REJECTED', 'Independent Verification MUST reject failing test');
		assert.ok(rejected.rejectionReasons.length >= 1, 'Must list concrete rejection reasons');

		// 2. Apply a repair that passes tests BUT introduces a critical SQLi taint defect -> MUST STILL BE REJECTED!
		fs.writeFileSync(p('service.cjs'), `exports.total = function total(price, qty) {
  return price * qty;
};
exports.unsafeLookup = function unsafeLookup(req, db) {
  const id = req.query.id;
  return db.query("SELECT * FROM orders WHERE id = " + id);
};
`, 'utf8');

		const rejectedTaint = await service.runIndependentVerification(dir, {
			changeDescription: 'Fix total() with unsafe query helper',
			changedFiles: ['service.cjs'],
			testCommands: ['node service.test.cjs'],
			requireTests: true,
		});
		assert.strictEqual(rejectedTaint.verdict, 'REJECTED', 'Independent Verification MUST reject newly introduced critical SQLi taint flow');
		assert.ok(rejectedTaint.rejectionReasons.some(r => /taint/i.test(r)), 'Rejection reason must cite taint security regression');

		// 3. Apply clean, safe repair -> APPROVED + Proof-Carrying Change Record persisted!
		fs.writeFileSync(p('service.cjs'), `exports.total = function total(price, qty) {
  return price * qty;
};
`, 'utf8');

		const approved = await service.runIndependentVerification(dir, {
			changeDescription: 'Clean fix: total() multiplies price * qty',
			changedFiles: ['service.cjs'],
			requirements: ['total(price, qty) returns price * qty'],
			testCommands: ['node service.test.cjs'],
			requireTests: true,
		});

		assert.strictEqual(approved.verdict, 'APPROVED', `Clean fix must be APPROVED, got: ${approved.rejectionReasons.join('; ')}`);
		assert.ok(approved.proofRecordId, 'Approved verification must generate Proof-Carrying Change Record ID');
		const proofFile = p(`.kodia/correctness/proofs/${approved.proofRecordId}.json`);
		assert.ok(fs.existsSync(proofFile), `Proof record must exist at ${proofFile}`);

		const snap = await service.loadWorkspaceSnapshot(dir);
		assert.ok(snap.proofs.some(pr => pr.id === approved.proofRecordId && pr.independentVerdict === 'APPROVED'));

		const compilers = await service.runCompilerAndAnalyzers(dir);
		const readiness = assessReleaseReadiness({
			compilerOutcomes: compilers,
			diagnostics: [],
			taintReport: { id: 't-clean', scannedAt: new Date().toISOString(), filesScanned: 2, unsafeFlows: [], sanitizedFlowsCount: 0, summary: 'clean' },
			latestVerification: approved,
		});
		assert.strictEqual(readiness.outcome, 'verified_against_checks');
	});
});
