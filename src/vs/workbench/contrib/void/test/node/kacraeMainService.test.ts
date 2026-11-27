/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * KACRAE — Real End-to-End Demonstrations (Demos 1–20) & Large-Repository Scale Benchmark
 * Executes against real temporary filesystems, real Git repos, real Node/TS compilers & test runners,
 * real sharded disk-backed indexing, real controlled repairs with backup/rollback & independent verification.
 */

import assert from 'assert';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { KacraeLiveEvent } from '../../common/kacraeTypes.js';
import { KodiaKacraeMainService } from '../../electron-main/kacraeMainService.js';

function git(args: string[], cwd: string): void {
	cp.execFileSync('git', args, { cwd, windowsHide: true, stdio: 'pipe' });
}

suite('Kodia KACRAE — End-to-End Demonstrations (1–20) & Large-Repo Benchmarks (Node)', function () {
	this.timeout(120_000);

	let service: KodiaKacraeMainService;
	let dir: string;
	let events: KacraeLiveEvent[];
	const p = (rel: string) => path.join(dir, rel);
	const write = (rel: string, content: string) => {
		const full = p(rel);
		fs.mkdirSync(path.dirname(full), { recursive: true });
		fs.writeFileSync(full, content, 'utf8');
	};

	setup(() => {
		service = new KodiaKacraeMainService();
		events = [];
		service.onDidEmitEvent(ev => events.push(ev));
		dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kodia-kacrae-e2e-')));
	});

	teardown(() => {
		service.dispose();
		fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
	});

	test('Demos 1, 2, 9, 10 & 17: Basic review, business logic defect, missing test generation, controlled autonomous repair, rollback & independent verification', async () => {
		write('src/pricing.cjs', [
			'exports.applyDiscount = function applyDiscount(price, discount) {',
			'  return price + discount;',
			'};',
		].join('\n'));
		write('test-pricing.cjs', [
			'const assert = require("assert");',
			'const { applyDiscount } = require("./src/pricing.cjs");',
			'assert.strictEqual(applyDiscount(100, 20), 80, "Discount must subtract from price");',
			'console.log("PASS");',
		].join('\n'));

		// Demo 1 & 2 & 17: Independent review detects defect without trusting any coding agent claim
		const session = await service.startReview({
			workspaceRoot: dir,
			scope: 'entire_project',
			depth: 'standard',
			testCommand: 'node test-pricing.cjs',
		});

		const bizFinding = session.findings.find(f => f.ruleId === 'KACRAE-BIZ-002');
		assert.ok(bizFinding, 'Must detect inverted discount business logic defect');
		assert.strictEqual(bizFinding.location.file, 'src/pricing.cjs');
		assert.strictEqual(bizFinding.location.startLine, 2);
		assert.strictEqual(session.testReport.testExecutionPassed, false, 'Real test command must fail before repair');
		assert.ok(session.testReport.generatedTests.length >= 1, 'Demo 9: Must generate behavior-based test suggestion');
		assert.strictEqual(session.readiness.verdict, 'blocked_by_findings', 'Readiness must block on critical defect & failing test');

		// Demo 10: Preview minimal patch (dryRun) -> Apply repair -> Independent verification passes real test!
		const preview = await service.proposeOrApplyRepair({
			workspaceRoot: dir,
			sessionId: session.id,
			findingId: bizFinding.id,
			dryRun: true,
		});
		assert.strictEqual(preview.status, 'proposed');
		assert.ok(preview.diffPreview.includes('-   return price + discount;'));
		assert.ok(preview.diffPreview.includes('+   return price - discount;'));

		const applied = await service.proposeOrApplyRepair({
			workspaceRoot: dir,
			sessionId: session.id,
			findingId: bizFinding.id,
			dryRun: false,
			testCommand: 'node test-pricing.cjs',
			role: 'approver',
		});
		assert.strictEqual(applied.status, 'verified', `Repair must pass independent verification, got ${JSON.stringify(applied)}`);
		assert.strictEqual(applied.independentVerdict, 'APPROVED');

		// Verify backup rollback restores original file cleanly
		const reverted = await service.revertRepair(dir, applied.id);
		assert.strictEqual(reverted?.status, 'reverted');
		assert.ok(fs.readFileSync(p('src/pricing.cjs'), 'utf8').includes('price + discount'));

		// Verify sequenced live events were emitted across full lifecycle
		const types = new Set(events.map(e => e.type));
		assert.ok(types.has('review_created') && types.has('indexing_completed') && types.has('finding_discovered') && types.has('repair_proposed') && types.has('repair_applied') && types.has('verification_completed'));
	});

	test('Demos 3, 4, 5, 6, 7, 8 & 13: Security attack-paths, tenant isolation, concurrency TOCTOU, architecture cycles/blast-radius, DB migration, API drift & visual graph', async () => {
		write('src/a.ts', 'import { b } from "./b.js"; export const a = () => b();\n');
		write('src/b.ts', 'import { a } from "./a.js"; export const b = () => a();\n');
		write('src/ui/Dashboard.tsx', 'import { queryUsers } from "../db/usersRepo.js"; export function Dashboard() { return queryUsers(); }\n');
		write('src/db/usersRepo.ts', 'export function queryUsers() { return "SELECT * FROM users"; }\n');
		write('src/api/tenantController.ts', [
			'export async function getRecord(req: any, db: any) {',
			'  const tenantId = req.body.tenantId;',
			'  const name = req.query.name;',
			'  await db.query(`SELECT * FROM records WHERE name = \'${name}\'`);',
			'  return db.query("SELECT * FROM records WHERE id = $1", [req.params.id]);',
			'}',
			'app.get("/v1/records", (req: any, res: any) => res.json([]));',
			'app.delete("/v1/admin/purge", (req: any, res: any) => res.json({ ok: true }));',
		].join('\n'));
		write('src/booking.ts', [
			'export async function reserve(repo: any, id: string) {',
			'  const avail = await repo.get(id);',
			'  if (avail > 0) {',
			'    await repo.log(id);',
			'    await repo.set(id, avail - 1);',
			'  }',
			'}',
		].join('\n'));
		write('migrations/001_bad.sql', 'DROP TABLE audit_entries;\nCREATE INDEX idx_rec ON records(name);\n');
		write('openapi.json', JSON.stringify({ openapi: '3.0.0', paths: { '/v1/records': { get: {} }, '/v1/exports': { post: {} } } }));

		const session = await service.startReview({
			workspaceRoot: dir,
			scope: 'entire_project',
			depth: 'deep',
			settings: { enableCompilerChecks: false },
		});
		const ruleSet = new Set(session.findings.map(f => f.ruleId));

		assert.ok(ruleSet.has('KACRAE-TENANT-001') && ruleSet.has('KACRAE-TENANT-002'), 'Demo 4: Must detect multi-tenant isolation flaws');
		assert.ok(session.attackPaths.length >= 2, 'Demo 3: Must build security attack paths');
		assert.ok(ruleSet.has('KACRAE-CONC-001'), 'Demo 5: Must detect concurrency race condition');
		assert.ok(ruleSet.has('KACRAE-ARCH-CYCLE-001'), 'Demo 6: Must detect circular dependency a.ts <-> b.ts');
		assert.ok(ruleSet.has('KACRAE-ARCH-LAYER-001'), 'Demo 6: Must detect frontend -> data layering violation');
		assert.ok(ruleSet.has('KACRAE-DB-MIG-001') && ruleSet.has('KACRAE-DB-MIG-002'), 'Demo 7: Must detect destructive & locking migrations');
		assert.ok(ruleSet.has('KACRAE-API-CONTRACT-001') && ruleSet.has('KACRAE-API-CONTRACT-002'), 'Demo 8: Must detect OpenAPI contract drift');

		// Demo 13: Graph & Blast-Radius Query
		const br = await service.queryRepositoryGraph(dir, { kind: 'blast_radius', target: 'src/db/usersRepo.ts' });
		assert.strictEqual(br.blastRadius?.found, true);
		assert.ok(br.blastRadius!.directlyAffectedFiles.includes('src/ui/Dashboard.tsx'));
		const cycles = await service.queryRepositoryGraph(dir, { kind: 'cycles' });
		assert.ok(cycles.files.includes('src/a.ts') && cycles.files.includes('src/b.ts'));
	});

	test('Demos 11, 14, 15, 16, 18 & 19: Git staged/unstaged scoping, offline/provider independence, RBAC, custom rules, audit trail & report export', async () => {
		git(['init'], dir);
		git(['config', 'user.email', 'dev@kodia.test'], dir);
		git(['config', 'user.name', 'Kodia Dev'], dir);

		write('src/clean.js', 'export function add(a, b) { return a + b; }\n');
		write('src/clean.test.js', 'import assert from "assert"; assert.strictEqual(1 + 2, 3);\n');
		git(['add', '.'], dir);
		git(['commit', '-m', 'initial'], dir);

		// Stage one buggy file and leave another unstaged
		write('src/stagedBug.js', 'export function badLoop(arr) { let n = 0; for (let i = 0; i <= arr.length; i++) { n += arr[i]; } return n; }\n');
		git(['add', 'src/stagedBug.js'], dir);
		write('src/unstagedRule.js', 'export function noisy() { FORBIDDEN_INTERNAL_CALL(); }\n');

		// Demo 19: Custom organization/repo rule + Enterprise RBAC enforcement + Audit log
		await service.manageRules(dir, {
			action: 'upsert',
			rule: {
				id: 'ORG-001',
				name: 'Forbid internal debug call',
				description: 'Do not invoke FORBIDDEN_INTERNAL_CALL in production files.',
				scope: 'organization',
				enabled: true,
				severity: 'high',
				category: 'compliance',
				pattern: 'FORBIDDEN_INTERNAL_CALL\\(',
				remediation: 'Remove debug call before merge.',
				updatedAt: new Date().toISOString(),
			},
		});

		// Demo 16 & 14 & 15: Staged Git review in strict local-only offline mode (zero external providers)
		const stagedSession = await service.startReview({
			workspaceRoot: dir,
			scope: 'git_staged',
			depth: 'standard',
			settings: { localOnlyMode: true, allowExternalInference: false, enableCompilerChecks: false },
		});
		assert.ok(stagedSession.targetFiles.includes('src/stagedBug.js'));
		assert.ok(!stagedSession.targetFiles.includes('src/unstagedRule.js'), 'Staged scope must NOT pull unstaged file');
		assert.ok(stagedSession.findings.some(f => f.ruleId === 'KACRAE-CORR-001'));
		assert.strictEqual(stagedSession.councilPlan.localOnlyEnforced, true);

		// Unstaged review catches custom ORG-001 rule
		const unstagedSession = await service.startReview({
			workspaceRoot: dir,
			scope: 'git_unstaged',
			depth: 'standard',
			settings: { localOnlyMode: true, enableCompilerChecks: false },
		});
		assert.ok(unstagedSession.findings.some(f => f.ruleId === 'ORG-001'), 'Must trigger custom ORG-001 rule on unstaged file');

		// RBAC blocks viewer from applying repair
		const stagedFinding = stagedSession.findings.find(f => f.ruleId === 'KACRAE-CORR-001')!;
		await assert.rejects(
			() => service.proposeOrApplyRepair({ workspaceRoot: dir, sessionId: stagedSession.id, findingId: stagedFinding.id, dryRun: false, role: 'viewer' }),
			/RBAC policy blocked/,
		);

		// Suppression without justification must be rejected; with justification succeeds & persists
		await assert.rejects(
			() => service.updateFindingLifecycle(dir, { sessionId: stagedSession.id, findingId: stagedFinding.id, nextState: 'suppressed', reason: '   ' }),
			/requires a non-empty justification/,
		);
		const suppressed = await service.updateFindingLifecycle(dir, {
			sessionId: stagedSession.id,
			findingId: stagedFinding.id,
			nextState: 'suppressed',
			reason: 'Reviewed exception for test verification',
		});
		assert.strictEqual(suppressed?.lifecycle, 'suppressed');

		// Export HTML + SARIF reports & inspect persisted snapshot + audit trail
		const htmlExp = await service.exportReport({ workspaceRoot: dir, sessionId: stagedSession.id, format: 'html', reportType: 'executive' });
		assert.ok(fs.existsSync(htmlExp.filePath) && htmlExp.bytes > 500);
		const snap = await service.loadWorkspaceSnapshot(dir);
		assert.ok(snap.sessions.length >= 2, 'Sessions must persist across reloads');
		assert.ok(snap.auditLog.length >= 3, 'Audit records must be persisted');
		assert.ok(snap.externalTools.some(t => t.id === 'node' && t.available), 'External tool adapter detection must find node');
		assert.strictEqual(snap.localRuntimes.length, 3, 'Must probe Ollama, LM Studio & vLLM');
	});

	test('Demo 12 & Part 41: Large-repository incremental sharded indexing benchmark (1,500 files), unchanged skip verification & permanent quality benchmark', async () => {
		// Create a 1,500-file polyglot monorepo across 15 packages
		const totalFiles = 1500;
		for (let pkg = 0; pkg < 15; pkg++) {
			const pkgDir = p(`packages/svc-${pkg}`);
			fs.mkdirSync(pkgDir, { recursive: true });
			for (let f = 0; f < 100; f++) {
				const idx = pkg * 100 + f;
				const imp = f > 0 ? `import { fn_${idx - 1} } from './mod_${f - 1}.js';\n` : '';
				fs.writeFileSync(path.join(pkgDir, `mod_${f}.ts`), `${imp}export function fn_${idx}(v: number) { return v + ${idx}; }\n`, 'utf8');
			}
		}

		// Cold full index
		const full = await service.indexRepository(dir, { concurrency: 8, incremental: true });
		assert.strictEqual(full.stats.indexedFiles, totalFiles);
		assert.strictEqual(full.stats.unchangedCachedFiles, 0);
		assert.strictEqual(full.stats.partial, false);
		assert.ok(full.stats.throughputFilesPerSec > 50, `Expected high indexing throughput, got ${full.stats.throughputFilesPerSec} files/s`);
		assert.strictEqual(full.graph.truncatedForRender, true, 'Must progressively cap DOM graph nodes on large repos');
		assert.strictEqual(full.graph.totalNodeCount, totalFiles);

		// Modify ONLY 1 file and run incremental rescan: 1,499 unchanged files MUST be skipped!
		fs.writeFileSync(p('packages/svc-0/mod_0.ts'), 'export function fn_0(v: number) { return v + 999; }\n', 'utf8');
		const inc = await service.indexRepository(dir, { concurrency: 8, incremental: true });
		assert.strictEqual(inc.stats.indexedFiles, 1, 'Only the 1 modified file should be re-parsed');
		assert.strictEqual(inc.stats.unchangedCachedFiles, totalFiles - 1, 'All 1,499 unchanged files must be skipped from cache');

		// Permanent Quality Benchmark (Part 41)
		const bench = await service.runQualityBenchmark(dir, { includeScaleFiles: 300 });
		assert.strictEqual(bench.precision, 1, `Expected 100% precision on controlled corpus, got ${bench.precision}`);
		assert.strictEqual(bench.recall, 1, `Expected 100% recall on controlled corpus, got ${bench.recall}`);
		assert.strictEqual(bench.falsePositiveRate, 0, `Expected 0% FPR on controlled corpus, got ${bench.falsePositiveRate}`);
		assert.ok(bench.scaleBenchmark && bench.scaleBenchmark.unchangedSkipped === 299);
	});
});

