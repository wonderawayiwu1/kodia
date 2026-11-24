/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import {
	MobileAppCategory,
	MobileArchitectureDesignReport,
	MobileArchitecturePattern,
	MobileArchitectureRequest,
	MobileBackendStack,
	MobileBuildTestResult,
	MobileCapabilityEntry,
	MobileDatabaseId,
	MobileEnvironmentProbeReport,
	MobileFrameworkId,
	MobilePerformanceAuditReport,
	MobilePerformanceFinding,
	MobileProductionReadinessReport,
	MobileProjectIntelligenceReport,
	MobileReadinessDimension,
	MobileScaffoldRequest,
	MobileSecurityAuditReport,
	MobileSecurityFinding,
	MobileTargetPlatform,
	VerificationStatus,
} from './mobileEngineeringTypes.js';

export interface MobileWorkspaceFile {
	readonly path: string;
	readonly content: string;
}

export interface GeneratedMobileFile {
	readonly relativePath: string;
	readonly content: string;
}

// ============================================================================
// 1. EXTENSIBLE MOBILE CAPABILITY DISCOVERY CATALOGUE
// ============================================================================

export const MOBILE_CAPABILITY_CATALOGUE: readonly MobileCapabilityEntry[] = [
	{
		id: 'react-native-new-arch',
		name: 'React Native New Architecture (Fabric, TurboModules, JSI, Hermes)',
		category: 'framework',
		maturity: 'production-proven',
		license: 'MIT',
		platforms: ['Android', 'iOS'],
		summary: 'Synchronous C++ JSI bridge, concurrent Fabric renderer, lazy TurboModules, and Hermes AOT bytecode engine.',
		recommendedWhen: 'Cross-platform TypeScript/React teams shipping complex Android & iOS apps with shared business logic and native integrations.',
	},
	{
		id: 'expo-router-eas',
		name: 'Expo SDK + Expo Router + EAS Build/Updates',
		category: 'framework',
		maturity: 'production-proven',
		license: 'MIT',
		platforms: ['Android', 'iOS', 'Web'],
		summary: 'File-based universal navigation, config plugins for custom native modules, cloud/local EAS builds, and OTA updates.',
		recommendedWhen: 'Fastest production React Native workflow with deep linking, native permissions, and automated store builds.',
	},
	{
		id: 'flutter-impeller',
		name: 'Flutter SDK + Impeller Rendering Engine + Riverpod/Bloc',
		category: 'framework',
		maturity: 'production-proven',
		license: 'BSD-3-Clause',
		platforms: ['Android', 'iOS', 'Web', 'Desktop'],
		summary: 'Ahead-of-time compiled Dart UI with Impeller shader precompilation, 120Hz animations, Material 3, Cupertino, and FFI/Platform Channels.',
		recommendedWhen: 'Pixel-consistent custom animations, fintech/consumer polish, or multi-platform apps requiring high frame stability.',
	},
	{
		id: 'android-jetpack-compose',
		name: 'Native Android (Kotlin, Jetpack Compose, Material 3, Room, Hilt, WorkManager)',
		category: 'framework',
		maturity: 'production-proven',
		license: 'Apache-2.0',
		platforms: ['Android'],
		summary: 'First-party declarative Android UI with Coroutines/Flow, Room SQLite, DataStore, WorkManager background jobs, and NDK/JNI support.',
		recommendedWhen: 'Android-first apps, deep hardware/BLE/NFC/automotive/background services, or strict platform performance budgets.',
	},
	{
		id: 'ios-swiftui-swiftdata',
		name: 'Native iOS (Swift 6, SwiftUI, Swift Concurrency, SwiftData, Core ML, StoreKit 2)',
		category: 'framework',
		maturity: 'production-proven',
		license: 'Apache-2.0',
		platforms: ['iOS', 'iPadOS', 'watchOS'],
		summary: 'Apple-native declarative UI with structured concurrency, Keychain, WidgetKit, Live Activities, ARKit, Vision, and HealthKit.',
		recommendedWhen: 'Apple-first apps requiring deep iOS ecosystem integrations (ARKit, HealthKit, StoreKit, Core ML, App Intents).',
	},
	{
		id: 'kotlin-multiplatform',
		name: 'Kotlin Multiplatform (KMP) & Compose Multiplatform',
		category: 'framework',
		maturity: 'production-proven',
		license: 'Apache-2.0',
		platforms: ['Android', 'iOS', 'Desktop', 'Web'],
		summary: 'Share domain, networking (Ktor), SQLDelight persistence, and optional Compose UI across Android and iOS while keeping native SwiftUI/Jetpack parity.',
		recommendedWhen: 'Teams wanting 100% native UIs or shared Kotlin core business logic without JS bridge overhead.',
	},
	{
		id: 'dotnet-maui',
		name: '.NET MAUI & .NET Android/iOS',
		category: 'framework',
		maturity: 'production-proven',
		license: 'MIT',
		platforms: ['Android', 'iOS', 'Windows', 'macOS'],
		summary: 'C# / .NET cross-platform native controls, Blazor Hybrid, and enterprise Microsoft ecosystem integration.',
		recommendedWhen: 'Enterprise C# / Azure organizations sharing models and services with ASP.NET Core backends.',
	},
	{
		id: 'ionic-capacitor',
		name: 'Ionic + Capacitor Native Runtime',
		category: 'framework',
		maturity: 'production-proven',
		license: 'MIT',
		platforms: ['Android', 'iOS', 'Web'],
		summary: 'Standards-based web UI wrapped with native Capacitor plugins for camera, biometrics, push notifications, and filesystem.',
		recommendedWhen: 'Existing web applications needing fast mobile packaging and native plugin access.',
	},
	{
		id: 'on-device-ai-litert-coreml-onnx',
		name: 'On-Device AI Runtimes (LiteRT / TensorFlow Lite, Core ML, ONNX Runtime Mobile)',
		category: 'ai-runtime',
		maturity: 'production-proven',
		license: 'Apache-2.0 / MIT',
		platforms: ['Android', 'iOS'],
		summary: 'Hardware-accelerated NPU/GPU/ANE inference for vision, OCR, embeddings, speech, and small quantized SLMs offline.',
		recommendedWhen: 'Privacy-sensitive, offline, or ultra-low-latency AI features (camera OCR, object detection, local voice/embeddings).',
	},
	{
		id: 'maestro-detox-patrol',
		name: 'Mobile UI & E2E Automation (Maestro, Detox, Patrol, Espresso, XCUITest)',
		category: 'testing',
		maturity: 'production-proven',
		license: 'Apache-2.0 / MIT',
		platforms: ['Android', 'iOS'],
		summary: 'Declarative and framework-native end-to-end UI flows for verifying navigation, gestures, offline states, and regressions on emulators/devices.',
		recommendedWhen: 'Production apps requiring automated regression verification beyond unit and widget/component tests.',
	},
	{
		id: 'offline-sync-crdt-outbox',
		name: 'Offline-First Outbox Queue + SQLite/Room/SwiftData + Conflict Reconciliation',
		category: 'architecture',
		maturity: 'production-proven',
		license: 'Open Pattern',
		platforms: ['Android', 'iOS'],
		summary: 'Local-first writes with idempotent mutation queues, version vectors/ETags, optimistic UI, exponential backoff, and deterministic conflict handling.',
		recommendedWhen: 'Field-service, healthcare, delivery, fintech, chat, and travel apps operating over unreliable mobile networks.',
	},
	{
		id: 'fastlane-eas-store-release',
		name: 'Release Automation (Gradle AAB/R8, Xcode Archive/IPA, Fastlane, EAS Submit)',
		category: 'build-release',
		maturity: 'production-proven',
		license: 'MIT',
		platforms: ['Android', 'iOS'],
		summary: 'Reproducible signed release pipelines, Play Store Data Safety & Apple Privacy Manifest checks, staged rollouts, and crash symbol uploads.',
		recommendedWhen: 'Every mobile app preparing for TestFlight, Google Play Internal Testing, or public store release.',
	},
];

export function discoverMobileCapabilities(query?: string, category?: MobileCapabilityEntry['category']): MobileCapabilityEntry[] {
	const q = (query ?? '').trim().toLowerCase();
	return MOBILE_CAPABILITY_CATALOGUE.filter(entry => {
		if (category && entry.category !== category) { return false; }
		if (!q) { return true; }
		return (
			entry.id.toLowerCase().includes(q)
			|| entry.name.toLowerCase().includes(q)
			|| entry.summary.toLowerCase().includes(q)
			|| entry.recommendedWhen.toLowerCase().includes(q)
			|| entry.platforms.some(p => p.toLowerCase().includes(q))
		);
	});
}

// ============================================================================
// 2. THREE-ENGINE UNIFIED MOBILE ARCHITECTURE ORCHESTRATOR
// ============================================================================

function inferFramework(req: MobileArchitectureRequest): { framework: MobileFrameworkId; rationale: string } {
	if (req.framework) {
		return { framework: req.framework, rationale: `Explicitly selected ${req.framework}.` };
	}
	const text = req.objective.toLowerCase();
	if (/\bflutter\b|\bdart\b|\bwidget\b|\briverpod\b|\bbloc\b/.test(text)) {
		return { framework: 'flutter', rationale: 'Prompt specifies Flutter/Dart ecosystem.' };
	}
	if (/\bjetpack compose\b|\bandroid native\b|\bkotlin\b/.test(text) && !/\bios\b|\bcross[- ]platform\b/.test(text)) {
		return { framework: 'android-kotlin', rationale: 'Android-specific native Kotlin / Jetpack Compose requested.' };
	}
	if (/\bswiftui\b|\bswift\b|\bios native\b|\buikit\b|\barkit\b|\bhealthkit\b|\bcore ml\b/.test(text) && !/\bandroid\b|\bcross[- ]platform\b/.test(text)) {
		return { framework: 'ios-swift', rationale: 'Apple-native Swift / SwiftUI requested.' };
	}
	if (/\bkotlin multiplatform\b|\bkmp\b|\bcompose multiplatform\b/.test(text)) {
		return { framework: 'kotlin-multiplatform', rationale: 'Kotlin Multiplatform specified.' };
	}
	if (/\bmaui\b|\b\.net\b|\bc#\b/.test(text)) {
		return { framework: 'dotnet-maui', rationale: '.NET MAUI / C# specified.' };
	}
	if (/\bionic\b|\bcapacitor\b/.test(text)) {
		return { framework: 'ionic-capacitor', rationale: 'Ionic / Capacitor specified.' };
	}
	if (/\breact native cli\b|\bturbomodule\b|\bjsi\b|\bfabric\b/.test(text)) {
		return { framework: 'react-native-cli', rationale: 'React Native CLI with custom native modules specified.' };
	}
	if (req.platform === 'android') {
		return { framework: 'android-kotlin', rationale: 'Single-platform Android target favors native Kotlin + Jetpack Compose + Material 3.' };
	}
	if (req.platform === 'ios') {
		return { framework: 'ios-swift', rationale: 'Single-platform iOS target favors native Swift + SwiftUI + SwiftData.' };
	}
	return {
		framework: 'react-native-expo',
		rationale: 'Cross-platform Android + iOS default using React Native (Expo + TypeScript + New Architecture) for fast native UI, Expo Router deep linking, and unified testing.',
	};
}

