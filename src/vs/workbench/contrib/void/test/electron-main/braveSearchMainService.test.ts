/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { StorageScope } from '../../../../../platform/storage/common/storage.js';
import { IApplicationStorageMainService } from '../../../../../platform/storage/electron-main/storageMainService.js';
import { IEncryptionMainService } from '../../../../../platform/encryption/common/encryptionService.js';
import { BraveSearchMainService } from '../../electron-main/braveSearchMainService.js';
import { SearchRequest } from '../../common/webSearchTypes.js';

// Preserve import for type resolution (only used in type assertions)
const _preserveApplicationStorageMainService = IApplicationStorageMainService;
void _preserveApplicationStorageMainService;

const encryptedBlob = 'encrypted-blob';
const decryptedSettings = JSON.stringify({
	globalSettings: {
		webSearchProviders: {
			brave: {
				apiKey: 'test-key-123',
				enabled: true,
				priority: 0,
				maxResults: 10,
				timeoutMs: 15000,
			},
		},
	},
});

const disabledSettings = JSON.stringify({
	globalSettings: {
		webSearchProviders: {
			brave: {
				apiKey: 'test-key-123',
				enabled: false,
				priority: 0,
				maxResults: 10,
				timeoutMs: 15000,
			},
		},
	},
});

const mockStorage = (value: string | undefined) => ({
	get: (_key: string, _scope: StorageScope) => value,
}) as unknown as IApplicationStorageMainService;

const mockEncryption = (decrypted: string, shouldFail = false) => ({
	decrypt: async (_value: string) => {
		if (shouldFail) throw new Error('decryption failed');
		return decrypted;
	},
}) as unknown as IEncryptionMainService;

let fetchCallCount = 0;
let lastFetchUrl: string | undefined;
const mockFetch = (response: Response) => {
	fetchCallCount = 0;
	lastFetchUrl = undefined;
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		fetchCallCount += 1;
		lastFetchUrl = input instanceof URL ? input.href : String(input);
		return response;
	}) as typeof fetch;
};

const realFetch = globalThis.fetch;

const validRequest: SearchRequest = { query: 'test query', maxResults: 5 };

const braveResponse = (status: number, body: string): Response =>
	new Response(body, { status, headers: { 'content-type': 'application/json' } });

const braveOkResponse = (webResults: unknown[]): Response =>
	braveResponse(200, JSON.stringify({ web: { results: webResults } }));

