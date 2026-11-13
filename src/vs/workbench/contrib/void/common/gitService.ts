/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IGitRepository } from '../../git/common/gitService.js';

/**
 * Result of checking whether a directory is a Git repository.
 */
export type GitRepoDetection = {
	isGitRepository: boolean;
	rootUri: URI | null;
};

/**
 * Status of a single file in the working tree or index.
 */
export type GitFileStatus = {
	uri: string;
	status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'type-change' | 'untracked' | 'ignored' | 'conflicted';
	staged: boolean;
};

/**
 * Full repository status.
 */
export type GitRepositoryStatus = {
	rootUri: string;
	branch: string | null;
	upstream: string | null;
	ahead: number | null;
	behind: number | null;
	staged: GitFileStatus[];
	unstaged: GitFileStatus[];
	untracked: GitFileStatus[];
	conflicted: GitFileStatus[];
	mergeInProgress: boolean;
};

/**
 * A single diff hunk.
 */
export type GitDiffHunk = {
	oldStart: number;
	oldLines: number;
	newStart: number;
	newLines: number;
	header: string;
	body: string;
};

/**
 * A diff for a single file.
 */
export type GitFileDiff = {
	uri: string;
	oldUri: string | null;
	newUri: string | null;
	status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'type-change' | 'conflicted';
	insertions: number;
	deletions: number;
	hunks: GitDiffHunk[];
	isBinary: boolean;
};

/**
 * Full diff result.
 */
export type GitDiffResult = {
	files: GitFileDiff[];
	totalInsertions: number;
	totalDeletions: number;
};

/**
 * A commit log entry.
 */
export type GitCommitLogEntry = {
	hash: string;
	shortHash: string;
	message: string;
	authorName: string;
	authorEmail: string;
	authorDate: string;
	committerName: string;
	committerEmail: string;
	committerDate: string;
	parents: string[];
};

/**
 * A branch reference.
 */
export type GitBranchInfo = {
	name: string;
	isCurrent: boolean;
	isRemote: boolean;
	upstream: string | null;
	ahead: number | null;
	behind: number | null;
	isProtected: boolean;
};

/**
 * A stash entry.
 */
export type GitStashEntry = {
	index: number;
	message: string;
};

/**
 * Service interface for Git operations.
 *
 * Read-only operations (status, diff, branches, log) use VS Code's Git API.
 * Write operations (commit, push, pull, branch, stash, etc.) use the terminal
 * tool service since VS Code's IGitRepository interface does not expose those
 * operations directly.
 */
export const IGitServiceVoid = createDecorator<IGitServiceVoid>('GitServiceVoid');

export interface IGitServiceVoid {
	readonly _serviceBrand: undefined;

	// Repository detection
	detectRepository(uri: URI): Promise<GitRepoDetection>;
	getRepository(uri: URI): Promise<IGitRepository | undefined>;

	// Read-only operations
	getRepositoryStatus(repo: IGitRepository): Promise<GitRepositoryStatus>;
	getRepositoryDiff(repo: IGitRepository, options?: { ref?: string | null; path?: string | null; staged?: boolean }): Promise<GitDiffResult>;
	getRepositoryBranches(repo: IGitRepository): Promise<GitBranchInfo[]>;
	getRepositoryLog(repo: IGitRepository, maxCount?: number, path?: string | null): Promise<{ commits: GitCommitLogEntry[]; total: number }>;
	hasUncommittedChanges(repo: IGitRepository): Promise<boolean>;
}
