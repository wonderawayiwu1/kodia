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
import { KODIA_OPEN_API_STUDIO_ACTION_ID, KODIA_TOGGLE_API_STUDIO_ACTION_ID } from './apiStudioService.js';
import { mountApiStudio } from './react/out/api-studio-tsx/index.js';

export class ApiStudioInput extends EditorInput {
	static readonly ID = 'workbench.input.kodia.apiStudio';
	static readonly RESOURCE = URI.from({ scheme: 'kodia-api-studio', path: '/workspace' });
	readonly resource = ApiStudioInput.RESOURCE;

	override get typeId(): string {
		return ApiStudioInput.ID;
	}

	override getName(): string {
		return nls.localize('kodiaApiStudioInputName', 'Kodia API Studio');
	}

	override getIcon() {
		return Codicon.globe;
	}
}

export class ApiStudioPane extends EditorPane {
	static readonly ID = 'workbench.pane.kodia.apiStudio';

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super(ApiStudioPane.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		parent.style.height = '100%';
		parent.style.width = '100%';

		const root = document.createElement('div');
		root.style.height = '100%';
		root.style.width = '100%';
		parent.appendChild(root);

		this.instantiationService.invokeFunction(accessor => {
			const disposeFn = mountApiStudio(root, accessor)?.dispose;
			this._register(toDisposable(() => disposeFn?.()));
		});
	}

	layout(_dimension: Dimension): void {
		// Responsive flex container adapts automatically to workbench editor pane dimensions
	}

	override get minimumWidth() { return 640; }
}

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(ApiStudioPane, ApiStudioPane.ID, nls.localize('kodiaApiStudioPane', 'Kodia API Engineering Studio')),
	[new SyncDescriptor(ApiStudioInput)],
);

registerAction2(class OpenKodiaApiStudioAction extends Action2 {
	constructor() {
		super({
			id: KODIA_OPEN_API_STUDIO_ACTION_ID,
			title: nls.localize2('kodiaOpenApiStudio', 'Kodia: Open API Engineering Studio'),
			f1: true,
			icon: Codicon.globe,
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyA,
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

		const openEditors = editorService.findEditors(ApiStudioInput.RESOURCE);
		if (openEditors.length > 0) {
			await editorGroupService.activeGroup.openEditor(openEditors[0].editor);
			return;
		}

		const input = instantiationService.createInstance(ApiStudioInput);
		await editorGroupService.activeGroup.openEditor(input);
	}
});

registerAction2(class ToggleKodiaApiStudioAction extends Action2 {
	constructor() {
		super({
			id: KODIA_TOGGLE_API_STUDIO_ACTION_ID,
			title: nls.localize2('kodiaToggleApiStudio', 'Kodia: Toggle API Engineering Studio'),
			f1: true,
			icon: Codicon.globe,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const editorGroupService = accessor.get(IEditorGroupsService);
		const instantiationService = accessor.get(IInstantiationService);

		const openEditors = editorService.findEditors(ApiStudioInput.RESOURCE);
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

		const input = instantiationService.createInstance(ApiStudioInput);
		await editorGroupService.activeGroup.openEditor(input);
	}
});