function inferCategory(req: MobileArchitectureRequest): MobileAppCategory {
	if (req.appCategory) { return req.appCategory; }
	const t = req.objective.toLowerCase();
	if (/\bai\b|\bllm\b|\brag\b|\bchatbot\b|\bvoice assistant\b|\bcomputer vision\b|\bocr\b|\bmultimodal\b/.test(t)) return 'ai-powered';
	if (/\bfintech\b|\bpayment\b|\bwallet\b|\bbank\b|\btrading\b|\bcrypto\b/.test(t)) return 'fintech';
	if (/\bhealth\b|\bmedical\b|\bpatient\b|\bclinic\b|\bfitness\b|\btelemedicine\b/.test(t)) return 'healthcare';
	if (/\be-?commerce\b|\bshop\b|\bstore\b|\bcart\b|\bcheckout\b|\bmarketplace\b/.test(t)) return 'ecommerce';
	if (/\bsocial\b|\bchat\b|\bmessaging\b|\bfeed\b|\bcommunity\b/.test(t)) return 'social';
	if (/\bdelivery\b|\bride\b|\bbooking\b|\bon-?demand\b|\bdriver\b|\bdispatch\b/.test(t)) return 'on-demand';
	if (/\boffline\b|\bfield\b|\bsync\b/.test(t)) return 'offline-first';
	if (/\biot\b|\bbluetooth\b|\bble\b|\bsmart home\b|\bwearable\b|\bsensor\b/.test(t)) return 'iot-companion';
	if (/\beducation\b|\blearning\b|\bcourse\b|\bquiz\b/.test(t)) return 'education';
	if (/\benterprise\b|\berp\b|\bcrm\b|\bmulti-?tenant\b|\brbac\b/.test(t)) return 'enterprise';
	if (/\bgame\b|\barcade\b|\bpuzzle\b/.test(t)) return 'game';
	return 'general';
}

