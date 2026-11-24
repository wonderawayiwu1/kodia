/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { execFile, spawn } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import {
	analyzeMobileProjectFiles,
	assessMobileProductionReadiness,
	auditMobilePerformance,
	auditMobileSecurity,
	designMobileArchitecture,
	generateMobileProjectFiles,
	MobileWorkspaceFile,
} from '../common/mobileEngineeringKnowledge.js';
import {
	IKodiaMobileMainService,
	MobileArchitectureDesignReport,
	MobileArchitectureRequest,
	MobileBuildTestRequest,
	MobileBuildTestResult,
	MobileDeviceActionRequest,
	MobileDeviceActionResult,
	MobileDiscoveredDevice,
	MobileEnvironmentProbeReport,
	MobileLiveEvent,
	MobilePerformanceAuditReport,
	MobileProductionReadinessReport,
	MobileProjectIntelligenceReport,
	MobileScaffoldRequest,
	MobileScaffoldResult,
	MobileSecurityAuditReport,
	MobileToolchainItem,
	MobileWorkspaceSnapshot,
} from '../common/mobileEngineeringTypes.js';

const SKIP_DIRS = new Set(['node_modules', '.git', '.kodia', 'dist', 'out', 'out-vscode', 'out-vscode-min', 'build', '.gradle', 'Pods', '.dart_tool', '__pycache__', '.venv', 'venv']);
const TEXT_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.dart', '.yaml', '.yml', '.kt', '.kts', '.java', '.swift', '.xml', '.plist', '.gradle', '.py', '.go', '.rs', '.cs', '.csproj', '.md', '.env', '.toml']);

interface ExecProbeResult {
	ok: boolean;
	exitCode: number | null;
	stdout: string;
	stderr: string;
	durationMs: number;
}

function runProcessCapture(bin: string, args: string[], opts?: { cwd?: string; timeoutMs?: number; shell?: boolean }): Promise<ExecProbeResult> {
	const start = Date.now();
	const timeoutMs = opts?.timeoutMs ?? 8000;
	return new Promise(resolve => {
		try {
			const child = execFile(bin, args, {
				cwd: opts?.cwd,
				timeout: timeoutMs,
				maxBuffer: 4 * 1024 * 1024,
				windowsHide: true,
				shell: opts?.shell ?? (process.platform === 'win32'),
			}, (error, stdout, stderr) => {
				const code = error && typeof (error as any).code === 'number' ? (error as any).code : (error ? 1 : 0);
				resolve({
					ok: !error,
					exitCode: code,
					stdout: String(stdout ?? '').trim(),
					stderr: String(stderr ?? '').trim(),
					durationMs: Date.now() - start,
				});
			});
			child.on('error', err => {
				resolve({
					ok: false,
					exitCode: null,
					stdout: '',
					stderr: err.message,
					durationMs: Date.now() - start,
				});
			});
		} catch (err) {
			resolve({
				ok: false,
				exitCode: null,
				stdout: '',
				stderr: err instanceof Error ? err.message : String(err),
				durationMs: Date.now() - start,
			});
		}
	});
}

function runShellCommandCapture(command: string, cwd: string, timeoutMs = 60000): Promise<ExecProbeResult> {
	const start = Date.now();
	return new Promise(resolve => {
		const isWin = process.platform === 'win32';
		const shellBin = isWin ? 'cmd.exe' : '/bin/sh';
		const shellArgs = isWin ? ['/d', '/s', '/c', command] : ['-c', command];
		let stdout = '';
		let stderr = '';
		let settled = false;
		const finish = (ok: boolean, exitCode: number | null) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve({ ok, exitCode, stdout: stdout.trim(), stderr: stderr.trim(), durationMs: Date.now() - start });
		};
		const child = spawn(shellBin, shellArgs, { cwd, windowsHide: true });
		const timer = setTimeout(() => {
			try { child.kill(); } catch { /* ignore */ }
			stderr += `\nTimed out after ${timeoutMs}ms.`;
			finish(false, null);
		}, timeoutMs);
		child.stdout?.on('data', d => { if (stdout.length < 200_000) stdout += String(d); });
		child.stderr?.on('data', d => { if (stderr.length < 200_000) stderr += String(d); });
		child.on('error', err => { stderr += err.message; finish(false, null); });
		child.on('close', code => finish(code === 0, code));
	});
}

