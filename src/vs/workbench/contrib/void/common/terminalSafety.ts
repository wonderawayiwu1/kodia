/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * Terminal command safety utilities.
 *
 * Detects potentially destructive commands and operations to elevate their
 * autonomy risk classification. Provides safe command construction helpers
 * to prevent argument injection issues.
 */

import { isWindows } from '../../../../base/common/platform.js';
import { quotePowerShellArg } from './terminalUtils.js';

/**
 * Commands that are destructive/irreversible and should be classified as
 * high or critical risk regardless of autonomy mode.
 *
 * These patterns match the command name (first token) of the command string.
 */
export const DESTRUCTIVE_COMMANDS: ReadonlySet<string> = new Set([
	// File deletion - recursive/force
	'rm', 'rmdir', 'rd', 'del', 'erase', 'deltree',
	// Filesystem formatting
	'format', 'mkfs', 'mkfs.ext4', 'mkfs.ntfs', 'mkfs.fat',
	// Disk imaging/overwriting
	'dd', 'shred', 'wipe', 'scrub',
]);

/**
 * Destructive command patterns that match anywhere in the command string.
 * These catch cases like `sudo mkfs.ext4 /dev/sdb1`, etc. where the destructive
 * command is not the first token. First-token-based commands (rm, del, format,
 * etc.) are handled directly in isDestructiveCommand().
 */
export const DESTRUCTIVE_PATTERNS: ReadonlyArray<RegExp> = [
	// mkfs.*
	/\bmkfs\./,
	// dd with of= (output file - could overwrite)
	/\bdd\s.*\bof=/,
	// format followed by drive/path
	/\bformat\s/,
];

/**
 * Checks if a command string contains a potentially destructive operation.
 * Returns true if the command should be treated as high/critical risk.
 *
 * Logic:
 * - rm/del/erase/rmdir/rd with BOTH recursive (-r/-R/--recursive) AND force
 *   (-f/--force) flags → critical (combined flags like -rf, -fr, -Rf handled)
 * - rm/del/erase/rmdir/rd without both flags → medium (single file delete)
 * - format/mkfs/dd/shred/wipe/scrub → always critical
 * - Other commands → not destructive
 */
export function isDestructiveCommand(command: string): boolean {
	if (!command || typeof command !== 'string') return false;

	const trimmed = command.trim();
	if (trimmed.length === 0) return false;

	const firstToken = trimmed.split(/\s+/)[0].toLowerCase();

	// Check first token against destructive command set
	if (DESTRUCTIVE_COMMANDS.has(firstToken)) {
		// rm/del/erase/rmdir/rd without recursive/force flags are medium risk
		// (single file delete is reversible-ish)
		if (
			firstToken === 'rm' ||
			firstToken === 'del' ||
			firstToken === 'erase' ||
			firstToken === 'rmdir' ||
			firstToken === 'rd'
		) {
			// Check for recursive (-r/-R/--recursive or /s) AND force
			// (-f/--force or /f or /q) flags. Handles combined flags like
			// -rf, -fr, -Rf, -fR, /s /q, /f /s, etc.
			const hasRecursive =
				/-[a-zA-Z]*r[a-zA-Z]*/.test(trimmed) ||
				/--recursive/.test(trimmed) ||
				/\/s\b/i.test(trimmed);
			const hasForce =
				/-[a-zA-Z]*f[a-zA-Z]*/.test(trimmed) ||
				/--force/.test(trimmed) ||
				/\/f\b/i.test(trimmed) ||
				/\/q\b/i.test(trimmed);
			if (hasRecursive && hasForce) return true;
			return false;
		}
		// Other destructive commands (format, mkfs, dd, etc.) are always critical
		return true;
	}

	// Check destructive patterns anywhere in the command (e.g., sudo mkfs.ext4)
	for (const pattern of DESTRUCTIVE_PATTERNS) {
		if (pattern.test(trimmed)) return true;
	}

	return false;
}

/**
 * Classifies the risk of a terminal command based on its content.
 * Returns 'critical' for destructive commands, 'medium' otherwise.
 * This is used to augment the base assessRisk for terminal tools.
 */
export function classifyCommandRisk(command: string): 'critical' | 'medium' {
	if (isDestructiveCommand(command)) return 'critical';
	return 'medium';
}

/**
 * Checks if a command string looks like it could be an argument injection
 * attempt - e.g., command substitution, backticks, $(...), ${...}, ;, |, &
 * used to chain commands unexpectedly.
 */
export function hasInjectionRisk(command: string): boolean {
	if (!command || typeof command !== 'string') return false;

	// Check for command substitution patterns that could be injection
	// $(...), ${...}, backticks
	if (/\$\([^)]*\)/.test(command)) return true;
	if (/\$\{[^}]*\}/.test(command)) return true;
	if (/`[^`]*`/.test(command)) return true;

	// Check for command chaining that wasn't explicitly requested
	// ; , | , & outside of quotes
	const unquoted = removeQuotedSections(command);
	if (/[;|&]/.test(unquoted)) return true;

	return false;
}

/**
 * Removes double-quoted and single-quoted sections from a string
 * so we can check for injection patterns outside of quotes.
 */
function removeQuotedSections(str: string): string {
	return str.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''");
}

/**
 * Safely constructs a command string for execution, quoting arguments
 * appropriately for the target shell.
 *
 * On Windows (PowerShell), uses quotePowerShellArg for each argument.
 * On POSIX shells, uses single-quote escaping.
 */
export function buildSafeCommand(command: string, args: string[]): string {
	if (isWindows) {
		// PowerShell: quote each argument individually
		const quotedArgs = args.map(a => quotePowerShellArg(a));
		return `${command} ${quotedArgs.join(' ')}`.trimEnd();
	} else {
		// POSIX shell: single-quote each argument, escaping embedded single quotes
		const quotedArgs = args.map(a => quotePosixArg(a));
		return `${command} ${quotedArgs.join(' ')}`.trimEnd();
	}
}

/**
 * Quotes a single argument for POSIX shell execution.
 * Wraps in single quotes, escaping any embedded single quotes.
 */
function quotePosixArg(arg: string): string {
	if (arg === '') return "''";
	// If the argument contains no characters that need quoting, pass through
	if (/^[A-Za-z0-9_./-]+$/.test(arg)) return arg;
	// Single-quote, replacing any embedded single quotes with '\''
	const escaped = arg.replace(/'/g, "'\\''");
	return `'${escaped}'`;
}

/**
 * Validates a command string for safety before execution.
 * Returns an array of warning messages, or an empty array if safe.
 */
export function validateCommandSafety(command: string): string[] {
	const warnings: string[] = [];

	if (!command || typeof command !== 'string') {
		warnings.push('Command is empty or not a string');
		return warnings;
	}

	const trimmed = command.trim();
	if (trimmed.length === 0) {
		warnings.push('Command is empty');
		return warnings;
	}

	if (isDestructiveCommand(trimmed)) {
		warnings.push('Command contains potentially destructive operation');
	}

	if (hasInjectionRisk(trimmed)) {
		warnings.push('Command contains potential argument injection patterns');
	}

	return warnings;
}
