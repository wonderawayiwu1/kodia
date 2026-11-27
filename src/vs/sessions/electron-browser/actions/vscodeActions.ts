/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../base/common/codicons.js';
import { getWindowId } from '../../../base/browser/dom.js';
import { mainWindow } from '../../../base/browser/window.js';
import { isEqual } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { ServicesAccessor } from '../../../editor/browser/editorExtensions.js';
import { EditorContextKeys } from '../../../editor/common/editorContextKeys.js';
import { localize2 } from '../../../nls.js';
import { Action2 } from '../../../platform/actions/common/actions.js';
import { IRemoteAgentHostService } from '../../../platform/agentHost/common/remoteAgentHostService.js';
import { KeyCode, KeyMod } from '../../../base/common/keyCodes.js';
import { ContextKeyExpr } from '../../../platform/contextkey/common/contextkey.js';
import { IsLinuxContext } from '../../../platform/contextkey/common/contextkeys.js';
import { KeybindingWeight } from '../../../platform/keybinding/common/keybindingsRegistry.js';
import { ITelemetryService } from '../../../platform/telemetry/common/telemetry.js';
import { EditorAreaFocusContext, IsAuxiliaryWindowContext } from '../../../workbench/common/contextkeys.js';
import { IsPhoneLayoutContext, SessionsWelcomeVisibleContext } from '../../common/contextkeys.js';
import { logSessionsInteraction } from '../../common/sessionsTelemetry.js';
import { Menus } from '../../browser/menus.js';
import { ISessionsService } from '../../services/sessions/browser/sessionsService.js';
import { ISessionsProvidersService } from '../../services/sessions/browser/sessionsProvidersService.js';
import { IWorkbenchContribution } from '../../../workbench/common/contributions.js';
import { OpenInVSCodeTitleBarWidget } from '../../browser/widget/openInVSCodeWidget.js';
import { IActionViewItemService } from '../../../platform/actions/browser/actionViewItemService.js';
import { IInstantiationService } from '../../../platform/instantiation/common/instantiation.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { resolveRemoteFolderUri } from '../../browser/openInVSCodeUtils.js';
import { INativeHostService } from '../../../platform/native/common/native.js';
import { IOpenedMainWindow } from '../../../platform/window/common/window.js';
import { isSingleFolderWorkspaceIdentifier } from '../../../platform/workspace/common/workspace.js';
import { OPEN_VSCODE_WINDOW_COMMAND_ID, RETURN_TO_VSCODE_EDITOR_COMMAND_ID, SHOULD_SHOW_RETURN_TO_VSCODE_EDITOR_COMMAND_ID } from '../../common/sessionCommands.js';
import { IActiveSession } from '../../services/sessions/common/sessionsManagement.js';
import { CommandsRegistry, ICommandService } from '../../../platform/commands/common/commands.js';
import { IKodiaWindowsService, KODIA_OPEN_SETTINGS_COMMAND_ID } from '../../../platform/windows/common/kodiaWindows.js';
import { MenuId, MenuRegistry } from '../../../platform/actions/common/actions.js';

export class OpenSessionInVSCodeAction extends Action2 {
	static readonly ID = 'agents.openSessionInVSCode';

