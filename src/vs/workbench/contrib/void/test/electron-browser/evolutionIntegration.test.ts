/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { EvolutionLiveEvent, KODIA_EVOLUTION_CHANNEL } from '../../common/evolutionTypes.js';
import { createHarness, RecordedRequest, runTurn, ScriptedLLMService, ScriptStep } from './agentHarness.js';
import { startEvolutionServiceProcess } from './evolutionServiceProcess.js';

suite('Kodia - End-to-End Next-Gen Evolution, Supply-Chain, IaC/FinOps & Capability Radar Agent Loop', function () {
	this.timeout(90_000);

	let store: DisposableStore;
	let dir: string;
	const p = (rel: string) => path.join(dir, rel);

	setup(() => {
		store = new DisposableStore();
		dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kodia-evolution-e2e-')));
	});

	teardown(() => {
		store.dispose();
		fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
	});

	test('full autonomous evolution chain: SBOM -> IaC/FinOps -> Incident Forensics -> Privacy & Modernization -> Capability Radar -> Hype Rejection & Governed Proposal', async () => {
		const { service: evolutionMain, stop: stopEvolutionMain } = await startEvolutionServiceProcess();
		const liveEvents: EvolutionLiveEvent[] = [];
		const sub = evolutionMain.onDidEmitEvent(ev => liveEvents.push(ev));

		fs.writeFileSync(p('package.json'), JSON.stringify({
			name: 'enterprise-svc',
			version: '1.0.0',
			dependencies: { express: '4.19.2', expres: '*' },
		}), 'utf8');
		fs.writeFileSync(p('Dockerfile'), `FROM node:latest\nENV SECRET_TOKEN=abc\nCMD ["node", "server.js"]\n`, 'utf8');
		fs.writeFileSync(p('server.js'), `exports.handle = function(ssn) { console.log(ssn); };\n`, 'utf8');

		let step = 0;
		const llm = new ScriptedLLMService((_i, req: RecordedRequest): ScriptStep => {
			const payload = JSON.stringify(req.messages);
			if (step === 0) {
				const sysCombined = `${req.separateSystemMessage ?? ''}\n${payload}`;
				assert.ok(
					sysCombined.includes('EVOLUTION, SUPPLY-CHAIN, INFRASTRUCTURE, COMPLIANCE & CONTINUOUS SELF-IMPROVEMENT'),
					'System prompt must include Evolution & Continuous Self-Improvement protocol by default',
				);
			}

			switch (step++) {
				case 0:
					return {
						text: 'Opening Evolution Hub and auditing supply chain SBOM, IaC/FinOps, and privacy compliance.',
						toolCalls: [
							{ name: 'evolution_open_hub', params: { section: 'radar' } },
							{ name: 'evolution_supply_chain_sbom', params: { run_live_audit: 'false' } },
							{ name: 'evolution_audit_iac_finops', params: { monthly_budget_usd: '500' } },
							{ name: 'evolution_audit_privacy_compliance', params: {} },
						],
					};
				case 1:
					assert.match(payload, /typosquat|expres/i, 'SBOM audit must flag typosquat package');
					assert.match(payload, /KODIA-DOCKER-002/i, 'IaC audit must flag Dockerfile secret');
					assert.match(payload, /GDPR/i, 'Privacy audit must flag GDPR PII logging');
					return {
						text: '',
						toolCalls: [
							{
								name: 'evolution_analyze_incident',
								params: {
									service_name: 'enterprise-svc',
									log_text: 'ERROR 500 ECONNREFUSED latency=920ms\nINFO 200 latency=20ms',
								},
							},
							{ name: 'evolution_plan_modernization', params: {} },
							{ name: 'evolution_run_capability_radar', params: {} },
						],
					};
				case 2:
					assert.match(payload, /SLO BREACHED/i, 'Incident analyzer must detect SLO breach');
					assert.match(payload, /Capability Evolution Radar/i, 'Radar must evaluate emerging capabilities');
					return {
						text: '',
						toolCalls: [
							{
								name: 'evolution_evaluate_technology',
								params: {
									name: 'Hyped Zero-Proof Self-Rewriter',
									domain: 'ai-agents',
									summary: 'Unverified experimental hype',
									license: 'Unknown',
									maturity: 'experimental',
									benchmarks_count: '0',
								},
							},
							{
								name: 'evolution_evaluate_technology',
								params: {
									name: 'OpenTelemetry Trace Linker',
									domain: 'infrastructure-cloud',
									summary: 'Correlate IDE runs with OTLP spans',
									license: 'Apache-2.0',
									maturity: 'production-proven',
									benchmarks_count: '5',
								},
							},
						],
					};
				case 3:
					assert.match(payload, /REJECT_HYPE/, 'Must reject experimental zero-evidence hype');
					assert.match(payload, /ADOPT_CANDIDATE/, 'Must classify proven Apache-2.0 tech as ADOPT_CANDIDATE');
					return {
						text: '',
						toolCalls: [{ name: 'evolution_manage_proposals', params: { action: 'list' } }],
					};
				default:
					assert.match(payload, /OpenTelemetry Trace Linker/, 'Must list persisted governed proposal');
					assert.match(payload, /autoInstallAllowed=false/, 'Must enforce zero blind installation');
					return { text: 'Completed full supply-chain SBOM, IaC/FinOps, incident/SLO, GDPR/modernization, and capability radar evolution audit.' };
			}
		});

		try {
			const base = createHarness(dir, llm, store, {
				modelSelection: { providerName: 'openAICompatible', modelName: 'kodia-evolution-test' },
				overridesOfModel: { openAICompatible: { 'kodia-evolution-test': { contextWindow: 128_000, specialToolFormat: 'openai-style' } } },
				globalSettings: { verifyBeforeFinishing: false },
				mainProcessServices: {
					[KODIA_EVOLUTION_CHANNEL]: evolutionMain,
				},
			});

			await runTurn(base.chat, 'Audit my supply chain, infrastructure, privacy compliance, and evaluate emerging capabilities.', 60_000);
			assert.deepStrictEqual(llm.scriptErrors, [], `Script errors: ${llm.scriptErrors.join('\n')}`);
			assert.ok(liveEvents.some(e => e.type === 'supply_chain_completed'));
			assert.ok(liveEvents.some(e => e.type === 'iac_finops_completed'));
			assert.ok(liveEvents.some(e => e.type === 'capability_radar_completed'));
			assert.ok(liveEvents.some(e => e.type === 'technology_evaluated'));
			assert.ok(fs.existsSync(p('.kodia/evolution/sbom.cdx.json')), 'CycloneDX SBOM must exist on disk');
			assert.ok(fs.existsSync(p('.kodia/evolution/proposals.json')), 'Governed proposals must exist on disk');
		} finally {
			sub.dispose();
			await stopEvolutionMain();
		}
	});
});
