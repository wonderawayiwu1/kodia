/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import { Emitter } from '../../../../../base/common/event.js';
import { FileAccess } from '../../../../../base/common/network.js';
import { ApiLiveEvent, IKodiaApiStudioMainService } from '../../common/apiStudioTypes.js';

export async function startApiStudioServiceProcess(): Promise<{ service: IKodiaApiStudioMainService; stop: () => Promise<void> }> {
	const host = FileAccess.asFileUri('vs/workbench/contrib/void/test/node/apiStudioServiceHost.js').fsPath;
	const child = cp.spawn('node', [host], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true });
	let stderr = '';
	child.stderr!.on('data', d => { stderr += String(d); });

	const onDidEmitEventEmitter = new Emitter<ApiLiveEvent>();
	const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
	let nextId = 0;

	await new Promise<void>((resolve, reject) => {
		child.once('exit', code => reject(new Error(`API Studio host exited (${code}): ${stderr}`)));
		child.on('message', (m: { ready?: boolean; event?: ApiLiveEvent; id?: number; result?: unknown; error?: string }) => {
			if (m.ready) { resolve(); return; }
			if (m.event) { onDidEmitEventEmitter.fire(m.event); return; }
			if (m.id !== undefined) {
				const p = pending.get(m.id);
				pending.delete(m.id);
				if (m.error !== undefined) { p?.reject(new Error(m.error)); }
				else { p?.resolve(m.result); }
			}
		});
	});

	const service = new Proxy({}, {
		get: (_t, prop) => {
			if (prop === 'onDidEmitEvent') { return onDidEmitEventEmitter.event; }
			if (typeof prop !== 'string' || prop === 'then') { return undefined; }
			return (...args: unknown[]) => new Promise((resolve, reject) => {
				const id = nextId++;
				pending.set(id, { resolve, reject });
				child.send({ id, command: prop, args });
			});
		},
	}) as IKodiaApiStudioMainService;

	const stop = async () => {
		onDidEmitEventEmitter.dispose();
		if (child.exitCode !== null) { return; }
		const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
		child.disconnect();
		await Promise.race([exited, new Promise(r => setTimeout(r, 8_000))]);
		if (child.exitCode === null) { child.kill(); }
	};

	return { service, stop };
}
