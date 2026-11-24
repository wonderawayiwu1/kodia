/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import {
	applyNotebookEditOperations,
	buildNbformatDocument,
	normalizeNotebookCell,
	normalizeNotebookSource,
	parseNotebookArrayParam,
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

	test('applyNotebookEditOperations supports add, update, duplicate, change_cell_type, move, delete, clear_all_outputs and aliases', () => {
		const nb = buildNbformatDocument([
			{ cell_type: 'markdown', source: '# Title' },
			{ cell_type: 'code', source: 'a = 1', outputs: [{ output_type: 'stream', name: 'stdout', text: '1\n' }], execution_count: 1 },
		]);

		const res = applyNotebookEditOperations(nb, [
			{ type: 'add_cell', index: 2, cell: { cell_type: 'code', source: 'b = 2' } },
			{ type: 'edit', index: 1, source: 'a = 10' },
			{ type: 'duplicate_cell', index: 1 },
			{ type: 'change_cell_type', index: 2, cell_type: 'markdown' },
			{ type: 'move_cell', from_index: 3, to_index: 1 },
			{ type: 'clear_all_outputs' },
			{ type: 'delete', index: 3 },
		]);

		assert.strictEqual(res.applied, 7);
		assert.strictEqual(res.warnings.length, 0);
		assert.strictEqual(nb.cells.length, 3);
		assert.strictEqual(nb.cells[0].cell_type, 'markdown');
		assert.deepStrictEqual(nb.cells[1].source, ['b = 2']);
		assert.deepStrictEqual(nb.cells[2].source, ['a = 10']);
		assert.deepStrictEqual(nb.cells[2].outputs, []);
		assert.strictEqual(nb.cells[2].execution_count, null);
	});
});
