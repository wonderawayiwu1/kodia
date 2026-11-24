/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Dimension } from '../../../../base/browser/dom.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { toDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import * as nls from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { EditorExtensions } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { KODIA_OPEN_MOBILE_STUDIO_ACTION_ID } from './mobileEngineeringService.js';
import { mountMobileStudio } from './react/out/mobile-studio-tsx/index.js';

export class MobileStudioInput extends EditorInput {
	static readonly ID = 'workbench.input.kodia.mobileStudio';
	static readonly RESOURCE = URI.from({ scheme: 'kodia-mobile', path: '/studio' });
	readonly resource = MobileStudioInput.RESOURCE;

	override get typeId(): string { return MobileStudioInput.ID; }
	override getName(): string { return nls.localize('kodiaMobileStudioName', 'Kodia Mobile Engineering Studio'); }
	override getIcon() { return Codicon.deviceMobile; }
}

export class MobileStudioPane extends EditorPane {
	static readonly ID = 'workbench.pane.kodia.mobileStudio';

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super(MobileStudioPane.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		parent.style.height = '100%';
		parent.style.width = '100%';
		const root = document.createElement('div');
		root.style.height = '100%';
		root.style.width = '100%';
		parent.appendChild(root);

		this.instantiationService.invokeFunction(accessor => {
			const disposeFn = mountMobileStudio(root, accessor)?.dispose;
			this._register(toDisposable(() => disposeFn?.()));
		});
	}

	layout(_dimension: Dimension): void { /* responsive flex layout */ }
	override get minimumWidth() { return 640; }
}

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(MobileStudioPane, MobileStudioPane.ID, nls.localize('kodiaMobileStudioPane', 'Kodia Mobile Engineering Studio')),
	[new SyncDescriptor(MobileStudioInput)],
);

registerAction2(class OpenKodiaMobileStudioAction extends Action2 {
	constructor() {
		super({
			id: KODIA_OPEN_MOBILE_STUDIO_ACTION_ID,
			title: nls.localize2('kodiaOpenMobileStudio', 'Kodia: Open Mobile Application Engineering Studio'),
			f1: true,
			icon: Codicon.deviceMobile,
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyM,
				weight: KeybindingWeight.WorkbenchContrib,
			},
			menu: [{ id: MenuId.LayoutControlMenuSubmenu, group: 'z_end' }],
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const editorGroupService = accessor.get(IEditorGroupsService);
		const instantiationService = accessor.get(IInstantiationService);
		const open = editorService.findEditors(MobileStudioInput.RESOURCE);
		if (open.length > 0) {
			await editorGroupService.activeGroup.openEditor(open[0].editor);
			return;
		}
		const input = instantiationService.createInstance(MobileStudioInput);
		await editorGroupService.activeGroup.openEditor(input);
	}
});
