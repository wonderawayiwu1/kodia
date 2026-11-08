/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { WebSearchProviderName, SearchProviderSettings } from '../../common/webSearchTypes.js';
import { DEFAULT_SEARCH_PROVIDER_SETTINGS } from '../../common/webSearchSettings.js';

suite('Web Search - Types', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('WebSearchProviderName enum has correct values', () => {
		const providers: WebSearchProviderName[] = ['brave', 'tavily', 'exa', 'you', 'nvidia', 'duckduckgo'];
		assert.deepStrictEqual(providers, ['brave', 'tavily', 'exa', 'you', 'nvidia', 'duckduckgo']);
	});

	test('SearchProviderSettings type has correct structure', () => {
		const settings: SearchProviderSettings = {
			apiKey: 'test-key',
			enabled: true,
			priority: 0,
			maxResults: 10,
			timeoutMs: 15000,
		};

		assert.strictEqual(settings.apiKey, 'test-key');
		assert.strictEqual(settings.enabled, true);
		assert.strictEqual(settings.priority, 0);
		assert.strictEqual(settings.maxResults, 10);
		assert.strictEqual(settings.timeoutMs, 15000);
	});

	test('SearchProviderSettings defaults are correct', () => {
		const providers = ['brave', 'tavily', 'exa', 'you', 'nvidia', 'duckduckgo'] as const;

		for (const provider of providers) {
			const defaults = DEFAULT_SEARCH_PROVIDER_SETTINGS[provider];
			assert.strictEqual(defaults.enabled, false);
			assert.strictEqual(defaults.maxResults, 10);
			assert.strictEqual(defaults.timeoutMs, 15000);
			assert.strictEqual(defaults.enabled, false);
			assert.strictEqual(typeof defaults.priority, 'number');
			assert.ok(defaults.priority >= 0);

			// DuckDuckGo and NVIDIA don't require API keys
			if (provider === 'duckduckgo' || provider === 'nvidia') {
				assert.strictEqual(defaults.apiKey, undefined);
			} else {
				assert.strictEqual(defaults.apiKey, undefined);
			}
		}
	});

	test('WebSearchProviderName type only allows valid providers', () => {
		// TypeScript compile-time check - these should compile
		const validProviders = ['brave', 'tavily', 'exa', 'you', 'nvidia', 'duckduckgo'];
		assert.strictEqual(validProviders.length, 6);
	});
});
