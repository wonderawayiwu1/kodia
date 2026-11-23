/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { registerMainProcessRemoteService } from '../../../../platform/ipc/electron-browser/services.js';
import { IKodiaApiStudioMainService, KODIA_API_STUDIO_CHANNEL } from '../common/apiStudioTypes.js';

registerMainProcessRemoteService(IKodiaApiStudioMainService, KODIA_API_STUDIO_CHANNEL);
