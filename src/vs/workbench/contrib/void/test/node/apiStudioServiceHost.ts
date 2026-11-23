/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { KodiaApiStudioMainService } from '../../electron-main/apiStudioMainService.js';

const service = new KodiaApiStudioMainService();

service.onDidEmitEvent(event => {
	try {
		process.send?.({ event });
	} catch { /* parent disconnected */ }
});

process.on('message', async (m: { id: number; command: string; args: unknown[] }) => {
	try {
		const fn = (service as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[m.command];
		if (typeof fn !== 'function') {
			throw new Error(`Unknown IKodiaApiStudioMainService method: ${m.command}`);
		}
		const result = await fn.apply(service, m.args);
		process.send?.({ id: m.id, result });
	} catch (e) {
		process.send?.({ id: m.id, error: e instanceof Error ? e.message : String(e) });
	}
});

process.on('disconnect', async () => {
	try {
		await service.stopAllRuntimes();
		service.dispose();
	} finally {
		process.exit(0);
	}
});

process.send?.({ ready: true });
