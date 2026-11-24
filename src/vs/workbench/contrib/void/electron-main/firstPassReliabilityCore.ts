/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import * as cp from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ScannedSourceFile } from '../common/projectHealth.js';
import {
	EricRecordLessonResult,
	FpereArchitectureReport,
	FpereBlueprint,
	FpereCheckpointKind,
	FpereCoordinationResult,
	FpereEvent,
	FpereImportExportReport,
	FpereIntegrationReport,
	FpereLiveSnapshot,
	FpereOwnershipLease,
	FpereQualityGateReport,
	FpereRepairPlan,
	IKodiaFirstPassReliabilityMainService,
} from '../common/firstPassReliabilityTypes.js';
import {
	analyzeRepositoryArchitecture,
	classifyRootCauseForRepair,
	computeQualityGateStage,
	evaluateTaskDagReadiness,
	validateFullStackIntegration,
	validateImportsAndExports,
} from '../common/firstPassReliabilityEngine.js';
import type {
	EricApiVerificationReport,
	EricApproachEvaluation,
	EricApproachOption,
	EricBehavioralSpec,
	EricEngineeringDomain,
	EricFailureCategory,
	EricFailureLesson,
	EricIndependentReviewReport,
	EricSemanticReport,
} from '../common/engineeringReasoningTypes.js';
import {
	analyzeSemanticCorrectness as analyzeSemanticCorrectnessEngine,
	buildIndependentEngineeringReview,
	evaluateTechnicalApproaches,
	extractExportedMembersFromDeclarationText,
	InstalledPackageDeclarationInfo,
	verifyApiUsageAgainstDeclarations,
} from '../common/engineeringReasoningEngine.js';
import { DiagnosticReliabilityCoreService } from './diagnosticReliabilityCore.js';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.kodia', '__pycache__', '.venv', 'venv', 'target', 'vendor', '.turbo', '.cache']);
const MAX_SCAN_FILES = 350;
const MAX_FILE_BYTES = 180_000;

function scanWorkspaceSourceFiles(workspaceRoot: string, maxFiles = MAX_SCAN_FILES): ScannedSourceFile[] {
	const results: ScannedSourceFile[] = [];
	if (!workspaceRoot || !fs.existsSync(workspaceRoot)) return results;

	const visit = (dir: string, depth: number) => {
		if (results.length >= maxFiles || depth > 7) return;
		let entries: fs.Dirent[];
		try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
		for (const e of entries) {
			if (results.length >= maxFiles) break;
			if (e.isDirectory()) {
				if (!SKIP_DIRS.has(e.name)) visit(path.join(dir, e.name), depth + 1);
			} else if (e.isFile()) {
				const abs = path.join(dir, e.name);
				const rel = path.relative(workspaceRoot, abs).replace(/\\/g, '/');
				if (!/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|py|php|go|rs|dart|kt|kts|swift|java|cs|json|sql|prisma|toml|yaml|yml|txt|example|sample|template|env)$/i.test(e.name)) {
					continue;
				}
				try {
					const stat = fs.statSync(abs);
					if (stat.size > MAX_FILE_BYTES) continue;
					const content = fs.readFileSync(abs, 'utf8');
					results.push({ relativePath: rel, content });
				} catch { /* skip unreadable */ }
			}
		}
	};

	visit(workspaceRoot, 0);
	return results;
}

function resolveDtsEntryFromPackageJson(pkgDir: string, pkgJson: Record<string, unknown>): string | undefined {
	const candidates: string[] = [];
	if (typeof pkgJson.types === 'string') candidates.push(pkgJson.types);
	if (typeof pkgJson.typings === 'string') candidates.push(pkgJson.typings);
	const exportsField = pkgJson.exports as Record<string, unknown> | undefined;
	if (exportsField && typeof exportsField === 'object') {
		const rootExport = (exportsField['.'] ?? exportsField) as Record<string, unknown> | undefined;
		if (rootExport && typeof rootExport === 'object') {
			if (typeof rootExport.types === 'string') candidates.push(rootExport.types);
			const imp = rootExport.import as Record<string, unknown> | undefined;
			if (imp && typeof imp.types === 'string') candidates.push(imp.types);
			const def = rootExport.default as Record<string, unknown> | undefined;
			if (def && typeof def.types === 'string') candidates.push(def.types);
		}
	}
	candidates.push('index.d.ts', 'dist/index.d.ts', 'lib/index.d.ts');
	for (const c of candidates) {
		const full = path.resolve(pkgDir, c);
		if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
	}
	return undefined;
}

