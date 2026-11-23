/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const KODIA_NOTEBOOK_KERNEL_CHANNEL = 'void-channel-notebookKernel';

export interface KodiaDiscoveredPythonKernel {
	id: string;
	label: string;
	description: string;
	detail: string;
	pythonPath: string;
	version: string;
	hasIpykernel: boolean;
	hasMatplotlib: boolean;
	isPreferred: boolean;
}

export interface KodiaKernelOutputItem {
	mime: string;
	/** UTF-8 text, JSON string, or base64-encoded binary data when `isBase64` is true. */
	data: string;
	isBase64?: boolean;
}

export interface KodiaKernelOutput {
	items: KodiaKernelOutputItem[];
}

export interface KodiaKernelExecuteRequest {
	notebookUri: string;
	pythonPath: string;
	cwd?: string;
	code: string;
}

export interface KodiaKernelExecuteResult {
	success: boolean;
	executionCount: number;
	outputs: KodiaKernelOutput[];
	errorName?: string;
	errorMessage?: string;
	errorStack?: string;
}

export interface KodiaKernelVariable {
	name: string;
	type: string;
	value: string;
}

export const IKodiaNotebookKernelMainService = createDecorator<IKodiaNotebookKernelMainService>('kodiaNotebookKernelMainService');

export interface IKodiaNotebookKernelMainService {
	readonly _serviceBrand: undefined;
	discoverKernels(workspaceFolder?: string): Promise<KodiaDiscoveredPythonKernel[]>;
	executeCell(req: KodiaKernelExecuteRequest): Promise<KodiaKernelExecuteResult>;
	interruptKernel(notebookUri: string): Promise<void>;
	restartKernel(notebookUri: string): Promise<void>;
	disposeKernel(notebookUri: string): Promise<void>;
	getVariables(notebookUri: string): Promise<KodiaKernelVariable[]>;
}
