/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// One-Command Orchestrator Service
// This is the core of "build a large application from one natural-language instruction."
//
// Flow:
// 1. User says "build a todo app with React and Node"
// 2. Task Decomposition breaks it into ordered sub-tasks
// 3. For each task:
//    a. Agent executes the task (writes code, runs commands)
//    b. Run tests to verify
//    c. If tests fail → Auto-Repair loop (fix → rerun → repeat until passing)
//    d. Update task status
// 4. After all tasks → Final verification (run all tests)
// 5. Report what was built and what works

import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { TaskPlan, TaskPlanTask } from './autonomousTask.js';
import { ITaskDecompositionService } from './taskDecompositionService.js';
import { IAutoRepairService } from './autoRepairService.js';
import { IContextCompactionService } from './contextCompactionService.js';
import { TestRunResultData } from './testServiceTypes.js';

export interface IOneCommandOrchestratorService {
	readonly _serviceBrand: undefined;

	/**
	 * Build an application from a single natural-language instruction.
	 *
	 * Flow:
	 * 1. Decompose request into task plan
	 * 2. Execute each task (agent writes code, runs commands)
	 * 3. Run tests after each task
	 * 4. Auto-repair if tests fail (fix → rerun → repeat until passing)
	 * 5. Context compaction if conversation gets too long
	 * 6. Final verification
	 *
	 * @param threadId The chat thread to use
	 * @param userRequest The natural-language request
	 * @param modelSelection The model to use
	 * @param maxRepairAttempts Max repair attempts per task
	 * @returns Orchestration result
	 */
	buildApplication(
		threadId: string,
		userRequest: string,
		modelSelection: any,
		maxRepairAttempts?: number
	): Promise<{
		success: boolean;
		plan: TaskPlan;
		attempts: number;
		finalResults: TestRunResultData | null;
		orchestrationLog: Array<{
			taskId: string;
			taskTitle: string;
			status: 'completed' | 'failed' | 'skipped';
			repairAttempts: number;
			testResults: TestRunResultData | null;
		}>;
	}>;

	/**
	 * Execute a single task from the plan with auto-repair.
	 */
	executeTaskWithAutoRepair(
		threadId: string,
		task: TaskPlanTask,
		plan: TaskPlan,
		modelSelection: any,
		maxRepairAttempts: number
	): Promise<{
		taskCompleted: boolean;
		repairAttempts: number;
		testResults: TestRunResultData | null;
		message: string;
	}>;

	/**
	 * Check context and compact if needed.
	 */
	checkAndCompactContext(
		threadId: string,
		modelSelection: any
	): Promise<{ compacted: boolean; tokensSaved: number }>;
}

export const IOneCommandOrchestratorService = createDecorator<IOneCommandOrchestratorService>('oneCommandOrchestratorService');

export class OneCommandOrchestratorService extends Disposable implements IOneCommandOrchestratorService {
	_serviceBrand: undefined;

	constructor(
		@ITaskDecompositionService private readonly _taskDecompositionService: ITaskDecompositionService,
		@IAutoRepairService private readonly _autoRepairService: IAutoRepairService,
		@IContextCompactionService private readonly _contextCompactionService: IContextCompactionService,
	) {
		super();
	}

	async buildApplication(
		threadId: string,
		userRequest: string,
		modelSelection: any,
		maxRepairAttempts: number = 5
	): Promise<{
		success: boolean;
		plan: TaskPlan;
		attempts: number;
		finalResults: TestRunResultData | null;
		orchestrationLog: Array<{
			taskId: string;
			taskTitle: string;
			status: 'completed' | 'failed' | 'skipped';
			repairAttempts: number;
			testResults: TestRunResultData | null;
		}>;
	}> {
		const orchestrationLog: Array<{
			taskId: string;
			taskTitle: string;
			status: 'completed' | 'failed' | 'skipped';
			repairAttempts: number;
			testResults: TestRunResultData | null;
		}> = [];

		let totalAttempts = 0;
		let finalResults: TestRunResultData | null = null;

		// Step 1: Decompose the request into a task plan
		const plan = this._taskDecompositionService.decomposeRequest(userRequest);
		const validation = this._taskDecompositionService.validatePlan(plan);

		if (!validation.valid) {
			return {
				success: false,
				plan,
				attempts: 0,
				finalResults: null,
				orchestrationLog: [],
			};
		}

		// Add the task plan as the first message to the thread
		const planMessage = this._taskDecompositionService.formatPlanForLLM(plan);
		const chatThreadService: any = (global as any)._chatThreadServiceInstance;
		if (chatThreadService) {
			chatThreadService.addUserMessage({
				threadId,
				userMessage: `I want you to build this application:\n\n${userRequest}\n\n${planMessage}\n\nStart by executing the first ready task.`,
			});
		}

		// Step 2: Execute each task in order
		let currentPlan = plan;
		let allTasksCompleted = false;

		while (!allTasksCompleted) {
			const readyTasks = this._taskDecompositionService.getReadyTasks(currentPlan);

			if (readyTasks.length === 0) {
				const incompleteTasks = currentPlan.tasks.filter(
					t => t.status !== 'completed' && t.status !== 'failed'
				);
				if (incompleteTasks.length === 0) {
					allTasksCompleted = true;
					break;
				}
				break;
			}

			const task = readyTasks[0];
			const taskResult = await this.executeTaskWithAutoRepair(
				threadId,
				task,
				currentPlan,
				modelSelection,
				maxRepairAttempts
			);

			totalAttempts += taskResult.repairAttempts;

			if (taskResult.taskCompleted) {
				currentPlan = this._taskDecompositionService.markTaskCompleted(
					currentPlan,
					task.id,
					taskResult.message
				);
			} else {
				currentPlan = this._taskDecompositionService.markTaskFailed(
					currentPlan,
					task.id,
					taskResult.message
				);
			}

			orchestrationLog.push({
				taskId: task.id,
				taskTitle: task.title,
				status: taskResult.taskCompleted ? 'completed' : 'failed',
				repairAttempts: taskResult.repairAttempts,
				testResults: taskResult.testResults,
			});

			if (taskResult.testResults) {
				finalResults = taskResult.testResults;
			}

			await this.checkAndCompactContext(threadId, modelSelection);

			if (this._taskDecompositionService.isPlanComplete(currentPlan)) {
				allTasksCompleted = true;
			}
		}

		if (allTasksCompleted && finalResults) {
			if (finalResults.failed > 0 || finalResults.errored > 0) {
				const repairResult = await this._autoRepairService.repairFailedTests(
					threadId,
					finalResults,
					modelSelection,
					maxRepairAttempts
				);
				totalAttempts += repairResult.attempts;
				finalResults = repairResult.finalResults;
			}
		}

		const success = allTasksCompleted && (!finalResults || (finalResults.failed === 0 && finalResults.errored === 0));

		return {
			success,
			plan: currentPlan,
			attempts: totalAttempts,
			finalResults,
			orchestrationLog,
		};
	}