function inspectInstalledNodePackages(workspaceRoot: string): Map<string, InstalledPackageDeclarationInfo> {
	const map = new Map<string, InstalledPackageDeclarationInfo>();
	if (!workspaceRoot) return map;
	const rootPkgPath = path.join(workspaceRoot, 'package.json');
	if (!fs.existsSync(rootPkgPath)) return map;
	let rootPkg: Record<string, unknown>;
	try { rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8')); } catch { return map; }

	const depNames = new Set<string>([
		...Object.keys((rootPkg.dependencies as Record<string, string>) ?? {}),
		...Object.keys((rootPkg.devDependencies as Record<string, string>) ?? {}),
	]);

	for (const pkgName of depNames) {
		if (pkgName.startsWith('@types/')) continue;
		const pkgDir = path.join(workspaceRoot, 'node_modules', ...pkgName.split('/'));
		const pkgJsonPath = path.join(pkgDir, 'package.json');
		if (!fs.existsSync(pkgJsonPath)) continue;
		try {
			const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')) as Record<string, unknown>;
			const version = typeof pkgJson.version === 'string' ? pkgJson.version : 'unknown';
			let dtsPath = resolveDtsEntryFromPackageJson(pkgDir, pkgJson);
			if (!dtsPath) {
				const atTypesName = pkgName.startsWith('@') ? pkgName.slice(1).replace('/', '__') : pkgName;
				const typesDir = path.join(workspaceRoot, 'node_modules', '@types', atTypesName);
				const typesPkgJsonPath = path.join(typesDir, 'package.json');
				if (fs.existsSync(typesPkgJsonPath)) {
					const typesPkg = JSON.parse(fs.readFileSync(typesPkgJsonPath, 'utf8')) as Record<string, unknown>;
					dtsPath = resolveDtsEntryFromPackageJson(typesDir, typesPkg);
				} else if (fs.existsSync(path.join(typesDir, 'index.d.ts'))) {
					dtsPath = path.join(typesDir, 'index.d.ts');
				}
			}
			if (!dtsPath) continue;
			const stat = fs.statSync(dtsPath);
			if (stat.size > 400_000) continue;
			const dtsContent = fs.readFileSync(dtsPath, 'utf8');
			const exportedMembers = extractExportedMembersFromDeclarationText(dtsContent);
			if (exportedMembers.size > 0) {
				map.set(pkgName, {
					packageName: pkgName,
					version,
					declarationSource: path.relative(workspaceRoot, dtsPath).replace(/\\/g, '/'),
					exportedMembers,
				});
			}
		} catch { /* skip unreadable package */ }
	}
	return map;
}

function runShellCommand(command: string, cwd: string, timeoutMs = 30_000): Promise<{ ok: boolean; exitCode: number; output: string }> {
	return new Promise(resolve => {
		let stdout = '';
		let stderr = '';
		let timedOut = false;
		const proc = cp.spawn(command, { cwd, shell: true, windowsHide: true });
		const timer = setTimeout(() => {
			timedOut = true;
			try {
				if (process.platform === 'win32' && proc.pid) {
					cp.spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true, timeout: 3000 });
				} else {
					proc.kill('SIGKILL');
				}
			} catch { /* ignore */ }
		}, timeoutMs);
		proc.stdout?.on('data', d => { stdout += String(d); });
		proc.stderr?.on('data', d => { stderr += String(d); });
		proc.on('close', code => {
			clearTimeout(timer);
			const out = `${stdout}\n${stderr}`.trim().slice(0, 4000);
			resolve({ ok: !timedOut && code === 0, exitCode: code ?? 1, output: timedOut ? `Timed out after ${timeoutMs}ms\n${out}` : out });
		});
		proc.on('error', err => {
			clearTimeout(timer);
			resolve({ ok: false, exitCode: 1, output: err.message });
		});
	});
}

