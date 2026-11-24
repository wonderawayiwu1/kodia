/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import * as cp from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import {
	IKodiaDiagnosticReliabilityMainService,
	KdreClassifiedDiagnostic,
	KdreCompilerDiagnostic,
	KdreCompilerToolRun,
	KdreCompilerVerificationReport,
	KdreCrossEditorComparisonReport,
	KdreDependencyHealthReport,
	KdreDiagnosticConflict,
	KdreDiscoveredConfigFile,
	KdreEvent,
	KdreInvestigationReport,
	KdreLanguageServerHealth,
	KdreLiveSnapshot,
	KdrePackageManager,
	KdreProjectConfigReport,
	KdreRawDiagnostic,
	KdreRecoveryResult,
	KdreSystemState,
} from '../common/diagnosticReliabilityTypes.js';
import {
	classifyDiagnosticsWithEvidence,
	investigateSuspiciousDiagnostic,
} from '../common/diagnosticReliabilityEngine.js';

const SUBPROJECT_ROOTS = ['apps', 'packages', 'services', 'frontend', 'backend', 'client', 'server', 'web', 'mobile', 'api'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.kodia', '__pycache__', '.venv', 'venv', 'target', 'vendor']);

function runExecFile(bin: string, args: string[], cwd: string, timeoutMs = 20_000): Promise<{ ok: boolean; missing: boolean; stdout: string; stderr: string; exitCode: number | null }> {
	return new Promise(resolve => {
		const isWinCmd = process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin);
		const command = isWinCmd ? (process.env.ComSpec || 'cmd.exe') : bin;
		const finalArgs = isWinCmd ? ['/d', '/s', '/c', bin, ...args] : args;
		cp.execFile(command, finalArgs, { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 6 * 1024 * 1024 }, (err, stdout, stderr) => {
			const code = err && typeof (err as any).code === 'number' ? (err as any).code : (err ? 1 : 0);
			const missing = Boolean(err && ((err as NodeJS.ErrnoException).code === 'ENOENT' || /is not recognized|command not found/i.test(String(stderr ?? ''))));
			resolve({
				ok: !err,
				missing,
				stdout: String(stdout ?? '').trim(),
				stderr: String(stderr ?? '').trim(),
				exitCode: code,
			});
		});
	});
}

function stripJsonComments(raw: string): string {
	let out = '';
	let inStr = false;
	let quote = '';
	let escaped = false;
	for (let i = 0; i < raw.length; i++) {
		const ch = raw[i];
		const next = raw[i + 1];
		if (inStr) {
			out += ch;
			if (escaped) escaped = false;
			else if (ch === '\\') escaped = true;
			else if (ch === quote) inStr = false;
			continue;
		}
		if (ch === '"' || ch === '\'') {
			inStr = true;
			quote = ch;
			out += ch;
			continue;
		}
		if (ch === '/' && next === '/') {
			while (i < raw.length && raw[i] !== '\n') i++;
			out += '\n';
			continue;
		}
		if (ch === '/' && next === '*') {
			i += 2;
			while (i < raw.length && !(raw[i] === '*' && raw[i + 1] === '/')) i++;
			i++;
			continue;
		}
		out += ch;
	}
	return out.replace(/,\s*([}\]])/g, '$1');
}

function safeParseJsonc(filePath: string): { ok: boolean; data?: any; error?: string } {
	try {
		const raw = fs.readFileSync(filePath, 'utf8');
		return { ok: true, data: JSON.parse(stripJsonComments(raw)) };
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}
}

function findWorkspaceFiles(root: string, maxFiles = 200): string[] {
	const out: string[] = [];
	const visit = (dir: string, depth: number) => {
		if (out.length >= maxFiles || depth > 5) return;
		let entries: fs.Dirent[];
		try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
		for (const e of entries) {
			if (out.length >= maxFiles) break;
			if (e.isDirectory()) {
				if (!SKIP_DIRS.has(e.name)) visit(path.join(dir, e.name), depth + 1);
			} else if (e.isFile()) {
				out.push(path.relative(root, path.join(dir, e.name)).replace(/\\/g, '/'));
			}
		}
	};
	if (root && fs.existsSync(root)) visit(root, 0);
	return out;
}

export class DiagnosticReliabilityCoreService extends Disposable implements IKodiaDiagnosticReliabilityMainService {
	readonly _serviceBrand: undefined;

	private readonly _onDidEmitEvent = this._register(new Emitter<KdreEvent>());
	readonly onDidEmitEvent = this._onDidEmitEvent.event;

	private readonly _onDidChangeSnapshot = this._register(new Emitter<KdreLiveSnapshot>());
	readonly onDidChangeSnapshot = this._onDidChangeSnapshot.event;

	private _seq = 0;
	private _recentEvents: KdreEvent[] = [];
	private _snapshots = new Map<string, KdreLiveSnapshot>();
	private _restartCounts = new Map<string, number>();

	private _emit(workspaceRoot: string, type: KdreEvent['type'], message: string, severity: KdreEvent['severity'] = 'info'): void {
		const ev: KdreEvent = {
			eventId: `kdre-ev-${++this._seq}-${Date.now()}`,
			sequence: this._seq,
			timestampMs: Date.now(),
			type,
			message,
			severity,
		};
		this._recentEvents.unshift(ev);
		if (this._recentEvents.length > 80) this._recentEvents.length = 80;
		this._onDidEmitEvent.fire(ev);
		const snap = this._snapshots.get(workspaceRoot);
		if (snap) {
			const updated = { ...snap, recentEvents: this._recentEvents.slice(0, 30) };
			this._snapshots.set(workspaceRoot, updated);
			this._onDidChangeSnapshot.fire(updated);
		}
	}

