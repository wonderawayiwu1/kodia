/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import type { RawToolCallObj, RawToolParamsObj } from './sendLLMMessageTypes.js';

export type InferredJsonSchemaType = 'string' | 'boolean' | 'number' | 'integer' | 'array' | 'object';

export type InferredJsonSchema = {
	type: InferredJsonSchemaType;
	description: string;
	items?: {
		type: string;
		properties?: Record<string, { type: string }>;
		required?: string[];
		additionalProperties?: boolean;
	};
	additionalProperties?: boolean;
};

/**
 * Infers an accurate JSON Schema primitive/container type for a tool parameter so strict
 * OpenAI/Groq/NVIDIA/Cloudflare/Gemini function-calling validators never reject valid boolean/number/array
 * arguments with HTTP 400 (`expected string, got boolean`) or emit strings where objects are required.
 */
export function inferToolParamSchema(
	paramName: string,
	description: string,
): InferredJsonSchema {
	const name = paramName.toLowerCase();
	const desc = (description || '').toLowerCase();

	// Explicit array-of-objects parameters (critical: never advertise these as items: { type: 'string' }!)
	if (name === 'edits') {
		return {
			type: 'array',
			description,
			items: {
				type: 'object',
				properties: {
					uri: { type: 'string' },
					target: { type: 'string' },
					replacement: { type: 'string' },
				},
				required: ['uri', 'target', 'replacement'],
				additionalProperties: true,
			},
		};
	}
	if (name === 'steps') {
		return {
			type: 'array',
			description,
			items: {
				type: 'object',
				properties: {
					title: { type: 'string' },
					status: { type: 'string' },
				},
				required: ['title', 'status'],
				additionalProperties: true,
			},
		};
	}
	if (/^(?:questions|stages|todos|cookies|cells|operations|viewports|tasks)$/.test(name) || /\barray of\s*\{|\[\s*\{/.test(desc)) {
		return { type: 'array', description, items: { type: 'object', additionalProperties: true } };
	}
	if (/^(?:cell_indices)$/.test(name)) {
		return { type: 'array', description, items: { type: 'number' } };
	}

	// Explicit string array parameters
	if (
		/\bjson array\b|\barray of\b/.test(desc) ||
		/^(?:paths|file_paths|session_ids|allowed_tools|test_files|test_names|changed_files|files|filters|globs|dependencies)$/.test(name)
	) {
		return { type: 'array', description, items: { type: 'string' } };
	}

	// Explicit object / record parameters
	if (
		/\bjson object\b|\bkey-value\b|\bmap of\b|\brecord\b|\b\{\s*width\s*,\s*height\s*\}\b/.test(desc) ||
		/^(?:viewport|headers|configuration|hyperparameters|metrics|trigger_input|style_changes|multipart_body|oauth2_tokens|cookie)$/.test(name)
	) {
		return { type: 'object', description, additionalProperties: true };
	}

	// Explicit boolean parameters
	if (
		/\b(?:optional\s+)?boolean\b|\btrue to\b|\bset true\b|\bdefault (?:true|false)\b|\btrue\/false\b/.test(desc) ||
		/^(?:is_|has_|can_|use_|include_|enable_|allow_|auto_|always_|dry_run|headless|staged|amend|force|checked|annotated|clear_first|press_enter|case_sensitive|full_page|summary_only|open_in_editor|execute|restart_kernel|run_all|persist|request_feedback|multi_tenant|new_branch|no_debug|restart|suspend|enabled|stop_on_failure|only_problems|approve_human_gates|stop_at_breakpoints|approval_granted|run_compiler)$/.test(name)
	) {
		return { type: 'boolean', description };
	}

	// Explicit integer / numeric parameters
	if (
		/\binteger\b|\b1-based\b|\bline number\b|\bmilliseconds\b|\bin pixels\b|\bin seconds\b|\bmax(?:imum)?\s+(?:number|events|nodes|results|files|lines|cycles|iterations)\b/.test(desc) ||
		/^(?:start_line_number|end_line_number|page_number|line|line_number|column|width|height|x|y|click_count|delay_ms|amount|timeout_ms|max_nodes|max_results|max_files|max_events|max_count|max_cycles|max_iterations|duration_seconds|height_px|limit|offset|port|attempts|status_min|cell_index|start_cell|end_cell|from_cell_index|select_match_index|thread_id|frame_id|start_frame|levels|variables_reference|start|count|interval_hours)$/.test(name)
	) {
		return { type: 'number', description };
	}

	return { type: 'string', description };
}

export interface StreamedToolDeltaState {
	name: string;
	id: string;
	paramsStr: string;
}

/**
 * Safely merges a streamed OpenAI-compatible tool-call delta chunk.
 * Handles BOTH delta-only servers (OpenAI, OpenRouter) AND servers that repeat the
 * full function name or call ID on every chunk (some Groq/NVIDIA/vLLM/Ollama gateways).
 */
export function mergeStreamedToolDelta(
	target: StreamedToolDeltaState,
	delta: { id?: string | null; name?: string | null; arguments?: string | null },
): void {
	if (delta.id) {
		if (!target.id) {
			target.id = delta.id;
		} else if (delta.id !== target.id && !target.id.endsWith(delta.id) && !delta.id.startsWith(target.id)) {
			target.id += delta.id;
		} else if (delta.id.startsWith(target.id)) {
			target.id = delta.id;
		}
	}
	if (delta.name) {
		if (!target.name) {
			target.name = delta.name;
		} else if (delta.name === target.name || target.name.endsWith(delta.name)) {
			// Repeated full tool name on subsequent chunk — do NOT duplicate!
		} else if (delta.name.startsWith(target.name)) {
			target.name = delta.name;
		} else {
			target.name += delta.name;
		}
	}
	if (delta.arguments) {
		target.paramsStr += delta.arguments;
	}
}

/**
 * Deterministically parses and repairs streamed JSON tool arguments from OpenAI/Groq/NVIDIA/local LLMs.
 * - Empty arguments `""` -> `{}` (never drops zero-arg tools!)
 * - Unwraps double-encoded JSON strings (`"{\"a\":1}"`)
 * - Strips markdown code fences and trailing commas
 * - Attempts safe extraction of the outermost `{ ... }` JSON object
 */
export function parseOrRepairToolArgs(rawArgs: string): { ok: true; params: RawToolParamsObj } | { ok: false; error: string } {
	const trimmed = (rawArgs ?? '').trim();
	if (!trimmed) {
		return { ok: true, params: {} };
	}

	const tryParseObj = (candidate: string): RawToolParamsObj | null => {
		try {
			let parsed: unknown = JSON.parse(candidate);
			if (typeof parsed === 'string') {
				try { parsed = JSON.parse(parsed); } catch { }
			}
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				return parsed as RawToolParamsObj;
			}
		} catch { }
		return null;
	};

	// 1. Direct fast path
	const direct = tryParseObj(trimmed);
	if (direct) return { ok: true, params: direct };

	// 2. Strip markdown fences ```json ... ```
	let cleaned = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
	const unfenced = tryParseObj(cleaned);
	if (unfenced) return { ok: true, params: unfenced };

	// 3. Extract outermost {...} and strip trailing commas before } or ]
	const firstBrace = cleaned.indexOf('{');
	const lastBrace = cleaned.lastIndexOf('}');
	if (firstBrace !== -1 && lastBrace > firstBrace) {
		const slice = cleaned.slice(firstBrace, lastBrace + 1).replace(/,\s*([}\]])/g, '$1');
		const extracted = tryParseObj(slice);
		if (extracted) return { ok: true, params: extracted };
	}

	// 4. Replace raw unescaped newlines/tabs inside JSON string literals
	const escapedControls = cleaned.replace(/,\s*([}\]])/g, '$1').replace(/[\u0000-\u001F]/g, ch => {
		if (ch === '\n') return '\\n';
		if (ch === '\r') return '\\r';
		if (ch === '\t') return '\\t';
		return '';
	});
	const repairedControls = tryParseObj(escapedControls);
	if (repairedControls) return { ok: true, params: repairedControls };

	return {
		ok: false,
		error: `Malformed or truncated JSON tool arguments (${trimmed.length} chars). If writing a large file, split into smaller edits or re-emit valid JSON.`,
	};
}

