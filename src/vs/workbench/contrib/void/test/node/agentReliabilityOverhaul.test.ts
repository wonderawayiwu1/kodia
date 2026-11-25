/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import {
	extractFallbackTextToolCalls,
	finalizeStreamedToolCalls,
	inferToolParamSchema,
	mergeStreamedToolDelta,
	parseOrRepairToolArgs,
} from '../../common/toolCallJsonRepair.js';
import { MAX_FOCUSED_TOOLS_PER_TURN, selectFocusedToolset } from '../../common/toolBudget.js';
import { repairToolParams } from '../../common/toolParamRepair.js';
import { prepareMessages } from '../../common/prepareLLMMessages.js';
import { availableTools, chat_systemMessage, InternalToolInfo } from '../../common/prompt/prompts.js';
import { estimateTokens } from '../../common/tokenizer.js';
import { FILE_CHANGING_TOOLS, shouldRequestCompletionCheck } from '../../common/completionCheck.js';
import {
	buildMandatoryLiveWebQueries,
	extractMidTurnWebVerificationQuery,
	formatAutoWebSearchResultsForLLM,
} from '../../common/liveWebGrounding.js';

suite('Kodia Core Agent Engine Reliability Overhaul', () => {

	suite('1. Focused Toolset Selection (prevents 364-tool schema overload)', () => {
		const allAgentTools = availableTools('agent', []) ?? [];

		test('caps full 360+ agent toolset to <= MAX_FOCUSED_TOOLS_PER_TURN (56)', () => {
			assert.ok(allAgentTools.length > 200, `expected >200 built-in tools, got ${allAgentTools.length}`);
			const res = selectFocusedToolset(
				allAgentTools,
				'Build NOVA Document Intelligence full-stack web app with React, Express, SQLite, Groq and NVIDIA',
				128_000,
				estimateTokens,
			);
			assert.ok(res.tools.length <= MAX_FOCUSED_TOOLS_PER_TURN, `expected <= ${MAX_FOCUSED_TOOLS_PER_TURN} tools, got ${res.tools.length}`);
			assert.ok(res.tools.length >= 25, `expected core coding tools present, got ${res.tools.length}`);
			const names = new Set(res.tools.map(t => t.name));
			for (const essential of ['read_file', 'write_file', 'edit_file', 'multi_edit_file', 'run_command', 'search_for_files', 'db_query', 'browser_launch', 'update_steps']) {
				assert.ok(names.has(essential), `essential tool "${essential}" missing from focused toolset`);
			}
		});

		test('dynamically activates domain packs matching user request while staying <= 56 tools', () => {
			const mobileRes = selectFocusedToolset(allAgentTools, 'Build an Android and iOS Flutter mobile app', 128_000, estimateTokens);
			assert.ok(mobileRes.tools.length <= MAX_FOCUSED_TOOLS_PER_TURN);
			assert.ok(mobileRes.tools.some(t => t.name.startsWith('mobile_')));

			const autoRes = selectFocusedToolset(allAgentTools, 'Create an n8n workflow automation with webhook trigger', 128_000, estimateTokens);
			assert.ok(autoRes.tools.length <= MAX_FOCUSED_TOOLS_PER_TURN);
			assert.ok(autoRes.tools.some(t => t.name.startsWith('uaep_')));
		});

		test('always preserves MCP tools and explicitly named tools', () => {
			const fakeMcp: InternalToolInfo = {
				name: 'mcp_stripe_create_invoice',
				description: 'Creates a Stripe invoice',
				params: { amount: { description: 'Amount in cents' } },
			};
			const res = selectFocusedToolset(
				[...allAgentTools, fakeMcp],
				'Please run evolution_supply_chain_sbom and create a Stripe invoice',
				128_000,
				estimateTokens,
			);
			const names = new Set(res.tools.map(t => t.name));
			assert.ok(names.has('mcp_stripe_create_invoice'), 'MCP tool must be preserved');
			assert.ok(names.has('evolution_supply_chain_sbom'), 'explicitly named tool must be preserved');
			assert.ok(res.tools.length <= MAX_FOCUSED_TOOLS_PER_TURN);
		});
	});

	suite('2. Accurate JSON Schema Parameter Type Inference', () => {
		test('infers boolean, number, array, object, and string types accurately', () => {
			assert.strictEqual(inferToolParamSchema('is_regex', 'Optional boolean (default false).').type, 'boolean');
			assert.strictEqual(inferToolParamSchema('dry_run', 'Set true to preview changes.').type, 'boolean');
			assert.strictEqual(inferToolParamSchema('start_line', '1-based line number to start reading.').type, 'number');
			assert.strictEqual(inferToolParamSchema('timeout_ms', 'Optional timeout in milliseconds.').type, 'number');
			const editsSchema = inferToolParamSchema('edits', 'JSON array of { uri, target, replacement }.');
			assert.strictEqual(editsSchema.type, 'array');
			assert.strictEqual(editsSchema.items?.type, 'object');
			assert.strictEqual(editsSchema.items?.properties?.uri?.type, 'string');
			assert.strictEqual(editsSchema.items?.properties?.target?.type, 'string');
			assert.strictEqual(editsSchema.items?.properties?.replacement?.type, 'string');
			assert.deepStrictEqual(editsSchema.items?.required, ['uri', 'target', 'replacement']);
			assert.strictEqual(inferToolParamSchema('headers', 'Optional JSON object of HTTP headers.').type, 'object');
			assert.strictEqual(inferToolParamSchema('uri', 'Absolute or workspace-relative file path.').type, 'string');
		});
	});

	suite('3. Resilient OpenAI-Compatible Streamed Tool Delta Merging & JSON Repair', () => {
		test('merges incremental deltas AND prevents duplication on full-name repeating gateways', () => {
			const incremental = { id: '', name: '', paramsStr: '' };
			mergeStreamedToolDelta(incremental, { id: 'call_1', name: 'write_', arguments: '{"uri":' });
			mergeStreamedToolDelta(incremental, { name: 'file', arguments: '"a.ts"}' });
			assert.strictEqual(incremental.id, 'call_1');
			assert.strictEqual(incremental.name, 'write_file');
			assert.strictEqual(incremental.paramsStr, '{"uri":"a.ts"}');

			// Gateways like NVIDIA NIM / vLLM sometimes repeat full name & id on every chunk
			const repeating = { id: '', name: '', paramsStr: '' };
			mergeStreamedToolDelta(repeating, { id: 'call_abc', name: 'write_file', arguments: '{"uri":"a.ts",' });
			mergeStreamedToolDelta(repeating, { id: 'call_abc', name: 'write_file', arguments: '"new_content":"ok"}' });
			assert.strictEqual(repeating.id, 'call_abc');
			assert.strictEqual(repeating.name, 'write_file');
			assert.strictEqual(repeating.paramsStr, '{"uri":"a.ts","new_content":"ok"}');
		});

		test('parses empty args, double-encoded JSON, fenced JSON, trailing commas, and unescaped newlines', () => {
			assert.deepStrictEqual(parseOrRepairToolArgs(''), { ok: true, params: {} });
			assert.deepStrictEqual(parseOrRepairToolArgs('  '), { ok: true, params: {} });
			assert.deepStrictEqual(parseOrRepairToolArgs(JSON.stringify('{"uri":"src/app.ts"}')), { ok: true, params: { uri: 'src/app.ts' } });
			assert.deepStrictEqual(parseOrRepairToolArgs('```json\n{"uri":"src/app.ts",}\n```'), { ok: true, params: { uri: 'src/app.ts' } });
			const withRawNewline = '{"uri":"a.ts","new_content":"line1\nline2"}';
			const parsedNl = parseOrRepairToolArgs(withRawNewline);
			assert.strictEqual(parsedNl.ok, true);
			if (parsedNl.ok) {
				assert.strictEqual(parsedNl.params.new_content, 'line1\nline2');
			}
		});

		test('finalizeStreamedToolCalls guarantees unique non-empty IDs and surfaces truncated JSON instead of dropping', () => {
			const finalized = finalizeStreamedToolCalls([
				{ id: '', name: 'list_artifacts', paramsStr: '' },
				{ id: '', name: 'read_file', paramsStr: '{"uri":"a.ts"}' },
				{ id: 'dup', name: 'write_file', paramsStr: '{"uri":"b.ts","new_content":"unterminated' },
				{ id: 'dup', name: 'run_command', paramsStr: '{"command":"npm test"}' },
			]);
			assert.strictEqual(finalized.length, 4, 'must NOT silently drop empty-arg or truncated calls');
			const ids = finalized.map(c => c.id);
			assert.ok(ids.every(id => id.length > 0), 'every call must have a non-empty ID');
			assert.strictEqual(new Set(ids).size, 4, 'every call ID must be unique');
			assert.deepStrictEqual(finalized[0].rawParams, {});
			assert.strictEqual(typeof finalized[2].rawParams.__kodia_malformed_json_error__, 'string');
		});
	});

	suite('4. Orphan Tool Message Protection in prepareMessages (OpenAI/Groq/NVIDIA 400 fix)', () => {
		test('synthesizes matching assistant tool_calls when a tool message lacks a preceding assistant turn', () => {
			const prepared = prepareMessages({
				messages: [
					{ role: 'user', content: 'Continue building NOVA' },
					{ role: 'tool', name: 'read_file', id: '', content: 'file contents', rawParams: { uri: 'a.ts' } },
				],
				systemMessage: 'You are Kodia.',
				aiInstructions: '',
				supportsSystemMessage: 'system-role',
				specialToolFormat: 'openai-style',
				supportsAnthropicReasoning: false,
				contextWindow: 128_000,
				reservedOutputTokenSpace: 4_096,
				providerName: 'openAICompatible',
			});
			const msgs = prepared.messages as Array<{ role: string; tool_calls?: Array<{ id: string }>; tool_call_id?: string }>;
			const toolIdx = msgs.findIndex(m => m.role === 'tool');
			assert.ok(toolIdx > 0, 'tool message must exist');
			const prev = msgs[toolIdx - 1];
			assert.strictEqual(prev.role, 'assistant', 'tool message must be immediately preceded by assistant message');
			assert.ok(Array.isArray(prev.tool_calls) && prev.tool_calls.length === 1, 'preceding assistant must carry matching tool_calls');
			assert.ok(msgs[toolIdx].tool_call_id && msgs[toolIdx].tool_call_id!.length > 0, 'tool_call_id must be non-empty');
			assert.strictEqual(prev.tool_calls![0].id, msgs[toolIdx].tool_call_id, 'assistant tool_calls[0].id must match tool_call_id');
		});
	});

	suite('5. Lean Execution-First System Prompt & Param Auto-Repair', () => {
		test('chat_systemMessage is concise (< 12,000 chars) and includes install-first discipline', () => {
			const sys = chat_systemMessage({
				workspaceFolders: ['C:\\projects\\NOVA'],
				chatMode: 'agent',
				mcpTools: [],
				includeXMLToolDefinitions: false,
			});
			assert.ok(sys.length < 12_000, `expected lean system prompt < 12,000 chars, got ${sys.length}`);
			assert.ok(sys.includes('INSTALL DEPENDENCIES FIRST'), 'system prompt must enforce install-first build discipline');
			assert.ok(sys.includes('COMPILE-AS-YOU-GO'), 'system prompt must enforce compile-as-you-go verification');
		});

		test('repairToolParams fixes browser camelCase aliases, view_code_item, and workspace_search_replace', () => {
			const b = repairToolParams('browser_click', { sessionId: 's1', tabId: 't1', timeoutMs: '5000', target: '#btn' }, 'C:\\repo');
			assert.strictEqual(b.repairedParams.session_id, 's1');
			assert.strictEqual(b.repairedParams.tab_id, 't1');
			assert.strictEqual(b.repairedParams.timeout_ms, '5000');

			const v = repairToolParams('view_code_item', { file: 'src/app.ts', symbol: 'App' }, 'C:\\repo');
			assert.strictEqual(v.repairedParams.symbol_name, 'App');
			assert.ok(String(v.repairedParams.uri).includes('src'));

			const w = repairToolParams('workspace_search_replace', { search: 'baseUrl', replace: 'baseURL', glob: 'src/**/*.ts' }, 'C:\\repo');
			assert.strictEqual(w.repairedParams.query, 'baseUrl');
			assert.strictEqual(w.repairedParams.replacement, 'baseURL');
			assert.strictEqual(w.repairedParams.include_glob, 'src/**/*.ts');
		});

		test('completion check recognizes multi_edit_file and workspace_search_replace as file-changing tools', () => {
			assert.ok(FILE_CHANGING_TOOLS.has('multi_edit_file'));
			assert.ok(FILE_CHANGING_TOOLS.has('workspace_search_replace'));
			assert.strictEqual(shouldRequestCompletionCheck({
				chatMode: 'agent',
				alreadyRequested: false,
				messagesThisTurn: [{ role: 'tool', type: 'success', name: 'multi_edit_file' }],
			}), true);
		});
	});

	suite('6. Cloudflare Gemma-4 & Hermes Fallback Text Tool-Call Recovery', () => {
		test('recovers leaked Gemma-4 <|tool_call>call:...<tool_call|> from reasoning_content and strips raw tokens', () => {
			const leakedReasoning = 'Checking card component next.\n<|tool_call>call:read_file{uri:<|"|>client/src/components/ui/card.tsx<|"|>}<tool_call|>';
			const allowed = new Set(['read_file', 'edit_file', 'multi_edit_file']);
			const res = extractFallbackTextToolCalls('', leakedReasoning, allowed);
			assert.strictEqual(res.toolCalls.length, 1);
			assert.strictEqual(res.toolCalls[0].name, 'read_file');
			assert.deepStrictEqual(res.toolCalls[0].rawParams, { uri: 'client/src/components/ui/card.tsx' });
			assert.strictEqual(res.cleanedReasoning, 'Checking card component next.');
		});

		test('recovers multi-param Gemma-4 edit_file calls with braces, numbers, booleans, and namespace prefix', () => {
			const leakedText = '<|tool_call>call:default_api:edit_file{uri:<|"|>src/btn.tsx<|"|>,target:<|"|>const a = () => { return "$1"; }<|"|>,replacement:<|"|>const a = () => { return "$2"; }<|"|>,start_line:10,dry_run:false}<tool_call|>';
			const res = extractFallbackTextToolCalls(leakedText, '', new Set(['edit_file']));
			assert.strictEqual(res.toolCalls.length, 1);
			assert.strictEqual(res.toolCalls[0].name, 'edit_file');
			assert.deepStrictEqual(res.toolCalls[0].rawParams, {
				uri: 'src/btn.tsx',
				target: 'const a = () => { return "$1"; }',
				replacement: 'const a = () => { return "$2"; }',
				start_line: 10,
				dry_run: false,
			});
			assert.strictEqual(res.cleanedText, '');
		});

		test('recovers Hermes/Qwen <tool_call>{...}</tool_call> and ignores unknown tools', () => {
			const text = 'Let me update the file.\n<tool_call>{"name":"edit_file","arguments":{"uri":"a.ts","target":"old","replacement":"new"}}</tool_call>\n<tool_call>{"name":"nonexistent_tool","arguments":{}}</tool_call>';
			const res = extractFallbackTextToolCalls(text, '', new Set(['edit_file']));
			assert.strictEqual(res.toolCalls.length, 1);
			assert.strictEqual(res.toolCalls[0].name, 'edit_file');
			assert.deepStrictEqual(res.toolCalls[0].rawParams, { uri: 'a.ts', target: 'old', replacement: 'new' });
			assert.strictEqual(res.cleanedText, 'Let me update the file.');
		});

		test('recovers Mistral raw JSON array [{"name":...,"arguments":{...}}] tool calls and repairs SEARCH/REPLACE markers', () => {
			const mistralText = '[{"name": "edit_file", "arguments": {"uri": "button.tsx", "search_replace_blocks": "<<<<<<< SEARCH\\nconst a = 1;\\n=======\\nconst a = 2;\\n>>>>>>> REPLACE"}}]';
			const res = extractFallbackTextToolCalls(mistralText, '', new Set(['edit_file']));
			assert.strictEqual(res.toolCalls.length, 1);
			assert.strictEqual(res.toolCalls[0].name, 'edit_file');
			assert.strictEqual(res.cleanedText, '');

			const repaired = repairToolParams('edit_file', res.toolCalls[0].rawParams, 'C:\\repo');
			assert.strictEqual(repaired.repairedParams.search_replace_blocks, '<<<<<<< ORIGINAL\nconst a = 1;\n=======\nconst a = 2;\n>>>>>>> UPDATED');

			const fromTarget = repairToolParams('edit_file', { uri: 'button.tsx', target: 'old', replacement: 'new' }, 'C:\\repo');
			assert.strictEqual(fromTarget.repairedParams.search_replace_blocks, '<<<<<<< ORIGINAL\nold\n=======\nnew\n>>>>>>> UPDATED');
		});
	});

	suite('7. Mandatory Live Web Search Grounding (Always-Latest Code Enforcement)', () => {
		test('buildMandatoryLiveWebQueries generates year-stamped queries for technical/AI requests and skips trivial greetings', () => {
			const trivial = buildMandatoryLiveWebQueries('thanks!', 2026);
			assert.strictEqual(trivial.shouldAutoSearch, false);
			assert.deepStrictEqual(trivial.queries, []);

			const plan = buildMandatoryLiveWebQueries('Build a React + Vite + Tailwind CSS app connected to Groq and NVIDIA NIM', 2026);
			assert.strictEqual(plan.shouldAutoSearch, true);
			assert.strictEqual(plan.queries.length, 2);
			assert.ok(plan.queries.every(q => q.includes('2026')), 'every query must include current year');
			assert.ok(plan.queries[0].includes('Groq') || plan.queries[0].includes('NVIDIA'));
			assert.ok(plan.queries[1].includes('Tailwind CSS') && plan.queries[1].includes('React'));
		});

		test('extractMidTurnWebVerificationQuery catches manifest/config/install calls when agent skipped web_search', () => {
			const q1 = extractMidTurnWebVerificationQuery('write_file', {
				uri: 'client/package.json',
				new_content: '{"dependencies":{"react":"^18.0.0","tailwindcss":"^4.0.0","vite":"^6.0.0"}}',
			}, 2026);
			assert.ok(q1 && q1.includes('Tailwind CSS') && q1.includes('2026'));

			const q2 = extractMidTurnWebVerificationQuery('run_command', {
				command: 'npm install openai tailwindcss @tailwindcss/vite',
			}, 2026);
			assert.ok(q2 && q2.includes('openai') && q2.includes('tailwindcss') && q2.includes('2026'));
		});

		test('formatAutoWebSearchResultsForLLM formats dated live grounding block & core toolset always keeps web_search/fetch_url', () => {
			const block = formatAutoWebSearchResultsForLLM([{
				query: 'Tailwind CSS latest 2026',
				results: [{ title: 'Tailwind CSS v4 Docs', url: 'https://tailwindcss.com/docs', snippet: 'Use @import "tailwindcss";', publishedDate: '2026-05-01' }],
			}], '2026-11-25');
			assert.ok(block.includes('FETCHED 2026-11-25'));
			assert.ok(block.includes('Tailwind CSS v4 Docs'));
			assert.ok(block.includes('https://tailwindcss.com/docs'));

			const allAgentTools = availableTools('agent', []) ?? [];
			const focused = selectFocusedToolset(allAgentTools, 'Fix button styles', 32_000, estimateTokens);
			const names = new Set(focused.tools.map(t => t.name));
			assert.ok(names.has('web_search'), 'web_search must always be in core toolset');
			assert.ok(names.has('fetch_url'), 'fetch_url must always be in core toolset');
			assert.ok(names.has('lei_check_dependency'), 'lei_check_dependency must always be in core toolset');

			const sys = chat_systemMessage({ workspaceFolders: ['C:\\repo'], chatMode: 'agent', mcpTools: [], includeXMLToolDefinitions: false });
			assert.ok(sys.includes('MANDATORY LIVE WEB SEARCH FIRST'));
		});
	});
});
