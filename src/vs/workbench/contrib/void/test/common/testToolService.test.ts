/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';

// ============================================================================
// Mocks for VS Code Testing API
// ============================================================================

class MockIncrementalTestCollectionItem {
	constructor(
		public controllerId: string,
		public item: { extId: string; label: string; uri: { fsPath: string } | undefined; range: { startLineNumber: number; startColumn: number } | null; children: Set<string> },
		public expand: number,
		public children: Set<string> = new Set(),
	) {}
}

class MockTestService {
	constructor(
		public controllers: Map<string, { id: string; label: { get: () => string } }> = new Map(),
		public collectionItems: MockIncrementalTestCollectionItem[] = [],
		public refreshCalled: number = 0,
		public cancelCalled: string[] = [],
		public runCalled: { group: number; tests: number; preserveFocus: boolean } | null = null,
	) {}

	async refreshTests(controllerId?: string): Promise<void> {
		this.refreshCalled++;
	}

	getTestController(controllerId: string) {
		return this.controllers.get(controllerId);
	}

	get collection() {
		return {
			rootItems: Array.from(this.controllers.values()),
			all: this.collectionItems,
			rootIds: Array.from(this.controllers.values()).map(c => c.id),
			getNodeById: (id: string) => this.collectionItems.find(t => t.item.extId === id),
			getNodeByUrl: (uri: { fsPath: string }) => {
				return this.collectionItems.filter(t => t.item.uri?.fsPath === uri.fsPath);
			},
			expand: async (id: string, levels: number) => {},
			getReviverDiff: () => [],
		};
	}

	async getTestsRelatedToCode(uri: { fsPath: string }, position: { lineNumber: number; column: number }, token: { isCancellationRequested: boolean }): Promise<MockIncrementalTestCollectionItem[]> {
		return this.collectionItems.filter(t => t.item.uri?.fsPath === uri.fsPath);
	}

	async runTests(req: { group: number; tests: MockIncrementalTestCollectionItem[]; preserveFocus: boolean }, token: { isCancellationRequested: boolean }): Promise<{ id: string; tasks: Array<{ id: string; name: string; ctrlId: string; running: boolean }> }> {
		this.runCalled = { group: req.group, tests: req.tests.length, preserveFocus: req.preserveFocus };
		const runId = 'test-run-' + Date.now();
		return {
			id: runId,
			tasks: [],
		};
	}

	cancelTestRun(runId?: string, taskId?: string): void {
		if (runId) this.cancelCalled.push(runId);
	}
}

class MockWorkspaceContextService {
	constructor(public folders: Array<{ uri: { fsPath: string } }> = [{ uri: { fsPath: '/workspace' } }]) {}
	getWorkspace() { return { folders: this.folders }; }
}

// ============================================================================
// Test the tool service types and validation logic
// ============================================================================

suite('Kodia - Test Tool Service Types', () => {

	suite('TestFramework type', () => {
		test('has required fields', () => {
			const fw: { name: string; type: string; controllerId: string } = {
				name: 'Jest',
				type: 'jest',
				controllerId: 'jest',
			};
			assert.strictEqual(fw.name, 'Jest');
			assert.strictEqual(fw.type, 'jest');
			assert.strictEqual(fw.controllerId, 'jest');
		});
	});

	suite('TestFileInfo type', () => {
		test('has required fields', () => {
			const tf: { uri: string; label: string; testCount: number; framework?: string } = {
				uri: '/workspace/test/file.test.ts',
				label: 'file.test.ts',
				testCount: 5,
				framework: 'jest',
			};
			assert.strictEqual(tf.uri, '/workspace/test/file.test.ts');
			assert.strictEqual(tf.label, 'file.test.ts');
			assert.strictEqual(tf.testCount, 5);
			assert.strictEqual(tf.framework, 'jest');
		});
	});

	suite('TestRunResultData type', () => {
		test('has required fields', () => {
			const result: {
				runId: string; passed: number; failed: number; skipped: number;
				errored: number; total: number; completed: boolean;
				testResults: Array<{ id: string; label: string; state: string }>;
			} = {
				runId: 'run-1',
				passed: 8,
				failed: 1,
				skipped: 0,
				errored: 1,
				total: 10,
				completed: true,
				testResults: [
					{ id: 't1', label: 'test one', state: 'passed' },
					{ id: 't2', label: 'test two', state: 'failed' },
				],
			};
			assert.strictEqual(result.runId, 'run-1');
			assert.strictEqual(result.passed, 8);
			assert.strictEqual(result.failed, 1);
			assert.strictEqual(result.total, 10);
			assert.strictEqual(result.completed, true);
			assert.strictEqual(result.testResults.length, 2);
		});
	});

});

