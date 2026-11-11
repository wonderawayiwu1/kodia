/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	estimateTokens,
	getTokenizer,
	TokenizerEncoding,
	TokenizerAccuracy,
	TokenizerSelectionReason,
} from '../../common/tokenizer.js';

const unicodeText = 'Hello, 世界! 🚀 ñoño 右左م testo';
const cjkText = '你好世界，这是中文文本。';
const emojiText = '🚀🔥💯🎉😀👍';
const rtlText = 'مرحبا بالعולם שלום עברית';
const sourceCodeText = `function fibonacci(n: number): number {
	if (n <= 1) return n;
	return fibonacci(n - 1) + fibonacci(n - 2);
}
const memo: Record<number, number> = {};
export function fib(n: number): number {
	if (memo[n]) return memo[n];
	memo[n] = fib(n - 1) + fib(n - 2);
	return memo[n];
}`;

suite('Kodia - tokenizer registry', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('estimateTokens backward compatibility: returns a number for any string', () => {
		assert.strictEqual(estimateTokens(''), 0);
		assert.ok(Number.isFinite(estimateTokens('hello world')));
		assert.ok(estimateTokens('hello world') > 0);
	});

	test('estimateTokens: empty string returns 0', () => {
		assert.strictEqual(estimateTokens(''), 0);
	});

	test('getTokenizer: unknown provider/model falls back safely', () => {
		const sel = getTokenizer('unknownProvider', 'unknown-model');
		assert.strictEqual(sel.reason, 'fallback');
		assert.strictEqual(sel.accuracy, 'approximate');
		assert.strictEqual(sel.encoding, 'o200k_base');
		assert.ok(typeof sel.countTokens === 'function');
		assert.ok(sel.countTokens('hello') > 0);
	});

	test('getTokenizer: unsupported providers are not mislabeled as exact', () => {
		const providers = ['anthropic', 'gemini', 'nvidia', 'deepseek', 'mistral', 'xAI', 'ollama', 'vLLM', 'lmStudio', 'mlx'];
		for (const provider of providers) {
			const sel = getTokenizer(provider, 'some-model');
			assert.strictEqual(sel.accuracy, 'approximate', `${provider} should not be exact`);
			assert.strictEqual(sel.reason, 'fallback', `${provider} should be fallback`);
		}
	});

	test('getTokenizer: OpenRouter and Groq are not given provider-wide exact tokenizer', () => {
		const routerSel = getTokenizer('openRouter', 'meta-llama/llama-3.3-70b-instruct');
		assert.strictEqual(routerSel.accuracy, 'approximate', 'OpenRouter should not be exact (multi-family)');
		assert.strictEqual(routerSel.reason, 'fallback', 'OpenRouter should be fallback');

		const groqSel = getTokenizer('groq', 'meta-llama/llama-3.3-70b-instruct');
		assert.strictEqual(groqSel.accuracy, 'approximate', 'Groq should not be exact (multi-family)');
		assert.strictEqual(groqSel.reason, 'fallback', 'Groq should be fallback');
	});

	test('getTokenizer: modern OpenAI family selects o200k_base via family hint', () => {
		const sel = getTokenizer('openAI', 'gpt-5');
		assert.strictEqual(sel.encoding, 'o200k_base');
		assert.strictEqual(sel.reason, 'family-hint');
		assert.strictEqual(sel.accuracy, 'approximate');

		const sel2 = getTokenizer('openAI', 'gpt-6-astra');
		assert.strictEqual(sel2.encoding, 'o200k_base');
		assert.strictEqual(sel2.reason, 'family-hint');
	});

	test('getTokenizer: legacy OpenAI family selects cl100k_base via family hint', () => {
		const sel = getTokenizer('openAI', 'gpt-4');
		assert.strictEqual(sel.encoding, 'cl100k_base');
		assert.strictEqual(sel.reason, 'family-hint');
		assert.strictEqual(sel.accuracy, 'approximate');

		const sel2 = getTokenizer('openAI', 'gpt-3.5-turbo');
		assert.strictEqual(sel2.encoding, 'cl100k_base');
		assert.strictEqual(sel2.reason, 'family-hint');
	});

	test('getTokenizer: exact-model hint takes precedence over family fallback', () => {
		// OpenAI models have tokenizerEncoding: 'o200k_base' in catalog metadata
		const sel = getTokenizer('openAI', 'gpt-6-astra', { tokenizerEncoding: 'o200k_base' as TokenizerEncoding });
		assert.strictEqual(sel.encoding, 'o200k_base');
		assert.strictEqual(sel.reason, 'exact-model');
		assert.strictEqual(sel.accuracy, 'exact');
	});

	test('getTokenizer: Nemotron regression - o200k_base selection', () => {
		const sel = getTokenizer('nvidia', 'nvidia/nemotron-3.5-super-vl-120b-a12b');
		// Nemotron has no tokenizerEncoding hint (not established), so it falls back to o200k_base as approximate
		assert.strictEqual(sel.encoding, 'o200k_base');
		assert.strictEqual(sel.reason, 'fallback');
		assert.strictEqual(sel.accuracy, 'approximate');
		// countTokens works
		assert.ok(sel.countTokens('hello world') > 0);
	});

	test('getTokenizer: synchronous fallback before tokenizer loading completes', () => {
		// Even before o200k_base finishes loading, countTokens should return chars/4 fallback
		const sel = getTokenizer('unknownProvider', 'unknown-model');
		const result = sel.countTokens('abcd');
		assert.strictEqual(result, 1); // 4 chars / 4 = 1 token
	});

	test('getTokenizer: countTokens is deterministic for same input', () => {
		const sel = getTokenizer('openAI', 'gpt-5');
		const text = 'The quick brown fox jumps over the lazy dog.';
		assert.strictEqual(sel.countTokens(text), sel.countTokens(text));
	});

	test('getTokenizer: unicode and multilingual text', () => {
		const sel = getTokenizer('openAI', 'gpt-5');
		const count = sel.countTokens(unicodeText);
		assert.ok(Number.isFinite(count));
		assert.ok(count > 0);
		// Should not throw
	});

	test('getTokenizer: CJK text', () => {
		const sel = getTokenizer('openAI', 'gpt-5');
		const count = sel.countTokens(cjkText);
		assert.ok(Number.isFinite(count));
		assert.ok(count > 0);
	});

	test('getTokenizer: emoji text', () => {
		const sel = getTokenizer('openAI', 'gpt-5');
		const count = sel.countTokens(emojiText);
		assert.ok(Number.isFinite(count));
		assert.ok(count > 0);
	});

	test('getTokenizer: RTL text', () => {
		const sel = getTokenizer('openAI', 'gpt-5');
		const count = sel.countTokens(rtlText);
		assert.ok(Number.isFinite(count));
		assert.ok(count > 0);
	});

	test('getTokenizer: source code text', () => {
		const sel = getTokenizer('openAI', 'gpt-5');
		const count = sel.countTokens(sourceCodeText);
		assert.ok(Number.isFinite(count));
		assert.ok(count > 0);
	});

	test('getTokenizer: cl100k_base handles unicode', () => {
		const sel = getTokenizer('openAI', 'gpt-4');
		assert.strictEqual(sel.encoding, 'cl100k_base');
		const count = sel.countTokens(unicodeText);
		assert.ok(Number.isFinite(count));
		assert.ok(count > 0);
	});

	test('getTokenizer: all selection reason values are valid', () => {
		const reasons = new Set<TokenizerSelectionReason>();
		reasons.add(getTokenizer('openAI', 'gpt-5').reason);
		reasons.add(getTokenizer('openAI', 'gpt-4').reason);
		reasons.add(getTokenizer('unknown', 'model').reason);
		assert.ok(reasons.has('family-hint') || reasons.has('fallback'));
	});

	test('getTokenizer: all accuracy values are valid', () => {
		const accuracies = new Set<TokenizerAccuracy>();
		accuracies.add(getTokenizer('openAI', 'gpt-6-astra', { tokenizerEncoding: 'o200k_base' as TokenizerEncoding }).accuracy);
		accuracies.add(getTokenizer('unknown', 'model').accuracy);
		assert.ok(accuracies.has('exact') || accuracies.has('approximate'));
	});
});
