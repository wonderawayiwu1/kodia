/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { defaultModelsOfProvider, VoidStaticModelInfo } from './modelCapabilities.js';
import { DetectedModel, withoutSnapshotSuffix } from './providerModels.js';
import { ProviderName } from './voidSettingsTypes.js';

// OpenRouter's public list of models, no key needed, the most used last week first (tokens processed):
// https://openrouter.ai/docs/api/api-reference/models/get-models
export const OPENROUTER_MODELS_BY_USAGE_URL = 'https://openrouter.ai/api/v1/models?sort=top-weekly';

// the fields Kodia reads
export type OpenRouterModel = {
	id: string;
	context_length: number;
	architecture?: { input_modalities?: string[]; output_modalities?: string[] };
	pricing?: { prompt?: string; completion?: string; input_cache_read?: string; input_cache_write?: string; [kind: string]: string | undefined };
	top_provider?: { max_completion_tokens?: number | null } | null;
	supported_parameters?: string[];
	expiration_date?: string | null;
	benchmarks?: { artificial_analysis?: { coding_index?: number | null } | null } | null;
};

type DetectedOpenRouterModel = DetectedModel & { capabilities: VoidStaticModelInfo };

// one of OpenRouter's free models: Kodia lists them first, apart from the paid ones
export const isFreeOpenRouterModel = (
	providerName: ProviderName,
	modelName: string,
	capabilities?: Partial<VoidStaticModelInfo>,
) => {
	if (providerName !== 'openRouter') return false;
	if (modelName.endsWith(':free') || modelName === 'openrouter/free') return true;
	if (capabilities?.cost && capabilities.cost.input === 0 && capabilities.cost.output === 0) return true;
	return false;
};

const MIN_CONTEXT_WINDOW = 32_768; // the agent's system message and tools alone take several thousand tokens
const MIN_FREE_CONTEXT_WINDOW = 4_096; // allow all usable free chat/coding models on OpenRouter
const MIN_OUTPUT_TOKENS = 16_384; // enough to write a file
const EXPIRES_SOON_MS = 7 * 24 * 60 * 60 * 1000;

// every price is 0 (OpenRouter's routers have a price of -1: it depends on the model they pick)
const isFree = (model: OpenRouterModel) => {
	if (model.id.endsWith(':free') || model.id === 'openrouter/free') return true;
	const prompt = model.pricing?.prompt;
	const completion = model.pricing?.completion;
	if (prompt !== undefined && completion !== undefined && Number(prompt) === 0 && Number(completion) === 0) {
		const prices = Object.values(model.pricing ?? {});
		return prices.every(price => price === undefined || Number(price) === 0);
	}
	const prices = Object.values(model.pricing ?? {});
	return prices.length > 0 && prices.every(price => price === undefined || Number(price) === 0);
};

// OpenRouter's prices are per token, Kodia's per million tokens
const perMillion = (price: string | undefined) => price === undefined || Number.isNaN(Number(price)) ? undefined : Number(price) * 1_000_000;

const capabilitiesOf = (model: OpenRouterModel): VoidStaticModelInfo => {
	const cacheRead = perMillion(model.pricing?.input_cache_read);
	const cacheWrite = perMillion(model.pricing?.input_cache_write);
	const supportsNativeTools = !!model.supported_parameters?.includes('tools') || model.id === 'openrouter/free';
	return {
		contextWindow: Math.max(model.context_length || 32_768, 4_096),
		reservedOutputTokenSpace: model.top_provider?.max_completion_tokens ?? null,
		supportsSystemMessage: 'system-role',
		specialToolFormat: supportsNativeTools ? 'openai-style' : undefined,
		supportsFIM: false,
		supportsVision: !!model.architecture?.input_modalities?.includes('image'),
		// OpenRouter doesn't say whether reasoning can be turned off: the model decides how much to think
		reasoningCapabilities: model.supported_parameters?.includes('reasoning')
			? { supportsReasoning: true, canTurnOffReasoning: true, canIOReasoning: true, reasoningSlider: { type: 'adaptive' } }
			: false,
		cost: {
			input: isFree(model) ? 0 : (perMillion(model.pricing?.prompt) ?? 0),
			output: isFree(model) ? 0 : (perMillion(model.pricing?.completion) ?? 0),
			...cacheRead !== undefined ? { cache_read: cacheRead } : {},
			...cacheWrite !== undefined ? { cache_write: cacheWrite } : {},
		},
		downloadable: false,
	};
};

// free models Kodia can't use in strict coding-only list (kept for backwards-compatible freeCodingModelsOfOpenRouter)
const unusableFreeModel = /^thinkingmachines\/|^google\/gemma-/;

// pure non-chat endpoints (TTS, speech, voice, audio-only, embeddings, rerankers, image-gen-only)
const nonChatModelIdPattern = /(?:^|\/|-)(?:voxtral|whisper|audio|voice|speech|tts|transcri|realtime|embed|embedding|rerank|fish-audio|heygen)(?:$|\/|-|\d)/i;

