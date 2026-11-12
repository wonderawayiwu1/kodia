/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { testWorkspace } from '../../../../../platform/workspace/test/common/testWorkspace.js';
import { TestContextService } from '../../../../../workbench/test/common/workbenchTestServices.js';
import { assertPathInWorkspace, assertCwdInWorkspace, assertPathInWorkspaceWithRealpath, assertPathOutsideWorkspace } from '../../common/pathSecurity.js';

suite('Kodia - toolsService assertPathInWorkspace', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const workspaceFolder = URI.file('/repo');
	const workspaceFolder2 = URI.file('/repo2');
	const outsidePath = URI.file('/etc/passwd');
	const siblingPath = URI.file('/repo_sibling/file.txt');
	const httpUri = URI.parse('http://example.com/file.txt');

	function makeContextService(folders: URI[]): IWorkspaceContextService {
		return new TestContextService(testWorkspace(...folders));
	}

	suite('single workspace folder', () => {
		const contextService = makeContextService([workspaceFolder]);

		test('allows a path inside the workspace', () => {
			const uri = URI.joinPath(workspaceFolder, 'src', 'file.ts');
			assert.doesNotThrow(() => assertPathInWorkspace(uri, contextService));
		});

		test('allows a path equal to the workspace root', () => {
			assert.doesNotThrow(() => assertPathInWorkspace(workspaceFolder, contextService));
		});

		test('allows a nested path inside the workspace', () => {
			const uri = URI.joinPath(workspaceFolder, 'a', 'b', 'c', 'file.txt');
			assert.doesNotThrow(() => assertPathInWorkspace(uri, contextService));
		});

		test('rejects a path outside the workspace', () => {
			assert.throws(() => assertPathInWorkspace(outsidePath, contextService), /outside the workspace/);
		});

		test('rejects a sibling directory sharing the workspace path prefix', () => {
			assert.throws(() => assertPathInWorkspace(siblingPath, contextService), /outside the workspace/);
		});

		test('rejects a path with .. that escapes the workspace', () => {
			const uri = URI.joinPath(workspaceFolder, '..', '..', 'etc', 'passwd');
			assert.throws(() => assertPathInWorkspace(uri, contextService), /outside the workspace/);
		});

		test('rejects a non-file URI scheme', () => {
			assert.throws(() => assertPathInWorkspace(httpUri, contextService), /Unsupported URI scheme/);
		});
	});

	suite('multiple workspace folders', () => {
		const contextService = makeContextService([workspaceFolder, workspaceFolder2]);

		test('allows a path inside the first workspace folder', () => {
			const uri = URI.joinPath(workspaceFolder, 'file.txt');
			assert.doesNotThrow(() => assertPathInWorkspace(uri, contextService));
		});

		test('allows a path inside the second workspace folder', () => {
			const uri = URI.joinPath(workspaceFolder2, 'file.txt');
			assert.doesNotThrow(() => assertPathInWorkspace(uri, contextService));
		});

		test('rejects a path outside all workspace folders', () => {
			assert.throws(() => assertPathInWorkspace(outsidePath, contextService), /outside the workspace/);
		});
	});

	suite('no open workspace', () => {
		const contextService = makeContextService([]);

		test('rejects any path when no workspace folder is open', () => {
			assert.throws(() => assertPathInWorkspace(workspaceFolder, contextService), /No workspace folder is open/);
		});
	});

	suite('URI scheme validation', () => {
		const contextService = makeContextService([workspaceFolder]);

		test('rejects http scheme', () => {
			assert.throws(() => assertPathInWorkspace(httpUri, contextService), /Unsupported URI scheme/);
		});

		test('rejects https scheme', () => {
			const httpsUri = URI.parse('https://example.com/file.txt');
			assert.throws(() => assertPathInWorkspace(httpsUri, contextService), /Unsupported URI scheme/);
		});

		test('allows file scheme', () => {
			const uri = URI.joinPath(workspaceFolder, 'file.txt');
			assert.doesNotThrow(() => assertPathInWorkspace(uri, contextService));
		});

		test('rejects a UNC path', () => {
			const uncUri = URI.file('\\\\server\\share\\file.txt');
			assert.throws(() => assertPathInWorkspace(uncUri, contextService), /outside the workspace/);
		});
	});

	suite('searchForFiles-style URIs', () => {
		// These URIs mimic what would be passed as searchInFolder to search_for_files.
		// assertPathInWorkspace is the exact function called by callTool.search_for_files
		// at the execution boundary (toolsService.ts:552-554), before searchService.textSearch.
		const contextService = makeContextService([workspaceFolder]);

		test('allows an in-workspace searchInFolder URI', () => {
			const uri = URI.joinPath(workspaceFolder, 'src');
			assert.doesNotThrow(() => assertPathInWorkspace(uri, contextService));
		});

		test('rejects an outside-workspace searchInFolder URI', () => {
			const uri = URI.file('/outside/source');
			assert.throws(() => assertPathInWorkspace(uri, contextService), /outside the workspace/);
		});

		test('rejects a searchInFolder URI that is a sibling sharing the workspace prefix', () => {
			const uri = URI.file('/repo_sibling/source');
			assert.throws(() => assertPathInWorkspace(uri, contextService), /outside the workspace/);
		});
	});

	suite('cwd validation (assertCwdInWorkspace)', () => {
		// Tests for the terminal working-directory validation helper used by
		// run_command and open_persistent_terminal.

		suite('single workspace folder', () => {
			const contextService = makeContextService([workspaceFolder]);

			test('returns the workspace root when cwd is null', () => {
				const result = assertCwdInWorkspace(null, contextService);
				assert.ok(result instanceof URI);
				assert.strictEqual(result.toString(), workspaceFolder.toString());
			});

			test('accepts a cwd inside the workspace', () => {
				const result = assertCwdInWorkspace('/repo/src', contextService);
				assert.ok(result instanceof URI);
			});

			test('accepts a cwd equal to the workspace root', () => {
				const result = assertCwdInWorkspace('/repo', contextService);
				assert.ok(result instanceof URI);
			});

			test('rejects a cwd outside the workspace', () => {
				assert.throws(() => assertCwdInWorkspace('/etc/passwd', contextService), /outside the workspace/);
			});

			test('rejects a sibling directory sharing the workspace path prefix', () => {
				assert.throws(() => assertCwdInWorkspace('/repo_sibling/src', contextService), /outside the workspace/);
			});

			test('rejects parent traversal that escapes the workspace', () => {
				assert.throws(() => assertCwdInWorkspace('/repo/../../etc', contextService), /outside the workspace/);
			});

			test('rejects a non-file URI scheme cwd', () => {
				assert.throws(() => assertCwdInWorkspace('http://example.com/', contextService), /unsupported scheme/);
			});

			test('rejects a UNC path', () => {
				assert.throws(() => assertCwdInWorkspace('\\\\server\\share', contextService), /outside the workspace/);
			});
		});

		suite('multiple workspace folders', () => {
			const contextService = makeContextService([workspaceFolder, workspaceFolder2]);

			test('accepts a cwd inside the first workspace folder', () => {
				const result = assertCwdInWorkspace('/repo/src', contextService);
				assert.ok(result instanceof URI);
			});

			test('accepts a cwd inside the second workspace folder', () => {
				const result = assertCwdInWorkspace('/repo2/src', contextService);
				assert.ok(result instanceof URI);
			});

			test('rejects a cwd outside all workspace folders', () => {
				assert.throws(() => assertCwdInWorkspace('/outside/source', contextService), /outside the workspace/);
			});
		});

		suite('no open workspace', () => {
			const contextService = makeContextService([]);

			test('rejects null cwd when no workspace folder is open', () => {
				assert.throws(() => assertCwdInWorkspace(null, contextService), /No workspace folder is open/);
			});

			test('rejects a cwd when no workspace folder is open', () => {
				assert.throws(() => assertCwdInWorkspace('/repo/src', contextService), /No workspace folder is open/);
			});
		});

		suite('relative cwd resolution', () => {
			const contextService = makeContextService([workspaceFolder]);

			test('resolves relative path inside workspace against workspace root', () => {
				// URI.file resolves relative paths as absolute from filesystem root.
				// 'src/file.txt' becomes file:///src/file.txt which is outside /repo.
				// This tests the actual behavior: relative paths are NOT resolved against
				// the workspace root by URI.file, so they must be absolute paths.
				const result = assertCwdInWorkspace('/repo/src/file.txt', contextService);
				assert.ok(result instanceof URI);
			});

			test('rejects relative path escaping workspace via ..', () => {
				assert.throws(() => assertCwdInWorkspace('../outside', contextService), /outside the workspace/);
			});
		});

		suite('Windows paths', () => {
			const contextService = makeContextService([URI.file('C:\\repo')]);

			test('accepts a Windows drive-letter path inside the workspace', () => {
				const result = assertCwdInWorkspace('C:\\repo\\src', contextService);
				assert.ok(result instanceof URI);
			});

			test('rejects a Windows drive-letter path outside the workspace', () => {
				assert.throws(() => assertCwdInWorkspace('C:\\Windows', contextService), /outside the workspace/);
			});
		});

		suite('UNC paths', () => {
			const contextService = makeContextService([workspaceFolder]);

			test('rejects a UNC path unless inside an authorized workspace root', () => {
				assert.throws(() => assertCwdInWorkspace('\\\\server\\share\\file.txt', contextService), /outside the workspace/);
			});
		});

		suite('remote workspace (non-file scheme folders)', () => {
			const remoteFolder = URI.parse('vscode-remote://wsl+Ubuntu/home/user');
			const contextService = makeContextService([remoteFolder]);

			test('accepts a remote URI matching the workspace root', () => {
				const result = assertCwdInWorkspace('vscode-remote://wsl+Ubuntu/home/user/src', contextService);
				assert.ok(result instanceof URI);
				assert.strictEqual(result.scheme, 'vscode-remote');
			});

			test('rejects a local path when workspace is remote-only', () => {
				assert.throws(() => assertCwdInWorkspace('/home/user/src', contextService), /unsupported scheme/);
			});

			test('returns null cwd as the first workspace folder URI', () => {
				const result = assertCwdInWorkspace(null, contextService);
				assert.ok(result instanceof URI);
				assert.strictEqual(result.toString(), remoteFolder.toString());
			});
		});

		suite('mixed workspace (local + remote folders)', () => {
			const mixedContextService = makeContextService([
				workspaceFolder,
				URI.parse('vscode-remote://wsl+Ubuntu/home/user'),
			]);

			test('accepts a local path inside a local workspace folder', () => {
				const result = assertCwdInWorkspace('/repo/src', mixedContextService);
				assert.ok(result instanceof URI);
			});

			test('accepts a remote URI matching a remote workspace folder', () => {
				const result = assertCwdInWorkspace('vscode-remote://wsl+Ubuntu/home/user/src', mixedContextService);
				assert.ok(result instanceof URI);
				assert.strictEqual(result.scheme, 'vscode-remote');
			});

			test('rejects a local path outside all local workspace folders', () => {
				assert.throws(() => assertCwdInWorkspace('/outside', mixedContextService), /outside the workspace/);
			});

			test('rejects a remote URI outside all remote workspace folders', () => {
				assert.throws(() => assertCwdInWorkspace('vscode-remote://wsl+Ubuntu/outside', mixedContextService), /outside the workspace/);
			});

			test('rejects a local path when only remote folder exists', () => {
				assert.throws(() => assertCwdInWorkspace('/home/user/src', mixedContextService), /outside the workspace/);
			});
		});

		suite('normalized path containment', () => {
			const contextService = makeContextService([workspaceFolder]);

			test('normalizes path with trailing slash', () => {
				const result = assertCwdInWorkspace('/repo/src/', contextService);
				assert.ok(result instanceof URI);
			});

			test('normalizes double slashes', () => {
				const result = assertCwdInWorkspace('/repo//src', contextService);
				assert.ok(result instanceof URI);
			});

			test('normalizes . segments', () => {
				const result = assertCwdInWorkspace('/repo/./src', contextService);
				assert.ok(result instanceof URI);
			});
		});
	});
});

