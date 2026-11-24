/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { UniversalAppBuilderCoreService } from '../../electron-main/universalAppBuilderCore.js';

function makeTempDir(prefix: string): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeRel(root: string, rel: string, content: string): void {
	const abs = path.join(root, rel);
	fs.mkdirSync(path.dirname(abs), { recursive: true });
	fs.writeFileSync(abs, content, 'utf8');
}

suite('Kodia Universal App Builder Engine (UABE) & IRIRE — Scenarios 1–11', () => {
	const tempDirs: string[] = [];

	teardown(() => {
		while (tempDirs.length) {
			const d = tempDirs.pop()!;
			try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
		}
	});

	test('Scenario 1 & 5: Website Scaffold, Real Test Execution, Visual Edit → Real Source Sync & Checkpoint Rollback', async function () {
		this.timeout(15000);
		const root = makeTempDir('kodia-uabe-s1-s5-');
		tempDirs.push(root);
		const svc = new UniversalAppBuilderCoreService();

		const init = await svc.initializeProject(root, {
			name: 'Nova Studio Site',
			brief: 'Build a clean responsive marketing website for Nova Studio with a clear call to action.',
			buildMode: 'autonomous_build',
		});
		assert.strictEqual(init.buildMode, 'autonomous_build');
		assert.ok(init.platforms.includes('web'));

		const scaf = await svc.scaffoldApplication(root, { template: 'website', appName: 'Nova Studio Site' });
		assert.ok(scaf.filesWritten.includes('public/index.html'));

		// Visual edit modifies REAL HTML file on disk with automatic checkpoint
		const ve = await svc.applyVisualEdit(root, {
			filePath: 'public/index.html',
			selectorOrText: 'Get Started',
			newText: 'Start Free Trial',
			styleChanges: { backgroundColor: '#2563eb', color: '#ffffff' },
			addClasses: ['shadow-lg'],
		});
		assert.strictEqual(ve.applied, true);
		assert.ok(ve.checkpointId);
		const modifiedHtml = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
		assert.ok(modifiedHtml.includes('Start Free Trial'));
		assert.ok(modifiedHtml.includes('background-color: #2563eb'));
		assert.ok(modifiedHtml.includes('shadow-lg'));

		// Rollback restores exact prior file content
		const rb = await svc.rollbackCheckpoint(root, ve.checkpointId!);
		assert.strictEqual(rb.restored, true);
		const restoredHtml = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
		assert.ok(restoredHtml.includes('Get Started'));
		assert.ok(!restoredHtml.includes('Start Free Trial'));

		// Evaluate truthful reliability with real test execution
		const rel = await svc.evaluateReliabilityDashboard(root, { runCompiler: false, testCommand: 'node --test' });
		const testPillar = rel.pillars.find(p => p.id === 'tests');
		assert.strictEqual(testPillar?.status, 'passed');
		svc.dispose();
	});

	test('Scenario 2 & 6: Contract-to-Product Traceability, Full-Stack Business App, Per-Project Build Mode & Incremental Update', async function () {
		this.timeout(15000);
		const root = makeTempDir('kodia-uabe-s2-s6-');
		tempDirs.push(root);
		const svc = new UniversalAppBuilderCoreService();

		const contract = [
			'# Client SOW: Acme Inventory Portal',
			'- Admin and staff roles with secure authentication and RBAC permissions',
			'- Full CRUD inventory management with search and filtering',
			'- PostgreSQL persistence with migrations and REST API endpoints',
			'- Stripe checkout integration for wholesale orders',
		].join('\n');

		const project = await svc.initializeProject(root, {
			brief: contract,
			sourceType: 'contract',
			buildMode: 'plan_first',
		});
		assert.strictEqual(project.buildMode, 'plan_first');
		assert.ok((project.contractAnalysis?.requirements.length ?? 0) >= 4);
		assert.ok(project.contractAnalysis?.userRoles.includes('Administrator'));

		// Switch per-project mode to autonomous_build and verify persistence across restart
		await svc.setProjectBuildMode(root, 'autonomous_build');
		const svcReloaded = new UniversalAppBuilderCoreService();
		const reloaded = await svcReloaded.getProjectState(root);
		assert.strictEqual(reloaded.buildMode, 'autonomous_build');

		const scaf = await svcReloaded.scaffoldApplication(root, { template: 'fullstack_business', appName: 'Acme Inventory Portal' });
		assert.ok(scaf.filesWritten.includes('src/server.mjs'));
		const rel = await svcReloaded.evaluateReliabilityDashboard(root, { runCompiler: false, testCommand: 'node --test' });
		assert.strictEqual(rel.unresolvedDefectsCount, 0);
		assert.strictEqual(rel.pillars.find(p => p.id === 'tests')?.status, 'passed');
		svc.dispose();
		svcReloaded.dispose();
	});

	test('Scenario 3 & 4: AI App Missing-Key Honesty, IRIRE Auto-Discovery, Official Links, Encrypted Secret Vault & Connection Check', async function () {
		this.timeout(15000);
		const root = makeTempDir('kodia-uabe-s3-s4-');
		tempDirs.push(root);
		const svc = new UniversalAppBuilderCoreService();

		const project = await svc.initializeProject(root, {
			name: 'AI Commerce Assistant',
			brief: 'Build an AI-powered SaaS using NVIDIA NIM models, MongoDB Atlas database, Supabase auth, and Stripe payments.',
		});
		const envVars = new Set(project.integrations.map(i => i.envVarName));
		assert.ok(envVars.has('NVIDIA_API_KEY'));
		assert.ok(envVars.has('MONGODB_URI'));
		assert.ok(envVars.has('SUPABASE_URL'));
		assert.ok(envVars.has('STRIPE_SECRET_KEY'));

		// Every discovered provider has official verified signup & docs links and guided setup steps
		const mongo = project.integrations.find(i => i.envVarName === 'MONGODB_URI')!;
		assert.strictEqual(mongo.urlVerificationStatus, 'verified_official');
		assert.ok(mongo.officialSignupUrl.startsWith('https://www.mongodb.com/'));
		assert.ok(mongo.setupSteps.length >= 4);

		// Encrypted vault: plaintext secret must NEVER be written in clear text to disk
		const fakeStripe = 'sk_test_51KodiaUnitTestSecretValue987654321';
		const saved = await svc.configureIntegrationSecret(root, {
			requirementId: 'irire-stripe-stripe_secret_key',
			envVarName: 'STRIPE_SECRET_KEY',
			secretValue: fakeStripe,
		});
		assert.strictEqual(saved.ok, true);
		const vaultRaw = fs.readFileSync(path.join(root, '.kodia', 'app-builder', 'secrets.vault.json'), 'utf8');
		const projectRaw = fs.readFileSync(path.join(root, '.kodia', 'app-builder', 'project.json'), 'utf8');
		assert.ok(!vaultRaw.includes(fakeStripe), 'Plaintext secret must be encrypted in secrets.vault.json');
		assert.ok(!projectRaw.includes(fakeStripe), 'Plaintext secret must NEVER appear in project.json');

		// Connection test validates format honestly and NEVER falsely claims live_verified without live network call
		const testRes = await svc.testIntegrationConnection(root, 'irire-stripe-stripe_secret_key');
		assert.strictEqual(testRes.ok, true);
		assert.strictEqual(testRes.mode, 'sandbox');
		assert.strictEqual(testRes.liveChecked, false);

		// Scaffold AI app & verify real missing-key test passes
		await svc.scaffoldApplication(root, { template: 'ai_app', appName: 'AI Commerce Assistant' });
		const rel = await svc.evaluateReliabilityDashboard(root, { runCompiler: false, testCommand: 'node --test' });
		assert.strictEqual(rel.pillars.find(p => p.id === 'tests')?.status, 'passed');
		// Mandatory unconfigured keys (MONGODB_URI, NVIDIA_API_KEY) keep external_integrations truthfully blocked
		assert.strictEqual(rel.pillars.find(p => p.id === 'external_integrations')?.status, 'blocked');
		svc.dispose();
	});

	test('Scenario 7 & 8: Mobile & Desktop Scaffolds Honestly Mark Native Runtime Unverified (Never Faked by Web Preview)', async function () {
		this.timeout(15000);
		const root = makeTempDir('kodia-uabe-s7-s8-');
		tempDirs.push(root);
		const svc = new UniversalAppBuilderCoreService();

		await svc.initializeProject(root, {
			name: 'Omni Companion',
			brief: 'Build a React Native mobile app and an Electron desktop companion app.',
			preferredPlatforms: ['mobile_rn', 'desktop_electron'],
		});
		await svc.scaffoldApplication(root, { template: 'desktop_electron', appName: 'Omni Companion' });
		const rel = await svc.evaluateReliabilityDashboard(root, { runCompiler: false, testCommand: 'node --test' });
		assert.strictEqual(rel.pillars.find(p => p.id === 'tests')?.status, 'passed');
		assert.strictEqual(rel.pillars.find(p => p.id === 'mobile_runtime')?.status, 'unverified');
		assert.strictEqual(rel.pillars.find(p => p.id === 'desktop_runtime')?.status, 'unverified');
		assert.notStrictEqual(rel.overallStatus, 'verified_against_executed_checks');
		svc.dispose();
	});

	test('Scenario 9 & 10: Failure Detection (Broken Import + SQL Injection + Semantic Defect) & Verified Recovery', async () => {
		const root = makeTempDir('kodia-uabe-s9-s10-');
		tempDirs.push(root);
		const svc = new UniversalAppBuilderCoreService();

		writeRel(root, 'package.json', JSON.stringify({ name: 'defect-test', dependencies: {} }));
		writeRel(root, 'src/orders.ts', [
			`import { nonexistent } from './missing-module';`,
			`export async function processOrders(db: any, scores: number[], userId: string) {`,
			`  scores.sort();`,
			`  await db.query(\`SELECT * FROM orders WHERE user_id = \${userId}\`);`,
			`  return nonexistent;`,
			`}`,
		].join('\n'));

		const bad = await svc.evaluateReliabilityDashboard(root, { runCompiler: false });
		assert.strictEqual(bad.overallStatus, 'needs_fixes');
		assert.ok(bad.unresolvedDefectsCount >= 3);

		// Repair root causes cleanly
		writeRel(root, 'src/orderHelpers.ts', `export function sortScores(s: readonly number[]): number[] { return [...s].sort((a, b) => a - b); }\n`);
		writeRel(root, 'src/orders.ts', [
			`import { sortScores } from './orderHelpers';`,
			`export async function processOrders(db: { query: (sql: string, args: unknown[]) => Promise<unknown> }, scores: number[], userId: string) {`,
			`  const ordered = sortScores(scores);`,
			`  await db.query('SELECT * FROM orders WHERE user_id = $1', [userId]);`,
			`  return ordered;`,
			`}`,
		].join('\n'));

		const good = await svc.evaluateReliabilityDashboard(root, { runCompiler: false });
		assert.strictEqual(good.unresolvedDefectsCount, 0);
		assert.strictEqual(good.pillars.find(p => p.id === 'imports')?.status, 'passed');
		assert.strictEqual(good.pillars.find(p => p.id === 'semantic_correctness')?.status, 'passed');
		svc.dispose();
	});

	test('Scenario 11: Client Delivery & Handover Package Generates Full Deliverables with Verified Zero Secrets', async () => {
		const root = makeTempDir('kodia-uabe-s11-');
		tempDirs.push(root);
		const svc = new UniversalAppBuilderCoreService();

		const secretToken = 'nvapi-SecretHandoverGuardTestValue1234567890';
		await svc.initializeProject(root, {
			name: 'Enterprise Analytics Suite',
			brief: `Build an AI analytics portal using NVIDIA NIM (example leaked key ${secretToken} must be redacted).`,
		});
		await svc.configureIntegrationSecret(root, {
			requirementId: 'irire-nvidia_nim-nvidia_api_key',
			envVarName: 'NVIDIA_API_KEY',
			secretValue: secretToken,
		});
		await svc.evaluateReliabilityDashboard(root, { runCompiler: false });

		const handover = await svc.generateClientHandover(root, { clientName: 'Acme Corp', projectTitle: 'Enterprise Analytics Suite' });
		assert.strictEqual(handover.zeroSecretsVerified, true);
		assert.ok(handover.filesGenerated.length >= 6);
		for (const f of handover.filesGenerated) {
			const fullPath = path.join(root, f.relativePath);
			assert.ok(fs.existsSync(fullPath), `Missing handover file ${f.relativePath}`);
			const text = fs.readFileSync(fullPath, 'utf8');
			assert.ok(!text.includes(secretToken), `Secret leaked into ${f.relativePath}!`);
		}
		const deck = fs.readFileSync(path.join(root, 'handover/CLIENT_PRESENTATION.html'), 'utf8');
		assert.ok(deck.includes('Enterprise Analytics Suite'));
		assert.ok(deck.includes('Acme Corp'));
		svc.dispose();
	});
});
