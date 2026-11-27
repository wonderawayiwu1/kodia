/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Dimension } from '../../../../base/browser/dom.js';
import { Orientation } from '../../../../base/browser/ui/sash/sash.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { toDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import * as nls from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IViewPaneOptions, ViewPane } from '../../../browser/parts/views/viewPane.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { EditorExtensions } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import {
	Extensions as ViewContainerExtensions,
	Extensions as ViewExtensions,
	IViewContainersRegistry,
	IViewDescriptorService,
	IViewsRegistry,
	ViewContainerLocation,
} from '../../../common/views.js';
import { IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import {
	KODIA_CODE_REVIEW_SIDEBAR_VIEW_ID,
	KODIA_CODE_REVIEW_VIEW_CONTAINER_ID,
	KODIA_LIVE_REVIEW_CONTAINER_ID,
	KODIA_LIVE_REVIEW_VIEW_ID,
	KODIA_OPEN_CODE_REVIEW_ACTION_ID,
	KODIA_TOGGLE_CODE_REVIEW_ACTION_ID,
} from './codeReviewService.js';
import {
	mountCodeReviewLivePanel,
	mountCodeReviewSidebar,
	mountCodeReviewWorkbench,
} from './react/out/code-review-tsx/index.js';

// ============================================================================
// 1. Full-Page Native Code Review Workbench Editor (Part 4.2)
// ============================================================================

export class CodeReviewWorkbenchInput extends EditorInput {
	static readonly ID = 'workbench.input.kodia.codeReview';
	static readonly RESOURCE = URI.from({ scheme: 'kodia-code-review', path: '/workbench' });
	readonly resource = CodeReviewWorkbenchInput.RESOURCE;

	override get typeId(): string {
		return CodeReviewWorkbenchInput.ID;
	}

	override getName(): string {
		return nls.localize('kodiaCodeReviewInputName', 'Kodia Code Review (KACRAE)');
	}

	override getIcon() {
		return Codicon.shield;
	}
}

export class CodeReviewWorkbenchPane extends EditorPane {
	static readonly ID = 'workbench.pane.kodia.codeReview';
	private _root: HTMLElement | undefined;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super(CodeReviewWorkbenchPane.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		parent.style.height = '100%';
		parent.style.width = '100%';
		parent.style.overflow = 'hidden';
		const root = document.createElement('div');
		root.style.height = '100%';
		root.style.width = '100%';
		root.style.overflow = 'hidden';
		root.style.position = 'relative';
		parent.appendChild(root);
		this._root = root;

		this.instantiationService.invokeFunction(accessor => {
			const disposeFn = mountCodeReviewWorkbench(root, accessor)?.dispose;
			this._register(toDisposable(() => disposeFn?.()));
		});
	}

	layout(dimension: Dimension): void {
		if (this._root) {
			this._root.style.width = `${dimension.width}px`;
			this._root.style.height = `${dimension.height}px`;
		}
	}

	override get minimumWidth() {
		return 520;
	}
}

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		CodeReviewWorkbenchPane,
		CodeReviewWorkbenchPane.ID,
		nls.localize('kodiaCodeReviewPane', 'Kodia Autonomous Code Review & Software Assurance Engine'),
	),
	[new SyncDescriptor(CodeReviewWorkbenchInput)],
);

// ============================================================================
// 2. Permanent Activity Bar Entry & Sidebar Explorer View (Part 4.1)
// ============================================================================

class CodeReviewSidebarViewPane extends ViewPane {
	private _bodyRoot: HTMLElement | undefined;

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(parent: HTMLElement): void {
		super.renderBody(parent);
		parent.style.height = '100%';
		parent.style.width = '100%';
		parent.style.overflow = 'hidden';
		parent.style.userSelect = 'text';
		const root = document.createElement('div');
		root.style.height = '100%';
		root.style.width = '100%';
		root.style.overflow = 'hidden';
		root.style.display = 'flex';
		root.style.flexDirection = 'column';
		parent.appendChild(root);
		this._bodyRoot = root;

		this.instantiationService.invokeFunction(accessor => {
			const disposeFn = mountCodeReviewSidebar(root, accessor)?.dispose;
			this._register(toDisposable(() => disposeFn?.()));
		});
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		if (this._bodyRoot) {
			this._bodyRoot.style.height = `${height}px`;
			this._bodyRoot.style.width = `${width}px`;
		}
	}
}

const viewContainerRegistry = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry);
const viewsRegistry = Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry);

const activityBarContainer = viewContainerRegistry.registerViewContainer({
	id: KODIA_CODE_REVIEW_VIEW_CONTAINER_ID,
	title: nls.localize2('kodiaCodeReviewActivityBar', 'Code Review'),
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [KODIA_CODE_REVIEW_VIEW_CONTAINER_ID, {
		mergeViewWithContainerWhenSingleView: true,
		orientation: Orientation.VERTICAL,
	}]),
	icon: Codicon.shield,
	order: 5,
	hideIfEmpty: false,
	storageId: 'workbench.view.kodiaCodeReview.state',
}, ViewContainerLocation.Sidebar);

