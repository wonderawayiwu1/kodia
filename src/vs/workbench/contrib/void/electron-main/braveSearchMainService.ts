/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { StorageScope } from '../../../../platform/storage/common/storage.js';
import { IApplicationStorageMainService } from '../../../../platform/storage/electron-main/storageMainService.js';
import { IEncryptionMainService } from '../../../../platform/encryption/common/encryptionService.js';
import { IWebSearchService, SearchRequest, SearchResponse, SearchResult } from '../common/webSearchTypes.js';
import { VOID_SETTINGS_STORAGE_KEY } from '../common/storageKeys.js';

const BRAVE_API_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';
const BRAVE_MAX_COUNT = 20;
const DEFAULT_TIMEOUT_MS = 15000;

interface StoredWebSearchProviderSettings {
	apiKey?: string;
	enabled: boolean;
	priority: number;
	maxResults: number;
	timeoutMs: number;
}

interface StoredGlobalSettings {
	webSearchProviders: Record<string, StoredWebSearchProviderSettings>;
}

interface StoredVoidSettings {
	globalSettings?: StoredGlobalSettings;
}

export class BraveSearchMainService implements IWebSearchService {
	_serviceBrand: undefined;

	constructor(
		@IApplicationStorageMainService private readonly _storageService: IApplicationStorageMainService,
		@IEncryptionMainService private readonly _encryptionService: IEncryptionMainService,
	) {
	}

	async search(request: SearchRequest): Promise<SearchResponse> {
		this._validateRequest(request);

		const settings = await this._readBraveSettings();
		const apiKey = settings.apiKey;
		if (!apiKey) {
			throw new Error('Brave Search API key is not configured. Please add it in Kodia Settings.');
		}

		if (!settings.enabled) {
			throw new Error('Brave Search is disabled. Enable it in Kodia Settings.');
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
		const results: SearchResult[] = webResults.map((item: unknown, index: number) => this._mapResult(item));

		return {
			results,
			provider: 'brave',
			query: request.query,
			totalResults: results.length,
			responseTimeMs: Date.now() - startTime,
		};
	}

	private async _readBraveSettings(): Promise<StoredWebSearchProviderSettings> {
		const encrypted = this._storageService.get(VOID_SETTINGS_STORAGE_KEY, StorageScope.APPLICATION);
		if (!encrypted) {
			return { enabled: false, priority: 0, maxResults: 10, timeoutMs: DEFAULT_TIMEOUT_MS };
		}

		const decrypted = await this._encryptionService.decrypt(encrypted);
		let state: StoredVoidSettings;
		try {
			state = JSON.parse(decrypted);
		} catch {
			return { enabled: false, priority: 0, maxResults: 10, timeoutMs: DEFAULT_TIMEOUT_MS };
		}
		return state.globalSettings?.webSearchProviders?.brave ?? {
			enabled: false,
			priority: 0,
			maxResults: 10,
			timeoutMs: DEFAULT_TIMEOUT_MS,
		};
	}

	private _validateRequest(request: SearchRequest): void {
		if (typeof request.query !== 'string' || request.query.trim().length === 0) {
			throw new Error('Search query is required.');
		}
		if (request.maxResults !== undefined && (typeof request.maxResults !== 'number' || request.maxResults < 1 || request.maxResults > 50)) {
			throw new Error('maxResults must be between 1 and 50.');
		}
	}

	private _getWebResults(body: unknown): unknown[] {
		const web = (body as { web?: unknown })?.web;
		if (!web || typeof web !== 'object') {
			return [];
		}
		const results = (web as { results?: unknown }).results;
		return Array.isArray(results) ? results : [];
	}

	private _mapResult(item: unknown): SearchResult {
		const obj = item as { title?: unknown; url?: unknown; snippet?: unknown; description?: unknown; page_age?: unknown };
		const url = typeof obj.url === 'string' ? obj.url : '';
		return {
			title: typeof obj.title === 'string' ? obj.title : '',
			url,
			displayUrl: url,
			snippet: typeof obj.snippet === 'string' ? obj.snippet : (typeof obj.description === 'string' ? obj.description : ''),
			source: 'brave',
			publishedDate: typeof obj.page_age === 'string' ? obj.page_age : undefined,
			retrievalTimestamp: Date.now(),
		};
	}
}
