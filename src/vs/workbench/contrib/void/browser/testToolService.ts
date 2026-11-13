/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { Position } from '../../../../editor/common/core/position.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import {
	TestDiscoverResult,
	TestListResult,
	TestRunResult, TestRunParams,
	TestRunTargetedResult, TestRunTargetedParams,
	TestRerunFailedResult, TestRerunFailedParams,
	TestCancelResult, TestCancelParams,
	TestFramework, TestFileInfo, TestCaseResult, TestRunResultData,
} from '../common/testServiceTypes.js';
import { ITestService, IMainThreadTestController } from '../../testing/common/testService.js';
import { TestResultState, TestRunProfileBitset, IncrementalTestCollectionItem } from '../../testing/common/testTypes.js';
import { ITestResult } from '../../testing/common/testResult.js';
import { ITestResultService } from '../../testing/common/testResultService.js';

export const ITestToolService = createDecorator<ITestToolService>('TestToolService');

export interface ITestToolService {
	readonly _serviceBrand: undefined;

	// Discovery
	discoverFrameworks(): Promise<TestDiscoverResult>;
	listTests(): Promise<TestListResult>;

	// Execution
	runTests(params: TestRunParams): Promise<TestRunResult>;
	runTargetedTests(params: TestRunTargetedParams): Promise<TestRunTargetedResult>;
	rerunFailedTests(params: TestRerunFailedParams): Promise<TestRerunFailedResult>;
	cancelTestRun(params: TestCancelParams): Promise<TestCancelResult>;

	// Events
	readonly onTestRunStart: Event<{ runId: string }>;
	readonly onTestRunComplete: Event<{ runId: string; results: TestRunResultData }>;

	// Get last results
	getLastResults(): TestRunResultData | null;
}

export class TestToolService extends Disposable implements ITestToolService {
	readonly _serviceBrand: undefined;

	private readonly testService: ITestService;
	private readonly testResultService: ITestResultService;

	private lastResults: TestRunResultData | null = null;
	private currentRunId: string | null = null;

	private readonly _onTestRunStart = new Emitter<{ runId: string }>();
	readonly onTestRunStart: Event<{ runId: string }> = this._onTestRunStart.event;

	private readonly _onTestRunComplete = new Emitter<{ runId: string; results: TestRunResultData }>();
	readonly onTestRunComplete: Event<{ runId: string; results: TestRunResultData }> = this._onTestRunComplete.event;

	constructor(
		testService: ITestService,
		testResultService: ITestResultService,
	) {
		super();
		this.testService = testService;
		this.testResultService = testResultService;

		// Listen for test result changes to track completion
		this._register(testResultService.onResultsChanged((ev: any) => {
			if ('started' in ev) {
				const result = ev.started;
				this.currentRunId = result.id;
				this._onTestRunStart.fire({ runId: result.id });

				result.onComplete(() => {
					const data = this.resultToData(result, Date.now());
					this.lastResults = data;
					this._onTestRunComplete.fire({ runId: result.id, results: data });
				});
			}
		}));
	}

	// -----------------------------------------------------------------------
	// Discovery
	// -----------------------------------------------------------------------

	async discoverFrameworks(): Promise<TestDiscoverResult> {
		await this.testService.refreshTests();

		const controllers: IMainThreadTestController[] = [];
		for (const root of this.testService.collection.rootItems) {
			const ctrlId = root.controllerId;
			const ctrl = this.testService.getTestController(ctrlId);
			if (ctrl && !controllers.find(c => c.id === ctrlId)) {
				controllers.push(ctrl);
			}
		}

		for (const item of this.testService.collection.all) {
			const ctrlId = item.controllerId;
			const ctrl = this.testService.getTestController(ctrlId);
			if (ctrl && !controllers.find(c => c.id === ctrlId)) {
				controllers.push(ctrl);
			}
		}

		const frameworks: TestFramework[] = [];
		for (const ctrl of controllers) {
			frameworks.push({
				name: ctrl.label.get(),
				type: this._inferFrameworkType(ctrl.label.get()),
				controllerId: ctrl.id,
			});
		}

		return { frameworks };
	}

	async listTests(): Promise<TestListResult> {
		await this.testService.refreshTests();

		const testFiles: TestFileInfo[] = [];
		const fileMap = new Map<string, { label: string; count: number; framework?: string }>();

		for (const item of this.testService.collection.all) {
			if (!item.item.uri) continue;

			const uri = item.item.uri;
			const existing = fileMap.get(uri.fsPath);
			if (existing) {
				existing.count++;
			} else {
				fileMap.set(uri.fsPath, {
					label: basename(uri.fsPath),
					count: 1,
					framework: this._inferFrameworkType(item.controllerId),
				});
			}
		}

		for (const [uriPath, info] of fileMap) {
			testFiles.push({
				uri: uriPath,
				label: info.label,
				testCount: info.count,
				framework: info.framework,
			});
		}

		testFiles.sort((a, b) => a.label.localeCompare(b.label));
		return { testFiles };
	}

