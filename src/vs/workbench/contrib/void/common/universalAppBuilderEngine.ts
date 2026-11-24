/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ScannedSourceFile } from './projectHealth.js';
import type { EricApiVerificationReport, EricSemanticReport } from './engineeringReasoningTypes.js';
import type { FpereImportExportReport, FpereIntegrationReport } from './firstPassReliabilityTypes.js';
import type {
	IrireClassification,
	IrireExternalRequirement,
	UabeArchitectureStyle,
	UabeBriefSourceType,
	UabeCloudAdapterInfo,
	UabeContractAnalysis,
	UabePlatformTarget,
	UabeProjectState,
	UabeReliabilityDashboardReport,
	UabeReliabilityPillar,
	UabeRequirementItem,
	UabeStackRecommendation,
	UabeVisualEditRequest,
	UabeVisualEditResult,
} from './universalAppBuilderTypes.js';

// ── 1. Official BaaS, Cloud, Database & Service Adapter Catalog (Section 13 & 14) ──────

const CLOUD_ADAPTER_CATALOG: readonly UabeCloudAdapterInfo[] = [
	{
		id: 'supabase',
		name: 'Supabase',
		category: 'baas',
		pricingTier: 'free_available',
		pricingDisclosure: 'Free tier available (subject to project pause after inactivity and storage/bandwidth limits; verify live quotas via LEI before production).',
		capabilities: ['PostgreSQL', 'Auth', 'Row-Level Security', 'Storage', 'Realtime', 'Edge Functions', 'Local CLI'],
		officialSignupUrl: 'https://supabase.com/dashboard/sign-up',
		officialDocsUrl: 'https://supabase.com/docs',
		officialKeysUrl: 'https://supabase.com/dashboard/project/_/settings/api',
		requiresBillingCard: false,
		selfHostable: true,
		localEmulatorAvailable: true,
	},
	{
		id: 'firebase',
		name: 'Firebase (Google)',
		category: 'baas',
		pricingTier: 'free_available',
		pricingDisclosure: 'Spark free tier available for Auth/Firestore/Hosting; Cloud Functions & higher quotas require Blaze pay-as-you-go billing.',
		capabilities: ['Authentication', 'Firestore', 'Realtime Database', 'Storage', 'Cloud Functions', 'FCM Push', 'Emulator Suite'],
		officialSignupUrl: 'https://console.firebase.google.com/',
		officialDocsUrl: 'https://firebase.google.com/docs',
		officialKeysUrl: 'https://console.firebase.google.com/',
		requiresBillingCard: false,
		selfHostable: false,
		localEmulatorAvailable: true,
	},
	{
		id: 'appwrite',
		name: 'Appwrite',
		category: 'baas',
		pricingTier: 'free_available',
		pricingDisclosure: 'Cloud free tier available and fully open-source self-hostable via Docker.',
		capabilities: ['Authentication', 'Databases', 'Storage', 'Functions', 'Realtime', 'Permissions', 'Messaging'],
		officialSignupUrl: 'https://cloud.appwrite.io/register',
		officialDocsUrl: 'https://appwrite.io/docs',
		officialKeysUrl: 'https://cloud.appwrite.io/console',
		requiresBillingCard: false,
		selfHostable: true,
		localEmulatorAvailable: true,
	},
	{
		id: 'convex',
		name: 'Convex',
		category: 'baas',
		pricingTier: 'free_available',
		pricingDisclosure: 'Free starter tier available with usage limits; verify live limits in official Convex pricing docs.',
		capabilities: ['Reactive Database', 'TypeScript Server Functions', 'Realtime Subscriptions', 'File Storage', 'Scheduled Jobs'],
		officialSignupUrl: 'https://dashboard.convex.dev/',
		officialDocsUrl: 'https://docs.convex.dev/',
		officialKeysUrl: 'https://dashboard.convex.dev/',
		requiresBillingCard: false,
		selfHostable: true,
		localEmulatorAvailable: true,
	},
	{
		id: 'pocketbase',
		name: 'PocketBase',
		category: 'baas',
		pricingTier: 'self_hosted_oss',
		pricingDisclosure: '100% open-source single-binary backend (SQLite + Auth + Realtime + Storage); zero vendor fees, user provides hosting.',
		capabilities: ['Embedded SQLite', 'Authentication', 'Realtime', 'File Storage', 'Admin UI', 'Single Binary'],
		officialSignupUrl: 'https://pocketbase.io/docs/',
		officialDocsUrl: 'https://pocketbase.io/docs/',
		officialKeysUrl: 'https://pocketbase.io/docs/',
		requiresBillingCard: false,
		selfHostable: true,
		localEmulatorAvailable: true,
	},
	{
		id: 'mongodb_atlas',
		name: 'MongoDB Atlas',
		category: 'database',
		pricingTier: 'free_available',
		pricingDisclosure: 'M0 shared free cluster available (512MB storage); production clusters are pay-as-you-go.',
		capabilities: ['Managed MongoDB', 'Atlas Search', 'Vector Search', 'Automated Backups', 'Network Access Control'],
		officialSignupUrl: 'https://www.mongodb.com/cloud/atlas/register',
		officialDocsUrl: 'https://www.mongodb.com/docs/atlas/',
		officialKeysUrl: 'https://cloud.mongodb.com/',
		requiresBillingCard: false,
		selfHostable: true,
		localEmulatorAvailable: true,
	},
	{
		id: 'cloudflare',
		name: 'Cloudflare Workers / D1 / R2 / Pages',
		category: 'cloud_serverless',
		pricingTier: 'free_available',
		pricingDisclosure: 'Free quotas available for Workers, Pages, D1, and KV; R2 requires payment method on file even within free allowance.',
		capabilities: ['Workers', 'Pages', 'D1 SQLite', 'R2 Object Storage', 'KV', 'Durable Objects'],
		officialSignupUrl: 'https://dash.cloudflare.com/sign-up',
		officialDocsUrl: 'https://developers.cloudflare.com/',
		officialKeysUrl: 'https://dash.cloudflare.com/profile/api-tokens',
		requiresBillingCard: false,
		selfHostable: false,
		localEmulatorAvailable: true,
	},
	{
		id: 'railway',
		name: 'Railway',
		category: 'hosting',
		pricingTier: 'trial_credits',
		pricingDisclosure: 'Trial credits available initially; ongoing deployments require usage-based paid plan.',
		capabilities: ['Web Services', 'Managed PostgreSQL/Redis', 'Cron Jobs', 'Automatic Builds'],
		officialSignupUrl: 'https://railway.com/',
		officialDocsUrl: 'https://docs.railway.com/',
		officialKeysUrl: 'https://railway.com/account/tokens',
		requiresBillingCard: true,
		selfHostable: false,
		localEmulatorAvailable: false,
	},
	{
		id: 'render',
		name: 'Render',
		category: 'hosting',
		pricingTier: 'free_available',
		pricingDisclosure: 'Free web services spin down on inactivity and free Postgres expires; verify live Render pricing before production.',
		capabilities: ['Web Services', 'Static Sites', 'Managed PostgreSQL', 'Background Workers'],
		officialSignupUrl: 'https://dashboard.render.com/register',
		officialDocsUrl: 'https://render.com/docs',
		officialKeysUrl: 'https://dashboard.render.com/u/settings#api-keys',
		requiresBillingCard: false,
		selfHostable: false,
		localEmulatorAvailable: false,
	},
	{
		id: 'nvidia_nim',
		name: 'NVIDIA NIM / Build API',
		category: 'ai_inference',
		pricingTier: 'trial_credits',
		pricingDisclosure: 'Developer API credits available on build.nvidia.com; verify current model IDs via LEI (lei_discover_models).',
		capabilities: ['OpenAI-Compatible Chat', 'Vision/Multimodal', 'Embeddings', 'Reranking', 'Tool Calling'],
		officialSignupUrl: 'https://build.nvidia.com/',
		officialDocsUrl: 'https://docs.api.nvidia.com/',
		officialKeysUrl: 'https://build.nvidia.com/settings/api-keys',
		requiresBillingCard: false,
		selfHostable: true,
		localEmulatorAvailable: false,
	},
	{
		id: 'openai',
		name: 'OpenAI API',
		category: 'ai_inference',
		pricingTier: 'pay_as_you_go',
		pricingDisclosure: 'Prepaid/pay-as-you-go API billing required; never embed keys in browser/mobile bundles.',
		capabilities: ['LLM Inference', 'Structured Outputs', 'Vision', 'Audio', 'Embeddings', 'Tool Calling'],
		officialSignupUrl: 'https://platform.openai.com/signup',
		officialDocsUrl: 'https://platform.openai.com/docs',
		officialKeysUrl: 'https://platform.openai.com/api-keys',
		requiresBillingCard: true,
		selfHostable: false,
		localEmulatorAvailable: false,
	},
	{
		id: 'stripe',
		name: 'Stripe',
		category: 'payments',
		pricingTier: 'pay_as_you_go',
		pricingDisclosure: 'Free test/sandbox mode with zero monthly fee; live payments charge per-transaction fees and require business verification.',
		capabilities: ['Checkout', 'Subscriptions', 'Webhooks', 'Customer Portal', 'Sandbox Test Mode'],
		officialSignupUrl: 'https://dashboard.stripe.com/register',
		officialDocsUrl: 'https://docs.stripe.com/',
		officialKeysUrl: 'https://dashboard.stripe.com/test/apikeys',
		requiresBillingCard: false,
		selfHostable: false,
		localEmulatorAvailable: true,
	},
	{
		id: 'resend',
		name: 'Resend (Transactional Email)',
		category: 'communications',
		pricingTier: 'free_available',
		pricingDisclosure: 'Free developer tier available; custom sending domain requires DNS verification.',
		capabilities: ['Transactional Email', 'React Email Templates', 'Webhooks', 'Domain Verification'],
		officialSignupUrl: 'https://resend.com/signup',
		officialDocsUrl: 'https://resend.com/docs',
		officialKeysUrl: 'https://resend.com/api-keys',
		requiresBillingCard: false,
		selfHostable: false,
		localEmulatorAvailable: true,
	},
];

