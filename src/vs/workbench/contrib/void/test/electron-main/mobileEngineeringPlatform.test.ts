/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
	auditMobilePerformance,
	auditMobileSecurity,
	designMobileArchitecture,
	discoverMobileCapabilities,
} from '../../common/mobileEngineeringKnowledge.js';
import { KodiaMobileMainService } from '../../electron-main/mobileEngineeringMainService.js';
import { buildSoftwareFactoryPrompt, FACTORY_PROJECT_PROFILES } from '../../common/softwareFactory.js';

suite('Kodia Permanent Mobile Application Engineering Platform (Demos A-G)', function () {
	this.timeout(90000);

	let tmpRoot: string;
	let service: KodiaMobileMainService;

	setup(() => {
		tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kodia-mobile-test-'));
		service = new KodiaMobileMainService();
	});

	teardown(() => {
		service.dispose();
		try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
	});

	test('Software Factory includes Mobile Application profile alongside all existing profiles and Three-Engine orchestrator works', () => {
		assert.ok(FACTORY_PROJECT_PROFILES.some(p => p.id === 'mobile-app' && p.label === 'Mobile Application'));
		assert.ok(FACTORY_PROJECT_PROFILES.some(p => p.id === 'web-app'));
		assert.ok(FACTORY_PROJECT_PROFILES.some(p => p.id === 'saas-platform'));

		const prompt = buildSoftwareFactoryPrompt('AI fitness coach with offline workouts', 'mobile-app', [], {
			platform: 'both',
			framework: 'flutter',
			appCategory: 'ai-powered',
			backend: 'python-fastapi',
			database: 'postgresql',
			includeAuth: true,
			includeAI: true,
			includeOffline: true,
			includeRealtime: false,
		});
		assert.match(prompt, /Three-Engine Unified Orchestration/);
		assert.match(prompt, /mobile_probe_environment/);
		assert.match(prompt, /flutter/);

		const arch = designMobileArchitecture({
			objective: 'AI medical assistant mobile app with offline patient notes and RAG search',
		});
		assert.strictEqual(arch.engineMode, 'unified-three-engine');
		assert.strictEqual(arch.backendStack, 'python-fastapi', 'AI mobile app should select Python/FastAPI instead of forcing Node.js');
		assert.strictEqual(arch.aiStrategy.enabled, true);
		assert.strictEqual(arch.offlineStrategy.enabled, true);
		assert.ok(arch.mermaidDiagram.includes('flowchart LR'));

		const caps = discoverMobileCapabilities('core ml');
		assert.ok(caps.length >= 1);
	});

	test('Real host environment probe honestly detects installed SDKs and platform limitations', async () => {
		const env = await service.probeEnvironment(tmpRoot);
		assert.strictEqual(env.hostPlatform, process.platform);
		assert.ok(env.toolchains.some(t => t.id === 'node' && t.installed));
		if (process.platform !== 'darwin') {
			assert.strictEqual(env.capabilities.canBuildIosNative, false);
			assert.ok(env.platformLimitations.some(l => /macOS|Xcode/i.test(l)));
		}
	});

	test('Demo A (React Native) + Demo E (Full-Stack Python Backend) + Demo F (AI Proxy) + Demo G (Offline-First Sync)', async () => {
		const appDir = path.join(tmpRoot, 'demo-fullstack-ai-offline');
		const scaffold = await service.scaffoldProject(tmpRoot, {
			projectName: 'PulseField Mobile',
			targetDir: appDir,
			objective: 'Full-stack AI-powered offline-first field operations mobile app',
			framework: 'react-native-expo',
			platform: 'both',
			appCategory: 'ai-powered',
			backend: 'python-fastapi',
			database: 'sqlite',
			includeAI: true,
			includeOffline: true,
			includeAuth: true,
		});
		assert.ok(scaffold.createdFiles.includes('mobile/package.json'));
		assert.ok(scaffold.createdFiles.includes('mobile/src/services/offlineSyncQueue.mjs'));
		assert.ok(scaffold.createdFiles.includes('backend/server.py'));
		assert.ok(scaffold.createdFiles.includes('backend/test_server.py'));

		const intel = await service.inspectWorkspace(appDir);
		assert.strictEqual(intel.detected, true);
		assert.strictEqual(intel.framework, 'react-native-expo');
		assert.strictEqual(intel.backendDetected?.stack, 'Python API Backend');

		// Execute REAL mobile client + offline sync tests (Demo A + Demo G)
		const mobileTest = await service.runBuildOrTest(appDir, { mode: 'test', targetDir: appDir, framework: 'react-native-expo' });
		assert.strictEqual(mobileTest.status, 'verified', `Mobile test failed: ${mobileTest.stderr}`);
		assert.strictEqual(mobileTest.exitCode, 0);

		// Execute REAL Python backend CRUD + SQLite + AI proxy credential enforcement tests (Demo E + Demo F)
		const backendTest = await service.runBuildOrTest(appDir, { mode: 'backend_test', targetDir: appDir });
		assert.strictEqual(backendTest.status, 'verified', `Backend test failed: ${backendTest.stderr}`);
		assert.strictEqual(backendTest.exitCode, 0);

		// Security & Readiness verification
		const sec = await service.runSecurityAudit(appDir);
		assert.strictEqual(sec.criticalCount, 0);
		assert.strictEqual(sec.score, 100);

		const readiness = await service.assessProductionReadiness(appDir);
		assert.ok(readiness.dimensions.length >= 5);
		assert.ok(readiness.androidStoreChecklist.length >= 3);
		assert.ok(readiness.iosStoreChecklist.length >= 2);
	});

	test('Demo B (Flutter), Demo C (Native Android Kotlin), Demo D (Native iOS Swift) scaffold, inspect & report real env status honestly', async () => {
		// Demo B: Flutter
		const flutterDir = path.join(tmpRoot, 'demo-flutter');
		await service.scaffoldProject(tmpRoot, {
			projectName: 'SkyLedger',
			targetDir: flutterDir,
			framework: 'flutter',
			backend: 'none',
		});
		const flutterIntel = await service.inspectWorkspace(flutterDir);
		assert.strictEqual(flutterIntel.framework, 'flutter');
		assert.ok(flutterIntel.testFiles.some(f => f.endsWith('widget_test.dart')));
		const flutterRun = await service.runBuildOrTest(flutterDir, { mode: 'test', targetDir: flutterDir, framework: 'flutter' });
		assert.ok(flutterRun.status === 'verified' || flutterRun.status === 'blocked_by_env');

		// Demo C: Native Android Kotlin
		const androidDir = path.join(tmpRoot, 'demo-android');
		await service.scaffoldProject(tmpRoot, {
			projectName: 'FieldPulseAndroid',
			targetDir: androidDir,
			framework: 'android-kotlin',
			platform: 'android',
			backend: 'none',
		});
		const androidIntel = await service.inspectWorkspace(androidDir);
		assert.strictEqual(androidIntel.framework, 'android-kotlin');
		assert.ok(androidIntel.permissionsDeclared.includes('android.permission.INTERNET'));
		const androidRun = await service.runBuildOrTest(androidDir, { mode: 'test', targetDir: androidDir, framework: 'android-kotlin' });
		assert.ok(androidRun.status === 'verified' || androidRun.status === 'blocked_by_env');

		// Demo D: Native iOS Swift
		const iosDir = path.join(tmpRoot, 'demo-ios');
		await service.scaffoldProject(tmpRoot, {
			projectName: 'PulseSwift',
			targetDir: iosDir,
			framework: 'ios-swift',
			platform: 'ios',
			backend: 'none',
		});
		const iosIntel = await service.inspectWorkspace(iosDir);
		assert.strictEqual(iosIntel.framework, 'ios-swift');
		assert.ok(iosIntel.testFiles.some(f => f.endsWith('AppStoreTests.swift')));
		const iosRun = await service.runBuildOrTest(iosDir, { mode: 'test', targetDir: iosDir, framework: 'ios-swift', platform: 'ios' });
		if (process.platform !== 'darwin') {
			assert.strictEqual(iosRun.status, 'blocked_by_env', 'iOS builds on non-macOS must honestly report blocked_by_env');
			assert.match(iosRun.summary, /macOS|Xcode/i);
		}
	});

	test('OWASP MASVS security audit and mobile performance audit detect real vulnerabilities and bottlenecks', () => {
		const sec = auditMobileSecurity([
			{ path: 'mobile/src/config.ts', content: 'export const API_KEY = "sk-1234567890abcdefghijklmnop";' },
			{ path: 'android/app/src/main/AndroidManifest.xml', content: '<application android:usesCleartextTraffic="true" android:debuggable="true">' },
		]);
		assert.strictEqual(sec.criticalCount, 1);
		assert.strictEqual(sec.highCount, 2);
		assert.ok(sec.score < 50);

		const perf = auditMobilePerformance([
			{ path: 'mobile/src/FeedScreen.tsx', content: 'export function Feed({ items }) { console.log(items); return <ScrollView>{items.map(i => <Text>{i}</Text>)}</ScrollView>; }' },
		]);
		assert.ok(perf.findings.some(f => f.id === 'PERF-UNVIRTUALIZED-LIST'));
		assert.ok(perf.findings.some(f => f.id === 'PERF-CONSOLE-LOG'));
	});
});
