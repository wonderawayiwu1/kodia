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

export interface NotebookCellSummary {
	index: number;
	cell_type: 'code' | 'markdown' | 'raw';
	preview: string;
	line_count: number;
	execution_count: number | null;
	output_count: number;
	output_types: string[];
}

export interface NotebookEditFailure {
	op_index: number;
	type: string;
	error: string;
}

export interface NotebookEditApplySummary {
	applied: number;
	cellCount: number;
	warnings: string[];
	failed: NotebookEditFailure[];
	cellsSummary: NotebookCellSummary[];
}

export interface NotebookEditHistoryState {
	undoStack: string[];
	redoStack: string[];
	clipboard: NbformatCell | null;
}

export interface NotebookSearchMatch {
	cell_index: number;
	cell_type: 'code' | 'markdown' | 'raw';
	in_output: boolean;
	line: number;
	column: number;
	preview: string;
}

export interface NotebookSearchResult {
	matches: NotebookSearchMatch[];
	total_matches: number;
}

export interface NotebookValidationIssue {
	severity: 'error' | 'warning';
	cell_index?: number;
	message: string;
}

export interface NotebookValidationReport {
	valid: boolean;
	nbformat: string;
	has_kernelspec: boolean;
	kernelspec_name: string | null;
	cell_count: number;
	code_cells: number;
	markdown_cells: number;
	executed_cells: number;
	issues: NotebookValidationIssue[];
}

const MAX_UNDO_HISTORY = 30;

