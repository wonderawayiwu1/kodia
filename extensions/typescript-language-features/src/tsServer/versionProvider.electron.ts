/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { TypeScriptServiceConfiguration } from '../configuration/configuration';
import { RelativeWorkspacePathResolver } from '../utils/relativePathResolver';
import { API } from './api';
import { ITypeScriptVersionProvider, TypeScriptVersion, TypeScriptVersionSource } from './versionProvider';


export class DiskTypeScriptVersionProvider implements ITypeScriptVersionProvider {

	public constructor(
		private configuration?: TypeScriptServiceConfiguration
	) { }

	public updateConfiguration(configuration: TypeScriptServiceConfiguration): void {
		this.configuration = configuration;
	}

	public get defaultVersion(): TypeScriptVersion {
		return this.globalVersion || this.bundledVersion;
	}

	public get globalVersion(): TypeScriptVersion | undefined {
		if (this.configuration?.globalTsdk) {
			const globals = this.loadVersionsFromSetting(TypeScriptVersionSource.UserSetting, this.configuration.globalTsdk);
			if (globals?.length) {
				return globals[0];
			}
		}
		return this.contributedTsNextVersion;
	}

	public get localVersion(): TypeScriptVersion | undefined {
		const tsdkVersions = this.localTsdkVersions;
		if (tsdkVersions?.length) {
			return tsdkVersions[0];
		}

		const nodeVersions = this.localNodeModulesVersions;
		if (nodeVersions?.length >= 1) {
			// Kodia KDRE: prefer root workspace TypeScript, then highest valid workspace version in multi-root/monorepo projects
			return nodeVersions[0];
		}
		return undefined;
	}


	public get localVersions(): TypeScriptVersion[] {
		const allVersions = this.localTsdkVersions.concat(this.localNodeModulesVersions);
		const paths = new Set<string>();
		return allVersions.filter(x => {
			if (paths.has(x.path)) {
				return false;
			}
			paths.add(x.path);
			return true;
		});
	}

	public get bundledVersion(): TypeScriptVersion {
		const version = this.getContributedVersion(TypeScriptVersionSource.Bundled, 'vscode.typescript-language-features', ['..', 'node_modules']);
		if (version) {
			return version;
		}

		vscode.window.showErrorMessage(vscode.l10n.t("VS Code\'s tsserver was deleted by another application such as a misbehaving virus detection tool. Please reinstall VS Code."));
		throw new Error('Could not find bundled tsserver.js');
	}

	private get contributedTsNextVersion(): TypeScriptVersion | undefined {
		return this.getContributedVersion(TypeScriptVersionSource.TsNightlyExtension, 'ms-vscode.vscode-typescript-next', ['node_modules']);
	}

	private getContributedVersion(source: TypeScriptVersionSource, extensionId: string, pathToTs: readonly string[]): TypeScriptVersion | undefined {
		try {
			const extension = vscode.extensions.getExtension(extensionId);
			if (extension) {
				const serverPath = path.join(extension.extensionPath, ...pathToTs, 'typescript', 'lib', 'tsserver.js');
				const bundledVersion = new TypeScriptVersion(source, serverPath, DiskTypeScriptVersionProvider.getApiVersion(serverPath), '');
				if (bundledVersion.isValid) {
					return bundledVersion;
				}
			}
		} catch {
			// noop
		}
		return undefined;
	}

	private get localTsdkVersions(): TypeScriptVersion[] {
		const localTsdk = this.configuration?.localTsdk;
		return localTsdk ? this.loadVersionsFromSetting(TypeScriptVersionSource.WorkspaceSetting, localTsdk) : [];
	}

	private loadVersionsFromSetting(source: TypeScriptVersionSource, tsdkPathSetting: string): TypeScriptVersion[] {
		if (path.isAbsolute(tsdkPathSetting)) {
			const serverPath = path.join(tsdkPathSetting, 'tsserver.js');
			return [
				new TypeScriptVersion(source,
					serverPath,
					DiskTypeScriptVersionProvider.getApiVersion(serverPath),
					tsdkPathSetting)
			];
		}

		const workspacePath = RelativeWorkspacePathResolver.asAbsoluteWorkspacePath(tsdkPathSetting);
		if (workspacePath !== undefined) {
			const serverPath = path.join(workspacePath, 'tsserver.js');
			return [
				new TypeScriptVersion(source,
					serverPath,
					DiskTypeScriptVersionProvider.getApiVersion(serverPath),
					tsdkPathSetting)
			];
		}

		return this.loadTypeScriptVersionsFromPath(source, tsdkPathSetting);
	}