const isUsableFreeChatModel = (model: OpenRouterModel, now: number) => {
	if (!isFree(model)) return false;
	if (model.id === 'openrouter/auto') return false;
	if (nonChatModelIdPattern.test(model.id)) return false;
	// Allow openrouter/free auto-router and all free text-output chat/multimodal models
	if (model.id !== 'openrouter/free') {
		const { input_modalities = [], output_modalities = [] } = model.architecture ?? {};
		if (input_modalities.length > 0 && !input_modalities.includes('text')) return false;
		if (output_modalities.length > 0 && !output_modalities.includes('text')) return false;
		if (model.context_length && model.context_length < MIN_FREE_CONTEXT_WINDOW) return false;
	}
	// Skip only models already expired
	if (model.expiration_date && Date.parse(model.expiration_date) <= now) return false;
	return true;
};

// a model that can run Kodia's agent: chat (text out, with or without images in), not a voice model, tool calling,
// room for the agent's context and for a file in the output, and not retired within a week
const canRunAgent = (model: OpenRouterModel, now: number) => {
	if (model.id.startsWith('openrouter/')) return false; // OpenRouter's routers: what they can do depends on the model they pick
	if (/voxtral|whisper|audio|voice|speech|tts|transcri|realtime/.test(model.id)) return false;
	if (isFree(model) && unusableFreeModel.test(model.id)) return false;
	const { input_modalities = [], output_modalities = [] } = model.architecture ?? {};
	if (!input_modalities.includes('text') || output_modalities.length !== 1 || output_modalities[0] !== 'text') return false;
	if (!model.supported_parameters?.includes('tools')) return false;
	if (model.context_length < MIN_CONTEXT_WINDOW) return false;
	const maxOutputTokens = model.top_provider?.max_completion_tokens;
	if (maxOutputTokens && maxOutputTokens < MIN_OUTPUT_TOKENS) return false;
	if (model.expiration_date && Date.parse(model.expiration_date) - now < EXPIRES_SOON_MS) return false;
	return true;
};

// ALL free chat/coding models on OpenRouter (no 5-model cap, includes Gemma 4, Nemotron, Flint, openrouter/free, etc.).
// Ordered with native tool-calling & highest-coding-index models first.
export const allFreeModelsOfOpenRouter = (models: OpenRouterModel[], now: number): DetectedOpenRouterModel[] => {
	const picked = models.filter(model => isUsableFreeChatModel(model, now));
	const codingIndex = (model: OpenRouterModel) => model.benchmarks?.artificial_analysis?.coding_index ?? -1;
	const hasTools = (model: OpenRouterModel) => (model.supported_parameters?.includes('tools') || model.id === 'openrouter/free') ? 1 : 0;
	picked.sort((a, b) =>
		hasTools(b) - hasTools(a)
		|| codingIndex(b) - codingIndex(a)
		|| (b.context_length ?? 0) - (a.context_length ?? 0)
		|| a.id.localeCompare(b.id)
	);
	return picked.map(model => ({ modelName: model.id, capabilities: capabilitiesOf(model) }));
};

// OpenRouter's free models that can run the agent. The best at code first, by Artificial Analysis' coding index, when
// OpenRouter has it.
export const freeCodingModelsOfOpenRouter = (models: OpenRouterModel[], now: number): DetectedOpenRouterModel[] => {
	const picked = models.filter(model => isFree(model) && canRunAgent(model, now));
	const codingIndex = (model: OpenRouterModel) => model.benchmarks?.artificial_analysis?.coding_index ?? -1;
	picked.sort((a, b) => codingIndex(b) - codingIndex(a) || a.id.localeCompare(b.id));
	return picked.map(model => ({ modelName: model.id, capabilities: capabilitiesOf(model) }));
};

// The models OpenRouter's users used most last week that can run the agent, besides the free ones and Kodia's default
// OpenRouter model. `modelsByUsage` is OpenRouter's list sorted by usage (OPENROUTER_MODELS_BY_USAGE_URL). A snapshot
// counts for its model when OpenRouter lists that too (deepseek-v4.1-flash-1017 is deepseek-v4.1-flash).
export const mostUsedModelsOfOpenRouter = (modelsByUsage: OpenRouterModel[], now: number, count: number): DetectedOpenRouterModel[] => {
	const modelOfId = new Map(modelsByUsage.map(model => [model.id, model]));
	const picked = new Map<string, DetectedOpenRouterModel>();
	for (const model of modelsByUsage) {
		if (picked.size >= count) break;
		const named = modelOfId.get(withoutSnapshotSuffix(model.id)) ?? model;
		if (picked.has(named.id) || isFree(named) || (defaultModelsOfProvider.openRouter as readonly string[]).includes(named.id) || !canRunAgent(named, now)) continue;
		picked.set(named.id, { modelName: named.id, capabilities: capabilitiesOf(named) });
	}
	return [...picked.values()];
};

// The models of `modelNames` OpenRouter still lists that can still run the agent, with their capabilities today: a
// model selected in the chat stays after it leaves the lists
export const stillListedModelsOfOpenRouter = (models: OpenRouterModel[], now: number, modelNames: readonly string[]): DetectedOpenRouterModel[] => {
	const modelOfId = new Map(models.map(model => [model.id, model]));
	return modelNames.flatMap(modelName => {
		const model = modelOfId.get(modelName);
		return model && canRunAgent(model, now) ? [{ modelName, capabilities: capabilitiesOf(model) }] : [];
	});
};