export class FirstPassReliabilityCoreService extends Disposable implements IKodiaFirstPassReliabilityMainService {
	readonly _serviceBrand: undefined;

	private readonly _onDidEmitEvent = this._register(new Emitter<FpereEvent>());
	readonly onDidEmitEvent = this._onDidEmitEvent.event;

	private readonly _onDidChangeSnapshot = this._register(new Emitter<FpereLiveSnapshot>());
	readonly onDidChangeSnapshot = this._onDidChangeSnapshot.event;

	private readonly _kdre: DiagnosticReliabilityCoreService;
	private _seq = 0;
	private _snapshots = new Map<string, FpereLiveSnapshot>();
	private _leases = new Map<string, FpereOwnershipLease[]>();
	private _repairCounts = new Map<string, number>();

	constructor(kdre?: DiagnosticReliabilityCoreService) {
		super();
		this._kdre = kdre ?? this._register(new DiagnosticReliabilityCoreService());
	}

	private _fpereDir(workspaceRoot: string): string {
		const dir = path.join(workspaceRoot, '.kodia', 'fpere');
		fs.mkdirSync(dir, { recursive: true });
		return dir;
	}

	private _persistJson(workspaceRoot: string, fileName: string, data: unknown): void {
		if (!workspaceRoot || !fs.existsSync(workspaceRoot)) return;
		try {
			fs.writeFileSync(path.join(this._fpereDir(workspaceRoot), fileName), JSON.stringify(data, null, 2), 'utf8');
		} catch { /* non-fatal */ }
	}

	private _readJson<T>(workspaceRoot: string, fileName: string): T | undefined {
		if (!workspaceRoot) return undefined;
		const fp = path.join(workspaceRoot, '.kodia', 'fpere', fileName);
		if (!fs.existsSync(fp)) return undefined;
		try { return JSON.parse(fs.readFileSync(fp, 'utf8')) as T; } catch { return undefined; }
	}

	private _getOrInit(workspaceRoot: string): FpereLiveSnapshot {
		const existing = this._snapshots.get(workspaceRoot);
		if (existing) return existing;
		const blueprint = this._readJson<FpereBlueprint>(workspaceRoot, 'blueprint.json');
		const architecture = this._readJson<FpereArchitectureReport>(workspaceRoot, 'architecture-memory.json');
		const behavioralSpec = this._readJson<EricBehavioralSpec>(workspaceRoot, 'behavioral-spec.json');
		const decisions = this._readJson<EricApproachEvaluation[]>(workspaceRoot, 'decisions.json') ?? [];
		const lastIndependentReview = this._readJson<EricIndependentReviewReport>(workspaceRoot, 'last-review.json');
		const lessons = this._readJson<EricFailureLesson[]>(workspaceRoot, 'engineering-lessons.json') ?? [];
		const snap: FpereLiveSnapshot = {
			workspaceRoot,
			updatedAtMs: Date.now(),
			currentPhase: blueprint ? 'implementing' : 'analyzing',
			currentStage: 'implemented',
			blueprint,
			architecture,
			activeLeases: this._leases.get(workspaceRoot) ?? [],
			repairHistory: [],
			recentEvents: [],
			behavioralSpec,
			lastApproachEvaluation: decisions[0],
			lastIndependentReview,
			engineeringLessonsCount: lessons.length,
		};
		this._snapshots.set(workspaceRoot, snap);
		return snap;
	}

	private _emit(
		workspaceRoot: string,
		type: FpereEvent['type'],
		phase: FpereEvent['phase'],
		message: string,
		severity: FpereEvent['severity'] = 'info',
		patch?: Partial<FpereLiveSnapshot>,
	): FpereLiveSnapshot {
		const cur = this._getOrInit(workspaceRoot);
		const ev: FpereEvent = {
			eventId: `fpere-ev-${++this._seq}-${Date.now()}`,
			sequence: this._seq,
			timestampMs: Date.now(),
			type,
			phase,
			message,
			severity,
		};
		const recentEvents = [ev, ...cur.recentEvents].slice(0, 40);
		const next: FpereLiveSnapshot = {
			...cur,
			...patch,
			updatedAtMs: Date.now(),
			currentPhase: phase,
			activeLeases: this._leases.get(workspaceRoot) ?? [],
			recentEvents,
		};
		this._snapshots.set(workspaceRoot, next);
		this._onDidEmitEvent.fire(ev);
		this._onDidChangeSnapshot.fire(next);
		return next;
	}