	private _getOrInitSnapshot(workspaceRoot: string): KdreLiveSnapshot {
		const existing = this._snapshots.get(workspaceRoot);
		if (existing) return existing;
		const init: KdreLiveSnapshot = {
			workspaceRoot,
			systemState: 'ready',
			statusLabel: 'Language services ready',
			updatedAtMs: Date.now(),
			totalEditorDiagnostics: 0,
			confirmedErrorCount: 0,
			potentialFalsePositiveCount: 0,
			staleCount: 0,
			conflictCount: 0,
			serverHealth: [],
			classifiedDiagnostics: [],
			conflicts: [],
			recentEvents: this._recentEvents.slice(0, 30),
		};
		this._snapshots.set(workspaceRoot, init);
		return init;
	}

	private _updateSnapshot(workspaceRoot: string, patch: Partial<KdreLiveSnapshot>): KdreLiveSnapshot {
		const cur = this._getOrInitSnapshot(workspaceRoot);
		const next: KdreLiveSnapshot = {
			...cur,
			...patch,
			updatedAtMs: Date.now(),
			recentEvents: this._recentEvents.slice(0, 30),
		};
		this._snapshots.set(workspaceRoot, next);
		this._onDidChangeSnapshot.fire(next);
		this._persistSnapshot(workspaceRoot, next);
		return next;
	}

	private _persistSnapshot(workspaceRoot: string, snap: KdreLiveSnapshot): void {
		if (!workspaceRoot || !fs.existsSync(workspaceRoot)) return;
		try {
			const dir = path.join(workspaceRoot, '.kodia', 'correctness');
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(path.join(dir, 'kdre-snapshot.json'), JSON.stringify(snap, null, 2), 'utf8');
		} catch { /* non-fatal */ }
	}

	async getSnapshot(workspaceRoot: string): Promise<KdreLiveSnapshot> {
		return this._getOrInitSnapshot(workspaceRoot);
	}

	// ── 1. Project Configuration Intelligence (Phase 1C & 5) ──────────────────────────

