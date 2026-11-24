/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IEnvironmentMainService } from '../../../../platform/environment/electron-main/environmentMainService.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { DisablementReason, IUpdateService, StateType } from '../../../../platform/update/common/update.js';
import { KODIA_LATEST_RELEASE_API_URL, KODIA_REPO } from '../common/kodiaLinks.js';
import { IVoidUpdateService } from '../common/voidUpdateService.js';
import { KodiaApplyUpdateResult, KodiaUpdateSource, KodiaUpdateStatus, VoidCheckUpdateRespose } from '../common/voidUpdateServiceTypes.js';


const DEFAULT_LOCAL_INSTALLER_PATH = 'C:\\CodeEditors\\kodia\\.build\\win32-x64\\user-setup\\kodia-installer-x64.exe';
const LOCAL_MANIFEST_FILENAME = 'kodia-update.json';

export const KODIA_INNO_SILENT_UPDATE_ARGS = [
	'/SILENT',
	'/SUPPRESSMSGBOXES',
	'/NORESTART',
	'/CLOSEAPPLICATIONS',
	'/RESTARTAPPLICATIONS',
	'/SP-',
	'/MERGETASKS=runcode,!desktopicon,!quicklaunchicon',
] as const;

interface KodiaLocalUpdateManifest {
	version?: string;
	voidVersion?: string;
	commit?: string;
	date?: string;
	buildTimestamp?: number;
	buildId?: string;
	installerFile?: string;
	sha256?: string;
}

interface ReadyUpdateState {
	version: string;
	source: KodiaUpdateSource;
	installerPath: string;
	buildId: string;
	releaseNotesUrl?: string;
}

interface GitHubReleaseAsset {
	name?: string;
	browser_download_url?: string;
}

interface GitHubReleaseResponse {
	tag_name?: string;
	html_url?: string;
	assets?: GitHubReleaseAsset[];
}


export class VoidMainUpdateService extends Disposable implements IVoidUpdateService {
	_serviceBrand: undefined;

	// the release/build the automatic check last announced, so it isn't announced again repeatedly
	private _autoAnnouncedRelease: string | undefined;
	private _readyUpdate: ReadyUpdateState | undefined;
	private _status: KodiaUpdateStatus = { state: 'idle' };
	private _downloadInFlight: Promise<string> | undefined;

	constructor(
		@IProductService private readonly _productService: IProductService,
		@IEnvironmentMainService private readonly _envMainService: IEnvironmentMainService,
		@IUpdateService private readonly _updateService: IUpdateService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
	) {
		super();
	}

	// Whether the user (or a policy, or --disable-updates) turned off automatic update checks. Release builds
	// have no update URL, so VS Code's updater is disabled for that reason and never reads update.mode itself.
	private _automaticChecksTurnedOff(): boolean {
		const updateMode = this._configurationService.getValue<string>('update.mode');
		if (updateMode === 'none' || updateMode === 'manual') { return true; }
		const { state } = this._updateService;
		return state.type === StateType.Disabled
			&& (state.reason === DisablementReason.ManuallyDisabled || state.reason === DisablementReason.Policy || state.reason === DisablementReason.DisabledByEnvironment);
	}

	async getUpdateStatus(): Promise<KodiaUpdateStatus> {
		if (this._updateService.state.type === StateType.Ready && this._status.state !== 'ready') {
			return {
				state: 'ready',
				source: 'native',
				message: 'Restart Kodia to update!',
			};
		}
		return { ...this._status };
	}

	async checkLocalOnly(): Promise<VoidCheckUpdateRespose> {
		const isDevMode = !this._envMainService.isBuilt;
		if (isDevMode || this._automaticChecksTurnedOff()) {
			return { message: null } as const;
		}
		const localRes = this._checkLocalBuildUpdate(false);
		return localRes ?? ({ message: null } as const);
	}

