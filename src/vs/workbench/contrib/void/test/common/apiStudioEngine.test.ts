/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import {
	assessApiProductionReadiness,
	auditApiWorkspaceStaticSecurity,
	ClientCodeTarget,
	compareApiResponses,
	correlateApiFailure,
	diffOpenApiSpecs,
	discoverWorkspaceApis,
	evaluateApiAssertions,
	exportCollectionToPostman,
	exportTestRunToCsv,
	generateApiClientCode,
	generateApiTestSuiteFromDiscovery,
	generateOpenApiSpecFromDiscovery,
	importFromCurl,
	importFromPostmanCollection,
	queryJsonPath,
	redactApiSecrets,
	redactHeaders,
	resolveApiVariables,
} from '../../common/apiStudioIntelligence.js';
import { ApiResponseResult } from '../../common/apiStudioTypes.js';
import { assessRisk } from '../../common/autonomyPolicy.js';
import { routingRoleForContext } from '../../common/modelRouting.js';
import { builtinTools } from '../../common/prompt/prompts.js';
import { SUBAGENT_TYPES } from '../../common/subagents.js';
import { getToolCategory, getToolDisplayTitles } from '../../common/toolDisplayMeta.js';

const ALL_20_API_STUDIO_TOOLS = [
	'api_open_studio',
	'api_discover_project',
	'api_runtime_start',
	'api_runtime_status',
	'api_runtime_stop',
	'api_send_request',
	'api_websocket_session',
	'api_generate_test_suite',
	'api_run_test_suite',
	'api_run_load_test',
	'api_security_audit',
	'api_compare_responses',
	'api_generate_openapi',
	'api_diff_specs',
	'api_generate_client_sdk',
	'api_mock_server',
	'api_manage_collection',
	'api_manage_environment',
	'api_assess_production_readiness',
	'api_correlate_failure',
] as const;

const MEDIUM_RISK_API_TOOLS = new Set<string>([
	'api_runtime_start',
	'api_runtime_stop',
	'api_send_request',
	'api_websocket_session',
	'api_run_test_suite',
	'api_run_load_test',
	'api_security_audit',
	'api_mock_server',
	'api_manage_collection',
	'api_manage_environment',
]);

