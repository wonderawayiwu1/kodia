/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { extUriBiasedIgnorePathCase, joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { isWindows } from '../../../../base/common/platform.js';
import { hasDriveLetter } from '../../../../base/common/extpath.js';

/**
 * Encapsulates workspace folder resolution with an optional working directory override.
 *
 * When a working directory is set (agents window), it takes priority over
 * workspace folders for all folder-related operations. Otherwise, the class
 * delegates to the underlying {@link IWorkspaceContextService}.
 *
 * On Windows, if an explicit working directory does not resolve to a path that
 * is contained within any workspace folder (for example a stale path like
 * `c:\wamp64\www` from a previous session that no longer exists), the class
 * automatically falls back to trying each workspace folder as the base so that
 * chat tools do not fail with "Unable to resolve nonexistent file".
 */
export class WorkingDirectory {

	constructor(
		private readonly _workspaceContextService: IWorkspaceContextService,
		private readonly _uri?: URI,
	) { }

	/** The explicit working directory URI, if set. */
	get uri(): URI | undefined {
		return this._uri;
	}

	/** Whether an explicit working directory is set. */
	get hasExplicitWorkingDirectory(): boolean {
		return !!this._uri;
	}

	/**
	 * Returns the workspace folder containing the given resource.
	 * When a working directory is set, only checks against it.
	 * Otherwise falls back to workspace context service.
	 *
	 * On Windows, if an explicit working directory is set but does not contain
	 * the resource (for example a stale path like `c:\wamp64\www`), the method
	 * falls back to checking the workspace folders so the resource is not
	 * incorrectly treated as outside the workspace.
	 */
	getFolder(resource: URI): URI | undefined {
		if (this._uri) {
			if (extUriBiasedIgnorePathCase.isEqualOrParent(resource, this._uri)) {
				return this._uri;
			}
			// Explicit URI doesn't contain this resource — fall through to
			// check workspace folders instead of returning undefined.
		}
		return this._workspaceContextService.getWorkspaceFolder(resource)?.uri;
	}

	/**
	 * Returns the best base URI to resolve relative paths against.
	 *
	 * On Windows, an explicit working directory that does not live inside any
	 * workspace folder is ignored to avoid resolving against stale paths
	 * (e.g. `c:\wamp64\www`) left over from a previous session.
	 */
	private getBaseUri(): URI | undefined {
		const folders = this._workspaceContextService.getWorkspace().folders;

		// If an explicit working directory is set, only use it when it is
		// contained within one of the workspace folders. Otherwise ignore it
		// so we don't resolve against a path that doesn't exist.
		if (this._uri) {
			const uriUnderWorkspace = folders.some(folder =>
				extUriBiasedIgnorePathCase.isEqualOrParent(this._uri!, folder.uri));
			if (uriUnderWorkspace) {
				return this._uri;
			}
			// Explicit URI is not under any workspace folder — ignore it.
		}

		// Fall back to workspace folders, trying each one until we find a
		// suitable base. On Windows prefer folders whose fsPath has a drive letter.
		for (const folder of folders) {
			const uri = folder.uri;
			if (!uri) {
				continue;
			}
			if (isWindows && uri.scheme === 'file') {
				const fsPath = uri.fsPath;
				if (fsPath && hasDriveLetter(fsPath, true)) {
					return uri;
				}
			}
			return uri;
		}

		return undefined;
	}

	/**
	 * Resolves a workspace-relative file path to a URI.
	 * When a working directory is set, resolves against it.
	 * Otherwise resolves against the first workspace folder.
	 *
	 * The resolved URI is guaranteed to stay within the base directory: a
	 * `filePath` containing parent-directory segments (e.g. `../outside.ts`)
	 * that escapes the base directory is rejected and `undefined` is returned.
	 * This prevents path traversal out of the working directory boundary.
	 */
	resolveRelativePath(filePath: string): URI | undefined {
		const base = this.getBaseUri();
		if (!base) {
			return undefined;
		}
		const resolved = joinPath(base, filePath);
		if (!extUriBiasedIgnorePathCase.isEqualOrParent(resolved, base)) {
			return undefined;
		}
		return resolved;
	}
}
