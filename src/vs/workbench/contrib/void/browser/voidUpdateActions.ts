/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { IAction } from '../../../../base/common/actions.js';
import * as dom from '../../../../base/browser/dom.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import Severity from '../../../../base/common/severity.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { INativeHostService } from '../../../../platform/native/common/native.js';
import { INotificationActions, INotificationHandle, INotificationService } from '../../../../platform/notification/common/notification.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IUpdateService } from '../../../../platform/update/common/update.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IStatusbarEntryAccessor, IStatusbarService, StatusbarAlignment } from '../../../services/statusbar/browser/statusbar.js';
import { KODIA_RELEASES_URL, KODIA_REPO, KODIA_REPO_URL } from '../common/kodiaLinks.js';
import { IMetricsService } from '../common/metricsService.js';
import { IVoidUpdateService } from '../common/voidUpdateService.js';
import { VoidCheckUpdateRespose } from '../common/voidUpdateServiceTypes.js';


export const KODIA_RESTART_TO_UPDATE_ACTION_ID = 'void.voidRestartToUpdate';

// Register Kodia auto-update configuration settings
Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'kodiaUpdate',
	order: 35,
	title: localize('kodiaUpdateConfigurationTitle', 'Kodia Updates'),
	type: 'object',
	properties: {
		'kodia.update.githubRepo': {
			type: 'string',
			default: KODIA_REPO,
			description: localize('kodiaUpdateGithubRepo', 'GitHub repository (owner/repo) used to check for and download Kodia releases.'),
		},
		'kodia.update.autoDownload': {
			type: 'boolean',
			default: true,
			description: localize('kodiaUpdateAutoDownload', 'Automatically download newer Kodia Windows installers in the background so you can click Restart to Update immediately.'),
		},
		'kodia.update.localInstallerPath': {
			type: 'string',
			default: '',
			description: localize('kodiaUpdateLocalInstallerPath', 'Optional local file or directory path containing a built kodia-installer-x64.exe (and kodia-update.json) so installed Kodia automatically detects local rebuilds and offers Restart to Update.'),
		},
	},
});

const triggerRestartToUpdate = async (
	voidUpdateService: IVoidUpdateService,
	updateService: IUpdateService,
	notifService: INotificationService,
	nativeHostService: INativeHostService,
	source?: 'native' | 'github' | 'local',
): Promise<void> => {
	if (source === 'native') {
		await updateService.quitAndInstall();
		return;
	}
	const result = await voidUpdateService.restartAndApplyUpdate();
	if (!result.launched) {
		notifService.notify({
			severity: Severity.Warning,
			message: result.error || 'No Kodia update is ready to install yet. Run "Kodia: Check for Updates" first.',
		});
		return;
	}
	await nativeHostService.quit();
};