viewsRegistry.registerViews([{
	id: KODIA_CODE_REVIEW_SIDEBAR_VIEW_ID,
	name: nls.localize2('kodiaCodeReviewSidebarView', 'Code Review (KACRAE)'),
	ctorDescriptor: new SyncDescriptor(CodeReviewSidebarViewPane),
	canToggleVisibility: true,
	canMoveView: true,
	hideByDefault: false,
	order: 1,
}], activityBarContainer);

// ============================================================================
// 3. Persistent Live Review Panel in Auxiliary Bar (Part 4.6)
// ============================================================================

class CodeReviewLivePanelViewPane extends ViewPane {
	private _bodyRoot: HTMLElement | undefined;

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(parent: HTMLElement): void {
		super.renderBody(parent);
		parent.style.height = '100%';
		parent.style.width = '100%';
		parent.style.overflow = 'hidden';
		parent.style.userSelect = 'text';
		const root = document.createElement('div');
		root.style.height = '100%';
		root.style.width = '100%';
		root.style.overflow = 'hidden';
		root.style.display = 'flex';
		root.style.flexDirection = 'column';
		parent.appendChild(root);
		this._bodyRoot = root;

		this.instantiationService.invokeFunction(accessor => {
			const disposeFn = mountCodeReviewLivePanel(root, accessor)?.dispose;
			this._register(toDisposable(() => disposeFn?.()));
		});
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		if (this._bodyRoot) {
			this._bodyRoot.style.height = `${height}px`;
			this._bodyRoot.style.width = `${width}px`;
		}
	}
}

const liveReviewContainer = viewContainerRegistry.registerViewContainer({
	id: KODIA_LIVE_REVIEW_CONTAINER_ID,
	title: nls.localize2('kodiaLiveReviewContainer', 'Live Review'),
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [KODIA_LIVE_REVIEW_CONTAINER_ID, {
		mergeViewWithContainerWhenSingleView: true,
		orientation: Orientation.VERTICAL,
	}]),
	icon: Codicon.pulse,
	order: 2,
	hideIfEmpty: false,
}, ViewContainerLocation.AuxiliaryBar);

viewsRegistry.registerViews([{
	id: KODIA_LIVE_REVIEW_VIEW_ID,
	name: nls.localize2('kodiaLiveReviewPanel', 'Live Code Review'),
	ctorDescriptor: new SyncDescriptor(CodeReviewLivePanelViewPane),
	canToggleVisibility: true,
	canMoveView: true,
	hideByDefault: false,
	order: 1,
}], liveReviewContainer);

// ============================================================================
// 4. Open / Toggle Workbench Actions
// ============================================================================

registerAction2(class OpenKodiaCodeReviewAction extends Action2 {
	constructor() {
		super({
			id: KODIA_OPEN_CODE_REVIEW_ACTION_ID,
			title: nls.localize2('kodiaOpenCodeReview', 'Kodia: Open Code Review Workbench (KACRAE)'),
			f1: true,
			icon: Codicon.shield,
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyR,
				weight: KeybindingWeight.WorkbenchContrib,
			},
			menu: [
				{
					id: MenuId.LayoutControlMenuSubmenu,
					group: 'z_end',
				},
			],
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const editorGroupService = accessor.get(IEditorGroupsService);
		const instantiationService = accessor.get(IInstantiationService);

		const openEditors = editorService.findEditors(CodeReviewWorkbenchInput.RESOURCE);
		if (openEditors.length > 0) {
			await editorGroupService.activeGroup.openEditor(openEditors[0].editor);
			return;
		}
		const input = instantiationService.createInstance(CodeReviewWorkbenchInput);
		await editorGroupService.activeGroup.openEditor(input);
	}
});

registerAction2(class ToggleKodiaCodeReviewAction extends Action2 {
	constructor() {
		super({
			id: KODIA_TOGGLE_CODE_REVIEW_ACTION_ID,
			title: nls.localize2('kodiaToggleCodeReview', 'Kodia: Toggle Code Review Workbench'),
			f1: true,
			icon: Codicon.shield,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const editorGroupService = accessor.get(IEditorGroupsService);
		const instantiationService = accessor.get(IInstantiationService);

		const openEditors = editorService.findEditors(CodeReviewWorkbenchInput.RESOURCE);
		if (openEditors.length > 0) {
			const openEditor = openEditors[0].editor;
			const isActive = editorService.activeEditor?.resource?.toString() === openEditor.resource?.toString();
			if (isActive) {
				await editorService.closeEditors(openEditors);
			} else {
				await editorGroupService.activeGroup.openEditor(openEditor);
			}
			return;
		}
		const input = instantiationService.createInstance(CodeReviewWorkbenchInput);
		await editorGroupService.activeGroup.openEditor(input);
	}
});