function collectWorkspaceFiles(root: string, maxFiles = 350): MobileWorkspaceFile[] {
	const results: MobileWorkspaceFile[] = [];
	if (!root || !fs.existsSync(root)) return results;

	const walk = (dir: string, depth: number) => {
		if (depth > 8 || results.length >= maxFiles) return;
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (results.length >= maxFiles) break;
			if (entry.isDirectory()) {
				if (SKIP_DIRS.has(entry.name)) continue;
				walk(path.join(dir, entry.name), depth + 1);
			} else if (entry.isFile()) {
				const ext = path.extname(entry.name).toLowerCase();
				if (!TEXT_EXTS.has(ext) && entry.name !== 'Podfile' && entry.name !== 'Fastfile' && entry.name !== 'Dockerfile') {
					continue;
				}
				const fullPath = path.join(dir, entry.name);
				try {
					const stat = fs.statSync(fullPath);
					if (stat.size > 256 * 1024) continue;
					const content = fs.readFileSync(fullPath, 'utf8');
					results.push({
						path: path.relative(root, fullPath).replace(/\\/g, '/'),
						content,
					});
				} catch {
					// skip unreadable
				}
			}
		}
	};

	walk(root, 0);
	return results;
}

export class KodiaMobileMainService extends Disposable implements IKodiaMobileMainService {
	readonly _serviceBrand: undefined;

	private readonly _onDidEmitEvent = this._register(new Emitter<MobileLiveEvent>());
	readonly onDidEmitEvent: Event<MobileLiveEvent> = this._onDidEmitEvent.event;

	private _seq = 0;
	private _events: MobileLiveEvent[] = [];

	private _emit(kind: MobileLiveEvent['kind'], title: string, detail: string): void {
		const ev: MobileLiveEvent = {
			eventId: crypto.randomUUID(),
			seq: ++this._seq,
			timestamp: new Date().toISOString(),
			kind,
			title,
			detail,
		};
		this._events.push(ev);
		if (this._events.length > 300) {
			this._events = this._events.slice(-300);
		}
		this._onDidEmitEvent.fire(ev);
	}

	private _storageDir(workspaceRoot: string): string {
		return path.join(workspaceRoot, '.kodia', 'mobile');
	}

	private _saveArtifact(workspaceRoot: string, fileName: string, data: unknown): void {
		if (!workspaceRoot || !fs.existsSync(workspaceRoot)) return;
		try {
			const dir = this._storageDir(workspaceRoot);
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(path.join(dir, fileName), JSON.stringify(data, null, 2), 'utf8');
		} catch {
			// best effort
		}
	}

	private _readArtifact<T>(workspaceRoot: string, fileName: string): T | undefined {
		if (!workspaceRoot) return undefined;
		const p = path.join(this._storageDir(workspaceRoot), fileName);
		if (!fs.existsSync(p)) return undefined;
		try {
			return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
		} catch {
			return undefined;
		}
	}

	private _findAndroidSdkDir(): string | undefined {
		const candidates = [
			process.env.ANDROID_HOME,
			process.env.ANDROID_SDK_ROOT,
			process.platform === 'win32' && process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : undefined,
			path.join(os.homedir(), 'Android', 'Sdk'),
			path.join(os.homedir(), 'Library', 'Android', 'sdk'),
		].filter((x): x is string => Boolean(x));
		return candidates.find(dir => fs.existsSync(dir));
	}

	private _resolveAdbBinary(): string {
		const sdk = this._findAndroidSdkDir();
		if (sdk) {
			const candidate = path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
			if (fs.existsSync(candidate)) return candidate;
		}
		return 'adb';
	}

