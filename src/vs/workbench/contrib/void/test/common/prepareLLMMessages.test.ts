/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { deepClone } from '../../../../../base/common/objects.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { estimateTokens } from '../../common/tokenizer.js';
import { prepareMessages, prepareSimpleLLMMessages, SimpleLLMMessage } from '../../common/prepareLLMMessages.js';
import { defaultOverridesOfModel, OptionsOfModelSelection } from '../../common/voidSettingsTypes.js';

suite('prepareLLMMessages', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const settings = () => ({
		overridesOfModel: deepClone(defaultOverridesOfModel),
		optionsOfModelSelection: { 'Chat': {}, 'Ctrl+K': {}, 'Autocomplete': {}, 'Apply': {}, 'SCM': {} } satisfies OptionsOfModelSelection,
	});

	test('puts the user\'s instructions, then the system message, in the system message', () => {
		const { messages, separateSystemMessage } = prepareSimpleLLMMessages({
			simpleMessages: [{ role: 'user', content: 'Fix the build' }],
			systemMessage: 'You are a coding agent.',
			aiInstructions: 'Answer in French.',
			modelSelection: { providerName: 'anthropic', modelName: 'claude-sonnet-4-6' },
			featureName: 'Chat',
			...settings(),
		});

		assert.strictEqual(separateSystemMessage, 'GUIDELINES AND MEMORY (from the user\'s settings, the project\'s rules files, and project memory):\nAnswer in French.\n\nYou are a coding agent.');
		assert.deepStrictEqual(messages, [{ role: 'user', content: 'Fix the build' }]);
	});

	test('converts a tool call and its result to Gemini\'s format', () => {
		const { messages, separateSystemMessage } = prepareSimpleLLMMessages({
			simpleMessages: [
				{ role: 'user', content: 'Read x.ts' },
				{ role: 'assistant', content: '', anthropicReasoning: null },
				{ role: 'tool', id: 'a', name: 'read_file', rawParams: { path: 'x.ts' }, content: 'contents' },
			],
			systemMessage: 'You are a coding agent.',
			aiInstructions: '',
			modelSelection: { providerName: 'gemini', modelName: 'gemini-3.8-flash' },
			featureName: 'Chat',
			...settings(),
		});

		assert.strictEqual(separateSystemMessage, 'You are a coding agent.');
		assert.deepStrictEqual(messages.map(m => m.role), ['user', 'model', 'user']);
	});

	suite('prepareMessages - context budget trimming', () => {
		const makeMessages = (contents: string[]): SimpleLLMMessage[] =>
			contents.map((c) => ({ role: 'user', content: c, displayContent: c, selections: null, state: { stagingSelections: [], isBeingEdited: false } }));

		const smallWindowSettings = {
			contextWindow: 4096,
			reservedOutputTokenSpace: 4096,
			tokenRatio: 1,
			// reservedOutputTokenSpace is capped at contextWindow/2 = 2048,
			// so effectiveInputBudget = max((4096-2048)/1, 1250) = 2048
			budget: Math.max((4096 - Math.min(4096 / 2, 4096)) / 1, 1_250), // 2048
		};

		test('initially over budget, trimming succeeds: no unnecessary clearing or summarisation', () => {
			// Use enough text to exceed 1250 estimated tokens regardless of tokenizer
			const longContent = 'The quick brown fox jumps over the lazy dog. '.repeat(1_500);
			const messages = makeMessages([longContent]);

			const result = prepareMessages({
				messages,
				systemMessage: 'system',
				aiInstructions: '',
				supportsSystemMessage: 'system-role',
				specialToolFormat: undefined,
				supportsAnthropicReasoning: false,
				contextWindow: smallWindowSettings.contextWindow,
				reservedOutputTokenSpace: smallWindowSettings.reservedOutputTokenSpace,
				providerName: 'anthropic',
				tokenRatio: smallWindowSettings.tokenRatio,
			});

			assert.strictEqual(result.wasInitiallyOverBudget, true);
			assert.strictEqual(result.wasStillOverBudgetAfterTrimming, false);
			assert.strictEqual(result.wasTrimmed, true);
			// Post-trim message should fit within budget
			const postTrimTokens = estimateTokens((result.messages[0] as { content: string }).content);
			assert.ok(postTrimTokens <= smallWindowSettings.budget + 100,
				`post-trim tokens ${postTrimTokens} exceed budget ${smallWindowSettings.budget}`);
		});

		test('initially over budget, trimming insufficient: fallback remains available', () => {
			// Many short messages at or below TRIM_TO_LEN (120 chars) that cannot be trimmed further.
			// Use enough messages to exceed the 2048 token budget with the real tokenizer (2 tokens per "short message").
			// 1 system message (1 token) + 1024 * "short message" (2 tokens each) = 2049 tokens > 2048 budget.
			const shortContent = 'short message';
			const messages = Array.from({ length: 1024 }, () => makeMessages([shortContent])[0]);

			const result = prepareMessages({
				messages,
				systemMessage: 'system',
				aiInstructions: '',
				supportsSystemMessage: 'system-role',
				specialToolFormat: undefined,
				supportsAnthropicReasoning: false,
				contextWindow: smallWindowSettings.contextWindow,
				reservedOutputTokenSpace: smallWindowSettings.reservedOutputTokenSpace,
				providerName: 'anthropic',
				tokenRatio: smallWindowSettings.tokenRatio,
			});

			assert.strictEqual(result.wasInitiallyOverBudget, true);
			assert.strictEqual(result.wasStillOverBudgetAfterTrimming, true);
		});

		test('already fits within budget: no trimming, no clearing or summarisation needed', () => {
			const shortContent = 'hello';
			const messages = makeMessages([shortContent]);

			const result = prepareMessages({
				messages,
				systemMessage: 'system',
				aiInstructions: '',
				supportsSystemMessage: 'system-role',
				specialToolFormat: undefined,
				supportsAnthropicReasoning: false,
				contextWindow: smallWindowSettings.contextWindow,
				reservedOutputTokenSpace: smallWindowSettings.reservedOutputTokenSpace,
				providerName: 'anthropic',
				tokenRatio: smallWindowSettings.tokenRatio,
			});

			assert.strictEqual(result.wasInitiallyOverBudget, false);
			assert.strictEqual(result.wasStillOverBudgetAfterTrimming, false);
			assert.strictEqual(result.wasTrimmed, false);
		});

		test('media tokens are included in the estimate', () => {
			// Image media adds IMAGE_TOKENS (1600) which exceeds the 1250 budget
			const messages: SimpleLLMMessage[] = [{
				role: 'user',
				content: 'x'.repeat(10_000),
				media: [{ kind: 'image', mimeType: 'image/png', dataBase64: 'abc' }],
			}];

			const result = prepareMessages({
				messages,
				systemMessage: 'system',
				aiInstructions: '',
				supportsSystemMessage: 'system-role',
				specialToolFormat: undefined,
				supportsAnthropicReasoning: false,
				contextWindow: smallWindowSettings.contextWindow,
				reservedOutputTokenSpace: smallWindowSettings.reservedOutputTokenSpace,
				providerName: 'anthropic',
				tokenRatio: smallWindowSettings.tokenRatio,
			});

			assert.strictEqual(result.wasInitiallyOverBudget, true);
		});

		test('original stored thread is not mutated by trimming', () => {
			const longContent = 'The quick brown fox jumps over the lazy dog. '.repeat(1_500);
			const originalContent = longContent;
			const messages = makeMessages([longContent]);

			prepareMessages({
				messages,
				systemMessage: 'system',
				aiInstructions: '',
				supportsSystemMessage: 'system-role',
				specialToolFormat: undefined,
				supportsAnthropicReasoning: false,
				contextWindow: smallWindowSettings.contextWindow,
				reservedOutputTokenSpace: smallWindowSettings.reservedOutputTokenSpace,
				providerName: 'anthropic',
				tokenRatio: smallWindowSettings.tokenRatio,
			});

			// Original message content should be unchanged (deepClone protects input)
			assert.strictEqual(messages[0].content, originalContent);
		});

		test('many short untrimmable messages followed by a long trimmable message', () => {
			// 200 short messages (untrimmable) + 1 long message that can be trimmed
			// This tests that the loop doesn't get stuck on untrimmable messages
			// and reaches the trimmable message
			const shortContent = 'short message'; // 13 chars, well under TRIM_TO_LEN (120)
			const longContent = 'The quick brown fox jumps over the lazy dog. '.repeat(500); // long enough to trim
			const messages = [
				...Array.from({ length: 200 }, () => makeMessages([shortContent])[0]),
				makeMessages([longContent])[0],
			];

			const result = prepareMessages({
				messages,
				systemMessage: 'system',
				aiInstructions: '',
				supportsSystemMessage: 'system-role',
				specialToolFormat: undefined,
				supportsAnthropicReasoning: false,
				contextWindow: smallWindowSettings.contextWindow,
				reservedOutputTokenSpace: smallWindowSettings.reservedOutputTokenSpace,
				providerName: 'anthropic',
				tokenRatio: smallWindowSettings.tokenRatio,
			});

			// Should be over budget initially (200 * 2 tokens + long message tokens + system)
			assert.strictEqual(result.wasInitiallyOverBudget, true);
			// Should successfully trim the long message
			assert.strictEqual(result.wasTrimmed, true);
			// After trimming, should fit within budget
			assert.strictEqual(result.wasStillOverBudgetAfterTrimming, false);
			// The last message (long one) should have been trimmed
			const lastMsg = result.messages[result.messages.length - 1] as { content: string };
			assert.ok(lastMsg.content.endsWith('...'), 'Long message should be trimmed with ellipsis');
		});

		test('collection containing only untrimmable messages', () => {
			// All messages are short and cannot be trimmed
			// Use enough to exceed budget (2048): 1024 * 2 tokens + 1 system = 2049
			const shortContent = 'short message';
			const messages = Array.from({ length: 1024 }, () => makeMessages([shortContent])[0]);

			const result = prepareMessages({
				messages,
				systemMessage: 'system',
				aiInstructions: '',
				supportsSystemMessage: 'system-role',
				specialToolFormat: undefined,
				supportsAnthropicReasoning: false,
				contextWindow: smallWindowSettings.contextWindow,
				reservedOutputTokenSpace: smallWindowSettings.reservedOutputTokenSpace,
				providerName: 'anthropic',
				tokenRatio: smallWindowSettings.tokenRatio,
			});

			assert.strictEqual(result.wasInitiallyOverBudget, true);
			assert.strictEqual(result.wasTrimmed, false); // Nothing could be trimmed
			assert.strictEqual(result.wasStillOverBudgetAfterTrimming, true); // Still over budget
		});

		test('existing over-budget fallback behavior preserved', () => {
			// Large number of untrimmable messages exceeding budget
			const shortContent = 'short message';
			const messages = Array.from({ length: 1024 }, () => makeMessages([shortContent])[0]);

			const result = prepareMessages({
				messages,
				systemMessage: 'system',
				aiInstructions: '',
				supportsSystemMessage: 'system-role',
				specialToolFormat: undefined,
				supportsAnthropicReasoning: false,
				contextWindow: smallWindowSettings.contextWindow,
				reservedOutputTokenSpace: smallWindowSettings.reservedOutputTokenSpace,
				providerName: 'anthropic',
				tokenRatio: smallWindowSettings.tokenRatio,
			});

			assert.strictEqual(result.wasInitiallyOverBudget, true);
			assert.strictEqual(result.wasStillOverBudgetAfterTrimming, true);
		});

		test('existing successful trimming behavior preserved', () => {
			// Single long message that can be trimmed to fit
			const longContent = 'The quick brown fox jumps over the lazy dog. '.repeat(1_500);
			const messages = makeMessages([longContent]);

			const result = prepareMessages({
				messages,
				systemMessage: 'system',
				aiInstructions: '',
				supportsSystemMessage: 'system-role',
				specialToolFormat: undefined,
				supportsAnthropicReasoning: false,
				contextWindow: smallWindowSettings.contextWindow,
				reservedOutputTokenSpace: smallWindowSettings.reservedOutputTokenSpace,
				providerName: 'anthropic',
				tokenRatio: smallWindowSettings.tokenRatio,
			});

			assert.strictEqual(result.wasInitiallyOverBudget, true);
			assert.strictEqual(result.wasStillOverBudgetAfterTrimming, false);
			assert.strictEqual(result.wasTrimmed, true);
			// Post-trim message should fit within budget
			const postTrimTokens = estimateTokens((result.messages[0] as { content: string }).content);
			assert.ok(postTrimTokens <= smallWindowSettings.budget + 100,
				`post-trim tokens ${postTrimTokens} exceed budget ${smallWindowSettings.budget}`);
		});
	});
});
