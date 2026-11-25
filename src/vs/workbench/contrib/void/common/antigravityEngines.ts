/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import type { SubagentProfile } from './subagents.js';
import type { InteractiveWidgetPayload } from './cursorAntigravityEngines.js';

// ============================================================================
// 1. Live Focus, Execution Steps Checklist, Interactive Questions & Artifacts
// ============================================================================

export type AgentStepStatus = 'pending' | 'in_progress' | 'done' | 'skipped' | 'failed';

export interface AgentStepItem {
	title: string;
	status: AgentStepStatus;
}

export interface UserQuestionItem {
	question: string;
	options: string[];
	is_multi_select?: boolean;
}

export interface UserQuestionAnswer {
	question: string;
	selected: string[];
	otherText?: string;
}

export interface PendingUserQuestion {
	id: string;
	threadId: string;
	questions: UserQuestionItem[];
	createdAt: number;
}

export type ArtifactKind = 'plan' | 'walkthrough' | 'report' | 'checklist' | 'other';

export interface ThreadArtifactMeta {
	id: string;
	name: string;
	title: string;
	path: string;
	kind: ArtifactKind;
	summary: string;
	requestFeedback: boolean;
	updatedAt: number;
	approved?: boolean;
}

export interface ThreadAgentUXState {
	focus?: string;
	focusUpdatedAt?: number;
	steps: AgentStepItem[];
	pendingQuestion?: PendingUserQuestion;
	artifacts: ThreadArtifactMeta[];
	widgets: InteractiveWidgetPayload[];
}

export function sanitizeArtifactFilename(rawName: string): string {
	const cleaned = rawName
		.trim()
		.replace(/\\/g, '/')
		.split('/')
		.pop()!
		.replace(/[^a-zA-Z0-9._-]/g, '_')
		.replace(/^_+|_+$/g, '');
	const base = cleaned || 'artifact';
	return base.endsWith('.md') ? base : `${base}.md`;
}

// ============================================================================
// 2. Dynamic Runtime Subagent Registry (define_subagent / manage_subagents)
// ============================================================================

export interface DynamicSubagentDefinition {
	name: string;
	description: string;
	systemPrompt: string;
	canChangeFiles: boolean;
	allowedTools?: string[];
	defaultModel?: string;
	createdAt: number;
	persistedPath?: string;
}

export interface SubagentSessionStatus {
	sessionId: string;
	parentThreadId: string;
	agent: string;
	description: string;
	state: 'running' | 'completed' | 'failed' | 'cancelled' | 'timed_out';
	startedAt: number;
	endedAt?: number;
	filesChanged: string[];
	toolCallCount: number;
	error?: string;
}

export interface ParallelWorkflowStageTask {
	agent: string;
	description: string;
	prompt: string;
	model?: string;
}

export interface ParallelWorkflowStage {
	name: string;
	tasks: ParallelWorkflowStageTask[];
}

export interface ParallelWorkflowTaskResult {
	stage: string;
	agent: string;
	description: string;
	sessionId: string;
	status: string;
	filesChanged: string[];
	summary: string;
	durationMs: number;
	error?: string;
}

export interface ParallelWorkflowReport {
	description: string;
	totalStages: number;
	totalTasks: number;
	succeeded: number;
	failed: number;
	durationMs: number;
	results: ParallelWorkflowTaskResult[];
}

export class DynamicSubagentRegistry {
	private readonly definitions = new Map<string, DynamicSubagentDefinition>();

	define(def: Omit<DynamicSubagentDefinition, 'createdAt'>): DynamicSubagentDefinition {
		const normalizedName = def.name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
		if (!normalizedName) {
			throw new Error('Subagent name must contain at least one letter or digit.');
		}
		const record: DynamicSubagentDefinition = {
			...def,
			name: normalizedName,
			createdAt: Date.now(),
		};
		this.definitions.set(normalizedName, record);
		return record;
	}

	get(name: string): DynamicSubagentDefinition | undefined {
		return this.definitions.get(name.trim().toLowerCase());
	}

