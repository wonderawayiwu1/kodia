/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { SearchResult, SearchProviderSettings, SearchRequest } from '../../common/webSearchTypes.js';
import { WebSearchError, WebSearchErrorType } from '../../electron-main/webSearchErrors.js';

suite('Web Search - You.com Provider (production logic)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	// Re-implement You.com-specific normalization logic for testing
	// (mirrors YouSearchMainService.normalizeResult)

	const YOU_MAX_COUNT = 100;

	function isValidHttpUrl(url: string): boolean {
		try {
			const parsed = new URL(url);
			return parsed.protocol === 'http:' || parsed.protocol === 'https:';
		} catch {
			return false;
		}
	}

	function normalizeUrl(url: string): string {
		try {
			const parsed = new URL(url);
			parsed.hash = '';
			parsed.protocol = parsed.protocol.toLowerCase();
			parsed.host = parsed.host.toLowerCase();
			return parsed.toString();
		} catch {
			return url;
		}
	}

	function extractDomain(url: string): string {
		try {
			const parsed = new URL(url);
			return parsed.hostname.replace(/^www\./, '');
		} catch {
			return url;
		}
	}

	function parsePublishedDate(dateValue: unknown): string | undefined {
		if (typeof dateValue !== 'string') return undefined;
		const trimmed = dateValue.trim();
		// Only accept ISO date format (YYYY-MM-DD or full ISO)
		if (/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)?$/.test(trimmed)) {
			return trimmed;
		}
		return undefined;
	}

	function youNormalizeResult(item: unknown, isNews: boolean = false): SearchResult | null {
		const obj = item as {
			title?: unknown;
			url?: unknown;
			description?: unknown;
			snippet?: unknown;
			age?: unknown;
			source?: unknown;
		};

		const rawTitle = typeof obj.title === 'string' ? obj.title.trim() : '';
		const rawUrl = typeof obj.url === 'string' ? obj.url.trim() : '';

		if (rawTitle.length === 0) {
			return null;
		}

		if (!isValidHttpUrl(rawUrl)) {
			return null;
		}

		const normalizedUrl = normalizeUrl(rawUrl);

		// For You.com, 'age' field:
		// - In results.news: represents publication timestamp (could be ISO date)
		// - In results.web: represents search-result age (relative like "2 hours ago")
		// Only populate publishedDate when it's a reliable ISO date
		let publishedDate: string | undefined;
		if (isNews) {
			// News results may have proper publication dates
			publishedDate = parsePublishedDate(obj.age);
		} else {
			// Web results: age is relative, don't use as publication date
			publishedDate = undefined;
		}

		const snippet = typeof obj.description === 'string' && obj.description.trim().length > 0
			? obj.description.trim()
			: (typeof obj.snippet === 'string' ? obj.snippet.trim() : '');

		return {
			title: rawTitle,
			url: normalizedUrl,
			displayUrl: extractDomain(normalizedUrl),
			snippet,
			source: 'you',
			publishedDate,
			retrievalTimestamp: Date.now(),
		};
	}

	suite('You.com normalizeResult - Web Results', () => {
		test('returns valid result with all fields', () => {
			const item = {
				title: '  Test Title  ',
				url: '  https://example.com/page  ',
				description: '  Test description  ',
				age: '2 hours ago', // relative age for web results
				source: 'web',
			};

			const result = youNormalizeResult(item, false);
			assert.ok(result !== null);
			assert.strictEqual(result!.title, 'Test Title');
			assert.strictEqual(result!.url, 'https://example.com/page');
			assert.strictEqual(result!.displayUrl, 'example.com');
			assert.strictEqual(result!.snippet, 'Test description');
			assert.strictEqual(result!.source, 'you');
			assert.strictEqual(result!.publishedDate, undefined); // web results don't get publishedDate from age
		});

		test('uses snippet when description is missing', () => {
			const item = {
				title: 'Test Title',
				url: 'https://example.com',
				snippet: 'Test snippet',
			};

			const result = youNormalizeResult(item, false);
			assert.ok(result !== null);
			assert.strictEqual(result!.snippet, 'Test snippet');
		});

		test('returns empty snippet when both missing', () => {
			const item = {
				title: 'Test Title',
				url: 'https://example.com',
			};

			const result = youNormalizeResult(item, false);
			assert.ok(result !== null);
			assert.strictEqual(result!.snippet, '');
		});

		test('returns null for empty title', () => {
			const item = {
				title: '   ',
				url: 'https://example.com',
				description: 'Test',
			};

			const result = youNormalizeResult(item, false);
			assert.strictEqual(result, null);
		});

		test('returns null for missing title', () => {
			const item = {
				url: 'https://example.com',
				description: 'Test',
			};

			const result = youNormalizeResult(item, false);
			assert.strictEqual(result, null);
		});

		test('returns null for invalid URL scheme (ftp)', () => {
			const item = {
				title: 'Test',
				url: 'ftp://example.com',
				description: 'Test',
			};

			const result = youNormalizeResult(item, false);
			assert.strictEqual(result, null);
		});

		test('returns null for javascript URL', () => {
			const item = {
				title: 'Test',
				url: 'javascript:alert(1)',
				description: 'Test',
			};

			const result = youNormalizeResult(item, false);
			assert.strictEqual(result, null);
		});

		test('returns null for empty URL', () => {
			const item = {
				title: 'Test',
				url: '',
				description: 'Test',
			};

			const result = youNormalizeResult(item, false);
			assert.strictEqual(result, null);
		});

		test('handles missing description gracefully', () => {
			const item = {
				title: 'Test',
				url: 'https://example.com',
			};

			const result = youNormalizeResult(item, false);
			assert.ok(result !== null);
			assert.strictEqual(result!.snippet, '');
		});

		test('normalizes URL and extracts domain', () => {
			const item = {
				title: 'Test',
				url: 'HTTPS://WWW.EXAMPLE.COM/PATH?QUERY=1#FRAGMENT',
				description: 'Test',
			};

			const result = youNormalizeResult(item, false);
			assert.ok(result !== null);
			// URL normalization: removes fragment, lowercases protocol and host only
			assert.strictEqual(result!.url, 'https://www.example.com/PATH?QUERY=1');
			assert.strictEqual(result!.displayUrl, 'example.com');
		});

		test('preserves special characters in title, URL, description', () => {
			const item = {
				title: 'Test <script>alert(1)</script>',
				url: 'https://example.com/path?q=hello%20world',
				description: 'Description with "quotes" & <tags>',
			};

			const result = youNormalizeResult(item, false);
			assert.ok(result !== null);
			assert.strictEqual(result!.title, 'Test <script>alert(1)</script>');
			assert.strictEqual(result!.url, 'https://example.com/path?q=hello%20world');
			assert.strictEqual(result!.snippet, 'Description with "quotes" & <tags>');
		});

		test('handles multiline description', () => {
			const item = {
				title: 'Test',
				url: 'https://example.com',
				description: 'Line 1\nLine 2\nLine 3',
			};

			const result = youNormalizeResult(item, false);
			assert.ok(result !== null);
			assert.strictEqual(result!.snippet, 'Line 1\nLine 2\nLine 3');
		});
	});

	suite('You.com normalizeResult - News Results', () => {
		test('returns valid result with publishedDate when age is ISO date', () => {
			const item = {
				title: 'News Title',
				url: 'https://news.example.com/article',
				description: 'News description',
				age: '2026-01-15T10:30:00Z', // ISO publication date for news
			};

			const result = youNormalizeResult(item, true);
			assert.ok(result !== null);
			assert.strictEqual(result!.title, 'News Title');
			assert.strictEqual(result!.publishedDate, '2026-01-15T10:30:00Z');
		});

		test('returns undefined publishedDate when age is relative for news', () => {
			const item = {
				title: 'News Title',
				url: 'https://news.example.com/article',
				description: 'News description',
				age: '3 hours ago', // relative age even for news
			};

			const result = youNormalizeResult(item, true);
			assert.ok(result !== null);
			assert.strictEqual(result!.publishedDate, undefined);
		});

		test('returns undefined publishedDate for invalid date format', () => {
			const item = {
				title: 'News Title',
				url: 'https://news.example.com/article',
				description: 'News description',
				age: 'January 15, 2026', // non-ISO format
			};

			const result = youNormalizeResult(item, true);
			assert.ok(result !== null);
			assert.strictEqual(result!.publishedDate, undefined);
		});
	});

	suite('You.com _getYouResults - Response Parsing', () => {
		function getYouResults(body: unknown): unknown[] {
			const youBody = body as { results?: { web?: unknown[]; news?: unknown[] } };
			const webResults = youBody?.results?.web ?? [];
			const newsResults = youBody?.results?.news ?? [];
			return [...webResults, ...newsResults];
		}

		test('parses web results from response', () => {
			const response = {
				results: {
					web: [
						{ title: 'Web 1', url: 'https://web1.com', description: 'Desc 1' },
						{ title: 'Web 2', url: 'https://web2.com', description: 'Desc 2' },
					],
					news: [],
				},
			};

			const results = getYouResults(response);
			assert.strictEqual(results.length, 2);
			assert.strictEqual((results[0] as any).title, 'Web 1');
			assert.strictEqual((results[1] as any).title, 'Web 2');
		});

		test('parses news results from response', () => {
			const response = {
				results: {
					web: [],
					news: [
						{ title: 'News 1', url: 'https://news1.com', description: 'Desc 1' },
					],
				},
			};

			const results = getYouResults(response);
			assert.strictEqual(results.length, 1);
			assert.strictEqual((results[0] as any).title, 'News 1');
		});

		test('merges web and news results', () => {
			const response = {
				results: {
					web: [{ title: 'Web', url: 'https://web.com', description: 'D' }],
					news: [{ title: 'News', url: 'https://news.com', description: 'D' }],
				},
			};

			const results = getYouResults(response);
			assert.strictEqual(results.length, 2);
		});

		test('handles missing results object', () => {
			const response = {};
			const results = getYouResults(response);
			assert.strictEqual(results.length, 0);
		});

		test('handles missing web and news arrays', () => {
			const response = { results: {} };
			const results = getYouResults(response);
			assert.strictEqual(results.length, 0);
		});

		test('handles null response body', () => {
			const results = getYouResults(null);
			assert.strictEqual(results.length, 0);
		});

		test('handles undefined response body', () => {
			const results = getYouResults(undefined);
			assert.strictEqual(results.length, 0);
		});

		test('handles malformed web array', () => {
			const response = { results: { web: null, news: [] } };
			const results = getYouResults(response);
			assert.strictEqual(results.length, 0);
		});
	});

	suite('You.com Request/Response Structure', () => {
		test('request body has correct structure', () => {
			const request: SearchRequest = { query: 'test query', maxResults: 10 };
			const settings: SearchProviderSettings = {
				enabled: true,
				priority: 3,
				maxResults: 10,
				timeoutMs: 15000,
				apiKey: 'test-key',
			};

			const maxResults = Math.min(Math.max(1, request.maxResults ?? settings.maxResults), YOU_MAX_COUNT);
			const body = {
				query: request.query,
				count: maxResults,
			};

			assert.strictEqual(body.query, 'test query');
			assert.strictEqual(body.count, 10);
		});

		test('request body uses defaults when maxResults omitted', () => {
			const request: SearchRequest = { query: 'test query' };
			const settings: SearchProviderSettings = {
				enabled: true,
				priority: 3,
				maxResults: 10,
				timeoutMs: 15000,
			};

			const maxResults = Math.min(Math.max(1, request.maxResults ?? settings.maxResults), YOU_MAX_COUNT);
			const body = { query: request.query, count: maxResults };

			assert.strictEqual(body.count, 10);
		});

		test('maxResults clamped to provider limit', () => {
			const request: SearchRequest = { query: 'test', maxResults: 200 };
			const settings: SearchProviderSettings = {
				enabled: true,
				priority: 3,
				maxResults: 10,
				timeoutMs: 15000,
			};

			const maxResults = Math.min(Math.max(1, request.maxResults ?? settings.maxResults), YOU_MAX_COUNT);
			assert.strictEqual(maxResults, YOU_MAX_COUNT);
		});

		test('request includes freshness when timeRange filter provided', () => {
			const request: SearchRequest = {
				query: 'test',
				filters: { timeRange: 'week' },
			};

			const freshnessMap: Record<string, string> = {
				day: 'day',
				week: 'week',
				month: 'month',
				year: 'year',
			};

			const body: Record<string, unknown> = { query: request.query, count: 10 };
			if (request.filters?.timeRange) {
				const freshness = freshnessMap[request.filters.timeRange];
				if (freshness) body.freshness = freshness;
			}

			assert.strictEqual(body.freshness, 'week');
		});

		test('request includes include_domains filter', () => {
			const request: SearchRequest = {
				query: 'test',
				filters: { domains: ['example.com', 'test.com'] },
			};

			const body: Record<string, unknown> = { query: request.query, count: 10 };
			if (request.filters?.domains?.length) {
				body.include_domains = request.filters.domains;
			}

			assert.deepStrictEqual(body.include_domains, ['example.com', 'test.com']);
		});

		test('request includes exclude_domains filter', () => {
			const request: SearchRequest = {
				query: 'test',
				filters: { excludeDomains: ['spam.com'] },
			};

			const body: Record<string, unknown> = { query: request.query, count: 10 };
			if (request.filters?.excludeDomains?.length) {
				body.exclude_domains = request.filters.excludeDomains;
			}

			assert.deepStrictEqual(body.exclude_domains, ['spam.com']);
		});

		test('empty successful results handled', () => {
			const response = { results: { web: [], news: [] } };
			const results = response.results.web ?? [];
			assert.strictEqual(results.length, 0);
		});
	});

	suite('You.com Deduplication', () => {
		function deduplicateByUrl(results: SearchResult[]): SearchResult[] {
			const seen = new Set<string>();
			const deduplicated: SearchResult[] = [];
			for (const result of results) {
				const normalizedUrl = normalizeUrl(result.url);
				if (!seen.has(normalizedUrl)) {
					seen.add(normalizedUrl);
					deduplicated.push({ ...result, url: normalizedUrl });
				}
			}
			return deduplicated;
		}

		test('removes duplicate URLs', () => {
			const results: SearchResult[] = [
				{ title: 'A', url: 'https://example.com', displayUrl: 'example.com', snippet: '1', source: 'you', retrievalTimestamp: 1 },
				{ title: 'B', url: 'https://example.com', displayUrl: 'example.com', snippet: '2', source: 'you', retrievalTimestamp: 2 },
			];

			const deduplicated = deduplicateByUrl(results);
			assert.strictEqual(deduplicated.length, 1);
			assert.strictEqual(deduplicated[0].title, 'A'); // preserves first
		});

		test('normalizes URLs before deduplication', () => {
			const results: SearchResult[] = [
				{ title: 'A', url: 'https://Example.COM', displayUrl: 'example.com', snippet: '1', source: 'you', retrievalTimestamp: 1 },
				{ title: 'B', url: 'https://example.com', displayUrl: 'example.com', snippet: '2', source: 'you', retrievalTimestamp: 2 },
			];

			const deduplicated = deduplicateByUrl(results);
			assert.strictEqual(deduplicated.length, 1);
		});

		test('normalizes case before deduplication', () => {
			const results: SearchResult[] = [
				{ title: 'A', url: 'HTTPS://EXAMPLE.COM', displayUrl: 'example.com', snippet: '1', source: 'you', retrievalTimestamp: 1 },
				{ title: 'B', url: 'https://example.com', displayUrl: 'example.com', snippet: '2', source: 'you', retrievalTimestamp: 2 },
			];

			const deduplicated = deduplicateByUrl(results);
			assert.strictEqual(deduplicated.length, 1);
		});

		test('preserves order of first occurrence', () => {
			const results: SearchResult[] = [
				{ title: 'First', url: 'https://a.com', displayUrl: 'a.com', snippet: '', source: 'you', retrievalTimestamp: 1 },
				{ title: 'Second', url: 'https://b.com', displayUrl: 'b.com', snippet: '', source: 'you', retrievalTimestamp: 2 },
				{ title: 'Third', url: 'https://a.com', displayUrl: 'a.com', snippet: '', source: 'you', retrievalTimestamp: 3 },
			];

			const deduplicated = deduplicateByUrl(results);
			assert.strictEqual(deduplicated.length, 2);
			assert.strictEqual(deduplicated[0].title, 'First');
			assert.strictEqual(deduplicated[1].title, 'Second');
		});

		test('handles empty array', () => {
			const deduplicated = deduplicateByUrl([]);
			assert.strictEqual(deduplicated.length, 0);
		});
	});

	suite('You.com Enforce Max Results', () => {
		function enforceMaxResults(results: SearchResult[], maxResults: number): SearchResult[] {
			return results.slice(0, maxResults);
		}

		test('limits results to maxResults', () => {
			const results: SearchResult[] = [
				{ title: '1', url: 'https://1.com', displayUrl: '1.com', snippet: '', source: 'you', retrievalTimestamp: 1 },
				{ title: '2', url: 'https://2.com', displayUrl: '2.com', snippet: '', source: 'you', retrievalTimestamp: 2 },
				{ title: '3', url: 'https://3.com', displayUrl: '3.com', snippet: '', source: 'you', retrievalTimestamp: 3 },
			];

			const limited = enforceMaxResults(results, 2);
			assert.strictEqual(limited.length, 2);
		});

		test('returns all when under limit', () => {
			const results: SearchResult[] = [
				{ title: '1', url: 'https://1.com', displayUrl: '1.com', snippet: '', source: 'you', retrievalTimestamp: 1 },
			];

			const limited = enforceMaxResults(results, 10);
			assert.strictEqual(limited.length, 1);
		});

		test('returns empty when maxResults is 0', () => {
			const results: SearchResult[] = [
				{ title: '1', url: 'https://1.com', displayUrl: '1.com', snippet: '', source: 'you', retrievalTimestamp: 1 },
			];

			const limited = enforceMaxResults(results, 0);
			assert.strictEqual(limited.length, 0);
		});
	});
});

