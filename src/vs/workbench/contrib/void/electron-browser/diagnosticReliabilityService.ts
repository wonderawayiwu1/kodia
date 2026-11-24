/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { IKodiaDiagnosticReliabilityMainService, KODIA_KDRE_CHANNEL } from '../common/diagnosticReliabilityTypes.js';

export class KodiaDiagnosticReliabilityIPCService {
	declare readonly _serviceBrand: undefined;

	constructor(@IMainProcessService mainProcessService: IMainProcessService) {
		return ProxyChannel.toService<IKodiaDiagnosticReliabilityMainService>(mainProcessService.getChannel(KODIA_KDRE_CHANNEL));
	}
}

registerSingleton(
	IKodiaDiagnosticReliabilityMainService,
	KodiaDiagnosticReliabilityIPCService as unknown as new (...args: unknown[]) => IKodiaDiagnosticReliabilityMainService,
	InstantiationType.Delayed,
);
