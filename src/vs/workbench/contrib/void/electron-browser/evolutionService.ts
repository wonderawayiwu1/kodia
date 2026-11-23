/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { IKodiaEvolutionMainService, KODIA_EVOLUTION_CHANNEL } from '../common/evolutionTypes.js';

export class KodiaEvolutionMainServiceProxy {
	constructor(@IMainProcessService mainProcessService: IMainProcessService) {
		return ProxyChannel.toService<IKodiaEvolutionMainService>(mainProcessService.getChannel(KODIA_EVOLUTION_CHANNEL));
	}
}

registerSingleton(
	IKodiaEvolutionMainService,
	KodiaEvolutionMainServiceProxy as unknown as new (...args: unknown[]) => IKodiaEvolutionMainService,
	InstantiationType.Delayed,
);