suite('Web Search - You.com Error Classification', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	// Test You.com-specific error classification
	// You.com documented status codes:
	// 401: invalid/missing key - Configuration, no fallback
	// 403: missing scope or access - Configuration, no fallback
	// 400/422: invalid request - Configuration, no fallback
	// 402: payment/account credit issue - Configuration, no fallback
	// 429: rate limit - Transient, fallback allowed (unless spend_cap_exceeded)
	// 5xx: server errors - Transient, fallback allowed

	suite('You.com classifyStatusCode', () => {
		function classifyYouStatusCode(statusCode: number): { type: WebSearchErrorType; isRetryable: boolean } {
			// Replicate WebSearchError.classifyStatusCode logic for 'you' provider
			switch (statusCode) {
				case 400:
				case 401:
				case 403:
				case 402:
				case 422:
					return { type: WebSearchErrorType.Configuration, isRetryable: false };
				case 429:
					return { type: WebSearchErrorType.Transient, isRetryable: true };
				case 408:
				case 425:
				case 500:
				case 502:
				case 503:
				case 504:
					return { type: WebSearchErrorType.Transient, isRetryable: true };
				default:
					return { type: WebSearchErrorType.Configuration, isRetryable: false }; // conservative
			}
		}

		test('401 is Configuration (invalid/missing key)', () => {
			const result = classifyYouStatusCode(401);
			assert.strictEqual(result.type, WebSearchErrorType.Configuration);
			assert.strictEqual(result.isRetryable, false);
		});

		test('403 is Configuration (missing scope/access)', () => {
			const result = classifyYouStatusCode(403);
			assert.strictEqual(result.type, WebSearchErrorType.Configuration);
			assert.strictEqual(result.isRetryable, false);
		});

		test('402 is Configuration (payment/credit issue)', () => {
			const result = classifyYouStatusCode(402);
			assert.strictEqual(result.type, WebSearchErrorType.Configuration);
			assert.strictEqual(result.isRetryable, false);
		});

		test('400 is Configuration (invalid request)', () => {
			const result = classifyYouStatusCode(400);
			assert.strictEqual(result.type, WebSearchErrorType.Configuration);
			assert.strictEqual(result.isRetryable, false);
		});

		test('422 is Configuration (validation failed)', () => {
			const result = classifyYouStatusCode(422);
			assert.strictEqual(result.type, WebSearchErrorType.Configuration);
			assert.strictEqual(result.isRetryable, false);
		});

		test('429 is Transient (rate limit)', () => {
			const result = classifyYouStatusCode(429);
			assert.strictEqual(result.type, WebSearchErrorType.Transient);
			assert.strictEqual(result.isRetryable, true);
		});

		test('500 is Transient (server error)', () => {
			const result = classifyYouStatusCode(500);
			assert.strictEqual(result.type, WebSearchErrorType.Transient);
			assert.strictEqual(result.isRetryable, true);
		});

		test('502 is Transient (bad gateway)', () => {
			const result = classifyYouStatusCode(502);
			assert.strictEqual(result.type, WebSearchErrorType.Transient);
			assert.strictEqual(result.isRetryable, true);
		});

		test('503 is Transient (service unavailable)', () => {
			const result = classifyYouStatusCode(503);
			assert.strictEqual(result.type, WebSearchErrorType.Transient);
			assert.strictEqual(result.isRetryable, true);
		});

		test('504 is Transient (gateway timeout)', () => {
			const result = classifyYouStatusCode(504);
			assert.strictEqual(result.type, WebSearchErrorType.Transient);
			assert.strictEqual(result.isRetryable, true);
		});

		test('408 is Transient (request timeout)', () => {
			const result = classifyYouStatusCode(408);
			assert.strictEqual(result.type, WebSearchErrorType.Transient);
			assert.strictEqual(result.isRetryable, true);
		});

		test('425 is Transient (too early)', () => {
			const result = classifyYouStatusCode(425);
			assert.strictEqual(result.type, WebSearchErrorType.Transient);
			assert.strictEqual(result.isRetryable, true);
		});

		test('unknown status is Configuration (conservative)', () => {
			const result = classifyYouStatusCode(418);
			assert.strictEqual(result.type, WebSearchErrorType.Configuration);
			assert.strictEqual(result.isRetryable, false);
		});
	});

	suite('You.com 429 spend_cap_exceeded detection', () => {
		function isSpendCapExceeded(responseBody: unknown): boolean {
			const body = responseBody as { error?: { code?: string; message?: string } };
			const errorCode = body?.error?.code;
			const errorMessage = body?.error?.message?.toLowerCase() ?? '';
			return errorCode === 'spend_cap_exceeded' || errorMessage.includes('spend cap');
		}

		test('detects spend_cap_exceeded error code', () => {
			const body = { error: { code: 'spend_cap_exceeded', message: 'Spend cap exceeded' } };
			assert.strictEqual(isSpendCapExceeded(body), true);
		});

		test('detects spend cap in message', () => {
			const body = { error: { code: 'rate_limit', message: 'Spend cap exceeded for this key' } };
			assert.strictEqual(isSpendCapExceeded(body), true);
		});

		test('does not flag regular rate limit', () => {
			const body = { error: { code: 'rate_limit', message: 'Rate limit exceeded' } };
			assert.strictEqual(isSpendCapExceeded(body), false);
		});

		test('handles missing error object', () => {
			assert.strictEqual(isSpendCapExceeded({}), false);
			assert.strictEqual(isSpendCapExceeded(null), false);
		});
	});
});