	toProfile(name: string): SubagentProfile | undefined {
		const def = this.get(name);
		if (!def) return undefined;
		return {
			canChangeFiles: def.canChangeFiles,
			description: def.description,
			guidance: def.systemPrompt,
			allowedTools: def.allowedTools,
			defaultModel: def.defaultModel,
		};
	}

	list(): DynamicSubagentDefinition[] {
		return Array.from(this.definitions.values());
	}

	remove(name: string): boolean {
		return this.definitions.delete(name.trim().toLowerCase());
	}

	toAgentMarkdown(def: DynamicSubagentDefinition): string {
		const lines = [
			'---',
			`name: ${def.name}`,
			`description: ${def.description.replace(/\r?\n/g, ' ')}`,
			`can_change_files: ${def.canChangeFiles}`,
		];
		if (def.allowedTools && def.allowedTools.length > 0) {
			lines.push(`tools: ${def.allowedTools.join(', ')}`);
		}
		if (def.defaultModel) {
			lines.push(`model: ${def.defaultModel}`);
		}
		lines.push('---', '', def.systemPrompt.trim(), '');
		return lines.join('\n');
	}
}

export const dynamicSubagentRegistry = new DynamicSubagentRegistry();

// ============================================================================
// 3. Antigravity Task Scheduler & Cron Engine (schedule_task / manage_scheduled_tasks)
// ============================================================================

export type ScheduledTaskKind = 'timer' | 'cron';
export type ScheduledTaskStatus = 'active' | 'paused' | 'completed' | 'cancelled';

export interface ScheduledTaskInfo {
	id: string;
	threadId?: string;
	kind: ScheduledTaskKind;
	prompt: string;
	durationSeconds?: number;
	cronExpression?: string;
	maxIterations?: number;
	status: ScheduledTaskStatus;
	createdAt: number;
	runCount: number;
	lastTriggeredAt?: number;
	nextRunAt?: number;
	lastError?: string;
}

/** Matches a single 5-field cron field against a numeric date component. */
export function matchCronField(field: string, value: number, min: number, max: number): boolean {
	const parts = field.trim().split(',');
	for (const rawPart of parts) {
		const part = rawPart.trim();
		if (!part) continue;
		const [rangePart, stepStr] = part.split('/');
		const step = stepStr !== undefined ? Number.parseInt(stepStr, 10) : 1;
		if (!Number.isInteger(step) || step <= 0) return false;

		if (rangePart === '*') {
			if ((value - min) % step === 0 && value >= min && value <= max) return true;
			continue;
		}
		if (rangePart.includes('-')) {
			const [startStr, endStr] = rangePart.split('-');
			const start = Number.parseInt(startStr, 10);
			const end = Number.parseInt(endStr, 10);
			if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) return false;
			if (value >= start && value <= end && (value - start) % step === 0) return true;
			continue;
		}
		const exact = Number.parseInt(rangePart, 10);
		if (!Number.isInteger(exact)) return false;
		if (stepStr !== undefined) {
			if (value >= exact && value <= max && (value - exact) % step === 0) return true;
		} else if (value === exact) {
			return true;
		}
	}
	return false;
}

/** Validates a standard 5-field cron expression: `min hour dom month dow`. */
export function validateCronExpression(expr: string): { valid: boolean; error?: string } {
	const fields = expr.trim().split(/\s+/);
	if (fields.length !== 5) {
		return { valid: false, error: `Cron expression must have exactly 5 fields (minute hour day-of-month month day-of-week), got ${fields.length}.` };
	}
	const bounds: Array<[number, number, string]> = [
		[0, 59, 'minute'],
		[0, 23, 'hour'],
		[1, 31, 'day-of-month'],
		[1, 12, 'month'],
		[0, 7, 'day-of-week'],
	];
	const tokenPattern = /^(\*|\d+(-\d+)?)(\/\d+)?(,(\*|\d+(-\d+)?)(\/\d+)?)*$/;
	for (let i = 0; i < 5; i++) {
		if (!tokenPattern.test(fields[i])) {
			return { valid: false, error: `Invalid cron ${bounds[i][2]} field: "${fields[i]}".` };
		}
	}
	return { valid: true };
}

