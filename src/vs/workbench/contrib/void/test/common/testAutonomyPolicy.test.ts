/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import {
	evaluateAutonomy, assessRisk, riskThresholdForApproval,
} from '../../common/autonomyPolicy.js';

// ============================================================================
// Tests for Test Discovery and Execution autonomy policy
// ============================================================================

suite('Kodia - Test Discovery and Execution Autonomy Policy (Stage 3)', () => {

	suite('assessRisk - test tools', () => {
		test('test_discover is low risk', () => {
			assert.strictEqual(assessRisk('test_discover', {}), 'low');
		});
		test('test_list is low risk', () => {
			assert.strictEqual(assessRisk('test_list', {}), 'low');
		});
		test('test_cancel is low risk', () => {
			assert.strictEqual(assessRisk('test_cancel', {}), 'low');
		});

		test('test_run is medium risk', () => {
			assert.strictEqual(assessRisk('test_run', {}), 'medium');
		});
		test('test_run_targeted is medium risk', () => {
			assert.strictEqual(assessRisk('test_run_targeted', {}), 'medium');
		});
		test('test_rerun_failed is medium risk', () => {
			assert.strictEqual(assessRisk('test_rerun_failed', {}), 'medium');
		});
	});

	suite('evaluateAutonomy - test tools in Agent mode', () => {
		const autoApprove: Record<string, boolean> = {};

		test('test_discover is allowed in Agent mode (low < high)', () => {
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove, operationPolicy: {},
				toolName: 'test_discover', params: {},
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'allow');
			assert.strictEqual(e.risk, 'low');
		});

		test('test_list is allowed in Agent mode', () => {
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove, operationPolicy: {},
				toolName: 'test_list', params: {},
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'allow');
			assert.strictEqual(e.risk, 'low');
		});

		test('test_run requires approval in Assist mode (medium >= medium)', () => {
			const e = evaluateAutonomy({
				mode: 'assist', autoApprove, operationPolicy: {},
				toolName: 'test_run', params: { test_files: ['/test/file.test.ts'] },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'requireApproval');
			assert.strictEqual(e.risk, 'medium');
		});

		test('test_run is allowed in Agent mode (medium < high)', () => {
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove, operationPolicy: {},
				toolName: 'test_run', params: { test_files: ['/test/file.test.ts'] },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'allow');
			assert.strictEqual(e.risk, 'medium');
		});

		test('test_run is allowed in Autonomous mode (medium < high)', () => {
			const e = evaluateAutonomy({
				mode: 'autonomous', autoApprove, operationPolicy: {},
				toolName: 'test_run', params: { test_files: ['/test/file.test.ts'] },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'allow');
			assert.strictEqual(e.risk, 'medium');
		});

		test('test_rerun_failed requires approval in Assist mode', () => {
			const e = evaluateAutonomy({
				mode: 'assist', autoApprove, operationPolicy: {},
				toolName: 'test_rerun_failed', params: {},
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'requireApproval');
			assert.strictEqual(e.risk, 'medium');
		});

		test('test_cancel is allowed in all modes (low risk)', () => {
			for (const mode of ['assist', 'agent', 'autonomous'] as const) {
				const e = evaluateAutonomy({
					mode, autoApprove, operationPolicy: {},
					toolName: 'test_cancel', params: { run_id: 'run-1' },
					isOutsideWorkspace: false,
				});
				assert.strictEqual(e.decision, 'allow', `${mode}: test_cancel should be allowed`);
				assert.strictEqual(e.risk, 'low');
			}
		});
	});

	suite('evaluateAutonomy - test tools with autoApprove', () => {
		test('test_run with autoApprove test is allowed in Assist mode', () => {
			const e = evaluateAutonomy({
				mode: 'assist', autoApprove: { test: true }, operationPolicy: {},
				toolName: 'test_run', params: { test_files: ['/test/file.test.ts'] },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'allow');
			assert.strictEqual(e.risk, 'medium');
		});

		test('test_run_targeted with autoApprove test is allowed in Assist mode', () => {
			const e = evaluateAutonomy({
				mode: 'assist', autoApprove: { test: true }, operationPolicy: {},
				toolName: 'test_run_targeted', params: { changed_files: ['/test/file.ts'] },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'allow');
			assert.strictEqual(e.risk, 'medium');
		});
	});

	suite('Policy precedence - test explicit operation policy', () => {

		test('explicit block on test_run overrides autoApprove', () => {
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove: { test: true }, operationPolicy: { 'test_run': 'block' },
				toolName: 'test_run', params: { test_files: ['/test/file.test.ts'] },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'block');
		});

		test('explicit allow on test_run permits in Assist mode', () => {
			const e = evaluateAutonomy({
				mode: 'assist', autoApprove: {}, operationPolicy: { 'test_run': 'allow' },
				toolName: 'test_run', params: { test_files: ['/test/file.test.ts'] },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'allow');
		});
	});

	suite('riskThresholdForApproval', () => {
		test('assist threshold is medium - test_run requires approval', () => {
			assert.strictEqual(riskThresholdForApproval('assist'), 'medium');
			const e = evaluateAutonomy({
				mode: 'assist', autoApprove: {}, operationPolicy: {},
				toolName: 'test_run', params: { test_files: ['/test/file.test.ts'] },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'requireApproval');
		});

		test('agent threshold is high - test_run is allowed without approval', () => {
			assert.strictEqual(riskThresholdForApproval('agent'), 'high');
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove: {}, operationPolicy: {},
				toolName: 'test_run', params: { test_files: ['/test/file.test.ts'] },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'allow');
		});

		test('autonomous threshold is high - test_run is allowed without approval', () => {
			assert.strictEqual(riskThresholdForApproval('autonomous'), 'high');
			const e = evaluateAutonomy({
				mode: 'autonomous', autoApprove: {}, operationPolicy: {},
				toolName: 'test_run', params: { test_files: ['/test/file.test.ts'] },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'allow');
		});
	});

});