	// -----------------------------------------------------------------------
	// Execution
	// -----------------------------------------------------------------------

	async runTests(params: TestRunParams): Promise<TestRunResult> {
		const testCases = await this._resolveTestCases(params.test_files, params.test_names);
		if (!testCases.length) {
			return {
				results: this._emptyResult('no_tests_found'),
			};
		}

		const result = await this._executeTestRun(testCases, TestRunProfileBitset.Run);
		return { results: result };
	}

	async runTargetedTests(params: TestRunTargetedParams): Promise<TestRunTargetedResult> {
		const testCases: IncrementalTestCollectionItem[] = [];
		for (const changedFile of params.changed_files) {
			const uri = URI.file(changedFile);
			const related = await this.testService.getTestsRelatedToCode(uri, new Position(1, 1), CancellationToken.None);
			for (const test of related) {
				const testItem = test as IncrementalTestCollectionItem;
				if (!testCases.find(t => t.item.extId === testItem.item.extId)) {
					testCases.push(testItem);
				}
			}
		}

		if (!testCases.length) {
			return {
				results: this._emptyResult('no_related_tests'),
			};
		}

		const result = await this._executeTestRun(testCases, TestRunProfileBitset.Run);
		return { results: result };
	}

	async rerunFailedTests(params: TestRerunFailedParams): Promise<TestRerunFailedResult> {
		if (!this.lastResults) {
			return {
				results: this._emptyResult('no_previous_results'),
			};
		}

		const failedTestIds = this.lastResults.testResults
			.filter(r => r.state === 'failed' || r.state === 'errored')
			.map(r => r.id);

		if (!failedTestIds.length) {
			return {
				results: this._emptyResult('no_failed_tests'),
			};
		}

		const testCases: IncrementalTestCollectionItem[] = [];
		for (const id of failedTestIds) {
			const test = this.testService.collection.getNodeById(id);
			if (test) {
				testCases.push(test);
			}
		}

		if (!testCases.length) {
			return {
				results: this._emptyResult('failed_tests_not_found'),
			};
		}

		const result = await this._executeTestRun(testCases, TestRunProfileBitset.Run);
		return { results: result };
	}

	async cancelTestRun(params: TestCancelParams): Promise<TestCancelResult> {
		const runId = params.run_id ?? this.currentRunId;
		if (!runId) {
			return { cancelled: false };
		}

		this.testService.cancelTestRun(runId);
		return { cancelled: true };
	}

	getLastResults(): TestRunResultData | null {
		return this.lastResults;
	}

	// -----------------------------------------------------------------------
	// Private helpers
	// -----------------------------------------------------------------------

	private async _resolveTestCases(
		testFiles?: string[],
		testNames?: string[],
	): Promise<IncrementalTestCollectionItem[]> {
		if (testFiles && testFiles.length > 0) {
			const testCases: IncrementalTestCollectionItem[] = [];
			for (const filePath of testFiles) {
				const uri = URI.file(filePath);
				for await (const fileTests of this._testsInFile(uri)) {
					for (const test of fileTests) {
						testCases.push(test);
					}
				}
			}

			if (testNames && testNames.length > 0) {
				return this._filterByName(testCases, testNames);
			}
			return testCases;
		}

		if (testNames && testNames.length > 0) {
			const allTests: IncrementalTestCollectionItem[] = [];
			for (const item of this.testService.collection.all) {
				allTests.push(item);
			}
			return this._filterByName(allTests, testNames);
		}

		const allTests: IncrementalTestCollectionItem[] = [];
		for (const item of this.testService.collection.all) {
			allTests.push(item);
		}
		return allTests;
	}

	private async *_testsInFile(uri: URI): AsyncGenerator<IncrementalTestCollectionItem[]> {
		for (const item of this.testService.collection.all) {
			if (item.item.uri && item.item.uri.fsPath === uri.fsPath) {
				yield [item];
			}
		}
	}

