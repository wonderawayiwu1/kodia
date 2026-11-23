/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { KodiaCorrectnessMainService } from '../../electron-main/correctnessMainService.js';

const service = new KodiaCorrectnessMainService();

service.onDidEmitEvent(event => {
	try {
		process.send?.({ event });
	} catch { /* parent disconnected */ }
});

process.on('message', async (m: { id: number; command: string; args: unknown[] }) => {
	try {
		const fn = (service as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[m.command];
		if (typeof fn !== 'function') {
			throw new Error(`Unknown IKodiaCorrectnessMainService method: ${m.command}`);
		}
		const result = await fn.apply(service, m.args);
		process.send?.({ id: m.id, result });
	} catch (e) {
		process.send?.({ id: m.id, error: e instanceof Error ? e.message : String(e) });
	}
});

process.on('disconnect', () => {
	try {
		service.dispose();
	} finally {
		process.exit(0);
	}
});

process.send?.({ ready: true });
