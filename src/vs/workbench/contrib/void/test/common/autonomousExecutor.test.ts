/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import {
	evaluateAutonomy, assessRisk, riskThresholdForApproval,
} from '../../common/autonomyPolicy.js';
import {
	verifyFileExists, verifyCommandSuccess, verifyFileContains, verifyTerminalOutput,
	hasCircularDependencies, isValidStateTransition,
} from '../../common/autonomousTask.js';
import { AutonomousExecutor } from '../../common/autonomousExecutor.js';
import { TaskPlanService } from '../../common/taskPlanService.js';

// ============================================================================
// Mocks for testing AutonomousExecutor in isolation
// ============================================================================

// @ts-ignore - Mock file service, does not implement full IFileService
class MockFileService {
	constructor(public exists: Map<string, boolean> = new Map()) {}
	private fileContents: Map<string, string> = new Map();
	async stat(uri: any): Promise<any> {
		const fsPath = (uri?.fsPath || uri || '').replace(/\\/g, '/');
		const exists = this.exists.has(fsPath) ? this.exists.get(fsPath)! : false;
		return exists ? { isFile: true, isDirectory: false } : undefined;
	}
	async readFile(uri: any): Promise<{ value: Buffer }> {
		const fsPath = (uri?.fsPath || uri || '').replace(/\\/g, '/');
		const content = this.fileContents.get(fsPath);
		if (content !== undefined) {
			return { value: Buffer.from(content) };
		}
		throw new Error(`File not found: ${fsPath}`);
	}
	async writeFile(uri: any, content: Buffer): Promise<void> {
		const fsPath = (uri?.fsPath || uri || '').replace(/\\/g, '/');
		this.exists.set(fsPath, true);
		this.fileContents.set(fsPath, content.toString('utf8'));
	}
}

class MockChatThreadService {
	public addUserMessageCalls: Array<{ threadId: string; userMessage: string }> = [];
	public runAutonomousTurnCalls: Array<string> = [];
	public shouldFail = false;
	public failureMessage = '';

	async addUserMessage({ userMessage, threadId }: { userMessage: string; threadId: string }): Promise<void> {
		this.addUserMessageCalls.push({ threadId, userMessage });
	}

	async runAutonomousTurn(threadId: string): Promise<void> {
		this.runAutonomousTurnCalls.push(threadId);
		if (this.shouldFail) {
			throw new Error(this.failureMessage || 'Agent turn failed');
		}
	}
}

// ============================================================================
// Tests
// ============================================================================