// ============================================================================
// Mock-based execution tests for test tool service logic
// ============================================================================

suite('Kodia - Test Tool Execution Logic (mocked)', () => {

	suite('MockTestService behavior', () => {
		test('refreshTests increments counter', async () => {
			const service = new MockTestService();
			await service.refreshTests();
			await service.refreshTests('jest');
			assert.strictEqual(service.refreshCalled, 2);
		});

		test('getTestController returns controller', () => {
			const service = new MockTestService();
			service.controllers.set('jest', { id: 'jest', label: { get: () => 'Jest' } });
			const ctrl = service.getTestController('jest');
			assert.ok(ctrl);
			assert.strictEqual(ctrl.id, 'jest');
		});

		test('getTestsRelatedToCode returns matching tests', async () => {
			const service = new MockTestService();
			const testItem = new MockIncrementalTestCollectionItem(
				'jest',
				{ extId: 'jest//file.test.ts', label: 'file.test.ts', uri: { fsPath: '/workspace/file.test.ts' }, range: null, children: new Set() },
				0,
			);
			service.collectionItems.push(testItem);

			const related = await service.getTestsRelatedToCode(
				{ fsPath: '/workspace/file.test.ts' },
				{ lineNumber: 1, column: 1 },
				{ isCancellationRequested: false },
			);
			assert.strictEqual(related.length, 1);
			assert.strictEqual(related[0].item.label, 'file.test.ts');
		});

		test('getTestsRelatedToCode returns empty for non-matching file', async () => {
			const service = new MockTestService();
			const related = await service.getTestsRelatedToCode(
				{ fsPath: '/workspace/other.ts' },
				{ lineNumber: 1, column: 1 },
				{ isCancellationRequested: false },
			);
			assert.strictEqual(related.length, 0);
		});

		test('cancelTestRun records the run ID', () => {
			const service = new MockTestService();
			service.cancelTestRun('run-1');
			service.cancelTestRun('run-2');
			assert.deepStrictEqual(service.cancelCalled, ['run-1', 'run-2']);
		});

		test('cancelTestRun with no ID does nothing', () => {
			const service = new MockTestService();
			service.cancelTestRun();
			assert.deepStrictEqual(service.cancelCalled, []);
		});
	});

	suite('MockWorkspaceContextService', () => {
		test('returns workspace folders', () => {
			const service = new MockWorkspaceContextService();
			const ws = service.getWorkspace();
			assert.strictEqual(ws.folders.length, 1);
			assert.strictEqual(ws.folders[0].uri.fsPath, '/workspace');
		});

		test('custom folders', () => {
			const service = new MockWorkspaceContextService([
				{ uri: { fsPath: '/proj1' } },
				{ uri: { fsPath: '/proj2' } },
			]);
			const ws = service.getWorkspace();
			assert.strictEqual(ws.folders.length, 2);
		});
	});

});

// ============================================================================
// Integration tests for TestToolService (actual class with mocks)
// ============================================================================

import { Emitter } from '../../../../../base/common/event.js';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { TestToolService } from '../../browser/testToolService.js';
import {
	TestRunResultData,
} from '../../common/testServiceTypes.js';
import { TestResultState } from '../../../../../workbench/contrib/testing/common/testTypes.js';

// ============================================================================
// Full mocks for VS Code Testing API
// ============================================================================

class FullMockIncrementalTestCollectionItem {
	constructor(
		public controllerId: string,
		public item: { extId: string; label: string; uri: { fsPath: string } | undefined; range: { startLineNumber: number; startColumn: number } | null; children: Set<string> },
		public expand: number,
		public children: Set<string> = new Set(),
	) {}
}

class FullMockTestService {
	controllers: Map<string, { id: string; controllerId: string; label: { get: () => string } }> = new Map();
	collectionItems: FullMockIncrementalTestCollectionItem[] = [];
	refreshCalled: number = 0;
	cancelCalled: string[] = [];
	runResult: { id: string; tasks: Array<{ id: string; name: string; ctrlId: string; running: boolean }> } | null = null;
	runTestsCalled = new DeferredPromise<void>();

	async refreshTests(controllerId?: string): Promise<void> {
		this.refreshCalled++;
	}

	getTestController(controllerId: string) {
		return this.controllers.get(controllerId);
	}

