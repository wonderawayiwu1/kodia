/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { IApplicationStorageMainService } from '../../../../platform/storage/electron-main/storageMainService.js';
import { IEncryptionMainService } from '../../../../platform/encryption/common/encryptionService.js';
import { SearchRequest, SearchResponse, SearchResult, SearchProviderSettings } from '../common/webSearchTypes.js';
import { WebSearchProvider } from './webSearchProvider.js';
import { WebSearchError, WebSearchErrorType } from './webSearchErrors.js';

const YOU_API_ENDPOINT = 'https://ydc-index.io/v1/search';
const YOU_MAX_COUNT = 100;
const DEFAULT_TIMEOUT_MS = 15000;

/**
 * You.com Search provider implementation.
 * API docs: https://you.com/docs/api-reference/search/v1-search
 * Endpoint: POST https://ydc-index.io/v1/search
 * Auth: X-API-Key header
 */
export class YouSearchMainService extends WebSearchProvider {
	readonly name = 'you' as const;
	readonly requiresApiKey = true;
	readonly maxResultsLimit = YOU_MAX_COUNT;
	readonly defaultTimeoutMs = DEFAULT_TIMEOUT_MS;

	constructor(
		@IApplicationStorageMainService private readonly _storageService?: IApplicationStorageMainService,
		@IEncryptionMainService private readonly _encryptionService?: IEncryptionMainService,
	) {
		super();
	}

	// Allow tests to inject services after construction
	setStorageService(service: IApplicationStorageMainService): void {
		(this._storageService as any) = service;
	}

	setEncryptionService(service: IEncryptionMainService): void {
		(this._encryptionService as any) = service;
	}

	validateSettings(settings: SearchProviderSettings): { valid: boolean; errors: string[] } {
		const errors: string[] = [];

		if (typeof settings.maxResults === 'number') {
			if (settings.maxResults < 1 || settings.maxResults > 50) {
				errors.push('maxResults must be between 1 and 50');
			}
		}

		if (typeof settings.timeoutMs === 'number') {
			if (settings.timeoutMs < 1000 || settings.timeoutMs > 60000) {
				errors.push('timeoutMs must be between 1000 and 60000');
			}
		}

		if (typeof settings.priority === 'number') {
			if (settings.priority < 0 || settings.priority > 10) {
				errors.push('priority must be between 0 and 10');
			}
		}

		if (settings.enabled && (!settings.apiKey || settings.apiKey.trim() === '')) {
			errors.push('API key is required for You.com');
		}

		return { valid: errors.length === 0, errors };
	}

