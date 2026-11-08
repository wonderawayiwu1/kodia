/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { validateSearchProviderSettings } from '../../common/webSearchSettings.js';
import { WebSearchProviderName } from '../../common/webSearchTypes.js';

suite('Web Search - Error Handling', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('validateSearchProviderSettings rejects empty API key for providers requiring it', () => {
		const providers: WebSearchProviderName[] = ['brave', 'tavily', 'exa', 'you'];

		for (const provider of providers) {
			const result = validateSearchProviderSettings(provider, {
				enabled: true,
				apiKey: '',
				priority: 0,
				maxResults: 10,
				timeoutMs: 15000,
			});

			assert.strictEqual(result.valid, false, `${provider} should reject empty API key`);
			assert.ok(result.errors.some(e => e.includes('API key')), `${provider} should have API key error`);
		}
	});

	test('validateSearchProviderSettings accepts empty API key for DuckDuckGo', () => {
		const result = validateSearchProviderSettings('duckduckgo', {
			enabled: true,
			apiKey: '',
			priority: 0,
			maxResults: 10,
			timeoutMs: 15000,
		});

		assert.strictEqual(result.valid, true);
	});

	test('validateSearchProviderSettings accepts empty API key for NVIDIA', () => {
		const result = validateSearchProviderSettings('nvidia', {
			enabled: true,
			apiKey: '',
			priority: 0,
			maxResults: 10,
			timeoutMs: 15000,
		});

		assert.strictEqual(result.valid, true);
	});

	test('validateSearchProviderSettings rejects invalid maxResults', () => {
		const result = validateSearchProviderSettings('brave', {
			enabled: true,
			apiKey: 'test-key',
			priority: 0,
			maxResults: 0, // invalid
			timeoutMs: 15000,
		});

		assert.strictEqual(result.valid, false);
		assert.ok(result.errors.some(e => e.includes('maxResults')));
	});

	test('validateSearchProviderSettings rejects invalid timeoutMs', () => {
		const result = validateSearchProviderSettings('brave', {
			enabled: true,
			apiKey: 'test-key',
			priority: 0,
			maxResults: 10,
			timeoutMs: 500, // too low
		});

		assert.strictEqual(result.valid, false);
		assert.ok(result.errors.some(e => e.includes('timeoutMs')));
	});

	test('validateSearchProviderSettings rejects invalid priority', () => {
		const result = validateSearchProviderSettings('brave', {
			enabled: true,
			apiKey: 'test-key',
			priority: -1, // invalid
			maxResults: 10,
			timeoutMs: 15000,
		});

		assert.strictEqual(result.valid, false);
		assert.ok(result.errors.some(e => e.includes('priority')));
	});

	test('validateSearchProviderSettings accepts valid settings', () => {
		const result = validateSearchProviderSettings('brave', {
			enabled: true,
			apiKey: 'valid-key-123',
			priority: 0,
			maxResults: 10,
			timeoutMs: 15000,
		});

		assert.strictEqual(result.valid, true);
		assert.strictEqual(result.errors.length, 0);
	});

	test('DuckDuckGo settings validation does not require API key', () => {
		const result = validateSearchProviderSettings('duckduckgo', {
			enabled: true,
			apiKey: undefined,
			priority: 5,
			maxResults: 10,
			timeoutMs: 15000,
		});

		assert.strictEqual(result.valid, true);
	});

	test('NVIDIA settings validation does not require separate API key', () => {
		const result = validateSearchProviderSettings('nvidia', {
			enabled: true,
			apiKey: undefined,
			priority: 3,
			maxResults: 10,
			timeoutMs: 15000,
		});

		assert.strictEqual(result.valid, true);
	});
});