	async check(explicit: boolean): Promise<VoidCheckUpdateRespose> {
		const isDevMode = !this._envMainService.isBuilt; // found in abstractUpdateService.ts

		if (isDevMode) {
			return { message: null } as const;
		}

		if (!explicit && this._automaticChecksTurnedOff()) {
			return { message: null } as const;
		}

		this._updateService.checkForUpdates(false); // implicitly check, then handle result ourselves

		if (this._updateService.state.type === StateType.Uninitialized) {
			// The update service hasn't been initialized yet
			return explicit ? ({ message: 'Checking for updates soon...', action: 'reinstall' } as const) : ({ message: null } as const);
		}

		if (this._updateService.state.type === StateType.Idle) {
			// No updates currently available
			return explicit ? ({ message: 'No updates found!', action: 'reinstall' } as const) : ({ message: null } as const);
		}

		if (this._updateService.state.type === StateType.CheckingForUpdates) {
			// Currently checking for updates
			return explicit ? ({ message: 'Checking for updates...' } as const) : ({ message: null } as const);
		}

		if (this._updateService.state.type === StateType.AvailableForDownload) {
			// Update available but requires manual download (mainly for Linux)
			return { message: 'A new update is available!', action: 'download', source: 'native' } as const;
		}

		if (this._updateService.state.type === StateType.Downloading) {
			// Update is currently being downloaded
			return explicit ? ({ message: 'Currently downloading update...' } as const) : ({ message: null } as const);
		}

		if (this._updateService.state.type === StateType.Downloaded) {
			// Update has been downloaded but not yet ready
			return explicit ? ({ message: 'An update is ready to be applied!', action: 'apply', source: 'native' } as const) : ({ message: null } as const);
		}

		if (this._updateService.state.type === StateType.Updating) {
			// Update is being applied
			return explicit ? ({ message: 'Applying update...' } as const) : ({ message: null } as const);
		}

		if (this._updateService.state.type === StateType.Ready) {
			// Update is ready
			this._status = { state: 'ready', source: 'native', message: 'Restart Kodia to update!' };
			return { message: 'Restart Kodia to update!', action: 'restart', source: 'native' } as const;
		}

		if (this._updateService.state.type === StateType.Disabled) {
			return await this._manualCheckGHTagIfDisabled(explicit);
		}
		return null;
	}

	async restartAndApplyUpdate(): Promise<KodiaApplyUpdateResult> {
		if (this._readyUpdate?.installerPath) {
			const installerPath = this._readyUpdate.installerPath;
			if (!fs.existsSync(installerPath)) {
				this._readyUpdate = undefined;
				this._status = { state: 'error', message: 'Staged Kodia installer could not be found on disk.' };
				return { launched: false, error: `Installer file not found: ${installerPath}` };
			}
			try {
				this._spawnInstaller(installerPath, [...KODIA_INNO_SILENT_UPDATE_ARGS]);
				this._scheduleQuitForUpdate();
				return { launched: true };
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				this._status = { state: 'error', message: `Failed to launch Kodia updater: ${msg}` };
				return { launched: false, error: msg };
			}
		}

		if (this._updateService.state.type === StateType.Ready) {
			await this._updateService.quitAndInstall();
			return { launched: true };
		}

		return { launched: false, error: 'No downloaded Kodia update is ready to install yet.' };
	}

	protected _spawnInstaller(installerPath: string, args: string[]): void {
		const child = cp.spawn(installerPath, args, {
			detached: true,
			stdio: 'ignore',
			windowsHide: false,
			env: { ...process.env, __COMPAT_LAYER: 'RunAsInvoker' },
		});
		child.unref();
	}

	protected _scheduleQuitForUpdate(): void {
		// Renderer triggers graceful INativeHostService.quit() immediately after receiving { launched: true };
		// Inno Setup also closes Kodia via /CLOSEAPPLICATIONS if any window remains open.
	}

	private _resolveLocalInstallerPath(): string | undefined {
		const configured = this._configurationService.getValue<string>('kodia.update.localInstallerPath')?.trim();
		if (configured) {
			try {
				if (fs.existsSync(configured) && fs.statSync(configured).isDirectory()) {
					return path.join(configured, 'kodia-installer-x64.exe');
				}
			} catch {
				// fall through to use configured path directly
			}
			return configured;
		}

		// Auto-detect local Kodia dev build only on Windows real built apps (which stamp product.date)
		if (process.platform === 'win32' && this._productService.date) {
			if (fs.existsSync(DEFAULT_LOCAL_INSTALLER_PATH)) {
				return DEFAULT_LOCAL_INSTALLER_PATH;
			}
		}
		return undefined;
	}

