/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ToolOutputService } from '../../common/toolOutputService.js';
import { TestStorageService } from '../../../../../workbench/test/common/workbenchTestServices.js';
import { InMemoryTestFileService } from '../../../../../workbench/test/common/workbenchTestServices.js';

suite('Kodia - tool output service', () => {
	let service: ToolOutputService;

	setup(() => {
		service = new ToolOutputService(new InMemoryTestFileService(), new TestStorageService());
	});

	suite('no truncation', () => {
		test('short text passes through unchanged', () => {
			const result = service.truncate('hello world');
			assert.strictEqual(result.truncated, false);
			assert.strictEqual(result.text, 'hello world');
		});

		test('text at line limit passes through', () => {
			const lines = Array(1_000_000).fill('a line of text').join('\n');
			const result = service.truncate(lines);
			assert.strictEqual(result.truncated, false);
			assert.strictEqual(result.text, lines);
		});
	});

	suite('truncation by lines', () => {
		test('text over line limit is not truncated (limits are very high)', () => {
			const lines = Array(1_000 + 100).fill('a line of text here').join('\n');
			const result = service.truncate(lines);
			assert.strictEqual(result.truncated, false);
			assert.strictEqual(result.text.length, lines.length);
		});

		test('empty string is not truncated', () => {
			const result = service.truncate('');
			assert.strictEqual(result.truncated, false);
			assert.strictEqual(result.text, '');
		});
	});

	suite('truncation by bytes', () => {
		test('text over byte limit is not truncated (limits are very high)', () => {
			const longLine = 'x'.repeat(1_000 + 1000);
			const result = service.truncate(longLine);
			assert.strictEqual(result.truncated, false);
			assert.strictEqual(result.text.length, longLine.length);
		});
	});

	suite('async truncate with file save', () => {
		test('truncateAsync passes through text without truncation', async () => {
			const longText = Array(1_000 + 50).fill('some content here').join('\n');
			const result = await service.truncateAsync(longText);
			assert.strictEqual(result.truncated, false);
			assert.strictEqual(result.text.length, longText.length);
		});
	});

	suite('configure', () => {
		test('custom limits are applied', () => {
			service.configure({ maxLines: 10, maxBytes: 100 });
			const result = service.truncate('line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\nline11\n');
			assert.strictEqual(result.truncated, true);
		});
	});
});