	private get localNodeModulesVersions(): TypeScriptVersion[] {
		const direct = this.loadTypeScriptVersionsFromPath(TypeScriptVersionSource.NodeModules, path.join('node_modules', 'typescript', 'lib'))
			.filter(x => x.isValid);
		if (direct.length > 0 || !vscode.workspace.workspaceFolders) {
			return direct;
		}
		// Kodia KDRE: discover workspace TypeScript in common monorepo / subproject layouts
		const found: TypeScriptVersion[] = [];
		const seen = new Set<string>();
		const subRoots = ['apps', 'packages', 'services', 'frontend', 'backend', 'client', 'server', 'web', 'mobile', 'api'];
		for (const root of vscode.workspace.workspaceFolders) {
			for (const sub of subRoots) {
				const candidateDir = path.join(root.uri.fsPath, sub);
				if (!fs.existsSync(candidateDir)) { continue; }
				const directSub = path.join(candidateDir, 'node_modules', 'typescript', 'lib', 'tsserver.js');
				if (fs.existsSync(directSub) && !seen.has(directSub)) {
					const ver = new TypeScriptVersion(TypeScriptVersionSource.NodeModules, directSub, DiskTypeScriptVersionProvider.getApiVersion(directSub), path.join(sub, 'node_modules', 'typescript', 'lib'));
					if (ver.isValid) { seen.add(directSub); found.push(ver); }
				}
				if (sub === 'apps' || sub === 'packages' || sub === 'services') {
					try {
						for (const entry of fs.readdirSync(candidateDir, { withFileTypes: true })) {
							if (!entry.isDirectory()) { continue; }
							const nested = path.join(candidateDir, entry.name, 'node_modules', 'typescript', 'lib', 'tsserver.js');
							if (fs.existsSync(nested) && !seen.has(nested)) {
								const ver = new TypeScriptVersion(TypeScriptVersionSource.NodeModules, nested, DiskTypeScriptVersionProvider.getApiVersion(nested), path.join(sub, entry.name, 'node_modules', 'typescript', 'lib'));
								if (ver.isValid) { seen.add(nested); found.push(ver); }
							}
						}
					} catch { /* ignore unreadable subdirs */ }
				}
			}
		}
		return found;
	}

	private loadTypeScriptVersionsFromPath(source: TypeScriptVersionSource, relativePath: string): TypeScriptVersion[] {
		if (!vscode.workspace.workspaceFolders) {
			return [];
		}

		const versions: TypeScriptVersion[] = [];
		for (const root of vscode.workspace.workspaceFolders) {
			let label: string = relativePath;
			if (vscode.workspace.workspaceFolders.length > 1) {
				label = path.join(root.name, relativePath);
			}

			const serverPath = path.join(root.uri.fsPath, relativePath, 'tsserver.js');
			versions.push(new TypeScriptVersion(source, serverPath, DiskTypeScriptVersionProvider.getApiVersion(serverPath), label));
		}
		return versions;
	}

	private static getApiVersion(serverPath: string): API | undefined {
		const version = DiskTypeScriptVersionProvider.getTypeScriptVersion(serverPath);
		if (version) {
			return version;
		}

		// Allow TS developers to provide custom version
		const tsdkVersion = vscode.workspace.getConfiguration().get<string | undefined>('typescript.tsdk_version', undefined);
		if (tsdkVersion) {
			return API.fromVersionString(tsdkVersion);
		}

		return undefined;
	}

	private static getTypeScriptVersion(serverPath: string): API | undefined {
		if (!fs.existsSync(serverPath)) {
			return undefined;
		}

		const p = serverPath.split(path.sep);
		if (p.length <= 2) {
			return undefined;
		}
		const p2 = p.slice(0, -2);
		const modulePath = p2.join(path.sep);
		let fileName = path.join(modulePath, 'package.json');
		if (!fs.existsSync(fileName)) {
			// Special case for ts dev versions
			if (path.basename(modulePath) === 'built') {
				fileName = path.join(modulePath, '..', 'package.json');
			}
		}
		if (!fs.existsSync(fileName)) {
			return undefined;
		}

		const contents = fs.readFileSync(fileName).toString();
		let desc: any;
		try {
			desc = JSON.parse(contents);
		} catch (err) {
			return undefined;
		}
		if (!desc?.version) {
			return undefined;
		}
		return desc.version ? API.fromVersionString(desc.version) : undefined;
	}
}