suite('Kodia - API Engineering Studio Intelligence & Contracts', () => {
	test('registers all 20 API Studio tools with schemas, display titles, api category, risk policy, and specialists', () => {
		for (const toolName of ALL_20_API_STUDIO_TOOLS) {
			assert.ok(toolName in builtinTools, `Missing schema in builtinTools: ${toolName}`);
			const titles = getToolDisplayTitles(toolName);
			assert.ok(titles.done && titles.proposed && titles.running, `Missing display titles for ${toolName}`);
			assert.strictEqual(getToolCategory(toolName), 'api', `Expected 'api' category for ${toolName}`);
			const expectedRisk = MEDIUM_RISK_API_TOOLS.has(toolName) ? 'medium' : 'low';
			assert.strictEqual(assessRisk(toolName, {}), expectedRisk, `Unexpected risk level for ${toolName}`);
		}
		assert.ok(SUBAGENT_TYPES.api_engineer.guidance.length > 30);
		assert.ok(SUBAGENT_TYPES.api_qa_perf.guidance.length > 30);
		assert.strictEqual(routingRoleForContext({ subagentRole: 'api_qa_perf' }), 'testing');
		assert.strictEqual(routingRoleForContext({ subagentRole: 'api_engineer' }), 'coding');
	});

	test('Demonstration H: discovers multi-language APIs across Express, NestJS, FastAPI, Go Gin, Rust Axum, Spring Boot, GraphQL, and gRPC Protobuf', () => {
		const report = discoverWorkspaceApis('/demo-monorepo', [
			{ path: 'services/gateway/package.json', content: '{"dependencies":{"express":"^4.19.0","pg":"^8.11.0","redis":"^4.6.0"}}' },
			{ path: 'services/gateway/src/server.ts', content: 'app.get("/health", ok);\napp.post("/api/orders", requireAuth, createOrder);\nconst wss = new WebSocketServer({ path: "/ws/orders" });\nconst key = process.env.JWT_SECRET;' },
			{ path: 'services/billing/main.py', content: '@app.get("/billing/invoices/{invoice_id}")\ndef get_invoice(invoice_id: str, user=Depends(get_current_user)):\n    pass\n@app.websocket("/ws/billing")\nasync def ws(): pass' },
			{ path: 'services/inventory/main.go', content: 'r.GET("/inventory/:sku", getSku)\nr.PUT("/inventory/:sku", updateSku)' },
			{ path: 'services/pricing/src/main.rs', content: 'let app = Router::new().route("/pricing/quote", post(quote_handler));' },
			{ path: 'services/ledger/LedgerController.java', content: '@GetMapping("/ledger/balance")\npublic Balance getBalance() { return null; }' },
			{ path: 'schemas/orders.proto', content: 'service OrderService { rpc GetOrder (OrderReq) returns (OrderRes); rpc StreamOrders (OrderReq) returns (stream OrderEvent); }' },
			{ path: 'schemas/api.graphql', content: 'type Query { order(id: ID!): Order }' },
		]);

		assert.ok(report.frameworks.includes('express'));
		assert.ok(report.frameworks.includes('fastapi'));
		assert.ok(report.frameworks.includes('axum'));
		assert.ok(report.frameworks.includes('spring-boot'));
		assert.ok(report.protocols.includes('http'));
		assert.ok(report.protocols.includes('websocket'));
		assert.ok(report.protocols.includes('grpc'));
		assert.ok(report.protocols.includes('graphql'));
		assert.ok(report.routes.length >= 8, `Expected >=8 routes, got ${report.routes.length}`);
		assert.strictEqual(report.grpcMethods.length, 2);
		assert.strictEqual(report.grpcMethods[1].streaming, 'server_streaming');
		assert.ok(report.services.length >= 4, 'Monorepo services must be separated into distinct services');
		assert.ok(report.envVariables.includes('JWT_SECRET'));
		assert.ok(report.mermaidTopology.includes('flowchart LR'));

		const suite = generateApiTestSuiteFromDiscovery({ baseUrl: 'http://127.0.0.1:3000', discovery: report });
		assert.ok(suite.requests.some(r => r.name.includes('[Auth Negative]')), 'Must auto-generate negative auth tests for protected routes');
	});

	test('interpolates variables & dynamic tokens while redacting secrets in headers and payloads', () => {
		const resolved = resolveApiVariables('{{baseUrl}}/users/{{userId}}?nonce={{$uuid}}&ts={{$timestamp}}', {
			baseUrl: 'http://127.0.0.1:4000',
			userId: 'u_42',
		});
		assert.ok(resolved.startsWith('http://127.0.0.1:4000/users/u_42?nonce='));
		assert.ok(!resolved.includes('{{$uuid}}') && !resolved.includes('{{$timestamp}}'));

		const secretTok = ['super_secret_', 'token_987654321'].join('');
		const redactedHdrs = redactHeaders({ Authorization: `Bearer ${secretTok}`, 'X-Trace-Id': 'trace-123' }, [secretTok]);
		assert.ok(!redactedHdrs.Authorization.includes(secretTok));
		assert.strictEqual(redactedHdrs['X-Trace-Id'], 'trace-123');
		assert.ok(!redactApiSecrets(`leaked ${secretTok}`, [secretTok]).includes(secretTok));
	});

	test('evaluates JSONPath queries, all assertion kinds, and structural response diffs', () => {
		const sampleRes: ApiResponseResult = {
			requestId: 'r1',
			executionId: 'e1',
			timestamp: new Date().toISOString(),
			protocol: 'http',
			method: 'GET',
			resolvedUrl: 'http://127.0.0.1:3000/orders/1',
			status: 200,
			statusText: 'OK',
			ok: true,
			headers: { 'content-type': 'application/json', 'x-correlation-id': 'corr-1' },
			transmittedHeaders: {},
			cookies: [{ name: 'sid', value: 'abc', httpOnly: true }],
			contentType: 'application/json',
			body: JSON.stringify({ id: 101, status: 'confirmed', items: [{ sku: 'A1' }, { sku: 'B2' }] }),
			sizeBytes: 64,
			timing: { dnsMs: 1, connectMs: 2, tlsMs: null, ttfbMs: 8, downloadMs: 2, totalMs: 12, measuredPhases: true },
			redirects: [],
			assertionResults: [],
			scriptLogs: [],
			scriptErrors: [],
			variableUpdates: {},
		};

		const jp = queryJsonPath(JSON.parse(sampleRes.body), '$.items[1].sku');
		assert.strictEqual(jp.found, true);
		assert.strictEqual(jp.value, 'B2');

		const results = evaluateApiAssertions([
			{ id: '1', kind: 'status_equals', expected: '200' },
			{ id: '2', kind: 'header_exists', target: 'x-correlation-id' },
			{ id: '3', kind: 'jsonpath_equals', target: '$.status', expected: 'confirmed' },
			{ id: '4', kind: 'jsonpath_length_gte', target: '$.items', expected: '2' },
			{ id: '5', kind: 'response_time_lt', expected: '100' },
			{ id: '6', kind: 'cookie_exists', target: 'sid' },
			{ id: '7', kind: 'json_schema_keys', expected: 'id,status,items' },
		], sampleRes);
		assert.strictEqual(results.length, 7);
		assert.ok(results.every(r => r.passed), `All assertions must pass: ${JSON.stringify(results)}`);

		const nextRes: ApiResponseResult = {
			...sampleRes,
			status: 201,
			body: JSON.stringify({ id: 101, status: 'shipped', items: [{ sku: 'A1' }], tracking: 'TRK-9' }),
		};
		const diff = compareApiResponses(sampleRes, nextRes);
		assert.strictEqual(diff.identical, false);
		assert.strictEqual(diff.statusChanged, true);
		assert.ok(diff.bodyDiffs.some(d => d.path === '$.status' && d.kind === 'changed'));
		assert.ok(diff.bodyDiffs.some(d => d.path === '$.tracking' && d.kind === 'added'));
	});

	test('generates OpenAPI 3.1 specs, detects breaking changes, generates 8-language SDK code, and converts cURL/Postman/CSV', () => {
		const disc = discoverWorkspaceApis('/app', [
			{ path: 'server.ts', content: 'app.get("/users/:id", authGuard, getUser);\napp.post("/users", createUser);' },
		]);
		const specV1 = generateOpenApiSpecFromDiscovery({ title: 'Users API', version: '1.0.0', discovery: disc });
		const specV2 = {
			openapi: '3.1.0',
			info: { title: 'Users API', version: '2.0.0' },
			paths: {
				'/users/{id}': {
					get: {
						parameters: [
							{ name: 'id', in: 'path', required: true },
							{ name: 'tenantId', in: 'header', required: true },
						],
					},
				},
				'/users/export': { get: {} },
			},
		};
		const specDiff = diffOpenApiSpecs(JSON.stringify(specV1), JSON.stringify(specV2));
		assert.ok(specDiff.breakingChanges.length >= 2, 'Must detect removed POST /users and new required tenantId param');
		assert.ok(specDiff.addedEndpoints.includes('GET /users/export'));

		const curlReq = importFromCurl(`curl -X POST 'http://127.0.0.1:3000/orders' -H 'Content-Type: application/json' -d '{"item":"book"}'`);
		assert.strictEqual(curlReq.method, 'POST');
		assert.strictEqual(curlReq.url, 'http://127.0.0.1:3000/orders');

		const targets: ClientCodeTarget[] = ['curl', 'fetch', 'typescript-sdk', 'python', 'go', 'rust', 'csharp', 'java'];
		for (const t of targets) {
			const code = generateApiClientCode(curlReq, t);
			assert.ok(code.includes('http://127.0.0.1:3000/orders'), `Generated ${t} code must target endpoint`);
		}

		const pmExport = exportCollectionToPostman({
			id: 'c1', name: 'Orders', variables: [], requests: [curlReq],
			createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
		});
		const pmReimported = importFromPostmanCollection(JSON.stringify(pmExport));
		assert.strictEqual(pmReimported.name, 'Orders');
		assert.strictEqual(pmReimported.requests.length, 1);

		const csv = exportTestRunToCsv({
			runId: 'r1', suiteId: 's1', suiteName: 'Smoke', startedAt: '', completedAt: '', durationMs: 25,
			total: 1, passed: 1, failed: 0, skipped: 0, blocked: 0, timedOut: 0, passRate: 1,
			cases: [{ requestId: '1', name: 'GET /health', method: 'GET', url: 'http://127.0.0.1:3000/health', status: 'passed', httpStatus: 200, durationMs: 10, assertions: [] }],
			summary: 'ok',
		});
		assert.ok(csv.includes('GET /health') && csv.includes('passed'));
	});

	test('audits static API security, correlates failures to source routes, and enforces honest production readiness gating', () => {
		const sec = auditApiWorkspaceStaticSecurity([
			{
				path: 'src/orders.ts',
				content: [
					'app.use(cors({ origin: "*" }));',
					'db.query(`SELECT * FROM orders WHERE id = ${req.params.id}`);',
					'const decoded = jwt.decode(token);',
					'res.status(500).json({ stack: err.stack });',
				].join('\n'),
			},
		]);
		assert.ok(sec.findings.some(f => f.category === 'injection' && f.severity === 'critical'));
		assert.ok(sec.findings.some(f => f.category === 'authentication' && f.severity === 'high'));
		assert.ok(sec.findings.some(f => f.category === 'cors'));
		assert.ok(sec.findings.some(f => f.category === 'error-leakage'));

		const disc = discoverWorkspaceApis('/app', [{ path: 'src/orders.ts', content: 'app.post("/orders", createOrder);' }]);
		const corr = correlateApiFailure({
			response: {
				requestId: 'req-9', executionId: 'ex-9', timestamp: new Date().toISOString(), protocol: 'http', method: 'POST',
				resolvedUrl: 'http://127.0.0.1:3000/orders', status: 500, statusText: 'Internal Server Error', ok: false,
				headers: {}, transmittedHeaders: {}, cookies: [], contentType: 'application/json', body: '{"error":"boom"}',
				sizeBytes: 16, timing: { dnsMs: null, connectMs: null, tlsMs: null, ttfbMs: 5, downloadMs: 1, totalMs: 6, measuredPhases: true },
				redirects: [], assertionResults: [], scriptLogs: [], scriptErrors: [], variableUpdates: {},
			},
			discovery: disc,
			runtimes: [{ runtimeId: 'rt1', name: 'orders', command: 'node server.js', cwd: '/app', status: 'ready', startedAt: '', recentLogs: ['[stderr] Error 500 on /orders: null reference'] }],
		});
		assert.strictEqual(corr.matchedRoute?.filePath, 'src/orders.ts');
		assert.ok(corr.matchedLogLines.length >= 1);

		// Untested API MUST NOT be marked passed!
		const untestedReadiness = assessApiProductionReadiness({ discovery: disc });
		assert.notStrictEqual(untestedReadiness.overallStatus, 'passed', 'Untested API must never be marked production-ready passed');
		assert.ok(untestedReadiness.blockers.length >= 2);
	});
});
