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
import { KODIA_OPEN_CORRECTNESS_HUB_ACTION_ID } from './correctnessService.js';
import { mountCorrectnessHub } from './react/out/correctness-hub-tsx/index.js';

export class CorrectnessHubInput extends EditorInput {
	static readonly ID = 'workbench.input.kodia.correctnessHub';
	static readonly RESOURCE = URI.from({ scheme: 'kodia-correctness', path: '/hub' });
	readonly resource = CorrectnessHubInput.RESOURCE;

	override get typeId(): string { return CorrectnessHubInput.ID; }
	override getName(): string { return nls.localize('kodiaCorrectnessHubName', 'Kodia Debugging & Correctness Hub'); }
	override getIcon() { return Codicon.shield; }
}

export class CorrectnessHubPane extends EditorPane {
	static readonly ID = 'workbench.pane.kodia.correctnessHub';

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super(CorrectnessHubPane.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		parent.style.height = '100%';
		parent.style.width = '100%';
		const root = document.createElement('div');
		root.style.height = '100%';
		root.style.width = '100%';
		parent.appendChild(root);

		this.instantiationService.invokeFunction(accessor => {
			const disposeFn = mountCorrectnessHub(root, accessor)?.dispose;
			this._register(toDisposable(() => disposeFn?.()));
		});
	}

	layout(_dimension: Dimension): void { /* responsive flex layout */ }
	override get minimumWidth() { return 640; }
}

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(CorrectnessHubPane, CorrectnessHubPane.ID, nls.localize('kodiaCorrectnessHubPane', 'Kodia Debugging & Correctness Hub')),
	[new SyncDescriptor(CorrectnessHubInput)],
);

registerAction2(class OpenKodiaCorrectnessHubAction extends Action2 {
	constructor() {
		super({
			id: KODIA_OPEN_CORRECTNESS_HUB_ACTION_ID,
			title: nls.localize2('kodiaOpenCorrectnessHub', 'Kodia: Open Deep Debugging & Correctness Hub'),
			f1: true,
			icon: Codicon.shield,
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyD,
				weight: KeybindingWeight.WorkbenchContrib,
			},
			menu: [{ id: MenuId.LayoutControlMenuSubmenu, group: 'z_end' }],
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const editorGroupService = accessor.get(IEditorGroupsService);
		const instantiationService = accessor.get(IInstantiationService);
		const open = editorService.findEditors(CorrectnessHubInput.RESOURCE);
		if (open.length > 0) {
			await editorGroupService.activeGroup.openEditor(open[0].editor);
			return;
		}
		const input = instantiationService.createInstance(CorrectnessHubInput);
		await editorGroupService.activeGroup.openEditor(input);
	}
});
