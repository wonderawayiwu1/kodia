/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { isWindows } from '../../../../base/common/platform.js';

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