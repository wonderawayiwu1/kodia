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
	IKodiaUniversalAutomationMainService,
	KODIA_UAEP_CHANNEL,
	UaepActivityEvent,
	UaepCodegenTarget,
	UaepCodeSyncReport,
	UaepCompileReport,
	UaepConnectorSpec,
	UaepDeploymentTarget,
	UaepEmbeddedPlatformResult,
	UaepExecutionRecord,
	UaepHostingOptionAssessment,
	UaepNodeTypeSpec,
	UaepOperationsSnapshot,
	UaepPortablePackageResult,
	UaepStepExecutionRecord,
	UaepStudioSection,
	UaepTenantCredentialMeta,
	UaepWorkflowDefinition,
} from '../common/universalAutomationTypes.js';

export const KODIA_OPEN_AUTOMATION_STUDIO_ACTION_ID = 'kodia.openUniversalAutomationStudio';

export interface IUniversalAutomationService {
	readonly _serviceBrand: undefined;
	readonly onDidEmitEvent: Event<UaepActivityEvent>;
	readonly onDidChangeSnapshot: Event<UaepOperationsSnapshot>;
	readonly onDidChangeActiveSection: Event<UaepStudioSection>;

	getActiveSection(): UaepStudioSection;
	setActiveSection(section: UaepStudioSection): void;
	openStudio(section?: UaepStudioSection): Promise<void>;

	getCachedSnapshot(): UaepOperationsSnapshot;
	getSnapshot(tenantId?: string): Promise<UaepOperationsSnapshot>;
	getNodeLibrary(): Promise<readonly UaepNodeTypeSpec[]>;
	getConnectorCatalog(): Promise<readonly UaepConnectorSpec[]>;
	getWorkflowTemplates(): Promise<readonly UaepWorkflowDefinition[]>;
	assessDeploymentTargets(workflowId?: string): Promise<readonly UaepHostingOptionAssessment[]>;

	saveWorkflow(workflow: Omit<UaepWorkflowDefinition, 'id' | 'version' | 'versionHistory' | 'createdAtMs' | 'updatedAtMs'> & { id?: string; versionSummary?: string }): Promise<UaepWorkflowDefinition>;
	deleteWorkflow(workflowId: string, tenantId?: string): Promise<{ deleted: boolean; message: string }>;
	generateWorkflowFromPrompt(req: { prompt: string; tenantId?: string; name?: string }): Promise<{ workflow: UaepWorkflowDefinition; compileReport: UaepCompileReport }>;
	modifyWorkflowFromPrompt(req: { workflowId: string; tenantId?: string; instruction: string }): Promise<{ workflow: UaepWorkflowDefinition; compileReport: UaepCompileReport; changeSummary: string }>;

	compileWorkflow(req: { workflowId: string; tenantId?: string; targetLanguage?: UaepCodegenTarget; writeToDir?: string }): Promise<UaepCompileReport>;
	checkWorkflowCodeSync(req: { workflowId: string; tenantId?: string; generatedFilePath: string }): Promise<UaepCodeSyncReport>;

	executeWorkflow(req: { workflowId: string; tenantId?: string; triggerInput?: Record<string, unknown>; triggerKind?: string; stopAtBreakpoints?: boolean }): Promise<UaepExecutionRecord>;
	testSingleNode(req: { workflowId: string; nodeId: string; tenantId?: string; sampleInput?: Record<string, unknown> }): Promise<UaepStepExecutionRecord>;
	interruptExecution(executionId: string, tenantId?: string): Promise<UaepExecutionRecord>;
	resumeExecution(req: { executionId: string; tenantId?: string; approvalGranted?: boolean; overrideInput?: Record<string, unknown> }): Promise<UaepExecutionRecord>;

	saveTenantCredential(req: { tenantId: string; name: string; provider: string; envKey: string; secretValue: string }): Promise<UaepTenantCredentialMeta>;
	verifyTenantIsolation(req: { requestingTenantId: string; targetWorkflowId?: string; targetCredentialId?: string }): Promise<{ allowed: boolean; reason: string }>;