	async getSnapshot(workspaceRoot: string): Promise<FpereLiveSnapshot> {
		return this._getOrInit(workspaceRoot);
	}

	async analyzeArchitecture(workspaceRoot: string): Promise<FpereArchitectureReport> {
		const files = scanWorkspaceSourceFiles(workspaceRoot);
		const report = analyzeRepositoryArchitecture(workspaceRoot, files);
		this._persistJson(workspaceRoot, 'architecture-memory.json', report);
		this._emit(workspaceRoot, 'architecture_analyzed', 'analyzing', report.summary, 'success', { architecture: report });
		return report;
	}

	async saveBlueprint(
		workspaceRoot: string,
		input: Omit<FpereBlueprint, 'id' | 'createdAtMs' | 'updatedAtMs'> & { id?: string },
	): Promise<FpereBlueprint> {
		const existing = this._getOrInit(workspaceRoot).blueprint;
		const now = Date.now();
		const blueprint: FpereBlueprint = {
			...input,
			id: input.id ?? existing?.id ?? `bp-${crypto.randomBytes(4).toString('hex')}`,
			createdAtMs: existing?.createdAtMs ?? now,
			updatedAtMs: now,
		};
		this._persistJson(workspaceRoot, 'blueprint.json', blueprint);
		this._emit(
			workspaceRoot,
			'blueprint_created',
			'planning',
			`Blueprint "${blueprint.title}" saved (${blueprint.apiContracts.length} API contracts, ${blueprint.dbModels.length} DB models, ${blueprint.tasks.length} DAG tasks)`,
			'success',
			{ blueprint },
		);
		return blueprint;
	}

	async validateImportsAndExports(workspaceRoot: string, targetFiles?: readonly string[]): Promise<FpereImportExportReport> {
		const files = scanWorkspaceSourceFiles(workspaceRoot);
		const report = validateImportsAndExports(workspaceRoot, files, targetFiles);
		this._emit(
			workspaceRoot,
			targetFiles?.length ? 'write_time_guard_triggered' : 'imports_validated',
			report.passed ? 'validating' : 'repairing',
			report.summary,
			report.passed ? 'success' : 'error',
			{ lastImportReport: report },
		);
		return report;
	}

	async checkFullStackIntegration(workspaceRoot: string, checkpoint: FpereCheckpointKind = 'full_stack_workflow'): Promise<FpereIntegrationReport> {
		const files = scanWorkspaceSourceFiles(workspaceRoot);
		const bp = this._getOrInit(workspaceRoot).blueprint;
		const report = validateFullStackIntegration(workspaceRoot, files, checkpoint, bp);
		this._persistJson(workspaceRoot, 'last-integration.json', report);
		this._emit(
			workspaceRoot,
			'integration_checkpoint',
			report.passed ? 'integrating' : 'repairing',
			report.summary,
			report.passed ? 'success' : 'error',
			{ lastIntegrationReport: report },
		);
		return report;
	}

