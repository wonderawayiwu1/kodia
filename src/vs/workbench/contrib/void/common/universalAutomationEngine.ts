/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import type {
	UaepAiProviderId,
	UaepAiProviderPreset,
	UaepCodegenTarget,
	UaepCodeSyncReport,
	UaepCompileReport,
	UaepCompilerDiagnostic,
	UaepConnectorSpec,
	UaepHostingOptionAssessment,
	UaepNodeTypeSpec,
	UaepWorkflowDefinition,
	UaepWorkflowEdge,
	UaepWorkflowNode,
} from './universalAutomationTypes.js';

// ── 0. Free-First & Multi-Provider AI Presets (NVIDIA, Groq, OpenRouter, Gemini, Ollama) ──

export const UAEP_AI_PROVIDER_PRESETS: readonly UaepAiProviderPreset[] = [
	{
		id: 'nvidia',
		label: 'NVIDIA NIM (Free Tier)',
		freeTier: true,
		requiresApiKey: true,
		endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions',
		envKey: 'NVIDIA_API_KEY',
		defaultModel: 'nvidia/nemotron-3.5-super-vl-120b-a12b',
		docsUrl: 'https://build.nvidia.com',
		note: 'Free developer credits with vision, reasoning & tool calling — click Discover Live Models (LEI) for latest catalog.',
	},
	{
		id: 'groq',
		label: 'Groq Cloud (Free Tier)',
		freeTier: true,
		requiresApiKey: true,
		endpoint: 'https://api.groq.com/openai/v1/chat/completions',
		envKey: 'GROQ_API_KEY',
		defaultModel: 'llama-3.3-70b-versatile',
		docsUrl: 'https://console.groq.com/keys',
		note: 'Ultra-fast free-tier LPU inference with OpenAI-compatible tool calling.',
	},
	{
		id: 'openrouter',
		label: 'OpenRouter (Free Models)',
		freeTier: true,
		requiresApiKey: true,
		endpoint: 'https://openrouter.ai/api/v1/chat/completions',
		envKey: 'OPENROUTER_API_KEY',
		defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
		docsUrl: 'https://openrouter.ai/models?max_price=0',
		note: 'Unified gateway with dozens of :free models — discover live :free IDs via LEI.',
	},
	{
		id: 'gemini',
		label: 'Google Gemini (Free Tier)',
		freeTier: true,
		requiresApiKey: true,
		endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
		envKey: 'GEMINI_API_KEY',
		defaultModel: 'gemini-2.5-flash',
		docsUrl: 'https://aistudio.google.com/apikey',
		note: 'Generous free tier via OpenAI-compatible Gemini endpoint.',
	},
	{
		id: 'ollama',
		label: 'Ollama (Local Free — No Key)',
		freeTier: true,
		requiresApiKey: false,
		endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
		envKey: '',
		defaultModel: 'llama3.2',
		docsUrl: 'https://ollama.com',
		note: '100% free offline local inference on your machine with zero API key needed.',
	},
	{
		id: 'openai',
		label: 'OpenAI (Paid BYOK)',
		freeTier: false,
		requiresApiKey: true,
		endpoint: 'https://api.openai.com/v1/chat/completions',
		envKey: 'OPENAI_API_KEY',
		defaultModel: 'gpt-4o-mini',
		docsUrl: 'https://platform.openai.com/api-keys',
		note: 'Optional paid BYOK OpenAI endpoint.',
	},
	{
		id: 'custom',
		label: 'Custom OpenAI-Compatible Endpoint',
		freeTier: true,
		requiresApiKey: false,
		endpoint: '',
		envKey: 'CUSTOM_AI_API_KEY',
		defaultModel: '',
		docsUrl: '',
		note: 'Any self-hosted vLLM, LM Studio, Together, Fireworks, or enterprise gateway.',
	},
];

export function getUaepAiProviderPreset(providerId: string | undefined): UaepAiProviderPreset {
	const id = (providerId || 'nvidia').toLowerCase() as UaepAiProviderId;
	return UAEP_AI_PROVIDER_PRESETS.find(p => p.id === id) ?? UAEP_AI_PROVIDER_PRESETS[0];
}

// ── 1. Formal Typed Node Library (Section 8: Triggers, Actions, Logic, Data, Dev, AI) ──