function inferBackend(req: MobileArchitectureRequest, category: MobileAppCategory, includeAI: boolean): { backend: MobileBackendStack; rationale: string } {
	if (req.backend) {
		return { backend: req.backend, rationale: `Explicitly selected ${req.backend}.` };
	}
	const t = req.objective.toLowerCase();
	if (/\bno backend\b|\blocal[- ]only\b|\bstandalone\b/.test(t)) {
		return { backend: 'none', rationale: 'Standalone local-only mobile app with no remote server required.' };
	}
	if (/\bfastapi\b|\bpython\b|\bdjango\b/.test(t)) {
		return { backend: /\bdjango\b/.test(t) ? 'python-django' : 'python-fastapi', rationale: 'Python backend explicitly requested.' };
	}
	if (/\blaravel\b|\bphp\b/.test(t)) return { backend: 'php-laravel', rationale: 'PHP / Laravel requested.' };
	if (/\bspring\b|\bjava\b/.test(t)) return { backend: 'java-spring', rationale: 'Java / Spring Boot requested.' };
	if (/\bgo\b|\bgolang\b|\bgin\b|\bfiber\b/.test(t)) return { backend: 'go-gin', rationale: 'Go / Gin high-concurrency API requested.' };
	if (/\brust\b|\baxum\b|\bactix\b/.test(t)) return { backend: 'rust-axum', rationale: 'Rust / Axum ultra-low-latency backend requested.' };
	if (/\basp\.net\b|\bc#\b|\bdotnet\b/.test(t)) return { backend: 'dotnet-aspnet', rationale: 'ASP.NET Core backend requested.' };
	if (/\bnestjs\b/.test(t)) return { backend: 'node-nestjs', rationale: 'NestJS enterprise TypeScript backend requested.' };
	if (/\bsupabase\b/.test(t)) return { backend: 'supabase', rationale: 'Supabase Postgres + Auth + Realtime requested.' };
	if (/\bfirebase\b/.test(t)) return { backend: 'firebase', rationale: 'Firebase Firestore + Auth + FCM requested.' };

	// Intelligent domain-driven selection (never blindly force Node.js)
	if (includeAI || category === 'ai-powered') {
		return { backend: 'python-fastapi', rationale: 'Python + FastAPI chosen for native AI/ML/RAG streaming, OpenAI-compatible proxy, async SSE/WebSockets, and Pydantic contract validation.' };
	}
	if (category === 'fintech' || category === 'on-demand') {
		return { backend: 'go-gin', rationale: 'Go + Gin chosen for high-concurrency transactional APIs, low tail latency, and strong typing.' };
	}
	if (category === 'enterprise' || category === 'healthcare') {
		return { backend: 'node-nestjs', rationale: 'NestJS modular architecture chosen for RBAC, audit logging, OpenAPI contracts, and strict DI boundaries.' };
	}
	return { backend: 'node-express', rationale: 'TypeScript Node/Express REST + WebSocket API chosen for rapid full-stack delivery and shared DTO contracts.' };
}

function inferDeviceCapabilities(req: MobileArchitectureRequest): string[] {
	const caps = new Set<string>(req.deviceCapabilities ?? []);
	const t = req.objective.toLowerCase();
	if (/\bcamera\b|\bphoto\b|\bscan\b|\bqr\b|\bbarcode\b|\bocr\b/.test(t)) caps.add('Camera & Media');
	if (/\bgps\b|\blocation\b|\bmap\b|\bgeofenc\b|\bdelivery\b|\bdriver\b/.test(t)) caps.add('Location, GPS & Maps');
	if (/\bbluetooth\b|\bble\b|\biot\b|\bwearable\b/.test(t)) caps.add('Bluetooth / BLE');
	if (/\bnfc\b|\btap to pay\b/.test(t)) caps.add('NFC');
	if (/\bbiometric\b|\bface id\b|\bfingerprint\b|\bfintech\b|\bhealth\b/.test(t)) caps.add('Biometrics & Secure Enclave / Keystore');
	if (/\bpush\b|\bnotification\b|\bchat\b|\balert\b/.test(t)) caps.add('Push Notifications (FCM / APNs)');
	if (/\bvoice\b|\bspeech\b|\baudio\b|\bmic\b/.test(t)) caps.add('Microphone & Speech');
	if (/\bdeep link\b|\buniversal link\b|\bshare\b/.test(t)) caps.add('Deep Links & Share Sheets');
	if (caps.size === 0) {
		caps.add('Secure Storage (Keychain / Keystore)');
		caps.add('Deep Linking & Push Notifications');
	}
	return Array.from(caps);
}

export function designMobileArchitecture(req: MobileArchitectureRequest): MobileArchitectureDesignReport {
	const t = req.objective.toLowerCase();
	const targetPlatform: MobileTargetPlatform = req.platform
		?? (/\bandroid only\b|\bonly android\b/.test(t) ? 'android'
			: /\bios only\b|\bonly ios\b|\biphone only\b/.test(t) ? 'ios'
				: 'both');

	const { framework, rationale: frameworkRationale } = inferFramework({ ...req, platform: targetPlatform });
	const appCategory = inferCategory(req);
	const includeAI = req.includeAI ?? (appCategory === 'ai-powered' || /\bai\b|\bllm\b|\brag\b|\bvision\b|\bvoice\b|\bassistant\b|\brecommend/.test(t));
	const includeOffline = req.includeOffline ?? (appCategory === 'offline-first' || /\boffline\b|\bsync\b|\bcache\b|\bfield\b|\bno internet\b/.test(t));
	const includeAuth = req.includeAuth ?? !/\bno auth\b|\bcalculator\b|\bstopwatch\b/.test(t);
	const { backend: backendStack, rationale: backendRationale } = inferBackend(req, appCategory, includeAI);

	const database: MobileDatabaseId = req.database ?? (
		backendStack === 'none' ? (includeOffline ? 'sqlite' : 'none')
			: backendStack === 'supabase' ? 'supabase'
				: backendStack === 'firebase' ? 'firestore'
					: (appCategory === 'enterprise' || appCategory === 'fintech' || appCategory === 'ecommerce' || appCategory === 'healthcare') ? 'postgresql'
						: 'sqlite'
	);

	const enginesEngaged: ('Universal Software Engineering Engine' | 'Mobile Application Engineering Engine' | 'AI Engineering Engine')[] = [
		'Mobile Application Engineering Engine',
	];
	if (backendStack !== 'none') { enginesEngaged.push('Universal Software Engineering Engine'); }
	if (includeAI) { enginesEngaged.push('AI Engineering Engine'); }

	const engineMode: MobileArchitectureDesignReport['engineMode'] =
		includeAI && backendStack !== 'none' ? 'unified-three-engine'
			: backendStack !== 'none' ? 'mobile-plus-universal'
				: 'mobile-only';

	const architecturePattern: MobileArchitecturePattern =
		includeOffline ? 'offline-first-cqrs'
			: (appCategory === 'enterprise' || appCategory === 'fintech' || appCategory === 'healthcare') ? 'clean-architecture'
				: (framework === 'android-kotlin' || framework === 'ios-swift') ? 'mvvm'
					: 'feature-based';

	const stateManagement =
		framework === 'flutter' ? 'Riverpod (AsyncNotifier) + immutable Freezed state'
			: framework === 'android-kotlin' ? 'Jetpack ViewModel + Kotlin StateFlow / SharedFlow'
				: framework === 'ios-swift' ? 'Swift @Observable + Swift Concurrency Actors'
					: 'Zustand / Redux Toolkit + TanStack Query (server state & offline cache)';

	const navigationStrategy =
		framework === 'flutter' ? 'GoRouter with typed routes, auth redirects, and deep links'
			: framework === 'android-kotlin' ? 'Navigation Compose with type-safe routes & App Links'
				: framework === 'ios-swift' ? 'NavigationStack / TabView coordinator with Universal Links'
					: 'Expo Router / React Navigation (Bottom Tabs + Auth/Main Stacks + Universal/App Links)';

	const localStore =
		framework === 'android-kotlin' ? 'Room (SQLite) + Encrypted DataStore'
			: framework === 'ios-swift' ? 'SwiftData / Core Data + iOS Keychain'
				: framework === 'flutter' ? 'Drift (SQLite) + flutter_secure_storage'
					: 'Expo SQLite / WatermelonDB + SecureStore (Keychain / Android Keystore)';

	const deviceCapabilities = inferDeviceCapabilities(req);
	const onDeviceAI = /\bon-?device\b|\bedge ai\b|\bcore ml\b|\blite\s?rt\b|\btflite\b|\bonnx\b|\boffline ai\b/.test(t);
	const aiMode: MobileArchitectureDesignReport['aiStrategy']['mode'] =
		!includeAI ? 'none' : onDeviceAI && backendStack !== 'none' ? 'hybrid' : onDeviceAI ? 'on-device' : 'cloud-proxy';

	const specialistAgents = ['mobile_architect', 'mobile_ui_ux'];
	if (framework === 'react-native-expo' || framework === 'react-native-cli') specialistAgents.push('react_native_engineer');
	else if (framework === 'flutter') specialistAgents.push('flutter_engineer');
	else if (framework === 'android-kotlin') specialistAgents.push('android_native_engineer');
	else if (framework === 'ios-swift') specialistAgents.push('ios_native_engineer');
	if (backendStack !== 'none') specialistAgents.push('backend', 'database', 'api');
	if (includeAI) specialistAgents.push('mobile_ai_engineer', 'llm_engineer', 'ai_eval');
	if (includeOffline) specialistAgents.push('mobile_offline_sync');
	specialistAgents.push('mobile_security', 'mobile_qa', 'mobile_perf', 'mobile_release', 'verifier');

	const screens = [
		...(includeAuth ? [{ name: 'Auth / Onboarding', route: '/auth', purpose: 'OAuth/JWT sign-in, biometric unlock, secure token storage' }] : []),
		{ name: 'Home Dashboard', route: '/(tabs)/home', purpose: 'Primary personalized mobile workspace with skeleton, empty & error states' },
		{ name: 'Explore / Catalog', route: '/(tabs)/explore', purpose: 'Virtualized list/search/filter workflow with pull-to-refresh' },
		...(includeAI ? [{ name: 'AI Assistant / Copilot', route: '/(tabs)/assistant', purpose: 'Streaming conversational/multimodal AI backed by secure backend proxy' }] : []),
		{ name: 'Detail & Actions', route: '/item/[id]', purpose: 'Deep-linkable item detail, offline-queued mutations, and optimistic UI' },
		{ name: 'Profile & Settings', route: '/(tabs)/settings', purpose: 'Theme, accessibility/dynamic type, notifications, sync status, privacy controls' },
	];

	const apiEndpoints = backendStack === 'none' ? [] : [
		{ method: 'GET', path: '/api/health', purpose: 'Service liveness, DB connectivity, and version check' },
		...(includeAuth ? [
			{ method: 'POST', path: '/api/auth/login', purpose: 'Authenticate user and issue short-lived JWT + refresh token' },
			{ method: 'POST', path: '/api/auth/refresh', purpose: 'Rotate refresh token cleanly' },
		] : []),
		{ method: 'GET', path: '/api/items', purpose: 'Paginated resource list with delta cursor support' },
		{ method: 'POST', path: '/api/items', purpose: 'Idempotent item creation (supports offline outbox replay)' },
		...(includeOffline ? [{ method: 'POST', path: '/api/sync', purpose: 'Incremental bidirectional sync + conflict resolution' }] : []),
		...(includeAI ? [{ method: 'POST', path: '/api/ai/chat', purpose: 'Server-side authenticated AI proxy (never exposes model API keys to mobile client)' }] : []),
	];

	const mermaidDiagram = [
		'flowchart LR',
		`  Mobile["Mobile App (${framework} / ${targetPlatform})"]`,
		`  LocalDB[("Local Store (${localStore})")]`,
		...(backendStack !== 'none' ? [
			`  API["Backend API (${backendStack})"]`,
			`  DB[("Database (${database})")]`,
			'  Mobile <-->|"HTTPS / JSON / WS"| API',
			'  API <--> DB',
		] : []),
		...(includeOffline ? ['  Mobile <-->|"Outbox Sync Queue"| LocalDB'] : ['  Mobile --> LocalDB']),
		...(includeAI ? [
			aiMode === 'on-device'
				? '  Mobile -->|"LiteRT / CoreML / ONNX"| EdgeAI["On-Device AI Runtime"]'
				: '  API -->|"Secured Server Keys"| LLM["Configured AI Provider / Local Server"]',
		] : []),
	].join('\n');

	return {
		generatedAt: new Date().toISOString(),
		objective: req.objective.trim(),
		engineMode,
		enginesEngaged,
		targetPlatform,
		framework,
		frameworkRationale,
		appCategory,
		architecturePattern,
		backendStack,
		backendRationale,
		database,
		stateManagement,
		navigationStrategy,
		uiDesignSystem: {
			androidDesign: 'Material 3 (dynamic color tokens, 48dp touch targets, edge-to-edge safe areas)',
			iosDesign: 'iOS Human Interface Guidelines (Cupertino navigation, SF typography scale, haptic feedback, safe-area insets)',
			tokensStrategy: 'Platform-adaptive design tokens (light/dark, WCAG AA contrast >= 4.5:1, dynamic type scaling)',
			keyComponents: ['Bottom Tab Bar', 'SafeArea Layout', 'Virtualized Lists', 'Bottom Sheets', 'Skeleton Loaders', 'Empty & Retry Error States', 'Accessible Forms'],
		},
		offlineStrategy: {
			enabled: includeOffline,
			localStore,
			syncProtocol: includeOffline ? 'Durable local mutation outbox with idempotency keys, exponential backoff, and delta pull cursors' : 'HTTP response caching with graceful offline banner and retry',
			conflictResolution: includeOffline ? 'Version-checked optimistic concurrency with deterministic last-write-wins or field-level merge policy' : 'Server-authoritative with retry on reconnect',
		},
		aiStrategy: {
			enabled: includeAI,
			mode: aiMode,
			runtimes: includeAI
				? (aiMode === 'on-device' ? ['LiteRT / TensorFlow Lite', 'Core ML', 'ONNX Runtime Mobile']
					: aiMode === 'hybrid' ? ['Backend Proxy (OpenAI-compatible / Anthropic / Gemini / Ollama)', 'LiteRT / Core ML on-device']
						: ['Backend Proxy (OpenAI-compatible / Anthropic / Gemini / NVIDIA / Ollama)'])
				: [],
			securityRule: 'NEVER embed privileged LLM/cloud API keys in mobile client bundles; route hosted inference through an authenticated backend proxy.',
		},
		deviceCapabilities,
		screens,
		apiEndpoints,
		specialistAgents,
		adrs: [
			{ title: `Mobile Framework Selection: ${framework}`, decision: frameworkRationale, tradeOff: 'Balances native UX fidelity, ecosystem maturity, and cross-platform velocity.' },
			{ title: `Backend Selection: ${backendStack}`, decision: backendRationale, tradeOff: 'Matches runtime strengths to domain requirements instead of forcing a single language.' },
			{ title: `Architecture Pattern: ${architecturePattern}`, decision: `Use ${architecturePattern} with ${stateManagement}.`, tradeOff: 'Separates UI, domain rules, and persistence for testability and long-term scaling.' },
		],
		mermaidDiagram,
		executionPhases: [
			'1. Environment & SDK verification (mobile_probe_environment)',
			'2. Architecture, contracts, and task decomposition',
			'3. Mobile client scaffold + navigation + adaptive design tokens',
			...(backendStack !== 'none' ? ['4. Backend API, database schema, auth & integration tests'] : []),
			...(includeOffline ? ['5. Offline persistence, outbox queue & reconnect reconciliation'] : []),
			...(includeAI ? ['6. Secure AI backend proxy / on-device inference + live verification'] : []),
			'7. Unit, widget/component, integration & device/emulator testing',
			'8. OWASP MASVS security audit + mobile performance audit',
			'9. Store readiness & signed release preparation report',
		],
	};
}

// ============================================================================
// 3. REAL MULTI-FRAMEWORK MOBILE + BACKEND PROJECT GENERATOR
// ============================================================================

function sanitizeIdentifier(name: string): string {
	const cleaned = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
	return cleaned || 'kodia_mobile_app';
}

function toPascalCase(name: string): string {
	return name.split(/[^a-zA-Z0-9]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join('') || 'KodiaMobileApp';
}

export function generateMobileProjectFiles(req: MobileScaffoldRequest): GeneratedMobileFile[] {
	const files: GeneratedMobileFile[] = [];
	const safeSlug = sanitizeIdentifier(req.projectName).replace(/_/g, '-');
	const snakeName = sanitizeIdentifier(req.projectName);
	const pascalName = toPascalCase(req.projectName);
	const includeAI = req.includeAI ?? req.appCategory === 'ai-powered';
	const includeOffline = req.includeOffline ?? req.appCategory === 'offline-first';
	const backend = req.backend ?? (includeAI ? 'python-fastapi' : 'node-express');
	const hasBackend = backend !== 'none';
	const mobilePrefix = hasBackend ? 'mobile/' : '';

	// Shared README documenting architecture & exact real commands
	files.push({
		relativePath: 'README.md',
		content: [
			`# ${req.projectName}`,
			``,
			`Engineered with **Kodia Mobile Application Engineering Platform**.`,
			``,
			`- **Framework:** \`${req.framework}\``,
			`- **Target Platform:** \`${req.platform ?? 'both'}\``,
			`- **Backend:** \`${backend}\``,
			`- **Database:** \`${req.database ?? 'sqlite'}\``,
			`- **Offline-First Sync:** ${includeOffline ? 'Enabled' : 'Standard caching'}`,
			`- **AI Integration:** ${includeAI ? 'Enabled (secured via backend proxy — no client API keys)' : 'None'}`,
			``,
			`## Structure`,
			hasBackend ? `- \`mobile/\` — Mobile application client\n- \`backend/\` — Backend API & persistence service` : `- Root — Mobile application client`,
			``,
		].join('\n'),
	});

	if (req.framework === 'react-native-expo' || req.framework === 'react-native-cli') {
		files.push({
			relativePath: `${mobilePrefix}package.json`,
			content: JSON.stringify({
				name: safeSlug,
				version: '1.0.0',
				private: true,
				main: req.framework === 'react-native-expo' ? 'expo-router/entry' : 'index.js',
				scripts: {
					start: req.framework === 'react-native-expo' ? 'expo start' : 'react-native start',
					android: req.framework === 'react-native-expo' ? 'expo run:android' : 'react-native run-android',
					ios: req.framework === 'react-native-expo' ? 'expo run:ios' : 'react-native run-ios',
					test: 'node --test tests/*.test.mjs',
					typecheck: 'tsc --noEmit',
				},
				dependencies: {
					react: '^18.3.1',
					'react-native': '^0.76.0',
					...(req.framework === 'react-native-expo' ? { expo: '~52.0.0', 'expo-router': '~4.0.0', 'expo-secure-store': '~14.0.0' } : { '@react-navigation/native': '^7.0.0' }),
				},
				devDependencies: {
					typescript: '^5.7.0',
					'@types/react': '^18.3.0',
				},
			}, null, 2) + '\n',
		});

		files.push({
			relativePath: `${mobilePrefix}app.json`,
			content: JSON.stringify({
				expo: {
					name: req.projectName,
					slug: safeSlug,
					version: '1.0.0',
					scheme: safeSlug,
					newArchEnabled: true,
					ios: { bundleIdentifier: `com.kodia.${snakeName}`, supportsTablet: true },
					android: { package: `com.kodia.${snakeName}`, adaptiveIcon: { backgroundColor: '#181818' } },
				},
			}, null, 2) + '\n',
		});

		files.push({
			relativePath: `${mobilePrefix}src/theme/tokens.ts`,
			content: `export const mobileTokens = {\n  colors: {\n    bg: '#181818',\n    surface: '#1F1F1F',\n    primary: '#2563EB',\n    text: '#F3F4F6',\n    muted: '#9CA3AF',\n    danger: '#EF4444',\n    success: '#10B981',\n  },\n  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },\n  touchTargetMin: 48,\n  radius: { sm: 8, md: 12, lg: 16 },\n} as const;\n`,
		});

		files.push({
			relativePath: `${mobilePrefix}src/state/store.mjs`,
			content: [
				`export function createAppStore(initialItems = []) {`,
				`  let state = { items: [...initialItems], loading: false, error: null, online: true };`,
				`  const listeners = new Set();`,
				`  const notify = () => listeners.forEach(fn => fn(state));`,
				`  return {`,
				`    getState: () => state,`,
				`    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },`,
				`    setOnline: (online) => { state = { ...state, online }; notify(); },`,
				`    setItems: (items) => { state = { ...state, items: [...items], loading: false, error: null }; notify(); },`,
				`    upsertItem: (item) => {`,
				`      const idx = state.items.findIndex(x => x.id === item.id);`,
				`      const next = idx >= 0 ? state.items.map((x, i) => (i === idx ? { ...x, ...item } : x)) : [...state.items, item];`,
				`      state = { ...state, items: next };`,
				`      notify();`,
				`    },`,
				`  };`,
				`}`,
				``,
			].join('\n'),
		});

		files.push({
			relativePath: `${mobilePrefix}src/services/apiClient.mjs`,
			content: [
				`export class MobileApiClient {`,
				`  constructor(baseUrl = 'http://127.0.0.1:8000') {`,
				`    this.baseUrl = baseUrl.replace(/\\/+$/, '');`,
				`  }`,
				`  async getHealth() {`,
				`    const res = await fetch(\`\${this.baseUrl}/api/health\`);`,
				`    if (!res.ok) throw new Error(\`Health check failed: \${res.status}\`);`,
				`    return res.json();`,
				`  }`,
				`  async listItems() {`,
				`    const res = await fetch(\`\${this.baseUrl}/api/items\`);`,
				`    if (!res.ok) throw new Error(\`GET /api/items failed: \${res.status}\`);`,
				`    return res.json();`,
				`  }`,
				`  async createItem(item) {`,
				`    const res = await fetch(\`\${this.baseUrl}/api/items\`, {`,
				`      method: 'POST',`,
				`      headers: { 'Content-Type': 'application/json' },`,
				`      body: JSON.stringify(item),`,
				`    });`,
				`    if (!res.ok) throw new Error(\`POST /api/items failed: \${res.status}\`);`,
				`    return res.json();`,
				`  }`,
				...(includeAI ? [
					`  async sendAiPrompt(prompt, conversationId = 'default') {`,
					`    const res = await fetch(\`\${this.baseUrl}/api/ai/chat\`, {`,
					`      method: 'POST',`,
					`      headers: { 'Content-Type': 'application/json' },`,
					`      body: JSON.stringify({ prompt, conversationId }),`,
					`    });`,
					`    if (!res.ok) throw new Error(\`POST /api/ai/chat failed: \${res.status}\`);`,
					`    return res.json();`,
					`  }`,
				] : []),
				`}`,
				``,
			].join('\n'),
		});

		if (includeOffline) {
			files.push({
				relativePath: `${mobilePrefix}src/services/offlineSyncQueue.mjs`,
				content: [
					`/** Durable offline-first outbox queue with idempotent replay & conflict tracking. */`,
					`export class OfflineSyncQueue {`,
					`  constructor() {`,
					`    this.pending = [];`,
					`    this.syncedIds = new Set();`,
					`  }`,
					`  enqueue(mutation) {`,
					`    const entry = {`,
					`      idempotencyKey: mutation.idempotencyKey || \`mut-\${Date.now()}-\${this.pending.length + 1}\`,`,
					`      operation: mutation.operation || 'upsert',`,
					`      payload: mutation.payload,`,
					`      createdAt: new Date().toISOString(),`,
					`      retries: 0,`,
					`    };`,
					`    this.pending.push(entry);`,
					`    return entry;`,
					`  }`,
					`  async flush(transport) {`,
					`    const remaining = [];`,
					`    const synced = [];`,
					`    for (const entry of this.pending) {`,
					`      if (this.syncedIds.has(entry.idempotencyKey)) continue;`,
					`      try {`,
					`        const result = await transport(entry);`,
					`        this.syncedIds.add(entry.idempotencyKey);`,
					`        synced.push({ key: entry.idempotencyKey, result });`,
					`      } catch (err) {`,
					`        entry.retries += 1;`,
					`        entry.lastError = err instanceof Error ? err.message : String(err);`,
					`        remaining.push(entry);`,
					`      }`,
					`    }`,
					`    this.pending = remaining;`,
					`    return { syncedCount: synced.length, remainingCount: remaining.length, synced };`,
					`  }`,
					`}`,
					``,
				].join('\n'),
			});
		}

		files.push({
			relativePath: `${mobilePrefix}src/screens/HomeScreen.tsx`,
			content: [
				`import React from 'react';`,
				`import { SafeAreaView, FlatList, Text, View, StyleSheet } from 'react-native';`,
				`import { mobileTokens } from '../theme/tokens';`,
				``,
				`export interface HomeItem { id: string; title: string; status: string; }`,
				``,
				`export const HomeScreen: React.FC<{ items: HomeItem[] }> = ({ items }) => (`,
				`  <SafeAreaView style={styles.container}>`,
				`    <Text style={styles.heading}>${req.projectName}</Text>`,
				`    <FlatList`,
				`      data={items}`,
				`      keyExtractor={(item) => item.id}`,
				`      ListEmptyComponent={<Text style={styles.empty}>No items yet.</Text>}`,
				`      renderItem={({ item }) => (`,
				`        <View style={styles.card}>`,
				`          <Text style={styles.title}>{item.title}</Text>`,
				`          <Text style={styles.meta}>{item.status}</Text>`,
				`        </View>`,
				`      )}`,
				`    />`,
				`  </SafeAreaView>`,
				`);`,
				``,
				`const styles = StyleSheet.create({`,
				`  container: { flex: 1, backgroundColor: mobileTokens.colors.bg, padding: mobileTokens.spacing.md },`,
				`  heading: { color: mobileTokens.colors.text, fontSize: 22, fontWeight: '700', marginBottom: 12 },`,
				`  card: { backgroundColor: mobileTokens.colors.surface, padding: 14, borderRadius: 12, marginBottom: 10 },`,
				`  title: { color: mobileTokens.colors.text, fontSize: 16, fontWeight: '600' },`,
				`  meta: { color: mobileTokens.colors.muted, fontSize: 13, marginTop: 4 },`,
				`  empty: { color: mobileTokens.colors.muted, textAlign: 'center', marginTop: 32 },`,
				`});`,
				``,
			].join('\n'),
		});

		files.push({
			relativePath: `${mobilePrefix}tests/app.test.mjs`,
			content: [
				`import test from 'node:test';`,
				`import assert from 'node:assert/strict';`,
				`import { createAppStore } from '../src/state/store.mjs';`,
				...(includeOffline ? [`import { OfflineSyncQueue } from '../src/services/offlineSyncQueue.mjs';`] : []),
				``,
				`test('mobile store updates items and connectivity cleanly', () => {`,
				`  const store = createAppStore([{ id: '1', title: 'Initial', status: 'ready' }]);`,
				`  store.upsertItem({ id: '2', title: 'Second', status: 'active' });`,
				`  assert.equal(store.getState().items.length, 2);`,
				`  store.setOnline(false);`,
				`  assert.equal(store.getState().online, false);`,
				`});`,
				...(includeOffline ? [
					``,
					`test('offline sync queue buffers offline writes and reconciles on reconnect', async () => {`,
					`  const queue = new OfflineSyncQueue();`,
					`  queue.enqueue({ idempotencyKey: 'k1', operation: 'create', payload: { title: 'Offline Note' } });`,
					`  const failPass = await queue.flush(async () => { throw new Error('offline'); });`,
					`  assert.equal(failPass.remainingCount, 1);`,
					`  const okPass = await queue.flush(async (entry) => ({ ok: true, key: entry.idempotencyKey }));`,
					`  assert.equal(okPass.syncedCount, 1);`,
					`  assert.equal(okPass.remainingCount, 0);`,
					`});`,
				] : []),
				``,
			].join('\n'),
		});
	} else if (req.framework === 'flutter') {
		files.push({
			relativePath: `${mobilePrefix}pubspec.yaml`,
			content: [
				`name: ${snakeName}`,
				`description: ${req.objective || `${req.projectName} Flutter application`}`,
				`publish_to: 'none'`,
				`version: 1.0.0+1`,
				`environment:`,
				`  sdk: '>=3.4.0 <4.0.0'`,
				`dependencies:`,
				`  flutter:`,
				`    sdk: flutter`,
				`  flutter_riverpod: ^2.6.1`,
				`  go_router: ^14.6.0`,
				`  http: ^1.2.2`,
				`dev_dependencies:`,
				`  flutter_test:`,
				`    sdk: flutter`,
				`  flutter_lints: ^5.0.0`,
				`flutter:`,
				`  uses-material-design: true`,
				``,
			].join('\n'),
		});
		files.push({
			relativePath: `${mobilePrefix}lib/main.dart`,
			content: [
				`import 'package:flutter/material.dart';`,
				`import 'package:flutter_riverpod/flutter_riverpod.dart';`,
				`import 'features/home/home_screen.dart';`,
				``,
				`void main() => runApp(const ProviderScope(child: ${pascalName}App()));`,
				``,
				`class ${pascalName}App extends StatelessWidget {`,
				`  const ${pascalName}App({super.key});`,
				`  @override`,
				`  Widget build(BuildContext context) {`,
				`    return MaterialApp(`,
				`      title: '${req.projectName}',`,
				`      theme: ThemeData(colorSchemeSeed: const Color(0xFF2563EB), useMaterial3: true, brightness: Brightness.dark),`,
				`      home: const HomeScreen(),`,
				`    );`,
				`  }`,
				`}`,
				``,
			].join('\n'),
		});
		files.push({
			relativePath: `${mobilePrefix}lib/features/home/home_screen.dart`,
			content: [
				`import 'package:flutter/material.dart';`,
				`import 'package:flutter_riverpod/flutter_riverpod.dart';`,
				`import '../../state/items_provider.dart';`,
				``,
				`class HomeScreen extends ConsumerWidget {`,
				`  const HomeScreen({super.key});`,
				`  @override`,
				`  Widget build(BuildContext context, WidgetRef ref) {`,
				`    final items = ref.watch(itemsProvider);`,
				`    return Scaffold(`,
				`      appBar: AppBar(title: const Text('${req.projectName}')),`,
				`      body: ListView.builder(`,
				`        itemCount: items.length,`,
				`        itemBuilder: (context, index) => ListTile(title: Text(items[index].title), subtitle: Text(items[index].status)),`,
				`      ),`,
				`    );`,
				`  }`,
				`}`,
				``,
			].join('\n'),
		});
		files.push({
			relativePath: `${mobilePrefix}lib/state/items_provider.dart`,
			content: [
				`import 'package:flutter_riverpod/flutter_riverpod.dart';`,
				``,
				`class MobileItem {`,
				`  final String id;`,
				`  final String title;`,
				`  final String status;`,
				`  const MobileItem({required this.id, required this.title, required this.status});`,
				`}`,
				``,
				`class ItemsNotifier extends Notifier<List<MobileItem>> {`,
				`  @override`,
				`  List<MobileItem> build() => const [MobileItem(id: '1', title: 'Welcome to ${req.projectName}', status: 'ready')];`,
				`  void add(MobileItem item) => state = [...state, item];`,
				`}`,
				``,
				`final itemsProvider = NotifierProvider<ItemsNotifier, List<MobileItem>>(ItemsNotifier.new);`,
				``,
			].join('\n'),
		});
		files.push({
			relativePath: `${mobilePrefix}test/widget_test.dart`,
			content: [
				`import 'package:flutter_test/flutter_test.dart';`,
				`import 'package:flutter_riverpod/flutter_riverpod.dart';`,
				`import 'package:${snakeName}/main.dart';`,
				``,
				`void main() {`,
				`  testWidgets('renders home screen title', (tester) async {`,
				`    await tester.pumpWidget(const ProviderScope(child: ${pascalName}App()));`,
				`    expect(find.text('${req.projectName}'), findsOneWidget);`,
				`  });`,
				`}`,
				``,
			].join('\n'),
		});
	} else if (req.framework === 'android-kotlin') {
		const pkgPath = `com/kodia/${snakeName}`;
		files.push({
			relativePath: `${mobilePrefix}settings.gradle.kts`,
			content: `rootProject.name = "${pascalName}"\ninclude(":app")\n`,
		});
		files.push({
			relativePath: `${mobilePrefix}app/build.gradle.kts`,
			content: [
				`plugins {`,
				`  id("com.android.application") version "8.7.0"`,
				`  id("org.jetbrains.kotlin.android") version "2.0.21"`,
				`}`,
				`android {`,
				`  namespace = "com.kodia.${snakeName}"`,
				`  compileSdk = 35`,
				`  defaultConfig {`,
				`    applicationId = "com.kodia.${snakeName}"`,
				`    minSdk = 26`,
				`    targetSdk = 35`,
				`    versionCode = 1`,
				`    versionName = "1.0.0"`,
				`  }`,
				`  buildFeatures { compose = true }`,
				`}`,
				`dependencies {`,
				`  implementation("androidx.core:core-ktx:1.15.0")`,
				`  implementation("androidx.compose.material3:material3:1.3.1")`,
				`  implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")`,
				`  testImplementation("junit:junit:4.13.2")`,
				`}`,
				``,
			].join('\n'),
		});
		files.push({
			relativePath: `${mobilePrefix}app/src/main/AndroidManifest.xml`,
			content: [
				`<manifest xmlns:android="http://schemas.android.com/apk/res/android">`,
				`  <uses-permission android:name="android.permission.INTERNET" />`,
				`  <application android:label="${req.projectName}" android:usesCleartextTraffic="false">`,
				`    <activity android:name=".MainActivity" android:exported="true">`,
				`      <intent-filter>`,
				`        <action android:name="android.intent.action.MAIN" />`,
				`        <category android:name="android.intent.category.LAUNCHER" />`,
				`      </intent-filter>`,
				`    </activity>`,
				`  </application>`,
				`</manifest>`,
				``,
			].join('\n'),
		});
		files.push({
			relativePath: `${mobilePrefix}app/src/main/java/${pkgPath}/MainViewModel.kt`,
			content: [
				`package com.kodia.${snakeName}`,
				``,
				`data class MobileItem(val id: String, val title: String, val synced: Boolean = true)`,
				``,
				`class MainViewModel {`,
				`  private val _items = mutableListOf(MobileItem("1", "Welcome to ${req.projectName}"))`,
				`  val items: List<MobileItem> get() = _items.toList()`,
				`  fun addItem(title: String, synced: Boolean = true): MobileItem {`,
				`    val item = MobileItem((_items.size + 1).toString(), title, synced)`,
				`    _items.add(item)`,
				`    return item`,
				`  }`,
				`}`,
				``,
			].join('\n'),
		});
		files.push({
			relativePath: `${mobilePrefix}app/src/test/java/${pkgPath}/MainViewModelTest.kt`,
			content: [
				`package com.kodia.${snakeName}`,
				`import org.junit.Assert.assertEquals`,
				`import org.junit.Test`,
				``,
				`class MainViewModelTest {`,
				`  @Test`,
				`  fun addsItemToState() {`,
				`    val vm = MainViewModel()`,
				`    vm.addItem("New Task")`,
				`    assertEquals(2, vm.items.size)`,
				`  }`,
				`}`,
				``,
			].join('\n'),
		});
	} else if (req.framework === 'ios-swift') {
		files.push({
			relativePath: `${mobilePrefix}Package.swift`,
			content: [
				`// swift-tools-version: 5.10`,
				`import PackageDescription`,
				``,
				`let package = Package(`,
				`  name: "${pascalName}",`,
				`  platforms: [.iOS(.v17)],`,
				`  products: [.library(name: "${pascalName}Core", targets: ["${pascalName}Core"])],`,
				`  targets: [`,
				`    .target(name: "${pascalName}Core"),`,
				`    .testTarget(name: "${pascalName}CoreTests", dependencies: ["${pascalName}Core"]),`,
				`  ]`,
				`)`,
				``,
			].join('\n'),
		});
		files.push({
			relativePath: `${mobilePrefix}Sources/${pascalName}Core/AppStore.swift`,
			content: [
				`import Foundation`,
				``,
				`public struct MobileItem: Identifiable, Equatable, Codable {`,
				`  public let id: String`,
				`  public let title: String`,
				`  public var synced: Bool`,
				`  public init(id: String, title: String, synced: Bool = true) {`,
				`    self.id = id; self.title = title; self.synced = synced`,
				`  }`,
				`}`,
				``,
				`public final class AppStore {`,
				`  public private(set) var items: [MobileItem]`,
				`  public init(initial: [MobileItem] = [MobileItem(id: "1", title: "Welcome to ${req.projectName}")]) {`,
				`    self.items = initial`,
				`  }`,
				`  public func add(title: String, synced: Bool = true) {`,
				`    items.append(MobileItem(id: String(items.count + 1), title: title, synced: synced))`,
				`  }`,
				`}`,
				``,
			].join('\n'),
		});
		files.push({
			relativePath: `${mobilePrefix}Tests/${pascalName}CoreTests/AppStoreTests.swift`,
			content: [
				`import XCTest`,
				`@testable import ${pascalName}Core`,
				``,
				`final class AppStoreTests: XCTestCase {`,
				`  func testAddItem() {`,
				`    let store = AppStore()`,
				`    store.add(title: "SwiftUI Screen")`,
				`    XCTAssertEqual(store.items.count, 2)`,
				`  }`,
				`}`,
				``,
			].join('\n'),
		});
	} else {
		// Generic / KMP / MAUI / Ionic / PWA clean starter
		files.push({
			relativePath: `${mobilePrefix}kodia-mobile.config.json`,
			content: JSON.stringify({
				name: req.projectName,
				framework: req.framework,
				platform: req.platform ?? 'both',
				backend,
				database: req.database ?? 'sqlite',
				offline: includeOffline,
				ai: includeAI,
			}, null, 2) + '\n',
		});
	}

	// Optional Cross-Language Backend (Python stdlib/FastAPI-compatible or Node HTTP + SQLite + AI Proxy + Real Tests)
	if (hasBackend) {
		if (backend === 'python-fastapi' || backend === 'python-django') {
			files.push({
				relativePath: 'backend/server.py',
				content: [
					`"""Kodia Mobile Backend (Python + SQLite + Secure AI Proxy)."""`,
					`import json`,
					`import os`,
					`import sqlite3`,
					`from http.server import BaseHTTPRequestHandler, HTTPServer`,
					``,
					`def init_db(db_path: str) -> sqlite3.Connection:`,
					`    conn = sqlite3.connect(db_path, check_same_thread=False)`,
					`    conn.execute("CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL)")`,
					`    conn.commit()`,
					`    return conn`,
					``,
					`def dispatch_request(conn: sqlite3.Connection, method: str, req_path: str, data: dict | None = None):`,
					`    payload = data or {}`,
					`    if method == "GET" and req_path == "/api/health":`,
					`        return 200, {"status": "ok", "backend": "${backend}"}`,
					`    if method == "GET" and req_path == "/api/items":`,
					`        rows = conn.execute("SELECT id, title, status FROM items ORDER BY rowid ASC").fetchall()`,
					`        return 200, {"items": [{"id": r[0], "title": r[1], "status": r[2]} for r in rows]}`,
					`    if method == "POST" and req_path == "/api/items":`,
					`        item_id = str(payload.get("id") or f"item-{conn.execute('SELECT COUNT(*) FROM items').fetchone()[0] + 1}")`,
					`        title = str(payload.get("title") or "").strip()`,
					`        status = str(payload.get("status") or "active")`,
					`        if not title:`,
					`            return 400, {"error": "title_required"}`,
					`        conn.execute("INSERT OR REPLACE INTO items (id, title, status) VALUES (?, ?, ?)", (item_id, title, status))`,
					`        conn.commit()`,
					`        return 201, {"id": item_id, "title": title, "status": status}`,
					`    if method == "POST" and req_path == "/api/ai/chat":`,
					`        prompt = str(payload.get("prompt") or "").strip()`,
					`        if not prompt:`,
					`            return 400, {"error": "prompt_required"}`,
					`        provider_key = os.environ.get("OPENAI_API_KEY") or os.environ.get("KODIA_AI_PROXY_URL")`,
					`        if not provider_key:`,
					`            return 503, {"error": "ai_provider_not_configured", "detail": "Set OPENAI_API_KEY or KODIA_AI_PROXY_URL on the backend server; never embed API keys in mobile clients."}`,
					`        return 200, {"proxied": True, "providerConfigured": True, "promptLength": len(prompt)}`,
					`    return 404, {"error": "not_found"}`,
					``,
					`def create_handler(conn: sqlite3.Connection):`,
					`    class Handler(BaseHTTPRequestHandler):`,
					`        def _send(self, code: int, payload: dict):`,
					`            body = json.dumps(payload).encode("utf-8")`,
					`            self.send_response(code)`,
					`            self.send_header("Content-Type", "application/json")`,
					`            self.send_header("Content-Length", str(len(body)))`,
					`            self.end_headers()`,
					`            self.wfile.write(body)`,
					`        def log_message(self, format, *args):`,
					`            return`,
					`        def do_GET(self):`,
					`            code, payload = dispatch_request(conn, "GET", self.path)`,
					`            return self._send(code, payload)`,
					`        def do_POST(self):`,
					`            length = int(self.headers.get("Content-Length", "0"))`,
					`            raw = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"`,
					`            code, payload = dispatch_request(conn, "POST", self.path, json.loads(raw or "{}"))`,
					`            return self._send(code, payload)`,
					`    return Handler`,
					``,
					`if __name__ == "__main__":`,
					`    db = init_db(os.environ.get("MOBILE_DB_PATH", "mobile_app.db"))`,
					`    port = int(os.environ.get("PORT", "8000"))`,
					`    HTTPServer(("127.0.0.1", port), create_handler(db)).serve_forever()`,
					``,
				].join('\n'),
			});
			files.push({
				relativePath: 'backend/test_server.py',
				content: [
					`import unittest`,
					`from server import init_db, dispatch_request`,
					``,
					`class BackendApiTest(unittest.TestCase):`,
					`    def setUp(self):`,
					`        self.conn = init_db(":memory:")`,
					`    def tearDown(self):`,
					`        self.conn.close()`,
					`    def test_health_and_items_crud(self):`,
					`        code, health = dispatch_request(self.conn, "GET", "/api/health")`,
					`        self.assertEqual(code, 200)`,
					`        self.assertEqual(health["status"], "ok")`,
					`        code, created = dispatch_request(self.conn, "POST", "/api/items", {"id": "m1", "title": "Mobile Order", "status": "synced"})`,
					`        self.assertEqual(code, 201)`,
					`        self.assertEqual(created["title"], "Mobile Order")`,
					`        code, listed = dispatch_request(self.conn, "GET", "/api/items")`,
					`        self.assertEqual(code, 200)`,
					`        self.assertEqual(len(listed["items"]), 1)`,
					`        self.assertEqual(listed["items"][0]["title"], "Mobile Order")`,
					`    def test_ai_proxy_requires_server_credentials(self):`,
					`        code, body = dispatch_request(self.conn, "POST", "/api/ai/chat", {"prompt": "Hello"})`,
					`        self.assertEqual(code, 503)`,
					`        self.assertEqual(body["error"], "ai_provider_not_configured")`,
					``,
					`if __name__ == "__main__":`,
					`    unittest.main()`,
					``,
				].join('\n'),
			});
		} else {
			// Node.js / Express-compatible zero-dependency HTTP server + node:test suite
			files.push({
				relativePath: 'backend/package.json',
				content: JSON.stringify({
					name: `${safeSlug}-backend`,
					version: '1.0.0',
					type: 'module',
					scripts: { start: 'node server.mjs', test: 'node --test server.test.mjs' },
				}, null, 2) + '\n',
			});
			files.push({
				relativePath: 'backend/server.mjs',
				content: [
					`import http from 'node:http';`,
					``,
					`export function createMobileBackendServer() {`,
					`  const items = new Map();`,
					`  return http.createServer(async (req, res) => {`,
					`    const send = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };`,
					`    if (req.method === 'GET' && req.url === '/api/health') return send(200, { status: 'ok', backend: '${backend}' });`,
					`    if (req.method === 'GET' && req.url === '/api/items') return send(200, { items: Array.from(items.values()) });`,
					`    if (req.method === 'POST' && req.url === '/api/items') {`,
					`      let raw = ''; for await (const chunk of req) raw += chunk;`,
					`      const body = JSON.parse(raw || '{}');`,
					`      if (!body.title) return send(400, { error: 'title_required' });`,
					`      const item = { id: String(body.id || items.size + 1), title: String(body.title), status: String(body.status || 'active') };`,
					`      items.set(item.id, item);`,
					`      return send(201, item);`,
					`    }`,
					`    return send(404, { error: 'not_found' });`,
					`  });`,
					`}`,
					``,
				].join('\n'),
			});
			files.push({
				relativePath: 'backend/server.test.mjs',
				content: [
					`import test from 'node:test';`,
					`import assert from 'node:assert/strict';`,
					`import { createMobileBackendServer } from './server.mjs';`,
					``,
					`test('backend health and items API work end-to-end', async () => {`,
					`  const srv = createMobileBackendServer();`,
					`  await new Promise(r => srv.listen(0, '127.0.0.1', r));`,
					`  const { port } = srv.address();`,
					`  try {`,
					`    const health = await fetch(\`http://127.0.0.1:\${port}/api/health\`).then(r => r.json());`,
					`    assert.equal(health.status, 'ok');`,
					`    const created = await fetch(\`http://127.0.0.1:\${port}/api/items\`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Synced Item' }) }).then(r => r.json());`,
					`    assert.equal(created.title, 'Synced Item');`,
					`  } finally { srv.close(); }`,
					`});`,
					``,
				].join('\n'),
			});
		}
	}

	return files;
}

// ============================================================================
// 4. UNIVERSAL MOBILE PROJECT INTELLIGENCE SCANNER
// ============================================================================

export function analyzeMobileProjectFiles(workspaceRoot: string, files: readonly MobileWorkspaceFile[]): MobileProjectIntelligenceReport {
	const paths = files.map(f => f.path.replace(/\\/g, '/'));
	const lowerPaths = paths.map(p => p.toLowerCase());
	const findContent = (pred: (p: string) => boolean) => files.find(f => pred(f.path.replace(/\\/g, '/').toLowerCase()))?.content ?? '';

	const pkgJsonText = findContent(p => p === 'package.json' || p.endsWith('/package.json'));
	const pubspecText = findContent(p => p === 'pubspec.yaml' || p.endsWith('/pubspec.yaml'));
	const gradleText = files.filter(f => f.path.toLowerCase().endsWith('.gradle') || f.path.toLowerCase().endsWith('.gradle.kts')).map(f => f.content).join('\n');
	const swiftPkgText = findContent(p => p.endsWith('package.swift'));

	let framework: MobileFrameworkId | 'unknown' = 'unknown';
	let frameworkLabel = 'No Mobile Framework Detected';

	if (pubspecText && /\bflutter\s*:/i.test(pubspecText)) {
		framework = 'flutter';
		frameworkLabel = 'Flutter (Dart)';
	} else if (pkgJsonText && /"expo"|"expo-router"/i.test(pkgJsonText)) {
		framework = 'react-native-expo';
		frameworkLabel = 'React Native (Expo)';
	} else if (pkgJsonText && /"react-native"/i.test(pkgJsonText)) {
		framework = 'react-native-cli';
		frameworkLabel = 'React Native CLI';
	} else if (pkgJsonText && /"@capacitor\/core"|"@ionic\//i.test(pkgJsonText)) {
		framework = 'ionic-capacitor';
		frameworkLabel = 'Ionic / Capacitor';
	} else if (gradleText && /com\.android\.application|org\.jetbrains\.kotlin\.multiplatform/i.test(gradleText)) {
		framework = /kotlin\.multiplatform/i.test(gradleText) ? 'kotlin-multiplatform' : 'android-kotlin';
		frameworkLabel = framework === 'kotlin-multiplatform' ? 'Kotlin Multiplatform' : 'Native Android (Kotlin/Gradle)';
	} else if (lowerPaths.some(p => p.endsWith('.xcodeproj/project.pbxproj') || p.endsWith('.swift')) && (swiftPkgText || lowerPaths.some(p => p.endsWith('.swift')))) {
		framework = 'ios-swift';
		frameworkLabel = 'Native iOS (Swift)';
	} else if (lowerPaths.some(p => p.endsWith('.csproj')) && files.some(f => /<UseMaui>true<\/UseMaui>/i.test(f.content))) {
		framework = 'dotnet-maui';
		frameworkLabel = '.NET MAUI';
	} else if (lowerPaths.some(p => p.endsWith('manifest.webmanifest') || p.endsWith('manifest.json')) && lowerPaths.some(p => /sw\.(js|ts)|service-worker\.(js|ts)/i.test(p))) {
		framework = 'pwa';
		frameworkLabel = 'Progressive Web App (PWA)';
	}

	const languages = new Set<string>();
	for (const p of lowerPaths) {
		if (p.endsWith('.ts') || p.endsWith('.tsx')) languages.add('TypeScript');
		if (p.endsWith('.js') || p.endsWith('.jsx') || p.endsWith('.mjs')) languages.add('JavaScript');
		if (p.endsWith('.dart')) languages.add('Dart');
		if (p.endsWith('.kt') || p.endsWith('.kts')) languages.add('Kotlin');
		if (p.endsWith('.java')) languages.add('Java');
		if (p.endsWith('.swift')) languages.add('Swift');
		if (p.endsWith('.py')) languages.add('Python');
		if (p.endsWith('.go')) languages.add('Go');
		if (p.endsWith('.cs')) languages.add('C#');
	}

	const targets: ('android' | 'ios' | 'web')[] = [];
	if (framework === 'android-kotlin' || lowerPaths.some(p => p.includes('android/') || p.endsWith('androidmanifest.xml')) || /"android"\s*:/i.test(findContent(p => p.endsWith('app.json')))) {
		targets.push('android');
	}
	if (framework === 'ios-swift' || lowerPaths.some(p => p.includes('ios/') || p.endsWith('info.plist') || p.endsWith('.swift')) || /"ios"\s*:/i.test(findContent(p => p.endsWith('app.json')))) {
		targets.push('ios');
	}
	if (framework === 'react-native-expo' || framework === 'flutter' || framework === 'ionic-capacitor' || framework === 'pwa') {
		if (!targets.includes('android')) targets.push('android');
		if (!targets.includes('ios')) targets.push('ios');
	}

	const allText = files.map(f => f.content).join('\n');
	const navLibs = [
		/expo-router/i.test(allText) ? 'Expo Router' : '',
		/@react-navigation/i.test(allText) ? 'React Navigation' : '',
		/go_router/i.test(allText) ? 'GoRouter' : '',
		/navigation-compose|NavHost/i.test(allText) ? 'Navigation Compose' : '',
		/NavigationStack|NavigationView/i.test(allText) ? 'SwiftUI NavigationStack' : '',
	].filter(Boolean);

	const stateLibs = [
		/zustand/i.test(allText) ? 'Zustand' : '',
		/@reduxjs\/toolkit|redux/i.test(allText) ? 'Redux' : '',
		/riverpod/i.test(allText) ? 'Riverpod' : '',
		/flutter_bloc|Cubit/i.test(allText) ? 'Bloc/Cubit' : '',
		/ViewModel|StateFlow/i.test(allText) ? 'ViewModel / StateFlow' : '',
		/@Observable|ObservableObject/i.test(allText) ? 'SwiftUI Observation' : '',
		/createAppStore/i.test(allText) ? 'Custom Store' : '',
	].filter(Boolean);

	const localDbs = [
		/sqlite|expo-sqlite|sqflite|drift/i.test(allText) ? 'SQLite' : '',
		/androidx\.room|@Entity/i.test(allText) ? 'Room' : '',
		/SwiftData|CoreData/i.test(allText) ? 'SwiftData / Core Data' : '',
		/OfflineSyncQueue|watermelondb/i.test(allText) ? 'Offline Sync Store' : '',
	].filter(Boolean);

	const permissions = new Set<string>();
	for (const f of files) {
		const m1 = f.content.matchAll(/uses-permission\s+android:name="([^"]+)"/g);
		for (const m of m1) permissions.add(m[1]);
		const m2 = f.content.matchAll(/<key>(NS[A-Za-z]+UsageDescription)<\/key>/g);
		for (const m of m2) permissions.add(m[1]);
	}

	const screens = paths.filter(p => /screen|page|view|tab/i.test(p) && /\.(tsx|jsx|dart|kt|swift)$/.test(p)).slice(0, 40);
	const testFiles = paths.filter(p => /(\.test\.|\.spec\.|_test\.dart|Test\.kt|Tests\.swift|test_.*\.py$)/.test(p)).slice(0, 40);
	const buildConfigs = paths.filter(p => /(package\.json|app\.json|eas\.json|pubspec\.yaml|build\.gradle|Package\.swift|Podfile|AndroidManifest\.xml|Info\.plist)$/i.test(p)).slice(0, 30);
	const signingConfigs = paths.filter(p => /(keystore|\.jks|\.p12|\.mobileprovision|eas\.json|Fastfile|Matchfile)/i.test(p)).slice(0, 20);
	const entryPoints = paths.filter(p => /(^|\/)(index\.(ts|tsx|js)|App\.(ts|tsx|js)|main\.dart|MainActivity\.kt|.*App\.swift)$/i.test(p)).slice(0, 15);

	let backendDetected: MobileProjectIntelligenceReport['backendDetected'];
	if (paths.some(p => p.startsWith('backend/') && p.endsWith('.py'))) {
		backendDetected = { path: 'backend', stack: 'Python API Backend' };
	} else if (paths.some(p => p.startsWith('backend/') && /\.(mjs|js|ts)$/.test(p))) {
		backendDetected = { path: 'backend', stack: 'Node.js API Backend' };
	} else if (paths.some(p => p.startsWith('backend/') && p.endsWith('.go'))) {
		backendDetected = { path: 'backend', stack: 'Go API Backend' };
	}

	const defects: { severity: 'high' | 'medium' | 'low'; file: string; message: string }[] = [];
	if (framework !== 'unknown' && testFiles.length === 0) {
		defects.push({ severity: 'medium', file: workspaceRoot, message: 'No automated mobile test files detected.' });
	}
	if (framework === 'android-kotlin' && !paths.some(p => p.toLowerCase().endsWith('androidmanifest.xml'))) {
		defects.push({ severity: 'high', file: workspaceRoot, message: 'Android project is missing AndroidManifest.xml.' });
	}

	return {
		analyzedAt: new Date().toISOString(),
		workspaceRoot,
		detected: framework !== 'unknown',
		framework,
		frameworkLabel,
		languages: Array.from(languages),
		targets,
		architectureStyle: paths.some(p => p.includes('/features/') || p.includes('/domain/')) ? 'Feature-Based / Clean Architecture' : 'Standard Modular',
		entryPoints,
		screens,
		navigationLibraries: navLibs,
		stateManagement: stateLibs,
		apiClients: paths.filter(p => /api|client|http|service/i.test(p) && !/test/i.test(p)).slice(0, 20),
		localDatabases: localDbs,
		nativeModules: paths.filter(p => /native|jni|bridge|channel|plugin/i.test(p)).slice(0, 20),
		permissionsDeclared: Array.from(permissions),
		backendDetected,
		testFiles,
		buildConfigs,
		signingConfigs,
		defects,
		totalFilesScanned: files.length,
	};
}

// ============================================================================
// 5. OWASP MASVS / MASTG MOBILE SECURITY AUDITOR
// ============================================================================

const SECURITY_RULES: readonly {
	id: string;
	masvsCategory: string;
	severity: MobileSecurityFinding['severity'];
	title: string;
	pattern: RegExp;
	remediation: string;
}[] = [
	{
		id: 'MASVS-STORAGE-KEY',
		masvsCategory: 'MASVS-STORAGE',
		severity: 'critical',
		title: 'Hardcoded privileged API key or secret in mobile client',
		pattern: /(?:sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z\-_]{35}|AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----)/,
		remediation: 'Remove secrets from mobile source immediately. Route privileged API calls through an authenticated backend proxy and rotate exposed credentials.',
	},
	{
		id: 'MASVS-NETWORK-CLEARTEXT',
		masvsCategory: 'MASVS-NETWORK',
		severity: 'high',
		title: 'Android cleartext HTTP traffic explicitly enabled',
		pattern: /android:usesCleartextTraffic\s*=\s*"true"/i,
		remediation: 'Set android:usesCleartextTraffic="false" and enforce HTTPS/TLS via network_security_config.xml.',
	},
	{
		id: 'MASVS-NETWORK-ATS',
		masvsCategory: 'MASVS-NETWORK',
		severity: 'high',
		title: 'iOS App Transport Security (NSAllowsArbitraryLoads) disabled',
		pattern: /<key>NSAllowsArbitraryLoads<\/key>\s*<true\s*\/>/i,
		remediation: 'Remove NSAllowsArbitraryLoads=true and enforce TLS 1.2+ for all mobile endpoints.',
	},
	{
		id: 'MASVS-STORAGE-INSECURE-TOKEN',
		masvsCategory: 'MASVS-STORAGE',
		severity: 'high',
		title: 'Auth token stored in unencrypted AsyncStorage / SharedPreferences',
		pattern: /(?:AsyncStorage\.setItem|getSharedPreferences\([^)]*\).*putString)\s*\([^)]*(?:token|jwt|secret|password)/i,
		remediation: 'Store tokens and secrets in iOS Keychain / Android Keystore (e.g., expo-secure-store, flutter_secure_storage, EncryptedSharedPreferences).',
	},
	{
		id: 'MASVS-PLATFORM-WEBVIEW',
		masvsCategory: 'MASVS-PLATFORM',
		severity: 'medium',
		title: 'WebView with JavaScript + universal file access enabled',
		pattern: /setAllowUniversalAccessFromFileURLs\s*\(\s*true\s*\)|allowUniversalAccessFromFileURLs\s*=\s*\{?\s*true/i,
		remediation: 'Disable universal file access in WebViews and validate all loaded origins against an allowlist.',
	},
	{
		id: 'MASVS-RESILIENCE-DEBUGGABLE',
		masvsCategory: 'MASVS-RESILIENCE',
		severity: 'high',
		title: 'Android debuggable flag explicitly set to true in manifest',
		pattern: /android:debuggable\s*=\s*"true"/i,
		remediation: 'Remove hardcoded android:debuggable="true"; rely on Gradle debug vs release build types.',
	},
	{
		id: 'MASVS-AUTH-CLIENT-PAYMENT',
		masvsCategory: 'MASVS-AUTH',
		severity: 'high',
		title: 'Potential client-side payment verification bypass',
		pattern: /paymentSuccess\s*=\s*true|isPaid\s*=\s*true.*\/\/\s*client/i,
		remediation: 'Always verify Stripe/Play Billing/StoreKit receipts and webhooks server-side before unlocking entitlements.',
	},
];

