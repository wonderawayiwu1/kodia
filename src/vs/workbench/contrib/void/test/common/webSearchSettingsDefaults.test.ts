/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { DEFAULT_SEARCH_PROVIDER_SETTINGS } from '../../common/webSearchSettings.js';
import { WebSearchProviderName } from '../../common/webSearchTypes.js';

suite('Web Search - Settings Defaults', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('Each provider has default settings', () => {
		const providers: WebSearchProviderName[] = ['brave', 'tavily', 'exa', 'you', 'nvidia', 'duckduckgo'];

		for (const provider of providers) {
			const defaults = DEFAULT_SEARCH_PROVIDER_SETTINGS[provider];
			assert.ok(defaults, `Missing defaults for ${provider}`);
			assert.strictEqual(defaults.enabled, false);
			assert.strictEqual(defaults.maxResults, 10);
			assert.strictEqual(defaults.timeoutMs, 15000);
			assert.ok(typeof defaults.priority === 'number');
			assert.ok(defaults.priority >= 0 && defaults.priority <= 10);

			// DuckDuckGo and NVIDIA don't require API keys in default settings
			if (provider === 'duckduckgo' || provider === 'nvidia') {
				assert.strictEqual(defaults.apiKey, undefined);
			} else {
				assert.strictEqual(defaults.apiKey, undefined);
			}
		}
	});

	test('Each provider has unique default priority', () => {
		const priorities = new Set<number>();
		const providers = ['brave', 'tavily', 'exa', 'you', 'nvidia', 'duckduckgo'] as const;

		for (const provider of providers) {
			const priority = DEFAULT_SEARCH_PROVIDER_SETTINGS[provider].priority;
			assert.ok(!priorities.has(priority), `Duplicate priority ${priority} for ${provider}`);
			priorities.add(priority);
		}
	});

	test('DuckDuckGo has highest priority number (last)', () => {
		const providers = ['brave', 'tavily', 'exa', 'you', 'nvidia'] as const;

		for (const provider of providers) {
			const priority = DEFAULT_SEARCH_PROVIDER_SETTINGS[provider].priority;
			assert.ok(priority < DEFAULT_SEARCH_PROVIDER_SETTINGS.duckduckgo.priority,
				`${provider} should have lower priority than duckduckgo`);
		}
	});
});
