/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IGitService as VSCodeIGitService, IGitRepository, GitRefType } from '../../git/common/gitService.js';
import { ITerminalToolService } from './terminalToolService.js';
import {
	GitRepoDetection, GitRepositoryStatus, GitFileStatus, GitFileDiff, GitDiffResult,
	GitCommitLogEntry, GitBranchInfo,
} from '../common/gitService.js';
import { resolveCwdUri } from '../common/pathSecurity.js';

export const IGitToolService = createDecorator<IGitToolService>('GitToolService');

export interface IGitToolService {
	readonly _serviceBrand: undefined;

	// Repository detection
	detectRepository(uri: URI): Promise<GitRepoDetection>;
	getRepository(uri: URI): Promise<IGitRepository | undefined>;

	// Read-only operations (via VS Code Git API)
	getRepositoryStatus(repo: IGitRepository): Promise<GitRepositoryStatus>;
	getRepositoryDiff(repo: IGitRepository, ref?: string | null, path?: string | null, staged?: boolean): Promise<GitDiffResult>;
	getRepositoryBranches(repo: IGitRepository): Promise<{ branches: GitBranchInfo[]; current: string | null }>;
	getRepositoryLog(repo: IGitRepository, maxCount?: number, path?: string | null): Promise<{ commits: GitCommitLogEntry[]; total: number }>;

	// Write operations (via terminal)
	gitBranchCreate(branchName: string, startPoint?: string | null): Promise<{ branchName: string }>;
	gitBranchSwitch(branchName: string): Promise<{ branchName: string }>;
	gitStage(repoRootUri: URI, paths: string[]): Promise<{ staged: string[] }>;
	gitUnstage(repoRootUri: URI, paths: string[]): Promise<{ unstaged: string[] }>;
	gitCommit(repoRootUri: URI, message: string, amend?: boolean): Promise<{ commitHash: string; message: string }>;
	gitFetch(repoRootUri: URI, remote?: string | null): Promise<{ result: string }>;
	gitPull(repoRootUri: URI, remote?: string | null, branch?: string | null): Promise<{ result: string }>;
	gitPush(repoRootUri: URI, remote?: string | null, branch?: string | null, force?: boolean): Promise<{ result: string }>;
	gitMerge(repoRootUri: URI, branch: string): Promise<{ result: string; mergeInProgress: boolean }>;
	gitStash(repoRootUri: URI, message?: string | null): Promise<{ result: string }>;
	gitStashPop(repoRootUri: URI): Promise<{ result: string }>;
	gitShow(repoRootUri: URI, commit: string, path?: string | null): Promise<{ commit: string; message: string; diff: string }>;
}

export class GitToolService extends Disposable implements IGitToolService {
	readonly _serviceBrand: undefined;

	private readonly vsCodeGitService: VSCodeIGitService;
	private readonly terminalToolService: ITerminalToolService;
	private readonly workspaceContextService: IWorkspaceContextService;

	constructor(
		vsCodeGitService: VSCodeIGitService,
		terminalToolService: ITerminalToolService,
		workspaceContextService: IWorkspaceContextService,
	) {
		super();
		this.vsCodeGitService = vsCodeGitService;
		this.terminalToolService = terminalToolService;
		this.workspaceContextService = workspaceContextService;
	}

	// -----------------------------------------------------------------------
	// Repository detection
	// -----------------------------------------------------------------------

	async detectRepository(uri: URI): Promise<GitRepoDetection> {
		for (const repo of this.vsCodeGitService.repositories) {
			if (this._isUriInsideRepository(uri, repo.rootUri)) {
				return { isGitRepository: true, rootUri: repo.rootUri };
			}
		}
		try {
			const repo = await this.vsCodeGitService.openRepository(uri);
			if (repo) {
				return { isGitRepository: true, rootUri: repo.rootUri };
			}
		} catch {
			// Ignore errors from openRepository
		}
		return { isGitRepository: false, rootUri: null };
	}

