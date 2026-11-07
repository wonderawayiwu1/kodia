/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { listProviderModels } from '../../electron-main/llmMessage/listProviderModels.js';

const realFetch = globalThis.fetch;

const mockFetch = (response: unknown, status = 200): void => {
	globalThis.fetch = (async () => new Response(JSON.stringify(response), { status })) as typeof fetch;
};

suite('Kodia - NVIDIA model discovery', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	setup(() => {
		mockFetch({ data: [] });
	});
	teardown(() => {
		globalThis.fetch = realFetch;
	});

	test('returns the models NVIDIA lists, preserving exact IDs', async () => {
		const models = [
			{ id: 'nvidia/nemotron-3-super-120b-a12b', context_length: 1_000_000 },
			{ id: 'meta/llama-3.1-8b-instruct' },
		];
		mockFetch({ data: models });
		const result = await listProviderModels('nvidia', 'nvapi-test-key');
		assert.deepStrictEqual(result, models);
	});

	test('returns an empty array when NVIDIA lists no models', async () => {
		mockFetch({ data: [] });
		const result = await listProviderModels('nvidia', 'nvapi-test-key');
		assert.deepStrictEqual(result, []);
	});

	test('throws on a non-OK response (invalid or revoked key)', async () => {
		mockFetch({ error: { message: 'Invalid API key' } }, 401);
		await assert.rejects(() => listProviderModels('nvidia', 'nvapi-bad-key'));
	});

	test('passes the bearer token and the NVIDIA base URL', async () => {
		let capturedUrl = '';
		let capturedHeader: string | undefined;
		globalThis.fetch = (async (url: string, init?: RequestInit) => {
			capturedUrl = String(url);
			capturedHeader = (init?.headers as { Authorization?: string } | undefined)?.Authorization;
			return new Response(JSON.stringify({ data: [] }), { status: 200 });
		}) as typeof fetch;
		try {
			await listProviderModels('nvidia', 'nvapi-test-key');
			assert.strictEqual(capturedUrl, 'https://integrate.api.nvidia.com/v1/models');
			assert.strictEqual(capturedHeader, 'Bearer nvapi-test-key');
		} finally {
			globalThis.fetch = realFetch;
		}
	});

	test('network failure propagates as an error', async () => {
		globalThis.fetch = (async () => {
			throw new TypeError('Failed to fetch');
		}) as typeof fetch;
		try {
			await assert.rejects(() => listProviderModels('nvidia', 'nvapi-test-key'));
		} finally {
			globalThis.fetch = realFetch;
		}
	});
});
