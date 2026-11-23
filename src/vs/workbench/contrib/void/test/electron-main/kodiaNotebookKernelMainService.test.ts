/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { KodiaNotebookKernelMainService } from '../../electron-main/kodiaNotebookKernelMainService.js';

suite('Kodia - Native Python Notebook Kernel Engine', function () {
	this.timeout(30_000);
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('discovers real Python, runs stateful cells, captures stdout, matplotlib PNG, tracebacks, and restarts cleanly', async function () {
		const svc = disposables.add(new KodiaNotebookKernelMainService());
		const kernels = await svc.discoverKernels();
		if (kernels.length === 0) {
			this.skip();
		}

		const py = kernels[0];
		assert.ok(py.pythonPath.length > 0);
		assert.ok(py.version.length > 0);

		const nbUri = `file:///kodia-test-${Date.now()}.ipynb`;

		// 1. stdout + variable definition
		const r1 = await svc.executeCell({
			notebookUri: nbUri,
			pythonPath: py.pythonPath,
			code: 'print("Hello from Kodia!")\nbase_val = 40',
		});
		assert.strictEqual(r1.success, true);
		assert.strictEqual(r1.executionCount, 1);
		assert.ok(r1.outputs.some(o => o.items.some(i => i.mime === 'application/vnd.code.notebook.stdout' && i.data.includes('Hello from Kodia!'))));

		// 2. Persistent state + trailing expression rich output
		const r2 = await svc.executeCell({
			notebookUri: nbUri,
			pythonPath: py.pythonPath,
			code: 'base_val + 2',
		});
		assert.strictEqual(r2.success, true);
		assert.strictEqual(r2.executionCount, 2);
		assert.ok(r2.outputs.some(o => o.items.some(i => i.mime === 'text/plain' && i.data.trim() === '42')));

		// 3. Variables explorer inspection
		const vars = await svc.getVariables(nbUri);
		assert.ok(vars.some(v => v.name === 'base_val' && v.value === '40'));

		// 4. Real error + traceback display
		const rErr = await svc.executeCell({
			notebookUri: nbUri,
			pythonPath: py.pythonPath,
			code: '1 / 0',
		});
		assert.strictEqual(rErr.success, false);
		assert.strictEqual(rErr.errorName, 'ZeroDivisionError');
		assert.ok(rErr.outputs.some(o => o.items.some(i => i.mime === 'application/vnd.code.notebook.error' && i.data.includes('ZeroDivisionError'))));

		// 5. Real matplotlib chart -> inline PNG output (when installed)
		if (py.hasMatplotlib) {
			const rPlot = await svc.executeCell({
				notebookUri: nbUri,
				pythonPath: py.pythonPath,
				code: 'import matplotlib.pyplot as plt\nplt.plot([1, 2, 3], [2, 4, 9])\nplt.title("Kodia Test")\nplt.show()',
			});
			assert.strictEqual(rPlot.success, true);
			const pngItem = rPlot.outputs.flatMap(o => o.items).find(i => i.mime === 'image/png' && i.isBase64);
			assert.ok(pngItem, 'matplotlib plot should produce an inline image/png output');
			const pngBuf = Buffer.from(pngItem.data, 'base64');
			// Verify real PNG magic signature (89 50 4E 47)
			assert.strictEqual(pngBuf[0], 0x89);
			assert.strictEqual(pngBuf[1], 0x50);
			assert.strictEqual(pngBuf[2], 0x4e);
			assert.strictEqual(pngBuf[3], 0x47);
		}

		// 6. Restart kernel clears variables and resets executionCount to 1
		await svc.restartKernel(nbUri);
		const rAfterRestart = await svc.executeCell({
			notebookUri: nbUri,
			pythonPath: py.pythonPath,
			code: 'base_val',
		});
		assert.strictEqual(rAfterRestart.success, false);
		assert.strictEqual(rAfterRestart.executionCount, 1);
		assert.strictEqual(rAfterRestart.errorName, 'NameError');

		await svc.disposeKernel(nbUri);
	});
});
