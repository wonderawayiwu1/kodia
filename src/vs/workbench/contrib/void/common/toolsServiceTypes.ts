import { URI } from '../../../../base/common/uri.js'
import { RawMCPToolCall } from './mcpServiceTypes.js';
import { builtinTools } from './prompt/prompts.js';
import { RawToolParamsObj } from './sendLLMMessageTypes.js';
import { SearchResult } from './webSearchTypes.js';
import { TerminalInfo } from '../browser/terminalToolService.js';
import { TaskPlan, TaskStatus } from './autonomousTask.js';
import { GitRepositoryStatus, GitDiffResult, GitCommitLogEntry, GitBranchInfo } from './gitService.js';
import { TestFramework, TestFileInfo, TestRunResultData } from './testServiceTypes.js';



export type TerminalResolveReason = { type: 'timeout' } | { type: 'done', exitCode: number }

export type LintErrorItem = { code: string, message: string, startLineNumber: number, endLineNumber: number }

// a place in the code, with the text there (the LLM can pass uri + line straight back to other tools)
export type CodeLocation = { uri: URI, line: number, snippet: string }

export type WorkspaceSymbolEntry = { name: string, kind: string, containerName: string | undefined, uri: URI, line: number | undefined }

// Partial of IFileStat
export type ShallowDirectoryItem = {
	uri: URI;
	name: string;
	isDirectory: boolean;
	isSymbolicLink: boolean;
}


export const approvalTypeOfBuiltinToolName: Partial<{ [T in BuiltinToolName]?: 'edits' | 'terminal' | 'web pages' | 'MCP tools' | 'planning' | 'git' | 'test' }> = {
	'create_file_or_folder': 'edits',
	'delete_file_or_folder': 'edits',
	'rewrite_file': 'edits',
	'edit_file': 'edits',
	'write_project_memory': 'edits',
	'run_command': 'terminal',
	'run_persistent_command': 'terminal',
	'open_persistent_terminal': 'terminal',
	'kill_persistent_terminal': 'terminal',
	'send_command_to_terminal': 'terminal',
	'interrupt_terminal': 'terminal',
	'close_terminal': 'terminal',
	// task planning - read-only planning, no file/system changes
	'create_task_plan': 'planning',
	'update_task_plan': 'planning',
	'get_task_plan': 'planning',
	// git operations - read-only
	'git_status': 'git',
	'git_diff': 'git',
	'git_log': 'git',
	'git_branch_list': 'git',
	'git_show': 'git',
	// git operations - local modifications
	'git_branch_create': 'git',
	'git_branch_switch': 'git',
	'git_stage': 'git',
	'git_unstage': 'git',
	'git_commit': 'git',
	'git_stash': 'git',
	'git_stash_pop': 'git',
	// git operations - network/destructive
	'git_fetch': 'git',
	'git_pull': 'git',
	'git_push': 'git',
	'git_merge': 'git',
	// test operations - read-only
	'test_discover': 'test',
	'test_list': 'test',
	'test_run': 'test',
	'test_run_targeted': 'test',
	'test_rerun_failed': 'test',
	'test_cancel': 'test',
	// a fetched URL can carry data out of the workspace, so the user sees it first
	'fetch_url': 'web pages',
	'web_search': 'web pages',
}


export type ToolApprovalType = NonNullable<(typeof approvalTypeOfBuiltinToolName)[keyof typeof approvalTypeOfBuiltinToolName]> | 'planning';


export const toolApprovalTypes = new Set<ToolApprovalType>([
	...Object.values(approvalTypeOfBuiltinToolName),
	'MCP tools',
	'planning',
])




// PARAMS OF TOOL CALL
export type BuiltinToolCallParams = {
	'read_file': { uri: URI, startLine: number | null, endLine: number | null, pageNumber: number },
	'ls_dir': { uri: URI, pageNumber: number },
	'get_dir_tree': { uri: URI },
	'search_pathnames_only': { query: string, includePattern: string | null, pageNumber: number },
	'search_for_files': { query: string, isRegex: boolean, searchInFolder: URI | null, pageNumber: number },
	'search_in_file': { uri: URI, query: string, isRegex: boolean },
	'go_to_definition': { uri: URI, line: number, symbol: string },
	'find_references': { uri: URI, line: number, symbol: string },
	'search_symbols': { query: string },
	'read_lint_errors': { uri: URI },
	'read_project_memory': {},
	'fetch_url': { url: string, pageNumber: number },
	'web_search': { query: string, maxResults?: number },
	// ---
	'rewrite_file': { uri: URI, newContent: string },
	'write_project_memory': { section: string, content: string },
	'edit_file': { uri: URI, searchReplaceBlocks: string },
	'create_file_or_folder': { uri: URI, isFolder: boolean },
	'delete_file_or_folder': { uri: URI, isRecursive: boolean, isFolder: boolean },
	// ---
	'run_command': { command: string; cwd: string | null, terminalId: string },
	'open_persistent_terminal': { cwd: string | null },
	'run_persistent_command': { command: string; persistentTerminalId: string },
	'kill_persistent_terminal': { persistentTerminalId: string },
	// Terminal session management (Stage 5A Day 1)
	'list_terminals': {},
	'read_terminal': { terminalId: string, offset?: number },
	'send_command_to_terminal': { terminalId: string, command: string },
	'interrupt_terminal': { terminalId: string },
	'close_terminal': { terminalId: string },
	// Task plan management (Stage 5A Day 2)
	'create_task_plan': { title: string, description: string, tasks: { title: string, description: string, dependencies: string[] }[] },
	'update_task_plan': { taskId: string, status: TaskStatus, result?: string | null, error?: string | null },
	'get_task_plan': {},
	// Test discovery and execution (Stage 3)
	'test_discover': {},
	'test_list': {},
	'test_run': { test_files?: string[], test_names?: string[] },
	'test_run_targeted': { changed_files: string[] },
	'test_rerun_failed': {},
	'test_cancel': { run_id?: string },
	// Git operations (Stage 2)
	'git_status': {},
	'git_diff': { ref: string | null, path: string | null, staged: boolean | null },
	'git_log': { max_count: number | null, path: string | null },
	'git_branch_list': {},
	'git_branch_create': { branch_name: string, start_point: string | null },
	'git_branch_switch': { branch_name: string },
	'git_stage': { paths: string[] },
	'git_unstage': { paths: string[] },
	'git_commit': { message: string, amend: boolean | null },
	'git_fetch': { remote: string | null },
	'git_pull': { remote: string | null, branch: string | null },
	'git_push': { remote: string | null, branch: string | null, force: boolean | null },
	'git_merge': { branch: string },
	'git_stash': { message: string | null },
	'git_stash_pop': {},
	'git_show': { commit: string, path: string | null },
}

