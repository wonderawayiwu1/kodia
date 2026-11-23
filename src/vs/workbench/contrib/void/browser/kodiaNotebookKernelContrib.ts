/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { AsyncIterableProducer } from '../../../../base/common/async.js';
import { decodeBase64, VSBuffer } from '../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { dirname } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { localize2 } from '../../../../nls.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IInlineChatSession, IInlineChatSessionService } from '../../inlineChat/browser/inlineChatSessionService.js';
import { IOutputDto, IOutputItemDto } from '../../notebook/common/notebookCommon.js';
import { CellExecutionUpdateType } from '../../notebook/common/notebookExecutionService.js';
import { INotebookExecutionStateService } from '../../notebook/common/notebookExecutionStateService.js';
import {
	INotebookKernel,
	INotebookKernelChangeEvent,
	INotebookKernelService,
	VariablesResult,
} from '../../notebook/common/notebookKernelService.js';
import { INotebookService } from '../../notebook/common/notebookService.js';
import {
	IKodiaNotebookKernelMainService,
	KODIA_NOTEBOOK_KERNEL_CHANNEL,
	KodiaDiscoveredPythonKernel,
	KodiaKernelOutput,
} from '../common/kodiaNotebookKernelTypes.js';


/**
 * Clean no-op IInlineChatSessionService registered because Kodia disables VS Code's built-in Copilot
 * inlineChat contribution (`inlineChat.contribution.ts`), while VS Code's Notebook Editor cell view models
 * (`CodeCellViewModel`, `MarkupCellViewModel`, `EmptyCellEditorHintContribution`) still inject `IInlineChatSessionService`.
 */
export class KodiaNullInlineChatSessionService implements IInlineChatSessionService {
	readonly _serviceBrand: undefined;
	readonly onWillStartSession = Event.None;
	readonly onDidChangeSessions = Event.None;

	async createSession(_editor: ICodeEditor, _isNotebook: boolean, _token: CancellationToken): Promise<IInlineChatSession> {
		throw new Error('VS Code inline chat is disabled in Kodia; use Kodia Quick Edit (Ctrl+K) instead.');
	}

	getSessionByTextModel(_uri: URI): IInlineChatSession | undefined {
		return undefined;
	}

	getSessionBySessionUri(_uri: URI): IInlineChatSession | undefined {
		return undefined;
	}
}

registerSingleton(IInlineChatSessionService, KodiaNullInlineChatSessionService, InstantiationType.Delayed);


const KODIA_PYTHON_EXTENSION_ID = new ExtensionIdentifier('kodia.python-notebook-kernel');

class KodiaPythonNotebookKernel extends Disposable implements INotebookKernel {
	readonly id: string;
	readonly viewType = 'jupyter-notebook';
	readonly extension = KODIA_PYTHON_EXTENSION_ID;
	readonly localResourceRoot: URI;
	readonly preloadUris: URI[] = [];
	readonly preloadProvides: string[] = [];

	private readonly _onDidChange = this._register(new Emitter<Readonly<INotebookKernelChangeEvent>>());
	readonly onDidChange = this._onDidChange.event;

	label: string;
	description?: string;
	detail?: string;
	supportedLanguages = ['python'];
	implementsInterrupt = true;
	implementsExecutionOrder = true;
	hasVariableProvider = true;

	constructor(
		private readonly _info: KodiaDiscoveredPythonKernel,
		private readonly _kernelMain: IKodiaNotebookKernelMainService,
		private readonly _notebookService: INotebookService,
		private readonly _executionStateService: INotebookExecutionStateService,
	) {
		super();
		this.id = _info.id;
		this.label = _info.label;
		this.description = _info.description;
		this.detail = _info.detail;
		this.localResourceRoot = URI.file(_info.pythonPath);
	}