suite('Kodia - AutonomyPolicy - Task Plan Tools (Stage 5A Day 2)', () => {

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

	suite('AutonomousExecutor - policy thresholds', () => {
		test('evaluateAutonomy - agent mode threshold is high', () => {
			assert.strictEqual(riskThresholdForApproval('agent'), 'high');
		});
		test('evaluateAutonomy - assist mode threshold is medium', () => {
			assert.strictEqual(riskThresholdForApproval('assist'), 'medium');
		});
		test('evaluateAutonomy - autonomous mode threshold is high', () => {
			assert.strictEqual(riskThresholdForApproval('autonomous'), 'high');
		});
	});

	suite('AutonomousExecutor - verification helpers', () => {
		test('verifyFileExists - file exists', async () => {
			const fileService = new MockFileService();
			fileService.exists.set('/test/file.txt', true);
			const result = await verifyFileExists(fileService, '/test/file.txt');
			assert.strictEqual(result.passed, true);
			assert.ok(result.evidence.includes('exists'));
		});

		test('verifyFileExists - file does not exist', async () => {
			const fileService = new MockFileService();
			const result = await verifyFileExists(fileService, '/nonexistent/file.txt');
			assert.strictEqual(result.passed, false);
			assert.ok(result.evidence.includes('does not exist'));
		});

		test('verifyCommandSuccess - exit code 0', () => {
			const result = verifyCommandSuccess(0);
			assert.strictEqual(result.passed, true);
			assert.ok(result.evidence.includes('Command exited with code 0'));
		});

		test('verifyCommandSuccess - exit code 1', () => {
			const result = verifyCommandSuccess(1);
			assert.strictEqual(result.passed, false);
			assert.ok(result.evidence.includes('Command exited with code 1'));
		});

		test('verifyTerminalOutput - matching output', () => {
			const result = verifyTerminalOutput('Build successful', 'build successful');
			assert.strictEqual(result.passed, true);
		});

		test('verifyTerminalOutput - non-matching output', () => {
			const result = verifyTerminalOutput('Build successful', 'error');
			assert.strictEqual(result.passed, false);
		});

		test('verifyFileContains - file contains text', async () => {
			const fileService = new MockFileService();
			fileService.exists.set('/test/file.txt', true);
			// @ts-ignore
			(fileService as any).readFile = async (uri: any) => ({ value: Buffer.from('Hello World') });
			const result = await verifyFileContains(fileService, '/test/file.txt', 'Hello');
			assert.strictEqual(result.passed, true);
		});

		test('verifyFileContains - file does not contain text', async () => {
			const fileService = new MockFileService();
			fileService.exists.set('/test/file.txt', true);
			// @ts-ignore
			(fileService as any).readFile = async (uri: any) => ({ value: Buffer.from('Hello World') });
			const result = await verifyFileContains(fileService, '/test/file.txt', 'Goodbye');
			assert.strictEqual(result.passed, false);
		});
	});

	suite('AutonomousExecutor - state transitions', () => {
		test('isValidStateTransition - pending to running is valid', () => {
			assert.strictEqual(isValidStateTransition('pending', 'running'), true);
		});
		test('isValidStateTransition - running to completed is valid', () => {
			assert.strictEqual(isValidStateTransition('running', 'completed'), true);
		});
		test('isValidStateTransition - running to failed is valid', () => {
			assert.strictEqual(isValidStateTransition('running', 'failed'), true);
		});
		test('isValidStateTransition - completed to anything is invalid', () => {
			assert.strictEqual(isValidStateTransition('completed', 'pending'), false);
			assert.strictEqual(isValidStateTransition('completed', 'running'), false);
			assert.strictEqual(isValidStateTransition('completed', 'completed'), false);
		});
		test('isValidStateTransition - failed to anything is invalid', () => {
			assert.strictEqual(isValidStateTransition('failed', 'pending'), false);
			assert.strictEqual(isValidStateTransition('failed', 'completed'), false);
		});
		test('isValidStateTransition - blocked to pending is valid', () => {
			assert.strictEqual(isValidStateTransition('blocked', 'pending'), true);
		});
	});

	suite('AutonomousExecutor - circular dependency detection', () => {
		test('hasCircularDependencies - no cycle', () => {
			const plan: any = {
				id: 'plan-1', title: 'Test', description: 'Test',
				overallStatus: 'pending',
				tasks: [
					{ id: 't1', title: 'Task 1', description: 'First', status: 'pending', dependencies: [] },
					{ id: 't2', title: 'Task 2', description: 'Second', status: 'pending', dependencies: ['t1'] },
				],
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};
			assert.strictEqual(hasCircularDependencies(plan), false);
		});

		test('hasCircularDependencies - direct cycle A->B->A', () => {
			const plan: any = {
				id: 'plan-1', title: 'Test', description: 'Test',
				overallStatus: 'pending',
				tasks: [
					{ id: 't1', title: 'Task 1', description: 'First', status: 'pending', dependencies: ['t2'] },
					{ id: 't2', title: 'Task 2', description: 'Second', status: 'pending', dependencies: ['t1'] },
				],
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};
			assert.strictEqual(hasCircularDependencies(plan), true);
		});

		test('hasCircularDependencies - indirect cycle A->B->C->A', () => {
			const plan: any = {
				id: 'plan-1', title: 'Test', description: 'Test',
				overallStatus: 'pending',
				tasks: [
					{ id: 't1', title: 'Task 1', description: 'First', status: 'pending', dependencies: ['t2'] },
					{ id: 't2', title: 'Task 2', description: 'Second', status: 'pending', dependencies: ['t3'] },
					{ id: 't3', title: 'Task 3', description: 'Third', status: 'pending', dependencies: ['t1'] },
				],
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};
			assert.strictEqual(hasCircularDependencies(plan), true);
		});

		test('hasCircularDependencies - self-dependency', () => {
			const plan: any = {
				id: 'plan-1', title: 'Test', description: 'Test',
				overallStatus: 'pending',
				tasks: [
					{ id: 't1', title: 'Task 1', description: 'First', status: 'pending', dependencies: ['t1'] },
				],
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};
			assert.strictEqual(hasCircularDependencies(plan), true);
		});

		test('hasCircularDependencies - empty plan', () => {
			const plan: any = {
				id: 'plan-1', title: 'Test', description: 'Test',
				overallStatus: 'pending',
				tasks: [],
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};
			assert.strictEqual(hasCircularDependencies(plan), false);
		});
	});

	suite('AutonomousExecutor - execution with mocked dependencies', () => {

		test('execute returns error when no plan exists', async () => {
			// @ts-ignore - MockFileService doesn't implement full IFileService
			const fileService = new MockFileService();
			const taskPlanService = new TaskPlanService();
			const chatThreadService = new MockChatThreadService();
			const executor = new AutonomousExecutor(fileService, taskPlanService, chatThreadService, 'thread-1');

			const result = await executor.execute();
			assert.strictEqual(result.success, false);
			assert.ok(result.message.includes('No task plan found'));
			assert.strictEqual(result.cancelled, false);
		});

		test('execute completes a single task plan', async () => {
			// @ts-ignore
			const fileService = new MockFileService();
			const taskPlanService = new TaskPlanService();
			const chatThreadService = new MockChatThreadService();
			const executor = new AutonomousExecutor(fileService, taskPlanService, chatThreadService, 'thread-1');

			taskPlanService.createPlan('thread-1', 'Test Plan', 'Test', [
				{ title: 'Task 1', description: 'Create a file', dependencies: [] },
			]);

			const result = await executor.execute();
			assert.strictEqual(result.success, true);
			assert.strictEqual(result.cancelled, false);
			assert.strictEqual(chatThreadService.addUserMessageCalls.length, 1);
			assert.strictEqual(chatThreadService.runAutonomousTurnCalls.length, 1);
			assert.strictEqual(chatThreadService.addUserMessageCalls[0].threadId, 'thread-1');
			assert.ok(chatThreadService.addUserMessageCalls[0].userMessage.includes('Create a file'));

			// Task should be marked completed
			const updatedPlan = taskPlanService.getPlan('thread-1');
			assert.ok(updatedPlan);
			assert.strictEqual(updatedPlan!.tasks[0].status, 'completed');
			assert.strictEqual(updatedPlan!.overallStatus, 'completed');
		});

		test('execute fails task after max retries when agent turn fails', async () => {
			// @ts-ignore
			const fileService = new MockFileService();
			const taskPlanService = new TaskPlanService();
			const chatThreadService = new MockChatThreadService();
			chatThreadService.shouldFail = true;
			chatThreadService.failureMessage = 'LLM error';
			const executor = new AutonomousExecutor(fileService, taskPlanService, chatThreadService, 'thread-1', { maxRetries: 1 });

			taskPlanService.createPlan('thread-1', 'Test Plan', 'Test', [
				{ title: 'Task 1', description: 'Do something', dependencies: [] },
			]);

			const result = await executor.execute();
			assert.strictEqual(result.success, false);
			assert.ok(result.message.includes('failed'));
			assert.strictEqual(result.cancelled, false);

			// Task should be marked failed
			const updatedPlan = taskPlanService.getPlan('thread-1');
			assert.ok(updatedPlan);
			assert.strictEqual(updatedPlan!.tasks[0].status, 'failed');
			assert.strictEqual(updatedPlan!.overallStatus, 'failed');
		});

		test('execute handles cancellation via AbortSignal', async () => {
			// @ts-ignore
			const fileService = new MockFileService();
			const taskPlanService = new TaskPlanService();
			const chatThreadService = new MockChatThreadService();
			const executor = new AutonomousExecutor(fileService, taskPlanService, chatThreadService, 'thread-1', { maxSteps: 100 });

			taskPlanService.createPlan('thread-1', 'Test Plan', 'Test', [
				{ title: 'Task 1', description: 'Do something', dependencies: [] },
			]);

			const controller = new AbortController();
			controller.abort();

			const result = await executor.execute(controller.signal);
			assert.strictEqual(result.success, false);
			assert.strictEqual(result.cancelled, true);
			assert.ok(result.message.includes('cancelled'));
		});

		test('execute prevents concurrent execution per thread (locking)', async () => {
			// @ts-ignore
			const fileService = new MockFileService();
			const taskPlanService = new TaskPlanService();
			const chatThreadService = new MockChatThreadService();
			const executor = new AutonomousExecutor(fileService, taskPlanService, chatThreadService, 'thread-1');

			taskPlanService.createPlan('thread-1', 'Test Plan', 'Test', [
				{ title: 'Task 1', description: 'Do something', dependencies: [] },
			]);

			// Start two executions concurrently
			const promise1 = executor.execute();
			const promise2 = executor.execute();

			const [result1, result2] = await Promise.all([promise1, promise2]);

			// Both should succeed (second sees plan already completed),
			// but only one set of agent calls should have been made
			const successes = [result1, result2].filter(r => r.success).length;
			assert.strictEqual(successes, 2, 'Both executions should succeed (second sees completed plan)');

			// Only one set of agent calls should have been made (locking prevented concurrent agent execution)
			assert.strictEqual(chatThreadService.addUserMessageCalls.length, 1);
			assert.strictEqual(chatThreadService.runAutonomousTurnCalls.length, 1);
		});

		test('execute detects circular dependencies and refuses to run', async () => {
			// @ts-ignore
			const fileService = new MockFileService();
			const taskPlanService = new TaskPlanService();
			const chatThreadService = new MockChatThreadService();
			const executor = new AutonomousExecutor(fileService, taskPlanService, chatThreadService, 'thread-1');

			// Manually create a plan with circular dependencies by bypassing validation
			const plan: any = {
				id: 'plan-circular', title: 'Circular Plan', description: 'Has circular deps',
				overallStatus: 'pending',
				tasks: [
					{ id: 't1', title: 'Task 1', description: 'First', status: 'pending', dependencies: ['t2'] },
					{ id: 't2', title: 'Task 2', description: 'Second', status: 'pending', dependencies: ['t1'] },
				],
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};
			// @ts-ignore - accessing private plans property for test setup
			taskPlanService.plans.set('thread-1', plan);

			const result = await executor.execute();
			assert.strictEqual(result.success, false);
			assert.ok(result.message.includes('circular dependencies'));
			assert.strictEqual(result.cancelled, false);
			assert.strictEqual(chatThreadService.addUserMessageCalls.length, 0);
			assert.strictEqual(chatThreadService.runAutonomousTurnCalls.length, 0);
		});

		test('execute skips already completed tasks (side-effect dedup)', async () => {
			// @ts-ignore
			const fileService = new MockFileService();
			const taskPlanService = new TaskPlanService();
			const chatThreadService = new MockChatThreadService();
			const executor = new AutonomousExecutor(fileService, taskPlanService, chatThreadService, 'thread-1');

			const plan = taskPlanService.createPlan('thread-1', 'Test Plan', 'Test', [
				{ title: 'Task 1', description: 'Do something', dependencies: [] },
			]);

			// Mark task as completed first
			taskPlanService.updateTask('thread-1', plan.tasks[0].id, 'completed', 'Already done');

			const result = await executor.execute();
			assert.strictEqual(result.success, true);
			// No agent calls should have been made since task is already done
			assert.strictEqual(chatThreadService.addUserMessageCalls.length, 0);
			assert.strictEqual(chatThreadService.runAutonomousTurnCalls.length, 0);
		});

		test('execute processes multiple tasks in dependency order', async () => {
			// @ts-ignore
			const fileService = new MockFileService();
			const taskPlanService = new TaskPlanService();
			const chatThreadService = new MockChatThreadService();
			const executor = new AutonomousExecutor(fileService, taskPlanService, chatThreadService, 'thread-1');

			// Create plan first to get task IDs
			const plan = taskPlanService.createPlan('thread-1', 'Test Plan', 'Test', [
				{ title: 'Task 1', description: 'First task', dependencies: [] },
			]);
			const task1Id = plan.tasks[0].id;

			// Create a new plan with Task 2 depending on Task 1
			const plan2: any = {
				id: 'plan-deps', title: 'Test Plan', description: 'Test',
				overallStatus: 'pending',
				tasks: [
					{ id: task1Id, title: 'Task 1', description: 'First task', status: 'pending', dependencies: [] },
					{ id: 'task-2', title: 'Task 2', description: 'Second task', status: 'pending', dependencies: [task1Id] },
				],
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};
			// @ts-ignore - accessing private plans property for test setup
			taskPlanService.plans.set('thread-1', plan2);

			const result = await executor.execute();
			assert.strictEqual(result.success, true);

			// Both tasks should have been executed in order (Task 1 first, then Task 2)
			assert.strictEqual(chatThreadService.addUserMessageCalls.length, 2);
			assert.ok(chatThreadService.addUserMessageCalls[0].userMessage.includes('First task'));
			assert.ok(chatThreadService.addUserMessageCalls[1].userMessage.includes('Second task'));
		});

		test('execute respects max steps limit', async () => {
			// @ts-ignore
			const fileService = new MockFileService();
			const taskPlanService = new TaskPlanService();
			const chatThreadService = new MockChatThreadService();
			const executor = new AutonomousExecutor(fileService, taskPlanService, chatThreadService, 'thread-1', { maxSteps: 1 });

			taskPlanService.createPlan('thread-1', 'Test Plan', 'Test', [
				{ title: 'Task 1', description: 'Do something', dependencies: [] },
			]);

			const result = await executor.execute();
			assert.strictEqual(result.success, false);
			assert.ok(result.message.includes('max steps'));
		});

		test('execute result includes taskResults map', async () => {
			// @ts-ignore
			const fileService = new MockFileService();
			const taskPlanService = new TaskPlanService();
			const chatThreadService = new MockChatThreadService();
			const executor = new AutonomousExecutor(fileService, taskPlanService, chatThreadService, 'thread-1');

			const plan = taskPlanService.createPlan('thread-1', 'Test Plan', 'Test', [
				{ title: 'Task 1', description: 'Do something', dependencies: [] },
			]);

			const result = await executor.execute();
			assert.ok(result.taskResults instanceof Map);
			assert.strictEqual(result.taskResults.size, 1);
			const taskResult = result.taskResults.get(plan.tasks[0].id);
			assert.ok(taskResult);
			assert.strictEqual(taskResult!.status, 'completed');
		});
	});

	suite('AutonomousExecutor - persistence and recovery', () => {

		test('TaskPlanService savePlans and loadPlans roundtrip', async () => {
			// @ts-ignore
			const fileService = new MockFileService();
			const service1 = new TaskPlanService();

			const plan = service1.createPlan('thread-1', 'Test Plan', 'Test description', [
				{ title: 'Task 1', description: 'First task', dependencies: [] },
			]);
			service1.updateTask('thread-1', plan.tasks[0].id, 'completed', 'Done');

			await service1.savePlans(fileService, 'test-plans.json');

			// Create a new service instance and load
			const service2 = new TaskPlanService();
			await service2.loadPlans(fileService, 'test-plans.json');

			const loadedPlan = service2.getPlan('thread-1');
			assert.ok(loadedPlan);
			assert.strictEqual(loadedPlan!.title, 'Test Plan');
			assert.strictEqual(loadedPlan!.tasks[0].status, 'completed');
			assert.strictEqual(loadedPlan!.tasks[0].result, 'Done');
			assert.strictEqual(loadedPlan!.overallStatus, 'completed');
		});

		test('TaskPlanService loadPlans with no saved file starts fresh', async () => {
			// @ts-ignore
			const fileService = new MockFileService(); // No files exist
			const service = new TaskPlanService();
			await service.loadPlans(fileService, 'nonexistent-plans.json');

			const plan = service.getPlan('thread-1');
			assert.strictEqual(plan, null);
		});

		test('TaskPlanService loadPlans does not overwrite existing in-memory plans', async () => {
			// @ts-ignore
			const fileService = new MockFileService();
			const service1 = new TaskPlanService();
			service1.createPlan('thread-1', 'Plan A', 'Description A', []);

			await service1.savePlans(fileService, 'test-plans.json');

			const service2 = new TaskPlanService();
			service2.createPlan('thread-1', 'Plan B', 'Description B', []);
			await service2.loadPlans(fileService, 'test-plans.json');

			// Plan B should still be there (not overwritten by Plan A)
			const plan = service2.getPlan('thread-1');
			assert.ok(plan);
			assert.strictEqual(plan!.title, 'Plan B');
		});
	});

	suite('TaskPlanService - state transition validation', () => {
		test('updateTask rejects invalid transition completed -> pending', () => {
			const service = new TaskPlanService();
			const plan = service.createPlan('thread-1', 'Test Plan', 'Test', [
				{ title: 'Task 1', description: 'Do something', dependencies: [] },
			]);

			// Complete the task
			service.updateTask('thread-1', plan.tasks[0].id, 'completed', 'Done');

			// Try to revert to pending - should fail
			const result = service.updateTask('thread-1', plan.tasks[0].id, 'pending');
			assert.strictEqual(result, null);

			// Task should still be completed
			const currentPlan = service.getPlan('thread-1');
			assert.ok(currentPlan);
			assert.strictEqual(currentPlan!.tasks[0].status, 'completed');
		});

		test('updateTask rejects invalid transition failed -> completed', () => {
			const service = new TaskPlanService();
			const plan = service.createPlan('thread-1', 'Test Plan', 'Test', [
				{ title: 'Task 1', description: 'Do something', dependencies: [] },
			]);

			// Fail the task
			service.updateTask('thread-1', plan.tasks[0].id, 'failed', undefined, 'Error');

			// Try to mark as completed - should fail
			const result = service.updateTask('thread-1', plan.tasks[0].id, 'completed');
			assert.strictEqual(result, null);

			// Task should still be failed
			const currentPlan = service.getPlan('thread-1');
			assert.ok(currentPlan);
			assert.strictEqual(currentPlan!.tasks[0].status, 'failed');
		});

		test('updateTask allows valid transition blocked -> pending', () => {
			const service = new TaskPlanService();
			const plan = service.createPlan('thread-1', 'Test Plan', 'Test', [
				{ title: 'Task 1', description: 'Do something', dependencies: [] },
			]);

			// Block the task
			service.updateTask('thread-1', plan.tasks[0].id, 'blocked');

			// Unblock to pending - should succeed
			const result = service.updateTask('thread-1', plan.tasks[0].id, 'pending');
			assert.ok(result);
			assert.strictEqual(result!.tasks[0].status, 'pending');
		});

		test('updateTask returns null for non-existent task', () => {
			const service = new TaskPlanService();
			service.createPlan('thread-1', 'Test Plan', 'Test', []);

			const result = service.updateTask('thread-1', 'nonexistent-task', 'completed');
			assert.strictEqual(result, null);
		});
	});

	suite('TaskPlanService - hasCircularDependencies integration', () => {
		test('hasCircularDependencies returns false for acyclic plan', () => {
			const service = new TaskPlanService();
			service.createPlan('thread-1', 'Test Plan', 'Test', [
				{ title: 'Task 1', description: 'First', dependencies: [] },
				{ title: 'Task 2', description: 'Second', dependencies: ['unused-id'] },
			]);
			assert.strictEqual(service.hasCircularDependencies('thread-1'), false);
		});

		test('hasCircularDependencies returns true for cyclic plan', () => {
			const service = new TaskPlanService();
			const plan = service.createPlan('thread-1', 'Test Plan', 'Test', [
				{ title: 'Task 1', description: 'First', dependencies: [] },
				{ title: 'Task 2', description: 'Second', dependencies: [] },
			]);
			// Manually set up circular dependencies: T1 -> T2 -> T1
			const t1Id = plan.tasks[0].id;
			const t2Id = plan.tasks[1].id;
			const cyclicPlan: any = {
				...plan,
				tasks: [
					{ ...plan.tasks[0], dependencies: [t2Id] },
					{ ...plan.tasks[1], dependencies: [t1Id] },
				],
			};
			// @ts-ignore - accessing private plans property
			service.plans.set('thread-1', cyclicPlan);
			assert.strictEqual(service.hasCircularDependencies('thread-1'), true);
		});

		test('hasCircularDependencies returns false for non-existent thread', () => {
			const service = new TaskPlanService();
			assert.strictEqual(service.hasCircularDependencies('nonexistent'), false);
		});
	});

});
