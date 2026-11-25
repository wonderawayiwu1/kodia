/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * Small-context models: Kodia offers ~130 tools, ~13k tokens of definitions (as XML in the system prompt, or as
 * native tool schemas — the same order either way). On a 16k-token model that is most of the window before the
 * conversation starts, and the prompt gets trimmed. When the full set takes more than TOOLS_SHARE_OF_CONTEXT of the
 * window, a prioritized subset that fits is offered instead, and the model is told which tool groups were left out.
 */

import { InternalToolInfo } from './prompt/prompts.js';

export const TOOLS_SHARE_OF_CONTEXT = 0.5;
/**
 * Maximum number of tools sent to an LLM in a single turn.
 * OpenAI hard-caps at 128 tools; Groq, NVIDIA NIM, Gemini, and OpenRouter achieve peak
 * function-calling accuracy and lowest latency when kept <= 56 focused tools instead of 360+.
 */
export const MAX_FOCUSED_TOOLS_PER_TURN = 56;

// Core software-building toolset: every essential capability to plan, read, write, edit,
// search, run commands/servers, query SQLite, test, inspect live browser, research latest models,
// review diffs, and delegate to subagents — ~46 razor-sharp tools!
const CORE_FOCUSED_TOOLS: readonly string[] = [
	// Files, editing & navigation
	'read_file', 'write_file', 'edit_file', 'multi_edit_file', 'workspace_search_replace',
	'create_file_or_folder', 'delete_file_or_folder', 'move_or_rename_file',
	'ls_dir', 'get_dir_tree', 'search_for_files', 'search_pathnames_only', 'search_in_file',
	'view_file_outline', 'view_code_item', 'read_lint_errors', 'workspace_diagnostics',
	// Commands, dev servers, DB & masked .env
	'run_command', 'dev_server_start', 'dev_server_stop', 'dev_server_status',
	'open_persistent_terminal', 'run_persistent_command', 'kill_persistent_terminal',
	'db_inspect', 'db_query', 'manage_env_file',
	// Testing, Git & BugBot review
	'test_discover', 'test_run', 'test_rerun_failed', 'git_status', 'git_diff', 'review_code_changes',
	// Live web/AI research & API / SSE testing
	'web_search', 'fetch_url', 'lei_discover_models', 'api_request', 'api_test_sse_stream',
	// Visual Browser QA & Embedded Live Preview
	'browser_launch', 'browser_new_tab', 'browser_navigate', 'browser_inspect_page',
	'browser_click_element', 'browser_fill_element', 'browser_screenshot', 'browser_console',
	'browser_close', 'open_live_preview',
	// Antigravity UX & multi-agent delegation
	'update_focus', 'update_steps', 'ask_user_question', 'create_artifact', 'subagent',
];

// Context-activated specialist tool packs: added ONLY when the user's request actually needs them
const DOMAIN_TOOL_PACKS: ReadonlyArray<{ pattern: RegExp; tools: readonly string[] }> = [
	{
		pattern: /\b(ui|ux|design|css|tailwind|dashboard|frontend|website|landing|saas|component|layout|responsive|accessibility|wcag|visual|screenshot)\b/i,
		tools: ['inspect_visual_quality', 'audit_accessibility', 'discover_visual_assets', 'download_visual_assets', 'browser_accessibility_snapshot', 'browser_set_viewport'],
	},
	{
		pattern: /\b(browser|click|hover|scroll|drag|playwright|e2e|selenium|puppeteer|aria|dialog|cookie|localstorage|upload)\b/i,
		tools: ['browser_hover', 'browser_type_text', 'browser_press_key', 'browser_scroll', 'browser_evaluate', 'browser_wait_for_text', 'browser_network_log', 'browser_storage', 'browser_upload_file'],
	},
	{
		pattern: /\b(commit|push|pull|branch|merge|rebase|stash|cherry|worktree|pr\b|pull\s+request|git\s+log)\b/i,
		tools: ['git_log', 'git_branch_list', 'git_branch_create', 'git_branch_switch', 'git_stage', 'git_unstage', 'git_commit', 'git_commit_context', 'git_pr_prepare', 'git_worktree_add'],
	},
	{
		pattern: /\b(android|ios|mobile|flutter|react\s+native|expo|kotlin|swift|apk|emulator|simulator)\b/i,
		tools: ['mobile_open_studio', 'mobile_probe_environment', 'mobile_inspect_project', 'mobile_design_architecture', 'mobile_scaffold_project', 'mobile_build_and_test', 'mobile_device_action'],
	},
	{
		pattern: /\b(n8n|automation\s+studio|uaep|webhook\s+workflow|portable\s+automation|embedded\s+automation)\b/i,
		tools: ['uaep_open_studio', 'uaep_generate_workflow', 'uaep_modify_workflow', 'uaep_compile_workflow', 'uaep_execute_workflow', 'uaep_save_credential', 'uaep_export_portable_package'],
	},
	{
		pattern: /\b(\.ipynb|jupyter|notebook|kernel|cell)\b/i,
		tools: ['read_notebook', 'write_notebook', 'edit_notebook', 'execute_notebook', 'execute_notebook_cell', 'validate_notebook', 'list_notebook_kernels'],
	},
	{
		pattern: /\b(breakpoint|debugger|step\s+over|step\s+into|stack\s+trace|dap)\b/i,
		tools: ['debug_start_session', 'debug_set_breakpoint', 'debug_continue', 'debug_step_over', 'debug_get_stack_trace', 'debug_get_variables', 'debug_evaluate_expression', 'debug_stop_session'],
	},
	{
		pattern: /\b(api\s+studio|load\s+test|websocket|openapi|swagger|postman)\b/i,
		tools: ['api_open_studio', 'api_discover_project', 'api_send_request', 'api_run_test_suite', 'api_run_load_test', 'api_security_audit'],
	},
	{
		pattern: /\b(schedule|cron|timer|every\s+\d+|recurring|parallel\s+workflow|teamwork|custom\s+subagent|notepad|cursor\s+rule|widget|diagram)\b/i,
		tools: ['schedule_task', 'manage_scheduled_tasks', 'define_subagent', 'manage_subagents', 'run_parallel_workflow', 'manage_notepads', 'manage_rules', 'render_interactive_widget'],
	},
	{
		pattern: /\b(ai\s+model|llm|rag|nvidia|groq|openrouter|gemini|openai|anthropic|ollama|embedding|fine-?tun|vector)\b/i,
		tools: ['lei_research_technology', 'lei_verify_model', 'lei_check_dependency', 'lei_diagnose_error'],
	},
	{
		pattern: /\b(docker|container|compose|redis|postgres|mysql|sqlite|migration)\b/i,
		tools: ['docker_status', 'docker_logs', 'dep_install', 'db_migrate', 'port_check'],
	},
];

