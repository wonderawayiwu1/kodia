/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { Disposable } from '../../../../base/common/lifecycle.js';
import {
	IKodiaNotebookKernelMainService,
	KodiaDiscoveredPythonKernel,
	KodiaKernelExecuteRequest,
	KodiaKernelExecuteResult,
	KodiaKernelVariable,
} from '../common/kodiaNotebookKernelTypes.js';


const KERNEL_MSG_PREFIX = '__KODIA_KERNEL_MSG__:';

/**
 * Persistent stateful Python kernel worker launched via `python -u -c <script>`.
 * Runs inside the user's real Python interpreter, preserving globals/imports/functions across cells,
 * capturing stdout/stderr, evaluating trailing expressions (with _repr_html_, _repr_png_, _repr_svg_, repr),
 * capturing matplotlib figures as inline PNGs, and returning structured tracebacks on errors.
 */
const PYTHON_KERNEL_HARNESS = `
import ast
import base64
import io
import json
import os
import sys
import traceback

PREFIX = "${KERNEL_MSG_PREFIX}"
_real_stdout = sys.stdout
_real_stderr = sys.stderr

def _send(obj):
    _real_stdout.write(PREFIX + json.dumps(obj, ensure_ascii=False) + "\\n")
    _real_stdout.flush()

_ns = {"__name__": "__main__", "__builtins__": __builtins__}
_exec_count = 0
_pending_outputs = []

def _emit_rich(val):
    if val is None:
        return
    items = []
    try:
        if hasattr(val, "_repr_png_") and callable(val._repr_png_):
            png = val._repr_png_()
            if isinstance(png, bytes):
                items.append({"mime": "image/png", "data": base64.b64encode(png).decode("ascii"), "isBase64": True})
            elif isinstance(png, str):
                items.append({"mime": "image/png", "data": png, "isBase64": True})
    except Exception:
        pass
    try:
        if hasattr(val, "_repr_svg_") and callable(val._repr_svg_):
            svg = val._repr_svg_()
            if isinstance(svg, str):
                items.append({"mime": "image/svg+xml", "data": svg})
    except Exception:
        pass
    try:
        if hasattr(val, "_repr_html_") and callable(val._repr_html_):
            html = val._repr_html_()
            if isinstance(html, str):
                items.append({"mime": "text/html", "data": html})
    except Exception:
        pass
    try:
        items.append({"mime": "text/plain", "data": repr(val)})
    except Exception:
        items.append({"mime": "text/plain", "data": str(val)})
    if items:
        _pending_outputs.append({"items": items})

def _kodia_display(*objs):
    for obj in objs:
        _emit_rich(obj)

_ns["display"] = _kodia_display

def _setup_matplotlib():
    try:
        import matplotlib
        matplotlib.use("Agg", force=True)
        import matplotlib.pyplot as plt
        def _kodia_show(*args, **kwargs):
            _flush_matplotlib_figures()
        plt.show = _kodia_show
    except Exception:
        pass

def _flush_matplotlib_figures():
    if "matplotlib.pyplot" not in sys.modules:
        return
    try:
        plt = sys.modules["matplotlib.pyplot"]
        fignums = list(plt.get_fignums())
        for num in fignums:
            fig = plt.figure(num)
            buf = io.BytesIO()
            fig.savefig(buf, format="png", bbox_inches="tight", dpi=110)
            buf.seek(0)
            b64 = base64.b64encode(buf.read()).decode("ascii")
            _pending_outputs.append({"items": [{"mime": "image/png", "data": b64, "isBase64": True}]})
            plt.close(fig)
    except Exception:
        pass

_setup_matplotlib()
_send({"type": "ready"})

for raw_line in sys.stdin:
    raw_line = raw_line.strip()
    if not raw_line:
        continue
    try:
        req = json.loads(raw_line)
    except Exception:
        continue

    req_id = req.get("id")
    op = req.get("op")

    if op == "variables":
        vars_out = []
        for k, v in list(_ns.items()):
            if k.startswith("_") or k == "display":
                continue
            try:
                tname = type(v).__name__
                if tname in ("module", "function", "type"):
                    continue
                val_str = repr(v)
                if len(val_str) > 200:
                    val_str = val_str[:200] + "..."
                vars_out.append({"name": k, "type": tname, "value": val_str})
            except Exception:
                pass
        _send({"id": req_id, "variables": vars_out})
        continue

    if op == "execute":
        _exec_count += 1
        code = req.get("code", "")
        cwd = req.get("cwd")
        if cwd and os.path.isdir(cwd):
            try:
                os.chdir(cwd)
                if cwd not in sys.path:
                    sys.path.insert(0, cwd)
            except Exception:
                pass

        _pending_outputs = []
        stdout_buf = io.StringIO()
        stderr_buf = io.StringIO()
        sys.stdout = stdout_buf
        sys.stderr = stderr_buf
        success = True
        err_name = None
        err_msg = None
        err_stack = None

        try:
            # Handle simple Jupyter magic lines gracefully (e.g. %matplotlib inline)
            cleaned_lines = []
            for ln in code.splitlines():
                stripped = ln.lstrip()
                if stripped.startswith("%matplotlib"):
                    cleaned_lines.append("pass  # %matplotlib handled inline by Kodia")
                else:
                    cleaned_lines.append(ln)
            exec_code = "\\n".join(cleaned_lines)

            tree = ast.parse(exec_code, "<notebook-cell>", "exec")
            last_expr = None
            if tree.body and isinstance(tree.body[-1], ast.Expr):
                last_expr = ast.Expression(body=tree.body.pop().value)
                ast.fix_missing_locations(last_expr)

            if tree.body:
                compiled_body = compile(tree, "<notebook-cell>", "exec")
                exec(compiled_body, _ns, _ns)

            if last_expr is not None:
                compiled_expr = compile(last_expr, "<notebook-cell>", "eval")
                val = eval(compiled_expr, _ns, _ns)
                if val is not None:
                    _emit_rich(val)

            _flush_matplotlib_figures()
        except BaseException as exc:
            success = False
            err_name = type(exc).__name__
            err_msg = str(exc)
            err_stack = traceback.format_exc()
        finally:
            sys.stdout = _real_stdout
            sys.stderr = _real_stderr

        outputs = []
        out_text = stdout_buf.getvalue()
        if out_text:
            outputs.append({"items": [{"mime": "application/vnd.code.notebook.stdout", "data": out_text}]})
        err_text = stderr_buf.getvalue()
        if err_text:
            outputs.append({"items": [{"mime": "application/vnd.code.notebook.stderr", "data": err_text}]})
        outputs.extend(_pending_outputs)
        if not success:
            err_payload = json.dumps({
                "name": err_name or "Error",
                "message": err_msg or "",
                "stack": err_stack or "",
            })
            outputs.append({"items": [{"mime": "application/vnd.code.notebook.error", "data": err_payload}]})

        _send({
            "id": req_id,
            "success": success,
            "executionCount": _exec_count,
            "outputs": outputs,
            "errorName": err_name,
            "errorMessage": err_msg,
            "errorStack": err_stack,
        })
`;

