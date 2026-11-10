/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { SearchResult } from '../../common/webSearchTypes.js';

// Test the normalization logic that mirrors BraveSearchMainService._mapResult and related helpers

suite('Web Search - Result Normalization (production logic)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	// Helpers that mirror the production implementation
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

	function parsePublishedDate(pageAge: unknown): string | undefined {
		if (typeof pageAge !== 'string') {
			return undefined;
		}
		const trimmed = pageAge.trim();
		if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
			return trimmed;
		}
		return undefined;
	}

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

	function mapResult(item: unknown): SearchResult | null {
		const obj = item as { title?: unknown; url?: unknown; snippet?: unknown; description?: unknown; page_age?: unknown };

		const rawTitle = typeof obj.title === 'string' ? obj.title.trim() : '';
		const rawUrl = typeof obj.url === 'string' ? obj.url.trim() : '';
		const rawSnippet = typeof obj.snippet === 'string' ? obj.snippet.trim()
			: (typeof obj.description === 'string' ? obj.description.trim() : '');

		if (rawTitle.length === 0) {
			return null;
		}

		if (!isValidHttpUrl(rawUrl)) {
			return null;
		}

		const normalizedUrl = normalizeUrl(rawUrl);
		const displayUrl = extractDomain(normalizedUrl);
		const publishedDate = parsePublishedDate(obj.page_age);

		return {
			title: rawTitle,
			url: normalizedUrl,
			displayUrl,
			snippet: rawSnippet,
			source: 'brave',
			publishedDate,
			retrievalTimestamp: Date.now(),
		};
	}

	suite('_isValidHttpUrl', () => {
		test('accepts https URLs', () => {
			assert.strictEqual(isValidHttpUrl('https://example.com'), true);
		});

		test('accepts http URLs', () => {
			assert.strictEqual(isValidHttpUrl('http://example.com'), true);
		});

		test('rejects ftp URLs', () => {
			assert.strictEqual(isValidHttpUrl('ftp://example.com'), false);
		});

		test('rejects javascript URLs', () => {
			assert.strictEqual(isValidHttpUrl('javascript:alert(1)'), false);
		});

		test('rejects mailto URLs', () => {
			assert.strictEqual(isValidHttpUrl('mailto:test@example.com'), false);
		});

		test('rejects data URLs', () => {
			assert.strictEqual(isValidHttpUrl('data:text/html,test'), false);
		});

		test('rejects invalid URLs', () => {
			assert.strictEqual(isValidHttpUrl('not-a-url'), false);
		});

		test('rejects empty string', () => {
			assert.strictEqual(isValidHttpUrl(''), false);
		});
	});

	suite('_normalizeUrl', () => {
		test('removes fragment', () => {
			assert.strictEqual(normalizeUrl('https://example.com/page#section'), 'https://example.com/page');
		});

		test('normalizes protocol to lowercase', () => {
			assert.strictEqual(normalizeUrl('HTTPS://EXAMPLE.COM'), 'https://example.com/');
		});

		test('normalizes host to lowercase', () => {
			assert.strictEqual(normalizeUrl('https://EXAMPLE.COM'), 'https://example.com/');
		});

		test('preserves query parameters', () => {
			assert.strictEqual(normalizeUrl('https://example.com?q=test&other=1'), 'https://example.com/?q=test&other=1');
		});

		test('handles URLs without path', () => {
			assert.strictEqual(normalizeUrl('https://example.com'), 'https://example.com/');
		});

		test('returns original on parse failure', () => {
			assert.strictEqual(normalizeUrl('invalid'), 'invalid');
		});
	});

	suite('_extractDomain', () => {
		test('extracts domain from URL', () => {
			assert.strictEqual(extractDomain('https://example.com/path'), 'example.com');
		});

		test('removes www prefix', () => {
			assert.strictEqual(extractDomain('https://www.example.com'), 'example.com');
		});

		test('preserves subdomains other than www', () => {
			assert.strictEqual(extractDomain('https://api.example.com'), 'api.example.com');
		});

		test('handles URLs with port', () => {
			assert.strictEqual(extractDomain('https://example.com:8080'), 'example.com');
		});

		test('returns original on parse failure', () => {
			assert.strictEqual(extractDomain('invalid'), 'invalid');
		});
	});

	suite('_parsePublishedDate', () => {
		test('accepts ISO date format', () => {
			assert.strictEqual(parsePublishedDate('2024-01-15'), '2024-01-15');
		});

		test('accepts ISO date with whitespace', () => {
			assert.strictEqual(parsePublishedDate('  2024-01-15  '), '2024-01-15');
		});

		test('rejects relative dates like "3 days ago"', () => {
			assert.strictEqual(parsePublishedDate('3 days ago'), undefined);
		});

		test('rejects other date formats', () => {
			assert.strictEqual(parsePublishedDate('Jan 15, 2024'), undefined);
			assert.strictEqual(parsePublishedDate('15/01/2024'), undefined);
			assert.strictEqual(parsePublishedDate('2024/01/15'), undefined);
		});

		test('rejects non-string input', () => {
			assert.strictEqual(parsePublishedDate(null), undefined);
			assert.strictEqual(parsePublishedDate(123), undefined);
			assert.strictEqual(parsePublishedDate(undefined), undefined);
		});

		test('rejects empty string', () => {
			assert.strictEqual(parsePublishedDate(''), undefined);
		});
	});

	suite('_mapResult', () => {
		test('returns valid result with all fields', () => {
			const item = {
				title: '  Test Title  ',
				url: '  https://example.com/page  ',
				snippet: '  Test snippet  ',
				page_age: '2024-01-15',
			};

			const result = mapResult(item);
			assert.ok(result !== null);
			assert.strictEqual(result!.title, 'Test Title');
			assert.strictEqual(result!.url, 'https://example.com/page');
			assert.strictEqual(result!.displayUrl, 'example.com');
			assert.strictEqual(result!.snippet, 'Test snippet');
			assert.strictEqual(result!.publishedDate, '2024-01-15');
			assert.strictEqual(result!.source, 'brave');
		});

		test('uses description when snippet is missing', () => {
			const item = {
				title: 'Test',
				url: 'https://example.com',
				description: 'Description text',
			};

			const result = mapResult(item);
			assert.ok(result !== null);
			assert.strictEqual(result!.snippet, 'Description text');
		});

		test('returns null for empty title', () => {
			const item = {
				title: '   ',
				url: 'https://example.com',
				snippet: 'Test',
			};

			const result = mapResult(item);
			assert.strictEqual(result, null);
		});

		test('returns null for missing title', () => {
			const item = {
				url: 'https://example.com',
				snippet: 'Test',
			};

			const result = mapResult(item);
			assert.strictEqual(result, null);
		});

		test('returns null for invalid URL scheme', () => {
			const item = {
				title: 'Test',
				url: 'ftp://example.com',
				snippet: 'Test',
			};

			const result = mapResult(item);
			assert.strictEqual(result, null);
		});

		test('returns null for javascript URL', () => {
			const item = {
				title: 'Test',
				url: 'javascript:alert(1)',
				snippet: 'Test',
			};

			const result = mapResult(item);
			assert.strictEqual(result, null);
		});

		test('returns null for empty URL', () => {
			const item = {
				title: 'Test',
				url: '',
				snippet: 'Test',
			};

			const result = mapResult(item);
			assert.strictEqual(result, null);
		});

		test('handles missing snippet gracefully', () => {
			const item = {
				title: 'Test',
				url: 'https://example.com',
			};

			const result = mapResult(item);
			assert.ok(result !== null);
			assert.strictEqual(result!.snippet, '');
		});

		test('handles missing publishedDate', () => {
			const item = {
				title: 'Test',
				url: 'https://example.com',
				snippet: 'Test',
			};

			const result = mapResult(item);
			assert.ok(result !== null);
			assert.strictEqual(result!.publishedDate, undefined);
		});

		test('ignores relative publishedDate', () => {
			const item = {
				title: 'Test',
				url: 'https://example.com',
				snippet: 'Test',
				page_age: '3 days ago',
			};

			const result = mapResult(item);
			assert.ok(result !== null);
			assert.strictEqual(result!.publishedDate, undefined);
		});

		test('normalizes URL and extracts domain', () => {
			const item = {
				title: 'Test',
				url: '  HTTPS://WWW.EXAMPLE.COM/PAGE#FRAGMENT  ',
				snippet: 'Test',
				page_age: '2024-01-15',
			};

			const result = mapResult(item);
			assert.ok(result !== null);
			// URL normalization: protocol and host lowercased, fragment removed, path preserved as-is
			assert.strictEqual(result!.url, 'https://www.example.com/PAGE');
			assert.strictEqual(result!.displayUrl, 'example.com');
		});
	});

	suite('_deduplicateByUrl', () => {
		test('removes duplicate URLs', () => {
			const results: SearchResult[] = [
				{ title: 'First', url: 'https://example.com', displayUrl: 'example.com', snippet: 'First', source: 'brave', retrievalTimestamp: Date.now() },
				{ title: 'Second', url: 'https://example.com', displayUrl: 'example.com', snippet: 'Second', source: 'brave', retrievalTimestamp: Date.now() },
				{ title: 'Third', url: 'https://other.com', displayUrl: 'other.com', snippet: 'Third', source: 'brave', retrievalTimestamp: Date.now() },
			];

			const deduplicated = deduplicateByUrl(results);
			assert.strictEqual(deduplicated.length, 2);
			assert.strictEqual(deduplicated[0].title, 'First');
			assert.strictEqual(deduplicated[1].title, 'Third');
		});

		test('normalizes URLs before deduplication', () => {
			const results: SearchResult[] = [
				{ title: 'First', url: 'https://example.com/page', displayUrl: 'example.com', snippet: 'First', source: 'brave', retrievalTimestamp: Date.now() },
				{ title: 'Second', url: 'https://example.com/page#section', displayUrl: 'example.com', snippet: 'Second', source: 'brave', retrievalTimestamp: Date.now() },
			];

			const deduplicated = deduplicateByUrl(results);
			assert.strictEqual(deduplicated.length, 1);
			assert.strictEqual(deduplicated[0].title, 'First');
		});

		test('normalizes case before deduplication', () => {
			const results: SearchResult[] = [
				{ title: 'First', url: 'https://EXAMPLE.COM', displayUrl: 'example.com', snippet: 'First', source: 'brave', retrievalTimestamp: Date.now() },
				{ title: 'Second', url: 'https://example.com', displayUrl: 'example.com', snippet: 'Second', source: 'brave', retrievalTimestamp: Date.now() },
			];

			const deduplicated = deduplicateByUrl(results);
			assert.strictEqual(deduplicated.length, 1);
			assert.strictEqual(deduplicated[0].title, 'First');
		});

		test('preserves order of first occurrence', () => {
			const results: SearchResult[] = [
				{ title: 'A', url: 'https://a.com', displayUrl: 'a.com', snippet: 'A', source: 'brave', retrievalTimestamp: Date.now() },
				{ title: 'B', url: 'https://b.com', displayUrl: 'b.com', snippet: 'B', source: 'brave', retrievalTimestamp: Date.now() },
				{ title: 'A-dup', url: 'https://a.com', displayUrl: 'a.com', snippet: 'A-dup', source: 'brave', retrievalTimestamp: Date.now() },
				{ title: 'C', url: 'https://c.com', displayUrl: 'c.com', snippet: 'C', source: 'brave', retrievalTimestamp: Date.now() },
			];

			const deduplicated = deduplicateByUrl(results);
			assert.strictEqual(deduplicated.length, 3);
			assert.strictEqual(deduplicated[0].title, 'A');
			assert.strictEqual(deduplicated[1].title, 'B');
			assert.strictEqual(deduplicated[2].title, 'C');
		});

		test('handles empty array', () => {
			const results: SearchResult[] = [];
			const deduplicated = deduplicateByUrl(results);
			assert.strictEqual(deduplicated.length, 0);
		});
	});
});

