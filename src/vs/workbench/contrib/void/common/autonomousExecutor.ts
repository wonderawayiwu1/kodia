/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ITaskPlanService } from './taskPlanService.js';
import { TaskPlan, TaskPlanTask, TaskStatus, verifyFileExists, formatTaskPlanForLLM, getPlanProgress, getNextPendingTask } from './autonomousTask.js';

export type ExecutionResult = {
	success: boolean;
	message: string;
	plan: TaskPlan;
	taskResults: Map<string, { status: TaskStatus; result?: string; error?: string; attempts: number }>;
	cancelled: boolean;
};

export type ExecutionOptions = {
	maxRetries?: number;              // max retries per task (default: 3)
	maxSteps?: number;                // max total tool steps (default: 50)
	verifyResults?: boolean;          // whether to verify task completion (default: true)
};

const DEFAULT_OPTIONS: ExecutionOptions = {
	maxRetries: 3,
	maxSteps: 50,
	verifyResults: true,
};

/**
 * Autonomous execution engine.
 *
 * Drives the agent through a task plan by:
 * 1. Getting the next pending task
 * 2. Adding a task instruction message to the chat thread
 * 3. Triggering the agent loop to execute tools
 * 4. Verifying task completion (optional)
 * 5. Updating task status
 * 6. Advancing to the next task
 *
 * All tool execution goes through the existing _runToolCall path in ChatThreadService,
 * which enforces evaluateAutonomy().
 */
export class AutonomousExecutor {
	private readonly fileService: any;
	private readonly taskPlanService: ITaskPlanService;
	private readonly chatThreadService: any;
	private readonly threadId: string;
	private readonly options: ExecutionOptions;

	// Per-thread execution lock to prevent concurrent executions
	private static executionLocks = new Map<string, Promise<void>>();

	constructor(
		fileService: any,
		taskPlanService: ITaskPlanService,
		chatThreadService: any,
		threadId: string,
		options: ExecutionOptions = {}
	) {
		this.fileService = fileService;
		this.taskPlanService = taskPlanService;
		this.chatThreadService = chatThreadService;
		this.threadId = threadId;
		this.options = { ...DEFAULT_OPTIONS, ...options };
	}

	/**
	 * Execute the full autonomy plan for the current thread.
	 *
	 * Loops: get next pending task -> add task instruction -> run agent loop ->
	 * verify result -> update task status -> repeat until complete/blocked/failed.
	 *
	 * @param signal Optional AbortSignal to cancel execution mid-loop.
	 */
	async execute(signal?: AbortSignal): Promise<ExecutionResult> {
		// Acquire per-thread execution lock to prevent concurrent executions
		const existingLock = AutonomousExecutor.executionLocks.get(this.threadId);
		if (existingLock) {
			// A previous execution is still in progress; wait for it
			await existingLock;
			// After waiting, check if we were cancelled while waiting
			if (signal?.aborted) {
				return this.cancelledResult();
			}
		}

		const releaseLock = this.acquireLock(this.threadId);
		try {
			return await this.executeInternal(signal);
		} finally {
			releaseLock();
		}
	}

	private cancelledResult(): ExecutionResult {
		return {
			success: false,
			message: 'Execution cancelled.',
			plan: this.taskPlanService.getPlan(this.threadId) ?? ({} as TaskPlan),
			taskResults: new Map(),
			cancelled: true,
		};
	}

	private acquireLock(threadId: string): () => void {
		let resolveRelease: () => void = () => {};
		const releasePromise = new Promise<void>(resolve => {
			resolveRelease = resolve;
		});
		AutonomousExecutor.executionLocks.set(threadId, releasePromise);
		return () => {
			AutonomousExecutor.executionLocks.delete(threadId);
			resolveRelease();
		};
	}

