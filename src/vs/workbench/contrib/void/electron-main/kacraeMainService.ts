/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * KACRAE — Main-Process Autonomous Code Review & Software Assurance Service
 *
 * Orchestrates:
 *  - Universal multi-scope reviews (file, selection, git staged/unstaged/commit/branch/PR, full repo)
 *  - Reuses Kodia's KodiaCorrectnessMainService (compilers, mutation testing, independent verification)
 *  - Streaming disk-backed incremental repository indexing & graph queries via KacraeRepoIndexer
 *  - Safe external analyzer adapter detection (tsc, node, python, eslint, semgrep, gitleaks, trivy, osv-scanner)
 *  - Local inference runtime detection (Ollama, LM Studio, vLLM)
 *  - Controlled Autonomous Repair with atomic backups, diff previews, rollback & independent verification
 *  - Enterprise RBAC, custom rules, epistemic review memory, immutable audit logs & report exports
 *  - Permanent reproducible KACRAE quality + large-repository scalability benchmark runner
 */

import * as cp from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ScannedSourceFile } from '../common/projectHealth.js';
import {
	analyzeKacraeSourceFiles,
	assessProductionReadiness,
	buildComplianceEvidenceReport,
	buildRequirementsTraceability,
	computeDocumentedHealthScore,
	parseRequirementsFromDocs,
	planMultiModelCouncil,
	redactSecretsInText,
	renderKacraeReport,
} from '../common/kacraeAnalyzers.js';
import { analyzeFunctionalCompleteness } from '../common/kacraeFunctionalCompleteness.js';
import { IBrowserService } from '../common/browserServiceTypes.js';
import {
	DEFAULT_KACRAE_SETTINGS,
	IKodiaKacraeMainService,
	KacraeApplyRepairRequest,
	KacraeAuditRecord,
	KacraeBenchmarkCaseResult,
	KacraeBenchmarkReport,
	KacraeEnterpriseRole,
	KacraeExportReportRequest,
	KacraeExportReportResult,
	KacraeExternalToolStatus,
	KacraeFinding,
	KacraeFindingLifecycleState,
	KacraeFunctionalCompletenessReport,
	KacraeFunctionalMatrixRow,
	KacraeLiveEvent,
	KacraeLiveEventType,
	KacraeLocalRuntimeStatus,
	KacraeMemoryEntry,
	KacraeRepairRecord,
	KacraeRepoGraph,
	KacraeRepoIndexStats,
	KacraeReviewRule,
	KacraeReviewSession,
	KacraeSettings,
	KacraeStartReviewRequest,
	KacraeWorkspaceSnapshot,
} from '../common/kacraeTypes.js';
import { KodiaCorrectnessMainService } from './correctnessMainService.js';
import { KacraeRepoIndexer } from './kacraeRepoIndexer.js';

const KACRAE_DIR = path.join('.kodia', 'kacrae');
const MAX_RING_EVENTS = 500;
const MAX_SESSIONS_STORED = 50;
const MAX_AUDIT_RECORDS = 1000;

interface SessionControlState {
	cancelled: boolean;
	paused: boolean;
}

function execFileSafe(bin: string, args: string[], cwd: string, timeoutMs = 15_000): Promise<{ ok: boolean; missing: boolean; code: number | null; stdout: string; stderr: string }> {
	return new Promise(resolve => {
		try {
			const needsShell = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(bin);
			cp.execFile(bin, args, { cwd, timeout: timeoutMs, windowsHide: true, shell: needsShell, maxBuffer: 6 * 1024 * 1024 }, (err, stdout, stderr) => {
				const missing = Boolean(err && (err as NodeJS.ErrnoException).code === 'ENOENT');
				const code = err && typeof (err as { code?: unknown }).code === 'number' ? Number((err as { code?: unknown }).code) : (err ? 1 : 0);
				resolve({ ok: !err, missing, code, stdout: String(stdout ?? '').trim(), stderr: String(stderr ?? '').trim() });
			});
		} catch (err) {
			resolve({ ok: false, missing: true, code: -1, stdout: '', stderr: err instanceof Error ? err.message : String(err) });
		}
	});
}

function runShellSafe(cmd: string, cwd: string, timeoutMs = 30_000): Promise<{ ok: boolean; code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
	return new Promise(resolve => {
		let stdout = '';
		let stderr = '';
		let timedOut = false;
		const proc = cp.spawn(cmd, { cwd, shell: true, windowsHide: true });
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
			resolve({ ok: !timedOut && code === 0, code, stdout: stdout.trim(), stderr: stderr.trim(), timedOut });
		});
		proc.on('error', err => {
			clearTimeout(timer);
			resolve({ ok: false, code: -1, stdout, stderr: err.message, timedOut });
		});
	});
}

function probeLocalHttpJson(urlStr: string, timeoutMs = 1200): Promise<{ ok: boolean; data?: unknown }> {
	return new Promise(resolve => {
		try {
			const req = http.get(urlStr, { timeout: timeoutMs }, res => {
				if (!res.statusCode || res.statusCode >= 400) {
					res.resume();
					resolve({ ok: false });
					return;
				}
				let body = '';
				res.on('data', chunk => { body += String(chunk); });
				res.on('end', () => {
					try { resolve({ ok: true, data: JSON.parse(body) }); }
					catch { resolve({ ok: true }); }
				});
			});
			req.on('error', () => resolve({ ok: false }));
			req.on('timeout', () => { req.destroy(); resolve({ ok: false }); });
		} catch {
			resolve({ ok: false });
		}
	});
}

