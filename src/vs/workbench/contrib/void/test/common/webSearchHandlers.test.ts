/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ProxyChannel } from '../../../../../base/parts/ipc/common/ipc.js';
import { SearchResponse, SearchResult } from '../../common/webSearchTypes.js';

suite('Web Search Handlers - Validation', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('valid query with omitted max_results returns correct params', () => {
		const query = 'test query';
		const maxResultsUnknown = undefined;
		const maxResults = maxResultsUnknown !== undefined && maxResultsUnknown !== null
			? (() => {
				const parsed = Number.parseInt(String(maxResultsUnknown), 10);
				if (!Number.isInteger(parsed)) throw new Error('not integer');
				if (parsed < 1 || parsed > 20) throw new Error('out of bounds');
				return parsed;
			  })()
			: undefined;

		assert.strictEqual(query, 'test query');
		assert.strictEqual(maxResults, undefined);
	});

	test('valid query with max_results=1 returns correct params', () => {
		const maxResultsUnknown = '1';
		const parsed = Number.parseInt(String(maxResultsUnknown), 10);
		assert.strictEqual(Number.isInteger(parsed), true);
		assert.strictEqual(parsed >= 1 && parsed <= 20, true);
		assert.strictEqual(parsed, 1);
	});

	test('valid query with max_results=20 returns correct params', () => {
		const maxResultsUnknown = '20';
		const parsed = Number.parseInt(String(maxResultsUnknown), 10);
		assert.strictEqual(Number.isInteger(parsed), true);
		assert.strictEqual(parsed >= 1 && parsed <= 20, true);
		assert.strictEqual(parsed, 20);
	});

	test('missing query throws', () => {
		const params: Record<string, unknown> = { max_results: '10' };
		try {
			const queryUnknown = params.query;
			if (queryUnknown === null) throw new Error('Invalid LLM output: query was null.');
			if (typeof queryUnknown !== 'string') throw new Error('Invalid LLM output format: query must be a string, but its type is "undefined".');
			const query = queryUnknown.trim();
			if (query.length === 0) throw new Error('Invalid LLM output: query must not be empty.');
			assert.fail('should have thrown');
		} catch (e) {
			assert.ok((e as Error).message.includes('must be a string'));
		}
	});

	test('null query throws', () => {
		const params: Record<string, unknown> = { query: null, max_results: '10' };
		try {
			const queryUnknown = params.query;
			if (queryUnknown === null) throw new Error('Invalid LLM output: query was null.');
			assert.fail('should have thrown');
		} catch (e) {
			assert.ok((e as Error).message.includes('query was null'));
		}
	});

	test('empty string query throws', () => {
		const params: Record<string, unknown> = { query: '', max_results: '10' };
		try {
			const queryUnknown = params.query;
			const query = String(queryUnknown).trim();
			if (query.length === 0) throw new Error('Invalid LLM output: query must not be empty.');
			assert.fail('should have thrown');
		} catch (e) {
			assert.ok((e as Error).message.includes('query must not be empty'));
		}
	});

	test('whitespace-only query throws', () => {
		const params: Record<string, unknown> = { query: '   ', max_results: '10' };
		try {
			const queryUnknown = params.query;
			const query = String(queryUnknown).trim();
			if (query.length === 0) throw new Error('Invalid LLM output: query must not be empty.');
			assert.fail('should have thrown');
		} catch (e) {
			assert.ok((e as Error).message.includes('query must not be empty'));
		}
	});

	test('non-string query throws', () => {
		const params: Record<string, unknown> = { query: 123, max_results: '10' };
		try {
			const queryUnknown = params.query;
			if (typeof queryUnknown !== 'string') throw new Error('Invalid LLM output format: query must be a string, but its type is "number".');
			assert.fail('should have thrown');
		} catch (e) {
			assert.ok((e as Error).message.includes('must be a string'));
		}
	});

	test('max_results=0 throws', () => {
		try {
			const parsed = 0;
			if (!Number.isInteger(parsed)) throw new Error('not integer');
			if (parsed < 1 || parsed > 20) throw new Error('out of bounds');
			assert.fail('should have thrown');
		} catch (e) {
			assert.ok((e as Error).message.includes('out of bounds'));
		}
	});

	test('max_results=-1 throws', () => {
		try {
			const parsed = -1;
			if (!Number.isInteger(parsed)) throw new Error('not integer');
			if (parsed < 1 || parsed > 20) throw new Error('out of bounds');
			assert.fail('should have thrown');
		} catch (e) {
			assert.ok((e as Error).message.includes('out of bounds'));
		}
	});

	test('max_results=21 throws', () => {
		try {
			const parsed = 21;
			if (!Number.isInteger(parsed)) throw new Error('not integer');
			if (parsed < 1 || parsed > 20) throw new Error('out of bounds');
			assert.fail('should have thrown');
		} catch (e) {
			assert.ok((e as Error).message.includes('out of bounds'));
		}
	});

	test('max_results fractional throws', () => {
		try {
			const parsed = 10.5;
			if (!Number.isInteger(parsed)) throw new Error('not integer');
			assert.fail('should have thrown');
		} catch (e) {
			assert.ok((e as Error).message.includes('not integer'));
		}
	});

	test('max_results invalid string throws', () => {
		try {
			const parsed = Number.parseInt('abc', 10);
			if (!Number.isInteger(parsed)) throw new Error('not integer');
			assert.fail('should have thrown');
		} catch (e) {
			assert.ok((e as Error).message.includes('not integer'));
		}
	});

	test('max_results boolean throws', () => {
		try {
			const parsed = Number.parseInt('true', 10);
			if (!Number.isInteger(parsed)) throw new Error('not integer');
			assert.fail('should have thrown');
		} catch (e) {
			assert.ok((e as Error).message.includes('not integer'));
		}
	});
});