	async inspectProjectConfiguration(workspaceRoot: string): Promise<KdreProjectConfigReport> {
		const langs = new Set<string>();
		const frameworks = new Set<string>();
		const pkgManagers = new Set<KdrePackageManager>();
		const configFiles: KdreDiscoveredConfigFile[] = [];
		const tsConfigPaths: string[] = [];
		const subprojects: string[] = [];
		const issues: string[] = [];
		let hasPathAliases = false;
		let hasProjectReferences = false;
		let workspaceTypeScriptVersion: string | undefined;
		let workspaceTypeScriptPath: string | undefined;
		let pythonInterpreterPath: string | undefined;
		let pythonVenvDetected = false;
		let phpComposerDetected = false;

		if (!workspaceRoot || !fs.existsSync(workspaceRoot)) {
			issues.push('Workspace root directory does not exist.');
			return {
				workspaceRoot,
				scannedAtMs: Date.now(),
				detectedLanguages: [],
				detectedFrameworks: [],
				packageManagers: [],
				isMonorepo: false,
				subprojects: [],
				configFiles: [],
				tsConfigPaths: [],
				hasPathAliases: false,
				hasProjectReferences: false,
				pythonVenvDetected: false,
				phpComposerDetected: false,
				issues,
			};
		}

		const candidateDirs: { rel: string; abs: string }[] = [{ rel: '', abs: workspaceRoot }];
		for (const sub of SUBPROJECT_ROOTS) {
			const subAbs = path.join(workspaceRoot, sub);
			if (!fs.existsSync(subAbs) || !fs.statSync(subAbs).isDirectory()) continue;
			if (fs.existsSync(path.join(subAbs, 'package.json')) || fs.existsSync(path.join(subAbs, 'tsconfig.json')) || fs.existsSync(path.join(subAbs, 'pyproject.toml')) || fs.existsSync(path.join(subAbs, 'composer.json'))) {
				candidateDirs.push({ rel: sub, abs: subAbs });
				subprojects.push(sub);
			}
			if (sub === 'apps' || sub === 'packages' || sub === 'services') {
				try {
					for (const e of fs.readdirSync(subAbs, { withFileTypes: true })) {
						if (!e.isDirectory()) continue;
						const childAbs = path.join(subAbs, e.name);
						const childRel = `${sub}/${e.name}`;
						if (fs.existsSync(path.join(childAbs, 'package.json')) || fs.existsSync(path.join(childAbs, 'tsconfig.json')) || fs.existsSync(path.join(childAbs, 'pyproject.toml'))) {
							candidateDirs.push({ rel: childRel, abs: childAbs });
							subprojects.push(childRel);
						}
					}
				} catch { /* ignore */ }
			}
		}

		for (const dir of candidateDirs) {
			const relOf = (name: string) => dir.rel ? `${dir.rel}/${name}` : name;

			// package.json
			const pkgPath = path.join(dir.abs, 'package.json');
			if (fs.existsSync(pkgPath)) {
				const parsed = safeParseJsonc(pkgPath);
				configFiles.push({ path: relOf('package.json'), kind: 'package_json', validJsonOrSyntax: parsed.ok, parseError: parsed.error });
				if (!parsed.ok) {
					issues.push(`Invalid JSON in ${relOf('package.json')}: ${parsed.error}`);
				} else if (parsed.data) {
					langs.add('JavaScript');
					const allDeps = { ...(parsed.data.dependencies ?? {}), ...(parsed.data.devDependencies ?? {}) };
					if (allDeps.typescript) langs.add('TypeScript');
					if (allDeps.react) frameworks.add('React');
					if (allDeps['react-native']) frameworks.add('React Native');
					if (allDeps.expo) frameworks.add('Expo');
					if (allDeps.next) frameworks.add('Next.js');
					if (allDeps.vue) frameworks.add('Vue');
					if (allDeps.nuxt) frameworks.add('Nuxt');
					if (allDeps['@angular/core']) frameworks.add('Angular');
					if (allDeps.svelte) frameworks.add('Svelte');
					if (allDeps.astro) frameworks.add('Astro');
					if (allDeps.fastify) frameworks.add('Fastify');
					if (allDeps.express) frameworks.add('Express');
					if (allDeps['@nestjs/core']) frameworks.add('NestJS');
					if (allDeps.prisma || allDeps['@prisma/client']) frameworks.add('Prisma');
					if (allDeps.vite) frameworks.add('Vite');
					if (parsed.data.workspaces) subprojects.push('(workspaces)');
				}
			}

			// tsconfig.json / jsconfig.json
			for (const cfgName of ['tsconfig.json', 'jsconfig.json'] as const) {
				const cfgPath = path.join(dir.abs, cfgName);
				if (!fs.existsSync(cfgPath)) continue;
				const parsed = safeParseJsonc(cfgPath);
				const rel = relOf(cfgName);
				if (cfgName === 'tsconfig.json') {
					langs.add('TypeScript');
					tsConfigPaths.push(rel);
				} else {
					langs.add('JavaScript');
				}
				const opts = parsed.data?.compilerOptions ?? {};
				if (opts.paths && Object.keys(opts.paths).length > 0) hasPathAliases = true;
				if (Array.isArray(parsed.data?.references) && parsed.data.references.length > 0) hasProjectReferences = true;
				const details = parsed.ok
					? `target=${opts.target ?? 'default'}, moduleResolution=${opts.moduleResolution ?? 'default'}, strict=${opts.strict ?? 'default'}`
					: undefined;
				configFiles.push({
					path: rel,
					kind: cfgName === 'tsconfig.json' ? 'tsconfig' : 'jsconfig',
					validJsonOrSyntax: parsed.ok,
					parseError: parsed.error,
					details,
				});
				if (!parsed.ok) issues.push(`Invalid ${rel}: ${parsed.error}`);
			}

			// Workspace TypeScript binary/package discovery
			if (!workspaceTypeScriptVersion) {
				const tsPkg = path.join(dir.abs, 'node_modules', 'typescript', 'package.json');
				if (fs.existsSync(tsPkg)) {
					const parsedTs = safeParseJsonc(tsPkg);
					if (parsedTs.ok && parsedTs.data?.version) {
						workspaceTypeScriptVersion = String(parsedTs.data.version);
						workspaceTypeScriptPath = relOf('node_modules/typescript');
					}
				}
			}
		}

		// Lockfiles & package managers
		const lockChecks: [string, KdrePackageManager][] = [
			['package-lock.json', 'npm'],
			['pnpm-lock.yaml', 'pnpm'],
			['yarn.lock', 'yarn'],
			['bun.lockb', 'bun'],
			['poetry.lock', 'poetry'],
			['uv.lock', 'uv'],
			['composer.lock', 'composer'],
			['Cargo.lock', 'cargo'],
			['go.sum', 'go'],
		];
		for (const [file, pm] of lockChecks) {
			if (fs.existsSync(path.join(workspaceRoot, file))) {
				pkgManagers.add(pm);
				configFiles.push({ path: file, kind: 'lockfile', validJsonOrSyntax: true });
			}
		}

		// Python configs & virtual environments
		for (const pyFile of ['pyproject.toml', 'setup.cfg', 'tox.ini', 'requirements.txt', 'mypy.ini', 'pyrightconfig.json']) {
			if (fs.existsSync(path.join(workspaceRoot, pyFile))) {
				langs.add('Python');
				if (pyFile === 'requirements.txt') pkgManagers.add('pip');
				configFiles.push({ path: pyFile, kind: 'python_config', validJsonOrSyntax: true });
			}
		}
		const venvCandidates = [
			path.join(workspaceRoot, '.venv', 'Scripts', 'python.exe'),
			path.join(workspaceRoot, 'venv', 'Scripts', 'python.exe'),
			path.join(workspaceRoot, '.venv', 'bin', 'python'),
			path.join(workspaceRoot, 'venv', 'bin', 'python'),
			path.join(workspaceRoot, 'env', 'bin', 'python'),
		];
		for (const cand of venvCandidates) {
			if (fs.existsSync(cand)) {
				pythonInterpreterPath = cand;
				pythonVenvDetected = true;
				langs.add('Python');
				break;
			}
		}

		// PHP / Go / Rust / Java / Kotlin / .NET / Flutter / EditorConfig
		if (fs.existsSync(path.join(workspaceRoot, 'composer.json'))) {
			langs.add('PHP');
			pkgManagers.add('composer');
			phpComposerDetected = true;
			const parsed = safeParseJsonc(path.join(workspaceRoot, 'composer.json'));
			configFiles.push({ path: 'composer.json', kind: 'php_config', validJsonOrSyntax: parsed.ok, parseError: parsed.error });
			if (parsed.ok && parsed.data?.require?.['laravel/framework']) frameworks.add('Laravel');
			if (parsed.ok && parsed.data?.require?.['symfony/framework-bundle']) frameworks.add('Symfony');
		}
		if (fs.existsSync(path.join(workspaceRoot, 'go.mod'))) {
			langs.add('Go');
			pkgManagers.add('go');
			configFiles.push({ path: 'go.mod', kind: 'go_mod', validJsonOrSyntax: true });
		}
		if (fs.existsSync(path.join(workspaceRoot, 'Cargo.toml'))) {
			langs.add('Rust');
			pkgManagers.add('cargo');
			configFiles.push({ path: 'Cargo.toml', kind: 'cargo_toml', validJsonOrSyntax: true });
		}
		for (const jb of ['build.gradle', 'build.gradle.kts', 'settings.gradle', 'pom.xml']) {
			if (fs.existsSync(path.join(workspaceRoot, jb))) {
				langs.add(jb.endsWith('.kts') ? 'Kotlin' : 'Java');
				pkgManagers.add(jb === 'pom.xml' ? 'maven' : 'gradle');
				configFiles.push({ path: jb, kind: 'java_build', validJsonOrSyntax: true });
			}
		}
		if (fs.existsSync(path.join(workspaceRoot, 'pubspec.yaml'))) {
			langs.add('Dart');
			frameworks.add('Flutter');
			pkgManagers.add('pub');
			configFiles.push({ path: 'pubspec.yaml', kind: 'framework_config', validJsonOrSyntax: true });
		}
		if (fs.existsSync(path.join(workspaceRoot, 'Directory.Build.props'))) {
			langs.add('C#');
			pkgManagers.add('dotnet');
			configFiles.push({ path: 'Directory.Build.props', kind: 'dotnet_props', validJsonOrSyntax: true });
		}
		if (fs.existsSync(path.join(workspaceRoot, '.editorconfig'))) {
			configFiles.push({ path: '.editorconfig', kind: 'editorconfig', validJsonOrSyntax: true });
		}

		// Detect source files if no config file declared a language yet
		const sampleFiles = findWorkspaceFiles(workspaceRoot, 120);
		if (sampleFiles.some(f => /\.tsx?$/i.test(f))) langs.add('TypeScript');
		if (sampleFiles.some(f => /\.jsx?$/i.test(f))) langs.add('JavaScript');
		if (sampleFiles.some(f => /\.py$/i.test(f))) langs.add('Python');
		if (sampleFiles.some(f => /\.php$/i.test(f))) langs.add('PHP');

		if (langs.has('TypeScript') && tsConfigPaths.length === 0) {
			issues.push('TypeScript source files found without a tsconfig.json — TS Server uses inferred project settings which may differ from compiler defaults.');
		}

		const report: KdreProjectConfigReport = {
			workspaceRoot,
			scannedAtMs: Date.now(),
			detectedLanguages: [...langs],
			detectedFrameworks: [...frameworks],
			packageManagers: [...pkgManagers],
			isMonorepo: subprojects.length > 0 || fs.existsSync(path.join(workspaceRoot, 'pnpm-workspace.yaml')) || fs.existsSync(path.join(workspaceRoot, 'turbo.json')) || fs.existsSync(path.join(workspaceRoot, 'nx.json')),
			subprojects: [...new Set(subprojects)],
			configFiles,
			tsConfigPaths,
			hasPathAliases,
			hasProjectReferences,
			workspaceTypeScriptVersion,
			workspaceTypeScriptPath,
			pythonInterpreterPath,
			pythonVenvDetected,
			phpComposerDetected,
			issues,
		};

		this._updateSnapshot(workspaceRoot, { projectConfig: report });
		this._emit(workspaceRoot, 'config_scanned', `Scanned ${configFiles.length} config file(s); detected ${report.detectedLanguages.join(', ') || 'no languages'}`, issues.length ? 'warning' : 'success');
		return report;
	}