	async runFirstPassQualityGate(
		workspaceRoot: string,
		opts?: { unitLabel?: string; targetFiles?: readonly string[]; checkpoint?: FpereCheckpointKind; runCompiler?: boolean; runTestCommand?: string; runBuildCommand?: string },
	): Promise<FpereQualityGateReport> {
		const unitLabel = opts?.unitLabel ?? 'Workspace Unit';
		const files = scanWorkspaceSourceFiles(workspaceRoot);
		const bp = this._getOrInit(workspaceRoot).blueprint;

		const importExportReport = validateImportsAndExports(workspaceRoot, files, opts?.targetFiles);
		const integrationReport = validateFullStackIntegration(workspaceRoot, files, opts?.checkpoint ?? 'full_stack_workflow', bp);

		const checks: { name: string; executed: boolean; passed: boolean; detail: string }[] = [
			{
				name: 'Import/Export & Code Hygiene',
				executed: true,
				passed: importExportReport.passed,
				detail: importExportReport.summary,
			},
			{
				name: `Full-Stack Integration (${opts?.checkpoint ?? 'full_stack_workflow'})`,
				executed: true,
				passed: integrationReport.passed,
				detail: integrationReport.summary,
			},
		];

		let compilerRan = false;
		let compilerPassed = true;
		let compilerErrors = 0;
		const blockingIssues = [
			...importExportReport.issues.filter(i => i.severity === 'error'),
			...integrationReport.issues.filter(i => i.severity === 'error'),
		];

		if (opts?.runCompiler !== false) {
			const comp = await this._kdre.runIndependentVerification(workspaceRoot, { targetFiles: opts?.targetFiles });
			const availableRuns = comp.runs.filter(r => r.available);
			compilerRan = availableRuns.length > 0;
			compilerPassed = comp.passed;
			compilerErrors = comp.totalErrors;
			checks.push({
				name: 'Independent Compiler / Type Check',
				executed: compilerRan,
				passed: compilerRan ? compilerPassed : true,
				detail: comp.summary,
			});
			for (const run of availableRuns) {
				for (const d of run.diagnostics) {
					if (d.severity === 'error') {
						blockingIssues.push({
							id: `FPERE-CMP-${blockingIssues.length + 1}`,
							kind: 'syntax_or_type_error',
							severity: 'error',
							file: d.file,
							line: d.line,
							symbolOrTarget: d.code,
							message: `[${d.engine} ${d.code}] ${d.message}`,
							suggestedFix: `Fix ${d.code} at ${d.file}:${d.line}.`,
						});
					}
				}
			}
		}

		let testsRan = false;
		let testsPassed = false;
		const testCmd = opts?.runTestCommand ?? bp?.testCommand;
		if (testCmd) {
			testsRan = true;
			const tr = await runShellCommand(testCmd, workspaceRoot, 35_000);
			testsPassed = tr.ok;
			checks.push({
				name: `Tests (${testCmd})`,
				executed: true,
				passed: tr.ok,
				detail: tr.ok ? 'Test command passed (exit 0).' : `Test command failed (exit ${tr.exitCode}): ${tr.output.slice(0, 240)}`,
			});
		}

		let buildRan = false;
		let buildPassed = false;
		const buildCmd = opts?.runBuildCommand ?? bp?.buildCommand;
		if (buildCmd) {
			buildRan = true;
			const br = await runShellCommand(buildCmd, workspaceRoot, 45_000);
			buildPassed = br.ok;
			checks.push({
				name: `Build (${buildCmd})`,
				executed: true,
				passed: br.ok,
				detail: br.ok ? 'Build command passed (exit 0).' : `Build command failed (exit ${br.exitCode}): ${br.output.slice(0, 240)}`,
			});
		}

		const stage = computeQualityGateStage({
			importExportPassed: importExportReport.passed,
			integrationPassed: integrationReport.passed,
			compilerRan,
			compilerPassed,
			testsRan,
			testsPassed,
			buildRan,
			buildPassed,
		});
		const passed = stage !== 'failed' && stage !== 'blocked';

		const report: FpereQualityGateReport = {
			gateId: `gate-${crypto.randomBytes(4).toString('hex')}`,
			workspaceRoot,
			evaluatedAtMs: Date.now(),
			unitLabel,
			stage,
			passed,
			checks,
			importExportReport,
			integrationReport,
			compilerErrors,
			testPassed: testsRan ? testsPassed : undefined,
			buildPassed: buildRan ? buildPassed : undefined,
			blockingIssues,
			summary: passed
				? `Quality Gate PASSED for "${unitLabel}" — verified stage: ${stage}.`
				: `Quality Gate FAILED for "${unitLabel}" (${blockingIssues.length} blocking issue(s), stage: ${stage}).`,
		};

		this._persistJson(workspaceRoot, 'last-quality-gate.json', report);
		this._emit(
			workspaceRoot,
			'quality_gate_evaluated',
			passed ? 'verified' : 'repairing',
			report.summary,
			passed ? 'success' : 'error',
			{ currentStage: stage, lastQualityGate: report, lastImportReport: importExportReport, lastIntegrationReport: integrationReport },
		);
		return report;
	}

