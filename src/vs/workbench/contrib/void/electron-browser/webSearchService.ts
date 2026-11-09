/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { registerMainProcessRemoteService } from '../../../../platform/ipc/electron-browser/services.js';
import { IWebSearchService } from '../common/webSearchTypes.js';

// Registers a renderer-side proxy for IWebSearchService. When resolved through
// dependency injection, calls are proxied over IPC to the void-channel-webSearch
// channel handled by BraveSearchMainService in the Electron main process.
// The API key is never exposed through this proxy: it is read from encrypted
// settings storage only in the main process.
registerMainProcessRemoteService(IWebSearchService, 'void-channel-webSearch');