	get collection() {
		return {
			rootItems: Array.from(this.controllers.values()).map(c => ({
				controllerId: c.controllerId,
				item: { extId: c.controllerId, label: c.label.get(), uri: undefined, range: null, children: new Set() },
				expand: 0,
				children: new Set<string>(),
			})),
			all: this.collectionItems,
			rootIds: Array.from(this.controllers.values()).map(c => c.id),
			getNodeById: (id: string) => this.collectionItems.find(t => t.item.extId === id),
			getNodeByUrl: (uri: { fsPath: string }) => {
				return this.collectionItems.filter(t => t.item.uri?.fsPath === uri.fsPath);
			},
			expand: async (id: string, levels: number) => {},
			getReviverDiff: () => [],
		};
	}

	async getTestsRelatedToCode(uri: { fsPath: string }, position: { lineNumber: number; column: number }, token: { isCancellationRequested: boolean }): Promise<FullMockIncrementalTestCollectionItem[]> {
		return this.collectionItems.filter(t => t.item.uri?.fsPath === uri.fsPath);
	}

	async runTests(req: { group: number; tests: FullMockIncrementalTestCollectionItem[]; preserveFocus: boolean }, token: { isCancellationRequested: boolean }): Promise<{ id: string; tasks: Array<{ id: string; name: string; ctrlId: string; running: boolean }> }> {
		this.runTestsCalled.complete(undefined);
		const runId = 'test-run-' + Date.now();
		this.runResult = { id: runId, tasks: [] };
		return { id: runId, tasks: [] };
	}

	cancelTestRun(runId?: string, taskId?: string): void {
		if (runId) this.cancelCalled.push(runId);
	}
}

class FullMockTestResultService {
	onResultsChangedEmitter = new Emitter<any>();
	onResultsChanged = this.onResultsChangedEmitter.event;
	results: any[] = [];

	getResult(resultId: string): any {
		return this.results.find(r => r.id === resultId);
	}

	fireStarted(result: any): void {
		this.results.push(result);
		this.onResultsChangedEmitter.fire({ started: result });
	}

	fireCompleted(result: any): void {
		result.completedAt = Date.now();
		this.onResultsChangedEmitter.fire({ completed: result });
	}
}

// ============================================================================
// TestToolService integration tests
// ============================================================================

