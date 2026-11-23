/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { isWindows } from '../../../../base/common/platform.js';
import { removeAnsiEscapeCodes } from '../../../../base/common/strings.js';

// PowerShell argument quoting utility for Windows
// Properly quotes a single argument for PowerShell command line execution.
// PowerShell uses backtick (`) as the escape character and double quotes for
// arguments containing spaces or special characters.
export function quotePowerShellArg(arg: string): string {
	// If the argument is empty, return empty double quotes
	if (arg === '') return '""';

	// If the argument contains no spaces, double quotes, backticks, or special
	// PowerShell characters, it can be passed unquoted.
	const needsQuoting = /[ \t\n"'`$(){};|&<>]/.test(arg);
	if (!needsQuoting) return arg;

	// Escape backticks first, then double quotes
	let escaped = arg.replace(/`/g, '``').replace(/"/g, '`"');
	return `"${escaped}"`;
}

// Build a PowerShell command string from a command name and arguments.
// Each argument is properly quoted for PowerShell.
export function buildPowerShellCommand(command: string, args: string[]): string {
	const quotedArgs = args.map(a => quotePowerShellArg(a)).join(' ');
	return `${command} ${quotedArgs}`.trimEnd();
}

// Detect whether the current platform is Windows (PowerShell is the default shell)
/**
 * Pure offset logic for incremental terminal reads.
 *
 * Offset semantics:
 * - If requestedOffset is undefined, the service-managed storedOffset is used.
 * - The effective offset is clamped to [0, fullOutput.length] so a caller-supplied
 *   offset can never cause unread output to be silently skipped or read out of bounds.
 * - The next stored offset only moves forward: it is the max of the previous stored
 *   offset and the end of the output that was just read. It never moves backward,
 *   even if the caller supplied a lower offset that caused re-reading older output.
 *
 * @param fullOutput The complete terminal output (oldest to newest).
 * @param storedOffset The service-managed offset from the previous read.
 * @param requestedOffset Caller-supplied offset override (undefined = use storedOffset).
 * @returns { output, isAtEnd, nextStoredOffset }
 */
export function computeIncrementalRead(
	fullOutput: string,
	storedOffset: number,
	requestedOffset?: number,
): { output: string; isAtEnd: boolean; nextStoredOffset: number } {
	const effectiveOffset = Math.max(0, Math.min(requestedOffset ?? storedOffset, fullOutput.length));
	const output = fullOutput.slice(effectiveOffset);
	const nextStoredOffset = Math.max(storedOffset, effectiveOffset + output.length);
	const isAtEnd = output.length === 0;
	return { output, isAtEnd, nextStoredOffset };
}


export const isPowerShellPlatform = isWindows;

/**
 * The real outcome of a finished terminal command, for tools that report success to the model
 * (dep_install, db_migrate, lint_run). Success means the command ran to completion with exit code 0;
 * a command killed for inactivity is never a success. Never report success that did not happen.
 */
export function terminalCommandOutcome(res: { result: string; resolveReason: { type: 'done'; exitCode: number } | { type: 'timeout' } }): { success: boolean; exit_code: number | undefined; output: string } {
	if (res.resolveReason.type === 'done') {
		return { success: res.resolveReason.exitCode === 0, exit_code: res.resolveReason.exitCode, output: res.result };
	}
	return { success: false, exit_code: undefined, output: `${res.result}\n(The command was stopped after a period of inactivity and did not finish.)` };
}

/**
 * Safely converts a timeout duration in seconds to milliseconds for `setTimeout`.
 * In JavaScript/Chromium/Node.js, passing `Infinity`, `NaN`, or values > 2^31-1
 * to `setTimeout` overflows the 32-bit signed integer and fires immediately (0ms/1ms).
 */
export function safeSetTimeoutMs(seconds: number, fallbackSeconds: number): number {
	const MAX_TIMEOUT_MS = 2_147_483_000; // safely below 2^31 - 1
	const effectiveSeconds = (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0)
		? seconds
		: fallbackSeconds;
	return Math.max(1000, Math.min(Math.round(effectiveSeconds * 1000), MAX_TIMEOUT_MS));
}

/**
 * Unwraps a Windows PowerShell `cmd /c '...'` wrapper when the actual terminal shell is
 * Command Prompt (`cmd`) or a POSIX shell (`gitbash`, `bash`, `zsh`, `sh`, `wsl`), where
 * single-quoted `cmd /c '...'` syntax is invalid.
 */
export function unwrapCmdForShellType(command: string, shellType: string | undefined): string {
	if (!shellType) return command;
	const lower = shellType.toLowerCase();
	if (lower === 'pwsh' || lower === 'powershell') {
		return command;
	}
	const match = /^cmd \/c '(.*)'$/s.exec(command.trim());
	if (!match) return command;
	return match[1].replace(/''/g, `'`);
}

/**
 * Wraps a command with a deterministic completion sentinel so Kodia can detect command
 * completion and exact exit codes reliably even when VS Code shell integration
 * (`CommandDetection`) is unavailable or blocked (e.g. restricted PowerShell, cmd.exe,
 * Git Bash, or hidden terminals).
 *
 * Notice that the echoed command itself contains a variable reference (`$__kodia_ec`,
 * `%ERRORLEVEL%`, or `$?`), NOT literal digits, so matching `:(-?\d+)__` only triggers
 * on the real runtime output after the command finishes.
 */
export function buildSentinelWrappedCommand(command: string, token: string, shellType: string | undefined): string {
	const marker = `__KODIA_DONE_${token}__`;
	const lower = (shellType ?? '').toLowerCase();

	if (isWindows) {
		if (lower === 'cmd' || lower === 'commandprompt') {
			return `${command} && echo ${marker}^:0__ || echo ${marker}^:1__`;
		}
		if (lower === 'gitbash' || lower === 'bash' || lower === 'sh' || lower === 'zsh' || lower === 'wsl') {
			return `${command}; printf '\\n${marker}:%s__\\n' "$?"`;
		}
		// Default Windows shell: PowerShell (pwsh / Windows PowerShell 5.1)
		// Reset $global:LASTEXITCODE first so a previous failing native command in a persistent terminal never leaks its exit code.
		return `$global:LASTEXITCODE = 0; ${command}; $__kodia_ec = if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { $LASTEXITCODE } elseif ($?) { 0 } else { 1 }; Write-Host "${marker}:$($__kodia_ec)__"`;
	}

	if (lower === 'fish') {
		return `${command}; printf '\\n${marker}:%s__\\n' $status`;
	}
	return `${command}; printf '\\n${marker}:%s__\\n' "$?"`;
}

/**
 * Checks raw terminal output for the runtime sentinel emitted by `buildSentinelWrappedCommand`.
 */
export function extractSentinelCompletion(
	rawOutput: string,
	token: string,
): { done: boolean; exitCode: number; cleanOutput: string } {
	const plain = removeAnsiEscapeCodes(rawOutput);
	const marker = `__KODIA_DONE_${token}__`;
	const regex = new RegExp(`${marker}:(-?\\d+)__`);
	const match = regex.exec(plain);
	if (!match) {
		return { done: false, exitCode: 0, cleanOutput: plain };
	}

	const exitCode = Number.parseInt(match[1], 10);
	const beforeMarker = plain.slice(0, match.index);
	// Strip echoed sentinel command line if present (contains marker without resolved numeric code)
	const cleanedLines = beforeMarker
		.replace(/\r\n/g, '\n')
		.replace(/\r/g, '\n')
		.split('\n')
		.filter(line => !line.includes(marker));

	return {
		done: true,
		exitCode: Number.isNaN(exitCode) ? 0 : exitCode,
		cleanOutput: cleanedLines.join('\n').trim(),
	};
}

/**
 * Wraps a command for safe execution in an interactive shell session.
 * Preserves shell built-ins (cd, export, $env:), pipes, and chains (&&, ;) cleanly
 * across PowerShell, Command Prompt, and POSIX shells.
 */
export function wrapCommandForInteractiveShell(command: string): string {
	return command.trim();
}

/**
 * Wraps a command for safe execution on Windows PowerShell.
 * PowerShell interprets certain words as keywords (e.g., 'new', 'foreach', 'where')
 * which can conflict with command names. Wrapping with cmd /c bypasses PowerShell
 * parsing entirely and is the safest approach for running external commands.
 */
export function wrapCommandForShell(command: string): string {
	if (isWindows) {
		// On Windows, wrap with cmd /c to bypass PowerShell keyword parsing
		// This prevents issues like 'new' being interpreted as a PowerShell keyword.
		// The command goes in a PowerShell SINGLE-quoted string: nothing in it is interpreted (no $var, no `escape) and
		// only ' needs escaping (doubled). The old `cmd /c "..."` escaped inner quotes as \", which PowerShell does not
		// treat as an escape: every command containing a double quote (node -e "...", git commit -m "...") failed to
		// parse or ran mangled, and $HOME / backticks were expanded by PowerShell (verified in Windows PowerShell 5.1).
		return `cmd /c '${command.replace(/'/g, `''`)}'`;
	}
	return command;
}

/**
 * Detects if a command contains keywords that might conflict with PowerShell parsing.
 * These are words that PowerShell treats as language keywords rather than command names.
 */
export function containsPowerShellKeyword(command: string): boolean {
	if (!isWindows) return false;
	const keywords = ['new', 'foreach', 'where', 'switch', 'try', 'catch', 'finally', 'throw', 'return', 'break', 'continue', 'param', 'begin', 'process', 'end', 'dynamicparam', 'trap', 'using'];
	const firstWord = command.trim().split(/\s+/)[0].toLowerCase();
	return keywords.includes(firstWord);
}