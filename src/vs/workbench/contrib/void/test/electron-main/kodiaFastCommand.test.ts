/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { KodiaOpsMainService } from '../../electron-main/kodiaOpsMainService.js';

suite('Kodia - Ultra-Fast Native Command Engine', function () {
	this.timeout(15_000);
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('executes commands rapidly with exact exit codes and combined stdout/stderr', async () => {
		const svc = disposables.add(new KodiaOpsMainService());

		const r1 = await svc.execFastCommand({
			execId: 'fast-1',
			command: 'node -e "console.log(\'hello_fast\'); console.error(\'warn_fast\')"',
		});
		assert.strictEqual(r1.exitCode, 0);
		assert.strictEqual(r1.timedOut, false);
		assert.ok(r1.output.includes('hello_fast'));
		assert.ok(r1.output.includes('warn_fast'));
		assert.ok(r1.durationMs < 5000, `expected fast execution, got ${r1.durationMs}ms`);

		const rFail = await svc.execFastCommand({
			execId: 'fast-2',
			command: 'node -e "process.exit(7)"',
		});
		assert.strictEqual(rFail.exitCode, 7);
		assert.strictEqual(rFail.timedOut, false);
	});

	test('enforces inactivity timeout cleanly without hanging', async () => {
		const svc = disposables.add(new KodiaOpsMainService());
		const r = await svc.execFastCommand({
			execId: 'fast-timeout',
			command: 'node -e "setTimeout(() => {}, 10000)"',
			inactiveTimeoutMs: 1100,
		});
		assert.strictEqual(r.timedOut, true);
		assert.strictEqual(r.exitCode, 124);
	});
});