	exportPortablePackage(req: { workflowId: string; tenantId?: string; target: UaepDeploymentTarget; outputDir?: string }): Promise<UaepPortablePackageResult>;
	generateEmbeddedPlatform(req: { appName: string; outputDir?: string; multiTenant?: boolean; brandingColor?: string }): Promise<UaepEmbeddedPlatformResult>;
}

export const IUniversalAutomationService = createDecorator<IUniversalAutomationService>('kodiaUniversalAutomationService');

export class UniversalAutomationService extends Disposable implements IUniversalAutomationService {
	readonly _serviceBrand: undefined;

	private readonly _onDidEmitEvent = this._register(new Emitter<UaepActivityEvent>());
	readonly onDidEmitEvent = this._onDidEmitEvent.event;

	private readonly _onDidChangeSnapshot = this._register(new Emitter<UaepOperationsSnapshot>());
	readonly onDidChangeSnapshot = this._onDidChangeSnapshot.event;

	private readonly _onDidChangeActiveSection = this._register(new Emitter<UaepStudioSection>());
	readonly onDidChangeActiveSection = this._onDidChangeActiveSection.event;

	private readonly mainService: IKodiaUniversalAutomationMainService;
	private _activeSection: UaepStudioSection = 'canvas';
	private _snapshot: UaepOperationsSnapshot;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super();
		this.mainService = ProxyChannel.toService<IKodiaUniversalAutomationMainService>(mainProcessService.getChannel(KODIA_UAEP_CHANNEL));
		this._snapshot = {
			workspaceRoot: this._root(),
			activeTenantId: 'default',
			totalWorkflows: 0,
			activeWorkflows: 0,
			totalExecutions: 0,
			completedExecutions: 0,
			failedExecutions: 0,
			pausedOrWaitingExecutions: 0,
			deadLetterCount: 0,
			workerHealth: { status: 'healthy', activeWorkers: 1, persistenceMode: 'file_durable_json' },
			totalAiTokensUsed: 0,
			workflows: [],
			recentExecutions: [],
			credentials: [],
			recentAuditLogs: [],
			recentEvents: [],
			updatedAtMs: Date.now(),
		};

		this._register(this.mainService.onDidEmitEvent(ev => this._onDidEmitEvent.fire(ev)));
		this._register(this.mainService.onDidChangeSnapshot(s => {
			this._snapshot = s;
			this._onDidChangeSnapshot.fire(s);
		}));

