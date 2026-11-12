/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import {
	evaluateAutonomy, assessRisk,
} from '../../common/autonomyPolicy.js';
import {
	newTaskPlan, newTask, addTask, updateTaskStatus,
	getNextPendingTask, getPlanProgress, formatTaskPlanForLLM,
	TaskStatus,
} from '../../common/autonomousTask.js';

suite('Kodia - Autonomy Policy - Task Plan Tools (Stage 5A Day 2)', () => {

	suite('assessRisk - task plan tools', () => {
		test('create_task_plan is low risk', () => {
			assert.strictEqual(assessRisk('create_task_plan', {}), 'low');
		});
		test('update_task_plan is low risk', () => {
			assert.strictEqual(assessRisk('update_task_plan', {}), 'low');
		});
		test('get_task_plan is low risk', () => {
			assert.strictEqual(assessRisk('get_task_plan', {}), 'low');
		});
	});

	suite('evaluateAutonomy - task plan tools in Agent mode', () => {
		const autoApprove: Record<string, boolean> = {};

		test('create_task_plan is allowed in Agent mode (low < high)', () => {
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove, operationPolicy: {},
				toolName: 'create_task_plan', params: { title: 'Test', description: 'Test', tasks: [] },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'allow');
			assert.strictEqual(e.risk, 'low');
		});

		test('update_task_plan is allowed in Agent mode', () => {
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove, operationPolicy: {},
				toolName: 'update_task_plan', params: { taskId: 't1', status: 'completed' },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'allow');
			assert.strictEqual(e.risk, 'low');
		});

		test('get_task_plan is allowed in Agent mode', () => {
			const e = evaluateAutonomy({
				mode: 'agent', autoApprove, operationPolicy: {},
				toolName: 'get_task_plan', params: {},
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'allow');
			assert.strictEqual(e.risk, 'low');
		});

		test('task plan tools are allowed in Assist mode (low < medium)', () => {
			const e = evaluateAutonomy({
				mode: 'assist', autoApprove, operationPolicy: {},
				toolName: 'create_task_plan', params: { title: 'Test', description: 'Test', tasks: [] },
				isOutsideWorkspace: false,
			});
			assert.strictEqual(e.decision, 'allow');
		});
	});

	suite('TaskPlan - creation and structure', () => {
		test('newTaskPlan creates a valid plan', () => {
			const plan = newTaskPlan('Build App', 'Build a todo app');
			assert.strictEqual(plan.title, 'Build App');
			assert.strictEqual(plan.description, 'Build a todo app');
			assert.strictEqual(plan.overallStatus, 'pending');
			assert.strictEqual(plan.tasks.length, 0);
			assert.ok(plan.id.startsWith('task-plan-'));
			assert.ok(plan.createdAt);
			assert.ok(plan.updatedAt);
		});

		test('newTask creates a valid task', () => {
			const task = newTask('Write code', 'Write the main component', ['t1']);
			assert.strictEqual(task.title, 'Write code');
			assert.strictEqual(task.description, 'Write the main component');
			assert.strictEqual(task.status, 'pending');
			assert.deepStrictEqual(task.dependencies, ['t1']);
			assert.ok(task.id.startsWith('task-'));
		});

		test('addTask adds a task to the plan', () => {
			const plan = newTaskPlan('Test', 'Test');
			const task = newTask('Task 1', 'Do something');
			const updated = addTask(plan, task);
			assert.strictEqual(updated.tasks.length, 1);
			assert.strictEqual(updated.tasks[0].title, 'Task 1');
			assert.ok(updated.updatedAt >= plan.updatedAt);
		});
	});

	suite('TaskPlan - status transitions', () => {
		test('updateTaskStatus changes status and updates overall status', () => {
			const plan = newTaskPlan('Test', 'Test');
			const task = newTask('Task 1', 'Do something');
			const planWithTask = addTask(plan, task);

			const updated = updateTaskStatus(planWithTask, task.id, 'running');
			assert.strictEqual(updated.tasks[0].status, 'running');
			assert.strictEqual(updated.overallStatus, 'in_progress');
		});

		test('updateTaskStatus with result stores the result', () => {
			const plan = newTaskPlan('Test', 'Test');
			const task = newTask('Task 1', 'Do something');
			const planWithTask = addTask(plan, task);

			const updated = updateTaskStatus(planWithTask, task.id, 'completed', 'Task completed successfully');
			assert.strictEqual(updated.tasks[0].status, 'completed');
			assert.strictEqual(updated.tasks[0].result, 'Task completed successfully');
			assert.strictEqual(updated.overallStatus, 'completed');
		});

		test('updateTaskStatus with error stores the error', () => {
			const plan = newTaskPlan('Test', 'Test');
			const task = newTask('Task 1', 'Do something');
			const planWithTask = addTask(plan, task);

			const updated = updateTaskStatus(planWithTask, task.id, 'failed', undefined, 'Something went wrong');
			assert.strictEqual(updated.tasks[0].status, 'failed');
			assert.strictEqual(updated.tasks[0].error, 'Something went wrong');
			assert.strictEqual(updated.overallStatus, 'failed');
		});
	});

	suite('TaskPlan - task dependencies', () => {
		test('getNextPendingTask returns tasks with satisfied dependencies', () => {
			const plan = newTaskPlan('Test', 'Test');
			let p = addTask(plan, newTask('Task 1', 'First task'));
			const task1Id = p.tasks[0].id;
			p = addTask(p, newTask('Task 2', 'Second task', [task1Id]));
			const task2Id = p.tasks[1].id;

			// Initially, only task 1 is ready
			const next1 = getNextPendingTask(p);
			assert.strictEqual(next1?.id, task1Id);

			// After task 1 is done, task 2 is ready
			p = updateTaskStatus(p, task1Id, 'completed');
			const next2 = getNextPendingTask(p);
			assert.strictEqual(next2?.id, task2Id);
		});

		test('getNextPendingTask returns null when all tasks are complete', () => {
			const plan = newTaskPlan('Test', 'Test');
			let p = addTask(plan, newTask('Task 1', 'Do something'));
			p = updateTaskStatus(p, p.tasks[0].id, 'completed');
			const next = getNextPendingTask(p);
			assert.strictEqual(next, null);
		});
	});

	suite('TaskPlan - progress tracking', () => {
		test('getPlanProgress calculates correctly', () => {
			const plan = newTaskPlan('Test', 'Test');
			let p = addTask(plan, newTask('Task 1', 'Task 1'));
			p = addTask(p, newTask('Task 2', 'Task 2'));
			p = addTask(p, newTask('Task 3', 'Task 3'));

			let progress = getPlanProgress(p);
			assert.strictEqual(progress.completed, 0);
			assert.strictEqual(progress.total, 3);
			assert.strictEqual(progress.percent, 0);

			p = updateTaskStatus(p, p.tasks[0].id, 'completed');
			progress = getPlanProgress(p);
			assert.strictEqual(progress.completed, 1);
			assert.strictEqual(progress.total, 3);
			assert.strictEqual(progress.percent, 33);

			p = updateTaskStatus(p, p.tasks[1].id, 'completed');
			p = updateTaskStatus(p, p.tasks[2].id, 'completed');
			progress = getPlanProgress(p);
			assert.strictEqual(progress.completed, 3);
			assert.strictEqual(progress.total, 3);
			assert.strictEqual(progress.percent, 100);
		});
	});

	suite('formatTaskPlanForLLM', () => {
		test('formats a plan for LLM consumption', () => {
			const plan = newTaskPlan('Build App', 'Build a todo app');
			let p = addTask(plan, newTask('Create files', 'Create project files'));
			p = addTask(p, newTask('Install deps', 'Install dependencies', [p.tasks[0].id]));

			const formatted = formatTaskPlanForLLM(p);
			assert.ok(formatted.includes('Build App'));
			assert.ok(formatted.includes('Build a todo app'));
			assert.ok(formatted.includes('Create files'));
			assert.ok(formatted.includes('Install deps'));
			assert.ok(formatted.includes('0%'));
		});
	});

	suite('TaskStatus - all values are valid', () => {
		const validStatuses: TaskStatus[] = ['pending', 'running', 'completed', 'failed', 'blocked'];
		for (const status of validStatuses) {
			test(`status '${status}' is valid`, () => {
				assert.ok(['pending', 'running', 'completed', 'failed', 'blocked'].includes(status));
			});
		}
	});
});