	// ── 2. Dependency & Module Resolution Verification (Phase 1D) ─────────────────────

	async verifyDependencyResolution(workspaceRoot: string): Promise<KdreDependencyHealthReport> {
		const warnings: string[] = [];
		const missingDeclaredDeps: string[] = [];
		const nodeModulesPath = path.join(workspaceRoot, 'node_modules');
		const nodeModulesPresent = fs.existsSync(nodeModulesPath);
		const hasTypesPackages = fs.existsSync(path.join(nodeModulesPath, '@types'));
		const pnpmWorkspaceDetected = fs.existsSync(path.join(workspaceRoot, 'pnpm-workspace.yaml')) || fs.existsSync(path.join(nodeModulesPath, '.pnpm'));
		const yarnPnpDetected = fs.existsSync(path.join(workspaceRoot, '.pnp.cjs')) || fs.existsSync(path.join(workspaceRoot, '.pnp.js'));

		const pkgPath = path.join(workspaceRoot, 'package.json');
		if (fs.existsSync(pkgPath)) {
			const parsed = safeParseJsonc(pkgPath);
			if (parsed.ok && parsed.data) {
				const declared = { ...(parsed.data.dependencies ?? {}), ...(parsed.data.devDependencies ?? {}) };
				const depNames = Object.keys(declared);
				if (depNames.length > 0 && !nodeModulesPresent && !yarnPnpDetected) {
					warnings.push(`package.json declares ${depNames.length} dependencies, but node_modules is missing — run package install before trusting unresolved-import diagnostics.`);
					missingDeclaredDeps.push(...depNames.slice(0, 15));
				} else if (nodeModulesPresent) {
					for (const dep of depNames.slice(0, 60)) {
						const depDir = path.join(nodeModulesPath, ...dep.split('/'));
						if (!fs.existsSync(depDir)) {
							missingDeclaredDeps.push(dep);
						}
					}
					if (missingDeclaredDeps.length > 0) {
						warnings.push(`${missingDeclaredDeps.length} declared package(s) missing from node_modules: ${missingDeclaredDeps.slice(0, 6).join(', ')}`);
					}
				}
			}
		}

		const pythonSitePackagesPresent = [
			path.join(workspaceRoot, '.venv', 'Lib', 'site-packages'),
			path.join(workspaceRoot, 'venv', 'Lib', 'site-packages'),
			path.join(workspaceRoot, '.venv', 'lib'),
			path.join(workspaceRoot, 'venv', 'lib'),
		].some(p => fs.existsSync(p));

		if ((fs.existsSync(path.join(workspaceRoot, 'requirements.txt')) || fs.existsSync(path.join(workspaceRoot, 'pyproject.toml'))) && !pythonSitePackagesPresent) {
			warnings.push('Python project detected without a local .venv/venv directory — ensure the active Python interpreter matches installed packages.');
		}

		const phpVendorAutoloadPresent = fs.existsSync(path.join(workspaceRoot, 'vendor', 'autoload.php'));
		if (fs.existsSync(path.join(workspaceRoot, 'composer.json')) && !phpVendorAutoloadPresent) {
			warnings.push('composer.json found without vendor/autoload.php — run composer install for accurate PHP symbol resolution.');
		}

		const report: KdreDependencyHealthReport = {
			workspaceRoot,
			checkedAtMs: Date.now(),
			nodeModulesPresent,
			hasTypesPackages,
			pnpmWorkspaceDetected,
			yarnPnpDetected,
			pythonSitePackagesPresent,
			phpVendorAutoloadPresent,
			missingDeclaredDeps,
			resolutionWarnings: warnings,
			healthy: warnings.length === 0 && missingDeclaredDeps.length === 0,
		};

		this._updateSnapshot(workspaceRoot, { dependencyHealth: report });
		this._emit(workspaceRoot, 'dependencies_checked', report.healthy ? 'Dependency resolution paths verified healthy' : `${warnings.length} dependency resolution warning(s)`, report.healthy ? 'success' : 'warning');
		return report;
	}