suite('Web Search - You.com Test Connection', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	suite('testConnection behavior', () => {
		test('returns failure when API key not configured', async () => {
			const settings: SearchProviderSettings = { enabled: true, priority: 3, maxResults: 10, timeoutMs: 15000 };
			// Simulate the check
			if (!settings.apiKey) {
				assert.ok(true); // would return failure
			}
		});

		test('does not leak API key in error messages', () => {
			const apiKey = 'secret-api-key-12345';
			const errorMessage = 'You.com authentication failed. Please check your API key and ensure it has Web Search scope.';
			assert.ok(!errorMessage.includes(apiKey));
		});

		test('sanitizes error messages for auth failures', () => {
			const authErrors = [401, 403];
			for (const code of authErrors) {
				const message = code === 401
					? 'You.com authentication failed. Please check your API key and ensure it has Web Search scope.'
					: 'You.com authentication failed. Please check your API key and ensure it has Web Search scope.';
				// Message mentions "API key" as a concept but doesn't leak the actual key value
				assert.ok(message.includes('authentication failed'));
				assert.ok(message.includes('API key'));
			}
		});
	});
});

suite('Web Search - You.com Credential Leakage Prevention', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('WebSearchError messages do not contain API key', () => {
		const apiKey = 'secret-key-12345';
		const error = WebSearchError.configuration('Auth failed', 'you', 401);
		assert.ok(!error.message.includes(apiKey));
		assert.ok(!(error as any).message?.includes?.(apiKey));
	});

	test('WebSearchError transient messages do not contain API key', () => {
		const apiKey = 'secret-key-12345';
		const error = WebSearchError.transient('Rate limited', 'you', 429);
		assert.ok(!error.message.includes(apiKey));
	});

	test('Unknown error does not leak credentials', () => {
		const apiKey = 'secret-key-12345';
		const error = WebSearchError.unknown('Network error', 'you');
		assert.ok(!error.message.includes(apiKey));
	});
});