export function auditMobileSecurity(files: readonly MobileWorkspaceFile[]): MobileSecurityAuditReport {
	const findings: MobileSecurityFinding[] = [];
	for (const file of files) {
		if (/\.test\.|\.spec\.|test_.*\.py$/i.test(file.path)) continue;
		const lines = file.content.split('\n');
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			for (const rule of SECURITY_RULES) {
				if (rule.pattern.test(line)) {
					findings.push({
						id: rule.id,
						masvsCategory: rule.masvsCategory,
						severity: rule.severity,
						file: file.path,
						line: i + 1,
						title: rule.title,
						evidence: line.trim().slice(0, 140),
						remediation: rule.remediation,
					});
				}
			}
		}
	}

	const criticalCount = findings.filter(f => f.severity === 'critical').length;
	const highCount = findings.filter(f => f.severity === 'high').length;
	const mediumCount = findings.filter(f => f.severity === 'medium').length;
	const lowCount = findings.filter(f => f.severity === 'low').length;
	const penalty = criticalCount * 30 + highCount * 15 + mediumCount * 7 + lowCount * 3;
	const score = Math.max(0, 100 - penalty);

	const passedChecks: string[] = [];
	if (criticalCount === 0) passedChecks.push('MASVS-STORAGE: No hardcoded cloud/LLM API keys or private keys detected');
	if (!findings.some(f => f.masvsCategory === 'MASVS-NETWORK')) passedChecks.push('MASVS-NETWORK: No insecure cleartext HTTP / ATS bypass flags detected');
	if (!findings.some(f => f.id === 'MASVS-PLATFORM-WEBVIEW')) passedChecks.push('MASVS-PLATFORM: No unsafe WebView universal file access detected');

	return {
		auditedAt: new Date().toISOString(),
		filesScanned: files.length,
		score,
		criticalCount,
		highCount,
		mediumCount,
		lowCount,
		findings,
		passedChecks,
	};
}

