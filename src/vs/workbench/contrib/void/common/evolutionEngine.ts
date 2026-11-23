/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { buildProjectDigitalTwin } from './digitalTwin.js';
import { ScannedSourceFile } from './projectHealth.js';
import {
	CapabilityRadarReport,
	ComplianceFramework,
	EvolutionVerdict,
	FinOpsEstimateItem,
	IacArtifactKind,
	IacFinOpsReport,
	IacSecurityFinding,
	IncidentErrorCluster,
	IncidentForensicsReport,
	LegacyModernizationReport,
	LicenseRiskTier,
	MigrationSafetyFinding,
	ModernizationWave,
	PackageEcosystem,
	PrivacyComplianceFinding,
	PrivacyComplianceReport,
	ReleasePlanReport,
	SbomComponent,
	SupplyChainAuditReport,
	SupplyChainFinding,
	TechnologyEvaluationInput,
	TechnologyEvaluationResult,
} from './evolutionTypes.js';

function normPath(p: string): string {
	return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

// ============================================================================
// 1. SOFTWARE SUPPLY-CHAIN INTELLIGENCE & CYCLONEDX 1.5 SBOM ENGINE
// ============================================================================

const PERMISSIVE_LICENSES = /\b(MIT|ISC|BSD-2-Clause|BSD-3-Clause|Apache-2\.0|Unlicense|0BSD|CC0-1\.0|BlueOak-1\.0\.0)\b/i;
const WEAK_COPYLEFT_LICENSES = /\b(MPL-2\.0|LGPL-2\.1|LGPL-3\.0|EPL-2\.0|CDDL)\b/i;
const STRONG_COPYLEFT_LICENSES = /\b(GPL-2\.0|GPL-3\.0|AGPL-3\.0|SSPL-1\.0|BUSL-1\.1)\b/i;

const KNOWN_POPULAR_PACKAGES = [
	'express', 'lodash', 'react', 'axios', 'typescript', 'webpack', 'next', 'eslint', 'prettier',
	'requests', 'numpy', 'pandas', 'fastapi', 'django', 'flask', 'torch', 'pydantic',
];

export function classifyLicenseRisk(license?: string): LicenseRiskTier {
	if (!license || !license.trim()) { return 'unknown'; }
	if (STRONG_COPYLEFT_LICENSES.test(license)) { return 'strong_copyleft'; }
	if (WEAK_COPYLEFT_LICENSES.test(license)) { return 'weak_copyleft'; }
	if (PERMISSIVE_LICENSES.test(license)) { return 'permissive'; }
	if (/proprietary|commercial|unlicensed/i.test(license)) { return 'proprietary'; }
	return 'unknown';
}

function editDistance1(a: string, b: string): boolean {
	if (a === b || Math.abs(a.length - b.length) > 1 || a.length < 5) { return false; }
	let i = 0, j = 0, diffs = 0;
	while (i < a.length && j < b.length) {
		if (a[i] === b[j]) { i++; j++; continue; }
		diffs++;
		if (diffs > 1) { return false; }
		if (a.length > b.length) { i++; }
		else if (b.length > a.length) { j++; }
		else { i++; j++; }
	}
	return diffs + (a.length - i) + (b.length - j) === 1;
}

export function analyzeSupplyChainWorkspace(
	files: readonly ScannedSourceFile[],
	opts?: {
		blockCopyleft?: boolean;
		liveVulnerabilities?: readonly SupplyChainFinding[];
		liveAuditExecuted?: boolean;
		liveAuditNote?: string;
	},
): SupplyChainAuditReport {
	const components: SbomComponent[] = [];
	const findings: SupplyChainFinding[] = [...(opts?.liveVulnerabilities ?? [])];
	const ecosystems = new Set<PackageEcosystem>();
	const fileMap = new Map(files.map(f => [normPath(f.relativePath), f.content]));

	const pushFinding = (f: Omit<SupplyChainFinding, 'id'>) => {
		findings.push({ id: `SC-${String(findings.length + 1).padStart(3, '0')}`, ...f });
	};

	const checkPackageSignals = (name: string, version: string, sourceFile: string, pinned: boolean, license?: string) => {
		if (!pinned || version === '*' || /^latest$/i.test(version)) {
			pushFinding({
				severity: version === '*' || /^latest$/i.test(version) ? 'high' : 'medium',
				category: 'pinning',
				packageName: name,
				file: sourceFile,
				title: `Unpinned dependency version "${name}@${version}"`,
				detail: 'Unpinned or wildcard version ranges allow silent upstream compromise or breaking transitive upgrades.',
				remediation: 'Pin exact versions or enforce committed lockfiles with integrity hashes.',
			});
		}
		const lower = name.toLowerCase().replace(/^@[^/]+\//, '');
		const lookalike = KNOWN_POPULAR_PACKAGES.find(pop => editDistance1(lower, pop));
		if (lookalike) {
			pushFinding({
				severity: 'high',
				category: 'typosquat',
				packageName: name,
				file: sourceFile,
				title: `Potential typosquatting dependency "${name}" (similar to "${lookalike}")`,
				detail: `Package name "${name}" is 1 edit away from widely targeted package "${lookalike}".`,
				remediation: `Verify publisher identity and provenance for "${name}" or replace with "${lookalike}".`,
			});
		}
		const lRisk = classifyLicenseRisk(license);
		if (lRisk === 'strong_copyleft') {
			pushFinding({
				severity: opts?.blockCopyleft ? 'critical' : 'medium',
				category: 'license',
				packageName: name,
				file: sourceFile,
				title: `Strong copyleft license (${license}) detected on "${name}"`,
				detail: 'GPL/AGPL/SSPL licenses may impose source-disclosure obligations on proprietary distributions.',
				remediation: 'Obtain legal review or substitute a permissively licensed alternative (MIT/Apache-2.0/BSD).',
			});
		}
	};

	for (const f of files) {
		const rel = normPath(f.relativePath);
		const base = rel.split('/').pop() ?? '';

		// 1. Node/npm package.json
		if (base === 'package.json') {
			ecosystems.add('npm');
			try {
				const pkg = JSON.parse(f.content) as {
					license?: string;
					dependencies?: Record<string, string>;
					devDependencies?: Record<string, string>;
					scripts?: Record<string, string>;
				};
				const dirPrefix = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/') + 1) : '';
				const hasLock = fileMap.has(`${dirPrefix}package-lock.json`)
					|| fileMap.has(`${dirPrefix}pnpm-lock.yaml`)
					|| fileMap.has(`${dirPrefix}yarn.lock`);
				if (!hasLock && (Object.keys(pkg.dependencies ?? {}).length + Object.keys(pkg.devDependencies ?? {}).length) > 0) {
					pushFinding({
						severity: 'medium',
						category: 'lockfile',
						packageName: '(workspace)',
						file: rel,
						title: 'Missing committed lockfile alongside package.json',
						detail: 'Builds without package-lock.json/pnpm-lock.yaml/yarn.lock are non-deterministic and vulnerable to supply-chain drift.',
						remediation: 'Generate and commit a lockfile and run reproducible installs (npm ci / pnpm install --frozen-lockfile).',
					});
				}
				// Check risky install scripts
				for (const hookName of ['preinstall', 'install', 'postinstall']) {
					const script = pkg.scripts?.[hookName];
					if (script && /\b(curl|wget|powershell|bash\s+-c|eval|nc\s|base64)\b/i.test(script)) {
						pushFinding({
							severity: 'critical',
							category: 'lifecycle-script',
							packageName: hookName,
							file: rel,
							title: `High-risk lifecycle script "${hookName}" executes shell/network commands`,
							detail: `Script "${script.slice(0, 100)}" executes shell or remote fetch commands during package installation.`,
							remediation: 'Remove remote download/exec logic from install scripts and audit with --ignore-scripts.',
						});
					}
				}
				// Check lockfile licenses if package-lock.json is present
				const lockRaw = fileMap.get(`${dirPrefix}package-lock.json`);
				const lockLicenses = new Map<string, string>();
				if (lockRaw) {
					try {
						const lockJson = JSON.parse(lockRaw) as { packages?: Record<string, { license?: string }> };
						for (const [k, v] of Object.entries(lockJson.packages ?? {})) {
							const pkgName = k.replace(/^node_modules\//, '');
							if (pkgName && v?.license) { lockLicenses.set(pkgName, v.license); }
						}
					} catch { /* ignore malformed lockfile */ }
				}
				const addDeps = (deps: Record<string, string> | undefined, scope: 'runtime' | 'dev') => {
					for (const [name, ver] of Object.entries(deps ?? {})) {
						const pinned = /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(ver);
						const lic = lockLicenses.get(name);
						components.push({
							name,
							version: ver,
							ecosystem: 'npm',
							purl: `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(ver)}`,
							scope,
							license: lic,
							licenseRisk: classifyLicenseRisk(lic),
							pinned,
							sourceFile: rel,
						});
						checkPackageSignals(name, ver, rel, pinned, lic);
					}
				};
				addDeps(pkg.dependencies, 'runtime');
				addDeps(pkg.devDependencies, 'dev');
			} catch { /* skip invalid json */ }
		}

		// 2. Python requirements.txt
		if (/^requirements.*\.txt$/i.test(base)) {
			ecosystems.add('pypi');
			for (const line of f.content.split(/\r?\n/)) {
				const trimmed = line.trim();
				if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) { continue; }
				const m = /^([A-Za-z0-9_.-]+)\s*(==|>=|<=|~=|!=|>|<)?\s*([^\s;#]+)?/.exec(trimmed);
				if (!m) { continue; }
				const name = m[1];
				const op = m[2] ?? '';
				const ver = m[3] ? `${op}${m[3]}` : '*';
				const pinned = op === '==' && Boolean(m[3]);
				components.push({
					name,
					version: ver,
					ecosystem: 'pypi',
					purl: `pkg:pypi/${name.toLowerCase()}@${encodeURIComponent(m[3] ?? 'unpinned')}`,
					scope: 'runtime',
					licenseRisk: 'unknown',
					pinned,
					sourceFile: rel,
				});
				checkPackageSignals(name, ver, rel, pinned);
			}
		}

		// 3. Go go.mod
		if (base === 'go.mod') {
			ecosystems.add('go');
			for (const line of f.content.split(/\r?\n/)) {
				const m = /^\s*(?:require\s+)?([a-z0-9.-]+\/[^\s]+)\s+(v\d+\.\d+\.\d+[^\s]*)/i.exec(line);
				if (!m) { continue; }
				components.push({
					name: m[1],
					version: m[2],
					ecosystem: 'go',
					purl: `pkg:golang/${m[1]}@${m[2]}`,
					scope: 'runtime',
					licenseRisk: 'unknown',
					pinned: true,
					sourceFile: rel,
				});
			}
		}

		// 4. Rust Cargo.toml
		if (base === 'Cargo.toml') {
			ecosystems.add('cargo');
			let inDeps = false;
			for (const line of f.content.split(/\r?\n/)) {
				const trimmed = line.trim();
				if (/^\[dependencies\]/i.test(trimmed)) { inDeps = true; continue; }
				if (/^\[/.test(trimmed)) { inDeps = false; continue; }
				if (!inDeps) { continue; }
				const m = /^([A-Za-z0-9_-]+)\s*=\s*(?:"([^"]+)"|\{[^}]*version\s*=\s*"([^"]+)")/.exec(trimmed);
				if (!m) { continue; }
				const ver = m[2] ?? m[3] ?? '*';
				const pinned = /^=?\d+\.\d+\.\d+/.test(ver);
				components.push({
					name: m[1],
					version: ver,
					ecosystem: 'cargo',
					purl: `pkg:cargo/${m[1]}@${encodeURIComponent(ver)}`,
					scope: 'runtime',
					licenseRisk: 'unknown',
					pinned,
					sourceFile: rel,
				});
				checkPackageSignals(m[1], ver, rel, pinned);
			}
		}
	}

	const now = new Date().toISOString();
	const cyclonedxSbom = {
		bomFormat: 'CycloneDX',
		specVersion: '1.5',
		version: 1,
		metadata: {
			timestamp: now,
			tools: [{ vendor: 'Kodia', name: 'Kodia Supply-Chain & SBOM Engine', version: '1.0.0' }],
		},
		components: components.map(c => ({
			type: 'library',
			name: c.name,
			version: c.version,
			purl: c.purl,
			scope: c.scope === 'runtime' ? 'required' : 'optional',
			...(c.license ? { licenses: [{ license: { id: c.license } }] } : {}),
		})),
	};

	const critHigh = findings.filter(f => f.severity === 'critical' || f.severity === 'high').length;
	return {
		id: `sbom-${Date.now().toString(36)}`,
		generatedAt: now,
		ecosystemsDetected: [...ecosystems],
		componentCount: components.length,
		components,
		findings,
		liveAuditExecuted: Boolean(opts?.liveAuditExecuted),
		liveAuditNote: opts?.liveAuditNote ?? 'Static manifest & lockfile analysis completed.',
		cyclonedxSbom,
		summary: `Supply-Chain & SBOM: ${components.length} component(s) across [${[...ecosystems].join(', ') || 'none'}], ${findings.length} finding(s) (${critHigh} critical/high).`,
	};
}

// ============================================================================
// 2. CLOUD, INFRASTRUCTURE-AS-CODE (IaC) & FINOPS COST INTELLIGENCE ENGINE
// ============================================================================

export function analyzeIacAndFinOps(
	files: readonly ScannedSourceFile[],
	monthlyBudgetUsd = 500,
): IacFinOpsReport {
	const findings: IacSecurityFinding[] = [];
	const costBreakdown: FinOpsEstimateItem[] = [];
	const kinds = new Set<IacArtifactKind>();
	let artifactsScanned = 0;

	const addFinding = (f: Omit<IacSecurityFinding, 'id'>) => {
		findings.push({ id: `IAC-${String(findings.length + 1).padStart(3, '0')}`, ...f });
	};

	for (const f of files) {
		const rel = normPath(f.relativePath);
		const base = (rel.split('/').pop() ?? '').toLowerCase();
		const lines = f.content.split(/\r?\n/);

		// 1. Dockerfile
		if (base === 'dockerfile' || base.startsWith('dockerfile.') || base.endsWith('.dockerfile')) {
			kinds.add('dockerfile');
			artifactsScanned++;
			let hasUser = false;
			let hasHealthcheck = false;
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				if (/^\s*USER\s+(?!root\b)\S+/i.test(line)) { hasUser = true; }
				if (/^\s*HEALTHCHECK\b/i.test(line)) { hasHealthcheck = true; }
				if (/^\s*FROM\s+[^\s:]+(?::latest)?\s*$/i.test(line) && !/scratch/i.test(line)) {
					addFinding({
						severity: 'medium',
						kind: 'dockerfile',
						ruleId: 'KODIA-DOCKER-001',
						file: rel,
						line: i + 1,
						title: 'Unpinned base image (:latest or missing tag)',
						detail: `Base image "${line.trim()}" is not pinned to a specific digest or minor version.`,
						remediation: 'Pin base images to an explicit version tag and SHA256 digest.',
					});
				}
				if (/^\s*(?:ENV|ARG)\s+[A-Z0-9_]*(?:SECRET|PASSWORD|TOKEN|API_KEY)\s*=?\s*\S+/i.test(line)) {
					addFinding({
						severity: 'critical',
						kind: 'dockerfile',
						ruleId: 'KODIA-DOCKER-002',
						file: rel,
						line: i + 1,
						title: 'Secret baked into Dockerfile ENV/ARG layer',
						detail: 'Secrets in ENV/ARG remain permanently recoverable in image history.',
						remediation: 'Use BuildKit --mount=type=secret at build time and runtime secret managers.',
					});
				}
				if (/curl\s+[^|]+\|\s*(?:sh|bash)/i.test(line)) {
					addFinding({
						severity: 'high',
						kind: 'dockerfile',
						ruleId: 'KODIA-DOCKER-003',
						file: rel,
						line: i + 1,
						title: 'Unverified curl | sh execution in container build',
						detail: 'Piping remote scripts directly into a shell bypasses checksum verification.',
						remediation: 'Download release artifacts, verify SHA256 checksums, then install.',
					});
				}
			}
			if (!hasUser) {
				addFinding({
					severity: 'high',
					kind: 'dockerfile',
					ruleId: 'KODIA-DOCKER-004',
					file: rel,
					line: 1,
					title: 'Container runs as root (no non-root USER instruction)',
					detail: 'Running workloads as root increases container breakout blast radius.',
					remediation: 'Create a dedicated non-root user and add `USER appuser` before CMD/ENTRYPOINT.',
				});
			}
			if (!hasHealthcheck) {
				addFinding({
					severity: 'low',
					kind: 'dockerfile',
					ruleId: 'KODIA-DOCKER-005',
					file: rel,
					line: 1,
					title: 'Missing container HEALTHCHECK instruction',
					detail: 'Orchestrators cannot detect deadlocked processes without health checks.',
					remediation: 'Add a lightweight HEALTHCHECK probing your /health endpoint.',
				});
			}
		}

		// 2. Kubernetes manifests
		if (/\.ya?ml$/i.test(rel) && /\bapiVersion\s*:/i.test(f.content) && /\bkind\s*:\s*(?:Deployment|StatefulSet|DaemonSet|Pod|CronJob|Job)\b/i.test(f.content)) {
			kinds.add('kubernetes');
			artifactsScanned++;
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				if (/\bprivileged\s*:\s*true\b/i.test(line)) {
					addFinding({
						severity: 'critical',
						kind: 'kubernetes',
						ruleId: 'KODIA-K8S-001',
						file: rel,
						line: i + 1,
						title: 'Privileged Kubernetes container enabled',
						detail: 'privileged: true grants near-full host kernel access to the container.',
						remediation: 'Set privileged: false and drop ALL Linux capabilities except what is strictly required.',
					});
				}
				if (/\bhostNetwork\s*:\s*true\b/i.test(line)) {
					addFinding({
						severity: 'high',
						kind: 'kubernetes',
						ruleId: 'KODIA-K8S-002',
						file: rel,
						line: i + 1,
						title: 'hostNetwork: true exposes node network namespace',
						detail: 'Pod can sniff or bind node-level interfaces and metadata services.',
						remediation: 'Remove hostNetwork: true and expose traffic via Kubernetes Service/Ingress.',
					});
				}
			}
			if (!/\blimits\s*:/i.test(f.content)) {
				addFinding({
					severity: 'medium',
					kind: 'kubernetes',
					ruleId: 'KODIA-K8S-003',
					file: rel,
					line: 1,
					title: 'Kubernetes workload missing CPU/memory resource limits',
					detail: 'Unbounded pods can trigger OOMKills and noisy-neighbor outages or autoscaling cost spikes.',
					remediation: 'Define explicit resources.requests and resources.limits for every container.',
				});
			}
			// Estimate K8s workload monthly compute cost
			const repMatch = /\breplicas\s*:\s*(\d+)/.exec(f.content);
			const replicas = repMatch ? Math.max(1, Number(repMatch[1])) : 1;
			const cpuMatch = /\bcpu\s*:\s*"?(\d+)(m)?"?/.exec(f.content);
			const vcpus = cpuMatch ? (cpuMatch[2] ? Number(cpuMatch[1]) / 1000 : Number(cpuMatch[1])) : 0.5;
			const monthly = Math.round(replicas * vcpus * 34 * 100) / 100;
			const savings = replicas > 2 ? Math.round(monthly * 0.25 * 100) / 100 : 0;
			costBreakdown.push({
				resource: `Kubernetes Workload (${replicas} replicas × ${vcpus} vCPU)`,
				sourceFile: rel,
				estimatedMonthlyUsd: monthly,
				rightSizingSavingsUsd: savings,
				recommendation: savings > 0 ? 'Configure HPA + Spot/Preemptible node pools for non-primary replicas (~25% savings).' : 'Right-sized baseline; verify actual CPU p95 utilization after load test.',
			});
		}

		// 3. Terraform (.tf)
		if (/\.tf$/i.test(rel)) {
			kinds.add('terraform');
			artifactsScanned++;
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				if (/cidr_blocks\s*=\s*\[[^\]]*["']0\.0\.0\.0\/0["']/i.test(line)) {
					addFinding({
						severity: 'critical',
						kind: 'terraform',
						ruleId: 'KODIA-TF-001',
						file: rel,
						line: i + 1,
						title: 'Open ingress security group rule (0.0.0.0/0)',
						detail: 'Exposing ports to 0.0.0.0/0 allows unrestricted internet scanning and exploitation.',
						remediation: 'Restrict cidr_blocks to VPC subnets, VPN ranges, or load balancer security groups.',
					});
				}
				if (/\b(?:storage_encrypted|encrypted)\s*=\s*false\b/i.test(line)) {
					addFinding({
						severity: 'high',
						kind: 'terraform',
						ruleId: 'KODIA-TF-002',
						file: rel,
						line: i + 1,
						title: 'Encryption at rest explicitly disabled in Terraform resource',
						detail: 'Unencrypted storage volumes or databases violate SOC2/HIPAA/GDPR data protection baselines.',
						remediation: 'Enable encryption at rest with KMS customer-managed keys.',
					});
				}
				const instMatch = /\binstance_(?:type|class)\s*=\s*["']([^"']+)["']/.exec(line);
				if (instMatch) {
					const inst = instMatch[1];
					const est = /xlarge/i.test(inst) ? 280 : /large/i.test(inst) ? 115 : /medium/i.test(inst) ? 45 : 18;
					const save = est >= 115 ? Math.round(est * 0.3) : 0;
					costBreakdown.push({
						resource: `Terraform Compute/DB (${inst})`,
						sourceFile: rel,
						estimatedMonthlyUsd: est,
						rightSizingSavingsUsd: save,
						recommendation: save > 0 ? 'Consider Graviton/ARM family or 1-yr Savings Plan (~30% reduction).' : 'Small instance class; monitor memory pressure.',
					});
				}
			}
		}

		// 4. GitHub Actions CI/CD workflows
		if (/\.github\/workflows\/.*\.ya?ml$/i.test(rel)) {
			kinds.add('github-actions');
			artifactsScanned++;
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				if (/^\s*permissions\s*:\s*write-all\b/i.test(line)) {
					addFinding({
						severity: 'critical',
						kind: 'github-actions',
						ruleId: 'KODIA-GHA-001',
						file: rel,
						line: i + 1,
						title: 'Overly permissive GitHub Actions token (permissions: write-all)',
						detail: 'Any compromised build step gains write access to repository code, releases, and packages.',
						remediation: 'Apply least-privilege permissions (e.g. `contents: read`).',
					});
				}
				if (/\buses\s*:\s*[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@(?:main|master|v\d+)\b/.test(line) && !/actions\/checkout@/.test(line)) {
					addFinding({
						severity: 'medium',
						kind: 'github-actions',
						ruleId: 'KODIA-GHA-002',
						file: rel,
						line: i + 1,
						title: 'Third-party GitHub Action pinned to mutable branch/tag instead of commit SHA',
						detail: 'Mutable tags can be retargeted by compromised upstream maintainers.',
						remediation: 'Pin third-party actions to a full 40-character commit SHA.',
					});
				}
			}
		}
	}

	const estimatedMonthlyUsd = Math.round(costBreakdown.reduce((s, c) => s + c.estimatedMonthlyUsd, 0) * 100) / 100;
	const potentialMonthlySavingsUsd = Math.round(costBreakdown.reduce((s, c) => s + c.rightSizingSavingsUsd, 0) * 100) / 100;
	const budgetExceeded = estimatedMonthlyUsd > monthlyBudgetUsd;
	const critHigh = findings.filter(f => f.severity === 'critical' || f.severity === 'high').length;

	return {
		id: `iac-${Date.now().toString(36)}`,
		scannedAt: new Date().toISOString(),
		artifactsScanned,
		artifactKinds: [...kinds],
		findings,
		estimatedMonthlyUsd,
		potentialMonthlySavingsUsd,
		costBreakdown,
		budgetExceeded,
		summary: `IaC & FinOps: scanned ${artifactsScanned} artifact(s) [${[...kinds].join(', ') || 'none'}], ${findings.length} finding(s) (${critHigh} critical/high), est. \$${estimatedMonthlyUsd}/mo (save ~\$${potentialMonthlySavingsUsd}/mo).`,
	};
}

// ============================================================================
// 3. PRODUCTION INCIDENT FORENSICS, SLO BURN-RATE & AUTONOMOUS RELEASE ENGINE
// ============================================================================

function percentile(sorted: readonly number[], pct: number): number {
	if (sorted.length === 0) { return 0; }
	const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1));
	return Math.round(sorted[idx] * 100) / 100;
}

export function analyzeProductionIncidentLogs(opts: {
	serviceName: string;
	logText: string;
	sloTargetPct?: number;
	p95BudgetMs?: number;
}): IncidentForensicsReport {
	const sloTarget = opts.sloTargetPct ?? 99.9;
	const p95Budget = opts.p95BudgetMs ?? 400;
	const lines = opts.logText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

	const latencies: number[] = [];
	const clusterMap = new Map<string, { count: number; severity: 'critical' | 'error' | 'warning'; sampleLine: string }>();
	let errorCount = 0;

	for (const line of lines) {
		const latMatch = /(?:latency|duration|response_time|elapsed|ms)[=:\s]+(\d+(?:\.\d+)?)\s*(?:ms)?/i.exec(line);
		if (latMatch) { latencies.push(Number(latMatch[1])); }

		const isCritical = /\b(FATAL|PANIC|OOMKilled|503|502|500|ECONNREFUSED|deadlock)\b/i.test(line);
		const isError = isCritical || /\b(ERROR|Exception|TypeError|UnhandledRejection|timeout|ETIMEDOUT)\b/i.test(line);
		const isWarn = !isError && /\b(WARN|WARNING|429|rate.?limit|retry)\b/i.test(line);

		if (isError) { errorCount++; }
		if (isError || isWarn) {
			const sig = line
				.replace(/\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g, '<ts>')
				.replace(/\b[0-9a-f]{8,}\b/gi, '<id>')
				.replace(/\b\d+\b/g, '<n>')
				.slice(0, 110);
			const prev = clusterMap.get(sig);
			const sev: 'critical' | 'error' | 'warning' = isCritical ? 'critical' : isError ? 'error' : 'warning';
			if (prev) {
				prev.count++;
			} else {
				clusterMap.set(sig, { count: 1, severity: sev, sampleLine: line.slice(0, 180) });
			}
		}
	}

	const total = Math.max(1, lines.length);
	const errorRatePct = Math.round((errorCount / total) * 10_000) / 100;
	const allowedErrorPct = Math.max(0.001, 100 - sloTarget);
	const errorBudgetBurnRate = Math.round((errorRatePct / allowedErrorPct) * 100) / 100;

	latencies.sort((a, b) => a - b);
	const latencyMs = latencies.length > 0 ? {
		p50: percentile(latencies, 50),
		p95: percentile(latencies, 95),
		p99: percentile(latencies, 99),
		sampleCount: latencies.length,
	} : undefined;

	const sloBreached = errorBudgetBurnRate > 1 || Boolean(latencyMs && latencyMs.p95 > p95Budget);

	const clusters: IncidentErrorCluster[] = [...clusterMap.entries()]
		.sort((a, b) => b[1].count - a[1].count)
		.slice(0, 10)
		.map(([signature, data]) => {
			const cause = /ECONNREFUSED|timeout|502|503/i.test(data.sampleLine)
				? 'Downstream service unreachable, saturated connection pool, or network timeout.'
				: /OOM|heap|memory/i.test(data.sampleLine)
				? 'Memory exhaustion or unbounded in-memory cache growth.'
				: /deadlock|lock timeout/i.test(data.sampleLine)
				? 'Database transaction lock contention or unindexed migration lock.'
				: /429|rate.?limit/i.test(data.sampleLine)
				? 'Upstream API quota exhaustion or missing backoff/circuit breaker.'
				: 'Application runtime exception — correlate stack trace with recent commits.';
			return { signature, count: data.count, severity: data.severity, sampleLine: data.sampleLine, suspectedCause: cause };
		});

	const runbookSteps = [
		`1. Confirm blast radius on "${opts.serviceName}" (observed error rate ${errorRatePct}%, burn rate ${errorBudgetBurnRate}x against ${sloTarget}% SLO).`,
		...(clusters[0] ? [`2. Triage top cluster (${clusters[0].count}x): ${clusters[0].suspectedCause}`] : ['2. Inspect recent deployment diff and infrastructure metrics.']),
		...(latencyMs && latencyMs.p95 > p95Budget ? [`3. Latency SLA violated (P95=${latencyMs.p95}ms > budget ${p95Budget}ms): check slow queries, saturation, and autoscaling.`] : ['3. Verify downstream dependencies and connection pools are healthy.']),
		'4. If regression began after latest deploy, trigger staged rollback immediately before deep root-cause repair.',
		'5. Add regression test + SLO alert threshold and run Kodia Independent Verification before re-deploying.',
	];

	const postmortemDraft = [
		`# Incident Postmortem Draft — ${opts.serviceName}`,
		`- **Observed Error Rate:** ${errorRatePct}% (${errorCount}/${lines.length} log events)`,
		`- **SLO Target:** ${sloTarget}% | **Error-Budget Burn Rate:** ${errorBudgetBurnRate}x | **SLO Breached:** ${sloBreached ? 'YES' : 'NO'}`,
		...(latencyMs ? [`- **Latency:** P50=${latencyMs.p50}ms, P95=${latencyMs.p95}ms (budget ${p95Budget}ms), P99=${latencyMs.p99}ms`] : []),
		`## Top Failure Clusters`,
		...(clusters.length > 0 ? clusters.slice(0, 5).map(c => `- **(${c.count}x, ${c.severity})** \`${c.sampleLine}\` — ${c.suspectedCause}`) : ['- No error clusters extracted from log sample.']),
		`## Immediate Mitigation Runbook`,
		...runbookSteps.map(s => `- ${s}`),
	].join('\n');

	return {
		id: `inc-${Date.now().toString(36)}`,
		analyzedAt: new Date().toISOString(),
		serviceName: opts.serviceName,
		totalLogLines: lines.length,
		errorCount,
		errorRatePct,
		latencyMs,
		sloTargetPct: sloTarget,
		errorBudgetBurnRate,
		sloBreached,
		clusters,
		runbookSteps,
		postmortemDraft,
		summary: `Incident Forensics (${opts.serviceName}): ${errorCount}/${lines.length} errors (${errorRatePct}%), burn rate ${errorBudgetBurnRate}x, SLO ${sloBreached ? 'BREACHED' : 'WITHIN BUDGET'}.`,
	};
}

export function analyzeMigrationSafety(files: readonly ScannedSourceFile[]): MigrationSafetyFinding[] {
	const findings: MigrationSafetyFinding[] = [];
	const push = (f: Omit<MigrationSafetyFinding, 'id'>) => {
		findings.push({ id: `MIG-${String(findings.length + 1).padStart(3, '0')}`, ...f });
	};

	for (const f of files) {
		const rel = normPath(f.relativePath);
		if (!/(?:migration|migrations|schema|prisma)/i.test(rel) && !/\.sql$/i.test(rel)) { continue; }
		const lines = f.content.split(/\r?\n/);
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (/\bDROP\s+TABLE\b/i.test(line)) {
				push({
					severity: 'critical',
					file: rel,
					line: i + 1,
					operation: 'DROP TABLE',
					risk: 'Irreversible data loss and immediate failures for running application replicas still referencing this table.',
					zeroDowntimeAlternative: 'Stop reading/writing the table in release N, archive/snapshot data, and drop in release N+1.',
				});
			}
			if (/\bDROP\s+COLUMN\b/i.test(line)) {
				push({
					severity: 'high',
					file: rel,
					line: i + 1,
					operation: 'DROP COLUMN',
					risk: 'Rolling deploys with previous app pods running SELECT * or old ORM models will crash.',
					zeroDowntimeAlternative: 'Use expand-and-contract: remove code references first, deploy, then drop column in a follow-up migration.',
				});
			}
			if (/\bADD\s+COLUMN\b.*\bNOT\s+NULL\b/i.test(line) && !/\bDEFAULT\b/i.test(line)) {
				push({
					severity: 'high',
					file: rel,
					line: i + 1,
					operation: 'ADD COLUMN NOT NULL (no DEFAULT)',
					risk: 'Fails on non-empty tables and can acquire full table rewrite lock.',
					zeroDowntimeAlternative: 'Add nullable column, backfill in batches, then add NOT NULL constraint with NOT VALID + VALIDATE.',
				});
			}
			if (/\bCREATE\s+(?:UNIQUE\s+)?INDEX\b/i.test(line) && !/\bCONCURRENTLY\b/i.test(line)) {
				push({
					severity: 'medium',
					file: rel,
					line: i + 1,
					operation: 'CREATE INDEX without CONCURRENTLY',
					risk: 'Acquires write lock on large Postgres tables during index build, stalling production writes.',
					zeroDowntimeAlternative: 'Use `CREATE INDEX CONCURRENTLY` outside an explicit transaction block.',
				});
			}
		}
	}
	return findings;
}

