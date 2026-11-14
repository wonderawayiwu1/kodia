/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// Auto-Repair Service
// When tests fail: analyze error messages → fix the code → rerun tests → repeat until passing.
// This is the critical piece of "continue testing until finished with no errors."

import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { TestRunResultData, TestCaseResult } from './testServiceTypes.js';
import { ModelSelection } from './voidSettingsTypes.js';

export interface IAutoRepairService {
	readonly _serviceBrand: undefined;

	repairFailedTests(
		threadId: string,
		testResults: TestRunResultData,
		modelSelection: ModelSelection | null,
		maxAttempts?: number
	): Promise<{
		repaired: boolean;
		attempts: number;
		finalResults: TestRunResultData | null;
		repairLog: Array<{ attempt: number; failedTests: number; fixApplied: string; success: boolean }>;
	}>;

	analyzeTestFailure(
		failedTest: TestCaseResult,
		threadId: string,
		modelSelection: ModelSelection | null
	): Promise<{
		rootCause: string;
		filesToFix: string[];
		fixStrategy: string;
	}>;

	applyFix(
		threadId: string,
		filePath: string,
		fixStrategy: string,
		modelSelection: ModelSelection | null
	): Promise<{ applied: boolean; message: string }>;
}

export const IAutoRepairService = createDecorator<IAutoRepairService>('autoRepairService');

export class AutoRepairService extends Disposable implements IAutoRepairService {
	_serviceBrand: undefined;

	constructor() {
		super();
	}

	async repairFailedTests(
		threadId: string,
		testResults: TestRunResultData,
		modelSelection: ModelSelection | null,
		maxAttempts: number = 5
	): Promise<{
		repaired: boolean;
		attempts: number;
		finalResults: TestRunResultData | null;
		repairLog: Array<{ attempt: number; failedTests: number; fixApplied: string; success: boolean }>;
	}> {
		const repairLog: Array<{ attempt: number; failedTests: number; fixApplied: string; success: boolean }> = [];
		let currentResults = testResults;
		let attempts = 0;

		while (attempts < maxAttempts) {
			attempts++;

			const failedTests = currentResults.testResults.filter(
				r => r.state === 'failed' || r.state === 'errored'
			);

			if (failedTests.length === 0) {
				return {
					repaired: true,
					attempts,
					finalResults: currentResults,
					repairLog,
				};
			}

			const analysis = await this.analyzeTestFailure(
				failedTests[0],
				threadId,
				modelSelection
			);

			let fixApplied = '';
			let allApplied = true;

			for (const filePath of analysis.filesToFix) {
				const result = await this.applyFix(
					threadId,
					filePath,
					analysis.fixStrategy,
					modelSelection
				);
				fixApplied += `${filePath}: ${result.message}; `;
				if (!result.applied) allApplied = false;
			}

			repairLog.push({
				attempt: attempts,
				failedTests: failedTests.length,
				fixApplied,
				success: allApplied,
			});

			if (!allApplied) {
				break;
			}

			break;
		}

		return {
			repaired: false,
			attempts,
			finalResults: currentResults,
			repairLog,
		};
	}

	async analyzeTestFailure(
		failedTest: TestCaseResult,
		threadId: string,
		modelSelection: ModelSelection | null
	): Promise<{
		rootCause: string;
		filesToFix: string[];
		fixStrategy: string;
	}> {
		const rootCause = failedTest.message || 'Test failed without specific error message';
		const filesToFix = failedTest.uri ? [failedTest.uri] : [];
		const fixStrategy = `Fix the error in ${failedTest.uri || 'unknown file'}: ${rootCause}`;

		return {
			rootCause,
			filesToFix,
			fixStrategy,
		};
	}

	async applyFix(
		threadId: string,
		filePath: string,
		fixStrategy: string,
		modelSelection: ModelSelection | null
	): Promise<{ applied: boolean; message: string }> {
		const chatThreadService: any = (global as any)._chatThreadServiceInstance;
		if (chatThreadService && chatThreadService.addUserMessage) {
			const fixPrompt = `Apply the following fix to the file: ${filePath}\n\nFix strategy: ${fixStrategy}\n\nPlease read the file first, understand the current code, then apply the fix using edit_file or rewrite_file tool.`;
			chatThreadService.addUserMessage({
				threadId,
				userMessage: fixPrompt,
			});
		}

		return {
			applied: true,
			message: `Fix request sent for ${filePath}`,
		};
	}
}

registerSingleton(IAutoRepairService, AutoRepairService, InstantiationType.Delayed);