/**
 * Selects a focused, high-signal toolset (<= MAX_FOCUSED_TOOLS_PER_TURN) tailored to the user's
 * current request so LLMs NEVER drown in 360+ tool schemas (eliminates OpenAI >128 errors,
 * Groq/NVIDIA tool-calling collapse, and ~45k tokens/turn of wasted schema overhead).
 */
export function selectFocusedToolset(
	allTools: InternalToolInfo[],
	userText: string,
	contextWindow: number,
	countTokens: (s: string) => number,
	maxTools: number = MAX_FOCUSED_TOOLS_PER_TURN,
): ToolBudgetResult {
	const byName = new Map(allTools.map(t => [t.name, t]));
	const selectedNames = new Set<string>();

	// 1. Always include MCP tools (explicitly installed by the user)
	for (const t of allTools) {
		if (t.name.includes('__') || !TOOL_PRIORITY.includes(t.name) && t.name.startsWith('mcp_')) {
			selectedNames.add(t.name);
		}
	}

	// 2. Include any tool explicitly mentioned by exact name in the user prompt
	if (userText) {
		for (const t of allTools) {
			if (t.name.length >= 6 && userText.includes(t.name)) {
				selectedNames.add(t.name);
			}
		}
	}

	// 3. Add core software-engineering tools first
	for (const name of CORE_FOCUSED_TOOLS) {
		if (byName.has(name)) selectedNames.add(name);
	}

	// 4. Add relevant domain packs matched by user intent (staying within maxTools)
	if (userText) {
		for (const pack of DOMAIN_TOOL_PACKS) {
			if (!pack.pattern.test(userText)) continue;
			for (const name of pack.tools) {
				if (selectedNames.size >= maxTools) break;
				if (byName.has(name)) selectedNames.add(name);
			}
		}
	}

	// Trim to maxTools if needed (preserving explicit mentions & core order)
	const orderedSelected: InternalToolInfo[] = [];
	for (const t of allTools) {
		if (selectedNames.has(t.name)) orderedSelected.push(t);
	}
	const capped = orderedSelected.length > maxTools ? orderedSelected.slice(0, maxTools) : orderedSelected;

	// Finally enforce token budget for small-context models (e.g. 8k-32k local models)
	const tokenBudgeted = toolsWithinBudget(capped, contextWindow, countTokens);
	const finalTools = tokenBudgeted ? tokenBudgeted.tools : capped;
	const finalSet = new Set(finalTools.map(t => t.name));
	const omitted = allTools.filter(t => !finalSet.has(t.name)).map(t => t.name);
	const usedTokens = finalTools.reduce((sum, t) => sum + toolDefinitionTokens(t, countTokens), 0);
	const fullTokens = allTools.reduce((sum, t) => sum + toolDefinitionTokens(t, countTokens), 0);
	return { tools: finalTools, omitted, usedTokens, fullTokens };
}