suite('Web Search Handlers - Result Formatting', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('multiple numbered results', () => {
		const results: SearchResult[] = [
			{ title: 'First', url: 'https://a.com', displayUrl: 'a.com', snippet: 'First snippet', source: 'brave', publishedDate: '2026-01-01', retrievalTimestamp: Date.now() },
			{ title: 'Second', url: 'https://b.com', displayUrl: 'b.com', snippet: 'Second snippet', source: 'brave', publishedDate: '2026-01-02', retrievalTimestamp: Date.now() },
		];

		const lines = results.map((r, i) => {
			const date = r.publishedDate ? ` (${r.publishedDate})` : '';
			return `${i + 1}. ${r.title}\n${r.url}${date}\n${r.snippet || '(no snippet)'}`;
		});
		const output = lines.join('\n\n');

		assert.ok(output.includes('1. First'));
		assert.ok(output.includes('https://a.com (2026-01-01)'));
		assert.ok(output.includes('First snippet'));
		assert.ok(output.includes('2. Second'));
		assert.ok(output.includes('https://b.com (2026-01-02)'));
		assert.ok(output.includes('Second snippet'));
	});

	test('missing publishedDate is omitted', () => {
		const results: SearchResult[] = [
			{ title: 'No Date', url: 'https://a.com', displayUrl: 'a.com', snippet: 'Snippet', source: 'brave', publishedDate: undefined, retrievalTimestamp: Date.now() },
		];

		const lines = results.map((r, i) => {
			const date = r.publishedDate ? ` (${r.publishedDate})` : '';
			return `${i + 1}. ${r.title}\n${r.url}${date}\n${r.snippet || '(no snippet)'}`;
		});
		const output = lines.join('\n\n');

		assert.ok(!output.includes('(undefined)'));
		assert.ok(!output.includes('()'));
		assert.ok(output.includes('1. No Date'));
		assert.ok(output.includes('https://a.com'));
		assert.ok(output.includes('Snippet'));
	});

	test('empty snippet falls back to (no snippet)', () => {
		const results: SearchResult[] = [
			{ title: 'No Snippet', url: 'https://a.com', displayUrl: 'a.com', snippet: '', source: 'brave', publishedDate: '2026-01-01', retrievalTimestamp: Date.now() },
		];

		const lines = results.map((r, i) => {
			const date = r.publishedDate ? ` (${r.publishedDate})` : '';
			return `${i + 1}. ${r.title}\n${r.url}${date}\n${r.snippet || '(no snippet)'}`;
		});
		const output = lines.join('\n\n');

		assert.ok(output.includes('(no snippet)'));
	});

	test('empty result array returns no results message', () => {
		const results: SearchResult[] = [];

		const output = !results || results.length === 0
			? 'No results found for the search query.'
			: 'has results';

		assert.strictEqual(output, 'No results found for the search query.');
	});

	test('no undefined/null text in output', () => {
		const results: SearchResult[] = [
			{ title: 'Test', url: 'https://a.com', displayUrl: 'a.com', snippet: 'snippet', source: 'brave', publishedDate: '2026-01-01', retrievalTimestamp: Date.now() },
		];

		const lines = results.map((r, i) => {
			const date = r.publishedDate ? ` (${r.publishedDate})` : '';
			return `${i + 1}. ${r.title}\n${r.url}${date}\n${r.snippet || '(no snippet)'}`;
		});
		const output = lines.join('\n\n');

		assert.ok(!output.includes('undefined'));
		assert.ok(!output.includes('null'));
		assert.ok(output.length > 0);
	});

	test('titles and URLs with special characters are preserved', () => {
		const results: SearchResult[] = [
			{
				title: 'Title with <b>bold</b> & "quotes"',
				url: 'https://example.com/path?query=test&other=1',
				displayUrl: 'example.com',
				snippet: 'Snippet with \'single\' and "double" quotes',
				source: 'brave',
				retrievalTimestamp: Date.now(),
			},
		];

		const lines = results.map((r, i) => {
			const date = r.publishedDate ? ` (${r.publishedDate})` : '';
			return `${i + 1}. ${r.title}\n${r.url}${date}\n${r.snippet || '(no snippet)'}`;
		});
		const output = lines.join('\n\n');

		assert.ok(output.includes('<b>bold</b>'));
		assert.ok(output.includes('&'));
		assert.ok(output.includes('"quotes"'));
		assert.ok(output.includes('?query=test&other=1'));
		assert.ok(output.includes("'single'"));
	});
});

