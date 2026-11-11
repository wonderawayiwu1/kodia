/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { IApplicationStorageMainService } from '../../../../platform/storage/electron-main/storageMainService.js';
import { IEncryptionMainService } from '../../../../platform/encryption/common/encryptionService.js';
import { SearchResult } from '../common/webSearchTypes.js';
import { StorageScope } from '../../../../platform/storage/common/storage.js';
import { VOID_SETTINGS_STORAGE_KEY } from '../common/storageKeys.js';

const NVIDIA_RERANK_ENDPOINT = 'https://ai.api.nvidia.com/v1/retrieval/nvidia/nemotron-3.5-rerank-8b/reranking';
const NVIDIA_RERANK_MODEL = 'nvidia/nemotron-3.5-rerank-8b';
const DEFAULT_MAX_PASSAGES = 20;
const DEFAULT_TIMEOUT_MS = 15000;

export interface RerankOptions {
	maxPassages?: number;
	timeoutMs?: number;
}

export interface NvidiaRerankerResult {
	reranked: SearchResult[];
	wasReranked: boolean;
}

/**
 * NVIDIA Nemotron-3.5-Rerank-8B reranking service.
 * Reorders existing search results using NVIDIA's reranking model.
 * Does NOT implement WebSearchProvider - this is a standalone post-processing service.
 */
export class NvidiaRerankerMainService {
	private readonly _storageService: IApplicationStorageMainService | undefined;
	private readonly _encryptionService: IEncryptionMainService | undefined;

	constructor(
		@IApplicationStorageMainService storageService?: IApplicationStorageMainService,
		@IEncryptionMainService encryptionService?: IEncryptionMainService,
	) {
		this._storageService = storageService;
		this._encryptionService = encryptionService;
	}

	// Allow tests to inject services after construction
	setStorageService(service: IApplicationStorageMainService): void {
		(this._storageService as any) = service;
	}

	setEncryptionService(service: IEncryptionMainService): void {
		(this._encryptionService as any) = service;
	}

