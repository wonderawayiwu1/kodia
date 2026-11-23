/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from '../../../../base/common/path.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ScannedSourceFile } from '../common/projectHealth.js';
import {
	analyzeIacAndFinOps,
	analyzePrivacyCompliance,
	analyzeProductionIncidentLogs,
	analyzeSupplyChainWorkspace,
	buildAutonomousReleasePlan,
	evaluateTechnologyForEvolution,
	planLegacyModernization,
	runCapabilityEvolutionRadar,
} from '../common/evolutionEngine.js';
import {
	CapabilityRadarReport,
	EvolutionDomain,
	EvolutionLiveEvent,
	EvolutionLiveEventType,
	EvolutionProposal,
	EvolutionVerdict,
	EvolutionWorkspaceSnapshot,
	IacFinOpsReport,
	IKodiaEvolutionMainService,
	IncidentForensicsReport,
	LegacyModernizationReport,
	PrivacyComplianceReport,
	ReleasePlanReport,
	SupplyChainAuditReport,
	SupplyChainFinding,
	TechnologyEvaluationInput,
	TechnologyEvaluationResult,
} from '../common/evolutionTypes.js';

const EVOLUTION_DIR = path.join('.kodia', 'evolution');
const MAX_RING_EVENTS = 300;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.kodia', '__pycache__', 'target', 'vendor']);

function runExec(bin: string, args: string[], cwd: string, timeoutMs = 15_000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
	return new Promise(resolve => {
		try {
			cp.execFile(bin, args, { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
				resolve({
					ok: !err,
					stdout: String(stdout ?? ''),
					stderr: String(stderr ?? (err?.message ?? '')),
				});
			});
		} catch (e) {
			resolve({ ok: false, stdout: '', stderr: e instanceof Error ? e.message : String(e) });
		}
	});
}

function scanWorkspaceFiles(root: string, maxFiles = 300, maxBytesPerFile = 180_000): ScannedSourceFile[] {
	const results: ScannedSourceFile[] = [];
	if (!root || !fs.existsSync(root)) { return results; }

	const visit = (dir: string) => {
		if (results.length >= maxFiles) { return; }
		let entries: fs.Dirent[];
		try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
		for (const e of entries) {
			if (results.length >= maxFiles) { break; }
			if (e.isDirectory()) {
				if (SKIP_DIRS.has(e.name)) { continue; }
				// Keep .github/workflows for CI/CD IaC auditing!
				if (e.name.startsWith('.') && e.name !== '.github') { continue; }
				visit(path.join(dir, e.name));
			} else if (e.isFile()) {
				const abs = path.join(dir, e.name);
				const rel = path.relative(root, abs).replace(/\\/g, '/');
				const keep = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|php|sql|prisma|tf|ya?ml|json|toml|txt|mod)$/i.test(e.name)
					|| /^dockerfile/i.test(e.name);
				if (!keep) { continue; }
				try {
					const st = fs.statSync(abs);
					if (st.size > maxBytesPerFile && e.name !== 'package-lock.json') { continue; }
					const content = fs.readFileSync(abs, 'utf8').slice(0, maxBytesPerFile);
					results.push({ relativePath: rel, content });
				} catch { /* ignore unreadable */ }
			}
		}
	};
	visit(root);
	return results;
}

export class KodiaEvolutionMainService extends Disposable implements IKodiaEvolutionMainService {
	readonly _serviceBrand: undefined;

	private readonly _onDidEmitEvent = this._register(new Emitter<EvolutionLiveEvent>());
	readonly onDidEmitEvent: Event<EvolutionLiveEvent> = this._onDidEmitEvent.event;

	private _seq = 0;
	private _recentEvents: EvolutionLiveEvent[] = [];

	private _emit(type: EvolutionLiveEventType, message: string, extra?: { ok?: boolean; durationMs?: number }): void {
		const seq = ++this._seq;
		const ev: EvolutionLiveEvent = {
			seq,
			eventId: `eev-${seq}-${Date.now().toString(36)}`,
			timestamp: new Date().toISOString(),
			type,
			message,
			...extra,
		};
		this._recentEvents.push(ev);
		if (this._recentEvents.length > MAX_RING_EVENTS) {
			this._recentEvents = this._recentEvents.slice(-MAX_RING_EVENTS);
		}
		this._onDidEmitEvent.fire(ev);
	}

	private _ensureDir(workspaceRoot: string): string {
		const dir = path.join(workspaceRoot, EVOLUTION_DIR);
		fs.mkdirSync(dir, { recursive: true });
		return dir;
	}

	private _readJson<T>(workspaceRoot: string, fileName: string, fallback: T): T {
		if (!workspaceRoot) { return fallback; }
		const fp = path.join(workspaceRoot, EVOLUTION_DIR, fileName);
		if (!fs.existsSync(fp)) { return fallback; }
		try { return JSON.parse(fs.readFileSync(fp, 'utf8')) as T; } catch { return fallback; }
	}