interface PendingRequest {
	resolve: (value: any) => void;
	reject: (err: Error) => void;
}

class PythonKernelSession {
	private _proc: cp.ChildProcess | undefined;
	private _readyPromise: Promise<void> | undefined;
	private _reqCounter = 0;
	private readonly _pending = new Map<number, PendingRequest>();
	private _disposed = false;

	constructor(
		public readonly notebookUri: string,
		public readonly pythonPath: string,
		public readonly cwd?: string,
	) { }

	private async _ensureStarted(): Promise<cp.ChildProcess> {
		if (this._proc && this._proc.exitCode === null && !this._proc.killed && this._readyPromise) {
			await this._readyPromise;
			return this._proc;
		}

		this._disposed = false;
		const cwd = this.cwd && fs.existsSync(this.cwd) ? this.cwd : undefined;
		const proc = cp.spawn(this.pythonPath, ['-u', '-c', PYTHON_KERNEL_HARNESS], {
			cwd,
			stdio: ['pipe', 'pipe', 'pipe'],
			windowsHide: true,
			env: {
				...process.env,
				PYTHONUNBUFFERED: '1',
				PYTHONIOENCODING: 'utf-8',
				MPLBACKEND: 'Agg',
			},
		});
		this._proc = proc;

		let resolveReady!: () => void;
		let rejectReady!: (err: Error) => void;
		this._readyPromise = new Promise<void>((res, rej) => {
			resolveReady = res;
			rejectReady = rej;
		});

		const rl = readline.createInterface({ input: proc.stdout! });
		let stderrStartup = '';
		proc.stderr?.on('data', (chunk: Buffer) => {
			stderrStartup += chunk.toString('utf8');
		});

		rl.on('line', (line: string) => {
			if (!line.startsWith(KERNEL_MSG_PREFIX)) {
				return;
			}
			try {
				const msg = JSON.parse(line.slice(KERNEL_MSG_PREFIX.length));
				if (msg.type === 'ready') {
					resolveReady();
					return;
				}
				if (typeof msg.id === 'number') {
					const pending = this._pending.get(msg.id);
					if (pending) {
						this._pending.delete(msg.id);
						pending.resolve(msg);
					}
				}
			} catch {
				// ignore malformed non-protocol lines
			}
		});

		const failAll = (reason: string) => {
			rejectReady(new Error(reason));
			for (const [, p] of this._pending) {
				p.reject(new Error(reason));
			}
			this._pending.clear();
		};

		proc.once('error', (err) => {
			failAll(`Python kernel failed to start (${this.pythonPath}): ${err.message}`);
		});

		proc.once('exit', (code, signal) => {
			rl.close();
			if (this._proc === proc) {
				this._proc = undefined;
				this._readyPromise = undefined;
			}
			if (!this._disposed) {
				failAll(`Python kernel exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})${stderrStartup ? `: ${stderrStartup.trim()}` : ''}`);
			}
		});

		await this._readyPromise;
		return proc;
	}

