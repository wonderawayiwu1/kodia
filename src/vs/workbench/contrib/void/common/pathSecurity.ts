/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { Schemas } from '../../../../base/common/network.js';
import * as path from '../../../../base/common/path.js';
import { extUriBiasedIgnorePathCase, normalizePath } from '../../../../base/common/resources.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';

/**
 * Asserts that a URI targets a path inside at least one open workspace folder.
 * This is a lexical check only: it does not resolve symlinks or junctions.
 */
export function assertPathInWorkspace(uri: URI, workspaceContextService: IWorkspaceContextService): void {
	const workspace = workspaceContextService.getWorkspace();
	if (workspace.folders.length === 0) {
		throw new Error('Void file tools require an open local workspace folder. No workspace folder is open.');
	}
	if (uri.scheme !== Schemas.file) {
		throw new Error(`Void file tools currently support local workspace paths only. Unsupported URI scheme: ${uri.scheme}`);
	}
	const isInside = workspace.folders.some(folder =>
		extUriBiasedIgnorePathCase.isEqualOrParent(uri, folder.uri)
	);
	if (!isInside) {
		throw new Error(`Path is outside the workspace: ${uri.fsPath}. Void file tools currently support local workspace paths only.`);
	}
}

/**
 * Resolves and validates a terminal working-directory string against the open workspace folders.
 *
 * Resolves the effective cwd first (null means the first workspace folder), normalizes the path,
 * validates that exact location against workspace roots, and returns the URI that should be passed
 * to terminal creation. This is a lexical check only: it does not resolve symlinks or junctions.
 *
 * @param cwd The caller-supplied cwd string, or null to use the workspace default.
 * @param workspaceContextService Used to enumerate workspace folders.
 * @returns The validated cwd URI to pass to terminal creation, or null when no workspace folder
 *          exists and no caller-supplied cwd is provided (caller must reject).
 * @throws If cwd is non-null and cannot be verified as inside a workspace folder, or if cwd is
 *         null and no workspace folder exists.
 */
export function assertCwdInWorkspace(
	cwd: string | null,
	workspaceContextService: IWorkspaceContextService,
): URI | null {
	const workspace = workspaceContextService.getWorkspace();
	if (workspace.folders.length === 0) {
		throw new Error(
			'Void terminal tools require an open local workspace folder. No workspace folder is open.',
		);
	}

	if (cwd === null) {
		// Null cwd means "use the default". The terminal service uses folders[0].uri.
		return workspace.folders[0].uri;
	}

	let uri: URI;
	// Detect if the caller supplied a full URI with scheme (e.g., vscode-remote://, file://, etc.)
	if (cwd.includes('://')) {
		try {
			uri = URI.parse(cwd);
		} catch (e) {
			throw new Error(`Invalid URI format: ${cwd}. Error: ${e}`);
		}
	} else if (path.isAbsolute(cwd)) {
		// Absolute filesystem path: convert to a file: URI
		uri = URI.file(cwd);
	} else {
		// Relative path: resolve against the first workspace root, then normalize.
		uri = URI.joinPath(workspace.folders[0].uri, cwd);
	}
	uri = normalizePath(uri);

	// Validate the resolved URI against every workspace folder whose scheme matches.
	// A file: URI can only be inside a file: folder; a vscode-remote: URI can only be
	// inside a matching vscode-remote: folder.
	const matchingFolders = workspace.folders.filter(f => f.uri.scheme === uri.scheme);
	if (matchingFolders.length === 0) {
		throw new Error(
			`Terminal working directory uses an unsupported scheme: ${uri.scheme}. Void terminal tools currently support local workspace paths only.`,
		);
	}

	const isInside = matchingFolders.some(folder =>
		extUriBiasedIgnorePathCase.isEqualOrParent(uri, folder.uri)
	);
	if (!isInside) {
		throw new Error(
			`Terminal working directory is outside the workspace: ${cwd}. Void terminal tools currently support local workspace paths only.`,
		);
	}

	return uri;
}

/**
 * Resolves and normalizes a terminal working-directory string without enforcing
 * workspace containment. The workspace is the default project context, not a
 * security boundary, so a cwd outside the workspace is permitted; it is simply
 * normalized and returned for reliable target identification.
 *
 * Mirrors `assertCwdInWorkspace` for resolution/normalization but does not
 * throw when the resolved path lies outside the workspace.
 *
 * @returns The normalized cwd URI, the first workspace folder URI when cwd is
 *          null (or null when no workspace folder exists and no cwd is given),
 *          or null when the cwd string cannot be parsed.
 */
export function resolveCwdUri(
	cwd: string | null,
	workspaceContextService: IWorkspaceContextService,
): URI | null {
	const workspace = workspaceContextService.getWorkspace();
	if (cwd === null) {
		if (workspace.folders.length === 0) return null;
		return workspace.folders[0].uri;
	}

	let uri: URI;
	if (cwd.includes('://')) {
		try {
			uri = URI.parse(cwd);
		} catch (e) {
			return null;
		}
	} else if (path.isAbsolute(cwd)) {
		uri = URI.file(cwd);
	} else {
		if (workspace.folders.length === 0) return null;
		uri = URI.joinPath(workspace.folders[0].uri, cwd);
	}
	return normalizePath(uri);
}

/**
 * Resolves the real path of `resource`, walking up the parent chain when the
 * path (or its ancestors) does not yet exist on disk. This ensures a symlink
 * at any ancestor is followed even for files that are about to be created.
 *
 * Returns `undefined` when the path cannot be resolved (e.g., provider does
 * not support realpath, or no existing ancestor can be found).
 */