const notifyUpdate = (
	res: VoidCheckUpdateRespose & { message: string },
	notifService: INotificationService,
	updateService: IUpdateService,
	voidUpdateService: IVoidUpdateService,
	nativeHostService: INativeHostService,
): INotificationHandle => {
	const message = res?.message || `This is a very old version of Kodia, please download the latest version! [Kodia Editor](${KODIA_RELEASES_URL})!`;

	let actions: INotificationActions | undefined;

	if (res?.action) {
		const primary: IAction[] = [];

		if (res.action === 'reinstall') {
			primary.push({
				label: `Reinstall`,
				id: 'void.updater.reinstall',
				enabled: true,
				tooltip: '',
				class: undefined,
				run: () => {
					const { window } = dom.getActiveWindow();
					window.open(res.releaseNotesUrl || KODIA_RELEASES_URL);
				}
			});
		}

		if (res.action === 'download') {
			primary.push({
				label: `Download`,
				id: 'void.updater.download',
				enabled: true,
				tooltip: '',
				class: undefined,
				run: () => {
					updateService.downloadUpdate(true);
				}
			});
		}

		if (res.action === 'apply') {
			primary.push({
				label: `Apply`,
				id: 'void.updater.apply',
				enabled: true,
				tooltip: '',
				class: undefined,
				run: () => {
					updateService.applyUpdate();
				}
			});
		}

		if (res.action === 'restart') {
			primary.push({
				label: `Restart to Update`,
				id: 'void.updater.restart',
				enabled: true,
				tooltip: 'Close Kodia, install the new version in place, and relaunch automatically',
				class: undefined,
				run: () => {
					void triggerRestartToUpdate(voidUpdateService, updateService, notifService, nativeHostService, res.source);
				}
			});
		}

		if (res.source !== 'local') {
			primary.push({
				id: 'void.updater.site',
				enabled: true,
				label: res.releaseNotesUrl ? `Release Notes` : `Kodia Releases`,
				tooltip: '',
				class: undefined,
				run: () => {
					const { window } = dom.getActiveWindow();
					window.open(res.releaseNotesUrl || KODIA_REPO_URL);
				}
			});
		}

		actions = {
			primary: primary,
			secondary: [{
				id: 'void.updater.close',
				enabled: true,
				label: `Later`,
				tooltip: '',
				class: undefined,
				run: () => {
					notifController.close();
				}
			}]
		};
	} else {
		actions = undefined;
	}

	const notifController = notifService.notify({
		severity: Severity.Info,
		message: message,
		sticky: true,
		actions: actions,
	});

	return notifController;
};

const notifyErrChecking = (notifService: INotificationService): INotificationHandle => {
	const message = `Kodia Error: There was an error checking for updates. If this persists, please get in touch or reinstall Kodia [here](${KODIA_RELEASES_URL})!`;
	return notifService.notify({
		severity: Severity.Info,
		message: message,
		sticky: true,
	});
};


let activeStatusBarUpdater: ((version?: string) => void) | undefined;

const syncUpdateStatusBar = async (voidUpdateService: IVoidUpdateService): Promise<void> => {
	try {
		const status = await voidUpdateService.getUpdateStatus();
		if (status.state === 'ready') {
			activeStatusBarUpdater?.(status.version);
		}
	} catch {
		// ignore IPC errors during shutdown
	}
};

const performVoidCheck = async (
	explicit: boolean,
	notifService: INotificationService,
	voidUpdateService: IVoidUpdateService,
	metricsService: IMetricsService,
	updateService: IUpdateService,
	nativeHostService: INativeHostService,
): Promise<INotificationHandle | null> => {

	const metricsTag = explicit ? 'Manual' : 'Auto';

	metricsService.capture(`Kodia Update ${metricsTag}: Checking...`, {});
	const res = await voidUpdateService.check(explicit);
	await syncUpdateStatusBar(voidUpdateService);

	if (!res) {
		const notifController = notifyErrChecking(notifService);
		metricsService.capture(`Kodia Update ${metricsTag}: Error`, { res });
		return notifController;
	} else {
		if (res.message) {
			const notifController = notifyUpdate(res, notifService, updateService, voidUpdateService, nativeHostService);
			metricsService.capture(`Kodia Update ${metricsTag}: Yes`, { res });
			return notifController;
		} else {
			metricsService.capture(`Kodia Update ${metricsTag}: No`, { res });
			return null;
		}
	}
};


// Actions
let lastNotifController: INotificationHandle | null = null;


