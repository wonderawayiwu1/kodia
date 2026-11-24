/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

export interface NbformatCell {
	cell_type: 'code' | 'markdown' | 'raw';
	metadata: Record<string, unknown>;
	source: string[];
	outputs?: unknown[];
	execution_count?: number | null;
}

export interface NbformatDocument {
	nbformat: number;
	nbformat_minor: number;
	metadata: Record<string, unknown>;
	cells: NbformatCell[];
}

export interface NotebookEditApplySummary {
	applied: number;
	cellCount: number;
	warnings: string[];
}

/**
 * Parses an LLM tool parameter that may be provided as a real JS array, a JSON-encoded array
 * string, or (rarely) a single object that should be wrapped as a 1-element array.
 */
export function parseNotebookArrayParam(paramName: string, raw: unknown): unknown[] {
	if (Array.isArray(raw)) {
		return raw;
	}
	if (typeof raw === 'string') {
		const trimmed = raw.trim();
		if (!trimmed) {
			return [];
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(trimmed);
		} catch (e) {
			throw new Error(`Invalid ${paramName}: expected a JSON array or array of objects (${e instanceof Error ? e.message : String(e)}).`);
		}
		if (Array.isArray(parsed)) {
			return parsed;
		}
		if (parsed && typeof parsed === 'object') {
			return [parsed];
		}
		throw new Error(`Invalid ${paramName}: must be an array.`);
	}
	if (raw && typeof raw === 'object') {
		return [raw];
	}
	throw new Error(`Invalid ${paramName}: expected an array or JSON array string, got ${typeof raw}.`);
}

/**
 * Normalizes a cell source (string or string[]) into canonical nbformat 4.5 line array format
 * where every line except the last ends with "\n".
 */
export function normalizeNotebookSource(source: unknown): string[] {
	if (Array.isArray(source)) {
		const joined = source.map(s => String(s ?? '')).join('');
		return splitLinesNbformat(joined);
	}
	if (typeof source === 'string') {
		return splitLinesNbformat(source);
	}
	return [];
}

function splitLinesNbformat(text: string): string[] {
	const normalized = text.replace(/\r\n/g, '\n');
	if (normalized.length === 0) {
		return [];
	}
	const parts = normalized.split('\n');
	return parts.map((line, idx) => (idx < parts.length - 1 ? `${line}\n` : line));
}

/**
 * Normalizes any flexible cell input into a strictly valid nbformat 4.5 cell object.
 * - Accepts `cell_type` or `type` ("code" | "markdown" | "raw")
 * - Accepts `source`, `content`, `code`, or `text` (string or string[])
 * - Ensures markdown/raw cells NEVER carry invalid `outputs` or `execution_count` fields
 */
export function normalizeNotebookCell(raw: unknown): NbformatCell {
	if (typeof raw === 'string') {
		return {
			cell_type: 'code',
			execution_count: null,
			metadata: {},
			outputs: [],
			source: normalizeNotebookSource(raw),
		};
	}

	const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	const rawType = String(obj.cell_type ?? obj.type ?? 'code').toLowerCase().trim();
	const cell_type: 'code' | 'markdown' | 'raw' =
		rawType === 'markdown' || rawType === 'md' ? 'markdown'
			: rawType === 'raw' ? 'raw'
				: 'code';

	const rawSource = obj.source ?? obj.content ?? obj.code ?? obj.text ?? '';
	const source = normalizeNotebookSource(rawSource);
	const metadata = (obj.metadata && typeof obj.metadata === 'object' && !Array.isArray(obj.metadata))
		? { ...(obj.metadata as Record<string, unknown>) }
		: {};

	if (cell_type === 'code') {
		const outputs = Array.isArray(obj.outputs) ? obj.outputs : [];
		const execution_count = typeof obj.execution_count === 'number' ? obj.execution_count : null;
		return {
			cell_type: 'code',
			execution_count,
			metadata,
			outputs,
			source,
		};
	}

	return {
		cell_type,
		metadata,
		source,
	};
}