function bumpSemver(version: string, bump: 'major' | 'minor' | 'patch' | 'none'): string {
	const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
	if (!m) { return version; }
	let major = Number(m[1]), minor = Number(m[2]), patch = Number(m[3]);
	if (bump === 'major') { major++; minor = 0; patch = 0; }
	else if (bump === 'minor') { minor++; patch = 0; }
	else if (bump === 'patch') { patch++; }
	return `${major}.${minor}.${patch}`;
}

export function buildAutonomousReleasePlan(opts: {
	currentVersion: string;
	commitSubjects: readonly string[];
	files: readonly ScannedSourceFile[];
}): ReleasePlanReport {
	const breakingChanges: string[] = [];
	const features: string[] = [];
	const fixes: string[] = [];

	for (const subject of opts.commitSubjects) {
		const s = subject.trim();
		if (!s) { continue; }
		if (/!:|BREAKING CHANGE/i.test(s)) { breakingChanges.push(s); }
		else if (/^feat(?:\([^)]+\))?:/i.test(s)) { features.push(s); }
		else if (/^fix(?:\([^)]+\))?:/i.test(s)) { fixes.push(s); }
	}

	const recommendedBump: ReleasePlanReport['recommendedBump'] =
		breakingChanges.length > 0 ? 'major' :
		features.length > 0 ? 'minor' :
		fixes.length > 0 || opts.commitSubjects.length > 0 ? 'patch' : 'none';
	const nextVersion = bumpSemver(opts.currentVersion, recommendedBump);
	const migrationFindings = analyzeMigrationSafety(opts.files);
	const hasCriticalMig = migrationFindings.some(m => m.severity === 'critical' || m.severity === 'high');

	const canaryRolloutPlan = [
		`Stage 1 (Canary 5%): Deploy v${nextVersion} to 5% traffic for 15 minutes; watch error-budget burn rate < 1.0x and P95 latency.`,
		`Stage 2 (Canary 25%): Expand to 25% traffic for 30 minutes; run synthetic API health & contract assertions.`,
		`Stage 3 (Full 100%): Complete rollout after zero critical alerts; archive Proof-Carrying Change Record.`,
	];
	const rollbackPlaybook = [
		`1. Shift ingress/load-balancer weight back to v${opts.currentVersion} immediately.`,
		...(migrationFindings.length > 0
			? ['2. WARNING: Schema migrations detected — verify backward compatibility of database schema before rolling back application code!']
			: ['2. No destructive schema migrations detected — application rollback is stateless and immediate.']),
		'3. Capture incident logs and run `evolution_analyze_incident` for postmortem forensics.',
	];

	const changelogMarkdown = [
		`## v${nextVersion} (${new Date().toISOString().slice(0, 10)})`,
		...(breakingChanges.length ? [`### Breaking Changes`, ...breakingChanges.map(c => `- ${c}`)] : []),
		...(features.length ? [`### Features`, ...features.map(c => `- ${c}`)] : []),
		...(fixes.length ? [`### Fixes`, ...fixes.map(c => `- ${c}`)] : []),
		...(migrationFindings.length ? [`### Migration Safety Warnings`, ...migrationFindings.map(m => `- **[${m.severity.toUpperCase()}]** ${m.file}:${m.line} — ${m.operation}: ${m.risk}`)] : []),
	].join('\n');

	return {
		id: `relplan-${Date.now().toString(36)}`,
		createdAt: new Date().toISOString(),
		currentVersion: opts.currentVersion,
		recommendedBump,
		nextVersion,
		commitsAnalyzed: opts.commitSubjects.length,
		breakingChanges,
		features,
		fixes,
		migrationFindings,
		releaseSafe: !hasCriticalMig,
		canaryRolloutPlan,
		rollbackPlaybook,
		changelogMarkdown,
		summary: `Release Plan: v${opts.currentVersion} -> v${nextVersion} (${recommendedBump}), ${opts.commitSubjects.length} commit(s), ${migrationFindings.length} migration warning(s), safe=${!hasCriticalMig}.`,
	};
}

