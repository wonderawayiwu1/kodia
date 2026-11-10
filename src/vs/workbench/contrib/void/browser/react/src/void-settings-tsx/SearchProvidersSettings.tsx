/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useCallback, useState } from 'react';
import { useAccessor, useSettingsState } from '../util/services.js';
import { SearchProviderCard } from './SearchProviderCard.js';
import { WebSearchProviderName, SearchProviderSettings, IWebSearchService } from '../../../../common/webSearchTypes.js';
import { DEFAULT_SEARCH_PROVIDER_SETTINGS, SEARCH_PROVIDER_DISPLAY_INFO } from '../../../../common/webSearchSettings.js';
import { SettingGroup } from './SettingsControls.js';
import { IVoidSettingsService } from '../../../../common/voidSettingsService.js';
import { IMetricsService } from '../../../../common/metricsService.js';
import { INotificationService } from '../../../../../../../platform/notification/common/notification.js';
import Severity from '../../../../../../../base/common/severity.js';
import { VoidSwitch } from '../util/inputs.js';

const WEB_SEARCH_PROVIDERS: WebSearchProviderName[] = [
	'brave',
	'tavily',
	'exa',
	'you',
	'nvidia',
	'duckduckgo',
];

export const SearchProvidersSettings = () => {
	const accessor = useAccessor();
	const settingsState = useSettingsState();
	const metricsService = accessor.get('IMetricsService');
	const voidSettingsService = accessor.get('IVoidSettingsService');
	const webSearchService = accessor.get('IWebSearchService');
	const notificationService = accessor.get('INotificationService');

	// Safe access to settings with fallbacks
	const globalSettings = settingsState?.globalSettings ?? {};
	const webSearchProviders = globalSettings.webSearchProviders ?? DEFAULT_SEARCH_PROVIDER_SETTINGS;
	const freeOnly = globalSettings.webSearchFreeOnly ?? true;

	// Track drag state for drag-and-drop reordering
	const [draggedId, setDraggedId] = useState<WebSearchProviderName | null>(null);
	// Track which provider is currently being tested to prevent duplicate requests
	const [testingProvider, setTestingProvider] = useState<WebSearchProviderName | null>(null);

	const handleDragStart = (e: React.DragEvent, providerName: WebSearchProviderName) => {
		setDraggedId(providerName);
		e.dataTransfer.effectAllowed = 'move';
	};

	const handleDragOver = (e: React.DragEvent) => {
		e.preventDefault();
		e.dataTransfer.dropEffect = 'move';
	};

	const handleDrop = (e: React.DragEvent, targetProvider: WebSearchProviderName) => {
		e.preventDefault();
		if (!draggedId || draggedId === targetProvider) return;

		// Get current providers sorted by priority
		const currentProviders = [...WEB_SEARCH_PROVIDERS].sort(
			(a, b) => webSearchProviders[a].priority - webSearchProviders[b].priority
		);

		const draggedIndex = currentProviders.indexOf(draggedId);
		const targetIndex = currentProviders.indexOf(targetProvider);

		if (draggedIndex === -1 || targetIndex === -1) return;

		// Reorder
		const newProviders = [...currentProviders];
		newProviders.splice(draggedIndex, 1);
		newProviders.splice(targetIndex, 0, draggedId);

		// Update priorities
		const newProvidersSettings = { ...webSearchProviders };
		newProviders.forEach((provider, index) => {
			newProvidersSettings[provider] = {
				...webSearchProviders[provider],
				priority: index,
			};
		});

		// Save updated settings
		voidSettingsService.setGlobalSetting('webSearchProviders', newProvidersSettings);
	};

	const handleSettingsChange = useCallback(async (providerName: WebSearchProviderName, changes: Partial<SearchProviderSettings>) => {
		// Guard against undefined state - fall back to defaults if not yet initialized
		const serviceState = voidSettingsService?.state;
		const serviceGlobalSettings = serviceState?.globalSettings;
		const serviceWebSearchProviders = serviceGlobalSettings?.webSearchProviders ?? DEFAULT_SEARCH_PROVIDER_SETTINGS;

		const currentSettings = serviceWebSearchProviders[providerName];

		const newSettings = {
			...currentSettings,
			...changes,
		};

		// For NVIDIA, don't persist apiKey (it's managed by the NVIDIA LLM provider)
		if (providerName === 'nvidia') {
			delete newSettings.apiKey;
		}

		await voidSettingsService.setSearchProviderSettings(providerName, newSettings);
	}, [voidSettingsService]);

	const handleTestConnection = useCallback(async (providerName: WebSearchProviderName) => {
		// Prevent duplicate requests
		if (testingProvider !== null) {
			return;
		}

		const providerSettings = webSearchProviders[providerName];
		const displayInfo = SEARCH_PROVIDER_DISPLAY_INFO[providerName];

		// Check if provider is enabled
		if (!providerSettings?.enabled) {
			notificationService.warn(`${displayInfo.title} is disabled. Enable it first to test the connection.`);
			return;
		}

		// For providers that don't require API keys (DuckDuckGo, NVIDIA)
		if (providerName === 'duckduckgo' || providerName === 'nvidia') {
			notificationService.info(`${displayInfo.title} does not require an API key. Connection test skipped.`);
			return;
		}

		// For all providers requiring API keys - test via IWebSearchService.testProviderConnection
		setTestingProvider(providerName);
		metricsService.capture('Web Search Test Connection', { provider: providerName });

		try {
			const result = await webSearchService.testProviderConnection(providerName);

			if (result.success) {
				notificationService.info(`${displayInfo.title} connection successful!`);
			} else {
				notificationService.notify({
					message: result.message,
					source: providerName,
					severity: Severity.Error,
				});
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			notificationService.notify({
				message: `${displayInfo.title} connection failed: ${errorMessage}`,
				source: errorMessage,
				severity: Severity.Error,
			});
		} finally {
			setTestingProvider(null);
		}
		return;
	}, [metricsService, notificationService, webSearchService, webSearchProviders, testingProvider]);

	return (
		<SettingGroup title='Web Search Providers' description='Configure search providers for web search and agent tools. Drag to reorder priority.'>
			<div className='mb-4'>
				<VoidSwitch
					value={freeOnly}
					onChange={(newVal) => {
						voidSettingsService.setGlobalSetting('webSearchFreeOnly', newVal);
					}}
					label='Strict free-only mode (zero-spend enforcement)'
					description='When enabled, only providers with verified free access will be used. Local usage counters are estimates only, not authoritative provider balances.'
				/>
			</div>

			<div className='space-y-4'>
				{WEB_SEARCH_PROVIDERS.map((providerName) => {
					const settings = webSearchProviders[providerName];
					const isTesting = testingProvider === providerName;

					return (
						<SearchProviderCard
							key={providerName}
							providerName={providerName}
							settings={settings}
							onSettingsChange={(name, changes) =>
								handleSettingsChange(name as WebSearchProviderName, changes)
							}
							onTestConnection={() =>
								handleTestConnection(providerName)
							}
							hasExistingKey={!!settings?.apiKey}
							onDragStart={handleDragStart}
							onDragOver={handleDragOver}
							onDrop={(e, target) =>
								handleDrop(e, target as WebSearchProviderName)
							}
							onDragEnd={() => setDraggedId(null)}
							draggedId={draggedId}
							isTesting={isTesting}
						/>
					);
				})}
			</div>
		</SettingGroup>
	);
};