registerAction2(class extends Action2 {
	constructor() {
		super({
			f1: true,
			id: 'void.voidCheckUpdate',
			title: localize2('voidCheckUpdate', 'Kodia: Check for Updates'),
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const voidUpdateService = accessor.get(IVoidUpdateService);
		const notifService = accessor.get(INotificationService);
		const metricsService = accessor.get(IMetricsService);
		const updateService = accessor.get(IUpdateService);
		const nativeHostService = accessor.get(INativeHostService);

		const currNotifController = lastNotifController;

		const newController = await performVoidCheck(true, notifService, voidUpdateService, metricsService, updateService, nativeHostService);

		if (newController) {
			currNotifController?.close();
			lastNotifController = newController;
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			f1: true,
			id: KODIA_RESTART_TO_UPDATE_ACTION_ID,
			title: localize2('voidRestartToUpdate', 'Kodia: Restart to Update'),
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const voidUpdateService = accessor.get(IVoidUpdateService);
		const updateService = accessor.get(IUpdateService);
		const notifService = accessor.get(INotificationService);
		const nativeHostService = accessor.get(INativeHostService);
		const status = await voidUpdateService.getUpdateStatus();
		await triggerRestartToUpdate(voidUpdateService, updateService, notifService, nativeHostService, status.source);
	}
});


// Workbench contribution: automatic startup/periodic checks + prominent "Restart to Update" status bar pill
class VoidUpdateWorkbenchContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.void.voidUpdate';

	private _updateStatusBarEntry: IStatusbarEntryAccessor | undefined;

	constructor(
		@IVoidUpdateService private readonly _voidUpdateService: IVoidUpdateService,
		@IMetricsService private readonly _metricsService: IMetricsService,
		@INotificationService private readonly _notifService: INotificationService,
		@IUpdateService private readonly _updateService: IUpdateService,
		@IStatusbarService private readonly _statusbarService: IStatusbarService,
		@INativeHostService private readonly _nativeHostService: INativeHostService,
	) {
		super();

		activeStatusBarUpdater = (version?: string) => this._showRestartToUpdatePill(version);
		this._register({
			dispose: () => {
				if (activeStatusBarUpdater) {
					activeStatusBarUpdater = undefined;
				}
			}
		});

		const autoCheck = () => {
			void performVoidCheck(false, this._notifService, this._voidUpdateService, this._metricsService, this._updateService, this._nativeHostService);
		};

		const localPollCheck = async () => {
			const res = await this._voidUpdateService.checkLocalOnly();
			await syncUpdateStatusBar(this._voidUpdateService);
			if (res && res.message) {
				const newController = notifyUpdate(res, this._notifService, this._updateService, this._voidUpdateService, this._nativeHostService);
				lastNotifController?.close();
				lastNotifController = newController;
			}
		};

		const { window } = dom.getActiveWindow();

		// Full check 5 seconds after launch
		const initId = window.setTimeout(() => autoCheck(), 5 * 1000);
		this._register({ dispose: () => window.clearTimeout(initId) });

		// Lightweight local-build check every 2 minutes (0 network calls — picks up local rebuilds automatically)
		const localIntervalId = window.setInterval(() => { void localPollCheck(); }, 2 * 60 * 1000);
		this._register({ dispose: () => window.clearInterval(localIntervalId) });

		// Full check (including GitHub Releases) every 3 hours
		const intervalId = window.setInterval(() => autoCheck(), 3 * 60 * 60 * 1000);
		this._register({ dispose: () => window.clearInterval(intervalId) });
	}

	private _showRestartToUpdatePill(version?: string): void {
		const label = version ? `Restart to Update (${version})` : 'Restart to Update Kodia';
		const entry = {
			name: 'Kodia Update Available',
			text: `$(cloud-download) ${label}`,
			ariaLabel: `${label} — Click to install the latest Kodia update and relaunch`,
			tooltip: 'A new version of Kodia is ready. Click to install in place and restart Kodia.',
			command: KODIA_RESTART_TO_UPDATE_ACTION_ID,
			kind: 'prominent' as const,
		};

		if (this._updateStatusBarEntry) {
			this._updateStatusBarEntry.update(entry);
		} else {
			this._updateStatusBarEntry = this._register(this._statusbarService.addEntry(
				entry,
				'kodia.statusbar.update',
				StatusbarAlignment.RIGHT,
				105,
			));
		}
	}
}
registerWorkbenchContribution2(VoidUpdateWorkbenchContribution.ID, VoidUpdateWorkbenchContribution, WorkbenchPhase.BlockRestore);
