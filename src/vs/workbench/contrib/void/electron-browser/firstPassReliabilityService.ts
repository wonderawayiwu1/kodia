/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { IKodiaFirstPassReliabilityMainService, KODIA_FPERE_CHANNEL } from '../common/firstPassReliabilityTypes.js';

export class KodiaFirstPassReliabilityIPCService {
	declare readonly _serviceBrand: undefined;

	constructor(@IMainProcessService mainProcessService: IMainProcessService) {
		return ProxyChannel.toService<IKodiaFirstPassReliabilityMainService>(mainProcessService.getChannel(KODIA_FPERE_CHANNEL));
	}
}

registerSingleton(
	IKodiaFirstPassReliabilityMainService,
	KodiaFirstPassReliabilityIPCService as unknown as new (...args: unknown[]) => IKodiaFirstPassReliabilityMainService,
	InstantiationType.Delayed,
);