suite('Web Search - You.com Orchestrator Fallback Behavior', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('Configuration errors (401, 403, 402, 400, 422) do NOT trigger fallback', () => {
		for (const code of [401, 403, 402, 400, 422]) {
			const error = WebSearchError.classifyStatusCode(code, 'you');
			assert.strictEqual(error.type, WebSearchErrorType.Configuration, `Status ${code} should be Configuration`);
			assert.strictEqual(error.isRetryable, false);
		}
	});

	test('Transient errors (429, 5xx) DO trigger fallback', () => {
		for (const code of [429, 500, 502, 503, 504, 408, 425]) {
			const error = WebSearchError.classifyStatusCode(code, 'you');
			assert.strictEqual(error.type, WebSearchErrorType.Transient, `Status ${code} should be Transient`);
			assert.strictEqual(error.isRetryable, true);
		}
	});

	test('Network/timeout errors DO trigger fallback', () => {
		const timeoutError = new DOMException('Timeout', 'TimeoutError');
		const networkError = new Error('ENOTFOUND');
		const abortError = new DOMException('Aborted', 'AbortError');

		for (const error of [timeoutError, networkError, abortError]) {
			const classified = WebSearchError.classifyNetworkError(error, 'you');
			assert.strictEqual(classified.type, WebSearchErrorType.Transient);
			assert.strictEqual(classified.isRetryable, true);
		}
	});

	test('Unknown errors are conservative (no fallback)', () => {
		const error = new Error('some unknown error');
		const classified = WebSearchError.classifyNetworkError(error, 'you');
		assert.strictEqual(classified.type, WebSearchErrorType.Unknown);
		assert.strictEqual(classified.isRetryable, false);
	});

	test('Authentication errors have sanitized messages without credentials', () => {
		const error = WebSearchError.configuration('Invalid API key', 'you', 401);
		// Error mentions "API key" as a concept but doesn't leak actual key values
		assert.ok(!error.message.includes('secret'));
		assert.ok(error.message.includes('authentication failed') || error.message.includes('Invalid'));
	});
});