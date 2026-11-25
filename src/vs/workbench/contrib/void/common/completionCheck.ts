/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * Evidence-based completion: before an agent turn that changed files ends, ask the model once to verify its
 * work against the request — by reading the actual files and running the project's tests/build — and to fix
 * what fails. Measured motivation (live NVIDIA runs, 2026-11-20): a smaller model wrote correct code but
 * invalid tests in 4/4 runs and reported success each time, because nothing made it check.
 *
 * Deterministic and bounded: at most once per turn, only when a file-changing tool actually succeeded.
 */

export const FILE_CHANGING_TOOLS: ReadonlySet<string> = new Set([
	'create_file_or_folder', 'write_file', 'rewrite_file', 'edit_file', 'multi_edit_file', 'workspace_search_replace', 'manage_env_file', 'delete_file_or_folder', 'move_or_rename_file',
]);

type MessageLike = { role: string; type?: string; name?: string };

/** True if any file-changing tool succeeded among these messages (the current turn's messages). */
export function turnChangedFiles(messagesThisTurn: readonly MessageLike[]): boolean {
	return messagesThisTurn.some(m => m.role === 'tool' && m.type === 'success' && !!m.name && FILE_CHANGING_TOOLS.has(m.name));
}

export function shouldRequestCompletionCheck(opts: { chatMode: string; alreadyRequested: boolean; messagesThisTurn: readonly MessageLike[] }): boolean {
	return (opts.chatMode === 'agent' || opts.chatMode === 'debug') && !opts.alreadyRequested && turnChangedFiles(opts.messagesThisTurn);
}

export const COMPLETION_CHECK_REQUEST = `Before finishing, verify your implementation with real commands and actual file evidence (do NOT claim success from memory):
1. Check every explicit user requirement against the files on disk.
2. Run the project's real type-check / build / test commands (e.g. \`npx tsc --noEmit\`, \`npm run build\`, \`npm test\`) for BOTH backend and frontend (if full-stack) and confirm 0 compiler errors.
3. If any error, missing dependency, broken import, or unmet requirement exists, fix the root cause cleanly (never weaken strict mode, add @ts-ignore, or fake tests) and re-run the check.
Then give a concise final summary reporting only what actually ran and passed.`;
