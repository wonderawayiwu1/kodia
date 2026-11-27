/*---------------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as fs from 'fs';
import { promisify } from 'util';
import * as path from '../../../../base/common/path.js';
import { URI } from '../../../../base/common/uri.js';
import type { IByokLmFunctionTool } from '../../common/agentHostByokLm.js';

const execAsync = promisify(cp.exec);

/** Context passed to a local tool executor for one tool call. */
export interface IKodiaToolContext {
	readonly workingDirectory: URI | undefined;
	readonly signal: AbortSignal;
}

export interface IKodiaToolResult {
	readonly success: boolean;
	/** Text fed back to the model as the tool call's output. */
	readonly output: string;
	/** True when the tool wrote to the filesystem (drives edit tracking later). */
	readonly didWrite?: boolean;
	/** Absolute path the tool acted on, when applicable. */
	readonly path?: string;
}

/**
 * Local workspace tools executed directly by the Kodia agent against the
 * session's working directory. Additional Kodia engine tools (KACRAE, ARPEI,
 * LEI, UABE, UAEP, Browser, Web Search, API/Design/AI/Mobile/Evolution/Ops,
 * and `kodia_invoke_tool` for all 379 builtin tools) are dynamically bridged
 * from the serving Kodia window.
 */
export const KODIA_TOOLS: IByokLmFunctionTool[] = [
	{
		type: 'function',
		name: 'read_file',
		description: 'Read a file at the given path (relative to the workspace root, or absolute). Optionally pass 1-based start_line and end_line for a slice.',
		parametersSchema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: 'File path to read.' },
				start_line: { type: 'number', description: 'Optional 1-based starting line.' },
				end_line: { type: 'number', description: 'Optional 1-based ending line (inclusive).' },
			},
			required: ['path'],
			additionalProperties: false,
		},
	},
	{
		type: 'function',
		name: 'write_file',
		description: 'Create or overwrite a file with the given contents. Creates parent directories as needed.',
		parametersSchema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: 'File path to write.' },
				content: { type: 'string', description: 'Full file contents.' },
			},
			required: ['path', 'content'],
			additionalProperties: false,
		},
	},
	{
		type: 'function',
		name: 'edit_file',
		description: 'Surgically replace an exact substring in an existing file without rewriting the whole file.',
		parametersSchema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: 'File path to edit.' },
				old_text: { type: 'string', description: 'Exact existing text to replace.' },
				new_text: { type: 'string', description: 'Replacement text.' },
				replace_all: { type: 'boolean', description: 'If true, replace all occurrences instead of requiring a single match.' },
			},
			required: ['path', 'old_text', 'new_text'],
			additionalProperties: false,
		},
	},
	{
		type: 'function',
		name: 'delete_file',
		description: 'Delete a file or empty directory inside the workspace.',
		parametersSchema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: 'Path to delete.' },
			},
			required: ['path'],
			additionalProperties: false,
		},
	},
	{
		type: 'function',
		name: 'list_dir',
		description: 'List the entries of a directory. Directories are suffixed with "/".',
		parametersSchema: {
			type: 'object',
			properties: { path: { type: 'string', description: 'Directory path. Defaults to the workspace root.' } },
			required: [],
			additionalProperties: false,
		},
	},
	{
		type: 'function',
		name: 'glob_search',
		description: 'Find files recursively in the workspace matching a substring or glob-like pattern (skips node_modules/.git/dist).',
		parametersSchema: {
			type: 'object',
			properties: {
				pattern: { type: 'string', description: 'Filename or path pattern (e.g. "*.tsx", "auth", "src/**/*.ts").' },
				path: { type: 'string', description: 'Optional subdirectory to search within.' },
				max_results: { type: 'number', description: 'Max files to return (default 80).' },
			},
			required: ['pattern'],
			additionalProperties: false,
		},
	},
	{
		type: 'function',
		name: 'grep_search',
		description: 'Search file contents across the workspace for a literal string or regular expression.',
		parametersSchema: {
			type: 'object',
			properties: {
				query: { type: 'string', description: 'Substring or regex pattern to search for.' },
				path: { type: 'string', description: 'Optional subdirectory or file to scope search.' },
				is_regex: { type: 'boolean', description: 'Treat query as regular expression (default false).' },
				max_results: { type: 'number', description: 'Max matching lines to return (default 60).' },
			},
			required: ['query'],
			additionalProperties: false,
		},
	},
	{
		type: 'function',
		name: 'git_status_diff',
		description: 'Inspect current Git status and optional unified diff summary for the workspace.',
		parametersSchema: {
			type: 'object',
			properties: {
				include_diff: { type: 'boolean', description: 'If true, include abbreviated unified diff output.' },
			},
			required: [],
			additionalProperties: false,
		},
	},
	{
		type: 'function',
		name: 'run_bash',
		description: 'Run a shell command in the workspace root and return its combined stdout/stderr.',
		parametersSchema: {
			type: 'object',
			properties: { command: { type: 'string', description: 'The shell command to run.' } },
			required: ['command'],
			additionalProperties: false,
		},
	},
];