/** Checks if `date` matches a 5-field cron expression. */
export function cronMatchesDate(expr: string, date: Date): boolean {
	const fields = expr.trim().split(/\s+/);
	if (fields.length !== 5) return false;
	const [minF, hourF, domF, monF, dowF] = fields;
	const dow = date.getDay(); // 0 = Sunday
	const dowMatches = matchCronField(dowF, dow, 0, 7) || (dow === 0 && matchCronField(dowF, 7, 0, 7));
	return (
		matchCronField(minF, date.getMinutes(), 0, 59) &&
		matchCronField(hourF, date.getHours(), 0, 23) &&
		matchCronField(domF, date.getDate(), 1, 31) &&
		matchCronField(monF, date.getMonth() + 1, 1, 12) &&
		dowMatches
	);
}

/** Computes the next matching Date within the next 366 days for a 5-field cron expression. */
export function computeNextCronRun(expr: string, fromDate: Date = new Date()): Date | undefined {
	const check = validateCronExpression(expr);
	if (!check.valid) return undefined;
	const cursor = new Date(fromDate.getTime());
	cursor.setSeconds(0, 0);
	cursor.setMinutes(cursor.getMinutes() + 1);
	// Scan up to 14 days minute-by-minute (20,160 iterations — <2ms in V8)
	for (let i = 0; i < 14 * 24 * 60; i++) {
		if (cronMatchesDate(expr, cursor)) {
			return cursor;
		}
		cursor.setMinutes(cursor.getMinutes() + 1);
	}
	return undefined;
}

interface InternalScheduledTask extends ScheduledTaskInfo {
	timerHandle?: ReturnType<typeof setTimeout>;
	lastCronMinuteKey?: string;
}

export class KodiaTaskScheduler {
	private readonly tasks = new Map<string, InternalScheduledTask>();
	private cronTicker: ReturnType<typeof setInterval> | undefined;
	private seq = 0;

	constructor(private readonly onTrigger: (task: ScheduledTaskInfo) => void | Promise<void>) { }

	schedule(opts: {
		threadId?: string;
		prompt: string;
		durationSeconds?: number;
		cronExpression?: string;
		maxIterations?: number;
	}): ScheduledTaskInfo {
		if (opts.durationSeconds !== undefined && opts.cronExpression !== undefined) {
			throw new Error('Provide either durationSeconds (one-shot timer) or cronExpression (recurring cron), not both.');
		}
		if (opts.durationSeconds === undefined && !opts.cronExpression) {
			throw new Error('Must provide either durationSeconds or cronExpression.');
		}
		const id = `sched_${Date.now().toString(36)}_${++this.seq}`;
		const nowMs = Date.now();

		if (opts.durationSeconds !== undefined) {
			const secs = Math.max(1, Math.min(opts.durationSeconds, 86400 * 7));
			const task: InternalScheduledTask = {
				id,
				threadId: opts.threadId,
				kind: 'timer',
				prompt: opts.prompt,
				durationSeconds: secs,
				maxIterations: 1,
				status: 'active',
				createdAt: nowMs,
				runCount: 0,
				nextRunAt: nowMs + secs * 1000,
			};
			task.timerHandle = setTimeout(() => { void this._fireTask(task); }, secs * 1000);
			this.tasks.set(id, task);
			return this._publicInfo(task);
		}

		const cron = opts.cronExpression!.trim();
		const valid = validateCronExpression(cron);
		if (!valid.valid) {
			throw new Error(valid.error ?? `Invalid cron expression: ${cron}`);
		}
		const nextRun = computeNextCronRun(cron, new Date(nowMs));
		const task: InternalScheduledTask = {
			id,
			threadId: opts.threadId,
			kind: 'cron',
			prompt: opts.prompt,
			cronExpression: cron,
			maxIterations: opts.maxIterations,
			status: 'active',
			createdAt: nowMs,
			runCount: 0,
			nextRunAt: nextRun?.getTime(),
		};
		this.tasks.set(id, task);
		this._ensureCronTicker();
		return this._publicInfo(task);
	}

	list(threadId?: string): ScheduledTaskInfo[] {
		const all = Array.from(this.tasks.values());
		return (threadId ? all.filter(t => !t.threadId || t.threadId === threadId) : all).map(t => this._publicInfo(t));
	}

