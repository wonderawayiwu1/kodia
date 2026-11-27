/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import type {
	IAgentHostByokLmHandler,
	IByokLmChatRequest,
	IByokLmChatResult,
	IByokLmFunctionTool,
	IByokLmModelInfo,
	IByokLmToolExecutionRequest,
	IByokLmToolExecutionResult,
} from '../../../../platform/agentHost/common/agentHostByokLm.js';
import { IKodiaAgentHostLmHandler } from '../../../../platform/agentHost/common/kodiaAgentHostLm.js';
import { KODIA_OPEN_SETTINGS_COMMAND_ID } from '../../../../platform/windows/common/kodiaWindows.js';
import { toInternalTool, toOutput, toSimpleMessages, toUsage } from '../common/kodiaAgentHostLmMessages.js';
import { getModelCapabilities } from '../common/modelCapabilities.js';
import { builtinTools, isABuiltinToolName, toolsXMLSystemPrompt } from '../common/prompt/prompts.js';
import { joinUserInstructions } from '../common/instructionsFrameworks.js';
import { IMlxService } from '../common/mlxService.js';
import { prepareSimpleLLMMessages } from '../common/prepareLLMMessages.js';
import { ILLMMessageService } from '../common/sendLLMMessageService.js';
import { BuiltinToolName } from '../common/toolsServiceTypes.js';
import { IVoidSettingsService } from '../common/voidSettingsService.js';
import { displayInfoOfProviderName, ModelSelection, ProviderName, providerNames } from '../common/voidSettingsTypes.js';
import { IToolsService } from './toolsService.js';

/**
 * Curated top-level Kodia engine tools exposed directly alongside the agent host's
 * 9 local workspace tools (keeps the per-turn schema count compact & well under
 * OpenAI/Groq's 128-tool cap, while `kodia_list_all_tools` + `kodia_invoke_tool`
 * unlock every single one of Kodia's 379 builtin tools on demand).
 */
const DIRECT_BRIDGED_KODIA_TOOLS: readonly BuiltinToolName[] = [
	// Live Web & Browser Automation
	'web_search',
	'fetch_url',
	'browser_launch',
	'browser_navigate',
	'browser_inspect_page',
	'browser_click_element',
	'browser_fill_element',
	'browser_screenshot',
	'browser_close',
	// KACRAE Autonomous Code Review & Functional Completeness
	'kacrae_open_workbench',
	'kacrae_run_review',
	'kacrae_verify_functional_completeness',
	'kacrae_apply_repair',
	'kacrae_export_report',
	// ARPEI Research-to-Product & Deep Autonomous Product Discovery
	'arpei_open_workspace',
	'arpei_plan_research',
	'arpei_explore_reference',
	'arpei_research_technical',
	'arpei_discover_assets',
	'arpei_evaluate_readiness_gate',
	'arpei_compare_visuals',
	'arpei_query_research_memory',
	// Live Engineering Intelligence (LEI)
	'lei_open_dashboard',
	'lei_research_technology',
	'lei_discover_models',
	'lei_verify_model',
	'lei_check_dependency',
	'lei_diagnose_error',
	// Universal App Builder (UABE) & IRIRE
	'uabe_open_workspace',
	'uabe_init_project',
	'uabe_analyze_contract',
	'uabe_recommend_stack',
	'uabe_discover_integrations',
	'uabe_evaluate_reliability',
	'uabe_generate_handover',
	// Universal Automation Studio (UAEP)
	'uaep_open_studio',
	'uaep_generate_workflow',
	'uaep_execute_workflow',
	// API Engineering Studio
	'api_open_studio',
	'api_discover_project',
	'api_send_request',
	'api_security_audit',
	// Deep Correctness, ERIC, FPERE & KDRE
	'correctness_open_hub',
	'correctness_analyze_workspace',
	'fpere_run_quality_gate',
	'eric_analyze_semantics',
	'kdre_evaluate_diagnostics',
	// UI/UX Design Intelligence & Visual Assets
	'generate_design_tokens',
	'search_image_providers',
	'download_visual_assets',
	'inspect_visual_quality',
	// AI Engineering Engine
	'ai_orchestrate_project',
	'ai_probe_compute_hardware',
	'ai_rag_query',
	// Mobile Engineering Studio
	'mobile_open_studio',
	'mobile_inspect_project',
	'mobile_build_and_test',
	// Evolution, Supply-Chain, Ops & Project Health / Memory
	'evolution_open_hub',
	'evolution_workspace_overview',
	'env_inspect',
	'docker_status',
	'db_inspect',
	'project_health_scan',
	'read_project_memory',
];