	private async _filterByName(
		tests: IncrementalTestCollectionItem[],
		testNames: string[],
	): Promise<IncrementalTestCollectionItem[]> {
		const names = testNames.map(t => t.toLowerCase().trim());
		const filtered: IncrementalTestCollectionItem[] = [];

		const doFilter = async (test: IncrementalTestCollectionItem) => {
			const name = test.item.label.toLowerCase().trim();
			if (names.some(n => name.includes(n))) {
				filtered.push(test);
				return;
			}
			if (test.children.size > 0) {
				for (const childId of test.children) {
					const child = this.testService.collection.getNodeById(childId) as IncrementalTestCollectionItem;
					if (child) {
						await doFilter(child);
					}
				}
			}
		};

		await Promise.all(tests.map(doFilter));
		return filtered;
	}

	private async _executeTestRun(
		testCases: IncrementalTestCollectionItem[],
		group: TestRunProfileBitset,
	): Promise<TestRunResultData> {
		const startTime = Date.now();

		const result = await this.testService.runTests(
			{
				group,
				tests: testCases,
				preserveFocus: true,
			},
			CancellationToken.None
		);

		const data = await this._waitForCompletion(result.id, startTime);
		return data;
	}

	private async _waitForCompletion(runId: string, startTime: number): Promise<TestRunResultData> {
		const maxWait = 120_000;
		const pollInterval = 500;
		let waited = 0;

		while (waited < maxWait) {
			await new Promise(resolve => setTimeout(resolve, pollInterval));
			waited += pollInterval;

			if (this.lastResults && this.lastResults.runId === runId && this.lastResults.completed) {
				return this.lastResults;
			}

			const results = this.testResultService.results;
			for (const r of results) {
				if (r.id === runId && r.completedAt !== undefined) {
					const data = this.resultToData(r, startTime);
					this.lastResults = data;
					return data;
				}
			}
		}

		return this.lastResults ?? this._emptyResult('timeout');
	}

	private resultToData(result: ITestResult, startTime: number): TestRunResultData {
		const testResults: TestCaseResult[] = [];
		for (const test of result.tests) {
			const state = this._mapState(test.ownComputedState);
			const messages: string[] = [];
			let stackTrace: string | undefined;
			let uri: string | undefined;
			let line: number | undefined;

			for (const task of test.tasks) {
				for (const msg of task.messages) {
					if (msg.type === 0) { // Error
						if (typeof msg.message === 'string') {
							messages.push(msg.message);
						} else {
							messages.push(msg.message.value);
						}
						if (msg.stackTrace) {
							stackTrace = msg.stackTrace.map(f => f.label).join('\n');
						}
						if (msg.location) {
							uri = msg.location.uri.fsPath;
							line = msg.location.range.startLineNumber;
						}
					}
				}
			}

			testResults.push({
				id: test.item.extId,
				label: test.item.label,
				state,
				duration: test.ownDuration,
				message: messages.length > 0 ? messages.join('\n') : undefined,
				stackTrace,
				uri,
				line,
			});
		}

		const failed = testResults.filter(t => t.state === 'failed' || t.state === 'errored').length;
		const passed = testResults.filter(t => t.state === 'passed').length;
		const skipped = testResults.filter(t => t.state === 'skipped').length;
		const errored = testResults.filter(t => t.state === 'errored').length;

		return {
			runId: result.id,
			passed,
			failed,
			skipped,
			errored,
			total: testResults.length,
			duration: result.completedAt ? result.completedAt - startTime : undefined,
			completed: result.completedAt !== undefined,
			testResults,
		};
	}

	private _emptyResult(reason: string): TestRunResultData {
		return {
			runId: reason,
			passed: 0,
			failed: 0,
			skipped: 0,
			errored: 0,
			total: 0,
			duration: 0,
			completed: true,
			testResults: [],
		};
	}

	private _mapState(state: TestResultState): 'passed' | 'failed' | 'skipped' | 'errored' {
		switch (state) {
			case TestResultState.Passed: return 'passed';
			case TestResultState.Failed: return 'failed';
			case TestResultState.Skipped: return 'skipped';
			case TestResultState.Errored: return 'errored';
			default: return 'failed';
		}
	}

	private _inferFrameworkType(controllerLabel: string): TestFramework['type'] {
		const label = controllerLabel.toLowerCase();
		if (label.includes('jest')) return 'jest';
		if (label.includes('mocha')) return 'mocha';
		if (label.includes('vitest')) return 'vitest';
		if (label.includes('pytest')) return 'pytest';
		if (label.includes('go test') || label.includes('gotest')) return 'go test';
		if (label.includes('cargo')) return 'cargo test';
		if (label.includes('dotnet')) return 'dotnet test';
		return 'other';
	}
}

function basename(path: string): string {
	const parts = path.split(/[\\/]/);
	return parts[parts.length - 1] || path;
}

registerSingleton(ITestToolService, TestToolService, InstantiationType.Delayed);
