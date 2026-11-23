/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { registerMainProcessRemoteService } from '../../../../platform/ipc/electron-browser/services.js';
import { IKodiaCorrectnessMainService, KODIA_CORRECTNESS_CHANNEL } from '../common/correctnessTypes.js';

registerMainProcessRemoteService(IKodiaCorrectnessMainService, KODIA_CORRECTNESS_CHANNEL);