	async executeNotebookCellsRequest(uri: URI, cellHandles: number[]): Promise<void> {
		const notebook = this._notebookService.getNotebookTextModel(uri);
		if (!notebook) {
			return;
		}

		const cwd = uri.scheme === 'file' ? dirname(uri).fsPath : undefined;
		let stopRemaining = false;

		for (const handle of cellHandles) {
			const cell = notebook.cells.find(c => c.handle === handle);
			if (!cell) {
				continue;
			}

			const execution = this._executionStateService.getCellExecution(cell.uri)
				?? this._executionStateService.createCellExecution(uri, handle);

			if (stopRemaining) {
				execution.complete({});
				continue;
			}

			execution.confirm();
			const runStartTime = Date.now();
			execution.update([
				{
					editType: CellExecutionUpdateType.ExecutionState,
					runStartTime,
				},
				{
					editType: CellExecutionUpdateType.Output,
					cellHandle: handle,
					append: false,
					outputs: [],
				},
			]);

			try {
				const res = await this._kernelMain.executeCell({
					notebookUri: uri.toString(),
					pythonPath: this._info.pythonPath,
					cwd,
					code: cell.getValue(),
				});

				const outputDtos: IOutputDto[] = res.outputs.map((out: KodiaKernelOutput) => ({
					outputId: generateUuid(),
					outputs: out.items.map((item): IOutputItemDto => ({
						mime: item.mime,
						data: item.isBase64 ? decodeBase64(item.data) : VSBuffer.fromString(item.data),
					})),
				}));

				execution.update([
					{
						editType: CellExecutionUpdateType.ExecutionState,
						executionOrder: res.executionCount > 0 ? res.executionCount : undefined,
						runStartTime,
					},
					{
						editType: CellExecutionUpdateType.Output,
						cellHandle: handle,
						append: false,
						outputs: outputDtos,
					},
				]);

				execution.complete({
					runEndTime: Date.now(),
					lastRunSuccess: res.success,
				});

				if (!res.success) {
					stopRemaining = true;
				}
			} catch (err) {
				const errMsg = err instanceof Error ? err.message : String(err);
				const errDto: IOutputDto = {
					outputId: generateUuid(),
					outputs: [{
						mime: 'application/vnd.code.notebook.error',
						data: VSBuffer.fromString(JSON.stringify({
							name: 'KernelError',
							message: errMsg,
							stack: err instanceof Error ? (err.stack ?? errMsg) : errMsg,
						})),
					}],
				};
				execution.update([{
					editType: CellExecutionUpdateType.Output,
					cellHandle: handle,
					append: false,
					outputs: [errDto],
				}]);
				execution.complete({
					runEndTime: Date.now(),
					lastRunSuccess: false,
				});
				stopRemaining = true;
			}
		}
	}

	async cancelNotebookCellExecution(uri: URI, cellHandles: number[]): Promise<void> {
		await this._kernelMain.interruptKernel(uri.toString());
		const notebook = this._notebookService.getNotebookTextModel(uri);
		if (notebook) {
			for (const handle of cellHandles) {
				const cell = notebook.cells.find(c => c.handle === handle);
				if (cell) {
					this._executionStateService.getCellExecution(cell.uri)?.complete({
						runEndTime: Date.now(),
						lastRunSuccess: false,
					});
				}
			}
		}
	}

	provideVariables(notebookUri: URI, _parentId: number | undefined, _kind: 'named' | 'indexed', start: number, _token: CancellationToken): AsyncIterableProducer<VariablesResult> {
		return new AsyncIterableProducer<VariablesResult>(async emitter => {
			const vars = await this._kernelMain.getVariables(notebookUri.toString());
			for (let i = start; i < vars.length; i++) {
				const v = vars[i];
				emitter.emitOne({
					id: i + 1,
					name: v.name,
					value: v.value,
					type: v.type,
					hasNamedChildren: false,
					indexedChildrenCount: 0,
				});
			}
		});
	}
}


let activeKernelContribution: KodiaNotebookKernelContribution | undefined;