export const LOCAL_KODIA_TOOL_NAMES = new Set(KODIA_TOOLS.map(t => t.name));

const DISPLAY_NAMES: Readonly<Record<string, string>> = {
	read_file: 'Read File',
	write_file: 'Write File',
	edit_file: 'Edit File',
	delete_file: 'Delete File',
	list_dir: 'List Directory',
	glob_search: 'Find Files',
	grep_search: 'Search Code',
	git_status_diff: 'Git Status & Diff',
	run_bash: 'Run Command',
	kodia_invoke_tool: 'Kodia Engine Tool',
	kodia_list_all_tools: 'List Kodia Tools',
	kodia_open_settings: 'Open Kodia Settings',
};

export function toolDisplayName(name: string): string {
	if (DISPLAY_NAMES[name]) {
		return DISPLAY_NAMES[name];
	}
	return name.split('_').map(w => w ? w[0].toUpperCase() + w.slice(1) : '').join(' ');
}

const MUTATING_PREFIXES = [
	'write_', 'edit_', 'delete_', 'create_', 'remove_', 'move_', 'rewrite_', 'multi_edit_', 'workspace_search_replace',
	'kacrae_apply_repair', 'kacrae_update_finding',
	'uabe_init_project', 'uabe_scaffold_app', 'uabe_apply_visual_edit', 'uabe_configure_integration',
	'uaep_execute_workflow', 'uaep_save_credential', 'uaep_generate_workflow', 'uaep_modify_workflow',
	'browser_click', 'browser_fill', 'browser_type', 'browser_press', 'browser_submit', 'browser_upload', 'browser_evaluate', 'browser_drag',
	'mobile_scaffold', 'mobile_build_and_test', 'mobile_device_action',
	'ai_scaffold_', 'ai_run_workflow', 'arpei_discover_assets', 'download_visual_assets', 'optimize_visual_assets',
	'dep_install', 'db_migrate', 'db_query', 'dev_server_', 'manage_env_file', 'manage_rules', 'manage_notepads',
	'git_commit', 'git_push', 'git_stage', 'git_unstage', 'git_reset', 'git_merge', 'git_rebase', 'git_revert', 'git_checkout', 'git_branch_create', 'git_branch_switch',
	'execute_notebook', 'restart_notebook', 'test_run',
];

/** Tools that change the workspace, run commands, or perform side effects — gated by approval. */
export function isMutatingTool(name: string): boolean {
	if (name === 'write_file' || name === 'edit_file' || name === 'delete_file' || name === 'run_bash') {
		return true;
	}
	if (name === 'kodia_invoke_tool') {
		return true;
	}
	return MUTATING_PREFIXES.some(p => name === p || name.startsWith(p));
}

function toolRoot(workingDirectory: URI | undefined): string {
	return workingDirectory?.fsPath ?? process.cwd();
}

function resolveToolPath(p: unknown, root: string): string {
	const s = typeof p === 'string' ? p : '';
	return path.isAbsolute(s) ? s : path.join(root, s);
}

/** What the host shows, and checks against its approval rules, before a tool call runs. */
export interface IKodiaToolCallDescription {
	readonly invocationMessage: string;
	/** The bare command for `run_bash`, so terminal approval rules apply to it; the JSON arguments otherwise. */
	readonly toolInput: string;
	/** Absolute path a file tool acts on. */
	readonly path?: string;
}

export function describeKodiaToolCall(name: string, argsJson: string, workingDirectory: URI | undefined): IKodiaToolCallDescription {
	let args: Record<string, unknown> = {};
	try {
		args = argsJson ? JSON.parse(argsJson) : {};
	} catch {
		// Described as-is; executeKodiaTool reports the invalid arguments.
	}
	const root = toolRoot(workingDirectory);
	switch (name) {
		case 'run_bash': {
			const command = typeof args.command === 'string' ? args.command : '';
			return { invocationMessage: command || toolDisplayName(name), toolInput: command || argsJson };
		}
		case 'read_file':
		case 'write_file':
		case 'edit_file':
		case 'delete_file':
		case 'list_dir': {
			const target = resolveToolPath(args.path ?? (name === 'list_dir' ? '.' : ''), root);
			const shown = path.relative(root, target) || '.';
			const verb = name === 'read_file' ? 'Read' : name === 'write_file' ? 'Write' : name === 'edit_file' ? 'Edit' : name === 'delete_file' ? 'Delete' : 'List';
			return { invocationMessage: `${verb} ${shown}`, toolInput: argsJson, path: target };
		}
		case 'glob_search':
			return { invocationMessage: `Find files matching "${String(args.pattern ?? '')}"`, toolInput: argsJson };
		case 'grep_search':
			return { invocationMessage: `Search "${String(args.query ?? '')}"`, toolInput: argsJson };
		case 'kodia_invoke_tool':
			return { invocationMessage: `Run Kodia tool: ${String(args.tool_name ?? 'unknown')}`, toolInput: argsJson };
		default:
			return { invocationMessage: toolDisplayName(name), toolInput: argsJson };
	}
}

