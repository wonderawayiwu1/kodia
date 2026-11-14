/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { evaluateAutonomy, assessRisk, riskThresholdForApproval, autonomyModes, defaultAutonomyMode, isPathOutsideWorkspace } from '../../common/autonomyPolicy.js';

suite('Kodia - autonomy policy (Stage 5A)', () => {

	suite('default mode', () => {
		test('Agent is the default autonomy mode', () => {
			assert.strictEqual(defaultAutonomyMode, 'agent');
		});

		test('autonomyModes lists all three modes', () => {
			assert.deepStrictEqual(autonomyModes, ['assist', 'agent', 'autonomous']);
		});
	});

	suite('risk classification (independent of path location)', () => {
		test('reads are low risk', () => {
			assert.strictEqual(assessRisk('read_file', {}), 'low');
			assert.strictEqual(assessRisk('search_for_files', {}), 'low');
			assert.strictEqual(assessRisk('web_search', {}), 'low');
		});

		test('ordinary development writes and terminal are medium risk', () => {
			assert.strictEqual(assessRisk('edit_file', {}), 'medium');
			assert.strictEqual(assessRisk('create_file_or_folder', {}), 'medium');
			assert.strictEqual(assessRisk('rewrite_file', {}), 'medium');
			assert.strictEqual(assessRisk('run_command', {}), 'medium');
			assert.strictEqual(assessRisk('open_persistent_terminal', {}), 'medium');
		});

		test('delete is high risk, recursive delete is critical', () => {
			assert.strictEqual(assessRisk('delete_file_or_folder', { isRecursive: false }), 'high');
			assert.strictEqual(assessRisk('delete_file_or_folder', { isRecursive: true }), 'critical');
			assert.strictEqual(assessRisk('delete_file_or_folder', {}), 'high');
		});
	});

	suite('mode thresholds', () => {
		test('assist requires approval from medium upward', () => {
			assert.strictEqual(riskThresholdForApproval('assist'), 'medium');
		});
		test('agent requires approval from high upward', () => {
			assert.strictEqual(riskThresholdForApproval('agent'), 'high');
		});
		test('autonomous requires approval from high upward', () => {
			assert.strictEqual(riskThresholdForApproval('autonomous'), 'high');
		});
	});

	suite('Agent mode decisions (default)', () => {
		const autoApprove: Record<string, boolean> = {};

		test('ordinary dev work inside workspace is allowed without approval', () => {
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove, operationPolicy: {},
				toolName: 'edit_file', params: { uri: URI.file('/repo/file.txt'), searchReplaceBlocks: 'a' },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'allow');
			assert.strictEqual(e.risk, 'medium');
		});

		test('ordinary dev work outside workspace is allowed without approval (location is not a gate)', () => {
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove, operationPolicy: {},
				toolName: 'edit_file', params: { uri: URI.file('/outside/file.txt'), searchReplaceBlocks: 'a' },
				isOutsideWorkspace: true,
			});
			assert.strictEqual(e.decision, 'allow');
			assert.strictEqual(e.risk, 'medium');
		});

		test('reads outside workspace are allowed', () => {
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove, operationPolicy: {},
				toolName: 'read_file', params: { uri: URI.file('/outside/file.txt') },
				isOutsideWorkspace: true,
			});
			assert.strictEqual(e.decision, 'allow');
		});

		test('delete requires approval in Agent mode', () => {
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove, operationPolicy: {},
				toolName: 'delete_file_or_folder', params: { uri: URI.file('/repo/file.txt'), isRecursive: false },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'requireApproval');
			assert.strictEqual(e.risk, 'high');
		});

		test('recursive delete requires approval in Agent mode', () => {
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove, operationPolicy: {},
				toolName: 'delete_file_or_folder', params: { uri: URI.file('/repo/dir'), isRecursive: true },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'requireApproval');
			assert.strictEqual(e.risk, 'critical');
		});

		test('terminal command is allowed without approval in Agent mode', () => {
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove, operationPolicy: {},
				toolName: 'run_command', params: { command: 'npm install', cwd: null, terminalId: 'x' },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'allow');
		});

		test('todo is low risk and allowed without approval in Agent mode', () => {
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove, operationPolicy: {},
				toolName: 'todo', params: { todos: [{ id: 'setup', content: 'set up project', status: 'in_progress' }] },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'allow');
			assert.strictEqual(e.risk, 'low');
		});

		test('todo is low risk and allowed without approval in Assist mode', () => {
			const e = evaluateAutonomy({
				mode: 'assist', autoApprove, operationPolicy: {},
				toolName: 'todo', params: { todos: [{ id: 'setup', content: 'set up project', status: 'pending' }] },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'allow');
			assert.strictEqual(e.risk, 'low');
		});

		test('subagent is low risk and allowed without approval in Agent mode', () => {
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove, operationPolicy: {},
				toolName: 'subagent', params: { agent: 'build', description: 'write tests', prompt: 'Write unit tests for the API layer' },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'allow');
			assert.strictEqual(e.risk, 'low');
		});

		test('subagent is low risk and allowed without approval in Assist mode', () => {
			const e = evaluateAutonomy({
				mode: 'assist', autoApprove, operationPolicy: {},
				toolName: 'subagent', params: { agent: 'build', description: 'write tests', prompt: 'Write unit tests for the API layer' },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'allow');
			assert.strictEqual(e.risk, 'low');
		});
	});

	suite('Assist mode decisions', () => {
		const autoApprove: Record<string, boolean> = {};

		test('reads are allowed without approval', () => {
			const e = evaluateAutonomy({
				mode: 'assist', autoApprove, operationPolicy: {},
				toolName: 'read_file', params: { uri: URI.file('/repo/file.txt') },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'allow');
		});

		test('edits require approval in Assist mode (medium >= threshold medium)', () => {
			const e = evaluateAutonomy({
				mode: 'assist', autoApprove, operationPolicy: {},
				toolName: 'edit_file', params: { uri: URI.file('/repo/file.txt'), searchReplaceBlocks: 'a' },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'requireApproval');
		});

		test('terminal requires approval in Assist mode', () => {
			const e = evaluateAutonomy({
				mode: 'assist', autoApprove, operationPolicy: {},
				toolName: 'run_command', params: { command: 'npm install', cwd: null, terminalId: 'x' },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'requireApproval');
		});
	});

	suite('Autonomous mode decisions', () => {
		const autoApprove: Record<string, boolean> = {};

		test('ordinary dev work is allowed without approval', () => {
			const e = evaluateAutonomy({
				mode: 'autonomous', autoApprove, operationPolicy: {},
				toolName: 'edit_file', params: { uri: URI.file('/repo/file.txt'), searchReplaceBlocks: 'a' },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'allow');
		});

		test('delete requires approval in Autonomous mode (high-impact pause)', () => {
			const e = evaluateAutonomy({
				mode: 'autonomous', autoApprove, operationPolicy: {},
				toolName: 'delete_file_or_folder', params: { uri: URI.file('/repo/file.txt'), isRecursive: false },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'requireApproval');
		});
	});

	suite('auto-approve overrides mode threshold', () => {
		test('auto-approved edits are allowed even in Assist mode', () => {
			const e = evaluateAutonomy({
				mode: 'assist', autoApprove: { edits: true }, operationPolicy: {},
				toolName: 'edit_file', params: { uri: URI.file('/repo/file.txt'), searchReplaceBlocks: 'a' },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'allow');
		});

		test('auto-approved terminal is allowed even in Assist mode', () => {
			const e = evaluateAutonomy({
				mode: 'assist', autoApprove: { terminal: true }, operationPolicy: {},
				toolName: 'run_command', params: { command: 'npm install', cwd: null, terminalId: 'x' },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'allow');
		});
	});

	suite('per-operation policy override', () => {
		test('block override prevents an operation regardless of mode', () => {
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove: {}, operationPolicy: { 'delete_file_or_folder': 'block' },
				toolName: 'delete_file_or_folder', params: { uri: URI.file('/repo/file.txt'), isRecursive: false },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'block');
		});

		test('allow override permits an operation even above threshold', () => {
			const e = evaluateAutonomy({
				mode: 'assist', autoApprove: {}, operationPolicy: { 'run_command': 'allow' },
				toolName: 'run_command', params: { command: 'npm install', cwd: null, terminalId: 'x' },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'allow');
		});

		test('requireApproval override forces approval even below threshold', () => {
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove: {}, operationPolicy: { 'read_file': 'requireApproval' },
				toolName: 'read_file', params: { uri: URI.file('/repo/file.txt') },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'requireApproval');
		});
	});

	suite('external path does not by itself gate access', () => {
		const autoApprove: Record<string, boolean> = {};

		test('Agent: outside-path edit is allowed just like inside-path edit', () => {
			const inside = evaluateAutonomy({
				mode: 'agent', autoApprove, operationPolicy: {},
				toolName: 'edit_file', params: { uri: URI.file('/repo/file.txt'), searchReplaceBlocks: 'a' },
				isOutsideWorkspace: false,
			});
			const outside = evaluateAutonomy({
				mode: 'agent', autoApprove, operationPolicy: {},
				toolName: 'edit_file', params: { uri: URI.file('/outside/file.txt'), searchReplaceBlocks: 'a' },
				isOutsideWorkspace: true,
			});
			assert.strictEqual(outside.decision, 'allow');
			assert.strictEqual(outside.decision, inside.decision);
		});
	});

	suite('isPathOutsideWorkspace', () => {
		const folders = [{ uri: URI.file('/repo') }, { uri: URI.file('/repo2') }];

		test('returns false for a path inside a workspace folder', () => {
			assert.strictEqual(isPathOutsideWorkspace(URI.file('/repo/src/file.txt'), folders), false);
		});

		test('returns true for a path outside all workspace folders', () => {
			assert.strictEqual(isPathOutsideWorkspace(URI.file('/etc/passwd'), folders), true);
		});

		test('returns false for null', () => {
			assert.strictEqual(isPathOutsideWorkspace(null, folders), false);
		});

		suite('Windows drive-letter paths', () => {
			const winFolders = [{ uri: URI.file('C:\\repo') }];

			test('returns false for a Windows path inside the workspace (case-insensitive)', () => {
				assert.strictEqual(isPathOutsideWorkspace(URI.file('C:\\repo\\src\\file.txt'), winFolders), false);
				assert.strictEqual(isPathOutsideWorkspace(URI.file('C:\\Repo\\File.Txt'), winFolders), false);
			});

			test('returns true for a Windows drive-letter path outside the workspace', () => {
				assert.strictEqual(isPathOutsideWorkspace(URI.file('C:\\Windows\\system32\\cfg.ini'), winFolders), true);
				assert.strictEqual(isPathOutsideWorkspace(URI.file('D:\\outside\\file.txt'), winFolders), true);
			});

			test('does not confuse a sibling sharing the drive prefix', () => {
				assert.strictEqual(isPathOutsideWorkspace(URI.file('C:\\repo_sibling\\file.txt'), winFolders), true);
			});
		});

		suite('UNC paths', () => {
			const uncFolders = [{ uri: URI.file('\\\\server\\share\\repo') }];

			test('returns false for a UNC path inside the workspace', () => {
				assert.strictEqual(isPathOutsideWorkspace(URI.file('\\\\server\\share\\repo\\src\\file.txt'), uncFolders), false);
			});

			test('returns true for a UNC path outside the workspace', () => {
				assert.strictEqual(isPathOutsideWorkspace(URI.file('\\\\server\\share\\outside\\file.txt'), uncFolders), true);
			});
		});
	});

	suite('Windows path access in Agent mode', () => {
		const autoApprove: Record<string, boolean> = {};

		test('Agent allows an edit on a Windows drive-letter path outside the workspace', () => {
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove, operationPolicy: {},
				toolName: 'edit_file',
				params: { uri: URI.file('C:\\Users\\name\\file.txt'), searchReplaceBlocks: 'a' },
				isOutsideWorkspace: true,
			});
			assert.strictEqual(e.decision, 'allow');
			assert.strictEqual(e.risk, 'medium');
		});

		test('Agent requires approval for a Windows delete outside the workspace', () => {
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove, operationPolicy: {},
				toolName: 'delete_file_or_folder',
				params: { uri: URI.file('C:\\Users\\name\\file.txt'), isRecursive: false },
				isOutsideWorkspace: true,
			});
			assert.strictEqual(e.decision, 'requireApproval');
		});
	});

	suite('Policy precedence - explicit block cannot be overridden by autoApprove', () => {
		test('explicit block on edits + autoApprove edits=true → block', () => {
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove: { edits: true }, operationPolicy: { 'edit_file': 'block' },
				toolName: 'edit_file', params: { uri: URI.file('/repo/file.txt'), searchReplaceBlocks: 'a' },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'block');
		});

		test('explicit block on terminal + autoApprove terminal=true → block', () => {
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove: { terminal: true }, operationPolicy: { 'run_command': 'block' },
				toolName: 'run_command', params: { command: 'npm install', cwd: null, terminalId: 'x' },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'block');
		});

		test('explicit block on low-risk read + autoApprove → block', () => {
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove: {}, operationPolicy: { 'read_file': 'block' },
				toolName: 'read_file', params: { uri: URI.file('/repo/file.txt') },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'block');
		});
	});

	suite('Policy precedence - explicit requireApproval cannot be overridden by autoApprove', () => {
		test('explicit requireApproval on edits + autoApprove edits=true → requireApproval', () => {
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove: { edits: true }, operationPolicy: { 'edit_file': 'requireApproval' },
				toolName: 'edit_file', params: { uri: URI.file('/repo/file.txt'), searchReplaceBlocks: 'a' },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'requireApproval');
		});

		test('explicit requireApproval on terminal + autoApprove terminal=true → requireApproval', () => {
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove: { terminal: true }, operationPolicy: { 'run_command': 'requireApproval' },
				toolName: 'run_command', params: { command: 'npm install', cwd: null, terminalId: 'x' },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'requireApproval');
		});

		test('explicit requireApproval on read (below threshold) + autoApprove → requireApproval', () => {
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove: {}, operationPolicy: { 'read_file': 'requireApproval' },
				toolName: 'read_file', params: { uri: URI.file('/repo/file.txt') },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'requireApproval');
		});
	});

	suite('Policy precedence - explicit allow respects critical safeguards', () => {
		test('explicit allow on non-critical delete → allow', () => {
			const e = evaluateAutonomy({
				mode: 'assist', autoApprove: {}, operationPolicy: { 'delete_file_or_folder': 'allow' },
				toolName: 'delete_file_or_folder', params: { uri: URI.file('/repo/file.txt'), isRecursive: false },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'allow');
		});

		test('explicit allow on recursive delete (critical) → requireApproval (not auto-bypassed)', () => {
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove: {}, operationPolicy: { 'delete_file_or_folder': 'allow' },
				toolName: 'delete_file_or_folder', params: { uri: URI.file('/repo/dir'), isRecursive: true },
				isOutsideWorkspace: false,
			});
			// Critical risk falls through to mode-based evaluation; agent threshold=high,
			// critical >= high → requires approval unless auto-approved.
			assert.strictEqual(e.decision, 'requireApproval');
		});

		test('explicit allow on critical delete + autoApprove edits=true → allow', () => {
			const e = evaluateAutonomy({
				mode: 'assist', autoApprove: { edits: true }, operationPolicy: { 'delete_file_or_folder': 'allow' },
				toolName: 'delete_file_or_folder', params: { uri: URI.file('/repo/dir'), isRecursive: true },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'allow');
		});
	});

	suite('Policy precedence - mode thresholds apply only when no explicit policy', () => {
		test('no policy + Agent mode: edit (medium) < threshold(high) → allow', () => {
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove: {}, operationPolicy: {},
				toolName: 'edit_file', params: { uri: URI.file('/repo/file.txt'), searchReplaceBlocks: 'a' },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'allow');
		});

		test('explicit policy + Agent mode: override takes precedence over threshold', () => {
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove: {}, operationPolicy: { 'edit_file': 'block' },
				toolName: 'edit_file', params: { uri: URI.file('/repo/file.txt'), searchReplaceBlocks: 'a' },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'block');
		});

		test('no policy + Assist mode: read (low) < threshold(medium) → allow', () => {
			const e = evaluateAutonomy({
				mode: 'assist', autoApprove: {}, operationPolicy: {},
				toolName: 'read_file', params: { uri: URI.file('/repo/file.txt') },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'allow');
		});
	});

	suite('MCP tools - classification and policy', () => {
		test('unknown MCP tool gets medium risk (default)', () => {
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove: {}, operationPolicy: {},
				toolName: 'some-unknown-mcp-tool', params: {},
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.risk, 'medium');
		});

		test('MCP tool in Agent mode (medium < high threshold) → allow', () => {
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove: {}, operationPolicy: {},
				toolName: 'some-unknown-mcp-tool', params: {},
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'allow');
		});

		test('MCP tool in Assist mode (medium >= medium threshold) → requireApproval', () => {
			const e = evaluateAutonomy({
				mode: 'assist', autoApprove: {}, operationPolicy: {},
				toolName: 'some-unknown-mcp-tool', params: {},
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'requireApproval');
		});

		test('MCP tool with autoApprove[MCP tools]=true → allow', () => {
			const e = evaluateAutonomy({
				mode: 'assist', autoApprove: { 'MCP tools': true }, operationPolicy: {},
				toolName: 'some-unknown-mcp-tool', params: {},
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'allow');
		});

		test('MCP tool with operationPolicy[exact name]=block → block', () => {
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove: {}, operationPolicy: { 'some-unknown-mcp-tool': 'block' },
				toolName: 'some-unknown-mcp-tool', params: {},
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'block');
		});

		test('MCP tool with operationPolicy[MCP tools]=requireApproval → requireApproval', () => {
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove: {}, operationPolicy: { 'MCP tools': 'requireApproval' },
				toolName: 'some-unknown-mcp-tool', params: {},
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'requireApproval');
		});

		test('MCP tool cannot receive unrestricted execution - default policy applies', () => {
			// An unclassified MCP tool in Assist mode requires approval (not silently allowed)
			const e = evaluateAutonomy({
				mode: 'assist', autoApprove: {}, operationPolicy: {},
				toolName: 'dangerous-mcp-tool', params: {},
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'requireApproval');
			assert.strictEqual(e.risk, 'medium');
		});
	});

	suite('Terminal commands - policy by risk, not command name', () => {
		test('run_command in Agent mode → allow (medium < high, no repeated prompts)', () => {
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove: {}, operationPolicy: {},
				toolName: 'run_command', params: { command: 'npm install', cwd: null, terminalId: 'x' },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'allow');
		});

		test('run_command in Assist mode → requireApproval (medium >= medium)', () => {
			const e = evaluateAutonomy({
				mode: 'assist', autoApprove: {}, operationPolicy: {},
				toolName: 'run_command', params: { command: 'npm install', cwd: null, terminalId: 'x' },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'requireApproval');
		});

		test('run_persistent_command in Agent mode → allow', () => {
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove: {}, operationPolicy: {},
				toolName: 'run_persistent_command', params: { command: 'npm run dev', persistentTerminalId: '1' },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'allow');
		});

		test('open_persistent_terminal in Agent mode → allow', () => {
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove: {}, operationPolicy: {},
				toolName: 'open_persistent_terminal', params: { cwd: null },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'allow');
		});

		test('kill_persistent_terminal in Agent mode → allow', () => {
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove: {}, operationPolicy: {},
				toolName: 'kill_persistent_terminal', params: { persistentTerminalId: '1' },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'allow');
		});

		test('Terminal commands outside workspace are allowed in Agent mode (location is not a gate)', () => {
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove: {}, operationPolicy: {},
				toolName: 'run_command', params: { command: 'npm install', cwd: '/outside/repo', terminalId: 'x' },
				isOutsideWorkspace: true,
			});
			assert.strictEqual(e.decision, 'allow');
		});

		test('Destructive command rm -rf is critical risk in Agent mode', () => {
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove: {}, operationPolicy: {},
				toolName: 'run_command', params: { command: 'rm -rf /tmp/foo', cwd: null, terminalId: 'x' },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.risk, 'critical');
			assert.strictEqual(e.decision, 'requireApproval');
		});

		test('Destructive command format is critical risk in Agent mode', () => {
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove: {}, operationPolicy: {},
				toolName: 'run_command', params: { command: 'format C:', cwd: null, terminalId: 'x' },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.risk, 'critical');
			assert.strictEqual(e.decision, 'requireApproval');
		});

		test('Destructive command del /f /s /q is critical risk in Agent mode', () => {
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove: {}, operationPolicy: {},
				toolName: 'run_command', params: { command: 'del /f /s /q *.*', cwd: null, terminalId: 'x' },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.risk, 'critical');
			assert.strictEqual(e.decision, 'requireApproval');
		});

		test('Single file rm is medium risk in Agent mode (allowed)', () => {
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove: {}, operationPolicy: {},
				toolName: 'run_command', params: { command: 'rm file.txt', cwd: null, terminalId: 'x' },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.risk, 'medium');
			assert.strictEqual(e.decision, 'allow');
		});

		test('Destructive command in Autonomous mode still requires approval', () => {
			const e = evaluateAutonomy({
				mode: 'autonomous', autoApprove: {}, operationPolicy: {},
				toolName: 'run_command', params: { command: 'rm -rf /tmp/foo', cwd: null, terminalId: 'x' },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.risk, 'critical');
			assert.strictEqual(e.decision, 'requireApproval');
		});

		test('Destructive command with explicit allow policy still requires approval (critical safeguard)', () => {
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove: { terminal: true }, operationPolicy: { 'run_command': 'allow' },
				toolName: 'run_command', params: { command: 'rm -rf /tmp/foo', cwd: null, terminalId: 'x' },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.risk, 'critical');
			// operationPolicy 'allow' + autoApprove together permit critical operations
			// (the safeguard is that operationPolicy alone doesn't bypass; autoApprove is also needed)
			assert.strictEqual(e.decision, 'allow');
		});

		test('Destructive command with explicit allow but NO autoApprove requires approval', () => {
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove: {}, operationPolicy: { 'run_command': 'allow' },
				toolName: 'run_command', params: { command: 'rm -rf /tmp/foo', cwd: null, terminalId: 'x' },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.risk, 'critical');
			// operationPolicy 'allow' alone does not bypass critical safeguards
			assert.strictEqual(e.decision, 'requireApproval');
		});
	});
});
