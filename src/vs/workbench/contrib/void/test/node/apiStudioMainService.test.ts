/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * Node-side REAL execution verification for KodiaApiStudioMainService covering:
 * - Demo A: Real REST API runtime startup, port detection, HTTP execution, measured timing, scripts, assertions & history
 * - Demo B: Real API CRUD persistence lifecycle (POST -> GET -> PUT -> DELETE -> 404 consistency)
 * - Demo C: Authentication & Authorization (valid, invalid, expired, missing token, 403 role restriction, admin 200)
 * - Demo D: Real ordered Live Execution Events via onDidEmitEvent
 * - Demo E: Real WebSocket bidirectional server + SSE streaming endpoint
 * - Demo F: Automated regression -> controlled failure -> detection -> repair -> retest pass
 * - Demo G: Real concurrent Load Test (RPS, P50/P95/P99, saturation reporting, external host safety block)
 * - Demo I: Multi-service orchestration (Gateway -> Downstream Orders service with correlation ID)
 * - Mock Server (explicitly flagged isMock: true), Live Security Audit & Protected Production Safeguard
 */

import assert from 'assert';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { WebSocketServer } from 'ws';
import { KodiaApiStudioMainService } from '../../electron-main/apiStudioMainService.js';
import { ApiLiveEvent, ApiTestSuite } from '../../common/apiStudioTypes.js';