const MAX_OUTPUT_BYTES = 1024 * 1024;
const COMMAND_TIMEOUT_MS = 120_000;
const IGNORED_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'out', 'out-vscode-min', 'build', '.cache', '__pycache__', '.venv', 'venv', 'target']);

function globToRegex(pattern: string): RegExp {
	const normalized = pattern.replace(/\\/g, '/').trim();
	if (!/[*?[\]]/.test(normalized)) {
		return new RegExp(normalized.replace(/[.+^${}()|[\]\\]/g, '\\$&'), 'i');
	}
	const escaped = normalized
		.replace(/[.+^${}()|[\]\\]/g, '\\$&')
		.replace(/\*\*/g, '::DOUBLE_STAR::')
		.replace(/\*/g, '[^/]*')
		.replace(/\?/g, '.')
		.replace(/::DOUBLE_STAR::/g, '.*');
	return new RegExp(escaped, 'i');
}

async function walkFiles(dir: string, maxFiles: number, signal: AbortSignal): Promise<string[]> {
	const results: string[] = [];
	const stack = [dir];
	while (stack.length > 0 && results.length < maxFiles) {
		if (signal.aborted) { break; }
		const cur = stack.pop()!;
		let entries: fs.Dirent[];
		try {
			entries = await fs.promises.readdir(cur, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const e of entries) {
			if (results.length >= maxFiles) { break; }
			if (e.isDirectory()) {
				if (!IGNORED_DIRS.has(e.name)) {
					stack.push(path.join(cur, e.name));
				}
			} else if (e.isFile()) {
				results.push(path.join(cur, e.name));
			}
		}
	}
	return results;
}

/** Execute a local workspace tool and return text to feed back to the model. */
export async function executeKodiaTool(name: string, argsJson: string, ctx: IKodiaToolContext): Promise<IKodiaToolResult> {
	let args: Record<string, unknown>;
	try {
		args = argsJson ? JSON.parse(argsJson) : {};
	} catch {
		return { success: false, output: `Invalid JSON arguments for tool "${name}".` };
	}

	const root = toolRoot(ctx.workingDirectory);
	const resolve = (p: unknown): string => resolveToolPath(p, root);

	try {
		switch (name) {
			case 'read_file': {
				const target = resolve(args.path);
				const content = await fs.promises.readFile(target, 'utf8');
				const startLine = typeof args.start_line === 'number' && args.start_line >= 1 ? Math.floor(args.start_line) : undefined;
				const endLine = typeof args.end_line === 'number' && args.end_line >= 1 ? Math.floor(args.end_line) : undefined;
				if (startLine !== undefined || endLine !== undefined) {
					const lines = content.split(/\r?\n/);
					const s = Math.max(1, startLine ?? 1);
					const e = Math.min(lines.length, endLine ?? lines.length);
					const slice = lines.slice(s - 1, e).map((l, idx) => `${s + idx}: ${l}`).join('\n');
					return { success: true, output: slice || '(empty range)', path: target };
				}
				return { success: true, output: content, path: target };
			}
			case 'write_file': {
				const target = resolve(args.path);
				await fs.promises.mkdir(path.dirname(target), { recursive: true });
				await fs.promises.writeFile(target, typeof args.content === 'string' ? args.content : '', 'utf8');
				return { success: true, output: `Wrote ${target}`, didWrite: true, path: target };
			}
			case 'edit_file': {
				const target = resolve(args.path);
				const oldText = typeof args.old_text === 'string' ? args.old_text : '';
				const newText = typeof args.new_text === 'string' ? args.new_text : '';
				if (!oldText) {
					return { success: false, output: 'Missing non-empty "old_text".' };
				}
				const original = await fs.promises.readFile(target, 'utf8');
				const count = original.split(oldText).length - 1;
				if (count === 0) {
					return { success: false, output: `old_text was not found in ${target}. Read the file to verify exact whitespace.` };
				}
				if (count > 1 && !args.replace_all) {
					return { success: false, output: `old_text matched ${count} times in ${target}. Provide more surrounding context or pass replace_all: true.` };
				}
				const updated = args.replace_all ? original.split(oldText).join(newText) : original.replace(oldText, newText);
				await fs.promises.writeFile(target, updated, 'utf8');
				return { success: true, output: `Edited ${target} (${args.replace_all ? count : 1} replacement${count > 1 && args.replace_all ? 's' : ''})`, didWrite: true, path: target };
			}
			case 'delete_file': {
				const target = resolve(args.path);
				await fs.promises.rm(target, { recursive: false, force: false });
				return { success: true, output: `Deleted ${target}`, didWrite: true, path: target };
			}
			case 'list_dir': {
				const target = resolve(args.path ?? '.');
				const entries = await fs.promises.readdir(target, { withFileTypes: true });
				const listing = entries.map(e => (e.isDirectory() ? `${e.name}/` : e.name)).sort().join('\n');
				return { success: true, output: listing || '(empty)', path: target };
			}
			case 'glob_search': {
				const base = resolve(args.path ?? '.');
				const pattern = typeof args.pattern === 'string' ? args.pattern : '*';
				const maxResults = typeof args.max_results === 'number' && args.max_results > 0 ? Math.min(200, args.max_results) : 80;
				const rx = globToRegex(pattern);
				const files = await walkFiles(base, 4000, ctx.signal);
				const matched: string[] = [];
				for (const f of files) {
					const rel = path.relative(root, f).replace(/\\/g, '/');
					if (rx.test(rel)) {
						matched.push(rel);
						if (matched.length >= maxResults) { break; }
					}
				}
				return { success: true, output: matched.length ? matched.join('\n') : `No files matched "${pattern}".` };
			}
			case 'grep_search': {
				const query = typeof args.query === 'string' ? args.query : '';
				if (!query) {
					return { success: false, output: 'Missing "query".' };
				}
				const base = resolve(args.path ?? '.');
				const maxResults = typeof args.max_results === 'number' && args.max_results > 0 ? Math.min(150, args.max_results) : 60;
				const rx = args.is_regex ? new RegExp(query, 'i') : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
				const stat = await fs.promises.stat(base);
				const files = stat.isFile() ? [base] : await walkFiles(base, 2500, ctx.signal);
				const hits: string[] = [];
				for (const f of files) {
					if (ctx.signal.aborted || hits.length >= maxResults) { break; }
					try {
						const st = await fs.promises.stat(f);
						if (st.size > 512 * 1024) { continue; }
						const text = await fs.promises.readFile(f, 'utf8');
						if (text.includes('\u0000')) { continue; }
						const lines = text.split(/\r?\n/);
						const rel = path.relative(root, f).replace(/\\/g, '/');
						for (let i = 0; i < lines.length; i++) {
							if (rx.test(lines[i])) {
								hits.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
								if (hits.length >= maxResults) { break; }
							}
						}
					} catch { /* skip unreadable */ }
				}
				return { success: true, output: hits.length ? hits.join('\n') : `No matches for "${query}".` };
			}
			case 'git_status_diff': {
				const { stdout: statusOut } = await execAsync('git status --short', { cwd: root, signal: ctx.signal, timeout: 15_000, maxBuffer: MAX_OUTPUT_BYTES });
				let out = `Git Status:\n${statusOut.trim() || '(clean working tree)'}`;
				if (args.include_diff) {
					const { stdout: diffOut } = await execAsync('git diff --stat', { cwd: root, signal: ctx.signal, timeout: 15_000, maxBuffer: MAX_OUTPUT_BYTES });
					out += `\n\nDiff Stat:\n${diffOut.trim() || '(no unstaged diff)'}`;
				}
				return { success: true, output: out };
			}
			case 'run_bash': {
				const command = typeof args.command === 'string' ? args.command : '';
				if (!command) {
					return { success: false, output: 'Missing "command".' };
				}
				const { stdout, stderr } = await execAsync(command, { cwd: root, signal: ctx.signal, timeout: COMMAND_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES });
				const out = `${stdout ?? ''}${stderr ? `\n[stderr]\n${stderr}` : ''}`.trim();
				return { success: true, output: out || '(no output)' };
			}
			default:
				return { success: false, output: `Unknown local tool: ${name}` };
		}
	} catch (err) {
		const e = err as { stdout?: string; stderr?: string; message?: string };
		const detail = (e.stdout || e.stderr) ? `${e.stdout ?? ''}${e.stderr ?? ''}`.trim() : (e.message ?? String(err));
		return { success: false, output: detail };
	}
}
