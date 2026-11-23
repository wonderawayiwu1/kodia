/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { KodiaApplyUpdateResult, KodiaUpdateStatus, VoidCheckUpdateRespose } from './voidUpdateServiceTypes.js';



export interface IVoidUpdateService {
	readonly _serviceBrand: undefined;
	check: (explicit: boolean) => Promise<VoidCheckUpdateRespose>;
	checkLocalOnly: () => Promise<VoidCheckUpdateRespose>;
	getUpdateStatus: () => Promise<KodiaUpdateStatus>;
	restartAndApplyUpdate: () => Promise<KodiaApplyUpdateResult>;
}


export const IVoidUpdateService = createDecorator<IVoidUpdateService>('VoidUpdateService');


// implemented by calling channel
export class VoidUpdateService implements IVoidUpdateService {

	readonly _serviceBrand: undefined;
	private readonly voidUpdateService: IVoidUpdateService;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService, // (only usable on client side)
	) {
		// creates an IPC proxy to use voidUpdateMainService.ts
		this.voidUpdateService = ProxyChannel.toService<IVoidUpdateService>(mainProcessService.getChannel('void-channel-update'));
	}


	// anything transmitted over a channel must be async even if it looks like it doesn't have to be
	check: IVoidUpdateService['check'] = async (explicit) => {
		const res = await this.voidUpdateService.check(explicit)
		return res
	}

	checkLocalOnly: IVoidUpdateService['checkLocalOnly'] = async () => {
		return await this.voidUpdateService.checkLocalOnly()
	}

	getUpdateStatus: IVoidUpdateService['getUpdateStatus'] = async () => {
		return await this.voidUpdateService.getUpdateStatus()
	}

	restartAndApplyUpdate: IVoidUpdateService['restartAndApplyUpdate'] = async () => {
		return await this.voidUpdateService.restartAndApplyUpdate()
	}
}

registerSingleton(IVoidUpdateService, VoidUpdateService, InstantiationType.Eager);


