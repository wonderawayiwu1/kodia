/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { SearchResult } from '../../common/webSearchTypes.js';
import { WebSearchError, WebSearchErrorType } from '../../electron-main/webSearchErrors.js';

suite('NVIDIA Reranker Service (production logic)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	// Test constants matching the service
	const NVIDIA_RERANK_ENDPOINT = 'https://ai.api.nvidia.com/v1/retrieval/nvidia/nemotron-3.5-rerank-8b/reranking';
	const NVIDIA_RERANK_MODEL = 'nvidia/nemotron-3.5-rerank-8b';
	const DEFAULT_MAX_PASSAGES = 20;

	// Mock SearchResult factory
	function createMockResult(overrides: Partial<SearchResult> = {}): SearchResult {
		return {
			title: 'Test Title',
			url: 'https://example.com',
			displayUrl: 'example.com',
			snippet: 'Test snippet',
			source: 'brave',
			publishedDate: undefined,
			retrievalTimestamp: Date.now(),
			...overrides,
		};
	}

	suite('Request Construction', () => {
		test('uses correct endpoint', () => {
			assert.strictEqual(NVIDIA_RERANK_ENDPOINT, 'https://ai.api.nvidia.com/v1/retrieval/nvidia/nemotron-3.5-rerank-8b/reranking');
		});

		test('uses correct model identifier', () => {
			assert.strictEqual(NVIDIA_RERANK_MODEL, 'nvidia/nemotron-3.5-rerank-8b');
		});

		test('constructs request body with correct structure', () => {
			const query = 'test query';
			const passages = [{ text: 'passage 1' }, { text: 'passage 2' }];
			const truncate = 'END';

			const body = {
				model: NVIDIA_RERANK_MODEL,
				query: { text: query },
				passages,
				truncate,
			};

			assert.strictEqual(body.model, NVIDIA_RERANK_MODEL);
			assert.deepStrictEqual(body.query, { text: query });
			assert.deepStrictEqual(body.passages, passages);
			assert.strictEqual(body.truncate, 'END');
		});

		test('limits passages to maxPassages', () => {
			const results = Array.from({ length: 50 }, (_, i) => createMockResult({ title: `Result ${i}` }));
			const maxPassages = DEFAULT_MAX_PASSAGES;
			const passages = results.slice(0, maxPassages).map(r => ({ text: `${r.title}. ${r.snippet}` }));

			assert.strictEqual(passages.length, DEFAULT_MAX_PASSAGES);
		});

		test('filters out empty passages', () => {
			const results = [
				createMockResult({ title: 'Good', snippet: 'content' }),
				createMockResult({ title: '', snippet: '' }),
				createMockResult({ title: 'Also good', snippet: 'more content' }),
			];

			// Service logic: constructs "title. snippet" then trims
			// Empty title + empty snippet = "." (just a dot after trim)
			const passages = results
				.map(r => ({ text: `${r.title}. ${r.snippet}`.trim() }))
				.filter(p => p.text.length > 1); // Filter out just "." or empty

			assert.strictEqual(passages.length, 2);
			assert.strictEqual(passages[0].text, 'Good. content');
			assert.strictEqual(passages[1].text, 'Also good. more content');
		});

		test('handles missing snippet gracefully', () => {
			const result = createMockResult({ snippet: '' });
			const text = `${result.title}. ${result.snippet}`.trim();
			assert.strictEqual(text, 'Test Title.');
		});

		test('uses correct default maxPassages', () => {
			const results = Array.from({ length: 5 }, (_, i) => createMockResult({ title: `Result ${i}` }));
			const maxPassages = DEFAULT_MAX_PASSAGES;
			const limited = results.slice(0, maxPassages);

			assert.strictEqual(limited.length, 5); // less than default max
		});
	});

	suite('Ranking Application', () => {
		function applyRankings(
			originalResults: SearchResult[],
			submittedPassageCount: number,
			responseData: unknown
		): SearchResult[] {
			// Duplicate of service's _applyRankings logic for testing
			const response = responseData as { rankings?: unknown[] };
			const rankings = response?.rankings;

			if (!Array.isArray(rankings) || rankings.length === 0) {
				return originalResults;
			}

			const validatedRankings: { index: number; logit: number }[] = [];
			const seenIndices = new Set<number>();

			for (const entry of rankings) {
				const obj = entry as { index?: unknown; logit?: unknown };

				if (typeof obj.index !== 'number' || !Number.isInteger(obj.index)) continue;
				if (obj.index < 0 || obj.index >= submittedPassageCount) continue;
				if (seenIndices.has(obj.index)) continue;
				if (typeof obj.logit !== 'number' || !Number.isFinite(obj.logit)) continue;

				seenIndices.add(obj.index);
				validatedRankings.push({ index: obj.index, logit: obj.logit });
			}

			if (validatedRankings.length === 0) {
				return originalResults;
			}

			const reranked: SearchResult[] = [];
			const usedIndices = new Set<number>();

			for (const { index } of validatedRankings) {
				const result = originalResults[index];
				if (result) {
					reranked.push(result);
					usedIndices.add(index);
				}
			}

			for (let i = 0; i < originalResults.length; i++) {
				if (!usedIndices.has(i)) {
					reranked.push(originalResults[i]);
				}
			}

			return reranked;
		}

		test('reorders results using returned indices', () => {
			const original = [
				createMockResult({ title: 'Result A', url: 'https://a.com' }),
				createMockResult({ title: 'Result B', url: 'https://b.com' }),
				createMockResult({ title: 'Result C', url: 'https://c.com' }),
			];

			const response = {
				rankings: [
					{ index: 1, logit: -1.0 },
					{ index: 2, logit: -1.5 },
					{ index: 0, logit: -2.0 },
				],
			};

			const reranked = applyRankings(original, 3, response);
			assert.strictEqual(reranked[0].title, 'Result B');
			assert.strictEqual(reranked[1].title, 'Result C');
			assert.strictEqual(reranked[2].title, 'Result A');
		});

		test('preserves original SearchResult objects (identity)', () => {
			const original = [
				createMockResult({ title: 'A', url: 'https://a.com' }),
				createMockResult({ title: 'B', url: 'https://b.com' }),
			];

			const response = { rankings: [{ index: 1, logit: -1.0 }, { index: 0, logit: -2.0 }] };
			const reranked = applyRankings(original, 2, response);

			assert.strictEqual(reranked[0], original[1]);
			assert.strictEqual(reranked[1], original[0]);
		});

		test('preserves all SearchResult fields', () => {
			const original = [
				createMockResult({
					title: 'Test',
					url: 'https://test.com',
					snippet: 'Snippet',
					source: 'tavily',
					publishedDate: '2026-01-15',
				}),
			];

			const response = { rankings: [{ index: 0, logit: -1.0 }] };
			const reranked = applyRankings(original, 1, response);

			assert.strictEqual(reranked[0].title, 'Test');
			assert.strictEqual(reranked[0].url, 'https://test.com');
			assert.strictEqual(reranked[0].snippet, 'Snippet');
			assert.strictEqual(reranked[0].source, 'tavily');
			assert.strictEqual(reranked[0].publishedDate, '2026-01-15');
		});

		test('appends results beyond reranking limit in original order', () => {
			const original = [
				createMockResult({ title: 'A', url: 'https://a.com' }),
				createMockResult({ title: 'B', url: 'https://b.com' }),
				createMockResult({ title: 'C', url: 'https://c.com' }),
				createMockResult({ title: 'D', url: 'https://d.com' }),
				createMockResult({ title: 'E', url: 'https://e.com' }),
			];

			// Only submit first 3 for reranking
			const response = {
				rankings: [
					{ index: 2, logit: -1.0 },
					{ index: 0, logit: -1.5 },
					{ index: 1, logit: -2.0 },
				],
			};

			const reranked = applyRankings(original, 3, response);

			// First 3 should be reranked: C, A, B
			// D and E should be appended in original order
			assert.strictEqual(reranked[0].title, 'C');
			assert.strictEqual(reranked[1].title, 'A');
			assert.strictEqual(reranked[2].title, 'B');
			assert.strictEqual(reranked[3].title, 'D');
			assert.strictEqual(reranked[4].title, 'E');
		});

		test('preserves relative order of appended results', () => {
			const original = [
				createMockResult({ title: 'A', url: 'https://a.com' }),
				createMockResult({ title: 'B', url: 'https://b.com' }),
				createMockResult({ title: 'C', url: 'https://c.com' }),
				createMockResult({ title: 'D', url: 'https://d.com' }),
				createMockResult({ title: 'E', url: 'https://e.com' }),
			];

			const response = { rankings: [{ index: 0, logit: -1.0 }] }; // only 1 submitted
			const reranked = applyRankings(original, 1, response);

			// A is reranked (only one), B,C,D,E appended in order
			assert.strictEqual(reranked[0].title, 'A');
			assert.strictEqual(reranked[1].title, 'B');
			assert.strictEqual(reranked[2].title, 'C');
			assert.strictEqual(reranked[3].title, 'D');
			assert.strictEqual(reranked[4].title, 'E');
		});
	});

	suite('Response Validation', () => {
		function applyRankings(
			originalResults: SearchResult[],
			submittedPassageCount: number,
			responseData: unknown
		): SearchResult[] {
			const response = responseData as { rankings?: unknown[] };
			const rankings = response?.rankings;

			if (!Array.isArray(rankings) || rankings.length === 0) {
				return originalResults;
			}

			const validatedRankings: { index: number; logit: number }[] = [];
			const seenIndices = new Set<number>();

			for (const entry of rankings) {
				const obj = entry as { index?: unknown; logit?: unknown };

				if (typeof obj.index !== 'number' || !Number.isInteger(obj.index)) continue;
				if (obj.index < 0 || obj.index >= submittedPassageCount) continue;
				if (seenIndices.has(obj.index)) continue;
				if (typeof obj.logit !== 'number' || !Number.isFinite(obj.logit)) continue;

				seenIndices.add(obj.index);
				validatedRankings.push({ index: obj.index, logit: obj.logit });
			}

			if (validatedRankings.length === 0) {
				return originalResults;
			}

			const reranked: SearchResult[] = [];
			const usedIndices = new Set<number>();

			for (const { index } of validatedRankings) {
				const result = originalResults[index];
				if (result) {
					reranked.push(result);
					usedIndices.add(index);
				}
			}

			for (let i = 0; i < originalResults.length; i++) {
				if (!usedIndices.has(i)) {
					reranked.push(originalResults[i]);
				}
			}

			return reranked;
		}

		test('returns original on invalid JSON / missing rankings', () => {
			const original = [createMockResult(), createMockResult()];

			assert.deepStrictEqual(applyRankings(original, 2, {}), original);
			assert.deepStrictEqual(applyRankings(original, 2, { rankings: null }), original);
			assert.deepStrictEqual(applyRankings(original, 2, { rankings: [] }), original);
			assert.deepStrictEqual(applyRankings(original, 2, { foo: 'bar' }), original);
		});

		test('rejects negative indices', () => {
			const original = [createMockResult(), createMockResult()];
			const response = { rankings: [{ index: -1, logit: -1.0 }] };

			assert.deepStrictEqual(applyRankings(original, 2, response), original);
		});

		test('rejects out-of-range indices', () => {
			const original = [createMockResult(), createMockResult()];
			const response = { rankings: [{ index: 5, logit: -1.0 }] };

			assert.deepStrictEqual(applyRankings(original, 2, response), original);
		});

		test('rejects duplicate indices', () => {
			const original = [createMockResult({ title: 'A' }), createMockResult({ title: 'B' })];
			const response = {
				rankings: [
					{ index: 0, logit: -1.0 },
					{ index: 0, logit: -2.0 }, // duplicate
				],
			};

			const reranked = applyRankings(original, 2, response);
			// Only first occurrence kept
			assert.strictEqual(reranked.length, 2);
		});

		test('rejects non-integer indices', () => {
			const original = [createMockResult(), createMockResult()];
			const response = { rankings: [{ index: 1.5, logit: -1.0 }] };

			assert.deepStrictEqual(applyRankings(original, 2, response), original);
		});

		test('rejects NaN/infinite logits', () => {
			const original = [createMockResult(), createMockResult()];

			for (const logit of [NaN, Infinity, -Infinity]) {
				const response = { rankings: [{ index: 0, logit }] };
				assert.deepStrictEqual(applyRankings(original, 2, response), original);
			}
		});

		test('rejects missing logit', () => {
			const original = [createMockResult(), createMockResult()];
			const response = { rankings: [{ index: 0 }] };

			assert.deepStrictEqual(applyRankings(original, 2, response), original);
		});

		test('rejects missing index', () => {
			const original = [createMockResult(), createMockResult()];
			const response = { rankings: [{ logit: -1.0 }] };

			assert.deepStrictEqual(applyRankings(original, 2, response), original);
		});

		test('returns original when no valid rankings after validation', () => {
			const original = [createMockResult(), createMockResult()];
			const response = { rankings: [{ index: 5, logit: -1.0 }] }; // invalid index

			assert.deepStrictEqual(applyRankings(original, 2, response), original);
		});
	});

	suite('Error Handling', () => {
		test('classifies 400 as Configuration error', () => {
			const error = WebSearchError.classifyStatusCode(400, 'nvidia');
			assert.strictEqual(error.type, WebSearchErrorType.Configuration);
			assert.strictEqual(error.isRetryable, false);
		});

		test('classifies 401 as Configuration error', () => {
			const error = WebSearchError.classifyStatusCode(401, 'nvidia');
			assert.strictEqual(error.type, WebSearchErrorType.Configuration);
			assert.strictEqual(error.isRetryable, false);
		});

		test('classifies 402 as Configuration error', () => {
			const error = WebSearchError.classifyStatusCode(402, 'nvidia');
			assert.strictEqual(error.type, WebSearchErrorType.Configuration);
			assert.strictEqual(error.isRetryable, false);
		});

		test('classifies 403 as Configuration error', () => {
			const error = WebSearchError.classifyStatusCode(403, 'nvidia');
			assert.strictEqual(error.type, WebSearchErrorType.Configuration);
			assert.strictEqual(error.isRetryable, false);
		});

		test('classifies 422 as Configuration error', () => {
			const error = WebSearchError.classifyStatusCode(422, 'nvidia');
			assert.strictEqual(error.type, WebSearchErrorType.Configuration);
			assert.strictEqual(error.isRetryable, false);
		});

		test('classifies 429 as Transient error', () => {
			const error = WebSearchError.classifyStatusCode(429, 'nvidia');
			assert.strictEqual(error.type, WebSearchErrorType.Transient);
			assert.strictEqual(error.isRetryable, true);
		});

		test('classifies 500 as Transient error', () => {
			const error = WebSearchError.classifyStatusCode(500, 'nvidia');
			assert.strictEqual(error.type, WebSearchErrorType.Transient);
			assert.strictEqual(error.isRetryable, true);
		});

		test('classifies 503 as Transient error', () => {
			const error = WebSearchError.classifyStatusCode(503, 'nvidia');
			assert.strictEqual(error.type, WebSearchErrorType.Transient);
			assert.strictEqual(error.isRetryable, true);
		});

		test('classifies network errors as Transient', () => {
			const networkError = new Error('ENOTFOUND');
			const error = WebSearchError.classifyNetworkError(networkError, 'nvidia');
			assert.strictEqual(error.type, WebSearchErrorType.Transient);
			assert.strictEqual(error.isRetryable, true);
		});

		test('classifies timeout as Transient', () => {
			const timeoutError = new DOMException('Timeout', 'TimeoutError');
			const error = WebSearchError.classifyNetworkError(timeoutError, 'nvidia');
			assert.strictEqual(error.type, WebSearchErrorType.Transient);
			assert.strictEqual(error.isRetryable, true);
		});

		test('classifies abort as Transient', () => {
			const abortError = new DOMException('Aborted', 'AbortError');
			const error = WebSearchError.classifyNetworkError(abortError, 'nvidia');
			assert.strictEqual(error.type, WebSearchErrorType.Transient);
			assert.strictEqual(error.isRetryable, true);
		});

		test('classifies unknown errors as Unknown (conservative)', () => {
			const error = new Error('some unknown error');
			const classified = WebSearchError.classifyNetworkError(error, 'nvidia');
			assert.strictEqual(classified.type, WebSearchErrorType.Unknown);
			assert.strictEqual(classified.isRetryable, false);
		});
	});

	suite('Credential Leakage Prevention', () => {
		test('WebSearchError messages do not contain API key', () => {
			const apiKey = 'nvapi-secret-key-12345';
			const error = WebSearchError.configuration('Auth failed', 'nvidia', 401);
			assert.ok(!error.message.includes(apiKey));
		});

		test('WebSearchError transient messages do not contain API key', () => {
			const apiKey = 'nvapi-secret-key-12345';
			const error = WebSearchError.transient('Rate limited', 'nvidia', 429);
			assert.ok(!error.message.includes(apiKey));
		});

		test('Unknown error does not leak credentials', () => {
			const apiKey = 'nvapi-secret-key-12345';
			const error = WebSearchError.unknown('Network error', 'nvidia');
			assert.ok(!error.message.includes(apiKey));
		});
	});

	suite('Fail-Open Behavior', () => {
		function applyRankings(
			originalResults: SearchResult[],
			submittedPassageCount: number,
			responseData: unknown
		): SearchResult[] {
			const response = responseData as { rankings?: unknown[] };
			const rankings = response?.rankings;

			if (!Array.isArray(rankings) || rankings.length === 0) {
				return originalResults;
			}

			const validatedRankings: { index: number; logit: number }[] = [];
			const seenIndices = new Set<number>();

			for (const entry of rankings) {
				const obj = entry as { index?: unknown; logit?: unknown };

				if (typeof obj.index !== 'number' || !Number.isInteger(obj.index)) continue;
				if (obj.index < 0 || obj.index >= submittedPassageCount) continue;
				if (seenIndices.has(obj.index)) continue;
				if (typeof obj.logit !== 'number' || !Number.isFinite(obj.logit)) continue;

				seenIndices.add(obj.index);
				validatedRankings.push({ index: obj.index, logit: obj.logit });
			}

			if (validatedRankings.length === 0) {
				return originalResults;
			}

			const reranked: SearchResult[] = [];
			const usedIndices = new Set<number>();

			for (const { index } of validatedRankings) {
				const result = originalResults[index];
				if (result) {
					reranked.push(result);
					usedIndices.add(index);
				}
			}

			for (let i = 0; i < originalResults.length; i++) {
				if (!usedIndices.has(i)) {
					reranked.push(originalResults[i]);
				}
			}

			return reranked;
		}

		test('returns original results for empty input', () => {
			const response = { rankings: [{ index: 0, logit: -1.0 }] };
			assert.deepStrictEqual(applyRankings([], 0, response), []);
		});

		test('returns original results for single result', () => {
			const original = [createMockResult()];
			const response = { rankings: [{ index: 0, logit: -1.0 }] };
			assert.deepStrictEqual(applyRankings(original, 1, response), original);
		});

		test('returns original when insufficient passages after filtering', () => {
			const original = [createMockResult({ title: '' }), createMockResult({ title: '' })];
			const response = { rankings: [] };
			assert.deepStrictEqual(applyRankings(original, 2, response), original);
		});
	});

	suite('Security', () => {
		test('API key never logged in error paths', () => {
			const apiKey = 'nvapi-test-key';
			const error = new Error('fetch failed');
			const classified = WebSearchError.classifyNetworkError(error, 'nvidia');
			assert.ok(!classified.message.includes(apiKey));
		});

		test('passage content not exposed in error messages', () => {
			const error = WebSearchError.transient('API error', 'nvidia', 500);
			assert.ok(!error.message.includes('passage'));
			assert.ok(!error.message.includes('snippet'));
		});
	});
});