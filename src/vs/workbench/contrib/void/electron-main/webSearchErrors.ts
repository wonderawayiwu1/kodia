/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * Error classification for web search providers.
 * Used by the orchestrator to determine fallback behavior.
 */
export enum WebSearchErrorType {
	/** Transient errors that warrant fallback to next provider */
	Transient = 'transient',
	/** Configuration/auth errors that should NOT trigger fallback */
	Configuration = 'configuration',
	/** Unknown/unclassified errors */
	Unknown = 'unknown',
}

/**
 * Structured error for web search operations.
 * Allows the orchestrator to make intelligent fallback decisions.
 */
export class WebSearchError extends Error {
	readonly type: WebSearchErrorType;
	readonly statusCode?: number;
	readonly providerName: string;
	readonly isRetryable: boolean;

	constructor(
		message: string,
		providerName: string,
		options: {
			type?: WebSearchErrorType;
			statusCode?: number;
			isRetryable?: boolean;
			cause?: Error;
		} = {}
	) {
		super(message);
		this.name = 'WebSearchError';
		this.type = options.type ?? WebSearchErrorType.Unknown;
		this.statusCode = options.statusCode;
		this.providerName = providerName;
		this.isRetryable = options.isRetryable ?? (options.type === WebSearchErrorType.Transient);

		// Maintain proper stack trace in V8
		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, WebSearchError);
		}
	}

	/**
	 * Creates a transient (retryable) error.
	 */
	static transient(message: string, providerName: string, statusCode?: number, cause?: Error): WebSearchError {
		return new WebSearchError(message, providerName, {
			type: WebSearchErrorType.Transient,
			statusCode,
			isRetryable: true,
			cause,
		});
	}

	/**
	 * Creates a configuration/auth error (non-retryable).
	 */
	static configuration(message: string, providerName: string, statusCode?: number, cause?: Error): WebSearchError {
		return new WebSearchError(message, providerName, {
			type: WebSearchErrorType.Configuration,
			statusCode,
			isRetryable: false,
			cause,
		});
	}

	/**
	 * Creates an unknown error (defaults to non-retryable for safety).
	 */
	static unknown(message: string, providerName: string, cause?: Error): WebSearchError {
		return new WebSearchError(message, providerName, {
			type: WebSearchErrorType.Unknown,
			isRetryable: false,
			cause,
		});
	}

	/**
	 * Classifies an HTTP response status code into an error type.
	 */
	static classifyStatusCode(statusCode: number, providerName: string): { type: WebSearchErrorType; isRetryable: boolean } {
		// Configuration/auth errors - should NOT fall back
		if (statusCode === 400 || statusCode === 401 || statusCode === 403 || statusCode === 422) {
			return { type: WebSearchErrorType.Configuration, isRetryable: false };
		}
		// Tavily-specific: plan/usage limits - configuration errors (don't fall back)
		if (statusCode === 432 || statusCode === 433) {
			return { type: WebSearchErrorType.Configuration, isRetryable: false };
		}
		// Tavily-specific: Flex tier capacity exceeded - transient (retry shortly or omit max_age_hours)
		// Verified: https://docs.tavily.com/documentation/rate-limits#flex-tier-capacity
		if (statusCode === 434) {
			return { type: WebSearchErrorType.Transient, isRetryable: true };
		}
		// Rate limit - SHOULD fall back
		if (statusCode === 429) {
			return { type: WebSearchErrorType.Transient, isRetryable: true };
		}
		// Request timeout / Too early - transient HTTP codes
		if (statusCode === 408 || statusCode === 425) {
			return { type: WebSearchErrorType.Transient, isRetryable: true };
		}
		// Server errors - SHOULD fall back
		if (statusCode >= 500) {
			return { type: WebSearchErrorType.Transient, isRetryable: true };
		}
		// Unknown status - conservative: don't fall back
		return { type: WebSearchErrorType.Configuration, isRetryable: false };
	}

	/**
	 * Classifies a fetch/network error.
	 */
	static classifyNetworkError(error: Error, providerName: string): WebSearchError {
		const message = error.message;
		const name = error.name;

		// Timeout errors - SHOULD fall back
		if (name === 'TimeoutError' || name === 'AbortError' || message.includes('timeout') || message.includes('TimeoutError')) {
			return WebSearchError.transient(`Request timed out`, providerName, undefined, error);
		}

		// Network errors - SHOULD fall back
		if (
			message.includes('network') ||
			message.includes('fetch') ||
			message.includes('ENOTFOUND') ||
			message.includes('ECONNREFUSED') ||
			message.includes('EAI_AGAIN') ||
			message.includes('ENETUNREACH')
		) {
			return WebSearchError.transient(`Network error: ${message}`, providerName, undefined, error);
		}

		// Unknown - conservative: don't fall back
		return WebSearchError.unknown(`Request failed: ${message}`, providerName, error);
	}
}