/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { defaultGlobalSettings, GlobalSettings } from '../../common/voidSettingsTypes.js';
import { defaultAutonomyMode, autonomyModes } from '../../common/autonomyPolicy.js';

suite('Kodia - autonomy mode settings defaults', () => {

	test('Agent is the default autonomy mode for new installations', () => {
		assert.strictEqual(defaultGlobalSettings.agentAutonomyMode, 'agent');
		assert.strictEqual(defaultGlobalSettings.agentAutonomyMode, defaultAutonomyMode);
	});

	test('default autonomy operation policy is empty (no per-operation overrides)', () => {
		assert.deepStrictEqual(defaultGlobalSettings.autonomyOperationPolicy, {});
	});

	test('default global settings shape includes the autonomy mode', () => {
		const s: GlobalSettings = defaultGlobalSettings;
		assert.ok('agentAutonomyMode' in s);
		assert.ok('autonomyOperationPolicy' in s);
		assert.deepStrictEqual(autonomyModes, ['assist', 'agent', 'autonomous']);
		assert.ok(autonomyModes.includes(s.agentAutonomyMode));
	});
});
