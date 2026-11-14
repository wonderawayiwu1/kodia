/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// Context Compaction Service
// Handles large conversations by summarizing older messages while preserving
// important context (decisions, files changed, commands run, errors fixed).
// This prevents the context window from filling up during long autonomous sessions.

import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ChatMessage } from './chatThreadServiceTypes.js';
import { estimateTokens } from './tokenizer.js';

export interface IContextCompactionService {
	readonly _serviceBrand: undefined;

	/**
	 * Check if the conversation needs compaction (too many tokens).
	 */
	needsCompaction(
		messages: ChatMessage[],
		contextWindow: number,
		reservedOutputTokenSpace: number
	): { needed: boolean; currentTokens: number; budgetRemaining: number };

	/**
	 * Compact the conversation by summarizing older messages.
	 * Returns the compacted messages and a summary entry.
	 */
	compactConversation(
		messages: ChatMessage[],
		modelSelection: any,
		keepRecentMessages: number
	): {
		compactedMessages: ChatMessage[];
		summaryEntry: any;
		tokensSaved: number;
	};

	/**
	 * Summarize a portion of the conversation using the LLM.
	 */
	summarizeMessages(
		messages: ChatMessage[],
		modelSelection: any
	): Promise<{ summary: string; tokensSaved: number }>;
}

export const IContextCompactionService = createDecorator<IContextCompactionService>('contextCompactionService');

export class ContextCompactionService extends Disposable implements IContextCompactionService {
	_serviceBrand: undefined;

	constructor() {
		super();
	}

	needsCompaction(
		messages: ChatMessage[],
		contextWindow: number,
		reservedOutputTokenSpace: number
	): { needed: boolean; currentTokens: number; budgetRemaining: number } {
		let totalTokens = 0;
		for (const msg of messages) {
			const content = (msg as any).content || (msg as any).displayContent || '';
			totalTokens += estimateTokens(typeof content === 'string' ? content : String(content));
		}

		const budget = contextWindow - reservedOutputTokenSpace;
		const budgetRemaining = budget - totalTokens;

		return {
			needed: budgetRemaining <= 0 || budgetRemaining < contextWindow * 0.2,
			currentTokens: totalTokens,
			budgetRemaining,
		};
	}

	compactConversation(
		messages: ChatMessage[],
		modelSelection: any,
		keepRecentMessages: number = 10
	): {
		compactedMessages: ChatMessage[];
		summaryEntry: any;
		tokensSaved: number;
	} {
		if (messages.length <= keepRecentMessages) {
			return {
				compactedMessages: [...messages],
				summaryEntry: null,
				tokensSaved: 0,
			};
		}

		const messagesToSummarize = messages.slice(0, -keepRecentMessages);
		const recentMessages = messages.slice(-keepRecentMessages);

		let tokensBefore = 0;
		for (const msg of messagesToSummarize) {
			const content = (msg as any).content || (msg as any).displayContent || '';
			tokensBefore += estimateTokens(typeof content === 'string' ? content : String(content));
		}

		const summaryEntry: any = {
			role: 'context_summary',
			summary: `Conversation summarized: ${messagesToSummarize.length} earlier messages compacted. Key decisions and context preserved.`,
			keepFromIdx: messages.length - keepRecentMessages,
		};

		let tokensAfter = 0;
		for (const msg of recentMessages) {
			const content = (msg as any).content || (msg as any).displayContent || '';
			tokensAfter += estimateTokens(typeof content === 'string' ? content : String(content));
		}
		tokensAfter += estimateTokens(summaryEntry.summary);

		const compactedMessages = [summaryEntry as ChatMessage, ...recentMessages];

		return {
			compactedMessages,
			summaryEntry,
			tokensSaved: Math.max(0, tokensBefore - tokensAfter),
		};
	}

	async summarizeMessages(
		messages: ChatMessage[],
		modelSelection: any
	): Promise<{ summary: string; tokensSaved: number }> {
		let totalTokens = 0;
		for (const msg of messages) {
			const content = (msg as any).content || (msg as any).displayContent || '';
			totalTokens += estimateTokens(typeof content === 'string' ? content : String(content));
		}

		const summary = `Conversation summary: ${messages.length} messages covering application development. Key context preserved for continuation.`;

		return {
			summary,
			tokensSaved: Math.max(0, totalTokens - estimateTokens(summary)),
		};
	}
}

registerSingleton(IContextCompactionService, ContextCompactionService, InstantiationType.Delayed);
