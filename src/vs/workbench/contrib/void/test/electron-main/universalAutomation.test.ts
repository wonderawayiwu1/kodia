/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'node:assert';
import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { UniversalAutomationCoreService } from '../../electron-main/universalAutomationCore.js';

function makeTempDir(prefix: string): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function startLocalHttpServer(handler: http.RequestListener): Promise<{ server: http.Server; url: string }> {
	return new Promise((resolve, reject) => {
		const server = http.createServer(handler);
		server.on('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const addr = server.address();
			if (!addr || typeof addr === 'string') return reject(new Error('Failed to bind ephemeral port'));
			resolve({ server, url: `http://127.0.0.1:${addr.port}` });
		});
	});
}

suite('Kodia Universal Automation Engineering Platform (UAEP) — Reliability Laboratory (Demos 1–15)', () => {
	const tempDirs: string[] = [];
	const openServers: http.Server[] = [];

	teardown(async () => {
		while (openServers.length) {
			const s = openServers.pop()!;
			await new Promise<void>(res => s.close(() => res()));
		}
		while (tempDirs.length) {
			const d = tempDirs.pop()!;
			try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
		}
	});

	test('Demo 1 & 6: Visual Workflow Execution + Real External HTTP API with Encrypted Tenant Credentials', async function () {
		this.timeout(15000);
		const root = makeTempDir('kodia-uaep-d1-d6-');
		tempDirs.push(root);
		const svc = new UniversalAutomationCoreService();

		let receivedAuth = '';
		const { server, url } = await startLocalHttpServer((req, res) => {
			receivedAuth = String(req.headers.authorization || '');
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ customerId: 'CUS-777', verified: true }));
		});
		openServers.push(server);

		const apiToken = 'bearer_live_secret_token_991122';
		await svc.saveTenantCredential(root, { tenantId: 'org-acme', name: 'Partner API', provider: 'http', envKey: 'PARTNER_API_TOKEN', secretValue: apiToken });

		// Verify secret is encrypted on disk (never plaintext)
		const vaultText = fs.readFileSync(path.join(root, '.kodia', 'automation', 'tenants', 'org-acme', 'vault.json'), 'utf8');
		assert.ok(!vaultText.includes(apiToken), 'Plaintext secret must NOT exist in vault.json');

		const wf = await svc.saveWorkflow(root, {
			tenantId: 'org-acme',
			name: 'Partner Customer Sync',
			description: 'Calls live partner API and transforms result inside VM sandbox',
			status: 'active',
			executionModel: 'interpreted',
			environment: 'testing',
			tags: ['http', 'sandbox'],
			nodes: [
				{ id: 't1', type: 'trigger.manual', category: 'trigger', label: 'Start', position: { x: 40, y: 100 }, config: {} },
				{ id: 'v1', type: 'data.schema_validate', category: 'data', label: 'Validate', position: { x: 240, y: 100 }, config: { requiredFields: ['email'] } },
				{ id: 'h1', type: 'action.http_request', category: 'action', label: 'Fetch Partner', position: { x: 440, y: 100 }, credentialRef: 'PARTNER_API_TOKEN', config: { method: 'GET', url: `${url}/customer` } },
				{ id: 's1', type: 'dev.sandbox_js', category: 'developer', label: 'Enrich JS', position: { x: 640, y: 100 }, config: { code: 'return { email: input.email, partnerId: input.response.customerId, ok: true };' } },
			],
			edges: [
				{ id: 'e1', sourceNodeId: 't1', targetNodeId: 'v1' },
				{ id: 'e2', sourceNodeId: 'v1', targetNodeId: 'h1' },
				{ id: 'e3', sourceNodeId: 'h1', targetNodeId: 's1' },
			],
		});

		const exec = await svc.executeWorkflow(root, { workflowId: wf.id, tenantId: 'org-acme', triggerInput: { email: 'cto@acme.io' } });
		assert.strictEqual(exec.status, 'completed');
		assert.strictEqual(receivedAuth, `Bearer ${apiToken}`);
		assert.strictEqual(exec.contextData.partnerId, 'CUS-777');
		assert.strictEqual(exec.contextData.ok, true);
		svc.dispose();
	});

	test('Demo 2, 3 & 4: AI Workflow Generation, Conversational Modification, TS/JS/Python Codegen & Bidirectional Sync Drift Detection', async () => {
		const root = makeTempDir('kodia-uaep-d2-d4-');
		tempDirs.push(root);
		const svc = new UniversalAutomationCoreService();

		const gen = await svc.generateWorkflowFromPrompt(root, {
			prompt: 'Whenever a new customer registers via webhook, verify email, check if customer already exists, add customer to CRM, send welcome email, and notify sales team.',
			tenantId: 'default',
			name: 'Customer Onboarding Flow',
		});
		assert.strictEqual(gen.compileReport.valid, true);
		assert.ok(gen.workflow.nodes.length >= 5);

		// Conversational modification preserves existing nodes and bumps version
		const mod = await svc.modifyWorkflowFromPrompt(root, {
			workflowId: gen.workflow.id,
			instruction: 'Add human approval gate before final step',
		});
		assert.strictEqual(mod.workflow.version, 2);
		assert.strictEqual(mod.workflow.nodes.length, gen.workflow.nodes.length + 1);
		assert.ok(mod.workflow.nodes.some(n => n.type === 'logic.human_approval'));

		// Compile to TypeScript and write to disk
		const tsCompile = await svc.compileWorkflow(root, { workflowId: mod.workflow.id, targetLanguage: 'typescript', writeToDir: 'generated-ts' });
		assert.strictEqual(tsCompile.valid, true);
		assert.ok(fs.existsSync(path.join(root, 'generated-ts/src/workflow.ts')));
		assert.ok(fs.existsSync(path.join(root, 'generated-ts/Dockerfile')));

		// Compile to Python as well
		const pyCompile = await svc.compileWorkflow(root, { workflowId: mod.workflow.id, targetLanguage: 'python', writeToDir: 'generated-py' });
		assert.strictEqual(pyCompile.valid, true);
		assert.ok(fs.existsSync(path.join(root, 'generated-py/src/workflow.py')));

		// Bidirectional sync check: initially in sync, then detects manual modification conflict
		const syncOk = await svc.checkWorkflowCodeSync(root, { workflowId: mod.workflow.id, generatedFilePath: 'generated-ts/src/workflow.ts' });
		assert.strictEqual(syncOk.inSync, true);

		const genFile = path.join(root, 'generated-ts/src/workflow.ts');
		fs.appendFileSync(genFile, '\n// MANUAL-EDIT custom business override\n', 'utf8');
		const syncDrift = await svc.checkWorkflowCodeSync(root, { workflowId: mod.workflow.id, generatedFilePath: 'generated-ts/src/workflow.ts' });
		assert.strictEqual(syncDrift.inSync, false);
		assert.strictEqual(syncDrift.manualModificationsDetected, true);
		svc.dispose();
	});

	test('Demo 5: BYOK AI Agent Node Calls Real OpenAI-Compatible Endpoint & Fails Honestly When Key Missing', async function () {
		this.timeout(15000);
		const root = makeTempDir('kodia-uaep-d5-');
		tempDirs.push(root);
		const svc = new UniversalAutomationCoreService();

		const { server, url } = await startLocalHttpServer((req, res) => {
			if (req.headers.authorization !== 'Bearer nvapi-byok-live-key-12345') {
				res.writeHead(401, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: 'Unauthorized' }));
				return;
			}
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ choices: [{ message: { content: 'Classified: HIGH_PRIORITY_BILLING' } }], usage: { total_tokens: 42 } }));
		});
		openServers.push(server);

		const wf = await svc.saveWorkflow(root, {
			tenantId: 'org-ai',
			name: 'AI Ticket Triage',
			description: 'BYOK AI classification',
			status: 'active',
			executionModel: 'interpreted',
			environment: 'testing',
			tags: ['ai'],
			nodes: [
				{ id: 't1', type: 'trigger.manual', category: 'trigger', label: 'Ticket', position: { x: 40, y: 100 }, config: {} },
				{ id: 'ai1', type: 'ai.llm_completion', category: 'ai', label: 'NVIDIA Triage', position: { x: 260, y: 100 }, credentialRef: 'NVIDIA_API_KEY', config: { provider: 'nvidia', model: 'nvidia/nemotron', endpoint: `${url}/v1/chat/completions`, prompt: 'Classify ticket: {{text}}' } },
			],
			edges: [{ id: 'e1', sourceNodeId: 't1', targetNodeId: 'ai1' }],
		});

		// Without credential: MUST fail honestly (never fake an AI reply!)
		const failed = await svc.executeWorkflow(root, { workflowId: wf.id, tenantId: 'org-ai', triggerInput: { text: 'Double charge on invoice' } });
		assert.strictEqual(failed.status, 'failed');
		assert.ok(failed.error?.includes('Missing BYOK credential'));

		// With encrypted BYOK credential: executes real HTTP call & tracks real token usage
		await svc.saveTenantCredential(root, { tenantId: 'org-ai', name: 'NVIDIA NIM', provider: 'nvidia', envKey: 'NVIDIA_API_KEY', secretValue: 'nvapi-byok-live-key-12345' });
		const ok = await svc.executeWorkflow(root, { workflowId: wf.id, tenantId: 'org-ai', triggerInput: { text: 'Double charge on invoice' } });
		assert.strictEqual(ok.status, 'completed');
		assert.strictEqual(ok.contextData.aiOutput, 'Classified: HIGH_PRIORITY_BILLING');
		assert.strictEqual(ok.aiTokensUsed, 42);
		svc.dispose();
	});

	test('Demo 7, 8, 9 & 14: Export Zero-Secret Standalone Runtime & Execute Independently Without Kodia', async function () {
		this.timeout(15000);
		const root = makeTempDir('kodia-uaep-d7-d9-');
		tempDirs.push(root);
		const svc = new UniversalAutomationCoreService();

		const secret = 'sk_live_never_export_me_123456789';
		await svc.saveTenantCredential(root, { tenantId: 'default', name: 'Stripe', provider: 'stripe', envKey: 'STRIPE_SECRET_KEY', secretValue: secret });

		const gen = await svc.generateWorkflowFromPrompt(root, { prompt: 'When webhook triggers, validate payload and notify ops channel', name: 'Independent Webhook Worker' });
		const exported = await svc.exportPortablePackage(root, { workflowId: gen.workflow.id, target: 'air_gapped_regulated', outputDir: 'standalone-pkg' });
		assert.strictEqual(exported.zeroSecretsVerified, true);
		assert.ok(exported.filesWritten.includes('runtime/server.mjs'));
		assert.ok(exported.filesWritten.includes('Dockerfile'));
		assert.ok(exported.filesWritten.includes('deployment-manifest.json'));

		// Spawn exported runtime/server.mjs as a totally independent Node process (zero dependency on Kodia!)
		const pkgDir = path.join(root, 'standalone-pkg');
		const proc = cp.spawn(process.execPath, ['runtime/server.mjs'], { cwd: pkgDir, env: { ...process.env, UAEP_PORT: '0' }, windowsHide: true });
		try {
			const port = await new Promise<number>((resolve, reject) => {
				let buf = '';
				const t = setTimeout(() => reject(new Error(`Standalone runtime timed out: ${buf}`)), 8000);
				proc.stdout?.on('data', d => {
					buf += String(d);
					const m = /UAEP_READY:(\d+)/.exec(buf);
					if (m) { clearTimeout(t); resolve(Number(m[1])); }
				});
				proc.on('error', e => { clearTimeout(t); reject(e); });
			});

			const health = await fetch(`http://127.0.0.1:${port}/health`).then(r => r.json()) as { ok: boolean; independentOfKodia: boolean };
			assert.strictEqual(health.ok, true);
			assert.strictEqual(health.independentOfKodia, true);

			const run = await fetch(`http://127.0.0.1:${port}/webhook`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ event: 'order.created', orderId: 99 }),
			}).then(r => r.json()) as { status: string; output: { orderId: number } };
			assert.strictEqual(run.status, 'completed');
			assert.strictEqual(run.output.orderId, 99);

			const history = await fetch(`http://127.0.0.1:${port}/executions`).then(r => r.json()) as { executions: unknown[] };
			assert.strictEqual(history.executions.length, 1);
		} finally {
			proc.kill();
		}
		svc.dispose();
	});

	test('Demo 10: Embedded Multi-Tenant Automation Platform Generator Produces Tested Standalone App', async function () {
		this.timeout(15000);
		const root = makeTempDir('kodia-uaep-d10-');
		tempDirs.push(root);
		const svc = new UniversalAutomationCoreService();

		const emb = await svc.generateEmbeddedPlatform(root, { appName: 'Acme Workflow Cloud', outputDir: 'acme-automation-app', multiTenant: true });
		assert.strictEqual(emb.multiTenant, true);
		assert.ok(emb.filesWritten.includes('public/index.html'));
		assert.ok(emb.filesWritten.includes('src/platformEngine.mjs'));

		// Execute the generated app's own real test suite!
		const runTest = cp.spawnSync(process.execPath, ['--test'], { cwd: path.join(root, 'acme-automation-app'), encoding: 'utf8', windowsHide: true });
		assert.strictEqual(runTest.status, 0, `Embedded platform tests failed: ${runTest.stdout}\n${runTest.stderr}`);
		svc.dispose();
	});

	test('Demo 11, 12 & 13: Multi-Tenant Isolation, Sandbox Escape Block, Durable Recovery, Idempotency & Hash-Chained Audit Log', async () => {
		const root = makeTempDir('kodia-uaep-d11-d13-');
		tempDirs.push(root);
		const svc = new UniversalAutomationCoreService();

		// 1. Multi-tenant isolation
		const credA = await svc.saveTenantCredential(root, { tenantId: 'tenant-alpha', name: 'Stripe Alpha', provider: 'stripe', envKey: 'STRIPE_SECRET_KEY', secretValue: 'sk_test_alpha_secret_123456' });
		const wfA = await svc.saveWorkflow(root, {
			tenantId: 'tenant-alpha',
			name: 'Alpha Payment Approval Flow',
			description: 'Payment with idempotency + human approval',
			status: 'active',
			executionModel: 'interpreted',
			environment: 'production',
			tags: ['finance'],
			nodes: [
				{ id: 't1', type: 'trigger.manual', category: 'trigger', label: 'Start', position: { x: 40, y: 100 }, config: {} },
				{ id: 'pay1', type: 'action.payment_charge', category: 'action', label: 'Charge Card', position: { x: 240, y: 100 }, credentialRef: 'STRIPE_SECRET_KEY', idempotencyKeyExpr: 'inv-{{invoiceId}}', config: { amountCents: 5000 } },
				{ id: 'appr1', type: 'logic.human_approval', category: 'logic', label: 'CFO Approval', position: { x: 440, y: 100 }, config: { approverRole: 'cfo' } },
				{ id: 'done1', type: 'data.transform', category: 'data', label: 'Finalize Ledger', position: { x: 640, y: 100 }, config: { mappings: { settled: 'yes' } } },
			],
			edges: [
				{ id: 'e1', sourceNodeId: 't1', targetNodeId: 'pay1' },
				{ id: 'e2', sourceNodeId: 'pay1', targetNodeId: 'appr1' },
				{ id: 'e3', sourceNodeId: 'appr1', targetNodeId: 'done1' },
			],
		});

		const isoWf = await svc.verifyTenantIsolation(root, { requestingTenantId: 'tenant-beta', targetWorkflowId: wfA.id });
		const isoCred = await svc.verifyTenantIsolation(root, { requestingTenantId: 'tenant-beta', targetCredentialId: credA.id });
		assert.strictEqual(isoWf.allowed, false);
		assert.strictEqual(isoCred.allowed, false);
		await assert.rejects(() => svc.executeWorkflow(root, { workflowId: wfA.id, tenantId: 'tenant-beta' }), /Tenant isolation violation/);

		// 2. Sandbox escape blocked at compile time
		const evilWf = await svc.saveWorkflow(root, {
			tenantId: 'tenant-alpha',
			name: 'Evil Sandbox',
			description: 'Should fail security compiler check',
			status: 'draft',
			executionModel: 'interpreted',
			environment: 'development',
			tags: [],
			nodes: [{ id: 's1', type: 'dev.sandbox_js', category: 'developer', label: 'Escape', position: { x: 40, y: 40 }, config: { code: "require('fs').readFileSync('/etc/passwd')" } }],
			edges: [],
		});
		const evilCompile = await svc.compileWorkflow(root, { workflowId: evilWf.id, tenantId: 'tenant-alpha' });
		assert.strictEqual(evilCompile.valid, false);
		assert.ok(evilCompile.diagnostics.some(d => d.code === 'UAEP-SEC-002'));

		// 3. Durable wait + crash interrupt + resume + idempotent non-duplicate payment!
		const run1 = await svc.executeWorkflow(root, { workflowId: wfA.id, tenantId: 'tenant-alpha', triggerInput: { invoiceId: 'INV-500' } });
		assert.strictEqual(run1.status, 'waiting_approval');

		const interrupted = await svc.interruptExecution(root, run1.executionId, 'tenant-alpha');
		assert.strictEqual(interrupted.status, 'interrupted');

		const resumed = await svc.resumeExecution(root, { executionId: run1.executionId, tenantId: 'tenant-alpha', approvalGranted: true });
		assert.strictEqual(resumed.status, 'completed');
		assert.strictEqual(resumed.contextData.settled, 'yes');

		// Re-running with same invoiceId hits idempotency ledger instead of charging twice!
		const dupRun = await svc.executeWorkflow(root, { workflowId: wfA.id, tenantId: 'tenant-alpha', triggerInput: { invoiceId: 'INV-500' } });
		const payStep = dupRun.steps.find(s => s.nodeId === 'pay1');
		assert.strictEqual(payStep?.idempotencyHit, true);

		// 4. Operations Snapshot & Hash-Chained Audit Logs
		const snap = await svc.getSnapshot(root, 'tenant-alpha');
		assert.strictEqual(snap.completedExecutions, 1);
		assert.strictEqual(snap.pausedOrWaitingExecutions, 1);
		assert.ok(snap.recentAuditLogs.length >= 2);
		assert.ok(snap.recentAuditLogs[0].entryHash.length === 64);
		svc.dispose();
	});
});