suite('Brave Search - Main Service', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	teardown(() => {
		globalThis.fetch = realFetch;
		fetchCallCount = 0;
	});

	test('successful search returns normalized results with page_age', async () => {
		const item = {
			title: 'Kodia Homepage',
			url: 'https://kodia.example.com',
			description: 'A code editor.',
			page_age: '2026-01-01',
		};
		mockStorage(encryptedBlob);
		mockEncryption(decryptedSettings);
		mockFetch(braveOkResponse([item]));

		const service = new BraveSearchMainService(mockStorage(encryptedBlob), mockEncryption(decryptedSettings));
		const response = await service.search(validRequest);

		assert.strictEqual(response.provider, 'brave');
		assert.strictEqual(response.query, 'test query');
		assert.strictEqual(response.results.length, 1);
		assert.strictEqual(response.results[0].title, 'Kodia Homepage');
		assert.strictEqual(response.results[0].url, 'https://kodia.example.com');
		assert.strictEqual(response.results[0].displayUrl, 'https://kodia.example.com');
		assert.strictEqual(response.results[0].snippet, 'A code editor.');
		assert.strictEqual(response.results[0].source, 'brave');
		assert.strictEqual(response.results[0].publishedDate, '2026-01-01');
		assert.strictEqual(response.results[0].score, undefined);
		assert.ok(typeof response.results[0].retrievalTimestamp === 'number');
		assert.ok(response.responseTimeMs >= 0);
		// API key must not appear in the response
		assert.ok(!JSON.stringify(response).includes('test-key-123'));
	});

	test('page_age is mapped to publishedDate', async () => {
		const item = {
			title: 'Example Result',
			url: 'https://example.com',
			description: 'An example result.',
			page_age: '2025-06-15',
		};
		mockStorage(encryptedBlob);
		mockEncryption(decryptedSettings);
		mockFetch(braveOkResponse([item]));

		const service = new BraveSearchMainService(mockStorage(encryptedBlob), mockEncryption(decryptedSettings));
		const response = await service.search(validRequest);

		assert.strictEqual(response.results[0].publishedDate, '2025-06-15');
	});

	test('missing page_age leaves publishedDate undefined', async () => {
		const item = {
			title: 'Example Result',
			url: 'https://example.com',
			description: 'An example result.',
		};
		mockStorage(encryptedBlob);
		mockEncryption(decryptedSettings);
		mockFetch(braveOkResponse([item]));

		const service = new BraveSearchMainService(mockStorage(encryptedBlob), mockEncryption(decryptedSettings));
		const response = await service.search(validRequest);

		assert.strictEqual(response.results[0].publishedDate, undefined);
		assert.strictEqual(response.results[0].title, 'Example Result');
		assert.strictEqual(response.results[0].snippet, 'An example result.');
	});

	test('missing optional fields are handled safely', async () => {
		const item = {
			title: 'Minimal Result',
			url: 'https://example.com/minimal',
		};
		mockStorage(encryptedBlob);
		mockEncryption(decryptedSettings);
		mockFetch(braveOkResponse([item]));

		const service = new BraveSearchMainService(mockStorage(encryptedBlob), mockEncryption(decryptedSettings));
		const response = await service.search(validRequest);

		assert.strictEqual(response.results[0].title, 'Minimal Result');
		assert.strictEqual(response.results[0].snippet, '');
		assert.strictEqual(response.results[0].publishedDate, undefined);
		assert.strictEqual(response.results[0].source, 'brave');
	});

	test('no rank field does not invent a score', async () => {
		const item = {
			title: 'Unranked Result',
			url: 'https://example.com/unranked',
			description: 'A result with no rank.',
			page_age: '2026-03-01',
		};
		mockStorage(encryptedBlob);
		mockEncryption(decryptedSettings);
		mockFetch(braveOkResponse([item]));

		const service = new BraveSearchMainService(mockStorage(encryptedBlob), mockEncryption(decryptedSettings));
		const response = await service.search(validRequest);

		assert.strictEqual(response.results[0].score, undefined);
		assert.strictEqual(response.results[0].title, 'Unranked Result');
	});

	test('safe search parameter is set to moderate', async () => {
		const item = {
			title: 'Safe Result',
			url: 'https://example.com/safe',
			description: 'A safe result.',
		};
		mockStorage(encryptedBlob);
		mockEncryption(decryptedSettings);
		mockFetch(braveOkResponse([item]));

		const service = new BraveSearchMainService(mockStorage(encryptedBlob), mockEncryption(decryptedSettings));
		const response = await service.search(validRequest);

		assert.strictEqual(response.results[0].title, 'Safe Result');
		assert.ok(lastFetchUrl?.includes('safesearch=moderate'), `Expected safesearch=moderate in URL, got: ${lastFetchUrl}`);
		assert.ok(lastFetchUrl?.includes('search_lang=en'), `Expected search_lang=en in URL, got: ${lastFetchUrl}`);
		assert.ok(lastFetchUrl?.includes('q=test+query') || lastFetchUrl?.includes('q=test%20query'), `Expected encoded query in URL, got: ${lastFetchUrl}`);
	});

	test('missing API key throws without exposing the key', async () => {
		const noKeySettings = JSON.stringify({
			globalSettings: { webSearchProviders: { brave: { apiKey: undefined, enabled: true, priority: 0, maxResults: 10, timeoutMs: 15000 } } },
		});
		mockStorage(encryptedBlob);
		mockEncryption(noKeySettings);

		const service = new BraveSearchMainService(mockStorage(encryptedBlob), mockEncryption(noKeySettings));
		await assert.rejects(
			service.search(validRequest),
			(err: Error) => err.message.includes('not configured') && !err.message.includes('test-key')
		);
	});

	test('no stored settings throws missing key', async () => {
		mockStorage(undefined);

		const service = new BraveSearchMainService(mockStorage(undefined), mockEncryption(decryptedSettings));
		await assert.rejects(
			service.search(validRequest),
			(err: Error) => err.message.includes('not configured')
		);
	});

	test('decryption failure throws safely', async () => {
		mockStorage(encryptedBlob);
		mockEncryption(decryptedSettings, true);

		const service = new BraveSearchMainService(mockStorage(encryptedBlob), mockEncryption(decryptedSettings, true));
		await assert.rejects(
			service.search(validRequest),
			(err: Error) => err.message.includes('decryption failed')
		);
	});

	test('disabled provider does not call fetch and throws', async () => {
		mockStorage(encryptedBlob);
		mockEncryption(disabledSettings);

		const service = new BraveSearchMainService(mockStorage(encryptedBlob), mockEncryption(disabledSettings));
		await assert.rejects(
			service.search(validRequest),
			(err: Error) => err.message.includes('disabled')
		);
		assert.strictEqual(fetchCallCount, 0, 'fetch must not be called when Brave is disabled');
	});

	test('HTTP 401 authentication failure throws safely', async () => {
		mockStorage(encryptedBlob);
		mockEncryption(decryptedSettings);
		mockFetch(braveResponse(401, JSON.stringify({ error: 'invalid key' })));

		const service = new BraveSearchMainService(mockStorage(encryptedBlob), mockEncryption(decryptedSettings));
		await assert.rejects(
			service.search(validRequest),
			(err: Error) => err.message.includes('401') && !err.message.includes('test-key-123')
		);
	});

	test('HTTP 429 rate limit throws safely', async () => {
		mockStorage(encryptedBlob);
		mockEncryption(decryptedSettings);
		mockFetch(braveResponse(429, JSON.stringify({ error: 'rate limited' })));

		const service = new BraveSearchMainService(mockStorage(encryptedBlob), mockEncryption(decryptedSettings));
		await assert.rejects(
			service.search(validRequest),
			(err: Error) => err.message.includes('429') && !err.message.includes('test-key-123')
		);
	});

	test('other HTTP failure throws safely', async () => {
		mockStorage(encryptedBlob);
		mockEncryption(decryptedSettings);
		mockFetch(braveResponse(500, 'Internal Server Error'));

		const service = new BraveSearchMainService(mockStorage(encryptedBlob), mockEncryption(decryptedSettings));
		await assert.rejects(
			service.search(validRequest),
			(err: Error) => err.message.includes('500') && !err.message.includes('test-key-123')
		);
	});

	test('malformed JSON response throws safely', async () => {
		mockStorage(encryptedBlob);
		mockEncryption(decryptedSettings);
		mockFetch(braveResponse(200, 'not json at all'));

		const service = new BraveSearchMainService(mockStorage(encryptedBlob), mockEncryption(decryptedSettings));
		await assert.rejects(
			service.search(validRequest),
			(err: Error) => err.message.includes('invalid response')
		);
	});

	test('empty results array returns empty results', async () => {
		mockStorage(encryptedBlob);
		mockEncryption(decryptedSettings);
		mockFetch(braveOkResponse([]));

		const service = new BraveSearchMainService(mockStorage(encryptedBlob), mockEncryption(decryptedSettings));
		const response = await service.search(validRequest);

		assert.strictEqual(response.results.length, 0);
		assert.strictEqual(response.totalResults, 0);
	});

	test('malformed stored settings JSON falls back to defaults', async () => {
		mockStorage(encryptedBlob);
		mockEncryption('not json');

		const service = new BraveSearchMainService(mockStorage(encryptedBlob), mockEncryption('not json'));
		await assert.rejects(
			service.search(validRequest),
			(err: Error) => err.message.includes('not configured')
		);
	});

	test('fetch network failure throws safely', async () => {
		mockStorage(encryptedBlob);
		mockEncryption(decryptedSettings);
		const networkError = new Error('network unreachable');
		globalThis.fetch = async () => { throw networkError; };

		const service = new BraveSearchMainService(mockStorage(encryptedBlob), mockEncryption(decryptedSettings));
		await assert.rejects(
			service.search(validRequest),
			(err: Error) => err.message.includes('network unreachable') && !err.message.includes('test-key-123')
		);
	});

	test('AbortError from fetch is reported as timeout', async () => {
		mockStorage(encryptedBlob);
		mockEncryption(decryptedSettings);
		const abortError = new Error('The operation was aborted.');
		abortError.name = 'AbortError';
		globalThis.fetch = async () => { throw abortError; };

		const service = new BraveSearchMainService(mockStorage(encryptedBlob), mockEncryption(decryptedSettings));
		await assert.rejects(
			service.search(validRequest),
			(err: Error) => err.message.includes('timed out')
		);
	});

	test('TimeoutError from fetch is reported as timeout', async () => {
		mockStorage(encryptedBlob);
		mockEncryption(decryptedSettings);
		const timeoutError = new Error('timed out');
		timeoutError.name = 'TimeoutError';
		globalThis.fetch = async () => { throw timeoutError; };

		const service = new BraveSearchMainService(mockStorage(encryptedBlob), mockEncryption(decryptedSettings));
		await assert.rejects(
			service.search(validRequest),
			(err: Error) => err.message.includes('timed out')
		);
	});

	test('invalid empty query throws', async () => {
		const service = new BraveSearchMainService(mockStorage(encryptedBlob), mockEncryption(decryptedSettings));
		await assert.rejects(
			service.search({ query: '' }),
			(err: Error) => err.message.includes('query is required')
		);
	});

	test('invalid whitespace-only query throws', async () => {
		const service = new BraveSearchMainService(mockStorage(encryptedBlob), mockEncryption(decryptedSettings));
		await assert.rejects(
			service.search({ query: '   ' }),
			(err: Error) => err.message.includes('query is required')
		);
	});

	test('invalid maxResults below 1 throws', async () => {
		const service = new BraveSearchMainService(mockStorage(encryptedBlob), mockEncryption(decryptedSettings));
		await assert.rejects(
			service.search({ query: 'q', maxResults: 0 }),
			(err: Error) => err.message.includes('maxResults')
		);
	});

	test('invalid maxResults above 50 throws', async () => {
		const service = new BraveSearchMainService(mockStorage(encryptedBlob), mockEncryption(decryptedSettings));
		await assert.rejects(
			service.search({ query: 'q', maxResults: 100 }),
			(err: Error) => err.message.includes('maxResults')
		);
	});

	test('query is not leaked in error messages', async () => {
		mockStorage(encryptedBlob);
		mockEncryption(decryptedSettings);
		mockFetch(braveResponse(401, JSON.stringify({ error: 'invalid key' })));

		const service = new BraveSearchMainService(mockStorage(encryptedBlob), mockEncryption(decryptedSettings));
		try {
			await service.search({ query: 'super secret query', maxResults: 5 });
			assert.fail('should have thrown');
		} catch (err) {
			const message = (err as Error).message;
			assert.ok(!message.includes('super secret query'), 'query leaked into error message: ' + message);
		}
	});

	test('API key is not in error messages', async () => {
		mockStorage(encryptedBlob);
		mockEncryption(decryptedSettings);
		mockFetch(braveResponse(401, JSON.stringify({ error: 'invalid key' })));

		const service = new BraveSearchMainService(mockStorage(encryptedBlob), mockEncryption(decryptedSettings));
		try {
			await service.search(validRequest);
			assert.fail('should have thrown');
		} catch (err) {
			const message = (err as Error).message;
			assert.ok(!message.includes('test-key-123'), 'API key leaked into error message: ' + message);
		}
	});
});
