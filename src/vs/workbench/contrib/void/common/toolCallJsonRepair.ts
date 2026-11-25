/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import type { RawToolCallObj, RawToolParamsObj } from './sendLLMMessageTypes.js';

export type InferredJsonSchemaType = 'string' | 'boolean' | 'number' | 'integer' | 'array' | 'object';

/**
 * Infers an accurate JSON Schema primitive/container type for a tool parameter so strict
 * OpenAI/Groq/NVIDIA/Gemini function-calling validators never reject valid boolean/number/array
 * arguments with HTTP 400 (`expected string, got boolean`).
 */
export function inferToolParamSchema(
	paramName: string,
	description: string,
): { type: InferredJsonSchemaType; description: string; items?: { type: string }; additionalProperties?: boolean } {
	const name = paramName.toLowerCase();
	const desc = (description || '').toLowerCase();

	// Explicit array parameters
	if (
		/\bjson array\b|\barray of\b/.test(desc) ||
		/^(?:edits|steps|questions|stages|paths|todos|file_paths|session_ids|allowed_tools|test_files|test_names|changed_files|files|filters|globs|cookies|cells|operations|cell_indices|viewports|tasks|dependencies)$/.test(name)
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
