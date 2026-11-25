/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * Custom Slash Commands (Mandate Part 3M).
 *
 * Discovers project-defined (`.kodia/commands/*.md`, `.claude/commands/*.md`) and
 * user-defined slash command templates, parses YAML frontmatter (`description`,
 * `argument-hint`, `allowed-tools`), and expands `$ARGUMENTS` / `$1..$9` placeholders.
 */

export interface CustomSlashCommand {
	/** Command name without leading slash, e.g. "review-pr" or "db:migrate" */
	readonly name: string;
	readonly description: string;
	readonly argumentHint?: string;
	readonly allowedTools?: readonly string[];
	readonly template: string;
	readonly sourcePath: string;
	readonly scope: 'project' | 'user' | 'builtin';
}

/**
 * Built-in Antigravity + Cursor slash commands available in every workspace out of the box.
 * Workspace files in `.kodia/commands/*.md` or `.claude/commands/*.md` with the same name override these.
 */
export const BUILTIN_SLASH_COMMANDS: readonly CustomSlashCommand[] = [
	{
		name: 'plan',
		description: 'Create a detailed step-by-step architecture & implementation plan artifact before editing code',
		argumentHint: '<goal or feature>',
		template: 'Analyze the codebase thoroughly first (read key files, symbols, and architecture). Then call `create_artifact` (name="implementation_plan.md", kind="plan", request_feedback=true) with concrete files to change, risks, and verification steps, and call `update_steps` with your ordered checklist. Wait for user approval before modifying files.\n\nGoal: $ARGUMENTS',
		sourcePath: 'builtin://plan',
		scope: 'builtin',
	},
	{
		name: 'goal',
		description: 'Autonomous thorough execution mode — plan, implement, test, visual QA & verify until 100% done',
		argumentHint: '<target outcome>',
		template: 'Execute this goal end-to-end with maximum rigor and zero shortcuts. Use `update_steps` and `update_focus` to track every phase, research latest APIs/models with LEI/web_search when needed, implement cleanly, run real compilers/tests/browser QA, fix every issue found, and verify all acceptance criteria before concluding.\n\nGoal: $ARGUMENTS',
		sourcePath: 'builtin://goal',
		scope: 'builtin',
	},
	{
		name: 'boost',
		description: 'Deep engineering mode — multi-perspective reasoning, live research, specialist subagents & independent review',
		argumentHint: '<complex task>',
		template: 'Engage deep engineering mode: (1) Specify behavior & evaluate architectural trade-offs (`eric_specify_behavior`, `eric_evaluate_approaches`), (2) verify latest SDK/model facts with LEI (`lei_research_technology` / `lei_discover_models`), (3) delegate independent modules via `run_parallel_workflow` or `subagent`, and (4) run independent verification (`review_code_changes` + real tests + typecheck).\n\nTask: $ARGUMENTS',
		sourcePath: 'builtin://boost',
		scope: 'builtin',
	},
	{
		name: 'grill-me',
		description: 'Interactive requirements interview using clickable multiple-choice question cards before coding',
		argumentHint: '<idea or feature>',
		template: 'Before writing any code, inspect relevant workspace context and call `ask_user_question` with crisp, high-leverage multiple-choice questions (putting your recommended choice first) to lock down architecture, UX, edge cases, and trade-offs. Once answered, summarize the agreed spec into an artifact.\n\nTopic: $ARGUMENTS',
		sourcePath: 'builtin://grill-me',
		scope: 'builtin',
	},
	{
		name: 'teamwork',
		description: 'Coordinate a parallel team of specialist subagents across independent modules',
		argumentHint: '<project or multi-module task>',
		template: 'Decompose this work into non-overlapping file ownership slices and orchestrate specialist subagents in parallel via `run_parallel_workflow` (or parallel `subagent` calls). Define shared interfaces first, verify integration after all agents finish, and synthesize a clear unified report.\n\nWork: $ARGUMENTS',
		sourcePath: 'builtin://teamwork',
		scope: 'builtin',
	},
	{
		name: 'browser',
		description: 'Drive the maximized responsive browser engine to test, inspect ARIA/network & visually verify a web app',
		argumentHint: '<url or test flow>',
		template: 'Launch a visible maximized responsive Chromium browser (`browser_launch` with no fixed viewport), open the target URL, inspect with `browser_inspect_page` / `browser_accessibility_snapshot` / `browser_screenshot(annotated=true)` / `browser_network_log` / `browser_console`, exercise the requested interactive flows, and report exact findings.\n\nTarget: $ARGUMENTS',
		sourcePath: 'builtin://browser',
		scope: 'builtin',
	},
	{
		name: 'review',
		description: 'Cursor BugBot-style automated diff, bug, type-safety & security review of current git changes',
		argumentHint: '[staged | unstaged | branch]',
		template: 'Run `review_code_changes` and inspect the changed files carefully for correctness bugs, race conditions, security flaws, missing edge cases, and regressions. Produce a concise severity-ranked review with exact `file:line` citations and concrete fixes.\n\nScope: $ARGUMENTS',
		sourcePath: 'builtin://review',
		scope: 'builtin',
	},
	{
		name: 'fix',
		description: 'Diagnose root cause of current errors, failing tests, or bugs and apply verified minimal fixes',
		argumentHint: '<error or symptom>',
		template: 'Reproduce or inspect the failure first (check `workspace_diagnostics`, compiler output, or tests), isolate the true root cause without suppressing errors, apply minimal clean fixes, and re-run verification to prove it passes.\n\nIssue: $ARGUMENTS',
		sourcePath: 'builtin://fix',
		scope: 'builtin',
	},
	{
		name: 'test',
		description: 'Discover test setup, write meaningful non-brittle tests, and run the real test runner',
		argumentHint: '<target module or feature>',
		template: 'Discover the project test framework (`test_discover`), write thorough real unit/integration tests covering edge cases and failure paths (never fake assertions), run the tests, and report exact pass/fail counts.\n\nTarget: $ARGUMENTS',
		sourcePath: 'builtin://test',
		scope: 'builtin',
	},
	{
		name: 'ui',
		description: 'Invoke Kodia UI/UX Design Intelligence Engine for studio-grade art-directed interfaces + visual QA',
		argumentHint: '<screen, component, or app>',
		template: 'Run the full UI/UX Design Intelligence workflow: `generate_design_brief`, `generate_design_tokens`, bespoke typography + vector icons + real/SVG visual assets, build responsive mobile-to-desktop UI with rich micro-interactions, and verify visually in the browser (`inspect_visual_quality` / `audit_accessibility`).\n\nDesign request: $ARGUMENTS',
		sourcePath: 'builtin://ui',
		scope: 'builtin',
	},
	{
		name: 'schedule',
		description: 'Schedule a one-shot timer or recurring 5-field cron automation inside Kodia',
		argumentHint: '<interval or cron + instruction>',
		template: 'Use `schedule_task` to create the requested one-shot timer or recurring 5-field cron schedule (and confirm with `manage_scheduled_tasks`), then report the task ID and next trigger time.\n\nSchedule request: $ARGUMENTS',
		sourcePath: 'builtin://schedule',
		scope: 'builtin',
	},
	{
		name: 'learn',
		description: 'Persist verified lessons, conventions, or rules into .kodia/rules/ and project memory',
		argumentHint: '<rule or lesson to remember>',
		template: 'Save this verified convention/rule cleanly into `.kodia/rules/` using `manage_rules` (action="save") and/or `write_project_memory` so Kodia applies it automatically in all future sessions.\n\nLesson: $ARGUMENTS',
		sourcePath: 'builtin://learn',
		scope: 'builtin',
	},
	{
		name: 'docs',
		description: 'Generate accurate, codebase-grounded documentation or an interactive walkthrough artifact',
		argumentHint: '<module, API, or feature>',
		template: 'Inspect the real source files and symbol outlines (`view_file_outline`, `read_file`) first so every path, flag, and symbol is 100% verified, then write crisp documentation or a walkthrough artifact (`create_artifact`, kind="walkthrough").\n\nTopic: $ARGUMENTS',
		sourcePath: 'builtin://docs',
		scope: 'builtin',
	},
	{
		name: 'compact',
		description: 'Summarize & compact conversation context to keep responses fast and focused',
		template: 'Produce a crisp, high-signal checkpoint summary of all completed work, key decisions, changed files, and remaining next steps so we can continue cleanly with minimal context overhead. $ARGUMENTS',
		sourcePath: 'builtin://compact',
		scope: 'builtin',
	},
];