	private _resolveEmulatorBinary(): string {
		const sdk = this._findAndroidSdkDir();
		if (sdk) {
			const candidate = path.join(sdk, 'emulator', process.platform === 'win32' ? 'emulator.exe' : 'emulator');
			if (fs.existsSync(candidate)) return candidate;
		}
		return 'emulator';
	}

	async probeEnvironment(workspaceRoot: string): Promise<MobileEnvironmentProbeReport> {
		const hostPlatform = process.platform;
		const hostArch = process.arch;
		const adbBin = this._resolveAdbBinary();
		const emulatorBin = this._resolveEmulatorBinary();

		const probes: Array<{ id: string; name: string; category: MobileToolchainItem['category']; bin: string; args: string[]; note?: string }> = [
			{ id: 'node', name: 'Node.js', category: 'cross-platform', bin: 'node', args: ['-v'] },
			{ id: 'npm', name: 'npm', category: 'cross-platform', bin: 'npm', args: ['-v'] },
			{ id: 'python', name: 'Python', category: 'general', bin: 'python', args: ['--version'] },
			{ id: 'java', name: 'Java JDK', category: 'android', bin: 'java', args: ['-version'] },
			{ id: 'adb', name: 'Android ADB', category: 'android', bin: adbBin, args: ['version'] },
			{ id: 'emulator', name: 'Android Emulator', category: 'android', bin: emulatorBin, args: ['-version'] },
			{ id: 'gradle', name: 'Gradle', category: 'android', bin: 'gradle', args: ['-v'] },
			{ id: 'flutter', name: 'Flutter SDK', category: 'cross-platform', bin: 'flutter', args: ['--version'] },
			{ id: 'dart', name: 'Dart SDK', category: 'cross-platform', bin: 'dart', args: ['--version'] },
			{ id: 'dotnet', name: '.NET SDK', category: 'cross-platform', bin: 'dotnet', args: ['--version'] },
			{ id: 'git', name: 'Git', category: 'general', bin: 'git', args: ['--version'] },
			{ id: 'docker', name: 'Docker', category: 'general', bin: 'docker', args: ['--version'] },
		];
		if (hostPlatform === 'darwin') {
			probes.push({ id: 'xcodebuild', name: 'Xcode / xcodebuild', category: 'ios', bin: 'xcodebuild', args: ['-version'] });
		}

		const probeResults = await Promise.all(probes.map(async p => {
			const res = await runProcessCapture(p.bin, p.args, { timeoutMs: 6000 });
			const combined = `${res.stdout}\n${res.stderr}`.trim();
			const firstLine = combined.split(/\r?\n/).find(l => l.trim().length > 0)?.trim();
			const item: MobileToolchainItem = {
				id: p.id,
				name: p.name,
				category: p.category,
				installed: res.ok,
				...(res.ok && firstLine ? { version: firstLine.slice(0, 80) } : {}),
				...(p.note ? { note: p.note } : {}),
			};
			return item;
		}));

		if (hostPlatform !== 'darwin') {
			probeResults.push({
				id: 'xcodebuild',
				name: 'Xcode / iOS Simulator',
				category: 'ios',
				installed: false,
				note: `Unavailable on ${hostPlatform}: native iOS builds and iOS Simulator require macOS + Xcode (use macOS CI or EAS Build).`,
			});
		}

		const byId = new Map(probeResults.map(t => [t.id, t]));
		const androidSdkDir = this._findAndroidSdkDir();
		const devices: MobileDiscoveredDevice[] = [];
		const androidAvds: string[] = [];

		if (byId.get('adb')?.installed) {
			const devRes = await runProcessCapture(adbBin, ['devices', '-l'], { timeoutMs: 5000 });
			if (devRes.ok) {
				for (const line of devRes.stdout.split(/\r?\n/).slice(1)) {
					const trimmed = line.trim();
					if (!trimmed) continue;
					const parts = trimmed.split(/\s+/);
					const id = parts[0];
					const rawState = parts[1] ?? 'offline';
					const modelMatch = trimmed.match(/model:([^\s]+)/);
					devices.push({
						id,
						name: modelMatch ? modelMatch[1].replace(/_/g, ' ') : id,
						platform: 'android',
						kind: id.startsWith('emulator-') ? 'emulator' : 'physical',
						state: rawState === 'device' ? 'online' : rawState === 'unauthorized' ? 'unauthorized' : 'offline',
					});
				}
			}
		}

		if (byId.get('emulator')?.installed) {
			const avdRes = await runProcessCapture(emulatorBin, ['-list-avds'], { timeoutMs: 5000 });
			if (avdRes.ok && avdRes.stdout) {
				for (const line of avdRes.stdout.split(/\r?\n/)) {
					if (line.trim()) androidAvds.push(line.trim());
				}
			}
		}

		if (hostPlatform === 'darwin' && byId.get('xcodebuild')?.installed) {
			const simRes = await runProcessCapture('xcrun', ['simctl', 'list', 'devices', 'booted', '--json'], { timeoutMs: 6000 });
			if (simRes.ok && simRes.stdout) {
				try {
					const parsed = JSON.parse(simRes.stdout) as { devices?: Record<string, Array<{ udid: string; name: string; state: string }>> };
					for (const [runtime, list] of Object.entries(parsed.devices ?? {})) {
						for (const d of list) {
							devices.push({
								id: d.udid,
								name: d.name,
								platform: 'ios',
								kind: 'simulator',
								state: d.state.toLowerCase() === 'booted' ? 'booted' : 'shutdown',
								osVersion: runtime.split('.').pop(),
							});
						}
					}
				} catch { /* ignore */ }
			}
		}

		const capabilities = {
			canBuildReactNativeJS: Boolean(byId.get('node')?.installed && byId.get('npm')?.installed),
			canBuildAndroidNative: Boolean(byId.get('java')?.installed && (androidSdkDir || byId.get('adb')?.installed)),
			canBuildFlutter: Boolean(byId.get('flutter')?.installed && byId.get('dart')?.installed),
			canBuildIosNative: hostPlatform === 'darwin' && Boolean(byId.get('xcodebuild')?.installed),
			canRunAndroidEmulator: Boolean(byId.get('emulator')?.installed && androidAvds.length > 0),
			canRunIosSimulator: hostPlatform === 'darwin' && Boolean(byId.get('xcodebuild')?.installed),
			canRunPythonBackend: Boolean(byId.get('python')?.installed),
			canRunNodeBackend: Boolean(byId.get('node')?.installed),
		};

		const missingPrerequisites: string[] = [];
		if (!capabilities.canBuildAndroidNative) missingPrerequisites.push('Android SDK / ADB / Gradle (install Android Studio or Android Command-line Tools to build APK/AAB or run Android Emulators).');
		if (!capabilities.canBuildFlutter) missingPrerequisites.push('Flutter & Dart SDK (install Flutter SDK to compile/test Flutter apps).');
		const platformLimitations: string[] = [];
		if (hostPlatform !== 'darwin') {
			platformLimitations.push(`Native iOS compilation (xcodebuild) and iOS Simulator are unavailable on ${hostPlatform}; use macOS with Xcode or cloud build CI (e.g. EAS Build) for IPA archives.`);
		}

		const report: MobileEnvironmentProbeReport = {
			probedAt: new Date().toISOString(),
			hostPlatform,
			hostArch,
			toolchains: probeResults,
			androidAvds,
			devices,
			capabilities,
			missingPrerequisites,
			platformLimitations,
		};
		this._saveArtifact(workspaceRoot, 'environment.json', report);
		this._emit('probe', 'Probed mobile environment', `${probeResults.filter(t => t.installed).length}/${probeResults.length} toolchains installed, ${devices.length} device(s) detected.`);
		return report;
	}

