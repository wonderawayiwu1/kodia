/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { IKodiaKacraeMainService, KODIA_KACRAE_CHANNEL } from '../common/kacraeTypes.js';

export class KodiaKacraeIPCService {
	declare readonly _serviceBrand: undefined;

	constructor(@IMainProcessService mainProcessService: IMainProcessService) {
		return ProxyChannel.toService<IKodiaKacraeMainService>(mainProcessService.getChannel(KODIA_KACRAE_CHANNEL));
	}
}

registerSingleton(
	IKodiaKacraeMainService,
	KodiaKacraeIPCService as unknown as new (...args: unknown[]) => IKodiaKacraeMainService,
	InstantiationType.Delayed,
);

