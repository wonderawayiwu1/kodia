/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { SearchProviderSettings } from '../../common/webSearchTypes.js';
import { normalizeSearchProviderSettings } from '../../common/webSearchSettings.js';

suite('Web Search - Settings Persistence', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('normalizeSearchProviderSettings applies defaults correctly', () => {
		const input: SearchProviderSettings = {
			apiKey: 'test-key',
			enabled: true,
			priority: 5,
			maxResults: 20,
			timeoutMs: 30000,
		};

		const normalized = normalizeSearchProviderSettings('brave', input);

		assert.strictEqual(normalized.apiKey, 'test-key');
		assert.strictEqual(normalized.enabled, true);
		assert.strictEqual(normalized.priority, 5);
		assert.strictEqual(normalized.maxResults, 20);
		assert.strictEqual(normalized.timeoutMs, 30000);
	});

	test('normalizeSearchProviderSettings clamps values to valid ranges', () => {
		const input: SearchProviderSettings = {
			apiKey: 'test-key',
			enabled: true,
			priority: 15, // too high
			maxResults: 100, // too high
			timeoutMs: 500, // too low
		};

		const normalized = normalizeSearchProviderSettings('brave', input);

		assert.strictEqual(normalized.priority, 10); // clamped to max
		assert.strictEqual(normalized.maxResults, 50); // clamped to max
		assert.strictEqual(normalized.timeoutMs, 1000); // clamped to min
	});

	test('normalizeSearchProviderSettings applies defaults for missing fields', () => {
		const partialInput = {
			enabled: true,
		} as any;

		const normalized = normalizeSearchProviderSettings('tavily', partialInput);

		assert.strictEqual(normalized.enabled, true);
		assert.strictEqual(normalized.priority, 1); // tavily default
		assert.strictEqual(normalized.maxResults, 10);
		assert.strictEqual(normalized.timeoutMs, 15000);
		assert.strictEqual(normalized.apiKey, undefined);
	});

	test('normalizeSearchProviderSettings trims API key whitespace', () => {
		const input: SearchProviderSettings = {
			apiKey: '  test-key  ',
			enabled: true,
			priority: 0,
			maxResults: 10,
			timeoutMs: 15000,
		};

		const normalized = normalizeSearchProviderSettings('brave', input);

		assert.strictEqual(normalized.apiKey, 'test-key');
	});

	test('normalizeSearchProviderSettings handles empty API key', () => {
		const input: SearchProviderSettings = {
			apiKey: '   ',
			enabled: true,
			priority: 0,
			maxResults: 10,
			timeoutMs: 15000,
		};

		const normalized = normalizeSearchProviderSettings('brave', input);

		assert.strictEqual(normalized.apiKey, undefined);
	});

	test('normalizeSearchProviderSettings clamps priority to valid range', () => {
		const lowPriority = normalizeSearchProviderSettings('brave', { priority: -5, enabled: true } as any);
		assert.strictEqual(lowPriority.priority, 0);

		const highPriority = normalizeSearchProviderSettings('brave', { priority: 20, enabled: true } as any);
		assert.strictEqual(highPriority.priority, 10);
	});

	test('normalizeSearchProviderSettings clamps maxResults', () => {
		const lowResults = normalizeSearchProviderSettings('brave', { maxResults: 0, enabled: true } as any);
		assert.strictEqual(lowResults.maxResults, 1);

		const highResults = normalizeSearchProviderSettings('brave', { maxResults: 100, enabled: true } as any);
		assert.strictEqual(highResults.maxResults, 50);
	});

	test('normalizeSearchProviderSettings clamps timeoutMs', () => {
		const lowTimeout = normalizeSearchProviderSettings('brave', { timeoutMs: 500, enabled: true } as any);
		assert.strictEqual(lowTimeout.timeoutMs, 1000);

		const highTimeout = normalizeSearchProviderSettings('brave', { timeoutMs: 100000, enabled: true } as any);
		assert.strictEqual(highTimeout.timeoutMs, 60000);
	});
});