	async inspectWorkspace(workspaceRoot: string): Promise<MobileProjectIntelligenceReport> {
		const files = collectWorkspaceFiles(workspaceRoot);
		const report = analyzeMobileProjectFiles(workspaceRoot, files);
		this._saveArtifact(workspaceRoot, 'project-intel.json', report);
		this._emit('inspect', 'Inspected mobile project', `${report.frameworkLabel} (${report.totalFilesScanned} files scanned, ${report.testFiles.length} test files).`);
		return report;
	}

	async designArchitecture(workspaceRoot: string, req: MobileArchitectureRequest): Promise<MobileArchitectureDesignReport> {
		const report = designMobileArchitecture(req);
		this._saveArtifact(workspaceRoot, 'architecture.json', report);
		this._emit('architecture', 'Designed mobile architecture', `${report.framework} (${report.targetPlatform}) + ${report.backendStack} [${report.engineMode}].`);
		return report;
	}

	async scaffoldProject(workspaceRoot: string, req: MobileScaffoldRequest): Promise<MobileScaffoldResult> {
		const baseDir = req.targetDir
			? (path.isAbsolute(req.targetDir) ? req.targetDir : path.join(workspaceRoot, req.targetDir))
			: workspaceRoot;
		fs.mkdirSync(baseDir, { recursive: true });

		const generated = generateMobileProjectFiles(req);
		const createdFiles: string[] = [];
		const skippedFiles: string[] = [];

		for (const file of generated) {
			const fullPath = path.join(baseDir, file.relativePath);
			if (fs.existsSync(fullPath) && !req.overwrite) {
				skippedFiles.push(file.relativePath);
				continue;
			}
			fs.mkdirSync(path.dirname(fullPath), { recursive: true });
			fs.writeFileSync(fullPath, file.content, 'utf8');
			createdFiles.push(file.relativePath);
		}

		const backendStack = req.backend ?? (req.includeAI || req.appCategory === 'ai-powered' ? 'python-fastapi' : 'node-express');
		const nextSteps = [
			`Inspect generated files in ${baseDir}`,
			`Run mobile_build_and_test to execute automated mobile & backend tests`,
			`Run mobile_audit_security and mobile_assess_readiness to verify production gates`,
		];

		const result: MobileScaffoldResult = {
			createdAt: new Date().toISOString(),
			projectDir: baseDir,
			framework: req.framework,
			backendStack,
			createdFiles,
			skippedFiles,
			nextSteps,
		};
		this._saveArtifact(workspaceRoot, 'last-scaffold.json', result);
		this._emit('scaffold', `Scaffolded ${req.framework} project`, `Created ${createdFiles.length} file(s) in ${baseDir}.`);
		return result;
	}

