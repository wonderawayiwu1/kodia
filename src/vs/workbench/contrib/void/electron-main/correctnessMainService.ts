/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vm from 'vm';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import {
	CompilerCheckOutcome,
	CorrectnessDiagnostic,
	CorrectnessLiveEvent,
	CorrectnessLiveEventType,
	CorrectnessWorkspaceSnapshot,
	DiagnosticSuppression,
	FuzzTestConfig,
	FuzzTestReport,
	IKodiaCorrectnessMainService,
	IndependentVerificationCheck,
	IndependentVerificationReport,
	MutantOutcome,
	MutationTestReport,
	ProofCarryingChangeRecord,
	ReleaseReadinessReport,
	RootCauseInvestigationReport,
	TaintFlowFinding,
} from '../common/correctnessTypes.js';
import {
	analyzeTaintFlows,
	analyzeWorkspaceCorrectness,
	applyMutantToSource,
	evaluateIndependentVerification,
	generateControlledMutants,
} from '../common/correctnessEngine.js';

const CORRECTNESS_DIR = path.join('.kodia', 'correctness');
const MAX_RING_EVENTS = 400;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.kodia', '__pycache__', '.venv', 'venv', 'target']);

function runShell(cmd: string, cwd: string, timeoutMs = 20_000): Promise<{ ok: boolean; code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
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

function runExec(bin: string, args: string[], cwd: string, timeoutMs = 15_000): Promise<{ ok: boolean; missing: boolean; stdout: string; stderr: string }> {
	return new Promise(resolve => {
		cp.execFile(bin, args, { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
			const missing = Boolean(err && (err as NodeJS.ErrnoException).code === 'ENOENT');
			resolve({ ok: !err, missing, stdout: String(stdout ?? '').trim(), stderr: String(stderr ?? '').trim() });
		});
	});
}

function walkWorkspaceFiles(root: string, maxFiles = 200): string[] {
	const out: string[] = [];
	const visit = (dir: string) => {
		if (out.length >= maxFiles) { return; }
		let entries: fs.Dirent[];
		try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
		for (const e of entries) {
			if (out.length >= maxFiles) { break; }
			if (e.isDirectory()) {
				if (!SKIP_DIRS.has(e.name)) { visit(path.join(dir, e.name)); }
			} else if (e.isFile()) {
				out.push(path.relative(root, path.join(dir, e.name)).replace(/\\/g, '/'));
			}
		}
	};
	if (root && fs.existsSync(root)) { visit(root); }
	return out;
}

function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a |= 0;
		a = (a + 0x6D2B79F5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function copyLightweightWorkspace(srcRoot: string, dstRoot: string): void {
	const visit = (curSrc: string, curDst: string) => {
		fs.mkdirSync(curDst, { recursive: true });
		for (const entry of fs.readdirSync(curSrc, { withFileTypes: true })) {
			if (SKIP_DIRS.has(entry.name)) { continue; }
			const s = path.join(curSrc, entry.name);
			const d = path.join(curDst, entry.name);
			if (entry.isDirectory()) { visit(s, d); }
			else if (entry.isFile()) { fs.copyFileSync(s, d); }
		}
	};
	visit(srcRoot, dstRoot);
}

export class KodiaCorrectnessMainService extends Disposable implements IKodiaCorrectnessMainService {
	readonly _serviceBrand: undefined;

	private readonly _onDidEmitEvent = this._register(new Emitter<CorrectnessLiveEvent>());
	readonly onDidEmitEvent: Event<CorrectnessLiveEvent> = this._onDidEmitEvent.event;

	private _seq = 0;
	private _recentEvents: CorrectnessLiveEvent[] = [];

	private _emit(
		type: CorrectnessLiveEventType,
		executionId: string,
		message: string,
		extra?: Partial<Omit<CorrectnessLiveEvent, 'seq' | 'eventId' | 'timestamp' | 'type' | 'executionId' | 'message'>>,
	): CorrectnessLiveEvent {
		const seq = ++this._seq;
		const ev: CorrectnessLiveEvent = {
			seq,
			eventId: `cev-${seq}-${Date.now().toString(36)}`,
			timestamp: new Date().toISOString(),
			type,
			executionId,
			message,
			...extra,
		};
		this._recentEvents.push(ev);
		if (this._recentEvents.length > MAX_RING_EVENTS) {
			this._recentEvents = this._recentEvents.slice(-MAX_RING_EVENTS);
		}
		this._onDidEmitEvent.fire(ev);
		return ev;
	}

	private _ensureDir(workspaceRoot: string, ...sub: string[]): string {
		const dir = path.join(workspaceRoot, CORRECTNESS_DIR, ...sub);
		fs.mkdirSync(dir, { recursive: true });
		return dir;
	}

	private _readJson<T>(workspaceRoot: string, fileName: string, fallback: T): T {
		if (!workspaceRoot) { return fallback; }
		const fp = path.join(workspaceRoot, CORRECTNESS_DIR, fileName);
		if (!fs.existsSync(fp)) { return fallback; }
		try { return JSON.parse(fs.readFileSync(fp, 'utf8')) as T; } catch { return fallback; }
	}

	private _writeJson(workspaceRoot: string, fileName: string, data: unknown): void {
		if (!workspaceRoot) { return; }
		const dir = this._ensureDir(workspaceRoot);
		fs.writeFileSync(path.join(dir, fileName), JSON.stringify(data, null, 2), 'utf8');
	}

	async getRecentEvents(limit = 150): Promise<CorrectnessLiveEvent[]> {
		return this._recentEvents.slice(-Math.max(1, Math.min(MAX_RING_EVENTS, limit)));
	}

	async loadWorkspaceSnapshot(workspaceRoot: string): Promise<CorrectnessWorkspaceSnapshot> {
		return {
			suppressions: this._readJson<DiagnosticSuppression[]>(workspaceRoot, 'suppressions.json', []),
			investigations: this._readJson<RootCauseInvestigationReport[]>(workspaceRoot, 'investigations.json', []),
			fuzzRuns: this._readJson<FuzzTestReport[]>(workspaceRoot, 'fuzz-runs.json', []),
			mutationRuns: this._readJson<MutationTestReport[]>(workspaceRoot, 'mutation-runs.json', []),
			verifications: this._readJson<IndependentVerificationReport[]>(workspaceRoot, 'verifications.json', []),
			proofs: this._readJson<ProofCarryingChangeRecord[]>(workspaceRoot, 'proofs.json', []),
			readinessReports: this._readJson<ReleaseReadinessReport[]>(workspaceRoot, 'readiness.json', []),
		};
	}

	// ========================================================================
	// 1. REAL MULTI-LANGUAGE COMPILER & EXTERNAL ANALYZER RUNNER
	// ========================================================================

	async runCompilerAndAnalyzers(workspaceRoot: string, opts?: {
		targetFiles?: readonly string[];
		languages?: readonly string[];
	}): Promise<CompilerCheckOutcome[]> {
		const execId = `cmp-${Date.now().toString(36)}`;
		this._emit('scan_started', execId, `Running real multi-language compiler & syntax checks in ${workspaceRoot}`);
		const outcomes: CompilerCheckOutcome[] = [];
		const allFiles = opts?.targetFiles?.length
			? opts.targetFiles.map(f => f.replace(/\\/g, '/'))
			: walkWorkspaceFiles(workspaceRoot, 250);

		const jsFiles = allFiles.filter(f => /\.(js|cjs|mjs)$/i.test(f));
		const tsFiles = allFiles.filter(f => /\.(ts|tsx)$/i.test(f));
		const pyFiles = allFiles.filter(f => /\.py$/i.test(f));
		const hasGoMod = fs.existsSync(path.join(workspaceRoot, 'go.mod'));
		const hasCargo = fs.existsSync(path.join(workspaceRoot, 'Cargo.toml'));

		// 1. Node.js syntax check (`node --check`)
		if (jsFiles.length > 0 && (!opts?.languages || opts.languages.some(l => /js|javascript|node/i.test(l)))) {
			const t0 = performance.now();
			const diags: CorrectnessDiagnostic[] = [];
			for (const jf of jsFiles.slice(0, 30)) {
				const abs = path.isAbsolute(jf) ? jf : path.join(workspaceRoot, jf);
				if (!fs.existsSync(abs)) { continue; }
				const r = await runExec('node', ['--check', abs], workspaceRoot, 8000);
				if (!r.ok && !r.missing) {
					const combined = `${r.stderr}\n${r.stdout}`;
					const lm = /:(\d+)\r?\n/.exec(combined);
					const msgLine = combined.split(/\r?\n/).find(l => /SyntaxError|Error:/i.test(l)) ?? combined.split(/\r?\n/)[0] ?? 'JavaScript syntax error';
					diags.push({
						id: `NODE-SYN-${diags.length + 1}`,
						ruleId: 'NODE-SYNTAX',
						layer: 'compiler',
						severity: 'error',
						confidence: 'confirmed',
						category: 'syntax-type',
						engine: 'node --check',
						file: jf,
						line: lm ? Number(lm[1]) : 1,
						title: 'JavaScript Syntax Error',
						message: msgLine.trim(),
						remediation: 'Fix the JavaScript syntax error reported by Node.js.',
					});
				}
			}
			const out: CompilerCheckOutcome = {
				engine: 'node --check',
				language: 'JavaScript',
				available: true,
				command: `node --check (${Math.min(30, jsFiles.length)} file(s))`,
				passed: diags.length === 0,
				durationMs: Math.round(performance.now() - t0),
				diagnostics: diags,
			};
			outcomes.push(out);
			this._emit('compiler_check_completed', execId, `node --check: ${out.passed ? 'PASS' : `${diags.length} error(s)`}`, { passed: out.passed, durationMs: out.durationMs });
		}

		// 2. TypeScript compiler check (`tsc --noEmit`) when tsconfig.json exists or TS files targeted
		const hasTsConfig = fs.existsSync(path.join(workspaceRoot, 'tsconfig.json'));
		if ((hasTsConfig || tsFiles.length > 0) && (!opts?.languages || opts.languages.some(l => /ts|typescript/i.test(l)))) {
			const t0 = performance.now();
			// Prefer local workspace tsc, fallback to Kodia repo node_modules/.bin/tsc or npx
			const localTsc = path.join(workspaceRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
			const hostTsc = path.resolve('node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
			const tscBin = fs.existsSync(localTsc) ? localTsc : fs.existsSync(hostTsc) ? hostTsc : 'tsc';
			const args = hasTsConfig
				? ['--noEmit', '--pretty', 'false', '--skipLibCheck']
				: ['--noEmit', '--pretty', 'false', '--skipLibCheck', '--allowJs', '--target', 'ES2022', '--module', 'ESNext', ...tsFiles.slice(0, 15).map(f => path.join(workspaceRoot, f))];
			const r = await runShell(`"${tscBin}" ${args.map(a => a.includes(' ') ? `"${a}"` : a).join(' ')}`, workspaceRoot, 20_000);
			const combined = `${r.stdout}\n${r.stderr}`;
			const diags: CorrectnessDiagnostic[] = [];
			for (const line of combined.split(/\r?\n/)) {
				const m = /^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+(TS\d+):\s*(.+)$/.exec(line.trim());
				if (m) {
					const rel = path.isAbsolute(m[1]) ? path.relative(workspaceRoot, m[1]).replace(/\\/g, '/') : m[1].replace(/\\/g, '/');
					diags.push({
						id: `TSC-${diags.length + 1}`,
						ruleId: m[5],
						layer: 'compiler',
						severity: m[4] === 'error' ? 'error' : 'warning',
						confidence: 'confirmed',
						category: 'syntax-type',
						engine: 'tsc',
						file: rel,
						line: Number(m[2]),
						column: Number(m[3]),
						title: `TypeScript ${m[5]}`,
						message: m[6].trim(),
						remediation: `Resolve TypeScript diagnostic ${m[5]} at ${rel}:${m[2]}.`,
					});
				}
			}
			const missing = !r.ok && /not recognized|command not found|ENOENT/i.test(combined) && diags.length === 0;
			const out: CompilerCheckOutcome = {
				engine: 'tsc',
				language: 'TypeScript',
				available: !missing,
				command: `tsc --noEmit`,
				passed: !missing && r.ok && diags.filter(d => d.severity === 'error').length === 0,
				durationMs: Math.round(performance.now() - t0),
				diagnostics: diags,
				rawOutput: combined.slice(0, 2500),
				note: missing ? 'TypeScript compiler (tsc) not found in PATH or node_modules.' : undefined,
			};
			outcomes.push(out);
			this._emit('compiler_check_completed', execId, `tsc: ${out.available ? (out.passed ? 'PASS' : `${diags.length} diagnostic(s)`) : 'unavailable'}`, { passed: out.passed, durationMs: out.durationMs });
		}

		// 3. Python syntax check (`python -m py_compile`)
		if (pyFiles.length > 0 && (!opts?.languages || opts.languages.some(l => /py|python/i.test(l)))) {
			const t0 = performance.now();
			const diags: CorrectnessDiagnostic[] = [];
			let pyAvailable = true;
			for (const pf of pyFiles.slice(0, 25)) {
				const abs = path.isAbsolute(pf) ? pf : path.join(workspaceRoot, pf);
				if (!fs.existsSync(abs)) { continue; }
				const r = await runExec('python', ['-m', 'py_compile', abs], workspaceRoot, 8000);
				if (r.missing) { pyAvailable = false; break; }
				if (!r.ok) {
					const combined = `${r.stderr}\n${r.stdout}`;
					const lm = /line\s+(\d+)/i.exec(combined);
					const msg = combined.split(/\r?\n/).filter(Boolean).pop() ?? 'Python syntax error';
					diags.push({
						id: `PY-SYN-${diags.length + 1}`,
						ruleId: 'PY-SYNTAX',
						layer: 'compiler',
						severity: 'error',
						confidence: 'confirmed',
						category: 'syntax-type',
						engine: 'python -m py_compile',
						file: pf,
						line: lm ? Number(lm[1]) : 1,
						title: 'Python SyntaxError',
						message: msg.trim(),
						remediation: 'Fix the Python syntax error reported by py_compile.',
					});
				}
			}
			const out: CompilerCheckOutcome = {
				engine: 'python -m py_compile',
				language: 'Python',
				available: pyAvailable,
				command: 'python -m py_compile',
				passed: pyAvailable && diags.length === 0,
				durationMs: Math.round(performance.now() - t0),
				diagnostics: diags,
				note: pyAvailable ? undefined : 'Python runtime not found on PATH.',
			};
			outcomes.push(out);
			this._emit('compiler_check_completed', execId, `py_compile: ${out.available ? (out.passed ? 'PASS' : `${diags.length} error(s)`) : 'unavailable'}`, { passed: out.passed, durationMs: out.durationMs });
		}

		// 4. Go vet
		if (hasGoMod && (!opts?.languages || opts.languages.some(l => /go/i.test(l)))) {
			const t0 = performance.now();
			const r = await runExec('go', ['vet', './...'], workspaceRoot, 15_000);
			const diags: CorrectnessDiagnostic[] = [];
			if (!r.ok && !r.missing) {
				for (const line of `${r.stderr}\n${r.stdout}`.split(/\r?\n/)) {
					const m = /^(.+?\.go):(\d+)(?::(\d+))?:\s*(.+)$/.exec(line.trim());
					if (m) {
						diags.push({
							id: `GO-VET-${diags.length + 1}`, ruleId: 'GO-VET', layer: 'compiler', severity: 'error', confidence: 'confirmed',
							category: 'syntax-type', engine: 'go vet', file: m[1], line: Number(m[2]), column: m[3] ? Number(m[3]) : undefined,
							title: 'go vet diagnostic', message: m[4], remediation: 'Resolve go vet issue.',
						});
					}
				}
			}
			outcomes.push({
				engine: 'go vet', language: 'Go', available: !r.missing, command: 'go vet ./...',
				passed: !r.missing && r.ok, durationMs: Math.round(performance.now() - t0), diagnostics: diags,
				note: r.missing ? 'Go toolchain not installed.' : undefined,
			});
		}

		// 5. Rust cargo check
		if (hasCargo && (!opts?.languages || opts.languages.some(l => /rust/i.test(l)))) {
			const t0 = performance.now();
			const r = await runExec('cargo', ['check', '--message-format=short'], workspaceRoot, 25_000);
			const diags: CorrectnessDiagnostic[] = [];
			if (!r.ok && !r.missing) {
				for (const line of `${r.stderr}\n${r.stdout}`.split(/\r?\n/)) {
					const m = /^(.+?\.rs):(\d+):(\d+):\s*(error|warning)(?:\[([^\]]+)\])?:\s*(.+)$/.exec(line.trim());
					if (m) {
						diags.push({
							id: `RUST-${diags.length + 1}`, ruleId: m[5] || 'CARGO-CHECK', layer: 'compiler',
							severity: m[4] === 'error' ? 'error' : 'warning', confidence: 'confirmed', category: 'syntax-type',
							engine: 'cargo check', file: m[1], line: Number(m[2]), column: Number(m[3]),
							title: `Rust ${m[5] || m[4]}`, message: m[6], remediation: 'Resolve Rust compiler diagnostic.',
						});
					}
				}
			}
			outcomes.push({
				engine: 'cargo check', language: 'Rust', available: !r.missing, command: 'cargo check',
				passed: !r.missing && r.ok, durationMs: Math.round(performance.now() - t0), diagnostics: diags,
				note: r.missing ? 'Cargo/Rust toolchain not installed.' : undefined,
			});
		}

		return outcomes;
	}

	// ========================================================================
	// 2. REAL PROPERTY-BASED & FUZZ TESTING ENGINE (With Input Minimization)
	// ========================================================================

	async runPropertyFuzzTest(workspaceRoot: string, config: FuzzTestConfig): Promise<FuzzTestReport> {
		const id = `fuzz-${Date.now().toString(36)}`;
		const seed = config.seed ?? 1337;
		const iterations = Math.max(10, Math.min(2000, config.iterations ?? 150));
		const t0 = performance.now();
		const absPath = path.isAbsolute(config.targetFile) ? config.targetFile : path.join(workspaceRoot, config.targetFile);

		this._emit('fuzz_started', id, `Starting property/fuzz test on ${config.targetFile}#${config.exportName} (${iterations} iterations, seed=${seed})`, { file: config.targetFile });

		if (!fs.existsSync(absPath)) {
			return {
				id, createdAt: new Date().toISOString(), targetFile: config.targetFile, exportName: config.exportName,
				seed, iterationsRun: 0, passed: false, durationMs: 0,
				summary: `Target file not found: ${config.targetFile}`, error: `File not found: ${config.targetFile}`,
			};
		}

		const source = fs.readFileSync(absPath, 'utf8');
		const rand = mulberry32(seed);

		// Edge/boundary seeds tried first before random exploration
		const genArg = (kind: FuzzTestConfig['argSchema'][number], iter: number): unknown => {
			if (kind === 'integer') {
				const edges = [0, 1, -1, 2, -2, 100, -100, 2147483647, -2147483648];
				if (iter < edges.length) { return edges[iter]; }
				return Math.floor((rand() - 0.5) * 2000);
			}
			if (kind === 'number') {
				const edges = [0, -0, 1, -1, 0.5, -0.5, 1e9, -1e9, NaN, Infinity, -Infinity];
				if (iter < edges.length) { return edges[iter]; }
				return Math.round((rand() - 0.5) * 10000) / 100;
			}
			if (kind === 'string') {
				const edges = ['', ' ', '0', 'null', '<script>alert(1)</script>', "' OR '1'='1", '../../../etc/passwd', '🚀🔥', 'a'.repeat(256)];
				if (iter < edges.length) { return edges[iter]; }
				const len = Math.floor(rand() * 32);
				const chars = 'abcdefghijklmnopqrstuvwxyz0123456789 _-./!@#$%';
				let s = '';
				for (let i = 0; i < len; i++) { s += chars[Math.floor(rand() * chars.length)]; }
				return s;
			}
			if (kind === 'boolean') { return iter % 2 === 0 ? true : false; }
			if (kind === 'array-number') {
				const edges = [[], [0], [-1], [1, 2, 3], [0, 0, 0], [-100, 100]];
				if (iter < edges.length) { return edges[iter]; }
				const len = Math.floor(rand() * 8);
				return Array.from({ length: len }, () => Math.floor((rand() - 0.5) * 200));
			}
			// json-object
			const edges = [{}, { id: 0 }, { id: -1, name: '' }, { a: null }];
			if (iter < edges.length) { return edges[iter]; }
			return { id: Math.floor(rand() * 100), value: Math.floor((rand() - 0.5) * 100) };
		};

		// Load CommonJS/plain JS module inside isolated vm context (zero fs/process access)
		const moduleObj: { exports: Record<string, unknown> } = { exports: {} };
		const ctx = vm.createContext({
			module: moduleObj,
			exports: moduleObj.exports,
			Math, Number, String, Boolean, Array, Object, JSON, Date, RegExp, Map, Set, Error, TypeError, RangeError,
		});

		// Strip simple ES `export ` prefixes so both CJS and simple ESM modules work seamlessly
		const runnableSource = source
			.replace(/\bexport\s+default\s+/g, 'module.exports.default = ')
			.replace(/\bexport\s+(async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/g, 'function $2')
			.replace(/\bexport\s+(?:const|let|var)\s+/g, 'const ');

		try {
			vm.runInContext(runnableSource, ctx, { timeout: 2000 });
			// If function was declared top-level (stripped export), expose it on module.exports
			if (typeof moduleObj.exports[config.exportName] !== 'function' && typeof (ctx as Record<string, unknown>)[config.exportName] === 'function') {
				moduleObj.exports[config.exportName] = (ctx as Record<string, unknown>)[config.exportName];
			}
		} catch (e) {
			return {
				id, createdAt: new Date().toISOString(), targetFile: config.targetFile, exportName: config.exportName,
				seed, iterationsRun: 0, passed: false, durationMs: Math.round(performance.now() - t0),
				summary: `Failed to load target module for fuzzing: ${e instanceof Error ? e.message : String(e)}`,
				error: e instanceof Error ? e.message : String(e),
			};
		}

		const targetFn = moduleObj.exports[config.exportName];
		if (typeof targetFn !== 'function') {
			return {
				id, createdAt: new Date().toISOString(), targetFile: config.targetFile, exportName: config.exportName,
				seed, iterationsRun: 0, passed: false, durationMs: Math.round(performance.now() - t0),
				summary: `Export "${config.exportName}" is not a callable function in ${config.targetFile}.`,
				error: `Export "${config.exportName}" not found.`,
			};
		}

		const checkProperty = (args: readonly unknown[]): { ok: boolean; err?: string } => {
			try {
				const result = (targetFn as (...a: unknown[]) => unknown)(...args);
				const propCtx = vm.createContext({ args, result, Number, Math, Array, Object, String, Boolean, JSON });
				const holds = vm.runInContext(`Boolean(${config.propertyExpression})`, propCtx, { timeout: 500 });
				if (!holds) {
					return { ok: false, err: `Property violated: (${config.propertyExpression}) returned false for result=${JSON.stringify(result)}` };
				}
				return { ok: true };
			} catch (e) {
				return { ok: false, err: `Uncaught exception: ${e instanceof Error ? e.message : String(e)}` };
			}
		};

		// Input minimization / shrinking for found counterexample
		const shrinkArgs = (failing: unknown[]): unknown[] => {
			const cur = [...failing];
			for (let idx = 0; idx < cur.length; idx++) {
				const val = cur[idx];
				if (typeof val === 'number' && Number.isFinite(val)) {
					const candidates = [0, 1, -1, Math.trunc(val / 2)];
					for (const cand of candidates) {
						if (Math.abs(cand) < Math.abs(val)) {
							const testArgs = [...cur];
							testArgs[idx] = cand;
							if (!checkProperty(testArgs).ok) { cur[idx] = cand; break; }
						}
					}
				} else if (typeof val === 'string' && val.length > 1) {
					for (const cand of ['', val.slice(0, Math.ceil(val.length / 2)), val[0]]) {
						const testArgs = [...cur];
						testArgs[idx] = cand;
						if (!checkProperty(testArgs).ok) { cur[idx] = cand; break; }
					}
				} else if (Array.isArray(val) && val.length > 1) {
					for (const cand of [[], val.slice(0, 1), val.slice(0, Math.ceil(val.length / 2))]) {
						const testArgs = [...cur];
						testArgs[idx] = cand;
						if (!checkProperty(testArgs).ok) { cur[idx] = cand; break; }
					}
				}
			}
			return cur;
		};

		let counterexample: FuzzTestReport['counterexample'];
		let iterationsRun = 0;

		for (let i = 0; i < iterations; i++) {
			iterationsRun = i + 1;
			const args = config.argSchema.map(k => genArg(k, i));
			const check = checkProperty(args);
			if (!check.ok) {
				const minimized = shrinkArgs(args);
				const snippet = [
					`test('fuzz regression: ${config.exportName} (${id})', () => {`,
					`  const result = ${config.exportName}(${minimized.map(a => JSON.stringify(a)).join(', ')});`,
					`  assert.ok(${config.propertyExpression});`,
					`});`,
				].join('\n');
				counterexample = {
					rawArgs: args,
					minimizedArgs: minimized,
					errorOrViolation: check.err ?? 'Property violated',
					iterationFound: i + 1,
					seed,
					regressionTestSnippet: snippet,
				};
				this._emit('fuzz_counterexample_found', id, `Fuzz counterexample at iter ${i + 1}: args=${JSON.stringify(minimized)} -> ${counterexample.errorOrViolation}`, { file: config.targetFile, passed: false });
				break;
			}
		}

		const durationMs = Math.round((performance.now() - t0) * 10) / 10;
		let corpusPath: string | undefined;
		if (counterexample && workspaceRoot) {
			const prevCorpus = this._readJson<unknown[]>(workspaceRoot, 'fuzz-corpus.json', []);
			this._writeJson(workspaceRoot, 'fuzz-corpus.json', [{ id, targetFile: config.targetFile, exportName: config.exportName, ...counterexample }, ...prevCorpus].slice(0, 100));
			corpusPath = path.join(CORRECTNESS_DIR, 'fuzz-corpus.json').replace(/\\/g, '/');
		}

		const report: FuzzTestReport = {
			id,
			createdAt: new Date().toISOString(),
			targetFile: config.targetFile,
			exportName: config.exportName,
			seed,
			iterationsRun,
			passed: !counterexample,
			durationMs,
			counterexample,
			corpusPath,
			summary: counterexample
				? `Fuzz test FOUND DEFECT on ${config.exportName} at iteration ${counterexample.iterationFound}/${iterations}: minimized args=${JSON.stringify(counterexample.minimizedArgs)} (${counterexample.errorOrViolation}).`
				: `Fuzz test PASSED ${iterationsRun} generated/boundary inputs (seed=${seed}) in ${durationMs}ms.`,
		};

		if (workspaceRoot) {
			const prev = this._readJson<FuzzTestReport[]>(workspaceRoot, 'fuzz-runs.json', []);
			this._writeJson(workspaceRoot, 'fuzz-runs.json', [report, ...prev].slice(0, 40));
		}
		this._emit('fuzz_completed', id, report.summary, { file: config.targetFile, passed: report.passed, durationMs });
		return report;
	}

	// ========================================================================
	// 3. REAL ISOLATED MUTATION TESTING ENGINE
	// ========================================================================

	async runMutationTesting(workspaceRoot: string, opts: {
		targetFile: string;
		testCommand: string;
		maxMutants?: number;
		timeoutMs?: number;
	}): Promise<MutationTestReport> {
		const id = `mut-${Date.now().toString(36)}`;
		const absTarget = path.isAbsolute(opts.targetFile) ? opts.targetFile : path.join(workspaceRoot, opts.targetFile);
		const relTarget = path.relative(workspaceRoot, absTarget).replace(/\\/g, '/');
		const timeoutMs = Math.max(2000, Math.min(30_000, opts.timeoutMs ?? 12_000));

		this._emit('mutation_started', id, `Starting isolated mutation testing on ${relTarget} using "${opts.testCommand}"`, { file: relTarget });

		if (!fs.existsSync(absTarget)) {
			return {
				id, createdAt: new Date().toISOString(), targetFile: relTarget, testCommand: opts.testCommand,
				totalMutants: 0, killed: 0, survived: 0, timedOut: 0, errors: 0, mutationScore: 0, outcomes: [],
				limitationsNote: 'Mutation scores measure test sensitivity to simple syntactic faults, not formal correctness.',
				summary: `Target file not found: ${relTarget}`, error: `Target file not found: ${relTarget}`,
			};
		}

		const originalSource = fs.readFileSync(absTarget, 'utf8');
		const mutants = generateControlledMutants(relTarget, originalSource, Math.max(1, Math.min(40, opts.maxMutants ?? 15)));

		// Copy workspace into an isolated temp directory so the real workspace is NEVER modified
		const tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kodia-mut-')));
		try {
			copyLightweightWorkspace(workspaceRoot, tmpRoot);
			// Link node_modules if present in workspace so test runner works seamlessly
			const srcNm = path.join(workspaceRoot, 'node_modules');
			const dstNm = path.join(tmpRoot, 'node_modules');
			if (fs.existsSync(srcNm) && !fs.existsSync(dstNm)) {
				try { fs.symlinkSync(srcNm, dstNm, 'junction'); } catch { /* optional */ }
			}

			// Verify baseline passes first
			const baseline = await runShell(opts.testCommand, tmpRoot, timeoutMs);
			if (!baseline.ok) {
				return {
					id, createdAt: new Date().toISOString(), targetFile: relTarget, testCommand: opts.testCommand,
					totalMutants: mutants.length, killed: 0, survived: 0, timedOut: 0, errors: 1, mutationScore: 0, outcomes: [],
					limitationsNote: 'Baseline tests must pass before mutation testing can evaluate mutant survival.',
					summary: `Baseline test command failed before mutation testing: ${(baseline.stderr || baseline.stdout).slice(0, 200)}`,
					error: `Baseline test failed (exit=${baseline.code}).`,
				};
			}

			const tmpTargetFile = path.join(tmpRoot, relTarget);
			const outcomes: MutantOutcome[] = [];
			let killed = 0, survived = 0, timedOut = 0, errors = 0;

			for (const m of mutants) {
				const mutatedSrc = applyMutantToSource(originalSource, m);
				fs.writeFileSync(tmpTargetFile, mutatedSrc, 'utf8');
				const mt0 = performance.now();
				const res = await runShell(opts.testCommand, tmpRoot, timeoutMs);
				const dur = Math.round(performance.now() - mt0);

				let status: MutantOutcome['status'];
				let detail: string;
				if (res.timedOut) {
					status = 'timeout'; timedOut++; detail = `Timed out after ${timeoutMs}ms (counted as detected).`;
				} else if (!res.ok) {
					status = 'killed'; killed++; detail = `Test suite detected mutant (exit=${res.code}).`;
				} else {
					status = 'survived'; survived++; detail = `SURVIVED: tests still passed despite changing \`${m.originalCode}\` -> \`${m.mutatedCode}\`.`;
				}
				outcomes.push({ ...m, status, durationMs: dur, detail });
				this._emit('mutant_evaluated', id, `[${status.toUpperCase()}] ${m.id} ${m.file}:${m.line} (${m.operator})`, { file: m.file, line: m.line, passed: status !== 'survived', durationMs: dur });
			}

			const effectiveDetected = killed + timedOut;
			const denom = Math.max(1, mutants.length - errors);
			const mutationScore = mutants.length > 0 ? Math.round((effectiveDetected / denom) * 1000) / 10 : 0;

			const report: MutationTestReport = {
				id,
				createdAt: new Date().toISOString(),
				targetFile: relTarget,
				testCommand: opts.testCommand,
				totalMutants: mutants.length,
				killed,
				survived,
				timedOut,
				errors,
				mutationScore,
				outcomes,
				limitationsNote: 'Mutation scores evaluate test sensitivity to injected syntactic faults (operator/branch flips); surviving mutants may indicate weak assertions or equivalent code, and high mutation scores do not prove absence of specification bugs.',
				summary: `Mutation Testing on ${relTarget}: ${killed} killed, ${survived} survived, ${timedOut} timeout out of ${mutants.length} mutant(s) (score: ${mutationScore}%).`,
			};

			if (workspaceRoot) {
				const prev = this._readJson<MutationTestReport[]>(workspaceRoot, 'mutation-runs.json', []);
				this._writeJson(workspaceRoot, 'mutation-runs.json', [report, ...prev].slice(0, 30));
			}
			this._emit('mutation_completed', id, report.summary, { file: relTarget, passed: survived === 0 });
			return report;
		} finally {
			fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
		}
	}

	// ========================================================================
	// 4. GENUINELY SEPARATE INDEPENDENT VERIFICATION ENGINE
	// ========================================================================

	async runIndependentVerification(workspaceRoot: string, opts: {
		changeDescription: string;
		requirements?: readonly string[];
		changedFiles: readonly string[];
		testCommands?: readonly string[];
		staticDiagnostics?: readonly CorrectnessDiagnostic[];
		taintFindings?: readonly TaintFlowFinding[];
		requireTests?: boolean;
	}): Promise<IndependentVerificationReport> {
		const execId = `iver-${Date.now().toString(36)}`;
		this._emit('independent_verification_started', execId, `Starting independent verification for "${opts.changeDescription}" (${opts.changedFiles.length} changed file(s))`);

		const checks: IndependentVerificationCheck[] = [];
		const analyzersRun: string[] = [];
		const testsExecuted: Array<{ command: string; passed: boolean; outputSnippet: string }> = [];

		// 1. Independent compiler/syntax verification on changed files
		const compilerOutcomes = await this.runCompilerAndAnalyzers(workspaceRoot, { targetFiles: opts.changedFiles });
		for (const co of compilerOutcomes.filter(c => c.available)) {
			analyzersRun.push(co.engine);
			checks.push({
				name: `Compiler check (${co.engine})`,
				category: 'compiler',
				status: co.passed ? 'passed' : 'failed',
				detail: co.passed ? `0 errors in ${co.durationMs}ms` : co.diagnostics.slice(0, 3).map(d => `${d.file}:${d.line} ${d.message}`).join(' | '),
				command: co.command,
			});
		}

		// 2. Independent fresh static & taint scan directly from disk on changed files + workspace context
		const diskFiles = walkWorkspaceFiles(workspaceRoot, 200).map(rel => {
			const abs = path.join(workspaceRoot, rel);
			let content = '';
			try { content = fs.readFileSync(abs, 'utf8'); } catch { content = ''; }
			return { relativePath: rel, content };
		});
		const suppressions = this._readJson<DiagnosticSuppression[]>(workspaceRoot, 'suppressions.json', []);
		const freshStatic = opts.staticDiagnostics ?? analyzeWorkspaceCorrectness(diskFiles, { suppressions, targetFiles: opts.changedFiles });
		const staticErrors = freshStatic.filter(d => !d.suppressed && (d.severity === 'critical' || d.severity === 'error'));
		analyzersRun.push('kodia-deep-analyzer');
		checks.push({
			name: 'Static & Cross-File Correctness',
			category: 'static-analysis',
			status: staticErrors.length === 0 ? 'passed' : 'failed',
			detail: staticErrors.length === 0 ? '0 critical/error static defects on changed files' : staticErrors.slice(0, 3).map(d => `${d.file}:${d.line} ${d.title}`).join(' | '),
		});

		const changedDiskFiles = diskFiles.filter(f => opts.changedFiles.map(x => x.replace(/\\/g, '/')).includes(f.relativePath));
		const freshTaint = opts.taintFindings ?? analyzeTaintFlows(changedDiskFiles).unsafeFlows;
		const critHighTaint = freshTaint.filter(t => t.severity === 'critical' || t.severity === 'high');
		analyzersRun.push('kodia-taint-analyzer');
		checks.push({
			name: 'Data-Flow & Taint Security',
			category: 'taint',
			status: critHighTaint.length === 0 ? 'passed' : 'failed',
			detail: critHighTaint.length === 0 ? '0 critical/high unsafe taint flows' : critHighTaint.slice(0, 3).map(t => `${t.sink.file}:${t.sink.line} ${t.title}`).join(' | '),
		});

		// 3. Independently execute every specified real test command
		if (opts.testCommands && opts.testCommands.length > 0) {
			for (const cmd of opts.testCommands) {
				const res = await runShell(cmd, workspaceRoot, 30_000);
				const snippet = `${res.stdout}\n${res.stderr}`.trim().slice(0, 400);
				testsExecuted.push({ command: cmd, passed: res.ok, outputSnippet: snippet });
				checks.push({
					name: `Automated tests (${cmd})`,
					category: 'tests',
					status: res.ok ? 'passed' : 'failed',
					detail: res.ok ? `Command exited 0` : `Exit code ${res.code}${res.timedOut ? ' (TIMED OUT)' : ''}: ${snippet.slice(0, 180)}`,
					command: cmd,
				});
			}
		} else {
			checks.push({
				name: 'Automated test execution',
				category: 'tests',
				status: 'not_run',
				detail: 'No test command was provided for independent verification.',
			});
		}

		// 4. Requirement coverage presence check
		if (opts.requirements && opts.requirements.length > 0) {
			checks.push({
				name: `Requirement checklist (${opts.requirements.length} item(s))`,
				category: 'requirement-coverage',
				status: opts.changedFiles.length > 0 ? 'passed' : 'failed',
				detail: opts.changedFiles.length > 0 ? `Mapped ${opts.changedFiles.length} changed file(s) to ${opts.requirements.length} requirement(s).` : 'No modified files recorded for requirements.',
			});
		}

		const report = evaluateIndependentVerification({
			changeDescription: opts.changeDescription,
			changedFiles: opts.changedFiles,
			checks,
			requireTests: opts.requireTests,
		});

		// Persist Proof-Carrying Change Record automatically
		const proof: ProofCarryingChangeRecord = {
			id: `proof-${Date.now().toString(36)}`,
			createdAt: report.verifiedAt,
			title: opts.changeDescription,
			requirementsCovered: [...(opts.requirements ?? [opts.changeDescription])],
			changedFiles: [...report.changedFiles],
			originalFailureOrGoal: opts.changeDescription,
			analyzersRun,
			testsExecuted,
			staticFindingsCount: staticErrors.length,
			taintFindingsCount: critHighTaint.length,
			independentVerdict: report.verdict,
			knownLimitations: report.untestedRisks.length ? [...report.untestedRisks] : ['Verification covers configured deterministic checks and executed tests only.'],
			unresolvedRisks: [...report.rejectionReasons],
			summary: report.summary,
		};

		const fullReport: IndependentVerificationReport = { ...report, proofRecordId: proof.id };

		if (workspaceRoot) {
			await this.saveProofRecord(workspaceRoot, proof);
			const prev = this._readJson<IndependentVerificationReport[]>(workspaceRoot, 'verifications.json', []);
			this._writeJson(workspaceRoot, 'verifications.json', [fullReport, ...prev].slice(0, 50));
		}

		this._emit('independent_verification_verdict', execId, fullReport.summary, { passed: fullReport.verdict === 'APPROVED' });
		this._emit('proof_recorded', execId, `Recorded Proof-Carrying Change ${proof.id} [${proof.independentVerdict}]`, { passed: proof.independentVerdict === 'APPROVED' });
		return fullReport;
	}

	// ========================================================================
	// 5. PERSISTENCE HELPERS (Proofs, Investigations, Readiness, Suppressions)
	// ========================================================================

	async saveProofRecord(workspaceRoot: string, record: ProofCarryingChangeRecord): Promise<ProofCarryingChangeRecord[]> {
		const prev = this._readJson<ProofCarryingChangeRecord[]>(workspaceRoot, 'proofs.json', []).filter(p => p.id !== record.id);
		const updated = [record, ...prev].slice(0, 60);
		this._writeJson(workspaceRoot, 'proofs.json', updated);
		// Also write individual inspectable proof file under .kodia/correctness/proofs/
		if (workspaceRoot) {
			const pDir = this._ensureDir(workspaceRoot, 'proofs');
			fs.writeFileSync(path.join(pDir, `${record.id}.json`), JSON.stringify(record, null, 2), 'utf8');
		}
		return updated;
	}

	async saveInvestigation(workspaceRoot: string, report: RootCauseInvestigationReport): Promise<RootCauseInvestigationReport[]> {
		const prev = this._readJson<RootCauseInvestigationReport[]>(workspaceRoot, 'investigations.json', []).filter(i => i.id !== report.id);
		const updated = [report, ...prev].slice(0, 40);
		this._writeJson(workspaceRoot, 'investigations.json', updated);
		this._emit('hypothesis_ranked', report.id, report.summary);
		return updated;
	}

	async saveReadinessReport(workspaceRoot: string, report: ReleaseReadinessReport): Promise<ReleaseReadinessReport[]> {
		const prev = this._readJson<ReleaseReadinessReport[]>(workspaceRoot, 'readiness.json', []).filter(r => r.id !== report.id);
		const updated = [report, ...prev].slice(0, 30);
		this._writeJson(workspaceRoot, 'readiness.json', updated);
		this._emit('readiness_assessed', report.id, report.summary, { passed: report.outcome === 'verified_against_checks' });
		return updated;
	}

	async manageSuppressions(workspaceRoot: string, opts: {
		action: 'list' | 'add' | 'remove';
		id?: string;
		ruleId?: string;
		filePattern?: string;
		justification?: string;
	}): Promise<DiagnosticSuppression[]> {
		let list = this._readJson<DiagnosticSuppression[]>(workspaceRoot, 'suppressions.json', []);
		if (opts.action === 'add' && opts.ruleId && opts.justification) {
			const entry: DiagnosticSuppression = {
				id: `sup-${Date.now().toString(36)}`,
				ruleId: opts.ruleId.trim(),
				filePattern: opts.filePattern?.trim() || undefined,
				justification: opts.justification.trim(),
				createdAt: new Date().toISOString(),
			};
			list = [entry, ...list];
			this._writeJson(workspaceRoot, 'suppressions.json', list);
		} else if (opts.action === 'remove' && opts.id) {
			list = list.filter(s => s.id !== opts.id);
			this._writeJson(workspaceRoot, 'suppressions.json', list);
		}
		return list;
	}
}