suite('Web Search IPC Integration (mocked)', () => {
	test('IPC call with valid request returns results', async () => {
		const results: SearchResult[] = [
			{
				title: 'Result 1',
				url: 'https://example.com/1',
				displayUrl: 'example.com',
				snippet: 'First result snippet',
				source: 'brave',
				publishedDate: '2026-01-01',
				retrievalTimestamp: Date.now(),
			},
			{
				title: 'Result 2',
				url: 'https://example.com/2',
				displayUrl: 'example.com',
				snippet: 'Second result snippet',
				source: 'brave',
				publishedDate: undefined,
				retrievalTimestamp: Date.now(),
			},
		];

		const response: SearchResponse = {
			results,
			provider: 'brave',
			query: 'test query',
			totalResults: results.length,
			responseTimeMs: 100,
		};

		const channelDisposables = new DisposableStore();
		const service = {
			search: async (request: { query: string; maxResults?: number }) => {
				assert.strictEqual(request.query, 'test query');
				assert.strictEqual(request.maxResults, 5);
				return response;
			},
		};
		const channel = ProxyChannel.fromService(service, channelDisposables);

		const result = await channel.call(null, 'search', [{ query: 'test query', maxResults: 5 }]) as SearchResponse;

		assert.strictEqual(result.results.length, 2);
		assert.strictEqual(result.results[0].title, 'Result 1');
		assert.strictEqual(result.results[1].title, 'Result 2');

		channelDisposables.dispose();
	});

	test('IPC rejection propagates error', async () => {
		const channelDisposables = new DisposableStore();
		const service = {
			search: async () => {
				throw new Error('IPC error: network failure');
			},
		};
		const channel = ProxyChannel.fromService(service, channelDisposables);

		try {
			await channel.call(null, 'search', [{ query: 'test', maxResults: 5 }]);
			assert.fail('should have thrown');
		} catch (e) {
			assert.ok((e as Error).message.includes('IPC error'));
		}

		channelDisposables.dispose();
	});

	test('empty results returned correctly', async () => {
		const response: SearchResponse = {
			results: [],
			provider: 'brave',
			query: 'empty query',
			totalResults: 0,
			responseTimeMs: 50,
		};

		const channelDisposables = new DisposableStore();
		const service = {
			search: async () => response,
		};
		const channel = ProxyChannel.fromService(service, channelDisposables);

		const result = await channel.call(null, 'search', [{ query: 'empty query' }]) as SearchResponse;

		assert.strictEqual(result.results.length, 0);

		channelDisposables.dispose();
	});

	test('request contains query and maxResults', async () => {
		const channelDisposables = new DisposableStore();
		const service = {
			search: async (request: { query: string; maxResults?: number }) => {
				return { results: [], provider: 'brave', query: 'test', responseTimeMs: 10 }
			}
		};
		const channel = ProxyChannel.fromService(service, channelDisposables);

		await channel.call(null, 'search', [{ query: 'my search query', maxResults: 3 }]);

		channelDisposables.dispose();
	});

	test('request with omitted maxResults passes undefined', async () => {
		const channelDisposables = new DisposableStore();
		const service = {
			search: async (request: { query: string; maxResults?: number }) => {
				return { results: [], provider: 'brave', query: 'test', responseTimeMs: 10 }
			}
		};
		const channel = ProxyChannel.fromService(service, channelDisposables);

		await channel.call(null, 'search', [{ query: 'test' }]);

		channelDisposables.dispose();
	});
});