	async runDeviceAction(workspaceRoot: string, req: MobileDeviceActionRequest): Promise<MobileDeviceActionResult> {
		const start = Date.now();
		const adbBin = this._resolveAdbBinary();
		const emulatorBin = this._resolveEmulatorBinary();

		if (req.action === 'list_devices' || req.action === 'diagnostics') {
			const env = await this.probeEnvironment(workspaceRoot);
			const result: MobileDeviceActionResult = {
				action: req.action,
				status: env.devices.length > 0 ? 'verified' : 'blocked_by_env',
				exitCode: 0,
				durationMs: Date.now() - start,
				output: env.devices.length > 0
					? env.devices.map(d => `${d.id} | ${d.name} | ${d.platform} (${d.kind}) | ${d.state}`).join('\n')
					: 'No running emulators, simulators, or connected physical devices found.',
				devices: env.devices,
			};
			this._emit('device', `Device action: ${req.action}`, result.output.slice(0, 160));
			return result;
		}

		const adbCheck = await runProcessCapture(adbBin, ['version'], { timeoutMs: 4000 });
		if (!adbCheck.ok) {
			const msg = 'ADB is not installed on this host. Install Android SDK Platform-Tools to run device actions.';
			this._emit('error', `Device action blocked: ${req.action}`, msg);
			return {
				action: req.action,
				status: 'blocked_by_env',
				exitCode: null,
				durationMs: Date.now() - start,
				output: '',
				error: msg,
			};
		}

		const deviceArgs = req.deviceId ? ['-s', req.deviceId] : [];
		let res: ExecProbeResult;
		if (req.action === 'start_emulator') {
			if (!req.avdName) {
				return { action: req.action, status: 'failed', exitCode: 1, durationMs: Date.now() - start, output: '', error: 'avdName is required to start an Android emulator.' };
			}
			const child = spawn(emulatorBin, ['-avd', req.avdName], { detached: true, stdio: 'ignore', windowsHide: true });
			child.unref();
			return { action: req.action, status: 'partial', exitCode: 0, durationMs: Date.now() - start, output: `Launched Android Emulator AVD "${req.avdName}" in background.` };
		} else if (req.action === 'install_app') {
			if (!req.artifactPath) return { action: req.action, status: 'failed', exitCode: 1, durationMs: Date.now() - start, output: '', error: 'artifactPath (.apk) is required.' };
			res = await runProcessCapture(adbBin, [...deviceArgs, 'install', '-r', req.artifactPath], { timeoutMs: 60000 });
		} else if (req.action === 'launch_app') {
			if (!req.packageName) return { action: req.action, status: 'failed', exitCode: 1, durationMs: Date.now() - start, output: '', error: 'packageName is required.' };
			res = await runProcessCapture(adbBin, [...deviceArgs, 'shell', 'monkey', '-p', req.packageName, '-c', 'android.intent.category.LAUNCHER', '1'], { timeoutMs: 15000 });
		} else if (req.action === 'stop_app') {
			if (!req.packageName) return { action: req.action, status: 'failed', exitCode: 1, durationMs: Date.now() - start, output: '', error: 'packageName is required.' };
			res = await runProcessCapture(adbBin, [...deviceArgs, 'shell', 'am', 'force-stop', req.packageName], { timeoutMs: 10000 });
		} else if (req.action === 'logcat') {
			res = await runProcessCapture(adbBin, [...deviceArgs, 'logcat', '-d', '-t', String(req.lines ?? 100)], { timeoutMs: 10000 });
		} else {
			const outPng = path.join(this._storageDir(workspaceRoot || os.tmpdir()), `device-screen-${Date.now()}.png`);
			fs.mkdirSync(path.dirname(outPng), { recursive: true });
			res = await runShellCommandCapture(`"${adbBin}" ${deviceArgs.join(' ')} exec-out screencap -p > "${outPng}"`, workspaceRoot || os.tmpdir(), 15000);
			return {
				action: req.action,
				status: res.ok ? 'verified' : 'failed',
				exitCode: res.exitCode,
				durationMs: res.durationMs,
				output: res.ok ? `Saved device screenshot to ${outPng}` : res.stderr,
				...(res.ok ? { screenshotPath: outPng } : { error: res.stderr }),
			};
		}

		const actionResult: MobileDeviceActionResult = {
			action: req.action,
			status: res.ok ? 'verified' : 'failed',
			exitCode: res.exitCode,
			durationMs: res.durationMs,
			output: res.stdout || res.stderr,
			...(res.ok ? {} : { error: res.stderr || 'Device command failed.' }),
		};
		this._emit('device', `Device action: ${req.action}`, `${actionResult.status} (${actionResult.durationMs}ms)`);
		return actionResult;
	}