	private _writeJson(workspaceRoot: string, fileName: string, data: unknown): string {
		if (!workspaceRoot) { return ''; }
		const dir = this._ensureDir(workspaceRoot);
		const fp = path.join(dir, fileName);
		fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf8');
		return fp;
	}

	async getRecentEvents(limit = 150): Promise<EvolutionLiveEvent[]> {
		return this._recentEvents.slice(-Math.max(1, Math.min(MAX_RING_EVENTS, limit)));
	}

	async loadWorkspaceSnapshot(workspaceRoot: string): Promise<EvolutionWorkspaceSnapshot> {
		return {
			supplyChainReports: this._readJson<SupplyChainAuditReport[]>(workspaceRoot, 'supply-chain.json', []),
			iacFinOpsReports: this._readJson<IacFinOpsReport[]>(workspaceRoot, 'iac-finops.json', []),
			incidentReports: this._readJson<IncidentForensicsReport[]>(workspaceRoot, 'incidents.json', []),
			releasePlans: this._readJson<ReleasePlanReport[]>(workspaceRoot, 'releases.json', []),
			privacyReports: this._readJson<PrivacyComplianceReport[]>(workspaceRoot, 'privacy.json', []),
			modernizationReports: this._readJson<LegacyModernizationReport[]>(workspaceRoot, 'modernization.json', []),
			radarReports: this._readJson<CapabilityRadarReport[]>(workspaceRoot, 'radar.json', []),
			proposals: this._readJson<EvolutionProposal[]>(workspaceRoot, 'proposals.json', []),
		};
	}

	async runSupplyChainAudit(workspaceRoot: string, opts?: {
		runLiveAudit?: boolean;
		blockCopyleft?: boolean;
	}): Promise<SupplyChainAuditReport> {
		const t0 = performance.now();
		const files = scanWorkspaceFiles(workspaceRoot, 250);
		const liveVulns: SupplyChainFinding[] = [];
		let liveAuditExecuted = false;
		let liveAuditNote = 'Static manifest & lockfile audit completed (live registry audit skipped or unavailable).';

		if (opts?.runLiveAudit && fs.existsSync(path.join(workspaceRoot, 'package-lock.json'))) {
			const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
			const res = await runExec(npmBin, ['audit', '--json', '--offline'], workspaceRoot, 12_000);
			try {
				const parsed = JSON.parse(res.stdout || '{}') as {
					vulnerabilities?: Record<string, { severity?: string; via?: unknown[] }>;
				};
				if (parsed.vulnerabilities) {
					liveAuditExecuted = true;
					liveAuditNote = 'Executed real `npm audit --json --offline` against package-lock.json.';
					for (const [pkg, info] of Object.entries(parsed.vulnerabilities)) {
						const sev = info.severity === 'critical' || info.severity === 'high' || info.severity === 'medium' ? info.severity : 'low';
						liveVulns.push({
							id: `SC-VULN-${liveVulns.length + 1}`,
							severity: sev,
							category: 'vulnerability',
							packageName: pkg,
							file: 'package-lock.json',
							title: `Advisory vulnerability in "${pkg}" (${sev})`,
							detail: `Reported by npm audit on workspace lockfile.`,
							remediation: `Upgrade "${pkg}" to a patched release and verify tests.`,
						});
					}
				}
			} catch {
				liveAuditNote = 'npm audit could not reach registry in offline/sandboxed environment; static SBOM & lockfile audit succeeded.';
			}
		}

		const base = analyzeSupplyChainWorkspace(files, {
			blockCopyleft: opts?.blockCopyleft,
			liveVulnerabilities: liveVulns,
			liveAuditExecuted,
			liveAuditNote,
		});
		const sbomPath = workspaceRoot ? this._writeJson(workspaceRoot, 'sbom.cdx.json', base.cyclonedxSbom) : undefined;
		const report: SupplyChainAuditReport = { ...base, sbomPath };

		if (workspaceRoot) {
			const prev = this._readJson<SupplyChainAuditReport[]>(workspaceRoot, 'supply-chain.json', []);
			this._writeJson(workspaceRoot, 'supply-chain.json', [report, ...prev].slice(0, 20));
		}
		this._emit('supply_chain_completed', report.summary, { ok: true, durationMs: Math.round(performance.now() - t0) });
		return report;
	}

