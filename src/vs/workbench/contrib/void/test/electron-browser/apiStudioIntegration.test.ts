/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * End-to-End Electron Agent Execution-Chain Integration Test for Kodia API Engineering Studio:
 *   USER SAYS "Test my API" -> SYSTEM PROMPT CHECK -> api_open_studio -> api_discover_project ->
 *   api_runtime_start (real Node API server) -> api_generate_test_suite -> api_run_test_suite (FAIL caught!) ->
 *   api_correlate_failure (maps to server.cjs + logs) -> edit_file (repairs bug) ->
 *   restart runtime -> api_run_test_suite (100% PASS) -> api_run_load_test ->
 *   api_security_audit -> api_assess_production_readiness -> api_runtime_stop -> VERIFIED COMPLETION.
 */

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ApiLiveEvent, KODIA_API_STUDIO_CHANNEL } from '../../common/apiStudioTypes.js';
import { createHarness, RecordedRequest, runTurn, ScriptedLLMService, ScriptStep } from './agentHarness.js';
import { startApiStudioServiceProcess } from './apiStudioServiceProcess.js';

suite('Kodia - End-to-End API Engineering Studio Agent Loop', function () {
	this.timeout(90_000);

	let store: DisposableStore;
	let dir: string;
	const p = (rel: string) => path.join(dir, rel);

	setup(() => {
		store = new DisposableStore();
		dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kodia-api-e2e-')));
	});

	teardown(() => {
		store.dispose();
		fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
	});

	test('full "Test my API" autonomous chain: open studio -> discover -> start runtime -> test -> detect failure -> correlate -> repair -> retest -> load -> security -> readiness', async () => {
		const { service: apiMain, stop: stopApiMain } = await startApiStudioServiceProcess();
		const liveEvents: ApiLiveEvent[] = [];
		const eventSub = apiMain.onDidEmitEvent(ev => liveEvents.push(ev));

		// Seed workspace with a real Express-style Node API containing a real bug on /api/health (returns 500 initially!)
		fs.writeFileSync(p('package.json'), JSON.stringify({ name: 'demo-api', dependencies: { express: '^4.19.0' } }), 'utf8');
		fs.writeFileSync(p('server.cjs'), `const http = require('http');
const server = http.createServer((req, res) => {
  if (req.url === '/api/health') {
    const healthy = false;
    if (!healthy) {
      console.error('Error 500 on /api/health: flag unhealthy');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'broken' }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' });
    return res.end(JSON.stringify({ status: 'ok' }));
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});
server.listen(0, '127.0.0.1', () => {
  console.log('listening on http://127.0.0.1:' + server.address().port);
});
`, 'utf8');

		let step = 0;
		let runtimeId = '';
		let baseUrl = '';
		let suiteId = '';

		const lastToolContent = (req: RecordedRequest): string => {
			const last = req.messages[req.messages.length - 1] as { content?: string } | undefined;
			return typeof last?.content === 'string' ? last.content : JSON.stringify(last ?? '');
		};
		const extract = (text: string, regex: RegExp): string => {
			const m = regex.exec(text);
			return m ? m[1] : '';
		};

		const llm = new ScriptedLLMService((_i, req: RecordedRequest): ScriptStep => {
			const payload = JSON.stringify(req.messages);
			if (step === 0) {
				const sysCombined = `${req.separateSystemMessage ?? ''}\n${payload}`;
				assert.ok(
					sysCombined.includes('NATIVE API ENGINEERING STUDIO'),
					'System prompt must include Native API Engineering Studio guidance by default',
				);
			}

			switch (step++) {
				case 0:
					return {
						text: 'Opening native Kodia API Studio and discovering API routes.',
						toolCalls: [
							{ name: 'api_open_studio', params: { section: 'explorer' } },
							{ name: 'api_discover_project', params: {} },
						],
					};
				case 1:
					assert.match(payload, /\/api\/health/, 'Discovery must find /api/health route');
					return {
						text: '',
						toolCalls: [{ name: 'api_runtime_start', params: { name: 'demo-api', command: 'node server.cjs' } }],
					};
				case 2:
					runtimeId = extract(lastToolContent(req), /\((rt-[a-z0-9-]+)\)/i);
					baseUrl = extract(lastToolContent(req), /baseUrl=(http:\/\/127\.0\.0\.1:\d+)/);
					assert.ok(runtimeId && baseUrl, `Must capture runtimeId & baseUrl from: ${lastToolContent(req)}`);
					return {
						text: '',
						toolCalls: [{ name: 'api_generate_test_suite', params: { name: 'Health Regression Suite', base_url: baseUrl } }],
					};
				case 3:
					suiteId = extract(lastToolContent(req), /\((suite-[a-z0-9-]+)\)/i);
					assert.ok(suiteId, `Must capture suiteId from: ${lastToolContent(req)}`);
					return {
						text: '',
						toolCalls: [{ name: 'api_run_test_suite', params: { suite_id: suiteId } }],
					};
				case 4:
					assert.match(lastToolContent(req), /[1-9]\d* failed/, 'Initial suite run MUST catch the real HTTP 500 bug');
					return {
						text: '',
						toolCalls: [{ name: 'api_correlate_failure', params: { history_index: '0' } }],
					};
				case 5:
					assert.match(lastToolContent(req), /HTTP 500/, 'Failure correlator must surface HTTP 500 failure');
					return {
						text: '',
						toolCalls: [
							{
								name: 'edit_file',
								params: {
									uri: p('server.cjs'),
									search_replace_blocks: `<<<<<<< ORIGINAL\n    const healthy = false;\n=======\n    const healthy = true;\n>>>>>>> UPDATED`,
								},
							},
						],
					};
				case 6:
					return {
						text: '',
						toolCalls: [{ name: 'api_runtime_stop', params: { runtime_id: runtimeId } }],
					};
				case 7:
					return {
						text: '',
						toolCalls: [{ name: 'api_runtime_start', params: { name: 'demo-api', command: 'node server.cjs' } }],
					};
				case 8:
					runtimeId = extract(lastToolContent(req), /\((rt-[a-z0-9-]+)\)/i);
					baseUrl = extract(lastToolContent(req), /baseUrl=(http:\/\/127\.0\.0\.1:\d+)/);
					assert.ok(runtimeId && baseUrl, 'Must restart repaired server cleanly');
					return {
						text: '',
						toolCalls: [{ name: 'api_run_test_suite', params: { suite_id: suiteId, base_url: baseUrl } }],
					};
				case 9:
					// Update request URL to the newly restarted port and send live verified request
					return {
						text: '',
						toolCalls: [{
							name: 'api_send_request',
							params: {
								url: `${baseUrl}/api/health`,
								method: 'GET',
								assertions: JSON.stringify([
									{ id: 'a1', name: 'Status 200', kind: 'status_equals', expected: '200' },
									{ id: 'a2', name: 'Healthy payload', kind: 'jsonpath_equals', target: '$.status', expected: 'ok' },
								]),
							},
						}],
					};
				case 10:
					assert.match(lastToolContent(req), /200 OK/, 'Repaired endpoint must return 200 OK');
					assert.match(lastToolContent(req), /2\/2 passed/, 'All assertions must pass after repair');
					return {
						text: '',
						toolCalls: [{
							name: 'api_run_load_test',
							params: { name: 'Health Load Baseline', url: `${baseUrl}/api/health`, method: 'GET', virtual_users: '3', duration_seconds: '1', p95_threshold_ms: '2000' },
						}],
					};
				case 11:
					assert.match(lastToolContent(req), /Thresholds: PASSED/, 'Load test must pass thresholds');
					return {
						text: '',
						toolCalls: [{ name: 'api_security_audit', params: { base_url: baseUrl } }],
					};
				case 12:
					assert.match(lastToolContent(req), /API Security Score:/, 'Security audit must report measured score');
					return {
						text: '',
						toolCalls: [{ name: 'api_assess_production_readiness', params: {} }],
					};
				case 13:
					assert.match(lastToolContent(req), /Production Readiness:/, 'Readiness report must be computed from real evidence');
					return {
						text: '',
						toolCalls: [{ name: 'api_runtime_stop', params: { stop_all: 'true' } }],
					};
				default:
					return { text: 'Tested demo-api live in Kodia API Engineering Studio: discovered /api/health, caught HTTP 500 regression, repaired server.cjs, verified 200 OK + load baseline + security audit + readiness report.' };
			}
		});

		try {
			const base = createHarness(dir, llm, store, {
				modelSelection: { providerName: 'openAICompatible', modelName: 'kodia-api-studio-test' },
				overridesOfModel: { openAICompatible: { 'kodia-api-studio-test': { contextWindow: 128_000, specialToolFormat: 'openai-style' } } },
				globalSettings: { verifyBeforeFinishing: false },
				mainProcessServices: {
					[KODIA_API_STUDIO_CHANNEL]: apiMain,
				},
			});

			await runTurn(base.chat, 'Test my API.', 60_000);
			assert.deepStrictEqual(llm.scriptErrors, [], `Script errors: ${llm.scriptErrors.join('\n')}`);
			assert.ok(liveEvents.length >= 10, `Must receive real cross-process live execution events, got ${liveEvents.length}`);
			assert.ok(liveEvents.some(e => e.type === 'runtime_ready'), 'Must receive runtime_ready live event');
			assert.ok(liveEvents.some(e => e.type === 'test_suite_completed'), 'Must receive test_suite_completed live event');
			assert.ok(liveEvents.some(e => e.type === 'load_completed'), 'Must receive load_completed live event');
			assert.ok(fs.existsSync(p('.kodia/api-studio/history.json')), 'API history must persist on disk');
			assert.ok(fs.existsSync(p('.kodia/api-studio/test-runs.json')), 'API test runs must persist on disk');
			assert.ok(fs.existsSync(p('.kodia/api-studio/load-runs.json')), 'API load runs must persist on disk');
			assert.ok(fs.existsSync(p('.kodia/api-studio/security-reports.json')), 'API security reports must persist on disk');
		} finally {
			eventSub.dispose();
			await stopApiMain();
		}
	});
});