	async runBuildOrTest(workspaceRoot: string, req: MobileBuildTestRequest): Promise<MobileBuildTestResult> {
		const cwd = req.targetDir
			? (path.isAbsolute(req.targetDir) ? req.targetDir : path.join(workspaceRoot, req.targetDir))
			: workspaceRoot;

		if (!fs.existsSync(cwd)) {
			return {
				executedAt: new Date().toISOString(),
				mode: req.mode,
				status: 'failed',
				command: req.customCommand ?? '',
				cwd,
				exitCode: null,
				durationMs: 0,
				stdout: '',
				stderr: `Target directory does not exist: ${cwd}`,
				summary: `Directory not found: ${cwd}`,
			};
		}

		let command = req.customCommand?.trim() ?? '';
		let blockingReason: string | undefined;

		if (!command) {
			if (req.mode === 'backend_test') {
				const backendDir = fs.existsSync(path.join(cwd, 'backend')) ? path.join(cwd, 'backend') : cwd;
				if (fs.existsSync(path.join(backendDir, 'test_server.py'))) {
					command = 'python -m unittest discover -v';
				} else if (fs.existsSync(path.join(backendDir, 'package.json'))) {
					command = 'npm test';
				} else {
					blockingReason = 'No recognized backend test suite found in target directory.';
				}
			} else if (req.platform === 'ios' && process.platform !== 'darwin') {
				blockingReason = `Native iOS ${req.mode} requires macOS with Xcode (host OS is ${process.platform}).`;
			} else if (req.framework === 'flutter' || fs.existsSync(path.join(cwd, 'pubspec.yaml'))) {
				const flutterOk = (await runProcessCapture('flutter', ['--version'], { timeoutMs: 4000 })).ok;
				if (!flutterOk) {
					blockingReason = 'Flutter SDK is not installed on this host.';
				} else {
					command = req.mode === 'build' ? 'flutter build apk --debug' : 'flutter test';
				}
			} else if (req.framework === 'android-kotlin' || fs.existsSync(path.join(cwd, 'settings.gradle.kts')) || fs.existsSync(path.join(cwd, 'build.gradle.kts'))) {
				const hasWrapper = fs.existsSync(path.join(cwd, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'));
				const gradleOk = hasWrapper || (await runProcessCapture('gradle', ['-v'], { timeoutMs: 4000 })).ok;
				if (!gradleOk) {
					blockingReason = 'Gradle / Android SDK toolchain is not installed on this host.';
				} else {
					const gradlew = hasWrapper ? (process.platform === 'win32' ? 'gradlew.bat' : './gradlew') : 'gradle';
					command = req.mode === 'build' ? `${gradlew} assembleDebug` : `${gradlew} testDebugUnitTest`;
				}
			} else if (req.framework === 'ios-swift' || fs.existsSync(path.join(cwd, 'Package.swift'))) {
				const swiftOk = (await runProcessCapture('swift', ['--version'], { timeoutMs: 4000 })).ok;
				if (!swiftOk) {
					blockingReason = `Swift / Xcode toolchain is not installed on this ${process.platform} host.`;
				} else {
					command = req.mode === 'build' ? 'swift build' : 'swift test';
				}
			} else {
				const mobileSubdir = fs.existsSync(path.join(cwd, 'mobile', 'package.json')) ? path.join(cwd, 'mobile') : cwd;
				if (fs.existsSync(path.join(mobileSubdir, 'package.json'))) {
					command = req.mode === 'typecheck' ? 'npm run typecheck' : req.mode === 'lint' ? 'npm run lint' : 'npm test';
				} else {
					blockingReason = `Could not infer mobile ${req.mode} command for ${cwd}. Provide customCommand explicitly.`;
				}
			}
		}

		if (blockingReason) {
			const blocked: MobileBuildTestResult = {
				executedAt: new Date().toISOString(),
				mode: req.mode,
				status: 'blocked_by_env',
				command: command || '(blocked)',
				cwd,
				exitCode: null,
				durationMs: 0,
				stdout: '',
				stderr: blockingReason,
				summary: blockingReason,
				blockingReason,
			};
			this._saveArtifact(workspaceRoot, 'last-build-test.json', blocked);
			this._emit('build', `Mobile ${req.mode} blocked`, blockingReason);
			return blocked;
		}

		let execCwd = cwd;
		if (!req.customCommand) {
			if (req.mode === 'backend_test' && fs.existsSync(path.join(cwd, 'backend'))) {
				execCwd = path.join(cwd, 'backend');
			} else if (req.mode !== 'backend_test' && fs.existsSync(path.join(cwd, 'mobile', 'package.json')) && !fs.existsSync(path.join(cwd, 'package.json'))) {
				execCwd = path.join(cwd, 'mobile');
			}
		}

		const execRes = await runShellCommandCapture(command, execCwd, req.timeoutMs ?? 90000);
		const result: MobileBuildTestResult = {
			executedAt: new Date().toISOString(),
			mode: req.mode,
			status: execRes.ok ? 'verified' : 'failed',
			command,
			cwd: execCwd,
			exitCode: execRes.exitCode,
			durationMs: execRes.durationMs,
			stdout: execRes.stdout.slice(-16000),
			stderr: execRes.stderr.slice(-8000),
			summary: execRes.ok
				? `${req.mode} passed in ${execRes.durationMs}ms (exit 0).`
				: `${req.mode} failed with exit code ${String(execRes.exitCode)} in ${execRes.durationMs}ms.`,
		};
		this._saveArtifact(workspaceRoot, 'last-build-test.json', result);
		this._emit(req.mode.includes('test') ? 'test' : 'build', `Mobile ${req.mode}: ${result.status}`, `${command} (${result.durationMs}ms)`);
		return result;
	}

	async runSecurityAudit(workspaceRoot: string): Promise<MobileSecurityAuditReport> {
		const files = collectWorkspaceFiles(workspaceRoot);
		const report = auditMobileSecurity(files);
		this._saveArtifact(workspaceRoot, 'security-audit.json', report);
		this._emit('security', 'Completed OWASP MASVS audit', `Score ${report.score}/100 (${report.findings.length} finding(s)).`);
		return report;
	}

	async runPerformanceAudit(workspaceRoot: string): Promise<MobilePerformanceAuditReport> {
		const files = collectWorkspaceFiles(workspaceRoot);
		const report = auditMobilePerformance(files);
		this._saveArtifact(workspaceRoot, 'performance-audit.json', report);
		this._emit('performance', 'Completed mobile performance audit', `Score ${report.score}/100 (${report.findings.length} finding(s)).`);
		return report;
	}

	async assessProductionReadiness(workspaceRoot: string): Promise<MobileProductionReadinessReport> {
		const [env, intel, security, performance] = await Promise.all([
			this.probeEnvironment(workspaceRoot),
			this.inspectWorkspace(workspaceRoot),
			this.runSecurityAudit(workspaceRoot),
			this.runPerformanceAudit(workspaceRoot),
		]);
		const lastBuildTest = this._readArtifact<MobileBuildTestResult>(workspaceRoot, 'last-build-test.json');
		const report = assessMobileProductionReadiness({ env, intel, security, performance, lastBuildTest });
		this._saveArtifact(workspaceRoot, 'readiness-report.json', report);
		this._emit('readiness', 'Assessed mobile store readiness', `${report.overallStatus} (${report.readinessScore}/100).`);
		return report;
	}

	async loadWorkspaceSnapshot(workspaceRoot: string): Promise<MobileWorkspaceSnapshot> {
		return {
			workspaceRoot,
			environment: this._readArtifact<MobileEnvironmentProbeReport>(workspaceRoot, 'environment.json'),
			projectIntel: this._readArtifact<MobileProjectIntelligenceReport>(workspaceRoot, 'project-intel.json'),
			architecture: this._readArtifact<MobileArchitectureDesignReport>(workspaceRoot, 'architecture.json'),
			lastScaffold: this._readArtifact<MobileScaffoldResult>(workspaceRoot, 'last-scaffold.json'),
			lastBuildTest: this._readArtifact<MobileBuildTestResult>(workspaceRoot, 'last-build-test.json'),
			securityAudit: this._readArtifact<MobileSecurityAuditReport>(workspaceRoot, 'security-audit.json'),
			performanceAudit: this._readArtifact<MobilePerformanceAuditReport>(workspaceRoot, 'performance-audit.json'),
			readinessReport: this._readArtifact<MobileProductionReadinessReport>(workspaceRoot, 'readiness-report.json'),
		};
	}

	async getRecentEvents(limit = 100): Promise<MobileLiveEvent[]> {
		return this._events.slice(-limit);
	}
}