		if (this._root()) {
			void this.getSnapshot();
		}
	}

	private _root(): string {
		return this.workspaceContextService.getWorkspace().folders[0]?.uri.fsPath ?? '';
	}

	getActiveSection(): UaepStudioSection { return this._activeSection; }
	setActiveSection(section: UaepStudioSection): void {
		this._activeSection = section;
		this._onDidChangeActiveSection.fire(section);
	}
	async openStudio(section?: UaepStudioSection): Promise<void> {
		if (section) this.setActiveSection(section);
		await this.commandService.executeCommand(KODIA_OPEN_AUTOMATION_STUDIO_ACTION_ID);
	}
	getCachedSnapshot(): UaepOperationsSnapshot { return this._snapshot; }

	async getSnapshot(tenantId = 'default'): Promise<UaepOperationsSnapshot> {
		try {
			const s = await this.mainService.getSnapshot(this._root(), tenantId);
			this._snapshot = s;
			this._onDidChangeSnapshot.fire(s);
			return s;
		} catch {
			return this._snapshot;
		}
	}
	async getNodeLibrary(): Promise<readonly UaepNodeTypeSpec[]> { return this.mainService.getNodeLibrary(); }
	async getConnectorCatalog(): Promise<readonly UaepConnectorSpec[]> { return this.mainService.getConnectorCatalog(); }
	async getWorkflowTemplates(): Promise<readonly UaepWorkflowDefinition[]> { return this.mainService.getWorkflowTemplates(); }
	async assessDeploymentTargets(workflowId?: string): Promise<readonly UaepHostingOptionAssessment[]> { return this.mainService.assessDeploymentTargets(this._root(), workflowId); }
	async saveWorkflow(workflow: Omit<UaepWorkflowDefinition, 'id' | 'version' | 'versionHistory' | 'createdAtMs' | 'updatedAtMs'> & { id?: string; versionSummary?: string }): Promise<UaepWorkflowDefinition> { return this.mainService.saveWorkflow(this._root(), workflow); }
	async deleteWorkflow(workflowId: string, tenantId = 'default'): Promise<{ deleted: boolean; message: string }> { return this.mainService.deleteWorkflow(this._root(), workflowId, tenantId); }
	async generateWorkflowFromPrompt(req: { prompt: string; tenantId?: string; name?: string }): Promise<{ workflow: UaepWorkflowDefinition; compileReport: UaepCompileReport }> { return this.mainService.generateWorkflowFromPrompt(this._root(), req); }
	async modifyWorkflowFromPrompt(req: { workflowId: string; tenantId?: string; instruction: string }): Promise<{ workflow: UaepWorkflowDefinition; compileReport: UaepCompileReport; changeSummary: string }> { return this.mainService.modifyWorkflowFromPrompt(this._root(), req); }
	async compileWorkflow(req: { workflowId: string; tenantId?: string; targetLanguage?: UaepCodegenTarget; writeToDir?: string }): Promise<UaepCompileReport> { return this.mainService.compileWorkflow(this._root(), req); }
	async checkWorkflowCodeSync(req: { workflowId: string; tenantId?: string; generatedFilePath: string }): Promise<UaepCodeSyncReport> { return this.mainService.checkWorkflowCodeSync(this._root(), req); }
	async executeWorkflow(req: { workflowId: string; tenantId?: string; triggerInput?: Record<string, unknown>; triggerKind?: string; stopAtBreakpoints?: boolean }): Promise<UaepExecutionRecord> { return this.mainService.executeWorkflow(this._root(), req); }
	async testSingleNode(req: { workflowId: string; nodeId: string; tenantId?: string; sampleInput?: Record<string, unknown> }): Promise<UaepStepExecutionRecord> { return this.mainService.testSingleNode(this._root(), req); }
	async interruptExecution(executionId: string, tenantId = 'default'): Promise<UaepExecutionRecord> { return this.mainService.interruptExecution(this._root(), executionId, tenantId); }
	async resumeExecution(req: { executionId: string; tenantId?: string; approvalGranted?: boolean; overrideInput?: Record<string, unknown> }): Promise<UaepExecutionRecord> { return this.mainService.resumeExecution(this._root(), req); }
	async saveTenantCredential(req: { tenantId: string; name: string; provider: string; envKey: string; secretValue: string }): Promise<UaepTenantCredentialMeta> { return this.mainService.saveTenantCredential(this._root(), req); }
	async verifyTenantIsolation(req: { requestingTenantId: string; targetWorkflowId?: string; targetCredentialId?: string }): Promise<{ allowed: boolean; reason: string }> { return this.mainService.verifyTenantIsolation(this._root(), req); }
	async exportPortablePackage(req: { workflowId: string; tenantId?: string; target: UaepDeploymentTarget; outputDir?: string }): Promise<UaepPortablePackageResult> { return this.mainService.exportPortablePackage(this._root(), req); }
	async generateEmbeddedPlatform(req: { appName: string; outputDir?: string; multiTenant?: boolean; brandingColor?: string }): Promise<UaepEmbeddedPlatformResult> { return this.mainService.generateEmbeddedPlatform(this._root(), req); }
}

registerSingleton(IUniversalAutomationService, UniversalAutomationService, InstantiationType.Delayed);