const WORKSPACE_ROOT_PARAM_KEYS = ['workspace_root', 'workspace_path', 'root_dir', 'project_root', 'project_path', 'cwd'] as const;

const STUDIO_COMMAND_MAP: Readonly<Record<string, string>> = {
	settings: KODIA_OPEN_SETTINGS_COMMAND_ID,
	app_builder: 'kodia.openUniversalAppBuilder',
	automation: 'kodia.openUniversalAutomationStudio',
	code_review: 'workbench.action.kodia.openCodeReview',
	arpei: 'workbench.action.kodia.openArpeiWorkspace',
	live_intelligence: 'kodia.openLiveEngineeringIntelligence',
	api_studio: 'workbench.action.kodia.openApiStudio',
	mobile_studio: 'workbench.action.kodia.openMobileStudio',
	correctness: 'workbench.action.kodia.openCorrectnessHub',
	evolution: 'workbench.action.kodia.openEvolutionHub',
};

function toFunctionToolSchema(name: BuiltinToolName): IByokLmFunctionTool {
	const spec = builtinTools[name];
	const properties: Record<string, { type: string; description: string }> = {};
	for (const [paramName, paramSpec] of Object.entries(spec.params ?? {})) {
		properties[paramName] = {
			type: 'string',
			description: paramSpec?.description ?? '',
		};
	}
	return {
		type: 'function',
		name: spec.name,
		description: spec.description,
		parametersSchema: {
			type: 'object',
			properties,
			additionalProperties: true,
		},
	};
}

/**
 * Serves the Kodia agent of the Agents Window with Kodia's own LLM service AND
 * Kodia's complete tool/engine stack (KACRAE, ARPEI, LEI, UABE, UAEP, Browser,
 * Web Search, API/Design/AI/Mobile/Correctness/Evolution/Ops, Settings & Studios).
 * Editor windows and the Agents Window both register it.
 */
class KodiaAgentHostLmHandler extends Disposable implements IAgentHostByokLmHandler {
	declare readonly _serviceBrand: undefined;

	readonly onDidChangeModels: Event<void>;

	constructor(
		@IVoidSettingsService private readonly _voidSettingsService: IVoidSettingsService,
		@ILLMMessageService private readonly _llmMessageService: ILLMMessageService,
		@IMlxService private readonly _mlxService: IMlxService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ICommandService private readonly _commandService: ICommandService,
	) {
		super();
		this.onDidChangeModels = this._voidSettingsService.onDidChangeState;
	}

	private _tryGetToolsService(): IToolsService | undefined {
		try {
			return this._instantiationService.invokeFunction(accessor => accessor.get(IToolsService));
		} catch {
			return undefined;
		}
	}

	async listModels(): Promise<IByokLmModelInfo[]> {
		await this._voidSettingsService.waitForInitState;
		// `_modelOptions` is every model switched on for a provider that is set up
		// ("Show in Dropdown" in Kodia settings): Gemini, MLX, OpenRouter, and the rest.
		const { _modelOptions, overridesOfModel } = this._voidSettingsService.state;
		return _modelOptions.map(({ name, selection: { providerName, modelName } }) => {
			const { contextWindow, supportsVision } = getModelCapabilities(providerName, modelName, overridesOfModel);
			const providerTitle = displayInfoOfProviderName(providerName).title;
			const label = name.includes(providerTitle) ? name : `${providerTitle} · ${name}`;
			return { vendor: providerName, id: modelName, name: label, maxContextWindowTokens: contextWindow, supportsVision: !!supportsVision };
		});
	}

