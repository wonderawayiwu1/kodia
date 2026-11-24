/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { StorageScope } from '../../../../platform/storage/common/storage.js';
import { IApplicationStorageMainService } from '../../../../platform/storage/electron-main/storageMainService.js';
import { IEncryptionMainService } from '../../../../platform/encryption/common/encryptionService.js';
import { VOID_SETTINGS_STORAGE_KEY } from '../common/storageKeys.js';
import { IKodiaWebFetchService } from '../common/webFetchTypes.js';
import { IWebSearchService } from '../common/webSearchTypes.js';
import { LeiProviderId } from '../common/liveIntelligenceTypes.js';
import { LiveIntelligenceCoreService } from './liveIntelligenceCore.js';

export class LiveIntelligenceMainService extends LiveIntelligenceCoreService {
	constructor(
		@IWebSearchService webSearchService: IWebSearchService,
		@IKodiaWebFetchService webFetchService: IKodiaWebFetchService,
		@IApplicationStorageMainService storageService: IApplicationStorageMainService,
		@IEncryptionMainService encryptionService: IEncryptionMainService,
	) {
		super({
			webSearchService,
			webFetchService,
			readEncryptedProviderKey: async (provider: LeiProviderId) => {
				try {
					const encrypted = storageService.get(VOID_SETTINGS_STORAGE_KEY, StorageScope.APPLICATION);
					if (!encrypted) return undefined;
					const decrypted = await encryptionService.decrypt(encrypted);
					const parsed = JSON.parse(decrypted);
					const keyMap: Record<string, string> = { openai: 'openAI', openrouter: 'openRouter', xai: 'xAI' };
					const settingsKey = keyMap[provider.toLowerCase()] ?? provider.toLowerCase();
					const key = parsed?.settingsOfProvider?.[settingsKey]?.apiKey;
					return typeof key === 'string' && key.trim() ? key.trim() : undefined;
				} catch {
					return undefined;
				}
			},
		});
	}
}