// What a coding agent needs most, most important first. Tools not listed come after, in their usual order.
const TOOL_PRIORITY: readonly string[] = [
	// read, find, change files
	'read_file', 'edit_file', 'multi_edit_file', 'workspace_search_replace', 'write_file', 'create_file_or_folder', 'ls_dir', 'search_for_files', 'search_pathnames_only', 'search_in_file',
	'view_file_outline', 'view_code_item', 'code_semantic_search', 'code_keyword_search', 'rewrite_file', 'delete_file_or_folder', 'get_dir_tree', 'read_lint_errors',
	// run things, SSE, live preview & masked .env
	'run_command', 'open_persistent_terminal', 'run_persistent_command', 'kill_persistent_terminal', 'api_test_sse_stream', 'open_live_preview', 'manage_env_file',
	// understand code & automated review
	'go_to_definition', 'find_references', 'search_symbols', 'review_code_changes',
	// plan, live progress, interactive clarification, artifacts, notepads, rules, widgets & verification
	'update_focus', 'update_steps', 'ask_user_question', 'create_artifact', 'update_artifact', 'render_interactive_widget', 'manage_notepads', 'manage_rules', 'todo', 'write_project_memory', 'test_discover', 'test_run', 'test_rerun_failed',
	// git basics
	'git_status', 'git_diff', 'git_log', 'git_branch_create', 'git_branch_switch', 'git_stage', 'git_commit', 'git_continue', 'git_abort',
	// delegate, workflows, scheduler, look things up & live engineering research (LEI)
	'subagent', 'define_subagent', 'manage_subagents', 'run_parallel_workflow', 'schedule_task', 'manage_scheduled_tasks', 'fetch_url', 'web_search',
	'lei_discover_models', 'lei_research_technology', 'lei_verify_model', 'lei_check_dependency', 'lei_diagnose_error',
	// UI/UX Design Intelligence Engine (never drop design system & visual QA tools)
	'generate_design_brief', 'generate_design_tokens', 'generate_page_architecture', 'inspect_existing_design_system',
	'discover_visual_assets', 'download_visual_assets', 'inspect_visual_quality', 'critique_interface_design', 'audit_accessibility',
	// Antigravity+ browser automation engine
	'browser_launch', 'browser_new_tab', 'browser_navigate', 'browser_inspect_page', 'browser_accessibility_snapshot', 'browser_screenshot',
	'browser_click_element', 'browser_click_at', 'browser_hover', 'browser_fill_element', 'browser_type_text', 'browser_press_key', 'browser_scroll',
	'browser_evaluate', 'browser_wait_for_text', 'browser_wait_for_network_idle', 'browser_network_log', 'browser_console', 'browser_reload', 'browser_close',
];

export type ToolBudgetResult = { tools: InternalToolInfo[]; omitted: string[]; usedTokens: number; fullTokens: number };

export function toolDefinitionTokens(tool: InternalToolInfo, countTokens: (s: string) => number): number {
	return countTokens(JSON.stringify({ name: tool.name, description: tool.description, params: tool.params }));
}

/**
 * The tools to offer a model with this context window: undefined when the full set fits (nothing changes), else a
 * prioritized subset within TOOLS_SHARE_OF_CONTEXT of the window and the names of the tools left out.
 */
export function toolsWithinBudget(tools: InternalToolInfo[], contextWindow: number, countTokens: (s: string) => number): ToolBudgetResult | undefined {
	const cost = new Map(tools.map(t => [t.name, toolDefinitionTokens(t, countTokens)]));
	const fullTokens = [...cost.values()].reduce((a, b) => a + b, 0);
	const budget = Math.floor(contextWindow * TOOLS_SHARE_OF_CONTEXT);
	if (fullTokens <= budget) return undefined;

	const rank = (name: string) => { const i = TOOL_PRIORITY.indexOf(name); return i === -1 ? TOOL_PRIORITY.length : i; };
	const ordered = tools.map((t, i) => ({ t, i })).sort((a, b) => rank(a.t.name) - rank(b.t.name) || a.i - b.i).map(x => x.t);
	const kept: InternalToolInfo[] = [];
	const omitted: string[] = [];
	let used = 0;
	for (const t of ordered) {
		const c = cost.get(t.name)!;
		if (used + c <= budget) { kept.push(t); used += c; }
		else omitted.push(t.name);
	}
	// keep the usual order in what is offered
	const order = new Map(tools.map((t, i) => [t.name, i]));
	kept.sort((a, b) => order.get(a.name)! - order.get(b.name)!);
	return { tools: kept, omitted, usedTokens: used, fullTokens };
}

/** "browser_* (12), debug_* (20), ..." — what the model is told it does not have, compactly */
export function describeOmittedTools(omitted: string[]): string {
	const groups = new Map<string, number>();
	for (const name of omitted) {
		const g = name.includes('_') ? `${name.split('_')[0]}_*` : name;
		groups.set(g, (groups.get(g) ?? 0) + 1);
	}
	const list = [...groups].sort((a, b) => b[1] - a[1]).map(([g, n]) => n > 1 ? `${g} (${n})` : g).join(', ');
	return `To fit this model's context window, only the tools listed here are available in this conversation; ${omitted.length} others are not (${list}). A model with a larger context window gets all of them.`;
}