	async listTools(): Promise<IByokLmFunctionTool[]> {
		const toolsService = this._tryGetToolsService();
		const tools: IByokLmFunctionTool[] = [
			{
				type: 'function',
				name: 'kodia_open_settings',
				description: 'Open Kodia Settings or any Kodia Engineering Studio natively inside this window (settings, app_builder, automation, code_review, arpei, live_intelligence, api_studio, mobile_studio, correctness, evolution).',
				parametersSchema: {
					type: 'object',
					properties: {
						studio: { type: 'string', description: 'Target studio: settings (default), app_builder, automation, code_review, arpei, live_intelligence, api_studio, mobile_studio, correctness, evolution.' },
					},
					required: [],
					additionalProperties: false,
				},
			},
		];

		if (!toolsService) {
			return tools;
		}

		for (const toolName of DIRECT_BRIDGED_KODIA_TOOLS) {
			if (builtinTools[toolName]) {
				tools.push(toFunctionToolSchema(toolName));
			}
		}

		// Meta-tools giving the Agents Window full access to ALL 379 Kodia builtin tools!
		tools.push(
			{
				type: 'function',
				name: 'kodia_list_all_tools',
				description: 'Search all 379 Kodia Code Editor engine tools by keyword (e.g. "debug", "git", "notebook", "design", "ai_", "api_", "mobile_", "evolution_", "fpere_", "eric_", "kdre_", "kacrae_", "arpei_", "uabe_", "uaep_") to get exact tool names and parameter schemas for `kodia_invoke_tool`.',
				parametersSchema: {
					type: 'object',
					properties: {
						query: { type: 'string', description: 'Optional keyword filter (e.g. "debug", "notebook", "design", "git", "test").' },
						limit: { type: 'number', description: 'Max matching tools to return (default 25).' },
					},
					required: [],
					additionalProperties: false,
				},
			},
			{
				type: 'function',
				name: 'kodia_invoke_tool',
				description: 'Invoke ANY of Kodia\'s 379 built-in engineering tools by exact `tool_name` with a JSON `params` object.',
				parametersSchema: {
					type: 'object',
					properties: {
						tool_name: { type: 'string', description: 'Exact Kodia builtin tool name (discover via `kodia_list_all_tools`).' },
						params: { type: 'object', description: 'Parameter object matching the tool\'s schema.' },
					},
					required: ['tool_name'],
					additionalProperties: false,
				},
			},
		);

		return tools;
	}

	async executeTool(request: IByokLmToolExecutionRequest, _token: CancellationToken): Promise<IByokLmToolExecutionResult> {
		let parsedArgs: Record<string, unknown> = {};
		try {
			parsedArgs = request.argumentsJson ? JSON.parse(request.argumentsJson) : {};
		} catch {
			return { success: false, output: `Invalid JSON arguments for tool "${request.name}".` };
		}

		if (request.name === 'kodia_open_settings') {
			const key = typeof parsedArgs.studio === 'string' && parsedArgs.studio.trim() ? parsedArgs.studio.trim().toLowerCase() : 'settings';
			const cmd = STUDIO_COMMAND_MAP[key] ?? KODIA_OPEN_SETTINGS_COMMAND_ID;
			try {
				await this._commandService.executeCommand(cmd);
				return { success: true, output: `Opened Kodia "${key}" (${cmd}) inside this window.` };
			} catch (err) {
				return { success: false, output: `Failed to open "${key}": ${err instanceof Error ? err.message : String(err)}` };
			}
		}

		if (request.name === 'kodia_list_all_tools') {
			const query = typeof parsedArgs.query === 'string' ? parsedArgs.query.trim().toLowerCase() : '';
			const limit = typeof parsedArgs.limit === 'number' && parsedArgs.limit > 0 ? Math.min(80, parsedArgs.limit) : 25;
			const allSpecs = Object.values(builtinTools);
			const matched = query
				? allSpecs.filter(s => s.name.toLowerCase().includes(query) || s.description.toLowerCase().includes(query))
				: allSpecs;
			const lines = matched.slice(0, limit).map(s => {
				const paramNames = Object.keys(s.params ?? {}).join(', ');
				return `- ${s.name}(${paramNames}): ${s.description.slice(0, 140)}`;
			});
			return {
				success: true,
				output: `Matched ${matched.length} of ${allSpecs.length} Kodia tools${query ? ` for "${query}"` : ''}:\n${lines.join('\n')}`,
			};
		}

		let targetName = request.name;
		let targetParams: Record<string, unknown> = parsedArgs;
		if (request.name === 'kodia_invoke_tool') {
			if (typeof parsedArgs.tool_name !== 'string' || !parsedArgs.tool_name.trim()) {
				return { success: false, output: 'Missing required "tool_name" parameter.' };
			}
			targetName = parsedArgs.tool_name.trim();
			targetParams = (parsedArgs.params && typeof parsedArgs.params === 'object') ? { ...(parsedArgs.params as Record<string, unknown>) } : {};
		}

		if (!isABuiltinToolName(targetName)) {
			return { success: false, output: `Unknown Kodia tool: "${targetName}". Call kodia_list_all_tools to inspect available tool names.` };
		}

		const toolsService = this._tryGetToolsService();
		if (!toolsService) {
			return { success: false, output: `Kodia IToolsService is not available in this window for "${targetName}".` };
		}

		// Automatically inject the Agents Window session's workingDirectory when a workspace-path param is defined & omitted.
		const spec = builtinTools[targetName];
		const definedParamKeys = new Set(Object.keys(spec.params ?? {}));
		if (request.workingDirectory) {
			for (const key of WORKSPACE_ROOT_PARAM_KEYS) {
				if (definedParamKeys.has(key) && (targetParams[key] === undefined || targetParams[key] === '')) {
					targetParams[key] = request.workingDirectory;
				}
			}
		}

		try {
			const validate = toolsService.validateParams[targetName] as (p: unknown) => unknown;
			const invoke = toolsService.callTool[targetName] as (p: unknown) => Promise<{ result: unknown; interruptTool?: () => void }>;
			const stringify = toolsService.stringOfResult[targetName] as (p: unknown, r: unknown) => string;

			const validated = validate(targetParams);
			const { result } = await invoke(validated);
			const awaitedResult = await Promise.resolve(result);
			const text = stringify(validated, awaitedResult);
			return { success: true, output: text || '(completed with no output)' };
		} catch (err) {
			return {
				success: false,
				output: err instanceof Error ? err.message : String(err),
			};
		}
	}