/**
 * Converts streamed OpenAI-compatible tool calls into RawToolCallObj[], ensuring:
 * - Every call has a non-empty unique `id` (prevents HTTP 400 on the next turn!)
 * - Zero-arg tools with `""` arguments are preserved as `{}`
 * - Malformed/truncated calls are surfaced as recoverable `__kodia_malformed_json_error__`
 *   instead of being silently dropped and prematurely ending the agent turn!
 */
export function finalizeStreamedToolCalls(calls: StreamedToolDeltaState[]): RawToolCallObj[] {
	const out: RawToolCallObj[] = [];
	const seenIds = new Set<string>();
	for (let i = 0; i < calls.length; i++) {
		const c = calls[i];
		if (!c || !c.name.trim()) continue;
		const cleanName = c.name.trim();
		let id = (c.id || '').trim();
		if (!id || seenIds.has(id)) {
			id = `call_kodia_${Date.now().toString(36)}_${i}`;
		}
		seenIds.add(id);

		const parsed = parseOrRepairToolArgs(c.paramsStr);
		if (parsed.ok) {
			out.push({
				id,
				name: cleanName,
				rawParams: parsed.params,
				doneParams: Object.keys(parsed.params),
				isDone: true,
			});
		} else {
			out.push({
				id,
				name: cleanName,
				rawParams: { __kodia_malformed_json_error__: parsed.error },
				doneParams: ['__kodia_malformed_json_error__'],
				isDone: true,
			});
		}
	}
	return out;
}