	// ── 3. Language Server Health Probe (Phase 4) ─────────────────────────────────────

	async probeLanguageServerHealth(workspaceRoot: string): Promise<readonly KdreLanguageServerHealth[]> {
		const cfg = this._snapshots.get(workspaceRoot)?.projectConfig ?? await this.inspectProjectConfiguration(workspaceRoot);
		const now = Date.now();
		const health: KdreLanguageServerHealth[] = [];

		if (cfg.detectedLanguages.includes('TypeScript') || cfg.detectedLanguages.includes('JavaScript')) {
			const hasWsTs = Boolean(cfg.workspaceTypeScriptVersion);
			health.push({
				language: 'TypeScript / JavaScript',
				serverName: 'TypeScript Language Server (tsserver)',
				status: hasWsTs || cfg.tsConfigPaths.length > 0 ? 'healthy' : 'degraded',
				version: cfg.workspaceTypeScriptVersion ?? 'bundled',
				binaryPath: cfg.workspaceTypeScriptPath,
				workspaceConfigured: cfg.tsConfigPaths.length > 0,
				restartCount: this._restartCounts.get('typescript') ?? 0,
				lastCheckedAtMs: now,
				issue: !hasWsTs && cfg.detectedLanguages.includes('TypeScript')
					? 'Workspace node_modules/typescript not found; TS Server falls back to bundled TypeScript.'
					: undefined,
				recommendedAction: !hasWsTs ? 'recheck_dependencies' : undefined,
			});
		}

		if (cfg.detectedLanguages.includes('Python')) {
			const pyBin = cfg.pythonInterpreterPath ?? 'python';
			const r = await runExecFile(pyBin, ['--version'], workspaceRoot, 5000);
			const pyright = await runExecFile('pyright', ['--version'], workspaceRoot, 5000);
			health.push({
				language: 'Python',
				serverName: pyright.ok ? 'Pyright' : 'Python Runtime (py_compile)',
				status: r.ok ? (pyright.ok ? 'healthy' : 'degraded') : 'unavailable',
				version: pyright.ok ? pyright.stdout : (r.stdout || r.stderr || undefined),
				binaryPath: cfg.pythonInterpreterPath,
				workspaceConfigured: cfg.pythonVenvDetected,
				restartCount: this._restartCounts.get('python') ?? 0,
				lastCheckedAtMs: now,
				issue: !r.ok ? 'Python runtime unavailable on host.' : !pyright.ok ? 'Pyright not installed on PATH; falling back to python -m py_compile.' : undefined,
			});
		}

		if (cfg.detectedLanguages.includes('PHP')) {
			const r = await runExecFile('php', ['-v'], workspaceRoot, 5000);
			health.push({
				language: 'PHP',
				serverName: 'PHP Language Features / php -l',
				status: r.ok ? 'healthy' : 'unavailable',
				version: r.ok ? r.stdout.split(/\r?\n/)[0] : undefined,
				workspaceConfigured: cfg.phpComposerDetected,
				restartCount: this._restartCounts.get('php') ?? 0,
				lastCheckedAtMs: now,
				issue: !r.ok ? 'PHP CLI not found on PATH.' : undefined,
			});
		}

		if (cfg.detectedLanguages.includes('Go')) {
			const r = await runExecFile('gopls', ['version'], workspaceRoot, 5000);
			const go = await runExecFile('go', ['version'], workspaceRoot, 5000);
			health.push({
				language: 'Go',
				serverName: 'gopls',
				status: r.ok ? 'healthy' : go.ok ? 'degraded' : 'unavailable',
				version: r.ok ? r.stdout.split(/\r?\n/)[0] : go.ok ? go.stdout : undefined,
				workspaceConfigured: true,
				restartCount: this._restartCounts.get('go') ?? 0,
				lastCheckedAtMs: now,
				issue: !r.ok ? 'gopls not installed on PATH.' : undefined,
			});
		}

		if (cfg.detectedLanguages.includes('Rust')) {
			const r = await runExecFile('rust-analyzer', ['--version'], workspaceRoot, 5000);
			health.push({
				language: 'Rust',
				serverName: 'rust-analyzer',
				status: r.ok ? 'healthy' : 'unavailable',
				version: r.ok ? r.stdout : undefined,
				workspaceConfigured: true,
				restartCount: this._restartCounts.get('rust') ?? 0,
				lastCheckedAtMs: now,
				issue: !r.ok ? 'rust-analyzer not installed on PATH.' : undefined,
			});
		}

		if (cfg.detectedLanguages.includes('Dart')) {
			const r = await runExecFile('dart', ['--version'], workspaceRoot, 5000);
			health.push({
				language: 'Dart / Flutter',
				serverName: 'Dart Analysis Server',
				status: r.ok ? 'healthy' : 'unavailable',
				version: r.ok ? (r.stdout || r.stderr) : undefined,
				workspaceConfigured: true,
				restartCount: this._restartCounts.get('dart') ?? 0,
				lastCheckedAtMs: now,
				issue: !r.ok ? 'Dart SDK not installed on PATH.' : undefined,
			});
		}

		this._updateSnapshot(workspaceRoot, { serverHealth: health });
		this._emit(workspaceRoot, 'server_health_updated', `Probed ${health.length} language service(s)`, health.some(h => h.status === 'unavailable' || h.status === 'crashed') ? 'warning' : 'success');
		return health;
	}

