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
	'create_file_or_folder', 'write_file', 'rewrite_file', 'edit_file', 'delete_file_or_folder', 'move_or_rename_file',
]);

type MessageLike = { role: string; type?: string; name?: string };

/** True if any file-changing tool succeeded among these messages (the current turn's messages). */
export function turnChangedFiles(messagesThisTurn: readonly MessageLike[]): boolean {
	return messagesThisTurn.some(m => m.role === 'tool' && m.type === 'success' && !!m.name && FILE_CHANGING_TOOLS.has(m.name));
}

export function shouldRequestCompletionCheck(opts: { chatMode: string; alreadyRequested: boolean; messagesThisTurn: readonly MessageLike[] }): boolean {
	return (opts.chatMode === 'agent' || opts.chatMode === 'debug') && !opts.alreadyRequested && turnChangedFiles(opts.messagesThisTurn);
}

export const COMPLETION_CHECK_REQUEST = `Kodia First-Pass Quality Gate — before you finish, verify your work with real evidence, not from memory:
1. Re-read the user's request and list each explicit requirement and shared interface/API/DB contract.
2. Run fpere_validate_imports (or fpere_run_quality_gate) to confirm zero broken relative imports, missing named/default exports, undeclared packages, or placeholder stubs.
3. For multi-layer apps, run fpere_check_integration to verify frontend/backend API contracts, database models, and environment declarations align.
4. Run the project's actual type-check, build, or test suite and report the real commands and results.
5. If anything fails or a requirement is unmet, fix the root cause (never weaken strict mode, types, or tests) and re-verify.
Then provide your concise final report stating only what was actually verified.`;
