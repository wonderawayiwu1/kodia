/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { StorageScope } from '../../../../platform/storage/common/storage.js';
import { IApplicationStorageMainService } from '../../../../platform/storage/electron-main/storageMainService.js';
import { IEncryptionMainService } from '../../../../platform/encryption/common/encryptionService.js';
import { IWebSearchService, SearchRequest, SearchResponse, SearchProviderSettings, WebSearchProviderName } from '../common/webSearchTypes.js';
import { VOID_SETTINGS_STORAGE_KEY } from '../common/storageKeys.js';
import { WebSearchProvider } from './webSearchProvider.js';
import { BraveSearchMainService } from './braveSearchMainService.js';
import { TavilySearchMainService } from './tavilySearchMainService.js';
import { ExaSearchMainService } from './exaSearchMainService.js';
import { WebSearchError, WebSearchErrorType } from './webSearchErrors.js';

const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Orchestrator for web search providers.
 * Manages provider priority, fallback, and selection logic.
 * Implements IWebSearchService to maintain backward compatibility.
 */
export class WebSearchMainService implements IWebSearchService {
	_serviceBrand: undefined;

	private readonly providers: Map<WebSearchProviderName, WebSearchProvider> = new Map();
	private readonly providerNames: WebSearchProviderName[] = [
		'brave',
		'tavily',
		'exa',
		'you',
		'nvidia',
		'duckduckgo',
	];

	private _initialized = false;

	constructor(
		@IApplicationStorageMainService private readonly _storageService: IApplicationStorageMainService,
		@IEncryptionMainService private readonly _encryptionService: IEncryptionMainService,
	) {
		// Providers will be initialized lazily on first search
	}

	private _ensureInitialized(): void {
		if (this._initialized) {
			return;
		}
		this.registerProvider(new BraveSearchMainService(this._storageService, this._encryptionService));
		this.registerProvider(new TavilySearchMainService(this._storageService, this._encryptionService));
		this.registerProvider(new ExaSearchMainService(this._storageService, this._encryptionService));
		// Other providers will be registered as they are implemented
		this._initialized = true;
	}

	/**
	 * Registers a search provider.
	 * Called during initialization for built-in providers.
	 */
	registerProvider(provider: WebSearchProvider): void {
		this.providers.set(provider.name, provider);
	}

	/**
	 * Gets all registered provider names.
	 */
	getRegisteredProviders(): WebSearchProviderName[] {
		return [...this.providers.keys()];
	}

	/**
	 * Reads all provider settings from encrypted storage.
	 */
	private async _readAllProviderSettings(): Promise<Record<WebSearchProviderName, SearchProviderSettings>> {
		const encrypted = this._storageService.get(VOID_SETTINGS_STORAGE_KEY, StorageScope.APPLICATION);
		if (!encrypted) {
			return this._getDefaultSettings();
		}

		const decrypted = await this._encryptionService.decrypt(encrypted);
		let state: { globalSettings?: { webSearchProviders?: Record<WebSearchProviderName, SearchProviderSettings> } };
		try {
			state = JSON.parse(decrypted);
		} catch {
			return this._getDefaultSettings();
		}

		const settings = (state.globalSettings?.webSearchProviders ?? {}) as Record<WebSearchProviderName, SearchProviderSettings>;
		const defaults = this._getDefaultSettings();

		// Merge with defaults for any missing providers
		const result: Record<WebSearchProviderName, SearchProviderSettings> = {} as Record<WebSearchProviderName, SearchProviderSettings>;
		for (const name of this.providerNames) {
			result[name] = {
				...defaults[name],
				...settings[name],
			};
		}
		return result;
	}

	private _getDefaultSettings(): Record<WebSearchProviderName, SearchProviderSettings> {
		return {
			brave: { enabled: false, priority: 0, maxResults: 10, timeoutMs: DEFAULT_TIMEOUT_MS },
			tavily: { enabled: false, priority: 1, maxResults: 10, timeoutMs: DEFAULT_TIMEOUT_MS },
			exa: { enabled: false, priority: 2, maxResults: 10, timeoutMs: DEFAULT_TIMEOUT_MS },
			you: { enabled: false, priority: 3, maxResults: 10, timeoutMs: DEFAULT_TIMEOUT_MS },
			nvidia: { enabled: false, priority: 4, maxResults: 10, timeoutMs: DEFAULT_TIMEOUT_MS },
			duckduckgo: { enabled: false, priority: 5, maxResults: 10, timeoutMs: DEFAULT_TIMEOUT_MS },
		};
	}