	async coordinateAgents(
		workspaceRoot: string,
		req: { action: 'acquire' | 'release' | 'status'; agentId?: string; taskId?: string; files?: readonly string[] },
	): Promise<FpereCoordinationResult> {
		const bp = this._getOrInit(workspaceRoot).blueprint;
		const dag = evaluateTaskDagReadiness(bp?.tasks ?? []);
		let leases = [...(this._leases.get(workspaceRoot) ?? [])];
		const conflicts: { file: string; heldByAgent: string; heldByTask: string }[] = [];
		let granted = true;
		let message = `Active leases: ${leases.length}; DAG ready: ${dag.readyTaskIds.length}, blocked: ${dag.blockedTaskIds.length}.`;

		if (req.action === 'acquire' && req.agentId && req.files?.length) {
			const normFiles = req.files.map(f => f.replace(/\\/g, '/').replace(/^\.\//, ''));
			// Reject acquisition if requested task is still blocked on prerequisite DAG dependencies
			if (req.taskId && dag.blockedTaskIds.includes(req.taskId)) {
				granted = false;
				message = `Task "${req.taskId}" is blocked waiting for prerequisite contract/dependency tasks in the Blueprint DAG.`;
			} else {
				for (const f of normFiles) {
					for (const lease of leases) {
						if (lease.agentId !== req.agentId && lease.files.includes(f)) {
							conflicts.push({ file: f, heldByAgent: lease.agentId, heldByTask: lease.taskId });
						}
					}
				}
				if (conflicts.length > 0) {
					granted = false;
					message = `File ownership conflict on ${conflicts.map(c => `${c.file} (held by ${c.heldByAgent})`).join(', ')}.`;
				} else {
					leases = leases.filter(l => !(l.agentId === req.agentId && l.taskId === (req.taskId ?? 'default')));
					leases.push({
						agentId: req.agentId,
						taskId: req.taskId ?? 'default',
						files: normFiles,
						acquiredAtMs: Date.now(),
					});
					this._leases.set(workspaceRoot, leases);
					message = `Granted exclusive ownership of ${normFiles.length} file(s) to agent "${req.agentId}".`;
				}
			}
			this._emit(workspaceRoot, 'agent_lease_updated', granted ? 'implementing' : 'blocked', message, granted ? 'info' : 'warning');
		} else if (req.action === 'release' && req.agentId) {
			leases = leases.filter(l => l.agentId !== req.agentId || (req.taskId && l.taskId !== req.taskId));
			this._leases.set(workspaceRoot, leases);
			message = `Released file ownership leases for agent "${req.agentId}".`;
			this._emit(workspaceRoot, 'agent_lease_updated', 'implementing', message, 'info');
		}

		return {
			granted,
			conflicts,
			readyTaskIds: dag.readyTaskIds,
			blockedTaskIds: dag.blockedTaskIds,
			activeLeases: leases,
			message,
		};
	}

	async planControlledRepair(
		workspaceRoot: string,
		req: { errorSummary: string; files?: readonly string[]; maxRetries?: number },
	): Promise<FpereRepairPlan> {
		const maxRetries = Math.max(1, Math.min(req.maxRetries ?? 3, 6));
		const key = `${workspaceRoot}::${(req.files ?? ['workspace']).join(',')}`;
		const attempt = (this._repairCounts.get(key) ?? 0) + 1;
		this._repairCounts.set(key, attempt);

		const plan = classifyRootCauseForRepair(req.errorSummary, attempt, maxRetries, req.files ?? []);
		const cur = this._getOrInit(workspaceRoot);
		const repairHistory = [plan, ...cur.repairHistory].slice(0, 20);
		this._emit(
			workspaceRoot,
			'repair_planned',
			plan.escalated ? 'blocked' : 'repairing',
			plan.rootCauseSummary,
			plan.escalated ? 'error' : 'warning',
			{ repairHistory, currentStage: plan.escalated ? 'blocked' : 'failed' },
		);
		return plan;
	}

	// ── ERIC (Engineering Reasoning & Technical Correctness) Implementation ────────────

	async saveBehavioralSpec(
		workspaceRoot: string,
		input: Omit<EricBehavioralSpec, 'id' | 'createdAtMs'> & { id?: string },
	): Promise<EricBehavioralSpec> {
		const spec: EricBehavioralSpec = {
			...input,
			id: input.id ?? `eric-spec-${crypto.randomBytes(4).toString('hex')}`,
			createdAtMs: Date.now(),
		};
		this._persistJson(workspaceRoot, 'behavioral-spec.json', spec);
		this._emit(
			workspaceRoot,
			'eric_spec_saved',
			'planning',
			`Behavioral spec "${spec.featureName}" saved (${spec.explicitRequirements.length} explicit reqs, ${spec.inferredAssumptions.length} assumptions, ${spec.acceptanceCriteria.length} criteria).`,
			'success',
			{ behavioralSpec: spec },
		);
		return spec;
	}

	async evaluateApproaches(
		workspaceRoot: string,
		req: { problem: string; domain: EricEngineeringDomain; options: readonly EricApproachOption[]; evidence?: readonly string[] },
	): Promise<EricApproachEvaluation> {
		const evaluation = evaluateTechnicalApproaches(req.problem, req.domain, req.options, req.evidence ?? []);
		const existing = this._readJson<EricApproachEvaluation[]>(workspaceRoot, 'decisions.json') ?? [];
		const updated = [evaluation, ...existing].slice(0, 30);
		this._persistJson(workspaceRoot, 'decisions.json', updated);
		this._emit(
			workspaceRoot,
			'eric_approach_evaluated',
			'planning',
			evaluation.rationale,
			'success',
			{ lastApproachEvaluation: evaluation },
		);
		return evaluation;
	}

	async verifyInstalledApiUsage(workspaceRoot: string): Promise<EricApiVerificationReport> {
		const files = scanWorkspaceSourceFiles(workspaceRoot);
		const installed = inspectInstalledNodePackages(workspaceRoot);
		const report = verifyApiUsageAgainstDeclarations(workspaceRoot, files, installed);
		this._emit(
			workspaceRoot,
			'eric_api_verified',
			report.passed ? 'validating' : 'repairing',
			report.summary,
			report.passed ? 'success' : 'error',
			{ lastApiVerification: report },
		);
		return report;
	}

	async analyzeSemanticCorrectness(workspaceRoot: string): Promise<EricSemanticReport> {
		const files = scanWorkspaceSourceFiles(workspaceRoot);
		const report = analyzeSemanticCorrectnessEngine(workspaceRoot, files);
		this._emit(
			workspaceRoot,
			'eric_semantics_analyzed',
			report.passed ? 'validating' : 'repairing',
			report.summary,
			report.passed ? 'success' : 'error',
			{ lastSemanticReport: report },
		);
		return report;
	}

	async runIndependentReview(workspaceRoot: string, opts?: { testCommand?: string }): Promise<EricIndependentReviewReport> {
		const files = scanWorkspaceSourceFiles(workspaceRoot);
		const semanticReport = analyzeSemanticCorrectnessEngine(workspaceRoot, files);
		const installed = inspectInstalledNodePackages(workspaceRoot);
		const apiVerificationReport = verifyApiUsageAgainstDeclarations(workspaceRoot, files, installed);
		const snap = this._getOrInit(workspaceRoot);
		const spec = snap.behavioralSpec ?? this._readJson<EricBehavioralSpec>(workspaceRoot, 'behavioral-spec.json');
		const lessons = this._readJson<EricFailureLesson[]>(workspaceRoot, 'engineering-lessons.json') ?? [];

		const toolsUsed: string[] = ['eric_analyze_semantics', 'eric_verify_api_usage'];
		const testsPassed: string[] = [];
		const testsFailed: string[] = [];
		const whatRemainsUnverified: string[] = [];

		const testCmd = opts?.testCommand ?? snap.blueprint?.testCommand;
		if (testCmd) {
			toolsUsed.push(`test_command:${testCmd}`);
			const tr = await runShellCommand(testCmd, workspaceRoot, 35_000);
			if (tr.ok) {
				testsPassed.push(`${testCmd} (exit 0)`);
			} else {
				testsFailed.push(`${testCmd} (exit ${tr.exitCode}): ${tr.output.slice(0, 200)}`);
			}
		}

		const activeDomains = new Set(semanticReport.domainsCovered);
		const relevantPastLessons = lessons.filter(l => l.verifiedFix && (activeDomains.has(l.domain) || l.domain === 'general')).slice(0, 8);

		const review = buildIndependentEngineeringReview({
			workspaceRoot,
			semanticReport,
			apiVerificationReport,
			spec,
			testsPassed,
			testsFailed,
			toolsUsed,
			whatRemainsUnverified,
			relevantPastLessons,
		});

		this._persistJson(workspaceRoot, 'last-review.json', review);
		this._emit(
			workspaceRoot,
			'eric_review_completed',
			review.verdict === 'verified_with_evidence' ? 'verified' : review.verdict === 'needs_fixes' ? 'repairing' : 'validating',
			review.summary,
			review.verdict === 'verified_with_evidence' ? 'success' : review.verdict === 'needs_fixes' ? 'error' : 'warning',
			{ lastSemanticReport: semanticReport, lastApiVerification: apiVerificationReport, lastIndependentReview: review },
		);
		return review;
	}

	async recordFailureLesson(workspaceRoot: string, req: {
		category: EricFailureCategory;
		domain: EricEngineeringDomain;
		technology: string;
		symptom: string;
		rootCause: string;
		verifiedFixPattern: string;
		verificationEvidence: string;
		verifiedFix: boolean;
	}): Promise<EricRecordLessonResult> {
		const existing = this._readJson<EricFailureLesson[]>(workspaceRoot, 'engineering-lessons.json') ?? [];
		if (!req.verifiedFix || !req.verificationEvidence.trim()) {
			return {
				recorded: false,
				reason: 'Refused to persist unverified failure lesson: verifiedFix must be true and concrete verificationEvidence must be provided.',
				totalLessons: existing.length,
			};
		}

		const normalizedKey = `${req.category}::${req.technology.toLowerCase()}::${req.rootCause.toLowerCase().slice(0, 80)}`;
		const matchIdx = existing.findIndex(l => `${l.category}::${l.technology.toLowerCase()}::${l.rootCause.toLowerCase().slice(0, 80)}` === normalizedKey);
		let saved: EricFailureLesson;
		let updated: EricFailureLesson[];
		if (matchIdx >= 0) {
			const prev = existing[matchIdx];
			saved = {
				...prev,
				symptom: req.symptom,
				verifiedFixPattern: req.verifiedFixPattern,
				verificationEvidence: req.verificationEvidence,
				recordedAtMs: Date.now(),
				occurrences: prev.occurrences + 1,
			};
			updated = [...existing];
			updated[matchIdx] = saved;
		} else {
			saved = {
				id: `eric-les-${crypto.randomBytes(4).toString('hex')}`,
				category: req.category,
				domain: req.domain,
				technology: req.technology,
				symptom: req.symptom,
				rootCause: req.rootCause,
				verifiedFixPattern: req.verifiedFixPattern,
				verificationEvidence: req.verificationEvidence,
				verifiedFix: true,
				recordedAtMs: Date.now(),
				occurrences: 1,
			};
			updated = [saved, ...existing].slice(0, 100);
		}

		this._persistJson(workspaceRoot, 'engineering-lessons.json', updated);
		this._emit(
			workspaceRoot,
			'eric_lesson_recorded',
			'verified',
			`Recorded verified engineering lesson [${saved.category}] for ${saved.technology} (occurrences: ${saved.occurrences}).`,
			'info',
			{ engineeringLessonsCount: updated.length },
		);
		return {
			recorded: true,
			reason: `Persisted verified engineering lesson ${saved.id} to .kodia/fpere/engineering-lessons.json.`,
			lesson: saved,
			totalLessons: updated.length,
		};
	}
}
