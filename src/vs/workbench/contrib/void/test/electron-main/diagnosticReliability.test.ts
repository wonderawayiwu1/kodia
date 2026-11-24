/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { URI } from '../../../../../base/common/uri.js';
import { MarkerSeverity } from '../../../../../platform/markers/common/markers.js';
import { MarkerService } from '../../../../../platform/markers/common/markerService.js';
import { classifyDiagnosticsWithEvidence } from '../../common/diagnosticReliabilityEngine.js';
import { DiagnosticReliabilityCoreService } from '../../electron-main/diagnosticReliabilityCore.js';

function mkTempProject(prefix: string): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

suite('Kodia Diagnostic Reliability Engine (KDRE) — LSP, False-Positive & E2E Tests', () => {
	const tempDirs: string[] = [];
	const mkDir = (prefix: string) => {
		const d = mkTempProject(prefix);
		tempDirs.push(d);
		return d;
	};

	teardown(() => {
		for (const d of tempDirs.splice(0)) {
			try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
		}
	});

	test('LSP & MarkerService lifecycle: rejects strictly older modelVersionId batches and clears cleanly', () => {
		const ms = new MarkerService();
		const uri = URI.file('/workspace/src/app.ts');

		// Publish diagnostics for document v7
		ms.changeOne('typescript', uri, [{
			severity: MarkerSeverity.Error,
			message: 'Current v7 error',
			startLineNumber: 10, startColumn: 1, endLineNumber: 10, endColumn: 5,
			modelVersionId: 7,
		}]);
		assert.strictEqual(ms.read({ resource: uri }).length, 1);
		assert.strictEqual(ms.read({ resource: uri })[0].message, 'Current v7 error');

		// Out-of-order stale LSP batch from document v5 arrives AFTER v7 — MUST BE REJECTED!
		ms.changeOne('typescript', uri, [{
			severity: MarkerSeverity.Error,
			message: 'Stale v5 ghost error',
			startLineNumber: 3, startColumn: 1, endLineNumber: 3, endColumn: 5,
			modelVersionId: 5,
		}]);
		assert.strictEqual(ms.read({ resource: uri }).length, 1);
		assert.strictEqual(ms.read({ resource: uri })[0].message, 'Current v7 error', 'Stale v5 diagnostic must never overwrite v7');

		// Newer document v8 arrives — accepted
		ms.changeOne('typescript', uri, [{
			severity: MarkerSeverity.Warning,
			message: 'Updated v8 warning',
			startLineNumber: 12, startColumn: 1, endLineNumber: 12, endColumn: 4,
			modelVersionId: 8,
		}]);
		assert.strictEqual(ms.read({ resource: uri })[0].message, 'Updated v8 warning');

		// Clearing with empty array clears markers and resets version watermark
		ms.changeOne('typescript', uri, []);
		assert.strictEqual(ms.read({ resource: uri }).length, 0);
		ms.dispose();
	});

	test('Project configuration intelligence discovers monorepo nested tsconfigs, path aliases, lockfiles & missing deps', async () => {
		const root = mkDir('kodia-kdre-monorepo-');
		fs.mkdirSync(path.join(root, 'apps', 'web', 'src'), { recursive: true });
		fs.writeFileSync(path.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
		fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
			name: 'mono',
			workspaces: ['apps/*'],
			dependencies: { fastify: '^5.0.0', '@prisma/client': '^6.0.0' },
		}, null, 2));
		fs.writeFileSync(path.join(root, 'apps', 'web', 'tsconfig.json'), `{
			// JSONC comment should parse cleanly
			"compilerOptions": {
				"target": "ES2022",
				"moduleResolution": "bundler",
				"paths": { "@/*": ["./src/*"] }
			},
			"references": []
		}`);

		const svc = new DiagnosticReliabilityCoreService();
		const cfg = await svc.inspectProjectConfiguration(root);
		assert.strictEqual(cfg.isMonorepo, true);
		assert.ok(cfg.packageManagers.includes('pnpm'));
		assert.ok(cfg.detectedFrameworks.includes('Fastify'));
		assert.ok(cfg.detectedFrameworks.includes('Prisma'));
		assert.ok(cfg.tsConfigPaths.includes('apps/web/tsconfig.json'));
		assert.strictEqual(cfg.hasPathAliases, true);

		const dep = await svc.verifyDependencyResolution(root);
		assert.strictEqual(dep.healthy, false);
		assert.ok(dep.missingDeclaredDeps.includes('fastify'), 'Must detect uninstalled declared dependency');
		svc.dispose();
	});

	test('End-to-End real JS + Python compiler verification: genuine error confirmed, fixed error clears, false-positive LSP error caught as conflict', async () => {
		const root = mkDir('kodia-kdre-e2e-');
		const jsFile = path.join(root, 'index.js');
		const pyFile = path.join(root, 'worker.py');

		// Step 1: Valid code with a false-positive LSP error injected
		fs.writeFileSync(jsFile, 'export function add(a, b) { return a + b; }\n');
		fs.writeFileSync(pyFile, 'def compute(x: int) -> int:\n    return x * 2\n');

		const svc = new DiagnosticReliabilityCoreService();
		const evalClean = await svc.evaluateDiagnostics(root, [
			{
				owner: 'typescript',
				source: 'ts',
				code: '2304',
				severity: 'error',
				message: 'Cannot find name phantomSymbol',
				file: 'index.js',
				line: 1,
				column: 1,
			},
			{
				owner: 'typescript',
				source: 'ts',
				code: '2307',
				severity: 'error',
				message: 'Ghost error in deleted file',
				file: 'deleted_ghost.js',
				line: 5,
				column: 1,
			},
		], { runCompiler: true });

		const phantom = evalClean.classified.find(c => c.raw.file === 'index.js');
		const ghost = evalClean.classified.find(c => c.raw.file === 'deleted_ghost.js');
		assert.ok(phantom);
		assert.strictEqual(phantom!.classification, 'conflicting', 'Clean node --check must flag bogus LSP error as conflicting');
		assert.strictEqual(phantom!.verificationStatus, 'refuted_by_compiler');
		assert.ok(ghost);
		assert.strictEqual(ghost!.classification, 'potentially_stale', 'Non-existent file diagnostic must be flagged stale');
		assert.strictEqual(ghost!.confidence, 'stale');

		// Step 2: Introduce a GENUINE syntax error in index.js and verify independent confirmation
		fs.writeFileSync(jsFile, 'export function broken( { return 1; }\n');
		const inv = await svc.investigateDiagnostic(root, {
			owner: 'typescript',
			source: 'ts',
			code: 'NODE-SYNTAX',
			severity: 'error',
			message: 'SyntaxError: Unexpected token {',
			file: 'index.js',
			line: 1,
			column: 25,
		}, { runCompiler: true });
		assert.strictEqual(inv.isLikelyFalsePositive, false, 'Genuine syntax error must NOT be dismissed as false positive');
		assert.strictEqual(inv.rootCauseCategory, 'genuine_code_error');
		assert.strictEqual(inv.confidence, 'high');

		// Step 3: Fix index.js and verify compiler passes cleanly
		fs.writeFileSync(jsFile, 'export function fixed(x) { return x + 1; }\n');
		const verAfterFix = await svc.runIndependentVerification(root);
		assert.strictEqual(verAfterFix.passed, true, 'Fixed code must pass independent compiler verification');
		assert.strictEqual(verAfterFix.totalErrors, 0);

		// Step 4: Recovery action updates snapshot & persists .kodia/correctness/kdre-snapshot.json
		const snap = await svc.recordRecoveryAction(root, {
			action: 'restart_language_server',
			targetLanguage: 'typescript',
			executed: true,
			summary: 'Restarted TS server after fix',
			affectedCount: 1,
			timestampMs: Date.now(),
		});
		assert.strictEqual(snap.systemState, 'ready');
		assert.ok(fs.existsSync(path.join(root, '.kodia', 'correctness', 'kdre-snapshot.json')));
		svc.dispose();
	});

	test('Conflict detection catches compiler-only errors missed by editor LSP and respects explicit user suppression rules', () => {
		const res = classifyDiagnosticsWithEvidence({
			workspaceRoot: '/repo',
			rawDiagnostics: [
				{
					owner: 'eslint',
					source: 'eslint',
					code: 'no-console',
					severity: 'warning',
					message: 'Unexpected console statement',
					file: 'src/a.ts',
					line: 4,
					column: 1,
					fileExists: true,
					inActiveWorkspace: true,
				},
				{
					owner: 'ts',
					source: 'ts',
					code: 'TS2322',
					severity: 'error',
					message: 'Stale v3 error',
					file: 'src/b.ts',
					line: 10,
					column: 1,
					modelVersionId: 3,
					currentDocumentVersion: 6,
					fileExists: true,
					inActiveWorkspace: true,
				},
			],
			compilerVerification: {
				verificationId: 'v1',
				workspaceRoot: '/repo',
				executedAtMs: Date.now(),
				totalErrors: 1,
				totalWarnings: 0,
				passed: false,
				summary: '1 error',
				runs: [{
					engine: 'tsc',
					language: 'TypeScript',
					available: true,
					cwd: '/repo',
					passed: false,
					durationMs: 120,
					diagnostics: [{
						engine: 'tsc',
						language: 'TypeScript',
						code: 'TS2345',
						severity: 'error',
						file: 'src/c.ts',
						line: 22,
						column: 5,
						message: 'Argument of type string is not assignable to parameter of type number',
					}],
				}],
			},
			suppressions: [{ ruleId: 'no-console', justification: 'CLI logger intentionally prints' }],
		});

		assert.strictEqual(res.classified[0].classification, 'suppressed_by_user_rule');
		assert.strictEqual(res.classified[1].classification, 'potentially_stale');
		assert.ok(res.conflicts.some(c => c.kind === 'stale_document_version'));
		assert.ok(res.conflicts.some(c => c.kind === 'compiler_error_lsp_missing' && c.file === 'src/c.ts'));
		assert.strictEqual(res.comparison.compilerOnlyCount, 1);
	});
});