	get(id: string): ScheduledTaskInfo | undefined {
		const t = this.tasks.get(id);
		return t ? this._publicInfo(t) : undefined;
	}

	pause(id: string): ScheduledTaskInfo | undefined {
		const t = this.tasks.get(id);
		if (!t || t.status !== 'active') return t ? this._publicInfo(t) : undefined;
		if (t.timerHandle) {
			clearTimeout(t.timerHandle);
			t.timerHandle = undefined;
		}
		t.status = 'paused';
		return this._publicInfo(t);
	}

	resume(id: string): ScheduledTaskInfo | undefined {
		const t = this.tasks.get(id);
		if (!t || t.status !== 'paused') return t ? this._publicInfo(t) : undefined;
		t.status = 'active';
		if (t.kind === 'timer') {
			const remainingMs = Math.max(1000, (t.nextRunAt ?? Date.now() + 1000) - Date.now());
			t.nextRunAt = Date.now() + remainingMs;
			t.timerHandle = setTimeout(() => { void this._fireTask(t); }, remainingMs);
		} else if (t.cronExpression) {
			t.nextRunAt = computeNextCronRun(t.cronExpression)?.getTime();
			this._ensureCronTicker();
		}
		return this._publicInfo(t);
	}

	cancel(id: string): boolean {
		const t = this.tasks.get(id);
		if (!t) return false;
		if (t.timerHandle) {
			clearTimeout(t.timerHandle);
			t.timerHandle = undefined;
		}
		t.status = 'cancelled';
		t.nextRunAt = undefined;
		this._maybeStopCronTicker();
		return true;
	}

	dispose(): void {
		for (const t of this.tasks.values()) {
			if (t.timerHandle) clearTimeout(t.timerHandle);
		}
		this.tasks.clear();
		if (this.cronTicker) {
			clearInterval(this.cronTicker);
			this.cronTicker = undefined;
		}
	}

	private _ensureCronTicker(): void {
		if (this.cronTicker) return;
		this.cronTicker = setInterval(() => {
			const now = new Date();
			const minuteKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
			for (const task of this.tasks.values()) {
				if (task.kind !== 'cron' || task.status !== 'active' || !task.cronExpression) continue;
				if (task.lastCronMinuteKey === minuteKey) continue;
				if (cronMatchesDate(task.cronExpression, now)) {
					task.lastCronMinuteKey = minuteKey;
					void this._fireTask(task);
				}
			}
			this._maybeStopCronTicker();
		}, 15_000);
		if (typeof (this.cronTicker as any).unref === 'function') {
			(this.cronTicker as any).unref();
		}
	}

	private _maybeStopCronTicker(): void {
		const hasActiveCron = Array.from(this.tasks.values()).some(t => t.kind === 'cron' && t.status === 'active');
		if (!hasActiveCron && this.cronTicker) {
			clearInterval(this.cronTicker);
			this.cronTicker = undefined;
		}
	}

	private async _fireTask(task: InternalScheduledTask): Promise<void> {
		if (task.status !== 'active') return;
		task.runCount += 1;
		task.lastTriggeredAt = Date.now();
		if (task.kind === 'timer' || (task.maxIterations && task.runCount >= task.maxIterations)) {
			task.status = 'completed';
			task.nextRunAt = undefined;
		} else if (task.cronExpression) {
			task.nextRunAt = computeNextCronRun(task.cronExpression)?.getTime();
		}
		try {
			await this.onTrigger(this._publicInfo(task));
		} catch (err) {
			task.lastError = err instanceof Error ? err.message : String(err);
		}
		this._maybeStopCronTicker();
	}

	private _publicInfo(t: InternalScheduledTask): ScheduledTaskInfo {
		return {
			id: t.id,
			threadId: t.threadId,
			kind: t.kind,
			prompt: t.prompt,
			durationSeconds: t.durationSeconds,
			cronExpression: t.cronExpression,
			maxIterations: t.maxIterations,
			status: t.status,
			createdAt: t.createdAt,
			runCount: t.runCount,
			lastTriggeredAt: t.lastTriggeredAt,
			nextRunAt: t.nextRunAt,
			lastError: t.lastError,
		};
	}
}