/**
 * Converts Gemma-4's native token-delimited argument syntax
 *   `{uri:<|"|>client/src/App.tsx<|"|>,start_line:1,is_regex:false}`
 * into standard JSON and parses it into a RawToolParamsObj.
 */
function parseGemma4ArgObject(rawObj: string): RawToolParamsObj | null {
	const trimmed = rawObj.trim();
	if (!trimmed || trimmed === '{}') return {};
	// Fast path if it's already valid JSON (e.g. standard double-quoted arguments)
	if (!trimmed.includes('<|"|>')) {
		const direct = parseOrRepairToolArgs(trimmed);
		if (direct.ok) return direct.params;
	}
	// 1. Replace Gemma-4 <|"|>...<|"|> string literals with properly JSON-escaped strings
	const placeholders: string[] = [];
	const withPlaceholders = trimmed.replace(/<\|"\|>([\s\S]*?)<\|"\|>/g, (_m, inner: string) => {
		const idx = placeholders.length;
		placeholders.push(JSON.stringify(inner));
		return `"__KODIA_G4_STR_${idx}__"`;
	});
	// 2. Quote bare object keys (e.g. {uri:"...",start_line:1} -> {"uri":"...","start_line":1})
	const quotedKeys = withPlaceholders.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3');
	// 3. Restore JSON-escaped string literals
	const restored = quotedKeys.replace(/"__KODIA_G4_STR_(\d+)__"/g, (_m, idxStr: string) => placeholders[Number(idxStr)] ?? '""');
	const parsed = parseOrRepairToolArgs(restored);
	return parsed.ok ? parsed.params : null;
}

/**
 * Recovers raw model-native tool calls that leaked into `content` or `reasoning_content`
 * on gateways whose server-side tool parser missed them (e.g. Cloudflare Workers AI Gemma-4
 * `<|tool_call>call:read_file{uri:<|"|>a.tsx<|"|>}<tool_call|>` or Qwen/Hermes `<tool_call>{...}</tool_call>`).
 */
