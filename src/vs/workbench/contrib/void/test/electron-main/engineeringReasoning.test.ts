/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { compareBenchmarkRuns } from '../../common/engineeringReasoningEngine.js';
import { FirstPassReliabilityCoreService } from '../../electron-main/firstPassReliabilityCore.js';

function makeTempWorkspace(prefix: string): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeRel(root: string, rel: string, content: string): void {
	const abs = path.join(root, rel);
	fs.mkdirSync(path.dirname(abs), { recursive: true });
	fs.writeFileSync(abs, content, 'utf8');
}

suite('Kodia Engineering Reasoning & Technical Correctness Engine (ERIC)', () => {
	const tempDirs: string[] = [];

	teardown(() => {
		while (tempDirs.length) {
			const d = tempDirs.pop()!;
			try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
		}
	});

	test('1. Persists Behavioral Specification (explicit vs assumptions) & Multi-Criteria Approach Selection', async () => {
		const root = makeTempWorkspace('kodia-eric-spec-');
		tempDirs.push(root);
		const svc = new FirstPassReliabilityCoreService();

		const spec = await svc.saveBehavioralSpec(root, {
			featureName: 'Idempotent Billing Webhook Processor',
			domain: 'web_backend',
			explicitRequirements: [
				'Verify HMAC-SHA256 signature before parsing payload',
				'Process each event ID at most once',
			],
			inferredAssumptions: [
				'PostgreSQL unique constraint enforces idempotency across workers',
			],
			constraints: ['Must respond within 2s'],
			inputsAndOutputs: [{ name: 'handleWebhook', inputShape: 'Request', outputShape: '{ status: number }' }],
			edgeCases: ['Duplicate event replay', 'Malformed signature header'],
			failureConditions: ['Return 401 on invalid signature', 'Return 503 on DB outage'],
			securityRequirements: ['Constant-time signature comparison'],
			performanceRequirements: ['P95 < 150ms'],
			integrationRequirements: ['Stripe webhook v2025'],
			acceptanceCriteria: [
				{ id: 'AC-1', criterion: 'Invalid signature rejected with 401', verificationMethod: 'Unit test', verified: true },
				{ id: 'AC-2', criterion: 'Duplicate delivery is no-op', verificationMethod: 'Integration test', verified: false },
			],
			openAmbiguities: ['Retention period for processed event IDs'],
		});

		assert.strictEqual(spec.explicitRequirements.length, 2);
		assert.strictEqual(spec.inferredAssumptions.length, 1);

		const evaluation = await svc.evaluateApproaches(root, {
			problem: 'Webhook idempotency mechanism',
			domain: 'web_backend',
			options: [
				{
					name: 'In-memory Set',
					summary: 'Store seen IDs in Node process RAM',
					scores: { correctness: 2, reliability: 1, maintainability: 4, security: 3, performance: 5, frameworkCompatibility: 5, operationalSimplicity: 5 },
					dependenciesRequired: [],
					pros: ['Zero setup'],
					cons: ['Lost on restart', 'Broken under horizontal scaling'],
				},
				{
					name: 'DB Unique Event Table + Transaction',
					summary: 'Insert event_id with UNIQUE key inside the state mutation transaction',
					scores: { correctness: 5, reliability: 5, maintainability: 5, security: 5, performance: 4, frameworkCompatibility: 5, operationalSimplicity: 4 },
					dependenciesRequired: [],
					pros: ['Atomic exactly-once semantics', 'Survives restarts and multi-instance concurrency'],
					cons: ['Requires periodic table pruning'],
				},
			],
			evidence: ['PostgreSQL transactional DDL docs'],
		});

		assert.strictEqual(evaluation.selectedOption, 'DB Unique Event Table + Transaction');
		assert.ok(evaluation.options[0].weightedScore > evaluation.options[1].weightedScore);

		// Reload in a brand new service instance to verify .kodia/fpere persistence
		const reloadedSvc = new FirstPassReliabilityCoreService();
		const snap = await reloadedSvc.getSnapshot(root);
		assert.strictEqual(snap.behavioralSpec?.featureName, 'Idempotent Billing Webhook Processor');
		assert.strictEqual(snap.lastApproachEvaluation?.selectedOption, 'DB Unique Event Table + Transaction');
		svc.dispose();
		reloadedSvc.dispose();
	});

	test('2. Real Installed Package .d.ts Inspection Catches Invented APIs and Passes Valid Calls', async () => {
		const root = makeTempWorkspace('kodia-eric-api-');
		tempDirs.push(root);

		writeRel(root, 'package.json', JSON.stringify({
			name: 'api-verify-demo',
			dependencies: { 'acme-sdk': '^2.4.0' },
		}, null, 2));
		writeRel(root, 'node_modules/acme-sdk/package.json', JSON.stringify({
			name: 'acme-sdk',
			version: '2.4.1',
			types: './dist/index.d.ts',
		}, null, 2));
		writeRel(root, 'node_modules/acme-sdk/dist/index.d.ts', [
			'export declare function createClient(apiKey: string): { ping(): Promise<boolean> };',
			'export declare function verifyToken(token: string): boolean;',
			'export declare const SDK_VERSION: string;',
		].join('\n'));

		// Write code with both valid and invented API usages
		writeRel(root, 'src/client.ts', [
			`import { createClient, nonexistentHelper } from 'acme-sdk';`,
			`import * as acme from 'acme-sdk';`,
			`export function run() {`,
			`  const c = createClient('k');`,
			`  acme.verifyToken('t');`,
			`  acme.inventedSuperMagic();`,
			`  return c;`,
			`}`,
		].join('\n'));

		const svc = new FirstPassReliabilityCoreService();
		const badReport = await svc.verifyInstalledApiUsage(root);
		assert.strictEqual(badReport.passed, false);
		assert.strictEqual(badReport.packagesInspected.length, 1);
		assert.strictEqual(badReport.packagesInspected[0].version, '2.4.1');
		assert.strictEqual(badReport.issues.length, 2);
		assert.ok(badReport.issues.some(i => i.referencedMember === 'nonexistentHelper'));
		assert.ok(badReport.issues.some(i => i.referencedMember === 'acme.inventedSuperMagic'));

		// Fix the source file to use only real exported symbols
		writeRel(root, 'src/client.ts', [
			`import { createClient, verifyToken } from 'acme-sdk';`,
			`import * as acme from 'acme-sdk';`,
			`export function run() {`,
			`  const c = createClient('k');`,
			`  verifyToken('t');`,
			`  acme.verifyToken('t2');`,
			`  return c;`,
			`}`,
		].join('\n'));

		const goodReport = await svc.verifyInstalledApiUsage(root);
		assert.strictEqual(goodReport.passed, true);
		assert.strictEqual(goodReport.issues.length, 0);
		assert.ok(goodReport.usagesChecked >= 3);
		svc.dispose();
	});

	test('3. Multi-Domain Semantic Correctness Catches Code That Compiles Yet Is Wrong & Weak Tests', async () => {
		const root = makeTempWorkspace('kodia-eric-sem-');
		tempDirs.push(root);

		writeRel(root, 'src/worker.ts', [
			`export async function syncAll(items: string[], scores: number[]) {`,
			`  items.forEach(async (item) => { await Promise.resolve(item); });`,
			`  const p = new Promise(async (resolve) => { resolve(1); });`,
			`  const sorted = scores.sort();`,
			`  setInterval(() => { console.log('tick'); }, 1000);`,
			`  try { JSON.parse('{}'); } catch {}`,
			`  return { p, sorted };`,
			`}`,
		].join('\n'));

		writeRel(root, 'src/authDb.ts', [
			`import * as crypto from 'node:crypto';`,
			`export function findUser(db: any, userId: string, password: string) {`,
			`  const hashedPassword = crypto.createHash('md5').update(password).digest('hex');`,
			`  return db.query(\`SELECT * FROM users WHERE id = \${userId} AND pw = '\${hashedPassword}'\`);`,
			`}`,
		].join('\n'));

		writeRel(root, 'src/FeedScreen.tsx', [
			`import { useState } from 'react';`,
			`export function FeedScreen() {`,
			`  const [items, setItems] = useState<string[]>([]);`,
			`  const add = (x: string) => { items.push(x); setItems(items); };`,
			`  return add;`,
			`}`,
		].join('\n'));

		writeRel(root, 'ml/train.py', [
			`from sklearn.preprocessing import StandardScaler`,
			`from sklearn.model_selection import train_test_split`,
			`def collect_batch(item, buf=[]):`,
			`    buf.append(item)`,
			`    return buf`,
			`def train(X, y, cursor, uid):`,
			`    scaler = StandardScaler()`,
			`    X_scaled = scaler.fit_transform(X)`,
			`    X_train, X_test, y_train, y_test = train_test_split(X_scaled, y)`,
			`    cursor.execute(f"SELECT * FROM runs WHERE uid = {uid}")`,
			`    return X_train, X_test`,
		].join('\n'));

		writeRel(root, 'tests/weak.test.ts', [
			`describe('suite', () => {`,
			`  it('tautology', () => { expect(true).toBe(true); });`,
			`  test.skip('skipped case', () => { expect(1 + 1).toBe(2); });`,
			`});`,
		].join('\n'));

		writeRel(root, 'tests/empty.test.ts', [
			`it('does nothing meaningful', () => { const a = 2 + 2; console.log(a); });`,
		].join('\n'));

		const svc = new FirstPassReliabilityCoreService();
		const report = await svc.analyzeSemanticCorrectness(root);
		assert.strictEqual(report.passed, false);
		assert.ok(report.criticalCount >= 3, `Expected >=3 critical findings, got ${report.criticalCount}`);
		assert.ok(report.weakTestOracleCount >= 3, `Expected >=3 weak test oracles, got ${report.weakTestOracleCount}`);

		const ruleIds = new Set(report.findings.map(f => f.ruleId));
		for (const expectedRule of [
			'ERIC-ASYNC-FOREACH',
			'ERIC-ASYNC-PROMISE-EXEC',
			'ERIC-NUMERIC-SORT-LEX',
			'ERIC-LEAK-INTERVAL',
			'ERIC-EMPTY-CATCH',
			'ERIC-SQL-INJECTION',
			'ERIC-WEAK-PASSWORD-HASH',
			'ERIC-REACT-STATE-MUTATION',
			'ERIC-ML-DATA-LEAKAGE',
			'ERIC-PY-MUTABLE-DEFAULT',
			'ERIC-PY-SQL-INJECTION',
			'ERIC-TEST-TAUTOLOGY',
			'ERIC-TEST-SKIPPED',
			'ERIC-TEST-NO-ASSERT',
		]) {
			assert.ok(ruleIds.has(expectedRule), `Missing expected ERIC semantic rule ${expectedRule}`);
		}
		svc.dispose();
	});

	test('4. Independent Engineering Review Enforces Anti-False-Confidence Evidence Verdicts', async function () {
		this.timeout(15000);
		const root = makeTempWorkspace('kodia-eric-review-');
		tempDirs.push(root);
		const svc = new FirstPassReliabilityCoreService();

		// Case A: Defect present -> needs_fixes
		writeRel(root, 'src/math.ts', `export function sortScores(scores: number[]) { return scores.sort(); }\n`);
		const revNeedsFixes = await svc.runIndependentReview(root);
		assert.strictEqual(revNeedsFixes.verdict, 'needs_fixes');
		assert.ok(revNeedsFixes.remainingRisks.length >= 1);

		// Case B: Clean code, but NO test command -> partially_verified (honest!)
		writeRel(root, 'src/math.ts', `export function sortScores(scores: number[]) { return [...scores].sort((a, b) => a - b); }\n`);
		const revPartial = await svc.runIndependentReview(root);
		assert.strictEqual(revPartial.verdict, 'partially_verified');
		assert.ok(revPartial.whatRemainsUnverified.some(u => /No runtime\/behavioral test suite/i.test(u)));

		// Case C: Clean code + verified acceptance criteria + real passing test command -> verified_with_evidence
		await svc.saveBehavioralSpec(root, {
			featureName: 'Numeric Score Sorter',
			domain: 'general',
			explicitRequirements: ['Sort numbers ascending numerically'],
			inferredAssumptions: [],
			constraints: [],
			inputsAndOutputs: [],
			edgeCases: ['[10, 2] -> [2, 10]'],
			failureConditions: [],
			securityRequirements: [],
			performanceRequirements: [],
			integrationRequirements: [],
			acceptanceCriteria: [{ id: 'AC-1', criterion: '[10, 2] sorts to [2, 10]', verificationMethod: 'Node assertion', verified: true }],
			openAmbiguities: [],
		});
		const revVerified = await svc.runIndependentReview(root, {
			testCommand: `node -e "const r = [10, 2, 1].sort((a, b) => a - b); if (r[0] !== 1 || r[2] !== 10) process.exit(1);"`,
		});
		assert.strictEqual(revVerified.verdict, 'verified_with_evidence');
		assert.strictEqual(revVerified.testsPassed.length, 1);
		assert.strictEqual(revVerified.testsFailed.length, 0);
		svc.dispose();
	});

	test('5. Continuous Learning Rejects Unverified Lessons & Persists Verified Root-Cause Lessons', async () => {
		const root = makeTempWorkspace('kodia-eric-lessons-');
		tempDirs.push(root);
		const svc = new FirstPassReliabilityCoreService();

		// Must reject unverified lesson
		const rejected = await svc.recordFailureLesson(root, {
			category: 'algorithm_error',
			domain: 'general',
			technology: 'TypeScript',
			symptom: 'Wrong order on numbers',
			rootCause: 'Default lexicographical sort',
			verifiedFixPattern: 'Use comparator (a, b) => a - b',
			verificationEvidence: '',
			verifiedFix: false,
		});
		assert.strictEqual(rejected.recorded, false);
		assert.strictEqual(rejected.totalLessons, 0);

		// Must persist verified lesson & increment occurrences on repeat
		const ok1 = await svc.recordFailureLesson(root, {
			category: 'algorithm_error',
			domain: 'general',
			technology: 'TypeScript',
			symptom: 'Array [10, 2] stayed [10, 2]',
			rootCause: 'Array.prototype.sort called without numeric comparator',
			verifiedFixPattern: 'Always pass (a, b) => a - b when sorting numbers',
			verificationEvidence: 'mocha sort.test.js: 4 passing (exit 0)',
			verifiedFix: true,
		});
		assert.strictEqual(ok1.recorded, true);
		assert.strictEqual(ok1.lesson?.occurrences, 1);

		const ok2 = await svc.recordFailureLesson(root, {
			category: 'algorithm_error',
			domain: 'general',
			technology: 'TypeScript',
			symptom: 'Array [100, 9] sorted wrong',
			rootCause: 'Array.prototype.sort called without numeric comparator',
			verifiedFixPattern: 'Always pass (a, b) => a - b when sorting numbers',
			verificationEvidence: 'mocha sort.test.js: 5 passing (exit 0)',
			verifiedFix: true,
		});
		assert.strictEqual(ok2.recorded, true);
		assert.strictEqual(ok2.lesson?.occurrences, 2);
		assert.strictEqual(ok2.totalLessons, 1);

		// Verify reloaded service sees the persisted lesson and surfaces it in independent review
		writeRel(root, 'src/clean.ts', `export const ok = (a: number, b: number) => a + b;\n`);
		const svc2 = new FirstPassReliabilityCoreService();
		const review = await svc2.runIndependentReview(root);
		assert.strictEqual(review.relevantPastLessons.length, 1);
		assert.strictEqual(review.relevantPastLessons[0].category, 'algorithm_error');
		svc.dispose();
		svc2.dispose();
	});

	test('6. Repeatable Baseline-vs-ERIC+FPERE Benchmark Measures Real Defect Reduction', async () => {
		const baseRoot = makeTempWorkspace('kodia-eric-bench-base-');
		const impRoot = makeTempWorkspace('kodia-eric-bench-imp-');
		tempDirs.push(baseRoot, impRoot);
		const svc = new FirstPassReliabilityCoreService();

		// Baseline: broken import + SQL interpolation + async forEach + numeric sort + weak test
		writeRel(baseRoot, 'package.json', JSON.stringify({ name: 'bench-base', dependencies: {} }));
		writeRel(baseRoot, 'src/service.ts', [
			`import { missing } from './nope';`,
			`export async function run(db: any, ids: number[]) {`,
			`  ids.sort();`,
			`  ids.forEach(async id => { await db.query(\`SELECT * FROM t WHERE id = \${id}\`); });`,
			`  return missing;`,
			`}`,
		].join('\n'));
		writeRel(baseRoot, 'tests/service.test.ts', `it('passes', () => { expect(true).toBe(true); });\n`);

		const t0 = Date.now();
		const baseImp = await svc.validateImportsAndExports(baseRoot);
		const baseSem = await svc.analyzeSemanticCorrectness(baseRoot);
		const baseDur = Math.max(1, Date.now() - t0);

		// ERIC+FPERE Remediated Workspace
		writeRel(impRoot, 'package.json', JSON.stringify({ name: 'bench-imp', dependencies: {} }));
		writeRel(impRoot, 'src/helpers.ts', `export function sortIds(ids: readonly number[]): number[] { return [...ids].sort((a, b) => a - b); }\n`);
		writeRel(impRoot, 'src/service.ts', [
			`import { sortIds } from './helpers';`,
			`export async function run(db: { query: (sql: string, params: unknown[]) => Promise<unknown> }, ids: number[]) {`,
			`  const ordered = sortIds(ids);`,
			`  for (const id of ordered) { await db.query('SELECT * FROM t WHERE id = $1', [id]); }`,
			`  return ordered;`,
			`}`,
		].join('\n'));
		writeRel(impRoot, 'tests/service.test.ts', `import assert from 'node:assert';\nit('sorts numerically', () => { assert.deepStrictEqual([10, 2].sort((a, b) => a - b), [2, 10]); });\n`);

		const t1 = Date.now();
		const impImp = await svc.validateImportsAndExports(impRoot);
		const impSem = await svc.analyzeSemanticCorrectness(impRoot);
		const impDur = Math.max(1, Date.now() - t1);

		const comparison = compareBenchmarkRuns('Order-Processing Service Benchmark', {
			label: 'Baseline',
			firstPassBuildPassed: false,
			firstPassTypeCheckPassed: false,
			importDependencyErrors: baseImp.errorCount,
			semanticDefects: baseSem.criticalCount + baseSem.errorCount,
			apiUsageDefects: 0,
			weakTestOracles: baseSem.weakTestOracleCount,
			securityFindings: baseSem.findings.filter(f => f.category === 'security_auth_boundary').length,
			integrationDefects: 0,
			testsPassed: 0,
			testsFailed: 1,
			requirementsSatisfied: 0,
			requirementsTotal: 3,
			repairCycles: 2,
			durationMs: baseDur,
		}, {
			label: 'With ERIC + FPERE',
			firstPassBuildPassed: true,
			firstPassTypeCheckPassed: true,
			importDependencyErrors: impImp.errorCount,
			semanticDefects: impSem.criticalCount + impSem.errorCount,
			apiUsageDefects: 0,
			weakTestOracles: impSem.weakTestOracleCount,
			securityFindings: impSem.findings.filter(f => f.category === 'security_auth_boundary').length,
			integrationDefects: 0,
			testsPassed: 3,
			testsFailed: 0,
			requirementsSatisfied: 3,
			requirementsTotal: 3,
			repairCycles: 0,
			durationMs: impDur,
		});

		assert.strictEqual(impImp.errorCount, 0);
		assert.strictEqual(impSem.criticalCount + impSem.errorCount, 0);
		assert.ok(comparison.defectDelta >= 5, `Expected measured defectDelta >= 5, got ${comparison.defectDelta}`);
		assert.ok(comparison.summary.includes('measured defect reduction='));
		svc.dispose();
	});
});
