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
	KODIA_ARPEI_SIDEBAR_VIEW_ID,
	KODIA_ARPEI_VIEW_CONTAINER_ID,
	KODIA_OPEN_ARPEI_ACTION_ID,
} from './arpeiService.js';
import { mountArpeiSidebar, mountArpeiWorkbench } from './react/out/arpei-tsx/index.js';

export class ArpeiWorkbenchInput extends EditorInput {
	static readonly ID = 'workbench.input.kodia.arpei';
	static readonly RESOURCE = URI.from({ scheme: 'kodia-arpei', path: '/research' });
	readonly resource = ArpeiWorkbenchInput.RESOURCE;

	override get typeId(): string { return ArpeiWorkbenchInput.ID; }
	override getName(): string { return nls.localize('kodiaArpeiName', 'Kodia Research Intelligence (ARPEI)'); }
	override getIcon() { return Codicon.compass; }
}

export class ArpeiWorkbenchPane extends EditorPane {
	static readonly ID = 'workbench.pane.kodia.arpei';
	private _root: HTMLElement | undefined;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super(ArpeiWorkbenchPane.ID, group, telemetryService, themeService, storageService);
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
			const disposeFn = mountArpeiWorkbench(root, accessor)?.dispose;
			this._register(toDisposable(() => disposeFn?.()));
		});
	}

	layout(dimension: Dimension): void {
		if (this._root) {
			this._root.style.width = `${dimension.width}px`;
			this._root.style.height = `${dimension.height}px`;
		}
	}
	override get minimumWidth() { return 520; }
}

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(ArpeiWorkbenchPane, ArpeiWorkbenchPane.ID, nls.localize('kodiaArpeiPane', 'Kodia Autonomous Research-to-Product Intelligence (ARPEI)')),
	[new SyncDescriptor(ArpeiWorkbenchInput)],
);

class ArpeiSidebarViewPane extends ViewPane {
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
			const disposeFn = mountArpeiSidebar(root, accessor)?.dispose;
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

const arpeiContainer = viewContainerRegistry.registerViewContainer({
	id: KODIA_ARPEI_VIEW_CONTAINER_ID,
	title: nls.localize2('kodiaArpeiContainer', 'Research Intelligence'),
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [KODIA_ARPEI_VIEW_CONTAINER_ID, {
		mergeViewWithContainerWhenSingleView: true,
		orientation: Orientation.VERTICAL,
	}]),
	icon: Codicon.compass,
	order: 6,
	hideIfEmpty: false,
	storageId: 'workbench.view.kodiaArpei.state',
}, ViewContainerLocation.Sidebar);

viewsRegistry.registerViews([{
	id: KODIA_ARPEI_SIDEBAR_VIEW_ID,
	name: nls.localize2('kodiaArpeiSidebarView', 'Research & Product Discovery'),
	ctorDescriptor: new SyncDescriptor(ArpeiSidebarViewPane),
	canToggleVisibility: true,
	canMoveView: true,
	hideByDefault: false,
	order: 1,
}], arpeiContainer);

registerAction2(class OpenKodiaArpeiAction extends Action2 {
	constructor() {
		super({
			id: KODIA_OPEN_ARPEI_ACTION_ID,
			title: nls.localize2('kodiaOpenArpei', 'Kodia: Open Research-to-Product Intelligence (ARPEI)'),
			f1: true,
			icon: Codicon.compass,
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyP,
				weight: KeybindingWeight.WorkbenchContrib,
			},
			menu: [{ id: MenuId.LayoutControlMenuSubmenu, group: 'z_end' }],
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const editorGroupService = accessor.get(IEditorGroupsService);
		const instantiationService = accessor.get(IInstantiationService);
		const open = editorService.findEditors(ArpeiWorkbenchInput.RESOURCE);
		if (open.length > 0) {
			await editorGroupService.activeGroup.openEditor(open[0].editor);
			return;
		}
		const input = instantiationService.createInstance(ArpeiWorkbenchInput);
		await editorGroupService.activeGroup.openEditor(input);
	}
});