	private _checkLocalBuildUpdate(explicit: boolean): VoidCheckUpdateRespose | undefined {
		const installerPath = this._resolveLocalInstallerPath();
		if (!installerPath || !fs.existsSync(installerPath)) {
			return undefined;
		}
		if (!isValidWindowsExecutable(installerPath)) {
			return undefined;
		}

		const currentTag = `${this._productService.version}-${this._productService.voidVersion}`;
		const currentDateMs = this._productService.date ? Date.parse(this._productService.date) : 0;
		const currentCommit = this._productService.commit ?? '';

		const manifestPath = path.join(path.dirname(installerPath), LOCAL_MANIFEST_FILENAME);
		let manifest: KodiaLocalUpdateManifest | undefined;
		if (fs.existsSync(manifestPath)) {
			try {
				manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as KodiaLocalUpdateManifest;
			} catch {
				manifest = undefined;
			}
		}

		let isNewer = false;
		let buildId = '';
		let displayVersion = 'local build';

		if (manifest) {
			const manifestTag = manifest.version && manifest.voidVersion
				? `${manifest.version}-${manifest.voidVersion}`
				: undefined;
			const manifestDateMs = typeof manifest.buildTimestamp === 'number'
				? manifest.buildTimestamp
				: (manifest.date ? Date.parse(manifest.date) : 0);

			const sameCommit = Boolean(manifest.commit && currentCommit && manifest.commit === currentCommit);
			const newerTag = manifestTag ? isNewerRelease(manifestTag, currentTag) : false;
			// Ignore post-compile timestamp skew (e.g. Inno Setup taking 15-20 min after product.json was stamped)
			// when both the running app and the manifest are the exact same git commit.
			const newerDate = !sameCommit && manifestDateMs > 0 && currentDateMs > 0 && manifestDateMs > currentDateMs + 5000;
			const newerWithoutCurrentDate = manifestDateMs > 0 && currentDateMs === 0 && Boolean(manifest.commit && manifest.commit !== currentCommit);
			const diffCommitNotOlder = Boolean(manifest.commit && currentCommit && manifest.commit !== currentCommit && (manifestDateMs === 0 || manifestDateMs >= currentDateMs));

			isNewer = newerTag || newerDate || newerWithoutCurrentDate || diffCommitNotOlder;
			buildId = manifest.buildId || `${manifestTag ?? 'local'}@${manifest.commit || manifestDateMs}`;
			const shortCommit = manifest.commit ? ` (${manifest.commit.slice(0, 7)})` : '';
			displayVersion = manifestTag ? `${manifestTag}${shortCommit}` : `local build${shortCommit}`;
		} else if (currentDateMs > 0) {
			try {
				const stat = fs.statSync(installerPath);
				if (stat.mtimeMs > currentDateMs + 60_000) {
					isNewer = true;
					buildId = `local-file@${Math.floor(stat.mtimeMs)}`;
					displayVersion = `local build (${new Date(stat.mtimeMs).toLocaleTimeString()})`;
				}
			} catch {
				return undefined;
			}
		}

		if (!isNewer) {
			if (this._readyUpdate?.source === 'local') {
				this._readyUpdate = undefined;
				this._status = { state: 'idle' };
			}
			return undefined;
		}

		this._readyUpdate = {
			version: displayVersion,
			source: 'local',
			installerPath,
			buildId,
		};
		const readyMessage = `A new Kodia build (${displayVersion}) is ready! Restart Kodia to update.`;
		this._status = {
			state: 'ready',
			version: displayVersion,
			source: 'local',
			installerPath,
			message: readyMessage,
		};

		if (!explicit && buildId === this._autoAnnouncedRelease) {
			return { message: null, version: displayVersion, source: 'local', installerPath } as const;
		}
		if (!explicit) {
			this._autoAnnouncedRelease = buildId;
		}
		return {
			message: readyMessage,
			action: 'restart',
			version: displayVersion,
			source: 'local',
			installerPath,
		} as const;
	}