	async execute(code: string, cwd?: string): Promise<KodiaKernelExecuteResult> {
		const proc = await this._ensureStarted();
		const id = ++this._reqCounter;
		return await new Promise<KodiaKernelExecuteResult>((resolve, reject) => {
			this._pending.set(id, { resolve, reject });
			const payload = JSON.stringify({ id, op: 'execute', code, cwd: cwd ?? this.cwd }) + '\n';
			proc.stdin?.write(payload, 'utf8', (err) => {
				if (err) {
					this._pending.delete(id);
					reject(err);
				}
			});
		});
	}

	async getVariables(): Promise<KodiaKernelVariable[]> {
		if (!this._proc || this._proc.exitCode !== null || this._proc.killed) {
			return [];
		}
		const id = ++this._reqCounter;
		try {
			const res = await new Promise<{ variables?: KodiaKernelVariable[] }>((resolve, reject) => {
				const timer = setTimeout(() => {
					this._pending.delete(id);
					resolve({ variables: [] });
				}, 2000);
				this._pending.set(id, {
					resolve: (val) => { clearTimeout(timer); resolve(val); },
					reject: (err) => { clearTimeout(timer); reject(err); },
				});
				this._proc?.stdin?.write(JSON.stringify({ id, op: 'variables' }) + '\n', 'utf8');
			});
			return res.variables ?? [];
		} catch {
			return [];
		}
	}