// RESULT OF TOOL CALL
export type BuiltinToolResultType = {
	'read_file': { fileContents: string, totalFileLen: number, totalNumLines: number, hasNextPage: boolean },
	'ls_dir': { children: ShallowDirectoryItem[] | null, hasNextPage: boolean, hasPrevPage: boolean, itemsRemaining: number },
	'get_dir_tree': { str: string, },
	'search_pathnames_only': { uris: URI[], hasNextPage: boolean },
	'search_for_files': { uris: URI[], hasNextPage: boolean },
	'search_in_file': { lines: number[]; },
	// hasLanguageServer: false when no language server answers this request for the file / workspace
	'go_to_definition': { locations: CodeLocation[], hasLanguageServer: boolean },
	'find_references': { locations: CodeLocation[], totalCount: number, hasLanguageServer: boolean },
	'search_symbols': { symbols: WorkspaceSymbolEntry[], totalCount: number, hasLanguageServer: boolean },
	'read_lint_errors': { lintErrors: LintErrorItem[] | null },
	'read_project_memory': { content: string },
	// url: where redirects ended
	'fetch_url': { url: string, title: string | null, content: string, totalLen: number, hasNextPage: boolean },
	'web_search': { results: SearchResult[] },
	// ---
	'rewrite_file': Promise<{ lintErrors: LintErrorItem[] | null }>,
	'edit_file': Promise<{ lintErrors: LintErrorItem[] | null }>,
	'write_project_memory': { content: string, tokenCount: number },
	'create_file_or_folder': {},
	'delete_file_or_folder': {},
	// ---
	'run_command': { result: string; resolveReason: TerminalResolveReason; },
	'run_persistent_command': { result: string; resolveReason: TerminalResolveReason; },
	'open_persistent_terminal': { persistentTerminalId: string },
	'kill_persistent_terminal': {},
	// Terminal session management (Stage 5A Day 1)
	'list_terminals': { terminals: TerminalInfo[] },
	'read_terminal': { output: string, isAtEnd: boolean, totalChars: number },
	'send_command_to_terminal': { result: string },
	'interrupt_terminal': {},
	'close_terminal': {},
	// Task plan management (Stage 5A Day 2)
	'create_task_plan': { plan: TaskPlan },
	'update_task_plan': { plan: TaskPlan },
	'get_task_plan': { plan: TaskPlan | null },
	// Git operations (Stage 2)
	'git_status': { status: GitRepositoryStatus },
	'git_diff': { diff: GitDiffResult },
	'git_log': { commits: GitCommitLogEntry[], total: number },
	'git_branch_list': { branches: GitBranchInfo[], current: string | null },
	'git_branch_create': { branch_name: string },
	'git_branch_switch': { branch_name: string },
	'git_stage': { staged: string[] },
	'git_unstage': { unstaged: string[] },
	'git_commit': { commit_hash: string, message: string },
	'git_fetch': { result: string },
	'git_pull': { result: string },
	'git_push': { result: string },
	'git_merge': { result: string, merge_in_progress: boolean },
	'git_stash': { result: string },
	'git_stash_pop': { result: string },
	'git_show': { commit: string, message: string, diff: string },
	// Test discovery and execution (Stage 3)
	'test_discover': { frameworks: TestFramework[] },
	'test_list': { testFiles: TestFileInfo[] },
	'test_run': { results: TestRunResultData },
	'test_run_targeted': { results: TestRunResultData },
	'test_rerun_failed': { results: TestRunResultData },
	'test_cancel': { cancelled: boolean },
}


export type ToolCallParams<T extends BuiltinToolName | (string & {})> = T extends BuiltinToolName ? BuiltinToolCallParams[T] : RawToolParamsObj
export type ToolResult<T extends BuiltinToolName | (string & {})> = T extends BuiltinToolName ? BuiltinToolResultType[T] : RawMCPToolCall

export type BuiltinToolName = keyof BuiltinToolResultType

type BuiltinToolParamNameOfTool<T extends BuiltinToolName> = keyof (typeof builtinTools)[T]['params']


export type ToolName = BuiltinToolName | (string & {})
export type ToolParamName<T extends ToolName> = T extends BuiltinToolName ? BuiltinToolParamNameOfTool<T> : string
