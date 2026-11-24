/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ContextCompactionService } from '../../common/contextCompactionService.js';
import { evaluateTaskDagReadiness } from '../../common/firstPassReliabilityEngine.js';
import { FirstPassReliabilityCoreService } from '../../electron-main/firstPassReliabilityCore.js';

function mkTempDir(prefix: string): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

suite('Kodia First-Pass Engineering Reliability Engine (FPERE) — Scenarios A through H', () => {
	const tempDirs: string[] = [];
	const mkDir = (prefix: string) => {
		const d = mkTempDir(prefix);
		tempDirs.push(d);
		return d;
	};

	teardown(() => {
		for (const d of tempDirs.splice(0)) {
			try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
		}
	});

	test('Scenario A: Small application passes import/export, compiler, and real runtime test Quality Gate on first pass', async function () {
		this.timeout(15000);
		const root = mkDir('kodia-fpere-a-');
		fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'small-app', type: 'module', dependencies: {} }, null, 2));
		fs.writeFileSync(path.join(root, 'math.js'), 'export function sum(a, b) { return a + b; }\n');
		fs.writeFileSync(path.join(root, 'index.js'), 'import { sum } from "./math.js";\nexport const total = sum(2, 3);\n');
		fs.writeFileSync(path.join(root, 'index.test.js'), 'import assert from "node:assert";\nimport { total } from "./index.js";\nassert.strictEqual(total, 5);\nconsole.log("SCENARIO_A_OK");\n');

		const svc = new FirstPassReliabilityCoreService();
		const gate = await svc.runFirstPassQualityGate(root, {
			unitLabel: 'Scenario A Small App',
			runCompiler: true,
			runTestCommand: 'node index.test.js',
		});

		assert.strictEqual(gate.passed, true);
		assert.strictEqual(gate.stage, 'tests_passed');
		assert.strictEqual(gate.importExportReport.errorCount, 0);
		assert.strictEqual(gate.compilerErrors, 0);
		assert.strictEqual(gate.testPassed, true);
		svc.dispose();
	});

	test('Scenario B & Scenario C: Full-stack + AI-powered app catches mismatched API contracts & client-side secret leaks, then passes once aligned', async () => {
		const root = mkDir('kodia-fpere-bc-');
		fs.mkdirSync(path.join(root, 'backend'), { recursive: true });
		fs.mkdirSync(path.join(root, 'frontend'), { recursive: true });

		fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fullstack-ai', dependencies: { express: '^5.0.0' } }, null, 2));
		fs.writeFileSync(path.join(root, '.env.example'), 'NVIDIA_API_KEY=\nDATABASE_URL=\n');
		fs.writeFileSync(path.join(root, 'backend', 'schema.sql'), 'CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT);\nCREATE TABLE messages (id INTEGER PRIMARY KEY, body TEXT);\n');
		fs.writeFileSync(path.join(root, 'backend', 'routes.js'), [
			'import express from "express";',
			'export const router = express.Router();',
			'router.get("/api/users", (_req, res) => res.json([]));',
			'router.post("/api/ai/chat", (_req, res) => { const k = process.env.NVIDIA_API_KEY; res.json({ ok: Boolean(k) }); });',
		].join('\n'));
		// Deliberate baseline defects: wrong endpoint path + client-side hardcoded AI key!
		fs.writeFileSync(path.join(root, 'frontend', 'apiClient.js'), [
			'const LEAK = "nvapi-1234567890abcdef12345";',
			'export async function loadUsers() { return fetch("/api/wrong-users"); }',
		].join('\n'));

		const svc = new FirstPassReliabilityCoreService();
		await svc.saveBlueprint(root, {
			title: 'Full-Stack AI Workspace',
			objective: 'Verified backend + frontend + AI proxy',
			stack: ['Node.js', 'Express', 'SQLite'],
			moduleBoundaries: [{ name: 'backend', directory: 'backend', responsibility: 'API & AI proxy' }],
			sharedInterfaces: [],
			apiContracts: [
				{ method: 'GET', path: '/api/users', backendFile: 'backend/routes.js' },
				{ method: 'POST', path: '/api/ai/chat', backendFile: 'backend/routes.js' },
			],
			dbModels: [{ name: 'users', fields: ['id', 'email'], schemaFile: 'backend/schema.sql' }],
			requiredEnvVars: ['NVIDIA_API_KEY', 'DATABASE_URL'],
			acceptanceCriteria: ['All frontend calls match backend routes', 'No client secret leaks'],
			tasks: [],
		});

		const badIntegration = await svc.checkFullStackIntegration(root, 'ai_integration');
		assert.strictEqual(badIntegration.passed, false);
		assert.ok(badIntegration.issues.some(i => i.kind === 'api_contract_mismatch'), 'Must catch frontend/backend route mismatch');
		assert.ok(badIntegration.issues.some(i => i.kind === 'ai_client_secret_leak'), 'Must catch hardcoded AI API key in frontend');

		// Fix frontend to match agreed contract & remove leaked key
		fs.writeFileSync(path.join(root, 'frontend', 'apiClient.js'), [
			'export async function loadUsers() { return fetch("/api/users"); }',
			'export async function sendAiChat(prompt) { return fetch("/api/ai/chat", { method: "POST", body: JSON.stringify({ prompt }) }); }',
		].join('\n'));

		const cleanIntegration = await svc.checkFullStackIntegration(root, 'ai_integration');
		assert.strictEqual(cleanIntegration.passed, true);
		assert.strictEqual(cleanIntegration.matchedApiContracts, 2);
		svc.dispose();
	});

	test('Scenario D & Scenario G: Large modular app catches broken imports, missing named exports, undeclared deps, stubs & plans bounded root-cause repair', async () => {
		const root = mkDir('kodia-fpere-dg-');
		fs.mkdirSync(path.join(root, 'src', 'contracts'), { recursive: true });
		fs.mkdirSync(path.join(root, 'src', 'services'), { recursive: true });

		fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'modular-app', dependencies: { zod: '^3.24.0' } }, null, 2));
		fs.writeFileSync(path.join(root, 'src', 'contracts', 'user.js'), 'export function createUser(name) { return { name }; }\n');
		// Baseline bad first-pass code: wrong named export + nonexistent relative import + undeclared package + Not implemented stub
		fs.writeFileSync(path.join(root, 'src', 'services', 'userService.js'), [
			'import { createAccount } from "../contracts/user.js";',
			'import { missingHelper } from "./doesNotExist.js";',
			'import imaginaryPkg from "invented-nonexistent-pkg";',
			'export function run() { throw new Error("Not implemented"); }',
		].join('\n'));

		const svc = new FirstPassReliabilityCoreService();
		const impBad = await svc.validateImportsAndExports(root);
		assert.strictEqual(impBad.passed, false);
		assert.ok(impBad.issues.some(i => i.kind === 'missing_named_export' && i.symbolOrTarget === 'createAccount'));
		assert.ok(impBad.issues.some(i => i.kind === 'broken_relative_import' && i.symbolOrTarget === './doesNotExist.js'));
		assert.ok(impBad.issues.some(i => i.kind === 'undeclared_package_import' && i.symbolOrTarget === 'invented-nonexistent-pkg'));
		assert.ok(impBad.issues.some(i => i.kind === 'unimplemented_placeholder'));

		// Root-cause repair planning enforces bounded retries
		const r1 = await svc.planControlledRepair(root, { errorSummary: 'missing_named_export createAccount', files: ['src/services/userService.js'], maxRetries: 2 });
		assert.strictEqual(r1.rootCauseClass, 'broken_import_or_export');
		assert.strictEqual(r1.escalated, false);
		await svc.planControlledRepair(root, { errorSummary: 'missing_named_export createAccount', files: ['src/services/userService.js'], maxRetries: 2 });
		const r3 = await svc.planControlledRepair(root, { errorSummary: 'missing_named_export createAccount', files: ['src/services/userService.js'], maxRetries: 2 });
		assert.strictEqual(r3.escalated, true, 'Exceeding maxRetries must escalate instead of looping infinitely');

		// Repair the module cleanly and verify zero first-pass errors
		fs.writeFileSync(path.join(root, 'src', 'services', 'userService.js'), [
			'import { createUser } from "../contracts/user.js";',
			'export function run(name) { return createUser(name); }',
		].join('\n'));
		const impClean = await svc.validateImportsAndExports(root);
		assert.strictEqual(impClean.passed, true);
		assert.strictEqual(impClean.errorCount, 0);
		svc.dispose();
	});

	test('Scenario E & Scenario F: Existing project modification & mobile+backend integration preserve existing behavior', async () => {
		const root = mkDir('kodia-fpere-ef-');
		fs.mkdirSync(path.join(root, 'mobile', 'src'), { recursive: true });
		fs.mkdirSync(path.join(root, 'backend'), { recursive: true });
		fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'mobile-fullstack', dependencies: { expo: '^53.0.0' } }, null, 2));
		fs.writeFileSync(path.join(root, 'backend', 'server.py'), [
			'def dispatch(req_path):',
			'    if req_path == "/api/items":',
			'        return {"items": []}',
		].join('\n'));
		fs.writeFileSync(path.join(root, 'mobile', 'src', 'ItemsScreen.js'), 'export async function fetchItems() { return fetch("/api/items"); }\n');

		const svc = new FirstPassReliabilityCoreService();
		const arch = await svc.analyzeArchitecture(root);
		assert.ok(arch.languages.includes('JavaScript'));
		assert.ok(arch.languages.includes('Python'));
		assert.ok(arch.frameworks.includes('Expo'));
		assert.ok(fs.existsSync(path.join(root, '.kodia', 'fpere', 'architecture-memory.json')));

		const intCheck = await svc.checkFullStackIntegration(root, 'mobile_integration');
		assert.strictEqual(intCheck.passed, true);
		assert.strictEqual(intCheck.matchedApiContracts, 1);
		svc.dispose();
	});

	test('Scenario H: Long-running context continuity preserves engineering state across compaction & enforces DAG + file ownership', async () => {
		const root = mkDir('kodia-fpere-h-');
		const svc = new FirstPassReliabilityCoreService();

		// 1. Task DAG & multi-agent ownership coordination
		await svc.saveBlueprint(root, {
			title: 'Long-Running Enterprise Platform',
			objective: 'Coordinate parallel agents via shared contracts',
			stack: ['TypeScript', 'Node.js'],
			moduleBoundaries: [],
			sharedInterfaces: [{ name: 'AuthContract', definedIn: 'src/contracts/auth.ts', exportedSymbols: ['AuthToken'], consumers: ['src/api/login.ts'] }],
			apiContracts: [],
			dbModels: [],
			requiredEnvVars: [],
			acceptanceCriteria: [],
			tasks: [
				{ id: 'T1-contracts', title: 'Define AuthContract', checkpoint: 'project_foundation', ownedFiles: ['src/contracts/auth.ts'], dependsOn: [], requiredContracts: [], status: 'in_progress' },
				{ id: 'T2-api', title: 'Implement Login API', checkpoint: 'api_layer', ownedFiles: ['src/api/login.ts'], dependsOn: ['T1-contracts'], requiredContracts: ['AuthContract'], status: 'pending' },
			],
		});

		const dag = evaluateTaskDagReadiness((await svc.getSnapshot(root)).blueprint!.tasks);
		assert.ok(dag.blockedTaskIds.includes('T2-api'), 'Dependent task T2-api must remain blocked until T1-contracts is verified');

		// Blocked task cannot acquire lease prematurely
		const blockedLease = await svc.coordinateAgents(root, { action: 'acquire', agentId: 'backend_agent', taskId: 'T2-api', files: ['src/api/login.ts'] });
		assert.strictEqual(blockedLease.granted, false);

		// Exclusive ownership prevents two agents colliding on the same file
		const lease1 = await svc.coordinateAgents(root, { action: 'acquire', agentId: 'contract_architect', taskId: 'T1-contracts', files: ['src/contracts/auth.ts'] });
		assert.strictEqual(lease1.granted, true);
		const conflictLease = await svc.coordinateAgents(root, { action: 'acquire', agentId: 'frontend_agent', taskId: 'T1-contracts', files: ['src/contracts/auth.ts'] });
		assert.strictEqual(conflictLease.granted, false);
		assert.strictEqual(conflictLease.conflicts.length, 1);

		// 2. ContextCompactionService preserves modified files, exports & API routes instead of wiping memory!
		const compaction = new ContextCompactionService();
		const syntheticMessages: any[] = [
			{ role: 'tool', type: 'success', name: 'write_file', params: { uri: 'src/contracts/auth.ts' }, content: 'export interface AuthToken { sub: string }' },
			{ role: 'assistant', content: 'Implemented POST /api/auth/login matching AuthToken contract.' },
			...Array.from({ length: 12 }, (_, i) => ({ role: 'user', content: `Follow-up step ${i}` })),
		];
		const { summaryEntry } = compaction.compactConversation(syntheticMessages, {}, 6);
		assert.ok(summaryEntry.summary.includes('src/contracts/auth.ts'), 'Compaction must preserve touched files');
		assert.ok(summaryEntry.summary.includes('POST /api/auth/login'), 'Compaction must preserve API contracts');
		assert.ok(summaryEntry.summary.includes('export AuthToken'), 'Compaction must preserve exported symbols');

		compaction.dispose();
		svc.dispose();
	});
});
