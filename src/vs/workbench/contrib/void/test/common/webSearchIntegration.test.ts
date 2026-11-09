/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { availableTools } from '../../common/prompt/prompts.js';
import { approvalTypeOfBuiltinToolName } from '../../common/toolsServiceTypes.js';

suite('Web Search Integration - Tool Availability', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('web_search is available in Agent mode', () => {
		const tools = availableTools('agent', undefined);
		assert.ok(tools !== undefined);
		assert.ok(tools?.some(t => t.name === 'web_search'), 'web_search should be available in Agent mode');
	});

	test('web_search is available in Gather mode', () => {
		const tools = availableTools('gather', undefined);
		assert.ok(tools !== undefined);
		assert.ok(tools?.some(t => t.name === 'web_search'), 'web_search should be available in Gather mode');
	});

	test('web_search is NOT available in Normal mode', () => {
		const tools = availableTools('normal', undefined);
		assert.ok(tools === undefined || tools.length === 0);
	});

	test('web_search has correct parameters', () => {
		const tools = availableTools('agent', undefined);
		const webSearchTool = tools?.find(t => t.name === 'web_search');
		assert.ok(webSearchTool !== undefined);
		assert.ok(webSearchTool?.params?.query);
		assert.strictEqual(webSearchTool?.params?.query?.description, 'The search query.');
		assert.ok(webSearchTool?.params?.max_results);
		assert.strictEqual(webSearchTool?.params?.max_results?.description, 'Optional. Maximum number of results to return (1-20). Defaults to 10.');
	});
});

suite('Web Search Integration - Approval Flow', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('approvalTypeOfBuiltinToolName maps web_search to "web pages"', () => {
		assert.strictEqual(approvalTypeOfBuiltinToolName['web_search'], 'web pages');
	});

	test('web_search is available in Gather mode but requires approval', () => {
		// web_search is in readOnlyToolsNeedingApproval, so it's available but needs approval in Gather mode
		const tools = availableTools('gather', undefined);
		assert.ok(tools !== undefined);
		assert.ok(tools?.some(t => t.name === 'web_search'), 'web_search should be available in Gather mode');
		// Confirm it requires approval via approvalTypeOfBuiltinToolName
		assert.strictEqual(approvalTypeOfBuiltinToolName['web_search'], 'web pages');
	});
});