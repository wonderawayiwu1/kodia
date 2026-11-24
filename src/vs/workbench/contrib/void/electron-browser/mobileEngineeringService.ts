/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { IKodiaMobileMainService, KODIA_MOBILE_CHANNEL } from '../common/mobileEngineeringTypes.js';

class MobileEngineeringMainServiceClient {
	constructor(@IMainProcessService mainProcessService: IMainProcessService) {
		return ProxyChannel.toService<IKodiaMobileMainService>(mainProcessService.getChannel(KODIA_MOBILE_CHANNEL));
	}
}

registerSingleton(IKodiaMobileMainService, MobileEngineeringMainServiceClient as any, InstantiationType.Delayed);