	// ── 4. Independent Multi-Language Compiler / Type-Checker Verification (Phase 6) ──

	async runIndependentVerification(
		workspaceRoot: string,
		opts?: { targetFiles?: readonly string[]; languages?: readonly string[] },
	): Promise<KdreCompilerVerificationReport> {
		const verificationId = `kdre-ver-${crypto.randomBytes(4).toString('hex')}`;
		this._updateSnapshot(workspaceRoot, { systemState: 'verifying', statusLabel: 'Running independent compiler verification…' });
		this._emit(workspaceRoot, 'compiler_verification_started', `Starting independent compiler verification in ${workspaceRoot}`);

		const cfg = this._snapshots.get(workspaceRoot)?.projectConfig ?? await this.inspectProjectConfiguration(workspaceRoot);
		const runs: KdreCompilerToolRun[] = [];
		const allFiles = opts?.targetFiles?.length
			? opts.targetFiles.map(f => f.replace(/\\/g, '/'))
			: findWorkspaceFiles(workspaceRoot, 250);

		const wantLang = (re: RegExp) => !opts?.languages?.length || opts.languages.some(l => re.test(l));

		// A. TypeScript (`tsc --noEmit`) — ALWAYS prefer the project's OWN workspace tsc first!
		const tsFiles = allFiles.filter(f => /\.(ts|tsx|mts|cts)$/i.test(f));
		if ((cfg.tsConfigPaths.length > 0 || tsFiles.length > 0) && wantLang(/ts|typescript/i)) {
			const projectsToCheck = cfg.tsConfigPaths.length > 0 ? cfg.tsConfigPaths.slice(0, 4) : [''];
			for (const relTsConfig of projectsToCheck) {
				const t0 = Date.now();
				const projDir = relTsConfig ? path.dirname(path.join(workspaceRoot, relTsConfig)) : workspaceRoot;
				const extBin = process.platform === 'win32' ? 'tsc.cmd' : 'tsc';
				const candidates = [
					path.join(projDir, 'node_modules', '.bin', extBin),
					path.join(workspaceRoot, 'node_modules', '.bin', extBin),
				];
				const chosenBin = candidates.find(c => fs.existsSync(c)) ?? 'tsc';
				const verRes = await runExecFile(chosenBin, ['--version'], projDir, 5000);
				if (verRes.missing) {
					runs.push({
						engine: 'tsc',
						language: 'TypeScript',
						available: false,
						cwd: projDir,
						passed: false,
						durationMs: Date.now() - t0,
						diagnostics: [],
						errorNote: 'No workspace or PATH tsc binary found.',
					});
					continue;
				}
				const args = relTsConfig
					? ['--noEmit', '--pretty', 'false', '-p', path.join(workspaceRoot, relTsConfig)]
					: ['--noEmit', '--pretty', 'false', '--skipLibCheck', ...tsFiles.slice(0, 15).map(f => path.join(workspaceRoot, f))];
				const r = await runExecFile(chosenBin, args, projDir, 25_000);
				const diags: KdreCompilerDiagnostic[] = [];
				for (const line of `${r.stdout}\n${r.stderr}`.split(/\r?\n/)) {
					const m = /^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+(TS\d+):\s*(.+)$/.exec(line.trim());
					if (m) {
						const absFile = path.isAbsolute(m[1]) ? m[1] : path.resolve(projDir, m[1]);
						const relFile = path.relative(workspaceRoot, absFile).replace(/\\/g, '/');
						diags.push({
							engine: 'tsc',
							language: 'TypeScript',
							code: m[5],
							severity: m[4] === 'error' ? 'error' : 'warning',
							file: relFile,
							line: Number(m[2]),
							column: Number(m[3]),
							message: m[6].trim(),
						});
					}
				}
				runs.push({
					engine: relTsConfig ? `tsc (${relTsConfig})` : 'tsc',
					language: 'TypeScript',
					available: true,
					version: verRes.stdout || undefined,
					command: `${path.basename(chosenBin)} ${args.join(' ')}`,
					cwd: projDir,
					passed: r.ok && diags.filter(d => d.severity === 'error').length === 0,
					durationMs: Date.now() - t0,
					diagnostics: diags,
				});
			}
		}

		// B. JavaScript (`node --check`)
		const jsFiles = allFiles.filter(f => /\.(js|cjs|mjs)$/i.test(f));
		if (jsFiles.length > 0 && wantLang(/js|javascript|node/i)) {
			const t0 = Date.now();
			const diags: KdreCompilerDiagnostic[] = [];
			let available = true;
			for (const jf of jsFiles.slice(0, 25)) {
				const abs = path.isAbsolute(jf) ? jf : path.join(workspaceRoot, jf);
				if (!fs.existsSync(abs)) continue;
				const r = await runExecFile('node', ['--check', abs], workspaceRoot, 8000);
				if (r.missing) { available = false; break; }
				if (!r.ok) {
					const combined = `${r.stderr}\n${r.stdout}`;
					const lm = /:(\d+)\r?\n/.exec(combined);
					const msg = combined.split(/\r?\n/).find(l => /SyntaxError|Error:/i.test(l)) ?? 'JavaScript syntax error';
					diags.push({
						engine: 'node --check',
						language: 'JavaScript',
						code: 'NODE-SYNTAX',
						severity: 'error',
						file: jf,
						line: lm ? Number(lm[1]) : 1,
						column: 1,
						message: msg.trim(),
					});
				}
			}
			runs.push({
				engine: 'node --check',
				language: 'JavaScript',
				available,
				command: `node --check (${Math.min(25, jsFiles.length)} files)`,
				cwd: workspaceRoot,
				passed: available && diags.length === 0,
				durationMs: Date.now() - t0,
				diagnostics: diags,
			});
		}

		// C. Python (`pyright` if installed + `<venv-python> -m py_compile`)
		const pyFiles = allFiles.filter(f => /\.py$/i.test(f));
		if (pyFiles.length > 0 && wantLang(/py|python/i)) {
			const t0 = Date.now();
			const pyBin = cfg.pythonInterpreterPath ?? 'python';
			const diags: KdreCompilerDiagnostic[] = [];
			let available = true;
			for (const pf of pyFiles.slice(0, 25)) {
				const abs = path.isAbsolute(pf) ? pf : path.join(workspaceRoot, pf);
				if (!fs.existsSync(abs)) continue;
				const r = await runExecFile(pyBin, ['-m', 'py_compile', abs], workspaceRoot, 8000);
				if (r.missing) { available = false; break; }
				if (!r.ok) {
					const combined = `${r.stderr}\n${r.stdout}`;
					const lm = /line\s+(\d+)/i.exec(combined);
					const msg = combined.split(/\r?\n/).filter(Boolean).pop() ?? 'Python syntax error';
					diags.push({
						engine: 'python -m py_compile',
						language: 'Python',
						code: 'PY-SYNTAX',
						severity: 'error',
						file: pf,
						line: lm ? Number(lm[1]) : 1,
						column: 1,
						message: msg.trim(),
					});
				}
			}
			runs.push({
				engine: 'python -m py_compile',
				language: 'Python',
				available,
				command: `${path.basename(pyBin)} -m py_compile`,
				cwd: workspaceRoot,
				passed: available && diags.length === 0,
				durationMs: Date.now() - t0,
				diagnostics: diags,
			});
		}

		// D. PHP (`php -l`)
		const phpFiles = allFiles.filter(f => /\.php$/i.test(f));
		if (phpFiles.length > 0 && wantLang(/php/i)) {
			const t0 = Date.now();
			const diags: KdreCompilerDiagnostic[] = [];
			let available = true;
			for (const pf of phpFiles.slice(0, 20)) {
				const abs = path.isAbsolute(pf) ? pf : path.join(workspaceRoot, pf);
				if (!fs.existsSync(abs)) continue;
				const r = await runExecFile('php', ['-l', abs], workspaceRoot, 8000);
				if (r.missing) { available = false; break; }
				if (!r.ok) {
					const combined = `${r.stdout}\n${r.stderr}`;
					const lm = /on line\s+(\d+)/i.exec(combined);
					diags.push({
						engine: 'php -l',
						language: 'PHP',
						code: 'PHP-SYNTAX',
						severity: 'error',
						file: pf,
						line: lm ? Number(lm[1]) : 1,
						column: 1,
						message: combined.split(/\r?\n/)[0]?.trim() || 'PHP syntax error',
					});
				}
			}
			runs.push({
				engine: 'php -l',
				language: 'PHP',
				available,
				command: 'php -l',
				cwd: workspaceRoot,
				passed: available && diags.length === 0,
				durationMs: Date.now() - t0,
				diagnostics: diags,
			});
		}

		const totalErrors = runs.reduce((s, r) => s + r.diagnostics.filter(d => d.severity === 'error').length, 0);
		const totalWarnings = runs.reduce((s, r) => s + r.diagnostics.filter(d => d.severity === 'warning').length, 0);
		const availableRuns = runs.filter(r => r.available);
		const passed = availableRuns.length > 0 && availableRuns.every(r => r.passed);

		const report: KdreCompilerVerificationReport = {
			verificationId,
			workspaceRoot,
			executedAtMs: Date.now(),
			runs,
			totalErrors,
			totalWarnings,
			passed,
			summary: availableRuns.length === 0
				? 'No applicable local compiler/validator binaries were available on this host.'
				: passed
					? `All ${availableRuns.length} compiler/type-checker check(s) PASSED (0 errors).`
					: `${totalErrors} compiler-confirmed error(s) and ${totalWarnings} warning(s) across ${availableRuns.length} engine(s).`,
		};

		this._updateSnapshot(workspaceRoot, {
			lastVerification: report,
			systemState: passed ? 'ready' : 'ready',
			statusLabel: passed ? 'Diagnostics verified clean' : `${totalErrors} compiler-confirmed error(s)`,
		});
		this._emit(workspaceRoot, 'compiler_verification_completed', report.summary, passed ? 'success' : 'warning');
		return report;
	}