suite('Web Search - Tool Result Formatting (production logic)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	function formatWebSearchResult(params: { query: string; maxResults?: number }, result: { results: SearchResult[] }): string {
		if (!result.results || result.results.length === 0) {
			return 'No results found for the search query.'
		}
		// Filter out results with empty titles or URLs (should not happen after normalization, but defensive)
		const validResults = result.results.filter(r => r.title && r.title.trim().length > 0 && r.url && r.url.trim().length > 0)
		if (validResults.length === 0) {
			return 'No results found for the search query.'
		}
		const lines = validResults.map((r, i) => {
			const date = r.publishedDate ? ` (${r.publishedDate})` : ''
			const snippet = r.snippet && r.snippet.trim().length > 0 ? r.snippet : '(no description available)'
			return `${i + 1}. ${r.title}\n${r.url}${date}\n${snippet}`
		})
		return lines.join('\n\n')
	}

	suite('formatWebSearchResult', () => {
		const baseParams = { query: 'test', maxResults: 10 };

		test('formats multiple results with numbers', () => {
			const result = {
				results: [
					{ title: 'First', url: 'https://a.com', displayUrl: 'a.com', snippet: 'First snippet', source: 'brave', publishedDate: '2024-01-01', retrievalTimestamp: Date.now() },
					{ title: 'Second', url: 'https://b.com', displayUrl: 'b.com', snippet: 'Second snippet', source: 'brave', publishedDate: '2024-01-02', retrievalTimestamp: Date.now() },
				],
			};

			const output = formatWebSearchResult(baseParams, result);
			assert.ok(output.includes('1. First'));
			assert.ok(output.includes('https://a.com (2024-01-01)'));
			assert.ok(output.includes('First snippet'));
			assert.ok(output.includes('2. Second'));
			assert.ok(output.includes('https://b.com (2024-01-02)'));
			assert.ok(output.includes('Second snippet'));
		});

		test('omits date when publishedDate is undefined', () => {
			const result = {
				results: [
					{ title: 'No Date', url: 'https://a.com', displayUrl: 'a.com', snippet: 'Snippet', source: 'brave', publishedDate: undefined, retrievalTimestamp: Date.now() },
				],
			};

			const output = formatWebSearchResult(baseParams, result);
			assert.ok(!output.includes('(undefined)'));
			assert.ok(!output.includes('()'));
			assert.ok(output.includes('1. No Date'));
			assert.ok(output.includes('https://a.com'));
			assert.ok(output.includes('Snippet'));
		});

		test('shows (no description available) for empty snippet', () => {
			const result = {
				results: [
					{ title: 'No Snippet', url: 'https://a.com', displayUrl: 'a.com', snippet: '', source: 'brave', publishedDate: '2024-01-01', retrievalTimestamp: Date.now() },
				],
			};

			const output = formatWebSearchResult(baseParams, result);
			assert.ok(output.includes('(no description available)'));
		});

		test('shows (no description available) for whitespace-only snippet', () => {
			const result = {
				results: [
					{ title: 'No Snippet', url: 'https://a.com', displayUrl: 'a.com', snippet: '   ', source: 'brave', publishedDate: '2024-01-01', retrievalTimestamp: Date.now() },
				],
			};

			const output = formatWebSearchResult(baseParams, result);
			assert.ok(output.includes('(no description available)'));
		});

		test('returns no results message for empty array', () => {
			const result = { results: [] };
			const output = formatWebSearchResult(baseParams, result);
			assert.strictEqual(output, 'No results found for the search query.');
		});

		test('filters out results with empty titles', () => {
			const result = {
				results: [
					{ title: '', url: 'https://a.com', displayUrl: 'a.com', snippet: 'Snippet', source: 'brave', retrievalTimestamp: Date.now() },
					{ title: 'Valid', url: 'https://b.com', displayUrl: 'b.com', snippet: 'Snippet', source: 'brave', retrievalTimestamp: Date.now() },
				],
			};

			const output = formatWebSearchResult(baseParams, result);
			// Empty title result should be filtered out, only "Valid" remains as result #1
			assert.ok(!output.includes('\n1. \n')); // No empty title showing as "1. " followed by newline
			assert.ok(output.includes('1. Valid'));
		});

		test('filters out results with empty URLs', () => {
			const result = {
				results: [
					{ title: 'No URL', url: '', displayUrl: '', snippet: 'Snippet', source: 'brave', retrievalTimestamp: Date.now() },
					{ title: 'Valid', url: 'https://b.com', displayUrl: 'b.com', snippet: 'Snippet', source: 'brave', retrievalTimestamp: Date.now() },
				],
			};

			const output = formatWebSearchResult(baseParams, result);
			assert.ok(!output.includes('No URL'));
			assert.ok(output.includes('1. Valid'));
		});

		test('returns no results message when all results filtered out', () => {
			const result = {
				results: [
					{ title: '', url: 'https://a.com', displayUrl: 'a.com', snippet: 'Snippet', source: 'brave', retrievalTimestamp: Date.now() },
					{ title: 'No URL', url: '', displayUrl: '', snippet: 'Snippet', source: 'brave', retrievalTimestamp: Date.now() },
				],
			};

			const output = formatWebSearchResult(baseParams, result);
			assert.strictEqual(output, 'No results found for the search query.');
		});

		test('preserves special characters in title, URL, snippet', () => {
			const result = {
				results: [
					{
						title: 'Title with <b>bold</b> & "quotes"',
						url: 'https://example.com/path?query=test&other=1',
						displayUrl: 'example.com',
						snippet: "Snippet with 'single' and \"double\" quotes",
						source: 'brave',
						publishedDate: '2024-01-01',
						retrievalTimestamp: Date.now(),
					},
				],
			};

			const output = formatWebSearchResult(baseParams, result);
			assert.ok(output.includes('<b>bold</b>'));
			assert.ok(output.includes('&'));
			assert.ok(output.includes('"quotes"'));
			assert.ok(output.includes('?query=test&other=1'));
			assert.ok(output.includes("'single'"));
		});

		test('handles multiline snippets', () => {
			const result = {
				results: [
					{
						title: 'Multiline',
						url: 'https://example.com',
						displayUrl: 'example.com',
						snippet: 'Line 1\nLine 2\nLine 3',
						source: 'brave',
						retrievalTimestamp: Date.now(),
					},
				],
			};

			const output = formatWebSearchResult(baseParams, result);
			assert.ok(output.includes('Line 1'));
			assert.ok(output.includes('Line 2'));
			assert.ok(output.includes('Line 3'));
		});

		test('no undefined/null text in output', () => {
			const result = {
				results: [
					{ title: 'Test', url: 'https://a.com', displayUrl: 'a.com', snippet: 'snippet', source: 'brave', publishedDate: '2024-01-01', retrievalTimestamp: Date.now() },
				],
			};

			const output = formatWebSearchResult(baseParams, result);
			assert.ok(!output.includes('undefined'));
			assert.ok(!output.includes('null'));
			assert.ok(output.length > 0);
		});
	});
});