export function extractFallbackTextToolCalls(
	fullText: string,
	fullReasoning = '',
	allowedToolNames?: ReadonlySet<string>,
): { toolCalls: RawToolCallObj[]; cleanedText: string; cleanedReasoning: string } {
	const found: RawToolCallObj[] = [];
	let callCounter = 0;

	const accept = (name: string, params: RawToolParamsObj) => {
		const cleanName = name.trim();
		if (!cleanName) return;
		if (allowedToolNames && allowedToolNames.size > 0 && !allowedToolNames.has(cleanName)) return;
		found.push({
			id: `call_kodia_fb_${Date.now().toString(36)}_${callCounter++}`,
			name: cleanName,
			rawParams: params,
			doneParams: Object.keys(params),
			isDone: true,
		});
	};

	const extractFrom = (source: string): string => {
		if (!source) return source;
		let cleaned = source;

		// Pattern 1: Gemma-4 native `<|tool_call>call:TOOL_NAME{...}<tool_call|>` (with optional namespace prefix like default_api:)
		const gemma4Re = /<\|tool_call>call:(?:[A-Za-z_][A-Za-z0-9_]*:)?([A-Za-z_][A-Za-z0-9_-]*)\s*(\{[\s\S]*?\})\s*<\|?tool_call\|>/g;
		cleaned = cleaned.replace(gemma4Re, (fullMatch, name: string, argsObj: string) => {
			const params = parseGemma4ArgObject(argsObj);
			if (params) {
				accept(name, params);
				return '';
			}
			return fullMatch;
		});

		// Pattern 2: Qwen / Hermes / vLLM `<tool_call>{"name":"...","arguments":{...}}</tool_call>`
		const hermesRe = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
		cleaned = cleaned.replace(hermesRe, (fullMatch, inner: string) => {
			const parsed = parseOrRepairToolArgs(inner);
			if (parsed.ok && typeof parsed.params.name === 'string') {
				const rawArgs = parsed.params.arguments ?? parsed.params.parameters ?? parsed.params.params ?? {};
				let argsObj: RawToolParamsObj = {};
				if (typeof rawArgs === 'string') {
					const rep = parseOrRepairToolArgs(rawArgs);
					if (rep.ok) argsObj = rep.params;
				} else if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
					argsObj = rawArgs as RawToolParamsObj;
				}
				accept(parsed.params.name, argsObj);
				return '';
			}
			return fullMatch;
		});

		// Pattern 3: Mistral / Llama raw JSON tool-call array `[TOOL_CALLS][{"name":"...","arguments":{...}}]`
		// or bare `[{"name":"edit_file","arguments":{...}}]` leaked into content when server parser misses it
		if (found.length === 0) {
			const mistralRe = /(?:\[TOOL_CALLS\]\s*)?(?:```(?:json)?\s*)?(\[\s*\{\s*"name"\s*:[\s\S]*?\}\s*\])(?:\s*```)?/g;
			cleaned = cleaned.replace(mistralRe, (fullMatch, jsonArrayStr: string) => {
				try {
					const arr = JSON.parse(jsonArrayStr.replace(/,\s*([}\]])/g, '$1'));
					if (Array.isArray(arr) && arr.length > 0 && arr.every(item => item && typeof item === 'object' && typeof (item as Record<string, unknown>).name === 'string')) {
						const beforeCount = found.length;
						for (const item of arr as Array<Record<string, unknown>>) {
							const rawArgs = item.arguments ?? item.parameters ?? item.params ?? {};
							let argsObj: RawToolParamsObj = {};
							if (typeof rawArgs === 'string') {
								const rep = parseOrRepairToolArgs(rawArgs);
								if (rep.ok) argsObj = rep.params;
							} else if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
								argsObj = rawArgs as RawToolParamsObj;
							}
							accept(String(item.name), argsObj);
						}
						if (found.length > beforeCount) {
							return '';
						}
					}
				} catch { }
				return fullMatch;
			});
		}

		return cleaned.trim();
	};

	// Prefer tool calls emitted in content first; if none found, recover tool calls that leaked into reasoning_content
	const cleanedText = extractFrom(fullText);
	let cleanedReasoning = fullReasoning;
	if (found.length === 0 && fullReasoning) {
		cleanedReasoning = extractFrom(fullReasoning);
	}

	return { toolCalls: found, cleanedText, cleanedReasoning };
}