export function createNotebookEditHistoryState(): NotebookEditHistoryState {
	return { undoStack: [], redoStack: [], clipboard: null };
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

export function sourceToText(source: unknown): string {
	if (Array.isArray(source)) {
		return source.map(s => String(s ?? '')).join('');
	}
	return typeof source === 'string' ? source : '';
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
 * Produces a lightweight structural summary of every cell in a notebook (without dumping huge base64 blobs).
 */
export function summarizeNotebookCells(notebook: NbformatDocument): NotebookCellSummary[] {
	const cells = Array.isArray(notebook.cells) ? notebook.cells : [];
	return cells.map((cell, index) => {
		const text = sourceToText(cell.source);
		const lines = text.length > 0 ? text.split('\n') : [];
		const firstNonEmpty = lines.find(l => l.trim().length > 0) ?? '';
		const preview = firstNonEmpty.trim().slice(0, 90);
		const outputs = Array.isArray(cell.outputs) ? cell.outputs : [];
		const outputTypes: string[] = [];
		for (const out of outputs) {
			if (!out || typeof out !== 'object') continue;
			const o = out as Record<string, unknown>;
			if (o.output_type === 'stream') {
				outputTypes.push(`stream:${String(o.name ?? 'stdout')}`);
			} else if (o.output_type === 'error') {
				outputTypes.push(`error:${String(o.ename ?? 'Error')}`);
			} else if (o.data && typeof o.data === 'object') {
				outputTypes.push(...Object.keys(o.data as Record<string, unknown>));
			} else if (o.output_type) {
				outputTypes.push(String(o.output_type));
			}
		}
		return {
			index,
			cell_type: cell.cell_type ?? 'code',
			preview,
			line_count: lines.length,
			execution_count: cell.cell_type === 'code' && typeof cell.execution_count === 'number' ? cell.execution_count : null,
			output_count: outputs.length,
			output_types: Array.from(new Set(outputTypes)),
		};
	});
}

function readIndexParam(op: Record<string, unknown>, keys: readonly string[]): number | undefined {
	for (const k of keys) {
		if (op[k] !== undefined && op[k] !== null && op[k] !== '') {
			const n = Number(op[k]);
			if (Number.isInteger(n)) {
				return n;
			}
		}
	}
	return undefined;
}

function validRangeHint(len: number, allowEnd = false): string {
	if (len === 0) {
		return allowEnd ? 'valid: 0; notebook is currently empty' : 'notebook has 0 cells';
	}
	const max = allowEnd ? len : len - 1;
	return `valid: 0..${max}; notebook has ${len} cell${len === 1 ? '' : 's'}`;
}

function cloneCell(cell: NbformatCell, resetOutputs = false): NbformatCell {
	const copy = JSON.parse(JSON.stringify(cell)) as NbformatCell;
	if (resetOutputs && copy.cell_type === 'code') {
		copy.outputs = [];
		copy.execution_count = null;
	}
	return normalizeNotebookCell(copy);
}

/**
 * Applies structured cell edit operations to a parsed nbformat notebook in-place.
 * - Accepts `index` OR `cell_index` uniformly across ALL cell operations.
 * - Supports `undo`, `redo`, `cut_cell`, `paste_cell`, `insert_cell_above`, `insert_cell_below`,
 *   `add_cell`, `remove_cell`, `replace_cell`, `move_cell`, `update_cell_source`,
 *   `duplicate_cell`, `change_cell_type`, `update_cell_outputs`, `clear_cell_outputs`, `clear_all_outputs`.
 * - Returns clear per-operation failure details and the updated cell outline with new indices.
 */
export function applyNotebookEditOperations(
	notebook: NbformatDocument,
	operations: unknown[],
	history?: NotebookEditHistoryState,
): NotebookEditApplySummary {
	if (!Array.isArray(notebook.cells)) {
		notebook.cells = [];
	}

	let applied = 0;
	const warnings: string[] = [];
	const failed: NotebookEditFailure[] = [];

	const pushUndoSnapshot = () => {
		if (!history) return;
		history.undoStack.push(JSON.stringify(notebook.cells));
		if (history.undoStack.length > MAX_UNDO_HISTORY) {
			history.undoStack.shift();
		}
		history.redoStack = [];
	};

	for (let opIdx = 0; opIdx < operations.length; opIdx++) {
		const rawOp = operations[opIdx];
		if (!rawOp || typeof rawOp !== 'object') {
			const msg = 'Operation must be an object.';
			warnings.push(msg);
			failed.push({ op_index: opIdx, type: 'invalid', error: msg });
			continue;
		}
		const op = rawOp as Record<string, unknown>;
		const rawOpType = String(op.type ?? op.op ?? op.action ?? '').toLowerCase().trim();

		const recordFailure = (error: string) => {
			warnings.push(error);
			failed.push({ op_index: opIdx, type: rawOpType || 'unknown', error });
		};

		switch (rawOpType) {
			case 'undo': {
				if (!history || history.undoStack.length === 0) {
					recordFailure('undo: nothing to undo for this notebook.');
				} else {
					history.redoStack.push(JSON.stringify(notebook.cells));
					const prev = history.undoStack.pop()!;
					notebook.cells = JSON.parse(prev);
					applied++;
				}
				break;
			}

			case 'redo': {
				if (!history || history.redoStack.length === 0) {
					recordFailure('redo: nothing to redo for this notebook.');
				} else {
					history.undoStack.push(JSON.stringify(notebook.cells));
					const next = history.redoStack.pop()!;
					notebook.cells = JSON.parse(next);
					applied++;
				}
				break;
			}

			case 'add_cell':
			case 'insert_cell':
			case 'insert':
			case 'add':
			case 'append_cell': {
				const parsedIdx = readIndexParam(op, ['index', 'cell_index', 'position']);
				const hasExplicitIdx = op.index !== undefined || op.cell_index !== undefined || op.position !== undefined;
				if (hasExplicitIdx && (parsedIdx === undefined || parsedIdx < 0 || parsedIdx > notebook.cells.length)) {
					recordFailure(`${rawOpType}: cell_index ${String(op.index ?? op.cell_index ?? op.position)} is out of range (${validRangeHint(notebook.cells.length, true)}).`);
					break;
				}
				const insertAt = parsedIdx !== undefined ? parsedIdx : notebook.cells.length;
				const cellInput = op.cell ?? {
					cell_type: op.cell_type ?? 'code',
					source: op.source ?? op.content ?? '',
					metadata: op.metadata,
				};
				pushUndoSnapshot();
				notebook.cells.splice(insertAt, 0, normalizeNotebookCell(cellInput));
				applied++;
				break;
			}

			case 'insert_cell_above': {
				const idx = readIndexParam(op, ['index', 'cell_index']);
				if (idx === undefined || idx < 0 || idx > notebook.cells.length) {
					recordFailure(`insert_cell_above: cell_index ${String(op.index ?? op.cell_index)} is out of range (${validRangeHint(notebook.cells.length, true)}).`);
					break;
				}
				const cellInput = op.cell ?? {
					cell_type: op.cell_type ?? 'code',
					source: op.source ?? op.content ?? '',
					metadata: op.metadata,
				};
				pushUndoSnapshot();
				notebook.cells.splice(idx, 0, normalizeNotebookCell(cellInput));
				applied++;
				break;
			}

			case 'insert_cell_below': {
				const idx = readIndexParam(op, ['index', 'cell_index']);
				if (idx === undefined || idx < 0 || idx >= notebook.cells.length) {
					recordFailure(`insert_cell_below: cell_index ${String(op.index ?? op.cell_index)} is out of range (${validRangeHint(notebook.cells.length)}).`);
					break;
				}
				const cellInput = op.cell ?? {
					cell_type: op.cell_type ?? 'code',
					source: op.source ?? op.content ?? '',
					metadata: op.metadata,
				};
				pushUndoSnapshot();
				notebook.cells.splice(idx + 1, 0, normalizeNotebookCell(cellInput));
				applied++;
				break;
			}

			case 'cut_cell': {
				const idx = readIndexParam(op, ['index', 'cell_index']);
				if (idx === undefined || idx < 0 || idx >= notebook.cells.length) {
					recordFailure(`cut_cell: cell_index ${String(op.index ?? op.cell_index)} is out of range (${validRangeHint(notebook.cells.length)}).`);
					break;
				}
				pushUndoSnapshot();
				const [removed] = notebook.cells.splice(idx, 1);
				if (history) {
					history.clipboard = cloneCell(removed, false);
				}
				applied++;
				break;
			}

			case 'paste_cell': {
				if (!history || !history.clipboard) {
					recordFailure('paste_cell: notebook clipboard is empty (run cut_cell first).');
					break;
				}
				const idx = readIndexParam(op, ['index', 'cell_index', 'position']);
				const insertAt = idx !== undefined
					? Math.max(0, Math.min(notebook.cells.length, idx))
					: notebook.cells.length;
				pushUndoSnapshot();
				notebook.cells.splice(insertAt, 0, cloneCell(history.clipboard, false));
				applied++;
				break;
			}

			case 'remove_cell':
			case 'delete_cell':
			case 'delete':
			case 'remove': {
				const idx = readIndexParam(op, ['index', 'cell_index']);
				if (idx !== undefined && idx >= 0 && idx < notebook.cells.length) {
					pushUndoSnapshot();
					notebook.cells.splice(idx, 1);
					applied++;
				} else {
					recordFailure(`remove_cell: cell_index ${String(op.index ?? op.cell_index)} is out of range (${validRangeHint(notebook.cells.length)}).`);
				}
				break;
			}

			case 'replace_cell':
			case 'replace': {
				const idx = readIndexParam(op, ['index', 'cell_index']);
				if (idx !== undefined && idx >= 0 && idx < notebook.cells.length) {
					const cellInput = op.cell ?? {
						cell_type: op.cell_type ?? notebook.cells[idx].cell_type,
						source: op.source ?? op.content ?? '',
						metadata: op.metadata ?? notebook.cells[idx].metadata,
					};
					pushUndoSnapshot();
					notebook.cells[idx] = normalizeNotebookCell(cellInput);
					applied++;
				} else {
					recordFailure(`replace_cell: cell_index ${String(op.index ?? op.cell_index)} is out of range (${validRangeHint(notebook.cells.length)}).`);
				}
				break;
			}

			case 'move_cell':
			case 'move': {
				const fromIdx = readIndexParam(op, ['from_index', 'from_cell_index', 'from', 'index', 'cell_index']);
				const toIdx = readIndexParam(op, ['to_index', 'to_cell_index', 'to', 'target_index']);
				if (
					fromIdx !== undefined && fromIdx >= 0 && fromIdx < notebook.cells.length &&
					toIdx !== undefined && toIdx >= 0 && toIdx <= notebook.cells.length
				) {
					pushUndoSnapshot();
					const [moved] = notebook.cells.splice(fromIdx, 1);
					const boundedTo = Math.max(0, Math.min(notebook.cells.length, toIdx));
					notebook.cells.splice(boundedTo, 0, moved);
					applied++;
				} else {
					recordFailure(`move_cell: invalid indices from=${String(op.from_index ?? op.from_cell_index ?? op.from ?? op.index ?? op.cell_index)} to=${String(op.to_index ?? op.to_cell_index ?? op.to ?? op.target_index)} (${validRangeHint(notebook.cells.length)}).`);
				}
				break;
			}

			case 'update_cell_source':
			case 'edit_cell':
			case 'update_cell':
			case 'update_source':
			case 'edit':
			case 'update': {
				const idx = readIndexParam(op, ['index', 'cell_index']);
				if (idx !== undefined && idx >= 0 && idx < notebook.cells.length) {
					pushUndoSnapshot();
					notebook.cells[idx].source = normalizeNotebookSource(op.source ?? op.content ?? '');
					applied++;
				} else {
					recordFailure(`update_cell_source: cell_index ${String(op.index ?? op.cell_index)} is out of range (${validRangeHint(notebook.cells.length)}).`);
				}
				break;
			}

			case 'duplicate_cell':
			case 'duplicate':
			case 'clone_cell': {
				const idx = readIndexParam(op, ['index', 'cell_index']);
				if (idx !== undefined && idx >= 0 && idx < notebook.cells.length) {
					pushUndoSnapshot();
					const cloned = cloneCell(notebook.cells[idx], true);
					notebook.cells.splice(idx + 1, 0, cloned);
					applied++;
				} else {
					recordFailure(`duplicate_cell: cell_index ${String(op.index ?? op.cell_index)} is out of range (${validRangeHint(notebook.cells.length)}).`);
				}
				break;
			}

			case 'change_cell_type':
			case 'convert_cell':
			case 'set_cell_type': {
				const idx = readIndexParam(op, ['index', 'cell_index']);
				const newType = String(op.cell_type ?? op.new_type ?? op.target_type ?? '').toLowerCase().trim();
				if (idx === undefined || idx < 0 || idx >= notebook.cells.length) {
					recordFailure(`change_cell_type: cell_index ${String(op.index ?? op.cell_index)} is out of range (${validRangeHint(notebook.cells.length)}).`);
				} else if (newType !== 'code' && newType !== 'markdown' && newType !== 'md' && newType !== 'raw') {
					recordFailure(`change_cell_type: invalid cell_type "${String(op.cell_type ?? op.new_type ?? op.target_type)}" (expected "code", "markdown", or "raw").`);
				} else {
					pushUndoSnapshot();
					const orig = notebook.cells[idx];
					notebook.cells[idx] = normalizeNotebookCell({
						cell_type: newType,
						source: orig.source,
						metadata: orig.metadata,
						outputs: [],
						execution_count: null,
					});
					applied++;
				}
				break;
			}

			case 'update_cell_outputs': {
				const idx = readIndexParam(op, ['index', 'cell_index']);
				if (idx !== undefined && idx >= 0 && idx < notebook.cells.length && notebook.cells[idx].cell_type === 'code') {
					pushUndoSnapshot();
					notebook.cells[idx].outputs = Array.isArray(op.outputs) ? op.outputs : [];
					applied++;
				} else {
					recordFailure(`update_cell_outputs: cell_index ${String(op.index ?? op.cell_index)} is out of range or not a code cell (${validRangeHint(notebook.cells.length)}).`);
				}
				break;
			}

			case 'clear_cell_outputs':
			case 'clear_outputs': {
				const idx = readIndexParam(op, ['index', 'cell_index']);
				if (idx !== undefined && idx >= 0 && idx < notebook.cells.length) {
					pushUndoSnapshot();
					if (notebook.cells[idx].cell_type === 'code') {
						notebook.cells[idx].outputs = [];
						notebook.cells[idx].execution_count = null;
					}
					applied++;
				} else {
					recordFailure(`clear_cell_outputs: cell_index ${String(op.index ?? op.cell_index)} is out of range (${validRangeHint(notebook.cells.length)}).`);
				}
				break;
			}

			case 'clear_all_outputs': {
				pushUndoSnapshot();
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
				recordFailure(`Unknown notebook edit operation: "${rawOpType}". Supported: add_cell, insert_cell_above, insert_cell_below, remove_cell, replace_cell, move_cell, update_cell_source, duplicate_cell, change_cell_type, cut_cell, paste_cell, undo, redo, clear_cell_outputs, clear_all_outputs.`);
				break;
		}
	}

	return {
		applied,
		cellCount: notebook.cells.length,
		warnings,
		failed,
		cellsSummary: summarizeNotebookCells(notebook),
	};
}

/**
 * Searches across code and markdown cell sources (and optionally cell outputs) in a notebook.
 */
export function searchNotebookDocument(
	notebook: NbformatDocument,
	options: {
		query: string;
		isRegex?: boolean;
		caseSensitive?: boolean;
		cellType?: 'all' | 'code' | 'markdown';
		includeOutputs?: boolean;
		fromCellIndex?: number;
		direction?: 'forward' | 'backward';
	},
): NotebookSearchResult {
	const query = options.query ?? '';
	if (!query) {
		return { matches: [], total_matches: 0 };
	}

	const flags = options.caseSensitive ? 'g' : 'gi';
	let regex: RegExp;
	try {
		const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		regex = new RegExp(options.isRegex ? query : escaped, flags);
	} catch (e) {
		throw new Error(`Invalid search regex "${query}": ${e instanceof Error ? e.message : String(e)}`);
	}

	const cells = Array.isArray(notebook.cells) ? notebook.cells : [];
	const filterType = options.cellType ?? 'all';
	const includeOutputs = options.includeOutputs !== false;

	const indices: number[] = [];
	if (options.direction === 'backward') {
		const start = options.fromCellIndex !== undefined
			? Math.min(cells.length - 1, Math.max(0, options.fromCellIndex))
			: cells.length - 1;
		for (let i = start; i >= 0; i--) indices.push(i);
	} else {
		const start = options.fromCellIndex !== undefined
			? Math.max(0, Math.min(cells.length, options.fromCellIndex))
			: 0;
		for (let i = start; i < cells.length; i++) indices.push(i);
	}

	const matches: NotebookSearchMatch[] = [];
	const scanText = (text: string, cellIndex: number, cellType: 'code' | 'markdown' | 'raw', inOutput: boolean) => {
		const lines = text.split('\n');
		for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
			const line = lines[lineIdx];
			regex.lastIndex = 0;
			let m: RegExpExecArray | null;
			while ((m = regex.exec(line)) !== null) {
				matches.push({
					cell_index: cellIndex,
					cell_type: cellType,
					in_output: inOutput,
					line: lineIdx + 1,
					column: m.index + 1,
					preview: line.trim().slice(0, 140),
				});
				if (m[0].length === 0) {
					regex.lastIndex++;
				}
				if (matches.length >= 200) {
					return;
				}
			}
		}
	};

	for (const i of indices) {
		const cell = cells[i];
		if (!cell) continue;
		const cellType = cell.cell_type ?? 'code';
		if (filterType !== 'all' && cellType !== filterType) {
			continue;
		}
		scanText(sourceToText(cell.source), i, cellType, false);
		if (matches.length >= 200) break;

		if (includeOutputs && Array.isArray(cell.outputs)) {
			for (const out of cell.outputs) {
				if (!out || typeof out !== 'object') continue;
				const o = out as Record<string, unknown>;
				if (o.output_type === 'stream' && o.text) {
					scanText(sourceToText(o.text), i, cellType, true);
				} else if (o.output_type === 'error') {
					const errText = `${String(o.ename ?? '')}: ${String(o.evalue ?? '')}\n${Array.isArray(o.traceback) ? o.traceback.join('\n') : ''}`;
					scanText(errText, i, cellType, true);
				} else if (o.data && typeof o.data === 'object') {
					const data = o.data as Record<string, unknown>;
					if (data['text/plain']) {
						scanText(sourceToText(data['text/plain']), i, cellType, true);
					}
				}
				if (matches.length >= 200) break;
			}
		}
		if (matches.length >= 200) break;
	}

	return {
		matches,
		total_matches: matches.length,
	};
}

/**
 * Validates a notebook document against nbformat 4.x structure, kernelspec presence, cell schemas,
 * and execution count consistency.
 */
export function validateNotebookDocument(notebook: unknown): NotebookValidationReport {
	const issues: NotebookValidationIssue[] = [];
	if (!notebook || typeof notebook !== 'object' || Array.isArray(notebook)) {
		return {
			valid: false,
			nbformat: 'invalid',
			has_kernelspec: false,
			kernelspec_name: null,
			cell_count: 0,
			code_cells: 0,
			markdown_cells: 0,
			executed_cells: 0,
			issues: [{ severity: 'error', message: 'Root notebook value must be a JSON object.' }],
		};
	}

	const nb = notebook as Record<string, unknown>;
	const major = typeof nb.nbformat === 'number' ? nb.nbformat : null;
	const minor = typeof nb.nbformat_minor === 'number' ? nb.nbformat_minor : null;
	if (major !== 4) {
		issues.push({ severity: 'error', message: `Unsupported or missing nbformat major version: ${String(nb.nbformat)} (expected 4).` });
	}
	if (minor === null || minor < 0) {
		issues.push({ severity: 'warning', message: `Missing or invalid nbformat_minor: ${String(nb.nbformat_minor)}.` });
	}

	const metadata = (nb.metadata && typeof nb.metadata === 'object' ? nb.metadata : {}) as Record<string, unknown>;
	const kernelspec = (metadata.kernelspec && typeof metadata.kernelspec === 'object' ? metadata.kernelspec : null) as Record<string, unknown> | null;
	const hasKernelspec = Boolean(kernelspec && (kernelspec.name || kernelspec.display_name));
	const kernelspecName = kernelspec ? String(kernelspec.display_name ?? kernelspec.name ?? '') || null : null;
	if (!hasKernelspec) {
		issues.push({ severity: 'warning', message: 'Notebook metadata is missing kernelspec.' });
	}

	if (!Array.isArray(nb.cells)) {
		issues.push({ severity: 'error', message: 'Notebook is missing a valid "cells" array.' });
		return {
			valid: false,
			nbformat: major !== null ? `${major}.${minor ?? 0}` : 'unknown',
			has_kernelspec: hasKernelspec,
			kernelspec_name: kernelspecName,
			cell_count: 0,
			code_cells: 0,
			markdown_cells: 0,
			executed_cells: 0,
			issues,
		};
	}

	let codeCells = 0;
	let markdownCells = 0;
	let executedCells = 0;

	for (let i = 0; i < nb.cells.length; i++) {
		const rawCell = nb.cells[i];
		if (!rawCell || typeof rawCell !== 'object' || Array.isArray(rawCell)) {
			issues.push({ severity: 'error', cell_index: i, message: `Cell ${i} is not an object.` });
			continue;
		}
		const cell = rawCell as Record<string, unknown>;
		const cellType = cell.cell_type;
		if (cellType === 'code') {
			codeCells++;
			if (!Array.isArray(cell.outputs)) {
				issues.push({ severity: 'error', cell_index: i, message: `Code cell ${i} is missing "outputs" array.` });
			}
			if (cell.execution_count !== null && cell.execution_count !== undefined && typeof cell.execution_count !== 'number') {
				issues.push({ severity: 'error', cell_index: i, message: `Code cell ${i} has non-numeric execution_count.` });
			} else if (typeof cell.execution_count === 'number') {
				executedCells++;
			}
		} else if (cellType === 'markdown' || cellType === 'raw') {
			if (cellType === 'markdown') markdownCells++;
			if ('outputs' in cell) {
				issues.push({ severity: 'error', cell_index: i, message: `Non-code (${cellType}) cell ${i} must not contain "outputs" field.` });
			}
			if ('execution_count' in cell) {
				issues.push({ severity: 'error', cell_index: i, message: `Non-code (${cellType}) cell ${i} must not contain "execution_count" field.` });
			}
		} else {
			issues.push({ severity: 'error', cell_index: i, message: `Cell ${i} has invalid cell_type "${String(cellType)}".` });
		}

		if (typeof cell.source !== 'string' && !Array.isArray(cell.source)) {
			issues.push({ severity: 'error', cell_index: i, message: `Cell ${i} is missing a valid "source" string or string[].` });
		}
	}

	return {
		valid: !issues.some(i => i.severity === 'error'),
		nbformat: major !== null ? `${major}.${minor ?? 0}` : 'unknown',
		has_kernelspec: hasKernelspec,
		kernelspec_name: kernelspecName,
		cell_count: nb.cells.length,
		code_cells: codeCells,
		markdown_cells: markdownCells,
		executed_cells: executedCells,
		issues,
	};
}

/**
 * Compacts huge inline base64 blobs (e.g. PNG/JPEG outputs inside .ipynb files) while preserving
 * exact line breaks and line numbering so read_file never truncates a 204-line notebook at line 17.
 */
export function compactBase64BlobsPreservingLines(text: string): string {
	return text.split('\n').map(line => {
		if (line.length <= 600) {
			return line;
		}
		// Match JSON image/media base64 strings such as `"image/png": "iVBORw0KGgo..."`
		let compacted = line.replace(
			/("(?:image\/[a-zA-Z0-9.+-]+|application\/pdf|audio\/[a-zA-Z0-9.+-]+)"\s*:\s*")([A-Za-z0-9+/=\s\\n]{500,})(")/g,
			(_m, prefix: string, payload: string, suffix: string) => `${prefix}<base64 omitted: ${payload.length} chars>${suffix}`,
		);
		// Match data:image/...;base64,... URIs
		compacted = compacted.replace(
			/(data:[a-zA-Z0-9.+/-]+;base64,)([A-Za-z0-9+/=]{500,})/g,
			(_m, prefix: string, payload: string) => `${prefix}<base64 omitted: ${payload.length} chars>`,
		);
		// Match standalone base64 chunk lines inside nbformat `"image/png": ["iVBOR...", ...]` arrays
		if (compacted.length > 1000 && /^\s*"[A-Za-z0-9+/=]{800,}\\?n?",?\s*$/.test(compacted)) {
			const indent = compacted.match(/^\s*/)?.[0] ?? '';
			const trailingComma = compacted.trimEnd().endsWith(',') ? ',' : '';
			return `${indent}"<base64 line omitted: ${compacted.trim().length} chars>"${trailingComma}`;
		}
		return compacted;
	}).join('\n');
}