// ============================================================================
// 4. DATA GOVERNANCE, PRIVACY COMPLIANCE & LEGACY MODERNIZATION ENGINE
// ============================================================================

export function analyzePrivacyCompliance(files: readonly ScannedSourceFile[]): PrivacyComplianceReport {
	const findings: PrivacyComplianceFinding[] = [];
	const push = (f: Omit<PrivacyComplianceFinding, 'id'>) => {
		findings.push({ id: `PRIV-${String(findings.length + 1).padStart(3, '0')}`, ...f });
	};

	let hasRetentionOrDeleteControl = false;
	let hasConsentControl = false;

	for (const f of files) {
		const rel = normPath(f.relativePath);
		if (!/\.(ts|tsx|js|jsx|mjs|cjs|py|go|java|rb|php|sql|prisma)$/i.test(rel)) { continue; }
		if (/\b(retention|gdprDelete|eraseUser|rightToBeForgotten|anonymize|purgeExpired)\b/i.test(f.content)) {
			hasRetentionOrDeleteControl = true;
		}
		if (/\b(consent|optIn|optOut|cookieConsent)\b/i.test(f.content)) {
			hasConsentControl = true;
		}

		const lines = f.content.split(/\r?\n/);
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const lineNum = i + 1;

			// PII logged directly
			if (/\b(?:console\.(?:log|info|warn|error)|logger\.(?:info|debug|warn|error)|print)\s*\([^)]*\b(ssn|socialSecurity|creditCard|cardNumber|pan|dob|dateOfBirth|patientName|medicalRecord|email|phoneNumber)\b/i.test(line)
				&& !/\b(redact|mask|hash|anonymize)\b/i.test(line)) {
				push({
					severity: 'critical',
					frameworks: ['GDPR', 'SOC2', 'HIPAA'],
					piiKind: 'Direct PII/PHI Logging',
					file: rel,
					line: lineNum,
					title: 'Unredacted PII/PHI written directly to application logs',
					detail: `Line logs sensitive personal/health field without masking: ${line.trim().slice(0, 120)}`,
					remediation: 'Mask or strip PII/PHI before emitting logs or telemetry.',
				});
			}

			// Sending PII directly into external LLM prompt without redaction
			if (/\b(openai|anthropic|gemini|sendLLM|chat\.completions|messages\.create)\b/i.test(f.content)
				&& /\b(ssn|creditCard|patientRecord|diagnosis|passportNumber|taxId)\b/i.test(line)
				&& !/\b(redact|anonymize|pseudonymize)\b/i.test(f.content)) {
				push({
					severity: 'high',
					frameworks: ['GDPR', 'HIPAA', 'EU_AI_ACT'],
					piiKind: 'PII/PHI in AI Model Payload',
					file: rel,
					line: lineNum,
					title: 'Sensitive personal/health data referenced in AI provider module without redaction',
					detail: 'Transmitting raw regulated data to external AI endpoints risks GDPR cross-border, HIPAA BAA, and EU AI Act violations.',
					remediation: 'Pseudonymize/redact PII before LLM invocation and document data-processing basis.',
				});
			}

			// Automated high-stakes decision without human oversight (EU AI Act)
			if (/\b(loanApproval|creditScore|hiringScore|medicalDiagnosis|resumeRank|bailRisk)\b/i.test(line)
				&& !/\b(humanReview|humanInTheLoop|appeal|auditLog)\b/i.test(f.content)) {
				push({
					severity: 'high',
					frameworks: ['EU_AI_ACT', 'SOC2'],
					piiKind: 'High-Risk Automated Decision',
					file: rel,
					line: lineNum,
					title: 'High-stakes automated decision logic lacks visible human-oversight / audit trail',
					detail: 'High-risk AI decisions require explainability, human-in-the-loop review, and immutable audit logging.',
					remediation: 'Add human approval/override path, decision audit log, and model documentation.',
				});
			}
		}
	}

	const missingControls: string[] = [];
	if (findings.length > 0 && !hasRetentionOrDeleteControl) {
		missingControls.push('No automated data-retention / right-to-erasure (GDPR Art. 17) handler detected in scanned code.');
	}
	if (findings.length > 0 && !hasConsentControl) {
		missingControls.push('No explicit user consent / opt-out enforcement hook detected for PII processing.');
	}

	const frameworkSummary: Record<ComplianceFramework, { findings: number; status: 'pass' | 'attention' | 'blocker' }> = {
		GDPR: { findings: 0, status: 'pass' },
		SOC2: { findings: 0, status: 'pass' },
		HIPAA: { findings: 0, status: 'pass' },
		EU_AI_ACT: { findings: 0, status: 'pass' },
	};
	for (const fw of Object.keys(frameworkSummary) as ComplianceFramework[]) {
		const fwFindings = findings.filter(x => x.frameworks.includes(fw));
		const hasCrit = fwFindings.some(x => x.severity === 'critical');
		frameworkSummary[fw] = {
			findings: fwFindings.length,
			status: hasCrit ? 'blocker' : fwFindings.length > 0 ? 'attention' : 'pass',
		};
	}

	return {
		id: `priv-${Date.now().toString(36)}`,
		scannedAt: new Date().toISOString(),
		filesScanned: files.length,
		findings,
		frameworkSummary,
		missingControls,
		summary: `Privacy & Governance: ${findings.length} finding(s) across ${files.length} file(s) (GDPR=${frameworkSummary.GDPR.status}, SOC2=${frameworkSummary.SOC2.status}, HIPAA=${frameworkSummary.HIPAA.status}, EU_AI_ACT=${frameworkSummary.EU_AI_ACT.status}).`,
	};
}