	interrupt(): void {
		// On Windows, SIGINT is unreliable for hidden child processes; cancel pending execution cleanly and reset worker
		for (const [, p] of this._pending) {
			p.resolve({
				success: false,
				executionCount: 0,
				outputs: [{
					items: [{
						mime: 'application/vnd.code.notebook.error',
						data: JSON.stringify({ name: 'KeyboardInterrupt', message: 'Cell execution interrupted by user', stack: 'KeyboardInterrupt: Cell execution interrupted by user' }),
					}]
				}],
				errorName: 'KeyboardInterrupt',
				errorMessage: 'Cell execution interrupted by user',
			} satisfies KodiaKernelExecuteResult);
		}
		this._pending.clear();
		this.dispose();
	}

	dispose(): void {
		this._disposed = true;
		for (const [, p] of this._pending) {
			p.reject(new Error('Kernel restarted or closed'));
		}
		this._pending.clear();
		if (this._proc) {
			try { this._proc.kill(); } catch { /* ignore */ }
			this._proc = undefined;
			this._readyPromise = undefined;
		}
	}
}

export class KodiaNotebookKernelMainService extends Disposable implements IKodiaNotebookKernelMainService {
	readonly _serviceBrand: undefined;

	private readonly _sessions = new Map<string, PythonKernelSession>();

	constructor() {
		super();
	}

	override dispose(): void {
		for (const session of this._sessions.values()) {
			session.dispose();
		}
		this._sessions.clear();
		super.dispose();
	}

	async discoverKernels(workspaceFolder?: string): Promise<KodiaDiscoveredPythonKernel[]> {
		const candidates: Array<{ cmd: string; args: string[]; labelHint?: string; isPreferred?: boolean }> = [];

		// 1. Workspace virtual environments first (highest priority)
		if (workspaceFolder) {
			const venvRelPaths = process.platform === 'win32'
				? ['.venv\\Scripts\\python.exe', 'venv\\Scripts\\python.exe', 'env\\Scripts\\python.exe']
				: ['.venv/bin/python', 'venv/bin/python', 'env/bin/python'];
			for (const rel of venvRelPaths) {
				const full = path.join(workspaceFolder, rel);
				if (fs.existsSync(full)) {
					candidates.push({ cmd: full, args: [], labelHint: `Python (${path.basename(path.dirname(path.dirname(full)))})`, isPreferred: true });
				}
			}
		}

		// 2. Installed Jupyter kernelspecs (jupyter kernelspec list --json)
		const kernelspecCandidates = await this._discoverJupyterKernelspecs();
		candidates.push(...kernelspecCandidates);

		// 3. System Python commands
		if (process.platform === 'win32') {
			candidates.push({ cmd: 'python', args: [] });
			candidates.push({ cmd: 'py', args: ['-3'] });
			candidates.push({ cmd: 'python3', args: [] });
		} else {
			candidates.push({ cmd: 'python3', args: [] });
			candidates.push({ cmd: 'python', args: [] });
		}

		const seenExe = new Set<string>();
		const discovered: KodiaDiscoveredPythonKernel[] = [];

		for (const cand of candidates) {
			const probed = await this._probePython(cand.cmd, cand.args);
			if (!probed) {
				continue;
			}
			const normExe = process.platform === 'win32' ? probed.executable.toLowerCase() : probed.executable;
			if (seenExe.has(normExe)) {
				continue;
			}
			seenExe.add(normExe);

			const id = `kodia-python-${discovered.length + 1}-${probed.version}`;
			const label = cand.labelHint ? `${cand.labelHint} ${probed.version}` : `Python ${probed.version}`;
			const tags: string[] = [];
			if (probed.hasIpykernel) { tags.push('ipykernel'); }
			if (probed.hasMatplotlib) { tags.push('matplotlib'); }
			const description = tags.length > 0 ? `${probed.executable} (${tags.join(', ')})` : probed.executable;

			discovered.push({
				id,
				label,
				description,
				detail: probed.executable,
				pythonPath: probed.executable,
				version: probed.version,
				hasIpykernel: probed.hasIpykernel,
				hasMatplotlib: probed.hasMatplotlib,
				isPreferred: Boolean(cand.isPreferred || discovered.length === 0),
			});
		}

		return discovered;
	}

