/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

/**
 * Web Search Provider Types
 *
 * This file contains the single authoritative definition of all web search related types.
 * These types are shared between the main process, renderer, and common code.
 */

// Provider names for web search (separate from LLM ProviderName)
export type WebSearchProviderName = 'brave' | 'tavily' | 'exa' | 'you' | 'nvidia' | 'duckduckgo';

// Search strategy options
export type SearchStrategy = 'fast' | 'balanced' | 'deep';

// Filters that can be applied to search requests
export interface SearchFilters {
	timeRange?: 'day' | 'week' | 'month' | 'year';
	domains?: string[];
	excludeDomains?: string[];
	safeSearch?: boolean;
}

// Search request sent to providers
export interface SearchRequest {
	query: string;
	maxResults?: number;
	filters?: SearchFilters;
	strategy?: SearchStrategy;
}

// Individual search result from a provider
export interface SearchResult {
	title: string;
	url: string;
	displayUrl: string;
	snippet: string;
	source: string; // provider name
	publishedDate?: string;
	score?: number;
	favicon?: string;
	imageUrl?: string;
	retrievalTimestamp: number;
}

// Search response from a provider
export interface SearchResponse {
	results: SearchResult[];
	provider: WebSearchProviderName;
	query: string;
	totalResults?: number;
	responseTimeMs: number;
}

// Service identifier for the main-process web search service.
// Implemented in electron-main; never exposes or transmits API keys.
export const IWebSearchService = createDecorator<IWebSearchService>('webSearchService');
export interface IWebSearchService {
	readonly _serviceBrand: undefined;
	search(request: SearchRequest): Promise<SearchResponse>;
	testProviderConnection(providerName: WebSearchProviderName): Promise<{ success: boolean; message: string }>;
}

// Settings for a single web search provider
export interface SearchProviderSettings {
	apiKey?: string;           // encrypted at rest; undefined for DDG
	enabled: boolean;          // default: false
	priority: number;          // drag-drop order (0 = highest priority)
	maxResults: number;        // default: 10
	timeoutMs: number;         // default: 15000
}