	async getRepository(uri: URI): Promise<IGitRepository | undefined> {
		for (const repo of this.vsCodeGitService.repositories) {
			if (this._isUriInsideRepository(uri, repo.rootUri)) {
				return repo;
			}
		}
		return this.vsCodeGitService.openRepository(uri);
	}

	// -----------------------------------------------------------------------
	// Read-only operations (via VS Code Git API)
	// -----------------------------------------------------------------------

	async getRepositoryStatus(repo: IGitRepository): Promise<GitRepositoryStatus> {
		const state = repo.state.get();
		const branch = state.HEAD;
		const staged: GitFileStatus[] = [];
		const unstaged: GitFileStatus[] = [];
		const untracked: GitFileStatus[] = [];
		const conflicted: GitFileStatus[] = [];

		for (const change of state.indexChanges) {
			staged.push(this._changeToFileStatus(change as any, true));
		}
		for (const change of state.workingTreeChanges) {
			unstaged.push(this._changeToFileStatus(change as any, false));
		}
		for (const change of state.untrackedChanges) {
			untracked.push({
				uri: change.uri.fsPath,
				status: 'untracked',
				staged: false,
			});
		}
		for (const change of state.mergeChanges) {
			conflicted.push({
				uri: change.uri.fsPath,
				status: 'conflicted',
				staged: false,
			});
		}

		return {
			rootUri: repo.rootUri.fsPath,
			branch: branch?.name ?? null,
			upstream: branch?.upstream ? `${branch.upstream.remote}/${branch.upstream.name}` : null,
			ahead: branch?.ahead ?? null,
			behind: branch?.behind ?? null,
			staged,
			unstaged,
			untracked,
			conflicted,
			mergeInProgress: state.mergeChanges.length > 0,
		};
	}

	async getRepositoryDiff(
		repo: IGitRepository,
		ref?: string | null,
		path?: string | null,
		staged?: boolean
	): Promise<GitDiffResult> {
		const changes = ref
			? await repo.diffBetweenWithStats(ref!, 'HEAD', path ?? undefined)
			: await repo.diffBetweenWithStats2('HEAD', path ?? undefined);

		const files: GitFileDiff[] = [];
		let totalInsertions = 0;
		let totalDeletions = 0;

		for (const change of changes) {
			files.push({
				uri: change.uri.fsPath,
				oldUri: change.originalUri?.fsPath ?? null,
				newUri: change.modifiedUri?.fsPath ?? null,
				status: this._mapGitChangeStatus(change) as GitFileDiff['status'],
				insertions: change.insertions,
				deletions: change.deletions,
				hunks: [
					{
						oldStart: 1,
						oldLines: change.deletions,
						newStart: 1,
						newLines: change.insertions,
						header: `@@ -1,${change.deletions} +1,${change.insertions} @@`,
						body: '',
					},
				],
				isBinary: false,
			});
			totalInsertions += change.insertions;
			totalDeletions += change.deletions;
		}

		return { files, totalInsertions, totalDeletions };
	}

	async getRepositoryBranches(repo: IGitRepository): Promise<{ branches: GitBranchInfo[]; current: string | null }> {
		const refs = await repo.getRefs({});
		const state = repo.state.get();
		const currentBranch = state.HEAD?.name;

		const branches: GitBranchInfo[] = [];
		for (const ref of refs) {
			if (ref.type === GitRefType.Head) {
				branches.push({
					name: ref.name ?? '',
					isCurrent: ref.name === currentBranch,
					isRemote: false,
					upstream: state.HEAD?.upstream ? `${state.HEAD.upstream.remote}/${state.HEAD.upstream.name}` : null,
					ahead: state.HEAD?.ahead ?? null,
					behind: state.HEAD?.behind ?? null,
					isProtected: false,
				});
			} else if (ref.type === GitRefType.RemoteHead) {
				branches.push({
					name: ref.name ?? '',
					isCurrent: false,
					isRemote: true,
					upstream: null,
					ahead: null,
					behind: null,
					isProtected: false,
				});
			}
		}
		const current = branches.find(b => b.isCurrent)?.name ?? null;
		return { branches, current };
	}

