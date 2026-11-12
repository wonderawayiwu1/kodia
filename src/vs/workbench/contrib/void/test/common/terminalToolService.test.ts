/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { evaluateAutonomy, assessRisk, riskThresholdForApproval, defaultAutonomyMode, autonomyModes } from '../../common/autonomyPolicy.js';
import { quotePowerShellArg, buildPowerShellCommand, isPowerShellPlatform, computeIncrementalRead } from '../../common/terminalUtils.js';

suite('Kodia - Terminal Execution Engine (Stage 5A Day 1)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	suite('PowerShell quoting utilities', () => {
		test('quotePowerShellArg: empty string returns empty quotes', () => {
			assert.strictEqual(quotePowerShellArg(''), '""');
		});

		test('quotePowerShellArg: simple word passes through unquoted', () => {
			assert.strictEqual(quotePowerShellArg('hello'), 'hello');
			assert.strictEqual(quotePowerShellArg('npm'), 'npm');
			assert.strictEqual(quotePowerShellArg('dir'), 'dir');
		});

		test('quotePowerShellArg: path with spaces is quoted', () => {
			const result = quotePowerShellArg('C:\\Program Files\\nodejs\\npm');
			assert.ok(result.startsWith('"') && result.endsWith('"'));
			assert.strictEqual(result, '"C:\\Program Files\\nodejs\\npm"');
		});

		test('quotePowerShellArg: Unicode path passes through unquoted (not special chars)', () => {
			const result = quotePowerShellArg('C:\\Users\\用户\\文档\\file.txt');
			// Unicode chars are not PowerShell special chars, so no quoting needed
			assert.strictEqual(result, 'C:\\Users\\用户\\文档\\file.txt');
		});

		test('quotePowerShellArg: path with double quotes escapes them', () => {
			const result = quotePowerShellArg('say "hello"');
			assert.ok(result.includes('`"'));
		});

		test('quotePowerShellArg: path with backtick escapes them', () => {
			const result = quotePowerShellArg('`echo');
			assert.ok(result.includes('``'));
		});

		test('quotePowerShellArg: special PowerShell chars are quoted', () => {
			for (const ch of ['$', '(', ')', '{', '}', ';', '|', '&', '<', '>']) {
				const result = quotePowerShellArg(`test${ch}value`);
				assert.ok(result.startsWith('"') && result.endsWith('"'), `Failed for char: ${ch}`);
			}
		});

		test('buildPowerShellCommand: builds command with quoted args', () => {
			const result = buildPowerShellCommand('npm', ['install', 'express']);
			assert.strictEqual(result, 'npm install express');
		});

		test('buildPowerShellCommand: quotes args with spaces', () => {
			const result = buildPowerShellCommand('type', ['C:\\My Docs\\file.txt']);
			assert.ok(result.includes('"C:\\My Docs\\file.txt"'));
		});

		test('isPowerShellPlatform: returns boolean', () => {
			assert.ok(typeof isPowerShellPlatform === 'boolean');
		});
	});

	suite('evaluateAutonomy for terminal tools', () => {
		const autoApprove: Record<string, boolean> = {};

		test('list_terminals (low risk) is allowed in all modes', () => {
			for (const mode of ['assist', 'agent', 'autonomous'] as const) {
				const e = evaluateAutonomy({
					mode, autoApprove, operationPolicy: {},
					toolName: 'list_terminals', params: {},
					isOutsideWorkspace: false,
				});
				assert.strictEqual(e.decision, 'allow', `${mode}: list_terminals should be allowed`);
				assert.strictEqual(e.risk, 'low');
			}
		});

		test('read_terminal (low risk) is allowed in all modes', () => {
			for (const mode of ['assist', 'agent', 'autonomous'] as const) {
				const e = evaluateAutonomy({
					mode, autoApprove, operationPolicy: {},
					toolName: 'read_terminal', params: { terminalId: '1' },
					isOutsideWorkspace: false,
				});
				assert.strictEqual(e.decision, 'allow', `${mode}: read_terminal should be allowed`);
				assert.strictEqual(e.risk, 'low');
			}
		});

		test('send_command_to_terminal (medium risk) is allowed in Agent mode', () => {
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove, operationPolicy: {},
				toolName: 'send_command_to_terminal', params: { terminalId: '1', command: 'npm install' },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'allow');
			assert.strictEqual(e.risk, 'medium');
		});

		test('send_command_to_terminal (medium risk) requires approval in Assist mode', () => {
			const e = evaluateAutonomy({
				mode: 'assist', autoApprove, operationPolicy: {},
				toolName: 'send_command_to_terminal', params: { terminalId: '1', command: 'npm install' },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'requireApproval');
			assert.strictEqual(e.risk, 'medium');
		});

		test('interrupt_terminal (medium risk) is allowed in Agent mode', () => {
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove, operationPolicy: {},
				toolName: 'interrupt_terminal', params: { terminalId: '1' },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'allow');
		});

		test('close_terminal (medium risk) requires approval in Assist mode', () => {
			const e = evaluateAutonomy({
				mode: 'assist', autoApprove, operationPolicy: {},
				toolName: 'close_terminal', params: { terminalId: '1' },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'requireApproval');
		});

		test('explicit block on send_command_to_terminal overrides autoApprove', () => {
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove: { terminal: true }, operationPolicy: { 'send_command_to_terminal': 'block' },
				toolName: 'send_command_to_terminal', params: { terminalId: '1', command: 'npm install' },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'block');
		});

		test('commands outside workspace allowed in Agent mode', () => {
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove, operationPolicy: {},
				toolName: 'send_command_to_terminal', params: { terminalId: '1', command: 'dir C:\\Outside' },
				isOutsideWorkspace: true,
			});
			assert.strictEqual(e.decision, 'allow');
		});

		test('risk classification for terminal tools', () => {
			assert.strictEqual(assessRisk('list_terminals', {}), 'low');
			assert.strictEqual(assessRisk('read_terminal', {}), 'low');
			assert.strictEqual(assessRisk('send_command_to_terminal', {}), 'medium');
			assert.strictEqual(assessRisk('interrupt_terminal', {}), 'medium');
			assert.strictEqual(assessRisk('close_terminal', {}), 'medium');
		});
	});

	suite('mode thresholds for terminal tools', () => {
		test('agent threshold (high) allows medium-risk terminal tools', () => {
			assert.strictEqual(riskThresholdForApproval('agent'), 'high');
			// send_command_to_terminal is medium, which is < high, so allowed
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove: {}, operationPolicy: {},
				toolName: 'send_command_to_terminal', params: { terminalId: '1', command: 'npm install' },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'allow');
		});

		test('assist threshold (medium) requires approval for medium-risk terminal tools', () => {
			assert.strictEqual(riskThresholdForApproval('assist'), 'medium');
			const e = evaluateAutonomy({
				mode: 'assist', autoApprove: {}, operationPolicy: {},
				toolName: 'send_command_to_terminal', params: { terminalId: '1', command: 'npm install' },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'requireApproval');
		});

		test('autoApprove terminal overrides assist threshold', () => {
			const e = evaluateAutonomy({
				mode: 'assist', autoApprove: { terminal: true }, operationPolicy: {},
				toolName: 'send_command_to_terminal', params: { terminalId: '1', command: 'npm install' },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'allow');
		});
	});

	suite('default mode and settings', () => {
		test('Agent is the default autonomy mode', () => {
			assert.strictEqual(defaultAutonomyMode, 'agent');
		});

		test('autonomyModes lists all three modes', () => {
			assert.deepStrictEqual(autonomyModes, ['assist', 'agent', 'autonomous']);
		});
	});

	suite('computeIncrementalRead - offset logic', () => {
		test('first incremental read returns all output', () => {
			const result = computeIncrementalRead('hello\nworld\n', 0, undefined);
			assert.strictEqual(result.output, 'hello\nworld\n');
			assert.strictEqual(result.isAtEnd, false);
			assert.strictEqual(result.nextStoredOffset, 12);
		});

		test('repeated reads without new output return empty', () => {
			const first = computeIncrementalRead('hello\nworld\n', 0, undefined);
			assert.strictEqual(first.nextStoredOffset, 12);

			const second = computeIncrementalRead('hello\nworld\n', 12, undefined);
			assert.strictEqual(second.output, '');
			assert.strictEqual(second.isAtEnd, true);
			assert.strictEqual(second.nextStoredOffset, 12);
		});

		test('new output between reads returns only new output', () => {
			const first = computeIncrementalRead('hello\n', 0, undefined);
			assert.strictEqual(first.output, 'hello\n');
			assert.strictEqual(first.nextStoredOffset, 6);

			const second = computeIncrementalRead('hello\nworld\n', 6, undefined);
			assert.strictEqual(second.output, 'world\n');
			assert.strictEqual(second.isAtEnd, false);
			assert.strictEqual(second.nextStoredOffset, 12);
		});

		test('explicit offset supplied by caller starts from that offset', () => {
			const result = computeIncrementalRead('hello\nworld\n', 0, 6);
			assert.strictEqual(result.output, 'world\n');
			assert.strictEqual(result.nextStoredOffset, 12);
		});

		test('offset lower than internally stored offset re-reads but advances forward', () => {
			// Internal offset is 10 (already read "hello\nworl"), caller asks for offset 4
			const result = computeIncrementalRead('hello\nworld\n', 10, 4);
			assert.strictEqual(result.output, 'o\nworld\n');
			assert.strictEqual(result.nextStoredOffset, 12); // advanced forward, not backward
		});

		test('offset beyond available output returns empty', () => {
			const result = computeIncrementalRead('hello\n', 0, 100);
			assert.strictEqual(result.output, '');
			assert.strictEqual(result.isAtEnd, true);
			assert.strictEqual(result.nextStoredOffset, 6); // fullOutput.length
		});

		test('negative offset is clamped to 0', () => {
			const result = computeIncrementalRead('hello\n', 0, -5);
			assert.strictEqual(result.output, 'hello\n');
			assert.strictEqual(result.nextStoredOffset, 6);
		});

		test('offset exactly at end returns empty', () => {
			const result = computeIncrementalRead('hello\n', 6, 6);
			assert.strictEqual(result.output, '');
			assert.strictEqual(result.isAtEnd, true);
			assert.strictEqual(result.nextStoredOffset, 6);
		});

		test('internal offset never moves backward after caller offset causes re-read', () => {
			// First read advances internal offset to 12
			const first = computeIncrementalRead('hello\nworld\n', 0, undefined);
			assert.strictEqual(first.nextStoredOffset, 12);

			// Caller re-reads from offset 0 using stored offset 12
			const second = computeIncrementalRead('hello\nworld\n', 12, 0);
			assert.strictEqual(second.output, 'hello\nworld\n');
			assert.strictEqual(second.nextStoredOffset, 12); // stays at 12, not 0
		});
	});
});