/**
 * Builds a complete, valid nbformat 4.5 Jupyter notebook JSON object.
 */
export function buildNbformatDocument(
	rawCells: unknown[],
	options?: {
		pythonVersion?: string;
		kernelName?: string;
		kernelDisplayName?: string;
	},
): NbformatDocument {
	const pythonVersion = options?.pythonVersion || '3.11.0';
	const kernelName = options?.kernelName || 'python3';
	const kernelDisplayName = options?.kernelDisplayName || 'Python 3';
	return {
		nbformat: 4,
		nbformat_minor: 5,
		metadata: {
			kernelspec: {
				display_name: kernelDisplayName,
				language: 'python',
				name: kernelName,
			},
			language_info: {
				name: 'python',
				version: pythonVersion,
				mimetype: 'text/x-python',
				codemirror_mode: { name: 'ipython', version: 3 },
				pygments_lexer: 'ipython3',
				nbconvert_exporter: 'python',
				file_extension: '.py',
			},
		},
		cells: rawCells.map(normalizeNotebookCell),
	};
}

/**
 * Applies structured cell edit operations to a parsed nbformat notebook in-place.
 * Supports canonical names and common LLM aliases cleanly while preserving nbformat 4.5 validity.
 */
export function applyNotebookEditOperations(
	notebook: NbformatDocument,
	operations: unknown[],
): NotebookEditApplySummary {
	if (!Array.isArray(notebook.cells)) {
		notebook.cells = [];
	}

	let applied = 0;
	const warnings: string[] = [];

	for (const rawOp of operations) {
		if (!rawOp || typeof rawOp !== 'object') {
			warnings.push('Skipped non-object operation.');
			continue;
		}
		const op = rawOp as Record<string, unknown>;
		const rawOpType = String(op.type ?? op.op ?? op.action ?? '').toLowerCase().trim();

		switch (rawOpType) {
			case 'add_cell':
			case 'insert_cell':
			case 'insert':
			case 'add':
			case 'append_cell': {
				const rawIndex = op.index ?? op.position ?? notebook.cells.length;
				const idx = typeof rawIndex === 'number' ? rawIndex : Number(rawIndex);
				const clampedIndex = Number.isFinite(idx)
					? Math.max(0, Math.min(notebook.cells.length, Math.trunc(idx)))
					: notebook.cells.length;
				const cellInput = op.cell ?? {
					cell_type: op.cell_type ?? 'code',
					source: op.source ?? op.content ?? '',
					metadata: op.metadata,
				};
				notebook.cells.splice(clampedIndex, 0, normalizeNotebookCell(cellInput));
				applied++;
				break;
			}

			case 'remove_cell':
			case 'delete_cell':
			case 'delete':
			case 'remove': {
				const idx = Number(op.index);
				if (Number.isInteger(idx) && idx >= 0 && idx < notebook.cells.length) {
					notebook.cells.splice(idx, 1);
					applied++;
				} else {
					warnings.push(`remove_cell: invalid index ${String(op.index)} (cells: ${notebook.cells.length}).`);
				}
				break;
			}

			case 'replace_cell':
			case 'replace': {
				const idx = Number(op.index);
				if (Number.isInteger(idx) && idx >= 0 && idx < notebook.cells.length) {
					const cellInput = op.cell ?? {
						cell_type: op.cell_type ?? notebook.cells[idx].cell_type,
						source: op.source ?? op.content ?? '',
						metadata: op.metadata ?? notebook.cells[idx].metadata,
					};
					notebook.cells[idx] = normalizeNotebookCell(cellInput);
					applied++;
				} else {
					warnings.push(`replace_cell: invalid index ${String(op.index)}.`);
				}
				break;
			}

			case 'move_cell':
			case 'move': {
				const fromIdx = Number(op.from_index ?? op.from ?? op.index);
				const toIdx = Number(op.to_index ?? op.to ?? op.target_index);
				if (
					Number.isInteger(fromIdx) && fromIdx >= 0 && fromIdx < notebook.cells.length &&
					Number.isInteger(toIdx) && toIdx >= 0 && toIdx <= notebook.cells.length
				) {
					const [moved] = notebook.cells.splice(fromIdx, 1);
					const boundedTo = Math.max(0, Math.min(notebook.cells.length, toIdx));
					notebook.cells.splice(boundedTo, 0, moved);
					applied++;
				} else {
					warnings.push(`move_cell: invalid indices from=${String(op.from_index ?? op.from)} to=${String(op.to_index ?? op.to)}.`);
				}
				break;
			}

			case 'update_cell_source':
			case 'edit_cell':
			case 'update_cell':
			case 'update_source':
			case 'edit':
			case 'update': {
				const idx = Number(op.index);
				if (Number.isInteger(idx) && idx >= 0 && idx < notebook.cells.length) {
					notebook.cells[idx].source = normalizeNotebookSource(op.source ?? op.content ?? '');
					applied++;
				} else {
					warnings.push(`update_cell_source: invalid index ${String(op.index)}.`);
				}
				break;
			}

			case 'duplicate_cell':
			case 'duplicate':
			case 'clone_cell': {
				const idx = Number(op.index);
				if (Number.isInteger(idx) && idx >= 0 && idx < notebook.cells.length) {
					const orig = notebook.cells[idx];
					const cloned: NbformatCell = normalizeNotebookCell({
						cell_type: orig.cell_type,
						source: [...orig.source],
						metadata: { ...(orig.metadata || {}) },
						outputs: [],
						execution_count: null,
					});
					notebook.cells.splice(idx + 1, 0, cloned);
					applied++;
				} else {
					warnings.push(`duplicate_cell: invalid index ${String(op.index)}.`);
				}
				break;
			}

			case 'change_cell_type':
			case 'convert_cell':
			case 'set_cell_type': {
				const idx = Number(op.index);
				const newType = String(op.cell_type ?? op.new_type ?? op.target_type ?? '').toLowerCase().trim();
				if (
					Number.isInteger(idx) && idx >= 0 && idx < notebook.cells.length &&
					(newType === 'code' || newType === 'markdown' || newType === 'md' || newType === 'raw')
				) {
					const orig = notebook.cells[idx];
					notebook.cells[idx] = normalizeNotebookCell({
						cell_type: newType,
						source: orig.source,
						metadata: orig.metadata,
						outputs: [],
						execution_count: null,
					});
					applied++;
				} else {
					warnings.push(`change_cell_type: invalid index=${String(op.index)} or cell_type=${String(op.cell_type ?? op.new_type)}.`);
				}
				break;
			}

			case 'update_cell_outputs': {
				const idx = Number(op.index);
				if (Number.isInteger(idx) && idx >= 0 && idx < notebook.cells.length && notebook.cells[idx].cell_type === 'code') {
					notebook.cells[idx].outputs = Array.isArray(op.outputs) ? op.outputs : [];
					applied++;
				} else {
					warnings.push(`update_cell_outputs: invalid index ${String(op.index)}.`);
				}
				break;
			}

			case 'clear_cell_outputs':
			case 'clear_outputs': {
				const idx = Number(op.index);
				if (Number.isInteger(idx) && idx >= 0 && idx < notebook.cells.length) {
					if (notebook.cells[idx].cell_type === 'code') {
						notebook.cells[idx].outputs = [];
						notebook.cells[idx].execution_count = null;
					}
					applied++;
				} else {
					warnings.push(`clear_cell_outputs: invalid index ${String(op.index)}.`);
				}
				break;
			}

			case 'clear_all_outputs': {
				for (const cell of notebook.cells) {
					if (cell.cell_type === 'code') {
						cell.outputs = [];
						cell.execution_count = null;
					}
				}
				applied++;
				break;
			}

			default:
				warnings.push(`Unknown notebook edit operation: "${rawOpType}".`);
				break;
		}
	}

	return {
		applied,
		cellCount: notebook.cells.length,
		warnings,
	};
}
