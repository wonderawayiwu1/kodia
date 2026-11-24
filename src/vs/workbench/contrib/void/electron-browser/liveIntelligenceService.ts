/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { IKodiaLiveIntelligenceMainService, KODIA_LEI_CHANNEL } from '../common/liveIntelligenceTypes.js';

export class KodiaLiveIntelligenceIPCService {
	declare readonly _serviceBrand: undefined;

	constructor(@IMainProcessService mainProcessService: IMainProcessService) {
		return ProxyChannel.toService<IKodiaLiveIntelligenceMainService>(mainProcessService.getChannel(KODIA_LEI_CHANNEL));
	}
}

registerSingleton(
	IKodiaLiveIntelligenceMainService,
	KodiaLiveIntelligenceIPCService as unknown as new (...args: unknown[]) => IKodiaLiveIntelligenceMainService,
	InstantiationType.Delayed,
);
