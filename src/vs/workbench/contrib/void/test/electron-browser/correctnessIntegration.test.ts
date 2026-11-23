/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * End-to-End Electron Agent Execution-Chain Integration Test for Kodia Deep Debugging,
 * Software Correctness, Autonomous Repair & Independent Verification Engine:
 *   USER ASKS TO INVESTIGATE & VERIFY -> SYSTEM PROMPT CHECK -> correctness_open_hub ->
 *   correctness_run_compilers -> correctness_analyze_workspace -> correctness_taint_analysis ->
 *   correctness_investigate_root_cause -> correctness_plan_repair ->
 *   BAD edit_file -> correctness_independent_verify (ACTIVELY REJECTED!) ->
 *   CLEAN edit_file -> correctness_independent_verify (APPROVED + Proof Record!) ->
 *   correctness_run_fuzz_test -> correctness_assess_release_readiness -> VERIFIED COMPLETION.
 */

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { CorrectnessLiveEvent, KODIA_CORRECTNESS_CHANNEL } from '../../common/correctnessTypes.js';
import { createHarness, RecordedRequest, runTurn, ScriptedLLMService, ScriptStep } from './agentHarness.js';
import { startCorrectnessServiceProcess } from './correctnessServiceProcess.js';

suite('Kodia - End-to-End Deep Debugging, Correctness & Independent Verification Agent Loop', function () {
	this.timeout(90_000);

	let store: DisposableStore;
	let dir: string;
	const p = (rel: string) => path.join(dir, rel);

	setup(() => {
		store = new DisposableStore();
		dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kodia-correctness-e2e-')));
	});

	teardown(() => {
		store.dispose();
		fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
	});

	test('full autonomous debugging & independent verification loop: detect -> reject broken repair -> approve clean fix -> fuzz -> readiness & proof record', async () => {
		const { service: correctnessMain, stop: stopCorrectnessMain } = await startCorrectnessServiceProcess();
		const liveEvents: CorrectnessLiveEvent[] = [];
		const eventSub = correctnessMain.onDidEmitEvent(ev => liveEvents.push(ev));

		// Seed workspace with real logic defect + real SQLi taint defect + real deterministic unit test
		fs.writeFileSync(p('billing.cjs'), `exports.computeUnitPrice = function computeUnitPrice(total, qty) {
  return total / qty; // BUG: returns Infinity/NaN on qty === 0 and wrong sign when negative
};
exports.findInvoice = function findInvoice(req, db) {
  const id = req.query.invoiceId;
  return db.query("SELECT * FROM invoices WHERE id = " + id);
};
`, 'utf8');

		fs.writeFileSync(p('billing.test.cjs'), `const assert = require('assert');
const { computeUnitPrice } = require('./billing.cjs');
assert.strictEqual(computeUnitPrice(100, 4), 25);
assert.strictEqual(computeUnitPrice(100, 0), 0);
console.log('billing tests passed');
`, 'utf8');

		let step = 0;
		const lastToolContent = (req: RecordedRequest): string => {
			const last = req.messages[req.messages.length - 1] as { content?: string } | undefined;
			return typeof last?.content === 'string' ? last.content : JSON.stringify(last ?? '');
		};

		const llm = new ScriptedLLMService((_i, req: RecordedRequest): ScriptStep => {
			const payload = JSON.stringify(req.messages);
			if (step === 0) {
				const sysCombined = `${req.separateSystemMessage ?? ''}\n${payload}`;
				assert.ok(
					sysCombined.includes('DEEP DEBUGGING, SOFTWARE CORRECTNESS & INDEPENDENT VERIFICATION'),
					'System prompt must include Deep Debugging, Software Correctness & Independent Verification protocol by default',
				);
			}

			switch (step++) {
				case 0:
					return {
						text: 'Opening Correctness Hub and running compilers, workspace analysis, and taint scan.',
						toolCalls: [
							{ name: 'correctness_open_hub', params: { section: 'diagnostics' } },
							{ name: 'correctness_run_compilers', params: {} },
							{ name: 'correctness_analyze_workspace', params: { incremental: 'true' } },
							{ name: 'correctness_taint_analysis', params: {} },
						],
					};
				case 1:
					assert.match(payload, /sql_query|SQL Injection/i, 'Taint analysis must detect SQLi in billing.cjs');
					return {
						text: '',
						toolCalls: [
							{
								name: 'correctness_investigate_root_cause',
								params: {
									symptom: 'computeUnitPrice fails when qty is 0 and findInvoice has SQL injection',
									stack_trace_or_logs: 'AssertionError in billing.test.cjs at billing.cjs:2',
								},
							},
							{
								name: 'correctness_plan_repair',
								params: {
									defect_summary: 'Fix zero-qty division and parameterize SQL query in billing.cjs',
									target_files: JSON.stringify(['billing.cjs']),
									smallest_fix_strategy: 'Guard qty <= 0 in computeUnitPrice and use parameterized query in findInvoice.',
								},
							},
						],
					};
				case 2:
					// Intentionally apply an INCOMPLETE/BROKEN repair first (fixes SQLi, leaves qty===0 broken!)
					return {
						text: '',
						toolCalls: [{
							name: 'edit_file',
							params: {
								uri: p('billing.cjs'),
								search_replace_blocks: `<<<<<<< ORIGINAL\n  const id = req.query.invoiceId;\n  return db.query("SELECT * FROM invoices WHERE id = " + id);\n=======\n  const id = Number(req.query.invoiceId);\n  return db.query("SELECT * FROM invoices WHERE id = $1", [id]);\n>>>>>>> UPDATED`,
							},
						}],
					};
				case 3:
					// Independent Verification MUST reject the incomplete repair!
					return {
						text: '',
						toolCalls: [{
							name: 'correctness_independent_verify',
							params: {
								change_description: 'Attempt 1: parameterized SQL query',
								changed_files: JSON.stringify(['billing.cjs']),
								test_commands: JSON.stringify(['node billing.test.cjs']),
								require_tests: 'true',
							},
						}],
					};
				case 4:
					assert.match(lastToolContent(req), /REJECTED/, 'Independent Verification MUST REJECT incomplete fix whose unit test still fails');
					// Now apply the real complete fix for computeUnitPrice
					return {
						text: '',
						toolCalls: [{
							name: 'edit_file',
							params: {
								uri: p('billing.cjs'),
								search_replace_blocks: `<<<<<<< ORIGINAL\nexports.computeUnitPrice = function computeUnitPrice(total, qty) {\n  return total / qty; // BUG: returns Infinity/NaN on qty === 0 and wrong sign when negative\n};\n=======\nexports.computeUnitPrice = function computeUnitPrice(total, qty) {\n  if (!Number.isFinite(total) || !Number.isFinite(qty) || qty === 0) return 0;\n  return total / qty;\n};\n>>>>>>> UPDATED`,
							},
						}],
					};
				case 5:
					// Re-run Independent Verification on clean complete fix -> MUST APPROVE!
					return {
						text: '',
						toolCalls: [{
							name: 'correctness_independent_verify',
							params: {
								change_description: 'Attempt 2: guarded qty===0 and parameterized SQL query',
								changed_files: JSON.stringify(['billing.cjs']),
								requirements: JSON.stringify(['Safe unit price for zero qty', 'No SQL injection']),
								test_commands: JSON.stringify(['node billing.test.cjs']),
								require_tests: 'true',
							},
						}],
					};
				case 6:
					assert.match(lastToolContent(req), /APPROVED/, 'Independent Verification MUST APPROVE clean verified repair');
					return {
						text: '',
						toolCalls: [
							{
								name: 'correctness_run_fuzz_test',
								params: {
									target_file: 'billing.cjs',
									export_name: 'computeUnitPrice',
									property_expression: 'Number.isFinite(result)',
									arg_schema: JSON.stringify(['number', 'number']),
									iterations: '60',
									seed: '99',
								},
							},
							{
								name: 'correctness_assess_release_readiness',
								params: {},
							},
						],
					};
				default:
					assert.match(payload, /PASSED|passed/, 'Fuzz test must pass on repaired computeUnitPrice');
					assert.match(payload, /Release Readiness:/, 'Release readiness assessment must be returned');
					return { text: 'Deep debugging & independent verification complete: rejected incomplete repair, verified clean fix with unit tests, taint check, fuzzing, proof record, and release readiness.' };
			}
		});

		try {
			const base = createHarness(dir, llm, store, {
				modelSelection: { providerName: 'openAICompatible', modelName: 'kodia-correctness-test' },
				overridesOfModel: { openAICompatible: { 'kodia-correctness-test': { contextWindow: 128_000, specialToolFormat: 'openai-style' } } },
				globalSettings: { verifyBeforeFinishing: false },
				mainProcessServices: {
					[KODIA_CORRECTNESS_CHANNEL]: correctnessMain,
				},
			});

			await runTurn(base.chat, 'Deeply investigate this bug and independently verify the fix.', 60_000);
			assert.deepStrictEqual(llm.scriptErrors, [], `Script errors: ${llm.scriptErrors.join('\n')}`);
			assert.ok(liveEvents.some(e => e.type === 'compiler_check_completed'), 'Must emit compiler_check_completed over cross-process IPC');
			assert.ok(liveEvents.some(e => e.type === 'independent_verification_verdict' && e.passed === false), 'Must emit REJECTED verification event');
			assert.ok(liveEvents.some(e => e.type === 'independent_verification_verdict' && e.passed === true), 'Must emit APPROVED verification event');
			assert.ok(liveEvents.some(e => e.type === 'proof_recorded'), 'Must emit proof_recorded event');
			assert.ok(liveEvents.some(e => e.type === 'fuzz_completed' && e.passed === true), 'Must emit passing fuzz_completed event');

			const proofsDir = p('.kodia/correctness/proofs');
			assert.ok(fs.existsSync(proofsDir), 'Proofs directory must be persisted on disk');
			const proofFiles = fs.readdirSync(proofsDir).filter(f => f.endsWith('.json'));
			assert.ok(proofFiles.length >= 1, 'At least 1 Proof-Carrying Change Record JSON must be saved');
		} finally {
			eventSub.dispose();
			await stopCorrectnessMain();
		}
	});
});