	/**
	 * Reranks the given search results using NVIDIA's Nemotron-3.5-Rerank-8B model.
	 * Returns the original results unchanged if reranking fails or is unavailable.
	 * 
	 * @param query The search query
	 * @param results Normalized search results to rerank
	 * @param options Optional configuration (maxPassages, timeoutMs)
	 * @returns Reordered results, or original results if reranking fails
	 */
	async rerank(
		query: string,
		results: SearchResult[],
		options: RerankOptions = {}
	): Promise<SearchResult[]> {
		// Fail-open: return original results if nothing to rerank
		if (!results || results.length <= 1) {
			return results;
		}

		// Get NVIDIA API key from settings
		const apiKey = await this._getNvidiaApiKey();
		if (!apiKey) {
			return results; // No key configured, fail open
		}

		const maxPassages = Math.min(options.maxPassages ?? DEFAULT_MAX_PASSAGES, results.length);
		const timeoutMs = Math.min(Math.max(1000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS), 60000);

		// Build passages from results (title + snippet)
		const passages = results.slice(0, maxPassages).map((result, index) => {
			const title = result.title?.trim() ?? '';
			const snippet = result.snippet?.trim() ?? '';
			const text = title && snippet ? `${title}. ${snippet}` : (title || snippet);
			return { text };
		});

		// Filter out empty passages
		const validPassages = passages.filter(p => p.text.length > 0);
		if (validPassages.length <= 1) {
			return results; // Not enough content to rerank
		}

		const requestBody = {
			model: NVIDIA_RERANK_MODEL,
			query: { text: query },
			passages: validPassages,
			truncate: 'END' as const,
		};

		try {
			const response = await fetch(NVIDIA_RERANK_ENDPOINT, {
				signal: AbortSignal.timeout(timeoutMs),
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${apiKey}`,
				},
				body: JSON.stringify(requestBody),
			});

			if (!response.ok) {
				// Log but don't expose details; fail open
				console.warn(`[NvidiaReranker] API error: ${response.status} ${response.statusText}`);
				return results;
			}

			const data = await response.json();
			const rerankedResults = this._applyRankings(results, validPassages.length, data);
			return rerankedResults;
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') {
				// Timeout or cancellation - preserve original results
				return results;
			}
			if (error instanceof DOMException && error.name === 'TimeoutError') {
				console.warn('[NvidiaReranker] Request timeout');
				return results;
			}
			console.warn('[NvidiaReranker] Request failed:', error instanceof Error ? error.message : String(error));
			return results;
		}
	}

	/**
	 * Retrieves the NVIDIA API key from the LLM provider settings.
	 * The key is stored in the main process encrypted settings under the NVIDIA LLM provider.
	 */
	private async _getNvidiaApiKey(): Promise<string | undefined> {
		if (!this._storageService || !this._encryptionService) {
			return undefined;
		}

		try {
			const encrypted = this._storageService.get(VOID_SETTINGS_STORAGE_KEY, StorageScope.APPLICATION);
			if (!encrypted) {
				return undefined;
			}

			const decrypted = await this._encryptionService.decrypt(encrypted);
			const state = JSON.parse(decrypted);

			// First check LLM provider settings (nvidia.apiKey)
			const llmApiKey = state.settingsOfProvider?.nvidia?.apiKey;
			if (llmApiKey && llmApiKey.trim().length > 0) {
				return llmApiKey.trim();
			}

			// Fallback: check web search provider settings (though it's intentionally undefined)
			const webSearchApiKey = state.globalSettings?.webSearchProviders?.nvidia?.apiKey;
			if (webSearchApiKey && webSearchApiKey.trim().length > 0) {
				return webSearchApiKey.trim();
			}

			return undefined;
		} catch (error) {
			console.warn('[NvidiaReranker] Failed to retrieve NVIDIA API key:', error instanceof Error ? error.message : String(error));
			return undefined;
		}
	}

	/**
	 * Applies NVIDIA rankings to the original results.
	 * Validates rankings before applying to ensure result integrity.
	 */
	private _applyRankings(
		originalResults: SearchResult[],
		submittedPassageCount: number,
		responseData: unknown
	): SearchResult[] {
		// Validate response structure
		const response = responseData as { rankings?: unknown[] };
		const rankings = response?.rankings;

		if (!Array.isArray(rankings) || rankings.length === 0) {
			console.warn('[NvidiaReranker] Invalid or empty rankings response');
			return originalResults;
		}

		// Validate each ranking entry
		const validatedRankings: { index: number; logit: number }[] = [];
		const seenIndices = new Set<number>();

		for (const entry of rankings) {
			const obj = entry as { index?: unknown; logit?: unknown };

			// Validate index
			if (typeof obj.index !== 'number' || !Number.isInteger(obj.index)) {
				console.warn('[NvidiaReranker] Invalid index in rankings, skipping entry');
				continue;
			}

			// Validate index range
			if (obj.index < 0 || obj.index >= submittedPassageCount) {
				console.warn('[NvidiaReranker] Index out of range, skipping entry');
				continue;
			}

			// Validate no duplicate indices
			if (seenIndices.has(obj.index)) {
				console.warn('[NvidiaReranker] Duplicate index in rankings, skipping entry');
				continue;
			}

			// Validate logit
			if (typeof obj.logit !== 'number' || !Number.isFinite(obj.logit)) {
				console.warn('[NvidiaReranker] Invalid logit in rankings, skipping entry');
				continue;
			}

			seenIndices.add(obj.index);
			validatedRankings.push({ index: obj.index, logit: obj.logit });
		}

		if (validatedRankings.length === 0) {
			console.warn('[NvidiaReranker] No valid rankings after validation');
			return originalResults;
		}

		// Map rankings back to original results
		const reranked: SearchResult[] = [];
		const usedIndices = new Set<number>();

		// Add reranked results in order
		for (const { index } of validatedRankings) {
			const result = originalResults[index];
			if (result) {
				reranked.push(result);
				usedIndices.add(index);
			}
		}

		// Append any results that were not included in the reranking (beyond maxPassages)
		// or not returned by the ranker, preserving their original order
		for (let i = 0; i < originalResults.length; i++) {
			if (!usedIndices.has(i)) {
				reranked.push(originalResults[i]);
			}
		}

		return reranked;
	}
}