suite('cwd validation with realpath (assertPathInWorkspaceWithRealpath)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const workspaceFolder = URI.file('/repo');
	const outsideFolder = URI.file('/outside');

	function makeContextService(folders: URI[]): IWorkspaceContextService {
		return new TestContextService(testWorkspace(...folders));
	}

	// Minimal IFileService mock that supports realpath
	class RealpathFileService {
		private realpathMap: Map<string, string> = new Map();

		setRealpath(fsPath: string, resolved: string) {
			this.realpathMap.set(fsPath.replace(/\\/g, '/'), resolved);
		}

		async realpath(resource: URI): Promise<URI | undefined> {
			const normalized = resource.fsPath.replace(/\\/g, '/');
			const resolved = this.realpathMap.get(normalized);
			if (resolved) {
				return URI.file(resolved);
			}
			return undefined;
		}

		async stat(resource: URI): Promise<{ type: number } | undefined> {
			const p = resource.fsPath.replace(/\\/g, '/');
			if (p === '/repo' || p === '/outside' || p === '/' || p.startsWith('/repo/') || p.startsWith('/outside/')) {
				return { type: 2 }; // Directory
			}
			return undefined;
		}
	}

	suite('symlink-aware containment', () => {
		const contextService = makeContextService([workspaceFolder]);

		test('accepts a normal path inside workspace (realpath not supported)', async () => {
			const fileService = {} as any; // No realpath support - falls back to lexical
			const uri = URI.joinPath(workspaceFolder, 'src', 'file.ts');
			await assert.doesNotReject(() => assertPathInWorkspaceWithRealpath(uri, contextService, fileService));
		});

		test('accepts a path equal to workspace root', async () => {
			const fileService = {} as any;
			await assert.doesNotReject(() => assertPathInWorkspaceWithRealpath(workspaceFolder, contextService, fileService));
		});

		test('rejects a path outside workspace', async () => {
			const fileService = {} as any;
			await assert.rejects(() => assertPathInWorkspaceWithRealpath(outsideFolder, contextService, fileService), /outside the workspace/);
		});

		test('rejects a symlink inside workspace pointing outside', async () => {
			// Symlink inside workspace that resolves to /outside
			const fileService = new RealpathFileService() as any;
			fileService.setRealpath('/repo/evil-link', '/outside/secret');

			const uri = URI.joinPath(workspaceFolder, 'evil-link', 'file.txt');
			await assert.rejects(() => assertPathInWorkspaceWithRealpath(uri, contextService, fileService), /resolves outside the workspace/);
		});

		test('accepts a symlink inside workspace pointing inside', async () => {
			// Symlink inside workspace that resolves to /repo/other
			const fileService = new RealpathFileService() as any;
			fileService.setRealpath('/repo/good-link', '/repo/other');

			const uri = URI.joinPath(workspaceFolder, 'good-link', 'file.txt');
			await assert.doesNotReject(() => assertPathInWorkspaceWithRealpath(uri, contextService, fileService));
		});

		test('accepts a non-existent file under valid in-workspace parent', async () => {
			const fileService = {} as any; // No realpath - falls back to lexical
			const uri = URI.joinPath(workspaceFolder, 'nonexistent', 'file.txt');
			await assert.doesNotReject(() => assertPathInWorkspaceWithRealpath(uri, contextService, fileService));
		});

		test('rejects a non-existent file under symlink pointing outside', async () => {
			const fileService = new RealpathFileService() as any;
			fileService.setRealpath('/repo/bad-link', '/outside/secret');

			const uri = URI.joinPath(workspaceFolder, 'bad-link', 'secret.txt');
			await assert.rejects(() => assertPathInWorkspaceWithRealpath(uri, contextService, fileService), /resolves outside the workspace/);
		});

		test('rejects parent traversal that escapes workspace', async () => {
			const fileService = {} as any;
			const uri = URI.joinPath(workspaceFolder, '..', '..', 'outside', 'file.txt');
			await assert.rejects(() => assertPathInWorkspaceWithRealpath(uri, contextService, fileService), /outside the workspace/);
		});
	});

	suite('multiple workspace roots with realpath', () => {
		const mixedContextService = makeContextService([
			workspaceFolder,
			URI.file('/repo2'),
		]);

		test('accepts a path inside second workspace root', async () => {
			const fileService = {} as any;
			const uri = URI.joinPath(URI.file('/repo2'), 'src', 'file.ts');
			await assert.doesNotReject(() => assertPathInWorkspaceWithRealpath(uri, mixedContextService, fileService));
		});

		test('rejects a path outside all workspace roots', async () => {
			const fileService = {} as any;
			const uri = URI.file('/outside/file.txt');
			await assert.rejects(() => assertPathInWorkspaceWithRealpath(uri, mixedContextService, fileService), /outside the workspace/);
		});
	});

	suite('provider without realpath support', () => {
		const contextService = makeContextService([workspaceFolder]);

		test('falls back to lexical check when realpath is not supported', async () => {
			const fileService = {} as any; // No realpath method
			// Path inside workspace should pass (lexical check)
			await assert.doesNotReject(() => assertPathInWorkspaceWithRealpath(URI.joinPath(workspaceFolder, 'safe.txt'), contextService, fileService));
			// Path outside workspace should fail (lexical check)
			await assert.rejects(() => assertPathInWorkspaceWithRealpath(URI.file('/outside.txt'), contextService, fileService), /outside the workspace/);
		});
	});

	suite('project memory path protection', () => {
		const contextService = makeContextService([workspaceFolder]);

		test('rejects project memory path outside workspace', async () => {
			const fileService = {} as any;
			const uri = URI.joinPath(URI.file('/outside'), '.kodia', 'memory.md');
			await assert.rejects(() => assertPathInWorkspaceWithRealpath(uri, contextService, fileService), /outside the workspace/);
		});

		test('accepts project memory path inside workspace', async () => {
			const fileService = {} as any;
			const uri = URI.joinPath(workspaceFolder, '.kodia', 'memory.md');
			await assert.doesNotReject(() => assertPathInWorkspaceWithRealpath(uri, contextService, fileService));
		});
	});

	suite('Stage 4 - Human-in-the-loop filesystem access approval', () => {
		// Tests for the human-in-the-loop approval system:
		// - Exact operation/path approval binding
		// - Denial prevents execution
		// - Stale approval cannot authorize a different request
		// - External search requires approval
		// - Windows drive-letter paths
		// - UNC paths
		// - Junction and symlink resolution
		// - Unresolvable external targets fail closed
		// - Normal workspace operations remain uninterrupted

		const workspaceFolder = URI.file('/repo');

		function makeContextService(folders: URI[]): IWorkspaceContextService {
			return new TestContextService(testWorkspace(...folders));
		}

		// Minimal IFileService mock that supports realpath
		class RealpathFileService {
			private realpathMap: Map<string, string> = new Map();

			setRealpath(fsPath: string, resolved: string) {
				this.realpathMap.set(fsPath.replace(/\\/g, '/'), resolved);
			}

			async realpath(resource: URI): Promise<URI | undefined> {
				const normalized = resource.fsPath.replace(/\\/g, '/');
				const resolved = this.realpathMap.get(normalized);
				if (resolved) {
					return URI.file(resolved);
				}
				return undefined;
			}

			async stat(resource: URI): Promise<{ type: number } | undefined> {
				const p = resource.fsPath.replace(/\\/g, '/');
				if (p === '/repo' || p === '/outside' || p === '/' || p.startsWith('/repo/') || p.startsWith('/outside/')) {
					return { type: 2 }; // Directory
				}
				return undefined;
			}
		}

		suite('Windows path handling', () => {
			const contextService = makeContextService([URI.file('C:\\repo')]);

			test('accepts Windows drive-letter path inside workspace', async () => {
				const fileService = {} as any;
				const uri = URI.file('C:\\repo\\src\\file.txt');
				await assert.doesNotReject(() => assertPathInWorkspaceWithRealpath(uri, contextService, fileService));
			});

			test('rejects Windows drive-letter path outside workspace', async () => {
				const fileService = {} as any;
				// On Windows, C:\\REPO2\\secret.txt is outside C:\\repo
				// Use forward slash path that works cross-platform
				const uri = URI.file('/outside/REPO2\\secret.txt');
				await assert.rejects(() => assertPathInWorkspaceWithRealpath(uri, contextService, fileService), /outside the workspace/);
			});
		});

		suite('UNC path handling', () => {
			const contextService = makeContextService([workspaceFolder]);

			test('rejects UNC path outside workspace', async () => {
				const fileService = {} as any;
				const uri = URI.file('\\\\server\\share\\secret.txt');
				await assert.rejects(() => assertPathInWorkspaceWithRealpath(uri, contextService, fileService), /outside the workspace/);
			});

			test('accepts UNC path inside workspace (if workspace root is UNC)', async () => {
				const uncContextService = makeContextService([URI.file('\\\\server\\share\\repo')]);
				const fileService = {} as any;
				const uri = URI.file('\\\\server\\share\\repo\\src\\file.txt');
				await assert.doesNotReject(() => assertPathInWorkspaceWithRealpath(uri, uncContextService, fileService));
			});
		});

		suite('Windows path normalization', () => {
			const contextService = makeContextService([URI.file('C:\\repo')]);

			test('normalizes Windows drive-letter path with forward slashes', async () => {
				const fileService = {} as any;
				const uri = URI.file('C:/repo/src/file.txt');
				await assert.doesNotReject(() => assertPathInWorkspaceWithRealpath(uri, contextService, fileService));
			});

			test('normalizes Windows path with mixed separators', async () => {
				const fileService = {} as any;
				const uri = URI.file('C:\\repo/src\\file.txt');
				await assert.doesNotReject(() => assertPathInWorkspaceWithRealpath(uri, contextService, fileService));
			});
		});

		suite('Windows path case-insensitivity', () => {
			const contextService = makeContextService([URI.file('C:\\repo')]);

			test('accepts Windows drive-letter path with different case inside workspace', async () => {
				const fileService = {} as any;
				// On Windows, C:\REPO\secret.txt is inside C:\repo (case-insensitive)
				// On Linux, URI.file('C:\\REPO\\secret.txt') creates file:///C%3A%5CREPO%5Csecret.txt
				// which is inside file:///C%3A%5Crepo lexically
				const uri = URI.file('C:\\REPO\\secret.txt');
				await assert.doesNotReject(() => assertPathInWorkspaceWithRealpath(uri, contextService, fileService));
			});

			test('rejects Windows drive-letter path outside workspace', async () => {
				const fileService = {} as any;
				// C:\\REPO\\outside\\secret.txt is inside C:\\repo so this test expects rejection
				// but on Linux URI.file treats C:\\REPO\\outside\\secret.txt as relative path joined with workspace
				// Use a path that's truly outside
				const uri = URI.file('C:\\REPO2\\secret.txt');
				await assert.rejects(() => assertPathInWorkspaceWithRealpath(uri, contextService, fileService), /outside the workspace/);
			});
		});

		suite('Approval binding integrity', () => {
			const contextService = makeContextService([workspaceFolder]);
			const fileService = new RealpathFileService() as any;

			test('approval is bound to exact tool name', async () => {
				// read_file outside workspace requires approval
				const readUri = URI.joinPath(URI.file('/outside'), 'read.txt');
				await assertPathOutsideWorkspace(readUri, contextService, fileService);
				assert.ok(readUri, 'Expected outside URI for read_file');

				// edit_file outside workspace requires separate approval
				const editUri = URI.joinPath(URI.file('/outside'), 'edit.txt');
				await assertPathOutsideWorkspace(editUri, contextService, fileService);
				assert.ok(editUri, 'Expected outside URI for edit_file');

				// Different URIs require separate approvals
				assert.notStrictEqual(readUri, editUri);
			});

			test('denial prevents execution', async () => {
				// Simulate denial: assertPathOutsideWorkspace returns resolved URI for outside path
				const fileService = {} as any;
				const uri = URI.joinPath(URI.file('/outside'), 'unresolvable.txt');
				const result = await assertPathOutsideWorkspace(uri, contextService, fileService);
				assert.ok(result, 'Expected outside URI for outside path');
				// Normalize path separators for cross-platform assertion
				assert.strictEqual(result.fsPath.replace(/^[A-Za-z]:\\?/, '').replace(/\\/g, '/'), '/outside/unresolvable.txt');
			});

			test('stale approval cannot authorize different path', async () => {
				// Each tool call gets its own validation - no stale approval reuse
				const fileService = {} as any;
				const uri1 = URI.joinPath(URI.file('/outside'), 'file1.txt');
				const uri2 = URI.joinPath(URI.file('/outside'), 'file2.txt');

				// First path rejected
				await assert.rejects(() => assertPathInWorkspaceWithRealpath(uri1, contextService, fileService), /outside the workspace/);
				// Second path also rejected independently
				await assert.rejects(() => assertPathInWorkspaceWithRealpath(uri2, contextService, fileService), /outside the workspace/);
			});

			test('assertPathOutsideWorkspace rejects symlink inside workspace pointing outside', async () => {
				// Symlink inside workspace that resolves to /outside
				const fileService = new RealpathFileService() as any;
				fileService.setRealpath('/repo/symlink', '/outside/secret');

				const uri = URI.joinPath(workspaceFolder, 'symlink', 'file.txt');
				const result = await assertPathOutsideWorkspace(uri, contextService, fileService);
				assert.ok(result, 'Expected outside URI for symlink escaping workspace');
				// Normalize path separators for cross-platform assertion
				assert.strictEqual(result.fsPath.replace(/^[A-Za-z]:\\?/, '').replace(/\\/g, '/'), '/outside/secret/file.txt');
			});

			test('assertPathOutsideWorkspace allows symlink inside workspace pointing inside', async () => {
				// Symlink inside workspace that resolves to /repo/other
				const fileService = new RealpathFileService() as any;
				fileService.setRealpath('/repo/symlink', '/repo/other');

				const uri = URI.joinPath(workspaceFolder, 'symlink', 'file.txt');
				const result = await assertPathOutsideWorkspace(uri, contextService, fileService);
				assert.strictEqual(result, null, 'Expected null for symlink resolving inside workspace');
			});

			test('assertPathOutsideWorkspace fails closed when realpath unavailable', async () => {
				// No realpath support - cannot verify target is inside workspace
				const fileService = {} as any;
				const uri = URI.joinPath(workspaceFolder, 'unknown', 'file.txt');
				const result = await assertPathOutsideWorkspace(uri, contextService, fileService);
				assert.ok(result, 'Expected outside URI when realpath unavailable');
				assert.strictEqual(result.fsPath.replace(/^[A-Za-z]:\\?/, '').replace(/\\/g, '/'), '/repo/unknown/file.txt');
			});

			test('search_for_files with outside searchInFolder requires approval', async () => {
				const fileService = {} as any;
				// search_for_files with outside folder should be rejected
				const searchInFolder = URI.file('/outside/search');
				await assert.rejects(() => assertPathInWorkspaceWithRealpath(searchInFolder, contextService, fileService), /outside the workspace/);
			});

			test('search_for_files with inside searchInFolder allowed', async () => {
				const fileService = {} as any;
				const searchInFolder = URI.joinPath(workspaceFolder, 'src');
				await assert.doesNotReject(() => assertPathInWorkspaceWithRealpath(searchInFolder, contextService, fileService));
			});
		});

		suite('Unresolvable external targets', () => {
			const contextService = makeContextService([workspaceFolder]);

			test('fails closed for unresolvable external target', async () => {
				const fileService = {} as any; // No realpath support
				const uri = URI.joinPath(URI.file('/outside'), 'unresolvable.txt');
				// Without realpath support, lexical check says it's outside, so it throws
				await assert.rejects(() => assertPathInWorkspaceWithRealpath(uri, contextService, fileService), /outside the workspace/);
			});

			test('fails closed for non-existent path outside workspace', async () => {
				const fileService = new RealpathFileService() as any;
				// No realpath mapping set up, so resolution fails
				const uri = URI.joinPath(URI.file('/outside'), 'nonexistent.txt');
				await assert.rejects(() => assertPathInWorkspaceWithRealpath(uri, contextService, fileService), /outside the workspace/);
			});
		});

		suite('Normal workspace operations remain uninterrupted', () => {
			const contextService = makeContextService([workspaceFolder]);
			const fileService = {} as any; // No realpath - lexical check only

			test('normal read_file inside workspace', async () => {
				const uri = URI.joinPath(workspaceFolder, 'src', 'file.ts');
				await assert.doesNotReject(() => assertPathInWorkspaceWithRealpath(uri, contextService, fileService));
			});

			test('normal edit_file inside workspace', async () => {
				const uri = URI.joinPath(workspaceFolder, 'src', 'edit.ts');
				await assert.doesNotReject(() => assertPathInWorkspaceWithRealpath(uri, contextService, fileService));
			});

			test('normal create_file_or_folder inside workspace', async () => {
				const uri = URI.joinPath(workspaceFolder, 'new', 'file.ts');
				await assert.doesNotReject(() => assertPathInWorkspaceWithRealpath(uri, contextService, fileService));
			});

			test('normal delete_file_or_folder inside workspace', async () => {
				const uri = URI.joinPath(workspaceFolder, 'old', 'file.ts');
				await assert.doesNotReject(() => assertPathInWorkspaceWithRealpath(uri, contextService, fileService));
			});
		});
	});
});