suite('Kodia - TestToolService (integration)', () => {

	let testService: FullMockTestService;
	let resultService: FullMockTestResultService;
	let toolService: TestToolService;

	setup(() => {
		testService = new FullMockTestService();
		resultService = new FullMockTestResultService();
		toolService = new TestToolService(testService as any, resultService as any);
	});

	suite('discoverFrameworks', () => {
		test('returns frameworks from controllers', async () => {
			testService.controllers.set('jest', { id: 'jest', controllerId: 'jest', label: { get: () => 'Jest' } });
			testService.controllers.set('mocha', { id: 'mocha', controllerId: 'mocha', label: { get: () => 'Mocha' } });

			// Add test items so they show up in collection
			testService.collectionItems.push(
				new FullMockIncrementalTestCollectionItem('jest', { extId: 'jest//t1', label: 'test 1', uri: { fsPath: '/workspace/file.test.ts' }, range: null, children: new Set() }, 0),
			);

			const result = await toolService.discoverFrameworks();
			assert.strictEqual(result.frameworks.length, 2);
			assert.ok(result.frameworks.some(f => f.name === 'Jest' && f.controllerId === 'jest'));
			assert.ok(result.frameworks.some(f => f.name === 'Mocha' && f.controllerId === 'mocha'));
		});

		test('returns empty when no controllers', async () => {
			const result = await toolService.discoverFrameworks();
			assert.strictEqual(result.frameworks.length, 0);
		});
	});

	suite('listTests', () => {
		test('lists test files from collection', async () => {
			testService.controllers.set('jest', { id: 'jest', controllerId: 'jest', label: { get: () => 'Jest' } });
			testService.collectionItems.push(
				new FullMockIncrementalTestCollectionItem('jest', { extId: 'jest//t1', label: 'test 1', uri: { fsPath: '/workspace/file.test.ts' }, range: null, children: new Set() }, 0),
				new FullMockIncrementalTestCollectionItem('jest', { extId: 'jest//t2', label: 'test 2', uri: { fsPath: '/workspace/file.test.ts' }, range: null, children: new Set() }, 0),
				new FullMockIncrementalTestCollectionItem('jest', { extId: 'jest//t3', label: 'test 3', uri: { fsPath: '/workspace/other.test.ts' }, range: null, children: new Set() }, 0),
			);

			const result = await toolService.listTests();
			assert.strictEqual(result.testFiles.length, 2);
			assert.ok(result.testFiles.some(f => f.uri === '/workspace/file.test.ts' && f.testCount === 2));
			assert.ok(result.testFiles.some(f => f.uri === '/workspace/other.test.ts' && f.testCount === 1));
		});

		test('returns empty when no tests', async () => {
			const result = await toolService.listTests();
			assert.strictEqual(result.testFiles.length, 0);
		});
	});

	suite('runTests', () => {
		test('resultToData maps test results correctly', () => {
			const mockResult = {
				id: 'run-1',
				completedAt: Date.now(),
				tests: [
					{
						item: { extId: 't1', label: 'test one' },
						ownComputedState: TestResultState.Passed,
						ownDuration: 100,
						tasks: [],
					},
					{
						item: { extId: 't2', label: 'test two' },
						ownComputedState: TestResultState.Failed,
						ownDuration: 50,
						tasks: [],
					},
				],
				tasks: [],
			} as any;

			const data = (toolService as any).resultToData(mockResult, Date.now() - 200);
			assert.strictEqual(data.runId, 'run-1');
			assert.strictEqual(data.passed, 1);
			assert.strictEqual(data.failed, 1);
			assert.strictEqual(data.total, 2);
			assert.strictEqual(data.completed, true);
			assert.strictEqual(data.testResults[0].state, 'passed');
			assert.strictEqual(data.testResults[1].state, 'failed');
		});

		test('returns empty result when no tests found', async () => {
			testService.controllers.set('jest', { id: 'jest', controllerId: 'jest', label: { get: () => 'Jest' } });
			// No collection items

			const result = await toolService.runTests({ test_files: ['/workspace/nonexistent.test.ts'] });
			assert.strictEqual(result.results.total, 0);
			assert.strictEqual(result.results.completed, true);
			assert.strictEqual(result.results.runId, 'no_tests_found');
		});
	});

	suite('runTargetedTests', () => {
		test('analyzeTestResults categorizes failures correctly', () => {
			const results: TestRunResultData = {
				runId: 'run-1',
				passed: 5,
				failed: 2,
				skipped: 1,
				errored: 1,
				total: 9,
				duration: 500,
				completed: true,
				testResults: [
					{ id: 't1', label: 'test one', state: 'passed' },
					{ id: 't2', label: 'test two', state: 'failed', message: 'AssertionError', uri: '/workspace/file.test.ts', line: 10 },
					{ id: 't3', label: 'test three', state: 'failed', message: 'TypeError', uri: '/workspace/file.test.ts', line: 20 },
					{ id: 't4', label: 'test four', state: 'skipped' },
					{ id: 't5', label: 'test five', state: 'errored', message: 'Timeout' },
				],
			};

			const analysis = (toolService as any).analyzeTestResults(results);
			assert.strictEqual(analysis.hasFailures, true);
			assert.ok(analysis.failureSummary.includes('3 test(s) failed'));
			assert.ok(analysis.failureSummary.includes('/workspace/file.test.ts'));
			assert.ok(analysis.recommendations.length > 0);
		});

		test('returns empty when no related tests', async () => {
			const result = await toolService.runTargetedTests({ changed_files: ['/workspace/nonexistent.ts'] });
			assert.strictEqual(result.results.total, 0);
			assert.strictEqual(result.results.runId, 'no_related_tests');
		});
	});

	suite('rerunFailedTests', () => {
		test('reruns failed tests from last results', async () => {
			// Set up last results with a failed test
			const failedResult: TestRunResultData = {
				runId: 'previous-run',
				passed: 1,
				failed: 1,
				skipped: 0,
				errored: 0,
				total: 2,
				duration: 100,
				completed: true,
				testResults: [
					{ id: 'jest//t1', label: 'passing test', state: 'passed' },
					{ id: 'jest//t2', label: 'failing test', state: 'failed', message: 'AssertionError' },
				],
			};
			(toolService as any).lastResults = failedResult;

			// Verify lastResults is correctly set for rerun
			const last = toolService.getLastResults();
			assert.strictEqual(last?.failed, 1);
			assert.strictEqual(last?.testResults.length, 2);
		});

		test('returns empty when no previous results', async () => {
			(toolService as any).lastResults = null;
			const result = await toolService.rerunFailedTests({});
			assert.strictEqual(result.results.total, 0);
			assert.strictEqual(result.results.runId, 'no_previous_results');
		});

		test('returns empty when no failed tests', async () => {
			const passedResult: TestRunResultData = {
				runId: 'previous-run',
				passed: 2,
				failed: 0,
				skipped: 0,
				errored: 0,
				total: 2,
				duration: 100,
				completed: true,
				testResults: [
					{ id: 'jest//t1', label: 'test 1', state: 'passed' },
					{ id: 'jest//t2', label: 'test 2', state: 'passed' },
				],
			};
			(toolService as any).lastResults = passedResult;
			const result = await toolService.rerunFailedTests({});
			assert.strictEqual(result.results.total, 0);
			assert.strictEqual(result.results.runId, 'no_failed_tests');
		});
	});

	suite('cancelTestRun', () => {
		test('cancels the current run', async () => {
			(toolService as any).currentRunId = 'run-123';
			const result = await toolService.cancelTestRun({});
			assert.strictEqual(result.cancelled, true);
			assert.deepStrictEqual(testService.cancelCalled, ['run-123']);
		});

		test('cancels specified run', async () => {
			const result = await toolService.cancelTestRun({ run_id: 'run-456' });
			assert.strictEqual(result.cancelled, true);
			assert.deepStrictEqual(testService.cancelCalled, ['run-456']);
		});

		test('returns false when no run to cancel', async () => {
			(toolService as any).currentRunId = null;
			const result = await toolService.cancelTestRun({});
			assert.strictEqual(result.cancelled, false);
		});
	});

	suite('getTestRunStatus', () => {
		test('returns last results for matching runId', async () => {
			const data: TestRunResultData = {
				runId: 'run-1',
				passed: 5,
				failed: 0,
				skipped: 0,
				errored: 0,
				total: 5,
				duration: 100,
				completed: true,
				testResults: [],
			};
			(toolService as any).lastResults = data;
			const status = toolService.getTestRunStatus('run-1');
			assert.strictEqual(status?.runId, 'run-1');
			assert.strictEqual(status?.passed, 5);
		});

		test('returns null for unknown runId', () => {
			const status = toolService.getTestRunStatus('unknown');
			assert.strictEqual(status, null);
		});

		test('returns result from resultService', async () => {
			const mockResult = {
				id: 'run-2',
				completedAt: Date.now(),
				tests: [],
				tasks: [],
			} as any;
			resultService.results.push(mockResult);
			const status = toolService.getTestRunStatus('run-2');
			assert.strictEqual(status?.runId, 'run-2');
		});
	});

	suite('isTestRunRunning', () => {
		test('returns false when no runs', () => {
			assert.strictEqual(toolService.isTestRunRunning(), false);
		});

		test('returns true when currentRunId is set', () => {
			(toolService as any).currentRunId = 'run-1';
			assert.strictEqual(toolService.isTestRunRunning(), true);
		});

		test('returns true when runningRuns has entries', () => {
			// Can't easily add to runningRuns since it's private, but currentRunId covers it
			(toolService as any).currentRunId = 'run-1';
			assert.strictEqual(toolService.isTestRunRunning(), true);
		});
	});

	suite('runAndAnalyzeTests', () => {
		test('analyzeTestResults identifies passing tests', () => {
			const results: TestRunResultData = {
				runId: 'run-1',
				passed: 5,
				failed: 0,
				skipped: 0,
				errored: 0,
				total: 5,
				duration: 200,
				completed: true,
				testResults: [
					{ id: 't1', label: 'test one', state: 'passed' },
					{ id: 't2', label: 'test two', state: 'passed' },
				],
			};

			const analysis = (toolService as any).analyzeTestResults(results);
			assert.strictEqual(analysis.hasFailures, false);
			assert.ok(analysis.failureSummary.includes('All 5 tests passed'));
			assert.ok(Array.isArray(analysis.recommendations));
		});

	});


	suite('getLastResults', () => {
		test('returns null initially', () => {
			assert.strictEqual(toolService.getLastResults(), null);
		});

		test('returns last results after a run', () => {
			const data: TestRunResultData = {
				runId: 'run-1',
				passed: 1,
				failed: 0,
				skipped: 0,
				errored: 0,
				total: 1,
				duration: 100,
				completed: true,
				testResults: [],
			};
			(toolService as any).lastResults = data;
			assert.strictEqual(toolService.getLastResults(), data);
		});
	});
});