	async getRepositoryLog(
		repo: IGitRepository,
		maxCount?: number,
		path?: string | null
	): Promise<{ commits: GitCommitLogEntry[]; total: number }> {
		// IGitRepository doesn't expose git log, so use the terminal service
		const resolvedCwd = resolveCwdUri(repo.rootUri.fsPath, this.workspaceContextService);
		const cwd = resolvedCwd?.fsPath ?? repo.rootUri.fsPath;

		let cmd = 'git log --pretty=format:%H%x09%an%x09%ae%x09%ad%x09%cn%x09%ce%x09%cd%x09%s%x09%P';
		if (maxCount) cmd += ` -n ${maxCount}`;
		if (path) cmd += ` -- ${path}`;

		const { resPromise } = await this.terminalToolService.runCommand(cmd, {
			type: 'temporary',
			cwd,
			terminalId: `git-log-${Date.now()}`,
		});

		const result = await resPromise;
		const output = result.result;

		const commits: GitCommitLogEntry[] = [];
		const lines = output.split('\n');
		for (const line of lines) {
			if (!line.trim()) continue;
			const parts = line.split('\t');
			if (parts.length < 9) continue;
			const hash = parts[0];
			const parents = parts[8] ? parts[8].split(' ').filter(Boolean) : [];
			commits.push({
				hash,
				shortHash: hash.substring(0, 7),
				message: parts[7],
				authorName: parts[1],
				authorEmail: parts[2],
				authorDate: parts[3],
				committerName: parts[4],
				committerEmail: parts[5],
				committerDate: parts[6],
				parents,
			});
		}

		return { commits, total: commits.length };
	}

	// -----------------------------------------------------------------------
	// Write operations (via terminal)
	// -----------------------------------------------------------------------

	private async _runGit(repoRootUri: URI, args: string[]): Promise<string> {
		const resolvedCwd = resolveCwdUri(repoRootUri.fsPath, this.workspaceContextService);
		const cwd = resolvedCwd?.fsPath ?? repoRootUri.fsPath;
		const cmd = ['git', ...args].join(' ');

		const { resPromise } = await this.terminalToolService.runCommand(cmd, {
			type: 'temporary',
			cwd,
			terminalId: `git-${args.join('-')}-${Date.now()}`,
		});

		const result = await resPromise;
		return result.result;
	}

	async gitBranchCreate(branchName: string, startPoint?: string | null): Promise<{ branchName: string }> {
		const repo = await this._getDefaultRepository();
		if (!repo) throw new Error('No Git repository found.');
		const args = startPoint ? ['branch', branchName, startPoint] : ['branch', branchName];
		await this._runGit(repo.rootUri, args);
		return { branchName };
	}

	async gitBranchSwitch(branchName: string): Promise<{ branchName: string }> {
		const repo = await this._getDefaultRepository();
		if (!repo) throw new Error('No Git repository found.');
		await this._runGit(repo.rootUri, ['checkout', branchName]);
		return { branchName };
	}

	async gitStage(repoRootUri: URI, paths: string[]): Promise<{ staged: string[] }> {
		await this._runGit(repoRootUri, ['add', ...paths]);
		return { staged: paths };
	}

	async gitUnstage(repoRootUri: URI, paths: string[]): Promise<{ unstaged: string[] }> {
		await this._runGit(repoRootUri, ['reset', 'HEAD', '--', ...paths]);
		return { unstaged: paths };
	}