	private async executeInternal(signal?: AbortSignal): Promise<ExecutionResult> {
		// Check for circular dependencies before starting
		if (this.taskPlanService.hasCircularDependencies(this.threadId)) {
			return {
				success: false,
				message: `Plan has circular dependencies and cannot be executed.`,
				plan: this.taskPlanService.getPlan(this.threadId) ?? ({} as TaskPlan),
				taskResults: new Map(),
				cancelled: false,
			};
		}

		let plan = this.taskPlanService.getPlan(this.threadId);
		if (!plan) {
			return {
				success: false,
				message: 'No task plan found. Create a plan first with create_task_plan.',
				plan: {} as TaskPlan,
				taskResults: new Map(),
				cancelled: false,
			};
		}

		let stepsTaken = 0;

		while (stepsTaken < this.options.maxSteps!) {
			// Check for cancellation
			if (signal?.aborted) {
				return this.cancelledResult();
			}

			// Check plan status
			const mode = plan.overallStatus;
			if (mode === 'completed') {
				return {
					success: true,
					message: `Plan "${plan.title}" completed successfully (${getPlanProgress(plan).percent}%).`,
					plan,
					taskResults: this.buildTaskResults(plan),
					cancelled: false,
				};
			}
			if (mode === 'failed') {
				return {
					success: false,
					message: `Plan "${plan.title}" failed.`,
					plan,
					taskResults: this.buildTaskResults(plan),
					cancelled: false,
				};
			}

			// Get the next pending task
			const nextTask = getNextPendingTask(plan);
			if (!nextTask) {
				// No pending tasks
				const allDone = plan.tasks.every(t => t.status === 'completed' || t.status === 'blocked');
				if (allDone) {
					return {
						success: plan.overallStatus === 'completed',
						message: `Plan "${plan.title}" has no pending tasks. Overall status: ${plan.overallStatus}.`,
						plan,
						taskResults: this.buildTaskResults(plan),
						cancelled: false,
					};
				}
				// Some tasks blocked - can't proceed
				return {
					success: false,
					message: `Plan "${plan.title}" has blocked tasks that cannot proceed.`,
					plan,
					taskResults: this.buildTaskResults(plan),
					cancelled: false,
				};
			}

			// Execute the next task
			const stepResult = await this.executeSingleTask(nextTask, plan, signal);
			if (stepResult.cancelled) {
				return stepResult;
			}
			if (!stepResult.success) {
				return stepResult;
			}

			// Reload the plan (may have been updated by tool execution)
			const updatedPlan = this.taskPlanService.getPlan(this.threadId);
			if (!updatedPlan) {
				return {
					success: false,
					message: 'Task plan was lost during execution.',
					plan,
					taskResults: this.buildTaskResults(plan),
					cancelled: false,
				};
			}
			plan = updatedPlan;
			stepsTaken++;
		}

		return {
			success: false,
			message: `Plan "${plan.title}" reached max steps (${this.options.maxSteps}) without completing.`,
			plan,
			taskResults: this.buildTaskResults(plan),
			cancelled: false,
		};
	}

	private buildTaskResults(plan: TaskPlan): Map<string, { status: TaskStatus; result?: string; error?: string; attempts: number }> {
		const results = new Map<string, { status: TaskStatus; result?: string; error?: string; attempts: number }>();
		for (const task of plan.tasks) {
			results.set(task.id, {
				status: task.status,
				result: task.result,
				error: task.error,
				attempts: 0, // We don't track attempts in the plan currently
			});
		}
		return results;
	}

	/**
	 * Execute a single task: mark it running, add task instruction to thread,
	 * trigger the agent loop to execute tools, verify results, update status.
	 *
	 * Side-effect dedup: tasks already in 'completed' or 'failed' state are not
	 * re-executed even if the executor is restarted.
	 */
	private async executeSingleTask(task: TaskPlanTask, plan: TaskPlan, signal?: AbortSignal): Promise<ExecutionResult> {
		// Side-effect dedup: skip tasks already in a terminal state
		if (task.status === 'completed' || task.status === 'failed') {
			return {
				success: true,
				message: `Task "${task.title}" already in terminal state: ${task.status}.`,
				plan,
				taskResults: this.buildTaskResults(plan),
				cancelled: false,
			};
		}

		// Mark task as running
		this.taskPlanService.updateTask(this.threadId, task.id, 'running');

		let retries = 0;

		while (retries <= this.options.maxRetries!) {
			// Check for cancellation before each retry
			if (signal?.aborted) {
				return this.cancelledResult();
			}

			// Add task instruction to the thread and trigger the agent loop
			const toolResult = await this.executeTaskViaLLM(task, plan);

			if (!toolResult.success) {
				// Tool execution failed - retry or fail
				retries++;
				if (retries > this.options.maxRetries!) {
					this.taskPlanService.updateTask(this.threadId, task.id, 'failed', undefined, toolResult.message);
					return {
						success: false,
						message: `Task "${task.title}" failed after ${this.options.maxRetries!} retries: ${toolResult.message}`,
						plan: this.taskPlanService.getPlan(this.threadId)!,
						taskResults: this.buildTaskResults(this.taskPlanService.getPlan(this.threadId)!),
						cancelled: false,
					};
				}
				// Retry with the error context
				continue;
			}

			// Verify the result if verification is enabled
			if (this.options.verifyResults) {
				const verification = await this.verifyTaskCompletion(task, toolResult.message);
				if (!verification.passed) {
					retries++;
					if (retries > this.options.maxRetries!) {
						this.taskPlanService.updateTask(this.threadId, task.id, 'failed', undefined, `Verification failed: ${verification.evidence}. Details: ${verification.details}`);
						return {
							success: false,
							message: `Task "${task.title}" failed verification after ${this.options.maxRetries!} retries: ${verification.evidence}`,
							plan: this.taskPlanService.getPlan(this.threadId)!,
							taskResults: this.buildTaskResults(this.taskPlanService.getPlan(this.threadId)!),
							cancelled: false,
						};
					}
					// Retry with the verification failure context
					continue;
				}
			}

			// Mark task as completed
			this.taskPlanService.updateTask(this.threadId, task.id, 'completed', toolResult.message);
			return {
				success: true,
				message: `Task "${task.title}" completed.`,
				plan: this.taskPlanService.getPlan(this.threadId)!,
				taskResults: this.buildTaskResults(this.taskPlanService.getPlan(this.threadId)!),
				cancelled: false,
			};
		}

		return {
			success: false,
			message: `Task "${task.title}" exhausted retries.`,
			plan: this.taskPlanService.getPlan(this.threadId)!,
			taskResults: this.buildTaskResults(this.taskPlanService.getPlan(this.threadId)!),
			cancelled: false,
		};
	}

