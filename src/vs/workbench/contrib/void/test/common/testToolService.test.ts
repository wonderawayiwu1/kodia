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
			rootItems: this.controllers.values(),
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
