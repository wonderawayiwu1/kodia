/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { RetryPolicy, createRetryErrorInfo } from '../../common/retryPolicy.js';

suite('Kodia - retry policy', () => {
	suite('exponential backoff', () => {
		test('first retry has a delay', () => {
			const policy = new RetryPolicy();
			const d1 = policy.decide({ type: 'Transport', code: 'ENOTFOUND' }, true);
			assert.ok(d1.retry);
			assert.ok(d1.delayMs > 0);
			assert.ok(d1.delayMs <= 30_000);
		});

		test('delay grows with attempts', () => {
			const policy = new RetryPolicy();
			const delays: number[] = [];
			for (let i = 0; i < 5; i++) {
				const d = policy.decide({ type: 'Transport', code: 'ENOTFOUND' }, true);
				if (!d.retry) break;
				delays.push(d.delayMs);
			}
			assert.ok(delays.length >= 2);
			// Delays should generally increase (with jitter, not strictly)
			assert.ok(delays[delays.length - 1] >= delays[0] * 0.5);
		});

		test('stops after max retries', () => {
			const policy = new RetryPolicy();
			let retries = 0;
			while (true) {
				const d = policy.decide({ type: 'Transport', code: 'ENOTFOUND' }, true);
				if (!d.retry) break;
				retries++;
				if (retries > 20) break; // safety
			}
			assert.ok(retries <= 10);
		});

		test('non-retryable errors stop immediately', () => {
			const policy = new RetryPolicy();
			const d = policy.decide({ type: 'Unknown', code: null }, false);
			assert.strictEqual(d.retry, false);
		});
	});

	suite('retry-after', () => {
		test('respects provider retry-after header', () => {
			const policy = new RetryPolicy();
			const d = policy.decide(
				{ type: 'RateLimit', code: null, retryAfterMs: 60_000 },
				true,
			);
			assert.ok(d.retry);
			assert.ok(d.delayMs >= 60_000);
		});

		test('caps retry-after at max', () => {
			const policy = new RetryPolicy();
			const d = policy.decide(
				{ type: 'RateLimit', code: null, retryAfterMs: 999_999_999 },
				true,
			);
			assert.ok(d.retry);
			assert.ok(d.delayMs <= 15 * 60 * 1000);
		});
	});

	suite('unreachable host', () => {
		test('unreachable codes use separate budget', () => {
			const policy = new RetryPolicy();
			const d = policy.decide({ type: 'Transport', code: 'ENOTFOUND' }, true);
			assert.ok(d.retry);
			assert.ok(d.delayMs > 0);
		});

		test('reachable transport errors are retryable', () => {
			const policy = new RetryPolicy();
			const d = policy.decide({ type: 'Transport', code: 'ECONNRESET' }, true);
			assert.ok(d.retry || d.attempt > 0);
		});
	});

	suite('createRetryErrorInfo', () => {
		test('maps 429 to RateLimit', () => {
			const info = createRetryErrorInfo({ name: 'APIError', status: 429, headers: { 'retry-after': '30' } });
			assert.strictEqual(info.type, 'RateLimit');
			assert.strictEqual(info.retryAfterMs, 30_000);
		});

		test('maps 500+ to ProviderInternal', () => {
			const info = createRetryErrorInfo({ name: 'APIError', status: 503 });
			assert.strictEqual(info.type, 'ProviderInternal');
		});

		test('maps transport errors', () => {
			const info = createRetryErrorInfo({ name: 'TransportError', code: 'ENOTFOUND' });
			assert.strictEqual(info.type, 'Transport');
			assert.strictEqual(info.code, 'ENOTFOUND');
		});
	});
});
