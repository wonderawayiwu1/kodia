/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { IApplicationStorageMainService } from '../../../../platform/storage/electron-main/storageMainService.js';
import { IEncryptionMainService } from '../../../../platform/encryption/common/encryptionService.js';
import { SearchRequest, SearchResponse, SearchResult, SearchProviderSettings } from '../common/webSearchTypes.js';
import { WebSearchProvider } from './webSearchProvider.js';
import { WebSearchError, WebSearchErrorType } from './webSearchErrors.js';

const EXA_API_ENDPOINT = 'https://api.exa.ai/search';
const EXA_MAX_COUNT = 100;
const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Exa Search provider implementation.
 * API docs: https://docs.exa.ai/reference/search
 * Endpoint: POST https://api.exa.ai/search
 * Auth: x-api-key or Authorization: Bearer <api_key>
 */
export class ExaSearchMainService extends WebSearchProvider {
	readonly name = 'exa' as const;
	readonly requiresApiKey = true;
	readonly maxResultsLimit = EXA_MAX_COUNT;
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
			errors.push('API key is required for Exa');
		}

		return { valid: errors.length === 0, errors };
	}

	async testConnection(settings: SearchProviderSettings): Promise<{ success: boolean; message: string }> {
		if (!settings.apiKey) {
			return { success: false, message: 'Exa API key is not configured.' };
		}

		try {
			const res = await fetch(EXA_API_ENDPOINT, {
				signal: AbortSignal.timeout(5000),
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-api-key': settings.apiKey,
				},
				body: JSON.stringify({
					query: 'test connection',
					numResults: 1,
				}),
			});

			if (!res.ok) {
				if (res.status === 401 || res.status === 403) {
					return { success: false, message: 'Exa authentication failed. Please check your API key.' };
				}
				if (res.status === 429) {
					return { success: false, message: 'Exa rate limit exceeded. Please try again later.' };
				}
				if (res.status >= 500) {
					return { success: false, message: `Exa server error (${res.status}). Please try again later.` };
				}
				return { success: false, message: `Exa API responded with status ${res.status}.` };
			}

			return { success: true, message: 'Exa connection successful!' };
		} catch (error) {
			const webSearchError = error instanceof WebSearchError ? error : WebSearchError.classifyNetworkError(error instanceof Error ? error : new Error(String(error)), 'exa');
			return { success: false, message: webSearchError.message };
		}
	}

	async search(request: SearchRequest, settings: SearchProviderSettings): Promise<SearchResponse> {
		const apiKey = settings.apiKey;
		if (!apiKey) {
			throw WebSearchError.configuration('Exa API key is not configured.', 'exa');
		}

		const maxResults = Math.min(Math.max(1, request.maxResults ?? settings.maxResults), EXA_MAX_COUNT);
		const timeoutMs = Math.min(Math.max(1000, settings.timeoutMs ?? DEFAULT_TIMEOUT_MS), 60000);

		const body = {
			query: request.query,
			numResults: maxResults,
			contents: {
				text: false,
				highlights: true,
			},
		};

		const startTime = Date.now();
		let res: Response;
		try {
			res = await fetch(EXA_API_ENDPOINT, {
				signal: AbortSignal.timeout(timeoutMs),
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-api-key': apiKey,
				},
				body: JSON.stringify(body),
			});
		} catch (e) {
			if (e instanceof Error) {
				throw WebSearchError.classifyNetworkError(e, 'exa');
			}
			throw WebSearchError.unknown(`Exa request failed: ${String(e)}`, 'exa', e instanceof Error ? e : undefined);
		}

		if (!res.ok) {
			const classification = WebSearchError.classifyStatusCode(res.status, 'exa');
			let message: string;
			switch (res.status) {
				case 401:
				case 403:
					message = 'Exa authentication failed. Please check your API key.';
					break;
				case 429:
					message = 'Exa rate limit exceeded. Please try again later.';
					break;
				case 400:
					message = 'Exa bad request. Check query parameters.';
					break;
				case 422:
					message = 'Exa request validation failed.';
					break;
				case 500:
				case 502:
				case 503:
				case 504:
					message = 'Exa server error. Please try again later.';
					break;
				default:
					message = `Exa API responded with status ${res.status}.`;
			}
			if (classification.type === WebSearchErrorType.Transient) {
				throw WebSearchError.transient(message, 'exa', res.status);
			} else {
				throw WebSearchError.configuration(message, 'exa', res.status);
			}
		}

		let responseBody: unknown;
		try {
			responseBody = await res.json();
		} catch {
			throw WebSearchError.unknown('Exa API returned an invalid response.', 'exa');
		}

		const results = this._getExaResults(responseBody);

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
			provider: 'exa',
			query: request.query,
			totalResults: finalResults.length,
			responseTimeMs: Date.now() - startTime,
		};
	}

	private _getExaResults(body: unknown): unknown[] {
		// Exa response format: { results: [...], requestId?, autopromptString?, costDollars? }
		const exaBody = body as { results?: unknown };
		const results = exaBody?.results;
		return Array.isArray(results) ? results : [];
	}

	/**
	 * Normalizes a raw Exa API result to the common SearchResult format.
	 * Returns null if the result should be filtered out.
	 */
	protected normalizeResult(item: unknown, index: number): SearchResult | null {
		const obj = item as {
			title?: unknown;
			url?: unknown;
			publishedDate?: unknown;
			text?: unknown;
			highlights?: unknown;
			summary?: unknown;
			score?: unknown;
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

		// Parse and normalize publishedDate if available
		const publishedDate = this.parsePublishedDate(obj.publishedDate);

		// Use highlights if available and no text content
		const snippet = typeof obj.text === 'string' && obj.text.trim().length > 0
			? obj.text.trim()
			: (typeof obj.highlights === 'object' && obj.highlights !== null && Array.isArray((obj.highlights as any[])[0])
				? (obj.highlights as string[]).join(' ')
				: (typeof obj.summary === 'string' ? obj.summary.trim() : ''));

		return {
			title: rawTitle,
			url: normalizedUrl,
			displayUrl: this.extractDomain(normalizedUrl),
			snippet,
			source: 'exa',
			publishedDate,
			retrievalTimestamp: Date.now(),
		};
	}
}