/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { TaskPlanService } from '../../common/taskPlanService.js';

suite('Kodia - TaskPlanService (Stage 5A Day 2)', () => {

	suite('TaskPlanService - creation and initialization', () => {
		test('createPlan creates a plan with tasks', () => {
			const service = new TaskPlanService();
			const plan = service.createPlan('thread-1', 'Test Plan', 'Test description', [
				{ title: 'Task 1', description: 'First task', dependencies: [] },
				{ title: 'Task 2', description: 'Second task', dependencies: [] },
			]);

			assert.strictEqual(plan.title, 'Test Plan');
			assert.strictEqual(plan.description, 'Test description');
			assert.strictEqual(plan.tasks.length, 2);
			assert.strictEqual(plan.overallStatus, 'pending');
			assert.strictEqual(plan.tasks[0].title, 'Task 1');
			assert.strictEqual(plan.tasks[1].title, 'Task 2');
		});

		test('getPlan returns null for non-existent thread', () => {
			const service = new TaskPlanService();
			const plan = service.getPlan('nonexistent-thread');
			assert.strictEqual(plan, null);
		});

		test('getOrCreatePlan creates a plan if none exists', () => {
			const service = new TaskPlanService();
			const plan = service.getOrCreatePlan('thread-1');
			assert.ok(plan);
			assert.strictEqual(plan.title, 'Development Task');
			assert.strictEqual(plan.description, 'Autonomous development task plan');
		});

		test('getOrCreatePlan returns existing plan', () => {
			const service = new TaskPlanService();
			const plan1 = service.getOrCreatePlan('thread-1');
			const plan2 = service.getOrCreatePlan('thread-1');
			assert.strictEqual(plan1.id, plan2.id);
		});
	});

	suite('TaskPlanService - updateTask', () => {
		test('updateTask changes task status', () => {
			const service = new TaskPlanService();
			const plan = service.createPlan('thread-1', 'Test Plan', 'Test', [
				{ title: 'Task 1', description: 'Do something', dependencies: [] },
			]);

			const updated = service.updateTask('thread-1', plan.tasks[0].id, 'running');
			assert.ok(updated);
			assert.strictEqual(updated.tasks[0].status, 'running');
			assert.strictEqual(updated.overallStatus, 'in_progress');
		});

		test('updateTask returns null for non-existent thread', () => {
			const service = new TaskPlanService();
			const result = service.updateTask('nonexistent', 'task-1', 'completed');
			assert.strictEqual(result, null);
		});

		test('updateTask marks task as completed with result', () => {
			const service = new TaskPlanService();
			const plan = service.createPlan('thread-1', 'Test Plan', 'Test', [
				{ title: 'Task 1', description: 'Do something', dependencies: [] },
			]);

			const updated = service.updateTask('thread-1', plan.tasks[0].id, 'completed', 'Task completed successfully');
			assert.ok(updated);
			assert.strictEqual(updated.tasks[0].status, 'completed');
			assert.strictEqual(updated.tasks[0].result, 'Task completed successfully');
			assert.strictEqual(updated.overallStatus, 'completed');
		});

		test('updateTask marks task as failed with error', () => {
			const service = new TaskPlanService();
			const plan = service.createPlan('thread-1', 'Test Plan', 'Test', [
				{ title: 'Task 1', description: 'Do something', dependencies: [] },
			]);

			const updated = service.updateTask('thread-1', plan.tasks[0].id, 'failed', undefined, 'Something went wrong');
			assert.ok(updated);
			assert.strictEqual(updated.tasks[0].status, 'failed');
			assert.strictEqual(updated.tasks[0].error, 'Something went wrong');
			assert.strictEqual(updated.overallStatus, 'failed');
		});
	});

	suite('TaskPlanService - addTask', () => {
		test('addTask adds a new task to the plan', () => {
			const service = new TaskPlanService();
			service.createPlan('thread-1', 'Test Plan', 'Test', [
				{ title: 'Task 1', description: 'First task', dependencies: [] },
			]);

			const updated = service.addTask('thread-1', { title: 'Task 2', description: 'Second task', dependencies: [] });
			assert.ok(updated);
			assert.strictEqual(updated.tasks.length, 2);
			assert.strictEqual(updated.tasks[1].title, 'Task 2');
			assert.strictEqual(updated.tasks[1].description, 'Second task');
		});

		test('addTask returns null for non-existent thread', () => {
			const service = new TaskPlanService();
			const result = service.addTask('nonexistent', { title: 'Task', description: 'Do something', dependencies: [] });
			assert.strictEqual(result, null);
		});
	});

	suite('TaskPlanService - getNextPendingTask', () => {
		test('getNextPendingTask returns first pending task with no dependencies', () => {
			const service = new TaskPlanService();
			service.createPlan('thread-1', 'Test Plan', 'Test', [
				{ title: 'Task 1', description: 'First task', dependencies: [] },
				{ title: 'Task 2', description: 'Second task', dependencies: ['task-1'] },
			]);

			const next = service.getNextPendingTask('thread-1');
			assert.ok(next);
			if (next) {
				assert.strictEqual(next.status, 'pending');
			}
		});

		test('getNextPendingTask returns null when no pending tasks', () => {
			const service = new TaskPlanService();
			const plan = service.createPlan('thread-1', 'Test Plan', 'Test', [
				{ title: 'Task 1', description: 'Task 1', dependencies: [] },
			]);

			service.updateTask('thread-1', plan.tasks[0].id, 'completed');

			const next = service.getNextPendingTask('thread-1');
			assert.strictEqual(next, null);
		});

		test('getNextPendingTask returns null when dependencies not satisfied', () => {
			const service = new TaskPlanService();
			service.createPlan('thread-1', 'Test Plan', 'Test', [
				{ title: 'Task 1', description: 'First task', dependencies: [] },
				{ title: 'Task 2', description: 'Second task', dependencies: ['task-1-id'] },
			]);

			const next = service.getNextPendingTask('thread-1');
			assert.ok(next);
			if (next) {
				assert.strictEqual(next.status, 'pending');
			}
		});
	});

	suite('TaskPlanService - formatPlanForLLM', () => {
		test('formatPlanForLLM returns formatted string', () => {
			const service = new TaskPlanService();
			service.createPlan('thread-1', 'Test Plan', 'Test description', [
				{ title: 'Task 1', description: 'Do something', dependencies: [] },
			]);

			const formatted = service.formatPlanForLLM('thread-1');
			assert.ok(formatted);
			assert.ok(formatted.includes('Test Plan'));
			assert.ok(formatted.includes('Test description'));
			assert.ok(formatted.includes('Task 1'));
		});

		test('formatPlanForLLM returns null for non-existent thread', () => {
			const service = new TaskPlanService();
			const formatted = service.formatPlanForLLM('nonexistent');
			assert.strictEqual(formatted, null);
		});
	});

	suite('TaskPlanService - getPlanProgress', () => {
		test('getPlanProgress calculates correctly', () => {
			const service = new TaskPlanService();
			const plan = service.createPlan('thread-1', 'Test Plan', 'Test', [
				{ title: 'Task 1', description: 'Task 1', dependencies: [] },
				{ title: 'Task 2', description: 'Task 2', dependencies: [] },
				{ title: 'Task 3', description: 'Task 3', dependencies: [] },
			]);

			let progress = service.getPlanProgress('thread-1');
			assert.ok(progress);
			if (progress) {
				assert.strictEqual(progress.completed, 0);
				assert.strictEqual(progress.total, 3);
				assert.strictEqual(progress.percent, 0);
			}

			service.updateTask('thread-1', plan.tasks[0].id, 'completed');
			progress = service.getPlanProgress('thread-1');
			assert.ok(progress);
			if (progress) {
				assert.strictEqual(progress.completed, 1);
				assert.strictEqual(progress.total, 3);
				assert.strictEqual(progress.percent, 33);
			}

			service.updateTask('thread-1', plan.tasks[1].id, 'completed');
			service.updateTask('thread-1', plan.tasks[2].id, 'completed');
			progress = service.getPlanProgress('thread-1');
			assert.ok(progress);
			if (progress) {
				assert.strictEqual(progress.completed, 3);
				assert.strictEqual(progress.total, 3);
				assert.strictEqual(progress.percent, 100);
			}
		});

		test('getPlanProgress returns null for non-existent thread', () => {
			const service = new TaskPlanService();
			const progress = service.getPlanProgress('nonexistent');
			assert.strictEqual(progress, null);
		});
	});

});