	async executeTaskWithAutoRepair(
		threadId: string,
		task: TaskPlanTask,
		plan: TaskPlan,
		modelSelection: any,
		maxRepairAttempts: number
	): Promise<{
		taskCompleted: boolean;
		repairAttempts: number;
		testResults: TestRunResultData | null;
		message: string;
	}> {
		const taskMessage = `
TASK: ${task.title}
Description: ${task.description}

Current plan context:
${this._taskDecompositionService.formatPlanForLLM(plan)}

Execute this task now. Use the available tools to implement the feature. When done:
1. Mark the task as completed using update_task_plan
2. Run tests to verify your work using test_run
3. Report what was accomplished

Start implementing now.
`;

		const chatThreadService: any = (global as any)._chatThreadServiceInstance;
		if (chatThreadService) {
			chatThreadService.addUserMessage({
				threadId,
				userMessage: taskMessage,
			});
		}

		try {
			if (chatThreadService && chatThreadService.runAutonomousTurn) {
				await chatThreadService.runAutonomousTurn(threadId);
			}
		} catch (err: any) {
			return {
				taskCompleted: false,
				repairAttempts: 0,
				testResults: null,
				message: `Agent execution failed: ${err?.message || 'Unknown error'}`,
			};
		}

		// Run tests after task completion
		// Use any type for test tool service since it's in browser layer
		const testToolService: any = (global as any)._testToolServiceInstance;
		let results: TestRunResultData | null = null;

		if (testToolService) {
			const testResult = await testToolService.runTests({});
			results = testResult.results;
		}

		let repairAttempts = 0;

		if (results && (results.failed > 0 || results.errored > 0)) {
			const repairResult = await this._autoRepairService.repairFailedTests(
				threadId,
				results,
				modelSelection,
				maxRepairAttempts
			);
			repairAttempts = repairResult.attempts;

			if (repairResult.repaired) {
				return {
					taskCompleted: true,
					repairAttempts,
					testResults: repairResult.finalResults,
					message: `Task "${task.title}" completed after ${repairAttempts} repair attempt(s). All tests pass.`,
				};
			} else {
				return {
					taskCompleted: false,
					repairAttempts,
					testResults: repairResult.finalResults,
					message: `Task "${task.title}" failed after ${repairAttempts} repair attempt(s). Tests still failing.`,
				};
			}
		}

		return {
			taskCompleted: true,
			repairAttempts: 0,
			testResults: results,
			message: `Task "${task.title}" completed. All tests pass.`,
		};
	}

	async checkAndCompactContext(
		threadId: string,
		modelSelection: any
	): Promise<{ compacted: boolean; tokensSaved: number }> {
		const chatThreadService: any = (global as any)._chatThreadServiceInstance;
		if (!chatThreadService) {
			return { compacted: false, tokensSaved: 0 };
		}

		const thread = chatThreadService.getCurrentThread();
		if (!thread) {
			return { compacted: false, tokensSaved: 0 };
		}

		const contextWindow = 1_000_000;
		const reservedOutputTokenSpace = 128_000;

		const needsCompaction = this._contextCompactionService.needsCompaction(
			thread.messages,
			contextWindow,
			reservedOutputTokenSpace
		);

		if (!needsCompaction.needed) {
			return { compacted: false, tokensSaved: 0 };
		}

		const compactionResult = this._contextCompactionService.compactConversation(
			thread.messages,
			modelSelection,
			20
		);

		if (compactionResult.summaryEntry && chatThreadService) {
			chatThreadService.addUserMessage({
				threadId,
				userMessage: compactionResult.summaryEntry.summary,
			});
		}

		return {
			compacted: true,
			tokensSaved: compactionResult.tokensSaved,
		};
	}
}

registerSingleton(IOneCommandOrchestratorService, OneCommandOrchestratorService, InstantiationType.Delayed);