async function resolveRealPathForNonexistent(
	resource: URI,
	fileService: IFileService,
): Promise<URI | undefined> {
	const fsPath = resource.fsPath;

	// Try direct realpath first (works for existing paths).
	try {
		const resolved = await fileService.realpath(resource);
		if (resolved) {
			return resolved;
		}
	} catch {
		// Path doesn't exist or provider doesn't support realpath - fall through.
	}

	// Walk up parent chain to find the nearest existing ancestor.
	let current = fsPath;
	let tail = path.basename(current);

	while (true) {
		const parent = path.dirname(current);
		if (parent === current) {
			// Reached filesystem root without finding an existing ancestor.
			return undefined;
		}

		try {
			const parentUri = URI.file(parent);
			const stat = await fileService.stat(parentUri);
			if (stat) {
				// Found existing parent - resolve its realpath.
				const resolvedParent = await fileService.realpath(parentUri);
				// If provider doesn't support realpath, fall back to lexical parent path.
				const resolvedParentPath = resolvedParent?.fsPath ?? parent;
				const resolvedPath = path.join(resolvedParentPath, tail);
				return URI.file(resolvedPath);
			}
		} catch {
			// Parent doesn't exist or stat failed - keep walking up.
		}

		tail = path.basename(current) + (tail ? '/' + tail : '');
		current = parent;
	}
}

/**
 * Asserts that a URI targets a path inside at least one open workspace folder,
 * resolving symlinks and junctions before checking containment.
 *
 * Performs both a lexical check on the original URI and a realpath-based check
 * on the resolved target. Both must pass.
 *
 * @param uri The URI to validate.
 * @param workspaceContextService Used to enumerate workspace folders.
 * @param fileService Used to resolve realpaths via IPC.
 * @throws If the URI or its symlink-resolved target escapes the workspace.
 */
export async function assertPathInWorkspaceWithRealpath(
	uri: URI,
	workspaceContextService: IWorkspaceContextService,
	fileService: IFileService,
): Promise<void> {
	// Step 1: Lexical check on the original URI.
	assertPathInWorkspace(uri, workspaceContextService);

	// Step 2: Resolve the real path (following symlinks/junctions).
	const resolvedUri = await resolveRealPathForNonexistent(uri, fileService);

	// Step 3: If we could resolve the real path, validate it against workspace roots.
	// If resolution failed (provider doesn't support realpath), fall back to
	// the lexical check which already passed in Step 1.
	if (resolvedUri) {
		const workspace = workspaceContextService.getWorkspace();
		const matchingFolders = workspace.folders.filter(f => f.uri.scheme === resolvedUri.scheme);
		if (matchingFolders.length === 0) {
			throw new Error(
				`Path resolves to unsupported scheme: ${resolvedUri.scheme}. Void file tools currently support local workspace paths only.`,
			);
		}

		const isInside = matchingFolders.some(folder =>
			extUriBiasedIgnorePathCase.isEqualOrParent(resolvedUri, folder.uri)
		);
		if (!isInside) {
			throw new Error(
				`Path resolves outside the workspace: ${uri.fsPath} -> ${resolvedUri.fsPath}. Void file tools currently support local workspace paths only.`,
			);
		}
	}
}

/**
 * Checks whether a URI targets a path outside the open workspace folders.
 * Returns the resolved URI if outside (for approval UI display), or null if inside.
 * Performs both lexical and symlink-resolved containment checks.
 *
 * @param uri The URI to check.
 * @param workspaceContextService Used to enumerate workspace folders.
 * @param fileService Used to resolve realpaths via IPC.
 * @returns The resolved URI if outside the workspace, or null if inside.
 * @throws If the path cannot be resolved at all (provider doesn't support realpath).
 */
export async function assertPathOutsideWorkspace(
	uri: URI,
	workspaceContextService: IWorkspaceContextService,
	fileService: IFileService,
): Promise<URI | null> {
	// Step 1: Lexical check - if inside workspace, we still need to resolve symlinks
	// because a path inside the workspace lexically could resolve outside via symlink.
	try {
		assertPathInWorkspace(uri, workspaceContextService);
	} catch {
		// Falls through - path is outside workspace lexically.
	}

	// Step 2: Resolve the real path (following symlinks/junctions).
	// Fail closed: if we cannot resolve the real path, require approval
	// because we cannot verify the target is inside the workspace.
	const resolvedUri = await resolveRealPathForNonexistent(uri, fileService);

	if (!resolvedUri) {
		// Cannot resolve - fail closed by treating the original URI as outside.
		return uri;
	}

	// Step 3: Validate the resolved path against workspace roots.
	const workspace = workspaceContextService.getWorkspace();
	const matchingFolders = workspace.folders.filter(f => f.uri.scheme === resolvedUri.scheme);
	if (matchingFolders.length === 0) {
		throw new Error(
			`Path resolves to unsupported scheme: ${resolvedUri.scheme}. Void file tools currently support local workspace paths only.`,
		);
	}

	const isInside = matchingFolders.some(folder =>
		extUriBiasedIgnorePathCase.isEqualOrParent(resolvedUri, folder.uri)
	);
	if (isInside) {
		// Symlink resolves inside workspace - no approval needed.
		return null;
	}

	// Resolved target is outside workspace - return for approval UI.
	return resolvedUri;
}