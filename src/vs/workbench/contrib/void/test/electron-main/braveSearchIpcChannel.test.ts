/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ProxyChannel } from '../../../../../base/parts/ipc/common/ipc.js';
import { StorageScope } from '../../../../../platform/storage/common/storage.js';
import { IApplicationStorageMainService } from '../../../../../platform/storage/electron-main/storageMainService.js';
import { IEncryptionMainService } from '../../../../../platform/encryption/common/encryptionService.js';
import { BraveSearchMainService } from '../../electron-main/braveSearchMainService.js';
import { SearchRequest, SearchResponse } from '../../common/webSearchTypes.js';

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

const mockStorage = (value: string | undefined) => ({
	get: (_key: string, _scope: StorageScope) => value,
}) as unknown as IApplicationStorageMainService;

const mockEncryption = (decrypted: string) => ({
	decrypt: async (_value: string) => decrypted,
}) as unknown as IEncryptionMainService;

const mockFetch = (response: Response) => {
	globalThis.fetch = async (): Promise<Response> => response;
};

const realFetch = globalThis.fetch;

const validRequest: SearchRequest = { query: 'test query', maxResults: 5 };

const braveOkResponse = (webResults: unknown[]): Response =>
	new Response(JSON.stringify({ web: { results: webResults } }), {
		status: 200,
		headers: { 'content-type': 'application/json' },
	});

suite('Brave Search - IPC Channel', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	const channelDisposables = new DisposableStore();

	teardown(() => {
		globalThis.fetch = realFetch;
	});

	test('channel exposes search operation and returns results', async () => {
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
		const channel = ProxyChannel.fromService(service, channelDisposables);

		const result = await channel.call(null, 'search', [validRequest]) as SearchResponse;

		assert.strictEqual(result.provider, 'brave');
		assert.strictEqual(result.query, 'test query');
		assert.strictEqual(result.results.length, 1);
		assert.strictEqual(result.results[0].title, 'Kodia Homepage');
		assert.strictEqual(result.results[0].source, 'brave');
		assert.ok(!JSON.stringify(result).includes('test-key-123'));
	});

	test('channel propagates missing API key error', async () => {
		const noKeySettings = JSON.stringify({
			globalSettings: { webSearchProviders: { brave: { apiKey: undefined, enabled: true, priority: 0, maxResults: 10, timeoutMs: 15000 } } },
		});
		mockStorage(encryptedBlob);
		mockEncryption(noKeySettings);

		const service = new BraveSearchMainService(mockStorage(encryptedBlob), mockEncryption(noKeySettings));
		const channel = ProxyChannel.fromService(service, channelDisposables);

		await assert.rejects(
			channel.call(null, 'search', [validRequest]),
			(err: Error) => err.message.includes('not configured') && !err.message.includes('test-key')
		);
	});

	test('channel propagates disabled provider error without calling fetch', async () => {
		const disabledSettings = JSON.stringify({
			globalSettings: { webSearchProviders: { brave: { apiKey: 'test-key-123', enabled: false, priority: 0, maxResults: 10, timeoutMs: 15000 } } },
		});
		mockStorage(encryptedBlob);
		mockEncryption(disabledSettings);

		let fetchCalled = false;
		globalThis.fetch = async () => { fetchCalled = true; return new Response(''); };

		const service = new BraveSearchMainService(mockStorage(encryptedBlob), mockEncryption(disabledSettings));
		const channel = ProxyChannel.fromService(service, channelDisposables);

		await assert.rejects(
			channel.call(null, 'search', [validRequest]),
			(err: Error) => err.message.includes('disabled')
		);
		assert.strictEqual(fetchCalled, false, 'fetch must not be called when Brave is disabled');
	});

	test('channel propagates HTTP error safely', async () => {
		mockStorage(encryptedBlob);
		mockEncryption(decryptedSettings);
		mockFetch(new Response(JSON.stringify({ error: 'invalid key' }), { status: 401, headers: { 'content-type': 'application/json' } }));

		const service = new BraveSearchMainService(mockStorage(encryptedBlob), mockEncryption(decryptedSettings));
		const channel = ProxyChannel.fromService(service, channelDisposables);

		await assert.rejects(
			channel.call(null, 'search', [validRequest]),
			(err: Error) => err.message.includes('401') && !err.message.includes('test-key-123')
		);
	});

	test('channel propagates network failure safely', async () => {
		mockStorage(encryptedBlob);
		mockEncryption(decryptedSettings);
		globalThis.fetch = async () => { throw new Error('network unreachable'); };

		const service = new BraveSearchMainService(mockStorage(encryptedBlob), mockEncryption(decryptedSettings));
		const channel = ProxyChannel.fromService(service, channelDisposables);

		await assert.rejects(
			channel.call(null, 'search', [validRequest]),
			(err: Error) => err.message.includes('network unreachable') && !err.message.includes('test-key-123')
		);
	});

	test('channel throws for unknown command', async () => {
		mockStorage(encryptedBlob);
		mockEncryption(decryptedSettings);

		const service = new BraveSearchMainService(mockStorage(encryptedBlob), mockEncryption(decryptedSettings));
		const channel = ProxyChannel.fromService(service, channelDisposables);

		assert.throws(
			() => channel.call(null, 'nonexistentCommand', [validRequest]),
			(err: Error) => err.message.includes('Method not found')
		);
	});

	test('channel call passes request correctly to service', async () => {
		mockStorage(encryptedBlob);
		mockEncryption(decryptedSettings);
		mockFetch(braveOkResponse([]));

		const service = new BraveSearchMainService(mockStorage(encryptedBlob), mockEncryption(decryptedSettings));
		const channel = ProxyChannel.fromService(service, channelDisposables);

		const customRequest: SearchRequest = { query: 'custom query', maxResults: 3 };
		const result = await channel.call(null, 'search', [customRequest]) as SearchResponse;

		assert.strictEqual(result.query, 'custom query');
		assert.strictEqual(result.results.length, 0);
	});

	test('service registration does not require an API key at startup', async () => {
		// Constructing the service with no stored settings should not throw.
		// The key is only needed when search() is actually called.
		mockStorage(undefined);
		mockEncryption(decryptedSettings);

		const service = new BraveSearchMainService(mockStorage(undefined), mockEncryption(decryptedSettings));
		const channel = ProxyChannel.fromService(service, channelDisposables);

		// Channel should be created successfully even without an API key
		assert.ok(channel);
	});
});
