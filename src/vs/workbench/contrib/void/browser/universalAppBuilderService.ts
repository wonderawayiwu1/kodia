/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import {
	IKodiaUniversalAppBuilderMainService,
	IrireConnectionTestResult,
	IrireExternalRequirement,
	IrireIntegrationMode,
	KODIA_UABE_CHANNEL,
	UabeActivityEvent,
	UabeBriefSourceType,
	UabeBuildMode,
	UabeCheckpointRecord,
	UabeCloudAdapterInfo,
	UabeContractAnalysis,
	UabeHandoverPackageResult,
	UabeInitProjectRequest,
	UabePlatformTarget,
	UabePreviewState,
	UabeProjectState,
	UabeReliabilityDashboardReport,
	UabeScaffoldResult,
	UabeStackRecommendation,
	UabeVisualEditRequest,
	UabeVisualEditResult,
	UabeWorkspaceTab,
} from '../common/universalAppBuilderTypes.js';

export const KODIA_OPEN_APP_BUILDER_ACTION_ID = 'kodia.openUniversalAppBuilder';

export interface IUniversalAppBuilderService {
	readonly _serviceBrand: undefined;
	readonly onDidEmitEvent: Event<UabeActivityEvent>;
	readonly onDidChangeProject: Event<UabeProjectState>;
	readonly onDidChangeActiveTab: Event<UabeWorkspaceTab>;

	getActiveTab(): UabeWorkspaceTab;
	setActiveTab(tab: UabeWorkspaceTab): void;
	openWorkspace(tab?: UabeWorkspaceTab): Promise<void>;

	getCachedProjectState(): UabeProjectState;
	getProjectState(): Promise<UabeProjectState>;
	initializeProject(req: UabeInitProjectRequest): Promise<UabeProjectState>;
	setProjectBuildMode(mode: UabeBuildMode): Promise<UabeProjectState>;
	analyzeContractOrBrief(req: { brief: string; sourceType?: UabeBriefSourceType }): Promise<UabeContractAnalysis>;
	recommendStack(req?: { preferredStack?: string; preferredPlatforms?: readonly UabePlatformTarget[] }): Promise<UabeStackRecommendation>;
	discoverExternalRequirements(briefOverride?: string): Promise<readonly IrireExternalRequirement[]>;
	configureIntegrationSecret(req: { requirementId: string; envVarName: string; secretValue: string; mode?: IrireIntegrationMode }): Promise<{ ok: boolean; requirement?: IrireExternalRequirement; message: string }>;
	testIntegrationConnection(requirementId: string): Promise<IrireConnectionTestResult>;
	listCloudAdapters(): Promise<readonly UabeCloudAdapterInfo[]>;
	applyVisualEdit(req: UabeVisualEditRequest): Promise<UabeVisualEditResult>;
	updatePreviewState(patch: Partial<UabePreviewState>): Promise<UabePreviewState>;
	scaffoldApplication(req: { template: 'website' | 'fullstack_business' | 'ai_app' | 'mobile_rn' | 'desktop_electron'; appName: string }): Promise<UabeScaffoldResult>;
	evaluateReliabilityDashboard(opts?: { runCompiler?: boolean; testCommand?: string; buildCommand?: string }): Promise<UabeReliabilityDashboardReport>;
	generateClientHandover(opts?: { clientName?: string; projectTitle?: string }): Promise<UabeHandoverPackageResult>;
	createCheckpoint(label: string, files: readonly string[]): Promise<UabeCheckpointRecord>;
	rollbackCheckpoint(checkpointId: string): Promise<{ restored: boolean; filesRestored: readonly string[]; message: string }>;
}

export const IUniversalAppBuilderService = createDecorator<IUniversalAppBuilderService>('kodiaUniversalAppBuilderService');

export class UniversalAppBuilderService extends Disposable implements IUniversalAppBuilderService {
	readonly _serviceBrand: undefined;

	private readonly _onDidEmitEvent = this._register(new Emitter<UabeActivityEvent>());
	readonly onDidEmitEvent = this._onDidEmitEvent.event;

	private readonly _onDidChangeProject = this._register(new Emitter<UabeProjectState>());
	readonly onDidChangeProject = this._onDidChangeProject.event;

	private readonly _onDidChangeActiveTab = this._register(new Emitter<UabeWorkspaceTab>());
	readonly onDidChangeActiveTab = this._onDidChangeActiveTab.event;

	private readonly mainService: IKodiaUniversalAppBuilderMainService;
	private _activeTab: UabeWorkspaceTab = 'create';
	private _state: UabeProjectState;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super();
		this.mainService = ProxyChannel.toService<IKodiaUniversalAppBuilderMainService>(mainProcessService.getChannel(KODIA_UABE_CHANNEL));
		const root = this._root();
		const now = Date.now();
		this._state = {
			projectId: 'uabe-init',
			name: root ? root.replace(/\\/g, '/').split('/').pop() || 'Kodia App' : 'Kodia App',
			brief: '',
			workspaceRoot: root,
			buildMode: 'autonomous_build',
			phase: 'idle',
			platforms: ['web'],
			integrations: [],
			preview: {
				url: 'http://localhost:3000',
				status: 'stopped',
				viewport: 'desktop',
				width: 1440,
				height: 900,
				visualEditEnabled: false,
				consoleErrors: [],
				networkFailures: [],
			},
			checkpoints: [],
			recentEvents: [],
			createdAtMs: now,
			updatedAtMs: now,
		};