	// ── 5. Evaluate, Classify & Detect Conflicts Across Live Editor Diagnostics ───────

	async evaluateDiagnostics(
		workspaceRoot: string,
		rawDiagnostics: readonly KdreRawDiagnostic[],
		opts?: { runCompiler?: boolean; suppressions?: readonly { ruleId: string; filePattern?: string; justification: string }[] },
	): Promise<{
		classified: readonly KdreClassifiedDiagnostic[];
		conflicts: readonly KdreDiagnosticConflict[];
		comparison: KdreCrossEditorComparisonReport;
		snapshot: KdreLiveSnapshot;
	}> {
		const snap = this._getOrInitSnapshot(workspaceRoot);
		const projectConfig = snap.projectConfig ?? await this.inspectProjectConfiguration(workspaceRoot);
		const dependencyHealth = snap.dependencyHealth ?? await this.verifyDependencyResolution(workspaceRoot);
		const serverHealth = snap.serverHealth.length ? snap.serverHealth : await this.probeLanguageServerHealth(workspaceRoot);
		const compilerVerification = opts?.runCompiler
			? await this.runIndependentVerification(workspaceRoot)
			: snap.lastVerification;

		// Enrich fileExists accurately from disk when caller didn't pre-check
		const enrichedRaw: KdreRawDiagnostic[] = rawDiagnostics.map(d => {
			if (d.fileExists !== undefined) return d;
			const abs = path.isAbsolute(d.file) ? d.file : path.join(workspaceRoot, d.file);
			return { ...d, fileExists: fs.existsSync(abs) };
		});

		const { classified, conflicts, comparison } = classifyDiagnosticsWithEvidence({
			workspaceRoot,
			rawDiagnostics: enrichedRaw,
			projectConfig,
			dependencyHealth,
			serverHealth,
			compilerVerification,
			suppressions: opts?.suppressions,
		});

		const confirmedErrorCount = classified.filter(c => (c.classification === 'compiler_confirmed' || c.classification === 'type_checker_confirmed') && c.raw.severity === 'error').length;
		const staleCount = classified.filter(c => c.classification === 'potentially_stale').length;
		const potentialFalsePositiveCount = classified.filter(c => c.verificationStatus === 'refuted_by_compiler' || c.classification === 'potentially_stale').length;

		let systemState: KdreSystemState = 'ready';
		let statusLabel = 'Diagnostics current';
		if (serverHealth.some(s => s.status === 'crashed' || s.status === 'unavailable')) {
			systemState = 'degraded';
			statusLabel = 'Language service degraded';
		} else if (staleCount > 0) {
			systemState = 'stale';
			statusLabel = `${staleCount} stale diagnostic(s) detected`;
		} else if (conflicts.length > 0) {
			systemState = 'degraded';
			statusLabel = `${conflicts.length} LSP/compiler conflict(s)`;
		} else if (compilerVerification) {
			statusLabel = confirmedErrorCount > 0 ? `${confirmedErrorCount} confirmed error(s)` : 'Diagnostics verified current';
		}

		const nextSnap = this._updateSnapshot(workspaceRoot, {
			systemState,
			statusLabel,
			totalEditorDiagnostics: rawDiagnostics.length,
			confirmedErrorCount,
			potentialFalsePositiveCount,
			staleCount,
			conflictCount: conflicts.length,
			classifiedDiagnostics: classified.slice(0, 200),
			conflicts: conflicts.slice(0, 100),
		});

		if (conflicts.length > 0) {
			this._emit(workspaceRoot, 'conflict_detected', `Detected ${conflicts.length} diagnostic conflict(s) between editor LSP and compiler`, 'warning');
		} else {
			this._emit(workspaceRoot, 'diagnostics_classified', `Classified ${classified.length} diagnostic(s) (${confirmedErrorCount} compiler-confirmed, ${staleCount} stale)`, 'info');
		}

		return { classified, conflicts, comparison, snapshot: nextSnap };
	}

