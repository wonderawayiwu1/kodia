/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as path from 'path';
import * as vm from 'vm';
import { createRequire } from 'module';
import type WebSocket from 'ws';

let cachedWebSocketCtor: typeof WebSocket | null = null;
async function loadWebSocketCtor(): Promise<typeof WebSocket> {
	if (cachedWebSocketCtor) { return cachedWebSocketCtor; }
	try {
		const req = createRequire(import.meta.url);
		const mod = req('ws') as typeof WebSocket | { default?: typeof WebSocket };
		cachedWebSocketCtor = (typeof mod === 'function' ? mod : mod.default) as typeof WebSocket;
		if (cachedWebSocketCtor) { return cachedWebSocketCtor; }
	} catch { /* fallback to dynamic ESM import */ }
	const esm = await import('ws');
	cachedWebSocketCtor = (esm.default ?? esm) as typeof WebSocket;
	return cachedWebSocketCtor;
}
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import {
	ApiAssertionResult,
	ApiCollection,
	ApiCookieEntry,
	ApiEnvironment,
	ApiHistoryEntry,
	ApiHttpMethod,
	ApiLiveEvent,
	ApiLiveEventType,
	ApiLoadTestConfig,
	ApiLoadTestResult,
	ApiLoadTimelineBucket,
	ApiManagedRuntimeInfo,
	ApiMockRoute,
	ApiMockServerStatus,
	ApiMonitorConfig,
	ApiRequestBody,
	ApiRequestSpec,
	ApiResponseResult,
	ApiSecurityFinding,
	ApiSecurityReport,
	ApiStudioWorkspaceSnapshot,
	ApiTestCaseResult,
	ApiTestRunResult,
	ApiTestStatus,
	ApiTestSuite,
	ApiWebSocketMessage,
	ApiWebSocketSessionInfo,
	DiscoveredApiRoute,
	IKodiaApiStudioMainService,
} from '../common/apiStudioTypes.js';
import {
	evaluateApiAssertions,
	queryJsonPath,
	redactApiSecrets,
	redactHeaders,
	resolveApiVariables,
} from '../common/apiStudioIntelligence.js';

const API_STATE_DIR = path.join('.kodia', 'api-studio');
const MAX_RING_EVENTS = 500;
const MAX_RUNTIME_LOGS = 200;

function isLocalHostname(urlStr: string): boolean {
	try {
		const u = new URL(urlStr);
		const h = u.hostname.toLowerCase();
		return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0' || h.endsWith('.local');
	} catch {
		return false;
	}
}

function parseSetCookieHeaders(raw: string | string[] | undefined): ApiCookieEntry[] {
	if (!raw) { return []; }
	const list = Array.isArray(raw) ? raw : [raw];
	const cookies: ApiCookieEntry[] = [];
	for (const line of list) {
		const parts = line.split(';').map(s => s.trim()).filter(Boolean);
		if (parts.length === 0) { continue; }
		const eq = parts[0].indexOf('=');
		if (eq <= 0) { continue; }
		const name = parts[0].slice(0, eq).trim();
		const value = parts[0].slice(eq + 1).trim();
		let domain: string | undefined;
		let cookiePath: string | undefined;
		let expires: string | undefined;
		let httpOnly = false;
		let secure = false;
		let sameSite: string | undefined;
		for (const attr of parts.slice(1)) {
			const [ak, av] = attr.split('=').map(s => s.trim());
			const l = ak.toLowerCase();
			if (l === 'domain') { domain = av; }
			else if (l === 'path') { cookiePath = av; }
			else if (l === 'expires') { expires = av; }
			else if (l === 'httponly') { httpOnly = true; }
			else if (l === 'secure') { secure = true; }
			else if (l === 'samesite') { sameSite = av; }
		}
		cookies.push({ name, value, domain, path: cookiePath, expires, httpOnly, secure, sameSite });
	}
	return cookies;
}

function parseSseBody(body: string): Array<{ id?: string; event?: string; data: string; timestamp: string }> {
	const events: Array<{ id?: string; event?: string; data: string; timestamp: string }> = [];
	const blocks = body.split(/\r?\n\r?\n/);
	const now = new Date().toISOString();
	for (const block of blocks) {
		if (!block.trim()) { continue; }
		let id: string | undefined;
		let event: string | undefined;
		const dataLines: string[] = [];
		for (const line of block.split(/\r?\n/)) {
			if (line.startsWith('id:')) { id = line.slice(3).trim(); }
			else if (line.startsWith('event:')) { event = line.slice(6).trim(); }
			else if (line.startsWith('data:')) { dataLines.push(line.slice(5).trim()); }
		}
		if (dataLines.length > 0 || event) {
			events.push({ id, event, data: dataLines.join('\n'), timestamp: now });
		}
	}
	return events;
}

function percentile(sorted: readonly number[], p: number): number {
	if (sorted.length === 0) { return 0; }
	const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
	return Math.round(sorted[idx] * 100) / 100;
}

interface ManagedRuntimeRecord {
	info: ApiManagedRuntimeInfo;
	proc?: cp.ChildProcess;
	logs: string[];
}

interface ManagedMockRecord {
	status: ApiMockServerStatus;
	server: http.Server;
	recentRequests: Array<{ method: string; path: string; status: number; timestamp: string }>;
}

interface ManagedWsRecord {
	info: ApiWebSocketSessionInfo;
	ws: WebSocket;
	messages: ApiWebSocketMessage[];
}

export class KodiaApiStudioMainService extends Disposable implements IKodiaApiStudioMainService {
	readonly _serviceBrand: undefined;

	private readonly _onDidEmitEvent = this._register(new Emitter<ApiLiveEvent>());
	readonly onDidEmitEvent: Event<ApiLiveEvent> = this._onDidEmitEvent.event;

	private _eventSeq = 0;
	private _recentEvents: ApiLiveEvent[] = [];
	private _activeCancellations = new Map<string, AbortController>();
	private _runtimes = new Map<string, ManagedRuntimeRecord>();
	private _mocks = new Map<string, ManagedMockRecord>();
	private _webSockets = new Map<string, ManagedWsRecord>();

	override dispose(): void {
		for (const ac of this._activeCancellations.values()) {
			try { ac.abort(); } catch { /* ignore */ }
		}
		this._activeCancellations.clear();
		for (const rec of this._runtimes.values()) {
			this._killProc(rec.proc);
		}
		this._runtimes.clear();
		for (const m of this._mocks.values()) {
			try { m.server.close(); } catch { /* ignore */ }
		}
		this._mocks.clear();
		for (const w of this._webSockets.values()) {
			try { w.ws.close(); } catch { /* ignore */ }
		}
		this._webSockets.clear();
		super.dispose();
	}

