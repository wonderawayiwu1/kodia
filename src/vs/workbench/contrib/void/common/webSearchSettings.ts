/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { SearchProviderSettings, WebSearchProviderName } from './webSearchTypes.js';

/**
 * Default settings for each web search provider.
 * These are used when a provider is first enabled.
 */
export const DEFAULT_SEARCH_PROVIDER_SETTINGS: Record<WebSearchProviderName, SearchProviderSettings> = {
	brave: {
		apiKey: undefined,
		enabled: false,
		priority: 0,
		maxResults: 10,
		timeoutMs: 15000,
	},
	tavily: {
		apiKey: undefined,
		enabled: false,
		priority: 1,
		maxResults: 10,
		timeoutMs: 15000,
	},
	exa: {
		apiKey: undefined,
		enabled: false,
		priority: 2,
		maxResults: 10,
		timeoutMs: 15000,
	},
	you: {
		apiKey: undefined,
		enabled: false,
		priority: 3,
		maxResults: 10,
		timeoutMs: 15000,
	},
	nvidia: {
		// NVIDIA uses the existing NVIDIA LLM provider's API key
		// This is intentionally left undefined - it reads from the NVIDIA LLM provider settings
		apiKey: undefined,
		enabled: false,
		priority: 4,
		maxResults: 10,
		timeoutMs: 15000,
	},
	duckduckgo: {
		// DuckDuckGo Instant Answer API requires no API key
		apiKey: undefined,
		enabled: false,
		priority: 5,
		maxResults: 10,
		timeoutMs: 15000,
	},
};

/**
 * Default global web search settings
 */
export const DEFAULT_WEB_SEARCH_GLOBAL_SETTINGS = {
	webSearchFreeOnly: true,
	webSearchRerankerEnabled: false,
	webSearchRerankerMaxPassages: 20,
};

/**
 * Provider display information for UI
 */
export const SEARCH_PROVIDER_DISPLAY_INFO: Record<WebSearchProviderName, {
	title: string;
	description: string;
	docsUrl: string;
	requiresApiKey: boolean;
}> = {
	brave: {
		title: 'Brave Search',
		description: 'Privacy-focused search engine with independent index.',
		docsUrl: 'https://api.search.brave.com/app/documentation/web-search/get-started',
		requiresApiKey: true,
	},
	tavily: {
		title: 'Tavily',
		description: 'Search engine optimized for AI agents and RAG.',
		docsUrl: 'https://docs.tavily.com/',
		requiresApiKey: true,
	},
	exa: {
		title: 'Exa',
		description: 'Neural search engine for deep research.',
		docsUrl: 'https://docs.exa.ai/',
		requiresApiKey: true,
	},
	you: {
		title: 'You.com',
		description: 'AI-powered search with summarization.',
		docsUrl: 'https://docs.you.com/',
		requiresApiKey: true,
	},
	nvidia: {
		title: 'NVIDIA NeMo Retriever',
		description: 'Embedding and reranking models. Reuses your NVIDIA API key.',
		docsUrl: 'https://build.nvidia.com/',
		requiresApiKey: false, // Reuses existing NVIDIA LLM key
	},
	duckduckgo: {
		title: 'DuckDuckGo Instant Answer',
		description: 'Free instant answers. No API key required.',
		docsUrl: 'https://duckduckgo.com/api',
		requiresApiKey: false,
	},
};

/**
 * Validates search provider settings
 */
export function validateSearchProviderSettings(
	providerName: WebSearchProviderName,
	settings: Partial<SearchProviderSettings>
): { valid: boolean; errors: string[] } {
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

	// Provider-specific validation
	if (providerName !== 'duckduckgo' && providerName !== 'nvidia') {
		if (settings.enabled && (!settings.apiKey || settings.apiKey.trim() === '')) {
			errors.push('API key is required for this provider');
		}
	}

	// NVIDIA key is managed by the NVIDIA LLM provider
	if (providerName === 'nvidia' && settings.apiKey && settings.apiKey.trim() !== '') {
		// Warning: NVIDIA key is managed by the NVIDIA LLM provider settings
		// This is just a warning, not an error
	}

	return { valid: errors.length === 0, errors };
}

/**
 * Returns default settings for a provider
 */
export function getDefaultSearchProviderSettings(
	providerName: WebSearchProviderName
): SearchProviderSettings {
	return { ...DEFAULT_SEARCH_PROVIDER_SETTINGS[providerName] };
}

/**
 * Returns all default search provider settings
 */
export function getAllDefaultSearchProviderSettings(): Record<WebSearchProviderName, SearchProviderSettings> {
	return { ...DEFAULT_SEARCH_PROVIDER_SETTINGS };
}

/**
 * Validates and normalizes search provider settings
 */
export function normalizeSearchProviderSettings(
	providerName: WebSearchProviderName,
	settings: SearchProviderSettings
): SearchProviderSettings {
	const defaults = getDefaultSearchProviderSettings(providerName);

	return {
		apiKey: settings.apiKey?.trim() || undefined,
		enabled: settings.enabled ?? defaults.enabled,
		priority: typeof settings.priority === 'number' ? Math.max(0, Math.min(10, settings.priority)) : defaults.priority,
		maxResults: typeof settings.maxResults === 'number' ? Math.max(1, Math.min(50, settings.maxResults)) : defaults.maxResults,
		timeoutMs: typeof settings.timeoutMs === 'number' ? Math.max(1000, Math.min(60000, settings.timeoutMs)) : defaults.timeoutMs,
	};
}

/**
 * Validates NVIDIA reranker settings
 */
export function validateNvidiaRerankerSettings(settings: {
	webSearchRerankerEnabled?: boolean;
	webSearchRerankerMaxPassages?: number;
}): { valid: boolean; errors: string[] } {
	const errors: string[] = [];

	if (typeof settings.webSearchRerankerEnabled !== 'boolean' && settings.webSearchRerankerEnabled !== undefined) {
		errors.push('webSearchRerankerEnabled must be a boolean');
	}

	if (typeof settings.webSearchRerankerMaxPassages === 'number') {
		if (settings.webSearchRerankerMaxPassages < 1 || settings.webSearchRerankerMaxPassages > 100) {
			errors.push('webSearchRerankerMaxPassages must be between 1 and 100');
		}
	} else if (settings.webSearchRerankerMaxPassages !== undefined) {
		errors.push('webSearchRerankerMaxPassages must be a number');
	}

	return { valid: errors.length === 0, errors };
}

/**
 * Returns default NVIDIA reranker settings
 */
export function getDefaultNvidiaRerankerSettings(): {
	webSearchRerankerEnabled: boolean;
	webSearchRerankerMaxPassages: number;
} {
	return {
		webSearchRerankerEnabled: false,
		webSearchRerankerMaxPassages: 20,
	};
}

/**
 * Validates and normalizes NVIDIA reranker settings
 */
export function normalizeNvidiaRerankerSettings(settings: {
	webSearchRerankerEnabled?: boolean;
	webSearchRerankerMaxPassages?: number;
}): {
	webSearchRerankerEnabled: boolean;
	webSearchRerankerMaxPassages: number;
} {
	const defaults = getDefaultNvidiaRerankerSettings();

	return {
		webSearchRerankerEnabled: settings.webSearchRerankerEnabled ?? defaults.webSearchRerankerEnabled,
		webSearchRerankerMaxPassages: typeof settings.webSearchRerankerMaxPassages === 'number'
			? Math.max(1, Math.min(100, settings.webSearchRerankerMaxPassages))
			: defaults.webSearchRerankerMaxPassages,
	};
}
