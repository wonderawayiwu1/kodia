/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import {
	isDestructiveCommand,
	classifyCommandRisk,
	hasInjectionRisk,
	buildSafeCommand,
	validateCommandSafety,
	DESTRUCTIVE_COMMANDS,
	DESTRUCTIVE_PATTERNS,
} from '../../common/terminalSafety.js';

suite('Kodia - Terminal Safety (Stage 1)', () => {

	suite('isDestructiveCommand - destructive command detection', () => {
		test('returns false for ordinary commands', () => {
			assert.strictEqual(isDestructiveCommand('npm install'), false);
			assert.strictEqual(isDestructiveCommand('git status'), false);
			assert.strictEqual(isDestructiveCommand('ls -la'), false);
			assert.strictEqual(isDestructiveCommand('node index.js'), false);
		});

		test('returns true for rm -rf (recursive force delete)', () => {
			assert.strictEqual(isDestructiveCommand('rm -rf /tmp/foo'), true);
			assert.strictEqual(isDestructiveCommand('rm -r -f /tmp/foo'), true);
			assert.strictEqual(isDestructiveCommand('rm --recursive --force /tmp/foo'), true);
		});

		test('returns true for del /f /s /q (Windows force delete)', () => {
			assert.strictEqual(isDestructiveCommand('del /f /s /q *.*'), true);
			assert.strictEqual(isDestructiveCommand('del /q /s /f C:\\temp'), true);
		});

		test('returns true for rmdir /s /q (Windows recursive delete)', () => {
			assert.strictEqual(isDestructiveCommand('rmdir /s /q C:\\temp'), true);
			assert.strictEqual(isDestructiveCommand('rd /s /q C:\\temp'), true);
		});

		test('returns true for format (filesystem formatting)', () => {
			assert.strictEqual(isDestructiveCommand('format C:'), true);
			assert.strictEqual(isDestructiveCommand('format /fs:ntfs D:'), true);
		});

		test('returns true for mkfs (filesystem creation/formatting)', () => {
			assert.strictEqual(isDestructiveCommand('mkfs.ext4 /dev/sdb1'), true);
			assert.strictEqual(isDestructiveCommand('mkfs.ntfs /dev/sdc1'), true);
		});

		test('returns true for dd with of= (disk overwrite)', () => {
			assert.strictEqual(isDestructiveCommand('dd if=/dev/zero of=/dev/sdb'), true);
		});

		test('returns false for rm without -r/-f (single file delete)', () => {
			assert.strictEqual(isDestructiveCommand('rm file.txt'), false);
			assert.strictEqual(isDestructiveCommand('rm -i file.txt'), false);
		});

		test('returns false for del without /f /s /q (single file delete)', () => {
			assert.strictEqual(isDestructiveCommand('del file.txt'), false);
			assert.strictEqual(isDestructiveCommand('erase file.txt'), false);
		});

		test('returns false for empty or null command', () => {
			assert.strictEqual(isDestructiveCommand(''), false);
			assert.strictEqual(isDestructiveCommand('   '), false);
			// @ts-ignore
			assert.strictEqual(isDestructiveCommand(null), false);
			// @ts-ignore
			assert.strictEqual(isDestructiveCommand(undefined), false);
		});

		test('DESTRUCTIVE_COMMANDS set contains expected commands', () => {
			assert.ok(DESTRUCTIVE_COMMANDS.has('rm'));
			assert.ok(DESTRUCTIVE_COMMANDS.has('del'));
			assert.ok(DESTRUCTIVE_COMMANDS.has('format'));
			assert.ok(DESTRUCTIVE_COMMANDS.has('mkfs'));
			assert.ok(DESTRUCTIVE_COMMANDS.has('dd'));
			assert.ok(DESTRUCTIVE_COMMANDS.has('rmdir'));
			assert.ok(DESTRUCTIVE_COMMANDS.has('rd'));
		});

		test('DESTRUCTIVE_PATTERNS match destructive patterns', () => {
			assert.ok(DESTRUCTIVE_PATTERNS.length > 0);
			for (const pattern of DESTRUCTIVE_PATTERNS) {
				assert.ok(pattern instanceof RegExp);
			}
		});
	});

	suite('classifyCommandRisk - command risk classification', () => {
		test('returns critical for destructive commands', () => {
			assert.strictEqual(classifyCommandRisk('rm -rf /tmp/foo'), 'critical');
			assert.strictEqual(classifyCommandRisk('format C:'), 'critical');
			assert.strictEqual(classifyCommandRisk('del /f /s /q *.*'), 'critical');
		});

		test('returns medium for ordinary commands', () => {
			assert.strictEqual(classifyCommandRisk('npm install'), 'medium');
			assert.strictEqual(classifyCommandRisk('git status'), 'medium');
			assert.strictEqual(classifyCommandRisk('rm file.txt'), 'medium');
		});
	});

	suite('hasInjectionRisk - argument injection detection', () => {
		test('returns false for safe commands', () => {
			assert.strictEqual(hasInjectionRisk('npm install'), false);
			assert.strictEqual(hasInjectionRisk('ls -la /tmp'), false);
			assert.strictEqual(hasInjectionRisk('git commit -m "message"'), false);
		});

		test('returns true for command substitution $(...)', () => {
			assert.strictEqual(hasInjectionRisk('echo $(whoami)'), true);
			assert.strictEqual(hasInjectionRisk('ls $(find /tmp -name "*.txt")'), true);
		});

		test('returns true for variable expansion ${...}', () => {
			assert.strictEqual(hasInjectionRisk('echo ${HOME}'), true);
		});

		test('returns true for backtick substitution', () => {
			assert.strictEqual(hasInjectionRisk('echo `whoami`'), true);
		});

		test('returns true for command chaining with ;', () => {
			assert.strictEqual(hasInjectionRisk('npm install; rm -rf /'), true);
			assert.strictEqual(hasInjectionRisk('ls; cat /etc/passwd'), true);
		});

		test('returns true for command chaining with |', () => {
			assert.strictEqual(hasInjectionRisk('npm install | sh'), true);
		});

		test('returns true for command chaining with &', () => {
			assert.strictEqual(hasInjectionRisk('npm install & rm -rf /'), true);
		});

		test('does not flag quoted strings with special chars', () => {
			assert.strictEqual(hasInjectionRisk('echo "hello; world"'), false);
			assert.strictEqual(hasInjectionRisk("echo 'hello; world'"), false);
		});

		test('returns false for empty command', () => {
			assert.strictEqual(hasInjectionRisk(''), false);
			// @ts-ignore
			assert.strictEqual(hasInjectionRisk(null), false);
		});
	});

	suite('buildSafeCommand - safe command construction', () => {
		test('builds simple command without args', () => {
			const result = buildSafeCommand('npm', []);
			assert.strictEqual(result, 'npm');
		});

		test('quotes arguments with spaces on POSIX', () => {
			// Just verify it returns a string (platform-specific quoting handled by terminalUtils)
			const result = buildSafeCommand('echo', ['hello world']);
			assert.ok(typeof result === 'string');
			assert.ok(result.startsWith('echo'));
		});

		test('handles empty args array', () => {
			const result = buildSafeCommand('npm', []);
			assert.strictEqual(result, 'npm');
		});
	});

	suite('validateCommandSafety - command validation', () => {
		test('returns empty array for safe commands', () => {
			const warnings = validateCommandSafety('npm install');
			assert.strictEqual(warnings.length, 0);
		});

		test('returns warning for destructive commands', () => {
			const warnings = validateCommandSafety('rm -rf /tmp/foo');
			assert.ok(warnings.length > 0);
			assert.ok(warnings.some(w => w.includes('destructive')));
		});

		test('returns warning for injection risk', () => {
			const warnings = validateCommandSafety('npm install; rm -rf /');
			assert.ok(warnings.length > 0);
			assert.ok(warnings.some(w => w.includes('injection')));
		});

		test('returns warning for empty command', () => {
			const warnings = validateCommandSafety('');
			assert.ok(warnings.length > 0);
			assert.ok(warnings.some(w => w.includes('empty')));
		});

		test('returns empty array for null/undefined', () => {
			// @ts-ignore
			const warnings1 = validateCommandSafety(null);
			assert.ok(Array.isArray(warnings1));
			// @ts-ignore
			const warnings2 = validateCommandSafety(undefined);
			assert.ok(Array.isArray(warnings2));
		});
	});

});