	private async _downloadInstaller(downloadUrl: string, versionTag: string, assetName: string): Promise<string> {
		const safeTag = versionTag.replace(/[^a-zA-Z0-9._-]/g, '_');
		const safeName = path.basename(assetName).replace(/[^a-zA-Z0-9._-]/g, '_') || 'kodia-installer-x64.exe';
		const updateDir = path.join(os.tmpdir(), 'kodia-updates', safeTag);
		const targetPath = path.join(updateDir, safeName);

		if (fs.existsSync(targetPath) && isValidWindowsExecutable(targetPath)) {
			return targetPath;
		}

		if (this._downloadInFlight) {
			return await this._downloadInFlight;
		}

		this._status = {
			state: 'downloading',
			version: versionTag,
			source: 'github',
			message: `Downloading Kodia ${versionTag}...`,
		};

		const task = (async () => {
			fs.mkdirSync(updateDir, { recursive: true });
			const partPath = `${targetPath}.${process.pid}.part`;
			try {
				const res = await fetch(downloadUrl);
				if (!res.ok) {
					throw new Error(`HTTP ${res.status} while downloading ${safeName}`);
				}
				const buf = Buffer.from(await res.arrayBuffer());
				if (buf.length < 2 || buf[0] !== 0x4d || buf[1] !== 0x5a) {
					throw new Error(`Downloaded asset ${safeName} is not a valid Windows executable`);
				}
				fs.writeFileSync(partPath, buf);
				fs.renameSync(partPath, targetPath);
				return targetPath;
			} catch (err) {
				try { if (fs.existsSync(partPath)) { fs.unlinkSync(partPath); } } catch { /* ignore */ }
				throw err;
			} finally {
				this._downloadInFlight = undefined;
			}
		})();

		this._downloadInFlight = task;
		return await task;
	}

	private async _manualCheckGHTagIfDisabled(explicit: boolean): Promise<VoidCheckUpdateRespose> {
		// 1. Fast local build check (detects local rebuilds immediately without needing GitHub upload)
		const localResult = this._checkLocalBuildUpdate(explicit);
		if (localResult) {
			return localResult;
		}

		// 2. GitHub Releases check (works on any laptop worldwide)
		try {
			const configuredRepo = this._configurationService.getValue<string>('kodia.update.githubRepo')?.trim();
			const apiUrl = configuredRepo && configuredRepo !== KODIA_REPO
				? `https://api.github.com/repos/${configuredRepo}/releases/latest`
				: KODIA_LATEST_RELEASE_API_URL;

			const response = await fetch(apiUrl);
			const data = await response.json() as GitHubReleaseResponse;
			const latestVersion: string = data.tag_name ?? '';

			// Release tags are "<VS Code version>-<Kodia version>", e.g. 1.141.0-2.5.0
			const myVersion = `${this._productService.version}-${this._productService.voidVersion}`;
			const isUpToDate = !latestVersion || !isNewerRelease(latestVersion, myVersion); // only makes sense if response.ok

			if (response.ok && !isUpToDate) {
				const autoDownload = this._configurationService.getValue<boolean>('kodia.update.autoDownload') !== false;
				const installerAsset = process.platform === 'win32'
					? findWindowsInstallerAsset(data.assets)
					: undefined;

				if (autoDownload && installerAsset?.browser_download_url && installerAsset.name) {
					try {
						const installerPath = await this._downloadInstaller(
							installerAsset.browser_download_url,
							latestVersion,
							installerAsset.name,
						);
						const readyMsg = `Kodia ${latestVersion} is ready! Restart Kodia to update.`;
						this._readyUpdate = {
							version: latestVersion,
							source: 'github',
							installerPath,
							buildId: latestVersion,
							releaseNotesUrl: data.html_url,
						};
						this._status = {
							state: 'ready',
							version: latestVersion,
							source: 'github',
							installerPath,
							releaseNotesUrl: data.html_url,
							message: readyMsg,
						};

						if (!explicit && latestVersion === this._autoAnnouncedRelease) {
							return { message: null, version: latestVersion, source: 'github', installerPath, releaseNotesUrl: data.html_url } as const;
						}
						if (!explicit) {
							this._autoAnnouncedRelease = latestVersion;
						}
						return {
							message: readyMsg,
							action: 'restart',
							version: latestVersion,
							source: 'github',
							installerPath,
							releaseNotesUrl: data.html_url,
						} as const;
					} catch {
						// Fall back cleanly to reinstall link if download fails
						this._status = { state: 'error', version: latestVersion, source: 'github', message: 'Failed to download Kodia installer.' };
					}
				}
			}

			let message: string | null;
			let action: 'reinstall' | undefined;

			// explicit
			if (explicit) {
				if (response.ok) {
					if (!isUpToDate) {
						message = 'A new version of Kodia is available! Please reinstall (auto-updates are disabled on this OS) - it only takes a second!';
						action = 'reinstall';
					} else {
						message = 'Kodia is up-to-date!';
					}
				} else {
					message = `An error occurred when fetching the latest GitHub release tag. Please try again in ~5 minutes, or reinstall.`;
					action = 'reinstall';
				}
			}
			// not explicit: once per release
			else {
				if (response.ok && !isUpToDate && latestVersion !== this._autoAnnouncedRelease) {
					this._autoAnnouncedRelease = latestVersion;
					message = 'A new version of Kodia is available! Please reinstall (auto-updates are disabled on this OS) - it only takes a second!';
					action = 'reinstall';
				} else {
					message = null;
				}
			}
			if (message === null) {
				return { message: null, version: latestVersion || undefined, source: 'github', releaseNotesUrl: data.html_url } as const;
			}
			return { message, action, version: latestVersion || undefined, source: 'github', releaseNotesUrl: data.html_url } as const;
		} catch (e) {
			if (explicit) {
				return {
					message: `An error occurred when fetching the latest GitHub release tag: ${e}. Please try again in ~5 minutes.`,
					action: 'reinstall',
				};
			} else {
				return { message: null } as const;
			}
		}
	}
}


