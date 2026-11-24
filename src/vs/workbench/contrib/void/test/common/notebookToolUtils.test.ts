/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import {
	applyNotebookEditOperations,
	buildNbformatDocument,
	compactBase64BlobsPreservingLines,
	createNotebookEditHistoryState,
	normalizeNotebookCell,
	normalizeNotebookSource,
	parseNotebookArrayParam,
	searchNotebookDocument,
	validateNotebookDocument,
} from '../../common/notebookToolUtils.js';

suite('Kodia Native Notebook Tool Utils', () => {
	test('parseNotebookArrayParam accepts real arrays, JSON strings, and single objects', () => {
		const arr = [{ cell_type: 'markdown', source: '# Hi' }];
		assert.deepStrictEqual(parseNotebookArrayParam('cells', arr), arr);
		assert.deepStrictEqual(parseNotebookArrayParam('cells', JSON.stringify(arr)), arr);
		assert.deepStrictEqual(parseNotebookArrayParam('cells', { cell_type: 'code', source: 'x = 1' }), [{ cell_type: 'code', source: 'x = 1' }]);
		assert.deepStrictEqual(parseNotebookArrayParam('cells', ''), []);
		assert.throws(() => parseNotebookArrayParam('cells', '{bad json'), /Invalid cells/);
		assert.throws(() => parseNotebookArrayParam('cells', 42), /Invalid cells/);
	});

	test('normalizeNotebookSource produces canonical nbformat line arrays', () => {
		assert.deepStrictEqual(normalizeNotebookSource('print(1)\nprint(2)'), ['print(1)\n', 'print(2)']);
		assert.deepStrictEqual(normalizeNotebookSource('a\r\nb'), ['a\n', 'b']);
		assert.deepStrictEqual(normalizeNotebookSource(['x = 1\n', 'x + 2']), ['x = 1\n', 'x + 2']);
		assert.deepStrictEqual(normalizeNotebookSource(''), []);
	});

	test('normalizeNotebookCell enforces strict nbformat 4.5 for markdown vs code cells', () => {
		const md = normalizeNotebookCell({ type: 'markdown', content: '# Title\nBody', outputs: [], execution_count: null });
		assert.strictEqual(md.cell_type, 'markdown');
		assert.deepStrictEqual(md.source, ['# Title\n', 'Body']);
		assert.strictEqual('outputs' in md, false, 'Markdown cells must not contain outputs');
		assert.strictEqual('execution_count' in md, false, 'Markdown cells must not contain execution_count');

		const code = normalizeNotebookCell({ cell_type: 'code', source: 'print("hello")' });
		assert.strictEqual(code.cell_type, 'code');
		assert.deepStrictEqual(code.source, ['print("hello")']);
		assert.deepStrictEqual(code.outputs, []);
		assert.strictEqual(code.execution_count, null);
	});

	test('buildNbformatDocument builds a valid nbformat 4.5 notebook in one shot', () => {
		const nb = buildNbformatDocument([
			{ cell_type: 'markdown', source: '# Kodia Test' },
			{ cell_type: 'code', source: 'print("Hello from Kodia!")' },
		], { pythonVersion: '3.11.9', kernelDisplayName: 'Python 3.11.9' });

		assert.strictEqual(nb.nbformat, 4);
		assert.strictEqual(nb.nbformat_minor, 5);
		assert.strictEqual(nb.cells.length, 2);
		assert.strictEqual(nb.cells[0].cell_type, 'markdown');
		assert.strictEqual('outputs' in nb.cells[0], false);
		assert.strictEqual(nb.cells[1].cell_type, 'code');
		assert.deepStrictEqual(nb.cells[1].outputs, []);
		assert.strictEqual((nb.metadata.kernelspec as any).display_name, 'Python 3.11.9');
	});

	test('applyNotebookEditOperations accepts cell_index AND index consistently, plus insert_above/below, cut/paste, undo/redo, and clear out-of-range errors', () => {
		const nb = buildNbformatDocument([
			{ cell_type: 'markdown', source: '# Title' },
			{ cell_type: 'code', source: 'a = 1', outputs: [{ output_type: 'stream', name: 'stdout', text: '1\n' }], execution_count: 1 },
		]);
		const history = createNotebookEditHistoryState();

		const res = applyNotebookEditOperations(nb, [
			{ type: 'insert_cell_below', cell_index: 1, cell: { cell_type: 'code', source: 'b = 2' } },
			{ type: 'insert_cell_above', cell_index: 0, cell: { cell_type: 'markdown', source: '# Top' } },
			{ type: 'update_cell_source', cell_index: 2, source: 'a = 10' },
			{ type: 'duplicate_cell', cell_index: 2 },
			{ type: 'change_cell_type', cell_index: 3, cell_type: 'markdown' },
			{ type: 'cut_cell', cell_index: 3 },
			{ type: 'paste_cell', cell_index: 0 },
			{ type: 'clear_all_outputs' },
		], history);

		assert.strictEqual(res.applied, 8);
		assert.strictEqual(res.failed.length, 0);
		assert.strictEqual(nb.cells.length, 5);
		assert.strictEqual(nb.cells[0].cell_type, 'markdown');
		assert.deepStrictEqual(nb.cells[0].source, ['a = 10']);
		assert.strictEqual(res.cellsSummary.length, 5);

		// Undo clear_all_outputs + paste_cell -> back to 4 cells; redo paste_cell -> 5 cells
		const undoRes = applyNotebookEditOperations(nb, [{ type: 'undo' }, { type: 'undo' }], history);
		assert.strictEqual(undoRes.applied, 2);
		assert.strictEqual(nb.cells.length, 4);
		const redoRes = applyNotebookEditOperations(nb, [{ type: 'redo' }], history);
		assert.strictEqual(redoRes.applied, 1);
		assert.strictEqual(nb.cells.length, 5);

		// Clear out-of-range error message
		const badRes = applyNotebookEditOperations(nb, [{ type: 'replace_cell', cell_index: 99, source: 'x = 1' }], history);
		assert.strictEqual(badRes.applied, 0);
		assert.strictEqual(badRes.failed.length, 1);
		assert.match(badRes.failed[0].error, /out of range.*valid: 0\.\.4; notebook has 5 cells/);
	});

	test('searchNotebookDocument finds matches in markdown, code, and outputs (forward & backward)', () => {
		const nb = buildNbformatDocument([
			{ cell_type: 'markdown', source: '# Kodia Analysis\nSummary section' },
			{ cell_type: 'code', source: 'x = "Kodia"\nprint(x)', outputs: [{ output_type: 'stream', name: 'stdout', text: 'Kodia output\n' }], execution_count: 1 },
			{ cell_type: 'markdown', source: 'Final Kodia note' },
		]);

		const all = searchNotebookDocument(nb, { query: 'kodia' });
		assert.strictEqual(all.total_matches, 4);
		assert.strictEqual(all.matches[0].cell_index, 0);
		assert.strictEqual(all.matches[1].cell_index, 1);
		assert.strictEqual(all.matches[2].in_output, true);
		assert.strictEqual(all.matches[3].cell_index, 2);

		const mdOnly = searchNotebookDocument(nb, { query: 'Kodia', caseSensitive: true, cellType: 'markdown' });
		assert.strictEqual(mdOnly.total_matches, 2);

		const backward = searchNotebookDocument(nb, { query: 'Kodia', direction: 'backward', fromCellIndex: 2, includeOutputs: false });
		assert.deepStrictEqual(backward.matches.map(m => m.cell_index), [2, 1, 0]);
	});

	test('validateNotebookDocument detects valid and invalid nbformat notebooks', () => {
		const validNb = buildNbformatDocument([
			{ cell_type: 'markdown', source: '# OK' },
			{ cell_type: 'code', source: '1 + 1', execution_count: 1, outputs: [] },
		]);
		const ok = validateNotebookDocument(validNb);
		assert.strictEqual(ok.valid, true);
		assert.strictEqual(ok.executed_cells, 1);
		assert.strictEqual(ok.issues.length, 0);

		const brokenNb = {
			nbformat: 4,
			nbformat_minor: 5,
			metadata: {},
			cells: [{ cell_type: 'markdown', source: '# Bad', outputs: [], execution_count: null }],
		};
		const bad = validateNotebookDocument(brokenNb);
		assert.strictEqual(bad.valid, false);
		assert.ok(bad.issues.some(i => i.message.includes('must not contain "outputs"')));
	});

	test('compactBase64BlobsPreservingLines compacts giant PNG lines while preserving exact line count', () => {
		const bigPng = 'A'.repeat(20000);
		const raw = [
			'{',
			'  "cells": [',
			`    { "image/png": "${bigPng}" }`,
			'  ]',
			'}',
		].join('\n');
		const compacted = compactBase64BlobsPreservingLines(raw);
		assert.strictEqual(compacted.split('\n').length, 5);
		assert.ok(compacted.length < 250);
		assert.match(compacted, /<base64 omitted: 20000 chars>/);
	});
});
