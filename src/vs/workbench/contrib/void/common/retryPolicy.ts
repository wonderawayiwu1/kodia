/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// OpenCode model-retry.ts adaptation: exponential backoff with jitter, retry-after support,
// and separate budgets for unreachable hosts and timeouts. Replaces Kodia's simple fixed-delay
// retry (CHAT_RETRIES=3, RETRY_DELAY=2500ms) with a policy that backs off exponentially and
// respects provider-supplied Retry-After delays.

export type RetryDecision = { readonly retry: boolean; readonly attempt: number; readonly delayMs: number }

export type RetryErrorInfo = {
	readonly type: string
	readonly code?: string | null
	readonly retryAfterMs?: number | null
	readonly httpStatus?: number | null
}

const RETRY_AFTER_MAX_MS = 15 * 60 * 1000 // 15 minutes
const MAX_RETRIES = 10
const BASE_DELAY_MS = 2000
const MAX_GAP_MS = 10_000
const MAX_TIMEOUT_RETRIES = 3
const UNREACHABLE_WINDOW_MS = 60 * 60 * 1000 // 1 hour
const UNREACHABLE_GAP_MAX_MS = 30_000

const UNREACHABLE_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'ENETDOWN'])
const NOT_SENT_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'])

export const isUnreachableError = (error: RetryErrorInfo): boolean =>
	error.type === 'Transport' && error.code != null && UNREACHABLE_CODES.has(error.code)

export const isNotSentError = (error: RetryErrorInfo): boolean => {
	if (error.type === 'RateLimit') return true
	if (error.type === 'ProviderInternal') return error.httpStatus === 503 || error.httpStatus === 529
	if (error.type === 'Transport')
		return error.code !== null && error.code !== undefined && NOT_SENT_CODES.has(error.code)
	return false
}

export class RetryPolicy {
	private attempt = 1
	private timeouts = 0
	private unreachableStart: number | null = null

	decide(cause: RetryErrorInfo, retryable: boolean): RetryDecision {
		const now = Date.now()

		// Determine which schedule to use
		let delay: number

		if (retryable && isUnreachableError(cause)) {
			if (this.unreachableStart === null) this.unreachableStart = now
			const elapsed = now - this.unreachableStart
			if (elapsed > UNREACHABLE_WINDOW_MS) {
				return { retry: false, attempt: this.attempt, delayMs: 0 }
			}
			delay = this._exponentialDelay(BASE_DELAY_MS, UNREACHABLE_GAP_MAX_MS, this.attempt - 1)
		} else {
			this.unreachableStart = null
			delay = this._exponentialDelay(BASE_DELAY_MS, MAX_GAP_MS, this.attempt - 1)
		}

		// Apply provider-supplied Retry-After
		const retryAfter = this._retryAfterMs(cause)
		if (retryAfter !== undefined) {
			delay = Math.max(delay, Math.min(retryAfter, RETRY_AFTER_MAX_MS))
		}

		// Count timeouts
		if (cause.type === 'Transport' && cause.code === 'Timeout') this.timeouts++

		this.attempt++

		const shouldRetry = retryable && this.attempt <= MAX_RETRIES && this.timeouts <= MAX_TIMEOUT_RETRIES

		return {
			retry: shouldRetry,
			attempt: this.attempt - 1,
			delayMs: Math.ceil(delay),
		}
	}

	private _exponentialDelay(baseMs: number, capMs: number, attemptIndex: number): number {
		// Exponential: base * 2^attemptIndex, jittered, capped at capMs
		const raw = baseMs * Math.pow(2, attemptIndex)
		const capped = Math.min(raw, capMs)
		// Jitter: +/- 25%
		const jitter = capped * 0.25 * (Math.random() * 2 - 1)
		return Math.max(0, capped + jitter)
	}

	private _retryAfterMs(cause: RetryErrorInfo): number | undefined {
		if (cause.type === 'RateLimit' || cause.type === 'ProviderInternal') {
			return cause.retryAfterMs ?? undefined
		}
		return undefined
	}

	reset(): void {
		this.attempt = 1
		this.timeouts = 0
		this.unreachableStart = null
	}
}

export function createRetryErrorInfo(error: { name?: string; message?: string; code?: string | null; status?: number | null; headers?: Record<string, string> | null }): RetryErrorInfo {
	const type = error.name || 'Unknown'
	let code: string | null = error.code ?? null
	let retryAfterMs: number | undefined
	let httpStatus: number | null = error.status ?? null

	// Extract retry-after from headers
	const headers = error.headers ?? {}
	const ra = headers['retry-after'] || headers['Retry-After']
	if (ra !== undefined) {
		const parsed = Number.parseInt(ra, 10)
		if (!Number.isNaN(parsed)) retryAfterMs = parsed * 1000 // header is in seconds
	}

	// Map common types
	if (type === 'RateLimitError' || type === 'RateLimit') return { type: 'RateLimit', code, retryAfterMs, httpStatus: httpStatus ?? null }
	if (type === 'APIError' && httpStatus === 429) return { type: 'RateLimit', code, retryAfterMs, httpStatus: httpStatus ?? null }
	if (type === 'APIError' && httpStatus !== undefined && httpStatus !== null && httpStatus >= 500) return { type: 'ProviderInternal', code, retryAfterMs, httpStatus: httpStatus ?? null }
	if (type === 'TransportError' || type === 'Transport') return { type: 'Transport', code, retryAfterMs, httpStatus: httpStatus ?? null }

	return { type, code, retryAfterMs, httpStatus: httpStatus ?? null }
}