export class KodiaNotebookKernelContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.kodiaNotebookKernel';

	private readonly _kernelMain: IKodiaNotebookKernelMainService;
	private readonly _registeredKernels = this._register(new DisposableStore());
	private _primaryKernel: KodiaPythonNotebookKernel | undefined;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService,
		@INotebookKernelService private readonly _notebookKernelService: INotebookKernelService,
		@INotebookService private readonly _notebookService: INotebookService,
		@INotebookExecutionStateService private readonly _executionStateService: INotebookExecutionStateService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
	) {
		super();
		this._kernelMain = ProxyChannel.toService<IKodiaNotebookKernelMainService>(
			mainProcessService.getChannel(KODIA_NOTEBOOK_KERNEL_CHANNEL),
		);
		activeKernelContribution = this;

		void this.refreshKernels();

		// Auto-preselect primary Python kernel for newly opened Jupyter notebooks
		this._register(this._notebookService.onDidAddNotebookDocument(notebook => {
			if (notebook.viewType === 'jupyter-notebook' && this._primaryKernel) {
				const existing = this._notebookKernelService.getMatchingKernel(notebook);
				if (!existing.selected) {
					this._notebookKernelService.preselectKernelForNotebook(this._primaryKernel, notebook);
				}
			}
		}));

		// Clean up persistent Python kernel process when notebook closes
		this._register(this._notebookService.onWillRemoveNotebookDocument(notebook => {
			void this._kernelMain.disposeKernel(notebook.uri.toString());
		}));
	}

	async refreshKernels(): Promise<number> {
		const workspaceFolder = this._workspaceContextService.getWorkspace().folders[0]?.uri.fsPath;
		const discovered = await this._kernelMain.discoverKernels(workspaceFolder);

		this._registeredKernels.clear();
		this._primaryKernel = undefined;

		for (const info of discovered) {
			const kernel = this._registeredKernels.add(new KodiaPythonNotebookKernel(
				info,
				this._kernelMain,
				this._notebookService,
				this._executionStateService,
			));
			this._registeredKernels.add(this._notebookKernelService.registerKernel(kernel));
			if (!this._primaryKernel || info.isPreferred) {
				this._primaryKernel = kernel;
			}
		}

		// Preselect for any already-open Jupyter notebooks
		if (this._primaryKernel) {
			for (const nb of this._notebookService.getNotebookTextModels()) {
				if (nb.viewType === 'jupyter-notebook') {
					const matching = this._notebookKernelService.getMatchingKernel(nb);
					if (!matching.selected) {
						this._notebookKernelService.preselectKernelForNotebook(this._primaryKernel, nb);
					}
				}
			}
		}

		return discovered.length;
	}

	async restartKernelForUri(uri: URI): Promise<void> {
		await this._kernelMain.restartKernel(uri.toString());
	}
}

registerWorkbenchContribution2(KodiaNotebookKernelContribution.ID, KodiaNotebookKernelContribution, WorkbenchPhase.AfterRestored);


registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'kodia.notebook.restartKernel',
			title: localize2('kodiaRestartNotebookKernel', 'Kodia: Restart Notebook Kernel'),
			icon: Codicon.debugRestart,
			f1: true,
			menu: [{
				id: MenuId.EditorTitle,
				group: 'navigation',
				order: 50,
				when: ContextKeyExpr.equals('activeEditor', 'workbench.editor.notebook'),
			}],
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const notifService = accessor.get(INotificationService);
		const uri = editorService.activeEditor?.resource;
		if (!uri || !uri.path.endsWith('.ipynb')) {
			notifService.info('Open a .ipynb notebook first to restart its Python kernel.');
			return;
		}
		await activeKernelContribution?.restartKernelForUri(uri);
		notifService.info('Python notebook kernel restarted. All variables have been cleared.');
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'kodia.notebook.refreshKernels',
			title: localize2('kodiaRefreshNotebookKernels', 'Kodia: Refresh Python Notebook Kernels'),
			f1: true,
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const notifService = accessor.get(INotificationService);
		const count = await activeKernelContribution?.refreshKernels() ?? 0;
		notifService.info(count > 0
			? `Discovered ${count} Python notebook kernel${count === 1 ? '' : 's'}.`
			: 'No Python interpreter found in PATH or workspace virtualenvs.');
	}
});