export function getCloudAdapterCatalog(): readonly UabeCloudAdapterInfo[] {
	return CLOUD_ADAPTER_CATALOG;
}

// ── 2. Contract-to-Product Requirements Intelligence (Section 5) ───────────────────────

export function extractContractToProduct(
	brief: string,
	sourceType: UabeBriefSourceType = 'idea',
	preferredPlatforms?: readonly UabePlatformTarget[],
): UabeContractAnalysis {
	const raw = brief.trim();
	const lower = raw.toLowerCase();

	// Derive concise project title from first meaningful line or sentence
	const firstLine = raw.split(/\r?\n/).map(l => l.replace(/^#+\s*/, '').trim()).find(Boolean) ?? 'Kodia Application';
	const projectTitle = firstLine.length > 72 ? `${firstLine.slice(0, 69)}...` : firstLine;

	// Detect target platforms
	const platforms = new Set<UabePlatformTarget>(preferredPlatforms ?? []);
	if (/\b(react native|expo)\b/.test(lower)) platforms.add('mobile_rn');
	if (/\b(flutter|dart)\b/.test(lower)) platforms.add('mobile_flutter');
	if (/\b(android|kotlin|jetpack compose|apk|aab)\b/.test(lower)) platforms.add('mobile_android');
	if (/\b(ios|swift|swiftui|iphone|ipad)\b/.test(lower)) platforms.add('mobile_ios');
	if (/\b(mobile app|smartphone|android and ios)\b/.test(lower) && !platforms.has('mobile_flutter') && !platforms.has('mobile_android') && !platforms.has('mobile_ios')) {
		platforms.add('mobile_rn');
	}
	if (/\b(electron)\b/.test(lower)) platforms.add('desktop_electron');
	if (/\b(tauri)\b/.test(lower)) platforms.add('desktop_tauri');
	if (/\b(desktop app|windows app|macos app|linux desktop)\b/.test(lower) && !platforms.has('desktop_tauri')) {
		platforms.add('desktop_electron');
	}
	if (/\b(ai|llm|rag|chatbot|agent|machine learning|nvidia|openai|anthropic|gemini|vision|embeddings)\b/.test(lower)) {
		platforms.add('ai_app');
	}
	if (/\b(e-?commerce|storefront|checkout|cart|products|orders)\b/.test(lower)) platforms.add('ecommerce');
	if (/\b(saas|multi-tenant|subscription|billing|crm|erp|inventory|admin panel|dashboard)\b/.test(lower)) platforms.add('enterprise_saas');
	if (/\b(api|backend|database|auth|login|crud|postgres|mongodb|supabase|firebase)\b/.test(lower)) platforms.add('fullstack');
	if (platforms.size === 0) platforms.add('web');

	// Detect roles
	const roles = new Set<string>();
	if (/\b(admin|administrator)\b/.test(lower)) roles.add('Administrator');
	if (/\b(manager|staff|operator|editor)\b/.test(lower)) roles.add('Manager / Operator');
	if (/\b(customer|buyer|shopper|client|patient|student)\b/.test(lower)) roles.add('Customer / End User');
	if (/\b(vendor|seller|merchant|doctor|teacher)\b/.test(lower)) roles.add('Provider / Merchant');
	if (roles.size === 0) roles.add('End User');

	// Extract bullet/sentence requirements without inventing contractual obligations
	const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
	const requirements: UabeRequirementItem[] = [];
	const objectives: string[] = [];
	const workflows: string[] = [];
	const ambiguities: string[] = [];

	let reqIdx = 1;
	const addReq = (category: UabeRequirementItem['category'], title: string, description: string, acceptance: string[], source: string) => {
		if (requirements.some(r => r.title.toLowerCase() === title.toLowerCase())) return;
		requirements.push({
			id: `REQ-${String(reqIdx++).padStart(3, '0')}`,
			source,
			category,
			title,
			description,
			acceptanceCriteria: acceptance,
			status: 'captured',
			implementationFiles: [],
			testFiles: [],
		});
	};

	for (let i = 0; i < lines.length && requirements.length < 25; i++) {
		const clean = lines[i].replace(/^[-*•\d.)]+\s*/, '').trim();
		if (clean.length < 10) continue;
		if (i === 0 || /^(goal|objective|mission|overview|summary)\b/i.test(clean)) {
			objectives.push(clean);
			continue;
		}
		const cl = clean.toLowerCase();
		const cat: UabeRequirementItem['category'] =
			/\b(auth|rbac|jwt|oauth|security|encrypt|permission|role|csrf|xss|sql)\b/.test(cl) ? 'security'
			: /\b(latency|p95|scale|performance|cache|throughput|offline)\b/.test(cl) ? 'performance'
			: /\b(stripe|paypal|twilio|sendgrid|resend|mongodb|supabase|firebase|nvidia|openai|webhook|api)\b/.test(cl) ? 'integration'
			: /\b(schema|database|table|entity|model|postgres|sqlite|mongo)\b/.test(cl) ? 'data'
			: /\b(workflow|checkout|onboarding|approval|signup|login|booking)\b/.test(cl) ? 'workflow'
			: 'functional';

		if (cat === 'workflow') workflows.push(clean);
		addReq(cat, clean.slice(0, 88), clean, [`Verified behavior for: ${clean.slice(0, 72)}`], `${sourceType}:line-${i + 1}`);
	}

	// Ensure baseline domain requirements reflected in the prompt are captured cleanly
	if (/\b(auth|login|register|signup|roles|rbac)\b/.test(lower) && !requirements.some(r => r.category === 'security')) {
		addReq('security', 'Authentication & Role-Based Access Control', 'Users can register, authenticate securely, and access only role-authorized resources.', ['Unauthenticated requests rejected with 401', 'Unauthorized role rejected with 403'], `${sourceType}:inferred-from-prompt`);
	}
	if (/\b(crud|create|update|delete|manage|inventory|orders|tasks)\b/.test(lower) && !requirements.some(r => /crud|create|manage/i.test(r.title))) {
		addReq('functional', 'End-to-End CRUD Data Workflows', 'Frontend forms, backend API endpoints, and database persistence stay synchronized across create/read/update/delete.', ['Create, list, update, delete verified against real backend & storage'], `${sourceType}:inferred-from-prompt`);
	}
	if (requirements.length === 0) {
		addReq('functional', projectTitle, raw || 'Build the requested application', ['Application builds, runs, and renders core functionality without errors'], `${sourceType}:line-1`);
	}
	if (objectives.length === 0) objectives.push(projectTitle);
	if (workflows.length === 0) workflows.push('Primary user journey from entry screen through core interaction and feedback state');

	// Identify genuine ambiguities without blocking simple requests
	if (/\b(payment|stripe|checkout|subscription)\b/.test(lower) && !/\b(sandbox|test mode|live)\b/.test(lower)) {
		ambiguities.push('Confirm whether payments should start in sandbox/test mode until live merchant keys are supplied.');
	}
	if (/\b(ai|llm|chatbot|rag)\b/.test(lower) && !/\b(nvidia|openai|anthropic|gemini|ollama|local)\b/.test(lower)) {
		ambiguities.push('Preferred AI provider/model not specified; Kodia can verify current providers via LEI or start with a configurable proxy + local fallback.');
	}

	const detectedProviderHints: string[] = [];
	const providerDetectors: [RegExp, string][] = [
		[/\bsupabase\b/, 'supabase'],
		[/\bfirebase|firestore\b/, 'firebase'],
		[/\bappwrite\b/, 'appwrite'],
		[/\bconvex\b/, 'convex'],
		[/\bpocketbase\b/, 'pocketbase'],
		[/\bmongodb|mongo\b/, 'mongodb_atlas'],
		[/\bpostgres|postgresql\b/, 'postgresql'],
		[/\bstripe\b/, 'stripe'],
		[/\bpaypal\b/, 'paypal'],
		[/\bnvidia|nemotron\b/, 'nvidia_nim'],
		[/\bopenai|gpt\b/, 'openai'],
		[/\banthropic|claude\b/, 'anthropic'],
		[/\bgemini\b/, 'gemini'],
		[/\bresend|sendgrid|smtp|email\b/, 'resend'],
		[/\btwilio|sms\b/, 'twilio'],
		[/\bcloudflare|r2|d1\b/, 'cloudflare'],
		[/\baws|s3\b/, 'aws_s3'],
		[/\bgoogle maps|mapbox|geolocation\b/, 'maps'],
		[/\boauth|google login|github login|social login\b/, 'oauth'],
	];
	for (const [re, id] of providerDetectors) {
		if (re.test(lower)) detectedProviderHints.push(id);
	}

	return {
		id: `uabe-spec-${Date.now().toString(36)}`,
		sourceType,
		projectTitle,
		businessObjectives: objectives,
		userRoles: [...roles],
		keyWorkflows: workflows,
		requirements,
		ambiguities,
		detectedPlatforms: [...platforms],
		detectedProviderHints,
		generatedAtMs: Date.now(),
	};
}

// ── 3. Universal Architecture & Stack Intelligence (Sections 6 & 7) ────────────────────

export function recommendUniversalStack(
	analysis: UabeContractAnalysis,
	preferredStack?: string,
	existingDeps?: Readonly<Record<string, string>>,
): UabeStackRecommendation {
	const pref = `${preferredStack ?? ''} ${analysis.requirements.map(r => r.description).join(' ')} ${analysis.projectTitle}`.toLowerCase();
	const deps = existingDeps ?? {};
	const hasExisting = Object.keys(deps).length > 0;

	// Respect existing project dependencies first (never silently replace an existing stack)
	let frontend = 'React + TypeScript + Vite + Tailwind CSS';
	if (deps['next'] || /\bnext\.?js\b/.test(pref)) frontend = 'Next.js (App Router) + TypeScript + Tailwind CSS';
	else if (deps['nuxt'] || /\bnuxt\b/.test(pref)) frontend = 'Nuxt 3 + Vue + TypeScript';
	else if (deps['vue'] || /\bvue\b/.test(pref)) frontend = 'Vue 3 + TypeScript + Vite';
	else if (deps['@sveltejs/kit'] || /\bsveltekit|svelte\b/.test(pref)) frontend = 'SvelteKit + TypeScript';
	else if (deps['@angular/core'] || /\bangular\b/.test(pref)) frontend = 'Angular + TypeScript';
	else if (deps['astro'] || /\bastro\b/.test(pref)) frontend = 'Astro + TypeScript';
	else if (/\bvanilla html|static html|plain html\b/.test(pref)) frontend = 'Semantic HTML5 + Modern CSS + TypeScript/ES Modules';

	let backend = 'Node.js + TypeScript (Fastify/Express)';
	if (/\bfastapi|python\b/.test(pref)) backend = 'Python + FastAPI + Pydantic';
	else if (/\bdjango\b/.test(pref)) backend = 'Python + Django + DRF';
	else if (/\blaravel|php\b/.test(pref)) backend = 'PHP + Laravel';
	else if (/\bspring boot|java\b/.test(pref)) backend = 'Java + Spring Boot';
	else if (/\basp\.?net|c#|\.net\b/.test(pref)) backend = 'C# + ASP.NET Core';
	else if (/\bgolang|\bgo\b/.test(pref)) backend = 'Go (net/http / Gin / Fiber)';
	else if (/\brust|axum|actix\b/.test(pref)) backend = 'Rust + Axum';
	else if (/\bnestjs\b/.test(pref)) backend = 'Node.js + NestJS + TypeScript';
	else if (/\bhono\b/.test(pref)) backend = 'TypeScript + Hono';
	else if (analysis.detectedPlatforms.length === 1 && analysis.detectedPlatforms[0] === 'web') backend = 'None (Static / Client-Side Web App)';

	let database = 'SQLite (zero-config local) / PostgreSQL (production)';
	if (/\bmongodb|mongo\b/.test(pref)) database = 'MongoDB (MongoDB Atlas / local Docker)';
	else if (/\bsupabase\b/.test(pref)) database = 'Supabase PostgreSQL + RLS';
	else if (/\bfirebase|firestore\b/.test(pref)) database = 'Firebase Firestore';
	else if (/\bmysql|mariadb\b/.test(pref)) database = 'MySQL / MariaDB';
	else if (/\bpostgres|postgresql|prisma|drizzle\b/.test(pref)) database = 'PostgreSQL + Prisma/Drizzle Migrations';
	else if (backend.startsWith('None')) database = 'None (Browser storage only)';

	const mobile = analysis.detectedPlatforms.includes('mobile_flutter') ? 'Flutter (Dart + Riverpod + GoRouter)'
		: analysis.detectedPlatforms.includes('mobile_android') ? 'Native Android (Kotlin + Jetpack Compose + Room)'
		: analysis.detectedPlatforms.includes('mobile_ios') ? 'Native iOS (Swift + SwiftUI + SwiftData)'
		: analysis.detectedPlatforms.includes('mobile_rn') ? 'React Native + Expo + TypeScript'
		: undefined;

	const desktop = analysis.detectedPlatforms.includes('desktop_tauri') ? 'Tauri (Rust Core + TypeScript Webview)'
		: analysis.detectedPlatforms.includes('desktop_electron') ? 'Electron + TypeScript (Preload IPC + Context Isolation)'
		: analysis.detectedPlatforms.includes('desktop_native') ? 'Native Desktop (.NET Avalonia / WinUI / Qt)'
		: undefined;

	const aiLayer = analysis.detectedPlatforms.includes('ai_app')
		? 'Backend AI Proxy Service (model-agnostic provider adapter + streaming + LEI-verified model IDs + safe local fallback)'
		: undefined;

	const baasOrCloud = analysis.detectedProviderHints.includes('supabase') ? 'Supabase'
		: analysis.detectedProviderHints.includes('firebase') ? 'Firebase'
		: analysis.detectedProviderHints.includes('appwrite') ? 'Appwrite'
		: analysis.detectedProviderHints.includes('convex') ? 'Convex'
		: analysis.detectedProviderHints.includes('pocketbase') ? 'PocketBase (Self-Hosted)'
		: analysis.detectedProviderHints.includes('cloudflare') ? 'Cloudflare Workers + D1 + R2'
		: undefined;

	let architectureStyle: UabeArchitectureStyle = 'modular_monolith';
	if (analysis.detectedPlatforms.includes('enterprise_saas')) architectureStyle = 'multi_tenant_saas';
	else if (desktop) architectureStyle = 'hybrid_desktop_local';
	else if (mobile) architectureStyle = 'offline_first';
	else if (baasOrCloud === 'Cloudflare Workers + D1 + R2') architectureStyle = 'serverless';
	else if (backend.startsWith('None')) architectureStyle = 'client_server';

	return {
		architectureStyle,
		frontend,
		backend,
		database,
		mobile,
		desktop,
		aiLayer,
		baasOrCloud,
		testingStack: [
			'Unit & Integration Tests (Node/Vitest/Pytest)',
			'Contract & API Verification (Kodia API Studio + FPERE)',
			'Semantic & Installed API Audit (ERIC)',
			'Live Browser / E2E QA (Playwright)',
		],
		rationale: `Selected ${architectureStyle} as the simplest architecture satisfying ${analysis.requirements.length} requirement(s) across [${analysis.detectedPlatforms.join(', ')}]${hasExisting ? ' while preserving existing repository dependencies' : ''}.`,
		alternativesConsidered: [
			{ name: 'Microservices mesh', whyNotChosen: 'Avoided unnecessary operational overhead unless independent scaling/deployment boundaries are explicitly required.' },
		],
		respectsExistingStack: hasExisting,
	};
}

// ── 4. IRIRE: Automatic External Requirements & Official Guided Setup (Section 14) ─────

interface ProviderTemplate {
	providerId: string;
	providerName: string;
	category: IrireExternalRequirement['category'];
	envVarName: string;
	classification: IrireClassification;
	reason: string;
	dependentFeatures: string[];
	officialSignupUrl: string;
	officialDocsUrl: string;
	officialApiKeysUrl: string;
	billingRequirement: string;
	setupSteps: string[];
	alternatives: { providerName: string; note: string; isLocalOrFree: boolean }[];
}

const IRIRE_PROVIDER_TEMPLATES: Readonly<Record<string, ProviderTemplate>> = {
	mongodb_atlas: {
		providerId: 'mongodb_atlas',
		providerName: 'MongoDB Atlas',
		category: 'database',
		envVarName: 'MONGODB_URI',
		classification: 'mandatory',
		reason: 'Required to connect the backend to a MongoDB database cluster.',
		dependentFeatures: ['Data Persistence', 'User & Entity CRUD', 'Search & Aggregations'],
		officialSignupUrl: 'https://www.mongodb.com/cloud/atlas/register',
		officialDocsUrl: 'https://www.mongodb.com/docs/atlas/getting-started/',
		officialApiKeysUrl: 'https://cloud.mongodb.com/',
		billingRequirement: 'Free M0 shared tier available without credit card; dedicated production tiers require billing.',
		setupSteps: [
			'Open the official MongoDB Atlas registration page and create or sign in to your account.',
			'Create a new Project and deploy a Cluster (select M0 Free for development or desired region/tier).',
			'Under Security → Database Access, create a database user with readWrite permissions.',
			'Under Security → Network Access, allow your current IP address (or trusted deployment CIDR).',
			'Click Connect → Drivers, copy the mongodb+srv:// connection string, replace <password>, and paste it below.',
			'Click Test Connection so Kodia verifies live authentication and database reachability.',
		],
		alternatives: [
			{ providerName: 'Local MongoDB (Docker)', note: 'Run docker run -p 27017:27017 mongo:7 locally with zero cloud account.', isLocalOrFree: true },
			{ providerName: 'SQLite / PostgreSQL', note: 'Use local SQLite or PostgreSQL if relational storage fits your schema.', isLocalOrFree: true },
		],
	},
	supabase: {
		providerId: 'supabase',
		providerName: 'Supabase',
		category: 'baas',
		envVarName: 'SUPABASE_URL',
		classification: 'mandatory',
		reason: 'Provides managed PostgreSQL, Auth, Row-Level Security, Storage, and Realtime.',
		dependentFeatures: ['Authentication', 'PostgreSQL Database', 'File Storage', 'Realtime Updates'],
		officialSignupUrl: 'https://supabase.com/dashboard/sign-up',
		officialDocsUrl: 'https://supabase.com/docs/guides/getting-started',
		officialApiKeysUrl: 'https://supabase.com/dashboard/project/_/settings/api',
		billingRequirement: 'Free tier available (up to 2 active free projects; projects pause after inactivity).',
		setupSteps: [
			'Sign in or register at Supabase Dashboard.',
			'Create a new organization and project, choosing a region close to your users.',
			'Navigate to Project Settings → API and copy the Project URL (SUPABASE_URL) and anon/publishable key (never expose service_role key in client bundles!).',
			'Paste the URL/key into Kodia secure credential storage and click Test Connection.',
		],
		alternatives: [
			{ providerName: 'Supabase Local CLI (Docker)', note: 'Run npx supabase start locally for free offline development.', isLocalOrFree: true },
			{ providerName: 'PocketBase (Self-Hosted)', note: 'Single-binary open-source BaaS with SQLite, Auth, and Storage.', isLocalOrFree: true },
		],
	},
	firebase: {
		providerId: 'firebase',
		providerName: 'Firebase',
		category: 'baas',
		envVarName: 'FIREBASE_API_KEY',
		classification: 'mandatory',
		reason: 'Provides Firebase Auth, Firestore, Cloud Storage, and Push Notifications.',
		dependentFeatures: ['Authentication', 'Firestore Data', 'Push Notifications'],
		officialSignupUrl: 'https://console.firebase.google.com/',
		officialDocsUrl: 'https://firebase.google.com/docs/web/setup',
		officialApiKeysUrl: 'https://console.firebase.google.com/',
		billingRequirement: 'Spark free tier covers Auth & starter Firestore; Cloud Functions require Blaze billing.',
		setupSteps: [
			'Open the official Firebase Console and create a new Firebase project.',
			'Register a Web/Android/iOS app in Project Settings → General.',
			'Enable Authentication and Firestore Database with appropriate Security Rules.',
			'Copy the project API key / service credentials into Kodia and run Test Connection.',
		],
		alternatives: [
			{ providerName: 'Firebase Local Emulator Suite', note: 'Develop and test Auth/Firestore locally without cloud billing.', isLocalOrFree: true },
		],
	},
	nvidia_nim: {
		providerId: 'nvidia_nim',
		providerName: 'NVIDIA NIM API',
		category: 'ai_provider',
		envVarName: 'NVIDIA_API_KEY',
		classification: 'mandatory',
		reason: 'Required to call hosted NVIDIA NIM models from the backend AI proxy.',
		dependentFeatures: ['AI Chat & Reasoning', 'Multimodal/Vision', 'Embeddings'],
		officialSignupUrl: 'https://build.nvidia.com/',
		officialDocsUrl: 'https://docs.api.nvidia.com/nim/reference/llm-apis',
		officialApiKeysUrl: 'https://build.nvidia.com/settings/api-keys',
		billingRequirement: 'Developer trial credits available; verify live model IDs with LEI (lei_discover_models) instead of hardcoding older IDs.',
		setupSteps: [
			'Open build.nvidia.com and sign in with an NVIDIA Developer account.',
			'Navigate to Settings → API Keys and click Generate API Key (starts with nvapi-).',
			'Enter the key in Kodia Secure Credentials (stored server-side only, never exposed in frontend code).',
			'Click Test Connection to validate model catalog access.',
		],
		alternatives: [
			{ providerName: 'Local Ollama / vLLM', note: 'Run open models locally via http://localhost:11434 with zero API fees.', isLocalOrFree: true },
		],
	},
	openai: {
		providerId: 'openai',
		providerName: 'OpenAI API',
		category: 'ai_provider',
		envVarName: 'OPENAI_API_KEY',
		classification: 'mandatory',
		reason: 'Required to call OpenAI chat, structured outputs, embeddings, or audio endpoints.',
		dependentFeatures: ['AI Assistant', 'Structured Extraction', 'Embeddings'],
		officialSignupUrl: 'https://platform.openai.com/signup',
		officialDocsUrl: 'https://platform.openai.com/docs/quickstart',
		officialApiKeysUrl: 'https://platform.openai.com/api-keys',
		billingRequirement: 'Requires API billing credits enabled on platform.openai.com (separate from ChatGPT Plus).',
		setupSteps: [
			'Sign in at platform.openai.com and verify billing credits under Settings → Billing.',
			'Open API Keys and create a project-scoped secret key.',
			'Enter the key into Kodia Secure Credentials (backend-only) and click Test Connection.',
		],
		alternatives: [
			{ providerName: 'Local Ollama', note: 'Free local OpenAI-compatible inference at http://localhost:11434/v1.', isLocalOrFree: true },
		],
	},
	anthropic: {
		providerId: 'anthropic',
		providerName: 'Anthropic Claude API',
		category: 'ai_provider',
		envVarName: 'ANTHROPIC_API_KEY',
		classification: 'mandatory',
		reason: 'Required to call Anthropic Claude API models.',
		dependentFeatures: ['AI Reasoning & Generation', 'Tool Calling'],
		officialSignupUrl: 'https://console.anthropic.com/',
		officialDocsUrl: 'https://docs.anthropic.com/',
		officialApiKeysUrl: 'https://console.anthropic.com/settings/keys',
		billingRequirement: 'Pay-as-you-go API credits required in Anthropic Console.',
		setupSteps: [
			'Sign in to console.anthropic.com and enable API billing credits.',
			'Go to Settings → API Keys and create a new secret key.',
			'Save it in Kodia Secure Credentials and run Test Connection.',
		],
		alternatives: [
			{ providerName: 'Local Ollama', note: 'Develop locally without cloud API charges.', isLocalOrFree: true },
		],
	},
	stripe: {
		providerId: 'stripe',
		providerName: 'Stripe Payments',
		category: 'payment',
		envVarName: 'STRIPE_SECRET_KEY',
		classification: 'user_dependent',
		reason: 'Processes checkout sessions, subscriptions, and signed payment webhooks.',
		dependentFeatures: ['Checkout Flow', 'Subscription Billing', 'Payment Webhooks'],
		officialSignupUrl: 'https://dashboard.stripe.com/register',
		officialDocsUrl: 'https://docs.stripe.com/development/quickstart',
		officialApiKeysUrl: 'https://dashboard.stripe.com/test/apikeys',
		billingRequirement: 'Test/Sandbox mode is completely free; live charges require Stripe account verification.',
		setupSteps: [
			'Register or sign in to the official Stripe Dashboard.',
			'Ensure Test Mode is toggled ON while developing.',
			'Open Developers → API keys and copy your sk_test_... Secret Key (backend only!).',
			'Optionally configure Developers → Webhooks (or Stripe CLI) to obtain STRIPE_WEBHOOK_SECRET.',
			'Enter the key into Kodia and click Test Connection.',
		],
		alternatives: [
			{ providerName: 'Stripe Sandbox / Local Mock Checkout Adapter', note: 'Build and test full order flow locally before activating live billing.', isLocalOrFree: true },
		],
	},
	resend: {
		providerId: 'resend',
		providerName: 'Resend / SMTP Email',
		category: 'email',
		envVarName: 'RESEND_API_KEY',
		classification: 'optional',
		reason: 'Sends transactional verification, password reset, and notification emails.',
		dependentFeatures: ['Email Verification', 'Password Reset', 'Order Notifications'],
		officialSignupUrl: 'https://resend.com/signup',
		officialDocsUrl: 'https://resend.com/docs/introduction',
		officialApiKeysUrl: 'https://resend.com/api-keys',
		billingRequirement: 'Free developer tier available; custom domains require DNS records.',
		setupSteps: [
			'Sign up at resend.com.',
			'Navigate to API Keys → Create API Key with Sending Access.',
			'Paste the re_... key into Kodia Secure Credentials and test delivery.',
		],
		alternatives: [
			{ providerName: 'Local Console / Mailpit SMTP Dev Adapter', note: 'Captures emails locally in development without any external email account.', isLocalOrFree: true },
		],
	},
	postgresql: {
		providerId: 'postgresql',
		providerName: 'PostgreSQL Database',
		category: 'database',
		envVarName: 'DATABASE_URL',
		classification: 'mandatory',
		reason: 'Primary relational database connection string for schemas, migrations, and queries.',
		dependentFeatures: ['Database Schema & Migrations', 'Backend API Persistence'],
		officialSignupUrl: 'https://www.postgresql.org/download/',
		officialDocsUrl: 'https://www.postgresql.org/docs/',
		officialApiKeysUrl: 'https://www.postgresql.org/docs/current/libpq-connect.html',
		billingRequirement: 'Free open-source locally or via Docker; managed cloud Postgres varies by host.',
		setupSteps: [
			'Use a local PostgreSQL instance (or Docker: docker run -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:16) or a managed provider (Supabase/Neon/RDS).',
			'Copy the connection URL in the format postgresql://user:pass@host:5432/dbname.',
			'Paste into Kodia Secure Credentials and click Test Connection.',
		],
		alternatives: [
			{ providerName: 'Embedded SQLite (Local Dev)', note: 'Zero-setup local database file for instant prototyping & testing.', isLocalOrFree: true },
		],
	},
	oauth: {
		providerId: 'oauth',
		providerName: 'OAuth Social Login (Google / GitHub)',
		category: 'auth_oauth',
		envVarName: 'OAUTH_CLIENT_ID',
		classification: 'user_dependent',
		reason: 'Enables single sign-on via user-owned OAuth app credentials and verified callback URLs.',
		dependentFeatures: ['Social Sign-In', 'Account Linking'],
		officialSignupUrl: 'https://console.cloud.google.com/apis/credentials',
		officialDocsUrl: 'https://developers.google.com/identity/protocols/oauth2',
		officialApiKeysUrl: 'https://console.cloud.google.com/apis/credentials',
		billingRequirement: 'Free for standard OAuth sign-in; requires developer account and authorized redirect URI.',
		setupSteps: [
			'Open Google Cloud Console (or GitHub Developer Settings) and create an OAuth 2.0 Client.',
			'Register your local redirect URI (e.g. http://localhost:3000/api/auth/callback).',
			'Copy the Client ID and Client Secret into Kodia Secure Credentials.',
		],
		alternatives: [
			{ providerName: 'Email + Password (Argon2/Scrypt) Auth', note: 'Self-contained authentication requiring zero external OAuth providers.', isLocalOrFree: true },
		],
	},
};

export function discoverExternalRequirements(
	brief: string,
	stack: UabeStackRecommendation | undefined,
	sourceFiles: readonly ScannedSourceFile[],
	existingSecrets: Readonly<Record<string, string>>,
): IrireExternalRequirement[] {
	const corpus = `${brief}\n${stack ? JSON.stringify(stack) : ''}\n${sourceFiles.map(f => f.content.slice(0, 6000)).join('\n')}`.toLowerCase();
	const now = Date.now();
	const found: IrireExternalRequirement[] = [];
	const seen = new Set<string>();

	const addFromTemplate = (key: string) => {
		const tpl = IRIRE_PROVIDER_TEMPLATES[key];
		if (!tpl || seen.has(tpl.envVarName)) return;
		seen.add(tpl.envVarName);
		const secretVal = existingSecrets[tpl.envVarName];
		const configured = Boolean(secretVal && secretVal.trim().length > 0);
		found.push({
			id: `irire-${tpl.providerId}-${tpl.envVarName.toLowerCase()}`,
			...tpl,
			mode: configured ? 'sandbox' : 'pending_credentials',
			urlVerificationStatus: 'verified_official',
			retrievedAtMs: now,
			configured,
			maskedValue: configured ? maskSecretValue(secretVal!) : undefined,
		});
	};

	if (/\bmongodb|mongoose|mongodb_uri\b/.test(corpus)) addFromTemplate('mongodb_atlas');
	if (/\bsupabase|supabase_url\b/.test(corpus)) addFromTemplate('supabase');
	if (/\bfirebase|firestore|firebase_api_key\b/.test(corpus)) addFromTemplate('firebase');
	if (/\bpostgres|postgresql|database_url|prisma\b/.test(corpus) && !seen.has('SUPABASE_URL')) addFromTemplate('postgresql');
	if (/\bnvidia|nemotron|nvidia_api_key\b/.test(corpus)) addFromTemplate('nvidia_nim');
	if (/\bopenai|openai_api_key\b/.test(corpus)) addFromTemplate('openai');
	if (/\banthropic|claude|anthropic_api_key\b/.test(corpus)) addFromTemplate('anthropic');
	if (/\b(ai|llm|chatbot|rag|ai_app)\b/.test(corpus) && !seen.has('NVIDIA_API_KEY') && !seen.has('OPENAI_API_KEY') && !seen.has('ANTHROPIC_API_KEY')) {
		addFromTemplate('openai');
	}
	if (/\bstripe|payment|checkout|subscription|stripe_secret_key\b/.test(corpus)) addFromTemplate('stripe');
	if (/\bresend|sendgrid|smtp|transactional email|email notification\b/.test(corpus)) addFromTemplate('resend');
	if (/\boauth|google login|github login|social login\b/.test(corpus)) addFromTemplate('oauth');

	// Also auto-discover ANY process.env.XYZ_KEY / os.environ["XYZ_TOKEN"] in workspace source files!
	const envVarRe = /\b(?:process\.env\.|import\.meta\.env\.|os\.environ(?:\.get)?\(\s*['"])([A-Z][A-Z0-9_]{2,}(?:KEY|TOKEN|SECRET|URI|URL|DSN|PASSWORD|CLIENT_ID))\b/g;
	for (const file of sourceFiles) {
		let m: RegExpExecArray | null;
		while ((m = envVarRe.exec(file.content)) !== null) {
			const envName = m[1];
			if (seen.has(envName) || envName === 'NODE_ENV' || envName === 'PUBLIC_URL') continue;
			seen.add(envName);
			const secretVal = existingSecrets[envName];
			const configured = Boolean(secretVal && secretVal.trim().length > 0);
			found.push({
				id: `irire-custom-${envName.toLowerCase()}`,
				providerId: 'custom',
				providerName: `External Service (${envName})`,
				category: 'custom',
				envVarName: envName,
				classification: 'pending_verification',
				mode: configured ? 'local_dev' : 'pending_credentials',
				reason: `Referenced in ${file.relativePath} and required by runtime code.`,
				dependentFeatures: [file.relativePath],
				officialSignupUrl: '',
				officialDocsUrl: '',
				officialApiKeysUrl: '',
				urlVerificationStatus: 'unverified',
				retrievedAtMs: now,
				billingRequirement: 'Inspect provider documentation (use LEI lei_research_technology) to confirm billing and setup requirements.',
				setupSteps: [
					`Verify which service consumes ${envName} in ${file.relativePath}.`,
					'Create or retrieve the credential from the official provider dashboard.',
					'Save the credential in Kodia Secure Credentials and run Test Connection.',
				],
				alternatives: [
					{ providerName: 'Local Development Stub / Adapter', note: 'Use a clearly marked local dev adapter until live credentials are supplied.', isLocalOrFree: true },
				],
				configured,
				maskedValue: configured ? maskSecretValue(secretVal!) : undefined,
			});
		}
	}

	return found;
}

export function maskSecretValue(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length <= 6) return '••••••';
	return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}

// ── 5. Visual Editing with Real Source-Code Synchronization (Section 9) ────────────────

export function applyVisualEditToSourceCode(
	sourceContent: string,
	req: UabeVisualEditRequest,
): UabeVisualEditResult & { updatedContent?: string } {
	const lines = sourceContent.split(/\r?\n/);
	const needle = req.selectorOrText.trim();
	if (!needle) {
		return { applied: false, filePath: req.filePath, summary: 'No selector or target text specified.', limitationReason: 'Empty target selector.' };
	}

	// Find best matching line (tag/id/className/text match)
	const targetIdx = lines.findIndex(l => l.includes(needle));
	if (targetIdx < 0) {
		return {
			applied: false,
			filePath: req.filePath,
			summary: `Could not map visual target "${needle}" directly inside ${req.filePath}.`,
			limitationReason: 'Target may be rendered dynamically or defined in an imported sub-component; use source-aware chat editing to locate and modify it safely.',
		};
	}

	const originalLine = lines[targetIdx];
	let updatedLine = originalLine;

	// 1. Replace visible text if requested
	if (req.newText !== undefined) {
		updatedLine = updatedLine.replace(needle, req.newText);
	}

	// 2. Apply class additions/removals (JSX className or HTML class)
	if ((req.addClasses && req.addClasses.length > 0) || (req.removeClasses && req.removeClasses.length > 0)) {
		const classAttrRe = /(className|class)\s*=\s*(['"])([^'"]*)\2/;
		const cm = classAttrRe.exec(updatedLine);
		if (cm) {
			const classes = new Set(cm[3].split(/\s+/).filter(Boolean));
			for (const rc of req.removeClasses ?? []) classes.delete(rc);
			for (const ac of req.addClasses ?? []) classes.add(ac);
			updatedLine = updatedLine.replace(classAttrRe, `${cm[1]}=${cm[2]}${[...classes].join(' ')}${cm[2]}`);
		} else if (/<[A-Za-z][^>]*>/.test(updatedLine) && req.addClasses?.length) {
			const attr = /\.(tsx|jsx)$/i.test(req.filePath) ? 'className' : 'class';
			updatedLine = updatedLine.replace(/<([A-Za-z][A-Za-z0-9._-]*)/, `<$1 ${attr}="${req.addClasses.join(' ')}"`);
		}
	}

	// 3. Apply inline style changes (JSX style={{ ... }} or HTML style="...")
	if (req.styleChanges && Object.keys(req.styleChanges).length > 0) {
		const isJsx = /\.(tsx|jsx)$/i.test(req.filePath);
		if (isJsx) {
			const jsxStyleRe = /style=\{\{([^}]*)\}\}/;
			const entries = Object.entries(req.styleChanges).map(([k, v]) => `${k}: '${v.replace(/'/g, "\\'")}'`);
			if (jsxStyleRe.test(updatedLine)) {
				updatedLine = updatedLine.replace(jsxStyleRe, (_m, inner: string) => {
					const existing = inner.trim().replace(/,\s*$/, '');
					return `style={{ ${existing ? `${existing}, ` : ''}${entries.join(', ')} }}`;
				});
			} else if (/<[A-Za-z][^>]*>/.test(updatedLine)) {
				updatedLine = updatedLine.replace(/<([A-Za-z][A-Za-z0-9._-]*)/, `<$1 style={{ ${entries.join(', ')} }}`);
			}
		} else {
			const cssStr = Object.entries(req.styleChanges)
				.map(([k, v]) => `${k.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}: ${v}`)
				.join('; ');
			const htmlStyleRe = /style=(['"])([^'"]*)\1/;
			if (htmlStyleRe.test(updatedLine)) {
				updatedLine = updatedLine.replace(htmlStyleRe, (_m, q: string, inner: string) => {
					const clean = inner.trim().replace(/;\s*$/, '');
					return `style=${q}${clean ? `${clean}; ` : ''}${cssStr}${q}`;
				});
			} else if (/<[A-Za-z][^>]*>/.test(updatedLine)) {
				updatedLine = updatedLine.replace(/<([A-Za-z][A-Za-z0-9._-]*)/, `<$1 style="${cssStr}"`);
			}
		}
	}

	if (updatedLine === originalLine) {
		return {
			applied: false,
			filePath: req.filePath,
			matchedLine: targetIdx + 1,
			summary: `Matched line ${targetIdx + 1} in ${req.filePath}, but no source syntax change was applicable.`,
			limitationReason: 'Line did not contain a modifiable HTML/JSX tag or matching text.',
		};
	}

	const nextLines = [...lines];
	nextLines[targetIdx] = updatedLine;
	return {
		applied: true,
		filePath: req.filePath,
		matchedLine: targetIdx + 1,
		beforeSnippet: originalLine.trim(),
		afterSnippet: updatedLine.trim(),
		updatedContent: nextLines.join('\n'),
		summary: `Synchronized visual edit to real source code at ${req.filePath}:${targetIdx + 1}.`,
	};
}

// ── 6. Honest Application Reliability Dashboard Builder (Section 27) ───────────────────

export function buildTruthfulReliabilityReport(params: {
	workspaceRoot: string;
	importReport: FpereImportExportReport;
	integrationReport: FpereIntegrationReport;
	semanticReport: EricSemanticReport;
	apiVerification: EricApiVerificationReport;
	integrations: readonly IrireExternalRequirement[];
	compilerRan: boolean;
	compilerErrors: number;
	testRan: boolean;
	testPassed: boolean;
	testDetail?: string;
	buildRan: boolean;
	buildPassed: boolean;
	buildDetail?: string;
	previewRunning: boolean;
	platforms: readonly UabePlatformTarget[];
}): UabeReliabilityDashboardReport {
	const now = Date.now();
	const pendingCreds = params.integrations.filter(i => i.classification === 'mandatory' && !i.configured);
	const failedIntegrations = params.integrations.filter(i => i.mode === 'failed');

	const hasMobile = params.platforms.some(p => p.startsWith('mobile_'));
	const hasDesktop = params.platforms.some(p => p.startsWith('desktop_'));

	const pillars: UabeReliabilityPillar[] = [
		{
			id: 'imports',
			label: 'Imports, Exports & Dependencies',
			status: params.importReport.passed ? 'passed' : 'failed',
			detail: params.importReport.summary,
			checkedAtMs: now,
		},
		{
			id: 'fullstack_contracts',
			label: 'Frontend ↔ Backend ↔ DB Contracts',
			status: params.integrationReport.passed ? 'passed' : 'failed',
			detail: params.integrationReport.summary,
			checkedAtMs: now,
		},
		{
			id: 'semantic_correctness',
			label: 'Semantic & Behavioral Correctness (ERIC)',
			status: params.semanticReport.passed ? (params.semanticReport.warningCount > 0 ? 'warning' : 'passed') : 'failed',
			detail: params.semanticReport.summary,
			checkedAtMs: now,
		},
		{
			id: 'installed_apis',
			label: 'Installed Package API Verification (ERIC)',
			status: params.apiVerification.passed ? 'passed' : 'failed',
			detail: params.apiVerification.summary,
			checkedAtMs: now,
		},
		{
			id: 'compiler',
			label: 'Independent Compiler & Type Check',
			status: !params.compilerRan ? 'not_tested' : params.compilerErrors === 0 ? 'passed' : 'failed',
			detail: !params.compilerRan ? 'Compiler check was not executed.' : params.compilerErrors === 0 ? '0 compiler errors.' : `${params.compilerErrors} compiler error(s).`,
			checkedAtMs: now,
		},
		{
			id: 'tests',
			label: 'Automated Runtime Tests',
			status: !params.testRan ? 'not_tested' : params.testPassed ? 'passed' : 'failed',
			detail: params.testDetail ?? (!params.testRan ? 'No runtime test command executed.' : params.testPassed ? 'Tests passed.' : 'Tests failed.'),
			checkedAtMs: now,
		},
		{
			id: 'build',
			label: 'Production Build',
			status: !params.buildRan ? 'not_tested' : params.buildPassed ? 'passed' : 'failed',
			detail: params.buildDetail ?? (!params.buildRan ? 'Build command was not executed.' : params.buildPassed ? 'Build passed.' : 'Build failed.'),
			checkedAtMs: now,
		},
		{
			id: 'external_integrations',
			label: 'External Integrations & Credentials (IRIRE)',
			status: failedIntegrations.length > 0 ? 'failed' : pendingCreds.length > 0 ? 'blocked' : params.integrations.length === 0 ? 'not_applicable' : 'passed',
			detail: failedIntegrations.length > 0
				? `${failedIntegrations.length} integration(s) failed verification.`
				: pendingCreds.length > 0
					? `${pendingCreds.length} mandatory credential(s) pending user setup: ${pendingCreds.map(p => p.envVarName).join(', ')}.`
					: params.integrations.length === 0
						? 'No external paid/cloud credentials required.'
						: `${params.integrations.length} integration(s) configured.`,
			checkedAtMs: now,
		},
		{
			id: 'preview_browser',
			label: 'Live Preview & Browser Workflow',
			status: params.previewRunning ? 'passed' : 'not_tested',
			detail: params.previewRunning ? 'Live application preview server active.' : 'Live browser workflow not yet executed in this check.',
			checkedAtMs: now,
		},
		{
			id: 'mobile_runtime',
			label: 'Native Mobile Runtime Verification',
			status: hasMobile ? 'unverified' : 'not_applicable',
			detail: hasMobile ? 'Native emulator/device verification requires Android/iOS runtime check (never substituted by web preview).' : 'Not a mobile target.',
			checkedAtMs: now,
		},
		{
			id: 'desktop_runtime',
			label: 'Native Desktop Runtime Verification',
			status: hasDesktop ? 'unverified' : 'not_applicable',
			detail: hasDesktop ? 'Desktop runtime startup/packaging requires native desktop launch (never substituted by browser preview).' : 'Not a desktop target.',
			checkedAtMs: now,
		},
	];

	const failedCount = pillars.filter(p => p.status === 'failed').length;
	const blockedCount = pillars.filter(p => p.status === 'blocked').length;
	const unverifiedFeatures = pillars
		.filter(p => p.status === 'not_tested' || p.status === 'unverified' || p.status === 'blocked')
		.map(p => `${p.label}: ${p.detail}`);

	const unresolvedDefectsCount =
		params.importReport.errorCount
		+ params.integrationReport.issues.filter(i => i.severity === 'error').length
		+ params.semanticReport.criticalCount
		+ params.semanticReport.errorCount
		+ params.apiVerification.issues.length
		+ params.compilerErrors
		+ (params.testRan && !params.testPassed ? 1 : 0)
		+ (params.buildRan && !params.buildPassed ? 1 : 0);

	const overallStatus: UabeReliabilityDashboardReport['overallStatus'] =
		failedCount > 0 || unresolvedDefectsCount > 0 ? 'needs_fixes'
		: blockedCount > 0 ? 'blocked'
		: unverifiedFeatures.length > 0 ? 'partially_verified'
		: 'verified_against_executed_checks';

	const applicable = pillars.filter(p => p.status !== 'not_applicable');
	const verifiedChecksCount = applicable.filter(p => p.status === 'passed').length;

	return {
		evaluatedAtMs: now,
		workspaceRoot: params.workspaceRoot,
		overallStatus,
		pillars,
		unresolvedDefectsCount,
		blockedRequirementsCount: pendingCreds.length,
		unverifiedFeatures,
		verifiedChecksCount,
		totalChecksCount: applicable.length,
		summary: `Reliability Status: ${overallStatus} — ${verifiedChecksCount}/${applicable.length} applicable pillars passed, ${unresolvedDefectsCount} unresolved defect(s), ${unverifiedFeatures.length} unverified/blocked item(s).`,
	};
}

// ── 7. Client Delivery & Handover Package Generator (Section 33) ───────────────────────

const SECRET_PATTERN = /\b(sk-(?:live|test|proj)?[A-Za-z0-9_-]{12,}|nvapi-[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,}|ghp_[A-Za-z0-9]{20,}|mongodb\+srv:\/\/[^:\s]+:[^@\s]+@)\b/g;

export function redactSecretsForHandover(text: string): { sanitized: string; redactions: number } {
	let redactions = 0;
	const sanitized = text.replace(SECRET_PATTERN, () => {
		redactions++;
		return '<REDACTED_SECRET_CONFIGURE_IN_ENV>';
	});
	return { sanitized, redactions };
}

export function buildHandoverDocuments(
	state: UabeProjectState,
	clientName = 'Client Team',
	projectTitle?: string,
): { files: Record<string, string>; redactions: number } {
	const title = projectTitle ?? state.contractAnalysis?.projectTitle ?? state.name;
	let totalRedactions = 0;
	const clean = (s: string) => {
		const r = redactSecretsForHandover(s);
		totalRedactions += r.redactions;
		return r.sanitized;
	};

	const stack = state.stack;
	const reqs = state.contractAnalysis?.requirements ?? [];
	const rel = state.reliability;

	const productArchMd = clean([
		`# ${title} — Product & Architecture Documentation`,
		``,
		`**Prepared for:** ${clientName}  `,
		`**Generated by:** Kodia Universal App Builder Engine (UABE) on ${new Date().toISOString()}`,
		``,
		`## 1. Product Overview & Objectives`,
		...(state.contractAnalysis?.businessObjectives ?? [state.brief || title]).map(o => `- ${o}`),
		``,
		`## 2. Target Platforms & Architecture`,
		`- **Platforms:** ${state.platforms.join(', ')}`,
		`- **Architecture Style:** ${stack?.architectureStyle ?? 'modular_monolith'}`,
		`- **Frontend:** ${stack?.frontend ?? 'Not specified'}`,
		`- **Backend:** ${stack?.backend ?? 'Not specified'}`,
		`- **Database:** ${stack?.database ?? 'Not specified'}`,
		stack?.mobile ? `- **Mobile:** ${stack.mobile}` : '',
		stack?.desktop ? `- **Desktop:** ${stack.desktop}` : '',
		stack?.aiLayer ? `- **AI Layer:** ${stack.aiLayer}` : '',
		stack?.baasOrCloud ? `- **BaaS / Cloud:** ${stack.baasOrCloud}` : '',
		`- **Rationale:** ${stack?.rationale ?? 'Aligned to project requirements.'}`,
		``,
		`## 3. User Roles & Core Workflows`,
		`- **Roles:** ${(state.contractAnalysis?.userRoles ?? ['End User']).join(', ')}`,
		...(state.contractAnalysis?.keyWorkflows ?? []).map(w => `- ${w}`),
		``,
		`## 4. Requirements Traceability Matrix`,
		`| ID | Category | Requirement | Status |`,
		`|---|---|---|---|`,
		...reqs.map(r => `| ${r.id} | ${r.category} | ${r.title.replace(/\|/g, '\\|')} | ${r.status} |`),
		``,
		`## 5. External Integrations & Security Posture`,
		...(state.integrations.length
			? state.integrations.map(i => `- **${i.providerName}** (\`${i.envVarName}\`, ${i.classification}) — Mode: \`${i.mode}\` | Official Docs: ${i.officialDocsUrl || 'See project README'}`)
			: ['- No external paid third-party credentials required.']),
	].filter(Boolean).join('\n'));

	const installOpsMd = clean([
		`# ${title} — Installation, Configuration & Operations Guide`,
		``,
		`## 1. Environment Configuration (Zero Secrets Bundled)`,
		`Copy \`.env.example\` to \`.env.local\` and populate the required values. **No live API keys or secrets are included in this handover package.**`,
		``,
		`## 2. Required External Credentials & Official Setup Links`,
		...(state.integrations.length
			? state.integrations.flatMap(i => [
				`### ${i.providerName} (\`${i.envVarName}\`)`,
				`- **Classification:** ${i.classification} | **Billing:** ${i.billingRequirement}`,
				i.officialSignupUrl ? `- **Official Account / Dashboard:** ${i.officialSignupUrl}` : '',
				i.officialDocsUrl ? `- **Official Documentation:** ${i.officialDocsUrl}` : '',
				...i.setupSteps.map((s, idx) => `${idx + 1}. ${s}`),
				``,
			])
			: ['No external accounts required for local execution.']),
		`## 3. Local Development, Testing & Build`,
		'```bash',
		'# Install dependencies (check package.json / requirements.txt / pubspec.yaml)',
		'npm install',
		'npm test',
		'npm run build',
		'```',
	].filter(Boolean).join('\n'));

	const verificationMd = clean([
		`# ${title} — Truthful Testing & Verification Report`,
		``,
		`> **Verification Honesty Notice:** This report lists only checks actually executed by Kodia. Unexecuted or blocked dimensions are explicitly marked as \`not_tested\`, \`unverified\`, or \`blocked\`.`,
		``,
		`- **Overall Status:** \`${rel?.overallStatus ?? 'partially_verified'}\``,
		`- **Summary:** ${rel?.summary ?? 'Run reliability evaluation to populate live verification metrics.'}`,
		``,
		`## Verification Pillars`,
		`| Pillar | Status | Evidence / Detail |`,
		`|---|---|---|`,
		...(rel?.pillars ?? []).map(p => `| ${p.label} | \`${p.status}\` | ${p.detail.replace(/\|/g, '\\|')} |`),
		``,
		`## Known Limitations & Unverified Areas`,
		...(rel?.unverifiedFeatures.length ? rel.unverifiedFeatures.map(u => `- ${u}`) : ['- None recorded for executed checks.']),
	].join('\n'));

	const envTemplate = clean([
		`# ${title} — Sanitized Environment Template (DO NOT COMMIT REAL SECRETS)`,
		...(state.integrations.length
			? state.integrations.map(i => `# ${i.providerName}: ${i.reason}\n${i.envVarName}=`)
			: ['# No external environment variables required.']),
	].join('\n'));

	const presentationHtml = clean(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title.replace(/</g, '&lt;')} — Client Handover Presentation</title>
<style>
  body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #0b1020; color: #e2e8f0; }
  .slide { min-height: 100vh; padding: 64px 10%; box-sizing: border-box; border-bottom: 1px solid #1e293b; display: flex; flex-direction: column; justify-content: center; }
  h1 { font-size: 2.6rem; margin: 0 0 12px; color: #38bdf8; }
  h2 { font-size: 1.8rem; margin: 0 0 16px; color: #a7f3d0; }
  .pill { display: inline-block; padding: 4px 12px; border-radius: 999px; background: #1e293b; border: 1px solid #334155; font-size: 0.85rem; margin-right: 8px; }
  ul { line-height: 1.8; font-size: 1.05rem; }
  table { border-collapse: collapse; width: 100%; margin-top: 16px; }
  th, td { border: 1px solid #334155; padding: 10px; text-align: left; font-size: 0.95rem; }
  th { background: #1e293b; }
</style>
</head>
<body>
  <section class="slide">
    <div><span class="pill">Client Handover</span><span class="pill">${state.platforms.join(' · ')}</span></div>
    <h1>${title.replace(/</g, '&lt;')}</h1>
    <p>Prepared for ${clientName.replace(/</g, '&lt;')} · Delivered via Kodia Universal App Builder Engine</p>
  </section>
  <section class="slide">
    <h2>Architecture &amp; Technology Stack</h2>
    <ul>
      <li><strong>Style:</strong> ${stack?.architectureStyle ?? 'modular_monolith'}</li>
      <li><strong>Frontend:</strong> ${(stack?.frontend ?? 'Configured per project').replace(/</g, '&lt;')}</li>
      <li><strong>Backend:</strong> ${(stack?.backend ?? 'Configured per project').replace(/</g, '&lt;')}</li>
      <li><strong>Database:</strong> ${(stack?.database ?? 'Configured per project').replace(/</g, '&lt;')}</li>
    </ul>
  </section>
  <section class="slide">
    <h2>Truthful Verification &amp; Reliability Summary</h2>
    <p>${(rel?.summary ?? 'Verification pending.').replace(/</g, '&lt;')}</p>
    <table>
      <thead><tr><th>Verification Pillar</th><th>Status</th><th>Detail</th></tr></thead>
      <tbody>
        ${(rel?.pillars ?? []).map(p => `<tr><td>${p.label.replace(/</g, '&lt;')}</td><td>${p.status}</td><td>${p.detail.replace(/</g, '&lt;')}</td></tr>`).join('')}
      </tbody>
    </table>
  </section>
  <section class="slide">
    <h2>Handover &amp; Next Steps</h2>
    <ul>
      <li>See <code>PRODUCT_ARCHITECTURE.md</code> for system architecture and requirement traceability.</li>
      <li>See <code>INSTALL_AND_OPERATIONS.md</code> and <code>.env.example</code> for credential setup (zero secrets bundled).</li>
      <li>See <code>VERIFICATION_REPORT.md</code> for executed test results and known limitations.</li>
    </ul>
  </section>
</body>
</html>`);

	const manifest = clean(JSON.stringify({
		projectTitle: title,
		clientName,
		generatedAt: new Date().toISOString(),
		platforms: state.platforms,
		overallReliabilityStatus: rel?.overallStatus ?? 'partially_verified',
		secretsBundled: false,
		files: ['PRODUCT_ARCHITECTURE.md', 'INSTALL_AND_OPERATIONS.md', 'VERIFICATION_REPORT.md', 'CLIENT_PRESENTATION.html', '.env.example'],
	}, null, 2));

	return {
		files: {
			'PRODUCT_ARCHITECTURE.md': productArchMd,
			'INSTALL_AND_OPERATIONS.md': installOpsMd,
			'VERIFICATION_REPORT.md': verificationMd,
			'CLIENT_PRESENTATION.html': presentationHtml,
			'.env.example': envTemplate,
			'handover-manifest.json': manifest,
		},
		redactions: totalRedactions,
	};
}

// ── Concise LLM Formatters ─────────────────────────────────────────────────────────────

export function formatContractAnalysisForLLM(a: UabeContractAnalysis): string {
	return [
		`## UABE Contract-to-Product Analysis — "${a.projectTitle}"`,
		`- **Source:** ${a.sourceType} | **Platforms:** ${a.detectedPlatforms.join(', ')} | **Roles:** ${a.userRoles.join(', ')}`,
		`- **Requirements (${a.requirements.length}):**`,
		...a.requirements.slice(0, 12).map(r => `  - [${r.id}][${r.category}] ${r.title} (${r.status})`),
		a.ambiguities.length ? `- **Ambiguities to Clarify:** ${a.ambiguities.join('; ')}` : '',
	].filter(Boolean).join('\n');
}

export function formatIntegrationsForLLM(reqs: readonly IrireExternalRequirement[]): string {
	if (reqs.length === 0) return 'IRIRE: No external third-party credentials required for this project.';
	return [
		`## IRIRE External Requirements & Integration Readiness (${reqs.length})`,
		...reqs.map(r => `- **${r.providerName}** (\`${r.envVarName}\`, ${r.classification}, mode: \`${r.mode}\`, configured: ${r.configured ? 'YES' : 'NO'})\n  - Why: ${r.reason}\n  - Official signup: ${r.officialSignupUrl || 'N/A'} | Docs: ${r.officialDocsUrl || 'N/A'}\n  - Billing: ${r.billingRequirement}`),
	].join('\n');
}

export function formatReliabilityDashboardForLLM(r: UabeReliabilityDashboardReport): string {
	return [
		`## UABE Honest Application Reliability Report — \`${r.overallStatus}\``,
		`- ${r.summary}`,
		...r.pillars.map(p => `  - [${p.status.toUpperCase()}] ${p.label}: ${p.detail}`),
		r.unverifiedFeatures.length ? `- **Unverified / Blocked:**\n${r.unverifiedFeatures.map(u => `  - ${u}`).join('\n')}` : '',
	].filter(Boolean).join('\n');
}