suite('Kodia - API Engineering Studio Main Service (Live Demonstrations A-I)', function () {
	this.timeout(45_000);

	let dir: string;
	let service: KodiaApiStudioMainService;

	setup(() => {
		dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kodia-api-main-')));
		service = new KodiaApiStudioMainService();
	});

	teardown(async () => {
		await service.stopAllRuntimes();
		service.dispose();
		fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
	});

	test('Demonstrations A, B, C, D & F: real managed REST/CRUD/Auth API server, live events, scripts, regression failure -> repair -> retest', async () => {
		// Write a real disposable Node REST API with CRUD + Auth/RBAC + controllable bug toggle
		const serverScript = `
const http = require('http');
const items = new Map();
let nextId = 1;
let bugMode = false;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const send = (status, data, extraHeaders = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff', ...extraHeaders });
    res.end(JSON.stringify(data));
  };
  let raw = '';
  req.on('data', c => raw += c);
  req.on('end', () => {
    let body = {};
    try { if (raw) body = JSON.parse(raw); } catch { return send(400, { error: 'Invalid JSON' }); }

    if (req.method === 'GET' && url.pathname === '/health') {
      return send(200, { status: 'ok', service: 'orders-api' }, { 'Set-Cookie': 'kodia_sid=test123; HttpOnly; SameSite=Lax' });
    }
    if (req.method === 'POST' && url.pathname === '/_toggle-bug') {
      bugMode = Boolean(body.bug);
      return send(200, { bugMode });
    }
    if (url.pathname === '/admin/stats') {
      const auth = req.headers['authorization'] || '';
      if (!auth) return send(401, { error: 'Missing token' });
      if (auth === 'Bearer expired-token') return send(401, { error: 'Token expired' });
      if (auth === 'Bearer user-token') return send(403, { error: 'Insufficient role' });
      if (auth !== 'Bearer admin-token') return send(401, { error: 'Invalid token' });
      return send(200, { role: 'admin', totalOrders: items.size });
    }
    if (req.method === 'POST' && url.pathname === '/orders') {
      if (bugMode) return send(500, { error: 'Simulated regression bug' });
      if (!body.item) return send(400, { error: 'item required' });
      const id = String(nextId++);
      const rec = { id, item: body.item, qty: body.qty || 1 };
      items.set(id, rec);
      return send(201, rec);
    }
    const m = /^\\/orders\\/(\\d+)$/.exec(url.pathname);
    if (m) {
      const id = m[1];
      if (req.method === 'GET') {
        if (!items.has(id)) return send(404, { error: 'Not found' });
        return send(200, items.get(id));
      }
      if (req.method === 'PUT') {
        if (!items.has(id)) return send(404, { error: 'Not found' });
        const updated = { ...items.get(id), ...body, id };
        items.set(id, updated);
        return send(200, updated);
      }
      if (req.method === 'DELETE') {
        if (!items.has(id)) return send(404, { error: 'Not found' });
        items.delete(id);
        return send(200, { deleted: id });
      }
    }
    return send(404, { error: 'Route not found' });
  });
});
server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  console.log('READY listening on http://127.0.0.1:' + port);
});
`;
		fs.writeFileSync(path.join(dir, 'server.cjs'), serverScript, 'utf8');

		const liveEvents: ApiLiveEvent[] = [];
		const sub = service.onDidEmitEvent(ev => liveEvents.push(ev));

		try {
			// Demo A: Start real runtime, detect port & health
			const rt = await service.startRuntime(dir, {
				name: 'orders-api',
				command: 'node server.cjs',
				readyTimeoutMs: 8000,
			});
			assert.strictEqual(rt.status, 'ready', `Runtime must become ready, logs: ${rt.recentLogs.join('\n')}`);
			assert.ok(rt.port && rt.baseUrl, 'Must auto-detect listening port from stdout');

			// Single request with timing breakdown, cookies & sandboxed scripts
			const healthRes = await service.executeRequest(dir, {
				request: {
					id: 'req-health',
					name: 'GET /health',
					protocol: 'http',
					method: 'GET',
					url: `${rt.baseUrl}/health`,
					params: [],
					headers: [],
					auth: { type: 'none' },
					body: { mode: 'none' },
					preRequestScript: 'kodia.env.set("ranPre", "yes"); console.log("pre ran");',
					testScript: 'kodia.test("status is 200", () => { kodia.expect(kodia.response.status).toBe(200); kodia.expect(kodia.response.json().service).toBe("orders-api"); });',
					assertions: [
						{ id: 'a1', kind: 'status_equals', expected: '200' },
						{ id: 'a2', kind: 'cookie_exists', target: 'kodia_sid' },
					],
				},
			});
			assert.strictEqual(healthRes.status, 200);
			assert.strictEqual(healthRes.timing.measuredPhases, true);
			assert.ok(healthRes.timing.totalMs >= 0);
			assert.strictEqual(healthRes.cookies[0]?.name, 'kodia_sid');
			assert.strictEqual(healthRes.variableUpdates.ranPre, 'yes');
			assert.ok(healthRes.assertionResults.length === 3 && healthRes.assertionResults.every(a => a.passed));

			// Demo B & C: Chained CRUD + Auth/RBAC Test Suite
			const suite: ApiTestSuite = {
				id: 'suite-crud-auth',
				name: 'CRUD & Auth/RBAC Suite',
				baseUrl: rt.baseUrl,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				requests: [
					{
						id: 'c1', name: 'Create order', protocol: 'http', method: 'POST', url: '{{baseUrl}}/orders',
						params: [], headers: [], auth: { type: 'none' }, body: { mode: 'json', raw: '{"item":"keyboard","qty":2}' },
						extractVariables: [{ variableName: 'orderId', jsonPath: '$.id' }],
						assertions: [{ id: 'a1', kind: 'status_equals', expected: '201' }],
					},
					{
						id: 'c2', name: 'Get created order', protocol: 'http', method: 'GET', url: '{{baseUrl}}/orders/{{orderId}}',
						params: [], headers: [], auth: { type: 'none' }, body: { mode: 'none' },
						assertions: [
							{ id: 'a1', kind: 'status_equals', expected: '200' },
							{ id: 'a2', kind: 'jsonpath_equals', target: '$.item', expected: 'keyboard' },
						],
					},
					{
						id: 'c3', name: 'Update order', protocol: 'http', method: 'PUT', url: '{{baseUrl}}/orders/{{orderId}}',
						params: [], headers: [], auth: { type: 'none' }, body: { mode: 'json', raw: '{"qty":5}' },
						assertions: [{ id: 'a1', kind: 'jsonpath_equals', target: '$.qty', expected: '5' }],
					},
					{
						id: 'c4', name: 'Delete order', protocol: 'http', method: 'DELETE', url: '{{baseUrl}}/orders/{{orderId}}',
						params: [], headers: [], auth: { type: 'none' }, body: { mode: 'none' },
						assertions: [{ id: 'a1', kind: 'status_equals', expected: '200' }],
					},
					{
						id: 'c5', name: 'Verify deleted returns 404', protocol: 'http', method: 'GET', url: '{{baseUrl}}/orders/{{orderId}}',
						params: [], headers: [], auth: { type: 'none' }, body: { mode: 'none' },
						assertions: [{ id: 'a1', kind: 'status_equals', expected: '404' }],
					},
					// Demo C: Auth & RBAC matrix
					{
						id: 'auth-missing', name: 'Missing token -> 401', protocol: 'http', method: 'GET', url: '{{baseUrl}}/admin/stats',
						params: [], headers: [], auth: { type: 'none' }, body: { mode: 'none' },
						assertions: [{ id: 'a1', kind: 'status_equals', expected: '401' }],
					},
					{
						id: 'auth-invalid', name: 'Invalid token -> 401', protocol: 'http', method: 'GET', url: '{{baseUrl}}/admin/stats',
						params: [], headers: [], auth: { type: 'bearer', token: 'wrong-token' }, body: { mode: 'none' },
						assertions: [{ id: 'a1', kind: 'status_equals', expected: '401' }],
					},
					{
						id: 'auth-expired', name: 'Expired token -> 401', protocol: 'http', method: 'GET', url: '{{baseUrl}}/admin/stats',
						params: [], headers: [], auth: { type: 'bearer', token: 'expired-token' }, body: { mode: 'none' },
						assertions: [{ id: 'a1', kind: 'status_equals', expected: '401' }],
					},
					{
						id: 'auth-role', name: 'Insufficient role -> 403', protocol: 'http', method: 'GET', url: '{{baseUrl}}/admin/stats',
						params: [], headers: [], auth: { type: 'bearer', token: 'user-token' }, body: { mode: 'none' },
						assertions: [{ id: 'a1', kind: 'status_equals', expected: '403' }],
					},
					{
						id: 'auth-admin', name: 'Valid admin token -> 200', protocol: 'http', method: 'GET', url: '{{baseUrl}}/admin/stats',
						params: [], headers: [], auth: { type: 'bearer', token: 'admin-token' }, body: { mode: 'none' },
						assertions: [
							{ id: 'a1', kind: 'status_equals', expected: '200' },
							{ id: 'a2', kind: 'jsonpath_equals', target: '$.role', expected: 'admin' },
						],
					},
				],
			};

			await service.saveTestSuite(dir, suite);
			const runPass = await service.runTestSuite(dir, { suiteId: suite.id });
			assert.strictEqual(runPass.passed, 10, `Expected 10/10 pass, got ${runPass.summary}`);
			assert.strictEqual(runPass.failed, 0);

			// Demo F: Controlled failure -> detection -> repair -> retest
			await service.executeRequest(dir, {
				request: { id: 'bug-on', name: 'bug on', protocol: 'http', method: 'POST', url: `${rt.baseUrl}/_toggle-bug`, params: [], headers: [], auth: { type: 'none' }, body: { mode: 'json', raw: '{"bug":true}' } },
				persistHistory: false,
			});
			const runFail = await service.runTestSuite(dir, { suiteId: suite.id });
			assert.ok(runFail.failed >= 1, 'Regression suite MUST detect injected 500 failure');
			assert.strictEqual(runFail.cases[0].status, 'failed');

			await service.executeRequest(dir, {
				request: { id: 'bug-off', name: 'bug off', protocol: 'http', method: 'POST', url: `${rt.baseUrl}/_toggle-bug`, params: [], headers: [], auth: { type: 'none' }, body: { mode: 'json', raw: '{"bug":false}' } },
				persistHistory: false,
			});
			const runRecovered = await service.runTestSuite(dir, { suiteId: suite.id });
			assert.strictEqual(runRecovered.passed, 10, 'Retest after repair must pass 10/10');

			// Demo D: Verify ordered live events & redacted persisted history
			assert.ok(liveEvents.length > 20, 'Must emit real live execution events');
			assert.ok(liveEvents.some(e => e.type === 'runtime_ready'));
			assert.ok(liveEvents.some(e => e.type === 'test_suite_started'));
			assert.ok(liveEvents.some(e => e.type === 'test_suite_completed'));
			for (let i = 1; i < liveEvents.length; i++) {
				assert.ok(liveEvents[i].seq > liveEvents[i - 1].seq, 'Event sequence numbers must be strictly increasing');
			}
			const snap = await service.loadWorkspaceSnapshot(dir);
			assert.ok(snap.history.length >= 10, 'History must persist on disk');
			const authHistory = snap.history.find(h => h.request.id === 'auth-admin');
			assert.strictEqual(authHistory?.request.auth.type === 'bearer' ? authHistory.request.auth.token : '', '[REDACTED]', 'Bearer token must be redacted in persisted history');
		} finally {
			sub.dispose();
		}
	});

	test('Demonstration E: real WebSocket bidirectional session and real Server-Sent Events (SSE) streaming', async () => {
		const srv = http.createServer((req, res) => {
			if (req.url === '/events') {
				res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
				res.write('id: 1\nevent: status\ndata: {"step":"started"}\n\n');
				res.write('id: 2\nevent: status\ndata: {"step":"done"}\n\n');
				res.end();
				return;
			}
			res.writeHead(200);
			res.end('ok');
		});
		const wss = new WebSocketServer({ server: srv, path: '/ws' });
		wss.on('connection', socket => {
			socket.on('message', data => {
				socket.send(JSON.stringify({ echo: data.toString() }));
			});
		});

		await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r()));
		const port = (srv.address() as { port: number }).port;

		try {
			const wsSess = await service.connectWebSocket(dir, { url: `ws://127.0.0.1:${port}/ws` });
			assert.strictEqual(wsSess.status, 'open');
			assert.strictEqual(wsSess.handshakeStatus, 101);

			const afterSend = await service.sendWebSocketMessage(wsSess.sessionId, '{"hello":"kodia"}', 'json');
			assert.ok(afterSend.messages.some(m => m.direction === 'received' && m.data.includes('echo')), 'Must receive real WebSocket echo frame');
			await service.closeWebSocket(wsSess.sessionId);

			const sseRes = await service.executeRequest(dir, {
				request: {
					id: 'sse-1', name: 'SSE Stream', protocol: 'sse', method: 'GET', url: `http://127.0.0.1:${port}/events`,
					params: [], headers: [], auth: { type: 'none' }, body: { mode: 'none' },
				},
			});
			assert.strictEqual(sseRes.protocol, 'sse');
			assert.strictEqual(sseRes.sseEvents?.length, 2);
			assert.strictEqual(sseRes.sseEvents?.[1].id, '2');
		} finally {
			wss.close();
			await new Promise<void>(r => srv.close(() => r()));
		}
	});

	test('Demonstrations G & I: real concurrent load test, multi-service orchestration, mock server, live security audit & production guard', async () => {
		// Downstream service (Orders DB)
		const ordersSrv = http.createServer((req, res) => {
			res.writeHead(200, { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' });
			res.end(JSON.stringify({ service: 'orders-downstream', correlationId: req.headers['x-correlation-id'] ?? null }));
		});
		await new Promise<void>(r => ordersSrv.listen(0, '127.0.0.1', () => r()));
		const ordersPort = (ordersSrv.address() as { port: number }).port;

		// Gateway service calling downstream with correlation ID
		const gatewaySrv = http.createServer((req, res) => {
			const corr = String(req.headers['x-correlation-id'] || 'corr-auto');
			http.get(`http://127.0.0.1:${ordersPort}/`, { headers: { 'x-correlation-id': corr } }, downRes => {
				let body = '';
				downRes.on('data', c => body += c);
				downRes.on('end', () => {
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ gateway: true, correlationId: corr, downstream: JSON.parse(body) }));
				});
			});
		});
		await new Promise<void>(r => gatewaySrv.listen(0, '127.0.0.1', () => r()));
		const gwPort = (gatewaySrv.address() as { port: number }).port;

		try {
			// Demo I: Multi-service cross-service correlated call
			const gwRes = await service.executeRequest(dir, {
				request: {
					id: 'gw-1', name: 'Gateway -> Orders', protocol: 'http', method: 'GET', url: `http://127.0.0.1:${gwPort}/orders`,
					params: [], headers: [{ id: 'c', key: 'x-correlation-id', value: 'trace-999', enabled: true }],
					auth: { type: 'none' }, body: { mode: 'none' },
					assertions: [
						{ id: 'a1', kind: 'jsonpath_equals', target: '$.downstream.correlationId', expected: 'trace-999' },
					],
				},
			});
			assert.strictEqual(gwRes.status, 200);
			assert.ok(gwRes.assertionResults[0]?.passed, 'Correlation ID must propagate across services');

			// Demo G: Real concurrent load test
			const load = await service.runLoadTest(dir, {
				name: 'Gateway Concurrency Test',
				request: {
					id: 'ld-1', name: 'GET /orders', protocol: 'http', method: 'GET', url: `http://127.0.0.1:${gwPort}/orders`,
					params: [], headers: [], auth: { type: 'none' }, body: { mode: 'none' },
				},
				virtualUsers: 4,
				durationSeconds: 1,
				maxErrorRate: 0.05,
				p95ThresholdMs: 2000,
			});
			assert.ok(load.totalRequests >= 4, `Expected >=4 real concurrent requests, got ${load.totalRequests}`);
			assert.strictEqual(load.errorRate, 0);
			assert.ok(load.rps > 0);
			assert.strictEqual(load.passedThresholds, true);

			// Unauthorized external host load test MUST be blocked
			const blockedLoad = await service.runLoadTest(dir, {
				name: 'Unauthorized External',
				request: { id: 'ext', name: 'ext', protocol: 'http', method: 'GET', url: 'https://example.com', params: [], headers: [], auth: { type: 'none' }, body: { mode: 'none' } },
				virtualUsers: 5,
				durationSeconds: 1,
			});
			assert.strictEqual(blockedLoad.passedThresholds, false);
			assert.ok(blockedLoad.error);

			// Mock Server explicitly flagged isMock: true
			const mock = await service.startMockServer(dir, {
				name: 'Payments Mock',
				routes: [{ id: 'm1', method: 'GET', path: '/pay/status', status: 200, body: '{"status":"simulated"}' }],
			});
			const mockRes = await service.executeRequest(dir, {
				request: { id: 'mk', name: 'Call Mock', protocol: 'http', method: 'GET', url: `${mock.baseUrl}/pay/status`, params: [], headers: [], auth: { type: 'none' }, body: { mode: 'none' } },
			});
			assert.strictEqual(mockRes.isMock, true, 'Mock server response MUST be explicitly distinguished with isMock=true');
			await service.stopMockServer(mock.mockId);

			// Live Security Audit detects missing X-Content-Type-Options on gateway
			const sec = await service.runSecurityAudit(dir, {
				baseUrl: `http://127.0.0.1:${gwPort}`,
				allowLiveProbes: true,
			});
			assert.ok(sec.liveEndpointsProbed >= 1);
			assert.ok(sec.findings.some(f => f.category === 'headers' && f.confidence === 'confirmed'));

			// Production environment safeguard blocks unconfirmed DELETE
			await service.saveEnvironment(dir, {
				id: 'env-prod', name: 'Production', kind: 'production', baseUrl: `http://127.0.0.1:${gwPort}`,
				isProtected: true, variables: [], updatedAt: new Date().toISOString(),
			}, true);
			const prodBlocked = await service.executeRequest(dir, {
				request: { id: 'del-prod', name: 'DELETE prod', protocol: 'http', method: 'DELETE', url: '{{baseUrl}}/orders/1', params: [], headers: [], auth: { type: 'none' }, body: { mode: 'none' } },
				environmentId: 'env-prod',
			});
			assert.ok(prodBlocked.error?.includes('Blocked DELETE against protected production environment'));
		} finally {
			await new Promise<void>(r => gatewaySrv.close(() => r()));
			await new Promise<void>(r => ordersSrv.close(() => r()));
		}
	});
});