	constructor() {
		super({
			id: OpenSessionInVSCodeAction.ID,
			title: localize2('openInVSCode', 'Open in Editor'),
			icon: Codicon.vscodeInsiders,
			precondition: ContextKeyExpr.and(IsAuxiliaryWindowContext.toNegated(), SessionsWelcomeVisibleContext.toNegated()),
			menu: [{
				id: Menus.TitleBarCenterRight,
				group: 'navigation',
				order: 7,
				when: ContextKeyExpr.and(IsAuxiliaryWindowContext.toNegated(), SessionsWelcomeVisibleContext.toNegated(), IsPhoneLayoutContext.negate()),
			}]
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const telemetryService = accessor.get(ITelemetryService);
		logSessionsInteraction(telemetryService, 'openInVSCode');

		const sessionsService = accessor.get(ISessionsService);
		const sessionsProvidersService = accessor.get(ISessionsProvidersService);
		const remoteAgentHostService = accessor.get(IRemoteAgentHostService);
		const nativeHostService = accessor.get(INativeHostService);

		return openSessionInVSCode(nativeHostService, sessionsService.activeSession.get(), sessionsProvidersService, remoteAgentHostService);
	}
}

export async function openSessionInVSCode(
	nativeHostService: INativeHostService,
	session: IActiveSession | undefined,
	sessionsProvidersService: ISessionsProvidersService,
	remoteAgentHostService: IRemoteAgentHostService,
): Promise<void> {
	const folderUris = getSessionFolderUris(session, sessionsProvidersService, remoteAgentHostService);
	if (!folderUris.length) {
		return nativeHostService.openWindow();
	}

	const chatSessionToOpen = getChatSessionToOpenInEditor(session);
	return nativeHostService.openWindow(folderUris.map(folderUri => ({ folderUri })), { forceNewWindow: true, chatSessionToOpen });
}

function getSessionFolderUris(
	session: IActiveSession | undefined,
	sessionsProvidersService: ISessionsProvidersService,
	remoteAgentHostService: IRemoteAgentHostService,
): URI[] {
	return session?.activeChat.get().workspace.get()?.folders.map(folder =>
		resolveRemoteFolderUri(folder.workingDirectory, session.providerId, sessionsProvidersService, remoteAgentHostService)
	) ?? [];
}

/**
 * Provisional sessions remain owned by the Agents composer and may be replaced or disposed, so only materialized sessions are safe to share across windows.
 */
export function getChatSessionToOpenInEditor(session: IActiveSession | undefined): URI | undefined {
	return session?.isCreated.get() ? session.resource : undefined;
}

export class OpenVSCodeWindowAction extends Action2 {
	static readonly ID = OPEN_VSCODE_WINDOW_COMMAND_ID;

	constructor() {
		super({
			id: OpenVSCodeWindowAction.ID,
			// Kodia: a title bar button at the far right, where the IDE has its button to open the Agents window.
			title: localize2('switchToIDE', 'Switch to IDE'),
			icon: Codicon.code,
			f1: true,
			menu: [{
				id: Menus.TitleBarRightLayout,
				group: 'navigation',
				order: 1000, // after the account widget
				when: ContextKeyExpr.and(IsAuxiliaryWindowContext.toNegated(), IsPhoneLayoutContext.negate()),
			}],
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyA,
				weight: KeybindingWeight.WorkbenchContrib,
				// On Linux, Ctrl+Shift+A is Toggle Block Comment, so defer to it in a focused writable editor.
				when: ContextKeyExpr.or(IsLinuxContext.toNegated(), EditorAreaFocusContext.toNegated(), EditorContextKeys.readOnly),
			},
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const nativeHostService = accessor.get(INativeHostService);
		const sessionsService = accessor.get(ISessionsService);
		const sessionsProvidersService = accessor.get(ISessionsProvidersService);
		const remoteAgentHostService = accessor.get(IRemoteAgentHostService);

		await switchToIDE(nativeHostService, getWindowId(mainWindow), sessionsService.activeSession.get(), sessionsProvidersService, remoteAgentHostService);
	}
}

/**
 * Kodia: focuses an editor window, preferring the one showing the active session's folder, and returns its id. When
 * no editor window is open, opens one on the active session's folders (or an empty one when the session has none),
 * and returns the id of that new window.
 */
export async function switchToIDE(
	nativeHostService: INativeHostService,
	currentWindowId: number,
	session: IActiveSession | undefined,
	sessionsProvidersService: ISessionsProvidersService,
	remoteAgentHostService: IRemoteAgentHostService,
): Promise<number | undefined> {
	const windows = await nativeHostService.getWindows({ includeAuxiliaryWindows: false });
	const editorWindows = windows.filter(w => w.id !== currentWindowId);
	if (!editorWindows.length) {
		await openSessionInVSCode(nativeHostService, session, sessionsProvidersService, remoteAgentHostService);
		// the window just opened is the one that wasn't there before
		const windowsAfter = await nativeHostService.getWindows({ includeAuxiliaryWindows: false });
		return windowsAfter.find(w => w.id !== currentWindowId && !windows.some(before => before.id === w.id))?.id;
	}

	const folderUris = getSessionFolderUris(session, sessionsProvidersService, remoteAgentHostService);
	const sessionWindow = editorWindows.find(({ workspace }) => isSingleFolderWorkspaceIdentifier(workspace) && folderUris.some(folderUri => isEqual(folderUri, workspace.uri)));
	const targetWindowId = (sessionWindow ?? editorWindows[0]).id;
	await nativeHostService.focusWindow({ targetWindowId });
	return targetWindowId;
}

// The command behind "Manage Models..." in the chat model picker: MANAGE_CHAT_COMMAND_ID in
// vs/workbench/contrib/chat/common/constants.ts, which the sessions layer can't import.
const MANAGE_MODELS_COMMAND_ID = 'workbench.action.chat.manage';

/**
 * Kodia: opens Kodia's settings, where its models are set up, in the editor window Switch to IDE goes to.
 * The Agents Window doesn't load Kodia's contribution, so its settings only exist in editor windows.
 */
export async function openKodiaSettingsInIDE(
	nativeHostService: INativeHostService,
	kodiaWindowsService: IKodiaWindowsService,
	currentWindowId: number,
	session: IActiveSession | undefined,
	sessionsProvidersService: ISessionsProvidersService,
	remoteAgentHostService: IRemoteAgentHostService,
): Promise<void> {
	const windowId = await switchToIDE(nativeHostService, currentWindowId, session, sessionsProvidersService, remoteAgentHostService);
	if (windowId !== undefined) {
		await kodiaWindowsService.openSettingsInWindow(windowId);
	}
}

const KODIA_STUDIOS_SUBMENU_ID = new MenuId('SessionsKodiaStudiosSubmenu');

const KODIA_SESSIONS_STUDIO_ITEMS: readonly { readonly id: string; readonly title: string; readonly icon: typeof Codicon.settingsGear; readonly order: number }[] = [
	{ id: KODIA_OPEN_SETTINGS_COMMAND_ID, title: 'Kodia Settings (Models, Providers & All Engines)', icon: Codicon.settingsGear, order: 1 },
	{ id: 'kodia.openUniversalAppBuilder', title: 'Universal App Builder (UABE & IRIRE)', icon: Codicon.rocket, order: 2 },
	{ id: 'kodia.openUniversalAutomationStudio', title: 'Automation Studio (UAEP)', icon: Codicon.circuitBoard, order: 3 },
	{ id: 'workbench.action.kodia.openCodeReview', title: 'Autonomous Code Review & Functional Completeness (KACRAE)', icon: Codicon.shield, order: 4 },
	{ id: 'workbench.action.kodia.openArpeiWorkspace', title: 'Research-to-Product Intelligence (ARPEI)', icon: Codicon.compass, order: 5 },
	{ id: 'kodia.openLiveEngineeringIntelligence', title: 'Live Engineering Intelligence (LEI)', icon: Codicon.radioTower, order: 6 },
	{ id: 'workbench.action.kodia.openApiStudio', title: 'API Engineering Studio', icon: Codicon.globe, order: 7 },
	{ id: 'workbench.action.kodia.openMobileStudio', title: 'Mobile Engineering Studio', icon: Codicon.deviceMobile, order: 8 },
	{ id: 'workbench.action.kodia.openCorrectnessHub', title: 'Deep Debugging & Correctness Hub', icon: Codicon.beaker, order: 9 },
	{ id: 'workbench.action.kodia.openEvolutionHub', title: 'Evolution, Supply-Chain & Ops Hub', icon: Codicon.pulse, order: 10 },
];

/**
 * Kodia:
 * 1. Overrides "Manage Models..." (`workbench.action.chat.manage`) to open Kodia's full
 *    native Settings pane directly inside the Agents Window (falling back to IDE only if unavailable).
 * 2. Contributes a native "Kodia Studios & Settings" launcher to the Agents Window titlebar,
 *    sidebar footer, and account menu so every Kodia setting and engineering studio is 1 click away.
 */
export class KodiaManageModelsContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.kodiaManageModels';

	constructor() {
		super();
		const override = () => this._register(CommandsRegistry.registerCommand(MANAGE_MODELS_COMMAND_ID, async accessor => {
			if (CommandsRegistry.getCommand(KODIA_OPEN_SETTINGS_COMMAND_ID)) {
				await accessor.get(ICommandService).executeCommand(KODIA_OPEN_SETTINGS_COMMAND_ID);
				return;
			}
			await openKodiaSettingsInIDE(
				accessor.get(INativeHostService),
				accessor.get(IKodiaWindowsService),
				getWindowId(mainWindow),
				accessor.get(ISessionsService).activeSession.get(),
				accessor.get(ISessionsProvidersService),
				accessor.get(IRemoteAgentHostService),
			);
		}));
		if (CommandsRegistry.getCommand(MANAGE_MODELS_COMMAND_ID)) {
			override();
		} else {
			const listener = this._register(CommandsRegistry.onDidRegisterCommand(id => {
				if (id === MANAGE_MODELS_COMMAND_ID) {
					listener.dispose();
					override();
				}
			}));
		}

		// Register Kodia Settings + All Engineering Studios natively in the Agents Window menus
		for (const item of KODIA_SESSIONS_STUDIO_ITEMS) {
			this._register(MenuRegistry.appendMenuItem(KODIA_STUDIOS_SUBMENU_ID, {
				command: { id: item.id, title: item.title, icon: item.icon },
				group: item.order === 1 ? '1_settings' : '2_studios',
				order: item.order,
			}));
		}

		// Quick Kodia Settings button in the Agents Window Account menu & Sidebar footer
		this._register(MenuRegistry.appendMenuItem(Menus.AccountMenu, {
			command: {
				id: KODIA_OPEN_SETTINGS_COMMAND_ID,
				title: localize2('kodiaSettingsInAgents', 'Kodia Settings & All Engines'),
				icon: Codicon.sparkle,
			},
			when: IsPhoneLayoutContext.negate(),
			group: '2_settings',
			order: 0,
		}));

		this._register(MenuRegistry.appendMenuItem(Menus.SidebarFooter, {
			submenu: KODIA_STUDIOS_SUBMENU_ID,
			title: localize2('kodiaStudiosFooter', 'Kodia Studios & Settings'),
			icon: Codicon.sparkle,
			group: 'navigation',
			order: 1,
		}));

		// Compact Kodia Studios & Settings dropdown button right beside "Switch to IDE" in the top-right titlebar
		this._register(MenuRegistry.appendMenuItem(Menus.TitleBarRightLayout, {
			submenu: KODIA_STUDIOS_SUBMENU_ID,
			title: localize2('kodiaStudiosTitlebar', 'Kodia Studios & Settings'),
			icon: Codicon.sparkle,
			group: 'navigation',
			order: 990,
			when: ContextKeyExpr.and(IsAuxiliaryWindowContext.toNegated(), IsPhoneLayoutContext.negate()),
		}));
	}
}

export class ReturnToVSCodeEditorAction extends Action2 {

	constructor() {
		super({
			id: RETURN_TO_VSCODE_EDITOR_COMMAND_ID,
			title: localize2('returnToVSCodeEditor', 'Return to VS Code Editor'),
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const nativeHostService = accessor.get(INativeHostService);
		await returnToVSCodeEditor(nativeHostService, getWindowId(mainWindow));
	}
}

export class ShouldShowReturnToVSCodeEditorAction extends Action2 {

	constructor() {
		super({
			id: SHOULD_SHOW_RETURN_TO_VSCODE_EDITOR_COMMAND_ID,
			title: localize2('shouldShowReturnToVSCodeEditor', 'Check Whether to Show Return to VS Code Editor'),
		});
	}

	override async run(accessor: ServicesAccessor): Promise<boolean> {
		const nativeHostService = accessor.get(INativeHostService);
		const windows = await nativeHostService.getWindows({ includeAuxiliaryWindows: false });
		return shouldShowReturnToVSCodeEditor(windows, getWindowId(mainWindow));
	}
}

export function shouldShowReturnToVSCodeEditor(windows: readonly IOpenedMainWindow[], currentWindowId: number): boolean {
	return !windows.some(window => window.id !== currentWindowId);
}

export async function returnToVSCodeEditor(nativeHostService: INativeHostService, currentWindowId: number): Promise<void> {
	await nativeHostService.openWindow();
	await nativeHostService.closeWindow({ targetWindowId: currentWindowId });
}

export class OpenInVSCodeWidgetContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.openInVSCode.widget';

	constructor(
		@IActionViewItemService actionViewItemService: IActionViewItemService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();
		this._register(actionViewItemService.register(Menus.TitleBarCenterRight, OpenSessionInVSCodeAction.ID, (action, options) => {
			return instantiationService.createInstance(OpenInVSCodeTitleBarWidget, action, options, OpenVSCodeWindowAction.ID);
		}, undefined));
	}
}
