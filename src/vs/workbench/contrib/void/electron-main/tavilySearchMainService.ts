/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { IApplicationStorageMainService } from '../../../../platform/storage/electron-main/storageMainService.js';
import { IEncryptionMainService } from '../../../../platform/encryption/common/encryptionService.js';
import { SearchRequest, SearchResponse, SearchResult, SearchProviderSettings } from '../common/webSearchTypes.js';
import { WebSearchProvider } from './webSearchProvider.js';
import { WebSearchError, WebSearchErrorType } from './webSearchErrors.js';

const TAVILY_API_ENDPOINT = 'https://api.tavily.com/search';
const TAVILY_MAX_COUNT = 20;
const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Tavily Search provider implementation.
 * API docs: https://docs.tavily.com/
 * Endpoint: POST https://api.tavily.com/search
 * Auth: Authorization: Bearer <api_key>
 */
export class TavilySearchMainService extends WebSearchProvider {
	readonly name = 'tavily' as const;
	readonly requiresApiKey = true;
	readonly maxResultsLimit = TAVILY_MAX_COUNT;
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
			errors.push('API key is required for Tavily');
		}

		return { valid: errors.length === 0, errors };
	}

	async testConnection(settings: SearchProviderSettings): Promise<{ success: boolean; message: string }> {
		if (!settings.apiKey) {
			return { success: false, message: 'Tavily API key is not configured.' };
		}

		try {
			const res = await fetch(TAVILY_API_ENDPOINT, {
				signal: AbortSignal.timeout(5000),
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${settings.apiKey}`,
				},
				body: JSON.stringify({
					query: 'test connection',
					max_results: 1,
					search_depth: 'basic',
				}),
			});

			if (!res.ok) {
				if (res.status === 401 || res.status === 403) {
					return { success: false, message: 'Tavily authentication failed. Please check your API key.' };
				}
				if (res.status === 432 || res.status === 433) {
					return { success: false, message: 'Tavily plan/usage limit exceeded. Please check your Tavily plan.' };
				}
				if (res.status === 434) {
					return { success: false, message: 'Tavily flex tier capacity exceeded. Retry shortly or omit freshness controls.' };
				}
				if (res.status === 429) {
					return { success: false, message: 'Tavily rate limit exceeded. Please try again later.' };
				}
				return { success: false, message: `Tavily API responded with status ${res.status}.` };
			}

			return { success: true, message: 'Tavily connection successful!' };
		} catch (error) {
			const webSearchError = error instanceof WebSearchError ? error : WebSearchError.classifyNetworkError(error instanceof Error ? error : new Error(String(error)), 'tavily');
			return { success: false, message: webSearchError.message };
		}
	}

	async search(request: SearchRequest, settings: SearchProviderSettings): Promise<SearchResponse> {
		const apiKey = settings.apiKey;
		if (!apiKey) {
			throw WebSearchError.configuration('Tavily API key is not configured.', 'tavily');
		}

		const maxResults = Math.min(Math.max(1, request.maxResults ?? settings.maxResults), TAVILY_MAX_COUNT);
		const timeoutMs = Math.min(Math.max(1000, settings.timeoutMs ?? DEFAULT_TIMEOUT_MS), 60000);

		const body = {
			query: request.query,
			max_results: maxResults,
			search_depth: 'basic', // 'basic' or 'advanced'
			include_answer: false,
			include_raw_content: false,
			include_images: false,
		};

		const startTime = Date.now();
		let res: Response;
		try {
			res = await fetch(TAVILY_API_ENDPOINT, {
				signal: AbortSignal.timeout(timeoutMs),
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${apiKey}`,
				},
				body: JSON.stringify(body),
			});
		} catch (e) {
			if (e instanceof Error) {
				throw WebSearchError.classifyNetworkError(e, 'tavily');
			}
			throw WebSearchError.unknown(`Tavily request failed: ${String(e)}`, 'tavily', e instanceof Error ? e : undefined);
		}

		if (!res.ok) {
			const classification = WebSearchError.classifyStatusCode(res.status, 'tavily');
			let message: string;
			switch (res.status) {
				case 401:
				case 403:
					message = 'Tavily authentication failed. Please check your API key.';
					break;
				case 429:
					message = 'Tavily rate limit exceeded. Please try again later.';
					break;
				case 400:
					message = 'Tavily bad request. Check query parameters.';
					break;
				case 422:
					message = 'Tavily request validation failed.';
					break;
				case 432:
				case 433:
				case 434:
					message = 'Tavily plan/usage limit exceeded.';
					break;
				default:
					message = `Tavily API responded with status ${res.status}.`;
			}
			if (classification.type === WebSearchErrorType.Transient) {
				throw WebSearchError.transient(message, 'tavily', res.status);
			} else {
				throw WebSearchError.configuration(message, 'tavily', res.status);
			}
		}

		let responseBody: unknown;
		try {
			responseBody = await res.json();
		} catch {
			throw WebSearchError.unknown('Tavily API returned an invalid response.', 'tavily');
		}

		const results = this._getTavilyResults(responseBody);

		// Map results, filtering out invalid ones
		const mappedResults: SearchResult[] = [];
		for (const item of results) {
			const mapped = this.normalizeResult(item, mappedResults.length);
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
			provider: 'tavily',
			query: request.query,
			totalResults: finalResults.length,
			responseTimeMs: Date.now() - startTime,
		};
	}

	private _getTavilyResults(body: unknown): unknown[] {
		// Tavily response format: { results: [...], answer?, response_time, usage?, request_id }
		const tavilyBody = body as { results?: unknown };
		const results = tavilyBody?.results;
		return Array.isArray(results) ? results : [];
	}

	/**
	 * Normalizes a raw Tavily API result to the common SearchResult format.
	 * Returns null if the result should be filtered out.
	 */
	protected normalizeResult(item: unknown, index: number): SearchResult | null {
		const obj = item as {
			title?: unknown;
			url?: unknown;
			content?: unknown; // Tavily uses 'content' for snippet/description
			score?: unknown;
			raw_content?: unknown;
		};

		const rawTitle = typeof obj.title === 'string' ? obj.title.trim() : '';
		const rawUrl = typeof obj.url === 'string' ? obj.url.trim() : '';
		const rawSnippet = typeof obj.content === 'string' ? obj.content.trim() : '';

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

		// Extract domain for displayUrl
		const displayUrl = this.extractDomain(normalizedUrl);

		// Tavily doesn't provide publishedDate in basic search results
		const publishedDate = undefined;

		return {
			title: rawTitle,
			url: normalizedUrl,
			displayUrl,
			snippet: rawSnippet,
			source: 'tavily',
			publishedDate,
			retrievalTimestamp: Date.now(),
		};
	}
}