	/**
	 * Add a task instruction to the chat thread and trigger the agent loop
	 * to execute tools. The LLM will call tools to accomplish the task,
	 * and all tool calls go through _runToolCall which enforces evaluateAutonomy().
	 */
	private async executeTaskViaLLM(task: TaskPlanTask, plan: TaskPlan): Promise<{ success: boolean; message: string }> {
		// Get the current plan for context
		const currentPlan = this.taskPlanService.getPlan(this.threadId);
		if (!currentPlan) {
			return { success: false, message: 'No task plan available.' };
		}

		// Build the task instruction for the LLM
		const taskInstruction = this.buildTaskInstruction(task, plan);

		// Add the task instruction as a user message to the thread
		await this.chatThreadService.addUserMessage({ threadId: this.threadId, userMessage: taskInstruction });

		// Trigger the agent loop to execute tools
		try {
			await this.chatThreadService.runAutonomousTurn(this.threadId);
		} catch (err: any) {
			return {
				success: false,
				message: err?.message || 'Agent turn failed',
			};
		}

		return { success: true, message: `Task "${task.title}" executed via agent.` };
	}

	/**
	 * Verify that a task was completed successfully.
	 * Uses file existence, terminal output, and other evidence.
	 */
	private async verifyTaskCompletion(task: TaskPlanTask, toolResult: string): Promise<{ passed: boolean; evidence: string; details?: string }> {
		const taskDesc = task.description.toLowerCase();
		const taskTitle = task.title.toLowerCase();

		// If the tool result itself indicates failure, fail fast
		if (toolResult.toLowerCase().includes('error') || toolResult.toLowerCase().includes('failed')) {
			return {
				passed: false,
				evidence: 'Tool result indicates failure',
				details: toolResult,
			};
		}

		// Check for file creation tasks
		if (taskDesc.includes('create') || taskTitle.includes('create')) {
			// Try to extract file paths from the task description or tool result
			const fileMatch = (task.description + ' ' + toolResult).match(/[/\\][\w\-._]+/g);
			if (fileMatch) {
				for (const fp of fileMatch) {
					const result = await verifyFileExists(this.fileService, fp);
					if (!result.passed) {
						return {
							passed: false,
							evidence: `Expected file ${fp} was not created`,
							details: result.details,
						};
					}
				}
				return {
					passed: true,
					evidence: 'All expected files were created',
					details: fileMatch.join(', '),
				};
			}
		}

		// Check for dependency installation tasks
		if (taskDesc.includes('install') || taskTitle.includes('install') || taskDesc.includes('npm')) {
			// Check if node_modules exists
			const result = await verifyFileExists(this.fileService, 'node_modules');
			if (!result.passed) {
				return {
					passed: false,
					evidence: 'node_modules directory not found - dependencies may not be installed',
				};
			}
			return {
				passed: true,
				evidence: 'node_modules directory exists - dependencies installed',
			};
		}

		// Default: if the tool result doesn't indicate failure, consider it done
		return {
			passed: true,
			evidence: 'Task completed (no specific verification criteria met)',
			details: toolResult,
		};
	}

	/**
	 * Build the task instruction message for the LLM.
	 */
	private buildTaskInstruction(task: TaskPlanTask, plan: TaskPlan): string {
		return `TASK: ${task.title}\nDescription: ${task.description}\n\nCurrent plan:\n${formatTaskPlanForLLM(plan)}\n\nYou are working on task "${task.title}". Use the available tools to complete this task. When you are done, call update_task_plan to mark the task as completed with a summary of what was done.`;
	}
}
