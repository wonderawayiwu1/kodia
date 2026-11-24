import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js'
import { URI } from '../../../../base/common/uri.js'
import { IReference } from '../../../../base/common/lifecycle.js'
import { Position } from '../../../../editor/common/core/position.js'
import { IRange } from '../../../../editor/common/core/range.js'
import { ITextModel } from '../../../../editor/common/model.js'
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js'
import { IResolvedTextEditorModel, ITextModelService } from '../../../../editor/common/services/resolverService.js'
import { getDefinitionsAtPosition, getReferencesAtPosition } from '../../../../editor/contrib/gotoSymbol/browser/goToSymbol.js'
import { getWorkspaceSymbols, WorkspaceSymbolProviderRegistry } from '../../search/common/search.js'
import { IFileService } from '../../../../platform/files/common/files.js'
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js'
import { createDecorator, IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js'
import { IBrowserService } from '../common/browserServiceTypes.js'
import { formatBrowserInspection, formatBrowserPage } from '../common/browserFormatting.js'
import { formatSubagentReport } from '../common/subagents.js'
import { formatArchitectureMapForLLM, formatProjectHealthForLLM } from '../common/projectHealth.js'
import { runArchitectureMap, runProjectHealthScan } from './projectHealthScanner.js'
import { formatDbInspectForLLM, formatDbQueryForLLM, formatDockerStatusForLLM, formatEnvInspectForLLM, IKodiaOpsMainService, KODIA_OPS_CHANNEL } from '../common/kodiaOpsTypes.js'
import { formatCodeSearch, formatIndexStats, formatLiteralSearch } from '../common/codeIndexFormatting.js'
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js'
import { QueryBuilder } from '../../../services/search/common/queryBuilder.js'
import { ISearchService } from '../../../services/search/common/search.js'
import { IEditCodeService } from './editCodeServiceInterface.js'
import { ITerminalToolService } from './terminalToolService.js'
import { IGitToolService } from './gitToolService.js'
import { ITestToolService } from './testToolService.js'
import { TestRunResultData } from '../common/testServiceTypes.js'
import { DebugExceptionFilter, DebugStopInfo } from '../common/debugServiceTypes.js'
import { IDebugToolService } from '../common/debugServiceTypes.js'
import { IDebuggerActivityService, DebuggerActivityType } from '../common/debuggerActivityServiceTypes.js'
import { LintErrorItem, BuiltinToolCallParams, BuiltinToolResultType, BuiltinToolName, CodeLocation, NotebookCellOutput } from '../common/toolsServiceTypes.js'
import { IVoidModelService } from '../common/voidModelService.js'
import { EndOfLinePreference } from '../../../../editor/common/model.js'
import { IVoidCommandBarService } from './voidCommandBarServiceInterface.js'
import { computeDirectoryTree1Deep, IDirectoryStrService, stringifyDirectoryTree1Deep } from '../common/directoryStrService.js'
import { IMarkerService, MarkerSeverity } from '../../../../platform/markers/common/markers.js'
import { raceTimeout } from '../../../../base/common/async.js'
import { RawToolParamsObj } from '../common/sendLLMMessageTypes.js'
import { MAX_CHILDREN_URIs_PAGE, MAX_FILE_CHARS_PAGE, MAX_PROJECT_MEMORY_TOKENS, MAX_TERMINAL_BG_COMMAND_TIME, MAX_TERMINAL_INACTIVE_TIME } from '../common/prompt/prompts.js'
import { IVoidSettingsService } from '../common/voidSettingsService.js'
import { generateUuid } from '../../../../base/common/uuid.js'
import { IProjectMemoryService } from '../common/projectMemoryService.js'
import { resolveCwdUri } from '../common/pathSecurity.js';
import { wrapCommandForShell, wrapCommandForInteractiveShell, terminalCommandOutcome } from '../common/terminalUtils.js';
import { TaskStatus, getPlanProgress, formatTaskPlanForLLM } from '../common/autonomousTask.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js'
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js'
import { IKodiaWebFetchService, WebFetchResult } from '../common/webFetchTypes.js'
import { IApiMainService } from '../common/apiServiceTypes.js'
import { ICodeIndexService } from '../common/codeIndexServiceTypes.js'
import { IWebSearchService, SearchRequest } from '../common/webSearchTypes.js'
import { INotebookService } from '../../notebook/common/notebookService.js'
import { INotebookKernelService } from '../../notebook/common/notebookKernelService.js'
import { INotebookExecutionService } from '../../notebook/common/notebookExecutionService.js'
import { INotebookEditorModelResolverService } from '../../notebook/common/notebookEditorModelResolverService.js'
import { CellKind } from '../../notebook/common/notebookCommon.js'
import { IEditorService } from '../../../services/editor/common/editorService.js'
import { IKodiaNotebookKernelMainService, KODIA_NOTEBOOK_KERNEL_CHANNEL } from '../common/kodiaNotebookKernelTypes.js'
import {
	applyNotebookEditOperations,
	buildNbformatDocument,
	compactBase64BlobsPreservingLines,
	createNotebookEditHistoryState,
	NbformatDocument,
	NotebookEditHistoryState,
	parseNotebookArrayParam,
	searchNotebookDocument,
	validateNotebookDocument,
} from '../common/notebookToolUtils.js'
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js'
import { VSBuffer } from '../../../../base/common/buffer.js'
import type { GitStepResult } from '../common/gitOperations.js'
import type { GitChangedFile } from '../common/gitService.js'
import { analyzeChangeImpact, buildProjectDigitalTwin, formatChangeImpactForLLM, queryKnowledgeGraph } from '../common/digitalTwin.js'
import { analyzeProjectHealth, buildArchitectureMap } from '../common/projectHealth.js'
import { collectWorkspaceProjectFiles } from './projectHealthScanner.js'
import { createVerificationRecord, formatQualityGateEvaluationForLLM, VERIFICATION_LEVEL_ORDER, VerificationLevel } from '../common/verificationLedger.js'
import { IVerificationLedgerService } from './verificationLedgerService.js'
import { ISoftwareFactoryService } from '../common/softwareFactory.js'
import { IDesignIntelligenceService } from './designIntelligenceService.js'
import {
	ColorHarmonyStrategy,
	DEFAULT_DESIGN_INTELLIGENCE_SETTINGS,
	FrontendFramework,
	IDesignAssetMainService,
	ImageProviderName,
	KODIA_DESIGN_CHANNEL,
	StylingSystem,
	VisualDirectionId,
} from '../common/designIntelligenceTypes.js'
import {
	analyzeProductDesignRequirements,
	auditDesignConsistency,
	critiqueInterfaceDesign,
	formatBrowserVisualAuditForLLM,
	formatColorPaletteForLLM,
	formatDesignBriefForLLM,
	formatDesignCritiqueForLLM,
	formatProductAnalysisForLLM,
	generateColorPalette,
	generateComponentVariants,
	generateDesignBrief,
	generateDesignTokens,
	generatePageArchitecture,
	generateResponsiveLayout,
	generateVisualDirection,
	inspectExistingDesignSystem,
	planVisualDefectRepairs,
	recommendIconLibrary,
	recommendUiComponents,
} from '../common/designIntelligenceEngine.js'
import { buildTypographyRecommendation } from '../common/designKnowledgeLibrary.js'
import { IAIEngineeringService } from './aiEngineeringService.js'
import {
	AICapabilityCatalogueEntry,
	AIEvaluationTaskType,
	DEFAULT_AI_ENGINE_SETTINGS,
	IKodiaAIEngineMainService,
	KODIA_AI_ENGINE_CHANNEL,
	ModelRegistryStage,
	ProviderCapabilitySummary,
} from '../common/aiEngineeringTypes.js'
import {
	analyzeAIResearchTopic,
	auditAISecurityWorkspace,
	compileNaturalLanguageWorkflow,
	designAIArchitecture,
	diagnoseAIFailure,
	discoverAICapabilities,
	estimateAIPerformanceAndCost,
	formatAIArchitectureForLLM,
	formatEngineRoutingForLLM,
	formatFactoryBlueprintForLLM,
	generateOneCommandFactoryBlueprint,
	recommendTrainingStrategy,
	routeEngineeringRequest,
} from '../common/aiEngineeringKnowledge.js'
import { getModelCapabilities } from '../common/modelCapabilities.js'
import { localProviderNames, providerNames } from '../common/voidSettingsTypes.js'
import { IApiStudioService } from './apiStudioService.js'
import {
	ApiAssertionSpec,
	ApiAuthConfig,
	ApiCollection,
	ApiEnvironment,
	ApiHttpMethod,
	ApiKeyValuePair,
	ApiMockRoute,
	ApiProtocol,
	ApiRequestBody,
	ApiRequestSpec,
	ApiResponseResult,
	ApiStudioSection,
	ApiTestSuite,
	DEFAULT_API_STUDIO_SETTINGS,
	IKodiaApiStudioMainService,
	KODIA_API_STUDIO_CHANNEL,
} from '../common/apiStudioTypes.js'
import {
	assessApiProductionReadiness,
	auditApiWorkspaceStaticSecurity,
	ClientCodeTarget,
	compareApiResponses,
	correlateApiFailure,
	diffOpenApiSpecs,
	discoverWorkspaceApis,
	exportCollectionToPostman,
	formatDiscoveryForLLM,
	formatResponseForLLM,
	generateApiClientCode,
	generateApiTestSuiteFromDiscovery,
	generateOpenApiSpecFromDiscovery,
	importFromCurl,
	importFromPostmanCollection,
} from '../common/apiStudioIntelligence.js'
import { ICorrectnessService } from './correctnessService.js'
import {
	CorrectnessHubSection,
	DEFAULT_CORRECTNESS_ENGINE_SETTINGS,
	FuzzTestConfig,
	IKodiaCorrectnessMainService,
	KODIA_CORRECTNESS_CHANNEL,
	ProofCarryingChangeRecord,
} from '../common/correctnessTypes.js'
import { IEvolutionService } from './evolutionService.js'
import { IMobileEngineeringService } from './mobileEngineeringService.js'
import { IKodiaWorkflowsService } from '../common/kodiaWorkflows.js'
import {
	DEFAULT_EVOLUTION_ENGINE_SETTINGS,
	EvolutionDomain,
	EvolutionHubSection,
	EvolutionProposal,
	EvolutionVerdict,
	IKodiaEvolutionMainService,
	KODIA_EVOLUTION_CHANNEL,
} from '../common/evolutionTypes.js'
import {
	IKodiaMobileMainService,
	KODIA_MOBILE_CHANNEL,
	MobileAppCategory,
	MobileBackendStack,
	MobileBuildTestRequest,
	MobileCapabilityEntry,
	MobileDatabaseId,
	MobileDeviceActionType,
	MobileFrameworkId,
	MobileStudioSection,
	MobileTargetPlatform,
} from '../common/mobileEngineeringTypes.js'
import {
	discoverMobileCapabilities,
	formatMobileArchitectureForLLM,
	formatMobileEnvironmentForLLM,
	formatMobileProjectIntelForLLM,
	formatMobileReadinessForLLM,
	formatMobileSecurityForLLM,
} from '../common/mobileEngineeringKnowledge.js'
import {
	analyzeTaintFlows,
	analyzeWorkspaceCorrectness,
	assessReleaseReadiness,
	buildControlledRepairPlan,
	exportDiagnosticsToSarif,
	formatInvestigationForLLM,
	investigateRootCause,
	runIncrementalCorrectnessAnalysis,
} from '../common/correctnessEngine.js'


// tool use for AI
type ValidateBuiltinParams = { [T in BuiltinToolName]: (p: RawToolParamsObj) => BuiltinToolCallParams[T] }
type CallBuiltinTool = { [T in BuiltinToolName]: (p: BuiltinToolCallParams[T]) => Promise<{ result: BuiltinToolResultType[T] | Promise<BuiltinToolResultType[T]>, interruptTool?: () => void }> }
type BuiltinToolResultToString = { [T in BuiltinToolName]: (p: BuiltinToolCallParams[T], result: Awaited<BuiltinToolResultType[T]>) => string }


const isFalsy = (u: unknown) => {
	return !u || u === 'null' || u === 'undefined'
}

const validateStr = (argName: string, value: unknown) => {
	if (value === null) throw new Error(`Invalid LLM output: ${argName} was null.`)
	if (typeof value !== 'string') throw new Error(`Invalid LLM output format: ${argName} must be a string, but its type is "${typeof value}". Full value: ${JSON.stringify(value)}.`)
	return value
}


// Asserts that a URI targets a path inside at least one open workspace folder.
// This is a lexical check only: it does not resolve symlinks or junctions.

const validateURI = (uriStr: unknown, workspaceContextService: IWorkspaceContextService) => {
	if (uriStr === null) throw new Error(`Invalid LLM output: uri was null.`)
	if (typeof uriStr !== 'string') throw new Error(`Invalid LLM output format: Provided uri must be a string, but it's a(n) ${typeof uriStr}. Full value: ${JSON.stringify(uriStr)}.`)

	// Check if it's already a full URI with scheme (e.g., vscode-remote://, file://, etc.)
	// Look for :// pattern which indicates a scheme is present
	// Examples of supported URIs:
	// - vscode-remote://wsl+Ubuntu/home/user/file.txt (WSL)
	// - vscode-remote://ssh-remote+myserver/home/user/file.txt (SSH)
	// - file:///home/user/file.txt (local file with scheme)
	// - /home/user/file.txt (local file path, will be converted to file://)
	// - C:\Users\file.txt (Windows local path, will be converted to file://)
	if (uriStr.includes('://')) {
		try {
			const uri = URI.parse(uriStr)
			return uri
		} catch (e) {
			// If parsing fails, it's a malformed URI
			throw new Error(`Invalid URI format: ${uriStr}. Error: ${e}`)
		}
	} else {
		// No scheme present, treat as file path
		// This handles regular file paths like /home/user/file.txt or C:\Users\file.txt
		const uri = URI.file(uriStr)
		return uri
	}
}

const validateOptionalURI = (uriStr: unknown, workspaceContextService: IWorkspaceContextService) => {
	if (isFalsy(uriStr)) return null
	return validateURI(uriStr, workspaceContextService)
}

const validateOptionalStr = (argName: string, str: unknown) => {
	if (isFalsy(str)) return null
	return validateStr(argName, str)
}


const validatePageNum = (pageNumberUnknown: unknown) => {
	if (!pageNumberUnknown) return 1
	const parsedInt = Number.parseInt(pageNumberUnknown + '')
	if (!Number.isInteger(parsedInt)) throw new Error(`Page number was not an integer: "${pageNumberUnknown}".`)
	if (parsedInt < 1) throw new Error(`Invalid LLM output format: Specified page number must be 1 or greater: "${pageNumberUnknown}".`)
	return parsedInt
}

const validateNumber = (numStr: unknown, opts: { default: number | null }) => {
	if (typeof numStr === 'number')
		return numStr
	if (isFalsy(numStr)) return opts.default

	if (typeof numStr === 'string') {
		const parsedInt = Number.parseInt(numStr + '')
		if (!Number.isInteger(parsedInt)) return opts.default
		return parsedInt
	}

	return opts.default
}

const validateProposedTerminalId = (terminalIdUnknown: unknown) => {
	if (!terminalIdUnknown) throw new Error(`A value for terminalID must be specified, but the value was "${terminalIdUnknown}"`)
	const terminalId = terminalIdUnknown + ''
	return terminalId
}

const validateBoolean = (b: unknown, opts: { default: boolean }) => {
	if (typeof b === 'string') {
		if (b === 'true') return true
		if (b === 'false') return false
	}
	if (typeof b === 'boolean') {
		return b
	}
	return opts.default
}


const validateLine = (lineUnknown: unknown) => {
	const line = validateNumber(lineUnknown, { default: null })
	if (line === null || line < 1) throw new Error(`Invalid LLM output: line must be a line number (1 or greater), but it was ${JSON.stringify(lineUnknown)}.`)
	return line
}


// --- language-server (LSP) tools ---

const LANGUAGE_SERVER_TIMEOUT_MS = 20_000
const MAX_LANGUAGE_SERVER_RESULTS = 50
const DEFINITION_SNIPPET_LINES = 5

// indexed by SymbolKind (a const enum); symbolKindNames from languages.ts is localized, and this text goes to the LLM
const symbolKindNames = ['file', 'module', 'namespace', 'package', 'class', 'method', 'property', 'field', 'constructor', 'enum', 'interface', 'function', 'variable', 'constant', 'string', 'number', 'boolean', 'array', 'object', 'key', 'null', 'enum member', 'struct', 'event', 'operator', 'type parameter']

const isIdentifierChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}_$]/u.test(c)

// 1-based column of `name` on the line, preferring a whole-identifier match over a substring
const columnOfIdentifier = (lineContent: string, name: string): number | null => {
	let substringMatch: number | null = null
	for (let i = lineContent.indexOf(name); i !== -1; i = lineContent.indexOf(name, i + 1)) {
		if (!isIdentifierChar(lineContent[i - 1]) && !isIdentifierChar(lineContent[i + name.length])) return i + 1
		substringMatch ??= i + 1
	}
	return substringMatch
}

// Where `symbol` is, at or near `line`: LLMs are often off by a line or two. For `a.b` or `a::b`, the last part.
const positionOfSymbol = (model: ITextModel, line: number, symbol: string): Position => {
	const name = symbol.split(/\.|::|->/).map(s => s.trim()).filter(s => s).pop() ?? symbol.trim()
	const lineCount = model.getLineCount()
	for (const delta of [0, -1, 1, -2, 2, -3, 3]) {
		const l = line + delta
		if (l < 1 || l > lineCount) continue
		const column = columnOfIdentifier(model.getLineContent(l), name)
		if (column !== null) return new Position(l, column)
	}
	const lineContent = line <= lineCount ? `"${model.getLineContent(line).trim()}"` : `past the end of the file (${lineCount} lines)`
	throw new Error(`"${symbol}" was not found on line ${line} or the lines around it. Line ${line} is ${lineContent}.`)
}

// one result per line, in order
const uniqueByLine = <T extends { uri: URI, range: IRange }>(links: T[]): T[] => {
	const seen = new Set<string>()
	return links.filter(l => {
		const key = `${l.uri.toString()}:${l.range.startLineNumber}`
		if (seen.has(key)) return false
		seen.add(key)
		return true
	})
}

// language servers can hang, or still be starting: give up rather than block the agent
const withLanguageServerTimeout = async <T>(run: (token: CancellationToken) => Promise<T>): Promise<T> => {
	const cts = new CancellationTokenSource()
	try {
		const result = await raceTimeout(run(cts.token), LANGUAGE_SERVER_TIMEOUT_MS, () => cts.cancel())
		if (result === undefined) throw new Error(`The language server did not answer within ${LANGUAGE_SERVER_TIMEOUT_MS / 1000}s (it may still be starting). Try again, or use search_for_files.`)
		return result
	}
	finally {
		cts.dispose()
	}
}

const noLanguageServerMessage = (what: string) => `No language server provides ${what} here, so this tool can't answer. Use search_for_files or search_in_file instead.`


/** Where the program is now, as reported by the debug session (stopped where/why, ended, or still running). */
const formatDebugStop = (s: DebugStopInfo): string => {
	if (s.state === 'terminated') return 'The program has ended (debug session terminated).'
	if (s.state === 'running') return `The program is running and has not stopped${s.waitedMs ? ` within ${Math.round(s.waitedMs / 1000)}s` : ''} (no breakpoint hit yet). Use debug_pause to stop it, or set a breakpoint.`
	const where = s.location ? ` in ${s.location.name} at ${s.location.sourcePath ?? '<no source>'}:${s.location.line}:${s.location.column} (frame ${s.location.frameId})` : ''
	const user = s.userLocation ? `\nFirst frame in your code: ${s.userLocation.name} at ${s.userLocation.sourcePath ?? '<no source>'}:${s.userLocation.line}:${s.userLocation.column} (frame ${s.userLocation.frameId}).` : ''
	return `Stopped (reason: ${s.reason ?? 'unknown'})${where}, thread ${s.threadId}.${s.description ? ` ${s.description}.` : ''}${s.text ? `\nException: ${s.text}` : ''}${user}`
}

/** Exception breakpoints a debugger offers, with which are on. */
const formatExceptionFilters = (filters: DebugExceptionFilter[]): string => {
	if (filters.length === 0) return 'This debugger offers no exception breakpoints.'
	return ['Exception breakpoints:', ...filters.map(f => `  ${f.enabled ? '[on] ' : '[off]'} ${f.filter}: ${f.label}`)].join('\n')
}

// Debug thread ids are adapter-specific (debugpy, js-debug, ... do not use 1). Omitted → the service picks the
// stopped (or only) thread; never a guessed id.
const validateOptionalThreadId = (v: unknown): number | undefined => {
	if (v === undefined || v === null || v === '') return undefined
	const n = Number(v)
	if (!Number.isInteger(n) || n < 0) throw new Error(`Invalid LLM output: thread_id must be an integer thread id from debug_list_threads, got ${JSON.stringify(v)}.`)
	return n
}

// git_stage / git_unstage: models send an array, a JSON-encoded array, or a single path. Silently turning anything
// else into [] made "Staged 0 file(s)" look like success.
const validateGitPaths = (pathsUnknown: unknown): string[] => {
	let value = pathsUnknown
	if (typeof value === 'string' && value.trim().startsWith('[')) {
		try { value = JSON.parse(value) } catch { /* treat as a single path */ }
	}
	const paths = (Array.isArray(value) ? value : typeof value === 'string' ? [value] : []).map(p => String(p).trim()).filter(p => p.length > 0)
	if (paths.length === 0) throw new Error(`Invalid LLM output: "paths" must list at least one file path. Got: ${JSON.stringify(pathsUnknown)}`)
	return paths
}

/**
 * An optional list as models send it: a real array (native tool calls), a JSON array in a string, or one plain string
 * (XML tool calls carry every value as text). Undefined when absent or empty.
 */
const validateOptionalStrList = (value: unknown): string[] | undefined => {
	let v = value
	if (typeof v === 'string' && v.trim().startsWith('[')) {
		try { v = JSON.parse(v) } catch { /* a single string */ }
	}
	const list = (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []).map(x => String(x).trim()).filter(x => x.length > 0)
	return list.length ? list : undefined
}

// revert / cherry-pick / rebase / continue: a stop on conflicts is a result the model must act on, not a success
const stringifyGitStep = (what: string, r: GitStepResult): string => {
	const lines = [r.result]
	if (r.inProgress) {
		lines.push(`${what} stopped: the ${r.inProgress} is in progress with ${r.conflicted.length} conflicted file(s)${r.conflicted.length ? ':' : '.'}`, ...r.conflicted.map(f => `  !! ${f}`))
		lines.push('Resolve the conflicts, git_stage the files, then git_continue — or git_abort to undo it.')
	} else {
		lines.push(`${what} done. HEAD is ${r.head ?? '(none)'}.`)
	}
	return lines.join('\n')
}

const checkIfIsFolder = (uriStr: string) => {
	uriStr = uriStr.trim()
	if (uriStr.endsWith('/') || uriStr.endsWith('\\')) return true
	return false
}

// fetch_url keeps this many pages, to read their next pages without downloading them again
const MAX_RECENT_PAGES = 10

export interface IToolsService {
	readonly _serviceBrand: undefined;
	validateParams: ValidateBuiltinParams;
	callTool: CallBuiltinTool;
	stringOfResult: BuiltinToolResultToString;
}

export const IToolsService = createDecorator<IToolsService>('ToolsService');

export class ToolsService implements IToolsService {

	readonly _serviceBrand: undefined;

	public validateParams: ValidateBuiltinParams;
	public callTool: CallBuiltinTool;
	public stringOfResult: BuiltinToolResultToString;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService workspaceContextService: IWorkspaceContextService,
		@ISearchService searchService: ISearchService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IVoidModelService voidModelService: IVoidModelService,
		@IEditCodeService editCodeService: IEditCodeService,
		@ITerminalToolService private readonly terminalToolService: ITerminalToolService,
		@IGitToolService private readonly gitToolService: IGitToolService,
		@ITestToolService private readonly testToolService: ITestToolService,
		@IDebugToolService private readonly debugToolService: IDebugToolService,
		@IVoidCommandBarService private readonly commandBarService: IVoidCommandBarService,
		@IDirectoryStrService private readonly directoryStrService: IDirectoryStrService,
		@IMarkerService private readonly markerService: IMarkerService,
		@IVoidSettingsService private readonly voidSettingsService: IVoidSettingsService,
		@IProjectMemoryService private readonly projectMemoryService: IProjectMemoryService,
		@ILanguageFeaturesService languageFeaturesService: ILanguageFeaturesService,
		@ITextModelService textModelService: ITextModelService,
		@IMainProcessService mainProcessService: IMainProcessService,
		@IDebuggerActivityService private readonly debuggerActivityService: IDebuggerActivityService,
		@INotebookService private readonly notebookService: INotebookService,
		@INotebookKernelService private readonly notebookKernelService: INotebookKernelService,
		@INotebookExecutionService private readonly notebookExecutionService: INotebookExecutionService,
	) {
		const queryBuilder = instantiationService.createInstance(QueryBuilder);
		const webFetchService = ProxyChannel.toService<IKodiaWebFetchService>(mainProcessService.getChannel('void-channel-webFetch'))
		const webSearchService = ProxyChannel.toService<IWebSearchService>(mainProcessService.getChannel('void-channel-webSearch'))
		const browserService = ProxyChannel.toService<IBrowserService>(mainProcessService.getChannel('void-channel-browser'))
		const codeIndexService = ProxyChannel.toService<ICodeIndexService>(mainProcessService.getChannel('void-channel-code-index'))
		const kodiaOpsService = ProxyChannel.toService<IKodiaOpsMainService>(mainProcessService.getChannel(KODIA_OPS_CHANNEL))
		const designAssetService = ProxyChannel.toService<IDesignAssetMainService>(mainProcessService.getChannel(KODIA_DESIGN_CHANNEL))
		const aiEngineMainService = ProxyChannel.toService<IKodiaAIEngineMainService>(mainProcessService.getChannel(KODIA_AI_ENGINE_CHANNEL))
		const apiStudioMainService = ProxyChannel.toService<IKodiaApiStudioMainService>(mainProcessService.getChannel(KODIA_API_STUDIO_CHANNEL))
		const correctnessMainService = ProxyChannel.toService<IKodiaCorrectnessMainService>(mainProcessService.getChannel(KODIA_CORRECTNESS_CHANNEL))
		const evolutionMainService = ProxyChannel.toService<IKodiaEvolutionMainService>(mainProcessService.getChannel(KODIA_EVOLUTION_CHANNEL))
		const mobileMainService = ProxyChannel.toService<IKodiaMobileMainService>(mainProcessService.getChannel(KODIA_MOBILE_CHANNEL))
		const notebookKernelMainService = ProxyChannel.toService<IKodiaNotebookKernelMainService>(mainProcessService.getChannel(KODIA_NOTEBOOK_KERNEL_CHANNEL))
		const notebookEditHistoryByUri = new Map<string, NotebookEditHistoryState>()
		const getNotebookEditHistory = (uri: URI): NotebookEditHistoryState => {
			const key = uri.toString().toLowerCase()
			let state = notebookEditHistoryByUri.get(key)
			if (!state) {
				state = createNotebookEditHistoryState()
				notebookEditHistoryByUri.set(key, state)
			}
			return state
		}
		const openNotebookInEditor = async (uri: URI): Promise<boolean> => {
			try {
				const editorService = instantiationService.invokeFunction(a => a.get(IEditorService))
				await editorService.openEditor({
					resource: uri,
					options: {
						override: 'jupyter-notebook',
						preserveFocus: true,
						pinned: true,
					},
				})
				return true
			} catch {
				return false
			}
		}
		const syncOpenNotebookFromDisk = async (uri: URI): Promise<void> => {
			try {
				if (!this.notebookService.getNotebookTextModel(uri)) {
					return
				}
				const resolver = instantiationService.invokeFunction(a => a.get(INotebookEditorModelResolverService))
				const ref = await resolver.resolve(uri, 'jupyter-notebook')
				try {
					await ref.object.revert({ soft: false })
				} finally {
					ref.dispose()
				}
			} catch {
				// Best-effort sync; disk file is already authoritative
			}
		}
		const ensureNotebookKernel = (notebookModel: any, kernelId?: string) => {
			const matchResult = this.notebookKernelService.getMatchingKernel(notebookModel)
			const allKernels = [
				...(matchResult.selected ? [matchResult.selected] : []),
				...(matchResult.suggestions || []),
				...(matchResult.all || []),
			]
			if (kernelId) {
				const requested = allKernels.find(k => k.id === kernelId || k.label === kernelId)
				if (requested) {
					this.notebookKernelService.selectKernelForNotebook(requested, notebookModel)
					return requested
				}
			}
			if (!matchResult.selected && allKernels.length > 0) {
				this.notebookKernelService.selectKernelForNotebook(allKernels[0], notebookModel)
				return allKernels[0]
			}
			return matchResult.selected
		}
		const formatNotebookCellOutputs = (rawOutputs: any[]): { formattedOutputs: NotebookCellOutput[]; cellError?: string } => {
			let cellError: string | undefined
			const formattedOutputs: NotebookCellOutput[] = rawOutputs.map((out: any) => {
				const items = Array.isArray(out.outputs) ? out.outputs : []
				const firstItem = items[0]
				const mime = firstItem?.mime ?? 'text/plain'
				const textVal = firstItem?.data ? firstItem.data.toString() : ''
				if (mime === 'application/vnd.code.notebook.error') {
					try {
						const parsed = JSON.parse(textVal)
						cellError = `${parsed.name || 'Error'}: ${parsed.message || textVal}`
						return { output_type: 'error', ename: parsed.name, evalue: parsed.message, traceback: parsed.stack ? String(parsed.stack).split('\n') : [] } as any
					} catch {
						cellError = textVal
						return { output_type: 'error', ename: 'Error', evalue: textVal, traceback: [textVal] } as any
					}
				}
				if (mime === 'application/vnd.code.notebook.stdout') {
					return { output_type: 'stream', name: 'stdout', text: textVal } as any
				}
				if (mime === 'application/vnd.code.notebook.stderr') {
					return { output_type: 'stream', name: 'stderr', text: textVal } as any
				}
				const dataObj: Record<string, string> = {}
				for (const it of items) {
					if (it.mime === 'image/png') {
						dataObj[it.mime] = `<image/png ${it.data?.byteLength ?? 0} bytes>`
					} else {
						dataObj[it.mime] = it.data ? it.data.toString() : ''
					}
				}
				return { output_type: 'display_data', data: dataObj } as any
			})
			return { formattedOutputs, cellError }
		}
		const getDesignService = (): IDesignIntelligenceService | undefined => {
			try { return instantiationService.invokeFunction(a => a.get(IDesignIntelligenceService)) } catch { return undefined }
		}
		const getAIEngineService = (): IAIEngineeringService | undefined => {
			try { return instantiationService.invokeFunction(a => a.get(IAIEngineeringService)) } catch { return undefined }
		}
		const getApiStudioService = (): IApiStudioService | undefined => {
			try { return instantiationService.invokeFunction(a => a.get(IApiStudioService)) } catch { return undefined }
		}
		const getCorrectnessService = (): ICorrectnessService | undefined => {
			try { return instantiationService.invokeFunction(a => a.get(ICorrectnessService)) } catch { return undefined }
		}
		const getEvolutionService = (): IEvolutionService | undefined => {
			try { return instantiationService.invokeFunction(a => a.get(IEvolutionService)) } catch { return undefined }
		}
		const getMobileService = (): IMobileEngineeringService | undefined => {
			try { return instantiationService.invokeFunction(a => a.get(IMobileEngineeringService)) } catch { return undefined }
		}
		const getWorkflowsService = (): IKodiaWorkflowsService | undefined => {
			try { return instantiationService.invokeFunction(a => a.get(IKodiaWorkflowsService)) } catch { return undefined }
		}
		const getDesignSettings = () => this.voidSettingsService.state.globalSettings.designIntelligence ?? DEFAULT_DESIGN_INTELLIGENCE_SETTINGS
		const getAISettings = () => this.voidSettingsService.state.globalSettings.aiEngine ?? DEFAULT_AI_ENGINE_SETTINGS
		const getApiStudioSettings = () => this.voidSettingsService.state.globalSettings.apiStudio ?? DEFAULT_API_STUDIO_SETTINGS
		const getCorrectnessSettings = () => this.voidSettingsService.state.globalSettings.correctness ?? DEFAULT_CORRECTNESS_ENGINE_SETTINGS
		const getEvolutionSettings = () => this.voidSettingsService.state.globalSettings.evolution ?? DEFAULT_EVOLUTION_ENGINE_SETTINGS
		const workspaceFolderPaths = () => workspaceContextService.getWorkspace().folders.map(f => f.uri.fsPath)

		const recentPages = new Map<string, WebFetchResult>()
		const fetchPage = async (url: string) => {
			const cached = recentPages.get(url)
			if (cached) return cached
			const page = await webFetchService.fetchURL(url)
			recentPages.set(url, page)
			if (recentPages.size > MAX_RECENT_PAGES) recentPages.delete(recentPages.keys().next().value!)
			return page
		}

		// Helper to wrap debugger tool calls with activity tracking for live chat UI.
		const withDebugActivity = async <T>(
			type: DebuggerActivityType,
			title: string,
			description: string,
			sessionId: string | undefined,
			fn: () => Promise<T>
		): Promise<T> => {
			const activityId = this.debuggerActivityService.startActivity({
				type,
				title,
				description,
				sessionId,
			})
			try {
				const result = await fn()
				this.debuggerActivityService.completeActivity(activityId, { details: result })
				return result
			} catch (e) {
				this.debuggerActivityService.failActivity(
					activityId,
					e instanceof Error ? e.message : String(e)
				)
				throw e
			}
		}

		const modelOfFile = async (uri: URI) => {
			await voidModelService.initializeModel(uri)
			const { model } = await voidModelService.getModelSafe(uri)
			if (model === null) { throw new Error(`No contents; File does not exist.`) }
			return model
		}

		// The code at each location, `nLines` lines from its start. Each file is loaded once and released
		// afterwards (unlike voidModelService, which keeps files open), since references can span many files.
		const codeLocationsOf = async (links: { uri: URI, range: IRange }[], nLines: number): Promise<CodeLocation[]> => {
			const refOfURI = new Map<string, IReference<IResolvedTextEditorModel> | null>()
			try {
				const locations: CodeLocation[] = []
				for (const { uri, range } of links) {
					const key = uri.toString()
					if (!refOfURI.has(key)) refOfURI.set(key, await textModelService.createModelReference(uri).catch(() => null))
					const model = refOfURI.get(key)?.object.textEditorModel

					const line = range.startLineNumber
					const lastLine = model ? Math.min(line + nLines - 1, model.getLineCount()) : line
					const snippet = model ? model.getValueInRange({ startLineNumber: line, startColumn: 1, endLineNumber: lastLine, endColumn: Number.MAX_SAFE_INTEGER }, EndOfLinePreference.LF) : ''
					locations.push({ uri, line, snippet })
				}
				return locations
			}
			finally {
				for (const ref of refOfURI.values()) ref?.dispose()
			}
		}

		this.validateParams = {
			read_file: (params: RawToolParamsObj) => {
				const { uri: uriStr, start_line: startLineUnknown, end_line: endLineUnknown, page_number: pageNumberUnknown } = params
				const uri = validateURI(uriStr, workspaceContextService)
				const pageNumber = validatePageNum(pageNumberUnknown)

				let startLine = validateNumber(startLineUnknown, { default: null })
				let endLine = validateNumber(endLineUnknown, { default: null })

				if (startLine !== null && startLine < 1) startLine = null
				if (endLine !== null && endLine < 1) endLine = null

				return { uri, startLine, endLine, pageNumber }
			},
			ls_dir: (params: RawToolParamsObj) => {
				const { uri: uriStr, page_number: pageNumberUnknown } = params

				const uri = validateURI(uriStr, workspaceContextService)
				const pageNumber = validatePageNum(pageNumberUnknown)
				return { uri, pageNumber }
			},
			get_dir_tree: (params: RawToolParamsObj) => {
				const { uri: uriStr, } = params
				const uri = validateURI(uriStr, workspaceContextService)
				return { uri }
			},
			search_pathnames_only: (params: RawToolParamsObj) => {
				const {
					query: queryUnknown,
					search_in_folder: includeUnknown,
					page_number: pageNumberUnknown
				} = params

				const queryStr = validateStr('query', queryUnknown)
				const pageNumber = validatePageNum(pageNumberUnknown)
				const includePattern = validateOptionalStr('include_pattern', includeUnknown)

				return { query: queryStr, includePattern, pageNumber }

			},
			search_for_files: (params: RawToolParamsObj) => {
				const {
					query: queryUnknown,
					search_in_folder: searchInFolderUnknown,
					is_regex: isRegexUnknown,
					page_number: pageNumberUnknown
				} = params
				const queryStr = validateStr('query', queryUnknown)
				const pageNumber = validatePageNum(pageNumberUnknown)
				const searchInFolder = validateOptionalURI(searchInFolderUnknown, workspaceContextService)
				const isRegex = validateBoolean(isRegexUnknown, { default: false })
				return {
					query: queryStr,
					isRegex,
					searchInFolder,
					pageNumber
				}
			},
			search_in_file: (params: RawToolParamsObj) => {
				const { uri: uriStr, query: queryUnknown, is_regex: isRegexUnknown } = params;
				const uri = validateURI(uriStr, workspaceContextService);
				const query = validateStr('query', queryUnknown);
				const isRegex = validateBoolean(isRegexUnknown, { default: false });
				return { uri, query, isRegex };
			},
			go_to_definition: (params: RawToolParamsObj) => {
				const { uri: uriStr, line: lineUnknown, symbol: symbolUnknown } = params
				const uri = validateURI(uriStr, workspaceContextService)
				const line = validateLine(lineUnknown)
				const symbol = validateStr('symbol', symbolUnknown).trim()
				if (!symbol) throw new Error(`Invalid LLM output: symbol was empty.`)
				return { uri, line, symbol }
			},
			find_references: (params: RawToolParamsObj) => {
				const { uri: uriStr, line: lineUnknown, symbol: symbolUnknown } = params
				const uri = validateURI(uriStr, workspaceContextService)
				const line = validateLine(lineUnknown)
				const symbol = validateStr('symbol', symbolUnknown).trim()
				if (!symbol) throw new Error(`Invalid LLM output: symbol was empty.`)
				return { uri, line, symbol }
			},
			search_symbols: (params: RawToolParamsObj) => {
				const { query: queryUnknown } = params
				const query = validateStr('query', queryUnknown).trim()
				if (!query) throw new Error(`Invalid LLM output: query was empty.`)
				return { query }
			},

			read_lint_errors: (params: RawToolParamsObj) => {
				const {
					uri: uriUnknown,
				} = params
				const uri = validateURI(uriUnknown, workspaceContextService)
				return { uri }
			},

			read_project_memory: (params: RawToolParamsObj) => {
				return {}
			},

			fetch_url: (params: RawToolParamsObj) => {
				const { url: urlUnknown, page_number: pageNumberUnknown } = params
				const url = validateStr('url', urlUnknown).trim()
				if (!/^https?:\/\//i.test(url)) throw new Error(`Invalid LLM output: url must start with http:// or https://, got "${url}".`)
				const pageNumber = validatePageNum(pageNumberUnknown)
				return { url, pageNumber }
			},

			web_search: (params: RawToolParamsObj) => {
				const { query: queryUnknown, max_results: maxResultsUnknown } = params
				const query = validateStr('query', queryUnknown).trim()
				if (query.length === 0) throw new Error(`Invalid LLM output: query must not be empty.`)
				let maxResults: number | undefined
				if (maxResultsUnknown !== undefined && maxResultsUnknown !== null) {
					const parsed = Number.parseInt(String(maxResultsUnknown), 10)
					if (!Number.isInteger(parsed)) throw new Error(`Invalid LLM output: max_results must be an integer.`)
					if (parsed < 1 || parsed > 20) throw new Error(`Invalid LLM output: max_results must be between 1 and 20.`)
					maxResults = parsed
				}
				return { query, maxResults }
			},

			// --- Browser automation ---
			browser_launch: (params: RawToolParamsObj) => {
				const headless = validateBoolean(params.headless, { default: false })
				let viewport: { width: number; height: number } | undefined
				if (params.viewport) {
					const v = params.viewport as any
					const width = validateNumber(v.width, { default: 1280 }) ?? 1280
					const height = validateNumber(v.height, { default: 800 }) ?? 800
					viewport = { width, height }
				}
				return { headless, viewport }
			},
			browser_close: (params: RawToolParamsObj) => {
				const sessionId = validateStr('sessionId', params.session_id)
				return { sessionId }
			},
			browser_list_sessions: () => ({}),
			browser_new_tab: (params: RawToolParamsObj) => {
				const sessionId = validateStr('sessionId', params.session_id)
				const url = validateOptionalStr('url', params.url) ?? undefined
				return { sessionId, url }
			},
			browser_list_tabs: (params: RawToolParamsObj) => {
				const sessionId = validateStr('sessionId', params.session_id)
				return { sessionId }
			},
			browser_switch_tab: (params: RawToolParamsObj) => {
				const sessionId = validateStr('sessionId', params.session_id)
				const tabId = validateStr('tabId', params.tab_id)
				return { sessionId, tabId }
			},
			browser_close_tab: (params: RawToolParamsObj) => {
				const sessionId = validateStr('sessionId', params.session_id)
				const tabId = validateStr('tabId', params.tab_id)
				return { sessionId, tabId }
			},
			browser_navigate: (params: RawToolParamsObj) => {
				const sessionId = validateStr('sessionId', params.session_id)
				const tabId = validateStr('tabId', params.tab_id)
				const url = validateStr('url', params.url)
				return { sessionId, tabId, url }
			},
			browser_back: (params: RawToolParamsObj) => {
				const sessionId = validateStr('sessionId', params.session_id)
				const tabId = validateStr('tabId', params.tab_id)
				return { sessionId, tabId }
			},
			browser_forward: (params: RawToolParamsObj) => {
				const sessionId = validateStr('sessionId', params.session_id)
				const tabId = validateStr('tabId', params.tab_id)
				return { sessionId, tabId }
			},
			browser_reload: (params: RawToolParamsObj) => {
				const sessionId = validateStr('sessionId', params.session_id)
				const tabId = validateStr('tabId', params.tab_id)
				return { sessionId, tabId }
			},
			browser_inspect_page: (params: RawToolParamsObj) => {
				const sessionId = validateStr('sessionId', params.session_id)
				const tabId = validateStr('tabId', params.tab_id)
				return { sessionId, tabId }
			},
			browser_click_element: (params: RawToolParamsObj) => {
				const sessionId = validateStr('sessionId', params.session_id)
				const tabId = validateStr('tabId', params.tab_id)
				const selector = validateStr('selector', params.selector)
				return { sessionId, tabId, selector }
			},
			browser_fill_element: (params: RawToolParamsObj) => {
				const sessionId = validateStr('sessionId', params.session_id)
				const tabId = validateStr('tabId', params.tab_id)
				const selector = validateStr('selector', params.selector)
				const text = validateStr('text', params.text)
				return { sessionId, tabId, selector, text }
			},
			browser_select_option: (params: RawToolParamsObj) => {
				const sessionId = validateStr('sessionId', params.session_id)
				const tabId = validateStr('tabId', params.tab_id)
				const selector = validateStr('selector', params.selector)
				const value = validateStr('value', params.value)
				return { sessionId, tabId, selector, value }
			},
			browser_check_element: (params: RawToolParamsObj) => {
				const sessionId = validateStr('sessionId', params.session_id)
				const tabId = validateStr('tabId', params.tab_id)
				const selector = validateStr('selector', params.selector)
				const checked = validateBoolean(params.checked, { default: false })
				return { sessionId, tabId, selector, checked }
			},
			browser_submit_form: (params: RawToolParamsObj) => {
				const sessionId = validateStr('sessionId', params.session_id)
				const tabId = validateStr('tabId', params.tab_id)
				const selector = validateStr('selector', params.selector)
				return { sessionId, tabId, selector }
			},
			browser_wait_for_element: (params: RawToolParamsObj) => {
				const sessionId = validateStr('sessionId', params.session_id)
				const tabId = validateStr('tabId', params.tab_id)
				const selector = validateStr('selector', params.selector)
				const timeoutMs = params.timeout_ms === undefined || params.timeout_ms === null ? undefined : Number(params.timeout_ms)
				return { sessionId, tabId, selector, timeoutMs }
			},
			browser_set_viewport: (params: RawToolParamsObj) => {
				const sessionId = validateStr('sessionId', params.session_id)
				const tabId = validateStr('tabId', params.tab_id)
				const width = validateNumber(params.width, { default: null })
				const height = validateNumber(params.height, { default: null })
				if (width === null || height === null) throw new Error('Invalid LLM output: width and height are required numbers.')
				return { sessionId, tabId, width, height }
			},
			browser_screenshot: (params: RawToolParamsObj) => {
				const sessionId = validateStr('sessionId', params.session_id)
				const tabId = validateStr('tabId', params.tab_id)
				const type = params.type === 'viewport' || params.type === 'fullpage' || params.type === 'element' ? params.type : 'viewport'
				const selector = validateOptionalStr('selector', params.selector) ?? undefined
				return { sessionId, tabId, type, selector }
			},
			browser_console: (params: RawToolParamsObj) => {
				const sessionId = validateStr('sessionId', params.session_id)
				const tabId = validateStr('tabId', params.tab_id)
				const level = params.level === 'debug' || params.level === 'info' || params.level === 'warning' || params.level === 'error' ? params.level : undefined
				const limit = params.limit === undefined || params.limit === null ? undefined : Number(params.limit)
				return { sessionId, tabId, level, limit }
			},
			browser_network_failures: (params: RawToolParamsObj) => {
				const sessionId = validateStr('sessionId', params.session_id)
				const tabId = validateStr('tabId', params.tab_id)
				return { sessionId, tabId }
			},
			browser_download: (params: RawToolParamsObj) => {
				const sessionId = validateStr('sessionId', params.session_id)
				const tabId = validateStr('tabId', params.tab_id)
				const url = validateStr('url', params.url)
				return { sessionId, tabId, url }
			},
			browser_list_downloads: (params: RawToolParamsObj) => {
				const sessionId = validateStr('sessionId', params.session_id)
				return { sessionId }
			},
			browser_shutdown: () => ({}),

			// --- Autonomous dev cycle tools ---
			dep_install: (params: RawToolParamsObj) => {
				const command = validateStr('command', params.command)
				const cwd = validateOptionalStr('cwd', params.cwd) ?? undefined
				return { command, cwd }
			},
			db_migrate: (params: RawToolParamsObj) => {
				const command = validateStr('command', params.command)
				const cwd = validateOptionalStr('cwd', params.cwd) ?? undefined
				return { command, cwd }
			},
			lint_run: (params: RawToolParamsObj) => {
				const command = validateStr('command', params.command)
				const cwd = validateOptionalStr('cwd', params.cwd) ?? undefined
				return { command, cwd }
			},
			log_read: (params: RawToolParamsObj) => {
				const path = validateStr('path', params.path)
				const lines = params.lines === undefined || params.lines === null ? undefined : Number(params.lines)
				return { path, lines }
			},
			autonomous_dev_cycle: (params: RawToolParamsObj) => {
				const projectType = validateStr('project_type', params.project_type)
				const projectDescription = validateStr('project_description', params.project_description)
				const port = params.port === undefined || params.port === null ? undefined : Number(params.port)
				const cwd = validateOptionalStr('cwd', params.cwd) ?? undefined
				const maxCycles = params.max_cycles === undefined || params.max_cycles === null ? 5 : Number(params.max_cycles)
				return { project_type: projectType, project_description: projectDescription, port, cwd, max_cycles: maxCycles }
			},

			// --- Dev server automation ---
			dev_server_start: (params: RawToolParamsObj) => {
				const { command: commandUnknown } = params
				const command = validateStr('command', commandUnknown)
				const cwd = validateOptionalStr('cwd', params.cwd) ?? undefined
				const port = params.port === undefined || params.port === null ? undefined : Number(params.port)
				const name = validateOptionalStr('name', params.name) ?? undefined
				return { command, cwd, port, name }
			},
			dev_server_stop: (params: RawToolParamsObj) => {
				const name = validateOptionalStr('name', params.name) ?? undefined
				const terminalId = validateOptionalStr('terminal_id', params.terminal_id) ?? undefined
				return { name, terminal_id: terminalId }
			},
			dev_server_list: () => ({}),
			dev_server_status: (params: RawToolParamsObj) => {
				const name = validateOptionalStr('name', params.name) ?? undefined
				const port = params.port === undefined || params.port === null ? undefined : Number(params.port)
				return { name, port }
			},
			// --- Direct API testing ---
			api_request: (params: RawToolParamsObj) => {
				const p = params as any
				const url = validateStr('url', p.url)
				const method = p.method === 'GET' || p.method === 'POST' || p.method === 'PUT' || p.method === 'DELETE' || p.method === 'PATCH' ? p.method : 'GET'
				const headers = p.headers && typeof p.headers === 'object' ? p.headers as Record<string, string> : undefined
				const body = validateOptionalStr('body', p.body) ?? undefined
				const timeoutMs = p.timeout_ms === undefined || p.timeout_ms === null ? undefined : Number(p.timeout_ms)
				const useCookieJar = p.use_cookie_jar === true
				const cookies = p.cookies && Array.isArray(p.cookies) ? (p.cookies as any[]).map((c: any) => ({
					name: validateStr('name', c.name),
					value: validateStr('value', c.value),
					domain: validateStr('domain', c.domain),
					path: validateStr('path', c.path),
					expires: c.expires === undefined || c.expires === null ? undefined : Number(c.expires),
					httpOnly: c.httpOnly === true,
					secure: c.secure === true,
				})) : undefined
				const oauth2Tokens = p.oauth2_tokens && typeof p.oauth2_tokens === 'object' ? {
					access_token: validateStr('access_token', p.oauth2_tokens.access_token),
					refresh_token: p.oauth2_tokens.refresh_token ?? undefined,
					expires_in: p.oauth2_tokens.expires_in === undefined || p.oauth2_tokens.expires_in === null ? undefined : Number(p.oauth2_tokens.expires_in),
					token_type: p.oauth2_tokens.token_type ?? undefined,
					scope: p.oauth2_tokens.scope ?? undefined,
				} : undefined
				const multipartBody = p.multipart_body && typeof p.multipart_body === 'object' ? {
					fields: p.multipart_body.fields && Array.isArray(p.multipart_body.fields) ? (p.multipart_body.fields as any[]).map((f: any) => ({
						name: validateStr('name', f.name),
						value: validateStr('value', f.value),
					})) : [],
					files: p.multipart_body.files && Array.isArray(p.multipart_body.files) ? (p.multipart_body.files as any[]).map((f: any) => ({
						name: validateStr('name', f.name),
						filename: validateStr('filename', f.filename),
						content_type: validateStr('content_type', f.content_type),
						content: validateStr('content', f.content),
					})) : [],
				} : undefined
				return { url, method, headers, body, timeout_ms: timeoutMs, cookies, use_cookie_jar: useCookieJar, oauth2_tokens: oauth2Tokens, multipart_body: multipartBody }
			},
			port_check: (params: RawToolParamsObj) => {
				const port = validateNumber(params.port, { default: null })
				if (port === null) throw new Error('Invalid LLM output: port must be a number.')
				return { port }
			},
			// Cookie management
			api_get_cookies: () => ({}),
			api_set_cookies: (params: RawToolParamsObj) => {
				const cookies = params.cookies && Array.isArray(params.cookies) ? params.cookies.map((c: any) => ({
					name: validateStr('name', c.name),
					value: validateStr('value', c.value),
					domain: validateStr('domain', c.domain),
					path: validateStr('path', c.path),
					expires: c.expires === undefined || c.expires === null ? undefined : Number(c.expires),
					httpOnly: c.httpOnly === true,
					secure: c.secure === true,
				})) : []
				return { cookies }
			},
			api_add_cookie: (params: RawToolParamsObj) => {
				const c = params.cookie && typeof params.cookie === 'object' ? params.cookie as any : null
				if (!c) throw new Error('Invalid LLM output: cookie object is required.')
				const cookie = {
					name: validateStr('name', c.name),
					value: validateStr('value', c.value),
					domain: validateStr('domain', c.domain),
					path: validateStr('path', c.path),
					expires: c.expires === undefined || c.expires === null ? undefined : Number(c.expires),
					httpOnly: c.httpOnly === true,
					secure: c.secure === true,
				}
				return { cookie }
			},
			api_clear_cookies: () => ({}),
			// OAuth2
			oauth2_generate_auth_url: (params: RawToolParamsObj) => {
				const clientId = validateStr('client_id', params.client_id)
				const clientSecret = validateStr('client_secret', params.client_secret)
				const authorizationUrl = validateStr('authorization_url', params.authorization_url)
				const tokenUrl = validateStr('token_url', params.token_url)
				const redirectUri = validateStr('redirect_uri', params.redirect_uri)
				const scope = validateOptionalStr('scope', params.scope) ?? undefined
				return { client_id: clientId, client_secret: clientSecret, authorization_url: authorizationUrl, token_url: tokenUrl, redirect_uri: redirectUri, scope }
			},
			oauth2_exchange_code: (params: RawToolParamsObj) => {
				const clientId = validateStr('client_id', params.client_id)
				const clientSecret = validateStr('client_secret', params.client_secret)
				const tokenUrl = validateStr('token_url', params.token_url)
				const redirectUri = validateStr('redirect_uri', params.redirect_uri)
				const code = validateStr('code', params.code)
				const codeVerifier = validateOptionalStr('code_verifier', params.code_verifier) ?? undefined
				return { client_id: clientId, client_secret: clientSecret, token_url: tokenUrl, redirect_uri: redirectUri, code, code_verifier: codeVerifier }
			},
			oauth2_refresh_token: (params: RawToolParamsObj) => {
				const clientId = validateStr('client_id', params.client_id)
				const clientSecret = validateStr('client_secret', params.client_secret)
				const tokenUrl = validateStr('token_url', params.token_url)
				const refreshToken = validateStr('refresh_token', params.refresh_token)
				return { client_id: clientId, client_secret: clientSecret, token_url: tokenUrl, refresh_token: refreshToken }
			},

			// --- Code Index & Semantic Search ---
			code_index: (params: RawToolParamsObj) => {
				return {}
			},
			code_index_file: (params: RawToolParamsObj) => {
				const uri = validateURI(params.uri, workspaceContextService)
				return { uri }
			},
			code_semantic_search: (params: RawToolParamsObj) => {
				const query = validateStr('query', params.query)
				if (!query.trim()) throw new Error('Invalid LLM output: query must not be empty.')
				return { query, limit: validateNumber(params.limit, { default: 10 }) ?? 10 }
			},
			code_keyword_search: (params: RawToolParamsObj) => {
				const query = validateStr('query', params.query)
				if (!query.trim()) throw new Error('Invalid LLM output: query must not be empty.')
				return { query, limit: validateNumber(params.limit, { default: 30 }) ?? 30 }
			},
			code_hybrid_search: (params: RawToolParamsObj) => {
				const query = validateStr('query', params.query)
				if (!query.trim()) throw new Error('Invalid LLM output: query must not be empty.')
				return { query, limit: validateNumber(params.limit, { default: 10 }) ?? 10 }
			},
			code_index_stats: () => ({}),
			code_index_clear: () => ({}),

			// --- Debugger automation ---
			debug_list_configurations: () => ({}),
			debug_list_sessions: () => ({}),
			debug_get_session_status: (params: RawToolParamsObj) => {
				const sessionId = validateStr('sessionId', params.session_id)
				return { sessionId }
			},
			debug_list_threads: (params: RawToolParamsObj) => {
				const sessionId = validateStr('sessionId', params.session_id)
				return { sessionId }
			},
			debug_start_session: (params: RawToolParamsObj) => {
				const configurationName = validateOptionalStr('configurationName', params.configuration_name) ?? undefined
				const folder = validateOptionalStr('folder', params.folder) ?? undefined
				const noDebug = validateBoolean(params.no_debug, { default: false })
				let configuration: Record<string, unknown> | undefined
				const raw: unknown = params.configuration
				if (raw !== undefined && raw !== null && raw !== '') {
					let value = raw
					if (typeof value === 'string') {
						try { value = JSON.parse(value) } catch { throw new Error(`Invalid LLM output: "configuration" must be a JSON object, e.g. {"type":"node","request":"launch","program":"\${workspaceFolder}/app.js"}.`) }
					}
					if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid LLM output: "configuration" must be an object.`)
					configuration = value as Record<string, unknown>
				}
				if (!configurationName && !configuration) throw new Error(`Invalid LLM output: give "configuration_name" (from debug_list_configurations) or an inline "configuration".`)
				return { configurationName, folder, noDebug, configuration }
			},
			debug_attach_session: (params: RawToolParamsObj) => {
				const configurationName = validateStr('configurationName', params.configuration_name)
				const folder = validateOptionalStr('folder', params.folder) ?? undefined
				return { configurationName, folder }
			},
			debug_stop_session: (params: RawToolParamsObj) => {
				const sessionId = validateStr('sessionId', params.session_id)
				const restart = validateBoolean(params.restart, { default: false })
				const suspend = validateBoolean(params.suspend, { default: false })
				return { sessionId, restart, suspend }
			},
			debug_restart_session: (params: RawToolParamsObj) => {
				const sessionId = validateStr('sessionId', params.session_id)
				return { sessionId }
			},
			debug_set_breakpoint: (params: RawToolParamsObj) => {
				const sessionId = validateOptionalStr('sessionId', params.session_id) ?? undefined
				const uri = validateStr('uri', params.uri)
				const lineNumber = validateLine(params.line_number)
				const column = params.column === undefined || params.column === null ? undefined : validateLine(params.column)
				const condition = validateOptionalStr('condition', params.condition) ?? undefined
				const hitCondition = validateOptionalStr('hitCondition', params.hit_condition) ?? undefined
				const logMessage = validateOptionalStr('logMessage', params.log_message) ?? undefined
				return { sessionId, uri, lineNumber, column, condition, hitCondition, logMessage }
			},
			debug_remove_breakpoint: (params: RawToolParamsObj) => {
				const breakpointId = validateStr('breakpointId', params.breakpoint_id)
				return { breakpointId }
			},
			debug_set_breakpoint_enabled: (params: RawToolParamsObj) => {
				const breakpointId = validateStr('breakpointId', params.breakpoint_id)
				const enabled = validateBoolean(params.enabled, { default: true })
				return { breakpointId, enabled }
			},
			debug_list_breakpoints: () => ({}),
			debug_set_exception_breakpoints: (params: RawToolParamsObj) => {
				const sessionId = validateStr('sessionId', params.session_id)
				const filters = validateOptionalStrList(params.filters) ?? []
				return { sessionId, filters }
			},
			debug_continue: (params: RawToolParamsObj) => {
				const sessionId = validateStr('sessionId', params.session_id)
				const threadId = validateOptionalThreadId(params.thread_id)
				return { sessionId, threadId }
			},
			debug_pause: (params: RawToolParamsObj) => {
				const sessionId = validateStr('sessionId', params.session_id)
				const threadId = validateOptionalThreadId(params.thread_id)
				return { sessionId, threadId }
			},
			debug_step_over: (params: RawToolParamsObj) => {
				const sessionId = validateStr('sessionId', params.session_id)
				const threadId = validateOptionalThreadId(params.thread_id)
				return { sessionId, threadId }
			},
			debug_step_into: (params: RawToolParamsObj) => {
				const sessionId = validateStr('sessionId', params.session_id)
				const threadId = validateOptionalThreadId(params.thread_id)
				return { sessionId, threadId }
			},
			debug_step_out: (params: RawToolParamsObj) => {
				const sessionId = validateStr('sessionId', params.session_id)
				const threadId = validateOptionalThreadId(params.thread_id)
				return { sessionId, threadId }
			},
			debug_get_stack_trace: (params: RawToolParamsObj) => {
				const sessionId = validateStr('sessionId', params.session_id)
				const threadId = validateOptionalThreadId(params.thread_id)
				const startFrame = params.start_frame === undefined || params.start_frame === null ? 0 : Number(params.start_frame)
				const levels = params.levels === undefined || params.levels === null ? 50 : Number(params.levels)
				return { sessionId, threadId, startFrame, levels }
			},
			debug_get_scopes: (params: RawToolParamsObj) => {
				const sessionId = validateStr('sessionId', params.session_id)
				const frameId = params.frame_id === undefined || params.frame_id === null ? 0 : Number(params.frame_id)
				const threadId = params.thread_id === undefined || params.thread_id === null ? undefined : Number(params.thread_id)
				return { sessionId, frameId, threadId }
			},
			debug_get_variables: (params: RawToolParamsObj) => {
				const sessionId = validateStr('sessionId', params.session_id)
				const variablesReference = params.variables_reference === undefined || params.variables_reference === null ? 0 : Number(params.variables_reference)
				const start = params.start === undefined || params.start === null ? undefined : Number(params.start)
				const count = params.count === undefined || params.count === null ? undefined : Number(params.count)
				return { sessionId, variablesReference, start, count }
			},
			debug_get_exception_info: (params: RawToolParamsObj) => {
				const sessionId = validateStr('sessionId', params.session_id)
				const threadId = validateOptionalThreadId(params.thread_id)
				return { sessionId, threadId }
			},
			debug_evaluate_expression: (params: RawToolParamsObj) => {
				const sessionId = validateStr('sessionId', params.session_id)
				const expression = validateStr('expression', params.expression)
				const frameId = params.frame_id === undefined || params.frame_id === null ? undefined : Number(params.frame_id)
				return { sessionId, expression, frameId }
			},
			debug_get_console_output: (params: RawToolParamsObj) => {
				const sessionId = validateOptionalStr('sessionId', params.session_id) ?? undefined
				const limit = params.limit === undefined || params.limit === null ? 200 : Number(params.limit)
				return { sessionId, limit }
			},

			// ---

			create_file_or_folder: (params: RawToolParamsObj) => {
				const { uri: uriUnknown } = params
				const uri = validateURI(uriUnknown, workspaceContextService)
				const uriStr = validateStr('uri', uriUnknown)
				const isFolder = checkIfIsFolder(uriStr)
				return { uri, isFolder }
			},

			delete_file_or_folder: (params: RawToolParamsObj) => {
				const { uri: uriUnknown, is_recursive: isRecursiveUnknown } = params
				const uri = validateURI(uriUnknown, workspaceContextService)
				const isRecursive = validateBoolean(isRecursiveUnknown, { default: false })
				const uriStr = validateStr('uri', uriUnknown)
				const isFolder = checkIfIsFolder(uriStr)
				return { uri, isRecursive, isFolder }
			},

			rewrite_file: (params: RawToolParamsObj) => {
				const { uri: uriStr, new_content: newContentUnknown } = params
				const uri = validateURI(uriStr, workspaceContextService)
				const newContent = validateStr('newContent', newContentUnknown)
				return { uri, newContent }
			},

			// write_file: alias for rewrite_file
			write_file: (params: RawToolParamsObj) => {
				const { uri: uriStr, new_content: newContentUnknown } = params
				const uri = validateURI(uriStr, workspaceContextService)
				const newContent = validateStr('newContent', newContentUnknown)
				return { uri, newContent }
			},

			edit_file: (params: RawToolParamsObj) => {
				const { uri: uriStr, search_replace_blocks: searchReplaceBlocksUnknown } = params
				const uri = validateURI(uriStr, workspaceContextService)
				const searchReplaceBlocks = validateStr('searchReplaceBlocks', searchReplaceBlocksUnknown)
				return { uri, searchReplaceBlocks }
			},

			write_project_memory: (params: RawToolParamsObj) => {
				const { section: sectionUnknown, content: contentUnknown } = params
				const section = validateStr('section', sectionUnknown).replace(/^#+\s*/, '').trim()
				if (!section || section.includes('\n')) throw new Error(`Invalid LLM output: section must be a one-line title, e.g. "Conventions".`)
				const content = validateOptionalStr('content', contentUnknown) ?? '' // empty deletes the section
				return { section, content }
			},

			// ---

			run_command: (params: RawToolParamsObj) => {
				const { command: commandUnknown, cwd: cwdUnknown } = params
				const command = validateStr('command', commandUnknown)
				const cwd = validateOptionalStr('cwd', cwdUnknown)
				const terminalId = generateUuid()
				return { command, cwd, terminalId }
			},
			run_persistent_command: (params: RawToolParamsObj) => {
				const { command: commandUnknown, persistent_terminal_id: persistentTerminalIdUnknown } = params;
				const command = validateStr('command', commandUnknown);
				const persistentTerminalId = validateProposedTerminalId(persistentTerminalIdUnknown)
				return { command, persistentTerminalId };
			},
			open_persistent_terminal: (params: RawToolParamsObj) => {
				const { cwd: cwdUnknown } = params;
				const cwd = validateOptionalStr('cwd', cwdUnknown)
				// No parameters needed; will open a new background terminal
				return { cwd };
			},
			kill_persistent_terminal: (params: RawToolParamsObj) => {
				const { persistent_terminal_id: terminalIdUnknown } = params;
				const persistentTerminalId = validateProposedTerminalId(terminalIdUnknown);
				return { persistentTerminalId };
			},

			// Terminal session management (Stage 5A Day 1)
			list_terminals: (params: RawToolParamsObj) => {
				return {}
			},
			read_terminal: (params: RawToolParamsObj) => {
				const { terminal_id: terminalIdUnknown } = params
				const terminalId = validateProposedTerminalId(terminalIdUnknown)
				const { offset: offsetUnknown } = params
				const offset = offsetUnknown === undefined || offsetUnknown === null ? undefined : Number(offsetUnknown)
				return { terminalId, offset }
			},
			send_command_to_terminal: (params: RawToolParamsObj) => {
				const { terminal_id: terminalIdUnknown, command: commandUnknown } = params
				const terminalId = validateProposedTerminalId(terminalIdUnknown)
				const command = validateStr('command', commandUnknown)
				return { terminalId, command }
			},
			interrupt_terminal: (params: RawToolParamsObj) => {
				const { terminal_id: terminalIdUnknown } = params
				const terminalId = validateProposedTerminalId(terminalIdUnknown)
				return { terminalId }
			},
			close_terminal: (params: RawToolParamsObj) => {
				const { terminal_id: terminalIdUnknown } = params
				const terminalId = validateProposedTerminalId(terminalIdUnknown)
				return { terminalId }
			},

			// Task plan management (Stage 5A Day 2)
			create_task_plan: (params: RawToolParamsObj) => {
				const rawTitle = params.title ?? (params as any).name ?? (params as any).plan_title ?? (params as any).goal
				const title = typeof rawTitle === 'string' && rawTitle.trim()
					? rawTitle.trim()
					: (typeof params.description === 'string' && params.description.trim() ? params.description.trim().slice(0, 80) : 'Task Plan')
				const rawDesc = params.description ?? (params as any).summary ?? title
				const description = typeof rawDesc === 'string' && rawDesc.trim() ? rawDesc.trim() : title
				let tasksUnknown: unknown = params.tasks ?? (params as any).steps
				if (typeof tasksUnknown === 'string') {
					try { tasksUnknown = JSON.parse(tasksUnknown) } catch { /* leave as string */ }
				}
				let tasks: { title: string, description: string, dependencies: string[], priority?: 'high' | 'medium' | 'low', assignedAgent?: string, acceptanceCriteria?: string[] }[] = []
				if (Array.isArray(tasksUnknown)) {
					tasks = tasksUnknown.map((t: any, idx: number) => {
						if (typeof t === 'string') {
							return { title: t.trim() || `Task ${idx + 1}`, description: t.trim() || `Task ${idx + 1}`, dependencies: [] }
						}
						const itemTitle = String(t?.title ?? t?.name ?? t?.content ?? t?.description ?? `Task ${idx + 1}`).trim()
						const itemDesc = String(t?.description ?? t?.details ?? itemTitle).trim()
						return {
							title: itemTitle,
							description: itemDesc,
							dependencies: Array.isArray(t?.dependencies) ? t.dependencies.map((d: any) => String(d)) : [],
							...(t?.priority === 'high' || t?.priority === 'medium' || t?.priority === 'low' ? { priority: t.priority } : {}),
							...(typeof t?.assignedAgent === 'string' && t.assignedAgent.trim() ? { assignedAgent: t.assignedAgent.trim() } : typeof t?.assigned_agent === 'string' && t.assigned_agent.trim() ? { assignedAgent: t.assigned_agent.trim() } : {}),
							...(Array.isArray(t?.acceptanceCriteria) ? { acceptanceCriteria: t.acceptanceCriteria.map((c: any) => String(c)) } : Array.isArray(t?.acceptance_criteria) ? { acceptanceCriteria: t.acceptance_criteria.map((c: any) => String(c)) } : {}),
						}
					})
				}
				return { title, description, tasks }
			},
			update_task_plan: (params: RawToolParamsObj) => {
				const rawTaskId = params.task_id ?? (params as any).taskId ?? (params as any).id ?? (params as any).step_id
				if (rawTaskId === undefined || rawTaskId === null || String(rawTaskId).trim() === '') {
					throw new Error(`Invalid LLM output: task_id must be specified (got "${String(rawTaskId)}").`)
				}
				const taskId = String(rawTaskId).trim()
				const rawStatus = params.status ?? 'completed'
				const status = validateStr('status', rawStatus) as TaskStatus
				const result = validateOptionalStr('result', params.result)
				const error = validateOptionalStr('error', params.error)
				return { taskId, status, result, error }
			},
			get_task_plan: (params: RawToolParamsObj) => {
				return {}
			},

			// Git operations (Stage 2)
			git_status: () => {
				return {}
			},
			git_diff: (params: RawToolParamsObj) => {
				const { ref: refUnknown, path: pathUnknown, staged: stagedUnknown } = params
				const ref = validateOptionalStr('ref', refUnknown)
				const path = validateOptionalStr('path', pathUnknown)
				const staged = validateBoolean(stagedUnknown, { default: false })
				return { ref, path, staged }
			},
			git_log: (params: RawToolParamsObj) => {
				const { max_count: maxCountUnknown, path: pathUnknown } = params
				const maxCount = maxCountUnknown === undefined || maxCountUnknown === null ? null : Number(maxCountUnknown)
				const path = validateOptionalStr('path', pathUnknown)
				return { max_count: maxCount, path }
			},
			git_branch_list: () => {
				return {}
			},
			git_branch_create: (params: RawToolParamsObj) => {
				const { branch_name: branchNameUnknown, start_point: startPointUnknown } = params
				const branchName = validateStr('branch_name', branchNameUnknown)
				const startPoint = validateOptionalStr('start_point', startPointUnknown)
				return { branch_name: branchName, start_point: startPoint }
			},
			git_branch_switch: (params: RawToolParamsObj) => {
				const { branch_name: branchNameUnknown } = params
				const branchName = validateStr('branch_name', branchNameUnknown)
				return { branch_name: branchName }
			},
			git_stage: (params: RawToolParamsObj) => {
				return { paths: validateGitPaths(params.paths) }
			},
			git_unstage: (params: RawToolParamsObj) => {
				return { paths: validateGitPaths(params.paths) }
			},
			git_commit: (params: RawToolParamsObj) => {
				const { message: messageUnknown, amend: amendUnknown } = params
				const message = validateStr('message', messageUnknown)
				const amend = validateBoolean(amendUnknown, { default: false })
				return { message, amend }
			},
			git_fetch: (params: RawToolParamsObj) => {
				const { remote: remoteUnknown } = params
				const remote = validateOptionalStr('remote', remoteUnknown)
				return { remote }
			},
			git_pull: (params: RawToolParamsObj) => {
				const { remote: remoteUnknown, branch: branchUnknown } = params
				const remote = validateOptionalStr('remote', remoteUnknown)
				const branch = validateOptionalStr('branch', branchUnknown)
				return { remote, branch }
			},
			git_push: (params: RawToolParamsObj) => {
				const { remote: remoteUnknown, branch: branchUnknown, force: forceUnknown } = params
				const remote = validateOptionalStr('remote', remoteUnknown)
				const branch = validateOptionalStr('branch', branchUnknown)
				const force = validateBoolean(forceUnknown, { default: false })
				return { remote, branch, force }
			},
			git_merge: (params: RawToolParamsObj) => {
				const { branch: branchUnknown } = params
				const branch = validateStr('branch', branchUnknown)
				return { branch }
			},
			git_stash: (params: RawToolParamsObj) => {
				const { message: messageUnknown } = params
				const message = validateOptionalStr('message', messageUnknown)
				return { message }
			},
			git_stash_pop: () => {
				return {}
			},
			git_show: (params: RawToolParamsObj) => {
				const { commit: commitUnknown, path: pathUnknown } = params
				const commit = validateStr('commit', commitUnknown)
				const path = validateOptionalStr('path', pathUnknown)
				return { commit, path }
			},
			git_revert: (params: RawToolParamsObj) => ({ commit: validateStr('commit', params.commit) }),
			git_cherry_pick: (params: RawToolParamsObj) => ({ commit: validateStr('commit', params.commit) }),
			git_rebase: (params: RawToolParamsObj) => ({ onto: validateStr('onto', params.onto) }),
			git_continue: () => ({}),
			git_abort: () => ({}),
			git_reset: (params: RawToolParamsObj) => {
				const ref = validateStr('ref', params.ref)
				const mode = (validateOptionalStr('mode', params.mode) ?? 'mixed').trim().toLowerCase()
				if (mode !== 'soft' && mode !== 'mixed' && mode !== 'hard') { throw new Error(`Invalid LLM output: mode must be "soft", "mixed" or "hard", got "${mode}".`) }
				return { ref, mode }
			},
			git_tag_list: () => ({}),
			git_tag_create: (params: RawToolParamsObj) => ({
				name: validateStr('name', params.name),
				ref: validateOptionalStr('ref', params.ref),
				message: validateOptionalStr('message', params.message),
			}),
			git_remote_list: () => ({}),
			git_worktree_list: () => ({}),
			git_worktree_add: (params: RawToolParamsObj) => ({
				path: validateStr('path', params.path),
				branch: validateStr('branch', params.branch),
				new_branch: validateBoolean(params.new_branch, { default: false }),
				start_point: validateOptionalStr('start_point', params.start_point),
			}),
			git_commit_context: (params: RawToolParamsObj) => ({ max_diff_chars: validateNumber(params.max_diff_chars, { default: null }) }),
			git_pr_prepare: (params: RawToolParamsObj) => ({ base: validateOptionalStr('base', params.base) }),

			// Test discovery and execution (Stage 3)
			test_discover: () => {
				return {}
			},
			test_list: () => {
				return {}
			},
			test_run: (params: RawToolParamsObj) => {
				// strings too: before, a single path or name sent as text was dropped and the whole suite ran instead
				return { test_files: validateOptionalStrList(params.test_files), test_names: validateOptionalStrList(params.test_names) }
			},
			test_run_targeted: (params: RawToolParamsObj) => {
				const changedFiles = validateOptionalStrList(params.changed_files)
				if (!changedFiles) throw new Error(`Invalid LLM output: "changed_files" must list at least one file path. Got: ${JSON.stringify(params.changed_files)}`)
				return { changed_files: changedFiles }
			},
			test_coverage: (params: RawToolParamsObj) => {
				return { test_files: validateOptionalStrList(params.test_files), test_names: validateOptionalStrList(params.test_names), files: validateOptionalStrList(params.files) }
			},
			test_history: (params: RawToolParamsObj) => {
				return { test_name: validateOptionalStr('test_name', params.test_name) ?? undefined, only_problems: validateBoolean(params.only_problems, { default: false }), limit: validateNumber(params.limit, { default: 30 }) ?? 30 }
			},
			test_check_flaky: (params: RawToolParamsObj) => {
				const attempts = validateNumber(params.attempts, { default: 3 }) ?? 3
				if (!Number.isInteger(attempts) || attempts < 2 || attempts > 10) throw new Error(`Invalid LLM output: "attempts" must be a whole number from 2 to 10. Got: ${JSON.stringify(params.attempts)}`)
				return { test_files: validateOptionalStrList(params.test_files), test_names: validateOptionalStrList(params.test_names), attempts }
			},
			test_rerun_failed: () => {
				return {}
			},
			test_debug: (params: RawToolParamsObj) => {
				const test_file = validateStr('test_file', params.test_file)
				return { test_file, test_names: validateOptionalStrList(params.test_names) ?? [], stop_on_failure: validateBoolean(params.stop_on_failure, { default: true }) }
			},
			test_cancel: (params: RawToolParamsObj) => {
				const { run_id: runIdUnknown } = params
				const runId = validateOptionalStr('run_id', runIdUnknown)
				return { run_id: runId ?? undefined }
			},

			// Todo list (task tracking within a turn - OpenCode parity)
			todo: (params: RawToolParamsObj) => {
				const { todos: todosUnknown } = params
				if (!Array.isArray(todosUnknown)) throw new Error(`Invalid LLM output: todos must be an array.`)
				const todos = todosUnknown.map((t, i) => {
					if (!t || typeof t !== 'object') throw new Error(`Invalid LLM output: todos[${i}] must be an object.`)
					const id = validateStr('id', (t as any).id)
					const content = validateStr('content', (t as any).content)
					const status = (t as any).status
					if (status !== 'pending' && status !== 'in_progress' && status !== 'completed') {
						throw new Error(`Invalid LLM output: todos[${i}].status must be 'pending', 'in_progress' or 'completed'.`)
					}
					return { id, content, status }
				})
				return { todos }
			},

			// Subagent delegation (OpenCode parity - roadmap Stage 6)
			subagent: (params: RawToolParamsObj) => {
				const { agent: agentUnknown, description: descriptionUnknown, prompt: promptUnknown, model: modelUnknown, session_i_d: sessionIDUnknown } = params
				const agent = validateStr('agent', agentUnknown)
				const description = validateStr('description', descriptionUnknown)
				const prompt = validateStr('prompt', promptUnknown)
				const model = validateOptionalStr('model', modelUnknown)
				const sessionID = validateOptionalStr('sessionID', sessionIDUnknown)
				if (!agent) throw new Error(`Invalid LLM output: agent must not be empty.`)
				if (!description) throw new Error(`Invalid LLM output: description must not be empty.`)
				if (!prompt) throw new Error(`Invalid LLM output: prompt must not be empty.`)
				return { agent, description, prompt, model: model ?? undefined, sessionID: sessionID ?? undefined }
			},

			project_health_scan: (params: RawToolParamsObj) => {
				const maxFiles = validateNumber(params.max_files, { default: 400 }) ?? 400
				return { max_files: maxFiles }
			},
			architecture_map: (params: RawToolParamsObj) => {
				const maxFiles = validateNumber(params.max_files, { default: 400 }) ?? 400
				return { max_files: maxFiles }
			},
			workspace_diagnostics: (params: RawToolParamsObj) => {
				const sevRaw = params.severity === undefined || params.severity === null ? 'all' : String(params.severity).toLowerCase()
				const severity: 'error' | 'warning' | 'all' = sevRaw === 'error' ? 'error' : sevRaw === 'warning' ? 'warning' : 'all'
				const limit = Math.max(1, Math.min(validateNumber(params.limit, { default: 100 }) ?? 100, 300))
				return { severity, limit }
			},
			move_or_rename_file: (params: RawToolParamsObj) => {
				const source_uri = validateURI(params.source_uri, workspaceContextService)
				const target_uri = validateURI(params.target_uri, workspaceContextService)
				const overwrite = validateBoolean(params.overwrite, { default: false }) ?? false
				return { source_uri, target_uri, overwrite }
			},
			file_metadata: (params: RawToolParamsObj) => {
				const uri = validateURI(params.uri, workspaceContextService)
				return { uri }
			},
			dependency_audit: (_params: RawToolParamsObj) => ({}),
			env_inspect: (_params: RawToolParamsObj) => ({}),
			docker_status: (_params: RawToolParamsObj) => ({}),
			docker_logs: (params: RawToolParamsObj) => {
				const container = validateStr('container', params.container).trim()
				if (!container) throw new Error('Invalid LLM output: container must not be empty.')
				const tail = validateNumber(params.tail, { default: 100 }) ?? 100
				return { container, tail }
			},
			db_inspect: (params: RawToolParamsObj) => {
				const db_path = params.db_path ? validateStr('db_path', params.db_path).trim() : undefined
				return { db_path }
			},
			db_query: (params: RawToolParamsObj) => {
				const sql = validateStr('sql', params.sql).trim()
				if (!sql) throw new Error('Invalid LLM output: sql must not be empty.')
				const db_path = params.db_path ? validateStr('db_path', params.db_path).trim() : undefined
				const allow_write = validateBoolean(params.allow_write, { default: false }) ?? false
				return { sql, db_path, allow_write }
			},
			change_impact_analysis: (params: RawToolParamsObj) => {
				const target_path = validateStr('target_path', params.target_path).trim()
				if (!target_path) throw new Error('Invalid LLM output: target_path must not be empty.')
				const sub_path = params.sub_path ? validateStr('sub_path', params.sub_path).trim() : undefined
				return { target_path, sub_path }
			},
			knowledge_graph_query: (params: RawToolParamsObj) => {
				const query = params.query ? validateStr('query', params.query).trim() : ''
				const sub_path = params.sub_path ? validateStr('sub_path', params.sub_path).trim() : undefined
				const limit = validateNumber(params.limit, { default: 15 }) ?? 15
				return { query, sub_path, limit }
			},
			evaluate_quality_gates: (params: RawToolParamsObj) => {
				const sub_path = params.sub_path ? validateStr('sub_path', params.sub_path).trim() : undefined
				return { sub_path }
			},
			record_verification_evidence: (params: RawToolParamsObj) => {
				const task_title = validateStr('task_title', params.task_title).trim()
				const summary = validateStr('summary', params.summary).trim()
				const rawLevel = validateStr('level', params.level).trim() as VerificationLevel
				const level: VerificationLevel = VERIFICATION_LEVEL_ORDER.includes(rawLevel) ? rawLevel : 'implemented'
				const passed = validateBoolean(params.passed, { default: true }) ?? true
				const detail = validateStr('detail', params.detail).trim()
				let files_changed: string[] | undefined
				if (Array.isArray(params.files_changed)) {
					files_changed = params.files_changed.map(String)
				} else if (typeof params.files_changed === 'string' && params.files_changed.trim()) {
					files_changed = params.files_changed.split(',').map(s => s.trim()).filter(Boolean)
				}
				const command = params.command ? validateStr('command', params.command).trim() : undefined
				return { task_title, summary, level, passed, detail, files_changed, command }
			},
			factory_manage_requirements: (params: RawToolParamsObj) => {
				const rawAction = validateStr('action', params.action).trim()
				const action = (rawAction === 'add' || rawAction === 'update' || rawAction === 'add_decision') ? rawAction : 'list'
				const id = params.id ? validateStr('id', params.id).trim() : undefined
				const title = params.title ? validateStr('title', params.title).trim() : undefined
				const description = params.description ? validateStr('description', params.description).trim() : undefined
				const statusRaw = params.status ? validateStr('status', params.status).trim() : undefined
				const status = (statusRaw === 'unstarted' || statusRaw === 'in_progress' || statusRaw === 'implemented' || statusRaw === 'verified') ? statusRaw : undefined
				const priorityRaw = params.priority ? validateStr('priority', params.priority).trim() : undefined
				const priority = (priorityRaw === 'high' || priorityRaw === 'medium' || priorityRaw === 'low') ? priorityRaw : undefined
				const decision = params.decision ? validateStr('decision', params.decision).trim() : undefined
				const consequences = params.consequences ? validateStr('consequences', params.consequences).trim() : undefined
				return { action, id, title, description, status, priority, decision, consequences }
			},

			// Autonomous UI/UX Design Intelligence, Visual Assets & Browser Visual QA (25 tools)
			analyze_product_design_requirements: (params: RawToolParamsObj) => {
				const product_description = validateStr('product_description', params.product_description).trim()
				if (!product_description) throw new Error('Invalid LLM output: product_description must not be empty.')
				const product_name = validateOptionalStr('product_name', params.product_name) ?? undefined
				const product_category = validateOptionalStr('product_category', params.product_category) ?? undefined
				const target_devices = validateOptionalStrList(params.target_devices)
				return { product_description, product_name, product_category, target_devices }
			},
			generate_design_brief: (params: RawToolParamsObj) => {
				const product_description = validateStr('product_description', params.product_description).trim()
				if (!product_description) throw new Error('Invalid LLM output: product_description must not be empty.')
				const product_name = validateOptionalStr('product_name', params.product_name) ?? undefined
				const product_category = validateOptionalStr('product_category', params.product_category) ?? undefined
				const visual_direction = (validateOptionalStr('visual_direction', params.visual_direction) ?? undefined) as VisualDirectionId | 'auto' | undefined
				return { product_description, product_name, product_category, visual_direction }
			},
			generate_visual_direction: (params: RawToolParamsObj) => {
				const product_description = validateStr('product_description', params.product_description).trim()
				const product_category = validateOptionalStr('product_category', params.product_category) ?? undefined
				const requested_direction = (validateOptionalStr('requested_direction', params.requested_direction) ?? undefined) as VisualDirectionId | 'auto' | undefined
				return { product_description, product_category, requested_direction }
			},
			generate_color_palette: (params: RawToolParamsObj) => ({
				product_description: validateOptionalStr('product_description', params.product_description) ?? undefined,
				product_category: validateOptionalStr('product_category', params.product_category) ?? undefined,
				visual_direction: (validateOptionalStr('visual_direction', params.visual_direction) ?? undefined) as VisualDirectionId | undefined,
				harmony: (validateOptionalStr('harmony', params.harmony) ?? undefined) as ColorHarmonyStrategy | undefined,
				brand_primary_color: validateOptionalStr('brand_primary_color', params.brand_primary_color) ?? undefined,
				brand_secondary_color: validateOptionalStr('brand_secondary_color', params.brand_secondary_color) ?? undefined,
				brand_accent_color: validateOptionalStr('brand_accent_color', params.brand_accent_color) ?? undefined,
			}),
			generate_design_tokens: (params: RawToolParamsObj) => ({
				name: validateOptionalStr('name', params.name) ?? undefined,
				product_description: validateOptionalStr('product_description', params.product_description) ?? undefined,
				product_category: validateOptionalStr('product_category', params.product_category) ?? undefined,
				visual_direction: (validateOptionalStr('visual_direction', params.visual_direction) ?? undefined) as VisualDirectionId | undefined,
				harmony: (validateOptionalStr('harmony', params.harmony) ?? undefined) as ColorHarmonyStrategy | undefined,
				brand_primary_color: validateOptionalStr('brand_primary_color', params.brand_primary_color) ?? undefined,
			}),
			generate_page_architecture: (params: RawToolParamsObj) => ({
				product_description: validateStr('product_description', params.product_description).trim(),
				product_name: validateOptionalStr('product_name', params.product_name) ?? undefined,
				product_category: validateOptionalStr('product_category', params.product_category) ?? undefined,
			}),
			generate_responsive_layout: (params: RawToolParamsObj) => ({
				product_description: validateOptionalStr('product_description', params.product_description) ?? undefined,
				product_category: validateOptionalStr('product_category', params.product_category) ?? undefined,
				max_content_width: validateOptionalStr('max_content_width', params.max_content_width) ?? undefined,
			}),
			discover_visual_assets: (params: RawToolParamsObj) => {
				const query = validateStr('query', params.query).trim()
				if (!query) throw new Error('Invalid LLM output: query must not be empty.')
				const purpose = validateOptionalStr('purpose', params.purpose) ?? undefined
				const rawOrient = validateOptionalStr('orientation', params.orientation)
				const orientation = (rawOrient === 'landscape' || rawOrient === 'portrait' || rawOrient === 'square') ? rawOrient : undefined
				const limit = validateNumber(params.limit, { default: 6 }) ?? 6
				const providers = validateOptionalStrList(params.providers) as ImageProviderName[] | undefined
				return { query, purpose, orientation, limit, providers }
			},
			search_image_providers: (params: RawToolParamsObj) => {
				const query = validateStr('query', params.query).trim()
				if (!query) throw new Error('Invalid LLM output: query must not be empty.')
				const providers = validateOptionalStrList(params.providers) as ImageProviderName[] | undefined
				const rawOrient = validateOptionalStr('orientation', params.orientation)
				const orientation = (rawOrient === 'landscape' || rawOrient === 'portrait' || rawOrient === 'square') ? rawOrient : undefined
				const limit = validateNumber(params.limit, { default: 6 }) ?? 6
				return { query, providers, orientation, limit }
			},
			download_visual_assets: (params: RawToolParamsObj) => {
				let rawAssets: unknown = params.assets
				if (typeof rawAssets === 'string') {
					try { rawAssets = JSON.parse(rawAssets) } catch { throw new Error('Invalid LLM output: assets must be a valid JSON array.') }
				}
				if (!Array.isArray(rawAssets) || rawAssets.length === 0) {
					throw new Error('Invalid LLM output: assets must be a non-empty array of asset descriptors.')
				}
				const assets = rawAssets.map((a: any, idx: number) => {
					if (!a || typeof a !== 'object') throw new Error(`Invalid LLM output: assets[${idx}] must be an object.`)
					const alt_text = validateStr(`assets[${idx}].alt_text`, a.alt_text ?? a.altText ?? a.svg_subject ?? `Visual asset ${idx + 1}`).trim()
					return {
						url: typeof a.url === 'string' && a.url.trim() ? a.url.trim() : undefined,
						filename: typeof a.filename === 'string' && a.filename.trim() ? a.filename.trim() : undefined,
						alt_text,
						provider: typeof a.provider === 'string' ? a.provider as ImageProviderName | 'generated-svg' : undefined,
						license: typeof a.license === 'string' ? a.license : undefined,
						attribution: typeof a.attribution === 'string' ? a.attribution : undefined,
						svg_subject: typeof a.svg_subject === 'string' ? a.svg_subject : undefined,
						primary_color: typeof a.primary_color === 'string' ? a.primary_color : undefined,
						secondary_color: typeof a.secondary_color === 'string' ? a.secondary_color : undefined,
						accent_color: typeof a.accent_color === 'string' ? a.accent_color : undefined,
						width: typeof a.width === 'number' ? a.width : undefined,
						height: typeof a.height === 'number' ? a.height : undefined,
						svg_style: typeof a.svg_style === 'string' ? a.svg_style as any : undefined,
					}
				})
				const target_dir = validateOptionalStr('target_dir', params.target_dir) ?? undefined
				return { assets, target_dir }
			},
			optimize_visual_assets: (params: RawToolParamsObj) => ({
				target_paths: validateOptionalStrList(params.target_paths),
				minify_svgs: validateBoolean(params.minify_svgs, { default: true }),
			}),
			discover_icon_library: (params: RawToolParamsObj) => ({
				visual_direction: (validateOptionalStr('visual_direction', params.visual_direction) ?? undefined) as VisualDirectionId | undefined,
			}),
			recommend_typography: (params: RawToolParamsObj) => ({
				visual_direction: (validateOptionalStr('visual_direction', params.visual_direction) ?? undefined) as VisualDirectionId | undefined,
				product_description: validateOptionalStr('product_description', params.product_description) ?? undefined,
				heading_font: validateOptionalStr('heading_font', params.heading_font) ?? undefined,
				body_font: validateOptionalStr('body_font', params.body_font) ?? undefined,
			}),
			recommend_ui_components: (params: RawToolParamsObj) => ({
				product_description: validateStr('product_description', params.product_description).trim(),
				product_category: validateOptionalStr('product_category', params.product_category) ?? undefined,
				visual_direction: (validateOptionalStr('visual_direction', params.visual_direction) ?? undefined) as VisualDirectionId | undefined,
			}),
			generate_component_variants: (params: RawToolParamsObj) => ({
				component_type: validateStr('component_type', params.component_type).trim(),
				framework: (validateOptionalStr('framework', params.framework) ?? undefined) as FrontendFramework | undefined,
				styling_system: (validateOptionalStr('styling_system', params.styling_system) ?? undefined) as StylingSystem | undefined,
				visual_direction: (validateOptionalStr('visual_direction', params.visual_direction) ?? undefined) as VisualDirectionId | undefined,
			}),
			inspect_existing_design_system: (params: RawToolParamsObj) => ({
				sub_path: validateOptionalStr('sub_path', params.sub_path) ?? undefined,
			}),
			audit_design_consistency: (params: RawToolParamsObj) => ({
				sub_path: validateOptionalStr('sub_path', params.sub_path) ?? undefined,
			}),
			inspect_responsive_layout: (params: RawToolParamsObj) => {
				const session_id = validateStr('session_id', params.session_id ?? params.sessionId).trim()
				const tab_id = validateStr('tab_id', params.tab_id ?? params.tabId).trim()
				let viewports: Array<{ label: string; width: number; height: number }> | undefined
				if (params.viewports) {
					const parsed = typeof params.viewports === 'string' ? JSON.parse(params.viewports) : params.viewports
					if (Array.isArray(parsed)) {
						viewports = parsed.filter((v: any) => v && typeof v.width === 'number' && typeof v.height === 'number').map((v: any) => ({ label: String(v.label || `${v.width}x${v.height}`), width: v.width, height: v.height }))
					}
				}
				const full_page = validateBoolean(params.full_page, { default: false })
				return { session_id, tab_id, viewports, full_page }
			},
			capture_application_screenshots: (params: RawToolParamsObj) => {
				const session_id = validateStr('session_id', params.session_id ?? params.sessionId).trim()
				const tab_id = validateStr('tab_id', params.tab_id ?? params.tabId).trim()
				let viewports: Array<{ label: string; width: number; height: number }> | undefined
				if (params.viewports) {
					const parsed = typeof params.viewports === 'string' ? JSON.parse(params.viewports) : params.viewports
					if (Array.isArray(parsed)) {
						viewports = parsed.filter((v: any) => v && typeof v.width === 'number' && typeof v.height === 'number').map((v: any) => ({ label: String(v.label || `${v.width}x${v.height}`), width: v.width, height: v.height }))
					}
				}
				const full_page = validateBoolean(params.full_page, { default: false })
				return { session_id, tab_id, viewports, full_page }
			},
			inspect_visual_quality: (params: RawToolParamsObj) => ({
				session_id: validateStr('session_id', params.session_id ?? params.sessionId).trim(),
				tab_id: validateStr('tab_id', params.tab_id ?? params.tabId).trim(),
			}),
			audit_accessibility: (params: RawToolParamsObj) => ({
				session_id: validateStr('session_id', params.session_id ?? params.sessionId).trim(),
				tab_id: validateStr('tab_id', params.tab_id ?? params.tabId).trim(),
			}),
			audit_frontend_performance: (params: RawToolParamsObj) => ({
				session_id: validateStr('session_id', params.session_id ?? params.sessionId).trim(),
				tab_id: validateStr('tab_id', params.tab_id ?? params.tabId).trim(),
			}),
			critique_interface_design: (params: RawToolParamsObj) => ({
				session_id: validateOptionalStr('session_id', params.session_id ?? params.sessionId) ?? undefined,
				tab_id: validateOptionalStr('tab_id', params.tab_id ?? params.tabId) ?? undefined,
				sub_path: validateOptionalStr('sub_path', params.sub_path) ?? undefined,
				product_description: validateOptionalStr('product_description', params.product_description) ?? undefined,
			}),
			repair_visual_defects: (params: RawToolParamsObj) => ({
				session_id: validateOptionalStr('session_id', params.session_id ?? params.sessionId) ?? undefined,
				tab_id: validateOptionalStr('tab_id', params.tab_id ?? params.tabId) ?? undefined,
				sub_path: validateOptionalStr('sub_path', params.sub_path) ?? undefined,
			}),
			compare_visual_revisions: (params: RawToolParamsObj) => ({
				baseline_path: validateStr('baseline_path', params.baseline_path).trim(),
				current_path: validateStr('current_path', params.current_path).trim(),
				diff_output_path: validateOptionalStr('diff_output_path', params.diff_output_path) ?? undefined,
				pixel_threshold: validateNumber(params.pixel_threshold, { default: 18 }) ?? 18,
			}),

			// Universal AI Engineering Engine & Unified Two-Engine Orchestrator (20 tools)
			ai_orchestrate_project: (params: RawToolParamsObj) => {
				const request = validateStr('request', params.request).trim()
				if (!request) throw new Error('Invalid LLM output: request must not be empty.')
				return { request }
			},
			ai_design_architecture: (params: RawToolParamsObj) => {
				const project_title = validateStr('project_title', params.project_title).trim()
				const requirements = validateStr('requirements', params.requirements).trim()
				const cpRaw = validateOptionalStr('compute_preference', params.compute_preference)
				const compute_preference = (cpRaw === 'auto' || cpRaw === 'local-first' || cpRaw === 'hybrid' || cpRaw === 'cloud-first') ? cpRaw : undefined
				return { project_title, requirements, compute_preference }
			},
			ai_probe_compute_hardware: () => ({}),
			ai_recommend_training_strategy: (params: RawToolParamsObj) => ({
				task_type: validateStr('task_type', params.task_type).trim(),
				dataset_rows: validateNumber(params.dataset_rows, { default: 1000 }) ?? 1000,
				model_size_billions: validateNumber(params.model_size_billions, { default: null }) ?? undefined,
				deployment_target: validateOptionalStr('deployment_target', params.deployment_target) ?? undefined,
			}),
			ai_profile_dataset: (params: RawToolParamsObj) => ({
				dataset_path: validateStr('dataset_path', params.dataset_path).trim(),
				max_rows: validateNumber(params.max_rows, { default: 5000 }) ?? 5000,
			}),
			ai_rag_build_index: (params: RawToolParamsObj) => ({
				index_name: validateStr('index_name', params.index_name).trim(),
				source_paths: validateOptionalStrList(params.source_paths),
				chunk_size: validateNumber(params.chunk_size, { default: null }) ?? undefined,
				chunk_overlap: validateNumber(params.chunk_overlap, { default: null }) ?? undefined,
				max_files: validateNumber(params.max_files, { default: 150 }) ?? 150,
			}),
			ai_rag_query: (params: RawToolParamsObj) => ({
				index_name: validateStr('index_name', params.index_name).trim(),
				query: validateStr('query', params.query).trim(),
				top_k: validateNumber(params.top_k, { default: null }) ?? undefined,
				source_filter: validateOptionalStr('source_filter', params.source_filter) ?? undefined,
			}),
			ai_rag_evaluate: (params: RawToolParamsObj) => {
				const index_name = validateStr('index_name', params.index_name).trim()
				const top_k = validateNumber(params.top_k, { default: 5 }) ?? 5
				let rawCases: unknown = params.cases
				if (typeof rawCases === 'string') {
					try { rawCases = JSON.parse(rawCases) } catch { throw new Error('Invalid LLM output: cases must be a valid JSON array.') }
				}
				if (!Array.isArray(rawCases) || rawCases.length === 0) {
					throw new Error('Invalid LLM output: cases must be a non-empty array.')
				}
				const cases = rawCases.map((c: any) => ({
					query: validateStr('case.query', c?.query).trim(),
					expected_sources: Array.isArray(c?.expected_sources) ? c.expected_sources.map(String) : Array.isArray(c?.expectedSources) ? c.expectedSources.map(String) : [],
					expected_terms: Array.isArray(c?.expected_terms) ? c.expected_terms.map(String) : Array.isArray(c?.expectedTerms) ? c.expectedTerms.map(String) : undefined,
				}))
				return { index_name, top_k, cases }
			},
			ai_experiment_manage: (params: RawToolParamsObj) => {
				const rawAction = validateStr('action', params.action).trim()
				const action = (rawAction === 'create' || rawAction === 'log' || rawAction === 'compare') ? rawAction : 'list'
				const parseObj = <T>(v: unknown): Record<string, T> | undefined => {
					if (!v) return undefined
					if (typeof v === 'string') { try { const p = JSON.parse(v); return typeof p === 'object' && p ? p : undefined } catch { return undefined } }
					return typeof v === 'object' ? v as Record<string, T> : undefined
				}
				const rawStatus = validateOptionalStr('status', params.status)
				const status = (rawStatus === 'running' || rawStatus === 'completed' || rawStatus === 'failed') ? rawStatus : undefined
				return {
					action,
					id: validateOptionalStr('id', params.id) ?? undefined,
					name: validateOptionalStr('name', params.name) ?? undefined,
					discipline: validateOptionalStr('discipline', params.discipline) ?? undefined,
					model_ref: validateOptionalStr('model_ref', params.model_ref) ?? undefined,
					dataset_ref: validateOptionalStr('dataset_ref', params.dataset_ref) ?? undefined,
					status,
					hyperparameters: parseObj<string | number | boolean>(params.hyperparameters),
					metrics: parseObj<number>(params.metrics),
					artifacts: validateOptionalStrList(params.artifacts),
					notes: validateOptionalStr('notes', params.notes) ?? undefined,
					metric_key: validateOptionalStr('metric_key', params.metric_key) ?? undefined,
				}
			},
			ai_model_registry: (params: RawToolParamsObj) => {
				const rawAction = validateStr('action', params.action).trim()
				const action = (rawAction === 'register' || rawAction === 'promote' || rawAction === 'inspect') ? rawAction : 'list'
				const rawStage = validateOptionalStr('stage', params.stage)
				const stage = (rawStage === 'experimental' || rawStage === 'staging' || rawStage === 'canary' || rawStage === 'production' || rawStage === 'archived') ? rawStage as ModelRegistryStage : undefined
				let metrics: Record<string, number> | undefined
				if (params.metrics) {
					const m = typeof params.metrics === 'string' ? (() => { try { return JSON.parse(params.metrics) } catch { return undefined } })() : params.metrics
					if (m && typeof m === 'object') { metrics = m as Record<string, number> }
				}
				return {
					action,
					id: validateOptionalStr('id', params.id) ?? undefined,
					name: validateOptionalStr('name', params.name) ?? undefined,
					version: validateOptionalStr('version', params.version) ?? undefined,
					framework: validateOptionalStr('framework', params.framework) ?? undefined,
					task_type: validateOptionalStr('task_type', params.task_type) ?? undefined,
					stage,
					artifact_path: validateOptionalStr('artifact_path', params.artifact_path) ?? undefined,
					dataset_ref: validateOptionalStr('dataset_ref', params.dataset_ref) ?? undefined,
					experiment_id: validateOptionalStr('experiment_id', params.experiment_id) ?? undefined,
					quantization: validateOptionalStr('quantization', params.quantization) ?? undefined,
					metrics,
					notes: validateOptionalStr('notes', params.notes) ?? undefined,
				}
			},
			ai_evaluate_system: (params: RawToolParamsObj) => {
				const name = validateStr('name', params.name).trim()
				const rawTask = validateStr('task_type', params.task_type).trim()
				const task_type: AIEvaluationTaskType = (rawTask === 'classification' || rawTask === 'regression' || rawTask === 'agent' || rawTask === 'rag' || rawTask === 'generation') ? rawTask : 'classification'
				let rawRecs: unknown = params.records
				if (typeof rawRecs === 'string') {
					try { rawRecs = JSON.parse(rawRecs) } catch { throw new Error('Invalid LLM output: records must be a valid JSON array.') }
				}
				if (!Array.isArray(rawRecs)) throw new Error('Invalid LLM output: records must be an array.')
				const min_pass_score = typeof params.min_pass_score === 'number' ? params.min_pass_score
					: typeof params.min_pass_score === 'string' && !Number.isNaN(Number(params.min_pass_score)) ? Number(params.min_pass_score) : undefined
				return { name, task_type, records: rawRecs as Array<Record<string, unknown>>, min_pass_score }
			},
			ai_audit_security: (params: RawToolParamsObj) => ({
				sub_path: validateOptionalStr('sub_path', params.sub_path) ?? undefined,
			}),
			ai_estimate_performance_cost: (params: RawToolParamsObj) => ({
				workload_name: validateStr('workload_name', params.workload_name).trim(),
				monthly_requests: validateNumber(params.monthly_requests, { default: 10000 }) ?? 10000,
				avg_input_tokens: validateNumber(params.avg_input_tokens, { default: 1200 }) ?? 1200,
				avg_output_tokens: validateNumber(params.avg_output_tokens, { default: 400 }) ?? 400,
			}),
			ai_create_workflow: (params: RawToolParamsObj) => {
				const rawTrig = validateOptionalStr('trigger', params.trigger)
				const trigger = (rawTrig === 'manual' || rawTrig === 'schedule' || rawTrig === 'webhook' || rawTrig === 'event') ? rawTrig : undefined
				return {
					name: validateStr('name', params.name).trim(),
					instruction: validateStr('instruction', params.instruction).trim(),
					trigger,
				}
			},
			ai_run_workflow: (params: RawToolParamsObj) => ({
				workflow_id: validateStr('workflow_id', params.workflow_id).trim(),
				input_context: validateOptionalStr('input_context', params.input_context) ?? undefined,
				approve_human_gates: validateBoolean(params.approve_human_gates, { default: false }),
			}),
			ai_research_analyze: (params: RawToolParamsObj) => ({
				topic: validateStr('topic', params.topic).trim(),
			}),
			ai_discover_capabilities: (params: RawToolParamsObj) => {
				const rawCat = validateOptionalStr('category', params.category)
				const validCats = new Set(['discipline', 'framework', 'model-family', 'protocol', 'evaluation', 'infrastructure', 'emerging'])
				return {
					query: validateOptionalStr('query', params.query) ?? undefined,
					category: rawCat && validCats.has(rawCat) ? rawCat as AICapabilityCatalogueEntry['category'] : undefined,
				}
			},
			ai_scaffold_product_factory: (params: RawToolParamsObj) => {
				const cpRaw = validateOptionalStr('compute_preference', params.compute_preference)
				const compute_preference = (cpRaw === 'auto' || cpRaw === 'local-first' || cpRaw === 'hybrid' || cpRaw === 'cloud-first') ? cpRaw : undefined
				return {
					objective: validateStr('objective', params.objective).trim(),
					project_title: validateOptionalStr('project_title', params.project_title) ?? undefined,
					compute_preference,
				}
			},
			ai_diagnose_failure: (params: RawToolParamsObj) => ({
				error_summary: validateStr('error_summary', params.error_summary).trim(),
				logs: validateOptionalStr('logs', params.logs) ?? undefined,
				component: validateOptionalStr('component', params.component) ?? undefined,
			}),
			ai_check_provider_capabilities: () => ({}),

			// Kodia API Engineering Studio (20 tools)
			api_open_studio: (params: RawToolParamsObj) => ({
				section: (validateOptionalStr('section', params.section) ?? undefined) as ApiStudioSection | undefined,
				method: (validateOptionalStr('method', params.method)?.toUpperCase() ?? undefined) as ApiHttpMethod | undefined,
				url: validateOptionalStr('url', params.url) ?? undefined,
				protocol: (validateOptionalStr('protocol', params.protocol) ?? undefined) as ApiProtocol | undefined,
			}),
			api_discover_project: (params: RawToolParamsObj) => ({
				sub_path: validateOptionalStr('sub_path', params.sub_path) ?? undefined,
				max_files: validateNumber(params.max_files, { default: 150 }) ?? 150,
			}),
			api_runtime_start: (params: RawToolParamsObj) => {
				let env: Record<string, string> | undefined
				if (params.env) {
					try { env = typeof params.env === 'string' ? JSON.parse(params.env) : params.env as Record<string, string> } catch { env = undefined }
				}
				return {
					name: validateStr('name', params.name).trim(),
					command: validateStr('command', params.command).trim(),
					cwd: validateOptionalStr('cwd', params.cwd) ?? undefined,
					port: validateNumber(params.port, { default: null }) ?? undefined,
					health_url: validateOptionalStr('health_url', params.health_url) ?? undefined,
					env,
					ready_timeout_ms: validateNumber(params.ready_timeout_ms, { default: 10000 }) ?? 10000,
				}
			},
			api_runtime_status: () => ({}),
			api_runtime_stop: (params: RawToolParamsObj) => ({
				runtime_id: validateOptionalStr('runtime_id', params.runtime_id) ?? undefined,
				stop_all: validateBoolean(params.stop_all, { default: false }),
			}),
			api_send_request: (params: RawToolParamsObj) => {
				const parseObj = <T>(v: unknown): T | undefined => {
					if (v === undefined || v === null || v === '') return undefined
					if (typeof v === 'string') { try { return JSON.parse(v) as T } catch { return undefined } }
					return v as T
				}
				const protocol = (validateOptionalStr('protocol', params.protocol) ?? 'http') as ApiProtocol

				// Normalize headers: accept either Record<string, string> or Array<{ key, value, enabled? }>
				let headers: Record<string, string> | undefined
				const rawHeaders = parseObj<unknown>(params.headers)
				if (Array.isArray(rawHeaders)) {
					headers = {}
					for (const h of rawHeaders) {
						if (h && typeof h === 'object' && 'key' in h && (h as { enabled?: boolean }).enabled !== false) {
							const k = String((h as { key?: unknown }).key ?? '').trim()
							if (k) headers[k] = String((h as { value?: unknown }).value ?? '')
						}
					}
				} else if (rawHeaders && typeof rawHeaders === 'object') {
					headers = {}
					for (const [k, v] of Object.entries(rawHeaders as Record<string, unknown>)) {
						if (k.trim() && v !== undefined && v !== null) headers[k] = String(v)
					}
				}

				// Normalize query params: accept either ApiKeyValuePair[] or Record<string, unknown>
				let queryParams: ApiKeyValuePair[] | undefined
				const rawParams = parseObj<unknown>(params.params)
				if (Array.isArray(rawParams)) {
					queryParams = rawParams
						.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
						.map((item, i) => ({
							id: String(item.id ?? `p-${i}`),
							key: String(item.key ?? ''),
							value: String(item.value ?? ''),
							enabled: item.enabled !== false,
						}))
				} else if (rawParams && typeof rawParams === 'object') {
					queryParams = Object.entries(rawParams as Record<string, unknown>).map(([k, v], i) => ({
						id: `p-${i}`,
						key: k,
						value: v === undefined || v === null ? '' : String(v),
						enabled: true,
					}))
				}

				// Normalize body & body_raw: accept ApiRequestBody ({ mode, raw }), plain JSON object, or raw string!
				const VALID_BODY_MODES = new Set(['none', 'json', 'xml', 'soap', 'graphql', 'text', 'html', 'form-urlencoded', 'multipart', 'binary'])
				const contentTypeHdr = Object.entries(headers ?? {}).find(([k]) => k.toLowerCase() === 'content-type')?.[1]?.toLowerCase() ?? ''
				const inferModeFromText = (txt: string): ApiRequestBody['mode'] => {
					if (protocol === 'soap') return 'soap'
					if (protocol === 'graphql') return 'graphql'
					if (contentTypeHdr.includes('x-www-form-urlencoded')) return 'form-urlencoded'
					if (contentTypeHdr.includes('xml')) return 'xml'
					if (contentTypeHdr.includes('html')) return 'html'
					if (contentTypeHdr.includes('json')) return 'json'
					const trimmed = txt.trim()
					if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
						try { JSON.parse(trimmed); return 'json' } catch { /* not valid json */ }
					}
					if (trimmed.startsWith('<')) return 'xml'
					return 'text'
				}

				let body: ApiRequestBody | undefined
				if (params.body !== undefined && params.body !== null && params.body !== '') {
					const parsedBody = parseObj<unknown>(params.body)
					if (parsedBody && typeof parsedBody === 'object' && !Array.isArray(parsedBody) && typeof (parsedBody as { mode?: unknown }).mode === 'string' && VALID_BODY_MODES.has((parsedBody as { mode: string }).mode)) {
						const b = parsedBody as Record<string, unknown>
						const rawField = b.raw !== undefined && b.raw !== null
							? (typeof b.raw === 'string' ? b.raw : JSON.stringify(b.raw, null, 2))
							: undefined
						body = { ...(b as unknown as ApiRequestBody), ...(rawField !== undefined ? { raw: rawField } : {}) }
					} else if (parsedBody !== undefined && typeof parsedBody === 'object') {
						// Plain JSON object or array passed directly as `body` (most common LLM pattern!)
						body = { mode: 'json', raw: JSON.stringify(parsedBody, null, 2) }
					} else if (typeof params.body === 'string') {
						body = { mode: inferModeFromText(params.body), raw: params.body }
					}
				}

				let body_raw: string | undefined
				if (params.body_raw !== undefined && params.body_raw !== null && params.body_raw !== '') {
					body_raw = typeof params.body_raw === 'string' ? params.body_raw : JSON.stringify(params.body_raw, null, 2)
					if (!body) {
						body = { mode: inferModeFromText(body_raw), raw: body_raw }
					}
				}

				// Normalize assertions
				const rawAssertions = parseObj<unknown>(params.assertions)
				const assertions: ApiAssertionSpec[] | undefined = Array.isArray(rawAssertions)
					? rawAssertions
						.filter((a): a is Record<string, unknown> => Boolean(a && typeof a === 'object'))
						.map((a, i) => ({
							id: String(a.id ?? `a-${i}`),
							name: String(a.name ?? a.kind ?? `Assertion ${i + 1}`),
							kind: String(a.kind ?? 'status_equals') as ApiAssertionSpec['kind'],
							target: a.target !== undefined ? String(a.target) : undefined,
							expected: a.expected !== undefined ? String(a.expected) : undefined,
							enabled: a.enabled !== false,
						}))
					: undefined

				// Normalize auth defensively
				const rawAuth = parseObj<Record<string, unknown>>(params.auth)
				const auth: ApiAuthConfig | undefined = rawAuth && typeof rawAuth.type === 'string'
					? (rawAuth as unknown as ApiAuthConfig)
					: rawAuth && typeof rawAuth.token === 'string'
						? { type: 'bearer', token: rawAuth.token }
						: undefined

				return {
					url: validateStr('url', params.url).trim(),
					method: ((validateOptionalStr('method', params.method) ?? 'GET').toUpperCase()) as ApiHttpMethod,
					protocol,
					name: validateOptionalStr('name', params.name) ?? undefined,
					params: queryParams,
					headers,
					auth,
					body,
					body_raw,
					pre_request_script: validateOptionalStr('pre_request_script', params.pre_request_script) ?? undefined,
					test_script: validateOptionalStr('test_script', params.test_script) ?? undefined,
					assertions,
					environment_id: validateOptionalStr('environment_id', params.environment_id) ?? undefined,
					timeout_ms: validateNumber(params.timeout_ms, { default: null }) ?? undefined,
					allow_protected_environment: validateBoolean(params.allow_protected_environment, { default: false }),
				}
			},
			api_websocket_session: (params: RawToolParamsObj) => {
				const rawAct = (validateOptionalStr('action', params.action) ?? 'list').toLowerCase()
				const action = (['connect', 'send', 'close', 'list'].includes(rawAct) ? rawAct : 'list') as 'connect' | 'send' | 'close' | 'list'
				let headers: Record<string, string> | undefined
				if (params.headers) {
					try { headers = typeof params.headers === 'string' ? JSON.parse(params.headers) : params.headers as Record<string, string> } catch { headers = undefined }
				}
				const rawKind = (validateOptionalStr('kind', params.kind) ?? 'text').toLowerCase()
				return {
					action,
					session_id: validateOptionalStr('session_id', params.session_id) ?? undefined,
					url: validateOptionalStr('url', params.url) ?? undefined,
					message: validateOptionalStr('message', params.message) ?? undefined,
					kind: (['text', 'json', 'ping'].includes(rawKind) ? rawKind : 'text') as 'text' | 'json' | 'ping',
					headers,
				}
			},
			api_generate_test_suite: (params: RawToolParamsObj) => ({
				name: validateOptionalStr('name', params.name) ?? undefined,
				base_url: validateStr('base_url', params.base_url).trim(),
				include_negative_tests: validateBoolean(params.include_negative_tests, { default: true }),
				save: validateBoolean(params.save, { default: true }),
			}),
			api_run_test_suite: (params: RawToolParamsObj) => {
				let suite: ApiTestSuite | undefined
				if (params.suite) {
					try { suite = typeof params.suite === 'string' ? JSON.parse(params.suite) : params.suite as ApiTestSuite } catch { suite = undefined }
				}
				return {
					suite_id: validateOptionalStr('suite_id', params.suite_id) ?? undefined,
					suite,
					environment_id: validateOptionalStr('environment_id', params.environment_id) ?? undefined,
					base_url: validateOptionalStr('base_url', params.base_url) ?? undefined,
					allow_protected_environment: validateBoolean(params.allow_protected_environment, { default: false }),
				}
			},
			api_run_load_test: (params: RawToolParamsObj) => {
				let headers: Record<string, string> | undefined
				if (params.headers) {
					try { headers = typeof params.headers === 'string' ? JSON.parse(params.headers) : params.headers as Record<string, string> } catch { headers = undefined }
				}
				const maxErrRaw = params.max_error_rate !== undefined && params.max_error_rate !== null ? Number(params.max_error_rate) : undefined
				const p95Raw = params.p95_threshold_ms !== undefined && params.p95_threshold_ms !== null ? Number(params.p95_threshold_ms) : undefined
				return {
					name: validateStr('name', params.name).trim(),
					url: validateStr('url', params.url).trim(),
					method: ((validateOptionalStr('method', params.method) ?? 'GET').toUpperCase()) as ApiHttpMethod,
					headers,
					body_raw: validateOptionalStr('body_raw', params.body_raw) ?? undefined,
					virtual_users: validateNumber(params.virtual_users, { default: 5 }) ?? 5,
					duration_seconds: validateNumber(params.duration_seconds, { default: 3 }) ?? 3,
					ramp_up_seconds: validateNumber(params.ramp_up_seconds, { default: 0 }) ?? 0,
					max_error_rate: Number.isFinite(maxErrRaw) ? maxErrRaw : undefined,
					p95_threshold_ms: Number.isFinite(p95Raw) ? p95Raw : undefined,
					allow_non_local_target: validateBoolean(params.allow_non_local_target, { default: false }),
				}
			},
			api_security_audit: (params: RawToolParamsObj) => ({
				base_url: validateOptionalStr('base_url', params.base_url) ?? undefined,
				sub_path: validateOptionalStr('sub_path', params.sub_path) ?? undefined,
				allow_live_probes: validateBoolean(params.allow_live_probes, { default: true }),
			}),
			api_compare_responses: (params: RawToolParamsObj) => ({
				left_history_index: validateNumber(params.left_history_index, { default: 1 }) ?? 1,
				right_history_index: validateNumber(params.right_history_index, { default: 0 }) ?? 0,
			}),
			api_generate_openapi: (params: RawToolParamsObj) => ({
				title: validateStr('title', params.title).trim(),
				version: validateOptionalStr('version', params.version) ?? '1.0.0',
				server_url: validateOptionalStr('server_url', params.server_url) ?? undefined,
				sub_path: validateOptionalStr('sub_path', params.sub_path) ?? undefined,
			}),
			api_diff_specs: (params: RawToolParamsObj) => ({
				base_spec_json: validateStr('base_spec_json', params.base_spec_json),
				target_spec_json: validateStr('target_spec_json', params.target_spec_json),
			}),
			api_generate_client_sdk: (params: RawToolParamsObj) => {
				let headers: Record<string, string> | undefined
				if (params.headers) {
					try { headers = typeof params.headers === 'string' ? JSON.parse(params.headers) : params.headers as Record<string, string> } catch { headers = undefined }
				}
				const rawTarget = (validateOptionalStr('target', params.target) ?? 'fetch').toLowerCase()
				const validTargets: ClientCodeTarget[] = ['curl', 'fetch', 'typescript-sdk', 'python', 'go', 'rust', 'csharp', 'java']
				const target: ClientCodeTarget = validTargets.includes(rawTarget as ClientCodeTarget) ? rawTarget as ClientCodeTarget : 'fetch'
				return {
					url: validateStr('url', params.url).trim(),
					method: ((validateOptionalStr('method', params.method) ?? 'GET').toUpperCase()) as ApiHttpMethod,
					headers,
					body_raw: validateOptionalStr('body_raw', params.body_raw) ?? undefined,
					target,
				}
			},
			api_mock_server: (params: RawToolParamsObj) => {
				const rawAct = (validateOptionalStr('action', params.action) ?? 'list').toLowerCase()
				const action = (['start', 'stop', 'list'].includes(rawAct) ? rawAct : 'list') as 'start' | 'stop' | 'list'
				let routes: ApiMockRoute[] | undefined
				if (params.routes) {
					try { routes = typeof params.routes === 'string' ? JSON.parse(params.routes) : params.routes as ApiMockRoute[] } catch { routes = undefined }
				}
				return {
					action,
					name: validateOptionalStr('name', params.name) ?? undefined,
					mock_id: validateOptionalStr('mock_id', params.mock_id) ?? undefined,
					port: validateNumber(params.port, { default: 0 }) ?? 0,
					routes,
				}
			},
			api_manage_collection: (params: RawToolParamsObj) => {
				const rawAct = (validateOptionalStr('action', params.action) ?? 'list').toLowerCase()
				const action = (['list', 'save', 'delete', 'import_curl', 'import_postman', 'export_postman'].includes(rawAct) ? rawAct : 'list') as 'list' | 'save' | 'delete' | 'import_curl' | 'import_postman' | 'export_postman'
				let collection: ApiCollection | undefined
				if (params.collection) {
					try { collection = typeof params.collection === 'string' ? JSON.parse(params.collection) : params.collection as ApiCollection } catch { collection = undefined }
				}
				return {
					action,
					collection_id: validateOptionalStr('collection_id', params.collection_id) ?? undefined,
					name: validateOptionalStr('name', params.name) ?? undefined,
					raw_input: validateOptionalStr('raw_input', params.raw_input) ?? undefined,
					collection,
				}
			},
			api_manage_environment: (params: RawToolParamsObj) => {
				const rawAct = (validateOptionalStr('action', params.action) ?? 'list').toLowerCase()
				const action = (['list', 'save', 'set_active'].includes(rawAct) ? rawAct : 'list') as 'list' | 'save' | 'set_active'
				const rawKind = (validateOptionalStr('kind', params.kind) ?? 'local').toLowerCase()
				const kind = (['local', 'development', 'testing', 'staging', 'production', 'custom'].includes(rawKind) ? rawKind : 'local') as ApiEnvironment['kind']
				let variables: ApiKeyValuePair[] | undefined
				if (params.variables) {
					try { variables = typeof params.variables === 'string' ? JSON.parse(params.variables) : params.variables as ApiKeyValuePair[] } catch { variables = undefined }
				}
				return {
					action,
					environment_id: validateOptionalStr('environment_id', params.environment_id) ?? undefined,
					name: validateOptionalStr('name', params.name) ?? undefined,
					kind,
					base_url: validateOptionalStr('base_url', params.base_url) ?? undefined,
					is_protected: validateBoolean(params.is_protected, { default: kind === 'production' }),
					variables,
					set_active: validateBoolean(params.set_active, { default: true }),
				}
			},
			api_assess_production_readiness: () => ({}),
			api_correlate_failure: (params: RawToolParamsObj) => ({
				history_index: validateNumber(params.history_index, { default: 0 }) ?? 0,
			}),

			// Kodia Deep Debugging, Software Correctness & Independent Verification (14 tools)
			correctness_open_hub: (params: RawToolParamsObj) => ({
				section: (validateOptionalStr('section', params.section) ?? undefined) as CorrectnessHubSection | undefined,
			}),
			correctness_analyze_workspace: (params: RawToolParamsObj) => ({
				sub_path: validateOptionalStr('sub_path', params.sub_path) ?? undefined,
				incremental: validateBoolean(params.incremental, { default: true }),
				max_files: validateNumber(params.max_files, { default: 200 }) ?? 200,
			}),
			correctness_run_compilers: (params: RawToolParamsObj) => ({
				target_files: validateOptionalStrList(params.target_files),
				languages: validateOptionalStrList(params.languages),
			}),
			correctness_taint_analysis: (params: RawToolParamsObj) => ({
				sub_path: validateOptionalStr('sub_path', params.sub_path) ?? undefined,
				max_files: validateNumber(params.max_files, { default: 180 }) ?? 180,
			}),
			correctness_investigate_root_cause: (params: RawToolParamsObj) => ({
				symptom: validateStr('symptom', params.symptom).trim(),
				stack_trace_or_logs: validateOptionalStr('stack_trace_or_logs', params.stack_trace_or_logs) ?? undefined,
				sub_path: validateOptionalStr('sub_path', params.sub_path) ?? undefined,
			}),
			correctness_run_fuzz_test: (params: RawToolParamsObj) => {
				const rawSchema = validateOptionalStrList(params.arg_schema) ?? ['number']
				return {
					target_file: validateStr('target_file', params.target_file).trim(),
					export_name: validateStr('export_name', params.export_name).trim(),
					property_expression: validateStr('property_expression', params.property_expression).trim(),
					arg_schema: rawSchema as FuzzTestConfig['argSchema'],
					iterations: validateNumber(params.iterations, { default: 150 }) ?? 150,
					seed: validateNumber(params.seed, { default: 1337 }) ?? 1337,
				}
			},
			correctness_run_mutation_test: (params: RawToolParamsObj) => ({
				target_file: validateStr('target_file', params.target_file).trim(),
				test_command: validateStr('test_command', params.test_command).trim(),
				max_mutants: validateNumber(params.max_mutants, { default: 15 }) ?? 15,
				timeout_ms: validateNumber(params.timeout_ms, { default: 12000 }) ?? 12000,
			}),
			correctness_plan_repair: (params: RawToolParamsObj) => ({
				defect_summary: validateStr('defect_summary', params.defect_summary).trim(),
				target_files: validateOptionalStrList(params.target_files) ?? [],
				smallest_fix_strategy: validateStr('smallest_fix_strategy', params.smallest_fix_strategy).trim(),
			}),
			correctness_independent_verify: (params: RawToolParamsObj) => ({
				change_description: validateStr('change_description', params.change_description).trim(),
				changed_files: validateOptionalStrList(params.changed_files) ?? [],
				requirements: validateOptionalStrList(params.requirements),
				test_commands: validateOptionalStrList(params.test_commands),
				require_tests: validateBoolean(params.require_tests, { default: true }),
			}),
			correctness_create_proof_record: (params: RawToolParamsObj) => ({
				title: validateStr('title', params.title).trim(),
				changed_files: validateOptionalStrList(params.changed_files) ?? [],
				requirements: validateOptionalStrList(params.requirements),
				summary: validateStr('summary', params.summary).trim(),
				known_limitations: validateOptionalStrList(params.known_limitations),
			}),
			correctness_assess_release_readiness: (params: RawToolParamsObj) => ({
				infrastructure_blocked_reason: validateOptionalStr('infrastructure_blocked_reason', params.infrastructure_blocked_reason) ?? undefined,
			}),
			correctness_export_sarif: (params: RawToolParamsObj) => ({
				sub_path: validateOptionalStr('sub_path', params.sub_path) ?? undefined,
			}),
			correctness_list_proofs: () => ({}),
			correctness_manage_suppressions: (params: RawToolParamsObj) => {
				const rawAct = (validateOptionalStr('action', params.action) ?? 'list').toLowerCase()
				const action = (['list', 'add', 'remove'].includes(rawAct) ? rawAct : 'list') as 'list' | 'add' | 'remove'
				return {
					action,
					id: validateOptionalStr('id', params.id) ?? undefined,
					rule_id: validateOptionalStr('rule_id', params.rule_id) ?? undefined,
					file_pattern: validateOptionalStr('file_pattern', params.file_pattern) ?? undefined,
					justification: validateOptionalStr('justification', params.justification) ?? undefined,
				}
			},

			// Kodia Next-Gen Evolution, Supply-Chain, IaC/FinOps, Ops & Governance (12 tools)
			evolution_open_hub: (params: RawToolParamsObj) => {
				const raw = validateOptionalStr('section', params.section)?.toLowerCase()
				const valid: EvolutionHubSection[] = ['radar', 'supply-chain', 'iac-finops', 'prod-release', 'privacy-legacy', 'proposals']
				return { section: (raw && valid.includes(raw as EvolutionHubSection) ? raw : undefined) as EvolutionHubSection | undefined }
			},
			evolution_supply_chain_sbom: (params: RawToolParamsObj) => ({
				run_live_audit: params.run_live_audit !== undefined ? validateBoolean(params.run_live_audit, { default: true }) : undefined,
				block_copyleft: params.block_copyleft !== undefined ? validateBoolean(params.block_copyleft, { default: false }) : undefined,
			}),
			evolution_audit_iac_finops: (params: RawToolParamsObj) => ({
				monthly_budget_usd: validateNumber(params.monthly_budget_usd, { default: null }) ?? undefined,
			}),
			evolution_analyze_incident: (params: RawToolParamsObj) => ({
				service_name: validateStr('service_name', params.service_name),
				log_text: validateOptionalStr('log_text', params.log_text) ?? undefined,
				log_file: validateOptionalStr('log_file', params.log_file) ?? undefined,
				slo_target_pct: validateNumber(params.slo_target_pct, { default: null }) ?? undefined,
				p95_budget_ms: validateNumber(params.p95_budget_ms, { default: null }) ?? undefined,
			}),
			evolution_plan_release: (params: RawToolParamsObj) => ({
				since_ref: validateOptionalStr('since_ref', params.since_ref) ?? undefined,
				current_version: validateOptionalStr('current_version', params.current_version) ?? undefined,
			}),
			evolution_audit_privacy_compliance: (params: RawToolParamsObj) => ({
				sub_path: validateOptionalStr('sub_path', params.sub_path) ?? undefined,
			}),
			evolution_plan_modernization: (params: RawToolParamsObj) => ({
				sub_path: validateOptionalStr('sub_path', params.sub_path) ?? undefined,
			}),
			evolution_run_capability_radar: (params: RawToolParamsObj) => ({
				audit_interval_hours: validateNumber(params.audit_interval_hours, { default: null }) ?? undefined,
			}),
			evolution_evaluate_technology: (params: RawToolParamsObj) => {
				const validDomains: EvolutionDomain[] = [
					'engineering-techniques', 'languages-frameworks', 'testing-verification', 'ai-agents',
					'security-threats', 'developer-workflows', 'infrastructure-cloud', 'hardware-embedded', 'kodia-self-improvement',
				]
				const rawDom = (validateOptionalStr('domain', params.domain) ?? 'engineering-techniques') as EvolutionDomain
				const domain = validDomains.includes(rawDom) ? rawDom : 'engineering-techniques'
				const rawMat = (validateOptionalStr('maturity', params.maturity) ?? 'emerging').toLowerCase()
				const maturity = (['experimental', 'emerging', 'production-proven', 'declining'].includes(rawMat) ? rawMat : 'emerging') as 'experimental' | 'emerging' | 'production-proven' | 'declining'
				const parseArr = (raw: unknown): string[] | undefined => {
					if (Array.isArray(raw)) return raw.map(String)
					if (typeof raw === 'string' && raw.trim()) {
						try { const p = JSON.parse(raw); if (Array.isArray(p)) return p.map(String) } catch { /* fallback */ }
						return raw.split(',').map(s => s.trim()).filter(Boolean)
					}
					return undefined
				}
				return {
					name: validateStr('name', params.name),
					domain,
					summary: validateStr('summary', params.summary),
					license: validateOptionalStr('license', params.license) ?? undefined,
					maturity,
					benchmarks_count: validateNumber(params.benchmarks_count, { default: null }) ?? undefined,
					requires_new_dependency: params.requires_new_dependency !== undefined ? validateBoolean(params.requires_new_dependency, { default: false }) : undefined,
					requires_special_hardware: params.requires_special_hardware !== undefined ? validateBoolean(params.requires_special_hardware, { default: false }) : undefined,
					security_concerns: parseArr(params.security_concerns),
					overlaps_existing: validateOptionalStr('overlaps_existing', params.overlaps_existing) ?? undefined,
				}
			},
			evolution_manage_proposals: (params: RawToolParamsObj) => {
				const rawAct = (validateOptionalStr('action', params.action) ?? 'list').toLowerCase()
				const action = (['list', 'add', 'update_status', 'remove'].includes(rawAct) ? rawAct : 'list') as 'list' | 'add' | 'update_status' | 'remove'
				const rawStatus = validateOptionalStr('status', params.status)?.toLowerCase()
				const status = rawStatus && ['proposed', 'approved', 'deferred', 'rejected', 'implemented'].includes(rawStatus)
					? rawStatus as EvolutionProposal['status'] : undefined
				const rawVerdict = validateOptionalStr('verdict', params.verdict)?.toUpperCase()
				const verdict = rawVerdict && ['ADOPT_CANDIDATE', 'MONITOR', 'DEFER', 'REJECT_HYPE', 'REJECT_INCOMPATIBLE'].includes(rawVerdict)
					? rawVerdict as EvolutionVerdict : undefined
				let acceptance_criteria: string[] | undefined
				if (Array.isArray(params.acceptance_criteria)) { acceptance_criteria = params.acceptance_criteria.map(String) }
				else if (typeof params.acceptance_criteria === 'string' && params.acceptance_criteria.trim()) {
					try { const p = JSON.parse(params.acceptance_criteria); if (Array.isArray(p)) acceptance_criteria = p.map(String) } catch { acceptance_criteria = [params.acceptance_criteria] }
				}
				return {
					action,
					id: validateOptionalStr('id', params.id) ?? undefined,
					status,
					title: validateOptionalStr('title', params.title) ?? undefined,
					domain: (validateOptionalStr('domain', params.domain) ?? undefined) as EvolutionDomain | undefined,
					verdict,
					signal_score: validateNumber(params.signal_score, { default: null }) ?? undefined,
					justification: validateOptionalStr('justification', params.justification) ?? undefined,
					acceptance_criteria,
				}
			},
			evolution_schedule_periodic_audit: (params: RawToolParamsObj) => ({
				interval_hours: validateNumber(params.interval_hours, { default: null }) ?? undefined,
			}),
			evolution_workspace_overview: () => ({}),

			// Kodia Permanent Mobile Application Engineering Platform (12 tools)
			mobile_open_studio: (params: RawToolParamsObj) => ({
				section: (validateOptionalStr('section', params.section) ?? undefined) as MobileStudioSection | undefined,
			}),
			mobile_probe_environment: () => ({}),
			mobile_inspect_project: () => ({}),
			mobile_design_architecture: (params: RawToolParamsObj) => {
				const objective = validateStr('objective', params.objective)
				let device_capabilities: string[] | undefined
				if (params.device_capabilities !== undefined && params.device_capabilities !== null) {
					device_capabilities = parseNotebookArrayParam('device_capabilities', params.device_capabilities).map(String)
				}
				return {
					objective,
					platform: (validateOptionalStr('platform', params.platform) ?? undefined) as MobileTargetPlatform | undefined,
					framework: (validateOptionalStr('framework', params.framework) ?? undefined) as MobileFrameworkId | undefined,
					app_category: (validateOptionalStr('app_category', params.app_category) ?? undefined) as MobileAppCategory | undefined,
					backend: (validateOptionalStr('backend', params.backend) ?? undefined) as MobileBackendStack | undefined,
					database: (validateOptionalStr('database', params.database) ?? undefined) as MobileDatabaseId | undefined,
					include_auth: params.include_auth !== undefined ? validateBoolean(params.include_auth, { default: true }) : undefined,
					include_ai: params.include_ai !== undefined ? validateBoolean(params.include_ai, { default: false }) : undefined,
					include_offline: params.include_offline !== undefined ? validateBoolean(params.include_offline, { default: false }) : undefined,
					include_realtime: params.include_realtime !== undefined ? validateBoolean(params.include_realtime, { default: false }) : undefined,
					device_capabilities,
				}
			},
			mobile_scaffold_project: (params: RawToolParamsObj) => ({
				project_name: validateStr('project_name', params.project_name),
				target_dir: validateOptionalStr('target_dir', params.target_dir) ?? undefined,
				objective: validateOptionalStr('objective', params.objective) ?? undefined,
				framework: validateStr('framework', params.framework) as MobileFrameworkId,
				platform: (validateOptionalStr('platform', params.platform) ?? undefined) as MobileTargetPlatform | undefined,
				app_category: (validateOptionalStr('app_category', params.app_category) ?? undefined) as MobileAppCategory | undefined,
				backend: (validateOptionalStr('backend', params.backend) ?? undefined) as MobileBackendStack | undefined,
				database: (validateOptionalStr('database', params.database) ?? undefined) as MobileDatabaseId | undefined,
				include_ai: params.include_ai !== undefined ? validateBoolean(params.include_ai, { default: false }) : undefined,
				include_offline: params.include_offline !== undefined ? validateBoolean(params.include_offline, { default: false }) : undefined,
				include_auth: params.include_auth !== undefined ? validateBoolean(params.include_auth, { default: true }) : undefined,
				overwrite: params.overwrite !== undefined ? validateBoolean(params.overwrite, { default: false }) : false,
			}),
			mobile_device_action: (params: RawToolParamsObj) => ({
				action: validateStr('action', params.action) as MobileDeviceActionType,
				device_id: validateOptionalStr('device_id', params.device_id) ?? undefined,
				avd_name: validateOptionalStr('avd_name', params.avd_name) ?? undefined,
				package_name: validateOptionalStr('package_name', params.package_name) ?? undefined,
				artifact_path: validateOptionalStr('artifact_path', params.artifact_path) ?? undefined,
				lines: params.lines !== undefined && params.lines !== null ? (validateNumber(params.lines, { default: 100 }) ?? undefined) : undefined,
			}),
			mobile_build_and_test: (params: RawToolParamsObj) => ({
				mode: validateStr('mode', params.mode) as MobileBuildTestRequest['mode'],
				target_dir: validateOptionalStr('target_dir', params.target_dir) ?? undefined,
				framework: (validateOptionalStr('framework', params.framework) ?? undefined) as MobileFrameworkId | undefined,
				platform: (validateOptionalStr('platform', params.platform) ?? undefined) as 'android' | 'ios' | 'all' | undefined,
				custom_command: validateOptionalStr('custom_command', params.custom_command) ?? undefined,
				timeout_ms: params.timeout_ms !== undefined && params.timeout_ms !== null ? (validateNumber(params.timeout_ms, { default: 90000 }) ?? undefined) : undefined,
			}),
			mobile_audit_security: () => ({}),
			mobile_audit_performance: () => ({}),
			mobile_assess_readiness: () => ({}),
			mobile_discover_capabilities: (params: RawToolParamsObj) => ({
				query: validateOptionalStr('query', params.query) ?? undefined,
				category: (validateOptionalStr('category', params.category) ?? undefined) as MobileCapabilityEntry['category'] | undefined,
			}),
			mobile_workspace_overview: () => ({}),

			// Notebook operations
			read_notebook: (params: RawToolParamsObj) => {
				const { uri: uriUnknown, start_cell: startCellUnknown, end_cell: endCellUnknown, cell_index: cellIndexUnknown, summary_only: summaryOnlyUnknown } = params
				const uri = validateURI(uriUnknown, workspaceContextService)
				let start_cell: number | undefined
				if (startCellUnknown !== undefined && startCellUnknown !== null) {
					const validated = validateNumber(startCellUnknown, { default: 0 })
					if (validated !== null) start_cell = validated as number
				}
				let end_cell: number | undefined
				if (endCellUnknown !== undefined && endCellUnknown !== null) {
					const validated = validateNumber(endCellUnknown, { default: null })
					if (validated !== null) end_cell = validated as number
				}
				let cell_index: number | undefined
				const rawCellIdx = cellIndexUnknown ?? (params as any).index
				if (rawCellIdx !== undefined && rawCellIdx !== null) {
					const validated = validateNumber(rawCellIdx, { default: null })
					if (validated !== null) cell_index = validated as number
				}
				const summary_only = summaryOnlyUnknown !== undefined ? validateBoolean(summaryOnlyUnknown, { default: false }) : false
				return { uri, start_cell, end_cell, cell_index, summary_only }
			},
			write_notebook: (params: RawToolParamsObj) => {
				const { uri: uriUnknown, cells: cellsUnknown, open_in_editor: openUnknown, execute: executeUnknown, kernel_id: kernelIdUnknown } = params
				const uri = validateURI(uriUnknown, workspaceContextService)
				const parsedCells = parseNotebookArrayParam('cells', cellsUnknown) as any[]
				const open_in_editor = openUnknown !== undefined ? validateBoolean(openUnknown, { default: true }) : true
				const execute = executeUnknown !== undefined ? validateBoolean(executeUnknown, { default: false }) : false
				const kernel_id = validateOptionalStr('kernel_id', kernelIdUnknown) ?? undefined
				return { uri, cells: parsedCells, open_in_editor, execute, kernel_id }
			},
			edit_notebook: (params: RawToolParamsObj) => {
				const { uri: uriUnknown, operations: operationsUnknown, open_in_editor: openUnknown } = params
				const uri = validateURI(uriUnknown, workspaceContextService)
				const parsedOps = parseNotebookArrayParam('operations', operationsUnknown) as any[]
				const open_in_editor = openUnknown !== undefined ? validateBoolean(openUnknown, { default: true }) : true
				return { uri, operations: parsedOps, open_in_editor }
			},
			execute_notebook_cell: (params: RawToolParamsObj) => {
				const { uri: uriUnknown, cell_index: cellIndexUnknown, kernel_id: kernelIdUnknown, open_in_editor: openUnknown } = params
				const uri = validateURI(uriUnknown, workspaceContextService)
				const rawIdx = cellIndexUnknown ?? (params as any).index
				const cell_index = validateNumber(rawIdx, { default: 0 }) as number
				const kernel_id = validateOptionalStr('kernel_id', kernelIdUnknown) ?? undefined
				const open_in_editor = openUnknown !== undefined ? validateBoolean(openUnknown, { default: true }) : true
				return { uri, cell_index, kernel_id, open_in_editor }
			},
			execute_notebook: (params: RawToolParamsObj) => {
				const { uri: uriUnknown, kernel_id: kernelIdUnknown, cell_indices: cellIndicesUnknown, start_cell: startCellUnknown, end_cell: endCellUnknown, restart_kernel: restartUnknown, open_in_editor: openUnknown } = params
				const uri = validateURI(uriUnknown, workspaceContextService)
				const kernel_id = validateOptionalStr('kernel_id', kernelIdUnknown) ?? undefined
				const restart_kernel = restartUnknown !== undefined ? validateBoolean(restartUnknown, { default: false }) : false
				const open_in_editor = openUnknown !== undefined ? validateBoolean(openUnknown, { default: true }) : true
				let cell_indices: number[] | undefined
				if (cellIndicesUnknown !== undefined && cellIndicesUnknown !== null) {
					const parsed = parseNotebookArrayParam('cell_indices', cellIndicesUnknown)
					cell_indices = parsed.map(Number).filter(n => Number.isInteger(n))
				}
				const start_cell = startCellUnknown !== undefined && startCellUnknown !== null ? (validateNumber(startCellUnknown, { default: null }) ?? undefined) : undefined
				const end_cell = endCellUnknown !== undefined && endCellUnknown !== null ? (validateNumber(endCellUnknown, { default: null }) ?? undefined) : undefined
				return { uri, kernel_id, cell_indices, start_cell, end_cell, restart_kernel, open_in_editor }
			},
			restart_notebook_kernel: (params: RawToolParamsObj) => {
				const uri = validateURI(params.uri, workspaceContextService)
				const run_all = params.run_all !== undefined ? validateBoolean(params.run_all, { default: false }) : false
				const kernel_id = validateOptionalStr('kernel_id', params.kernel_id) ?? undefined
				return { uri, run_all, kernel_id }
			},
			interrupt_notebook_kernel: (params: RawToolParamsObj) => {
				const uri = validateURI(params.uri, workspaceContextService)
				return { uri }
			},
			search_notebook: (params: RawToolParamsObj) => {
				const uri = validateURI(params.uri, workspaceContextService)
				const query = validateStr('query', params.query)
				const is_regex = params.is_regex !== undefined ? validateBoolean(params.is_regex, { default: false }) : false
				const case_sensitive = params.case_sensitive !== undefined ? validateBoolean(params.case_sensitive, { default: false }) : false
				const rawCellType = validateOptionalStr('cell_type', params.cell_type)?.toLowerCase()
				const cell_type: 'all' | 'code' | 'markdown' = rawCellType === 'code' || rawCellType === 'markdown' ? rawCellType : 'all'
				const include_outputs = params.include_outputs !== undefined ? validateBoolean(params.include_outputs, { default: true }) : true
				const from_cell_index = params.from_cell_index !== undefined && params.from_cell_index !== null ? (validateNumber(params.from_cell_index, { default: null }) ?? undefined) : undefined
				const rawDir = validateOptionalStr('direction', params.direction)?.toLowerCase()
				const direction: 'forward' | 'backward' = rawDir === 'backward' ? 'backward' : 'forward'
				const select_match_index = params.select_match_index !== undefined && params.select_match_index !== null ? (validateNumber(params.select_match_index, { default: null }) ?? undefined) : undefined
				return { uri, query, is_regex, case_sensitive, cell_type, include_outputs, from_cell_index, direction, select_match_index }
			},
			validate_notebook: (params: RawToolParamsObj) => {
				const uri = validateURI(params.uri, workspaceContextService)
				return { uri }
			},
			select_notebook_kernel: (params: RawToolParamsObj) => {
				const { uri: uriUnknown, kernel_id: kernelIdUnknown } = params
				const uri = validateURI(uriUnknown, workspaceContextService)
				const kernel_id = validateStr('kernel_id', kernelIdUnknown)
				return { uri, kernel_id }
			},
			list_notebook_kernels: (params: RawToolParamsObj) => {
				const { uri: uriUnknown } = params
				const uri = validateOptionalURI(uriUnknown, workspaceContextService) ?? undefined
				return { uri }
			},

		}


		this.callTool = {
			read_file: async ({ uri, startLine, endLine, pageNumber }) => {
				await voidModelService.initializeModel(uri)
				const { model } = await voidModelService.getModelSafe(uri)
				if (model === null) { throw new Error(`No contents; File does not exist.`) }

				let contents: string
				if (startLine === null && endLine === null) {
					contents = model.getValue(EndOfLinePreference.LF)
				}
				else {
					const startLineNumber = startLine === null ? 1 : startLine
					const endLineNumber = endLine === null ? model.getLineCount() : endLine
					contents = model.getValueInRange({ startLineNumber, startColumn: 1, endLineNumber, endColumn: Number.MAX_SAFE_INTEGER }, EndOfLinePreference.LF)
				}

				const totalNumLines = model.getLineCount()

				// Compact giant inline base64 blobs (e.g. PNG charts inside .ipynb files) while preserving
				// exact line breaks and line numbering so read_file never truncates a 204-line notebook at line 17.
				const displayContents = (uri.path.toLowerCase().endsWith('.ipynb') || contents.includes(';base64,') || contents.includes('"image/png"'))
					? compactBase64BlobsPreservingLines(contents)
					: contents

				const isFinitePage = Number.isFinite(MAX_FILE_CHARS_PAGE)
				const fromIdx = isFinitePage ? MAX_FILE_CHARS_PAGE * (pageNumber - 1) : 0
				const toIdx = isFinitePage ? MAX_FILE_CHARS_PAGE * pageNumber - 1 : displayContents.length - 1
				const fileContents = displayContents.slice(fromIdx, toIdx + 1) // paginate
				const hasNextPage = isFinitePage && (displayContents.length - 1) - toIdx >= 1
				const totalFileLen = displayContents.length
				return { result: { fileContents, totalFileLen, hasNextPage, totalNumLines } }
			},

			ls_dir: async ({ uri, pageNumber }) => {
				const dirResult = await computeDirectoryTree1Deep(fileService, uri, pageNumber)
				return { result: dirResult }
			},

			get_dir_tree: async ({ uri }) => {
				const str = await this.directoryStrService.getDirectoryStrTool(uri)
				return { result: { str } }
			},

			search_pathnames_only: async ({ query: queryStr, includePattern, pageNumber }) => {

				const query = queryBuilder.file(workspaceContextService.getWorkspace().folders.map(f => f.uri), {
					filePattern: queryStr,
					includePattern: includePattern ?? undefined,
					sortByScore: true, // makes results 10x better
				})
				const data = await searchService.fileSearch(query, CancellationToken.None)

				const fromIdx = MAX_CHILDREN_URIs_PAGE * (pageNumber - 1)
				const toIdx = MAX_CHILDREN_URIs_PAGE * pageNumber - 1
				const uris = data.results
					.slice(fromIdx, toIdx + 1) // paginate
					.map(({ resource, results }) => resource)

				const hasNextPage = (data.results.length - 1) - toIdx >= 1
				return { result: { uris, hasNextPage } }
			},

			search_for_files: async ({ query: queryStr, isRegex, searchInFolder, pageNumber }) => {
				// searchInFolder containment/risk is evaluated by the autonomy policy
				// in _runToolCall (chatThreadService). Access outside the workspace is
				// permitted; only operation risk and mode gate it. Do not re-check here.
				const searchFolders = searchInFolder === null ?
					workspaceContextService.getWorkspace().folders.map(f => f.uri)
					: [searchInFolder]

				const runTextSearch = (isCaseSensitive: boolean) => {
					const query = queryBuilder.text({
						pattern: queryStr,
						isRegExp: isRegex,
						isCaseSensitive,
					}, searchFolders, {
						previewOptions: { matchLines: 1, charsPerLine: 180 },
						maxResults: 250,
					})
					return searchService.textSearch(query, CancellationToken.None)
				}

				let data = await runTextSearch(true)
				if (data.results.length === 0 && !isRegex) {
					data = await runTextSearch(false)
				}

				const fromIdx = MAX_CHILDREN_URIs_PAGE * (pageNumber - 1)
				const toIdx = MAX_CHILDREN_URIs_PAGE * pageNumber - 1
				const pageItems = data.results.slice(fromIdx, toIdx + 1)
				const uris = pageItems.map(({ resource }) => resource)

				// Extract rich line-numbered previews directly from ripgrep so the agent sees exact lines in 1 turn
				const matches: Array<{ uri: URI, line: number, preview: string }> = []
				const MAX_TOTAL_PREVIEWS = 60
				for (const item of pageItems) {
					if (matches.length >= MAX_TOTAL_PREVIEWS) break
					const fileMatches = (item.results ?? []).slice(0, 4)
					for (const m of fileMatches as any[]) {
						if (matches.length >= MAX_TOTAL_PREVIEWS) break
						if (m && typeof m.previewText === 'string' && Array.isArray(m.rangeLocations) && m.rangeLocations.length > 0) {
							const lineNum = (m.rangeLocations[0]?.source?.startLineNumber ?? 0) + 1
							const preview = m.previewText.replace(/\r?\n/g, ' ').trim().slice(0, 180)
							if (preview) {
								matches.push({ uri: item.resource, line: lineNum, preview })
							}
						}
					}
				}

				const hasNextPage = (data.results.length - 1) - toIdx >= 1
				return { result: { queryStr, uris, hasNextPage, matches } }
			},
			search_in_file: async ({ uri, query, isRegex }) => {
				await voidModelService.initializeModel(uri);
				const { model } = await voidModelService.getModelSafe(uri);
				if (model === null) { throw new Error(`No contents; File does not exist.`); }
				const contents = model.getValue(EndOfLinePreference.LF);
				const contentOfLine = contents.split('\n');
				const totalLines = contentOfLine.length;
				const regex = isRegex ? new RegExp(query) : null;
				const lines: number[] = []
				for (let i = 0; i < totalLines; i++) {
					const line = contentOfLine[i];
					if ((isRegex && regex!.test(line)) || (!isRegex && line.includes(query))) {
						lines.push(i + 1);
					}
				}
				let caseInsensitiveFallback = false;
				if (lines.length === 0 && !isRegex && query.length > 0) {
					const lowerQuery = query.toLowerCase();
					for (let i = 0; i < totalLines; i++) {
						if (contentOfLine[i].toLowerCase().includes(lowerQuery)) {
							lines.push(i + 1);
						}
					}
					if (lines.length > 0) {
						caseInsensitiveFallback = true;
					}
				}
				return { result: { lines, caseInsensitiveFallback } };
			},

			go_to_definition: async ({ uri, line, symbol }) => {
				const model = await modelOfFile(uri)
				const position = positionOfSymbol(model, line, symbol)
				const registry = languageFeaturesService.definitionProvider
				if (!registry.has(model)) return { result: { locations: [], hasLanguageServer: false } }

				const links = await withLanguageServerTimeout(token => getDefinitionsAtPosition(registry, model, position, false, token))
				// targetSelectionRange is the symbol's name; range can span a whole class
				const definitions = uniqueByLine(links.map(l => ({ uri: l.uri, range: l.targetSelectionRange ?? l.range })))
				const locations = await codeLocationsOf(definitions.slice(0, MAX_LANGUAGE_SERVER_RESULTS), DEFINITION_SNIPPET_LINES)
				return { result: { locations, hasLanguageServer: true } }
			},

			find_references: async ({ uri, line, symbol }) => {
				const model = await modelOfFile(uri)
				const position = positionOfSymbol(model, line, symbol)
				const registry = languageFeaturesService.referenceProvider
				if (!registry.has(model)) return { result: { locations: [], totalCount: 0, hasLanguageServer: false } }

				const links = await withLanguageServerTimeout(token => getReferencesAtPosition(registry, model, position, false, false, token))
				const references = uniqueByLine(links)
				const locations = await codeLocationsOf(references.slice(0, MAX_LANGUAGE_SERVER_RESULTS), 1)
				return { result: { locations, totalCount: references.length, hasLanguageServer: true } }
			},

			search_symbols: async ({ query }) => {
				if (WorkspaceSymbolProviderRegistry.all().length === 0) return { result: { symbols: [], totalCount: 0, hasLanguageServer: false } }

				const items = await withLanguageServerTimeout(token => getWorkspaceSymbols(query, token))
				// exact name first, then case-insensitive, then prefix, then the rest (sort is stable)
				const lowerQuery = query.toLowerCase()
				const rank = (name: string) => name === query ? 0 : name.toLowerCase() === lowerQuery ? 1 : name.toLowerCase().startsWith(lowerQuery) ? 2 : 3
				const symbols = items.map(i => i.symbol).sort((a, b) => rank(a.name) - rank(b.name))
				return {
					result: {
						symbols: symbols.slice(0, MAX_LANGUAGE_SERVER_RESULTS).map(s => ({
							name: s.name,
							kind: symbolKindNames[s.kind] ?? 'symbol',
							containerName: s.containerName || undefined,
							uri: s.location.uri,
							line: s.location.range?.startLineNumber,
						})),
						totalCount: symbols.length,
						hasLanguageServer: true,
					}
				}
			},

			read_lint_errors: async ({ uri }) => {
				await this._waitForFreshLintErrors(uri, 450)
				const { lintErrors } = this._getLintErrors(uri)
				return { result: { lintErrors } }
			},

			read_project_memory: async () => {
				await this.projectMemoryService.whenReady
				const content = this.projectMemoryService.getMemory()
				return { result: { content } }
			},

			fetch_url: async ({ url, pageNumber }) => {
				const page = await fetchPage(url)
				const fromIdx = MAX_FILE_CHARS_PAGE * (pageNumber - 1)
				const toIdx = MAX_FILE_CHARS_PAGE * pageNumber - 1
				const content = page.text.slice(fromIdx, toIdx + 1) // paginate
				const hasNextPage = (page.text.length - 1) - toIdx >= 1
				return { result: { url: page.url, title: page.title, content, totalLen: page.text.length, hasNextPage } }
			},

			web_search: async ({ query, maxResults }) => {
				const request: SearchRequest = { query, maxResults }
				const response = await webSearchService.search(request)
				const result: BuiltinToolResultType['web_search'] = { results: response.results }
				return { result }
			},

			// --- Browser automation ---
			browser_launch: async ({ headless, viewport }) => {
				const result = await browserService.launchBrowser({ headless, viewport })
				return { result: { sessionId: result.sessionId, engine: result.engine, headless: result.headless, version: result.version } }
			},
			browser_close: async ({ sessionId }) => {
				await browserService.closeBrowser(sessionId)
				return { result: {} }
			},
			browser_list_sessions: async () => {
				const sessions = await browserService.listSessions()
				return { result: { sessions } }
			},
			browser_new_tab: async ({ sessionId, url }) => {
				return { result: await browserService.newTab(sessionId, { url }) }
			},
			browser_list_tabs: async ({ sessionId }) => {
				const tabs = await browserService.listTabs(sessionId)
				return { result: { tabs } }
			},
			browser_switch_tab: async ({ sessionId, tabId }) => {
				const result = await browserService.switchTab(sessionId, tabId)
				return { result: { tabId: result.tabId, url: result.url, title: result.title } }
			},
			browser_close_tab: async ({ sessionId, tabId }) => {
				await browserService.closeTab(sessionId, tabId)
				return { result: {} }
			},
			browser_navigate: async ({ sessionId, tabId, url }) => {
				return { result: await browserService.navigate(sessionId, tabId, url) }
			},
			browser_back: async ({ sessionId, tabId }) => {
				return { result: await browserService.goBack(sessionId, tabId) }
			},
			browser_forward: async ({ sessionId, tabId }) => {
				return { result: await browserService.goForward(sessionId, tabId) }
			},
			browser_reload: async ({ sessionId, tabId }) => {
				return { result: await browserService.reload(sessionId, tabId) }
			},
			browser_inspect_page: async ({ sessionId, tabId }) => {
				return { result: await browserService.inspectPage(sessionId, tabId) }
			},
			browser_click_element: async ({ sessionId, tabId, selector }) => {
				return { result: await browserService.clickElement(sessionId, tabId, selector) }
			},
			browser_fill_element: async ({ sessionId, tabId, selector, text }) => {
				await browserService.fillElement(sessionId, tabId, selector, text)
				return { result: {} }
			},
			browser_select_option: async ({ sessionId, tabId, selector, value }) => {
				await browserService.selectOption(sessionId, tabId, selector, value)
				return { result: {} }
			},
			browser_check_element: async ({ sessionId, tabId, selector, checked }) => {
				await browserService.checkElement(sessionId, tabId, selector, checked)
				return { result: {} }
			},
			browser_submit_form: async ({ sessionId, tabId, selector }) => {
				return { result: await browserService.submitForm(sessionId, tabId, selector) }
			},
			browser_wait_for_element: async ({ sessionId, tabId, selector, timeoutMs }) => {
				const result = await browserService.waitForElement(sessionId, tabId, selector, { timeoutMs })
				return { result: { found: result.found } }
			},
			browser_set_viewport: async ({ sessionId, tabId, width, height }) => {
				await browserService.setViewport(sessionId, tabId, { width, height })
				return { result: { width, height } }
			},
			browser_screenshot: async ({ sessionId, tabId, type, selector }) => {
				const result = await browserService.takeScreenshot(sessionId, tabId, { type, selector })
				return { result: { dataUrl: result.dataUrl, width: result.width, height: result.height, type: result.type, path: result.path } }
			},
			browser_console: async ({ sessionId, tabId, level, limit }) => {
				const messages = await browserService.getConsoleMessages(sessionId, tabId, { level, limit })
				return { result: { messages, truncated: false, dropped: 0 } }
			},
			browser_network_failures: async ({ sessionId, tabId }) => {
				const failures = await browserService.getNetworkFailures(sessionId, tabId)
				return { result: { failures } }
			},
			browser_download: async ({ sessionId, tabId, url }) => {
				const result = await browserService.startDownload(sessionId, tabId, url)
				return { result: { downloadId: result.downloadId, url: result.url, suggestedFilename: result.suggestedFilename, status: result.status, path: result.path, failureText: result.failureText } }
			},
			browser_list_downloads: async ({ sessionId }) => {
				const downloads = await browserService.listDownloads(sessionId)
				return { result: { downloads } }
			},
			browser_shutdown: async () => {
				await browserService.shutdown()
				return { result: {} }
			},

			// --- Autonomous dev cycle tools ---
			dep_install: async ({ command, cwd }) => {
				const resolvedCwd = resolveCwdUri(cwd ?? null, workspaceContextService)
				const cwdPath = resolvedCwd?.fsPath ?? cwd ?? null
				const wrappedCommand = wrapCommandForShell(command)
				const { resPromise, interrupt } = await this.terminalToolService.runCommand(wrappedCommand, {
					type: 'temporary',
					cwd: cwdPath,
					terminalId: `dep-install-${Date.now()}`,
				})
				void interrupt
				const { success, exit_code, output } = terminalCommandOutcome(await resPromise)
				return { result: { command, cwd: cwdPath ?? '', success, output, exit_code } }
			},
			db_migrate: async ({ command, cwd }) => {
				const resolvedCwd = resolveCwdUri(cwd ?? null, workspaceContextService)
				const cwdPath = resolvedCwd?.fsPath ?? cwd ?? null
				const wrappedCommand = wrapCommandForShell(command)
				const { resPromise, interrupt } = await this.terminalToolService.runCommand(wrappedCommand, {
					type: 'temporary',
					cwd: cwdPath,
					terminalId: `db-migrate-${Date.now()}`,
				})
				void interrupt
				const { success, exit_code, output } = terminalCommandOutcome(await resPromise)
				return { result: { command, cwd: cwdPath ?? '', success, output, exit_code } }
			},
			lint_run: async ({ command, cwd }) => {
				const resolvedCwd = resolveCwdUri(cwd ?? null, workspaceContextService)
				const cwdPath = resolvedCwd?.fsPath ?? cwd ?? null
				const wrappedCommand = wrapCommandForShell(command)
				const { resPromise, interrupt } = await this.terminalToolService.runCommand(wrappedCommand, {
					type: 'temporary',
					cwd: cwdPath,
					terminalId: `lint-run-${Date.now()}`,
				})
				void interrupt
				// success is the linter's real exit code; counting the word "error" in its output is only a hint
				// (it matched e.g. "0 errors" and missed failures worded otherwise)
				const { success, exit_code, output } = terminalCommandOutcome(await resPromise)
				const errorsFound = output.split('\n').filter(line => /\berror\b/i.test(line) && !/\b0 errors?\b/i.test(line)).length
				return { result: { command, cwd: cwdPath ?? '', success, output, exit_code, errors_found: errorsFound } }
			},
			log_read: async ({ path, lines }) => {
				try {
					const uri = URI.file(path)
					const stat = await this.fileService.stat(uri)
					if (!stat || !stat.isFile) {
						throw new Error(`File not found: ${path}`)
					}
					const contents = await this.fileService.readFile(uri)
					const text = contents.value.toString()
					const allLines = text.split('\n')
					const filteredLines = lines ? allLines.slice(-lines) : allLines
					return {
						result: {
							path,
							lines: filteredLines.length,
							content: filteredLines.join('\n'),
						},
					}
				} catch (err: any) {
					return {
						result: {
							path,
							lines: 0,
							content: `Error reading log: ${err?.message ?? String(err)}`,
						},
					}
				}
			},
			autonomous_dev_cycle: async ({ project_type, project_description, port, cwd, max_cycles: maxCycles }) => {
				const resolvedCwd = resolveCwdUri(cwd ?? null, workspaceContextService)
				const cwdPath = resolvedCwd?.fsPath ?? cwd ?? process.cwd()
				let cyclesRun = 0
				let errorsFixed = 0
				let filesCreated = 0
				let success = false
				let finalStatus = ''
				const portToUse = port ?? 3000

				// Helper to run a terminal command
				const runCmd = async (cmd: string, label: string): Promise<{ success: boolean; output: string; exitCode: number }> => {
					const wrapped = wrapCommandForShell(cmd)
					const { resPromise } = await this.terminalToolService.runCommand(wrapped, {
						type: 'temporary',
						cwd: cwdPath,
						terminalId: `autonomous-${label}-${Date.now()}`,
					})
					const result = await resPromise
					const output = result.result
					const exitCode = output.includes('error') || output.includes('Error') ? 1 : 0
					return { success: exitCode === 0, output, exitCode }
				}

				// Step 1: Scaffold project files
				cyclesRun++
				const hasPackageJson = await this.fileService.stat(URI.file(`${cwdPath}/package.json`)).then(() => true).catch(() => false)
				const hasServerJs = await this.fileService.stat(URI.file(`${cwdPath}/server.js`)).then(() => true).catch(() => false)

				if (!hasPackageJson) {
					await this.fileService.writeFile(URI.file(`${cwdPath}/package.json`), VSBuffer.fromString(JSON.stringify({
						name: 'autonomous-app',
						version: '1.0.0',
						scripts: { start: 'node server.js', test: 'echo "no tests specified" && exit 0' },
					}, null, 2)))
					filesCreated++
				}
				if (!hasServerJs) {
					await this.fileService.writeFile(URI.file(`${cwdPath}/server.js`), VSBuffer.fromString(`const express = require('express')\nconst app = express()\napp.use(express.json())\napp.get('/', (req, res) => res.json({ status: 'ok', service: '${project_type}' }))\napp.get('/api/health', (req, res) => res.json({ status: 'healthy', timestamp: new Date().toISOString() }))\nconst PORT = ${portToUse}\napp.listen(PORT, () => console.log('Server running on port ' + PORT))\n`))
					filesCreated++
				}

				// Step 2: Install dependencies
				cyclesRun++
				const depResult = await runCmd('npm install', 'dep_install')
				if (!depResult.success) {
					errorsFixed++
					// Try fixing common issues
					const fixResult = await runCmd('npm install --legacy-peer-deps', 'dep_install_fix')
					if (fixResult.success) errorsFixed--
				}

				// Step 3: Lint
				cyclesRun++
				const lintResult = await runCmd('npx eslint . --ext .js --quiet 2>&1 || true', 'lint_run')
				const errorsFound = (output => (output.match(/error/gi) || []).length)(lintResult.output)
				if (!lintResult.success && errorsFound > 0) {
					errorsFixed++
				}

				// Step 4: Start server (persistent terminal)
				cyclesRun++
				const serverTerminalId = await this.terminalToolService.createPersistentTerminal({ cwd: cwdPath })
				const wrappedServer = wrapCommandForShell('node server.js')
				const { resPromise: serverResPromise } = await this.terminalToolService.runCommand(wrappedServer, {
					type: 'persistent',
					persistentTerminalId: serverTerminalId,
				})
				void serverResPromise
				// Wait briefly for server to start
				await new Promise(r => setTimeout(r, 2000))

				// Step 5: Test APIs
				cyclesRun++
				const testResult = await runCmd('npm test 2>&1 || true', 'test_run')
				const testsFailed = (testResult.output.match(/\d+ failing/gi) || []).length
				if (testsFailed > 0) {
					errorsFixed++
				}

				success = depResult.success && serverTerminalId !== undefined
				finalStatus = success ? 'All systems operational' : 'Completed with warnings'

				return {
					result: {
						project_type: project_type,
						cycles_run: cyclesRun,
						success,
						final_status: finalStatus,
						errors_fixed: errorsFixed,
						files_created: filesCreated,
						url: `http://localhost:${portToUse}`,
					},
				}
			},

			// --- Dev server automation ---
			dev_server_start: async ({ command, cwd, port, name }) => {
				const serverName = name ?? `server-${Date.now()}`
				const resolvedCwd = resolveCwdUri(cwd ?? null, workspaceContextService)
				const cwdPath = resolvedCwd?.fsPath ?? null

				// Wrap command for safe execution
				const wrappedCommand = wrapCommandForShell(command)

				// Create a persistent terminal with the working directory, then run the command in it
				const terminalId = await this.terminalToolService.createPersistentTerminal({ cwd: cwdPath })
				const { resPromise, interrupt } = await this.terminalToolService.runCommand(wrappedCommand, {
					type: 'persistent',
					persistentTerminalId: terminalId,
				})
				void resPromise
				void interrupt

				// Give the server a moment to start, then check if the port is responding
				let serverUrl: string | undefined
				if (port) {
					serverUrl = `http://localhost:${port}`
				}

				return {
					result: {
						name: serverName,
						terminal_id: terminalId,
						command,
						cwd: cwdPath ?? '',
						port,
						url: serverUrl,
						pid: 0, // terminal service doesn't expose PID directly
					},
				}
			},
			dev_server_stop: async ({ name, terminal_id: terminalId }) => {
				const targetId = terminalId ?? (name ? `dev-server-${name}` : undefined)
				if (!targetId) throw new Error('dev_server_stop requires either name or terminal_id')
				await this.terminalToolService.killPersistentTerminal(targetId)
				return { result: { name: name ?? targetId, stopped: true } }
			},
			dev_server_list: async () => {
				const terminals = this.terminalToolService.listTerminals()
				const servers = terminals
					.filter(t => t.terminalId.startsWith('dev-server-'))
					.map(t => ({
						name: t.terminalId.replace('dev-server-', ''),
						terminal_id: t.terminalId,
						command: t.title ?? '(unknown)',
						cwd: t.cwd ?? '',
						port: undefined,
						url: undefined,
						running: t.exitCode === undefined,
					}))
				return { result: { servers } }
			},
			dev_server_status: async ({ name, port }) => {
				const targetId = name ? `dev-server-${name}` : undefined
				const terminals = this.terminalToolService.listTerminals()
				const target = targetId ? terminals.find(t => t.terminalId === targetId) : undefined

				if (!target) {
					// Try to find by port (can't reliably do this from terminal info)
					return { result: { name: name ?? '', running: false, port, url: port ? `http://localhost:${port}` : undefined, terminal_id: undefined } }
				}

				return {
					result: {
						name: target.terminalId.replace('dev-server-', ''),
						running: target.exitCode === undefined,
						port,
						url: port ? `http://localhost:${port}` : undefined,
						terminal_id: target.terminalId,
					},
				}
			},

			// --- Direct API testing ---
			api_request: async (params: any) => {
				const apiService = ProxyChannel.toService<IApiMainService>(mainProcessService.getChannel('void-channel-api'))
				const result = await apiService.apiRequest({
					url: params.url,
					method: params.method,
					headers: params.headers,
					body: params.body,
					timeoutMs: params.timeout_ms,
					cookies: params.cookies,
					useCookieJar: params.use_cookie_jar,
					oauth2Tokens: params.oauth2_tokens,
					multipartBody: params.multipart_body,
				})
				return { result: { ok: result.ok, status: result.status, status_text: result.statusText, headers: result.headers, body: result.body, body_type: result.bodyType, url: result.url, method: result.method, elapsed_ms: result.elapsedMs, cookies: result.cookies } }
			},
			port_check: async ({ port }: any) => {
				const apiService = ProxyChannel.toService<IApiMainService>(mainProcessService.getChannel('void-channel-api'))
				const result = await apiService.portCheck({ port })
				return { result: { port: result.port, in_use: result.inUse, process: result.process } }
			},
			// Cookie management
			api_get_cookies: async () => {
				const apiService = ProxyChannel.toService<IApiMainService>(mainProcessService.getChannel('void-channel-api'))
				const cookies = await apiService.getCookies()
				return { result: { cookies } }
			},
			api_set_cookies: async ({ cookies }: any) => {
				const apiService = ProxyChannel.toService<IApiMainService>(mainProcessService.getChannel('void-channel-api'))
				await apiService.setCookies(cookies)
				return { result: { count: cookies.length } }
			},
			api_add_cookie: async ({ cookie }: any) => {
				const apiService = ProxyChannel.toService<IApiMainService>(mainProcessService.getChannel('void-channel-api'))
				await apiService.addCookie(cookie)
				return { result: { count: 1 } }
			},
			api_clear_cookies: async () => {
				const apiService = ProxyChannel.toService<IApiMainService>(mainProcessService.getChannel('void-channel-api'))
				await apiService.clearCookies()
				return { result: { cleared: 0 } }
			},
			// OAuth2
			oauth2_generate_auth_url: async ({ client_id, client_secret, authorization_url, token_url, redirect_uri, scope }) => {
				const apiService = ProxyChannel.toService<IApiMainService>(mainProcessService.getChannel('void-channel-api'))
				const result = await apiService.generateAuthUrl({ clientId: client_id, clientSecret: client_secret, authorizationUrl: authorization_url, tokenUrl: token_url, redirectUri: redirect_uri, scope })
				return { result: { url: result.url, state: result.state, code_verifier: result.codeVerifier } }
			},
			oauth2_exchange_code: async ({ client_id, client_secret, token_url, redirect_uri, code, code_verifier: codeVerifier }: any) => {
				const apiService = ProxyChannel.toService<IApiMainService>(mainProcessService.getChannel('void-channel-api'))
				const result = await apiService.exchangeCodeForTokens({ clientId: client_id, clientSecret: client_secret, tokenUrl: token_url, redirectUri: redirect_uri }, code, codeVerifier)
				return { result: { access_token: result.accessToken, refresh_token: result.refreshToken, expires_in: result.expiresIn, token_type: result.tokenType, scope: result.scope, created_at: result.createdAt } }
			},
			oauth2_refresh_token: async ({ client_id, client_secret, token_url, refresh_token }: any) => {
				const apiService = ProxyChannel.toService<IApiMainService>(mainProcessService.getChannel('void-channel-api'))
				const result = await apiService.refreshAccessToken({ clientId: client_id, clientSecret: client_secret, tokenUrl: token_url, authorizationUrl: '', redirectUri: '' }, refresh_token)
				return { result: { access_token: result.accessToken, refresh_token: result.refreshToken, expires_in: result.expiresIn, token_type: result.tokenType, scope: result.scope, created_at: result.createdAt } }
			},

			// --- Code Index & Semantic Search ---
			// the index lives in the main process and follows the workspace folders (was: indexed the main process's cwd)
			code_index: async () => {
				return { result: await codeIndexService.indexWorkspace(workspaceFolderPaths()) }
			},
			code_index_file: async ({ uri }) => {
				return { result: { indexed: await codeIndexService.indexFile(uri.fsPath), filePath: uri.fsPath } }
			},
			code_semantic_search: async ({ query, limit }) => {
				// search by meaning (NVIDIA's embedding model) and re-rank (NVIDIA's reranker) only when the chat model is
				// NVIDIA's: the code already goes there
				const nvidia = this.voidSettingsService.state.modelSelectionOfFeature['Chat']?.providerName === 'nvidia'
				return { result: { query, ...await codeIndexService.search(workspaceFolderPaths(), query, limit, { rerank: nvidia, semantic: nvidia }) } }
			},
			code_keyword_search: async ({ query, limit }) => {
				return { result: { query, ...await codeIndexService.findLiteral(workspaceFolderPaths(), query, limit) } }
			},
			code_hybrid_search: async ({ query, limit }) => { // kept for older threads: the same ranked search
				return { result: { query, ...await codeIndexService.search(workspaceFolderPaths(), query, limit) } }
			},
			code_index_stats: async () => {
				return { result: await codeIndexService.getStats() }
			},
			code_index_clear: async () => {
				await codeIndexService.clearIndex()
				return { result: { cleared: true } }
			},

			// --- Debugger automation ---
			debug_list_configurations: async () => {
				return withDebugActivity(
					'list_configurations',
					'List debug configurations',
					'Listing available debug configurations',
					undefined,
					async () => {
						const result = await this.debugToolService.listConfigurations()
						return { result }
					}
				)
			},
			debug_list_sessions: async () => {
				return withDebugActivity(
					'list_sessions',
					'List debug sessions',
					'Listing active debug sessions',
					undefined,
					async () => {
						const result = await this.debugToolService.listSessions()
						return { result }
					}
				)
			},
			debug_get_session_status: async ({ sessionId }) => {
				return withDebugActivity(
					'get_session_status',
					'Get session status',
					`Getting status of session ${sessionId}`,
					sessionId,
					async () => {
						const result = await this.debugToolService.getSessionStatus(sessionId)
						return { result }
					}
				)
			},
			debug_start_session: async ({ configurationName, folder, noDebug, configuration }) => {
				return withDebugActivity(
					'start_session',
					'Start debug session',
					`Starting debug session "${configurationName ?? `${configuration?.type} ${configuration?.request}`}"`,
					undefined,
					async () => ({ result: await this.debugToolService.startSession(configurationName, folder, noDebug, configuration) })
				)
			},
			debug_attach_session: async ({ configurationName, folder }) => {
				return withDebugActivity(
					'attach_session',
					'Attach debug session',
					`Attaching debug session "${configurationName}"`,
					undefined,
					async () => {
						const result = await this.debugToolService.attachSession(configurationName, folder)
						return { result }
					}
				)
			},
			debug_stop_session: async ({ sessionId, restart, suspend }) => {
				return withDebugActivity(
					'stop_session',
					'Stop debug session',
					`Stopping debug session ${sessionId}`,
					sessionId,
					async () => {
						await this.debugToolService.stopSession(sessionId, restart, suspend)
						return { result: {} }
					}
				)
			},
			debug_restart_session: async ({ sessionId }) => {
				return withDebugActivity(
					'restart_session',
					'Restart debug session',
					`Restarting debug session ${sessionId}`,
					sessionId,
					async () => {
						await this.debugToolService.restartSession(sessionId)
						return { result: {} }
					}
				)
			},
			debug_set_breakpoint: async ({ sessionId, uri, lineNumber, column, condition, hitCondition, logMessage }) => {
				return withDebugActivity(
					'set_breakpoint',
					'Set breakpoint',
					`Setting breakpoint at ${uri}:${lineNumber}`,
					sessionId,
					async () => {
						const result = await this.debugToolService.setBreakpoint(sessionId, uri, lineNumber, column, condition, hitCondition, logMessage)
						return { result }
					}
				)
			},
			debug_remove_breakpoint: async ({ breakpointId }) => {
				return withDebugActivity(
					'remove_breakpoint',
					'Remove breakpoint',
					`Removing breakpoint ${breakpointId}`,
					undefined,
					async () => {
						await this.debugToolService.removeBreakpoint(breakpointId)
						return { result: {} }
					}
				)
			},
			debug_set_breakpoint_enabled: async ({ breakpointId, enabled }) => {
				return withDebugActivity(
					'set_breakpoint_enabled',
					'Toggle breakpoint',
					`${enabled ? 'Enabling' : 'Disabling'} breakpoint ${breakpointId}`,
					undefined,
					async () => {
						await this.debugToolService.setBreakpointEnabled(breakpointId, enabled)
						return { result: {} }
					}
				)
			},
			debug_set_exception_breakpoints: async ({ sessionId, filters }) => {
				return withDebugActivity(
					'set_exception_breakpoints',
					'Exception breakpoints',
					filters.length ? `Stopping on exceptions: ${filters.join(', ')}` : 'Not stopping on exceptions',
					sessionId,
					async () => {
						const result = await this.debugToolService.setExceptionBreakpoints(sessionId, filters)
						return { result }
					}
				)
			},
			debug_list_breakpoints: async () => {
				return withDebugActivity(
					'list_breakpoints',
					'List breakpoints',
					'Listing all breakpoints',
					undefined,
					async () => {
						const result = await this.debugToolService.listBreakpoints()
						return { result }
					}
				)
			},
			debug_continue: async ({ sessionId, threadId }) => {
				return withDebugActivity(
					'continue',
					'Continue execution',
					'Continuing debug execution',
					sessionId,
					async () => ({ result: await this.debugToolService.continue(sessionId, threadId) })
				)
			},
			debug_pause: async ({ sessionId, threadId }) => {
				return withDebugActivity(
					'pause',
					'Pause execution',
					'Pausing debug execution',
					sessionId,
					async () => ({ result: await this.debugToolService.pause(sessionId, threadId) })
				)
			},
			debug_step_over: async ({ sessionId, threadId }) => {
				return withDebugActivity(
					'step_over',
					'Step over',
					'Stepping over execution',
					sessionId,
					async () => ({ result: await this.debugToolService.stepOver(sessionId, threadId) })
				)
			},
			debug_step_into: async ({ sessionId, threadId }) => {
				return withDebugActivity(
					'step_into',
					'Step into',
					'Stepping into execution',
					sessionId,
					async () => ({ result: await this.debugToolService.stepInto(sessionId, threadId) })
				)
			},
			debug_step_out: async ({ sessionId, threadId }) => {
				return withDebugActivity(
					'step_out',
					'Step out',
					'Stepping out of execution',
					sessionId,
					async () => ({ result: await this.debugToolService.stepOut(sessionId, threadId) })
				)
			},
			debug_list_threads: async ({ sessionId }) => {
				return withDebugActivity(
					'list_threads',
					'List threads',
					'Listing threads in debug session',
					sessionId,
					async () => {
						const result = await this.debugToolService.listThreads(sessionId)
						return { result }
					}
				)
			},
			debug_get_stack_trace: async ({ sessionId, threadId, startFrame, levels }) => {
				return withDebugActivity(
					'get_stack_trace',
					'Get stack trace',
					`Getting stack trace for thread ${threadId}`,
					sessionId,
					async () => {
						const result = await this.debugToolService.getStackTrace(sessionId, threadId, startFrame, levels)
						return { result }
					}
				)
			},
			debug_get_scopes: async ({ sessionId, frameId, threadId }) => {
				return withDebugActivity(
					'get_scopes',
					'Get scopes',
					`Getting variable scopes for frame ${frameId}`,
					sessionId,
					async () => {
						const result = await this.debugToolService.getScopes(sessionId, frameId, threadId)
						return { result }
					}
				)
			},
			debug_get_variables: async ({ sessionId, variablesReference, start, count }) => {
				return withDebugActivity(
					'get_variables',
					'Get variables',
					`Getting variables (ref ${variablesReference})`,
					sessionId,
					async () => {
						const result = await this.debugToolService.getVariables(sessionId, variablesReference, start, count)
						return { result }
					}
				)
			},
			debug_evaluate_expression: async ({ sessionId, expression, frameId }) => {
				return withDebugActivity(
					'evaluate_expression',
					'Evaluate expression',
					`Evaluating: ${expression}`,
					sessionId,
					async () => {
						const result = await this.debugToolService.evaluateExpression(sessionId, expression, frameId)
						return { result }
					}
				)
			},
			debug_get_exception_info: async ({ sessionId, threadId }) => {
				return withDebugActivity(
					'get_exception_info',
					'Get exception info',
					'Getting exception information',
					sessionId,
					async () => {
						const result = await this.debugToolService.getExceptionInfo(sessionId, threadId)
						return { result }
					}
				)
			},
			debug_get_console_output: async ({ sessionId, limit }) => {
				return withDebugActivity(
					'get_console_output',
					'Read console output',
					'Reading debug console output',
					sessionId,
					async () => {
						const result = await this.debugToolService.getConsoleOutput(sessionId, limit)
						return { result }
					}
				)
			},

			// ---

			create_file_or_folder: async ({ uri, isFolder }) => {
				// Determine if this is a folder by checking disk, falling back to validation hint
				let actualIsFolder = isFolder
				try {
					const stat = await fileService.stat(uri)
					actualIsFolder = stat.isDirectory
				} catch {
					// Path doesn't exist yet: if validation said file but it has no extension,
					// treat it as a folder (models often omit trailing slash for folders)
					if (!isFolder) {
						const lastSegment = uri.fsPath.split(/[/\\]/).pop() || ''
						actualIsFolder = !lastSegment.includes('.')
					}
				}

				if (actualIsFolder)
					await fileService.createFolder(uri)
				else
					await fileService.createFile(uri)
				return { result: {} }
			},

			delete_file_or_folder: async ({ uri, isRecursive }) => {
				await fileService.del(uri, { recursive: isRecursive })
				return { result: {} }
			},

			rewrite_file: async ({ uri, newContent }) => {
				await voidModelService.initializeModel(uri)
				if (this.commandBarService.getStreamState(uri) === 'streaming') {
					throw new Error(`Another LLM is currently making changes to this file. Please stop streaming for now and ask the user to resume later.`)
				}
				await editCodeService.callBeforeApplyOrEdit(uri)
				await editCodeService.instantlyRewriteFile({ uri, newContent })
				// Event-driven fresh diagnostics wait (0ms for non-code files, ~120-550ms for code files)
				await this._waitForFreshLintErrors(uri)
				const { lintErrors } = this._getLintErrors(uri)
				return { result: { lintErrors } }
			},

			// write_file: alias for rewrite_file
			write_file: async ({ uri, newContent }) => {
				await voidModelService.initializeModel(uri)
				if (this.commandBarService.getStreamState(uri) === 'streaming') {
					throw new Error(`Another LLM is currently making changes to this file. Please stop streaming for now and ask the user to resume later.`)
				}
				await editCodeService.callBeforeApplyOrEdit(uri)
				await editCodeService.instantlyRewriteFile({ uri, newContent })
				await this._waitForFreshLintErrors(uri)
				const { lintErrors } = this._getLintErrors(uri)
				return { result: { lintErrors } }
			},

			edit_file: async ({ uri, searchReplaceBlocks }) => {
				await voidModelService.initializeModel(uri)
				if (this.commandBarService.getStreamState(uri) === 'streaming') {
					throw new Error(`Another LLM is currently making changes to this file. Please stop streaming for now and ask the user to resume later.`)
				}
				await editCodeService.callBeforeApplyOrEdit(uri)
				await editCodeService.instantlyApplySearchReplaceBlocks({ uri, searchReplaceBlocks })

				await this._waitForFreshLintErrors(uri)
				const { lintErrors } = this._getLintErrors(uri)
				return { result: { lintErrors } }
			},

			write_project_memory: async ({ section, content }) => {
				const { memory, tokenCount } = await this.projectMemoryService.writeSection(section, content)
				return { result: { content: memory, tokenCount } }
			},
			// ---
			run_command: async ({ command, cwd, terminalId }) => {
				const resolvedCwd = resolveCwdUri(cwd, workspaceContextService)
				const cwdPath = resolvedCwd?.fsPath ?? cwd ?? undefined

				// Ultra-fast native main-process execution (~25-80ms vs ~2.5s PTY launch), with automatic fallback to TerminalToolService
				const runFastOrFallback = async (): Promise<{ result: string; resolveReason: { type: 'done'; exitCode: number } | { type: 'timeout' } }> => {
					try {
						const fastRes = await kodiaOpsService.execFastCommand({
							execId: terminalId,
							command,
							cwd: cwdPath,
							inactiveTimeoutMs: MAX_TERMINAL_INACTIVE_TIME * 1000,
						})
						if (fastRes && typeof fastRes.exitCode === 'number') {
							const formatted = `$ ${command}\n${fastRes.output}`
							return {
								result: formatted,
								resolveReason: fastRes.timedOut ? { type: 'timeout' } : { type: 'done', exitCode: fastRes.exitCode },
							}
						}
					} catch {
						// Fallback to integrated VS Code PTY if main-process ops channel is unavailable (e.g. unit test mocks)
					}
					const wrappedCommand = wrapCommandForShell(command)
					const { resPromise } = await this.terminalToolService.runCommand(wrappedCommand, { type: 'temporary', cwd: cwdPath ?? null, terminalId })
					return await resPromise
				}

				return {
					result: runFastOrFallback(),
					interruptTool: () => {
						void kodiaOpsService.cancelFastCommand(terminalId).catch(() => { })
					},
				}
			},
			run_persistent_command: async ({ command, persistentTerminalId }) => {
				// Wrap command for safe execution on Windows PowerShell
				const wrappedCommand = wrapCommandForShell(command)
				const { resPromise, interrupt } = await this.terminalToolService.runCommand(wrappedCommand, { type: 'persistent', persistentTerminalId })
				return { result: resPromise, interruptTool: interrupt }
			},
			open_persistent_terminal: async ({ cwd }) => {
				const resolvedCwd = resolveCwdUri(cwd, workspaceContextService)
				const persistentTerminalId = await this.terminalToolService.createPersistentTerminal({ cwd: resolvedCwd?.fsPath ?? cwd })
				return { result: { persistentTerminalId } }
			},
			kill_persistent_terminal: async ({ persistentTerminalId }) => {
				// Close the background terminal by sending exit
				await this.terminalToolService.killPersistentTerminal(persistentTerminalId)
				return { result: {} }
			},

			// Terminal session management (Stage 5A Day 1)
			list_terminals: async () => {
				const terminals = this.terminalToolService.listTerminals()
				return { result: { terminals } }
			},
			read_terminal: async ({ terminalId, offset }) => {
				const result = await this.terminalToolService.readTerminalIncremental(terminalId, offset)
				return { result }
			},
			send_command_to_terminal: async ({ terminalId, command }) => {
				// Wrap command for safe execution on Windows PowerShell
				// Use the call operator (&) to avoid PowerShell keyword conflicts
				const wrappedCommand = wrapCommandForInteractiveShell(command)
				await this.terminalToolService.sendCommandToTerminal(terminalId, wrappedCommand)
				return { result: { result: `Command sent to terminal "${terminalId}": ${command}` } }
			},
			interrupt_terminal: async ({ terminalId }) => {
				await this.terminalToolService.interruptTerminal(terminalId)
				return { result: {} }
			},
			close_terminal: async ({ terminalId }) => {
				await this.terminalToolService.closeTerminal(terminalId)
				return { result: {} }
			},
			// Task plan tools are handled directly in chatThreadService (need thread context)
			// These stubs exist only to satisfy the CallBuiltinTool type
			create_task_plan: async () => { throw new Error('create_task_plan handled in chatThreadService') },
			update_task_plan: async () => { throw new Error('update_task_plan handled in chatThreadService') },
			get_task_plan: async () => { throw new Error('get_task_plan handled in chatThreadService') },

			// Git operations (Stage 2)
			// Every git_* tool runs real git in the main process (no shell) and throws git's own error on failure.
			git_status: async () => {
				const git = this.gitToolService, root = await git.workspaceRepositoryRoot()
				return { result: { status: await git.ops.status(root) } }
			},
			git_diff: async ({ ref, path, staged }) => {
				const git = this.gitToolService, root = await git.workspaceRepositoryRoot()
				return { result: { diff: await git.ops.diff(root, { ref, path, staged: staged ?? false }) } }
			},
			git_log: async ({ max_count: maxCount, path }) => {
				const git = this.gitToolService, root = await git.workspaceRepositoryRoot()
				const log = await git.ops.log(root, { maxCount, path })
				return { result: { commits: log.commits, total: log.total } }
			},
			git_branch_list: async () => {
				const git = this.gitToolService, root = await git.workspaceRepositoryRoot()
				return { result: await git.ops.branches(root) }
			},
			git_branch_create: async ({ branch_name: branchName, start_point: startPoint }) => {
				const git = this.gitToolService, root = await git.workspaceRepositoryRoot()
				return { result: { branch_name: (await git.ops.createBranch(root, branchName, startPoint)).branchName } }
			},
			git_branch_switch: async ({ branch_name: branchName }) => {
				const git = this.gitToolService, root = await git.workspaceRepositoryRoot()
				return { result: { branch_name: (await git.ops.switchBranch(root, branchName)).branchName } }
			},
			git_stage: async ({ paths }) => {
				const git = this.gitToolService, root = await git.workspaceRepositoryRoot()
				return { result: { staged: (await git.ops.stage(root, paths)).staged } }
			},
			git_unstage: async ({ paths }) => {
				const git = this.gitToolService, root = await git.workspaceRepositoryRoot()
				return { result: { unstaged: (await git.ops.unstage(root, paths)).unstaged } }
			},
			git_commit: async ({ message, amend }) => {
				const git = this.gitToolService, root = await git.workspaceRepositoryRoot()
				const result = await git.ops.commit(root, message, amend ?? false)
				return { result: { commit_hash: result.commitHash, message: result.message } }
			},
			git_fetch: async ({ remote }) => {
				const git = this.gitToolService, root = await git.workspaceRepositoryRoot()
				return { result: await git.ops.fetch(root, remote) }
			},
			git_pull: async ({ remote, branch }) => {
				const git = this.gitToolService, root = await git.workspaceRepositoryRoot()
				return { result: await git.ops.pull(root, remote, branch) }
			},
			git_push: async ({ remote, branch, force }) => {
				const git = this.gitToolService, root = await git.workspaceRepositoryRoot()
				return { result: await git.ops.push(root, remote, branch, force ?? false) }
			},
			git_merge: async ({ branch }) => {
				const git = this.gitToolService, root = await git.workspaceRepositoryRoot()
				const result = await git.ops.merge(root, branch)
				return { result: { result: result.result, merge_in_progress: result.mergeInProgress, conflicted: result.conflicted } }
			},
			git_stash: async ({ message }) => {
				const git = this.gitToolService, root = await git.workspaceRepositoryRoot()
				return { result: await git.ops.stash(root, message) }
			},
			git_stash_pop: async () => {
				const git = this.gitToolService, root = await git.workspaceRepositoryRoot()
				return { result: await git.ops.stashPop(root) }
			},
			git_show: async ({ commit, path }) => {
				const git = this.gitToolService, root = await git.workspaceRepositoryRoot()
				return { result: await git.ops.show(root, commit, path) }
			},
			git_revert: async ({ commit }) => {
				const git = this.gitToolService, root = await git.workspaceRepositoryRoot()
				return { result: await git.ops.revert(root, commit) }
			},
			git_cherry_pick: async ({ commit }) => {
				const git = this.gitToolService, root = await git.workspaceRepositoryRoot()
				return { result: await git.ops.cherryPick(root, commit) }
			},
			git_rebase: async ({ onto }) => {
				const git = this.gitToolService, root = await git.workspaceRepositoryRoot()
				return { result: await git.ops.rebase(root, onto) }
			},
			git_continue: async () => {
				const git = this.gitToolService, root = await git.workspaceRepositoryRoot()
				return { result: await git.ops.continueOperation(root) }
			},
			git_abort: async () => {
				const git = this.gitToolService, root = await git.workspaceRepositoryRoot()
				return { result: await git.ops.abortOperation(root) }
			},
			git_reset: async ({ ref, mode }) => {
				const git = this.gitToolService, root = await git.workspaceRepositoryRoot()
				return { result: await git.ops.reset(root, ref, mode) }
			},
			git_tag_list: async () => {
				const git = this.gitToolService, root = await git.workspaceRepositoryRoot()
				return { result: await git.ops.tags(root) }
			},
			git_tag_create: async ({ name, ref, message }) => {
				const git = this.gitToolService, root = await git.workspaceRepositoryRoot()
				return { result: await git.ops.createTag(root, name, ref, message) }
			},
			git_remote_list: async () => {
				const git = this.gitToolService, root = await git.workspaceRepositoryRoot()
				return { result: await git.ops.remotes(root) }
			},
			git_worktree_list: async () => {
				const git = this.gitToolService, root = await git.workspaceRepositoryRoot()
				return { result: await git.ops.worktrees(root) }
			},
			git_commit_context: async ({ max_diff_chars: maxDiffChars }) => {
				const git = this.gitToolService, root = await git.workspaceRepositoryRoot()
				return { result: await git.ops.commitContext(root, { maxDiffChars: maxDiffChars ?? undefined }) }
			},
			git_pr_prepare: async ({ base }) => {
				const git = this.gitToolService, root = await git.workspaceRepositoryRoot()
				return { result: { pr: await git.ops.prContext(root, base), tests: this.testToolService.getLastResults() } }
			},
			git_worktree_add: async ({ path, branch, new_branch: newBranch, start_point: startPoint }) => {
				const git = this.gitToolService, root = await git.workspaceRepositoryRoot()
				return { result: await git.ops.addWorktree(root, path, branch, newBranch, startPoint) }
			},

			// Test discovery and execution (Stage 3)
			test_discover: async () => {
				return { result: await this.testToolService.discoverFrameworks() }
			},
			test_list: async () => {
				return { result: await this.testToolService.listTests() }
			},
			test_run: async ({ test_files: testFiles, test_names: testNames }) => {
				return { result: await this.testToolService.runTests({ test_files: testFiles, test_names: testNames }) }
			},
			test_run_targeted: async ({ changed_files: changedFiles }) => {
				return { result: await this.testToolService.runTargetedTests({ changed_files: changedFiles }) }
			},
			test_rerun_failed: async () => {
				return { result: await this.testToolService.rerunFailedTests({}) }
			},
			test_coverage: async ({ test_files, test_names, files }) => {
				return { result: await this.testToolService.runCoverage({ test_files, test_names, files }) }
			},
			test_history: async ({ test_name, only_problems, limit }) => {
				return { result: await this.testToolService.getHistory({ test_name, only_problems, limit }) }
			},
			test_check_flaky: async ({ test_files, test_names, attempts }) => {
				return { result: await this.testToolService.checkFlaky({ test_files, test_names, attempts }) }
			},
			test_debug: async ({ test_file, test_names, stop_on_failure }) => {
				const plan = await this.testToolService.planTestDebug(test_file, test_names)
				const session = stop_on_failure
					? await this.debugToolService.startAndRunToException(plan.configuration, plan.failureFilters, undefined, plan.failureCondition)
					: { ...await this.debugToolService.startSession(undefined, undefined, false, plan.configuration), exceptionBreakpoints: [] }
				return { result: { ...session, framework: plan.framework, describe: plan.describe } }
			},
			test_cancel: async ({ run_id: runId }) => {
				return { result: await this.testToolService.cancelTestRun({ run_id: runId }) }
			},

			// Todo list (task tracking within a turn - OpenCode parity)
			todo: async ({ todos }) => {
				const done = todos.filter(t => t.status === 'completed').length
				const inProgress = todos.filter(t => t.status === 'in_progress').length
				const pending = todos.filter(t => t.status === 'pending').length
				return { result: { done, inProgress, pending, todos } }
			},

			// Subagent delegation (OpenCode parity - roadmap Stage 6).
			// Handled in chatThreadService._runToolCall (needs thread creation + autonomous executor).
			subagent: async () => {
				throw new Error('subagent tool is handled by chatThreadService, not toolsService.callTool')
			},

			project_health_scan: async ({ max_files }) => {
				return { result: await runProjectHealthScan(fileService, workspaceContextService, max_files) }
			},
			architecture_map: async ({ max_files }) => {
				return { result: await runArchitectureMap(fileService, workspaceContextService, max_files) }
			},
			workspace_diagnostics: async ({ severity = 'all', limit = 100 }) => {
				const allMarkers = this.markerService.read({})
				let totalErrors = 0
				let totalWarnings = 0
				const items: Array<{ uri: string, severity: 'error' | 'warning', line: number, code: string, message: string, source?: string }> = []
				for (const m of allMarkers) {
					if (m.severity === MarkerSeverity.Error) totalErrors++
					else if (m.severity === MarkerSeverity.Warning) totalWarnings++
					else continue
					if (severity === 'error' && m.severity !== MarkerSeverity.Error) continue
					if (severity === 'warning' && m.severity !== MarkerSeverity.Warning) continue
					if (items.length < limit) {
						items.push({
							uri: m.resource.fsPath,
							severity: m.severity === MarkerSeverity.Error ? 'error' : 'warning',
							line: m.startLineNumber,
							code: typeof m.code === 'string' ? m.code : m.code?.value || '',
							message: m.message,
							source: m.source,
						})
					}
				}
				return { result: { totalErrors, totalWarnings, items } }
			},
			move_or_rename_file: async ({ source_uri, target_uri, overwrite }) => {
				if (!workspaceContextService.isInsideWorkspace(source_uri)) {
					throw new Error(`Source path is outside the open workspace: ${source_uri.fsPath}`)
				}
				if (!workspaceContextService.isInsideWorkspace(target_uri)) {
					throw new Error(`Target path is outside the open workspace: ${target_uri.fsPath}`)
				}
				await fileService.move(source_uri, target_uri, Boolean(overwrite))
				return { result: { sourceUri: source_uri, targetUri: target_uri } }
			},
			file_metadata: async ({ uri }) => {
				const stat = await fileService.stat(uri)
				let lineCount: number | null = null
				let lineEnding: 'CRLF' | 'LF' | 'mixed' | 'none' = 'none'
				let isBinary = false
				if (!stat.isDirectory && stat.size <= 2_000_000) {
					try {
						const raw = await fileService.readFile(uri)
						const bytes = raw.value.buffer
						const probeLen = Math.min(bytes.length, 4096)
						for (let i = 0; i < probeLen; i++) {
							if (bytes[i] === 0) { isBinary = true; break }
						}
						if (!isBinary) {
							const text = raw.value.toString()
							const crlf = (text.match(/\r\n/g) ?? []).length
							const lfOnly = (text.match(/(?<!\r)\n/g) ?? []).length
							lineCount = text.length === 0 ? 0 : text.split(/\r?\n/).length
							lineEnding = crlf > 0 && lfOnly > 0 ? 'mixed' : crlf > 0 ? 'CRLF' : lfOnly > 0 ? 'LF' : 'none'
						}
					} catch { /* unreadable content */ }
				}
				return {
					result: {
						uri: uri.fsPath,
						size: stat.size,
						mtime: stat.mtime,
						isDirectory: stat.isDirectory,
						isSymbolicLink: stat.isSymbolicLink,
						lineCount,
						lineEnding,
						isBinary,
					}
				}
			},
			dependency_audit: async () => {
				const manifests: Array<{ file: string, ecosystem: string, dependencies: number, devDependencies: number, scripts: string[], riskySpecs: string[], license?: string, engines?: Record<string, string> }> = []
				const folders = workspaceContextService.getWorkspace().folders
				for (const folder of folders) {
					// package.json
					try {
						const pkgUri = URI.joinPath(folder.uri, 'package.json')
						const text = (await fileService.readFile(pkgUri)).value.toString()
						const pkg = JSON.parse(text) as { dependencies?: Record<string, string>, devDependencies?: Record<string, string>, scripts?: Record<string, string>, license?: string, engines?: Record<string, string> }
						const deps = pkg.dependencies ?? {}
						const devDeps = pkg.devDependencies ?? {}
						const riskySpecs: string[] = []
						for (const [k, v] of [...Object.entries(deps), ...Object.entries(devDeps)]) {
							const trimmed = String(v).trim()
							if (trimmed === '*' || trimmed === 'latest' || /^https?:\/\//i.test(trimmed)) {
								riskySpecs.push(`${k}@${trimmed}`)
							}
						}
						manifests.push({
							file: pkgUri.fsPath,
							ecosystem: 'npm/node',
							dependencies: Object.keys(deps).length,
							devDependencies: Object.keys(devDeps).length,
							scripts: Object.keys(pkg.scripts ?? {}),
							riskySpecs,
							license: pkg.license,
							engines: pkg.engines,
						})
					} catch { /* no package.json */ }
					// requirements.txt
					try {
						const reqUri = URI.joinPath(folder.uri, 'requirements.txt')
						const lines = (await fileService.readFile(reqUri)).value.toString().split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'))
						const riskySpecs = lines.filter(l => !/[=<>!~]/.test(l))
						manifests.push({
							file: reqUri.fsPath,
							ecosystem: 'python/pip',
							dependencies: lines.length,
							devDependencies: 0,
							scripts: [],
							riskySpecs: riskySpecs.map(r => `${r} (unpinned)`),
						})
					} catch { /* no requirements.txt */ }
					// Cargo.toml / go.mod
					for (const [fileName, ecosystem] of [['Cargo.toml', 'rust/cargo'], ['go.mod', 'go/modules']] as const) {
						try {
							const u = URI.joinPath(folder.uri, fileName)
							const content = (await fileService.readFile(u)).value.toString()
							const depCount = ecosystem === 'go/modules'
								? (content.match(/^\s+[a-zA-Z0-9._-]+\/[a-zA-Z0-9._/-]+\s+v/gm) ?? []).length
								: (content.match(/^[a-zA-Z0-9_-]+\s*=/gm) ?? []).length
							manifests.push({ file: u.fsPath, ecosystem, dependencies: depCount, devDependencies: 0, scripts: [], riskySpecs: [] })
						} catch { /* not present */ }
					}
				}
				return { result: { manifests } }
			},
			env_inspect: async () => {
				const root = workspaceFolderPaths()[0] ?? ''
				return { result: await kodiaOpsService.inspectEnvironment(root) }
			},
			docker_status: async () => {
				const root = workspaceFolderPaths()[0] ?? ''
				return { result: await kodiaOpsService.getDockerStatus(root) }
			},
			docker_logs: async ({ container, tail }) => {
				return { result: await kodiaOpsService.getDockerLogs(container, tail) }
			},
			db_inspect: async ({ db_path }) => {
				const root = workspaceFolderPaths()[0] ?? ''
				return { result: await kodiaOpsService.inspectDatabase(root, db_path) }
			},
			db_query: async ({ sql, db_path, allow_write }) => {
				const root = workspaceFolderPaths()[0] ?? ''
				return { result: await kodiaOpsService.queryDatabase(root, sql, db_path, allow_write) }
			},
			change_impact_analysis: async ({ target_path, sub_path }) => {
				const files = await collectWorkspaceProjectFiles(this.fileService, workspaceContextService, { subPath: sub_path })
				const twin = buildProjectDigitalTwin(files)
				return { result: analyzeChangeImpact(twin, target_path) }
			},
			knowledge_graph_query: async ({ query, sub_path, limit }) => {
				const files = await collectWorkspaceProjectFiles(this.fileService, workspaceContextService, { subPath: sub_path })
				const twin = buildProjectDigitalTwin(files)
				const matches = queryKnowledgeGraph(twin, query, limit ?? 15)
				return {
					result: {
						totalModules: twin.nodes.length,
						totalSymbols: twin.totalSymbols,
						totalApis: twin.totalApis,
						totalDbEntities: twin.totalDbEntities,
						untestedCount: twin.untestedModules.length,
						matches,
					},
				}
			},
			evaluate_quality_gates: async ({ sub_path }) => {
				let ledger: IVerificationLedgerService | undefined
				try { ledger = instantiationService.invokeFunction(a => a.get(IVerificationLedgerService)) } catch { ledger = undefined }
				if (ledger) {
					return { result: await ledger.runWorkspaceQualityGates(sub_path) }
				}
				// Fallback when running inside minimal unit test harness without IVerificationLedgerService registered
				const files = await collectWorkspaceProjectFiles(this.fileService, workspaceContextService, { subPath: sub_path })
				const health = analyzeProjectHealth(files)
				const arch = buildArchitectureMap(files)
				const { computeEngineeringQualityScore } = await import('../common/projectHealth.js')
				const { evaluateQualityGates } = await import('../common/verificationLedger.js')
				const score = computeEngineeringQualityScore(health, arch)
				const errorMarkers = this.markerService.read({ severities: MarkerSeverity.Error })
				const evaluation = evaluateQualityGates({
					criticalFindings: health.counts.critical,
					highFindings: health.counts.high,
					qualityScore: score.score,
					circularDependencies: arch.cycles.length,
					workspaceErrors: errorMarkers.length,
				})
				const record = createVerificationRecord({
					taskTitle: sub_path ? `Quality Gates (${sub_path})` : 'Workspace Autonomous Quality Gates',
					summary: `Quality Gates ${evaluation.passed ? 'PASSED' : 'FAILED'} (Score ${score.score}/100)`,
					checks: evaluation.gates.map(g => ({
						name: g.label,
						level: 'static_checks',
						passed: g.passed,
						detail: `actual=${g.actual} (${g.threshold})`,
						timestamp: evaluation.evaluatedAt,
					})),
					qualityScore: score.score,
				})
				return { result: { evaluation, record } }
			},
			record_verification_evidence: async ({ task_title, summary, level, passed, detail, files_changed, command }) => {
				let ledger: IVerificationLedgerService | undefined
				try { ledger = instantiationService.invokeFunction(a => a.get(IVerificationLedgerService)) } catch { ledger = undefined }
				const check = { name: task_title, level, passed, detail, command, timestamp: new Date().toISOString() }
				const rec = ledger
					? ledger.addRecord({ taskTitle: task_title, summary, filesChanged: files_changed, checks: [check] })
					: createVerificationRecord({ taskTitle: task_title, summary, filesChanged: files_changed, checks: [check] })
				return { result: rec }
			},
			factory_manage_requirements: async ({ action, id, title, description, status, priority, decision, consequences }) => {
				let factory: ISoftwareFactoryService | undefined
				try { factory = instantiationService.invokeFunction(a => a.get(ISoftwareFactoryService)) } catch { factory = undefined }
				if (!factory) {
					return { result: { message: 'SoftwareFactoryService is unavailable in this minimal runtime.' } }
				}
				if (action === 'add') {
					const created = factory.addRequirement({ title: title ?? 'Untitled Requirement', description: description ?? '', priority })
					return { result: { message: `Added ${created.id}: ${created.title}`, requirements: factory.getRequirements() } }
				}
				if (action === 'update' && id) {
					const updated = factory.updateRequirement(id, { title, description, status, priority })
					return { result: { message: updated ? `Updated ${updated.id} → ${updated.status}` : `Requirement ${id} not found`, requirements: factory.getRequirements() } }
				}
				if (action === 'add_decision') {
					const adr = factory.addDecision({ title: title ?? 'Architecture Decision', context: description ?? '', decision: decision ?? '', consequences })
					return { result: { message: `Recorded ${adr.id}: ${adr.title}`, decisions: factory.getDecisions() } }
				}
				return {
					result: {
						message: `${factory.getRequirements().length} requirement(s), ${factory.getDecisions().length} ADR(s).`,
						requirements: factory.getRequirements(),
						decisions: factory.getDecisions(),
					},
				}
			},

			// Autonomous UI/UX Design Intelligence, Visual Assets & Browser Visual QA (25 tools)
			analyze_product_design_requirements: async ({ product_description, product_name, product_category, target_devices }) => {
				const ds = getDesignService()
				const settings = getDesignSettings()
				const analysis = analyzeProductDesignRequirements({
					productDescription: product_description,
					productName: product_name,
					productCategory: product_category,
					targetDevices: target_devices,
					brandProfile: ds?.getBrandProfile(),
					preferredDirection: settings.preferredStyleDirection,
					accessibilityTarget: settings.accessibilityTarget,
				})
				ds?.recordAnalysis(analysis)
				return { result: analysis }
			},
			generate_design_brief: async ({ product_description, product_name, product_category, visual_direction }) => {
				const ds = getDesignService()
				const settings = getDesignSettings()
				const brief = generateDesignBrief({
					productDescription: product_description,
					productName: product_name,
					productCategory: product_category,
					requestedDirection: visual_direction ?? settings.preferredStyleDirection,
					brandProfile: ds?.getBrandProfile(),
					accessibilityTarget: settings.accessibilityTarget,
					animationPreference: settings.animationPreference,
				})
				ds?.recordBrief(brief)
				return { result: brief }
			},
			generate_visual_direction: async ({ product_description, product_category, requested_direction }) => {
				const ds = getDesignService()
				const settings = getDesignSettings()
				const direction = generateVisualDirection({
					productDescription: product_description,
					productCategory: product_category,
					requestedDirection: requested_direction ?? settings.preferredStyleDirection,
					brandProfile: ds?.getBrandProfile(),
				})
				ds?.recordDirection(direction)
				return { result: direction }
			},
			generate_color_palette: async ({ product_description, product_category, visual_direction, harmony, brand_primary_color, brand_secondary_color, brand_accent_color }) => {
				const ds = getDesignService()
				const settings = getDesignSettings()
				const palette = generateColorPalette({
					productDescription: product_description,
					productCategory: product_category,
					visualDirection: visual_direction ?? (settings.preferredStyleDirection !== 'auto' ? settings.preferredStyleDirection : undefined),
					harmony,
					brandPrimaryColor: brand_primary_color,
					brandSecondaryColor: brand_secondary_color,
					brandAccentColor: brand_accent_color,
					brandProfile: ds?.getBrandProfile(),
					accessibilityTarget: settings.accessibilityTarget,
				})
				ds?.recordPalette(palette)
				return { result: palette }
			},
			generate_design_tokens: async ({ name, product_description, product_category, visual_direction, harmony, brand_primary_color }) => {
				const ds = getDesignService()
				const settings = getDesignSettings()
				const tokens = generateDesignTokens({
					name,
					productDescription: product_description,
					productCategory: product_category,
					visualDirection: visual_direction ?? (settings.preferredStyleDirection !== 'auto' ? settings.preferredStyleDirection : undefined),
					harmony,
					brandPrimaryColor: brand_primary_color,
					brandProfile: ds?.getBrandProfile(),
					accessibilityTarget: settings.accessibilityTarget,
					animationPreference: settings.animationPreference,
				})
				ds?.recordTokens(tokens)
				return { result: tokens }
			},
			generate_page_architecture: async ({ product_description, product_name, product_category }) => {
				const ds = getDesignService()
				const arch = generatePageArchitecture({
					productDescription: product_description,
					productName: product_name,
					productCategory: product_category,
					brandProfile: ds?.getBrandProfile(),
				})
				ds?.recordArchitecture(arch)
				return { result: arch }
			},
			generate_responsive_layout: async ({ product_description, product_category, max_content_width }) => {
				const layout = generateResponsiveLayout({
					productDescription: product_description,
					productCategory: product_category,
					maxContentWidth: max_content_width,
				})
				return { result: layout }
			},
			discover_visual_assets: async ({ query, orientation, limit, providers }) => {
				const ds = getDesignService()
				const settings = getDesignSettings()
				const root = workspaceFolderPaths()[0] ?? ''
				const allowedProviders = providers && providers.length > 0 ? providers : [...settings.approvedImageProviders]
				const res = await designAssetService.searchImageProviders({
					query,
					workspaceRoot: root,
					providers: allowedProviders,
					apiKeys: settings.imageProviderApiKeys,
					orientation,
					limit,
					licensePreference: settings.assetLicensePreference,
				})
				ds?.recordDiscoveredAssets(res.assets)
				return { result: res }
			},
			search_image_providers: async ({ query, providers, orientation, limit }) => {
				const ds = getDesignService()
				const settings = getDesignSettings()
				const root = workspaceFolderPaths()[0] ?? ''
				const allowedProviders = providers && providers.length > 0 ? providers : [...settings.approvedImageProviders]
				const res = await designAssetService.searchImageProviders({
					query,
					workspaceRoot: root,
					providers: allowedProviders,
					apiKeys: settings.imageProviderApiKeys,
					orientation,
					limit,
					licensePreference: settings.assetLicensePreference,
				})
				ds?.recordDiscoveredAssets(res.assets)
				return { result: res }
			},
			download_visual_assets: async ({ assets, target_dir }) => {
				const ds = getDesignService()
				const root = workspaceFolderPaths()[0] ?? ''
				if (!root) throw new Error('An open workspace folder is required to save downloaded visual assets.')
				const res = await designAssetService.downloadVisualAssets({
					workspaceRoot: root,
					targetDir: target_dir,
					assets: assets.map(a => ({
						url: a.url,
						filename: a.filename,
						altText: a.alt_text,
						provider: a.provider,
						license: a.license,
						attribution: a.attribution,
						generateSvgFallback: a.svg_subject
							? {
								subject: a.svg_subject,
								primaryColor: a.primary_color,
								secondaryColor: a.secondary_color,
								accentColor: a.accent_color,
								width: a.width,
								height: a.height,
								style: a.svg_style,
							}
							: undefined,
					})),
				})
				ds?.recordDownloadedAssets(res.downloaded)
				return { result: res }
			},
			optimize_visual_assets: async ({ target_paths, minify_svgs }) => {
				const root = workspaceFolderPaths()[0] ?? ''
				if (!root) throw new Error('An open workspace folder is required to optimize visual assets.')
				const report = await designAssetService.optimizeVisualAssets({
					workspaceRoot: root,
					targetPaths: target_paths,
					minifySvgs: minify_svgs,
				})
				return { result: report }
			},
			discover_icon_library: async ({ visual_direction }) => {
				const rawFiles = await collectWorkspaceProjectFiles(fileService, workspaceContextService, { maxFiles: 120 })
				const files = rawFiles.map(f => ({ path: f.relativePath, content: f.content }))
				const inspected = inspectExistingDesignSystem(files)
				const pkgFile = files.find(f => /(?:^|\/)package\.json$/i.test(f.path))
				let deps: string[] = []
				if (pkgFile) {
					try {
						const parsed = JSON.parse(pkgFile.content) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
						deps = [...Object.keys(parsed.dependencies ?? {}), ...Object.keys(parsed.devDependencies ?? {})]
					} catch { /* ignore */ }
				}
				const ds = getDesignService()
				const dir = visual_direction ?? ds?.state.latestDirection?.id
				return { result: recommendIconLibrary({ existingDependencies: deps, framework: inspected.framework, visualDirection: dir }) }
			},
			recommend_typography: async ({ visual_direction, product_description, heading_font, body_font }) => {
				const ds = getDesignService()
				const direction = visual_direction
					?? (product_description ? generateVisualDirection({ productDescription: product_description, brandProfile: ds?.getBrandProfile() }).id : ds?.state.latestDirection?.id)
					?? 'high-end-saas'
				const bp = ds?.getBrandProfile()
				return {
					result: buildTypographyRecommendation(direction, {
						headingFont: heading_font ?? bp?.headingFont,
						bodyFont: body_font ?? bp?.bodyFont,
						monoFont: bp?.monoFont,
					}),
				}
			},
			recommend_ui_components: async ({ product_description, product_category, visual_direction }) => {
				const ds = getDesignService()
				const components = recommendUiComponents({
					productDescription: product_description,
					productCategory: product_category,
					visualDirection: visual_direction ?? ds?.state.latestDirection?.id,
				})
				return { result: { components } }
			},
			generate_component_variants: async ({ component_type, framework, styling_system, visual_direction }) => {
				const ds = getDesignService()
				let fw = framework
				let styling = styling_system
				if (!fw || !styling) {
					const rawFiles = await collectWorkspaceProjectFiles(fileService, workspaceContextService, { maxFiles: 100 })
					const inspected = inspectExistingDesignSystem(rawFiles.map(f => ({ path: f.relativePath, content: f.content })))
					if (!fw && inspected.framework !== 'unknown') { fw = inspected.framework }
					if (!styling && inspected.stylingSystem !== 'unknown') { styling = inspected.stylingSystem }
				}
				return {
					result: generateComponentVariants({
						componentType: component_type,
						framework: fw,
						stylingSystem: styling,
						visualDirection: visual_direction ?? ds?.state.latestDirection?.id,
					}),
				}
			},
			inspect_existing_design_system: async ({ sub_path }) => {
				const ds = getDesignService()
				const rawFiles = await collectWorkspaceProjectFiles(fileService, workspaceContextService, { maxFiles: 350, subPath: sub_path })
				const report = inspectExistingDesignSystem(rawFiles.map(f => ({ path: f.relativePath, content: f.content })))
				ds?.recordExistingSystem(report)
				return { result: report }
			},
			audit_design_consistency: async ({ sub_path }) => {
				const ds = getDesignService()
				const rawFiles = await collectWorkspaceProjectFiles(fileService, workspaceContextService, { maxFiles: 350, subPath: sub_path })
				const report = auditDesignConsistency(rawFiles.map(f => ({ path: f.relativePath, content: f.content })))
				ds?.recordConsistencyAudit(report)
				return { result: report }
			},
			inspect_responsive_layout: async ({ session_id, tab_id, viewports, full_page }) => {
				const ds = getDesignService()
				const res = await browserService.captureMultiViewportAudit(session_id, tab_id, { viewports, fullPage: full_page })
				ds?.recordMultiViewportAudit(res)
				return { result: res }
			},
			capture_application_screenshots: async ({ session_id, tab_id, viewports, full_page }) => {
				const ds = getDesignService()
				const res = await browserService.captureMultiViewportAudit(session_id, tab_id, { viewports, fullPage: full_page })
				ds?.recordMultiViewportAudit(res)
				return { result: res }
			},
			inspect_visual_quality: async ({ session_id, tab_id }) => {
				const ds = getDesignService()
				const audit = await browserService.auditDesignVisuals(session_id, tab_id)
				ds?.recordVisualAudit(audit)
				return { result: audit }
			},
			audit_accessibility: async ({ session_id, tab_id }) => {
				const ds = getDesignService()
				const audit = await browserService.auditDesignVisuals(session_id, tab_id)
				ds?.recordVisualAudit(audit)
				return { result: audit }
			},
			audit_frontend_performance: async ({ session_id, tab_id }) => {
				const ds = getDesignService()
				const audit = await browserService.auditDesignVisuals(session_id, tab_id)
				ds?.recordVisualAudit(audit)
				return { result: audit }
			},
			critique_interface_design: async ({ session_id, tab_id, sub_path, product_description }) => {
				const ds = getDesignService()
				const rawFiles = await collectWorkspaceProjectFiles(fileService, workspaceContextService, { maxFiles: 300, subPath: sub_path })
				const staticAudit = auditDesignConsistency(rawFiles.map(f => ({ path: f.relativePath, content: f.content })))
				let visualAudit = ds?.state.latestVisualAudit ?? null
				if (session_id && tab_id) {
					visualAudit = await browserService.auditDesignVisuals(session_id, tab_id)
					ds?.recordVisualAudit(visualAudit)
				}
				const critique = critiqueInterfaceDesign({
					staticAudit,
					visualAudit,
					multiViewport: ds?.state.latestMultiViewport ?? null,
					productDescription: product_description,
				})
				ds?.recordConsistencyAudit(staticAudit)
				ds?.recordCritique(critique)
				return { result: critique }
			},
			repair_visual_defects: async ({ session_id, tab_id, sub_path }) => {
				const ds = getDesignService()
				const rawFiles = await collectWorkspaceProjectFiles(fileService, workspaceContextService, { maxFiles: 300, subPath: sub_path })
				const staticAudit = auditDesignConsistency(rawFiles.map(f => ({ path: f.relativePath, content: f.content })))
				let visualAudit = ds?.state.latestVisualAudit ?? null
				if (session_id && tab_id) {
					visualAudit = await browserService.auditDesignVisuals(session_id, tab_id)
					ds?.recordVisualAudit(visualAudit)
				}
				const critique = critiqueInterfaceDesign({
					staticAudit,
					visualAudit,
					multiViewport: ds?.state.latestMultiViewport ?? null,
				})
				const plan = planVisualDefectRepairs(critique.topPriorities)
				return { result: plan }
			},
			compare_visual_revisions: async ({ baseline_path, current_path, diff_output_path, pixel_threshold }) => {
				const ds = getDesignService()
				const cmp = await designAssetService.compareVisualRevisions({
					baselinePath: baseline_path,
					currentPath: current_path,
					diffOutputPath: diff_output_path,
					pixelThreshold: pixel_threshold,
				})
				ds?.recordComparison(cmp)
				return { result: cmp }
			},

			// Universal AI Engineering Engine & Unified Two-Engine Orchestrator (20 tools)
			ai_orchestrate_project: async ({ request }) => {
				const routing = routeEngineeringRequest(request)
				getAIEngineService()?.recordRouting(routing)
				return { result: routing }
			},
			ai_design_architecture: async ({ project_title, requirements, compute_preference }) => {
				const aiSvc = getAIEngineService()
				const settings = getAISettings()
				const arch = designAIArchitecture({
					projectTitle: project_title,
					requirements,
					hardware: aiSvc?.state.latestHardware,
					computePreference: compute_preference ?? settings.computePreference,
				})
				aiSvc?.recordArchitecture(arch)
				return { result: arch }
			},
			ai_probe_compute_hardware: async () => {
				const root = workspaceFolderPaths()[0] ?? ''
				const hw = await aiEngineMainService.probeComputeHardware(root)
				getAIEngineService()?.recordHardware(hw)
				return { result: hw }
			},
			ai_recommend_training_strategy: async ({ task_type, dataset_rows, model_size_billions, deployment_target }) => {
				const aiSvc = getAIEngineService()
				let hw = aiSvc?.state.latestHardware ?? null
				if (!hw) {
					try {
						hw = await aiEngineMainService.probeComputeHardware(workspaceFolderPaths()[0] ?? '')
						aiSvc?.recordHardware(hw)
					} catch { /* fallback to cpu-only assumption */ }
				}
				return {
					result: recommendTrainingStrategy({
						taskType: task_type,
						datasetRows: dataset_rows,
						modelSizeBillions: model_size_billions,
						deploymentTarget: deployment_target,
						hardware: hw,
					}),
				}
			},
			ai_profile_dataset: async ({ dataset_path, max_rows }) => {
				const root = workspaceFolderPaths()[0] ?? ''
				const report = await aiEngineMainService.profileDataset(root, dataset_path, { maxRows: max_rows })
				getAIEngineService()?.recordDatasetProfile(report)
				return { result: report }
			},
			ai_rag_build_index: async ({ index_name, source_paths, chunk_size, chunk_overlap, max_files }) => {
				const root = workspaceFolderPaths()[0] ?? ''
				const settings = getAISettings()
				const summary = await aiEngineMainService.buildRagIndex(root, {
					indexName: index_name,
					sourcePaths: source_paths,
					chunkSize: chunk_size ?? settings.defaultRagChunkSize,
					chunkOverlap: chunk_overlap ?? settings.defaultRagChunkOverlap,
					maxFiles: max_files,
				})
				const all = await aiEngineMainService.listRagIndexes(root)
				getAIEngineService()?.recordRagIndexes(all)
				return { result: summary }
			},
			ai_rag_query: async ({ index_name, query, top_k, source_filter }) => {
				const root = workspaceFolderPaths()[0] ?? ''
				const settings = getAISettings()
				const res = await aiEngineMainService.queryRagIndex(root, {
					indexName: index_name,
					query,
					topK: top_k ?? settings.defaultRagTopK,
					sourceFilter: source_filter,
				})
				return { result: res }
			},
			ai_rag_evaluate: async ({ index_name, top_k, cases }) => {
				const root = workspaceFolderPaths()[0] ?? ''
				const report = await aiEngineMainService.evaluateRagIndex(root, {
					indexName: index_name,
					topK: top_k,
					cases: cases.map(c => ({ query: c.query, expectedSources: c.expected_sources, expectedTerms: c.expected_terms })),
				})
				getAIEngineService()?.recordRagEval(report)
				return { result: report }
			},
			ai_experiment_manage: async (p) => {
				const root = workspaceFolderPaths()[0] ?? ''
				const res = await aiEngineMainService.manageExperiments(root, {
					action: p.action,
					id: p.id,
					name: p.name,
					discipline: p.discipline,
					modelRef: p.model_ref,
					datasetRef: p.dataset_ref,
					status: p.status,
					hyperparameters: p.hyperparameters,
					metrics: p.metrics,
					artifacts: p.artifacts,
					notes: p.notes,
					metricKey: p.metric_key,
				})
				getAIEngineService()?.recordExperiments(res.experiments)
				return { result: res }
			},
			ai_model_registry: async (p) => {
				const root = workspaceFolderPaths()[0] ?? ''
				const res = await aiEngineMainService.manageModelRegistry(root, {
					action: p.action,
					id: p.id,
					name: p.name,
					version: p.version,
					framework: p.framework,
					taskType: p.task_type,
					stage: p.stage,
					artifactPath: p.artifact_path,
					datasetRef: p.dataset_ref,
					experimentId: p.experiment_id,
					quantization: p.quantization,
					metrics: p.metrics,
					notes: p.notes,
				})
				getAIEngineService()?.recordModels(res.models)
				return { result: res }
			},
			ai_evaluate_system: async ({ name, task_type, records, min_pass_score }) => {
				const root = workspaceFolderPaths()[0] ?? ''
				const report = await aiEngineMainService.runAIModelEvaluation(root, {
					name,
					taskType: task_type,
					records,
					minPassScore: min_pass_score,
				})
				const all = await aiEngineMainService.listEvaluations(root)
				getAIEngineService()?.recordEvaluations(all)
				return { result: report }
			},
			ai_audit_security: async ({ sub_path }) => {
				const rawFiles = await collectWorkspaceProjectFiles(fileService, workspaceContextService, { maxFiles: 350, subPath: sub_path })
				const audit = auditAISecurityWorkspace(rawFiles.map(f => ({ path: f.relativePath, content: f.content })))
				getAIEngineService()?.recordSecurityAudit(audit)
				return { result: audit }
			},
			ai_estimate_performance_cost: async ({ workload_name, monthly_requests, avg_input_tokens, avg_output_tokens }) => ({
				result: estimateAIPerformanceAndCost({
					workloadName: workload_name,
					monthlyRequests: monthly_requests,
					avgInputTokens: avg_input_tokens,
					avgOutputTokens: avg_output_tokens,
				}),
			}),
			ai_create_workflow: async ({ name, instruction, trigger }) => {
				const root = workspaceFolderPaths()[0] ?? ''
				const wf = compileNaturalLanguageWorkflow({ name, instruction, trigger })
				const saved = await aiEngineMainService.saveWorkflow(root, wf)
				const all = await aiEngineMainService.listWorkflows(root)
				getAIEngineService()?.recordWorkflows(all)
				return { result: saved }
			},
			ai_run_workflow: async ({ workflow_id, input_context, approve_human_gates }) => {
				const root = workspaceFolderPaths()[0] ?? ''
				const run = await aiEngineMainService.executeWorkflow(root, {
					workflowId: workflow_id,
					inputContext: input_context,
					approveHumanGates: approve_human_gates,
				})
				getAIEngineService()?.recordWorkflowRun(run)
				return { result: run }
			},
			ai_research_analyze: async ({ topic }) => ({
				result: analyzeAIResearchTopic(topic),
			}),
			ai_discover_capabilities: async ({ query, category }) => ({
				result: { entries: discoverAICapabilities(query, category) },
			}),
			ai_scaffold_product_factory: async ({ objective, project_title, compute_preference }) => {
				const aiSvc = getAIEngineService()
				const settings = getAISettings()
				const bp = generateOneCommandFactoryBlueprint({
					objective,
					projectTitle: project_title,
					hardware: aiSvc?.state.latestHardware,
					computePreference: compute_preference ?? settings.computePreference,
				})
				aiSvc?.recordFactoryBlueprint(bp)
				return { result: bp }
			},
			ai_diagnose_failure: async ({ error_summary, logs, component }) => ({
				result: diagnoseAIFailure({ errorSummary: error_summary, logs, component }),
			}),
			ai_check_provider_capabilities: async () => {
				const state = this.voidSettingsService.state
				const localSet = new Set<string>(localProviderNames)
				const providers: ProviderCapabilitySummary[] = providerNames.map(pName => {
					const ps = state.settingsOfProvider[pName]
					const activeModels = (ps?.models ?? []).filter(m => !m.isHidden)
					const configured = !!(ps?._didFillInProviderSettings && activeModels.length > 0)
					let supportsToolCalling = false
					let supportsVision = false
					let supportsReasoning = false
					for (const m of activeModels.slice(0, 8)) {
						const caps = getModelCapabilities(pName, m.modelName, state.overridesOfModel)
						if (caps.specialToolFormat) { supportsToolCalling = true }
						if (caps.supportsVision) { supportsVision = true }
						if (caps.reasoningCapabilities && caps.reasoningCapabilities.supportsReasoning) { supportsReasoning = true }
					}
					return {
						providerName: pName,
						configured,
						isLocal: localSet.has(pName),
						modelCount: activeModels.length,
						sampleModels: activeModels.slice(0, 5).map(m => m.modelName),
						supportsToolCalling,
						supportsVision,
						supportsReasoning,
					}
				})
				return {
					result: {
						providers,
						configuredCount: providers.filter(p => p.configured).length,
						localConfiguredCount: providers.filter(p => p.configured && p.isLocal).length,
					},
				}
			},

			// Kodia API Engineering Studio (20 tools)
			api_open_studio: async ({ section, method, url, protocol }) => {
				const svc = getApiStudioService()
				const targetSection: ApiStudioSection = section ?? 'requests'
				let req: ApiRequestSpec | undefined
				if (url) {
					const cur = svc?.state.activeRequest
					req = {
						id: `req-${Date.now().toString(36)}`,
						name: `${method ?? 'GET'} ${url}`,
						protocol: protocol ?? 'http',
						method: method ?? 'GET',
						url,
						params: cur?.params ?? [],
						headers: cur?.headers ?? [{ id: 'h-accept', key: 'Accept', value: 'application/json', enabled: true }],
						auth: cur?.auth ?? { type: 'none' },
						body: cur?.body ?? { mode: 'none' },
						assertions: cur?.assertions ?? [],
					}
				}
				await svc?.openStudio({ section: targetSection, request: req })
				return { result: { opened: true, section: targetSection, url } }
			},
			api_discover_project: async ({ sub_path, max_files }) => {
				const root = workspaceFolderPaths()[0] ?? ''
				const scanned = await collectWorkspaceProjectFiles(fileService, workspaceContextService, { subPath: sub_path, maxFiles: max_files ?? 150 })
				const report = discoverWorkspaceApis(root, scanned.map(f => ({ path: f.relativePath, content: f.content })))
				const svc = getApiStudioService()
				svc?.recordDiscovery(report)
				if (getApiStudioSettings().autoOpenStudioOnApiTasks) {
					void svc?.openStudio({ section: 'explorer' })
				}
				return { result: report }
			},
			api_runtime_start: async ({ name, command, cwd, port, health_url, env, ready_timeout_ms }) => {
				const root = workspaceFolderPaths()[0] ?? ''
				const info = await apiStudioMainService.startRuntime(root, { name, command, cwd, port, healthUrl: health_url, env, readyTimeoutMs: ready_timeout_ms })
				const all = await apiStudioMainService.listRuntimes()
				const svc = getApiStudioService()
				svc?.recordRuntimes(all)
				if (getApiStudioSettings().autoOpenStudioOnApiTasks) {
					void svc?.openStudio({ section: 'topology' })
				}
				return { result: info }
			},
			api_runtime_status: async () => {
				const runtimes = await apiStudioMainService.listRuntimes()
				getApiStudioService()?.recordRuntimes(runtimes)
				return { result: { runtimes } }
			},
			api_runtime_stop: async ({ runtime_id, stop_all }) => {
				if (stop_all || !runtime_id) {
					const stoppedCount = await apiStudioMainService.stopAllRuntimes()
					getApiStudioService()?.recordRuntimes(await apiStudioMainService.listRuntimes())
					return { result: { stoppedCount } }
				}
				const runtime = await apiStudioMainService.stopRuntime(runtime_id)
				getApiStudioService()?.recordRuntimes(await apiStudioMainService.listRuntimes())
				return { result: { stoppedCount: runtime ? 1 : 0, runtime } }
			},
			api_send_request: async (p) => {
				const root = workspaceFolderPaths()[0] ?? ''
				const headersList: ApiKeyValuePair[] = Object.entries(p.headers ?? {}).map(([k, v], i) => ({
					id: `hdr-${i}`,
					key: k,
					value: String(v),
					enabled: true,
				}))
				const body: ApiRequestBody = p.body ?? (p.body_raw !== undefined ? { mode: p.protocol === 'soap' ? 'soap' : 'json', raw: p.body_raw } : { mode: 'none' })
				const reqSpec: ApiRequestSpec = {
					id: `req-${Date.now().toString(36)}`,
					name: p.name ?? `${p.method ?? 'GET'} ${p.url}`,
					protocol: p.protocol ?? 'http',
					method: p.method ?? 'GET',
					url: p.url,
					params: p.params ?? [],
					headers: headersList,
					auth: p.auth ?? { type: 'none' },
					body,
					preRequestScript: p.pre_request_script,
					testScript: p.test_script,
					assertions: p.assertions ?? [],
					timeoutMs: p.timeout_ms ?? getApiStudioSettings().defaultTimeoutMs,
				}
				const svc = getApiStudioService()
				svc?.setActiveRequest(reqSpec)
				if (getApiStudioSettings().autoOpenStudioOnApiTasks) {
					void svc?.openStudio({ section: 'requests', request: reqSpec })
				}
				const response = await apiStudioMainService.executeRequest(root, {
					request: reqSpec,
					environmentId: p.environment_id,
					allowProtectedEnvironment: p.allow_protected_environment,
					persistHistory: true,
				})
				svc?.recordResponse(response)
				await svc?.refreshFromDisk()
				return { result: response }
			},
			api_websocket_session: async ({ action, session_id, url, message, kind, headers }) => {
				const root = workspaceFolderPaths()[0] ?? ''
				let session = null
				if (action === 'connect') {
					if (!url) throw new Error('url is required for api_websocket_session connect')
					session = await apiStudioMainService.connectWebSocket(root, { url, headers })
				} else if (action === 'send') {
					if (!session_id) throw new Error('session_id is required for api_websocket_session send')
					session = await apiStudioMainService.sendWebSocketMessage(session_id, message ?? '', kind ?? 'text')
				} else if (action === 'close') {
					if (!session_id) throw new Error('session_id is required for api_websocket_session close')
					session = await apiStudioMainService.closeWebSocket(session_id)
				}
				const sessions = await apiStudioMainService.listWebSockets()
				const svc = getApiStudioService()
				svc?.recordWebSockets(sessions)
				if (getApiStudioSettings().autoOpenStudioOnApiTasks && action === 'connect') {
					void svc?.openStudio({ section: 'websockets' })
				}
				return { result: { session, sessions } }
			},
			api_generate_test_suite: async ({ name, base_url, include_negative_tests, save }) => {
				const root = workspaceFolderPaths()[0] ?? ''
				const svc = getApiStudioService()
				let discovery = svc?.state.discovery ?? null
				if (!discovery) {
					const scanned = await collectWorkspaceProjectFiles(fileService, workspaceContextService, { maxFiles: 150 })
					discovery = discoverWorkspaceApis(root, scanned.map(f => ({ path: f.relativePath, content: f.content })))
					svc?.recordDiscovery(discovery)
				}
				const suite = generateApiTestSuiteFromDiscovery({ name, baseUrl: base_url, discovery, includeNegativeTests: include_negative_tests })
				if (save !== false && root) {
					const all = await apiStudioMainService.saveTestSuite(root, suite)
					svc?.recordSuites(all)
				}
				return { result: suite }
			},
			api_run_test_suite: async ({ suite_id, suite, environment_id, base_url, allow_protected_environment }) => {
				const root = workspaceFolderPaths()[0] ?? ''
				const svc = getApiStudioService()
				if (getApiStudioSettings().autoOpenStudioOnApiTasks) {
					void svc?.openStudio({ section: 'runner' })
				}
				const run = await apiStudioMainService.runTestSuite(root, {
					suiteId: suite_id,
					suite,
					environmentId: environment_id,
					baseUrlOverride: base_url,
					allowProtectedEnvironment: allow_protected_environment,
				})
				svc?.recordTestRun(run)
				await svc?.refreshFromDisk()
				return { result: run }
			},
			api_run_load_test: async (p) => {
				const root = workspaceFolderPaths()[0] ?? ''
				const svc = getApiStudioService()
				if (getApiStudioSettings().autoOpenStudioOnApiTasks) {
					void svc?.openStudio({ section: 'performance' })
				}
				const headersList: ApiKeyValuePair[] = Object.entries(p.headers ?? {}).map(([k, v], i) => ({
					id: `lh-${i}`, key: k, value: String(v), enabled: true,
				}))
				const run = await apiStudioMainService.runLoadTest(root, {
					name: p.name,
					request: {
						id: `load-req-${Date.now().toString(36)}`,
						name: p.name,
						protocol: 'http',
						method: p.method ?? 'GET',
						url: p.url,
						params: [],
						headers: headersList,
						auth: { type: 'none' },
						body: p.body_raw ? { mode: 'json', raw: p.body_raw } : { mode: 'none' },
					},
					virtualUsers: p.virtual_users,
					durationSeconds: p.duration_seconds,
					rampUpSeconds: p.ramp_up_seconds,
					maxErrorRate: p.max_error_rate,
					p95ThresholdMs: p.p95_threshold_ms,
					allowNonLocalTarget: p.allow_non_local_target,
				})
				svc?.recordLoadRun(run)
				return { result: run }
			},
			api_security_audit: async ({ base_url, sub_path, allow_live_probes }) => {
				const root = workspaceFolderPaths()[0] ?? ''
				const scanned = await collectWorkspaceProjectFiles(fileService, workspaceContextService, { subPath: sub_path, maxFiles: 120 })
				const staticAudit = auditApiWorkspaceStaticSecurity(scanned.map(f => ({ path: f.relativePath, content: f.content })))
				const svc = getApiStudioService()
				const discovery = svc?.state.discovery ?? discoverWorkspaceApis(root, scanned.map(f => ({ path: f.relativePath, content: f.content })))
				const report = await apiStudioMainService.runSecurityAudit(root, {
					baseUrl: base_url,
					routes: discovery.routes,
					staticFindings: staticAudit.findings,
					filesScanned: scanned.length,
					allowLiveProbes: allow_live_probes,
				})
				svc?.recordSecurityReport(report)
				if (getApiStudioSettings().autoOpenStudioOnApiTasks) {
					void svc?.openStudio({ section: 'security' })
				}
				return { result: report }
			},
			api_compare_responses: async ({ left_history_index, right_history_index, left_response, right_response }) => {
				const root = workspaceFolderPaths()[0] ?? ''
				const snap = await apiStudioMainService.loadWorkspaceSnapshot(root)
				const left: ApiResponseResult | undefined = left_response ?? snap.history[left_history_index ?? 1]?.response
				const right: ApiResponseResult | undefined = right_response ?? snap.history[right_history_index ?? 0]?.response
				if (!left || !right) {
					throw new Error('At least two recorded API responses are required to compare.')
				}
				return { result: compareApiResponses(left, right, `History[${left_history_index ?? 1}]`, `History[${right_history_index ?? 0}]`) }
			},
			api_generate_openapi: async ({ title, version, server_url, sub_path }) => {
				const root = workspaceFolderPaths()[0] ?? ''
				const scanned = await collectWorkspaceProjectFiles(fileService, workspaceContextService, { subPath: sub_path, maxFiles: 150 })
				const discovery = discoverWorkspaceApis(root, scanned.map(f => ({ path: f.relativePath, content: f.content })))
				const spec = generateOpenApiSpecFromDiscovery({ title, version, serverUrl: server_url, discovery })
				return { result: { spec, endpointCount: discovery.routes.filter(r => r.protocol === 'http').length } }
			},
			api_diff_specs: async ({ base_spec_json, target_spec_json }) => ({
				result: diffOpenApiSpecs(base_spec_json, target_spec_json),
			}),
			api_generate_client_sdk: async ({ url, method, headers, body_raw, target }) => {
				const req: ApiRequestSpec = {
					id: 'sdk-gen',
					name: `${method ?? 'GET'} ${url}`,
					protocol: 'http',
					method: method ?? 'GET',
					url,
					params: [],
					headers: Object.entries(headers ?? {}).map(([k, v], i) => ({ id: `h-${i}`, key: k, value: String(v), enabled: true })),
					auth: { type: 'none' },
					body: body_raw ? { mode: 'json', raw: body_raw } : { mode: 'none' },
				}
				return { result: { target, code: generateApiClientCode(req, target) } }
			},
			api_mock_server: async ({ action, name, mock_id, port, routes }) => {
				const root = workspaceFolderPaths()[0] ?? ''
				let mock = undefined
				let stopped = undefined
				if (action === 'start') {
					mock = await apiStudioMainService.startMockServer(root, { name: name || 'Kodia Mock API', port, routes: routes ?? [] })
				} else if (action === 'stop' && mock_id) {
					stopped = await apiStudioMainService.stopMockServer(mock_id)
				}
				const mocks = await apiStudioMainService.listMockServers()
				getApiStudioService()?.recordMockServers(mocks)
				return { result: { mock, mocks, stopped } }
			},
			api_manage_collection: async ({ action, collection_id, name, raw_input, collection }) => {
				const root = workspaceFolderPaths()[0] ?? ''
				const svc = getApiStudioService()
				if (action === 'save' && collection) {
					const collections = await apiStudioMainService.saveCollection(root, collection)
					svc?.recordCollections(collections)
					return { result: { message: `Saved collection "${collection.name}".`, collections } }
				}
				if (action === 'delete' && collection_id) {
					const collections = await apiStudioMainService.deleteCollection(root, collection_id)
					svc?.recordCollections(collections)
					return { result: { message: `Deleted collection ${collection_id}.`, collections } }
				}
				if (action === 'import_curl' && raw_input) {
					const req = importFromCurl(raw_input)
					const now = new Date().toISOString()
					const col: ApiCollection = {
						id: `col-curl-${Date.now().toString(36)}`,
						name: name || 'Imported cURL',
						variables: [],
						requests: [req],
						createdAt: now,
						updatedAt: now,
					}
					const collections = await apiStudioMainService.saveCollection(root, col)
					svc?.recordCollections(collections)
					return { result: { message: `Imported cURL request into collection "${col.name}".`, collections } }
				}
				if (action === 'import_postman' && raw_input) {
					const col = importFromPostmanCollection(raw_input)
					const collections = await apiStudioMainService.saveCollection(root, col)
					svc?.recordCollections(collections)
					return { result: { message: `Imported Postman collection "${col.name}" (${col.requests.length} requests).`, collections } }
				}
				const snap = await apiStudioMainService.loadWorkspaceSnapshot(root)
				if (action === 'export_postman' && collection_id) {
					const target = snap.collections.find(c => c.id === collection_id)
					if (!target) throw new Error(`Collection "${collection_id}" not found.`)
					return { result: { message: `Exported "${target.name}" as Postman v2.1 JSON.`, collections: [...snap.collections], exportedJson: JSON.stringify(exportCollectionToPostman(target), null, 2) } }
				}
				svc?.recordCollections(snap.collections)
				return { result: { message: `${snap.collections.length} API collection(s) found.`, collections: [...snap.collections] } }
			},
			api_manage_environment: async ({ action, environment_id, name, kind, base_url, is_protected, variables, set_active }) => {
				const root = workspaceFolderPaths()[0] ?? ''
				const svc = getApiStudioService()
				if (action === 'save') {
					const env: ApiEnvironment = {
						id: environment_id || `env-${(name || 'local').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`,
						name: name || 'Local',
						kind: kind ?? 'local',
						baseUrl: base_url,
						isProtected: is_protected,
						variables: variables ?? [],
						updatedAt: new Date().toISOString(),
					}
					const res = await apiStudioMainService.saveEnvironment(root, env, set_active !== false)
					svc?.recordEnvironments(res.environments, res.activeEnvironmentId)
					return { result: { message: `Saved environment "${env.name}" (${env.kind}).`, environments: res.environments, activeEnvironmentId: res.activeEnvironmentId } }
				}
				if (action === 'set_active') {
					const activeId = await apiStudioMainService.setActiveEnvironment(root, environment_id ?? null)
					const snap = await apiStudioMainService.loadWorkspaceSnapshot(root)
					svc?.recordEnvironments(snap.environments, activeId)
					return { result: { message: `Active API environment set to ${activeId ?? 'none'}.`, environments: [...snap.environments], activeEnvironmentId: activeId } }
				}
				const snap = await apiStudioMainService.loadWorkspaceSnapshot(root)
				svc?.recordEnvironments(snap.environments, snap.activeEnvironmentId)
				return { result: { message: `${snap.environments.length} environment(s) configured (active=${snap.activeEnvironmentId ?? 'none'}).`, environments: [...snap.environments], activeEnvironmentId: snap.activeEnvironmentId } }
			},
			api_assess_production_readiness: async () => {
				const root = workspaceFolderPaths()[0] ?? ''
				const snap = await apiStudioMainService.loadWorkspaceSnapshot(root)
				const svc = getApiStudioService()
				const report = assessApiProductionReadiness({
					discovery: svc?.state.discovery,
					latestTestRun: snap.testRuns[0] ?? null,
					latestLoadRun: snap.loadRuns[0] ?? null,
					latestSecurityReport: snap.securityReports[0] ?? null,
					runtimes: snap.runtimes,
				})
				svc?.recordReadiness(report)
				if (getApiStudioSettings().autoOpenStudioOnApiTasks) {
					void svc?.openStudio({ section: 'readiness' })
				}
				return { result: report }
			},
			api_correlate_failure: async ({ history_index }) => {
				const root = workspaceFolderPaths()[0] ?? ''
				const snap = await apiStudioMainService.loadWorkspaceSnapshot(root)
				const svc = getApiStudioService()
				const target = snap.history[history_index ?? 0]?.response ?? svc?.state.latestResponse
				if (!target) { throw new Error('No recorded API response found to correlate.'); }
				const report = correlateApiFailure({
					response: target,
					discovery: svc?.state.discovery,
					runtimes: snap.runtimes,
				})
				svc?.recordFailureCorrelation(report)
				return { result: report }
			},

			// Kodia Deep Debugging, Software Correctness & Independent Verification (14 tools)
			correctness_open_hub: async ({ section }) => {
				const target: CorrectnessHubSection = section ?? 'diagnostics'
				await getCorrectnessService()?.openHub(target)
				return { result: { opened: true, section: target } }
			},
			correctness_analyze_workspace: async ({ sub_path, incremental, max_files }) => {
				const root = workspaceFolderPaths()[0] ?? ''
				const scanned = await collectWorkspaceProjectFiles(fileService, workspaceContextService, { subPath: sub_path, maxFiles: max_files ?? 200 })
				const svc = getCorrectnessService()
				const suppressions = root ? await correctnessMainService.manageSuppressions(root, { action: 'list' }) : []
				const cache = incremental !== false && svc ? svc.getIncrementalCache() : { hashes: {}, diagnosticsByFile: {} }
				const { report, nextHashes, nextDiagnosticsByFile } = runIncrementalCorrectnessAnalysis({
					files: scanned,
					previousHashes: incremental !== false ? cache.hashes : undefined,
					previousDiagnosticsByFile: incremental !== false ? cache.diagnosticsByFile : undefined,
					suppressions,
				})
				svc?.setIncrementalCache(nextHashes, nextDiagnosticsByFile)
				svc?.recordIncremental(report)
				return { result: report }
			},
			correctness_run_compilers: async ({ target_files, languages }) => {
				const root = workspaceFolderPaths()[0] ?? ''
				const outcomes = await correctnessMainService.runCompilerAndAnalyzers(root, { targetFiles: target_files, languages })
				getCorrectnessService()?.recordCompilerOutcomes(outcomes)
				const totalErrors = outcomes.reduce((s, o) => s + o.diagnostics.filter(d => d.severity === 'error' || d.severity === 'critical').length, 0)
				return { result: { outcomes, totalErrors } }
			},
			correctness_taint_analysis: async ({ sub_path, max_files }) => {
				const scanned = await collectWorkspaceProjectFiles(fileService, workspaceContextService, { subPath: sub_path, maxFiles: max_files ?? 180 })
				const report = analyzeTaintFlows(scanned)
				getCorrectnessService()?.recordTaint(report)
				return { result: report }
			},
			correctness_investigate_root_cause: async ({ symptom, stack_trace_or_logs, sub_path }) => {
				const root = workspaceFolderPaths()[0] ?? ''
				const scanned = await collectWorkspaceProjectFiles(fileService, workspaceContextService, { subPath: sub_path, maxFiles: 180 })
				const svc = getCorrectnessService()
				const suppressions = root ? await correctnessMainService.manageSuppressions(root, { action: 'list' }) : []
				const diags = analyzeWorkspaceCorrectness(scanned, { suppressions })
				const taint = analyzeTaintFlows(scanned)
				const report = investigateRootCause({
					symptom,
					stackTraceOrLogs: stack_trace_or_logs,
					files: scanned,
					diagnostics: diags,
					taintReport: taint,
					compilerOutcomes: svc?.state.latestCompilerOutcomes,
				})
				svc?.recordInvestigation(report)
				if (root) { await correctnessMainService.saveInvestigation(root, report) }
				if (getCorrectnessSettings().autoOpenHubOnDeepInvestigation) {
					void svc?.openHub('investigate')
				}
				return { result: report }
			},
			correctness_run_fuzz_test: async ({ target_file, export_name, property_expression, arg_schema, iterations, seed }) => {
				const root = workspaceFolderPaths()[0] ?? ''
				const report = await correctnessMainService.runPropertyFuzzTest(root, {
					targetFile: target_file,
					exportName: export_name,
					propertyExpression: property_expression,
					argSchema: arg_schema,
					iterations: iterations ?? getCorrectnessSettings().fuzzDefaultIterations,
					seed,
				})
				getCorrectnessService()?.recordFuzzRun(report)
				return { result: report }
			},
			correctness_run_mutation_test: async ({ target_file, test_command, max_mutants, timeout_ms }) => {
				const root = workspaceFolderPaths()[0] ?? ''
				const report = await correctnessMainService.runMutationTesting(root, {
					targetFile: target_file,
					testCommand: test_command,
					maxMutants: max_mutants ?? getCorrectnessSettings().mutationMaxMutantsPerRun,
					timeoutMs: timeout_ms ?? getCorrectnessSettings().mutationTimeoutMs,
				})
				getCorrectnessService()?.recordMutationRun(report)
				return { result: report }
			},
			correctness_plan_repair: async ({ defect_summary, target_files, smallest_fix_strategy }) => {
				const scanned = await collectWorkspaceProjectFiles(fileService, workspaceContextService, { maxFiles: 180 })
				const plan = buildControlledRepairPlan({
					defectSummary: defect_summary,
					targetFiles: target_files,
					files: scanned,
					smallestFixStrategy: smallest_fix_strategy,
				})
				getCorrectnessService()?.recordRepairPlan(plan)
				return { result: plan }
			},
			correctness_independent_verify: async ({ change_description, changed_files, requirements, test_commands, require_tests }) => {
				const root = workspaceFolderPaths()[0] ?? ''
				const report = await correctnessMainService.runIndependentVerification(root, {
					changeDescription: change_description,
					changedFiles: changed_files,
					requirements,
					testCommands: test_commands,
					requireTests: require_tests,
				})
				const svc = getCorrectnessService()
				svc?.recordVerification(report)
				await svc?.refreshFromDisk()
				return { result: report }
			},
			correctness_create_proof_record: async ({ title, changed_files, requirements, summary, known_limitations }) => {
				const root = workspaceFolderPaths()[0] ?? ''
				const svc = getCorrectnessService()
				const latestV = svc?.state.verifications[0]
				const record: ProofCarryingChangeRecord = {
					id: `proof-${Date.now().toString(36)}`,
					createdAt: new Date().toISOString(),
					title,
					requirementsCovered: requirements ?? [title],
					changedFiles: changed_files,
					originalFailureOrGoal: title,
					analyzersRun: ['kodia-deep-analyzer', 'kodia-taint-analyzer'],
					testsExecuted: [],
					staticFindingsCount: svc?.state.latestIncremental?.diagnostics.filter(d => !d.suppressed).length ?? 0,
					taintFindingsCount: svc?.state.latestTaint?.unsafeFlows.length ?? 0,
					independentVerdict: latestV?.verdict ?? 'CONDITIONAL',
					knownLimitations: known_limitations ?? ['Manually assembled proof record; run correctness_independent_verify for automated check capture.'],
					unresolvedRisks: latestV?.rejectionReasons ? [...latestV.rejectionReasons] : [],
					summary,
				}
				const all = root ? await correctnessMainService.saveProofRecord(root, record) : [record]
				svc?.recordProofs(all)
				return { result: { record, totalProofs: all.length } }
			},
			correctness_assess_release_readiness: async ({ infrastructure_blocked_reason }) => {
				const root = workspaceFolderPaths()[0] ?? ''
				const svc = getCorrectnessService()
				const snap = root ? await correctnessMainService.loadWorkspaceSnapshot(root) : null
				const report = assessReleaseReadiness({
					compilerOutcomes: svc?.state.latestCompilerOutcomes,
					diagnostics: svc?.state.latestIncremental?.diagnostics,
					taintReport: svc?.state.latestTaint,
					latestVerification: svc?.state.verifications[0] ?? snap?.verifications[0] ?? null,
					infrastructureBlockedReason: infrastructure_blocked_reason,
				})
				svc?.recordReadiness(report)
				if (root) { await correctnessMainService.saveReadinessReport(root, report) }
				return { result: report }
			},
			correctness_export_sarif: async ({ sub_path }) => {
				const scanned = await collectWorkspaceProjectFiles(fileService, workspaceContextService, { subPath: sub_path, maxFiles: 180 })
				const diags = analyzeWorkspaceCorrectness(scanned)
				const taint = analyzeTaintFlows(scanned)
				const sarif = exportDiagnosticsToSarif(diags, taint.unsafeFlows)
				return { result: { sarif, findingCount: diags.length + taint.unsafeFlows.length } }
			},
			correctness_list_proofs: async () => {
				const root = workspaceFolderPaths()[0] ?? ''
				const snap = root ? await correctnessMainService.loadWorkspaceSnapshot(root) : null
				const proofs = [...(snap?.proofs ?? [])]
				getCorrectnessService()?.recordProofs(proofs)
				return { result: { proofs } }
			},
			correctness_manage_suppressions: async ({ action, id, rule_id, file_pattern, justification }) => {
				const root = workspaceFolderPaths()[0] ?? ''
				const suppressions = await correctnessMainService.manageSuppressions(root, {
					action,
					id,
					ruleId: rule_id,
					filePattern: file_pattern,
					justification,
				})
				getCorrectnessService()?.recordSuppressions(suppressions)
				return { result: { suppressions } }
			},

			// Kodia Next-Gen Evolution, Supply-Chain, IaC/FinOps, Ops & Governance (12 tools)
			evolution_open_hub: async ({ section }) => {
				const target: EvolutionHubSection = section ?? 'radar'
				await getEvolutionService()?.openHub(target)
				return { result: { opened: true, section: target } }
			},
			evolution_supply_chain_sbom: async ({ run_live_audit, block_copyleft }) => {
				const root = workspaceFolderPaths()[0] ?? ''
				const cfg = getEvolutionSettings()
				const report = await evolutionMainService.runSupplyChainAudit(root, {
					runLiveAudit: run_live_audit ?? true,
					blockCopyleft: block_copyleft ?? cfg.blockCopyleftLicensesInCommercialMode,
				})
				getEvolutionService()?.recordSupplyChain(report)
				return { result: report }
			},
			evolution_audit_iac_finops: async ({ monthly_budget_usd }) => {
				const root = workspaceFolderPaths()[0] ?? ''
				const cfg = getEvolutionSettings()
				const report = await evolutionMainService.runIacFinOpsAudit(root, {
					monthlyBudgetUsd: monthly_budget_usd ?? cfg.monthlyCloudBudgetUsd,
				})
				getEvolutionService()?.recordIacFinOps(report)
				return { result: report }
			},
			evolution_analyze_incident: async ({ service_name, log_text, log_file, slo_target_pct, p95_budget_ms }) => {
				const root = workspaceFolderPaths()[0] ?? ''
				const cfg = getEvolutionSettings()
				const report = await evolutionMainService.analyzeProductionIncident(root, {
					serviceName: service_name,
					logText: log_text,
					logFile: log_file,
					sloTargetPct: slo_target_pct ?? cfg.defaultSloAvailabilityTarget,
					p95BudgetMs: p95_budget_ms ?? cfg.defaultP95LatencyBudgetMs,
				})
				getEvolutionService()?.recordIncident(report)
				return { result: report }
			},
			evolution_plan_release: async ({ since_ref, current_version }) => {
				const root = workspaceFolderPaths()[0] ?? ''
				const report = await evolutionMainService.planAutonomousRelease(root, {
					sinceRef: since_ref,
					currentVersion: current_version,
				})
				getEvolutionService()?.recordReleasePlan(report)
				return { result: report }
			},
			evolution_audit_privacy_compliance: async ({ sub_path }) => {
				const root = workspaceFolderPaths()[0] ?? ''
				const { privacy, modernization } = await evolutionMainService.auditPrivacyAndModernization(root, { subPath: sub_path })
				getEvolutionService()?.recordPrivacy(privacy)
				getEvolutionService()?.recordModernization(modernization)
				return { result: privacy }
			},
			evolution_plan_modernization: async ({ sub_path }) => {
				const root = workspaceFolderPaths()[0] ?? ''
				const { privacy, modernization } = await evolutionMainService.auditPrivacyAndModernization(root, { subPath: sub_path })
				getEvolutionService()?.recordPrivacy(privacy)
				getEvolutionService()?.recordModernization(modernization)
				return { result: modernization }
			},
			evolution_run_capability_radar: async ({ audit_interval_hours }) => {
				const root = workspaceFolderPaths()[0] ?? ''
				const cfg = getEvolutionSettings()
				const report = await evolutionMainService.runCapabilityEvolutionRadar(root, {
					auditIntervalHours: audit_interval_hours ?? cfg.auditIntervalHours,
				})
				getEvolutionService()?.recordRadar(report)
				return { result: report }
			},
			evolution_evaluate_technology: async (params) => {
				const root = workspaceFolderPaths()[0] ?? ''
				const result = await evolutionMainService.evaluateTechnologyCandidate(root, {
					name: params.name,
					domain: params.domain,
					summary: params.summary,
					license: params.license,
					maturity: params.maturity,
					benchmarksOrEvidenceCount: params.benchmarks_count,
					requiresNewRuntimeDependency: params.requires_new_dependency,
					requiresSpecialHardware: params.requires_special_hardware,
					knownSecurityConcerns: params.security_concerns,
					overlapsExistingKodiaCapability: params.overlaps_existing,
				})
				const proposals = await evolutionMainService.manageProposals(root, { action: 'list' })
				getEvolutionService()?.recordProposals(proposals)
				return { result }
			},
			evolution_manage_proposals: async (params) => {
				const root = workspaceFolderPaths()[0] ?? ''
				const proposals = await evolutionMainService.manageProposals(root, {
					action: params.action,
					id: params.id,
					status: params.status,
					title: params.title,
					domain: params.domain,
					verdict: params.verdict,
					signalScore: params.signal_score,
					justification: params.justification,
					acceptanceCriteria: params.acceptance_criteria,
				})
				getEvolutionService()?.recordProposals(proposals)
				return { result: { proposals } }
			},
			evolution_schedule_periodic_audit: async ({ interval_hours }) => {
				const cfg = getEvolutionSettings()
				const hours = Math.max(1, Math.min(720, Math.round(interval_hours ?? cfg.auditIntervalHours)))
				const wf = getWorkflowsService()
				if (!wf) {
					return { result: { scheduled: false, intervalHours: hours, message: 'Kodia Workflows scheduler service unavailable in headless mode; run evolution_run_capability_radar manually.' } }
				}
				const job = wf.addScheduledJob({
					name: 'Kodia Periodic Capability Evolution Audit',
					prompt: 'Run evolution_run_capability_radar and evolution_supply_chain_sbom to evaluate emerging engineering capabilities, security threats, and dependency risks. Record proposals in .kodia/evolution/proposals.json and NEVER blindly install dependencies.',
					chatMode: 'agent',
					intervalMinutes: hours * 60,
					enabled: true,
				})
				return { result: { scheduled: true, jobId: job.id, intervalHours: hours, message: `Scheduled recurring Kodia Capability Evolution Audit every ${hours}h (jobId=${job.id}).` } }
			},
			evolution_workspace_overview: async () => {
				const root = workspaceFolderPaths()[0] ?? ''
				const snap = await evolutionMainService.loadWorkspaceSnapshot(root)
				return { result: snap }
			},

			// Kodia Permanent Mobile Application Engineering Platform (12 tools)
			mobile_open_studio: async ({ section }) => {
				const targetSection: MobileStudioSection = section ?? 'overview'
				const svc = getMobileService()
				await svc?.openStudio(targetSection)
				return { result: { opened: true, section: targetSection } }
			},
			mobile_probe_environment: async () => {
				const root = workspaceFolderPaths()[0] ?? ''
				const report = await mobileMainService.probeEnvironment(root)
				getMobileService()?.recordEnvironment(report)
				return { result: report }
			},
			mobile_inspect_project: async () => {
				const root = workspaceFolderPaths()[0] ?? ''
				const report = await mobileMainService.inspectWorkspace(root)
				getMobileService()?.recordProjectIntel(report)
				return { result: report }
			},
			mobile_design_architecture: async (p) => {
				const root = workspaceFolderPaths()[0] ?? ''
				const report = await mobileMainService.designArchitecture(root, {
					objective: p.objective,
					platform: p.platform,
					framework: p.framework,
					appCategory: p.app_category,
					backend: p.backend,
					database: p.database,
					includeAuth: p.include_auth,
					includeAI: p.include_ai,
					includeOffline: p.include_offline,
					includeRealtime: p.include_realtime,
					deviceCapabilities: p.device_capabilities,
				})
				getMobileService()?.recordArchitecture(report)
				return { result: report }
			},
			mobile_scaffold_project: async (p) => {
				const root = workspaceFolderPaths()[0] ?? ''
				const res = await mobileMainService.scaffoldProject(root, {
					projectName: p.project_name,
					targetDir: p.target_dir,
					objective: p.objective,
					framework: p.framework,
					platform: p.platform,
					appCategory: p.app_category,
					backend: p.backend,
					database: p.database,
					includeAI: p.include_ai,
					includeOffline: p.include_offline,
					includeAuth: p.include_auth,
					overwrite: p.overwrite,
				})
				getMobileService()?.recordScaffold(res)
				return { result: res }
			},
			mobile_device_action: async (p) => {
				const root = workspaceFolderPaths()[0] ?? ''
				const res = await mobileMainService.runDeviceAction(root, {
					action: p.action,
					deviceId: p.device_id,
					avdName: p.avd_name,
					packageName: p.package_name,
					artifactPath: p.artifact_path,
					lines: p.lines,
				})
				return { result: res }
			},
			mobile_build_and_test: async (p) => {
				const root = workspaceFolderPaths()[0] ?? ''
				const res = await mobileMainService.runBuildOrTest(root, {
					mode: p.mode,
					targetDir: p.target_dir,
					framework: p.framework,
					platform: p.platform,
					customCommand: p.custom_command,
					timeoutMs: p.timeout_ms,
				})
				getMobileService()?.recordBuildTest(res)
				return { result: res }
			},
			mobile_audit_security: async () => {
				const root = workspaceFolderPaths()[0] ?? ''
				const report = await mobileMainService.runSecurityAudit(root)
				getMobileService()?.recordSecurityAudit(report)
				return { result: report }
			},
			mobile_audit_performance: async () => {
				const root = workspaceFolderPaths()[0] ?? ''
				const report = await mobileMainService.runPerformanceAudit(root)
				getMobileService()?.recordPerformanceAudit(report)
				return { result: report }
			},
			mobile_assess_readiness: async () => {
				const root = workspaceFolderPaths()[0] ?? ''
				const report = await mobileMainService.assessProductionReadiness(root)
				getMobileService()?.recordReadiness(report)
				return { result: report }
			},
			mobile_discover_capabilities: async ({ query, category }) => {
				return { result: { entries: discoverMobileCapabilities(query, category) } }
			},
			mobile_workspace_overview: async () => {
				const root = workspaceFolderPaths()[0] ?? ''
				const snap = await mobileMainService.loadWorkspaceSnapshot(root)
				return { result: snap }
			},

			// Notebook operations
			read_notebook: async ({ uri, start_cell, end_cell, cell_index, summary_only }) => {
				const compactOutputForRead = (out: any) => {
					if (!out || typeof out !== 'object') return out
					if (out.data && typeof out.data === 'object') {
						const cleanData: Record<string, unknown> = {}
						for (const [mime, val] of Object.entries(out.data)) {
							if (mime.startsWith('image/') && typeof val === 'string') {
								cleanData[mime] = `<${mime} base64 ${val.length} chars>`
							} else if (mime.startsWith('image/') && Array.isArray(val)) {
								cleanData[mime] = `<${mime} base64 ${val.join('').length} chars>`
							} else {
								cleanData[mime] = val
							}
						}
						return { ...out, data: cleanData }
					}
					return out
				}
				const openModel = this.notebookService.getNotebookTextModel(uri)
				if (openModel) {
					const allCells = openModel.cells.map((cell: any, idx: number) => {
						const { formattedOutputs } = formatNotebookCellOutputs(cell.outputs || [])
						return {
							index: idx,
							cell_type: cell.cellKind === CellKind.Markup ? 'markdown' : 'code',
							source: cell.getValue(),
							outputs: formattedOutputs,
							execution_count: cell.internalMetadata?.executionOrder ?? null,
							metadata: cell.metadata || {},
						}
					})
					const total_cells = allCells.length
					const ks = (openModel.metadata as any)?.kernelspec
					const kernelspec = ks ? String(ks.display_name ?? ks.name ?? '') || null : null
					if (cell_index !== undefined) {
						if (cell_index < 0 || cell_index >= total_cells) {
							throw new Error(`cell_index ${cell_index} is out of range (valid: 0..${Math.max(0, total_cells - 1)}; notebook has ${total_cells} cells).`)
						}
						return { result: { cells: [allCells[cell_index]] as any, summary_only, total_cells, kernelspec, nbformat: '4.5' } }
					}
					const start = start_cell ?? 0
					const end = end_cell !== undefined ? end_cell : total_cells
					return { result: { cells: allCells.slice(start, end) as any, summary_only, total_cells, kernelspec, nbformat: '4.5' } }
				}
				const fileContent = await fileService.readFile(uri)
				let notebook: any
				try {
					notebook = JSON.parse(fileContent.value.toString())
				} catch (e) {
					throw new Error(`Notebook is not valid JSON.`)
				}
				if (!notebook.cells || !Array.isArray(notebook.cells)) {
					throw new Error(`Notebook has no cells.`)
				}
				const total_cells = notebook.cells.length
				const ks = notebook.metadata?.kernelspec
				const kernelspec = ks ? String(ks.display_name ?? ks.name ?? '') || null : null
				const nbformat = notebook.nbformat !== undefined ? `${notebook.nbformat}.${notebook.nbformat_minor ?? 0}` : '4.5'
				if (cell_index !== undefined) {
					if (cell_index < 0 || cell_index >= total_cells) {
						throw new Error(`cell_index ${cell_index} is out of range (valid: 0..${Math.max(0, total_cells - 1)}; notebook has ${total_cells} cells).`)
					}
					const cell = notebook.cells[cell_index]
					return {
						result: {
							cells: [{
								index: cell_index,
								cell_type: cell.cell_type,
								source: Array.isArray(cell.source) ? cell.source.join('') : cell.source,
								outputs: (cell.outputs || []).map(compactOutputForRead),
								execution_count: cell.execution_count ?? null,
								metadata: cell.metadata || {},
							}] as any,
							summary_only,
							total_cells,
							kernelspec,
							nbformat,
						}
					}
				}
				const start = start_cell ?? 0
				const end = end_cell !== undefined ? end_cell : total_cells
				const sliced = notebook.cells.slice(start, end)
				const outputCells = sliced.map((cell: any, offset: number) => ({
					index: start + offset,
					cell_type: cell.cell_type,
					source: Array.isArray(cell.source) ? cell.source.join('') : cell.source,
					outputs: (cell.outputs || []).map(compactOutputForRead),
					execution_count: cell.execution_count ?? null,
					metadata: cell.metadata || {},
				}))
				return { result: { cells: outputCells, summary_only, total_cells, kernelspec, nbformat } }
			},
			write_notebook: async ({ uri, cells, open_in_editor, execute, kernel_id }) => {
				let pythonVersion = '3.11.0'
				let kernelDisplayName = 'Python 3'
				try {
					const workspaceFolder = workspaceContextService.getWorkspace().folders[0]?.uri.fsPath
					const discovered = await notebookKernelMainService.discoverKernels(workspaceFolder)
					const preferred = discovered.find(k => k.isPreferred) ?? discovered[0]
					if (preferred) {
						pythonVersion = preferred.version || pythonVersion
						kernelDisplayName = preferred.label || kernelDisplayName
					}
				} catch {
					// Use sensible defaults if discovery isn't available
				}
				const notebook = buildNbformatDocument(cells, { pythonVersion, kernelDisplayName })
				await fileService.writeFile(uri, VSBuffer.fromString(JSON.stringify(notebook, null, 2)))
				await syncOpenNotebookFromDisk(uri)

				const shouldOpen = open_in_editor !== false
				const opened = shouldOpen ? await openNotebookInEditor(uri) : false

				let execution_results: any[] | undefined
				if (execute) {
					const execCall = await this.callTool.execute_notebook({
						uri,
						kernel_id,
						open_in_editor: shouldOpen,
					})
					const execData = await execCall.result
					execution_results = execData.results
				}
				return {
					result: {
						uri,
						cell_count: notebook.cells.length,
						opened,
						...(execution_results ? { execution_results } : {}),
					}
				}
			},
			edit_notebook: async ({ uri, operations, open_in_editor }) => {
				// If the notebook is currently open with unsaved execution outputs, flush to disk first
				if (this.notebookService.getNotebookTextModel(uri)) {
					try {
						const resolver = instantiationService.invokeFunction(a => a.get(INotebookEditorModelResolverService))
						const ref = await resolver.resolve(uri, 'jupyter-notebook')
						try {
							if (ref.object.isDirty()) {
								await ref.object.save()
							}
						} finally {
							ref.dispose()
						}
					} catch {
						// best effort
					}
				}
				const fileContent = await fileService.readFile(uri)
				let notebook: NbformatDocument
				try {
					notebook = JSON.parse(fileContent.value.toString())
				} catch (e) {
					throw new Error(`Notebook is not valid JSON.`)
				}
				const history = getNotebookEditHistory(uri)
				const summary = applyNotebookEditOperations(notebook, operations, history)
				if (summary.applied === 0 && summary.failed.length > 0) {
					throw new Error(`edit_notebook failed (${summary.failed.map(f => `[op ${f.op_index} ${f.type}] ${f.error}`).join('; ')})`)
				}
				await fileService.writeFile(uri, VSBuffer.fromString(JSON.stringify(notebook, null, 2)))
				await syncOpenNotebookFromDisk(uri)
				const opened = open_in_editor !== false ? await openNotebookInEditor(uri) : false
				return {
					result: {
						uri,
						applied: summary.applied,
						cell_count: summary.cellCount,
						opened,
						cells_summary: summary.cellsSummary,
						...(summary.failed.length > 0 ? { failed: summary.failed } : {}),
						...(summary.warnings.length > 0 ? { warnings: summary.warnings } : {}),
					}
				}
			},
			execute_notebook_cell: async ({ uri, cell_index, kernel_id, open_in_editor }) => {
				const startTime = Date.now()
				let resolvedRef: { object: { notebook: any; save(): Promise<boolean> }; dispose(): void } | undefined
				try {
					if (open_in_editor !== false) {
						await openNotebookInEditor(uri)
					}
					const resolver = instantiationService.invokeFunction(a => a.get(INotebookEditorModelResolverService))
					resolvedRef = await resolver.resolve(uri, 'jupyter-notebook') as any
					const notebookModel = resolvedRef?.object?.notebook ?? this.notebookService.getNotebookTextModel(uri)
					if (!notebookModel) {
						throw new Error(`Notebook model could not be opened for ${uri.fsPath}. Ensure the file is a valid .ipynb notebook.`)
					}
					if (cell_index < 0 || cell_index >= notebookModel.cells.length) {
						throw new Error(`cell_index ${cell_index} is out of range (valid: 0..${Math.max(0, notebookModel.cells.length - 1)}; notebook has ${notebookModel.cells.length} cells).`)
					}
					const cellModel = notebookModel.cells[cell_index]
					if (!cellModel) throw new Error(`Cell ${cell_index} not found`)

					ensureNotebookKernel(notebookModel, kernel_id)

					const contextKeyService = instantiationService.invokeFunction(a => a.get(IContextKeyService))
					await this.notebookExecutionService.executeNotebookCells(notebookModel, [cellModel], contextKeyService)

					const updatedCell = notebookModel.cells[cell_index]
					const { formattedOutputs, cellError } = formatNotebookCellOutputs(updatedCell?.outputs || [])
					const execution_count = updatedCell?.internalMetadata?.executionOrder ?? null

					// Persist outputs and execution count to disk immediately
					try {
						await resolvedRef?.object?.save()
					} catch {
						// Best-effort save
					}

					const executionTime = Date.now() - startTime
					return {
						result: {
							cell_index,
							outputs: formattedOutputs,
							execution_time: executionTime,
							execution_count,
							success: !cellError,
							...(cellError ? { error: cellError } : {}),
						}
					}
				} catch (e: any) {
					return { result: { cell_index, outputs: [], execution_time: Date.now() - startTime, success: false, error: e?.message ?? String(e) } }
				} finally {
					resolvedRef?.dispose()
				}
			},
			execute_notebook: async ({ uri, kernel_id, cell_indices, start_cell, end_cell, restart_kernel, open_in_editor }) => {
				let resolvedRef: { object: { notebook: any; save(): Promise<boolean> }; dispose(): void } | undefined
				let restarted = false
				let saved = false
				try {
					if (open_in_editor !== false) {
						await openNotebookInEditor(uri)
					}
					if (restart_kernel) {
						await notebookKernelMainService.restartKernel(uri.toString())
						restarted = true
					}
					const resolver = instantiationService.invokeFunction(a => a.get(INotebookEditorModelResolverService))
					resolvedRef = await resolver.resolve(uri, 'jupyter-notebook') as any
					const notebookModel = resolvedRef?.object?.notebook ?? this.notebookService.getNotebookTextModel(uri)
					if (!notebookModel) {
						throw new Error(`Notebook model could not be opened for ${uri.fsPath}. Ensure the file is a valid .ipynb notebook.`)
					}

					ensureNotebookKernel(notebookModel, kernel_id)
					const contextKeyService = instantiationService.invokeFunction(a => a.get(IContextKeyService))

					let codeCellIndices: number[]
					if (cell_indices && cell_indices.length > 0) {
						codeCellIndices = cell_indices
					} else {
						const rangeStart = start_cell !== undefined ? Math.max(0, start_cell) : 0
						const rangeEnd = end_cell !== undefined ? Math.min(notebookModel.cells.length, end_cell) : notebookModel.cells.length
						codeCellIndices = []
						for (let i = rangeStart; i < rangeEnd; i++) {
							if (notebookModel.cells[i]?.cellKind === CellKind.Code) {
								codeCellIndices.push(i)
							}
						}
					}

					const results = []
					for (const idx of codeCellIndices) {
						const startTime = Date.now()
						const cellModel = notebookModel.cells[idx]
						if (!cellModel) {
							results.push({
								cell_index: idx,
								outputs: [],
								execution_time: 0,
								success: false,
								error: `cell_index ${idx} is out of range (valid: 0..${Math.max(0, notebookModel.cells.length - 1)}; notebook has ${notebookModel.cells.length} cells).`,
							})
							continue
						}
						try {
							await this.notebookExecutionService.executeNotebookCells(notebookModel, [cellModel], contextKeyService)
							const updatedCell = notebookModel.cells[idx]
							const { formattedOutputs, cellError } = formatNotebookCellOutputs(updatedCell?.outputs || [])
							results.push({
								cell_index: idx,
								outputs: formattedOutputs,
								execution_time: Date.now() - startTime,
								success: !cellError,
								...(cellError ? { error: cellError } : {}),
							})
						} catch (e: any) {
							results.push({
								cell_index: idx,
								outputs: [],
								execution_time: Date.now() - startTime,
								success: false,
								error: e?.message ?? String(e),
							})
						}
					}

					// Persist all outputs and execution counts cleanly to disk
					try {
						saved = await resolvedRef?.object?.save() ?? false
					} catch {
						saved = false
					}

					return { result: { results, restarted, saved } }
				} finally {
					resolvedRef?.dispose()
				}
			},
			restart_notebook_kernel: async ({ uri, run_all, kernel_id }) => {
				await notebookKernelMainService.restartKernel(uri.toString())
				if (run_all) {
					const execCall = await this.callTool.execute_notebook({
						uri,
						kernel_id,
						restart_kernel: false,
						open_in_editor: true,
					})
					const execData = await execCall.result
					return { result: { restarted: true, execution_results: execData.results, saved: execData.saved } }
				}
				return { result: { restarted: true } }
			},
			interrupt_notebook_kernel: async ({ uri }) => {
				await notebookKernelMainService.interruptKernel(uri.toString())
				return { result: { interrupted: true } }
			},
			search_notebook: async ({ uri, query, is_regex, case_sensitive, cell_type, include_outputs, from_cell_index, direction, select_match_index }) => {
				const openModel = this.notebookService.getNotebookTextModel(uri)
				let notebookDoc: NbformatDocument
				if (openModel) {
					notebookDoc = {
						nbformat: 4,
						nbformat_minor: 5,
						metadata: openModel.metadata || {},
						cells: openModel.cells.map((cell: any) => {
							const { formattedOutputs } = formatNotebookCellOutputs(cell.outputs || [])
							return {
								cell_type: cell.cellKind === CellKind.Markup ? 'markdown' : 'code',
								metadata: cell.metadata || {},
								source: cell.getValue().split('\n'),
								...(cell.cellKind === CellKind.Code ? { outputs: formattedOutputs, execution_count: cell.internalMetadata?.executionOrder ?? null } : {}),
							}
						}),
					}
				} else {
					const fileContent = await fileService.readFile(uri)
					notebookDoc = JSON.parse(fileContent.value.toString()) as NbformatDocument
				}
				const searchRes = searchNotebookDocument(notebookDoc, {
					query,
					isRegex: is_regex,
					caseSensitive: case_sensitive,
					cellType: cell_type,
					includeOutputs: include_outputs,
					fromCellIndex: from_cell_index,
					direction,
				})
				let selected_cell_index: number | undefined
				if (select_match_index !== undefined && searchRes.matches[select_match_index]) {
					selected_cell_index = searchRes.matches[select_match_index].cell_index
					try {
						const editorService = instantiationService.invokeFunction(a => a.get(IEditorService))
						const pane = await editorService.openEditor({
							resource: uri,
							options: { override: 'jupyter-notebook', preserveFocus: true, pinned: true },
						}) as any
						const nbEditor = pane?.getControl?.()
						const targetCell = nbEditor?.cellAt?.(selected_cell_index)
						if (targetCell && nbEditor?.focusElement) {
							nbEditor.focusElement(targetCell)
							nbEditor.revealInCenterIfOutsideViewport?.(targetCell)
						}
					} catch {
						// Best-effort cell focus in UI
					}
				}
				return {
					result: {
						matches: searchRes.matches,
						total_matches: searchRes.total_matches,
						...(selected_cell_index !== undefined ? { selected_cell_index } : {}),
					}
				}
			},
			validate_notebook: async ({ uri }) => {
				if (this.notebookService.getNotebookTextModel(uri)) {
					try {
						const resolver = instantiationService.invokeFunction(a => a.get(INotebookEditorModelResolverService))
						const ref = await resolver.resolve(uri, 'jupyter-notebook')
						try {
							if (ref.object.isDirty()) {
								await ref.object.save()
							}
						} finally {
							ref.dispose()
						}
					} catch {
						// best effort
					}
				}
				const fileContent = await fileService.readFile(uri)
				let parsed: unknown
				try {
					parsed = JSON.parse(fileContent.value.toString())
				} catch (e) {
					return {
						result: {
							valid: false,
							nbformat: 'invalid-json',
							has_kernelspec: false,
							kernelspec_name: null,
							cell_count: 0,
							code_cells: 0,
							markdown_cells: 0,
							executed_cells: 0,
							issues: [{ severity: 'error' as const, message: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` }],
						}
					}
				}
				return { result: validateNotebookDocument(parsed) }
			},
			select_notebook_kernel: async ({ uri, kernel_id }): Promise<{ result: { kernel_id: string } }> => {
				let resolvedRef: { object: { notebook: any }; dispose(): void } | undefined
				try {
					let notebookModel = this.notebookService.getNotebookTextModel(uri)
					if (!notebookModel) {
						const resolver = instantiationService.invokeFunction(a => a.get(INotebookEditorModelResolverService))
						resolvedRef = await resolver.resolve(uri, 'jupyter-notebook') as any
						notebookModel = resolvedRef?.object?.notebook
					}
					if (!notebookModel) throw new Error('Notebook model not found')

					const matchResult = this.notebookKernelService.getMatchingKernel(notebookModel)
					const allKernels = [
						...(matchResult.selected ? [matchResult.selected] : []),
						...(matchResult.suggestions || []),
						...(matchResult.all || []),
					]
					const matched = allKernels.find(k => k.id === kernel_id || k.label === kernel_id) ?? allKernels[0]
					if (matched) {
						this.notebookKernelService.selectKernelForNotebook(matched, notebookModel)
					}

					const metadata = { ...notebookModel.metadata }
					const existingKernelSpec = (metadata.kernelspec as Record<string, unknown>) || {}
					metadata.kernelspec = {
						...existingKernelSpec,
						name: matched?.id ?? kernel_id,
						display_name: matched?.label ?? kernel_id,
						language: 'python'
					}
					notebookModel.metadata = metadata

					return { result: { kernel_id: matched?.id ?? kernel_id } }
				} finally {
					resolvedRef?.dispose()
				}
			},
			list_notebook_kernels: async ({ uri }) => {
				const openModel = uri ? this.notebookService.getNotebookTextModel(uri) : undefined
				const target = openModel ?? { uri: uri ?? URI.file('/notebook.ipynb'), notebookType: 'jupyter-notebook' }
				const matchResult = this.notebookKernelService.getMatchingKernel(target)
				const allKernels = [
					...(matchResult.selected ? [matchResult.selected] : []),
					...(matchResult.suggestions || []),
					...(matchResult.all || []),
					...(matchResult.hidden || [])
				]
				const uniqueKernels = new Map<string, any>()
				for (const k of allKernels) {
					if (!uniqueKernels.has(k.id)) {
						uniqueKernels.set(k.id, k)
					}
				}
				const kernelInfos = Array.from(uniqueKernels.values()).map((k: any) => ({
					id: k.id,
					name: k.label,
					description: k.description,
					supported_languages: k.supportedLanguages,
					is_preferred: Boolean(matchResult.selected?.id === k.id || k.isPreferred)
				}))
				return { result: { kernels: kernelInfos } }
			},

		}


		const nextPageStr = (hasNextPage: boolean) => hasNextPage ? '\n\n(more on next page...)' : ''

		const stringifyLintErrors = (lintErrors: LintErrorItem[]) => {
			return lintErrors
				.map((e, i) => `Error ${i + 1}:\nLines Affected: ${e.startLineNumber}-${e.endLineNumber}\nError message:${e.message}`)
				.join('\n\n')
				.substring(0, MAX_FILE_CHARS_PAGE)
		}

		const formatTestResult = (r: { state: string; label: string; message?: string; stackTrace?: string; uri?: string; line?: number; duration?: number }): string => {
			const lines: string[] = []
			const stateIcon = r.state === 'passed' ? '✅' : r.state === 'failed' || r.state === 'errored' ? '❌' : '⏭️'
			lines.push(`${stateIcon} ${r.label}`)
			if (r.message) lines.push(`   Message: ${r.message}`)
			if (r.stackTrace) lines.push(`   Stack: ${r.stackTrace.split('\n').slice(0, 3).join('\n   ')}`)
			if (r.uri) lines.push(`   File: ${r.uri}${r.line !== undefined ? `:${r.line}` : ''}`)
			if (r.duration !== undefined) lines.push(`   Duration: ${r.duration}ms`)
			return lines.join('\n')
		}

		const _formatTestResults = (results: TestRunResultData): string => {
			const { passed, failed, skipped, errored, total, duration, completed, testResults } = results
			const lines: string[] = []
			if (total === 0) {
				// never let "nothing ran" read like a pass
				lines.push(`NO TESTS WERE RUN. ${results.note ?? ''}`.trim())
			} else {
				lines.push(`Test run ${completed ? 'completed' : 'DID NOT COMPLETE'}${results.source === 'command' ? ` (${results.framework}, exit code ${results.exitCode ?? 'none'})` : results.source === 'vscode' ? ' (VS Code test controller)' : ''}`)
				lines.push(`Results: ${passed} passed, ${failed} failed${errored ? ` (${errored} errored)` : ''}, ${skipped} skipped (${total} total)`)
				if (results.note) lines.push(`Note: ${results.note}`)
			}
			if (results.history) {
				const h = results.history
				if (h.newlyFailing.length) lines.push(`REGRESSION — passed in the previous run, fail now: ${h.newlyFailing.join('; ')}`)
				if (h.fixed.length) lines.push(`Fixed since the previous run: ${h.fixed.join('; ')}`)
				if (h.knownFlaky.length) lines.push(`Known flaky (has passed and failed on the same code before): ${h.knownFlaky.join('; ')}`)
			}
			if (results.coverage) {
				const c = results.coverage
				lines.push(`Coverage: lines ${c.linePercent ?? 'n/a'}% (${c.linesHit}/${c.linesFound})${c.branchesFound ? `, branches ${c.branchPercent}% (${c.branchesHit}/${c.branchesFound})` : ''} over ${c.files.length} file(s)`)
				for (const f of c.files.slice(0, 25)) lines.push(`  ${f.file}: ${f.linePercent ?? 'n/a'}% (${f.linesHit}/${f.linesFound})${f.uncoveredRanges ? ` — uncovered lines ${f.uncoveredRanges}` : ''}`)
				if (c.files.length > 25) lines.push(`  ... and ${c.files.length - 25} more files`)
				if (c.notInReport.length) lines.push(`Not loaded by any test (0% coverage): ${c.notInReport.join(', ')}`)
			}
			if (results.command) lines.push(`Command: ${results.command}`)
			if (duration !== undefined) lines.push(`Duration: ${duration}ms`)
			// failures first, with their messages: that is what the agent acts on
			const ordered = [...testResults].sort((a, b) => Number(a.state === 'passed' || a.state === 'skipped') - Number(b.state === 'passed' || b.state === 'skipped'))
			if (ordered.length > 0) {
				lines.push('\nTest details:')
				for (const r of ordered.slice(0, 30)) lines.push(formatTestResult(r))
				if (ordered.length > 30) lines.push(`\n... and ${ordered.length - 30} more tests`)
			}
			if (total === 0 && results.outputTail) lines.push(`\nRunner output (tail):\n${results.outputTail}`)
			return lines.join('\n')
		}

		// given to the LLM after the call for successful tool calls
		this.stringOfResult = {
			read_file: (params, result) => {
				const baseLine = params.startLine ?? 1
				const rawLines = result.fileContents.split('\n')
				const numbered = rawLines.map((ln, idx) => `${baseLine + idx}| ${ln}`).join('\n')
				const endLineShown = baseLine + rawLines.length - 1
				const header = `${params.uri.fsPath} (showing lines ${baseLine}-${endLineShown} of ${result.totalNumLines})`
				return `${header}\n\`\`\`\n${numbered}\n\`\`\`${nextPageStr(result.hasNextPage)}${result.hasNextPage ? `\nMore info because truncated: this file has ${result.totalNumLines} lines, or ${result.totalFileLen} characters.` : ''}`
			},
			ls_dir: (params, result) => {
				const dirTreeStr = stringifyDirectoryTree1Deep(params, result)
				return dirTreeStr // + nextPageStr(result.hasNextPage) // already handles num results remaining
			},
			get_dir_tree: (params, result) => {
				return result.str
			},
			search_pathnames_only: (params, result) => {
				return result.uris.map(uri => uri.fsPath).join('\n') + nextPageStr(result.hasNextPage)
			},
			search_for_files: (params, result) => {
				if (result.matches && result.matches.length > 0) {
					const byFile = new Map<string, Array<{ line: number; preview: string }>>()
					for (const m of result.matches) {
						const key = m.uri.fsPath
						const list = byFile.get(key) ?? []
						list.push({ line: m.line, preview: m.preview })
						byFile.set(key, list)
					}
					const out: string[] = []
					for (const uri of result.uris) {
						const hits = byFile.get(uri.fsPath)
						if (hits && hits.length > 0) {
							out.push(uri.fsPath)
							for (const h of hits) {
								out.push(`  L${h.line}: ${h.preview}`)
							}
						} else {
							out.push(uri.fsPath)
						}
					}
					return out.join('\n') + nextPageStr(result.hasNextPage)
				}
				return result.uris.map(uri => uri.fsPath).join('\n') + nextPageStr(result.hasNextPage)
			},
			search_in_file: (params, result) => {
				const { model } = voidModelService.getModel(params.uri)
				if (!model) return '<Error getting string of result>'
				if (result.lines.length === 0) return `No matches found in ${params.uri.fsPath}.`
				const totalLines = model.getLineCount()
				const prefix = result.caseInsensitiveFallback ? '(matched case-insensitively)\n' : ''
				const blocks = result.lines.slice(0, 60).map(n => {
					const start = Math.max(1, n - 1)
					const end = Math.min(totalLines, n + 1)
					const ctx: string[] = []
					for (let ln = start; ln <= end; ln++) {
						const text = model.getLineContent(ln)
						ctx.push(`${ln === n ? '>' : ' '} L${ln}: ${text}`)
					}
					return ctx.join('\n')
				}).join('\n---\n');
				const tail = result.lines.length > 60 ? `\n... (${result.lines.length - 60} more matching lines)` : ''
				return `${prefix}${blocks}${tail}`;
			},
			go_to_definition: (params, result) => {
				if (!result.hasLanguageServer) return noLanguageServerMessage('definitions for this file type')
				if (result.locations.length === 0) return `No definition found for "${params.symbol}".`
				return result.locations.map(l => `${l.uri.fsPath}:${l.line}\n\`\`\`\n${l.snippet}\n\`\`\``).join('\n\n')
			},
			find_references: (params, result) => {
				if (!result.hasLanguageServer) return noLanguageServerMessage('references for this file type')
				if (result.locations.length === 0) return `No references found for "${params.symbol}".`

				// grouped by file, in the language server's order
				const linesOfFile = new Map<string, string[]>()
				for (const l of result.locations) {
					const lines = linesOfFile.get(l.uri.fsPath) ?? []
					lines.push(`  ${l.line}: ${l.snippet.trim()}`)
					linesOfFile.set(l.uri.fsPath, lines)
				}
				const str = [...linesOfFile].map(([fsPath, lines]) => `${fsPath}\n${lines.join('\n')}`).join('\n\n')
				const truncated = result.totalCount > result.locations.length ? `\n\n(Showing ${result.locations.length} of ${result.totalCount} references.)` : ''
				return str + truncated
			},
			search_symbols: (params, result) => {
				if (!result.hasLanguageServer) return noLanguageServerMessage('workspace symbols')
				if (result.symbols.length === 0) return `No symbols match "${params.query}". The language server may not have loaded the project yet (reading one of its files helps) — or use search_for_files.`

				const str = result.symbols.map(s => {
					const where = s.line ? `${s.uri.fsPath}:${s.line}` : s.uri.fsPath
					return `${s.name} (${s.kind}${s.containerName ? `, in ${s.containerName}` : ''}) — ${where}`
				}).join('\n')
				const truncated = result.totalCount > result.symbols.length ? `\n\n(Showing ${result.symbols.length} of ${result.totalCount} symbols. Use a more specific query to narrow it down.)` : ''
				return str + truncated
			},
			read_lint_errors: (params, result) => {
				return result.lintErrors ?
					stringifyLintErrors(result.lintErrors)
					: 'No lint errors found.'
			},
			read_project_memory: (params, result) => {
				return result.content || 'No project memory stored yet.'
			},
			fetch_url: (params, result) => {
				const header = `${result.title ? `${result.title}\n` : ''}${result.url}${result.url !== params.url ? ` (redirected from ${params.url})` : ''}`
				const content = result.content || (params.pageNumber > 1 ? '(No content on this page.)' : '(The page has no text. It may need JavaScript to render.)')
				const truncated = result.hasNextPage ? `${nextPageStr(true)}\nMore info because truncated: this page has ${result.totalLen} characters.` : ''
				return `${header}\n\n${content}${truncated}`
			},

			web_search: (params, result) => {
				if (!result.results || result.results.length === 0) {
					return 'No results found for the search query.'
				}
				// Filter out results with empty titles or URLs (should not happen after normalization, but defensive)
				const validResults = result.results.filter(r => r.title && r.title.trim().length > 0 && r.url && r.url.trim().length > 0)
				if (validResults.length === 0) {
					return 'No results found for the search query.'
				}
				const lines = validResults.map((r, i) => {
					const date = r.publishedDate ? ` (${r.publishedDate})` : ''
					const snippet = r.snippet && r.snippet.trim().length > 0 ? r.snippet : '(no description available)'
					return `${i + 1}. ${r.title}\n${r.url}${date}\n${snippet}`
				})
				return lines.join('\n\n')
			},

			// --- Browser automation ---
			browser_launch: (_params, result) => {
				return `Browser launched (session ${result.sessionId}, ${result.engine}, headless=${result.headless}, v${result.version}).`
			},
			browser_close: () => 'Browser session closed.',
			browser_list_sessions: (_params, result) => {
				if (result.sessions.length === 0) return 'No active browser sessions.'
				return result.sessions.map(s => `Session ${s.sessionId}: ${s.engine} headless=${s.headless}, tabs=${s.tabCount}`).join('\n')
			},
			browser_new_tab: (_params, result) => `Opened tab ${result.tabId}: ${formatBrowserPage(result)}`,
			browser_list_tabs: (_params, result) => {
				if (result.tabs.length === 0) return 'No open tabs.'
				return result.tabs.map(t => {
					const active = t.isActive ? ' (active)' : ''
					const load = t.loading ? ' loading' : ''
					const err = t.loadError ? ` [load error: ${t.loadError}]` : ''
					return `Tab ${t.tabId}: ${t.url}${active}${load}${err}${t.title ? ` — ${t.title}` : ''}`
				}).join('\n')
			},
			browser_switch_tab: (_params, result) => `Switched to tab ${result.tabId} (${result.url}).`,
			browser_close_tab: () => 'Tab closed.',
			browser_navigate: (_params, result) => `Navigated to ${formatBrowserPage(result)}`,
			browser_back: (_params, result) => `Went back to ${formatBrowserPage(result)}`,
			browser_forward: (_params, result) => `Went forward to ${formatBrowserPage(result)}`,
			browser_reload: (_params, result) => `Reloaded ${formatBrowserPage(result)}`,
			browser_inspect_page: (_params, result) => formatBrowserInspection(result),
			browser_click_element: (_params, result) => result.navigated ? `Element clicked; the page navigated to ${formatBrowserPage(result)}` : `Element clicked (no navigation; still on ${result.url}).`,
			browser_fill_element: () => 'Element filled.',
			browser_select_option: () => 'Option selected.',
			browser_check_element: () => 'Element check state changed.',
			browser_submit_form: (_params, result) => result.navigated ? `Form submitted; the page navigated to ${formatBrowserPage(result)}` : `Form submitted (no navigation; still on ${result.url}).`,
			browser_wait_for_element: (_params, result) => result.found ? 'Element found.' : 'Element not found within the timeout.',
			browser_set_viewport: (_params, result) => `Viewport resized to ${result.width}x${result.height}.`,
			// the model only receives this text, not the image: say so, and point at what it can read instead
			browser_screenshot: (_params, result) => `Screenshot captured (${result.type}, ${result.width}x${result.height}) and saved to ${result.path}. The image itself is not part of this result; use browser_inspect_page for the page's text, controls and measured layout problems.`,
			browser_console: (_params, result) => {
				if (!result.messages || result.messages.length === 0) return 'No console messages.'
				return result.messages.map(m => `[${m.level}] ${m.text}`).join('\n')
			},
			browser_network_failures: (_params, result) => {
				if (!result.failures || result.failures.length === 0) return 'No network failures.'
				return result.failures.map(f => `[${f.type}] ${f.url} — ${f.errorText}`).join('\n')
			},
			browser_download: (_params, result) => {
				const status = result.status === 'completed' && result.path ? `saved to ${result.path}` : result.failureText || result.status
				return `Download ${result.downloadId} (${result.suggestedFilename}): ${result.status} — ${status}`
			},
			browser_list_downloads: (_params, result) => {
				if (!result.downloads || result.downloads.length === 0) return 'No downloads.'
				return result.downloads.map(d => `  ${d.downloadId}: ${d.suggestedFilename} — ${d.status}${d.path ? ` (${d.path})` : ''}${d.failureText ? ` [${d.failureText}]` : ''}`).join('\n')
			},
			browser_shutdown: () => 'Browser automation service shut down. All sessions closed.',

			// --- Autonomous dev cycle tools ---
			dep_install: (_params, result) => {
				const { command, cwd, success, output, exit_code } = result
				const status = success ? 'SUCCESS' : `FAILED (exit ${exit_code})`
				const outputPreview = output.length > 300 ? output.slice(0, 300) + '...' : output
				return `dep_install: ${status}\nCommand: ${command}\nCWD: ${cwd}\nOutput:\n${outputPreview}`
			},
			db_migrate: (_params, result) => {
				const { command, cwd, success, output, exit_code } = result
				const status = success ? 'SUCCESS' : `FAILED (exit ${exit_code})`
				const outputPreview = output.length > 300 ? output.slice(0, 300) + '...' : output
				return `db_migrate: ${status}\nCommand: ${command}\nCWD: ${cwd}\nOutput:\n${outputPreview}`
			},
			lint_run: (_params, result) => {
				const { command, cwd, success, output, errors_found } = result
				const status = success ? 'PASS' : `FAIL (${errors_found} errors)`
				const outputPreview = output.length > 300 ? output.slice(0, 300) + '...' : output
				return `lint_run: ${status}\nCommand: ${command}\nCWD: ${cwd}\nErrors found: ${errors_found}\nOutput:\n${outputPreview}`
			},
			log_read: (_params, result) => {
				const { path, lines, content } = result
				return `log_read: ${path} (${lines} lines)\n${content}`
			},
			autonomous_dev_cycle: (_params, result) => {
				const { project_type, cycles_run, success, final_status, errors_fixed, files_created, url } = result
				const status = success ? 'SUCCESS' : 'WARNINGS'
				return `autonomous_dev_cycle: ${status}\nProject type: ${project_type}\nCycles run: ${cycles_run}\nErrors fixed: ${errors_fixed}\nFiles created: ${files_created}\nFinal status: ${final_status}\nURL: ${url ?? 'N/A'}`
			},

			// --- Code Index & Semantic Search ---
			code_index: (_params, result) => formatIndexStats(result),
			code_index_file: (_params, result) => result.indexed ? `Indexed ${result.filePath}.` : `${result.filePath} was not indexed (missing, binary, too large, or over the index limits).`,
			code_semantic_search: (_params, result) => formatCodeSearch(result),
			code_hybrid_search: (_params, result) => formatCodeSearch(result),
			code_keyword_search: (_params, result) => formatLiteralSearch(result),
			code_index_stats: (_params, result) => formatIndexStats(result),
			code_index_clear: (_params, result) => {
				return `Code index cleared.`
			},

			// --- Dev server automation ---
			dev_server_start: (_params, result) => {
				const { name, terminal_id, command, cwd, port, url } = result
				const portStr = port ? ` on port ${port}` : ''
				const urlStr = url ? ` (${url})` : ''
				return `Started dev server "${name}"${portStr}${urlStr}\nCommand: ${command}\nCWD: ${cwd}\nTerminal ID: ${terminal_id}`
			},
			dev_server_stop: (_params, result) => {
				return `Stopped dev server "${result.name}".`
			},
			dev_server_list: (_params, result) => {
				const { servers } = result
				if (servers.length === 0) return 'No dev servers running.'
				return servers.map(s => {
					const status = s.running ? 'running' : 'stopped'
					const urlStr = s.url ? ` → ${s.url}` : ''
					return `  ${s.name} [${status}]${urlStr} (terminal: ${s.terminal_id})`
				}).join('\n')
			},
			dev_server_status: (_params, result) => {
				const { name, running, url } = result
				const status = running ? 'running' : 'stopped'
				const urlStr = url ? ` at ${url}` : ''
				return `Dev server "${name}" is ${status}${urlStr}`
			},
			// --- Direct API testing ---
			api_request: (_params, result) => {
				const { status, status_text, method, url, elapsed_ms, body_type, body } = result
				const bodyPreview = body.length > 200 ? body.slice(0, 200) + '...' : body
				return `${method} ${url} → ${status} ${status_text} (${elapsed_ms}ms)\nContent-Type: ${body_type}\nBody: ${bodyPreview}`
			},
			port_check: (_params, result) => {
				const { port, in_use, process } = result
				const status = in_use ? 'IN USE' : 'free'
				const procStr = process ? ` (${process})` : ''
				return `Port ${port}: ${status}${procStr}`
			},
			// Cookie management
			api_get_cookies: (_params, result) => {
				const { cookies } = result
				if (cookies.length === 0) return 'No cookies stored.'
				return `Stored cookies (${cookies.length}):\n${cookies.map(c => `  ${c.name}=${c.value} (${c.domain}${c.path})`).join('\n')}`
			},
			api_set_cookies: (_params, result) => {
				return `Set ${result.count} cookie(s) in jar.`
			},
			api_add_cookie: (_params, result) => {
				return `Added 1 cookie to jar.`
			},
			api_clear_cookies: (_params, result) => {
				return `Cleared ${result.cleared} cookie(s) from jar.`
			},
			// OAuth2
			oauth2_generate_auth_url: (_params, result) => {
				return `OAuth2 authorization URL:\n${result.url}\nState: ${result.state}\nCode verifier: ${result.code_verifier ?? 'N/A'}`
			},
			oauth2_exchange_code: (_params, result) => {
				return `OAuth2 tokens obtained:\nAccess token: ${result.access_token}\nRefresh token: ${result.refresh_token ?? 'none'}\nExpires in: ${result.expires_in ?? 'unknown'}s\nToken type: ${result.token_type}\nScope: ${result.scope ?? 'none'}\nCreated at: ${result.created_at ?? 'unknown'}`
			},
			oauth2_refresh_token: (_params, result) => {
				return `OAuth2 token refreshed:\nAccess token: ${result.access_token}\nRefresh token: ${result.refresh_token ?? 'none'}\nExpires in: ${result.expires_in ?? 'unknown'}s\nToken type: ${result.token_type}\nScope: ${result.scope ?? 'none'}\nCreated at: ${result.created_at ?? 'unknown'}`
			},

			// --- Debugger automation ---
			debug_list_configurations: (_params, result) => {
				if (result.configurations.length === 0) return 'No debug configurations found.'
				return result.configurations.map(c => `${c.name} [${c.type}, ${c.request}]${c.folder ? ` (${c.folder})` : ''}`).join('\n')
			},
			debug_list_sessions: (_params, result) => {
				if (result.sessions.length === 0) return 'No active debug sessions.'
				return result.sessions.map(s => `Session ${s.sessionId}: ${s.name} [${s.type}, ${s.request}] state=${s.state}`).join('\n')
			},
			debug_get_session_status: (_params, result) => {
				return `Session ${result.sessionId}: ${result.name}\nType: ${result.type} (${result.request})\nState: ${result.state}${result.folder ? `\nFolder: ${result.folder}` : ''}`
			},
			debug_start_session: (_params, result) => `Started debug session ${result.sessionId}: ${result.name} [${result.type}, ${result.request}]\n${formatDebugStop(result.stop)}`,
			debug_attach_session: (_params, result) => `Attached debug session ${result.sessionId}: ${result.name} [${result.type}, ${result.request}]\n${formatDebugStop(result.stop)}`,
			debug_stop_session: () => 'Debug session stopped.',
			debug_restart_session: () => 'Debug session restarted.',
			debug_set_breakpoint: (_params, result) => {
				const v = result.verified ? 'verified' : 'UNVERIFIED';
				return `Breakpoint ${result.id} at ${result.uri}:${result.lineNumber} (${v}, ${result.enabled ? 'enabled' : 'disabled'})`;
			},
			debug_remove_breakpoint: () => 'Breakpoint removed.',
			debug_set_breakpoint_enabled: (_params, result) => 'Breakpoint enabled state updated.',
			debug_list_breakpoints: (_params, result) => {
				const lines = result.breakpoints.length === 0 ? ['No breakpoints.'] : result.breakpoints.map(b => {
					const extra = [b.condition && `condition: ${b.condition}`, b.hitCondition && `hit count: ${b.hitCondition}`, b.logMessage && `logpoint: ${b.logMessage}`].filter(Boolean).join(', ')
					return `  ${b.id}: ${b.uri}:${b.lineNumber} (${b.enabled ? 'enabled' : 'disabled'}, ${b.verified ? 'verified' : 'unverified'}${extra ? `, ${extra}` : ''})`
				})
				if (result.exceptionBreakpoints.length) lines.push(formatExceptionFilters(result.exceptionBreakpoints))
				return lines.join('\n')
			},
			debug_set_exception_breakpoints: (_params, result) => formatExceptionFilters(result.exceptionBreakpoints),
			debug_continue: (_params, result) => formatDebugStop(result),
			debug_pause: (_params, result) => formatDebugStop(result),
			debug_step_over: (_params, result) => formatDebugStop(result),
			debug_step_into: (_params, result) => formatDebugStop(result),
			debug_step_out: (_params, result) => formatDebugStop(result),
			debug_list_threads: (_params, result) => {
				if (result.threads.length === 0) return 'No threads.'
				return result.threads.map(t => `Thread ${t.threadId}: ${t.name} (${t.stateLabel}, ${t.stopped ? 'stopped' : 'running'})`).join('\n')
			},
			debug_get_stack_trace: (_params, result) => {
				const lines = [`Stack trace (${result.frames.length} of ${result.totalFrames} frames):`];
				for (const f of result.frames) {
					const loc = f.sourcePath ? `${f.sourceName || f.sourcePath}:${f.line}:${f.column}` : '<no source>';
					lines.push(`  Frame ${f.frameId}: ${f.name} — ${loc}`);
				}
				return lines.join('\n');
			},
			debug_get_scopes: (_params, result) => {
				if (result.scopes.length === 0) return 'No scopes.'
				return result.scopes.map(s => `Scope ${s.name} (ref=${s.variablesReference}, ${s.expensive ? 'expensive' : 'cheap'}, ${s.hasChildren ? 'has children' : 'no children'})`).join('\n')
			},
			debug_get_variables: (_params, result) => {
				if (result.variables.length === 0) return 'No variables.'
				return result.variables.map(v => {
					const kids = v.hasChildren ? ` (ref=${v.variablesReference})` : '';
					return `  ${v.name} = ${v.value}${kids} [${v.type}]`;
				}).join('\n')
			},
			debug_evaluate_expression: (_params, result) => {
				const kids = result.hasChildren ? ` (ref=${result.variablesReference})` : '';
				return `Result: ${result.result}\nType: ${result.type}${kids}`;
			},
			debug_get_exception_info: (_params, result) => {
				const lines = [`Exception info:`];
				if (result.id) lines.push(`  Id: ${result.id}`);
				if (result.description) lines.push(`  Description: ${result.description}`);
				lines.push(`  Break mode: ${result.breakMode}`);
				return lines.join('\n');
			},
			debug_get_console_output: (_params, result) => {
				if (!result.output || result.output.length === 0) return 'No console output.';
				return result.output.map(o => `[${o.sessionId.slice(0, 8)}] ${o.text}`).join('\n');
			},

			// ---
			create_file_or_folder: (params, result) => {
				return `URI ${params.uri.fsPath} successfully created.`
			},
			delete_file_or_folder: (params, result) => {
				return `URI ${params.uri.fsPath} successfully deleted.`
			},
			edit_file: (params, result) => {
				const lintErrsString = (
					this.voidSettingsService.state.globalSettings.includeToolLintErrors ?
						(result.lintErrors ? ` Lint errors found after change:\n${stringifyLintErrors(result.lintErrors)}.\nIf this is related to a change made while calling this tool, you might want to fix the error.`
							: ` No lint errors found.`)
						: '')

				return `Change successfully made to ${params.uri.fsPath}.${lintErrsString}`
			},
			rewrite_file: (params, result) => {
				const lintErrsString = (
					this.voidSettingsService.state.globalSettings.includeToolLintErrors ?
						(result.lintErrors ? ` Lint errors found after change:\n${stringifyLintErrors(result.lintErrors)}.\nIf this is related to a change made while calling this tool, you might want to fix the error.`
							: ` No lint errors found.`)
						: '')

				return `Change successfully made to ${params.uri.fsPath}.${lintErrsString}`
			},
			write_file: (params, result) => {
				const lintErrsString = (
					this.voidSettingsService.state.globalSettings.includeToolLintErrors ?
						(result.lintErrors ? ` Lint errors found after change:\n${stringifyLintErrors(result.lintErrors)}.\nIf this is related to a change made while calling this tool, you might want to fix the error.`
							: ` No lint errors found.`)
						: '')

				return `Change successfully made to ${params.uri.fsPath}.${lintErrsString}`
			},
			write_project_memory: (params, result) => {
				const action = params.content.trim() ? `Section "${params.section}" saved` : `Section "${params.section}" deleted`
				const nearLimit = result.tokenCount > MAX_PROJECT_MEMORY_TOKENS * 0.8
					? ` That's close to the ~${MAX_PROJECT_MEMORY_TOKENS}-token limit: condense or delete outdated sections soon.` : ''
				return `${action}. The project memory is now ${result.tokenCount} tokens.${nearLimit}`
			},
			run_command: (params, result) => {
				const { resolveReason, result: result_, } = result
				// success
				if (resolveReason.type === 'done') {
					return `${result_}\n(exit code ${resolveReason.exitCode})`
				}
				// normal command
				if (resolveReason.type === 'timeout') {
					return `${result_}\nTerminal command ran, but was automatically killed by Kodia after ${MAX_TERMINAL_INACTIVE_TIME}s of inactivity and did not finish successfully. To try with more time, open a persistent terminal and run the command there.`
				}
				throw new Error(`Unexpected internal error: Terminal command did not resolve with a valid reason.`)
			},

			run_persistent_command: (params, result) => {
				const { resolveReason, result: result_, } = result
				const { persistentTerminalId } = params
				// success
				if (resolveReason.type === 'done') {
					return `${result_}\n(exit code ${resolveReason.exitCode})`
				}
				// bg command
				if (resolveReason.type === 'timeout') {
					return `${result_}\nTerminal command is running in terminal ${persistentTerminalId}. The given outputs are the results after ${MAX_TERMINAL_BG_COMMAND_TIME} seconds.`
				}
				throw new Error(`Unexpected internal error: Terminal command did not resolve with a valid reason.`)
			},

			open_persistent_terminal: (_params, result) => {
				const { persistentTerminalId } = result;
				return `Successfully created persistent terminal. persistentTerminalId="${persistentTerminalId}"`;
			},
			kill_persistent_terminal: (params, _result) => {
				return `Successfully closed terminal "${params.persistentTerminalId}".`;
			},

			// Terminal session management (Stage 5A Day 1)
			list_terminals: (_params, result) => {
				const { terminals } = result
				if (terminals.length === 0) return 'No terminals found.'
				return terminals.map(t => {
					const status = t.exitCode !== undefined ? `exited (${t.exitCode})` : (t.processId !== undefined ? 'running' : 'unknown')
					const cwdStr = t.cwd ?? '(default)'
					return `Terminal ${t.terminalId} [${t.type}] ${status} cwd="${cwdStr}" title="${t.title}"`
				}).join('\n')
			},
			read_terminal: (_params, result) => {
				const { output, isAtEnd } = result
				if (!output) return isAtEnd ? '(no new output, terminal idle)' : '(no new output)'
				return `${output}${isAtEnd ? '' : '\n...(more output available, call read_terminal again)'}`
			},
			send_command_to_terminal: (_params, result) => {
				return result.result
			},
			interrupt_terminal: (_params, _result) => {
				return 'Sent interrupt (Ctrl+C) to terminal.'
			},
			close_terminal: (_params, _result) => {
				return 'Terminal closed.'
			},

			// Task plan management (Stage 5A Day 2)
			create_task_plan: (_params, result) => {
				const { plan } = result
				return `Created task plan ${plan.title} with ${plan.tasks.length} tasks.`;
			},
			update_task_plan: (_params, result) => {
				const { plan } = result
				const { completed, total, percent } = getPlanProgress(plan)
				return `Updated task plan ${plan.title}. Progress: ${percent}% (${completed}/${total} tasks). Overall: ${plan.overallStatus}.`;
			},
			get_task_plan: (_params, result) => {
				const { plan } = result
				if (!plan) return 'No task plan exists yet. Use create_task_plan to create one.';
				return formatTaskPlanForLLM(plan)
			},

			// Git operations (Stage 2)
			git_status: (_params, result) => {
				const { status } = result
				const lines: string[] = []
				lines.push(`Repository: ${status.rootUri}`)
				lines.push(`Branch: ${status.branch ?? '(none)'}`)
				if (status.upstream) lines.push(`Upstream: ${status.upstream} (ahead ${status.ahead ?? 0}, behind ${status.behind ?? 0})`)
				lines.push(`Staged: ${status.staged.length}, Unstaged: ${status.unstaged.length}, Untracked: ${status.untracked.length}`)
				if (status.conflicted.length > 0) lines.push(`Conflicted: ${status.conflicted.length}`)
				if (status.operationInProgress) lines.push(`${status.operationInProgress[0].toUpperCase()}${status.operationInProgress.slice(1)} in progress (finish with git_continue after resolving, or git_abort)`)
				if (status.staged.length > 0) {
					lines.push('\nStaged:')
					for (const f of status.staged) lines.push(`  [${f.status}] ${f.uri}`)
				}
				if (status.unstaged.length > 0) {
					lines.push('\nUnstaged:')
					for (const f of status.unstaged) lines.push(`  [${f.status}] ${f.uri}`)
				}
				if (status.untracked.length > 0) {
					lines.push('\nUntracked:')
					for (const f of status.untracked) lines.push(`  ?? ${f.uri}`)
				}
				if (status.conflicted.length > 0) {
					lines.push('\nConflicted:')
					for (const f of status.conflicted) lines.push(`  !! ${f.uri}`)
				}
				return lines.join('\n')
			},
			git_diff: (_params, result) => {
				const { diff } = result
				const lines: string[] = []
				lines.push(`Files changed: ${diff.files.length} (insertions: ${diff.totalInsertions}, deletions: ${diff.totalDeletions})`)
				for (const f of diff.files) {
					lines.push(`\n${f.status.toUpperCase()}: ${f.uri} (+${f.insertions}/-${f.deletions})`)
					for (const hunk of f.hunks) {
						lines.push(hunk.body)
					}
				}
				return lines.join('\n')
			},
			git_log: (_params, result) => {
				const { commits, total } = result
				const lines: string[] = []
				lines.push(`Commits: ${total} total, showing ${commits.length}`)
				for (const c of commits) {
					lines.push(`${c.shortHash} ${c.authorName} <${c.authorEmail}> ${c.authorDate}`)
					lines.push(`    ${c.message}`)
					if (c.parents.length > 0) lines.push(`    Parents: ${c.parents.map(p => p.substring(0, 7)).join(', ')}`)
				}
				return lines.join('\n')
			},
			git_branch_list: (_params, result) => {
				const { branches, current } = result
				const lines: string[] = []
				lines.push(`Current branch: ${current ?? '(none)'}`)
				for (const b of branches) {
					const marker = b.isCurrent ? '*' : ' '
					const remote = b.isRemote ? ' (remote)' : ''
					const upstream = b.upstream ? ` -> ${b.upstream}` : ''
					const aheadBehind = b.ahead !== null || b.behind !== null ? ` (ahead ${b.ahead ?? 0}, behind ${b.behind ?? 0})` : ''
					lines.push(`${marker} ${b.name}${remote}${upstream}${aheadBehind}`)
				}
				return lines.join('\n')
			},
			git_branch_create: (_params, result) => {
				return `Created branch "${result.branch_name}".`
			},
			git_branch_switch: (_params, result) => {
				return `Switched to branch "${result.branch_name}".`
			},
			git_stage: (_params, result) => {
				return `Staged ${result.staged.length} file(s): ${result.staged.join(', ')}`
			},
			git_unstage: (_params, result) => {
				return `Unstaged ${result.unstaged.length} file(s): ${result.unstaged.join(', ')}`
			},
			git_commit: (_params, result) => {
				return `Committed: ${result.commit_hash} - ${result.message}`
			},
			git_fetch: (_params, result) => {
				return result.result
			},
			git_pull: (_params, result) => {
				return result.result
			},
			git_push: (_params, result) => {
				return result.result
			},
			git_merge: (_params, result) => {
				let msg = result.result
				if (result.merge_in_progress) {
					msg += `\nMerge in progress: ${result.conflicted?.length ?? 0} conflicted file(s)${result.conflicted?.length ? `:\n${result.conflicted.map(f => `  !! ${f}`).join('\n')}` : ''}\nResolve the conflicts, stage the files, then commit.`
				}
				return msg
			},
			git_stash: (_params, result) => {
				return result.result
			},
			git_stash_pop: (_params, result) => {
				return result.result
			},
			git_show: (_params, result) => {
				return `Commit ${result.commit}\n${result.message}\n\n${result.diff}`
			},
			git_revert: (_params, result) => stringifyGitStep('Revert', result),
			git_cherry_pick: (_params, result) => stringifyGitStep('Cherry-pick', result),
			git_rebase: (_params, result) => stringifyGitStep('Rebase', result),
			git_continue: (_params, result) => stringifyGitStep(`Continued ${result.operation}`, result),
			git_abort: (_params, result) => `Aborted the ${result.operation}. HEAD is ${result.head ?? '(none)'}.`,
			git_reset: (_params, result) => {
				const lines = [`Reset (${result.mode}) from ${result.previousHead} to ${result.newHead}.`]
				if (result.detachedCommits.length) {
					lines.push(`The branch no longer contains ${result.detachedCommits.length} commit(s):`, ...result.detachedCommits.slice(0, 20).map(c => `  ${c}`))
					lines.push(`To undo: git_reset with ref ${result.previousHead}.`)
				}
				if (result.mode === 'soft') { lines.push('Their changes are staged.') } else if (result.mode === 'mixed') { lines.push('Their changes are in the working tree, unstaged.') }
				return lines.join('\n')
			},
			git_tag_list: (_params, result) => result.tags.length === 0 ? 'No tags.' : result.tags.map(t => `${t.name} -> ${t.commit.slice(0, 10)}${t.annotated ? ` (annotated: ${t.subject})` : ''}`).join('\n'),
			git_tag_create: (_params, result) => `Created tag ${result.name} at ${result.commit}.`,
			git_remote_list: (_params, result) => result.remotes.length === 0 ? 'No remotes.' : result.remotes.map(r => `${r.name}\tfetch: ${r.fetchUrl ?? '-'}\tpush: ${r.pushUrl ?? '-'}`).join('\n'),
			git_worktree_list: (_params, result) => result.worktrees.map(w => `${w.path}  ${w.branch ? `[${w.branch}]` : '(detached)'}  ${w.head?.slice(0, 10) ?? ''}${w.isMain ? '  (main)' : ''}${w.locked ? '  locked' : ''}${w.prunable ? '  prunable' : ''}`).join('\n'),
			git_worktree_add: (_params, result) => `Created worktree ${result.path} on branch ${result.branch} at ${result.head}.`,
			git_commit_context: (_params, c) => {
				const fileLine = (f: GitChangedFile) => `  ${f.status}${f.oldPath ? ` (from ${f.oldPath})` : ''}: ${f.path}${f.added === null ? ' (binary)' : ` +${f.added} -${f.deleted}`}`
				const lines = [`Staged for the commit on ${c.branch ?? '(detached HEAD)'} — ${c.staged.length} file(s):`, ...c.staged.map(fileLine)]
				const ns = c.notStaged
				if (ns.unstaged.length || ns.untracked.length) lines.push(`NOT in this commit (do not describe them): ${[...ns.unstaged.map(p => `${p} (modified)`), ...ns.untracked.map(p => `${p} (untracked)`)].slice(0, 30).join(', ')}`)
				const cv = c.convention
				if (c.recentSubjects.length === 0) lines.push('Style: no earlier commits to follow; use a short imperative subject (under ~72 characters).')
				else {
					lines.push(cv.conventional ? `Style: conventional commits — "type(scope): subject"; types used here: ${cv.types.join(', ')}${cv.scopes.length ? `; scopes: ${cv.scopes.join(', ')}` : ''}.` : 'Style: plain subjects (not conventional commits).')
					lines.push(`Typical subject length: ${cv.averageSubjectLength} characters. Recent subjects:`, ...c.recentSubjects.slice(0, 8).map(s => `  ${s}`))
				}
				lines.push(`\nStaged diff${c.diffTruncated ? ' (TRUNCATED — the file list above is complete)' : ''}:\n${c.stagedDiff}`)
				return lines.join('\n')
			},
			git_pr_prepare: (_params, { pr, tests }) => {
				const lines = [`Pull request: ${pr.branch} → ${pr.base} (${pr.ahead} commit(s) ahead${pr.behind ? `, ${pr.behind} behind — the base has moved on` : ''}).`]
				lines.push(pr.upstream ? (pr.unpushed ? `NOT fully pushed: ${pr.unpushed} commit(s) are not on ${pr.upstream} yet.` : `Pushed: ${pr.upstream} is up to date.`) : 'NOT pushed: the branch has no upstream on a remote yet.')
				const u = pr.uncommitted
				if (u.staged + u.unstaged + u.untracked) lines.push(`Uncommitted work (not part of the pull request): ${u.staged} staged, ${u.unstaged} modified, ${u.untracked} untracked.`)
				lines.push(pr.conflictsWithBase === null ? 'Conflicts with the base: could not be checked.' : pr.conflictsWithBase.length ? `WOULD CONFLICT with ${pr.base} in: ${pr.conflictsWithBase.join(', ')}` : `Merges cleanly into ${pr.base}.`)
				lines.push(`\nCommits (oldest first):`, ...pr.commits.map(c => `  ${c.hash.slice(0, 8)} ${c.subject}${c.body ? `\n      ${c.body.split('\n').slice(0, 4).join('\n      ')}` : ''}`))
				lines.push(`\nFiles changed: ${pr.totals.files} (+${pr.totals.added} -${pr.totals.deleted})`, ...pr.files.slice(0, 60).map(f => `  ${f.status}${f.oldPath ? ` (from ${f.oldPath})` : ''}: ${f.path}${f.added === null ? ' (binary)' : ` +${f.added} -${f.deleted}`}`))
				if (pr.files.length > 60) lines.push(`  ... and ${pr.files.length - 60} more`)
				lines.push(tests && tests.total > 0
					? `\nLast test run this session: ${tests.passed} passed, ${tests.failed} failed, ${tests.skipped} skipped (${tests.total})${tests.completed ? '' : ', INCOMPLETE'}${tests.command ? ` — ${tests.command}` : ''}.`
					: '\nNo tests have been run in this session: do not claim the change is tested (run test_run first if it should be).')
				return lines.join('\n')
			},

			// Test discovery and execution (Stage 3)
			test_discover: (_params, result) => {
				const { frameworks } = result
				if (frameworks.length === 0) return 'No test frameworks detected.'
				const lines = frameworks.map(f => `${f.name} (${f.type})${f.configFile ? ` - config: ${f.configFile}` : ''}`)
				return `Test frameworks detected:\n${lines.join('\n')}`
			},
			test_list: (_params, result) => {
				const { testFiles } = result
				if (testFiles.length === 0) return 'No test files found.'
				const lines = testFiles.map(f => `${f.label} (${f.testCount} test${f.testCount !== 1 ? 's' : ''})${f.framework ? ` - ${f.framework}` : ''}\n  ${f.uri}`)
				return `Test files:\n${lines.join('\n')}`
			},
			test_run: (_params, result) => {
				const { results } = result
				return _formatTestResults(results)
			},
			test_run_targeted: (_params, result) => {
				const { results } = result
				return _formatTestResults(results)
			},
			test_rerun_failed: (_params, result) => {
				const { results } = result
				return _formatTestResults(results)
			},
			test_cancel: (_params, result) => {
				return result.cancelled ? 'Test run cancelled.' : 'No test run to cancel.'
			},
			test_coverage: (_params, result) => _formatTestResults(result.results),
			test_history: (_params, result) => {
				if (result.tracked === 0) return 'No test runs have been recorded for this project yet. Run tests first (test_run).'
				const lines = [`${result.matched} of ${result.tracked} tracked test(s) match; showing ${result.tests.length}.`]
				if (!result.fingerprinted) lines.push('Note: runs here were not tied to a code version (no git), so flakiness cannot be told apart from code changes; use test_check_flaky.')
				for (const t of result.tests) {
					const tags = [t.flaky ? `FLAKY: ${t.flakyEvidence}` : '', t.failingStreak ? `failing ${t.failingStreak} run(s) in a row` : '', t.flips ? `${t.flips} outcome change(s)` : ''].filter(Boolean).join('; ')
					lines.push(`- ${t.label}: last ${t.lastState}; ${t.passed} passed / ${t.failed} failed / ${t.skipped} skipped in ${t.runs} run(s)${t.averageDurationMs !== undefined ? `; avg ${t.averageDurationMs}ms` : ''}${tags ? ` — ${tags}` : ''}`)
					if (t.lastFailureMessage && (t.flaky || t.failingStreak)) lines.push(`    last failure: ${t.lastFailureMessage.split('\n')[0]}`)
				}
				if (result.recentRuns.length) {
					lines.push('Recent runs (newest first):')
					for (const r of result.recentRuns) lines.push(`  ${new Date(r.at).toISOString()} ${r.framework ?? r.source ?? ''}: ${r.passed} passed, ${r.failed} failed, ${r.skipped} skipped${r.completed ? '' : ' (incomplete)'}`)
				}
				return lines.join('\n')
			},
			test_debug: (params, result) => {
				const lines = [`Started debug session ${result.sessionId}: ${result.describe} (${result.framework}).`]
				if (result.exceptionBreakpoints.some(f => f.enabled)) lines.push(`Stopping where a test fails (exception breakpoints on: ${result.exceptionBreakpoints.filter(f => f.enabled).map(f => f.filter).join(', ')}).`)
				lines.push(formatDebugStop(result.stop))
				if (result.stop.state === 'stopped' && result.stop.reason === 'exception') lines.push('This is where the test failed: inspect it with debug_get_exception_info, debug_get_stack_trace and debug_evaluate_expression.')
				else if (result.stop.state === 'terminated' && params.stop_on_failure) lines.push('The run ended without stopping on a failure: under the debugger these tests did not fail (or the file has no matching test).')
				return lines.join('\n')
			},
			test_check_flaky: (_params, result) => {
				const v = result.verdict
				const lines = [`Ran the tests ${result.runs.length} time(s) (${result.runs.map(r => `${r.passed}/${r.total} passed`).join(', ')}).`]
				if (v.flaky.length) {
					lines.push(`FLAKY — passed in some attempts and failed in others:`)
					for (const f of v.flaky) lines.push(`  ${f.label}: passed ${f.passed}×, failed ${f.failed}×${f.messages.length ? ` — ${f.messages.join(' | ')}` : ''}`)
				} else lines.push('No flaky tests: every test had the same outcome in every attempt.')
				if (v.consistentlyFailing.length) lines.push(`Failed in every attempt (a real failure, not flakiness): ${v.consistentlyFailing.join('; ')}`)
				lines.push(`Passed in every attempt: ${v.consistentlyPassing}`)
				if (v.incomplete.length) lines.push(`Not seen in every attempt: ${v.incomplete.join('; ')}`)
				if (result.note) lines.push(`Note: ${result.note}`)
				return lines.join('\n')
			},

			// Todo list (task tracking within a turn - OpenCode parity)
			todo: (_params, result) => {
				const { todos } = result
				const done = todos.filter(t => t.status === 'completed').length
				const inProgress = todos.filter(t => t.status === 'in_progress').length
				const pending = todos.filter(t => t.status === 'pending').length
				const lines = todos.map(t => {
					const icon = t.status === 'completed' ? '✅' : t.status === 'in_progress' ? '🔄' : '⬜'
					return `${icon} ${t.content}`
				})
				return `Todo list: ${done}/${todos.length} done${inProgress ? `, ${inProgress} in progress` : ''}${pending ? `, ${pending} pending` : ''}.\n${lines.join('\n')}`
			},

			// Subagent delegation (roadmap 6); chatThreadService runs it and formats the same report
			subagent: (_params, result) => formatSubagentReport(result),
			project_health_scan: (_params, result) => formatProjectHealthForLLM(result),
			architecture_map: (_params, result) => formatArchitectureMapForLLM(result),
			workspace_diagnostics: (_params, result) => {
				if (result.items.length === 0) {
					return `Workspace Diagnostics: 0 errors, 0 warnings.`
				}
				const lines = [`Workspace Diagnostics: ${result.totalErrors} error(s), ${result.totalWarnings} warning(s) (showing ${result.items.length}):`]
				for (const item of result.items) {
					lines.push(`- [${item.severity.toUpperCase()}] ${item.uri}:${item.line}${item.code ? ` (${item.code})` : ''}: ${item.message}`)
				}
				return lines.join('\n')
			},
			move_or_rename_file: (_params, result) => `Moved ${result.sourceUri.fsPath} → ${result.targetUri.fsPath}.`,
			file_metadata: (_params, result) => [
				`File: ${result.uri}`,
				`Type: ${result.isDirectory ? 'directory' : result.isBinary ? 'binary file' : 'text file'}${result.isSymbolicLink ? ' (symlink)' : ''}`,
				`Size: ${result.size} bytes`,
				...(result.lineCount !== null ? [`Lines: ${result.lineCount} (${result.lineEnding})`] : []),
				`Modified: ${new Date(result.mtime).toISOString()}`,
			].join('\n'),
			dependency_audit: (_params, result) => {
				if (result.manifests.length === 0) return 'No dependency manifests (package.json, requirements.txt, Cargo.toml, go.mod) found at workspace root.'
				return result.manifests.map(m => [
					`Manifest: ${m.file} (${m.ecosystem})`,
					`  Dependencies: ${m.dependencies} runtime, ${m.devDependencies} dev${m.license ? ` | License: ${m.license}` : ''}`,
					...(m.scripts.length ? [`  Scripts: ${m.scripts.slice(0, 12).join(', ')}`] : []),
					...(m.riskySpecs.length ? [`  Unpinned/Risky Specs (${m.riskySpecs.length}): ${m.riskySpecs.slice(0, 10).join(', ')}`] : ['  Unpinned/Risky Specs: none']),
				].join('\n')).join('\n\n')
			},
			env_inspect: (_params, result) => formatEnvInspectForLLM(result),
			docker_status: (_params, result) => formatDockerStatusForLLM(result),
			docker_logs: (_params, result) => result.error ? `Docker logs error (${result.container}): ${result.error}` : `Docker logs (${result.container}):\n${result.logs || '(empty)'}`,
			db_inspect: (_params, result) => formatDbInspectForLLM(result),
			db_query: (_params, result) => formatDbQueryForLLM(result),
			change_impact_analysis: (_params, result) => formatChangeImpactForLLM(result),
			knowledge_graph_query: (_params, result) => {
				const header = `Project Digital Twin (${result.totalModules} modules, ${result.totalSymbols} symbols, ${result.totalApis} APIs, ${result.totalDbEntities} DB entities, ${result.untestedCount} untested modules)`;
				if (result.matches.length === 0) return `${header}\nNo matching nodes found.`;
				return [
					header,
					...result.matches.map(n => `- [${n.kind}] ${n.id} (${n.lines}L, importedBy=${n.importedBy.length}, tests=${n.relatedTests.length}${n.exportedSymbols.length ? `, exports: ${n.exportedSymbols.slice(0, 6).join(', ')}` : ''}${n.apiEndpoints.length ? `, APIs: ${n.apiEndpoints.slice(0, 3).join(', ')}` : ''})`),
				].join('\n');
			},
			evaluate_quality_gates: (_params, result) => formatQualityGateEvaluationForLLM(result.evaluation),
			record_verification_evidence: (_params, result) => `Verification record ${result.id} saved (${result.passed ? 'PASSED' : 'FAILED'}, level: ${result.highestLevel}) — ${result.summary}`,
			factory_manage_requirements: (_params, result) => {
				const lines = [result.message];
				if (result.requirements && result.requirements.length > 0) {
					lines.push(...result.requirements.slice(0, 20).map(r => `- [${r.id}][${r.status}][${r.priority}] ${r.title}`));
				}
				if (result.decisions && result.decisions.length > 0) {
					lines.push(...result.decisions.slice(0, 10).map(d => `- [${d.id}][${d.status}] ${d.title}: ${d.decision}`));
				}
				return lines.join('\n');
			},

			// Autonomous UI/UX Design Intelligence, Visual Assets & Browser Visual QA (25 tools)
			analyze_product_design_requirements: (_params, result) => formatProductAnalysisForLLM(result),
			generate_design_brief: (_params, result) => formatDesignBriefForLLM(result),
			generate_visual_direction: (_params, r) => [
				`# Visual Direction: ${r.name} (${r.id})`,
				`Rationale: ${r.rationale}`,
				`Keywords: ${r.aestheticKeywords.join(', ')}`,
				`Color Mood: ${r.colorMood}`,
				`Typography: ${r.typographyCharacter}`,
				`Layout: ${r.layoutPhilosophy}`,
				`Surface & Elevation: ${r.surfaceTreatment} | ${r.elevationStrategy} | Radii: ${r.borderRadiusStyle}`,
				`Motion: ${r.motionCharacter}`,
				`Use: ${r.visualTreatmentsToUse.join('; ')}`,
				`Avoid: ${r.visualTreatmentsToAvoid.join('; ')}`,
			].join('\n'),
			generate_color_palette: (_params, result) => formatColorPaletteForLLM(result),
			generate_design_tokens: (_params, r) => [
				`# Design System Tokens: ${r.name} (${r.visualDirection})`,
				`Google Fonts: ${r.typography.googleFontsUrl}`,
				`WCAG Contrast: ${r.palette.allContrastChecksPassAA ? 'ALL 12 CHECKS PASS AA' : 'Review contrast checks'}`,
				``,
				`## CSS Custom Properties (ready to paste into global stylesheet)`,
				'```css',
				r.cssVariables,
				'```',
				``,
				`## Tailwind Theme Extend`,
				'```json',
				r.tailwindExtendSnippet,
				'```',
			].join('\n'),
			generate_page_architecture: (_params, r) => [
				`# Page Architecture: ${r.productName} (${r.category})`,
				`Desktop Navigation: ${r.navigationPattern}`,
				`Mobile Navigation: ${r.mobileNavigationPattern}`,
				`Shared Shell: ${r.sharedShellComponents.join(', ')}`,
				``,
				`## Pages (${r.pages.length})`,
				...r.pages.map(p => `- **${p.name}** (\`${p.route}\`) [${p.navigationRole}] — ${p.purpose}\n  Sections: ${p.sections.map(s => `${s.name} (${s.layoutPattern})`).join(' -> ')}\n  States: ${p.statesRequired.join(', ')}`),
				``,
				`## Connected Functionality`,
				...r.stateAndDataFlows.map(f => `- ${f}`),
			].join('\n'),
			generate_responsive_layout: (_params, r) => [
				`# Responsive Layout System (max-width: ${r.maxContentWidth})`,
				`Strategy: ${r.strategy}`,
				`Breakpoints:\n${r.breakpoints.map(b => `- ${b.name} (>=${b.minWidthPx}px): ${b.columns} cols, padding ${b.containerPadding}, nav: ${b.navigationBehavior}`).join('\n')}`,
				`Mobile Transformations:\n${r.mobileTransformations.map(m => `- ${m}`).join('\n')}`,
				`Touch & Safe Area:\n${r.touchAndSafeAreaRules.map(t => `- ${t}`).join('\n')}`,
				`CSS Foundation:\n\`\`\`css\n${r.cssFoundation}\n\`\`\``,
			].join('\n'),
			discover_visual_assets: (_params, r) => [
				`# Visual Asset Discovery for "${r.query}" (${r.assets.length} result(s))`,
				`Providers: ${r.providerStatuses.map(s => `${s.provider}=${s.status}(${s.count})${s.message ? ` [${s.message}]` : ''}`).join(', ')}`,
				...(r.assets.length === 0
					? [r.fallbackRecommendation ?? 'No assets returned.']
					: r.assets.map((a, i) => `${i + 1}. [${a.provider}] ${a.title} | ${a.width ?? '?'}x${a.height ?? '?'} | license: ${a.license}\n   url: ${a.url}\n   alt: "${a.altTextSuggestion}"${a.attribution ? `\n   attribution: ${a.attribution}` : ''}`)),
			].join('\n'),
			search_image_providers: (_params, r) => [
				`# Image Provider Search for "${r.query}" (${r.assets.length} result(s))`,
				`Provider Statuses: ${r.providerStatuses.map(s => `${s.provider}:${s.status}(${s.count})`).join(', ')}`,
				...r.assets.map((a, i) => `${i + 1}. [${a.provider}] ${a.url} (${a.width ?? '?'}x${a.height ?? '?'}, ${a.license})`),
				...(r.fallbackRecommendation ? [r.fallbackRecommendation] : []),
			].join('\n'),
			download_visual_assets: (_params, r) => {
				const ok = r.downloaded.filter(d => d.verifiedOnDisk)
				const failed = r.downloaded.filter(d => !d.verifiedOnDisk)
				return [
					`# Visual Assets Downloaded: ${ok.length} verified on disk, ${failed.length} failed`,
					...ok.map(d => `- [VERIFIED] ${d.relativePath} (${d.mimeType}, ${(d.sizeBytes / 1024).toFixed(1)} KB, ${d.width ?? '?'}x${d.height ?? '?'}, provider=${d.provider}, license=${d.license})`),
					...failed.map(d => `- [FAILED] ${d.sourceUrl}: ${d.error ?? 'Unknown download error'}`),
					...(r.attributionManifestPath ? [`Attribution manifest written to: ${r.attributionManifestPath}`] : []),
				].join('\n')
			},
			optimize_visual_assets: (_params, r) => [
				`# Visual Asset Optimization: scanned ${r.scannedCount}, optimized ${r.optimizedCount}, saved ${r.totalSavedBytes} bytes`,
				...r.entries.slice(0, 25).map(e => `- [${e.action}] ${e.filePath} (${e.format}, ${e.width ?? '?'}x${e.height ?? '?'}, ${(e.optimizedBytes / 1024).toFixed(1)} KB)${e.recommendation ? ` — ${e.recommendation}` : ''}`),
				...(r.warnings.length ? [`Warnings:\n${r.warnings.map(w => `- ${w}`).join('\n')}`] : []),
			].join('\n'),
			discover_icon_library: (_params, r) => [
				`# Icon Library Recommendation: ${r.recommendedLibrary} (${r.packageName})`,
				`Detected existing in project: ${r.detectedExistingLibraries.join(', ') || 'none'} | Reuse existing: ${r.reuseExisting ? 'YES' : 'NO'}`,
				...(r.installCommand ? [`Install: \`${r.installCommand}\``] : []),
				`Stroke Width: ${r.strokeWidth} | Sizes: ${Object.entries(r.sizingScale).map(([k, v]) => `${k}=${v}`).join(', ')}`,
				`Common Slots: ${Object.entries(r.recommendedIconsBySlot).map(([k, v]) => `${k}→${v}`).join(', ')}`,
				`Accessibility Rules:\n${r.accessibilityRules.map(a => `- ${a}`).join('\n')}`,
			].join('\n'),
			recommend_typography: (_params, r) => [
				`# Typography System: ${r.pairingName}`,
				`Rationale: ${r.rationale}`,
				`Google Fonts: ${r.googleFontsUrl}`,
				`Stacks: display=${r.fontStacks.display} | body=${r.fontStacks.body} | mono=${r.fontStacks.mono}`,
				`Type Scale:\n${r.scale.map(s => `- ${s.token} (${s.role}): ${s.sizeClamp}, lh=${s.lineHeight}, weight=${s.weight}, tracking=${s.letterSpacing}`).join('\n')}`,
				`Best Practices:\n${r.bestPractices.map(b => `- ${b}`).join('\n')}`,
			].join('\n'),
			recommend_ui_components: (_params, r) => [
				`# Recommended UI Components (${r.components.length})`,
				...r.components.map(c => `- **${c.name}** [${c.priority}/${c.category}]: variants=[${c.variants.join(', ')}] | states=[${c.interactiveStates.join(', ')}]\n  Responsive: ${c.responsiveBehavior}\n  A11y: ${c.accessibilityRequirements.join('; ')}`),
			].join('\n'),
			generate_component_variants: (_params, r) => [
				`# Component Variants: ${r.componentType} (${r.framework} / ${r.stylingSystem} / ${r.visualDirection})`,
				...r.variants.map(v => `- **${v.name}**: ${v.usage} | states: ${v.states.join(', ')}`),
				``,
				`Implementation Reference:`,
				'```tsx',
				r.implementationSnippet,
				'```',
				`Accessibility Checklist: ${r.accessibilityChecklist.join('; ')}`,
			].join('\n'),
			inspect_existing_design_system: (_params, r) => [
				`# Existing Workspace Design System`,
				r.summary,
				`Fonts: ${r.detectedFonts.join(', ') || 'none detected'}`,
				`Animation libraries: ${r.detectedAnimationLibraries.join(', ') || 'none'}`,
				...(r.tailwindConfigPath ? [`Tailwind config: ${r.tailwindConfigPath}`] : []),
				...(r.designTokenFiles.length ? [`Token files: ${r.designTokenFiles.join(', ')}`] : []),
				...(r.sampleCssVariables.length ? [`Sample CSS variables: ${r.sampleCssVariables.slice(0, 16).join(', ')}`] : []),
			].join('\n'),
			audit_design_consistency: (_params, r) => [
				`# Design Consistency Audit: ${r.score}/100`,
				r.summary,
				...(r.findings.length ? [`Findings:\n${r.findings.map(f => `- [${f.severity.toUpperCase()}][${f.category}] ${f.title}${f.location ? ` (${f.location})` : ''}: ${f.detail} -> ${f.fixRecommendation}`).join('\n')}`] : ['No consistency defects found.']),
				...(r.strengths.length ? [`Strengths:\n${r.strengths.map(s => `- ${s}`).join('\n')}`] : []),
			].join('\n'),
			inspect_responsive_layout: (_params, r) => [
				`# Multi-Viewport Responsive Layout Inspection: ${r.url}`,
				`Overall: ${r.allViewportsClean ? 'ALL VIEWPORTS CLEAN' : 'RESPONSIVE DEFECTS DETECTED'}`,
				r.summary,
				...r.captures.map(c => `- **${c.label} (${c.width}x${c.height})**: screenshot=${c.path} | overflow=${c.hasHorizontalOverflow ? 'YES' : 'no'} | layoutIssues=${c.layoutIssueCount} | brokenImages=${c.brokenImageCount} | smallTouchTargets=${c.smallTouchTargetCount}`),
			].join('\n'),
			capture_application_screenshots: (_params, r) => [
				`# Application Screenshots Captured (${r.captures.length} viewports): ${r.url}`,
				...r.captures.map(c => `- ${c.label} (${c.width}x${c.height}): ${c.path} | overflow=${c.hasHorizontalOverflow ? 'YES' : 'no'} | brokenImages=${c.brokenImageCount}`),
			].join('\n'),
			inspect_visual_quality: (_params, r) => formatBrowserVisualAuditForLLM(r),
			audit_accessibility: (_params, r) => [
				`# Live WCAG 2.1 Accessibility Audit: ${r.url} (${r.viewport.width}x${r.viewport.height})`,
				`Contrast Violations: ${r.contrastViolations.length} | Structural Issues: ${r.accessibilityIssues.length} | Missing Alt: ${r.missingAltImages.length} | Small Touch Targets: ${r.smallTouchTargets.length} | Reduced Motion Rule: ${r.pageMetrics.hasReducedMotionMediaRule ? 'yes' : 'no'}`,
				...r.contrastViolations.map(c => `- [CONTRAST] ${c.selector} ("${c.textSample}"): ${c.ratio}:1 < ${c.required}:1 (${c.foreground} on ${c.background})`),
				...r.accessibilityIssues.map(a => `- [${a.severity.toUpperCase()}][${a.rule}] ${a.selector}: ${a.detail}`),
				...r.smallTouchTargets.map(t => `- [TOUCH] ${t.selector} ("${t.label}"): ${t.width}x${t.height}px (<40px)`),
			].join('\n'),
			audit_frontend_performance: (_params, r) => [
				`# Live Frontend Performance Audit: ${r.url}`,
				`DOM Nodes: ${r.performanceMetrics.domNodeCount} (max depth ${r.performanceMetrics.maxDomDepth})`,
				`Timings: TTFB=${r.performanceMetrics.ttfbMs ?? '?'}ms, DOMContentLoaded=${r.performanceMetrics.domContentLoadedMs ?? '?'}ms, Load=${r.performanceMetrics.loadCompleteMs ?? '?'}ms`,
				`Network Payload: ${r.performanceMetrics.resourceCount} resources, ${(r.performanceMetrics.totalTransferBytes / 1024).toFixed(1)} KB total | CLS=${r.performanceMetrics.cumulativeLayoutShift ?? 0}`,
				...(r.performanceMetrics.largestResources.length ? [`Largest Resources:\n${r.performanceMetrics.largestResources.map(res => `- [${res.type}] ${res.name}: ${(res.bytes / 1024).toFixed(1)} KB (${res.durationMs}ms)`).join('\n')}`] : []),
			].join('\n'),
			critique_interface_design: (_params, r) => formatDesignCritiqueForLLM(r),
			repair_visual_defects: (_params, r) => [
				`# Visual Defect Repair Plan (${r.totalDefects} defect(s): ${r.criticalCount} critical, ${r.majorCount} major)`,
				...(r.actions.length === 0
					? ['No visual defects detected.']
					: r.actions.map(a => `${a.priority}. [${a.severity.toUpperCase()}] ${a.target} — ${a.rootCause}\n   Fix: ${a.concreteFix}\n   Verify: ${a.verificationStep}`)),
				``,
				`Verification Loop:\n${r.recheckSequence.join('\n')}`,
			].join('\n'),
			compare_visual_revisions: (_params, r) => r.summary,

			// Universal AI Engineering Engine & Unified Two-Engine Orchestrator (20 tools)
			ai_orchestrate_project: (_params, r) => formatEngineRoutingForLLM(r),
			ai_design_architecture: (_params, r) => formatAIArchitectureForLLM(r),
			ai_probe_compute_hardware: (_params, r) => [
				`# Compute Hardware & AI Runtimes`,
				r.summary,
				`Runtimes: ${r.runtimes.filter(rt => rt.available).map(rt => `${rt.name}${rt.version ? ` (${rt.version})` : ''}`).join(', ') || 'none'}`,
				`Missing: ${r.runtimes.filter(rt => !rt.available).map(rt => rt.name).join(', ') || 'none'}`,
			].join('\n'),
			ai_recommend_training_strategy: (_params, r) => [
				`# Model Training Strategy: ${r.recommendedApproach} (${r.precision})`,
				`Task: ${r.taskType} | Rows: ${r.datasetRows} | Compute Tier: ${r.computeTier} | Est. VRAM: ${r.estimatedVramGb} GB`,
				`Stack: ${r.frameworkStack.join(', ')}`,
				`Hyperparameters: ${JSON.stringify(r.hyperparameters)}`,
				`Rationale: ${r.rationale}`,
				`Reproducibility:\n${r.reproducibilityChecklist.map(c => `- ${c}`).join('\n')}`,
			].join('\n'),
			ai_profile_dataset: (_params, r) => r.error
				? `Dataset profiling error: ${r.error}`
				: [
					`# Dataset Profile: ${r.datasetPath} (${r.format})`,
					`Rows: ${r.rowCount} | Columns: ${r.columnCount} | Duplicates: ${r.duplicateRowCount} | Quality Score: ${r.qualityScore}/100 | SHA-256: ${r.sha256Fingerprint}`,
					`Schema:\n${r.columns.slice(0, 20).map(c => `- ${c.name} [${c.inferredType}]: missing=${(c.missingRate * 100).toFixed(1)}%, unique=${c.uniqueCount}${c.numericStats ? `, min=${c.numericStats.min}, max=${c.numericStats.max}, mean=${c.numericStats.mean}` : ''}`).join('\n')}`,
					...(r.piiWarnings.length ? [`PII Warnings:\n${r.piiWarnings.map(w => `- ${w}`).join('\n')}`] : []),
					...(r.qualityWarnings.length ? [`Quality Warnings:\n${r.qualityWarnings.map(w => `- ${w}`).join('\n')}`] : []),
					`Cleaning Recommendations:\n${r.cleaningRecommendations.map(c => `- ${c}`).join('\n')}`,
				].join('\n'),
			ai_rag_build_index: (_params, r) => `Built hybrid RAG index "${r.indexName}" (${r.indexPath}): ${r.documentCount} document(s), ${r.chunkCount} chunk(s), ~${r.totalTokensEstimate} tokens (strategy=${r.strategy}, chunkSize=${r.chunkSize}, overlap=${r.chunkOverlap}).`,
			ai_rag_query: (_params, r) => r.error
				? `RAG query error: ${r.error}`
				: [
					`# Hybrid RAG Retrieval ("${r.indexName}") — ${r.results.length} result(s) from ${r.totalChunksSearched} chunks in ${r.latencyMs}ms`,
					r.groundedContextBlock,
				].join('\n\n'),
			ai_rag_evaluate: (_params, r) => r.error
				? `RAG evaluation error: ${r.error}`
				: [
					`# RAG Retrieval Evaluation ("${r.indexName}", topK=${r.topK}) — ${r.passed ? 'PASSED' : 'NEEDS IMPROVEMENT'}`,
					`Cases: ${r.totalCases} | HitRate@K: ${r.hitRateAtK} | Precision@K: ${r.meanPrecisionAtK} | Recall@K: ${r.meanRecallAtK} | MRR: ${r.mrr} | Groundedness: ${r.meanGroundedness}`,
				].join('\n'),
			ai_experiment_manage: (_params, r) => [
				r.message,
				...r.experiments.slice(0, 12).map(e => `- [${e.id}][${e.status}] ${e.name} (${e.modelRef}): metrics=${JSON.stringify(e.metrics)}`),
			].join('\n'),
			ai_model_registry: (_params, r) => [
				r.message,
				...r.models.slice(0, 12).map(m => `- [${m.id}][${m.stage}] ${m.name} v${m.version} (${m.framework}/${m.taskType}) artifact=${m.artifactPath ? `${m.artifactPath} (${m.artifactVerifiedOnDisk ? 'verified' : 'missing'})` : 'none'} metrics=${JSON.stringify(m.metrics)}`),
			].join('\n'),
			ai_evaluate_system: (_params, r) => r.error
				? `AI evaluation error: ${r.error}`
				: [
					`# AI Evaluation (${r.id}): ${r.name} [${r.taskType}] — ${r.passed ? 'PASSED' : 'FAILED'}`,
					`${r.thresholdSummary} | Samples: ${r.sampleCount}`,
					`Metrics: ${JSON.stringify(r.metrics)}`,
					...r.details,
				].join('\n'),
			ai_audit_security: (_params, r) => [
				`# AI Security & Governance Audit: ${r.score}/100`,
				r.summary,
				...(r.findings.length ? [`Findings:\n${r.findings.slice(0, 15).map(f => `- [${f.severity.toUpperCase()}][${f.category}] ${f.title}${f.file ? ` (${f.file}:${f.line ?? 1})` : ''} -> ${f.remediation}`).join('\n')}`] : ['No AI security vulnerabilities detected.']),
				...(r.protectionsDetected.length ? [`Protections Detected: ${r.protectionsDetected.join(', ')}`] : []),
				...(r.highImpactNotices.length ? [`High-Impact Domain Oversight:\n${r.highImpactNotices.map(n => `- ${n}`).join('\n')}`] : []),
			].join('\n'),
			ai_estimate_performance_cost: (_params, r) => [
				`# AI Performance & Cost Estimate: ${r.workloadName}`,
				`Volume: ${r.monthlyRequests.toLocaleString()} req/mo (~${(r.estimatedMonthlyTokens / 1_000_000).toFixed(2)}M tokens/mo)`,
				...r.tiers.map(t => `- **${t.tier}**: \$${t.estimatedMonthlyCostUsd}/mo | p50=${t.estimatedLatencyP50Ms}ms, p95=${t.estimatedLatencyP95Ms}ms — ${t.notes}`),
				`Optimizations:\n${r.optimizations.map(o => `- ${o}`).join('\n')}`,
			].join('\n'),
			ai_create_workflow: (_params, r) => [
				`Created executable AI workflow **${r.name}** (${r.id}, trigger=${r.trigger}, ${r.steps.length} steps):`,
				...r.steps.map(s => `- [${s.id}][${s.kind}] ${s.name}${s.requiresApproval ? ' (HITL APPROVAL GATE)' : ''}: ${s.description}`),
			].join('\n'),
			ai_run_workflow: (_params, r) => [
				r.summary,
				...r.stepTraces.map(t => `- [${t.stepId}][${t.status}] ${t.name} (${t.durationMs}ms): ${t.output}`),
			].join('\n'),
			ai_research_analyze: (_params, r) => [
				`# AI Research & Experiment Synthesis: ${r.topic}`,
				`Disciplines: ${r.disciplines.join(', ')}`,
				`Approaches:\n${r.establishedApproaches.map(a => `- **${a.method}**: ${a.strengths} | Limits: ${a.limitations}`).join('\n')}`,
				`Hypotheses:\n${r.hypotheses.map(h => `- ${h}`).join('\n')}`,
				`Experiment Plan: Baseline="${r.experimentDesign.baseline}" | Metrics: ${r.experimentDesign.primaryMetrics.join(', ')}`,
				`Note: ${r.epistemicNote}`,
			].join('\n'),
			ai_discover_capabilities: (_params, r) => [
				`# Kodia Future AI Capability Catalogue (${r.entries.length} match(es))`,
				...r.entries.map(e => `- **${e.name}** [${e.category}/${e.maturity}/${e.integrationStatus}]: ${e.summary}\n  Why: ${e.whyItMatters} | Security: ${e.securityImplications}`),
			].join('\n'),
			ai_scaffold_product_factory: (_params, r) => formatFactoryBlueprintForLLM(r),
			ai_diagnose_failure: (_params, r) => [
				`# AI Failure Diagnosis [${r.category}] (${r.severity.toUpperCase()})`,
				`Likely Root Causes:\n${r.likelyRootCauses.map(c => `- ${c}`).join('\n')}`,
				`Concrete Repairs:\n${r.concreteRepairs.map(c => `- ${c}`).join('\n')}`,
				`Verification:\n${r.verificationSteps.map(v => `- ${v}`).join('\n')}`,
			].join('\n'),
			ai_check_provider_capabilities: (_params, r) => [
				`# Kodia Model-Agnostic Provider Matrix (${r.configuredCount} configured, ${r.localConfiguredCount} local)`,
				...r.providers.filter(p => p.configured || p.isLocal).map(p => `- **${p.providerName}** [${p.isLocal ? 'local' : 'cloud'}] ${p.configured ? 'CONFIGURED' : 'not configured'}: ${p.modelCount} model(s), tools=${p.supportsToolCalling}, vision=${p.supportsVision}, reasoning=${p.supportsReasoning}${p.sampleModels.length ? ` (${p.sampleModels.join(', ')})` : ''}`),
			].join('\n'),

			// Kodia API Engineering Studio (20 tools)
			api_open_studio: (_params, r) => `Opened native Kodia API Engineering Studio (section=${r.section}${r.url ? `, url=${r.url}` : ''}).`,
			api_discover_project: (_params, r) => formatDiscoveryForLLM(r),
			api_runtime_start: (_params, r) => [
				`API Runtime **${r.name}** (${r.runtimeId}): status=${r.status}, pid=${r.pid ?? 'n/a'}, port=${r.port ?? 'n/a'}, baseUrl=${r.baseUrl ?? 'n/a'}`,
				...(r.error ? [`Error: ${r.error}`] : []),
				...(r.recentLogs.length ? [`Recent Logs:\n${r.recentLogs.slice(-10).join('\n')}`] : []),
			].join('\n'),
			api_runtime_status: (_params, r) => r.runtimes.length === 0
				? 'No managed API runtimes currently tracked.'
				: r.runtimes.map(rt => `- **${rt.name}** (${rt.runtimeId}): ${rt.status} | port=${rt.port ?? 'n/a'} | pid=${rt.pid ?? 'n/a'} | logs=${rt.recentLogs.length}`).join('\n'),
			api_runtime_stop: (_params, r) => `Stopped ${r.stoppedCount} API runtime(s).`,
			api_send_request: (_params, r) => formatResponseForLLM(r),
			api_websocket_session: (_params, r) => [
				...(r.session ? [`WebSocket ${r.session.sessionId} (${r.session.url}): status=${r.session.status}, messages=${r.session.messages.length}${r.session.error ? `, error=${r.session.error}` : ''}`, ...r.session.messages.slice(-6).map(m => `  [${m.direction}/${m.kind}] ${m.data.slice(0, 140)}`)] : []),
				`Total tracked WebSocket sessions: ${r.sessions.length}`,
			].join('\n'),
			api_generate_test_suite: (_params, r) => [
				`Generated API Test Suite **${r.name}** (${r.id}): ${r.requests.length} test(s)`,
				...r.requests.slice(0, 20).map(req => `- ${req.method} ${req.url} (${req.assertions?.length ?? 0} assertions)`),
			].join('\n'),
			api_run_test_suite: (_params, r) => [
				`# API Test Suite Run (${r.runId})`,
				r.summary,
				...r.cases.map(c => `- [${c.status.toUpperCase()}] ${c.method} ${c.url} (HTTP ${c.httpStatus ?? 0}, ${c.durationMs}ms)${c.failureReason ? ` -> ${c.failureReason}` : ''}`),
			].join('\n'),
			api_run_load_test: (_params, r) => [
				`# API Performance Load Test (${r.runId})`,
				r.summary,
				`Latency ms: min=${r.latencyMs.min}, avg=${r.latencyMs.avg}, p50=${r.latencyMs.p50}, p90=${r.latencyMs.p90}, p95=${r.latencyMs.p95}, p99=${r.latencyMs.p99}, max=${r.latencyMs.max}`,
				`Throughput: ${r.throughputBytesPerSec} B/s | Thresholds: ${r.passedThresholds ? 'PASSED' : 'FAILED'} | Generator Saturated: ${r.generatorSaturated ? 'YES' : 'NO'}`,
				...r.thresholdDetails.map(d => `- ${d}`),
			].join('\n'),
			api_security_audit: (_params, r) => [
				`# API Security Audit (${r.id})`,
				r.summary,
				...(r.findings.length ? r.findings.map(f => `- [${f.severity.toUpperCase()}/${f.confidence}] ${f.title} (${f.endpoint ?? `${f.file}:${f.line}`}) -> ${f.remediation}`) : ['- No security findings detected.']),
			].join('\n'),
			api_compare_responses: (_params, r) => [
				`# API Response Comparison (${r.leftLabel} vs ${r.rightLabel})`,
				r.summary,
				`Latency delta: ${r.latencyDeltaMs >= 0 ? '+' : ''}${r.latencyDeltaMs}ms | Size delta: ${r.sizeDeltaBytes >= 0 ? '+' : ''}${r.sizeDeltaBytes}B`,
				...r.bodyDiffs.slice(0, 20).map(d => `- [${d.kind}] ${d.path}: ${d.left ?? '<none>'} -> ${d.right ?? '<none>'}`),
			].join('\n'),
			api_generate_openapi: (_params, r) => `Generated OpenAPI 3.1.0 spec with ${r.endpointCount} HTTP endpoint(s):\n\`\`\`json\n${JSON.stringify(r.spec, null, 2).slice(0, 3000)}\n\`\`\``,
			api_diff_specs: (_params, r) => [
				`# OpenAPI Specification Diff (${r.baseSpec} -> ${r.targetSpec})`,
				r.summary,
				...r.breakingChanges.map(b => `- [BREAKING] ${b}`),
				...r.nonBreakingChanges.map(n => `- [NON-BREAKING] ${n}`),
			].join('\n'),
			api_generate_client_sdk: (_params, r) => `# Generated API Client (${r.target})\n\`\`\`\n${r.code}\n\`\`\``,
			api_mock_server: (_params, r) => [
				...(r.mock ? [`Started MOCK Server **${r.mock.name}** (${r.mock.mockId}) at ${r.mock.baseUrl} [IS_MOCK=true, ${r.mock.routes.length} routes]`] : []),
				...(r.stopped !== undefined ? [`Mock server stop result: ${r.stopped}`] : []),
				`Active mock servers: ${r.mocks.length}`,
			].join('\n'),
			api_manage_collection: (_params, r) => r.exportedJson ? `${r.message}\n\`\`\`json\n${r.exportedJson.slice(0, 2500)}\n\`\`\`` : r.message,
			api_manage_environment: (_params, r) => r.message,
			api_assess_production_readiness: (_params, r) => [
				`# API Production Readiness Assessment`,
				r.summary,
				...r.pillars.map(p => `- **${p.pillar.toUpperCase()}**: ${p.status.toUpperCase()} (${p.score}/100) ${p.evidence[0] ?? p.gaps[0] ?? ''}`),
				...(r.blockers.length ? [`Blockers:\n${r.blockers.map(b => `- ${b}`).join('\n')}`] : []),
			].join('\n'),
			api_correlate_failure: (_params, r) => [
				`# API Failure Correlation (${r.endpoint}, HTTP ${r.status})`,
				r.summary,
				...(r.matchedRoute ? [`Matched Source Route: ${r.matchedRoute.filePath}:${r.matchedRoute.line} (${r.matchedRoute.framework})`] : []),
				...(r.failedAssertions.length ? [`Failed Assertions:\n${r.failedAssertions.map(a => `- ${a}`).join('\n')}`] : []),
				...(r.matchedLogLines.length ? [`Correlated Runtime Logs:\n${r.matchedLogLines.map(l => `  ${l}`).join('\n')}`] : []),
				`Repair Steps:\n${r.repairSteps.map(s => `- ${s}`).join('\n')}`,
			].join('\n'),

			// Kodia Deep Debugging, Software Correctness & Independent Verification (14 tools)
			correctness_open_hub: (_params, r) => `Opened Kodia Debugging & Correctness Hub (section=${r.section}).`,
			correctness_analyze_workspace: (_params, r) => [
				`# Kodia Correctness Analysis [${r.mode.toUpperCase()}]`,
				r.summary,
				...(r.partialNotice ? [r.partialNotice] : []),
				...r.diagnostics.filter(d => !d.suppressed).slice(0, 25).map(d => `- [${d.severity.toUpperCase()}/${d.ruleId}] ${d.file}:${d.line} — ${d.title}: ${d.message}`),
			].join('\n'),
			correctness_run_compilers: (_params, r) => [
				`# Multi-Language Compiler & Syntax Checks (${r.totalErrors} error(s))`,
				...r.outcomes.map(o => `- **${o.engine}** (${o.language}): ${!o.available ? `UNAVAILABLE (${o.note ?? 'not installed'})` : o.passed ? `PASS (${o.durationMs}ms)` : `FAIL (${o.diagnostics.length} diagnostic(s))`}`),
				...r.outcomes.flatMap(o => o.diagnostics).slice(0, 20).map(d => `  - ${d.file}:${d.line} [${d.ruleId}] ${d.message}`),
			].join('\n'),
			correctness_taint_analysis: (_params, r) => [
				`# Data-Flow & Taint Analysis`,
				r.summary,
				...r.unsafeFlows.slice(0, 20).map(f => `- [${f.severity.toUpperCase()}] ${f.title} (${f.source.file}:${f.source.line} -> ${f.sink.file}:${f.sink.line}) | ${f.remediation}`),
			].join('\n'),
			correctness_investigate_root_cause: (_params, r) => formatInvestigationForLLM(r),
			correctness_run_fuzz_test: (_params, r) => [
				`# Property-Based / Fuzz Test (${r.id})`,
				r.summary,
				...(r.counterexample ? [`Minimized Counterexample: ${JSON.stringify(r.counterexample.minimizedArgs)}`, `Error/Violation: ${r.counterexample.errorOrViolation}`, `Regression Test:\n\`\`\`js\n${r.counterexample.regressionTestSnippet}\n\`\`\``] : []),
			].join('\n'),
			correctness_run_mutation_test: (_params, r) => [
				`# Isolated Mutation Testing (${r.id})`,
				r.summary,
				`Note: ${r.limitationsNote}`,
				...r.outcomes.filter(o => o.status === 'survived').slice(0, 12).map(o => `- [SURVIVED] ${o.file}:${o.line} (${o.operator}): \`${o.originalCode}\` -> \`${o.mutatedCode}\``),
			].join('\n'),
			correctness_plan_repair: (_params, r) => [
				`# Controlled Repair Plan (${r.id})`,
				`Defect: ${r.defectSummary}`,
				`Target Files: ${r.targetFiles.join(', ')}`,
				`Blast Radius: ${r.blastRadiusFiles.join(', ') || 'isolated'}`,
				`Targeted Regression Tests: ${r.targetedTests.join(', ') || 'run relevant suite'}`,
				`Smallest Safe Fix: ${r.smallestFixStrategy}`,
				`Rollback: ${r.rollbackStrategy}`,
			].join('\n'),
			correctness_independent_verify: (_params, r) => [
				`# Independent Verification Verdict: **${r.verdict}** (${r.id})`,
				r.summary,
				...(r.proofRecordId ? [`Proof-Carrying Record: ${r.proofRecordId}`] : []),
				...r.checks.map(c => `- [${c.status.toUpperCase()}] (${c.category}) ${c.name}: ${c.detail}`),
				...(r.rejectionReasons.length ? [`Rejection Reasons:\n${r.rejectionReasons.map(x => `- ${x}`).join('\n')}`] : []),
				...(r.untestedRisks.length ? [`Untested Risks:\n${r.untestedRisks.map(x => `- ${x}`).join('\n')}`] : []),
			].join('\n'),
			correctness_create_proof_record: (_params, r) => `Saved Proof-Carrying Change Record **${r.record.id}** [${r.record.independentVerdict}] (${r.totalProofs} total persisted proof(s)).`,
			correctness_assess_release_readiness: (_params, r) => [
				`# Risk-Based Release Readiness: **${r.outcome.toUpperCase()}**`,
				r.summary,
				...r.gates.map(g => `- [${g.status.toUpperCase()}] ${g.label}: ${g.evidence}${g.gap ? ` (Gap: ${g.gap})` : ''}`),
				...(r.unverifiedDimensions.length ? [`Unverified Dimensions:\n${r.unverifiedDimensions.map(u => `- ${u}`).join('\n')}`] : []),
				`Disclaimer: ${r.explicitDisclaimer}`,
			].join('\n'),
			correctness_export_sarif: (_params, r) => `Exported SARIF 2.1.0 report with ${r.findingCount} finding(s):\n\`\`\`json\n${JSON.stringify(r.sarif, null, 2).slice(0, 2600)}\n\`\`\``,
			correctness_list_proofs: (_params, r) => r.proofs.length === 0 ? 'No proof-carrying change records persisted yet.' : r.proofs.map(p => `- **${p.id}** [${p.independentVerdict}] ${p.title} (${p.changedFiles.length} file(s), ${p.testsExecuted.length} test cmd(s))`).join('\n'),
			correctness_manage_suppressions: (_params, r) => `${r.suppressions.length} justified diagnostic suppression(s) recorded.`,

			// Kodia Next-Gen Evolution, Supply-Chain, IaC/FinOps, Ops & Governance (12 tools)
			evolution_open_hub: (_params, r) => `Opened Kodia Next-Gen Evolution & Ops Hub (section=${r.section}).`,
			evolution_supply_chain_sbom: (_params, r) => [
				`# Kodia Supply-Chain & CycloneDX 1.5 SBOM`,
				r.summary,
				`Live Audit: ${r.liveAuditNote}`,
				...(r.sbomPath ? [`SBOM Saved: ${r.sbomPath}`] : []),
				...r.findings.slice(0, 20).map(f => `- **[${f.severity.toUpperCase()}] ${f.category}** \`${f.packageName}\` (${f.file}): ${f.title} — ${f.remediation}`),
			].join('\n'),
			evolution_audit_iac_finops: (_params, r) => [
				`# Kodia IaC Security & FinOps Cost Audit`,
				r.summary,
				...r.findings.slice(0, 20).map(f => `- **[${f.severity.toUpperCase()}] ${f.ruleId}** ${f.file}:${f.line} — ${f.title}`),
				...r.costBreakdown.map(c => `- Cost: ${c.resource} (${c.sourceFile}) = $${c.estimatedMonthlyUsd}/mo (save ~$${c.rightSizingSavingsUsd}/mo: ${c.recommendation})`),
			].join('\n'),
			evolution_analyze_incident: (_params, r) => [
				r.summary,
				'',
				r.postmortemDraft,
			].join('\n'),
			evolution_plan_release: (_params, r) => [
				`# Kodia Autonomous Release Plan`,
				r.summary,
				'',
				r.changelogMarkdown,
				`## Canary Rollout Plan`,
				...r.canaryRolloutPlan.map(s => `- ${s}`),
				`## Rollback Playbook`,
				...r.rollbackPlaybook.map(s => `- ${s}`),
			].join('\n'),
			evolution_audit_privacy_compliance: (_params, r) => [
				`# Kodia Privacy & Governance Compliance Audit`,
				r.summary,
				...r.findings.slice(0, 20).map(f => `- **[${f.severity.toUpperCase()}] [${f.frameworks.join('/')}]** ${f.file}:${f.line} — ${f.title}`),
				...r.missingControls.map(m => `- Missing Control: ${m}`),
			].join('\n'),
			evolution_plan_modernization: (_params, r) => [
				`# Kodia Strangler-Fig Legacy Modernization Plan`,
				r.summary,
				...r.monolithHotspots.slice(0, 8).map(h => `- Hotspot: \`${h.file}\` (fanIn=${h.fanIn}, lines=${h.lines}) — ${h.reason}`),
				...r.waves.map(w => `### Wave ${w.wave} (${w.risk} risk): ${w.title}\n- Targets: ${w.targetModules.join(', ') || 'TBD'}\n- Strategy: ${w.strategy}\n- Gate: ${w.verificationGate}`),
			].join('\n'),
			evolution_run_capability_radar: (_params, r) => [
				`# Kodia Continuous Capability Evolution Radar`,
				r.summary,
				`Workspace Ecosystems: ${r.workspaceEcosystems.join(', ') || 'generic'} | Next Audit: ${r.nextRecommendedAuditAt}`,
				...r.evaluations.map(e => `- **[${e.verdict}]** ${e.name} (${e.domain}) — signal=${e.signalScore}, hype=${e.hypeRiskScore}, licenseOk=${e.licenseCompatible}, autoInstallAllowed=${e.autoInstallAllowed}`),
			].join('\n'),
			evolution_evaluate_technology: (_params, r) => [
				`# Technology Signal-vs-Hype Evaluation: ${r.name}`,
				`Verdict: **${r.verdict}** | Signal: ${r.signalScore}/100 | Hype Risk: ${r.hypeRiskScore}/100 | License Compatible: ${r.licenseCompatible} | autoInstallAllowed: ${r.autoInstallAllowed}`,
				`License Note: ${r.licenseNote}`,
				...r.rationale.map(x => `- ${x}`),
				`Recommended Action: ${r.recommendedAction}`,
			].join('\n'),
			evolution_manage_proposals: (_params, r) => r.proposals.length === 0
				? 'No evolution proposals recorded yet.'
				: r.proposals.map(p => `- **${p.id}** [${p.status}/${p.verdict}] ${p.title} (signal=${p.signalScore}, autoInstallAllowed=${p.autoInstallAllowed})`).join('\n'),
			evolution_schedule_periodic_audit: (_params, r) => r.message,
			evolution_workspace_overview: (_params, r) => [
				`# Kodia Evolution & Enterprise Ops Snapshot`,
				`- Supply-Chain SBOM reports: ${r.supplyChainReports.length}`,
				`- IaC & FinOps reports: ${r.iacFinOpsReports.length}`,
				`- Incident Forensics reports: ${r.incidentReports.length}`,
				`- Release Plans: ${r.releasePlans.length}`,
				`- Privacy Compliance reports: ${r.privacyReports.length}`,
				`- Modernization Plans: ${r.modernizationReports.length}`,
				`- Capability Radar audits: ${r.radarReports.length}`,
				`- Governed Proposals: ${r.proposals.length}`,
			].join('\n'),

			// Kodia Permanent Mobile Application Engineering Platform (12 tools)
			mobile_open_studio: (_params, r) => `Opened Kodia Mobile Engineering Studio (section: ${r.section}).`,
			mobile_probe_environment: (_params, r) => formatMobileEnvironmentForLLM(r),
			mobile_inspect_project: (_params, r) => formatMobileProjectIntelForLLM(r),
			mobile_design_architecture: (_params, r) => formatMobileArchitectureForLLM(r),
			mobile_scaffold_project: (_params, r) => [
				`Scaffolded ${r.framework} mobile project (backend: ${r.backendStack}) in ${r.projectDir}:`,
				`Created ${r.createdFiles.length} file(s): ${r.createdFiles.join(', ')}`,
				...(r.skippedFiles.length > 0 ? [`Skipped existing: ${r.skippedFiles.join(', ')}`] : []),
				`Next steps:\n${r.nextSteps.map(s => `  - ${s}`).join('\n')}`,
			].join('\n'),
			mobile_device_action: (_params, r) => `Mobile device action "${r.action}" → ${r.status} (${r.durationMs}ms)\n${r.error ? `Error: ${r.error}\n` : ''}${r.output}`.trim(),
			mobile_build_and_test: (_params, r) => [
				`Mobile ${r.mode} → ${r.status.toUpperCase()} (${r.durationMs}ms) [${r.command}]`,
				r.summary,
				...(r.stdout ? [`Stdout:\n${r.stdout.slice(0, 3000)}`] : []),
				...(r.stderr ? [`Stderr:\n${r.stderr.slice(0, 1500)}`] : []),
			].join('\n'),
			mobile_audit_security: (_params, r) => formatMobileSecurityForLLM(r),
			mobile_audit_performance: (_params, r) => [
				`Mobile Performance Audit — Score: ${r.score}/100 (${r.filesScanned} files scanned, ${r.findings.length} finding(s))`,
				...r.findings.slice(0, 12).map(f => `  - [${f.severity.toUpperCase()}][${f.category}] ${f.file}:${f.line} — ${f.title}: ${f.recommendation}`),
				`Recommendations:\n${r.recommendations.map(rec => `  - ${rec}`).join('\n')}`,
			].join('\n'),
			mobile_assess_readiness: (_params, r) => formatMobileReadinessForLLM(r),
			mobile_discover_capabilities: (_params, r) => r.entries.length === 0
				? 'No matching mobile capabilities found.'
				: r.entries.map(e => `- **${e.name}** [${e.category}/${e.maturity}] (${e.platforms.join(', ')}) — ${e.summary}`).join('\n'),
			mobile_workspace_overview: (_params, r) => [
				`# Kodia Mobile Engineering Workspace Snapshot (${r.workspaceRoot})`,
				`- Environment probed: ${r.environment ? `${r.environment.toolchains.filter(t => t.installed).length}/${r.environment.toolchains.length} toolchains, ${r.environment.devices.length} devices` : 'no'}`,
				`- Project detected: ${r.projectIntel?.detected ? r.projectIntel.frameworkLabel : 'none yet'}`,
				`- Architecture blueprint: ${r.architecture ? `${r.architecture.framework} + ${r.architecture.backendStack} (${r.architecture.engineMode})` : 'none yet'}`,
				`- Last build/test: ${r.lastBuildTest ? `${r.lastBuildTest.mode} → ${r.lastBuildTest.status}` : 'not run'}`,
				`- OWASP MASVS security: ${r.securityAudit ? `${r.securityAudit.score}/100` : 'not audited'}`,
				`- Store readiness: ${r.readinessReport ? `${r.readinessReport.overallStatus} (${r.readinessReport.readinessScore}/100)` : 'not assessed'}`,
			].join('\n'),

			// Notebook operations
			read_notebook: (params, result) => {
				const { cells, summary_only, total_cells, kernelspec, nbformat } = result
				if (!cells || cells.length === 0) return 'Notebook is empty.'
				const metaParts = [
					total_cells !== undefined ? `${total_cells} cells` : `${cells.length} cells`,
					nbformat ? `nbformat ${nbformat}` : '',
					kernelspec ? `kernel: ${kernelspec}` : '',
				].filter(Boolean).join(' | ')
				const lines = cells.map((cell: any) => {
					const typeIcon = cell.cell_type === 'code' ? '▶' : '📝'
					const execCount = cell.execution_count !== null && cell.execution_count !== undefined ? ` [${cell.execution_count}]` : ''
					const source = Array.isArray(cell.source) ? cell.source.join('') : String(cell.source ?? '')
					if (summary_only) {
						const firstLine = (source.split('\n').find((l: string) => l.trim().length > 0) ?? '').trim().slice(0, 90)
						const outSummary = cell.outputs && cell.outputs.length > 0
							? ` (${cell.outputs.length} output${cell.outputs.length === 1 ? '' : 's'}: ${cell.outputs.map((o: any) => o.output_type === 'display_data' || o.output_type === 'execute_result' ? Object.keys(o.data || {}).join(',') : o.output_type).join(', ')})`
							: ''
						return `${typeIcon} [${cell.index}] ${cell.cell_type}${execCount}: ${firstLine}${outSummary}`
					}
					const outputStr = cell.outputs && cell.outputs.length > 0
						? '\n  Outputs: ' + cell.outputs.map((o: any) => {
							if (o.output_type === 'stream') return `${o.name}: ${Array.isArray(o.text) ? o.text.join('') : o.text}`
							if (o.output_type === 'execute_result' || o.output_type === 'display_data') return `display: ${JSON.stringify(o.data).slice(0, 220)}`
							if (o.output_type === 'error') return `Error: ${o.ename}: ${o.evalue}`
							return ''
						}).join('; ')
						: ''
					const maxSourceChars = params.cell_index !== undefined ? 4000 : 400
					return `${typeIcon} Cell ${cell.index} (${cell.cell_type})${execCount}:\n${source.slice(0, maxSourceChars)}${source.length > maxSourceChars ? '...' : ''}${outputStr}`
				})
				return `Notebook: ${params.uri.fsPath} (${metaParts})\n${lines.join('\n')}`
			},
			write_notebook: (params, result) => {
				const openNote = result.opened ? ' and opened in native Notebook Editor' : ''
				if (result.execution_results && result.execution_results.length > 0) {
					const ok = result.execution_results.filter(r => r.success).length
					const failed = result.execution_results.length - ok
					const lines = result.execution_results.map(r => `${r.success ? '✅' : '❌'} Cell ${r.cell_index}: ${r.execution_time}ms${r.error ? ` - ${r.error}` : ''}`)
					return `Notebook written to ${params.uri.fsPath} (${result.cell_count} cells)${openNote} and executed (${ok} succeeded, ${failed} failed):\n${lines.join('\n')}`
				}
				return `Notebook written to ${params.uri.fsPath} (${result.cell_count} cells)${openNote}.`
			},
			edit_notebook: (params, result) => {
				const failStr = result.failed && result.failed.length > 0
					? `\nFailed operations:\n${result.failed.map(f => `  - op ${f.op_index} (${f.type}): ${f.error}`).join('\n')}`
					: ''
				const outline = result.cells_summary && result.cells_summary.length > 0
					? `\nUpdated cells:\n${result.cells_summary.map(c => `  [${c.index}] ${c.cell_type}${c.execution_count !== null ? ` [${c.execution_count}]` : ''}: ${c.preview || '(empty)'}${c.output_count > 0 ? ` (${c.output_types.join(', ')})` : ''}`).join('\n')}`
					: ''
				return `Applied ${result.applied} notebook edit operation(s) to ${params.uri.fsPath} (now ${result.cell_count} cells${result.opened ? ', synced in Notebook Editor' : ''}).${failStr}${outline}`
			},
			execute_notebook_cell: (params, result) => {
				const { cell_index, outputs, execution_time, execution_count, success, error } = result
				const countTag = execution_count !== null && execution_count !== undefined ? ` [${execution_count}]` : ''
				if (!success) return `Cell ${cell_index}${countTag} execution failed (${execution_time}ms): ${error}`
				const outputStr = outputs && outputs.length > 0
					? outputs.map((o: any) => {
						if (o.output_type === 'stream') return `${o.name}: ${Array.isArray(o.text) ? o.text.join('') : o.text}`
						if (o.output_type === 'execute_result' || o.output_type === 'display_data') return `display: ${JSON.stringify(o.data).slice(0, 220)}`
						if (o.output_type === 'error') return `Error: ${o.ename}: ${o.evalue}\n${o.traceback?.join('\n') || ''}`
						return ''
					}).join('\n')
					: '(no output)'
				return `Cell ${cell_index}${countTag} executed in ${execution_time}ms:\n${outputStr}`
			},
			execute_notebook: (params, result) => {
				const { results, restarted, saved } = result
				const successful = results.filter((r: any) => r.success).length
				const failed = results.filter((r: any) => !r.success).length
				const lines = results.map((r: any) => {
					const status = r.success ? '✅' : '❌'
					const preview = r.outputs && r.outputs.length > 0
						? ' → ' + r.outputs.map((o: any) => {
							if (o.output_type === 'stream') return String(Array.isArray(o.text) ? o.text.join('') : o.text).trim().slice(0, 80)
							if (o.output_type === 'display_data') return Object.keys(o.data || {}).join(', ')
							if (o.output_type === 'error') return `${o.ename}: ${o.evalue}`
							return ''
						}).filter(Boolean).join(' | ')
						: ''
					return `${status} Cell ${r.cell_index}: ${r.execution_time}ms${r.error ? ` - ${r.error}` : preview}`
				})
				const meta = [restarted ? 'kernel restarted' : '', saved ? 'saved to disk' : ''].filter(Boolean).join(', ')
				return `Notebook execution complete${meta ? ` (${meta})` : ''}: ${successful} succeeded, ${failed} failed.\n${lines.join('\n')}`
			},
			restart_notebook_kernel: (params, result) => {
				if (result.execution_results) {
					const ok = result.execution_results.filter(r => r.success).length
					const failed = result.execution_results.length - ok
					return `Kernel restarted for ${params.uri.fsPath} and re-ran all cells (${ok} succeeded, ${failed} failed${result.saved ? ', saved to disk' : ''}).`
				}
				return `Kernel restarted for ${params.uri.fsPath} (variables cleared, execution count reset).`
			},
			interrupt_notebook_kernel: (params) => {
				return `Interrupted running kernel for ${params.uri.fsPath}.`
			},
			search_notebook: (params, result) => {
				if (result.total_matches === 0) {
					return `No matches for "${params.query}" in ${params.uri.fsPath}.`
				}
				const lines = result.matches.slice(0, 50).map((m, idx) =>
					`  #${idx} Cell ${m.cell_index} (${m.cell_type}${m.in_output ? ' output' : ''}) L${m.line}:${m.column} — ${m.preview}`
				)
				const selectedNote = result.selected_cell_index !== undefined ? `\nFocused cell ${result.selected_cell_index} in Notebook Editor.` : ''
				return `Found ${result.total_matches} match(es) for "${params.query}" in ${params.uri.fsPath}:\n${lines.join('\n')}${selectedNote}`
			},
			validate_notebook: (params, result) => {
				const header = `${result.valid ? '✅ Valid' : '❌ Invalid'} notebook: ${params.uri.fsPath} (nbformat ${result.nbformat}, ${result.cell_count} cells: ${result.code_cells} code, ${result.markdown_cells} markdown, ${result.executed_cells} executed, kernelspec: ${result.kernelspec_name ?? 'missing'})`
				if (result.issues.length === 0) return `${header}\nNo issues found.`
				const issueLines = result.issues.map(i => `  - [${i.severity.toUpperCase()}]${i.cell_index !== undefined ? ` Cell ${i.cell_index}:` : ''} ${i.message}`)
				return `${header}\nIssues:\n${issueLines.join('\n')}`
			},
			select_notebook_kernel: (params, result) => {
				return `Kernel set to ${result.kernel_id} for ${params.uri.fsPath}.`
			},
			list_notebook_kernels: (params, result) => {
				const { kernels } = result
				if (!kernels || kernels.length === 0) return 'No kernels available.'
				const lines = kernels.map((k: any) => `${k.id}: ${k.name}${k.description ? ` - ${k.description}` : ''} (languages: ${k.supported_languages.join(', ')})${k.is_preferred ? ' ⭐' : ''}`)
				return `Available kernels:\n${lines.join('\n')}`
			},

		}
	}
	private async _waitForFreshLintErrors(uri: URI, maxWaitMs = 550): Promise<void> {
		// Skip waiting completely for non-code / plain-text files that never produce language-server diagnostics
		const lowerPath = uri.path.toLowerCase()
		if (/\.(?:md|markdown|txt|log|csv|tsv|env|gitignore|dockerignore|lock|svg|png|jpg|jpeg|gif|webp|ico|pdf|toml|ini|conf|cfg)$/.test(lowerPath)) {
			return
		}
		if (!this.voidSettingsService.state.globalSettings.includeToolLintErrors) {
			return
		}
		// Resolve immediately once the language server publishes fresh markers for this URI, or after maxWaitMs
		await new Promise<void>(resolve => {
			let settled = false
			const finish = () => {
				if (settled) return
				settled = true
				clearTimeout(timer)
				sub.dispose()
				resolve()
			}
			const sub = this.markerService.onMarkerChanged(uris => {
				if (uris.some(u => u.toString() === uri.toString())) {
					setTimeout(finish, 40)
				}
			})
			const timer = setTimeout(finish, maxWaitMs)
		})
	}

	private _getLintErrors(uri: URI): { lintErrors: LintErrorItem[] | null } {
		const lintErrors = this.markerService
			.read({ resource: uri })
			.filter(l => l.severity === MarkerSeverity.Error || l.severity === MarkerSeverity.Warning)
			.slice(0, 100)
			.map(l => ({
				code: typeof l.code === 'string' ? l.code : l.code?.value || '',
				message: (l.severity === MarkerSeverity.Error ? '(error) ' : '(warning) ') + l.message,
				startLineNumber: l.startLineNumber,
				endLineNumber: l.endLineNumber,
			} satisfies LintErrorItem))

		if (!lintErrors.length) return { lintErrors: null }
		return { lintErrors, }
	}

}

registerSingleton(IToolsService, ToolsService, InstantiationType.Eager);