/**
 * Derive a command name from a relative markdown path inside a commands directory.
 * e.g. `review-pr.md` -> `review-pr`, `git/release.md` -> `git:release`.
 */
export function commandNameFromRelativePath(relativePath: string): string {
	return relativePath
		.replace(/\\/g, '/')
		.replace(/^\/+/, '')
		.replace(/\.md$/i, '')
		.split('/')
		.filter(Boolean)
		.join(':')
		.toLowerCase();
}

/**
 * Parse a markdown command template with optional YAML frontmatter.
 */
export function parseCustomCommandMarkdown(
	name: string,
	sourcePath: string,
	scope: 'project' | 'user',
	content: string,
): CustomSlashCommand | undefined {
	const trimmed = content.trim();
	if (!trimmed || !name) { return undefined; }

	let description = `Run /${name}`;
	let argumentHint: string | undefined;
	let allowedTools: string[] | undefined;
	let template = trimmed;

	const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(trimmed);
	if (fmMatch) {
		const fm = fmMatch[1];
		template = fmMatch[2].trim();
		for (const line of fm.split(/\r?\n/)) {
			const kv = /^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/.exec(line.trim());
			if (!kv) { continue; }
			const key = kv[1].toLowerCase();
			const val = kv[2].trim().replace(/^["']|["']$/g, '');
			if (key === 'description' && val) { description = val; }
			else if ((key === 'argument-hint' || key === 'argument_hint' || key === 'args') && val) { argumentHint = val; }
			else if ((key === 'allowed-tools' || key === 'allowed_tools' || key === 'tools') && val) {
				allowedTools = val.replace(/^\[|\]$/g, '').split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
			}
		}
	}

	if (!template) { return undefined; }
	return {
		name,
		description,
		argumentHint,
		allowedTools,
		template,
		sourcePath,
		scope,
	};
}

/**
 * Split positional arguments respecting quoted strings.
 */
export function splitCommandArguments(rawArgs: string): string[] {
	const args: string[] = [];
	const re = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(rawArgs)) !== null) {
		args.push(m[1] ?? m[2] ?? m[3] ?? '');
	}
	return args;
}