		this._register(this.mainService.onDidEmitEvent(ev => this._onDidEmitEvent.fire(ev)));
		this._register(this.mainService.onDidChangeProject(state => {
			this._state = state;
			this._onDidChangeProject.fire(state);
		}));

		if (root) {
			void this.getProjectState();
		}
	}

	private _root(): string {
		return this.workspaceContextService.getWorkspace().folders[0]?.uri.fsPath ?? '';
	}

	getActiveTab(): UabeWorkspaceTab { return this._activeTab; }

	setActiveTab(tab: UabeWorkspaceTab): void {
		this._activeTab = tab;
		this._onDidChangeActiveTab.fire(tab);
	}

	async openWorkspace(tab?: UabeWorkspaceTab): Promise<void> {
		if (tab) this.setActiveTab(tab);
		await this.commandService.executeCommand(KODIA_OPEN_APP_BUILDER_ACTION_ID);
	}

	getCachedProjectState(): UabeProjectState { return this._state; }

	async getProjectState(): Promise<UabeProjectState> {
		try {
			const s = await this.mainService.getProjectState(this._root());
			this._state = s;
			this._onDidChangeProject.fire(s);
			return s;
		} catch {
			return this._state;
		}
	}

	async initializeProject(req: UabeInitProjectRequest): Promise<UabeProjectState> {
		const s = await this.mainService.initializeProject(this._root(), req);
		this._state = s;
		this._onDidChangeProject.fire(s);
		return s;
	}

	async setProjectBuildMode(mode: UabeBuildMode): Promise<UabeProjectState> {
		const s = await this.mainService.setProjectBuildMode(this._root(), mode);
		this._state = s;
		this._onDidChangeProject.fire(s);
		return s;
	}

	async analyzeContractOrBrief(req: { brief: string; sourceType?: UabeBriefSourceType }): Promise<UabeContractAnalysis> {
		return this.mainService.analyzeContractOrBrief(this._root(), req);
	}

	async recommendStack(req?: { preferredStack?: string; preferredPlatforms?: readonly UabePlatformTarget[] }): Promise<UabeStackRecommendation> {
		return this.mainService.recommendStack(this._root(), req);
	}

	async discoverExternalRequirements(briefOverride?: string): Promise<readonly IrireExternalRequirement[]> {
		return this.mainService.discoverExternalRequirements(this._root(), briefOverride);
	}

	async configureIntegrationSecret(req: { requirementId: string; envVarName: string; secretValue: string; mode?: IrireIntegrationMode }): Promise<{ ok: boolean; requirement?: IrireExternalRequirement; message: string }> {
		return this.mainService.configureIntegrationSecret(this._root(), req);
	}

	async testIntegrationConnection(requirementId: string): Promise<IrireConnectionTestResult> {
		return this.mainService.testIntegrationConnection(this._root(), requirementId);
	}

	async listCloudAdapters(): Promise<readonly UabeCloudAdapterInfo[]> {
		return this.mainService.listCloudAdapters();
	}

	async applyVisualEdit(req: UabeVisualEditRequest): Promise<UabeVisualEditResult> {
		return this.mainService.applyVisualEdit(this._root(), req);
	}

	async updatePreviewState(patch: Partial<UabePreviewState>): Promise<UabePreviewState> {
		return this.mainService.updatePreviewState(this._root(), patch);
	}

	async scaffoldApplication(req: { template: 'website' | 'fullstack_business' | 'ai_app' | 'mobile_rn' | 'desktop_electron'; appName: string }): Promise<UabeScaffoldResult> {
		return this.mainService.scaffoldApplication(this._root(), req);
	}

	async evaluateReliabilityDashboard(opts?: { runCompiler?: boolean; testCommand?: string; buildCommand?: string }): Promise<UabeReliabilityDashboardReport> {
		return this.mainService.evaluateReliabilityDashboard(this._root(), opts);
	}

	async generateClientHandover(opts?: { clientName?: string; projectTitle?: string }): Promise<UabeHandoverPackageResult> {
		return this.mainService.generateClientHandover(this._root(), opts);
	}

	async createCheckpoint(label: string, files: readonly string[]): Promise<UabeCheckpointRecord> {
		return this.mainService.createCheckpoint(this._root(), label, files);
	}

	async rollbackCheckpoint(checkpointId: string): Promise<{ restored: boolean; filesRestored: readonly string[]; message: string }> {
		return this.mainService.rollbackCheckpoint(this._root(), checkpointId);
	}
}

registerSingleton(IUniversalAppBuilderService, UniversalAppBuilderService, InstantiationType.Delayed);