	async testConnection(settings: SearchProviderSettings): Promise<{ success: boolean; message: string }> {
		if (!settings.apiKey) {
			return { success: false, message: 'You.com API key is not configured.' };
		}

		try {
			const res = await fetch(YOU_API_ENDPOINT, {
				signal: AbortSignal.timeout(5000),
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-API-Key': settings.apiKey,
				},
				body: JSON.stringify({
					query: 'test connection',
					count: 1,
				}),
			});

			if (!res.ok) {
				if (res.status === 401 || res.status === 403) {
					return { success: false, message: 'You.com authentication failed. Please check your API key and ensure it has Web Search scope.' };
				}
				if (res.status === 402) {
					return { success: false, message: 'You.com account has insufficient credits. Please add credits to your account.' };
				}
				if (res.status === 429) {
					// Try to read response body to distinguish rate limit from spend cap
					let message = 'You.com rate limit exceeded. Please try again later.';
					try {
						const body = await res.clone().json();
						const errorCode = body?.error?.code;
						const errorMessage = body?.error?.message?.toLowerCase() ?? '';
						if (errorCode === 'spend_cap_exceeded' || errorMessage.includes('spend cap')) {
							message = 'You.com spend cap exceeded. Please increase your spending limit or wait for reset.';
						}
					} catch {
						// Ignore JSON parse errors, use default message
					}
					return { success: false, message };
				}
				if (res.status === 422) {
					return { success: false, message: 'You.com request validation failed. Check query parameters.' };
				}
				if (res.status >= 500) {
					return { success: false, message: `You.com server error (${res.status}). Please try again later.` };
				}
				return { success: false, message: `You.com API responded with status ${res.status}.` };
			}

			return { success: true, message: 'You.com connection successful!' };
		} catch (error) {
			const webSearchError = error instanceof WebSearchError ? error : WebSearchError.classifyNetworkError(error instanceof Error ? error : new Error(String(error)), 'you');
			return { success: false, message: webSearchError.message };
		}
	}

	async search(request: SearchRequest, settings: SearchProviderSettings): Promise<SearchResponse> {
		const apiKey = settings.apiKey;
		if (!apiKey) {
			throw WebSearchError.configuration('You.com API key is not configured.', 'you');
		}

		const maxResults = Math.min(Math.max(1, request.maxResults ?? settings.maxResults), YOU_MAX_COUNT);
		const timeoutMs = Math.min(Math.max(1000, settings.timeoutMs ?? DEFAULT_TIMEOUT_MS), 60000);

		const body: Record<string, unknown> = {
			query: request.query,
			count: maxResults,
		};

		// Add optional filters if provided
		if (request.filters) {
			if (request.filters.timeRange) {
				// Map timeRange to freshness parameter
				const freshnessMap: Record<string, string> = {
					day: 'day',
					week: 'week',
					month: 'month',
					year: 'year',
				};
				const freshness = freshnessMap[request.filters.timeRange];
				if (freshness) {
					body.freshness = freshness;
				}
			}
			if (request.filters.domains?.length) {
				body.include_domains = request.filters.domains;
			}
			if (request.filters.excludeDomains?.length) {
				body.exclude_domains = request.filters.excludeDomains;
			}
		}

		const startTime = Date.now();
		let res: Response;
		try {
			res = await fetch(YOU_API_ENDPOINT, {
				signal: AbortSignal.timeout(timeoutMs),
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-API-Key': apiKey,
				},
				body: JSON.stringify(body),
			});
		} catch (e) {
			if (e instanceof Error) {
				throw WebSearchError.classifyNetworkError(e, 'you');
			}
			throw WebSearchError.unknown(`You.com request failed: ${String(e)}`, 'you', e instanceof Error ? e : undefined);
		}

		if (!res.ok) {
			const classification = WebSearchError.classifyStatusCode(res.status, 'you');
			let message: string;
			switch (res.status) {
				case 401:
				case 403:
					message = 'You.com authentication failed. Please check your API key and ensure it has Web Search scope.';
					break;
				case 402:
					message = 'You.com account has insufficient credits. Please add credits to your account.';
					break;
				case 429:
					// Try to read response body to distinguish rate limit from spend cap
					message = 'You.com rate limit exceeded. Please try again later.';
					try {
						const body = await res.clone().json();
						const errorCode = body?.error?.code;
						const errorMessage = body?.error?.message?.toLowerCase() ?? '';
						if (errorCode === 'spend_cap_exceeded' || errorMessage.includes('spend cap')) {
							message = 'You.com spend cap exceeded. Please increase your spending limit or wait for reset.';
						}
					} catch {
						// Ignore JSON parse errors, use default message
					}
					break;
				case 400:
				case 422:
					message = 'You.com bad request or validation failed. Check query parameters.';
					break;
				case 500:
				case 502:
				case 503:
				case 504:
					message = 'You.com server error. Please try again later.';
					break;
				default:
					message = `You.com API responded with status ${res.status}.`;
			}
			if (classification.type === WebSearchErrorType.Transient) {
				throw WebSearchError.transient(message, 'you', res.status);
			} else {
				throw WebSearchError.configuration(message, 'you', res.status);
			}
		}

		let responseBody: unknown;
		try {
			responseBody = await res.json();
		} catch {
			throw WebSearchError.unknown('You.com API returned an invalid response.', 'you');
		}

		const results = this._getYouResults(responseBody);

		// Map results, filtering out invalid ones
		const mappedResults: SearchResult[] = [];
		for (const { item, isNews } of results) {
			const mapped = this.normalizeResult(item, mappedResults.length, isNews);
			if (mapped) {
				mappedResults.push(mapped);
			}
		}

		// Deduplicate by normalized URL
		const deduplicatedResults = this.deduplicateByUrl(mappedResults);

		// Enforce maxResults limit
		const finalResults = this.enforceMaxResults(deduplicatedResults, maxResults);

		return {
			results: finalResults,
			provider: 'you',
			query: request.query,
			totalResults: finalResults.length,
			responseTimeMs: Date.now() - startTime,
		};
	}

	private _getYouResults(body: unknown): { item: unknown; isNews: boolean }[] {
		// You.com response format: { results: { web: [...], news: [...] } }
		const youBody = body as { results?: { web?: unknown[]; news?: unknown[] } };
		const webResults = youBody?.results?.web ?? [];
		const newsResults = youBody?.results?.news ?? [];
		return [
			...webResults.map(item => ({ item, isNews: false })),
			...newsResults.map(item => ({ item, isNews: true })),
		];
	}

	/**
	 * Normalizes a raw You.com API result to the common SearchResult format.
	 * Returns null if the result should be filtered out.
	 */
	protected normalizeResult(item: unknown, index: number, isNews: boolean = false): SearchResult | null {
		const obj = item as {
			title?: unknown;
			url?: unknown;
			description?: unknown;
			snippet?: unknown;
			age?: unknown;
		};

		const rawTitle = typeof obj.title === 'string' ? obj.title.trim() : '';
		const rawUrl = typeof obj.url === 'string' ? obj.url.trim() : '';

		// Require a meaningful title
		if (rawTitle.length === 0) {
			return null;
		}

		// Require a valid HTTP/HTTPS URL
		if (!this.isValidHttpUrl(rawUrl)) {
			return null;
		}

		// Normalize URL (remove fragment, normalize case)
		const normalizedUrl = this.normalizeUrl(rawUrl);

		// You.com provides 'age' field:
		// - In results.news: may represent publication timestamp (ISO date string)
		// - In results.web: represents search-result age (relative like "2 hours ago")
		// Only populate publishedDate when it's a reliable ISO date from news results
		let publishedDate: string | undefined;
		if (isNews) {
			publishedDate = this.parsePublishedDate(obj.age);
		} else {
			// Web results: age is relative (e.g., "2 hours ago"), don't use as publication date
			publishedDate = undefined;
		}

		// Use description or snippet for snippet
		const snippet = typeof obj.description === 'string' && obj.description.trim().length > 0
			? obj.description.trim()
			: (typeof obj.snippet === 'string' ? obj.snippet.trim() : '');

		return {
			title: rawTitle,
			url: normalizedUrl,
			displayUrl: this.extractDomain(normalizedUrl),
			snippet,
			source: 'you',
			publishedDate,
			retrievalTimestamp: Date.now(),
		};
	}
}