// ============================================================================
// 6. MOBILE PERFORMANCE AUDITOR
// ============================================================================

export function auditMobilePerformance(files: readonly MobileWorkspaceFile[]): MobilePerformanceAuditReport {
	const findings: MobilePerformanceFinding[] = [];
	for (const file of files) {
		if (!/\.(tsx|jsx|ts|js|dart|kt|swift)$/i.test(file.path) || /test/i.test(file.path)) continue;
		const lines = file.content.split('\n');
		let flaggedScrollView = false;
		for (let i = 0; i < lines.length; i++) {
			const ln = lines[i];
			if (!flaggedScrollView && (/<ScrollView[^>]*>[\s\S]*\.map\(/i.test(ln) || (/ScrollView/.test(ln) && file.content.includes('.map(') && !file.content.includes('FlatList')))) {
				flaggedScrollView = true;
				findings.push({
					id: 'PERF-UNVIRTUALIZED-LIST',
					category: 'rendering',
					severity: 'medium',
					file: file.path,
					line: i + 1,
					title: 'ScrollView used where FlatList / FlashList virtualization is preferred',
					recommendation: 'Use FlatList, SectionList, or FlashList for dynamic collections to prevent frame drops and memory spikes.',
				});
			}
			if (/console\.log\(/i.test(ln) && !/debug/i.test(file.path)) {
				findings.push({
					id: 'PERF-CONSOLE-LOG',
					category: 'rendering',
					severity: 'low',
					file: file.path,
					line: i + 1,
					title: 'Production console.log statement in mobile bundle',
					recommendation: 'Strip console.log in production builds (e.g. babel-plugin-transform-remove-console) to reduce JS thread overhead.',
				});
			}
		}
	}

	const score = Math.max(40, 100 - findings.filter(f => f.severity === 'high').length * 15 - findings.filter(f => f.severity === 'medium').length * 8 - Math.min(20, findings.filter(f => f.severity === 'low').length * 2));
	return {
		auditedAt: new Date().toISOString(),
		filesScanned: files.length,
		score,
		findings: findings.slice(0, 40),
		recommendations: [
			'Enable Hermes (React Native), Impeller (Flutter), or R8/Baseline Profiles (Android) for faster cold start.',
			'Use virtualized lists (FlatList/ListView.builder/LazyColumn/LazyVStack) for large datasets.',
			'Compress and cache remote images and offload heavy parsing/AI inference off the UI thread.',
		],
	};
}

// ============================================================================
// 7. INDEPENDENT MOBILE PRODUCTION & STORE READINESS ENGINE
// ============================================================================

export function assessMobileProductionReadiness(input: {
	env: MobileEnvironmentProbeReport;
	intel: MobileProjectIntelligenceReport;
	security: MobileSecurityAuditReport;
	performance: MobilePerformanceAuditReport;
	lastBuildTest?: MobileBuildTestResult;
}): MobileProductionReadinessReport {
	const { env, intel, security, performance, lastBuildTest } = input;
	const dimensions: MobileReadinessDimension[] = [];
	const blockingIssues: string[] = [];

	dimensions.push({
		dimension: 'Project & Architecture Integrity',
		status: intel.detected ? (intel.defects.some(d => d.severity === 'high') ? 'failed' : 'verified') : 'not_tested',
		evidence: intel.detected ? `${intel.frameworkLabel} detected (${intel.totalFilesScanned} files, ${intel.screens.length} screen(s), ${intel.testFiles.length} test file(s)).` : 'No mobile project detected in workspace.',
		...(intel.detected ? {} : { actionRequired: 'Scaffold or open a mobile application workspace.' }),
	});

	const testStatus: VerificationStatus = !lastBuildTest
		? 'not_tested'
		: lastBuildTest.status;
	dimensions.push({
		dimension: 'Automated Build & Tests',
		status: testStatus,
		evidence: lastBuildTest
			? `${lastBuildTest.mode} (${lastBuildTest.command}) → ${lastBuildTest.status} (${lastBuildTest.durationMs}ms): ${lastBuildTest.summary}`
			: 'No build or test execution has been recorded yet.',
		...(testStatus !== 'verified' ? { actionRequired: 'Run mobile_build_and_test to capture verified execution evidence.' } : {}),
	});

	const secStatus: VerificationStatus = security.criticalCount > 0 ? 'failed' : security.highCount > 0 ? 'partial' : 'verified';
	dimensions.push({
		dimension: 'OWASP MASVS Security & Privacy',
		status: secStatus,
		evidence: `Security score ${security.score}/100 (${security.criticalCount} critical, ${security.highCount} high, ${security.mediumCount} medium across ${security.filesScanned} files).`,
		...(secStatus !== 'verified' ? { actionRequired: 'Resolve all critical/high MASVS security findings before release.' } : {}),
	});
	if (security.criticalCount > 0) blockingIssues.push(`${security.criticalCount} critical mobile security finding(s) detected.`);

	dimensions.push({
		dimension: 'Mobile Performance & Rendering',
		status: performance.score >= 80 ? 'verified' : 'partial',
		evidence: `Static performance score ${performance.score}/100 (${performance.findings.length} finding(s)). Device FPS/memory profiling requires an attached emulator/device.`,
	});

	const hasDevice = env.devices.some(d => d.state === 'online' || d.state === 'booted');
	dimensions.push({
		dimension: 'Emulator / Physical Device Verification',
		status: hasDevice ? 'partial' : 'blocked_by_env',
		evidence: hasDevice ? `${env.devices.length} device(s) detected on host.` : 'No running Android emulator, iOS simulator, or physical device detected on this host.',
		actionRequired: hasDevice ? 'Run UI/E2E verification on the connected device.' : 'Install Android SDK/Emulator or connect a physical device (or run on macOS for iOS Simulator).',
	});

	const androidStoreChecklist: MobileProductionReadinessReport['androidStoreChecklist'] = [
		{ item: 'Android SDK & Gradle release toolchain (AAB/R8)', status: env.capabilities.canBuildAndroidNative ? 'verified' : 'blocked_by_env', note: env.capabilities.canBuildAndroidNative ? 'Android toolchain detected.' : 'Android SDK / Gradle not installed on this host.' },
		{ item: 'Release keystore & Play App Signing', status: intel.signingConfigs.length > 0 ? 'partial' : 'requires_external_creds_or_hardware', note: 'Signing keystore credentials must be supplied securely by the owner (never auto-signed without authorization).' },
		{ item: 'Cleartext HTTP disabled & MASVS security', status: secStatus, note: `Security audit score ${security.score}/100.` },
	];

	const iosStoreChecklist: MobileProductionReadinessReport['iosStoreChecklist'] = [
		{ item: 'macOS + Xcode Archive / IPA build environment', status: env.capabilities.canBuildIosNative ? 'verified' : 'blocked_by_env', note: env.capabilities.canBuildIosNative ? 'Xcode toolchain detected.' : `Host OS is ${env.hostPlatform}; native iOS compilation & Simulator require macOS with Xcode (or cloud CI such as EAS Build).` },
		{ item: 'Apple Developer certificates, provisioning & TestFlight', status: 'requires_external_creds_or_hardware', note: 'Requires Apple Developer account credentials and explicit user authorization.' },
	];

	const verifiedCount = dimensions.filter(d => d.status === 'verified').length;
	const readinessScore = Math.round((verifiedCount / dimensions.length) * 100);
	const overallStatus: MobileProductionReadinessReport['overallStatus'] =
		blockingIssues.length > 0 || dimensions.some(d => d.status === 'failed') ? 'not_ready'
			: verifiedCount === dimensions.length ? 'ready'
				: 'conditionally_ready';

	return {
		evaluatedAt: new Date().toISOString(),
		framework: intel.framework,
		overallStatus,
		readinessScore,
		dimensions,
		androidStoreChecklist,
		iosStoreChecklist,
		blockingIssues,
		environmentalLimitations: [...env.platformLimitations, ...env.missingPrerequisites],
	};
}

// ============================================================================
// 8. CONCISE LLM FORMATTERS
// ============================================================================

export function formatMobileEnvironmentForLLM(r: MobileEnvironmentProbeReport): string {
	const installed = r.toolchains.filter(t => t.installed).map(t => `${t.name}${t.version ? ` (${t.version})` : ''}`);
	const missing = r.toolchains.filter(t => !t.installed).map(t => t.name);
	return [
		`Mobile Environment Probe (${r.hostPlatform}/${r.hostArch}):`,
		`Installed toolchains (${installed.length}): ${installed.join(', ') || 'none'}`,
		`Missing toolchains (${missing.length}): ${missing.join(', ') || 'none'}`,
		`Android AVDs: ${r.androidAvds.length > 0 ? r.androidAvds.join(', ') : 'none'}`,
		`Connected/Booted Devices: ${r.devices.length > 0 ? r.devices.map(d => `${d.id} (${d.platform} ${d.kind}, ${d.state})`).join('; ') : 'none'}`,
		...(r.platformLimitations.length > 0 ? [`Platform Limitations:\n${r.platformLimitations.map(l => `  - ${l}`).join('\n')}`] : []),
	].join('\n');
}

export function formatMobileArchitectureForLLM(r: MobileArchitectureDesignReport): string {
	return [
		`Mobile Architecture Blueprint (${r.engineMode}):`,
		`Engines: ${r.enginesEngaged.join(' + ')}`,
		`Platform: ${r.targetPlatform} | Framework: ${r.framework} | Category: ${r.appCategory} | Pattern: ${r.architecturePattern}`,
		`Backend: ${r.backendStack} | Database: ${r.database}`,
		`State: ${r.stateManagement} | Navigation: ${r.navigationStrategy}`,
		`Offline-First: ${r.offlineStrategy.enabled ? `Yes (${r.offlineStrategy.localStore})` : 'No'} | AI Mode: ${r.aiStrategy.mode}`,
		`Specialists: ${r.specialistAgents.join(', ')}`,
		`Screens (${r.screens.length}): ${r.screens.map(s => `${s.name} (${s.route})`).join(', ')}`,
		`Diagram:\n\`\`\`mermaid\n${r.mermaidDiagram}\n\`\`\``,
	].join('\n');
}

export function formatMobileProjectIntelForLLM(r: MobileProjectIntelligenceReport): string {
	if (!r.detected) {
		return `No mobile application framework detected in ${r.workspaceRoot} (${r.totalFilesScanned} files scanned).`;
	}
	return [
		`Mobile Project Intelligence (${r.frameworkLabel}):`,
		`Targets: ${r.targets.join(', ') || 'unknown'} | Languages: ${r.languages.join(', ')} | Architecture: ${r.architectureStyle}`,
		`Screens (${r.screens.length}): ${r.screens.slice(0, 12).join(', ') || 'none'}`,
		`Navigation: ${r.navigationLibraries.join(', ') || 'none'} | State: ${r.stateManagement.join(', ') || 'none'} | Local DB: ${r.localDatabases.join(', ') || 'none'}`,
		`Backend: ${r.backendDetected ? `${r.backendDetected.stack} (${r.backendDetected.path})` : 'none detected'}`,
		`Tests (${r.testFiles.length}): ${r.testFiles.slice(0, 10).join(', ') || 'none'}`,
		...(r.defects.length > 0 ? [`Defects:\n${r.defects.map(d => `  - [${d.severity}] ${d.file}: ${d.message}`).join('\n')}`] : []),
	].join('\n');
}

export function formatMobileSecurityForLLM(r: MobileSecurityAuditReport): string {
	const top = r.findings.slice(0, 15).map(f => `  - [${f.severity.toUpperCase()}][${f.masvsCategory}] ${f.file}:${f.line} — ${f.title} (${f.remediation})`);
	return [
		`Mobile Security Audit (OWASP MASVS) — Score: ${r.score}/100 (${r.filesScanned} files scanned)`,
		`Counts: ${r.criticalCount} critical, ${r.highCount} high, ${r.mediumCount} medium, ${r.lowCount} low`,
		...(top.length > 0 ? [`Findings:\n${top.join('\n')}`] : ['No MASVS static security vulnerabilities detected.']),
		...(r.passedChecks.length > 0 ? [`Passed Checks:\n${r.passedChecks.map(c => `  ✓ ${c}`).join('\n')}`] : []),
	].join('\n');
}

export function formatMobileReadinessForLLM(r: MobileProductionReadinessReport): string {
	return [
		`Mobile Production Readiness: ${r.overallStatus.toUpperCase()} (${r.readinessScore}/100) [${r.framework}]`,
		`Dimensions:\n${r.dimensions.map(d => `  - ${d.dimension}: ${d.status} — ${d.evidence}`).join('\n')}`,
		...(r.blockingIssues.length > 0 ? [`Blocking Issues:\n${r.blockingIssues.map(b => `  ! ${b}`).join('\n')}`] : []),
		...(r.environmentalLimitations.length > 0 ? [`Environmental Limitations:\n${r.environmentalLimitations.map(l => `  - ${l}`).join('\n')}`] : []),
	].join('\n');
}
