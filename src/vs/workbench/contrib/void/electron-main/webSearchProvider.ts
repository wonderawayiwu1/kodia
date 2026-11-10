/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { SearchRequest, SearchResponse, SearchResult, SearchProviderSettings } from '../common/webSearchTypes.js';

/**
 * Abstract base class for web search providers.
 * Each provider implements this interface to provide search functionality
 * through the common IWebSearchService orchestrator.
 */
export abstract class WebSearchProvider {
	readonly abstract name: 'brave' | 'tavily' | 'exa' | 'you' | 'nvidia' | 'duckduckgo';
	readonly abstract requiresApiKey: boolean;
	readonly abstract maxResultsLimit: number;
	readonly abstract defaultTimeoutMs: number;

	/**
	 * Validates provider-specific settings.
	 * Called before search to ensure configuration is valid.
	 */
	abstract validateSettings(settings: SearchProviderSettings): { valid: boolean; errors: string[] };

	/**
	 * Tests the connection to the provider's API.
	 * Used by the "Test Connection" button in settings.
	 */
	abstract testConnection(settings: SearchProviderSettings): Promise<{ success: boolean; message: string }>;

	/**
	 * Performs the search request.
	 * Must return normalized SearchResult objects.
	 */
	abstract search(request: SearchRequest, settings: SearchProviderSettings): Promise<SearchResponse>;

	/**
	 * Normalizes a raw provider result to the common SearchResult format.
	 * Returns null if the result should be filtered out.
	 */
	protected abstract normalizeResult(item: unknown, index: number): SearchResult | null;

	/**
	 * Validates that a URL uses HTTP or HTTPS scheme.
	 */
	protected isValidHttpUrl(url: string): boolean {
		try {
			const parsed = new URL(url);
			return parsed.protocol === 'http:' || parsed.protocol === 'https:';
		} catch {
			return false;
		}
	}

	/**
	 * Normalizes a URL by removing fragments and normalizing case.
	 */
	protected normalizeUrl(url: string): string {
		try {
			const parsed = new URL(url);
			parsed.hash = '';
			parsed.protocol = parsed.protocol.toLowerCase();
			parsed.host = parsed.host.toLowerCase();
			return parsed.toString();
		} catch {
			return url;
		}
	}

	/**
	 * Extracts the domain from a URL for display purposes.
	 */
	protected extractDomain(url: string): string {
		try {
			const parsed = new URL(url);
			return parsed.hostname.replace(/^www\./, '');
		} catch {
			return url;
		}
	}

	/**
	 * Parses and normalizes a published date string.
	 * Only accepts ISO-like dates (YYYY-MM-DD) for consistency.
	 */
	protected parsePublishedDate(dateValue: unknown): string | undefined {
		if (typeof dateValue !== 'string') {
			return undefined;
		}
		const trimmed = dateValue.trim();
		if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
			return trimmed;
		}
		return undefined;
	}

	/**
	 * Deduplicates results by normalized URL, keeping the first occurrence.
	 */
	protected deduplicateByUrl(results: SearchResult[]): SearchResult[] {
		const seen = new Set<string>();
		const deduplicated: SearchResult[] = [];
		for (const result of results) {
			const normalizedUrl = this.normalizeUrl(result.url);
			if (!seen.has(normalizedUrl)) {
				seen.add(normalizedUrl);
				deduplicated.push({ ...result, url: normalizedUrl });
			}
		}
		return deduplicated;
	}

	/**
	 * Enforces the maxResults limit on the final results array.
	 */
	protected enforceMaxResults(results: SearchResult[], maxResults: number): SearchResult[] {
		return results.slice(0, maxResults);
	}
}