	async chat(request: IByokLmChatRequest, token: CancellationToken): Promise<IByokLmChatResult> {
		if (!(providerNames as readonly string[]).includes(request.vendor)) {
			return { output: [], error: `Unknown Kodia provider: ${request.vendor}` };
		}
		const modelSelection: ModelSelection = { providerName: request.vendor as ProviderName, modelName: request.modelId };
		// An editor window starts Kodia's MLX server; the Agents Window may be the only window open.
		if (modelSelection.providerName === 'mlx' && this._voidSettingsService.state.globalSettings.autoSetupMlx) {
			await this._mlxService.ensureReady({ installIfMissing: false, startServer: true }).catch(() => undefined);
		}
		const { overridesOfModel, optionsOfModelSelection, globalSettings } = this._voidSettingsService.state;
		const tools = request.tools?.flatMap(toInternalTool) ?? [];
		// Models without native tool calling are taught the XML format in the system message.
		const { specialToolFormat } = getModelCapabilities(modelSelection.providerName, modelSelection.modelName, overridesOfModel);
		const systemMessage = [request.instructions, specialToolFormat ? null : toolsXMLSystemPrompt(tools)].filter(Boolean).join('\n\n');
		const { messages, separateSystemMessage } = prepareSimpleLLMMessages({
			simpleMessages: toSimpleMessages(request.input),
			systemMessage,
			// Apply the user's global Kodia AI instructions & frameworks consistently across Editor and Agents Windows.
			aiInstructions: joinUserInstructions(globalSettings.aiInstructions, globalSettings.instructionsFrameworks),
			modelSelection,
			featureName: 'Chat',
			overridesOfModel,
			optionsOfModelSelection,
		});

		return new Promise<IByokLmChatResult>(resolve => {
			let requestId: string | null = null;
			const cancellation = token.onCancellationRequested(() => {
				if (requestId) {
					this._llmMessageService.abort(requestId);
				}
			});
			const settle = (result: IByokLmChatResult) => {
				cancellation.dispose();
				resolve(result);
			};
			requestId = this._llmMessageService.sendLLMMessage({
				messagesType: 'chatMessages',
				messages,
				separateSystemMessage,
				// Agent mode, with Kodia's local + bridged engine tools.
				chatMode: 'agent',
				tools,
				modelSelection,
				modelSelectionOptions: optionsOfModelSelection.Chat[modelSelection.providerName]?.[modelSelection.modelName],
				overridesOfModel,
				logging: { loggingName: 'Agents Window' },
				onText: () => { },
				onFinalMessage: final => settle({ output: toOutput(final), usage: toUsage(final.usage) }),
				onError: ({ message }) => settle({ output: [], error: message }),
				onAbort: () => settle({ output: [], error: 'Cancelled' }),
			});
		});
	}
}

registerSingleton(IKodiaAgentHostLmHandler, KodiaAgentHostLmHandler, InstantiationType.Delayed);