	async runIacFinOpsAudit(workspaceRoot: string, opts?: {
		monthlyBudgetUsd?: number;
	}): Promise<IacFinOpsReport> {
		const t0 = performance.now();
		const files = scanWorkspaceFiles(workspaceRoot, 300);
		const report = analyzeIacAndFinOps(files, opts?.monthlyBudgetUsd ?? 500);
		if (workspaceRoot) {
			const prev = this._readJson<IacFinOpsReport[]>(workspaceRoot, 'iac-finops.json', []);
			this._writeJson(workspaceRoot, 'iac-finops.json', [report, ...prev].slice(0, 20));
		}
		this._emit('iac_finops_completed', report.summary, { ok: !report.budgetExceeded, durationMs: Math.round(performance.now() - t0) });
		return report;
	}

	async analyzeProductionIncident(workspaceRoot: string, opts: {
		serviceName: string;
		logText?: string;
		logFile?: string;
		sloTargetPct?: number;
		p95BudgetMs?: number;
	}): Promise<IncidentForensicsReport> {
		const t0 = performance.now();
		let logText = opts.logText ?? '';
		if (!logText && opts.logFile && workspaceRoot) {
			const abs = path.isAbsolute(opts.logFile) ? opts.logFile : path.join(workspaceRoot, opts.logFile);
			if (fs.existsSync(abs)) {
				logText = fs.readFileSync(abs, 'utf8').slice(0, 500_000);
			}
		}
		const report = analyzeProductionIncidentLogs({
			serviceName: opts.serviceName,
			logText,
			sloTargetPct: opts.sloTargetPct,
			p95BudgetMs: opts.p95BudgetMs,
		});
		if (workspaceRoot) {
			const prev = this._readJson<IncidentForensicsReport[]>(workspaceRoot, 'incidents.json', []);
			this._writeJson(workspaceRoot, 'incidents.json', [report, ...prev].slice(0, 25));
		}
		this._emit('incident_analyzed', report.summary, { ok: !report.sloBreached, durationMs: Math.round(performance.now() - t0) });
		return report;
	}

	async planAutonomousRelease(workspaceRoot: string, opts?: {
		sinceRef?: string;
		currentVersion?: string;
	}): Promise<ReleasePlanReport> {
		const t0 = performance.now();
		let currentVersion = opts?.currentVersion ?? '0.1.0';
		const pkgPath = path.join(workspaceRoot, 'package.json');
		if (!opts?.currentVersion && fs.existsSync(pkgPath)) {
			try {
				const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
				if (pkg.version) { currentVersion = pkg.version; }
			} catch { /* ignore */ }
		}

		const logArgs = opts?.sinceRef
			? ['log', `${opts.sinceRef}..HEAD`, '--pretty=format:%s', '-n', '50']
			: ['log', '--pretty=format:%s', '-n', '30'];
		const gitRes = await runExec('git', logArgs, workspaceRoot, 8_000);
		const commitSubjects = gitRes.ok
			? gitRes.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
			: [];

		const files = scanWorkspaceFiles(workspaceRoot, 250);
		const report = buildAutonomousReleasePlan({ currentVersion, commitSubjects, files });
		if (workspaceRoot) {
			const prev = this._readJson<ReleasePlanReport[]>(workspaceRoot, 'releases.json', []);
			this._writeJson(workspaceRoot, 'releases.json', [report, ...prev].slice(0, 20));
		}
		this._emit('release_planned', report.summary, { ok: report.releaseSafe, durationMs: Math.round(performance.now() - t0) });
		return report;
	}

	async auditPrivacyAndModernization(workspaceRoot: string, opts?: {
		subPath?: string;
	}): Promise<{ privacy: PrivacyComplianceReport; modernization: LegacyModernizationReport }> {
		const t0 = performance.now();
		const targetRoot = opts?.subPath ? path.join(workspaceRoot, opts.subPath) : workspaceRoot;
		const files = scanWorkspaceFiles(targetRoot, 300);
		const privacy = analyzePrivacyCompliance(files);
		const modernization = planLegacyModernization(files);

		if (workspaceRoot) {
			const prevP = this._readJson<PrivacyComplianceReport[]>(workspaceRoot, 'privacy.json', []);
			this._writeJson(workspaceRoot, 'privacy.json', [privacy, ...prevP].slice(0, 20));
			const prevM = this._readJson<LegacyModernizationReport[]>(workspaceRoot, 'modernization.json', []);
			this._writeJson(workspaceRoot, 'modernization.json', [modernization, ...prevM].slice(0, 20));
		}
		this._emit('privacy_audited', privacy.summary, { ok: privacy.findings.every(f => f.severity !== 'critical'), durationMs: Math.round(performance.now() - t0) });
		this._emit('modernization_planned', modernization.summary, { ok: true });
		return { privacy, modernization };
	}