	async investigateDiagnostic(
		workspaceRoot: string,
		diagnostic: KdreRawDiagnostic,
		opts?: { runCompiler?: boolean },
	): Promise<KdreInvestigationReport> {
		const snap = this._getOrInitSnapshot(workspaceRoot);
		const projectConfig = snap.projectConfig ?? await this.inspectProjectConfiguration(workspaceRoot);
		const dependencyHealth = snap.dependencyHealth ?? await this.verifyDependencyResolution(workspaceRoot);
		const serverHealth = snap.serverHealth.length ? snap.serverHealth : await this.probeLanguageServerHealth(workspaceRoot);
		const compilerVerification = opts?.runCompiler !== false
			? await this.runIndependentVerification(workspaceRoot, { targetFiles: [diagnostic.file] })
			: snap.lastVerification;

		const abs = path.isAbsolute(diagnostic.file) ? diagnostic.file : path.join(workspaceRoot, diagnostic.file);
		const enriched: KdreRawDiagnostic = {
			...diagnostic,
			fileExists: diagnostic.fileExists ?? fs.existsSync(abs),
		};

		return investigateSuspiciousDiagnostic({
			workspaceRoot,
			raw: enriched,
			projectConfig,
			dependencyHealth,
			serverHealth,
			compilerVerification,
		});
	}

	async recordRecoveryAction(workspaceRoot: string, result: KdreRecoveryResult): Promise<KdreLiveSnapshot> {
		if (result.action === 'restart_language_server' && result.targetLanguage) {
			const k = result.targetLanguage.toLowerCase();
			this._restartCounts.set(k, (this._restartCounts.get(k) ?? 0) + 1);
		}
		this._emit(workspaceRoot, 'recovery_executed', `${result.action}: ${result.summary}`, result.executed ? 'success' : 'warning');
		return this._updateSnapshot(workspaceRoot, {
			systemState: result.executed ? 'ready' : 'degraded',
			statusLabel: result.executed ? 'Recovered — diagnostics synced' : 'Recovery incomplete',
		});
	}
}