function sha256Text(s: string): string {
	return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

function normRel(p: string): string {
	return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

export class KodiaKacraeMainService extends Disposable implements IKodiaKacraeMainService {
	readonly _serviceBrand: undefined;

	private readonly _onDidEmitEvent = this._register(new Emitter<KacraeLiveEvent>());
	readonly onDidEmitEvent: Event<KacraeLiveEvent> = this._onDidEmitEvent.event;

	private readonly _indexer = new KacraeRepoIndexer();
	private readonly _correctness: KodiaCorrectnessMainService;
	private readonly _browserService?: IBrowserService;
	private readonly _controls = new Map<string, SessionControlState>();
	private readonly _events: KacraeLiveEvent[] = [];
	private _seq = 0;

	constructor(@IBrowserService browserService?: IBrowserService) {
		super();
		this._browserService = browserService;
		this._correctness = this._register(new KodiaCorrectnessMainService());
	}

	// ========================================================================
	// Event Stream & Atomic Persistence
	// ========================================================================

	private _emit(
		sessionId: string,
		type: KacraeLiveEventType,
		phase: string,
		message: string,
		extra?: Partial<Pick<KacraeLiveEvent, 'progressPct' | 'file' | 'line' | 'severity' | 'findingId' | 'durationMs'>>,
	): KacraeLiveEvent {
		const ev: KacraeLiveEvent = {
			seq: ++this._seq,
			eventId: `kev-${this._seq}-${Date.now().toString(36)}`,
			sessionId,
			type,
			timestamp: new Date().toISOString(),
			phase,
			message: redactSecretsInText(message),
			...extra,
		};
		this._events.push(ev);
		if (this._events.length > MAX_RING_EVENTS) {
			this._events.splice(0, this._events.length - MAX_RING_EVENTS);
		}
		this._onDidEmitEvent.fire(ev);
		return ev;
	}

	async getRecentEvents(limit = 150): Promise<KacraeLiveEvent[]> {
		return this._events.slice(-Math.max(1, Math.min(MAX_RING_EVENTS, limit)));
	}

	private _storeDir(workspaceRoot: string): string {
		const dir = path.join(workspaceRoot, KACRAE_DIR);
		fs.mkdirSync(dir, { recursive: true });
		return dir;
	}

	private _readJson<T>(workspaceRoot: string, fileName: string, fallback: T): T {
		if (!workspaceRoot || !fs.existsSync(workspaceRoot)) { return fallback; }
		const p = path.join(workspaceRoot, KACRAE_DIR, fileName);
		if (!fs.existsSync(p)) { return fallback; }
		try {
			return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
		} catch {
			return fallback;
		}
	}

	private _writeJsonAtomic(workspaceRoot: string, fileName: string, data: unknown): void {
		if (!workspaceRoot || !fs.existsSync(workspaceRoot)) { return; }
		const dir = this._storeDir(workspaceRoot);
		const target = path.join(dir, fileName);
		const tmp = `${target}.${process.pid}.tmp`;
		fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
		fs.renameSync(tmp, target);
	}

	private _appendAudit(workspaceRoot: string, entry: Omit<KacraeAuditRecord, 'id' | 'timestamp'>): KacraeAuditRecord {
		const rec: KacraeAuditRecord = {
			id: `aud-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
			timestamp: new Date().toISOString(),
			...entry,
			detail: redactSecretsInText(entry.detail),
		};
		const log = this._readJson<KacraeAuditRecord[]>(workspaceRoot, 'audit-log.json', []);
		log.unshift(rec);
		this._writeJsonAtomic(workspaceRoot, 'audit-log.json', log.slice(0, MAX_AUDIT_RECORDS));
		return rec;
	}

	// ========================================================================
	// Workspace Snapshot & Cancellation / Pause / Resume
	// ========================================================================

	async loadWorkspaceSnapshot(workspaceRoot: string): Promise<KacraeWorkspaceSnapshot> {
		const sessions = this._readJson<KacraeReviewSession[]>(workspaceRoot, 'sessions.json', []);
		const latestIndexStats = this._readJson<KacraeRepoIndexStats | null>(workspaceRoot, 'index-stats.json', null);
		const cachedGraph = this._indexer.loadCachedGraph(workspaceRoot)?.graph ?? null;
		const rules = this._readJson<KacraeReviewRule[]>(workspaceRoot, 'rules.json', []);
		const memory = this._readJson<KacraeMemoryEntry[]>(workspaceRoot, 'memory.json', []);
		const repairs = this._readJson<KacraeRepairRecord[]>(workspaceRoot, 'repairs.json', []);
		const auditLog = this._readJson<KacraeAuditRecord[]>(workspaceRoot, 'audit-log.json', []);
		const latestBenchmark = this._readJson<KacraeBenchmarkReport | null>(workspaceRoot, 'benchmark.json', null);
		const [externalTools, localRuntimes] = await Promise.all([
			this.detectExternalTools(workspaceRoot),
			this.detectLocalRuntimes(),
		]);

		return {
			workspaceRoot,
			sessions,
			latestIndexStats,
			latestGraph: cachedGraph,
			rules,
			memory,
			repairs,
			auditLog,
			externalTools,
			localRuntimes,
			latestBenchmark,
		};
	}

	async cancelReview(sessionId: string): Promise<boolean> {
		const ctrl = this._controls.get(sessionId);
		if (!ctrl) { return false; }
		ctrl.cancelled = true;
		ctrl.paused = false;
		this._emit(sessionId, 'review_cancelled', 'control', `Cancellation requested for session ${sessionId}`);
		return true;
	}

	async pauseReview(sessionId: string): Promise<boolean> {
		const ctrl = this._controls.get(sessionId);
		if (!ctrl) { return false; }
		ctrl.paused = true;
		this._emit(sessionId, 'review_paused', 'control', `Review session ${sessionId} paused`);
		return true;
	}

	async resumeReview(sessionId: string): Promise<boolean> {
		const ctrl = this._controls.get(sessionId);
		if (!ctrl) { return false; }
		ctrl.paused = false;
		this._emit(sessionId, 'review_resumed', 'control', `Review session ${sessionId} resumed`);
		return true;
	}

	// ========================================================================
	// Enterprise Repository Indexing & Graph Queries
	// ========================================================================

	async indexRepository(workspaceRoot: string, opts?: {
		concurrency?: number;
		maxFiles?: number;
		excludePatterns?: readonly string[];
		incremental?: boolean;
		resumeCheckpoint?: boolean;
		sessionId?: string;
	}): Promise<{ stats: KacraeRepoIndexStats; graph: KacraeRepoGraph }> {
		const sessionId = opts?.sessionId ?? `idx-${Date.now().toString(36)}`;
		const ctrl: SessionControlState = { cancelled: false, paused: false };
		this._controls.set(sessionId, ctrl);

		this._emit(sessionId, 'indexing_started', 'indexing', `Starting incremental repository index for ${workspaceRoot}`, { progressPct: 0 });
		try {
			const result = await this._indexer.indexWorkspace(workspaceRoot, {
				concurrency: opts?.concurrency,
				maxFiles: opts?.maxFiles,
				excludePatterns: opts?.excludePatterns,
				incremental: opts?.incremental,
				control: {
					isCancelled: () => ctrl.cancelled,
					isPaused: () => ctrl.paused,
					onProgress: p => {
						const pct = p.discovered > 0 ? Math.min(99, Math.round((p.processed / p.discovered) * 100)) : 50;
						this._emit(sessionId, 'indexing_progress', 'indexing', `Indexed ${p.processed}/${p.discovered} files (${p.unchanged} cached)`, {
							progressPct: pct,
							file: p.currentFile,
						});
					},
				},
			});
			this._writeJsonAtomic(workspaceRoot, 'index-stats.json', result.stats);
			this._emit(
				sessionId,
				'indexing_completed',
				'indexing',
				`Indexed ${result.stats.indexedFiles} file(s), reused ${result.stats.unchangedCachedFiles} cached file(s) at ${result.stats.throughputFilesPerSec} files/s`,
				{ progressPct: 100, durationMs: result.stats.durationMs },
			);
			return { stats: result.stats, graph: result.graph };
		} finally {
			this._controls.delete(sessionId);
		}
	}

	async queryRepositoryGraph(workspaceRoot: string, query: {
		kind: 'dependents' | 'apis' | 'tests' | 'db_table' | 'blast_radius' | 'cycles';
		target?: string;
	}) {
		let cached = this._indexer.loadCachedGraph(workspaceRoot);
		if (!cached) {
			const res = await this.indexRepository(workspaceRoot, { incremental: true });
			cached = { graph: res.graph, records: new Map() };
		}
		const graph = cached.graph;
		const target = query.target ?? '';

		if (query.kind === 'blast_radius') {
			const blastRadius = this._indexer.computeBlastRadius(graph, target);
			return {
				answer: blastRadius.summary,
				files: [...blastRadius.directlyAffectedFiles, ...blastRadius.indirectlyAffectedFiles],
				blastRadius,
			};
		}
		if (query.kind === 'cycles') {
			const files = [...new Set(graph.topology.cycles.flat())];
			return {
				answer: graph.topology.cycles.length
					? `Found ${graph.topology.cycles.length} circular dependency cycle(s): ${graph.topology.cycles.map(c => c.join(' -> ')).join('; ')}`
					: 'No circular dependencies detected in indexed repository.',
				files,
			};
		}
		if (query.kind === 'dependents') {
			const br = this._indexer.computeBlastRadius(graph, target);
			return {
				answer: `${br.directlyAffectedFiles.length} direct and ${br.indirectlyAffectedFiles.length} indirect dependent(s) of ${target}.`,
				files: [...br.directlyAffectedFiles, ...br.indirectlyAffectedFiles],
				blastRadius: br,
			};
		}
		if (query.kind === 'apis') {
			const matching = graph.nodes.filter(n => n.apiEndpoints.length > 0 && (!target || n.id.includes(target) || n.imports.some(i => i.includes(target))));
			return {
				answer: `Found ${matching.length} API module(s): ${matching.flatMap(m => m.apiEndpoints).slice(0, 12).join(', ') || 'none'}`,
				files: matching.map(m => m.id),
			};
		}
		if (query.kind === 'tests') {
			const node = graph.nodes.find(n => n.id === normRel(target) || n.id.endsWith(`/${normRel(target)}`));
			const tests = node ? node.relatedTests : graph.nodes.filter(n => n.kind === 'test').map(n => n.id);
			return {
				answer: `Found ${tests.length} test file(s) covering ${target || 'workspace'}.`,
				files: tests,
			};
		}
		// db_table
		const tblLower = target.toLowerCase();
		const dbNodes = graph.nodes.filter(n => n.dbTables.some(t => t.toLowerCase().includes(tblLower)));
		return {
			answer: `Found ${dbNodes.length} module(s) referencing database table "${target}".`,
			files: dbNodes.map(n => n.id),
		};
	}

	// ========================================================================
	// Universal Review Orchestrator (Part 5)
	// ========================================================================

	private async _resolveGitInfo(workspaceRoot: string): Promise<{ isGit: boolean; branch?: string; revision?: string }> {
		const rev = await execFileSafe('git', ['rev-parse', '--short', 'HEAD'], workspaceRoot, 5000);
		if (!rev.ok) { return { isGit: false }; }
		const br = await execFileSafe('git', ['rev-parse', '--abbrev-ref', 'HEAD'], workspaceRoot, 5000);
		return { isGit: true, branch: br.ok ? br.stdout : undefined, revision: rev.stdout };
	}

	private async _resolveScopedFiles(
		workspaceRoot: string,
		request: KacraeStartReviewRequest,
		settings: KacraeSettings,
		graph: KacraeRepoGraph,
	): Promise<{ files: ScannedSourceFile[]; partial: boolean; partialReason?: string }> {
		let relPaths: string[] = [];
		let partial = false;
		let partialReason: string | undefined;

		if (request.scope === 'selected_code' && request.selectedSnippet) {
			return {
				files: [{ relativePath: normRel(request.selectedSnippet.file), content: request.selectedSnippet.code }],
				partial: true,
				partialReason: `Scoped to selected code range (${request.selectedSnippet.file}:${request.selectedSnippet.startLine}-${request.selectedSnippet.endLine}).`,
			};
		}

		if (request.targetFiles && request.targetFiles.length > 0) {
			relPaths = request.targetFiles.map(f => path.isAbsolute(f) ? normRel(path.relative(workspaceRoot, f)) : normRel(f));
			if (request.scope !== 'entire_project' && request.scope !== 'monorepo') {
				partial = true;
				partialReason = `Scoped to ${relPaths.length} requested file(s).`;
			}
		} else if (request.scope === 'git_staged') {
			const res = await execFileSafe('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMRT'], workspaceRoot, 8000);
			relPaths = res.ok ? res.stdout.split(/\r?\n/).map(s => normRel(s.trim())).filter(Boolean) : [];
			partial = true;
			partialReason = `Scoped to ${relPaths.length} staged Git file(s).`;
		} else if (request.scope === 'git_unstaged') {
			const res = await execFileSafe('git', ['diff', '--name-only', '--diff-filter=ACMRT'], workspaceRoot, 8000);
			const untracked = await execFileSafe('git', ['ls-files', '--others', '--exclude-standard'], workspaceRoot, 8000);
			relPaths = [...new Set([
				...(res.ok ? res.stdout.split(/\r?\n/) : []),
				...(untracked.ok ? untracked.stdout.split(/\r?\n/) : []),
			].map(s => normRel(s.trim())).filter(Boolean))];
			partial = true;
			partialReason = `Scoped to ${relPaths.length} unstaged/untracked Git file(s).`;
		} else if (request.scope === 'modified_files') {
			const staged = await execFileSafe('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMRT'], workspaceRoot, 8000);
			const unstaged = await execFileSafe('git', ['diff', '--name-only', '--diff-filter=ACMRT'], workspaceRoot, 8000);
			const untracked = await execFileSafe('git', ['ls-files', '--others', '--exclude-standard'], workspaceRoot, 8000);
			relPaths = [...new Set([
				...(staged.ok ? staged.stdout.split(/\r?\n/) : []),
				...(unstaged.ok ? unstaged.stdout.split(/\r?\n/) : []),
				...(untracked.ok ? untracked.stdout.split(/\r?\n/) : []),
			].map(s => normRel(s.trim())).filter(Boolean))];
			if (relPaths.length === 0) {
				// Fallback to indexed workspace files when working tree is clean
				relPaths = graph.nodes.map(n => n.id);
			} else {
				partial = true;
				partialReason = `Scoped to ${relPaths.length} modified Git working-tree file(s).`;
			}
		} else if (request.scope === 'latest_commit') {
			const res = await execFileSafe('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'], workspaceRoot, 8000);
			relPaths = res.ok ? res.stdout.split(/\r?\n/).map(s => normRel(s.trim())).filter(Boolean) : [];
			partial = true;
			partialReason = `Scoped to latest Git commit (${relPaths.length} file(s)).`;
		} else if (request.scope === 'commit_range' || request.scope === 'branch_comparison' || request.scope === 'pull_request') {
			const base = request.gitBaseRef || 'HEAD~1';
			const head = request.gitHeadRef || 'HEAD';
			const res = await execFileSafe('git', ['diff', '--name-only', '--diff-filter=ACMRT', `${base}...${head}`], workspaceRoot, 8000);
			relPaths = res.ok ? res.stdout.split(/\r?\n/).map(s => normRel(s.trim())).filter(Boolean) : [];
			partial = true;
			partialReason = `Scoped to Git diff ${base}...${head} (${relPaths.length} file(s)).`;
		} else {
			relPaths = graph.nodes.map(n => n.id);
		}

		// Bound max files per review to protect memory
		const maxForReview = request.depth === 'enterprise_assurance' || request.depth === 'deep'
			? Math.max(settings.maxFilesPerStandardReview, 2000)
			: settings.maxFilesPerStandardReview;
		if (relPaths.length > maxForReview) {
			relPaths = relPaths.slice(0, maxForReview);
			partial = true;
			partialReason = `Bounded to ${maxForReview} prioritized files out of larger workspace (configure maxFilesPerStandardReview to expand).`;
		}

		// Always include OpenAPI specs or test files when reviewing modified files so contract/coverage checks stay accurate
		const extraContextFiles = graph.nodes
			.filter(n => n.kind === 'test' || /(?:openapi|swagger).*\.(?:json|ya?ml)$/i.test(n.id))
			.map(n => n.id)
			.slice(0, 60);
		const finalPaths = [...new Set([...relPaths, ...extraContextFiles])];

		const scanned: ScannedSourceFile[] = [];
		for (const rel of finalPaths) {
			const abs = path.join(workspaceRoot, rel);
			try {
				const st = fs.statSync(abs);
				if (!st.isFile() || st.size > 512 * 1024) { continue; }
				scanned.push({ relativePath: rel, content: fs.readFileSync(abs, 'utf8') });
			} catch { /* ignore unreadable */ }
		}

		return { files: scanned, partial, partialReason };
	}

	async startReview(request: KacraeStartReviewRequest): Promise<KacraeReviewSession> {
		const t0 = Date.now();
		const sessionId = `rev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
		const createdAt = new Date().toISOString();
		const settings: KacraeSettings = { ...DEFAULT_KACRAE_SETTINGS, ...(request.settings ?? {}) };
		const ctrl: SessionControlState = { cancelled: false, paused: false };
		this._controls.set(sessionId, ctrl);

		const title = request.title ?? `KACRAE ${request.depth.replace(/_/g, ' ')} review (${request.scope.replace(/_/g, ' ')})`;
		this._emit(sessionId, 'review_created', 'init', `Created review session: ${title}`, { progressPct: 2 });
		this._emit(sessionId, 'review_queued', 'init', `Queued review for workspace ${request.workspaceRoot}`, { progressPct: 5 });

		const toolsExecuted: string[] = [];
		try {
			// Stage 1: Incremental Repository Indexing
			const { stats: idxStats, graph } = await this.indexRepository(request.workspaceRoot, {
				concurrency: settings.indexingConcurrency,
				excludePatterns: settings.excludePatterns,
				incremental: true,
				sessionId,
			});
			toolsExecuted.push('kacrae-repo-indexer');
			if (ctrl.cancelled) {
				return this._buildCancelledSession(sessionId, title, request, createdAt, t0, settings, toolsExecuted);
			}

			// Stage 2: Git Context & Scoped File Resolution
			const gitInfo = await this._resolveGitInfo(request.workspaceRoot);
			const scoped = await this._resolveScopedFiles(request.workspaceRoot, request, settings, graph);
			const partialScan = scoped.partial || idxStats.partial;
			const partialReason = scoped.partialReason ?? idxStats.partialReason;

			// Stage 3: Deterministic Multi-Domain Static, Security, DB, API, Architecture, Test & Adversarial Analysis
			this._emit(sessionId, 'analyzer_started', 'analysis', `Analyzing ${scoped.files.length} scoped file(s) across security, correctness, concurrency, DB, API, architecture & test engines`, { progressPct: 40 });
			const customRules = this._readJson<KacraeReviewRule[]>(request.workspaceRoot, 'rules.json', []);
			const analysis = analyzeKacraeSourceFiles(scoped.files, { customRules, graph, settings });
			const functionalCompleteness = analyzeFunctionalCompleteness(scoped.files);
			toolsExecuted.push('kacrae-correctness', 'kacrae-functional-completeness', 'kacrae-security-taint', 'kacrae-tenant-isolation', 'kacrae-concurrency', 'kacrae-database', 'kacrae-api-contract', 'kacrae-architecture', 'kacrae-test-intelligence');

			let findings = [...analysis.findings, ...functionalCompleteness.findings];
			for (const fd of findings.slice(0, 40)) {
				this._emit(sessionId, 'finding_discovered', 'analysis', `${fd.severity.toUpperCase()} [${fd.ruleId}] ${fd.title}`, {
					file: fd.location.file,
					line: fd.location.startLine,
					severity: fd.severity,
					findingId: fd.id,
				});
			}
			this._emit(sessionId, 'analyzer_completed', 'analysis', `Deterministic analysis found ${findings.length} calibrated finding(s)`, { progressPct: 68 });

			if (ctrl.cancelled) {
				return this._buildCancelledSession(sessionId, title, request, createdAt, t0, settings, toolsExecuted);
			}

			// Stage 4: Real Multi-Language Compiler Checks (Reusing KodiaCorrectnessMainService)
			if (settings.enableCompilerChecks && request.depth !== 'quick') {
				this._emit(sessionId, 'analyzer_started', 'compilers', 'Running native language compilers (node --check, tsc, python py_compile)', { progressPct: 74 });
				const compilerOutcomes = await this._correctness.runCompilerAndAnalyzers(request.workspaceRoot, {
					targetFiles: scoped.files.map(f => f.relativePath),
				});
				for (const outcome of compilerOutcomes) {
					if (!outcome.available) { continue; }
					toolsExecuted.push(outcome.engine);
					const MAX_COMPILER_FINDINGS_PER_ENGINE = 50;
					const emittedDiags = outcome.diagnostics.slice(0, MAX_COMPILER_FINDINGS_PER_ENGINE);
					for (const d of emittedDiags) {
						findings.push({
							id: `kacrae-comp-${sha256Text(`${d.ruleId}:${d.file}:${d.line}:${d.message}`).slice(0, 10)}`,
							ruleId: d.ruleId,
							title: d.title,
							category: 'correctness',
							severity: d.severity === 'critical' ? 'critical' : d.severity === 'error' ? 'high' : 'medium',
							classification: 'confirmed_defect',
							confidence: 0.99,
							location: { file: normRel(d.file), startLine: d.line, endLine: d.line, startColumn: d.column },
							codeContext: d.evidence ?? d.message,
							explanation: d.message,
							whyItMatters: d.remediation,
							preconditions: [],
							impact: `Confirmed ${outcome.language} compiler/type error (${outcome.engine}).`,
							evidence: [`${outcome.engine}: ${d.message}`],
							relatedFindingIds: [],
							affectedComponents: [normRel(d.file)],
							detectionMethod: 'compiler',
							lifecycle: 'confirmed',
							lifecycleHistory: [],
							createdAt: new Date().toISOString(),
						});
					}
					if (outcome.diagnostics.length > MAX_COMPILER_FINDINGS_PER_ENGINE) {
						const omitted = outcome.diagnostics.length - MAX_COMPILER_FINDINGS_PER_ENGINE;
						findings.push({
							id: `kacrae-comp-cap-${outcome.engine}`,
							ruleId: `KACRAE-${outcome.engine.toUpperCase()}-SUMMARY`,
							title: `${omitted} additional ${outcome.language} compiler diagnostics omitted (fix root config / dependencies first)`,
							category: 'correctness',
							severity: 'medium',
							classification: 'confirmed_defect',
							confidence: 0.95,
							location: { file: normRel(outcome.diagnostics[0]?.file ?? 'tsconfig.json'), startLine: 1, endLine: 1 },
							codeContext: `${outcome.engine} reported ${outcome.diagnostics.length} total diagnostics; showing top ${MAX_COMPILER_FINDINGS_PER_ENGINE}.`,
							explanation: `Showing the first ${MAX_COMPILER_FINDINGS_PER_ENGINE} diagnostics from ${outcome.engine}. Many cascading compiler errors are typically resolved at once by running npm install or fixing shared type/config issues.`,
							whyItMatters: 'Prevents hundreds of cascading diagnostics from drowning out high-priority bugs.',
							preconditions: [],
							impact: `${outcome.diagnostics.length} total compiler diagnostics in ${outcome.engine}.`,
							evidence: [`Total diagnostics: ${outcome.diagnostics.length}`, `Displayed: ${MAX_COMPILER_FINDINGS_PER_ENGINE}`],
							relatedFindingIds: [],
							affectedComponents: [],
							detectionMethod: 'compiler',
							lifecycle: 'confirmed',
							lifecycleHistory: [],
							createdAt: new Date().toISOString(),
						});
					}
				}
				this._emit(sessionId, 'analyzer_completed', 'compilers', `Completed compiler checks (${compilerOutcomes.filter(c => c.available).length} available)`, { progressPct: 82 });
			}

			// Stage 5: Optional Test Execution (Real command, never simulated)
			let testExecutionPassed: boolean | undefined;
			let testExecutionOutput: string | undefined;
			if (settings.enableTestExecution && request.testCommand) {
				this._emit(sessionId, 'test_started', 'testing', `Executing test command: ${request.testCommand}`, { progressPct: 86 });
				const testRes = await runShellSafe(request.testCommand, request.workspaceRoot, 45_000);
				testExecutionPassed = testRes.ok;
				testExecutionOutput = redactSecretsInText(`${testRes.stdout}\n${testRes.stderr}`).trim().slice(0, 4000);
				toolsExecuted.push(`test:${request.testCommand}`);
				this._emit(sessionId, 'test_completed', 'testing', `Test command ${testRes.ok ? 'PASSED' : 'FAILED'} (exit ${testRes.code})`, { progressPct: 92 });
			}

			// Stage 6: Requirements Traceability (Part 19)
			let traceability = undefined;
			const reqDocFiles: ScannedSourceFile[] = [];
			if (request.requirementsDocs && request.requirementsDocs.length > 0) {
				for (const docPath of request.requirementsDocs) {
					const abs = path.isAbsolute(docPath) ? docPath : path.join(request.workspaceRoot, docPath);
					if (fs.existsSync(abs)) {
						reqDocFiles.push({ relativePath: normRel(path.relative(request.workspaceRoot, abs)), content: fs.readFileSync(abs, 'utf8') });
					}
				}
			} else {
				// Auto-discover REQUIREMENTS.md / SPEC.md if present in workspace root
				for (const candidate of ['REQUIREMENTS.md', 'SPEC.md', 'docs/REQUIREMENTS.md', 'docs/SPEC.md']) {
					const abs = path.join(request.workspaceRoot, candidate);
					if (fs.existsSync(abs)) {
						reqDocFiles.push({ relativePath: candidate, content: fs.readFileSync(abs, 'utf8') });
					}
				}
			}
			if (reqDocFiles.length > 0) {
				const parsedReqs = parseRequirementsFromDocs(reqDocFiles);
				if (parsedReqs.length > 0) {
					traceability = buildRequirementsTraceability(parsedReqs, scoped.files, findings);
					toolsExecuted.push('kacrae-requirements-traceability');
				}
			}

			// Stage 7: Multi-Model Council Plan, Compliance, Documented Health Score & Honest Readiness
			const councilPlan = planMultiModelCouncil({
				depth: request.depth,
				settings,
				configuredProviders: request.configuredProviders,
			});

			const complianceReport = buildComplianceEvidenceReport(findings, toolsExecuted, true);
			const healthScore = computeDocumentedHealthScore({
				findings,
				testFilesCount: analysis.testReport.testFilesCount,
				sourceFilesCount: analysis.testReport.sourceFilesCount,
				testExecutionPassed,
				partialScan,
			});
			const readiness = assessProductionReadiness({
				findings,
				toolsExecuted,
				testExecutionPassed,
				partialScan,
				settings,
			});

			const counts = {
				critical: findings.filter(f => f.severity === 'critical').length,
				high: findings.filter(f => f.severity === 'high').length,
				medium: findings.filter(f => f.severity === 'medium').length,
				low: findings.filter(f => f.severity === 'low').length,
				info: findings.filter(f => f.severity === 'info').length,
				confirmed: findings.filter(f => f.classification === 'confirmed_defect').length,
				suppressed: findings.filter(f => f.lifecycle === 'suppressed').length,
				resolved: findings.filter(f => f.lifecycle === 'verified_resolved').length,
			};

			const durationMs = Math.max(1, Date.now() - t0);
			const session: KacraeReviewSession = {
				id: sessionId,
				title,
				workspaceRoot: request.workspaceRoot,
				scope: request.scope,
				depth: request.depth,
				status: partialScan ? 'completed_partial' : 'completed',
				createdAt,
				completedAt: new Date().toISOString(),
				durationMs,
				gitBranch: gitInfo.branch,
				gitRevision: gitInfo.revision,
				targetFiles: scoped.files.map(f => f.relativePath),
				filesAnalyzedCount: scoped.files.length,
				partialScan,
				partialReason,
				findings,
				counts,
				attackPaths: analysis.attackPaths,
				databaseReport: analysis.databaseReport,
				apiContractReport: analysis.apiContractReport,
				testReport: {
					...analysis.testReport,
					testExecutionPassed,
					testExecutionOutput,
				},
				performanceReport: {
					...analysis.performanceReport,
					measuredMetrics: [
						{ label: 'Indexing Throughput', value: String(idxStats.throughputFilesPerSec), unit: 'files/sec' },
						{ label: 'Peak Indexer Heap', value: String(idxStats.peakHeapMb), unit: 'MB' },
						{ label: 'Total Review Latency', value: String(durationMs), unit: 'ms' },
					],
				},
				functionalCompleteness,
				adversarialChallenges: settings.enableAdversarialReview ? analysis.adversarialChallenges : [],
				traceability,
				complianceReport,
				healthScore,
				readiness,
				councilPlan,
				toolsExecuted: [...new Set(toolsExecuted)],
				modelsUsed: councilPlan.assignments.filter(a => a.modelName).map(a => `${a.providerName}/${a.modelName}`),
				summary: `Analyzed ${scoped.files.length} file(s) in ${durationMs}ms: ${counts.critical} critical, ${counts.high} high, ${counts.medium} medium, ${counts.low} low (${counts.confirmed} confirmed). Readiness: ${readiness.verdict}.`,
			};

			// Persist session & immutable audit record
			const sessions = this._readJson<KacraeReviewSession[]>(request.workspaceRoot, 'sessions.json', []);
			sessions.unshift(session);
			this._writeJsonAtomic(request.workspaceRoot, 'sessions.json', sessions.slice(0, MAX_SESSIONS_STORED));

			this._appendAudit(request.workspaceRoot, {
				actor: request.actor ?? os.userInfo().username,
				role: settings.enterpriseRole,
				action: 'review_completed',
				repository: request.workspaceRoot,
				revision: gitInfo.revision,
				sessionId,
				toolsUsed: session.toolsExecuted,
				modelsUsed: session.modelsUsed,
				filesAffected: session.targetFiles.slice(0, 50),
				policyVerdict: readiness.verdict === 'blocked_by_findings' ? 'block' : readiness.verdict === 'ready_per_policy_checks' ? 'pass' : 'warn',
				detail: session.summary,
			});

			this._emit(sessionId, 'review_completed', 'complete', session.summary, { progressPct: 100, durationMs });
			return session;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this._emit(sessionId, 'review_failed', 'error', `Review failed: ${msg}`);
			throw err;
		} finally {
			this._controls.delete(sessionId);
		}
	}

	private _buildCancelledSession(
		sessionId: string,
		title: string,
		request: KacraeStartReviewRequest,
		createdAt: string,
		t0: number,
		settings: KacraeSettings,
		toolsExecuted: string[],
	): KacraeReviewSession {
		const councilPlan = planMultiModelCouncil({ depth: request.depth, settings, configuredProviders: request.configuredProviders });
		return {
			id: sessionId,
			title,
			workspaceRoot: request.workspaceRoot,
			scope: request.scope,
			depth: request.depth,
			status: 'cancelled',
			createdAt,
			completedAt: new Date().toISOString(),
			durationMs: Math.max(1, Date.now() - t0),
			targetFiles: [],
			filesAnalyzedCount: 0,
			partialScan: true,
			partialReason: 'Review cancelled before completion.',
			findings: [],
			counts: { critical: 0, high: 0, medium: 0, low: 0, info: 0, confirmed: 0, suppressed: 0, resolved: 0 },
			attackPaths: [],
			databaseReport: { databasesDetected: [], migrationsInspected: 0, queriesInspected: 0, destructiveMigrations: 0, lockingMigrations: 0, nPlusOneRisks: 0, tenantIsolationRisks: 0, findings: [] },
			apiContractReport: { protocolsDetected: [], specFiles: [], specEndpoints: [], implementedEndpoints: [], undocumentedEndpoints: [], unimplementedSpecEndpoints: [], breakingChanges: [], findings: [] },
			testReport: { testFilesCount: 0, sourceFilesCount: 0, untestedCriticalFiles: [], weakOrTautologicalTests: [], flakyTestPatterns: [], generatedTests: [] },
			performanceReport: { observations: [], measuredMetrics: [], disclaimer: 'Cancelled before measurement.' },
			adversarialChallenges: [],
			complianceReport: buildComplianceEvidenceReport([], toolsExecuted, true),
			healthScore: computeDocumentedHealthScore({ findings: [], testFilesCount: 0, sourceFilesCount: 0, partialScan: true }),
			readiness: assessProductionReadiness({ findings: [], toolsExecuted, partialScan: true, settings }),
			councilPlan,
			toolsExecuted,
			modelsUsed: [],
			summary: 'Review cancelled by user.',
		};
	}

	// ========================================================================
	// Finding Lifecycle Transitions (Part 16.4)
	// ========================================================================

	async updateFindingLifecycle(workspaceRoot: string, opts: {
		sessionId: string;
		findingId: string;
		nextState: KacraeFindingLifecycleState;
		actor?: string;
		reason?: string;
	}): Promise<KacraeFinding | null> {
		if (opts.nextState === 'suppressed' && (!opts.reason || !opts.reason.trim())) {
			throw new Error('Suppressing a finding requires a non-empty justification.');
		}
		const sessions = this._readJson<KacraeReviewSession[]>(workspaceRoot, 'sessions.json', []);
		const sIdx = sessions.findIndex(s => s.id === opts.sessionId);
		if (sIdx < 0) { return null; }

		const session = sessions[sIdx];
		const fIdx = session.findings.findIndex(f => f.id === opts.findingId);
		if (fIdx < 0) { return null; }

		const oldFinding = session.findings[fIdx];
		const actor = opts.actor ?? os.userInfo().username;
		const updated: KacraeFinding = {
			...oldFinding,
			lifecycle: opts.nextState,
			suppressionJustification: opts.nextState === 'suppressed' ? opts.reason?.trim() : oldFinding.suppressionJustification,
			lifecycleHistory: [
				...oldFinding.lifecycleHistory,
				{
					from: oldFinding.lifecycle,
					to: opts.nextState,
					actor,
					reason: opts.reason,
					timestamp: new Date().toISOString(),
				},
			],
		};

		const nextFindings = [...session.findings];
		nextFindings[fIdx] = updated;
		const activeFindings = nextFindings.filter(f =>
			f.lifecycle !== 'verified_resolved' &&
			f.lifecycle !== 'suppressed' &&
			f.lifecycle !== 'false_positive',
		);
		sessions[sIdx] = {
			...session,
			findings: nextFindings,
			counts: {
				critical: activeFindings.filter(f => f.severity === 'critical').length,
				high: activeFindings.filter(f => f.severity === 'high').length,
				medium: activeFindings.filter(f => f.severity === 'medium').length,
				low: activeFindings.filter(f => f.severity === 'low').length,
				info: activeFindings.filter(f => f.severity === 'info').length,
				confirmed: activeFindings.filter(f => f.classification === 'confirmed_defect').length,
				suppressed: nextFindings.filter(f => f.lifecycle === 'suppressed').length,
				resolved: nextFindings.filter(f => f.lifecycle === 'verified_resolved').length,
			},
		};
		this._writeJsonAtomic(workspaceRoot, 'sessions.json', sessions);

		const evType: KacraeLiveEventType =
			opts.nextState === 'confirmed' ? 'finding_confirmed' :
			opts.nextState === 'suppressed' || opts.nextState === 'false_positive' ? 'finding_dismissed' :
			'finding_updated';
		this._emit(opts.sessionId, evType, 'lifecycle', `Finding ${opts.findingId} -> ${opts.nextState}${opts.reason ? ` (${opts.reason})` : ''}`, {
			findingId: opts.findingId,
			file: updated.location.file,
			line: updated.location.startLine,
		});

		this._appendAudit(workspaceRoot, {
			actor,
			role: 'reviewer',
			action: opts.nextState === 'suppressed' ? 'finding_suppressed' : 'finding_updated',
			repository: workspaceRoot,
			sessionId: opts.sessionId,
			toolsUsed: ['kacrae-lifecycle'],
			modelsUsed: [],
			filesAffected: [updated.location.file],
			detail: `Finding ${opts.findingId} transitioned ${oldFinding.lifecycle} -> ${opts.nextState}. Reason: ${opts.reason ?? 'none'}`,
		});

		return updated;
	}

	// ========================================================================
	// Controlled Autonomous Repair & Independent Verification (Part 17)
	// ========================================================================

	async proposeOrApplyRepair(request: KacraeApplyRepairRequest): Promise<KacraeRepairRecord> {
		const role: KacraeEnterpriseRole = request.role ?? 'approver';
		if (!request.dryRun && (role === 'viewer' || role === 'reviewer')) {
			throw new Error(`RBAC policy blocked repair application: role "${role}" lacks approval permission (requires approver, security_officer, or admin).`);
		}

		const sessions = this._readJson<KacraeReviewSession[]>(request.workspaceRoot, 'sessions.json', []);
		const sIdx = sessions.findIndex(s => s.id === request.sessionId);
		if (sIdx < 0) { throw new Error(`Review session not found: ${request.sessionId}`); }
		const session = sessions[sIdx];
		const fIdx = session.findings.findIndex(f => f.id === request.findingId);
		if (fIdx < 0) { throw new Error(`Finding not found: ${request.findingId}`); }

		const finding = session.findings[fIdx];
		const absFile = path.resolve(request.workspaceRoot, finding.location.file);
		if (!absFile.startsWith(path.resolve(request.workspaceRoot))) {
			throw new Error('Path traversal blocked: finding file escapes workspace root.');
		}
		if (!fs.existsSync(absFile)) {
			throw new Error(`Target source file does not exist: ${finding.location.file}`);
		}

		const originalContent = fs.readFileSync(absFile, 'utf8');
		const originalHash = sha256Text(originalContent);
		const actor = request.actor ?? os.userInfo().username;

		let nextContent: string;
		let diffPreview: string;
		if (request.customReplacement !== undefined) {
			nextContent = request.customReplacement;
			diffPreview = `--- a/${finding.location.file}\n+++ b/${finding.location.file}\n@@ custom replacement @@`;
		} else if (finding.suggestedFix && originalContent.includes(finding.suggestedFix.originalSnippet)) {
			nextContent = originalContent.replace(finding.suggestedFix.originalSnippet, finding.suggestedFix.replacementSnippet);
			diffPreview = finding.suggestedFix.diffPreview;
		} else {
			throw new Error(`No safe deterministic patch matched current contents of ${finding.location.file}. Provide customReplacement after inspecting current code.`);
		}

		const repairId = `rep-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
		if (request.dryRun) {
			const proposal: KacraeRepairRecord = {
				id: repairId,
				findingId: finding.id,
				file: finding.location.file,
				status: 'proposed',
				originalContentHash: originalHash,
				diffPreview,
				actor,
			};
			this._emit(request.sessionId, 'repair_proposed', 'repair', `Proposed minimal repair for ${finding.ruleId} in ${finding.location.file}`, {
				findingId: finding.id,
				file: finding.location.file,
				line: finding.location.startLine,
			});
			await this.updateFindingLifecycle(request.workspaceRoot, {
				sessionId: request.sessionId,
				findingId: finding.id,
				nextState: 'fix_proposed',
				actor,
				reason: 'Generated minimal diff preview',
			});
			return proposal;
		}

		// Save atomic backup for rollback before touching user source
		const backupsDir = path.join(this._storeDir(request.workspaceRoot), 'backups');
		fs.mkdirSync(backupsDir, { recursive: true });
		const backupPath = path.join(backupsDir, `${repairId}.bak`);
		fs.writeFileSync(backupPath, originalContent, 'utf8');

		this._emit(request.sessionId, 'repair_approved', 'repair', `Repair ${repairId} approved by ${actor} (${role})`, { findingId: finding.id, file: finding.location.file });
		fs.writeFileSync(absFile, nextContent, 'utf8');
		this._emit(request.sessionId, 'repair_applied', 'repair', `Applied minimal repair ${repairId} to ${finding.location.file}`, { findingId: finding.id, file: finding.location.file });

		// Independent Verification: re-run KACRAE analyzer on modified file + KodiaCorrectnessMainService independent verification!
		this._emit(request.sessionId, 'verification_started', 'verification', `Independently verifying repair ${repairId} on ${finding.location.file}`, { findingId: finding.id, file: finding.location.file });

		const reAnalyzed = analyzeKacraeSourceFiles([{ relativePath: finding.location.file, content: nextContent }]);
		const defectStillPresent = reAnalyzed.findings.some(f => f.ruleId === finding.ruleId && Math.abs(f.location.startLine - finding.location.startLine) <= 2);

		const indReport = await this._correctness.runIndependentVerification(request.workspaceRoot, {
			changeDescription: `KACRAE repair ${repairId} for ${finding.ruleId} (${finding.title})`,
			changedFiles: [finding.location.file],
			testCommands: request.testCommand ? [request.testCommand] : [],
			requireTests: Boolean(request.testCommand),
		});

		const verifiedResolved = !defectStillPresent && indReport.verdict === 'APPROVED';
		const verificationEvidence = {
			verifiedAt: new Date().toISOString(),
			verdict: verifiedResolved ? 'verified_resolved' as const : defectStillPresent ? 'still_failing' as const : 'inconclusive' as const,
			command: request.testCommand,
			tool: 'kacrae-independent-verifier + correctness-engine',
			exitCode: verifiedResolved ? 0 : 1,
			outputSnippet: redactSecretsInText(indReport.summary),
			testRefs: request.testCommand ? [request.testCommand] : [],
			remainingUncertainty: [
				...indReport.untestedRisks,
				...(defectStillPresent ? [`Original rule ${finding.ruleId} still matched after repair.`] : []),
			],
		};

		const record: KacraeRepairRecord = {
			id: repairId,
			findingId: finding.id,
			file: finding.location.file,
			status: verifiedResolved ? 'verified' : 'verification_failed',
			originalContentHash: originalHash,
			diffPreview,
			appliedAt: new Date().toISOString(),
			backupPath,
			verification: verificationEvidence,
			independentVerdict: indReport.verdict,
			actor,
		};

		const repairs = this._readJson<KacraeRepairRecord[]>(request.workspaceRoot, 'repairs.json', []);
		repairs.unshift(record);
		this._writeJsonAtomic(request.workspaceRoot, 'repairs.json', repairs.slice(0, 200));

		// Update finding with verification evidence and lifecycle
		const refreshedSessions = this._readJson<KacraeReviewSession[]>(request.workspaceRoot, 'sessions.json', []);
		const rsIdx = refreshedSessions.findIndex(s => s.id === request.sessionId);
		if (rsIdx >= 0) {
			const rfIdx = refreshedSessions[rsIdx].findings.findIndex(f => f.id === finding.id);
			if (rfIdx >= 0) {
				const f = refreshedSessions[rsIdx].findings[rfIdx];
				const nextFindings = [...refreshedSessions[rsIdx].findings];
				nextFindings[rfIdx] = {
					...f,
					verification: verificationEvidence,
					lifecycle: verifiedResolved ? 'verified_resolved' : 'awaiting_verification',
					lifecycleHistory: [
						...f.lifecycleHistory,
						{ from: f.lifecycle, to: verifiedResolved ? 'verified_resolved' : 'awaiting_verification', actor, reason: indReport.summary, timestamp: new Date().toISOString() },
					],
				};
				refreshedSessions[rsIdx] = {
					...refreshedSessions[rsIdx],
					findings: nextFindings,
					counts: {
						...refreshedSessions[rsIdx].counts,
						resolved: nextFindings.filter(x => x.lifecycle === 'verified_resolved').length,
					},
				};
				this._writeJsonAtomic(request.workspaceRoot, 'sessions.json', refreshedSessions);
			}
		}

		this._appendAudit(request.workspaceRoot, {
			actor,
			role,
			action: 'repair_applied',
			repository: request.workspaceRoot,
			sessionId: request.sessionId,
			toolsUsed: ['kacrae-repair', 'kacrae-independent-verifier'],
			modelsUsed: [],
			filesAffected: [finding.location.file],
			policyVerdict: verifiedResolved ? 'pass' : 'warn',
			detail: `Applied repair ${repairId} for ${finding.ruleId}; independent verification verdict=${indReport.verdict}, resolved=${verifiedResolved}`,
		});

		this._emit(request.sessionId, 'verification_completed', 'verification', `Independent verification ${verifiedResolved ? 'CONFIRMED fix' : 'did not confirm fix'} (${indReport.verdict})`, {
			findingId: finding.id,
			file: finding.location.file,
		});

		return record;
	}

	async revertRepair(workspaceRoot: string, repairId: string, actor?: string): Promise<KacraeRepairRecord | null> {
		const repairs = this._readJson<KacraeRepairRecord[]>(workspaceRoot, 'repairs.json', []);
		const idx = repairs.findIndex(r => r.id === repairId);
		if (idx < 0) { return null; }
		const rec = repairs[idx];
		if (!rec.backupPath || !fs.existsSync(rec.backupPath)) {
			throw new Error(`Backup file missing for repair ${repairId}; cannot safely revert.`);
		}
		const absFile = path.resolve(workspaceRoot, rec.file);
		fs.writeFileSync(absFile, fs.readFileSync(rec.backupPath, 'utf8'), 'utf8');
		const updated: KacraeRepairRecord = { ...rec, status: 'reverted', revertedAt: new Date().toISOString() };
		repairs[idx] = updated;
		this._writeJsonAtomic(workspaceRoot, 'repairs.json', repairs);

		this._appendAudit(workspaceRoot, {
			actor: actor ?? os.userInfo().username,
			role: 'approver',
			action: 'repair_reverted',
			repository: workspaceRoot,
			toolsUsed: ['kacrae-repair-rollback'],
			modelsUsed: [],
			filesAffected: [rec.file],
			detail: `Reverted repair ${repairId} from backup`,
		});
		return updated;
	}

	// ========================================================================
	// Custom Rules & Epistemic Review Memory (Parts 25 & 26)
	// ========================================================================

	async manageRules(workspaceRoot: string, opts: {
		action: 'list' | 'upsert' | 'delete' | 'toggle';
		rule?: KacraeReviewRule;
		ruleId?: string;
		enabled?: boolean;
	}): Promise<KacraeReviewRule[]> {
		const rules = this._readJson<KacraeReviewRule[]>(workspaceRoot, 'rules.json', []);
		if (opts.action === 'list') { return rules; }
		if (opts.action === 'upsert' && opts.rule) {
			// Validate regex pattern safely
			try { new RegExp(opts.rule.pattern); } catch (e) { throw new Error(`Invalid regex pattern in rule ${opts.rule.id}: ${e}`); }
			const idx = rules.findIndex(r => r.id === opts.rule!.id);
			const nextRule: KacraeReviewRule = { ...opts.rule, updatedAt: new Date().toISOString() };
			if (idx >= 0) { rules[idx] = nextRule; } else { rules.unshift(nextRule); }
		} else if (opts.action === 'delete' && opts.ruleId) {
			const idx = rules.findIndex(r => r.id === opts.ruleId);
			if (idx >= 0) { rules.splice(idx, 1); }
		} else if (opts.action === 'toggle' && opts.ruleId) {
			const idx = rules.findIndex(r => r.id === opts.ruleId);
			if (idx >= 0) { rules[idx] = { ...rules[idx], enabled: opts.enabled ?? !rules[idx].enabled, updatedAt: new Date().toISOString() }; }
		}
		this._writeJsonAtomic(workspaceRoot, 'rules.json', rules);
		this._appendAudit(workspaceRoot, {
			actor: os.userInfo().username,
			role: 'admin',
			action: 'rule_updated',
			repository: workspaceRoot,
			toolsUsed: ['kacrae-policy-engine'],
			modelsUsed: [],
			filesAffected: ['.kodia/kacrae/rules.json'],
			detail: `Rule operation ${opts.action} (${opts.rule?.id ?? opts.ruleId ?? 'all'})`,
		});
		return rules;
	}

	async manageMemory(workspaceRoot: string, opts: {
		action: 'list' | 'add' | 'approve' | 'delete';
		entry?: Omit<KacraeMemoryEntry, 'id' | 'createdAt'>;
		entryId?: string;
	}): Promise<KacraeMemoryEntry[]> {
		const mem = this._readJson<KacraeMemoryEntry[]>(workspaceRoot, 'memory.json', []);
		if (opts.action === 'list') { return mem; }
		if (opts.action === 'add' && opts.entry) {
			mem.unshift({
				id: `mem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
				createdAt: new Date().toISOString(),
				...opts.entry,
				statement: redactSecretsInText(opts.entry.statement),
			});
		} else if (opts.action === 'approve' && opts.entryId) {
			const idx = mem.findIndex(m => m.id === opts.entryId);
			if (idx >= 0) { mem[idx] = { ...mem[idx], approvedByUser: true, kind: 'user_convention' }; }
		} else if (opts.action === 'delete' && opts.entryId) {
			const idx = mem.findIndex(m => m.id === opts.entryId);
			if (idx >= 0) { mem.splice(idx, 1); }
		}
		this._writeJsonAtomic(workspaceRoot, 'memory.json', mem.slice(0, 300));
		return mem;
	}

	// ========================================================================
	// External Tool Adapter & Local Runtime Detection (Parts 8.4, 15, 28)
	// ========================================================================

	async detectExternalTools(workspaceRoot: string): Promise<KacraeExternalToolStatus[]> {
		const cwd = workspaceRoot && fs.existsSync(workspaceRoot) ? workspaceRoot : process.cwd();
		const specs: readonly { id: string; name: string; bin: string; args: string[]; category: KacraeExternalToolStatus['category']; licenseNote: string; installHint: string }[] = [
			{ id: 'node', name: 'Node.js Syntax Checker', bin: 'node', args: ['--version'], category: 'compiler', licenseNote: 'MIT', installHint: 'Install Node.js LTS' },
			{ id: 'tsc', name: 'TypeScript Compiler (tsc)', bin: process.platform === 'win32' ? 'tsc.cmd' : 'tsc', args: ['--version'], category: 'compiler', licenseNote: 'Apache-2.0', installHint: 'npm i -D typescript' },
			{ id: 'python', name: 'Python Compiler (py_compile)', bin: 'python', args: ['--version'], category: 'compiler', licenseNote: 'PSF', installHint: 'Install Python 3' },
			{ id: 'semgrep', name: 'Semgrep SAST Adapter', bin: 'semgrep', args: ['--version'], category: 'sast', licenseNote: 'LGPL-2.1 (CLI)', installHint: 'pip install semgrep' },
			{ id: 'gitleaks', name: 'Gitleaks Secret Scanner', bin: 'gitleaks', args: ['version'], category: 'secrets', licenseNote: 'MIT', installHint: 'Install gitleaks binary' },
			{ id: 'trivy', name: 'Trivy Vulnerability & IaC Scanner', bin: 'trivy', args: ['--version'], category: 'dependency', licenseNote: 'Apache-2.0', installHint: 'Install Aquasecurity Trivy' },
			{ id: 'osv-scanner', name: 'OSV-Scanner Advisory Adapter', bin: 'osv-scanner', args: ['--version'], category: 'dependency', licenseNote: 'Apache-2.0', installHint: 'Install Google OSV-Scanner' },
		];

		return Promise.all(specs.map(async s => {
			const res = await execFileSafe(s.bin, s.args, cwd, 4000);
			return {
				id: s.id,
				name: s.name,
				category: s.category,
				available: res.ok && !res.missing,
				version: res.ok ? (res.stdout || res.stderr).split(/\r?\n/)[0]?.slice(0, 80) : undefined,
				licenseNote: s.licenseNote,
				installHint: s.installHint,
			};
		}));
	}

	async detectLocalRuntimes(): Promise<KacraeLocalRuntimeStatus[]> {
		const totalRamGb = Math.round(os.totalmem() / (1024 ** 3));
		const hardwareNote = `Detected ${totalRamGb} GB system RAM, ${os.cpus().length} CPU threads (${os.platform()}/${os.arch()}).`;
		const checkedAt = new Date().toISOString();

		const [ollamaCli, ollamaHttp, lmStudioHttp, vllmHttp] = await Promise.all([
			execFileSafe('ollama', ['--version'], process.cwd(), 3000),
			probeLocalHttpJson('http://127.0.0.1:11434/api/tags'),
			probeLocalHttpJson('http://127.0.0.1:1234/v1/models'),
			probeLocalHttpJson('http://127.0.0.1:8000/v1/models'),
		]);

		const ollamaModels = Array.isArray((ollamaHttp.data as { models?: unknown[] } | undefined)?.models)
			? ((ollamaHttp.data as { models: { name?: string; size?: number }[] }).models).map(m => ({
				name: String(m.name ?? 'unknown'),
				sizeGb: typeof m.size === 'number' ? Number((m.size / (1024 ** 3)).toFixed(1)) : undefined,
			}))
			: [];

		const lmModels = Array.isArray((lmStudioHttp.data as { data?: unknown[] } | undefined)?.data)
			? ((lmStudioHttp.data as { data: { id?: string }[] }).data).map(m => ({ name: String(m.id ?? 'unknown') }))
			: [];

		const vllmModels = Array.isArray((vllmHttp.data as { data?: unknown[] } | undefined)?.data)
			? ((vllmHttp.data as { data: { id?: string }[] }).data).map(m => ({ name: String(m.id ?? 'unknown') }))
			: [];

		const recModel = totalRamGb >= 32 ? 'qwen2.5-coder:32b' : totalRamGb >= 16 ? 'qwen2.5-coder:14b' : 'qwen2.5-coder:7b';

		return [
			{
				runtime: 'ollama',
				installed: ollamaCli.ok || ollamaHttp.ok,
				endpoint: 'http://127.0.0.1:11434',
				reachable: ollamaHttp.ok,
				models: ollamaModels,
				recommendedModel: recModel,
				hardwareNote,
				setupSteps: ollamaHttp.ok
					? ollamaModels.length > 0 ? ['Ollama is running and ready for offline private reviews.'] : [`Run: ollama pull ${recModel}`]
					: ['Install Ollama from https://ollama.com', 'Start Ollama service', `Run: ollama pull ${recModel}`],
				checkedAt,
			},
			{
				runtime: 'lmStudio',
				installed: lmStudioHttp.ok,
				endpoint: 'http://127.0.0.1:1234/v1',
				reachable: lmStudioHttp.ok,
				models: lmModels,
				recommendedModel: recModel,
				hardwareNote,
				setupSteps: lmStudioHttp.ok
					? ['LM Studio OpenAI-compatible server is reachable.']
					: ['Install LM Studio from https://lmstudio.ai', 'Load a code model and start Local Server on port 1234'],
				checkedAt,
			},
			{
				runtime: 'vLLM',
				installed: vllmHttp.ok,
				endpoint: 'http://127.0.0.1:8000/v1',
				reachable: vllmHttp.ok,
				models: vllmModels,
				recommendedModel: recModel,
				hardwareNote,
				setupSteps: vllmHttp.ok
					? ['vLLM server is reachable.']
					: ['Run vllm serve <model> --port 8000 for high-throughput local/on-prem enterprise inference.'],
				checkedAt,
			},
		];
	}

	// ========================================================================
	// Report Export (Part 24.8)
	// ========================================================================

	async exportReport(request: KacraeExportReportRequest): Promise<KacraeExportReportResult> {
		const sessions = this._readJson<KacraeReviewSession[]>(request.workspaceRoot, 'sessions.json', []);
		const session = sessions.find(s => s.id === request.sessionId) ?? sessions[0];
		if (!session) {
			throw new Error(`No review session found for export (${request.sessionId}).`);
		}
		const content = renderKacraeReport(session, { format: request.format, reportType: request.reportType });
		const extMap: Record<KacraeExportReportRequest['format'], string> = {
			html: 'html', pdf_html: 'print.html', json: 'json', markdown: 'md', sarif: 'sarif.json',
		};
		const reportsDir = path.join(this._storeDir(request.workspaceRoot), 'reports');
		fs.mkdirSync(reportsDir, { recursive: true });
		const outPath = request.outputPath
			? path.resolve(request.workspaceRoot, request.outputPath)
			: path.join(reportsDir, `kacrae-${request.reportType}-${session.id}.${extMap[request.format]}`);
		fs.writeFileSync(outPath, content, 'utf8');

		this._appendAudit(request.workspaceRoot, {
			actor: os.userInfo().username,
			role: 'reviewer',
			action: 'report_exported',
			repository: request.workspaceRoot,
			sessionId: session.id,
			toolsUsed: ['kacrae-report-designer'],
			modelsUsed: [],
			filesAffected: [normRel(path.relative(request.workspaceRoot, outPath))],
			detail: `Exported ${request.reportType} report as ${request.format} (${Buffer.byteLength(content, 'utf8')} bytes)`,
		});

		return {
			format: request.format,
			filePath: outPath,
			content,
			bytes: Buffer.byteLength(content, 'utf8'),
		};
	}

	// ========================================================================
	// Permanent Quality & Large-Repository Scalability Benchmark (Part 41)
	// ========================================================================

	async runQualityBenchmark(workspaceRoot: string, opts?: { includeScaleFiles?: number }): Promise<KacraeBenchmarkReport> {
		const corpus: readonly { id: string; kind: 'true_defect' | 'valid_benign'; expected: string; files: ScannedSourceFile[] }[] = [
			{
				id: 'tp-off-by-one',
				kind: 'true_defect',
				expected: 'KACRAE-CORR-001',
				files: [{ relativePath: 'src/sum.ts', content: 'export function sum(xs: number[]) { let s = 0; for (let i = 0; i <= xs.length; i++) { s += xs[i]; } return s; }\n' }],
			},
			{
				id: 'tp-discount-bug',
				kind: 'true_defect',
				expected: 'KACRAE-BIZ-002',
				files: [{ relativePath: 'src/checkout.ts', content: 'export function applyDiscount(price: number, discount: number) { return price + discount; }\n' }],
			},
			{
				id: 'tp-tenant-idor',
				kind: 'true_defect',
				expected: 'KACRAE-TENANT-001',
				files: [{ relativePath: 'src/tenantApi.ts', content: 'export async function getInvoices(req: any, db: any) { const tenantId = req.query.tenantId; return db.query("SELECT * FROM invoices WHERE tenant_id = $1", [tenantId]); }\n' }],
			},
			{
				id: 'tp-concurrency-toctou',
				kind: 'true_defect',
				expected: 'KACRAE-CONC-001',
				files: [{ relativePath: 'src/booking.ts', content: 'export async function reserveSeat(repo: any, seatId: string) { const seats = await repo.get(seatId); if (seats > 0) { await repo.log(seatId); await repo.set(seatId, seats - 1); } }\n' }],
			},
			{
				id: 'tp-db-destructive-mig',
				kind: 'true_defect',
				expected: 'KACRAE-DB-MIG-001',
				files: [{ relativePath: 'migrations/002_drop.sql', content: 'DROP TABLE legacy_payments;\nCREATE INDEX idx_orders_user ON orders(user_id);\n' }],
			},
			{
				id: 'tp-sqli-taint',
				kind: 'true_defect',
				expected: 'security',
				files: [{ relativePath: 'src/search.ts', content: 'export async function findUser(req: any, db: any) { const name = req.query.name; return db.query(`SELECT id FROM users WHERE name = \'${name}\'`); }\n' }],
			},
			{
				id: 'tp-api-drift',
				kind: 'true_defect',
				expected: 'KACRAE-API-CONTRACT-001',
				files: [
					{ relativePath: 'openapi.json', content: JSON.stringify({ openapi: '3.0.0', paths: { '/v1/orders': { get: {} }, '/v1/refunds': { post: {} } } }) },
					{ relativePath: 'src/server.ts', content: 'app.get("/v1/orders", (req, res) => res.json([]));\n' },
				],
			},
			{
				id: 'tn-parameterized-sql',
				kind: 'valid_benign',
				expected: 'none',
				files: [
					{ relativePath: 'src/safeRepo.ts', content: 'export async function getOrder(db: any, tenantId: string, id: string) { return db.query("SELECT id, total FROM orders WHERE id = $1 AND tenant_id = $2", [id, tenantId]); }\n' },
					{ relativePath: 'src/safeRepo.test.ts', content: 'import assert from "assert"; test("safeRepo", () => { assert.strictEqual(1 + 1, 2); });\n' },
				],
			},
			{
				id: 'tn-validated-path',
				kind: 'valid_benign',
				expected: 'none',
				files: [
					{ relativePath: 'src/safeFs.ts', content: 'import path from "path"; export function resolveAsset(base: string, rel: string) { const p = path.resolve(base, rel); if (!p.startsWith(base)) throw new Error("bad"); return p; }\n' },
					{ relativePath: 'src/safeFs.test.ts', content: 'import assert from "assert"; test("safeFs", () => { assert.ok(resolveAsset("/a", "b")); });\n' },
				],
			},
			{
				id: 'tn-example-env',
				kind: 'valid_benign',
				expected: 'none',
				files: [{ relativePath: '.env.example', content: 'API_KEY="your_api_key_placeholder_here"\n' }],
			},
		];

		const cases: KacraeBenchmarkCaseResult[] = [];
		let tp = 0; let fp = 0; let tn = 0; let fn = 0; let totalLatency = 0;

		for (const c of corpus) {
			const c0 = Date.now();
			const res = analyzeKacraeSourceFiles(c.files);
			const dt = Math.max(0.1, Date.now() - c0);
			totalLatency += dt;

			if (c.kind === 'true_defect') {
				const matched = res.findings.some(f => f.ruleId === c.expected || f.category === c.expected);
				if (matched) { tp++; } else { fn++; }
				cases.push({ id: c.id, kind: c.kind, expectedRuleOrCategory: c.expected, detected: matched, falsePositiveConfirmed: false, latencyMs: dt, findingCount: res.findings.length });
			} else {
				const confirmedFp = res.findings.some(f => f.classification === 'confirmed_defect' && (f.severity === 'critical' || f.severity === 'high'));
				if (confirmedFp) { fp++; } else { tn++; }
				cases.push({ id: c.id, kind: c.kind, expectedRuleOrCategory: 'none', detected: false, falsePositiveConfirmed: confirmedFp, latencyMs: dt, findingCount: res.findings.length });
			}
		}

		let scaleBenchmark: KacraeBenchmarkReport['scaleBenchmark'] = undefined;
		if (opts?.includeScaleFiles && opts.includeScaleFiles > 0) {
			const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kacrae-scale-bench-'));
			try {
				const count = Math.min(opts.includeScaleFiles, 20_000);
				for (let pkg = 0; pkg < Math.ceil(count / 100); pkg++) {
					const pkgDir = path.join(tmpDir, 'packages', `svc-${pkg}`);
					fs.mkdirSync(pkgDir, { recursive: true });
					for (let f = 0; f < 100 && pkg * 100 + f < count; f++) {
						const idx = pkg * 100 + f;
						const imp = f > 0 ? `import { fn_${idx - 1} } from './mod_${f - 1}.js';\n` : '';
						fs.writeFileSync(path.join(pkgDir, `mod_${f}.ts`), `${imp}export function fn_${idx}(x: number) { return x + ${idx}; }\n`, 'utf8');
					}
				}
				const run1 = await this._indexer.indexWorkspace(tmpDir, { concurrency: 8, incremental: true });
				// Modify 1 file and run incremental rescan
				fs.writeFileSync(path.join(tmpDir, 'packages', 'svc-0', 'mod_0.ts'), 'export function fn_0(x: number) { return x + 42; }\n', 'utf8');
				const run2 = await this._indexer.indexWorkspace(tmpDir, { concurrency: 8, incremental: true });
				scaleBenchmark = {
					fileCount: count,
					fullIndexMs: run1.stats.durationMs,
					incrementalRescanMs: run2.stats.durationMs,
					throughputFilesPerSec: run1.stats.throughputFilesPerSec,
					peakHeapMb: run1.stats.peakHeapMb,
					unchangedSkipped: run2.stats.unchangedCachedFiles,
				};
			} finally {
				fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
			}
		}

		const precision = tp + fp > 0 ? Number((tp / (tp + fp)).toFixed(3)) : 1;
		const recall = tp + fn > 0 ? Number((tp / (tp + fn)).toFixed(3)) : 1;
		const fpr = fp + tn > 0 ? Number((fp / (fp + tn)).toFixed(3)) : 0;
		const f1Score = precision + recall > 0 ? Number(((2 * precision * recall) / (precision + recall)).toFixed(3)) : 0;

		const report: KacraeBenchmarkReport = {
			runAt: new Date().toISOString(),
			corpusSize: corpus.length,
			truePositives: tp,
			falsePositives: fp,
			trueNegatives: tn,
			falseNegatives: fn,
			precision,
			recall,
			falsePositiveRate: fpr,
			f1Score,
			avgLatencyMs: Number((totalLatency / corpus.length).toFixed(2)),
			scaleBenchmark,
			cases,
			note: 'Measured strictly on Kodia KACRAE controlled corpus (no external competitor claims without reproducible side-by-side runs).',
		};

		if (workspaceRoot && fs.existsSync(workspaceRoot)) {
			this._writeJsonAtomic(workspaceRoot, 'benchmark.json', report);
		}
		return report;
	}

	// ========================================================================
	// Functional Completeness & Live Runtime / Browser Verification
	// ========================================================================

	async verifyFunctionalCompleteness(workspaceRoot: string, opts?: {
		appUrl?: string;
		apiBaseUrl?: string;
		useBrowser?: boolean;
		testCommand?: string;
		targetFiles?: readonly string[];
	}): Promise<KacraeFunctionalCompletenessReport> {
		const sessionId = `fc-${Date.now().toString(36)}`;
		this._emit(sessionId, 'analyzer_started', 'functional_completeness', `Running Functional Completeness & Static-UI Verification for ${workspaceRoot}`);

		const { graph } = await this.indexRepository(workspaceRoot, { incremental: true, sessionId });
		const relPaths = opts?.targetFiles?.length
			? opts.targetFiles.map(f => path.isAbsolute(f) ? normRel(path.relative(workspaceRoot, f)) : normRel(f))
			: graph.nodes.map(n => n.id).slice(0, 600);

		const files: ScannedSourceFile[] = [];
		for (const rel of relPaths) {
			const abs = path.join(workspaceRoot, rel);
			try {
				const st = fs.statSync(abs);
				if (st.isFile() && st.size <= 512 * 1024) {
					files.push({ relativePath: rel, content: fs.readFileSync(abs, 'utf8') });
				}
			} catch { /* ignore */ }
		}

		const baseReport = analyzeFunctionalCompleteness(files);
		const matrix: KacraeFunctionalMatrixRow[] = [...baseReport.matrix];
		const extraFindings: KacraeFinding[] = [...baseReport.findings];
		const limitations: string[] = [...baseReport.honestLimitations];
		let apiVerified = false;
		let browserVerified = false;

		// 1. Live HTTP API probing when apiBaseUrl or appUrl is provided
		const probeBase = opts?.apiBaseUrl ?? opts?.appUrl;
		if (probeBase) {
			try {
				const rootProbe = await probeLocalHttpJson(probeBase, 3000);
				apiVerified = true;
				matrix.push({
					id: `fc-http-root-${Date.now().toString(36)}`,
					feature: `Live HTTP endpoint availability (${probeBase})`,
					expectedBehavior: 'Application server responds with healthy HTTP status (< 400)',
					sourceFiles: [],
					uiComponents: [],
					backendDependencies: [probeBase],
					verificationMethod: 'api_probe',
					evidence: [rootProbe.ok ? `HTTP probe succeeded at ${probeBase}` : `HTTP probe failed or returned >= 400 at ${probeBase}`],
					testResults: rootProbe.ok ? 'HTTP 2xx/3xx response observed' : 'Endpoint unreachable or returned error status',
					status: rootProbe.ok ? 'complete' : 'broken',
					certainty: rootProbe.ok ? 'verified_working' : 'confirmed_failure',
					severity: rootProbe.ok ? 'info' : 'critical',
					remediation: rootProbe.ok ? 'Continue with workflow assertions.' : 'Start the application server and verify route handlers return 2xx.',
				});
			} catch (e) {
				limitations.push(`API probe error for ${probeBase}: ${e instanceof Error ? e.message : String(e)}`);
			}
		}

		// 2. Real Live Browser Functional Verification (clicks controls & asserts OBSERVABLE outcomes!)
		if (opts?.appUrl && opts.useBrowser !== false && this._browserService) {
			let browserSessionId: string | null = null;
			try {
				const launch = await this._browserService.launchBrowser({ headless: true, viewport: { width: 1280, height: 800 } });
				browserSessionId = launch.sessionId;
				const tab = await this._browserService.newTab(browserSessionId, { url: opts.appUrl });
				const initial = await this._browserService.inspectPage(browserSessionId, tab.tabId);
				browserVerified = true;

				if (initial.consoleErrors > 0 || initial.networkFailures > 0) {
					matrix.push({
						id: `fc-browser-runtime-err-${Date.now().toString(36)}`,
						feature: `Live browser runtime health (${opts.appUrl})`,
						expectedBehavior: 'Page loads with zero uncaught console errors and zero failed network requests',
						sourceFiles: [],
						uiComponents: [opts.appUrl],
						backendDependencies: initial.recentNetworkFailures,
						verificationMethod: 'browser_e2e',
						evidence: [...initial.recentConsoleErrors.slice(0, 5), ...initial.recentNetworkFailures.slice(0, 5)],
						testResults: `${initial.consoleErrors} console error(s), ${initial.networkFailures} network failure(s)`,
						status: 'broken',
						certainty: 'confirmed_failure',
						severity: 'high',
						remediation: 'Fix uncaught runtime exceptions and failing network/API requests observed during live page load.',
					});
				}

				// Interact with up to 5 visible, enabled buttons and verify OBSERVABLE state change (DOM text, URL, or network activity!)
				const interactiveButtons = initial.elements.filter(el => el.type === 'button' && el.visible && !el.disabled).slice(0, 5);
				for (const btn of interactiveButtons) {
					const beforeText = (await this._browserService.inspectPage(browserSessionId, tab.tabId)).text;
					const beforeUrl = (await this._browserService.inspectPage(browserSessionId, tab.tabId)).url;
					const beforeNetCount = (await this._browserService.getNetworkLog(browserSessionId, tab.tabId, { limit: 200 })).length;
					let clickFailed = false;
					let clickErr = '';
					try {
						await this._browserService.clickElement(browserSessionId, tab.tabId, btn.selector);
						await new Promise(r => setTimeout(r, 150));
					} catch (ce) {
						clickFailed = true;
						clickErr = ce instanceof Error ? ce.message : String(ce);
					}
					const afterInspect = await this._browserService.inspectPage(browserSessionId, tab.tabId);
					const afterNetCount = (await this._browserService.getNetworkLog(browserSessionId, tab.tabId, { limit: 200 })).length;
					const observableChange = afterInspect.text !== beforeText || afterInspect.url !== beforeUrl || afterNetCount > beforeNetCount;

					if (clickFailed) {
						matrix.push({
							id: `fc-btn-fail-${sha256Text(btn.selector).slice(0, 8)}`,
							feature: `UI Button "${btn.label || btn.selector}"`,
							expectedBehavior: 'Button is clickable and produces observable application behavior',
							sourceFiles: [],
							uiComponents: [btn.selector],
							backendDependencies: [],
							verificationMethod: 'browser_e2e',
							evidence: [`Click failed on ${btn.selector}: ${clickErr}`],
							testResults: 'Browser interaction threw an error',
							status: 'broken',
							certainty: 'confirmed_failure',
							severity: 'high',
							remediation: 'Ensure the control is unobstructed, mounted, and handles click events cleanly.',
						});
					} else if (!observableChange) {
						matrix.push({
							id: `fc-btn-noop-${sha256Text(btn.selector).slice(0, 8)}`,
							feature: `UI Button "${btn.label || btn.selector}"`,
							expectedBehavior: 'Clicking button produces an observable DOM, route, or network outcome',
							sourceFiles: [],
							uiComponents: [btn.selector],
							backendDependencies: [],
							verificationMethod: 'browser_e2e',
							evidence: [`Clicked "${btn.label || btn.selector}" at ${opts.appUrl}: DOM text, URL, and network log remained identical.`],
							testResults: 'No observable outcome after real browser click (suspected static/dead button)',
							status: 'nonfunctional',
							certainty: 'confirmed_failure',
							severity: 'high',
							remediation: 'Wire this button to real UI state mutation, navigation, or backend API persistence.',
						});
					} else {
						matrix.push({
							id: `fc-btn-ok-${sha256Text(btn.selector).slice(0, 8)}`,
							feature: `UI Button "${btn.label || btn.selector}"`,
							expectedBehavior: 'Clicking button produces an observable application outcome',
							sourceFiles: [],
							uiComponents: [btn.selector],
							backendDependencies: [],
							verificationMethod: 'browser_e2e',
							evidence: [
								afterInspect.url !== beforeUrl ? `Navigated to ${afterInspect.url}` : '',
								afterInspect.text !== beforeText ? 'Observable DOM state updated' : '',
								afterNetCount > beforeNetCount ? `Triggered ${afterNetCount - beforeNetCount} network request(s)` : '',
							].filter(Boolean),
							testResults: 'Verified observable behavior in live Chromium browser',
							status: 'complete',
							certainty: 'verified_working',
							severity: 'info',
							remediation: 'No action needed.',
						});
					}
				}
			} catch (e) {
				limitations.push(`Browser functional verification unavailable (${e instanceof Error ? e.message : String(e)}). Static call-graph results remain intact.`);
			} finally {
				if (browserSessionId) {
					try { await this._browserService.closeBrowser(browserSessionId); } catch { /* ignore */ }
				}
			}
		} else if (opts?.appUrl && !this._browserService) {
			limitations.push('Live browser service was not attached in this host context; executed static + HTTP probe checks only.');
		}

		// 3. Optional automated test execution
		if (opts?.testCommand) {
			const testRes = await runShellSafe(opts.testCommand, workspaceRoot, 45_000);
			matrix.push({
				id: `fc-test-${Date.now().toString(36)}`,
				feature: `Automated Test Suite (${opts.testCommand})`,
				expectedBehavior: 'All automated functional/integration tests pass with exit code 0',
				sourceFiles: [],
				uiComponents: [],
				backendDependencies: [],
				verificationMethod: 'automated_test',
				evidence: [redactSecretsInText(`${testRes.stdout}\n${testRes.stderr}`).slice(0, 500)],
				testResults: testRes.ok ? 'PASS (exit 0)' : `FAIL (exit ${testRes.code})`,
				status: testRes.ok ? 'complete' : 'broken',
				certainty: testRes.ok ? 'verified_working' : 'confirmed_failure',
				severity: testRes.ok ? 'info' : 'critical',
				remediation: testRes.ok ? 'Maintain test coverage.' : 'Investigate failing test output and repair root cause.',
			});
		}

		const counts = {
			complete: matrix.filter(m => m.status === 'complete').length,
			partially_implemented: matrix.filter(m => m.status === 'partially_implemented').length,
			nonfunctional: matrix.filter(m => m.status === 'nonfunctional').length,
			placeholder: matrix.filter(m => m.status === 'placeholder').length,
			broken: matrix.filter(m => m.status === 'broken').length,
			unverified: matrix.filter(m => m.status === 'unverified').length,
		};

		const finalReport: KacraeFunctionalCompletenessReport = {
			...baseReport,
			analyzedAt: new Date().toISOString(),
			appUrl: opts?.appUrl,
			browserVerified,
			apiVerified,
			counts,
			matrix,
			findings: extraFindings,
			summary: `Functional Completeness Matrix (${matrix.length} features): ${counts.complete} complete, ${counts.partially_implemented} partial, ${counts.placeholder} placeholder, ${counts.nonfunctional} nonfunctional, ${counts.broken} broken, ${counts.unverified} unverified. Browser verified=${browserVerified}, API verified=${apiVerified}.`,
			honestLimitations: limitations,
		};

		this._writeJsonAtomic(workspaceRoot, 'functional-completeness.json', finalReport);
		this._emit(sessionId, 'verification_completed', 'functional_completeness', finalReport.summary);
		return finalReport;
	}
}
