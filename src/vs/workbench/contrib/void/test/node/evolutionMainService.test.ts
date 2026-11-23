/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EvolutionLiveEvent } from '../../common/evolutionTypes.js';
import { KodiaEvolutionMainService } from '../../electron-main/evolutionMainService.js';

suite('Kodia - Next-Gen Evolution, Supply-Chain, IaC/FinOps & Ops (Node Main Service)', function () {
	this.timeout(60_000);

	let service: KodiaEvolutionMainService;
	let dir: string;
	let events: EvolutionLiveEvent[];
	const p = (rel: string) => path.join(dir, rel);

	setup(() => {
		service = new KodiaEvolutionMainService();
		events = [];
		service.onDidEmitEvent(ev => events.push(ev));
		dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kodia-evolution-node-')));
	});

	teardown(() => {
		service.dispose();
		fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
	});

	test('runs real SBOM/CycloneDX 1.5, IaC/FinOps, log-file incident forensics, git release planning, privacy/modernization & governed capability radar', async () => {
		// Seed realistic polyglot enterprise workspace
		fs.writeFileSync(p('package.json'), JSON.stringify({
			name: 'acme-billing',
			version: '2.1.0',
			dependencies: { express: '4.19.2', lodash: '^4.17.21' },
		}), 'utf8');
		fs.writeFileSync(p('Dockerfile'), `FROM node:latest\nCMD ["node", "index.js"]\n`, 'utf8');
		fs.mkdirSync(p('migrations'), { recursive: true });
		fs.writeFileSync(p('migrations/002_drop.sql'), `ALTER TABLE invoices DROP COLUMN legacy_ref;\n`, 'utf8');
		fs.writeFileSync(p('prod.log'), `2026-11-23T02:00:00Z INFO GET /ok 200 latency=25ms\n2026-11-23T02:00:01Z ERROR POST /pay 500 timeout latency=950ms\n`, 'utf8');
		fs.writeFileSync(p('index.js'), `function logUser(email, ssn) { console.log(email, ssn); }\nmodule.exports = { logUser };\n`, 'utf8');

		// Initialize real git repo with conventional commits for real git-log release planning!
		cp.execFileSync('git', ['init'], { cwd: dir, windowsHide: true });
		cp.execFileSync('git', ['config', 'user.email', 'test@kodia.dev'], { cwd: dir, windowsHide: true });
		cp.execFileSync('git', ['config', 'user.name', 'Kodia Test'], { cwd: dir, windowsHide: true });
		cp.execFileSync('git', ['add', '.'], { cwd: dir, windowsHide: true });
		cp.execFileSync('git', ['commit', '-m', 'feat(billing): add invoice export endpoint'], { cwd: dir, windowsHide: true });

		// 1. Supply-Chain & CycloneDX 1.5 SBOM
		const sbom = await service.runSupplyChainAudit(dir, { runLiveAudit: false });
		assert.strictEqual(sbom.componentCount, 2);
		assert.ok(fs.existsSync(p('.kodia/evolution/sbom.cdx.json')), 'CycloneDX 1.5 SBOM must persist on disk');
		const savedSbom = JSON.parse(fs.readFileSync(p('.kodia/evolution/sbom.cdx.json'), 'utf8'));
		assert.strictEqual(savedSbom.bomFormat, 'CycloneDX');
		assert.strictEqual(savedSbom.specVersion, '1.5');

		// 2. IaC & FinOps
		const iac = await service.runIacFinOpsAudit(dir, { monthlyBudgetUsd: 500 });
		assert.ok(iac.findings.some(f => f.ruleId === 'KODIA-DOCKER-001'));
		assert.ok(iac.findings.some(f => f.ruleId === 'KODIA-DOCKER-004'));

		// 3. Real log-file incident forensics
		const inc = await service.analyzeProductionIncident(dir, { serviceName: 'acme-billing', logFile: 'prod.log' });
		assert.strictEqual(inc.totalLogLines, 2);
		assert.strictEqual(inc.errorCount, 1);
		assert.strictEqual(inc.sloBreached, true);

		// 4. Real git-log autonomous release plan + destructive migration check
		const rel = await service.planAutonomousRelease(dir);
		assert.strictEqual(rel.currentVersion, '2.1.0');
		assert.strictEqual(rel.recommendedBump, 'minor');
		assert.strictEqual(rel.nextVersion, '2.2.0');
		assert.strictEqual(rel.releaseSafe, false, 'DROP COLUMN migration must flag releaseSafe=false');

		// 5. Privacy & Legacy Modernization
		const { privacy, modernization } = await service.auditPrivacyAndModernization(dir);
		assert.strictEqual(privacy.frameworkSummary.GDPR.status, 'blocker');
		assert.strictEqual(modernization.waves.length, 3);

		// 6. Permanent Capability Evolution Radar + Governed Proposal Lifecycle (autoInstallAllowed=false)
		const radar = await service.runCapabilityEvolutionRadar(dir);
		assert.ok(radar.workspaceEcosystems.includes('Node/TypeScript'));
		assert.ok(radar.workspaceEcosystems.includes('Cloud/IaC'));

		const evaluated = await service.evaluateTechnologyCandidate(dir, {
			name: 'OTLP Span Correlator',
			domain: 'infrastructure-cloud',
			summary: 'Correlate local tests with OpenTelemetry traces',
			license: 'Apache-2.0',
			maturity: 'production-proven',
			benchmarksOrEvidenceCount: 4,
		});
		assert.strictEqual(evaluated.verdict, 'ADOPT_CANDIDATE');
		assert.strictEqual(evaluated.autoInstallAllowed, false);

		const snap = await service.loadWorkspaceSnapshot(dir);
		assert.ok(snap.proposals.some(pr => pr.title === 'OTLP Span Correlator' && pr.autoInstallAllowed === false));
		assert.ok(events.length >= 7, `Expected >=7 live events, got ${events.length}`);
	});
});