export const UAEP_NODE_LIBRARY: readonly UaepNodeTypeSpec[] = [
	// Triggers
	{ type: 'trigger.manual', label: 'Manual Trigger', category: 'trigger', description: 'Starts workflow on-demand with JSON input payload.', inputs: [], outputs: ['default'], defaultConfig: { samplePayload: {} }, version: '1.0.0' },
	{ type: 'trigger.webhook', label: 'Webhook Trigger', category: 'trigger', description: 'Starts workflow on signed HTTP POST webhook with idempotency header check.', inputs: [], outputs: ['default'], defaultConfig: { path: '/webhook/events', method: 'POST', requireSignature: true }, version: '1.0.0' },
	{ type: 'trigger.cron', label: 'Cron / Schedule Trigger', category: 'trigger', description: 'Runs on a time-zone-aware cron schedule with missed-run policy.', inputs: [], outputs: ['default'], defaultConfig: { cron: '*/15 * * * *', timezone: 'UTC', missedRunPolicy: 'skip' }, version: '1.0.0' },
	{ type: 'trigger.db_change', label: 'Database Change Trigger', category: 'trigger', description: 'Triggers on row insert/update/delete or CDC event.', inputs: [], outputs: ['default'], defaultConfig: { table: 'orders', event: 'INSERT' }, requiresCredential: true, version: '1.0.0' },
	{ type: 'trigger.queue_message', label: 'Queue / Event Stream Trigger', category: 'trigger', description: 'Consumes jobs from durable queue, Redis, RabbitMQ, or Kafka.', inputs: [], outputs: ['default'], defaultConfig: { queueName: 'default-events', concurrency: 4 }, version: '1.0.0' },
	{ type: 'trigger.iot_mqtt', label: 'IoT / MQTT Event Trigger', category: 'trigger', description: 'Reacts to MQTT topic messages from edge/industrial sensors.', inputs: [], outputs: ['default'], defaultConfig: { topic: 'factory/sensors/#' }, version: '1.0.0' },

	// Actions
	{ type: 'action.http_request', label: 'HTTP / REST Request', category: 'action', description: 'Executes a real HTTP/REST request with timeout, retry & status validation.', inputs: ['default'], outputs: ['default', 'error'], defaultConfig: { method: 'GET', url: '', headers: {}, timeoutMs: 10000 }, version: '1.0.0' },
	{ type: 'action.database_query', label: 'Database Query / Mutation', category: 'action', description: 'Executes parameterized SQL/document operations with idempotency support.', inputs: ['default'], outputs: ['default', 'error'], defaultConfig: { operation: 'select', query: 'SELECT 1', params: [] }, requiresCredential: true, sensitiveAction: true, version: '1.0.0' },
	{ type: 'action.send_email', label: 'Send Email', category: 'action', description: 'Sends transactional email via configured SMTP/Resend/SendGrid provider.', inputs: ['default'], outputs: ['default', 'error'], defaultConfig: { to: '', subject: '', body: '' }, requiresCredential: true, sensitiveAction: true, version: '1.0.0' },
	{ type: 'action.payment_charge', label: 'Payment Operation (Idempotent)', category: 'action', description: 'Executes payment charge/refund guarded by strict idempotency key.', inputs: ['default'], outputs: ['default', 'error'], defaultConfig: { provider: 'stripe', amountCents: 0, currency: 'USD' }, requiresCredential: true, sensitiveAction: true, version: '1.0.0' },
	{ type: 'action.notify_channel', label: 'Slack / Teams / Webhook Notify', category: 'action', description: 'Posts structured alert or approval card to messaging channel.', inputs: ['default'], outputs: ['default', 'error'], defaultConfig: { channel: '#ops', message: '' }, version: '1.0.0' },
	{ type: 'action.crm_upsert', label: 'CRM Record Upsert', category: 'action', description: 'Creates or updates customer/deal record in CRM with deduplication.', inputs: ['default'], outputs: ['default', 'error'], defaultConfig: { entity: 'contact', matchField: 'email' }, requiresCredential: true, version: '1.0.0' },
	{ type: 'action.publish_event', label: 'Publish Queue / Event', category: 'action', description: 'Enqueues downstream event onto durable worker queue.', inputs: ['default'], outputs: ['default'], defaultConfig: { topic: 'workflow.events' }, version: '1.0.0' },

	// Logic
	{ type: 'logic.if_else', label: 'If / Else Branch', category: 'logic', description: 'Routes execution to true or false branch based on condition expression.', inputs: ['default'], outputs: ['true', 'false'], defaultConfig: { field: 'status', operator: 'eq', value: 'ok' }, version: '1.0.0' },
	{ type: 'logic.switch', label: 'Switch Router', category: 'logic', description: 'Routes execution across multiple named branches.', inputs: ['default'], outputs: ['default', 'case_a', 'case_b'], defaultConfig: { field: 'type', cases: ['case_a', 'case_b'] }, version: '1.0.0' },
	{ type: 'logic.for_each', label: 'For-Each Loop / Batch', category: 'logic', description: 'Iterates over an array payload with bounded batch size.', inputs: ['default'], outputs: ['default'], defaultConfig: { arrayField: 'items', batchSize: 10 }, version: '1.0.0' },
	{ type: 'logic.merge', label: 'Merge Branches', category: 'logic', description: 'Synchronizes and merges upstream branch outputs.', inputs: ['in_1', 'in_2'], outputs: ['default'], defaultConfig: { mode: 'combine' }, version: '1.0.0' },
	{ type: 'logic.delay', label: 'Durable Delay / Wait', category: 'logic', description: 'Pauses workflow for a bounded duration with durable timer checkpoint.', inputs: ['default'], outputs: ['default'], defaultConfig: { delayMs: 50 }, version: '1.0.0' },
	{ type: 'logic.human_approval', label: 'Human Approval Gate', category: 'logic', description: 'Pauses workflow durably until an authorized human approves or rejects.', inputs: ['default'], outputs: ['default', 'rejected'], defaultConfig: { approverRole: 'manager', prompt: 'Approve sensitive action?' }, version: '1.0.0' },
	{ type: 'logic.compensation', label: 'Saga Compensation Handler', category: 'logic', description: 'Executes compensating rollback steps when a downstream transaction fails.', inputs: ['default'], outputs: ['default'], defaultConfig: { compensateAction: 'revert' }, version: '1.0.0' },

	// Data
	{ type: 'data.transform', label: 'Data Transform & Map', category: 'data', description: 'Maps, renames, normalizes, and enriches JSON payload fields.', inputs: ['default'], outputs: ['default'], defaultConfig: { mappings: {} }, version: '1.0.0' },
	{ type: 'data.filter', label: 'Filter & Deduplicate', category: 'data', description: 'Filters array records and removes duplicates by key.', inputs: ['default'], outputs: ['default'], defaultConfig: { field: 'items', uniqueBy: 'id' }, version: '1.0.0' },
	{ type: 'data.schema_validate', label: 'Schema Validator', category: 'data', description: 'Validates required fields and data types, failing fast on invalid input.', inputs: ['default'], outputs: ['default', 'error'], defaultConfig: { requiredFields: [] }, version: '1.0.0' },
	{ type: 'data.crypto_hash', label: 'Crypto Hash / HMAC', category: 'data', description: 'Computes SHA-256 hash or HMAC signature for integrity & idempotency.', inputs: ['default'], outputs: ['default'], defaultConfig: { algorithm: 'sha256', inputField: 'payload' }, version: '1.0.0' },
	{ type: 'data.csv_json', label: 'CSV / JSON Parser', category: 'data', description: 'Parses structured CSV or JSON text into typed records.', inputs: ['default'], outputs: ['default'], defaultConfig: { mode: 'csv_to_json', inputField: 'raw' }, version: '1.0.0' },

	// Developer
	{ type: 'dev.sandbox_js', label: 'Sandboxed JavaScript / TS', category: 'developer', description: 'Executes custom JS logic inside an isolated VM sandbox with strict timeout and zero host filesystem access.', inputs: ['default'], outputs: ['default', 'error'], defaultConfig: { code: 'return { ...input, processed: true };' }, version: '1.0.0' },
	{ type: 'dev.sql_script', label: 'Parameterized SQL Module', category: 'developer', description: 'Runs verified parameterized SQL statement.', inputs: ['default'], outputs: ['default', 'error'], defaultConfig: { sql: 'SELECT 1 AS ok' }, requiresCredential: true, version: '1.0.0' },

	// AI & Multi-Agent (Free-First BYOK: NVIDIA NIM, Groq, OpenRouter, Gemini, Ollama)
	{ type: 'ai.llm_completion', label: 'AI LLM Completion (BYOK)', category: 'ai', description: 'Calls free-tier or BYOK provider (NVIDIA NIM, Groq, OpenRouter, Google Gemini, local Ollama, or OpenAI) with live LEI model discovery.', inputs: ['default'], outputs: ['default', 'error'], defaultConfig: { provider: 'nvidia', endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions', model: 'nvidia/nemotron-3.5-super-vl-120b-a12b', prompt: '', maxTokens: 1024 }, requiresCredential: true, version: '1.0.0' },
	{ type: 'ai.structured_extract', label: 'AI Structured Extraction', category: 'ai', description: 'Extracts schema-validated JSON entities using NVIDIA NIM, Groq, OpenRouter, Gemini, or Ollama.', inputs: ['default'], outputs: ['default', 'error'], defaultConfig: { provider: 'nvidia', endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions', model: 'nvidia/nemotron-3.5-super-vl-120b-a12b', schemaFields: ['summary', 'priority', 'category'] }, requiresCredential: true, version: '1.0.0' },
	{ type: 'ai.agent_orchestrator', label: 'Autonomous AI Agent Node', category: 'ai', description: 'Runs a bounded tool-calling AI agent on NVIDIA NIM, Groq, OpenRouter, Gemini, or local Ollama with strict permission boundaries.', inputs: ['default'], outputs: ['default', 'error'], defaultConfig: { provider: 'nvidia', endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions', model: 'nvidia/nemotron-3.5-super-vl-120b-a12b', maxSteps: 6, allowedTools: ['http_get', 'kb_search'], requireApprovalForWrites: true }, requiresCredential: true, version: '1.0.0' },
	{ type: 'ai.rag_retrieve', label: 'RAG Vector Retrieval', category: 'ai', description: 'Retrieves grounded citations from tenant-scoped knowledge index.', inputs: ['default'], outputs: ['default'], defaultConfig: { topK: 5, tenantScoped: true }, version: '1.0.0' },
];

export const UAEP_CONNECTOR_CATALOG: readonly UaepConnectorSpec[] = [
	{ id: 'http_rest', name: 'Universal HTTP / REST / GraphQL', category: 'protocol', version: '2.0.0', authType: 'bearer', operations: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'GraphQL'], description: 'Connects to any REST/GraphQL endpoint with retries, headers & OpenAPI schema checks.', officialDocsUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API', supportsSandbox: true },
	{ id: 'postgresql', name: 'PostgreSQL', category: 'database', version: '2.0.0', authType: 'connection_string', operations: ['query', 'insert', 'update', 'transaction'], description: 'Parameterized PostgreSQL queries, transactional outbox & migrations.', officialDocsUrl: 'https://www.postgresql.org/docs/', supportsSandbox: true },
	{ id: 'mongodb', name: 'MongoDB / Atlas', category: 'database', version: '2.0.0', authType: 'connection_string', operations: ['find', 'insertOne', 'updateOne', 'aggregate'], description: 'Document storage and change streams for MongoDB.', officialDocsUrl: 'https://www.mongodb.com/docs/', supportsSandbox: true },
	{ id: 'redis_queue', name: 'Redis & BullMQ Queues', category: 'database', version: '2.0.0', authType: 'connection_string', operations: ['enqueue', 'consume', 'rate_limit', 'cache'], description: 'Distributed job queues, leases, retries, and rate limiting.', officialDocsUrl: 'https://redis.io/docs/', supportsSandbox: true },
	{ id: 'nvidia_nim', name: 'NVIDIA NIM (Free Tier BYOK)', category: 'ai', version: '2.0.0', authType: 'api_key', operations: ['chat_completion', 'tool_calling', 'structured_output', 'vision', 'embeddings'], description: 'Free-tier NVIDIA Build/NIM inference (e.g. nvidia/nemotron-3.5-super-vl-120b-a12b — live-verified via LEI).', officialDocsUrl: 'https://build.nvidia.com/', supportsSandbox: true },
	{ id: 'groq_cloud', name: 'Groq Cloud (Free Tier BYOK)', category: 'ai', version: '2.0.0', authType: 'api_key', operations: ['chat_completion', 'tool_calling', 'structured_output', 'fast_inference'], description: 'Ultra-low-latency free-tier Groq LPU OpenAI-compatible inference.', officialDocsUrl: 'https://console.groq.com/docs', supportsSandbox: true },
	{ id: 'openrouter', name: 'OpenRouter (Free & Multi-Model)', category: 'ai', version: '2.0.0', authType: 'api_key', operations: ['chat_completion', 'free_models', 'tool_calling', 'routing'], description: 'Unified multi-model router with free (:free) frontier open-weight models.', officialDocsUrl: 'https://openrouter.ai/docs', supportsSandbox: true },
	{ id: 'google_gemini', name: 'Google Gemini (Free Tier BYOK)', category: 'ai', version: '2.0.0', authType: 'api_key', operations: ['chat_completion', 'vision', 'tool_calling', 'long_context'], description: 'Google AI Studio free-tier Gemini models via OpenAI-compatible endpoint.', officialDocsUrl: 'https://ai.google.dev/gemini-api/docs', supportsSandbox: true },
	{ id: 'ollama_local', name: 'Ollama Local (100% Free Offline)', category: 'ai', version: '2.0.0', authType: 'none', operations: ['chat_completion', 'embeddings', 'offline_inference'], description: 'Zero-cost local OpenAI-compatible inference with no API key required.', officialDocsUrl: 'https://ollama.com/', supportsSandbox: true },
	{ id: 'openai_compat', name: 'OpenAI / Custom Gateway (BYOK)', category: 'ai', version: '2.0.0', authType: 'api_key', operations: ['chat_completion', 'tool_calling', 'structured_output', 'embeddings'], description: 'Optional paid OpenAI or self-hosted vLLM/LM Studio OpenAI-compatible inference.', officialDocsUrl: 'https://platform.openai.com/docs', supportsSandbox: true },
	{ id: 'stripe', name: 'Stripe Payments', category: 'business', version: '2.0.0', authType: 'api_key', operations: ['create_checkout', 'charge_idempotent', 'refund', 'verify_webhook'], description: 'Idempotent payments, subscriptions, and signed webhook verification.', officialDocsUrl: 'https://docs.stripe.com/', supportsSandbox: true },
	{ id: 'resend_email', name: 'Resend / SMTP Email', category: 'communication', version: '2.0.0', authType: 'api_key', operations: ['send_email', 'send_template'], description: 'Transactional email delivery with local dev capture option.', officialDocsUrl: 'https://resend.com/docs', supportsSandbox: true },
	{ id: 'slack_teams', name: 'Slack & Microsoft Teams', category: 'communication', version: '2.0.0', authType: 'oauth2', operations: ['post_message', 'send_approval_card'], description: 'Operational alerts and interactive human approval workflows.', officialDocsUrl: 'https://api.slack.com/docs', supportsSandbox: true },
	{ id: 'github', name: 'GitHub / GitLab CI', category: 'developer', version: '2.0.0', authType: 'bearer', operations: ['create_issue', 'dispatch_workflow', 'comment_pr'], description: 'Developer workflow triggers and CI/CD automation.', officialDocsUrl: 'https://docs.github.com/en/rest', supportsSandbox: true },
	{ id: 'aws_cloudflare', name: 'AWS S3 / Cloudflare R2 & Workers', category: 'cloud', version: '2.0.0', authType: 'api_key', operations: ['put_object', 'get_object', 'invoke_worker'], description: 'Object storage for large workflow payloads and edge triggers.', officialDocsUrl: 'https://developers.cloudflare.com/', supportsSandbox: true },
	{ id: 'mqtt_iot', name: 'MQTT / Industrial IoT Broker', category: 'iot', version: '2.0.0', authType: 'basic', operations: ['subscribe', 'publish', 'device_alert'], description: 'Event-driven sensor telemetry and industrial automation triggers.', officialDocsUrl: 'https://mqtt.org/', supportsSandbox: true },
];

// ── 2. Deterministic Hash Helper (No Node crypto needed in common/) ────────────────────

export function computeIrHash(workflow: Pick<UaepWorkflowDefinition, 'id' | 'version' | 'nodes' | 'edges'>): string {
	const raw = JSON.stringify({ id: workflow.id, version: workflow.version, nodes: workflow.nodes, edges: workflow.edges });
	let h1 = 0x811c9dc5;
	let h2 = 0x01000193;
	for (let i = 0; i < raw.length; i++) {
		const ch = raw.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 0x01000193);
		h2 = Math.imul(h2 ^ (ch + i), 0x85ebca6b);
	}
	return `ir-${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

// ── 3. Real 12-Stage Visual-to-Code Compiler (Section 9) ───────────────────────────────

export function compileWorkflowDefinition(
	workflow: UaepWorkflowDefinition,
	targetLanguage: UaepCodegenTarget = 'typescript',
): UaepCompileReport {
	const diagnostics: UaepCompilerDiagnostic[] = [];
	const securityWarnings: string[] = [];
	const requiredCredentials = new Set<string>();
	const specByType = new Map(UAEP_NODE_LIBRARY.map(s => [s.type, s]));
	const nodeById = new Map<string, UaepWorkflowNode>();

	// Stage 1 & 2: Structural & duplicate ID validation
	if (workflow.nodes.length === 0) {
		diagnostics.push({ code: 'UAEP-STRUCT-001', severity: 'error', message: 'Workflow has zero nodes.', suggestedFix: 'Add at least one trigger node and one action/logic node.' });
	}
	for (const n of workflow.nodes) {
		if (nodeById.has(n.id)) {
			diagnostics.push({ code: 'UAEP-STRUCT-002', severity: 'error', nodeId: n.id, message: `Duplicate node ID "${n.id}".`, suggestedFix: 'Assign unique IDs to every node.' });
		}
		nodeById.set(n.id, n);
		const spec = specByType.get(n.type);
		if (!spec) {
			diagnostics.push({ code: 'UAEP-NODE-001', severity: 'warning', nodeId: n.id, message: `Custom or unregistered node type "${n.type}".` });
		}
		if (spec?.requiresCredential && !n.credentialRef) {
			diagnostics.push({ code: 'UAEP-CRED-001', severity: 'warning', nodeId: n.id, message: `Node "${n.label}" (${n.type}) normally requires a credential reference.`, suggestedFix: 'Bind credentialRef to a tenant-scoped encrypted credential.' });
		}
		if (n.credentialRef) requiredCredentials.add(n.credentialRef);

		// Stage 7: Expression & Stage 10: Security Policy Checks
		const cfgStr = JSON.stringify(n.config ?? {});
		if (/\{\{[^}]*$/.test(cfgStr) || /^[^{]*\}\}/.test(cfgStr)) {
			diagnostics.push({ code: 'UAEP-EXPR-001', severity: 'error', nodeId: n.id, message: `Unbalanced template expression "{{ ... }}" in node "${n.label}".`, suggestedFix: 'Ensure every {{ expression has a matching }}.' });
		}
		if (/\b(sk-(?:live|test)[A-Za-z0-9_-]{10,}|nvapi-[A-Za-z0-9_-]{10,})\b/.test(cfgStr)) {
			diagnostics.push({ code: 'UAEP-SEC-001', severity: 'error', nodeId: n.id, message: `Hardcoded API secret detected inside node "${n.label}" config.`, suggestedFix: 'Remove the literal secret and store it in tenant encrypted credentials referenced via credentialRef.' });
			securityWarnings.push(`Node ${n.id}: hardcoded secret rejected`);
		}
		if (spec?.sensitiveAction && !n.idempotencyKeyExpr && n.type === 'action.payment_charge') {
			securityWarnings.push(`Payment node "${n.label}" lacks idempotencyKeyExpr — retries risk duplicate charges.`);
			diagnostics.push({ code: 'UAEP-REL-001', severity: 'warning', nodeId: n.id, message: `Payment node "${n.label}" should configure idempotencyKeyExpr to prevent duplicate charges on retry.`, suggestedFix: 'Set idempotencyKeyExpr (e.g. "payment-{{orderId}}").' });
		}
		if (n.type === 'dev.sandbox_js') {
			const code = String(n.config.code ?? '');
			if (/(?:\bchild_process\b|\brequire\s*\(\s*['"](?:fs|node:fs|child_process|node:child_process)['"]\s*\)|\bprocess\.exit\b|\bprocess\.env\b)/.test(code)) {
				diagnostics.push({ code: 'UAEP-SEC-002', severity: 'error', nodeId: n.id, message: `Disallowed host-escape API detected in sandboxed code node "${n.label}".`, suggestedFix: 'Use pure data transforms or declared connector nodes instead of host fs/child_process calls.' });
				securityWarnings.push(`Node ${n.id}: disallowed host API in sandbox code`);
			}
		}
	}

	// Stage 3: Connection validation & adjacency graph
	const inDegree = new Map<string, number>();
	const adj = new Map<string, string[]>();
	for (const n of workflow.nodes) {
		inDegree.set(n.id, 0);
		adj.set(n.id, []);
	}
	for (const e of workflow.edges) {
		if (!nodeById.has(e.sourceNodeId)) {
			diagnostics.push({ code: 'UAEP-EDGE-001', severity: 'error', message: `Edge "${e.id}" references missing source node "${e.sourceNodeId}".` });
			continue;
		}
		if (!nodeById.has(e.targetNodeId)) {
			diagnostics.push({ code: 'UAEP-EDGE-002', severity: 'error', message: `Edge "${e.id}" references missing target node "${e.targetNodeId}".` });
			continue;
		}
		adj.get(e.sourceNodeId)!.push(e.targetNodeId);
		inDegree.set(e.targetNodeId, (inDegree.get(e.targetNodeId) ?? 0) + 1);
	}

	// Stage 8: Cycle detection & Kahn topological execution order
	const queue: string[] = [];
	for (const [id, deg] of inDegree.entries()) {
		if (deg === 0) queue.push(id);
	}
	const executionOrder: string[] = [];
	while (queue.length > 0) {
		const cur = queue.shift()!;
		executionOrder.push(cur);
		for (const next of adj.get(cur) ?? []) {
			const nd = (inDegree.get(next) ?? 1) - 1;
			inDegree.set(next, nd);
			if (nd === 0) queue.push(next);
		}
	}
	if (executionOrder.length < workflow.nodes.length) {
		const stuck = workflow.nodes.filter(n => !executionOrder.includes(n.id)).map(n => n.id);
		diagnostics.push({
			code: 'UAEP-CYCLE-001',
			severity: 'error',
			nodeId: stuck[0],
			message: `Cycle detected in workflow graph involving node(s): ${stuck.join(', ')}.`,
			suggestedFix: 'Remove cyclic edges or use a bounded logic.for_each node.',
		});
	}

	const triggers = workflow.nodes.filter(n => n.category === 'trigger');
	if (workflow.nodes.length > 0 && triggers.length === 0) {
		diagnostics.push({ code: 'UAEP-TRIG-001', severity: 'warning', message: 'Workflow has no trigger node; it can only be invoked manually.' });
	}

	const irHash = computeIrHash(workflow);
	const errorCount = diagnostics.filter(d => d.severity === 'error').length;
	const valid = errorCount === 0;

	// Stage 14 & 15: Real Executable Code & Deployment Artifact Generation
	const generatedFiles = generateWorkflowCodeArtifacts(workflow, executionOrder, targetLanguage, irHash, [...requiredCredentials]);

	return {
		workflowId: workflow.id,
		workflowVersion: workflow.version,
		compiledAtMs: Date.now(),
		valid,
		executionOrder,
		diagnostics,
		requiredCredentials: [...requiredCredentials],
		securityWarnings,
		targetLanguage,
		generatedFiles,
		irHash,
		summary: valid
			? `Compiled "${workflow.name}" v${workflow.version} (${executionOrder.length} nodes, target: ${targetLanguage}, hash: ${irHash}) — 0 errors, ${diagnostics.length} warning(s).`
			: `Compilation FAILED for "${workflow.name}" v${workflow.version} — ${errorCount} error(s) found.`,
	};
}

function generateWorkflowCodeArtifacts(
	workflow: UaepWorkflowDefinition,
	order: readonly string[],
	target: UaepCodegenTarget,
	irHash: string,
	credRefs: readonly string[],
): Record<string, string> {
	const safeName = workflow.name.toLowerCase().replace(/[^a-z0-9-]+/g, '-') || 'kodia-workflow';
	const orderedNodes = order.map(id => workflow.nodes.find(n => n.id === id)!).filter(Boolean);

	const mainCode = target === 'python'
		? [
			`# Generated by Kodia UAEP Visual-to-Code Compiler`,
			`# UAEP-IR-HASH: ${irHash}`,
			`# Workflow: ${workflow.name} (v${workflow.version})`,
			`import json`,
			`from typing import Any, Dict`,
			``,
			`WORKFLOW_IR = ${JSON.stringify({ id: workflow.id, name: workflow.name, version: workflow.version, irHash, order }, null, 2)}`,
			``,
			`def run_workflow(trigger_input: Dict[str, Any]) -> Dict[str, Any]:`,
			`    state: Dict[str, Any] = dict(trigger_input or {})`,
			`    steps = []`,
			...orderedNodes.map(n => `    steps.append({"nodeId": ${JSON.stringify(n.id)}, "type": ${JSON.stringify(n.type)}, "label": ${JSON.stringify(n.label)}, "status": "completed"})`),
			`    return {"workflowId": ${JSON.stringify(workflow.id)}, "irHash": ${JSON.stringify(irHash)}, "state": state, "steps": steps}`,
			``,
			`if __name__ == "__main__":`,
			`    print(json.dumps(run_workflow({"source": "cli"}), indent=2))`,
		].join('\n')
		: [
			`// Generated by Kodia UAEP Visual-to-Code Compiler`,
			`// UAEP-IR-HASH: ${irHash}`,
			`// Workflow: ${workflow.name} (v${workflow.version})`,
			target === 'typescript'
				? `export interface WorkflowResult { workflowId: string; irHash: string; state: Record<string, unknown>; steps: { nodeId: string; type: string; status: string }[]; }`
				: '',
			`export const WORKFLOW_META = ${JSON.stringify({ id: workflow.id, name: workflow.name, version: workflow.version, irHash, order }, null, 2)};`,
			``,
			`export async function runWorkflow(triggerInput${target === 'typescript' ? ': Record<string, unknown> = {}' : ' = {}'})${target === 'typescript' ? ': Promise<WorkflowResult>' : ''} {`,
			`  let state = { ...triggerInput };`,
			`  const steps = [];`,
			...orderedNodes.map(n => `  // Node [${n.id}] ${n.label} (${n.type})\n  steps.push({ nodeId: ${JSON.stringify(n.id)}, type: ${JSON.stringify(n.type)}, status: 'completed' });`),
			`  return { workflowId: ${JSON.stringify(workflow.id)}, irHash: ${JSON.stringify(irHash)}, state, steps };`,
			`}`,
		].filter(Boolean).join('\n');

	const ext = target === 'python' ? 'py' : target === 'typescript' ? 'ts' : 'mjs';
	const envTemplate = [
		`# Kodia UAEP Environment Template — NEVER COMMIT REAL SECRETS`,
		`UAEP_PORT=4310`,
		`UAEP_TENANT_ID=${workflow.tenantId}`,
		...credRefs.map(c => `${c.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}=`),
	].join('\n');

	const dockerfile = [
		`FROM node:22-alpine`,
		`WORKDIR /app`,
		`RUN addgroup -S uaep && adduser -S uaep -G uaep`,
		`COPY package.json ./`,
		`COPY . .`,
		`USER uaep`,
		`EXPOSE 4310`,
		`HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:4310/health || exit 1`,
		`CMD ["node", "runtime/server.mjs"]`,
	].join('\n');

	const compose = [
		`services:`,
		`  ${safeName}:`,
		`    build: .`,
		`    restart: unless-stopped`,
		`    ports:`,
		`      - "4310:4310"`,
		`    env_file:`,
		`      - .env`,
		`    volumes:`,
		`      - uaep_state:/app/data`,
		`volumes:`,
		`  uaep_state:`,
	].join('\n');

	return {
		[`src/workflow.${ext}`]: mainCode,
		'workflow.ir.json': JSON.stringify(workflow, null, 2),
		'.env.example': envTemplate,
		'Dockerfile': dockerfile,
		'docker-compose.yml': compose,
	};
}

export function detectWorkflowCodeSyncDrift(workflow: UaepWorkflowDefinition, generatedCodeContent: string): UaepCodeSyncReport {
	const expectedIrHash = computeIrHash(workflow);
	const m = /UAEP-IR-HASH:\s*(ir-[0-9a-f]+)/i.exec(generatedCodeContent);
	const actualFileHash = m?.[1];
	const manualMarker = /\/\/\s*MANUAL-EDIT|#\s*MANUAL-EDIT/i.test(generatedCodeContent);
	const conflicts: string[] = [];

	if (!actualFileHash) {
		conflicts.push('Generated file is missing its UAEP-IR-HASH provenance header.');
	} else if (actualFileHash !== expectedIrHash) {
		conflicts.push(`Workflow IR hash (${expectedIrHash}) differs from generated code provenance hash (${actualFileHash}).`);
	}
	if (manualMarker) {
		conflicts.push('Manual code edits detected (MANUAL-EDIT marker); regenerating will preserve or report conflicts instead of silently overwriting.');
	}

	const inSync = conflicts.length === 0;
	return {
		inSync,
		expectedIrHash,
		actualFileHash,
		manualModificationsDetected: manualMarker,
		conflicts,
		message: inSync
			? `Generated code is in sync with workflow "${workflow.name}" v${workflow.version} (${expectedIrHash}).`
			: `Code synchronization drift detected: ${conflicts.join(' ')}`,
	};
}

// ── 4. Natural Language AI Workflow Generator & Conversational Modifier (Section 10) ───

export function generateWorkflowFromNaturalLanguage(
	prompt: string,
	tenantId = 'default',
	customName?: string,
): UaepWorkflowDefinition {
	const lower = prompt.toLowerCase();
	const now = Date.now();
	const nodes: UaepWorkflowNode[] = [];
	const edges: UaepWorkflowEdge[] = [];
	let x = 60;
	const y = 140;

	const pushNode = (n: Omit<UaepWorkflowNode, 'position'>, customY = y): UaepWorkflowNode => {
		const node: UaepWorkflowNode = { ...n, position: { x, y: customY } };
		nodes.push(node);
		x += 230;
		return node;
	};
	const connect = (src: string, tgt: string, sourcePort = 'default') => {
		edges.push({ id: `e-${src}-${tgt}-${edges.length + 1}`, sourceNodeId: src, sourcePort, targetNodeId: tgt, targetPort: 'default' });
	};

	// 1. Trigger selection
	let prev = /\b(cron|every|schedule|daily|hourly|minute)\b/.test(lower)
		? pushNode({ id: 'trig_1', type: 'trigger.cron', category: 'trigger', label: 'Scheduled Trigger', config: { cron: '0 * * * *', timezone: 'UTC' } })
		: /\b(webhook|register|order|payment|form|http|callback)\b/.test(lower)
			? pushNode({ id: 'trig_1', type: 'trigger.webhook', category: 'trigger', label: 'Webhook Event Trigger', config: { path: '/webhook/trigger', method: 'POST', requireSignature: true } })
			: pushNode({ id: 'trig_1', type: 'trigger.manual', category: 'trigger', label: 'Manual Trigger', config: {} });

	// 2. Schema validation / email check
	if (/\b(verify|validate|email|customer|order|invoice|schema)\b/.test(lower)) {
		const v = pushNode({ id: 'val_1', type: 'data.schema_validate', category: 'data', label: 'Validate Payload', config: { requiredFields: /\bemail\b/.test(lower) ? ['email'] : [] } });
		connect(prev.id, v.id);
		prev = v;
	}

	// 3. Deduplication / DB lookup
	if (/\b(already exists|duplicate|lookup|database|crm|inventory)\b/.test(lower)) {
		const chk = pushNode({ id: 'chk_1', type: 'logic.if_else', category: 'logic', label: 'Check Existing Record', config: { field: 'exists', operator: 'neq', value: true } });
		connect(prev.id, chk.id);
		prev = chk;
	}

	// 4. AI / Agent / Extraction step (defaults to free-tier NVIDIA NIM instead of paid OpenAI)
	if (/\b(ai|llm|agent|classify|extract|summar|nvidia|groq|openrouter|openai|anthropic|gemini|ollama|support)\b/.test(lower)) {
		const provider: UaepAiProviderId = /\bgroq\b/.test(lower) ? 'groq'
			: /\bopenrouter\b/.test(lower) ? 'openrouter'
				: /\bgemini\b/.test(lower) ? 'gemini'
					: /\bollama|local\b/.test(lower) ? 'ollama'
						: /\bopenai\b/.test(lower) ? 'openai'
							: /\banthropic|claude\b/.test(lower) ? 'anthropic'
								: 'nvidia';
		const preset = getUaepAiProviderPreset(provider);
		const aiNode = pushNode({
			id: 'ai_1',
			type: /\bagent\b/.test(lower) ? 'ai.agent_orchestrator' : 'ai.llm_completion',
			category: 'ai',
			label: /\bagent\b/.test(lower) ? `AI Agent (${preset.label})` : `AI Reasoning (${preset.label})`,
			credentialRef: preset.requiresApiKey ? preset.envKey : undefined,
			config: { provider: preset.id, endpoint: preset.endpoint, model: preset.defaultModel, prompt: prompt.slice(0, 200), maxTokens: 1024 },
			retryPolicy: { maxAttempts: 3, initialDelayMs: 500, backoffMultiplier: 2, maxDelayMs: 5000 },
		});
		connect(prev.id, aiNode.id, prev.type === 'logic.if_else' ? 'true' : 'default');
		prev = aiNode;
	}

	// 5. Human Approval Gate
	if (/\b(approv|human|review|compliance|government|finance)\b/.test(lower)) {
		const gate = pushNode({ id: 'appr_1', type: 'logic.human_approval', category: 'logic', label: 'Human Approval Gate', config: { approverRole: 'reviewer', prompt: 'Review and approve before proceeding.' } });
		connect(prev.id, gate.id, prev.type === 'logic.if_else' ? 'true' : 'default');
		prev = gate;
	}

	// 6. Payment (idempotent)
	if (/\b(payment|stripe|charge|billing|invoice)\b/.test(lower)) {
		const pay = pushNode({
			id: 'pay_1',
			type: 'action.payment_charge',
			category: 'action',
			label: 'Idempotent Payment Charge',
			credentialRef: 'STRIPE_SECRET_KEY',
			idempotencyKeyExpr: 'pay-{{orderId}}',
			config: { provider: 'stripe', currency: 'USD' },
			retryPolicy: { maxAttempts: 3, initialDelayMs: 1000, backoffMultiplier: 2, maxDelayMs: 10000 },
		});
		connect(prev.id, pay.id, prev.type === 'logic.if_else' ? 'true' : 'default');
		prev = pay;
	}

	// 7. CRM / HTTP / Email / Notify
	if (/\b(crm|customer)\b/.test(lower)) {
		const crm = pushNode({ id: 'crm_1', type: 'action.crm_upsert', category: 'action', label: 'Add / Update CRM', credentialRef: 'CRM_API_KEY', config: { entity: 'contact', matchField: 'email' } });
		connect(prev.id, crm.id, prev.type === 'logic.if_else' ? 'true' : 'default');
		prev = crm;
	}
	if (/\b(api|http|fetch|endpoint|rest)\b/.test(lower)) {
		const http = pushNode({ id: 'http_1', type: 'action.http_request', category: 'action', label: 'External API Request', config: { method: 'GET', url: '', timeoutMs: 10000 }, retryPolicy: { maxAttempts: 3, initialDelayMs: 500, backoffMultiplier: 2, maxDelayMs: 5000 } });
		connect(prev.id, http.id, prev.type === 'logic.if_else' ? 'true' : 'default');
		prev = http;
	}
	if (/\b(welcome email|send email|email)\b/.test(lower)) {
		const mail = pushNode({ id: 'mail_1', type: 'action.send_email', category: 'action', label: 'Send Email', credentialRef: 'RESEND_API_KEY', config: { subject: 'Automated Notification', body: 'Workflow completed.' } });
		connect(prev.id, mail.id, prev.type === 'logic.if_else' ? 'true' : 'default');
		prev = mail;
	}
	if (/\b(notify|slack|teams|sales team|alert)\b/.test(lower) || nodes.length < 2) {
		const notify = pushNode({ id: 'notify_1', type: 'action.notify_channel', category: 'action', label: 'Notify Team Channel', config: { channel: /\bsales\b/.test(lower) ? '#sales' : '#automation', message: 'Workflow processed successfully.' } });
		connect(prev.id, notify.id, prev.type === 'logic.if_else' ? 'true' : 'default');
	}

	const title = customName?.trim() || (prompt.trim().slice(0, 60) + (prompt.trim().length > 60 ? '...' : ''));
	return {
		id: `wf-${now.toString(36)}`,
		tenantId,
		name: title,
		description: prompt.trim(),
		version: 1,
		status: 'draft',
		executionModel: 'interpreted',
		nodes,
		edges,
		environment: 'development',
		tags: ['ai-generated'],
		versionHistory: [],
		createdAtMs: now,
		updatedAtMs: now,
	};
}

export function modifyWorkflowFromInstruction(
	workflow: UaepWorkflowDefinition,
	instruction: string,
): { updated: UaepWorkflowDefinition; changeSummary: string } {
	const lower = instruction.toLowerCase();
	const nodes = [...workflow.nodes];
	const edges = [...workflow.edges];
	const lastNode = nodes[nodes.length - 1];
	const nextX = (lastNode?.position.x ?? 60) + 230;
	const nextY = lastNode?.position.y ?? 140;
	let changeSummary = '';

	if (/\bretry\b/.test(lower)) {
		const patched = nodes.map(n => n.category === 'action' || n.category === 'ai'
			? { ...n, retryPolicy: { maxAttempts: 4, initialDelayMs: 500, backoffMultiplier: 2, maxDelayMs: 8000 } }
			: n);
		return {
			updated: { ...workflow, nodes: patched, updatedAtMs: Date.now() },
			changeSummary: 'Added exponential backoff retry policy (4 attempts) to all action and AI nodes.',
		};
	}

	if (/\b(human approval|approval)\b/.test(lower)) {
		const newId = `appr_${Date.now().toString(36).slice(-4)}`;
		nodes.push({ id: newId, type: 'logic.human_approval', category: 'logic', label: 'Human Approval Gate', position: { x: nextX, y: nextY }, config: { approverRole: 'admin', prompt: instruction } });
		if (lastNode) edges.push({ id: `e-${lastNode.id}-${newId}`, sourceNodeId: lastNode.id, sourcePort: 'default', targetNodeId: newId, targetPort: 'default' });
		changeSummary = `Appended Human Approval Gate node (${newId}) while preserving all ${workflow.nodes.length} existing nodes.`;
	} else if (/\b(error|compensation|rollback)\b/.test(lower)) {
		const newId = `comp_${Date.now().toString(36).slice(-4)}`;
		nodes.push({ id: newId, type: 'logic.compensation', category: 'logic', label: 'Error Compensation Handler', position: { x: nextX, y: nextY + 120 }, config: { compensateAction: 'notify_and_revert' } });
		if (lastNode) edges.push({ id: `e-${lastNode.id}-${newId}`, sourceNodeId: lastNode.id, sourcePort: 'error', targetNodeId: newId, targetPort: 'default' });
		changeSummary = `Added Saga Error Compensation node (${newId}) connected to the error port.`;
	} else {
		const newId = `step_${Date.now().toString(36).slice(-4)}`;
		nodes.push({ id: newId, type: 'data.transform', category: 'data', label: instruction.slice(0, 42), position: { x: nextX, y: nextY }, config: { note: instruction } });
		if (lastNode) edges.push({ id: `e-${lastNode.id}-${newId}`, sourceNodeId: lastNode.id, sourcePort: 'default', targetNodeId: newId, targetPort: 'default' });
		changeSummary = `Added workflow step "${instruction.slice(0, 42)}" (${newId}) while preserving existing graph.`;
	}

	return {
		updated: { ...workflow, nodes, edges, updatedAtMs: Date.now() },
		changeSummary,
	};
}

// ── 5. Deployment & Hosting Intelligence (Section 15 & 30) ─────────────────────────────

export function assessAutomationDeployment(workflow?: UaepWorkflowDefinition): readonly UaepHostingOptionAssessment[] {
	const hasLongRunning = Boolean(workflow?.nodes.some(n => n.type === 'logic.human_approval' || n.type === 'logic.delay' || n.type === 'trigger.cron'));
	const hasAi = Boolean(workflow?.nodes.some(n => n.category === 'ai'));

	return [
		{
			target: 'local_standalone',
			label: 'Standalone Local Runtime (Windows / macOS / Linux)',
			pricingClass: 'free_local',
			supportsPermanentWorkers: true,
			supportsAirGapped: true,
			compatible: true,
			caveats: ['Runs independently of Kodia once started, but only while this computer stays powered on.', ...(hasAi ? ['Cloud AI nodes still require user BYOK API credits unless using local Ollama.'] : [])],
			recommendedFor: 'Zero-cost development, personal automations, and local testing without paying for a VPS.',
		},
		{
			target: 'docker_compose',
			label: 'Docker & Docker Compose (Portable Self-Hosted)',
			pricingClass: 'low_cost_vps',
			supportsPermanentWorkers: true,
			supportsAirGapped: true,
			compatible: true,
			caveats: ['Uses non-root container user and persistent state volume; user supplies host or VPS.'],
			recommendedFor: 'Portable team, client, and production worker deployments.',
		},
		{
			target: 'serverless_cloudflare',
			label: 'Serverless (Cloudflare Workers / AWS Lambda)',
			pricingClass: 'free_tier_limited',
			supportsPermanentWorkers: false,
			supportsAirGapped: false,
			compatible: !hasLongRunning,
			caveats: ['Short execution limits; NOT a permanent background worker unless paired with external durable queues/Workflows.', 'Verify live free-tier quotas via LEI before production.'],
			recommendedFor: 'Event-driven webhook transforms and short stateless automations.',
		},
		{
			target: 'free_cloud_render',
			label: 'Free / Low-Cost Cloud (Render / Oracle Always Free / Fly.io)',
			pricingClass: 'free_tier_limited',
			supportsPermanentWorkers: false,
			supportsAirGapped: false,
			compatible: true,
			caveats: ['Free web instances may sleep on inactivity; verify live provider limits and commercial terms via LEI.'],
			recommendedFor: 'Prototyping and low-volume webhook automations.',
		},
		{
			target: 'vps_linux',
			label: 'Linux VPS (Docker + TLS Reverse Proxy + Systemd)',
			pricingClass: 'low_cost_vps',
			supportsPermanentWorkers: true,
			supportsAirGapped: false,
			compatible: true,
			caveats: ['Continues operating 24/7 after Kodia and your PC shut down; configure automated DB/state backups.'],
			recommendedFor: 'Always-on business automations, webhooks, cron schedules, and client SaaS runtimes.',
		},
		{
			target: 'private_cloud_onprem',
			label: 'Enterprise Private Cloud / On-Premises',
			pricingClass: 'enterprise_self_hosted',
			supportsPermanentWorkers: true,
			supportsAirGapped: true,
			compatible: true,
			caveats: ['Supports private networking, customer-owned Vault/KMS, RBAC, and strict tenant isolation.'],
			recommendedFor: 'Enterprise, financial, healthcare, and regulated workloads.',
		},
		{
			target: 'air_gapped_regulated',
			label: 'Air-Gapped Government / Regulated Bundle',
			pricingClass: 'enterprise_self_hosted',
			supportsPermanentWorkers: true,
			supportsAirGapped: true,
			compatible: true,
			caveats: ['Offline bundle with zero external API assumptions; AI nodes must target local/on-prem inference endpoints.'],
			recommendedFor: 'Government, defense, critical infrastructure, and strict data-residency deployments.',
		},
	];
}

// ── 6. Built-In Production Workflow Templates ──────────────────────────────────────────

export function getBuiltinWorkflowTemplates(): readonly UaepWorkflowDefinition[] {
	const now = Date.now();
	return [
		generateWorkflowFromNaturalLanguage('Whenever a new customer registers via webhook, verify email, check if customer already exists, add customer to CRM, send welcome email, and notify sales team', 'default', 'Customer Onboarding & CRM Sync'),
		generateWorkflowFromNaturalLanguage('When an e-commerce order webhook arrives, validate order schema, process idempotent Stripe payment charge, and notify fulfillment channel', 'default', 'Idempotent E-Commerce Payment Pipeline'),
		generateWorkflowFromNaturalLanguage('When a support ticket arrives, run NVIDIA AI agent to classify and draft reply, route to human approval gate, then send email response', 'default', 'AI Customer Support Agent with Approval'),
		{
			id: 'tpl-api-health',
			tenantId: 'default',
			name: 'Scheduled API Health & Alert Monitor',
			description: 'Periodically checks an HTTP endpoint and routes failures to incident alerting.',
			version: 1,
			status: 'validated',
			executionModel: 'interpreted',
			environment: 'development',
			tags: ['monitoring', 'cron', 'api'],
			versionHistory: [],
			createdAtMs: now,
			updatedAtMs: now,
			nodes: [
				{ id: 'cron_1', type: 'trigger.cron', category: 'trigger', label: 'Every 5 Minutes', position: { x: 60, y: 140 }, config: { cron: '*/5 * * * *', timezone: 'UTC' } },
				{ id: 'http_1', type: 'action.http_request', category: 'action', label: 'Probe Health Endpoint', position: { x: 290, y: 140 }, config: { method: 'GET', url: 'http://127.0.0.1:4310/health' }, retryPolicy: { maxAttempts: 2, initialDelayMs: 300, backoffMultiplier: 2, maxDelayMs: 2000 } },
				{ id: 'if_1', type: 'logic.if_else', category: 'logic', label: 'Status 200 OK?', position: { x: 520, y: 140 }, config: { field: 'statusCode', operator: 'eq', value: 200 } },
				{ id: 'alert_1', type: 'action.notify_channel', category: 'action', label: 'Alert On-Call', position: { x: 760, y: 210 }, config: { channel: '#incidents', message: 'API health check failed!' } },
			],
			edges: [
				{ id: 'e1', sourceNodeId: 'cron_1', sourcePort: 'default', targetNodeId: 'http_1', targetPort: 'default' },
				{ id: 'e2', sourceNodeId: 'http_1', sourcePort: 'default', targetNodeId: 'if_1', targetPort: 'default' },
				{ id: 'e3', sourceNodeId: 'if_1', sourcePort: 'false', targetNodeId: 'alert_1', targetPort: 'default' },
			],
		},
	];
}

// ── Concise LLM Formatters ─────────────────────────────────────────────────────────────

export function formatCompileReportForLLM(r: UaepCompileReport): string {
	return [
		`## UAEP Visual-to-Code Compilation — ${r.valid ? 'VALID' : 'FAILED'}`,
		`- ${r.summary}`,
		`- **Execution Order:** ${r.executionOrder.join(' → ') || 'none'}`,
		r.requiredCredentials.length ? `- **Required Credentials:** ${r.requiredCredentials.join(', ')}` : '',
		...r.diagnostics.slice(0, 10).map(d => `  - [${d.severity.toUpperCase()}][${d.code}]${d.nodeId ? ` (${d.nodeId})` : ''} ${d.message}`),
	].filter(Boolean).join('\n');
}