/**
 * Expand a custom command template with raw user arguments.
 * Supports `$ARGUMENTS` and positional `$1`..`$9`. If the template contains no
 * placeholders and arguments were provided, appends them cleanly.
 */
export function expandCustomCommandPrompt(command: CustomSlashCommand, rawArgs: string): string {
	const trimmedArgs = rawArgs.trim();
	const positional = splitCommandArguments(trimmedArgs);
	let hadPlaceholder = false;

	let expanded = command.template.replace(/\$ARGUMENTS\b/g, () => {
		hadPlaceholder = true;
		return trimmedArgs;
	});

	expanded = expanded.replace(/\$([1-9])\b/g, (_match, idxStr) => {
		hadPlaceholder = true;
		const idx = Number(idxStr) - 1;
		return positional[idx] ?? '';
	});

	if (!hadPlaceholder && trimmedArgs) {
		expanded = `${expanded}\n\nArguments: ${trimmedArgs}`;
	}

	return expanded.trim();
}

/**
 * Parse a chat message starting with `/commandName optional args`.
 * Returns undefined if the input does not start with a valid slash command token.
 */
export function parseSlashCommandInvocation(input: string): { commandName: string; rawArgs: string } | undefined {
	const trimmed = input.trim();
	const m = /^\/([a-zA-Z0-9_:-]+)(?:\s+([\s\S]*))?$/.exec(trimmed);
	if (!m) { return undefined; }
	return {
		commandName: m[1].toLowerCase(),
		rawArgs: (m[2] ?? '').trim(),
	};
}
