/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { DEFAULT_SEARCH_PROVIDER_SETTINGS, SEARCH_PROVIDER_DISPLAY_INFO } from '../../common/webSearchSettings.js';

suite('Web Search - Provider Configuration', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('All six providers are defined', () => {
		const providers = ['brave', 'tavily', 'exa', 'you', 'nvidia', 'duckduckgo'] as const;

		for (const provider of providers) {
			assert.ok(DEFAULT_SEARCH_PROVIDER_SETTINGS[provider], `Missing settings for ${provider}`);
			assert.ok(SEARCH_PROVIDER_DISPLAY_INFO[provider], `Missing display info for ${provider}`);
		}
	});

	test('DuckDuckGo is keyless', () => {
		const settings = DEFAULT_SEARCH_PROVIDER_SETTINGS.duckduckgo;
		assert.strictEqual(settings.apiKey, undefined);
		assert.ok(SEARCH_PROVIDER_DISPLAY_INFO.duckduckgo.requiresApiKey === false);
	});

	test('NVIDIA reuses existing key (no duplicate field)', () => {
		const settings = DEFAULT_SEARCH_PROVIDER_SETTINGS.nvidia;
		assert.strictEqual(settings.apiKey, undefined);
		// NVIDIA search uses the existing NVIDIA LLM provider key
		// The UI should read from the existing NVIDIA provider settings
	});

	test('Each provider has unique display info', () => {
		const providers = ['brave', 'tavily', 'exa', 'you', 'nvidia', 'duckduckgo'] as const;
		const titles = new Set<string>();
		const urls = new Set<string>();

		for (const provider of providers) {
			const info = SEARCH_PROVIDER_DISPLAY_INFO[provider];
			assert.ok(info.title, `Missing title for ${provider}`);
			assert.ok(info.description, `Missing description for ${provider}`);
			assert.ok(info.docsUrl, `Missing docs URL for ${provider}`);
			assert.ok(typeof info.requiresApiKey === 'boolean', `Missing requiresApiKey for ${provider}`);

			assert.ok(!titles.has(info.title), `Duplicate title: ${info.title}`);
			assert.ok(!urls.has(info.docsUrl), `Duplicate URL: ${info.docsUrl}`);

			titles.add(info.title);
			urls.add(info.docsUrl);
		}
	});

	test('Provider priorities are sequential starting from 0', () => {
		const priorities = [
			DEFAULT_SEARCH_PROVIDER_SETTINGS.brave.priority,
			DEFAULT_SEARCH_PROVIDER_SETTINGS.tavily.priority,
			DEFAULT_SEARCH_PROVIDER_SETTINGS.exa.priority,
			DEFAULT_SEARCH_PROVIDER_SETTINGS.you.priority,
			DEFAULT_SEARCH_PROVIDER_SETTINGS.nvidia.priority,
			DEFAULT_SEARCH_PROVIDER_SETTINGS.duckduckgo.priority,
		].sort((a, b) => a - b);

		assert.deepStrictEqual(priorities, [0, 1, 2, 3, 4, 5]);
	});

	test('DuckDuckGo has lowest priority (last)', () => {
		const providers = ['brave', 'tavily', 'exa', 'you', 'nvidia'] as const;

		for (const provider of providers) {
			assert.ok(
				DEFAULT_SEARCH_PROVIDER_SETTINGS[provider].priority <
				DEFAULT_SEARCH_PROVIDER_SETTINGS.duckduckgo.priority,
				`${provider} should have higher priority than duckduckgo`
			);
		}
	});

	test('DuckDuckGo does not require API key', () => {
		assert.strictEqual(SEARCH_PROVIDER_DISPLAY_INFO.duckduckgo.requiresApiKey, false);
	});

	test('NVIDIA does not require separate API key', () => {
		assert.strictEqual(SEARCH_PROVIDER_DISPLAY_INFO.nvidia.requiresApiKey, false);
	});

	test('All other providers require API key', () => {
		const providers = ['brave', 'tavily', 'exa', 'you'] as const;

		for (const provider of providers) {
			assert.strictEqual(SEARCH_PROVIDER_DISPLAY_INFO[provider].requiresApiKey, true);
		}
	});
});
