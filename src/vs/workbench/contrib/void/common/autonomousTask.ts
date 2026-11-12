/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'blocked';

export type TaskPlanTask = {
	id: string;
	title: string;
	description: string;
	status: TaskStatus;
	dependencies: string[]; // task IDs that must be completed before this task
	result?: string; // result/output from completed task
	error?: string; // error message if failed
};

export type TaskPlan = {
	id: string;
	title: string;
	description: string;
	overallStatus: 'pending' | 'in_progress' | 'completed' | 'failed';
	tasks: TaskPlanTask[];
	createdAt: string;
	updatedAt: string;
};

export const newTaskPlan = (title: string, description: string): TaskPlan => {
	const now = new Date().toISOString();
	const id = 'task-plan-' + now.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 30);
	return {
		id,
		title,
		description,
		overallStatus: 'pending',
		tasks: [],
		createdAt: now,
		updatedAt: now,
	};
};

export const newTask = (title: string, description: string, dependencies: string[] = []): TaskPlanTask => {
	return {
		id: 'task-' + Math.random().toString(36).slice(2, 11),
		title,
		description,
		status: 'pending',
		dependencies,
	};
};

export const addTask = (plan: TaskPlan, task: TaskPlanTask): TaskPlan => {
	return {
		...plan,
		tasks: [...plan.tasks, task],
		updatedAt: new Date().toISOString(),
	};
};

export const updateTaskStatus = (plan: TaskPlan, taskId: string, status: TaskStatus, result?: string, error?: string): TaskPlan => {
	return {
		...plan,
		tasks: plan.tasks.map(t =>
			t.id === taskId
				? { ...t, status, ...(result !== undefined ? { result } : {}), ...(error !== undefined ? { error } : {}) }
				: t
		),
		overallStatus: computeOverallStatus(plan.tasks.map(t => t.id === taskId ? { ...t, status } : t)),
		updatedAt: new Date().toISOString(),
	};
};

export const computeOverallStatus = (tasks: TaskPlanTask[]): 'pending' | 'in_progress' | 'completed' | 'failed' => {
	if (tasks.length === 0) return 'pending';
	const hasFailed = tasks.some(t => t.status === 'failed');
	const hasBlocked = tasks.some(t => t.status === 'blocked');
	const allCompleted = tasks.every(t => t.status === 'completed');
	const anyRunning = tasks.some(t => t.status === 'running');
	if (hasFailed) return 'failed';
	if (allCompleted) return 'completed';
	if (anyRunning || hasBlocked) return 'in_progress';
	return 'pending';
};

export const getNextPendingTask = (plan: TaskPlan): TaskPlanTask | null => {
	// Find tasks whose dependencies are all completed
	const completedIds = new Set(plan.tasks.filter(t => t.status === 'completed').map(t => t.id));
	for (const task of plan.tasks) {
		if (task.status !== 'pending') continue;
		const depsSatisfied = task.dependencies.every(depId => completedIds.has(depId));
		if (depsSatisfied) return task;
	}
	return null;
};

export const getTaskById = (plan: TaskPlan, taskId: string): TaskPlanTask | undefined => {
	return plan.tasks.find(t => t.id === taskId);
};

export const getPlanProgress = (plan: TaskPlan): { completed: number, total: number, percent: number } => {
	const completed = plan.tasks.filter(t => t.status === 'completed').length;
	const total = plan.tasks.length;
	const percent = total === 0 ? 0 : Math.round((completed / total) * 100);
	return { completed, total, percent };
};

export const formatTaskPlanForLLM = (plan: TaskPlan): string => {
	const lines: string[] = [];
	lines.push(`Task Plan: ${plan.title}`);
	lines.push(`Description: ${plan.description}`);
	lines.push(`Overall Status: ${plan.overallStatus}`);
	lines.push(`Progress: ${getPlanProgress(plan).percent}% (${getPlanProgress(plan).completed}/${getPlanProgress(plan).total} tasks)`);
	lines.push('');
	lines.push('Tasks:');
	for (const task of plan.tasks) {
		const deps = task.dependencies.length > 0 ? ` (depends on: ${task.dependencies.join(', ')})` : '';
		lines.push(`- [${task.status}] ${task.id}: ${task.title}`);
		lines.push(`  Description: ${task.description}${deps}`);
		if (task.result) lines.push(`  Result: ${task.result}`);
		if (task.error) lines.push(`  Error: ${task.error}`);
	}
	return lines.join('\n');
};