	async executeCell(req: KodiaKernelExecuteRequest): Promise<KodiaKernelExecuteResult> {
		let session = this._sessions.get(req.notebookUri);
		if (!session || session.pythonPath !== req.pythonPath) {
			session?.dispose();
			session = new PythonKernelSession(req.notebookUri, req.pythonPath, req.cwd);
			this._sessions.set(req.notebookUri, session);
		}
		return await session.execute(req.code, req.cwd);
	}

	async interruptKernel(notebookUri: string): Promise<void> {
		this._sessions.get(notebookUri)?.interrupt();
	}

	async restartKernel(notebookUri: string): Promise<void> {
		const existing = this._sessions.get(notebookUri);
		if (existing) {
			existing.dispose();
			this._sessions.delete(notebookUri);
		}
	}

	async disposeKernel(notebookUri: string): Promise<void> {
		const existing = this._sessions.get(notebookUri);
		if (existing) {
			existing.dispose();
			this._sessions.delete(notebookUri);
		}
	}

	async getVariables(notebookUri: string): Promise<KodiaKernelVariable[]> {
		const session = this._sessions.get(notebookUri);
		if (!session) {
			return [];
		}
		return await session.getVariables();
	}

	private async _discoverJupyterKernelspecs(): Promise<Array<{ cmd: string; args: string[]; labelHint?: string; isPreferred?: boolean }>> {
		const results: Array<{ cmd: string; args: string[]; labelHint?: string; isPreferred?: boolean }> = [];
		try {
			const out = await this._execQuick('jupyter', ['kernelspec', 'list', '--json'], 4000);
			if (!out) { return results; }
			const parsed = JSON.parse(out) as { kernelspecs?: Record<string, { spec?: { argv?: string[]; display_name?: string; language?: string } }> };
			for (const [, entry] of Object.entries(parsed.kernelspecs ?? {})) {
				const spec = entry?.spec;
				if (!spec || spec.language?.toLowerCase() !== 'python') { continue; }
				const pyExe = spec.argv?.[0];
				if (pyExe && fs.existsSync(pyExe)) {
					results.push({ cmd: pyExe, args: [], labelHint: spec.display_name || 'Python 3', isPreferred: true });
				}
			}
		} catch {
			// jupyter CLI not installed or not in PATH — ignore cleanly
		}
		return results;
	}

	private async _probePython(cmd: string, args: string[]): Promise<{ executable: string; version: string; hasIpykernel: boolean; hasMatplotlib: boolean } | undefined> {
		const probeCode = `import sys, json, importlib.util; print(json.dumps({"executable": sys.executable, "version": "%d.%d.%d" % sys.version_info[:3], "hasIpykernel": importlib.util.find_spec("ipykernel") is not None, "hasMatplotlib": importlib.util.find_spec("matplotlib") is not None}))`;
		const out = await this._execQuick(cmd, [...args, '-c', probeCode], 4000);
		if (!out) { return undefined; }
		try {
			const line = out.trim().split(/\r?\n/).pop() ?? '';
			const parsed = JSON.parse(line);
			if (typeof parsed.executable === 'string' && typeof parsed.version === 'string') {
				return parsed;
			}
		} catch {
			// ignore non-JSON output (e.g. Microsoft Store Python stub)
		}
		return undefined;
	}

	private _execQuick(cmd: string, args: string[], timeoutMs: number): Promise<string | undefined> {
		return new Promise<string | undefined>((resolve) => {
			try {
				cp.execFile(cmd, args, { timeout: timeoutMs, windowsHide: true, encoding: 'utf8' }, (err, stdout) => {
					if (err || !stdout) {
						resolve(undefined);
						return;
					}
					resolve(stdout);
				});
			} catch {
				resolve(undefined);
			}
		});
	}
}