	async runCapabilityEvolutionRadar(workspaceRoot: string, opts?: {
		additionalCandidates?: readonly TechnologyEvaluationInput[];
		auditIntervalHours?: number;
	}): Promise<CapabilityRadarReport> {
		const t0 = performance.now();
		const files = scanWorkspaceFiles(workspaceRoot, 150);
		const ecosystems = new Set<string>();
		for (const f of files) {
			const base = (f.relativePath.split('/').pop() ?? '').toLowerCase();
			if (base === 'package.json') { ecosystems.add('Node/TypeScript'); }
			if (base === 'requirements.txt' || base === 'pyproject.toml') { ecosystems.add('Python'); }
			if (base === 'go.mod') { ecosystems.add('Go'); }
			if (base === 'cargo.toml') { ecosystems.add('Rust'); }
			if (base === 'dockerfile' || base.endsWith('.tf')) { ecosystems.add('Cloud/IaC'); }
		}

		const report = runCapabilityEvolutionRadar({
			workspaceEcosystems: [...ecosystems],
			kodiaCapabilitiesCount: 15,
			additionalCandidates: opts?.additionalCandidates,
			auditIntervalHours: opts?.auditIntervalHours,
		});
		if (workspaceRoot) {
			const prev = this._readJson<CapabilityRadarReport[]>(workspaceRoot, 'radar.json', []);
			this._writeJson(workspaceRoot, 'radar.json', [report, ...prev].slice(0, 20));
		}
		this._emit('capability_radar_completed', report.summary, { ok: true, durationMs: Math.round(performance.now() - t0) });
		return report;
	}

	async evaluateTechnologyCandidate(workspaceRoot: string, input: TechnologyEvaluationInput): Promise<TechnologyEvaluationResult> {
		const result = evaluateTechnologyForEvolution(input);
		if (workspaceRoot && result.verdict === 'ADOPT_CANDIDATE') {
			await this.manageProposals(workspaceRoot, {
				action: 'add',
				title: result.name,
				domain: result.domain,
				verdict: result.verdict,
				signalScore: result.signalScore,
				justification: result.rationale.join(' '),
				acceptanceCriteria: [
					'Explicit user approval recorded (autoInstallAllowed=false).',
					'License & supply-chain SBOM verification passes.',
					'Independent Verification & zero-regression test suite passes.',
				],
			});
		}
		this._emit('technology_evaluated', `${result.name}: ${result.verdict} (signal=${result.signalScore}, hype=${result.hypeRiskScore})`, {
			ok: result.verdict !== 'REJECT_HYPE' && result.verdict !== 'REJECT_INCOMPATIBLE',
		});
		return result;
	}

	async manageProposals(workspaceRoot: string, opts: {
		action: 'list' | 'add' | 'update_status' | 'remove';
		id?: string;
		status?: EvolutionProposal['status'];
		title?: string;
		domain?: EvolutionDomain;
		verdict?: EvolutionVerdict;
		signalScore?: number;
		justification?: string;
		acceptanceCriteria?: readonly string[];
	}): Promise<EvolutionProposal[]> {
		let list = this._readJson<EvolutionProposal[]>(workspaceRoot, 'proposals.json', []);
		const now = new Date().toISOString();

		if (opts.action === 'add' && opts.title?.trim()) {
			const exists = list.some(p => p.title.toLowerCase() === opts.title!.trim().toLowerCase());
			if (!exists) {
				const item: EvolutionProposal = {
					id: `prop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
					createdAt: now,
					updatedAt: now,
					title: opts.title.trim(),
					domain: opts.domain ?? 'kodia-self-improvement',
					verdict: opts.verdict ?? 'ADOPT_CANDIDATE',
					signalScore: opts.signalScore ?? 75,
					status: 'proposed',
					autoInstallAllowed: false,
					justification: opts.justification?.trim() || 'Recorded via Kodia Continuous Capability Evolution Engine.',
					acceptanceCriteria: [...(opts.acceptanceCriteria ?? ['Requires explicit user approval & independent verification.'])],
				};
				list = [item, ...list].slice(0, 100);
				this._writeJson(workspaceRoot, 'proposals.json', list);
				this._emit('proposal_updated', `Added proposal: ${item.title} (autoInstallAllowed=false)`, { ok: true });
			}
		} else if (opts.action === 'update_status' && opts.id && opts.status) {
			list = list.map(p => p.id === opts.id ? { ...p, status: opts.status!, updatedAt: now } : p);
			this._writeJson(workspaceRoot, 'proposals.json', list);
			this._emit('proposal_updated', `Updated proposal ${opts.id} -> ${opts.status}`, { ok: true });
		} else if (opts.action === 'remove' && opts.id) {
			list = list.filter(p => p.id !== opts.id);
			this._writeJson(workspaceRoot, 'proposals.json', list);
			this._emit('proposal_updated', `Removed proposal ${opts.id}`, { ok: true });
		}

		return list;
	}
}