export function planLegacyModernization(files: readonly ScannedSourceFile[]): LegacyModernizationReport {
	const twin = buildProjectDigitalTwin(files);
	const fanIn = new Map<string, number>();
	for (const node of twin.nodes) {
		fanIn.set(node.id, node.importedBy.length);
	}

	const monolithHotspots: { file: string; fanIn: number; lines: number; reason: string }[] = [];
	const deprecatedPatterns: { file: string; line: number; pattern: string; replacement: string }[] = [];

	const depChecks: readonly { regex: RegExp; pattern: string; replacement: string }[] = [
		{ regex: /\bnew\s+Buffer\s*\(/, pattern: 'Deprecated Node new Buffer()', replacement: 'Use Buffer.from() or Buffer.alloc()' },
		{ regex: /\bcomponentWillMount\b|\bcomponentWillReceiveProps\b/, pattern: 'Legacy React UNSAFE lifecycle hook', replacement: 'Migrate to functional components + hooks' },
		{ regex: /\bmysql_query\s*\(/, pattern: 'Removed PHP mysql_query()', replacement: 'Migrate to PDO prepared statements' },
		{ regex: /\bpython\s*2\.|print\s+["'][^"']+["']\s*$/, pattern: 'Python 2 syntax', replacement: 'Migrate to Python 3 print() & type hints' },
		{ regex: /\bvar\s+[A-Za-z_$][A-Za-z0-9_$]*\s*=/, pattern: 'Legacy ES5 var declaration', replacement: 'Migrate to const/let with TypeScript strict mode' },
	];

	for (const f of files) {
		const rel = normPath(f.relativePath);
		const lines = f.content.split(/\r?\n/);
		const fi = fanIn.get(rel) ?? 0;
		if (lines.length >= 250 || fi >= 4) {
			monolithHotspots.push({
				file: rel,
				fanIn: fi,
				lines: lines.length,
				reason: lines.length >= 250 && fi >= 4 ? 'Large file with high fan-in coupling' : lines.length >= 250 ? 'High line count / god-module candidate' : 'High fan-in shared dependency hub',
			});
		}
		for (let i = 0; i < lines.length; i++) {
			for (const dc of depChecks) {
				if (dc.regex.test(lines[i])) {
					deprecatedPatterns.push({ file: rel, line: i + 1, pattern: dc.pattern, replacement: dc.replacement });
					break;
				}
			}
		}
	}

	monolithHotspots.sort((a, b) => (b.fanIn * 100 + b.lines) - (a.fanIn * 100 + a.lines));

	const waves: ModernizationWave[] = [
		{
			wave: 1,
			title: 'Characterization Tests & Contract Freezing',
			targetModules: monolithHotspots.slice(0, 3).map(h => h.file),
			risk: 'low',
			strategy: 'Lock down existing behavior with golden/contract tests and API Studio regression suites before modifying legacy internals.',
			verificationGate: '100% characterization tests green + Kodia Independent Verification APPROVED.',
		},
		{
			wave: 2,
			title: 'Leaf & Deprecated Pattern Remediation',
			targetModules: [...new Set(deprecatedPatterns.map(d => d.file))].slice(0, 8),
			risk: 'medium',
			strategy: 'Replace deprecated runtime APIs and introduce strict typing/lint boundaries on low-blast-radius modules first.',
			verificationGate: 'Zero compiler errors + mutation score check on refactored modules.',
		},
		{
			wave: 3,
			title: 'Strangler-Fig Extraction of High-Fan-In Hubs',
			targetModules: monolithHotspots.slice(0, 5).map(h => h.file),
			risk: 'high',
			strategy: 'Introduce typed facade interfaces behind feature flags, migrate callers incrementally, and retire legacy code only after canary parity.',
			verificationGate: 'Change-impact tests + Independent Verification + canary SLO parity.',
		},
	];

	return {
		id: `mod-${Date.now().toString(36)}`,
		analyzedAt: new Date().toISOString(),
		totalModules: files.length,
		monolithHotspots: monolithHotspots.slice(0, 12),
		deprecatedPatterns: deprecatedPatterns.slice(0, 25),
		waves,
		summary: `Legacy Modernization: ${monolithHotspots.length} hotspot(s) & ${deprecatedPatterns.length} deprecated pattern(s) across ${files.length} file(s); structured into ${waves.length} Strangler-Fig waves.`,
	};
}

// ============================================================================
// 5. PERMANENT CONTINUOUS CAPABILITY EVOLUTION & SIGNAL-VS-HYPE ENGINE (§6)
// ============================================================================

export const BUILTIN_EVOLUTION_RADAR_CANDIDATES: readonly TechnologyEvaluationInput[] = [
	{
		name: 'CycloneDX 1.5 SBOM & Reproducible Lockfile Attestation',
		domain: 'security-threats',
		summary: 'Standardized machine-readable SBOMs with PURL identifiers and provenance verification.',
		license: 'Apache-2.0',
		maturity: 'production-proven',
		benchmarksOrEvidenceCount: 5,
		requiresNewRuntimeDependency: false,
	},
	{
		name: 'OpenTelemetry Distributed Trace Correlation',
		domain: 'infrastructure-cloud',
		summary: 'Vendor-neutral OTLP span correlation linking local IDE debugging, API calls, and production traces.',
		license: 'Apache-2.0',
		maturity: 'production-proven',
		benchmarksOrEvidenceCount: 5,
		requiresNewRuntimeDependency: false,
	},
	{
		name: 'Property-Based Differential & Formal Contract Testing',
		domain: 'testing-verification',
		summary: 'Seeded property fuzzing with counterexample shrinking integrated directly into autonomous repair verification.',
		license: 'MIT',
		maturity: 'production-proven',
		benchmarksOrEvidenceCount: 4,
		requiresNewRuntimeDependency: false,
	},
	{
		name: 'MCP Apps & Typed Multi-Agent Verification Protocols',
		domain: 'ai-agents',
		summary: 'Structured tool protocols with adversarial read-only verification agents reducing hallucinated fixes.',
		license: 'MIT',
		maturity: 'emerging',
		benchmarksOrEvidenceCount: 3,
		requiresNewRuntimeDependency: false,
	},
	{
		name: 'WASM / Component Model Polyglot Sandboxing',
		domain: 'languages-frameworks',
		summary: 'Portable low-overhead sandboxing for untrusted plugin & test execution across languages.',
		license: 'Apache-2.0',
		maturity: 'emerging',
		benchmarksOrEvidenceCount: 3,
		requiresNewRuntimeDependency: true,
	},
	{
		name: 'Hardware-in-the-Loop (HIL) & Embedded Serial/JTAG Test Bench',
		domain: 'hardware-embedded',
		summary: 'Automated flashing, serial telemetry capture, and GDB/OpenOCD debugging for MCU/robotics boards.',
		license: 'Apache-2.0',
		maturity: 'production-proven',
		benchmarksOrEvidenceCount: 3,
		requiresNewRuntimeDependency: true,
		requiresSpecialHardware: true,
	},
	{
		name: 'Unverified Autonomous "Zero-Config AGI Self-Rewriting Kernel"',
		domain: 'kodia-self-improvement',
		summary: 'Marketing buzzword claim promising self-rewriting code without tests, proofs, or human oversight.',
		license: 'Unknown',
		maturity: 'experimental',
		benchmarksOrEvidenceCount: 0,
		requiresNewRuntimeDependency: true,
		knownSecurityConcerns: ['Unbounded self-modification without deterministic verification or rollback'],
	},
	{
		name: 'Proprietary AGPL-3.0 Closed-Telemetry Scanner Wrapper',
		domain: 'developer-workflows',
		summary: 'Third-party scanner requiring AGPL-3.0 copyleft viral linking and mandatory cloud telemetry.',
		license: 'AGPL-3.0',
		maturity: 'emerging',
		benchmarksOrEvidenceCount: 1,
		requiresNewRuntimeDependency: true,
		knownSecurityConcerns: ['Mandatory outbound source-code telemetry'],
	},
];

export function evaluateTechnologyForEvolution(input: TechnologyEvaluationInput): TechnologyEvaluationResult {
	const rationale: string[] = [];
	const licenseRisk = classifyLicenseRisk(input.license);
	const licenseCompatible = licenseRisk === 'permissive' || licenseRisk === 'weak_copyleft';
	const licenseNote = licenseCompatible
		? `License "${input.license}" (${licenseRisk}) is compatible with Kodia's permissive architecture.`
		: `License "${input.license ?? 'unspecified'}" (${licenseRisk}) requires legal clearance and cannot be integrated automatically.`;

	let signalScore = 50;
	let hypeRiskScore = 25;

	if (input.maturity === 'production-proven') { signalScore += 28; hypeRiskScore -= 15; rationale.push('Production-proven engineering maturity.'); }
	else if (input.maturity === 'emerging') { signalScore += 10; hypeRiskScore += 10; rationale.push('Emerging capability — monitor adoption and stability.'); }
	else if (input.maturity === 'experimental') { signalScore -= 22; hypeRiskScore += 38; rationale.push('Experimental maturity with elevated hype/churn risk.'); }
	else { signalScore -= 30; hypeRiskScore += 20; rationale.push('Declining ecosystem trajectory.'); }

	const evCount = input.benchmarksOrEvidenceCount ?? 0;
	if (evCount >= 3) { signalScore += 15; hypeRiskScore -= 10; rationale.push(`Backed by ${evCount} verifiable benchmarks/production references.`); }
	else if (evCount === 0) { signalScore -= 20; hypeRiskScore += 30; rationale.push('Zero independent benchmarks or verifiable evidence provided.'); }

	if (input.requiresNewRuntimeDependency) { signalScore -= 5; rationale.push('Requires explicit dependency & supply-chain approval (never auto-installed).'); }
	if (input.requiresSpecialHardware) { signalScore -= 10; rationale.push('Requires physical hardware/HIL bench availability; gate behind real device detection.'); }
	if (input.overlapsExistingKodiaCapability) { signalScore -= 25; rationale.push(`Overlaps existing Kodia subsystem: ${input.overlapsExistingKodiaCapability} — extend instead of duplicating.`); }
	if (input.knownSecurityConcerns?.length) {
		signalScore -= 25;
		hypeRiskScore += 20;
		rationale.push(`Security concerns identified: ${input.knownSecurityConcerns.join('; ')}`);
	}
	if (!licenseCompatible) {
		rationale.push(licenseNote);
	}

	signalScore = Math.max(0, Math.min(100, signalScore));
	hypeRiskScore = Math.max(0, Math.min(100, hypeRiskScore));

	let verdict: EvolutionVerdict;
	let recommendedAction: string;
	if (!licenseCompatible && (licenseRisk === 'strong_copyleft' || licenseRisk === 'proprietary')) {
		verdict = 'REJECT_INCOMPATIBLE';
		recommendedAction = 'Do NOT integrate — license conflicts with Kodia distribution model.';
	} else if (hypeRiskScore >= 65 || (evCount === 0 && input.maturity === 'experimental')) {
		verdict = 'REJECT_HYPE';
		recommendedAction = 'Reject hype — lacks verifiable engineering evidence and carries high reliability/security risk.';
	} else if (input.overlapsExistingKodiaCapability || input.requiresSpecialHardware) {
		verdict = 'MONITOR';
		recommendedAction = input.requiresSpecialHardware
			? 'Monitor until target hardware/device bench is attached; provide optional plugin hook rather than mandatory dependency.'
			: `Extend existing ${input.overlapsExistingKodiaCapability} instead of building a duplicate subsystem.`;
	} else if (signalScore >= 70 && licenseCompatible) {
		verdict = 'ADOPT_CANDIDATE';
		recommendedAction = 'Record as governed Evolution Proposal and require explicit user approval + Independent Verification before integration.';
	} else {
		verdict = 'DEFER';
		recommendedAction = 'Defer and re-evaluate on next scheduled Capability Evolution Radar cycle.';
	}

	return {
		id: `eval-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
		evaluatedAt: new Date().toISOString(),
		name: input.name,
		domain: input.domain,
		signalScore,
		hypeRiskScore,
		licenseCompatible,
		licenseNote,
		verdict,
		autoInstallAllowed: false,
		rationale,
		recommendedAction,
	};
}

export function runCapabilityEvolutionRadar(opts: {
	workspaceEcosystems: readonly string[];
	kodiaCapabilitiesCount: number;
	additionalCandidates?: readonly TechnologyEvaluationInput[];
	auditIntervalHours?: number;
}): CapabilityRadarReport {
	const allInputs = [...BUILTIN_EVOLUTION_RADAR_CANDIDATES, ...(opts.additionalCandidates ?? [])];
	const evaluations = allInputs.map(evaluateTechnologyForEvolution);
	const topAdoptionCandidates = evaluations.filter(e => e.verdict === 'ADOPT_CANDIDATE').map(e => `${e.name} (signal=${e.signalScore})`);
	const rejectedAsHypeOrIncompatible = evaluations.filter(e => e.verdict === 'REJECT_HYPE' || e.verdict === 'REJECT_INCOMPATIBLE').map(e => `${e.name} [${e.verdict}]`);
	const intervalMs = Math.max(1, opts.auditIntervalHours ?? 168) * 3600_000;
	const nextRecommendedAuditAt = new Date(Date.now() + intervalMs).toISOString();

	return {
		id: `radar-${Date.now().toString(36)}`,
		auditedAt: new Date().toISOString(),
		workspaceEcosystems: [...opts.workspaceEcosystems],
		kodiaCapabilitiesAudited: opts.kodiaCapabilitiesCount,
		evaluations,
		topAdoptionCandidates,
		rejectedAsHypeOrIncompatible,
		nextRecommendedAuditAt,
		summary: `Capability Evolution Radar: evaluated ${evaluations.length} candidates across 9 domains — ${topAdoptionCandidates.length} adoption candidate(s), ${rejectedAsHypeOrIncompatible.length} rejected as hype/incompatible (autoInstallAllowed=false).`,
	};
}
