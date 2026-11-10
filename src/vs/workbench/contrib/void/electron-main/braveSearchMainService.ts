/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { IApplicationStorageMainService } from '../../../../platform/storage/electron-main/storageMainService.js';
import { IEncryptionMainService } from '../../../../platform/encryption/common/encryptionService.js';
import { SearchRequest, SearchResponse, SearchResult, SearchProviderSettings } from '../common/webSearchTypes.js';
import { WebSearchProvider } from './webSearchProvider.js';

const BRAVE_API_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';
const BRAVE_MAX_COUNT = 20;
const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Brave Search provider implementation.
 * Extends the shared WebSearchProvider base class.
 */
export class BraveSearchMainService extends WebSearchProvider {
	readonly name = 'brave' as const;
	readonly requiresApiKey = true;
	readonly maxResultsLimit = BRAVE_MAX_COUNT;
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
			errors.push('API key is required for Brave Search');
		}

		return { valid: errors.length === 0, errors };
	}

	async testConnection(settings: SearchProviderSettings): Promise<{ success: boolean; message: string }> {
		if (!settings.apiKey) {
			return { success: false, message: 'Brave Search API key is not configured.' };
		}

		try {
			const url = new URL(BRAVE_API_ENDPOINT);
			url.searchParams.set('q', 'test connection');
			url.searchParams.set('count', '1');
			url.searchParams.set('search_lang', 'en');
			url.searchParams.set('safesearch', 'moderate');

			const res = await fetch(url, {
				signal: AbortSignal.timeout(5000),
				headers: {
					'Accept': 'application/json',
					'X-Subscription-Token': settings.apiKey,
				},
			});

			if (!res.ok) {
				if (res.status === 401 || res.status === 403) {
					return { success: false, message: 'Brave Search authentication failed. Please check your API key.' };
				}
				return { success: false, message: `Brave Search API responded with status ${res.status}.` };
			}

			return { success: true, message: 'Brave Search connection successful!' };
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			if (errorMessage.includes('timeout') || errorMessage.includes('TimeoutError')) {
				return { success: false, message: 'Brave Search connection timed out.' };
			}
			return { success: false, message: `Brave Search connection failed: ${errorMessage}` };
		}
	}

	async search(request: SearchRequest, settings: SearchProviderSettings): Promise<SearchResponse> {
		const apiKey = settings.apiKey;
		if (!apiKey) {
			throw new Error('Brave Search API key is not configured.');
		}

		const maxResults = Math.min(Math.max(1, request.maxResults ?? settings.maxResults), BRAVE_MAX_COUNT);
		const timeoutMs = Math.min(Math.max(1000, settings.timeoutMs ?? DEFAULT_TIMEOUT_MS), 60000);

		const url = new URL(BRAVE_API_ENDPOINT);
		url.searchParams.set('q', request.query);
		url.searchParams.set('count', String(maxResults));
		url.searchParams.set('search_lang', 'en');
		url.searchParams.set('safesearch', 'moderate');

		const startTime = Date.now();
		let res: Response;
		try {
			res = await fetch(url, {
				signal: AbortSignal.timeout(timeoutMs),
				headers: {
					'Accept': 'application/json',
					'X-Subscription-Token': apiKey,
				},
			});
		} catch (e) {
			if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
				throw new Error(`Brave Search request timed out after ${timeoutMs / 1000}s.`);
			}
			throw new Error(`Brave Search request failed: ${e instanceof Error ? e.message : String(e)}`);
		}

		if (!res.ok) {
			throw new Error(`Brave Search API responded with status ${res.status}.`);
		}

		let body: unknown;
		try {
			body = await res.json();
		} catch {
			throw new Error('Brave Search API returned an invalid response.');
		}

		const webResults = this._getWebResults(body);

		// Map results, filtering out invalid ones (null returns from normalizeResult)
		const mappedResults: SearchResult[] = [];
		for (const item of webResults) {
			const mapped = this.normalizeResult(item, mappedResults.length);
			if (mapped) {
				mappedResults.push(mapped);
			}
		}

		// Deduplicate by normalized URL (keep first occurrence)
		const deduplicatedResults = this.deduplicateByUrl(mappedResults);

		// Enforce maxResults limit
		const finalResults = this.enforceMaxResults(deduplicatedResults, maxResults);

		return {
			results: finalResults,
			provider: 'brave',
			query: request.query,
			totalResults: finalResults.length,
			responseTimeMs: Date.now() - startTime,
		};
	}

	private _getWebResults(body: unknown): unknown[] {
		const web = (body as { web?: unknown })?.web;
		if (!web || typeof web !== 'object') {
			return [];
		}
		const results = (web as { results?: unknown }).results;
		return Array.isArray(results) ? results : [];
	}

	/**
	 * Normalizes a raw Brave API result to the common SearchResult format.
	 * Returns null if the result should be filtered out.
	 */
	protected normalizeResult(item: unknown, index: number): SearchResult | null {
		const obj = item as { title?: unknown; url?: unknown; snippet?: unknown; description?: unknown; page_age?: unknown };

		const rawTitle = typeof obj.title === 'string' ? obj.title.trim() : '';
		const rawUrl = typeof obj.url === 'string' ? obj.url.trim() : '';
		const rawSnippet = typeof obj.snippet === 'string' ? obj.snippet.trim()
			: (typeof obj.description === 'string' ? obj.description.trim() : '');

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

		// Parse and normalize publishedDate if available
		const publishedDate = this.parsePublishedDate(obj.page_age);

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
}