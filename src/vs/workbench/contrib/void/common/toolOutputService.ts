/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// OpenCode tool-output.ts adaptation: centralizes tool-output truncation so that
// very large results (file reads, grep, terminal output, etc.) do not fill the
// context window. Outputs over the limit are truncated to a preview, the full
// text is saved to a retained file, and the preview carries a marker with the
// file path so the agent can read the rest if needed.

import { IFileService } from '../../../../platform/files/common/files.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';
import { VSBuffer } from '../../../../base/common/buffer.js';

export const MAX_LINES = Number.MAX_SAFE_INTEGER;
export const MAX_BYTES = Number.MAX_SAFE_INTEGER;
export const RETENTION_DAYS = 7;
export const OUTPUT_DIRECTORY = 'tool-output';

export type ToolOutputTruncation = {
	maxLines: number;
	maxBytes: number;
};

export interface IToolOutputService {
	readonly _serviceBrand: undefined;
	/** Truncate a tool result string synchronously. Returns `{ text, truncated }`. */
	truncate(text: string): { text: string; truncated: boolean };
	/** Truncate and save full output to a file. Returns `{ text, truncated, outputPath? }`. */
	truncateAsync(text: string): Promise<{ text: string; truncated: boolean; outputPath?: string }>;
	/** Configure limits. */
	configure(limits: Partial<ToolOutputTruncation>): void;
}

export const IToolOutputService = createDecorator<IToolOutputService>('toolOutputService');

export class ToolOutputService extends Disposable implements IToolOutputService {
	_serviceBrand: undefined;

	private readonly fileService: IFileService;
	private readonly storageService: IStorageService;
	private limits: ToolOutputTruncation = { maxLines: MAX_LINES, maxBytes: MAX_BYTES };

	constructor(
		@IFileService fileService: IFileService,
		@IStorageService storageService: IStorageService,
	) {
		super();
		this.fileService = fileService;
		this.storageService = storageService;
	}

	truncate(text: string): { text: string; truncated: boolean } {
		if (!text) return { text, truncated: false };

		// No limits - return text as-is
		if (this.limits.maxLines === Infinity && this.limits.maxBytes === Infinity) {
			return { text, truncated: false };
		}

		const totalLines = countLines(text);
		const totalBytes = new TextEncoder().encode(text).byteLength;

		if (totalLines <= this.limits.maxLines && totalBytes <= this.limits.maxBytes) {
			return { text, truncated: false };
		}

		const end = Math.min(afterLines(text, this.limits.maxLines), byteBoundary(text, this.limits.maxBytes));
		let shown = text.slice(
			0,
			text.endsWith('\r\n', end) ? end - 2 : text.endsWith('\n', end) ? end - 1 : end,
		);

		const shownLines = countLines(text.slice(0, end));
		const lastLineCut =
			shownLines > 0 &&
			shown.length < text.length &&
			!text.startsWith('\n', shown.length) &&
			!text.startsWith('\r\n', shown.length);
		const range = shownLines === 0 ? '0 lines' : `lines 1-${shownLines}`;
		const lastLineCutStr = lastLineCut ? ' (last line cut)' : '';
		const marker = `[showing ${range} of ${totalLines}${lastLineCutStr}; full output saved to tool-output file]`;

		const bounded: string[] = [];
		let remaining = shown.length;
		let separator = false;
		let marked = false;
		for (const line of text.split('\n')) {
			if (separator && remaining > 0) remaining--;
			separator = line !== '' && !line.endsWith('\n');
			if (!marked && remaining >= line.length + 1) {
				bounded.push(line);
				remaining -= line.length + 1;
				continue;
			}
			if (remaining > 0) bounded.push(line.slice(0, remaining));
			if (!marked) bounded.push(marker);
			remaining = 0;
			marked = true;
		}
		if (!marked) bounded.push(marker);

		return { text: bounded.join('\n'), truncated: true };
	}

	async truncateAsync(text: string): Promise<{ text: string; truncated: boolean; outputPath?: string }> {
		const result = this.truncate(text);
		if (!result.truncated) return result;

		try {
			const appData = this.storageService.get(OUTPUT_DIRECTORY, StorageScope.APPLICATION);
			let base: URI;
			if (appData) {
				try {
					base = URI.parse(appData);
				} catch {
					base = URI.file(require('os').tmpdir());
				}
			} else {
				base = URI.file(require('os').tmpdir());
			}
			const dir = URI.joinPath(base, OUTPUT_DIRECTORY);
			await this.fileService.createFolder(dir);
			const file = URI.joinPath(dir, 'tool_' + generateUuid() + '.txt');
			await this.fileService.writeFile(file, VSBuffer.fromString(text));
			return { ...result, outputPath: file.toString() };
		} catch (error) {
			// If saving fails, still return the truncated text without a path.
			return result;
		}
	}

	configure(limits: Partial<ToolOutputTruncation>): void {
		if (limits.maxLines !== undefined) this.limits.maxLines = limits.maxLines;
		if (limits.maxBytes !== undefined) this.limits.maxBytes = limits.maxBytes;
	}
}

registerSingleton(IToolOutputService, ToolOutputService, InstantiationType.Delayed);

// --- helpers (mirror OpenCode tool-output.ts) ---

function countLines(text: string): number {
	if (text === '') return 0;
	let count = 1;
	for (let index = text.indexOf('\n'); index !== -1 && index < text.length - 1; index = text.indexOf('\n', index + 1))
		count++;
	return count;
}

function afterLines(text: string, count: number): number {
	let index = 0;
	for (let line = 0; line < count; line++) {
		const next = text.indexOf('\n', index);
		if (next === -1) return text.length;
		index = next + 1;
	}
	return index;
}

const encoder = new TextEncoder();

function byteBoundary(text: string, budget: number): number {
	const index = encoder.encodeInto(text, new Uint8Array(Math.max(0, budget))).read;
	if (index === text.length || index === 0) return index;
	const before = text.charCodeAt(index - 1);
	const after = text.charCodeAt(index);
	if (before < 0x80 && after < 0x80) return before === 13 && after === 10 ? index - 1 : index;
	const start = text.lastIndexOf('\n', index - 1) + 1;
	const segment = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
		.segment(text.slice(start, index + 2))
		.containing(index - start);
	return start + (segment?.index ?? index - start);
}