	async gitCommit(repoRootUri: URI, message: string, amend?: boolean): Promise<{ commitHash: string; message: string }> {
		const args = amend ? ['commit', '--amend', '-m', message] : ['commit', '-m', message];
		const result = await this._runGit(repoRootUri, args);
		const match = result.match(/\[([^\]]+)\s+([a-f0-9]+)\]/);
		const commitHash = match ? match[2] : '';
		return { commitHash, message };
	}

	async gitFetch(repoRootUri: URI, remote?: string | null): Promise<{ result: string }> {
		const args = remote ? ['fetch', remote] : ['fetch'];
		const result = await this._runGit(repoRootUri, args);
		return { result };
	}

	async gitPull(repoRootUri: URI, remote?: string | null, branch?: string | null): Promise<{ result: string }> {
		const args = ['pull'];
		if (remote) args.push(remote);
		if (branch) args.push(branch);
		const result = await this._runGit(repoRootUri, args);
		return { result };
	}

	async gitPush(repoRootUri: URI, remote?: string | null, branch?: string | null, force?: boolean): Promise<{ result: string }> {
		const args = ['push'];
		if (force) args.push('--force');
		if (remote) args.push(remote);
		if (branch) args.push(branch);
		const result = await this._runGit(repoRootUri, args);
		return { result };
	}

	async gitMerge(repoRootUri: URI, branch: string): Promise<{ result: string; mergeInProgress: boolean }> {
		const result = await this._runGit(repoRootUri, ['merge', branch]);
		const mergeInProgress = result.includes('merge') || result.includes('conflict') || result.includes('Auto-merging');
		return { result, mergeInProgress };
	}

	async gitStash(repoRootUri: URI, message?: string | null): Promise<{ result: string }> {
		const args = message ? ['stash', 'push', '-m', message] : ['stash'];
		const result = await this._runGit(repoRootUri, args);
		return { result };
	}

	async gitStashPop(repoRootUri: URI): Promise<{ result: string }> {
		const result = await this._runGit(repoRootUri, ['stash', 'pop']);
		return { result };
	}

	async gitShow(repoRootUri: URI, commit: string, path?: string | null): Promise<{ commit: string; message: string; diff: string }> {
		const args = path ? ['show', commit, '--', path] : ['show', commit];
		const result = await this._runGit(repoRootUri, args);

		const commitMatch = result.match(/^commit\s+([a-f0-9]+)/m);
		const commitHash = commitMatch ? commitMatch[1] : commit;
		const messageMatch = result.match(/\n\n    (.+)/m);
		const commitMessage = messageMatch ? messageMatch[1] : '';

		return { commit: commitHash, message: commitMessage, diff: result };
	}

	// -----------------------------------------------------------------------
	// Private helpers
	// -----------------------------------------------------------------------

	private async _getDefaultRepository(): Promise<IGitRepository | undefined> {
		const workspace = this.workspaceContextService.getWorkspace();
		if (workspace.folders.length === 0) return undefined;
		return this.getRepository(workspace.folders[0].uri);
	}

	private _isUriInsideRepository(uri: URI, rootUri: URI): boolean {
		if (uri.scheme !== rootUri.scheme) return false;
		const uriPath = uri.path;
		const rootPath = rootUri.path;
		return uriPath === rootPath || uriPath.startsWith(rootPath + '/');
	}

	private _changeToFileStatus(change: { uri: URI; insertions: number; deletions: number }, staged: boolean): GitFileStatus {
		return {
			uri: change.uri.fsPath,
			status: this._mapGitChangeStatus(change),
			staged,
		};
	}

	private _mapGitChangeStatus(change: { insertions?: number; deletions?: number }): GitFileStatus['status'] {
		if ((change.insertions ?? 0) > 0 && (change.deletions ?? 0) === 0) return 'added';
		if ((change.deletions ?? 0) > 0 && (change.insertions ?? 0) === 0) return 'deleted';
		return 'modified';
	}
}

registerSingleton(IGitToolService, GitToolService, InstantiationType.Delayed);