function isValidWindowsExecutable(filePath: string): boolean {
	try {
		const fd = fs.openSync(filePath, 'r');
		try {
			const header = Buffer.alloc(2);
			const bytesRead = fs.readSync(fd, header, 0, 2, 0);
			return bytesRead === 2 && header[0] === 0x4d && header[1] === 0x5a; // 'MZ'
		} finally {
			fs.closeSync(fd);
		}
	} catch {
		return false;
	}
}

function findWindowsInstallerAsset(assets: GitHubReleaseAsset[] | undefined): GitHubReleaseAsset | undefined {
	if (!Array.isArray(assets) || assets.length === 0) {
		return undefined;
	}
	const exeAssets = assets.filter(a => typeof a?.name === 'string' && typeof a?.browser_download_url === 'string' && /\.exe$/i.test(a.name));
	if (exeAssets.length === 0) {
		return undefined;
	}
	return (
		exeAssets.find(a => /kodia.*installer.*x64\.exe$/i.test(a.name!))
		?? exeAssets.find(a => /kodia.*x64.*\.exe$/i.test(a.name!))
		?? exeAssets.find(a => /setup.*\.exe$|installer.*\.exe$/i.test(a.name!))
		?? exeAssets[0]
	);
}

/** Whether release tag `a` is newer than `b`, comparing "<VS Code version>-<Kodia version>" (or optional leading 'v') numerically. */
function isNewerRelease(a: string, b: string): boolean {
	const stripV = (s: string) => s.replace(/^v/i, '');
	const parse = (tag: string) => /^(\d+)\.(\d+)\.(\d+)-(\d+)\.(\d+)\.(\d+)$/.exec(stripV(tag))?.slice(1).map(Number);
	const pa = parse(a), pb = parse(b);
	if (!pa || !pb) {
		return stripV(a) !== stripV(b);
	}
	for (let i = 0; i < pa.length; i++) {
		if (pa[i] !== pb[i]) {
			return pa[i] > pb[i];
		}
	}
	return false;
}