	/**
	 * Gets enabled providers sorted by priority (lowest priority number = highest priority).
	 */
	private async _getEnabledProvidersSorted(): Promise<{ name: WebSearchProviderName; provider: WebSearchProvider; settings: SearchProviderSettings }[]> {
		this._ensureInitialized();
		const allSettings = await this._readAllProviderSettings();
		const enabled: { name: WebSearchProviderName; provider: WebSearchProvider; settings: SearchProviderSettings }[] = [];

		for (const name of this.providerNames) {
			const provider = this.providers.get(name);
			const settings = allSettings[name];
			if (provider && settings?.enabled) {
				enabled.push({ name, provider, settings });
			}
		}

		// Sort by priority (ascending = highest priority first)
		enabled.sort((a, b) => (a.settings.priority ?? 99) - (b.settings.priority ?? 99));
		return enabled;
	}

	/**
	 * Validates the search request.
	 */
	private _validateRequest(request: SearchRequest): void {
		if (typeof request.query !== 'string' || request.query.trim().length === 0) {
			throw new Error('Search query is required.');
		}
		if (request.maxResults !== undefined && (typeof request.maxResults !== 'number' || request.maxResults < 1 || request.maxResults > 50)) {
			throw new Error('maxResults must be between 1 and 50.');
		}
	}

	async search(request: SearchRequest): Promise<SearchResponse> {
		this._validateRequest(request);

		const enabledProviders = await this._getEnabledProvidersSorted();

		if (enabledProviders.length === 0) {
			throw new Error('No web search providers are enabled. Enable at least one provider in Kodia Settings.');
		}

		let lastError: Error | null = null;

		// Try each enabled provider in priority order
		for (const { name, provider, settings } of enabledProviders) {
			try {
				// Validate provider-specific settings
				const validation = provider.validateSettings(settings);
				if (!validation.valid) {
					const errorMsg = `Provider ${name} configuration invalid: ${validation.errors.join(', ')}`;
					lastError = WebSearchError.configuration(errorMsg, name);
					continue; // Try next provider
				}

				// Check API key requirement
				if (provider.requiresApiKey && !settings.apiKey) {
					const errorMsg = `Provider ${name} requires an API key.`;
					lastError = WebSearchError.configuration(errorMsg, name);
					continue; // Try next provider
				}

				const maxResults = Math.min(
					Math.max(1, request.maxResults ?? settings.maxResults),
					provider.maxResultsLimit
				);

				const startTime = Date.now();

				// Create a modified request with the computed maxResults
				const providerRequest: SearchRequest = {
					...request,
					maxResults,
				};

				const response = await provider.search(providerRequest, settings);

				return {
					...response,
					provider: name,
					query: request.query,
					totalResults: response.results.length,
					responseTimeMs: Date.now() - startTime,
				};
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));

				// Only fall back on transient (retryable) errors
				if (error instanceof WebSearchError) {
					if (error.type === WebSearchErrorType.Transient) {
						console.warn(`[WebSearchMainService] Provider ${name} failed (transient), falling back: ${error.message}`);
						continue;
					} else {
						// Configuration/auth error - don't fall back, throw immediately
						console.warn(`[WebSearchMainService] Provider ${name} failed (configuration), not falling back: ${error.message}`);
						throw error;
					}
				}

				// Unknown error type - conservative: don't fall back
				console.warn(`[WebSearchMainService] Provider ${name} failed (unknown error type), not falling back: ${lastError.message}`);
				throw lastError;
			}
		}

		// All providers failed
		throw lastError ?? new Error('All enabled web search providers failed.');
	}

	/**
	 * Tests connection for a specific provider.
	 * Used by the settings UI "Test Connection" button.
	 */
	async testProviderConnection(providerName: WebSearchProviderName): Promise<{ success: boolean; message: string }> {
		const provider = this.providers.get(providerName);
		if (!provider) {
			return { success: false, message: `Provider ${providerName} is not implemented.` };
		}

		const allSettings = await this._readAllProviderSettings();
		const settings = allSettings[providerName];

		if (!settings?.enabled) {
			return { success: false, message: `${providerName} is disabled. Enable it first to test the connection.` };
		}

		if (!provider.requiresApiKey) {
			return { success: true, message: `${providerName} does not require an API key. Connection test skipped.` };
		}

		if (!settings.apiKey) {
			return { success: false, message: `${providerName} API key is not configured. Please add an API key first.` };
		}

		return provider.testConnection(settings);
	}
}