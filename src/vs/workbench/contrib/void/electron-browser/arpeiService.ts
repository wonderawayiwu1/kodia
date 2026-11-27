/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { IKodiaArpeiMainService, KODIA_ARPEI_CHANNEL } from '../common/arpeiTypes.js';

export class KodiaArpeiIPCService {
	declare readonly _serviceBrand: undefined;

	constructor(@IMainProcessService mainProcessService: IMainProcessService) {
		return ProxyChannel.toService<IKodiaArpeiMainService>(mainProcessService.getChannel(KODIA_ARPEI_CHANNEL));
	}
}

registerSingleton(
	IKodiaArpeiMainService,
	KodiaArpeiIPCService as unknown as new (...args: unknown[]) => IKodiaArpeiMainService,
	InstantiationType.Delayed,
);