	private _killProc(proc?: cp.ChildProcess): void {
		if (!proc || proc.killed || !proc.pid) { return; }
		try {
			if (process.platform === 'win32') {
				const res = cp.spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true, timeout: 3000 });
				if (res.status !== 0) {
					try { proc.kill('SIGKILL'); } catch { proc.kill(); }
				}
			} else {
				proc.kill('SIGTERM');
			}
		} catch {
			try { proc.kill('SIGKILL'); } catch { /* ignore */ }
		}
	}

	private _emit(
		type: ApiLiveEventType,
		executionId: string,
		message: string,
		extra?: Partial<Omit<ApiLiveEvent, 'seq' | 'eventId' | 'timestamp' | 'type' | 'executionId' | 'message'>>,
	): ApiLiveEvent {
		const seq = ++this._eventSeq;
		const ev: ApiLiveEvent = {
			seq,
			eventId: `ev-${seq}-${Date.now().toString(36)}`,
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

	private _ensureDir(workspaceRoot: string): string {
		const dir = path.join(workspaceRoot, API_STATE_DIR);
		fs.mkdirSync(dir, { recursive: true });
		return dir;
	}

	private _readJson<T>(workspaceRoot: string, fileName: string, fallback: T): T {
		if (!workspaceRoot) { return fallback; }
		const fp = path.join(workspaceRoot, API_STATE_DIR, fileName);
		if (!fs.existsSync(fp)) { return fallback; }
		try {
			return JSON.parse(fs.readFileSync(fp, 'utf8')) as T;
		} catch {
			return fallback;
		}
	}

	private _writeJson(workspaceRoot: string, fileName: string, data: unknown): void {
		if (!workspaceRoot) { return; }
		const dir = this._ensureDir(workspaceRoot);
		fs.writeFileSync(path.join(dir, fileName), JSON.stringify(data, null, 2), 'utf8');
	}

	async getRecentEvents(limit = 150): Promise<ApiLiveEvent[]> {
		return this._recentEvents.slice(-Math.max(1, Math.min(MAX_RING_EVENTS, limit)));
	}

	async loadWorkspaceSnapshot(workspaceRoot: string): Promise<ApiStudioWorkspaceSnapshot> {
		const collections = this._readJson<ApiCollection[]>(workspaceRoot, 'collections.json', []);
		const envState = this._readJson<{ environments: ApiEnvironment[]; activeEnvironmentId: string | null }>(
			workspaceRoot,
			'environments.json',
			{ environments: [], activeEnvironmentId: null },
		);
		const history = this._readJson<ApiHistoryEntry[]>(workspaceRoot, 'history.json', []);
		const suites = this._readJson<ApiTestSuite[]>(workspaceRoot, 'suites.json', []);
		const testRuns = this._readJson<ApiTestRunResult[]>(workspaceRoot, 'test-runs.json', []);
		const loadRuns = this._readJson<ApiLoadTestResult[]>(workspaceRoot, 'load-runs.json', []);
		const securityReports = this._readJson<ApiSecurityReport[]>(workspaceRoot, 'security-reports.json', []);
		const monitors = this._readJson<ApiMonitorConfig[]>(workspaceRoot, 'monitors.json', []);

		return {
			collections,
			environments: envState.environments,
			activeEnvironmentId: envState.activeEnvironmentId,
			history,
			suites,
			testRuns,
			loadRuns,
			securityReports,
			monitors,
			runtimes: [...this._runtimes.values()].map(r => ({ ...r.info, recentLogs: [...r.logs] })),
			mockServers: [...this._mocks.values()].map(m => ({ ...m.status, recentRequests: [...m.recentRequests] })),
			webSockets: [...this._webSockets.values()].map(w => ({ ...w.info, messages: [...w.messages] })),
		};
	}

	// ========================================================================
	// 1. SANDBOXED PRE-REQUEST & TEST SCRIPT ENGINE (Node vm — Zero Host Access)
	// ========================================================================

	private _runSandboxedScript(
		code: string,
		ctx: {
			vars: Record<string, string>;
			request: { method: string; url: string; headers: Record<string, string>; body?: string };
			response?: { status: number; statusText: string; headers: Readonly<Record<string, string>>; body: string; json: () => unknown; timeMs: number };
		},
		timeoutMs = 2000,
	): { logs: string[]; errors: string[]; assertions: ApiAssertionResult[]; varUpdates: Record<string, string> } {
		const logs: string[] = [];
		const errors: string[] = [];
		const assertions: ApiAssertionResult[] = [];
		const varUpdates: Record<string, string> = {};

		if (!code || !code.trim()) {
			return { logs, errors, assertions, varUpdates };
		}

		const makeExpect = (actual: unknown) => ({
			toBe: (expected: unknown) => {
				if (actual !== expected) { throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
			},
			toEqual: (expected: unknown) => {
				if (JSON.stringify(actual) !== JSON.stringify(expected)) { throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
			},
			toContain: (needle: unknown) => {
				const ok = typeof actual === 'string' ? actual.includes(String(needle)) : Array.isArray(actual) ? actual.includes(needle) : false;
				if (!ok) { throw new Error(`Expected ${JSON.stringify(actual)} to contain ${JSON.stringify(needle)}`); }
			},
			toBeTruthy: () => {
				if (!actual) { throw new Error(`Expected truthy value, got ${JSON.stringify(actual)}`); }
			},
			toBeGreaterThan: (n: number) => {
				if (!(Number(actual) > n)) { throw new Error(`Expected ${actual} > ${n}`); }
			},
			toBeLessThan: (n: number) => {
				if (!(Number(actual) < n)) { throw new Error(`Expected ${actual} < ${n}`); }
			},
		});

		const sandbox = vm.createContext({
			console: {
				log: (...args: unknown[]) => logs.push(args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')),
				warn: (...args: unknown[]) => logs.push(`[WARN] ${args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}`),
				error: (...args: unknown[]) => logs.push(`[ERR] ${args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}`),
			},
			kodia: {
				env: {
					get: (k: string) => ctx.vars[k],
					set: (k: string, v: unknown) => {
						const sv = String(v ?? '');
						ctx.vars[k] = sv;
						varUpdates[k] = sv;
					},
				},
				request: ctx.request,
				response: ctx.response,
				expect: makeExpect,
				test: (name: string, fn: () => void) => {
					try {
						fn();
						assertions.push({
							id: `script-${assertions.length + 1}`,
							name,
							kind: 'body_contains',
							passed: true,
							expected: 'pass',
							actual: 'pass',
							message: `Script test passed: ${name}`,
						});
					} catch (e) {
						const msg = e instanceof Error ? e.message : String(e);
						assertions.push({
							id: `script-${assertions.length + 1}`,
							name,
							kind: 'body_contains',
							passed: false,
							expected: 'pass',
							actual: msg,
							message: msg,
						});
					}
				},
			},
			JSON,
			Math,
			Date,
			RegExp,
			Number,
			String,
			Boolean,
			Array,
			Object,
			encodeURIComponent,
			decodeURIComponent,
		});

		try {
			vm.runInContext(code, sandbox, { timeout: timeoutMs });
		} catch (e) {
			errors.push(e instanceof Error ? e.message : String(e));
		}

		return { logs, errors, assertions, varUpdates };
	}

	// ========================================================================
	// 2. REAL HTTP / HTTPS / GRAPHQL / SOAP / MULTIPART / SSE CLIENT
	// ========================================================================

	private _collectEnvContext(workspaceRoot: string, environmentId?: string, extraVariables?: Record<string, string>): {
		env?: ApiEnvironment;
		vars: Record<string, string>;
		secretValues: string[];
	} {
		const envState = this._readJson<{ environments: ApiEnvironment[]; activeEnvironmentId: string | null }>(
			workspaceRoot,
			'environments.json',
			{ environments: [], activeEnvironmentId: null },
		);
		const targetId = environmentId ?? envState.activeEnvironmentId ?? undefined;
		const env = targetId ? envState.environments.find(e => e.id === targetId || e.name.toLowerCase() === targetId.toLowerCase()) : undefined;
		const vars: Record<string, string> = {};
		const secretValues: string[] = [];
		if (env?.baseUrl) { vars['baseUrl'] = env.baseUrl; }
		for (const v of env?.variables ?? []) {
			if (!v.enabled || !v.key.trim()) { continue; }
			vars[v.key.trim()] = v.value;
			if (v.secret && v.value) { secretValues.push(v.value); }
		}
		for (const [k, v] of Object.entries(extraVariables ?? {})) {
			vars[k] = v;
		}
		return { env, vars, secretValues };
	}

	async cancelExecution(executionId: string): Promise<boolean> {
		const ac = this._activeCancellations.get(executionId);
		if (!ac) { return false; }
		ac.abort();
		this._activeCancellations.delete(executionId);
		this._emit('execution_cancelled', executionId, `Cancelled execution ${executionId}`);
		return true;
	}

	async executeRequest(workspaceRoot: string, opts: {
		request: ApiRequestSpec;
		environmentId?: string;
		extraVariables?: Record<string, string>;
		allowProtectedEnvironment?: boolean;
		executionId?: string;
		suiteId?: string;
		persistHistory?: boolean;
	}): Promise<ApiResponseResult> {
		const executionId = opts.executionId || `exec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
		const { env, vars, secretValues } = this._collectEnvContext(workspaceRoot, opts.environmentId, opts.extraVariables);
		const req = opts.request;
		const scriptLogs: string[] = [];
		const scriptErrors: string[] = [];
		const variableUpdates: Record<string, string> = {};

		// Production safety guard for destructive requests
		const isDestructive = req.method === 'DELETE' || req.method === 'PUT' || req.method === 'PATCH';
		if (env && (env.kind === 'production' || env.isProtected) && isDestructive && !opts.allowProtectedEnvironment) {
			const errMsg = `Blocked ${req.method} against protected production environment "${env.name}". Pass allowProtectedEnvironment=true after explicit confirmation.`;
			this._emit('execution_error', executionId, errMsg, { requestId: req.id, environmentId: env.id, method: req.method, url: req.url });
			return {
				requestId: req.id,
				executionId,
				timestamp: new Date().toISOString(),
				protocol: req.protocol,
				method: req.method,
				resolvedUrl: req.url,
				status: 0,
				statusText: 'Blocked by Production Safeguard',
				ok: false,
				headers: {},
				transmittedHeaders: {},
				cookies: [],
				contentType: '',
				body: '',
				sizeBytes: 0,
				timing: { dnsMs: null, connectMs: null, tlsMs: null, ttfbMs: null, downloadMs: null, totalMs: 0, measuredPhases: false },
				redirects: [],
				assertionResults: [],
				scriptLogs,
				scriptErrors: [errMsg],
				variableUpdates,
				error: errMsg,
			};
		}

		// Resolve headers & URL for pre-request script
		const headers: Record<string, string> = {};
		for (const h of req.headers ?? []) {
			if (!h.enabled || !h.key.trim()) { continue; }
			headers[h.key.trim()] = resolveApiVariables(h.value, vars);
			if (h.secret && h.value) { secretValues.push(headers[h.key.trim()]); }
		}

		if (req.preRequestScript?.trim()) {
			const pre = this._runSandboxedScript(req.preRequestScript, {
				vars,
				request: { method: req.method, url: resolveApiVariables(req.url, vars), headers, body: req.body?.raw },
			});
			scriptLogs.push(...pre.logs);
			scriptErrors.push(...pre.errors);
			Object.assign(variableUpdates, pre.varUpdates);
		}

		let resolvedUrl = resolveApiVariables(req.url.trim(), vars);
		if (!/^https?:\/\//i.test(resolvedUrl) && vars['baseUrl']) {
			resolvedUrl = `${vars['baseUrl'].replace(/\/+$/, '')}/${resolvedUrl.replace(/^\/+/, '')}`;
		}

		// Attach query parameters
		let parsedUrl: URL;
		try {
			parsedUrl = new URL(resolvedUrl);
		} catch (e) {
			const errMsg = `Invalid URL "${resolvedUrl}": ${e instanceof Error ? e.message : String(e)}`;
			this._emit('execution_error', executionId, errMsg, { requestId: req.id, method: req.method, url: resolvedUrl });
			return {
				requestId: req.id, executionId, timestamp: new Date().toISOString(), protocol: req.protocol, method: req.method,
				resolvedUrl, status: 0, statusText: 'Invalid URL', ok: false, headers: {}, transmittedHeaders: {}, cookies: [],
				contentType: '', body: '', sizeBytes: 0,
				timing: { dnsMs: null, connectMs: null, tlsMs: null, ttfbMs: null, downloadMs: null, totalMs: 0, measuredPhases: false },
				redirects: [], assertionResults: [], scriptLogs, scriptErrors, variableUpdates, error: errMsg,
			};
		}

		for (const p of req.params ?? []) {
			if (!p.enabled || !p.key.trim()) { continue; }
			parsedUrl.searchParams.set(resolveApiVariables(p.key.trim(), vars), resolveApiVariables(p.value, vars));
		}

		// Resolve Authentication
		const auth = req.auth;
		if (auth.type === 'basic') {
			const user = resolveApiVariables(auth.username, vars);
			const pass = resolveApiVariables(auth.password, vars);
			if (pass) { secretValues.push(pass); }
			headers['Authorization'] = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
		} else if (auth.type === 'bearer') {
			const tok = resolveApiVariables(auth.token, vars);
			if (tok) { secretValues.push(tok); }
			headers['Authorization'] = `${auth.prefix || 'Bearer'} ${tok}`;
		} else if (auth.type === 'api-key') {
			const k = resolveApiVariables(auth.key, vars);
			const v = resolveApiVariables(auth.value, vars);
			if (v) { secretValues.push(v); }
			if (auth.addTo === 'query') { parsedUrl.searchParams.set(k, v); }
			else { headers[k] = v; }
		} else if (auth.type === 'oauth2' && auth.accessToken) {
			const tok = resolveApiVariables(auth.accessToken, vars);
			if (tok) { secretValues.push(tok); }
			headers['Authorization'] = `Bearer ${tok}`;
		} else if (auth.type === 'custom' && auth.headerName) {
			const hv = resolveApiVariables(auth.headerValue, vars);
			if (hv) { secretValues.push(hv); }
			headers[auth.headerName] = hv;
		}

		// Build Request Body Buffer (defensively handle plain objects / missing mode as JSON)
		let bodyBuffer: Buffer | undefined;
		const setHeaderIfMissing = (name: string, value: string) => {
			if (!Object.keys(headers).some(k => k.toLowerCase() === name.toLowerCase())) {
				headers[name] = value;
			}
		};

		const rawBodyObj = req.body as ApiRequestBody | Record<string, unknown> | undefined;
		const bodyMode = rawBodyObj && typeof (rawBodyObj as { mode?: unknown }).mode === 'string'
			? (rawBodyObj as ApiRequestBody).mode
			: (rawBodyObj && typeof rawBodyObj === 'object' && Object.keys(rawBodyObj).length > 0 ? 'json' : 'none');

		if (bodyMode === 'json') {
			setHeaderIfMissing('Content-Type', 'application/json');
			const rawStr = typeof (rawBodyObj as ApiRequestBody).raw === 'string'
				? (rawBodyObj as ApiRequestBody).raw!
				: (rawBodyObj && typeof (rawBodyObj as { mode?: unknown }).mode === 'string'
					? JSON.stringify((rawBodyObj as ApiRequestBody).raw ?? {})
					: JSON.stringify(rawBodyObj));
			bodyBuffer = Buffer.from(resolveApiVariables(rawStr, vars), 'utf8');
		} else if (bodyMode === 'xml') {
			setHeaderIfMissing('Content-Type', 'application/xml');
			bodyBuffer = Buffer.from(resolveApiVariables((rawBodyObj as ApiRequestBody).raw ?? '', vars), 'utf8');
		} else if (bodyMode === 'soap') {
			setHeaderIfMissing('Content-Type', 'text/xml; charset=utf-8');
			if ((rawBodyObj as ApiRequestBody).soapAction) { setHeaderIfMissing('SOAPAction', (rawBodyObj as ApiRequestBody).soapAction!); }
			bodyBuffer = Buffer.from(resolveApiVariables((rawBodyObj as ApiRequestBody).raw ?? '', vars), 'utf8');
		} else if (bodyMode === 'graphql') {
			setHeaderIfMissing('Content-Type', 'application/json');
			let gqlVars: unknown = {};
			const b = rawBodyObj as ApiRequestBody;
			if (b.graphqlVariables?.trim()) {
				try { gqlVars = JSON.parse(resolveApiVariables(b.graphqlVariables, vars)); } catch { gqlVars = {}; }
			}
			bodyBuffer = Buffer.from(JSON.stringify({
				query: resolveApiVariables(b.graphqlQuery ?? '', vars),
				variables: gqlVars,
				...(b.graphqlOperationName ? { operationName: b.graphqlOperationName } : {}),
			}), 'utf8');
		} else if (bodyMode === 'text' || bodyMode === 'html') {
			setHeaderIfMissing('Content-Type', bodyMode === 'html' ? 'text/html' : 'text/plain');
			bodyBuffer = Buffer.from(resolveApiVariables((rawBodyObj as ApiRequestBody).raw ?? '', vars), 'utf8');
		} else if (bodyMode === 'form-urlencoded') {
			setHeaderIfMissing('Content-Type', 'application/x-www-form-urlencoded');
			const b = rawBodyObj as ApiRequestBody;
			const enabledFields = (b.formFields ?? []).filter(f => f.enabled && f.key.trim());
			if (enabledFields.length > 0) {
				const sp = new URLSearchParams();
				for (const f of enabledFields) {
					sp.append(f.key.trim(), resolveApiVariables(f.value, vars));
				}
				bodyBuffer = Buffer.from(sp.toString(), 'utf8');
			} else if (b.raw) {
				bodyBuffer = Buffer.from(resolveApiVariables(b.raw, vars), 'utf8');
			}
		} else if (bodyMode === 'multipart') {
			const boundary = `----KodiaApiBoundary${Date.now().toString(16)}`;
			setHeaderIfMissing('Content-Type', `multipart/form-data; boundary=${boundary}`);
			const chunks: Buffer[] = [];
			for (const part of req.body.multipartParts ?? []) {
				if (!part.enabled || !part.key.trim()) { continue; }
				if (part.kind === 'file' && part.filePath && fs.existsSync(part.filePath)) {
					const filename = path.basename(part.filePath);
					const fileData = fs.readFileSync(part.filePath);
					chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${part.key}"; filename="${filename}"\r\nContent-Type: ${part.contentType || 'application/octet-stream'}\r\n\r\n`));
					chunks.push(fileData);
					chunks.push(Buffer.from('\r\n'));
				} else {
					chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${part.key}"\r\n\r\n${resolveApiVariables(part.value, vars)}\r\n`));
				}
			}
			chunks.push(Buffer.from(`--${boundary}--\r\n`));
			bodyBuffer = Buffer.concat(chunks);
		} else if (req.body.mode === 'binary' && req.body.binaryFilePath && fs.existsSync(req.body.binaryFilePath)) {
			setHeaderIfMissing('Content-Type', 'application/octet-stream');
			bodyBuffer = fs.readFileSync(req.body.binaryFilePath);
		}

		if (bodyBuffer) {
			headers['Content-Length'] = String(bodyBuffer.byteLength);
		}
		if (req.protocol === 'sse') {
			setHeaderIfMissing('Accept', 'text/event-stream');
		}
		setHeaderIfMissing('User-Agent', 'Kodia-API-Engineering-Studio/1.0');

		const finalUrl = parsedUrl.toString();
		const ac = new AbortController();
		this._activeCancellations.set(executionId, ac);

		this._emit('request_queued', executionId, `Queued ${req.method} ${finalUrl}`, { requestId: req.id, environmentId: env?.id, method: req.method, url: finalUrl });

		const maxRedirects = req.followRedirects === false ? 0 : 5;
		const timeoutMs = Math.max(500, Math.min(120_000, req.timeoutMs ?? 15_000));
		const redirects: Array<{ from: string; to: string; status: number }> = [];

		const doFetch = (targetUrl: URL, redirectsLeft: number): Promise<ApiResponseResult> => {
			return new Promise(resolve => {
				const tStart = performance.now();
				let tDns: number | null = null;
				let tConnect: number | null = null;
				let tTls: number | null = null;
				let tFirstByte: number | null = null;
				let remoteAddress: string | undefined;

				const transport = targetUrl.protocol === 'https:' ? https : http;
				this._emit('request_dispatched', executionId, `Dispatched ${req.method} ${targetUrl.toString()}`, { requestId: req.id, method: req.method, url: targetUrl.toString() });

				const httpReq = transport.request(
					targetUrl,
					{
						method: req.method,
						headers,
						timeout: timeoutMs,
						signal: ac.signal,
					},
					res => {
						tFirstByte = performance.now();
						const statusCode = res.statusCode ?? 0;
						const statusText = res.statusMessage ?? '';
						const resHeaders: Record<string, string> = {};
						for (const [hk, hv] of Object.entries(res.headers)) {
							if (hv !== undefined) {
								resHeaders[hk] = Array.isArray(hv) ? hv.join(', ') : hv;
							}
						}
						this._emit('response_headers_received', executionId, `HTTP ${statusCode} ${statusText} headers received`, {
							requestId: req.id,
							method: req.method,
							url: targetUrl.toString(),
							status: statusCode,
							durationMs: Math.round((tFirstByte - tStart) * 10) / 10,
						});

						// Follow redirects when enabled
						if ([301, 302, 303, 307, 308].includes(statusCode) && resHeaders['location'] && redirectsLeft > 0) {
							res.resume();
							const nextUrl = new URL(resHeaders['location'], targetUrl);
							redirects.push({ from: targetUrl.toString(), to: nextUrl.toString(), status: statusCode });
							void doFetch(nextUrl, redirectsLeft - 1).then(resolve);
							return;
						}

						const chunks: Buffer[] = [];
						let totalBytes = 0;
						const maxBytes = 10 * 1024 * 1024;
						let truncated = false;
						const contentType = resHeaders['content-type'] ?? '';
						const isSse = req.protocol === 'sse' || contentType.toLowerCase().includes('text/event-stream');

						res.on('data', (chunk: Buffer) => {
							if (totalBytes + chunk.byteLength <= maxBytes) {
								chunks.push(chunk);
								totalBytes += chunk.byteLength;
							} else {
								truncated = true;
							}
							if (isSse) {
								this._emit('stream_message', executionId, `SSE chunk (${chunk.byteLength}B)`, {
									requestId: req.id,
									method: req.method,
									url: targetUrl.toString(),
									payload: { chunk: chunk.toString('utf8').slice(0, 500) },
								});
							}
						});

						res.on('end', () => {
							const tEnd = performance.now();
							const rawBody = Buffer.concat(chunks).toString('utf8');
							const cookies = parseSetCookieHeaders(res.headers['set-cookie']);
							const totalMs = Math.round((tEnd - tStart) * 10) / 10;
							const timing = {
								dnsMs: tDns !== null ? Math.round((tDns - tStart) * 10) / 10 : null,
								connectMs: tConnect !== null ? Math.round((tConnect - (tDns ?? tStart)) * 10) / 10 : null,
								tlsMs: tTls !== null && tConnect !== null ? Math.round((tTls - tConnect) * 10) / 10 : null,
								ttfbMs: tFirstByte !== null ? Math.round((tFirstByte - tStart) * 10) / 10 : null,
								downloadMs: tFirstByte !== null ? Math.round((tEnd - tFirstByte) * 10) / 10 : null,
								totalMs,
								measuredPhases: true,
							};

							const baseResult: ApiResponseResult = {
								requestId: req.id,
								executionId,
								timestamp: new Date().toISOString(),
								protocol: isSse ? 'sse' : req.protocol,
								method: req.method,
								resolvedUrl: targetUrl.toString(),
								status: statusCode,
								statusText,
								ok: statusCode >= 200 && statusCode < 300,
								headers: resHeaders,
								transmittedHeaders: redactHeaders(headers, secretValues),
								cookies,
								contentType,
								body: rawBody,
								bodyTruncated: truncated || undefined,
								sizeBytes: totalBytes,
								timing,
								redirects,
								remoteAddress,
								httpVersion: res.httpVersion,
								assertionResults: [],
								scriptLogs,
								scriptErrors,
								variableUpdates,
								sseEvents: isSse ? parseSseBody(rawBody) : undefined,
								isMock: resHeaders['x-kodia-mock'] === 'true' || undefined,
							};

							// Declarative assertions
							const assertionResults: ApiAssertionResult[] = evaluateApiAssertions(req.assertions ?? [], baseResult);

							// Variable extractions from JSONPath
							if (req.extractVariables?.length) {
								try {
									const parsedJson = JSON.parse(rawBody);
									for (const ex of req.extractVariables) {
										const q = queryJsonPath(parsedJson, ex.jsonPath);
										if (q.found && q.value !== undefined) {
											const strVal = typeof q.value === 'string' ? q.value : JSON.stringify(q.value);
											variableUpdates[ex.variableName] = strVal;
											vars[ex.variableName] = strVal;
										}
									}
								} catch { /* non-JSON body */ }
							}

							// Post-response / test script
							if (req.testScript?.trim()) {
								const post = this._runSandboxedScript(req.testScript, {
									vars,
									request: { method: req.method, url: targetUrl.toString(), headers: redactHeaders(headers, secretValues), body: req.body.raw },
									response: {
										status: statusCode,
										statusText,
										headers: resHeaders,
										body: rawBody,
										json: () => JSON.parse(rawBody),
										timeMs: totalMs,
									},
								});
								scriptLogs.push(...post.logs);
								scriptErrors.push(...post.errors);
								assertionResults.push(...post.assertions);
								Object.assign(variableUpdates, post.varUpdates);
							}

							for (const ar of assertionResults) {
								this._emit('assertion_result', executionId, `${ar.passed ? 'PASS' : 'FAIL'}: ${ar.name} — ${ar.message}`, {
									requestId: req.id,
									passed: ar.passed,
									method: req.method,
									url: targetUrl.toString(),
								});
							}

							const finalResult: ApiResponseResult = {
								...baseResult,
								assertionResults,
								scriptLogs,
								scriptErrors,
								variableUpdates,
							};

							this._emit('response_completed', executionId, `${req.method} ${targetUrl.toString()} -> HTTP ${statusCode} (${totalMs}ms, ${totalBytes}B)`, {
								requestId: req.id,
								method: req.method,
								url: targetUrl.toString(),
								status: statusCode,
								durationMs: totalMs,
								passed: assertionResults.length > 0 ? assertionResults.every(a => a.passed) : finalResult.ok,
							});
							resolve(finalResult);
						});
					},
				);

				httpReq.on('socket', socket => {
					socket.once('lookup', () => { tDns = performance.now(); });
					socket.once('connect', () => {
						tConnect = performance.now();
						remoteAddress = socket.remoteAddress;
						this._emit('connection_established', executionId, `Connected to ${socket.remoteAddress ?? targetUrl.host}`, {
							requestId: req.id,
							method: req.method,
							url: targetUrl.toString(),
						});
					});
					socket.once('secureConnect', () => { tTls = performance.now(); });
				});

				httpReq.on('timeout', () => {
					httpReq.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
				});

				httpReq.on('error', err => {
					const totalMs = Math.round((performance.now() - tStart) * 10) / 10;
					const errMsg = err instanceof Error ? err.message : String(err);
					this._emit('execution_error', executionId, `${req.method} ${targetUrl.toString()} failed: ${errMsg}`, {
						requestId: req.id,
						method: req.method,
						url: targetUrl.toString(),
						durationMs: totalMs,
					});
					resolve({
						requestId: req.id,
						executionId,
						timestamp: new Date().toISOString(),
						protocol: req.protocol,
						method: req.method,
						resolvedUrl: targetUrl.toString(),
						status: 0,
						statusText: 'Network Error',
						ok: false,
						headers: {},
						transmittedHeaders: redactHeaders(headers, secretValues),
						cookies: [],
						contentType: '',
						body: '',
						sizeBytes: 0,
						timing: { dnsMs: null, connectMs: null, tlsMs: null, ttfbMs: null, downloadMs: null, totalMs, measuredPhases: false },
						redirects,
						assertionResults: [],
						scriptLogs,
						scriptErrors,
						variableUpdates,
						error: errMsg,
					});
				});

				if (bodyBuffer) { httpReq.write(bodyBuffer); }
				httpReq.end();
			});
		};

		try {
			const response = await doFetch(parsedUrl, maxRedirects);

			// Persist updated environment variables if scripts updated any
			if (env && Object.keys(variableUpdates).length > 0 && workspaceRoot) {
				const envState = this._readJson<{ environments: ApiEnvironment[]; activeEnvironmentId: string | null }>(
					workspaceRoot,
					'environments.json',
					{ environments: [], activeEnvironmentId: null },
				);
				const updatedEnvs = envState.environments.map(e => {
					if (e.id !== env.id) { return e; }
					const nextVars = [...e.variables];
					for (const [vk, vv] of Object.entries(variableUpdates)) {
						const idx = nextVars.findIndex(x => x.key === vk);
						if (idx >= 0) { nextVars[idx] = { ...nextVars[idx], value: vv, enabled: true }; }
						else { nextVars.push({ id: `v-${Date.now().toString(36)}-${nextVars.length}`, key: vk, value: vv, enabled: true }); }
					}
					return { ...e, variables: nextVars, updatedAt: new Date().toISOString() };
				});
				this._writeJson(workspaceRoot, 'environments.json', { ...envState, environments: updatedEnvs });
			}

			// Persist redacted history entry
			if (opts.persistHistory !== false && workspaceRoot) {
				const redactedReq: ApiRequestSpec = {
					...req,
					headers: req.headers.map(h => h.secret ? { ...h, value: '[REDACTED]' } : h),
					auth: req.auth.type === 'bearer' ? { ...req.auth, token: '[REDACTED]' }
						: req.auth.type === 'basic' ? { ...req.auth, password: '[REDACTED]' }
							: req.auth.type === 'api-key' ? { ...req.auth, value: '[REDACTED]' }
								: req.auth,
				};
				const entry: ApiHistoryEntry = {
					id: `hist-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
					executionId,
					timestamp: response.timestamp,
					request: redactedReq,
					response: {
						...response,
						body: redactApiSecrets(response.body.slice(0, 64_000), secretValues),
					},
					environmentId: env?.id,
					suiteId: opts.suiteId,
				};
				const prev = this._readJson<ApiHistoryEntry[]>(workspaceRoot, 'history.json', []);
				this._writeJson(workspaceRoot, 'history.json', [entry, ...prev].slice(0, 200));
			}

			return response;
		} finally {
			this._activeCancellations.delete(executionId);
		}
	}

	// ========================================================================
	// 3. REAL WEBSOCKET SESSION MANAGER (`ws`) & OPTIONAL GRPC ADAPTER
	// ========================================================================

	async connectWebSocket(_workspaceRoot: string, opts: { url: string; headers?: Record<string, string>; protocols?: string[] }): Promise<ApiWebSocketSessionInfo> {
		const sessionId = `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
		const connectedAt = new Date().toISOString();
		const messages: ApiWebSocketMessage[] = [];
		const WsCtor = await loadWebSocketCtor();

		return new Promise(resolve => {
			let settled = false;
			const ws = new WsCtor(opts.url, opts.protocols, { headers: opts.headers, handshakeTimeout: 8000 });
			const record: ManagedWsRecord = {
				info: { sessionId, url: opts.url, status: 'connecting', messages, connectedAt },
				ws,
				messages,
			};
			this._webSockets.set(sessionId, record);

			ws.on('upgrade', res => {
				const hdrs: Record<string, string> = {};
				for (const [k, v] of Object.entries(res.headers)) {
					if (v !== undefined) { hdrs[k] = Array.isArray(v) ? v.join(', ') : v; }
				}
				record.info = { ...record.info, handshakeStatus: res.statusCode, handshakeHeaders: hdrs };
			});

			ws.on('open', () => {
				record.info = { ...record.info, status: 'open' };
				const sysMsg: ApiWebSocketMessage = {
					id: `m-${messages.length + 1}`, direction: 'system', kind: 'text',
					data: `Connected to ${opts.url}`, sizeBytes: 0, timestamp: new Date().toISOString(),
				};
				messages.push(sysMsg);
				this._emit('connection_established', sessionId, `WebSocket connected: ${opts.url}`, { url: opts.url });
				if (!settled) { settled = true; resolve({ ...record.info, messages: [...messages] }); }
			});

			ws.on('message', (data, isBinary) => {
				const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
				const text = isBinary ? buf.toString('base64') : buf.toString('utf8');
				let kind: ApiWebSocketMessage['kind'] = isBinary ? 'binary' : 'text';
				if (!isBinary) {
					try { JSON.parse(text); kind = 'json'; } catch { /* text */ }
				}
				const msg: ApiWebSocketMessage = {
					id: `m-${messages.length + 1}`,
					direction: 'received',
					kind,
					data: text,
					sizeBytes: buf.byteLength,
					timestamp: new Date().toISOString(),
				};
				messages.push(msg);
				if (messages.length > 200) { messages.shift(); }
				this._emit('stream_message', sessionId, `WS <= ${text.slice(0, 120)}`, { url: opts.url, payload: { direction: 'received', kind, data: text.slice(0, 500) } });
			});

			ws.on('pong', () => {
				const msg: ApiWebSocketMessage = { id: `m-${messages.length + 1}`, direction: 'received', kind: 'pong', data: 'pong', sizeBytes: 4, timestamp: new Date().toISOString() };
				messages.push(msg);
				this._emit('stream_message', sessionId, 'WS <= pong', { url: opts.url });
			});

			ws.on('close', () => {
				record.info = { ...record.info, status: 'closed', closedAt: new Date().toISOString() };
				this._emit('execution_stopped' as ApiLiveEventType, sessionId, `WebSocket closed: ${opts.url}`, { url: opts.url });
			});

			ws.on('error', err => {
				const errMsg = err instanceof Error ? err.message : String(err);
				record.info = { ...record.info, status: 'error', error: errMsg };
				this._emit('execution_error', sessionId, `WebSocket error: ${errMsg}`, { url: opts.url });
				if (!settled) { settled = true; resolve({ ...record.info, messages: [...messages] }); }
			});
		});
	}

	async sendWebSocketMessage(sessionId: string, data: string, kind: 'text' | 'json' | 'ping' = 'text'): Promise<ApiWebSocketSessionInfo> {
		const rec = this._webSockets.get(sessionId);
		if (!rec) { throw new Error(`WebSocket session "${sessionId}" not found.`); }
		if (rec.ws.readyState !== 1 /* WebSocket.OPEN */) {
			throw new Error(`WebSocket session "${sessionId}" is not open (state=${rec.info.status}).`);
		}
		if (kind === 'ping') {
			rec.ws.ping();
		} else {
			rec.ws.send(data);
		}
		const msg: ApiWebSocketMessage = {
			id: `m-${rec.messages.length + 1}`,
			direction: 'sent',
			kind,
			data,
			sizeBytes: Buffer.byteLength(data, 'utf8'),
			timestamp: new Date().toISOString(),
		};
		rec.messages.push(msg);
		this._emit('stream_message', sessionId, `WS => ${data.slice(0, 120)}`, { url: rec.info.url, payload: { direction: 'sent', kind, data: data.slice(0, 500) } });
		// Brief micro-wait so immediate echo frames are captured cleanly in the returned snapshot
		await new Promise(r => setTimeout(r, 60));
		return { ...rec.info, messages: [...rec.messages] };
	}

	async closeWebSocket(sessionId: string): Promise<ApiWebSocketSessionInfo | null> {
		const rec = this._webSockets.get(sessionId);
		if (!rec) { return null; }
		try { rec.ws.close(); } catch { /* ignore */ }
		rec.info = { ...rec.info, status: 'closed', closedAt: new Date().toISOString() };
		return { ...rec.info, messages: [...rec.messages] };
	}

	async listWebSockets(): Promise<ApiWebSocketSessionInfo[]> {
		return [...this._webSockets.values()].map(r => ({ ...r.info, messages: [...r.messages] }));
	}

	async invokeGrpc(workspaceRoot: string, opts: {
		address: string;
		serviceMethod: string;
		payloadJson: string;
		protoPath?: string;
		plaintext?: boolean;
		metadata?: Record<string, string>;
	}): Promise<{ ok: boolean; output: string; durationMs: number; engine: string; error?: string }> {
		const t0 = performance.now();
		const args: string[] = [];
		if (opts.plaintext !== false) { args.push('-plaintext'); }
		if (opts.protoPath) { args.push('-proto', opts.protoPath); }
		for (const [k, v] of Object.entries(opts.metadata ?? {})) {
			args.push('-H', `${k}: ${v}`);
		}
		args.push('-d', opts.payloadJson || '{}', opts.address, opts.serviceMethod);

		return new Promise(resolve => {
			cp.execFile('grpcurl', args, { cwd: workspaceRoot || undefined, timeout: 15_000, windowsHide: true }, (err, stdout, stderr) => {
				const durationMs = Math.round((performance.now() - t0) * 10) / 10;
				if (err) {
					const missing = (err as NodeJS.ErrnoException).code === 'ENOENT';
					resolve({
						ok: false,
						output: String(stdout ?? ''),
						durationMs,
						engine: 'grpcurl',
						error: missing
							? 'grpcurl CLI is not installed on this machine. Install grpcurl to invoke live gRPC RPCs (proto discovery still works natively).'
							: (String(stderr ?? '').trim() || err.message),
					});
					return;
				}
				resolve({ ok: true, output: String(stdout ?? '').trim(), durationMs, engine: 'grpcurl' });
			});
		});
	}

	// ========================================================================
	// 4. REAL API RUNTIME MANAGER (Multi-Service Process Lifecycle & Health)
	// ========================================================================

	async startRuntime(workspaceRoot: string, opts: {
		name: string;
		command: string;
		cwd?: string;
		port?: number;
		healthUrl?: string;
		env?: Record<string, string>;
		readyTimeoutMs?: number;
	}): Promise<ApiManagedRuntimeInfo> {
		const runtimeId = `rt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
		const cwd = opts.cwd ? (path.isAbsolute(opts.cwd) ? opts.cwd : path.join(workspaceRoot, opts.cwd)) : (workspaceRoot || process.cwd());
		const startedAt = new Date().toISOString();
		const logs: string[] = [];

		const rec: ManagedRuntimeRecord = {
			info: {
				runtimeId,
				name: opts.name,
				command: opts.command,
				cwd,
				port: opts.port,
				baseUrl: opts.port ? `http://127.0.0.1:${opts.port}` : undefined,
				healthUrl: opts.healthUrl,
				status: 'starting',
				startedAt,
				recentLogs: logs,
			},
			logs,
		};
		this._runtimes.set(runtimeId, rec);
		this._emit('runtime_starting', runtimeId, `Starting API service "${opts.name}": ${opts.command}`, { runtimeId, serviceName: opts.name });

		const proc = cp.spawn(opts.command, {
			cwd,
			shell: true,
			windowsHide: true,
			env: { ...process.env, ...(opts.port ? { PORT: String(opts.port) } : {}), ...(opts.env ?? {}) },
		});
		rec.proc = proc;
		rec.info = { ...rec.info, pid: proc.pid };

		const appendLog = (prefix: string, chunk: Buffer) => {
			for (const rawLine of chunk.toString('utf8').split(/\r?\n/)) {
				const line = rawLine.trimEnd();
				if (!line) { continue; }
				const entry = `[${prefix}] ${line}`;
				logs.push(entry);
				if (logs.length > MAX_RUNTIME_LOGS) { logs.shift(); }
				this._emit('runtime_log', runtimeId, entry, { runtimeId, serviceName: opts.name });

				// Auto-detect listening port from stdout/stderr
				if (!rec.info.port) {
					const portMatch = /(?:https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5}))|(?:listening(?:\s+on)?(?:\s+port)?\s*:?\s*(\d{2,5}))|(?:port\s*[=:]\s*(\d{2,5}))/i.exec(line);
					const detected = Number(portMatch?.[1] || portMatch?.[2] || portMatch?.[3]);
					if (detected > 0 && detected < 65536) {
						rec.info = { ...rec.info, port: detected, baseUrl: `http://127.0.0.1:${detected}` };
					}
				}
			}
		};

		proc.stdout?.on('data', d => appendLog('stdout', d));
		proc.stderr?.on('data', d => appendLog('stderr', d));
		proc.on('exit', code => {
			if (rec.info.status !== 'stopped') {
				rec.info = {
					...rec.info,
					status: code === 0 ? 'stopped' : 'failed',
					exitCode: code,
					stoppedAt: new Date().toISOString(),
					error: code && code !== 0 ? `Process exited with code ${code}` : undefined,
				};
				this._emit(code === 0 ? 'runtime_stopped' : 'runtime_failed', runtimeId, `Service "${opts.name}" exited (code=${code})`, { runtimeId, serviceName: opts.name });
			}
		});

		// Poll until healthUrl or detected port responds, or process exits
		const deadline = Date.now() + Math.max(1500, Math.min(30_000, opts.readyTimeoutMs ?? 10_000));
		while (Date.now() < deadline) {
			if (rec.info.status === 'failed' || rec.info.status === 'stopped') { break; }
			const probeUrl = opts.healthUrl || (rec.info.port ? `http://127.0.0.1:${rec.info.port}/` : undefined);
			if (probeUrl) {
				const alive = await this._probeHttpAlive(probeUrl);
				if (alive) {
					rec.info = { ...rec.info, status: 'ready', baseUrl: rec.info.baseUrl ?? new URL(probeUrl).origin };
					this._emit('runtime_ready', runtimeId, `Service "${opts.name}" ready at ${rec.info.baseUrl} (PID ${proc.pid ?? 'n/a'})`, {
						runtimeId, serviceName: opts.name, url: rec.info.baseUrl,
					});
					break;
				}
			}
			await new Promise(r => setTimeout(r, 150));
		}

		if (rec.info.status === 'starting') {
			rec.info = { ...rec.info, status: proc.exitCode === null ? 'ready' : 'failed' };
			if (rec.info.status === 'ready') {
				this._emit('runtime_ready', runtimeId, `Service "${opts.name}" running (PID ${proc.pid ?? 'n/a'})`, { runtimeId, serviceName: opts.name, url: rec.info.baseUrl });
			}
		}

		return { ...rec.info, recentLogs: [...logs] };
	}

	private _probeHttpAlive(urlStr: string): Promise<boolean> {
		return new Promise(resolve => {
			try {
				const u = new URL(urlStr);
				const mod = u.protocol === 'https:' ? https : http;
				const req = mod.request(u, { method: 'GET', timeout: 800 }, res => {
					res.resume();
					resolve(true);
				});
				req.on('error', () => resolve(false));
				req.on('timeout', () => { req.destroy(); resolve(false); });
				req.end();
			} catch {
				resolve(false);
			}
		});
	}

	async stopRuntime(runtimeId: string): Promise<ApiManagedRuntimeInfo | null> {
		const rec = this._runtimes.get(runtimeId);
		if (!rec) { return null; }
		rec.info = { ...rec.info, status: 'stopped', stoppedAt: new Date().toISOString() };
		this._killProc(rec.proc);
		if (rec.proc && rec.proc.exitCode === null) {
			await new Promise<void>(resolve => {
				const timer = setTimeout(resolve, 400);
				rec.proc!.once('exit', () => { clearTimeout(timer); resolve(); });
			});
		}
		this._emit('runtime_stopped', runtimeId, `Stopped API service "${rec.info.name}"`, { runtimeId, serviceName: rec.info.name });
		return { ...rec.info, recentLogs: [...rec.logs] };
	}

	async stopAllRuntimes(): Promise<number> {
		let count = 0;
		for (const id of [...this._runtimes.keys()]) {
			const r = this._runtimes.get(id);
			if (r && (r.info.status === 'starting' || r.info.status === 'ready')) {
				await this.stopRuntime(id);
				count++;
			}
		}
		return count;
	}

	async listRuntimes(): Promise<ApiManagedRuntimeInfo[]> {
		return [...this._runtimes.values()].map(r => ({ ...r.info, recentLogs: [...r.logs] }));
	}

	// ========================================================================
	// 5. COLLECTIONS, ENVIRONMENTS & TEST SUITES PERSISTENCE
	// ========================================================================

	async saveCollection(workspaceRoot: string, collection: ApiCollection): Promise<ApiCollection[]> {
		const existing = this._readJson<ApiCollection[]>(workspaceRoot, 'collections.json', []).filter(c => c.id !== collection.id);
		const updated = [collection, ...existing];
		this._writeJson(workspaceRoot, 'collections.json', updated);
		return updated;
	}

	async deleteCollection(workspaceRoot: string, collectionId: string): Promise<ApiCollection[]> {
		const updated = this._readJson<ApiCollection[]>(workspaceRoot, 'collections.json', []).filter(c => c.id !== collectionId);
		this._writeJson(workspaceRoot, 'collections.json', updated);
		return updated;
	}

	async saveEnvironment(workspaceRoot: string, env: ApiEnvironment, setActive = false): Promise<{ environments: ApiEnvironment[]; activeEnvironmentId: string | null }> {
		const state = this._readJson<{ environments: ApiEnvironment[]; activeEnvironmentId: string | null }>(
			workspaceRoot,
			'environments.json',
			{ environments: [], activeEnvironmentId: null },
		);
		const environments = [env, ...state.environments.filter(e => e.id !== env.id)];
		const activeEnvironmentId = setActive ? env.id : (state.activeEnvironmentId ?? env.id);
		const next = { environments, activeEnvironmentId };
		this._writeJson(workspaceRoot, 'environments.json', next);
		return next;
	}

	async setActiveEnvironment(workspaceRoot: string, environmentId: string | null): Promise<string | null> {
		const state = this._readJson<{ environments: ApiEnvironment[]; activeEnvironmentId: string | null }>(
			workspaceRoot,
			'environments.json',
			{ environments: [], activeEnvironmentId: null },
		);
		this._writeJson(workspaceRoot, 'environments.json', { ...state, activeEnvironmentId: environmentId });
		return environmentId;
	}

	async saveTestSuite(workspaceRoot: string, suite: ApiTestSuite): Promise<ApiTestSuite[]> {
		const existing = this._readJson<ApiTestSuite[]>(workspaceRoot, 'suites.json', []).filter(s => s.id !== suite.id);
		const updated = [suite, ...existing];
		this._writeJson(workspaceRoot, 'suites.json', updated);
		return updated;
	}

	// ========================================================================
	// 6. REAL AUTOMATED API TEST SUITE RUNNER (With Variable Chaining)
	// ========================================================================

	async runTestSuite(workspaceRoot: string, opts: {
		suiteId?: string;
		suite?: ApiTestSuite;
		environmentId?: string;
		baseUrlOverride?: string;
		allowProtectedEnvironment?: boolean;
	}): Promise<ApiTestRunResult> {
		const suites = this._readJson<ApiTestSuite[]>(workspaceRoot, 'suites.json', []);
		const suite = opts.suite ?? suites.find(s => s.id === opts.suiteId);
		const runId = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
		const startedAt = new Date().toISOString();
		const t0 = performance.now();

		if (!suite) {
			return {
				runId, suiteId: opts.suiteId ?? 'unknown', suiteName: 'Unknown Suite', startedAt,
				completedAt: new Date().toISOString(), durationMs: 0, total: 0, passed: 0, failed: 0,
				skipped: 0, blocked: 1, timedOut: 0, passRate: 0, cases: [],
				summary: `Test suite "${opts.suiteId}" not found.`,
			};
		}

		const ac = new AbortController();
		this._activeCancellations.set(runId, ac);
		this._emit('test_suite_started', runId, `Started API test suite "${suite.name}" (${suite.requests.length} test(s))`, { testRunId: runId });

		const chainedVars: Record<string, string> = {};
		if (opts.baseUrlOverride) { chainedVars['baseUrl'] = opts.baseUrlOverride; }
		else if (suite.baseUrl) { chainedVars['baseUrl'] = suite.baseUrl; }

		const cases: ApiTestCaseResult[] = [];
		let passed = 0, failed = 0, skipped = 0, blocked = 0, timedOut = 0;

		for (const reqSpec of suite.requests) {
			if (ac.signal.aborted) {
				skipped++;
				cases.push({
					requestId: reqSpec.id, name: reqSpec.name, method: reqSpec.method, url: reqSpec.url,
					status: 'skipped', durationMs: 0, assertions: [], failureReason: 'Cancelled by user',
				});
				continue;
			}

			const res = await this.executeRequest(workspaceRoot, {
				request: reqSpec,
				environmentId: opts.environmentId ?? suite.environmentId,
				extraVariables: chainedVars,
				allowProtectedEnvironment: opts.allowProtectedEnvironment,
				executionId: runId,
				suiteId: suite.id,
				persistHistory: true,
			});

			// Propagate extracted/script variables to subsequent requests in the workflow!
			Object.assign(chainedVars, res.variableUpdates);

			let status: ApiTestStatus;
			let failureReason: string | undefined;
			if (res.error) {
				if (/timed out/i.test(res.error)) { status = 'timed_out'; timedOut++; }
				else if (/Blocked by Production/i.test(res.error)) { status = 'blocked'; blocked++; }
				else { status = 'failed'; failed++; }
				failureReason = res.error;
			} else if (res.scriptErrors.length > 0) {
				status = 'failed';
				failed++;
				failureReason = `Script error: ${res.scriptErrors.join('; ')}`;
			} else if (res.assertionResults.length > 0) {
				const failedAsserts = res.assertionResults.filter(a => !a.passed);
				if (failedAsserts.length === 0) {
					status = 'passed';
					passed++;
				} else {
					status = 'failed';
					failed++;
					failureReason = failedAsserts.map(a => `${a.name}: ${a.message}`).join(' | ');
				}
			} else if (res.ok) {
				status = 'passed';
				passed++;
			} else {
				status = 'failed';
				failed++;
				failureReason = `HTTP ${res.status} ${res.statusText}`;
			}

			const caseRes: ApiTestCaseResult = {
				requestId: reqSpec.id,
				name: reqSpec.name,
				method: reqSpec.method,
				url: res.resolvedUrl,
				status,
				httpStatus: res.status || undefined,
				durationMs: res.timing.totalMs,
				assertions: res.assertionResults,
				response: res,
				failureReason,
			};
			cases.push(caseRes);

			this._emit('test_case_completed', runId, `[${status.toUpperCase()}] ${reqSpec.name} (${res.timing.totalMs}ms)`, {
				testRunId: runId,
				requestId: reqSpec.id,
				method: reqSpec.method,
				url: res.resolvedUrl,
				status: res.status,
				durationMs: res.timing.totalMs,
				passed: status === 'passed',
			});
		}

		this._activeCancellations.delete(runId);
		const durationMs = Math.round((performance.now() - t0) * 10) / 10;
		const total = suite.requests.length;
		const passRate = total > 0 ? Math.round((passed / total) * 1000) / 1000 : 0;

		const report: ApiTestRunResult = {
			runId,
			suiteId: suite.id,
			suiteName: suite.name,
			environmentId: opts.environmentId ?? suite.environmentId,
			startedAt,
			completedAt: new Date().toISOString(),
			durationMs,
			total,
			passed,
			failed,
			skipped,
			blocked,
			timedOut,
			passRate,
			cancelled: ac.signal.aborted || undefined,
			cases,
			summary: `Suite "${suite.name}": ${passed}/${total} passed (${failed} failed, ${skipped} skipped, ${blocked} blocked, ${timedOut} timed out) in ${durationMs}ms.`,
		};

		if (workspaceRoot) {
			const prev = this._readJson<ApiTestRunResult[]>(workspaceRoot, 'test-runs.json', []);
			this._writeJson(workspaceRoot, 'test-runs.json', [report, ...prev].slice(0, 50));
		}

		this._emit('test_suite_completed', runId, report.summary, { testRunId: runId, durationMs, passed: failed === 0 && blocked === 0 && timedOut === 0 });
		return report;
	}

	// ========================================================================
	// 7. REAL CONCURRENT PERFORMANCE / LOAD TESTING ENGINE
	// ========================================================================

	async runLoadTest(workspaceRoot: string, config: ApiLoadTestConfig): Promise<ApiLoadTestResult> {
		const runId = `load-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
		const startedAt = new Date().toISOString();
		const { vars } = this._collectEnvContext(workspaceRoot, config.environmentId);
		const targetUrl = resolveApiVariables(config.request.url, vars);

		// Safety guard: do not flood non-localhost targets without explicit authorization
		if (!isLocalHostname(targetUrl) && !config.allowNonLocalTarget) {
			return {
				runId, name: config.name, targetUrl, method: config.request.method, startedAt,
				completedAt: new Date().toISOString(), durationMs: 0, virtualUsers: config.virtualUsers,
				totalRequests: 0, successfulRequests: 0, failedRequests: 0, errorRate: 0, rps: 0,
				throughputBytesPerSec: 0, latencyMs: { min: 0, avg: 0, p50: 0, p90: 0, p95: 0, p99: 0, max: 0 },
				statusCodes: {}, timeline: [], generatorSaturated: false, engine: 'kodia-native-concurrent',
				passedThresholds: false, thresholdDetails: ['Blocked non-local load test target without allowNonLocalTarget=true authorization.'],
				summary: `Blocked load test against external host ${targetUrl} without explicit authorization.`,
				error: 'Non-local target requires allowNonLocalTarget=true.',
			};
		}

		const vus = Math.max(1, Math.min(200, config.virtualUsers));
		const durationSec = Math.max(1, Math.min(120, config.durationSeconds));
		const rampSec = Math.max(0, Math.min(durationSec - 1, config.rampUpSeconds ?? 0));
		const thinkMs = Math.max(0, config.thinkTimeMs ?? 0);

		const ac = new AbortController();
		this._activeCancellations.set(runId, ac);

		const latencies: number[] = [];
		const statusCodes: Record<string, number> = {};
		let totalBytes = 0;
		let successCount = 0;
		let failCount = 0;
		const timeline: ApiLoadTimelineBucket[] = [];

		// Per-second bucket counters
		const bucketLatencies = new Map<number, number[]>();
		const bucketErrors = new Map<number, number>();
		const tStart = performance.now();
		const endTime = tStart + durationSec * 1000;
		let activeVUs = 0;
		let eventLoopLagSpikes = 0;

		const tickTimer = setInterval(() => {
			const elapsedSec = Math.max(1, Math.floor((performance.now() - tStart) / 1000));
			const lats = (bucketLatencies.get(elapsedSec) ?? []).slice().sort((a, b) => a - b);
			const errs = bucketErrors.get(elapsedSec) ?? 0;
			const avg = lats.length ? Math.round((lats.reduce((a, b) => a + b, 0) / lats.length) * 10) / 10 : 0;
			const bucket: ApiLoadTimelineBucket = {
				second: elapsedSec,
				rps: lats.length,
				activeVUs,
				avgLatencyMs: avg,
				p95LatencyMs: percentile(lats, 95),
				errors: errs,
			};
			timeline.push(bucket);
			this._emit('load_metric_tick', runId, `Load t=${elapsedSec}s: ${bucket.rps} RPS, activeVUs=${activeVUs}, P95=${bucket.p95LatencyMs}ms, errors=${errs}`, {
				url: targetUrl,
				payload: bucket as unknown as Record<string, unknown>,
			});
		}, 1000);

		const parsedTarget = new URL(targetUrl);
		const transport = parsedTarget.protocol === 'https:' ? https : http;
		const reqHeaders: Record<string, string> = {};
		for (const h of config.request.headers ?? []) {
			if (h.enabled && h.key.trim()) { reqHeaders[h.key.trim()] = resolveApiVariables(h.value, vars); }
		}
		if (config.request.auth.type === 'bearer') {
			reqHeaders['Authorization'] = `Bearer ${resolveApiVariables(config.request.auth.token, vars)}`;
		}
		const payloadBuf = config.request.body.mode !== 'none' && config.request.body.raw
			? Buffer.from(resolveApiVariables(config.request.body.raw, vars), 'utf8')
			: undefined;
		if (payloadBuf) {
			reqHeaders['Content-Length'] = String(payloadBuf.byteLength);
			if (!reqHeaders['Content-Type']) { reqHeaders['Content-Type'] = 'application/json'; }
		}

		const sendOne = (): Promise<{ ok: boolean; status: number; ms: number; bytes: number }> => new Promise(resolve => {
			const s0 = performance.now();
			const req = transport.request(parsedTarget, { method: config.request.method, headers: reqHeaders, timeout: config.request.timeoutMs ?? 10_000 }, res => {
				let bytes = 0;
				res.on('data', (c: Buffer) => { bytes += c.byteLength; });
				res.on('end', () => {
					const status = res.statusCode ?? 0;
					resolve({ ok: status >= 200 && status < 400, status, ms: performance.now() - s0, bytes });
				});
			});
			req.on('timeout', () => { req.destroy(new Error('timeout')); });
			req.on('error', () => resolve({ ok: false, status: 0, ms: performance.now() - s0, bytes: 0 }));
			if (payloadBuf) { req.write(payloadBuf); }
			req.end();
		});

		const worker = async (idx: number) => {
			if (rampSec > 0) {
				const delay = Math.floor((idx / vus) * rampSec * 1000);
				if (delay > 0) { await new Promise(r => setTimeout(r, delay)); }
			}
			activeVUs++;
			try {
				while (performance.now() < endTime && !ac.signal.aborted) {
					const lagCheck = performance.now();
					const res = await sendOne();
					const sec = Math.max(1, Math.ceil((performance.now() - tStart) / 1000));
					latencies.push(res.ms);
					totalBytes += res.bytes;
					const codeKey = String(res.status);
					statusCodes[codeKey] = (statusCodes[codeKey] ?? 0) + 1;
					const bList = bucketLatencies.get(sec) ?? [];
					bList.push(res.ms);
					bucketLatencies.set(sec, bList);
					if (res.ok) { successCount++; }
					else {
						failCount++;
						bucketErrors.set(sec, (bucketErrors.get(sec) ?? 0) + 1);
					}
					if (thinkMs > 0) {
						await new Promise(r => setTimeout(r, thinkMs));
					} else if (performance.now() - lagCheck > 500 && res.ms < 50) {
						eventLoopLagSpikes++;
					}
				}
			} finally {
				activeVUs--;
			}
		};

		try {
			await Promise.all(Array.from({ length: vus }, (_, i) => worker(i)));
		} finally {
			clearInterval(tickTimer);
			this._activeCancellations.delete(runId);
		}

		const actualDurationMs = Math.max(1, Math.round((performance.now() - tStart) * 10) / 10);
		const totalRequests = successCount + failCount;
		const sorted = latencies.slice().sort((a, b) => a - b);
		const avgMs = sorted.length ? Math.round((sorted.reduce((a, b) => a + b, 0) / sorted.length) * 100) / 100 : 0;
		const errorRate = totalRequests > 0 ? Math.round((failCount / totalRequests) * 10000) / 10000 : 0;
		const rps = Math.round((totalRequests / (actualDurationMs / 1000)) * 100) / 100;
		const throughputBytesPerSec = Math.round(totalBytes / (actualDurationMs / 1000));
		const p95 = percentile(sorted, 95);

		const thresholdDetails: string[] = [];
		let passedThresholds = true;
		if (config.maxErrorRate !== undefined && errorRate > config.maxErrorRate) {
			passedThresholds = false;
			thresholdDetails.push(`Error rate ${(errorRate * 100).toFixed(2)}% exceeded max ${(config.maxErrorRate * 100).toFixed(2)}%.`);
		}
		if (config.p95ThresholdMs !== undefined && p95 > config.p95ThresholdMs) {
			passedThresholds = false;
			thresholdDetails.push(`P95 latency ${p95}ms exceeded threshold ${config.p95ThresholdMs}ms.`);
		}
		if (thresholdDetails.length === 0) {
			thresholdDetails.push('All configured performance thresholds passed.');
		}

		const result: ApiLoadTestResult = {
			runId,
			name: config.name,
			targetUrl,
			method: config.request.method,
			startedAt,
			completedAt: new Date().toISOString(),
			durationMs: actualDurationMs,
			virtualUsers: vus,
			totalRequests,
			successfulRequests: successCount,
			failedRequests: failCount,
			errorRate,
			rps,
			throughputBytesPerSec,
			latencyMs: {
				min: sorted.length ? Math.round(sorted[0] * 100) / 100 : 0,
				avg: avgMs,
				p50: percentile(sorted, 50),
				p90: percentile(sorted, 90),
				p95,
				p99: percentile(sorted, 99),
				max: sorted.length ? Math.round(sorted[sorted.length - 1] * 100) / 100 : 0,
			},
			statusCodes,
			timeline,
			generatorSaturated: eventLoopLagSpikes > 10,
			engine: 'kodia-native-concurrent',
			passedThresholds,
			thresholdDetails,
			summary: `Load test "${config.name}": ${totalRequests} reqs (${vus} VUs, ${(actualDurationMs / 1000).toFixed(1)}s) -> ${rps} RPS, P50=${percentile(sorted, 50)}ms, P95=${p95}ms, P99=${percentile(sorted, 99)}ms, errorRate=${(errorRate * 100).toFixed(2)}%.`,
		};

		if (workspaceRoot) {
			const prev = this._readJson<ApiLoadTestResult[]>(workspaceRoot, 'load-runs.json', []);
			this._writeJson(workspaceRoot, 'load-runs.json', [result, ...prev].slice(0, 30));
		}
		this._emit('load_completed', runId, result.summary, { url: targetUrl, durationMs: actualDurationMs, passed: passedThresholds });
		return result;
	}

	// ========================================================================
	// 8. LIVE + STATIC API SECURITY ASSESSMENT ENGINE
	// ========================================================================

	async runSecurityAudit(workspaceRoot: string, opts: {
		baseUrl?: string;
		routes?: readonly DiscoveredApiRoute[];
		staticFindings?: readonly ApiSecurityFinding[];
		filesScanned?: number;
		allowLiveProbes?: boolean;
	}): Promise<ApiSecurityReport> {
		const id = `SEC-${Date.now().toString(36)}`;
		const findings: ApiSecurityFinding[] = [...(opts.staticFindings ?? [])];
		const passedControls: string[] = [];
		let liveEndpointsProbed = 0;

		const add = (f: Omit<ApiSecurityFinding, 'id'>) => {
			const finding: ApiSecurityFinding = { id: `APISEC-${String(findings.length + 1).padStart(3, '0')}`, ...f };
			findings.push(finding);
			this._emit('security_finding', id, `[${f.severity.toUpperCase()}] ${f.title}`, { url: f.endpoint });
		};

		if (opts.baseUrl && (opts.allowLiveProbes !== false || isLocalHostname(opts.baseUrl))) {
			const base = opts.baseUrl.replace(/\/+$/, '');
			const probeTargets = (opts.routes ?? []).filter(r => r.protocol === 'http' && !r.path.includes(':') && !r.path.includes('{')).slice(0, 6);
			const urlsToProbe = probeTargets.length > 0
				? probeTargets.map(r => ({ url: `${base}${r.path}`, method: (r.method === 'ALL' ? 'GET' : r.method) as ApiHttpMethod, requiresAuth: Boolean(r.requiresAuth) }))
				: [{ url: base, method: 'GET' as ApiHttpMethod, requiresAuth: false }];

			for (const t of urlsToProbe) {
				const res = await this.executeRequest(workspaceRoot, {
					request: {
						id: `sec-probe-${liveEndpointsProbed + 1}`,
						name: `Security Probe ${t.method} ${t.url}`,
						protocol: 'http',
						method: t.method,
						url: t.url,
						params: [],
						headers: [{ id: 'origin', key: 'Origin', value: 'https://untrusted-audit-origin.example', enabled: true }],
						auth: { type: 'none' },
						body: { mode: 'none' },
						timeoutMs: 5000,
					},
					executionId: id,
					persistHistory: false,
				});
				liveEndpointsProbed++;

				if (res.status > 0) {
					if (t.requiresAuth && res.status >= 200 && res.status < 300) {
						add({
							severity: 'critical',
							confidence: 'confirmed',
							category: 'authentication',
							title: `Protected route ${t.method} ${t.url} accepted unauthenticated request (HTTP ${res.status})`,
							endpoint: t.url,
							evidence: `Unauthenticated request returned HTTP ${res.status}.`,
							remediation: 'Enforce authentication middleware before handler execution and return HTTP 401 when credentials are absent.',
						});
					} else if (t.requiresAuth && (res.status === 401 || res.status === 403)) {
						passedControls.push(`Verified ${t.url} rejects unauthenticated access (HTTP ${res.status})`);
					}

					const lowerH = Object.fromEntries(Object.entries(res.headers).map(([k, v]) => [k.toLowerCase(), v]));
					if (!lowerH['x-content-type-options']) {
						add({
							severity: 'low',
							confidence: 'confirmed',
							category: 'headers',
							title: 'Missing X-Content-Type-Options: nosniff header',
							endpoint: t.url,
							evidence: 'Response headers lacked x-content-type-options.',
							remediation: 'Add X-Content-Type-Options: nosniff (e.g., via Helmet or framework security headers middleware).',
						});
					} else {
						passedControls.push('X-Content-Type-Options header present');
					}
					if (lowerH['access-control-allow-origin'] === '*' && lowerH['access-control-allow-credentials'] === 'true') {
						add({
							severity: 'high',
							confidence: 'confirmed',
							category: 'cors',
							title: 'Wildcard CORS combined with Access-Control-Allow-Credentials: true',
							endpoint: t.url,
							evidence: `ACAO=${lowerH['access-control-allow-origin']}, ACAC=${lowerH['access-control-allow-credentials']}`,
							remediation: 'Never reflect arbitrary origins or wildcard CORS alongside credentials.',
						});
					}
					if (/at\s+[A-Za-z0-9_$.]+\s+\([^)]+:\d+:\d+\)|Traceback \(most recent call last\)/i.test(res.body)) {
						add({
							severity: 'medium',
							confidence: 'confirmed',
							category: 'error-leakage',
							title: 'Live response leaked stack trace / internal file paths',
							endpoint: t.url,
							evidence: res.body.slice(0, 140),
							remediation: 'Return generic client-safe error responses in production and keep stack traces in server logs only.',
						});
					}
				}
			}
		}

		const criticalCount = findings.filter(f => f.severity === 'critical').length;
		const highCount = findings.filter(f => f.severity === 'high').length;
		const medCount = findings.filter(f => f.severity === 'medium').length;
		const lowCount = findings.filter(f => f.severity === 'low').length;
		const score = Math.max(0, Math.min(100, 100 - criticalCount * 30 - highCount * 16 - medCount * 8 - lowCount * 3));

		const report: ApiSecurityReport = {
			id,
			scannedAt: new Date().toISOString(),
			score,
			targetBaseUrl: opts.baseUrl,
			filesScanned: opts.filesScanned ?? 0,
			liveEndpointsProbed,
			criticalCount,
			highCount,
			findings,
			passedControls: [...new Set(passedControls)],
			summary: `API Security Score: ${score}/100 (${criticalCount} critical, ${highCount} high, ${findings.length} total finding(s) across ${opts.filesScanned ?? 0} file(s) & ${liveEndpointsProbed} live probe(s)).`,
		};

		if (workspaceRoot) {
			const prev = this._readJson<ApiSecurityReport[]>(workspaceRoot, 'security-reports.json', []);
			this._writeJson(workspaceRoot, 'security-reports.json', [report, ...prev].slice(0, 30));
		}
		return report;
	}

	// ========================================================================
	// 9. REAL NATIVE LOCAL MOCK HTTP SERVER (Explicitly Flagged isMock: true)
	// ========================================================================

	async startMockServer(_workspaceRoot: string, opts: { name: string; port?: number; routes: readonly ApiMockRoute[] }): Promise<ApiMockServerStatus> {
		const mockId = `mock-${Date.now().toString(36)}`;
		const recentRequests: Array<{ method: string; path: string; status: number; timestamp: string }> = [];

		const server = http.createServer((req, res) => {
			const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
			const method = (req.method || 'GET').toUpperCase();
			const match = opts.routes.find(r => (r.method === 'ALL' || r.method === method) && r.path === reqUrl.pathname);

			const respond = () => {
				const status = match ? match.status : 404;
				const headers: Record<string, string> = {
					'Content-Type': 'application/json',
					'X-Kodia-Mock': 'true',
					...(match?.headers ?? {}),
				};
				res.writeHead(status, headers);
				res.end(match ? match.body : JSON.stringify({ error: 'Mock route not configured', isMock: true, path: reqUrl.pathname }));

				recentRequests.unshift({ method, path: reqUrl.pathname, status, timestamp: new Date().toISOString() });
				if (recentRequests.length > 50) { recentRequests.pop(); }
				const rec = this._mocks.get(mockId);
				if (rec) {
					rec.status = { ...rec.status, requestCount: rec.status.requestCount + 1, recentRequests: [...recentRequests] };
				}
				this._emit('mock_request_received', mockId, `[MOCK] ${method} ${reqUrl.pathname} -> ${status}`, { method, url: reqUrl.pathname, status });
			};

			if (match?.delayMs && match.delayMs > 0) {
				setTimeout(respond, match.delayMs);
			} else {
				respond();
			}
		});

		await new Promise<void>((resolve, reject) => {
			server.once('error', reject);
			server.listen(opts.port ?? 0, '127.0.0.1', () => resolve());
		});

		const addr = server.address();
		const port = typeof addr === 'object' && addr ? addr.port : (opts.port ?? 0);
		const status: ApiMockServerStatus = {
			mockId,
			name: opts.name,
			port,
			baseUrl: `http://127.0.0.1:${port}`,
			running: true,
			isMock: true,
			routes: [...opts.routes],
			requestCount: 0,
			recentRequests,
		};
		this._mocks.set(mockId, { status, server, recentRequests });
		return status;
	}

	async stopMockServer(mockId: string): Promise<boolean> {
		const rec = this._mocks.get(mockId);
		if (!rec) { return false; }
		await new Promise<void>(resolve => rec.server.close(() => resolve()));
		this._mocks.delete(mockId);
		return true;
	}

	async listMockServers(): Promise<ApiMockServerStatus[]> {
		return [...this._mocks.values()].map(m => ({ ...m.status, recentRequests: [...m.recentRequests] }));
	}

	// ========================================================================
	// 10. API MONITORS
	// ========================================================================

	async saveMonitor(workspaceRoot: string, monitor: ApiMonitorConfig): Promise<ApiMonitorConfig[]> {
		const existing = this._readJson<ApiMonitorConfig[]>(workspaceRoot, 'monitors.json', []).filter(m => m.id !== monitor.id);
		const updated = [monitor, ...existing];
		this._writeJson(workspaceRoot, 'monitors.json', updated);
		return updated;
	}

	async runMonitorNow(workspaceRoot: string, monitorId: string): Promise<ApiMonitorConfig | null> {
		const monitors = this._readJson<ApiMonitorConfig[]>(workspaceRoot, 'monitors.json', []);
		const target = monitors.find(m => m.id === monitorId);
		if (!target) { return null; }
		const res = await this.executeRequest(workspaceRoot, {
			request: target.request,
			executionId: `mon-${monitorId}-${Date.now().toString(36)}`,
			persistHistory: true,
		});
		const healthy = !res.error && res.status === target.expectedStatus && res.timing.totalMs <= target.maxLatencyMs;
		const degraded = !res.error && res.status === target.expectedStatus && res.timing.totalMs > target.maxLatencyMs;
		const updated: ApiMonitorConfig = {
			...target,
			lastRunAt: new Date().toISOString(),
			lastStatus: healthy ? 'healthy' : degraded ? 'degraded' : 'down',
			lastLatencyMs: res.timing.totalMs,
			uptimePercent: healthy ? 100 : degraded ? 95 : 0,
		};
		await this.saveMonitor(workspaceRoot, updated);
		return updated;
	}
}
