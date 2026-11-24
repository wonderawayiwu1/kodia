/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import {
	DEFAULT_LEI_FRESHNESS_POLICIES,
	FreshnessCategory,
	LeiDependencyReport,
	LeiDiscoveredModel,
	LeiDomain,
	LeiEvidenceConflict,
	LeiEvidenceRecord,
	LeiFailureDiagnosisReport,
	LeiFreshnessAssessment,
	LeiFreshnessPolicies,
	LeiKnowledgeFreshness,
	LeiModelDiscoveryReport,
	LeiModelTaskRequirements,
	LeiModelVerificationReport,
	LeiResearchResult,
	LeiSecurityAuditReport,
	LeiSourceReference,
	LeiSourceTier,
	LeiVerificationStatus,
} from './liveIntelligenceTypes.js';

// ── Authoritative Domain Registry (Examples, never a closed list — Part 5.1) ──────────

interface DomainAuthorityRule {
	readonly pattern: RegExp;
	readonly tier: LeiSourceTier;
	readonly label: string;
	readonly score: number;
}

const AUTHORITY_RULES: readonly DomainAuthorityRule[] = [
	// Tier 1-4: Official vendor docs, API references, model cards, release notes
	{ pattern: /^(docs\.api\.nvidia\.com|build\.nvidia\.com|developer\.nvidia\.com)$/i, tier: 1, label: 'Official NVIDIA documentation', score: 98 },
	{ pattern: /^(platform\.openai\.com|developers\.openai\.com|openai\.com)$/i, tier: 1, label: 'Official OpenAI documentation', score: 98 },
	{ pattern: /^(docs\.anthropic\.com|docs\.claude\.com|anthropic\.com)$/i, tier: 1, label: 'Official Anthropic documentation', score: 98 },
	{ pattern: /^(ai\.google\.dev|cloud\.google\.com|firebase\.google\.com|developer\.android\.com)$/i, tier: 1, label: 'Official Google / Android documentation', score: 98 },
	{ pattern: /^(developer\.apple\.com|swift\.org)$/i, tier: 1, label: 'Official Apple / Swift documentation', score: 98 },
	{ pattern: /^(docs\.mistral\.ai|console\.groq\.com|api-docs\.deepseek\.com|docs\.x\.ai|openrouter\.ai)$/i, tier: 2, label: 'Official AI provider API reference', score: 96 },
	{ pattern: /^(react\.dev|nextjs\.org|vuejs\.org|nuxt\.com|angular\.dev|svelte\.dev|astro\.build|nodejs\.org|typescriptlang\.org|python\.org|docs\.python\.org)$/i, tier: 1, label: 'Official language/framework documentation', score: 97 },
	{ pattern: /^(fastapi\.tiangolo\.com|docs\.djangoproject\.com|flask\.palletsprojects\.com|laravel\.com|symfony\.com|spring\.io|kotlinlang\.org|docs\.flutter\.dev|reactnative\.dev|docs\.expo\.dev|learn\.microsoft\.com|go\.dev|doc\.rust-lang\.org|expressjs\.com|docs\.nestjs\.com|fastify\.dev)$/i, tier: 1, label: 'Official framework documentation', score: 97 },
	{ pattern: /^(docs\.stripe\.com|developer\.paypal\.com|docs\.aws\.amazon\.com|supabase\.com|developers\.cloudflare\.com|docs\.github\.com|docs\.docker\.com|kubernetes\.io|developer\.hashicorp\.com|www\.postgresql\.org|dev\.mysql\.com|www\.mongodb\.com|www\.sqlite\.org|redis\.io|www\.prisma\.io|orm\.drizzle\.team)$/i, tier: 2, label: 'Official platform / API documentation', score: 96 },
	{ pattern: /^(huggingface\.co)$/i, tier: 4, label: 'Official Hugging Face model hub', score: 90 },
	// Tier 5: Official GitHub repositories & releases
	{ pattern: /^(api\.github\.com|github\.com|raw\.githubusercontent\.com)$/i, tier: 5, label: 'Official GitHub repository / releases', score: 88 },
	// Tier 6: Official package registries
	{ pattern: /^(registry\.npmjs\.org|www\.npmjs\.com|npmjs\.com)$/i, tier: 6, label: 'Official npm registry', score: 93 },
	{ pattern: /^(pypi\.org)$/i, tier: 6, label: 'Official PyPI registry', score: 93 },
	{ pattern: /^(pub\.dev)$/i, tier: 6, label: 'Official pub.dev registry', score: 93 },
	{ pattern: /^(crates\.io)$/i, tier: 6, label: 'Official crates.io registry', score: 93 },
	{ pattern: /^(repo\.packagist\.org|packagist\.org|central\.sonatype\.com|search\.maven\.org|api\.nuget\.org|www\.nuget\.org)$/i, tier: 6, label: 'Official package registry', score: 92 },
	// Tier 7: Official security advisories
	{ pattern: /^(api\.osv\.dev|osv\.dev|nvd\.nist\.gov|cve\.mitre\.org|www\.cve\.org|owasp\.org|cisa\.gov)$/i, tier: 7, label: 'Official security advisory', score: 97 },
	// Tier 8: Standards organizations
	{ pattern: /^(www\.w3\.org|w3\.org|datatracker\.ietf\.org|www\.rfc-editor\.org|tc39\.es|ecma-international\.org)$/i, tier: 8, label: 'Standards organization', score: 95 },
	// Tier 10: Reputable technical publications
	{ pattern: /^(developer\.mozilla\.org|web\.dev|infoq\.com|lwn\.net|martinfowler\.com)$/i, tier: 10, label: 'Reputable technical reference', score: 84 },
	// Tier 12: Community discussions
	{ pattern: /^(stackoverflow\.com|reddit\.com|www\.reddit\.com|news\.ycombinator\.com|dev\.to|medium\.com)$/i, tier: 12, label: 'Community discussion', score: 45 },
];

export function extractDomain(url: string): string {
	try {
		return new URL(url).hostname.toLowerCase();
	} catch {
		return '';
	}
}

export function scoreSourceCredibility(url: string, title = ''): { tier: LeiSourceTier; authorityLabel: string; authorityScore: number } {
	const domain = extractDomain(url);
	if (!domain) {
		return { tier: 12, authorityLabel: 'Unknown source', authorityScore: 20 };
	}

	for (const rule of AUTHORITY_RULES) {
		if (rule.pattern.test(domain)) {
			// Boost release notes / official docs paths slightly
			const isReleaseOrApi = /\/(releases|changelog|deprecat|api|docs|modelcard|models)\b/i.test(url);
			return {
				tier: rule.tier,
				authorityLabel: rule.label,
				authorityScore: Math.min(100, rule.score + (isReleaseOrApi ? 1 : 0)),
			};
		}
	}

	// Dynamic discovery for official docs of technologies not in the example list
	if (/^(docs|developer|developers|api|reference|learn)\./i.test(domain)) {
		return { tier: 1, authorityLabel: `Official vendor docs (${domain})`, authorityScore: 90 };
	}
	if (/\/(docs|documentation|api-reference|changelog|releases)\b/i.test(url) && !/medium\.com|dev\.to|blog\./i.test(domain)) {
		return { tier: 2, authorityLabel: `Vendor documentation (${domain})`, authorityScore: 82 };
	}
	if (/security|advisory|cve|ghsa/i.test(url) || /security advisory/i.test(title)) {
		return { tier: 7, authorityLabel: `Security advisory (${domain})`, authorityScore: 80 };
	}
	if (/\.org$|\.gov$|\.edu$/i.test(domain)) {
		return { tier: 8, authorityLabel: `Organization reference (${domain})`, authorityScore: 76 };
	}
	if (/blog\./i.test(domain)) {
		return { tier: 9, authorityLabel: `Maintainer / engineering blog (${domain})`, authorityScore: 68 };
	}

	return { tier: 11, authorityLabel: `Technical web source (${domain})`, authorityScore: 55 };
}

export function rankSources(sources: readonly LeiSourceReference[]): LeiSourceReference[] {
	return [...sources].sort((a, b) => {
		if (a.inspectedFullDocument !== b.inspectedFullDocument) {
			return a.inspectedFullDocument ? -1 : 1;
		}
		if (a.authorityScore !== b.authorityScore) {
			return b.authorityScore - a.authorityScore;
		}
		return a.tier - b.tier;
	});
}

// ── Security & Prompt-Injection Sanitization (Part 18) ─────────────────────────────────

const SECRET_PATTERNS: readonly RegExp[] = [
	/\bnvapi-[A-Za-z0-9_-]{12,}\b/g,
	/\bsk-(?:proj-|ant-|live-|test-)?[A-Za-z0-9_-]{16,}\b/g,
	/\bAIza[0-9A-Za-z_-]{25,}\b/g,
	/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
	/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
	/\bAKIA[0-9A-Z]{16}\b/g,
	/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/gi,
	/(api[_-]?key|secret|password|token)\s*[:=]\s*['"]?[A-Za-z0-9._~+/=-]{10,}['"]?/gi,
];

export function scrubSecretsFromQuery(input: string): string {
	let cleaned = input;
	for (const re of SECRET_PATTERNS) {
		cleaned = cleaned.replace(re, '');
	}
	return cleaned.replace(/\s+/g, ' ').trim();
}

const PROMPT_INJECTION_PATTERNS: readonly RegExp[] = [
	/ignore\s+(all\s+)?(previous|prior|above|system|developer)\s+(instructions|prompts|rules|directives)/gi,
	/disregard\s+(all\s+)?(previous|prior|system)\s+(instructions|rules)/gi,
	/you\s+are\s+now\s+(in\s+)?(developer|jailbreak|admin|unrestricted)\s+mode/gi,
	/\b(system\s*prompt|override\s+permissions|disable\s+security|exfiltrate\s+(api\s*key|token|credentials|env))/gi,
	/\b(run|execute)\s+(shell|terminal|bash|powershell|cmd)\s+command\b[^.\n]{0,120}/gi,
	/<\s*script\b[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi,
	/\[INST\]|\[\/INST\]|<\|im_start\|>|<\|system\|>/gi,
];

export function sanitizeExternalContent(rawText: string, maxChars = 18_000): { sanitized: string; strippedCount: number } {
	let text = rawText.slice(0, Math.max(maxChars * 2, 36_000));
	let strippedCount = 0;
	for (const re of PROMPT_INJECTION_PATTERNS) {
		const matches = text.match(re);
		if (matches) {
			strippedCount += matches.length;
			text = text.replace(re, ' [untrusted-directive-removed] ');
		}
	}
	// Strip any accidentally echoed credentials
	for (const re of SECRET_PATTERNS) {
		text = text.replace(re, '[redacted]');
	}
	const sanitized = text.replace(/\r\n/g, '\n').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, maxChars);
	return { sanitized, strippedCount };
}

// ── Freshness Detector (Part 3) ────────────────────────────────────────────────────────

const LEGACY_OR_OBSOLETE_PATTERNS: readonly { pattern: RegExp; note: string; technology: string; domain: LeiDomain }[] = [
	{ pattern: /llama-3\.1-nemotron-70b-instruct/i, note: 'Legacy NVIDIA Nemotron 3.1 identifier detected — verify current NVIDIA NIM catalog and replacement models', technology: 'nvidia', domain: 'ai_models' },
	{ pattern: /nemotron-4-340b|llama-3-70b-instruct|mixtral-8x7b/i, note: 'Older hosted LLM identifier detected — verify current availability and deprecation status', technology: 'ai-models', domain: 'ai_models' },
	{ pattern: /text-davinci|code-davinci|gpt-3\.5-turbo-0301|gpt-4-0314|gpt-4-vision-preview/i, note: 'Deprecated OpenAI model identifier detected', technology: 'openai', domain: 'model_deprecation' },
	{ pattern: /claude-2(\.0|\.1)?\b|claude-instant-1|claude-3-sonnet-20240229/i, note: 'Retired or legacy Anthropic model identifier detected', technology: 'anthropic', domain: 'model_deprecation' },
	{ pattern: /gemini-pro\b|gemini-1\.0|gemini-1\.5-pro-001/i, note: 'Legacy Google Gemini identifier detected', technology: 'gemini', domain: 'model_deprecation' },
	{ pattern: /\/v1\/completions\b|openai\.ChatCompletion\.create\b/i, note: 'Legacy OpenAI v0/completions API pattern detected — verify current SDK/endpoint', technology: 'openai', domain: 'api_endpoints' },
	{ pattern: /expo\s*(sdk\s*)?(4[0-9]|50)\b|react-native\s*0\.6\d/i, note: 'Older React Native / Expo SDK version detected — verify current compatibility', technology: 'react-native', domain: 'mobile_platform' },
	{ pattern: /create-react-app|react-scripts/i, note: 'Deprecated Create React App toolchain detected — verify modern official recommendation', technology: 'react', domain: 'framework_releases' },
	{ pattern: /\b(moment|request|tslint|node-sass)\b/i, note: 'Deprecated or unmaintained npm package detected', technology: 'npm', domain: 'package_versions' },
];

const OFFICIAL_SEED_URLS: Readonly<Record<string, readonly string[]>> = {
	nvidia: ['https://docs.api.nvidia.com/nim/reference/llm-apis', 'https://build.nvidia.com/explore/discover'],
	openai: ['https://platform.openai.com/docs/models', 'https://platform.openai.com/docs/deprecations'],
	anthropic: ['https://docs.anthropic.com/en/docs/about-claude/models/overview'],
	gemini: ['https://ai.google.dev/gemini-api/docs/models', 'https://ai.google.dev/gemini-api/docs/deprecations'],
	groq: ['https://console.groq.com/docs/models'],
	mistral: ['https://docs.mistral.ai/getting-started/models/models_overview/'],
	deepseek: ['https://api-docs.deepseek.com/quick_start/pricing'],
	react: ['https://react.dev/versions'],
	nextjs: ['https://nextjs.org/docs'],
	'react-native': ['https://reactnative.dev/versions', 'https://docs.expo.dev/versions/latest/'],
	expo: ['https://docs.expo.dev/versions/latest/'],
	flutter: ['https://docs.flutter.dev/release/release-notes'],
	android: ['https://developer.android.com/build/releases/gradle-plugin'],
	ios: ['https://developer.apple.com/documentation/xcode-release-notes'],
	fastapi: ['https://fastapi.tiangolo.com/release-notes/'],
	django: ['https://docs.djangoproject.com/en/stable/releases/'],
	laravel: ['https://laravel.com/docs/releases'],
	nodejs: ['https://nodejs.org/en/about/previous-releases'],
	stripe: ['https://docs.stripe.com/upgrades'],
	supabase: ['https://supabase.com/docs'],
	firebase: ['https://firebase.google.com/support/releases'],
	postgresql: ['https://www.postgresql.org/support/versioning/'],
	prisma: ['https://www.prisma.io/docs'],
	owasp: ['https://owasp.org/www-project-top-ten/'],
};

export function getTtlForDomain(domain: LeiDomain, policies: LeiFreshnessPolicies = DEFAULT_LEI_FRESHNESS_POLICIES): number {
	switch (domain) {
		case 'ai_models': return policies.aiModelsTtlMs;
		case 'model_deprecation': return policies.modelDeprecationTtlMs;
		case 'package_versions': return policies.packageVersionsTtlMs;
		case 'security_advisories': return policies.securityAdvisoriesTtlMs;
		case 'framework_releases': return policies.frameworkReleasesTtlMs;
		case 'sdk_compatibility':
		case 'mobile_platform': return policies.sdkCompatibilityTtlMs;
		case 'api_endpoints': return policies.apiEndpointsTtlMs;
		case 'cloud_services':
		case 'database_infra': return policies.cloudServicesTtlMs;
		case 'stable_concepts': return 365 * 24 * 60 * 60 * 1000;
	}
}

export function normalizeTechnologyKey(topic: string, explicitTechnology?: string): string {
	const raw = (explicitTechnology || topic).toLowerCase();
	if (/nvidia|nemotron|nim\b/.test(raw)) return 'nvidia';
	if (/openai|gpt-|chatgpt/.test(raw)) return 'openai';
	if (/anthropic|claude/.test(raw)) return 'anthropic';
	if (/gemini|google ai/.test(raw)) return 'gemini';
	if (/groq/.test(raw)) return 'groq';
	if (/mistral/.test(raw)) return 'mistral';
	if (/deepseek/.test(raw)) return 'deepseek';
	if (/openrouter/.test(raw)) return 'openrouter';
	if (/ollama/.test(raw)) return 'ollama';
	if (/react[\s-]?native|expo/.test(raw)) return 'react-native';
	if (/next\.?js|nextjs/.test(raw)) return 'nextjs';
	if (/\breact\b/.test(raw)) return 'react';
	if (/flutter|dart/.test(raw)) return 'flutter';
	if (/android|kotlin|jetpack|gradle/.test(raw)) return 'android';
	if (/swift|xcode|\bios\b/.test(raw)) return 'ios';
	if (/fastapi/.test(raw)) return 'fastapi';
	if (/django/.test(raw)) return 'django';
	if (/laravel/.test(raw)) return 'laravel';
	if (/stripe/.test(raw)) return 'stripe';
	if (/supabase/.test(raw)) return 'supabase';
	if (/firebase/.test(raw)) return 'firebase';
	if (/postgres/.test(raw)) return 'postgresql';
	if (/prisma/.test(raw)) return 'prisma';
	if (/node\.?js/.test(raw)) return 'nodejs';
	const slug = raw.replace(/[^a-z0-9._/-]+/g, ' ').trim().split(/\s+/).slice(0, 3).join('-');
	return slug || 'general';
}

export function assessEngineeringFreshness(
	topic: string,
	options?: {
		technology?: string;
		currentVersionOrId?: string;
		existingEvidence?: LeiEvidenceRecord;
		policies?: LeiFreshnessPolicies;
		nowMs?: number;
	},
): LeiFreshnessAssessment {
	const nowMs = options?.nowMs ?? Date.now();
	const policies = options?.policies ?? DEFAULT_LEI_FRESHNESS_POLICIES;
	const combined = `${topic} ${options?.technology ?? ''} ${options?.currentVersionOrId ?? ''}`.trim();
	const lower = combined.toLowerCase();
	const technology = normalizeTechnologyKey(topic, options?.technology);

	const reasons: string[] = [];
	const detectedLegacySignals: string[] = [];

	for (const rule of LEGACY_OR_OBSOLETE_PATTERNS) {
		if (rule.pattern.test(combined)) {
			detectedLegacySignals.push(rule.note);
		}
	}

	// Determine category & domain
	let category: FreshnessCategory = 'A_stable';
	let domain: LeiDomain = 'stable_concepts';
	let riskLevel: LeiFreshnessAssessment['riskLevel'] = 'low';

	const isSecurityCritical = /\b(cve|vulnerability|advisory|security|owasp|oauth|oidc|jwt|crypto|encryption|tls|ssl|payment|stripe|paypal|pci|hipaa|gdpr|privacy|auth0|passkey|webauthn)\b/i.test(lower);
	const isAiVolatile = /\b(nvidia|nemotron|nim|openai|gpt-|anthropic|claude|gemini|groq|mistral|deepseek|qwen|llama|hugging\s*face|ollama|vllm|lm\s*studio|openrouter|model\s*(id|catalog|identifier|availability|deprecation|pricing|context|vision|tool\s*calling)|llm\s*provider)\b/i.test(lower);
	const isApiOrCloudVolatile = /\b(api\s*(endpoint|version|deprecated|migration|rate\s*limit)|webhook|cloud\s*service|aws|azure|gcp|cloudflare|supabase|firebase|vercel|netlify)\b/i.test(lower);
	const isMobileOrFrameworkVersion = /\b(react\s*native|expo|flutter|dart|android\s*(sdk|gradle|agp|permission)|xcode|ios\s*sdk|swift|next\.?js|react\s*\d|vue|nuxt|angular|svelte|astro|express|nestjs|fastify|django|fastapi|flask|laravel|symfony|spring\s*boot|prisma|drizzle|typeorm|postgresql|mysql|mongodb|redis|docker|kubernetes|terraform|node\.?js|python\s*3\.\d+|typescript\s*\d)\b/i.test(lower);
	const isDependencyQuery = /\b(npm|pypi|pub\.dev|crates\.io|packagist|maven|nuget|package|dependency|dependencies|install|upgrade|peer\s*dependenc|lockfile|deprecat|breaking\s*change|compatib|release\s*notes|latest\s*version|current\s*version)\b/i.test(lower);
	const isPureStableConcept = /\b(binary\s*search|quicksort|mergesort|dijkstra|big[\s-]o|hash\s*table|linked\s*list|red[\s-]black\s*tree|dynamic\s*programming|recursion|solid\s*principles|design\s*pattern|factory\s*pattern|observer\s*pattern|tcp\/ip|normalization|acid\s*properties|matrix\s*multiplication|fibonacci)\b/i.test(lower);

	if (isSecurityCritical) {
		category = 'D_critical';
		domain = 'security_advisories';
		riskLevel = 'critical';
		reasons.push('Security, authentication, cryptography, payment, or advisory topic requires authoritative verification (Category D).');
	} else if (isAiVolatile || detectedLegacySignals.some(s => /model|nemotron|openai|anthropic|gemini/i.test(s))) {
		category = 'C_rapidly_changing';
		domain = /deprecat|obsolete|retired|legacy/i.test(lower) ? 'model_deprecation' : 'ai_models';
		riskLevel = 'high';
		reasons.push('AI model catalogs, identifiers, capabilities, and provider endpoints change frequently (Category C).');
	} else if (isApiOrCloudVolatile) {
		category = 'C_rapidly_changing';
		domain = /aws|azure|gcp|cloud|vercel|netlify/i.test(lower) ? 'cloud_services' : 'api_endpoints';
		riskLevel = 'high';
		reasons.push('External API endpoints, SDK interfaces, and cloud services evolve rapidly (Category C).');
	} else if (isDependencyQuery) {
		category = 'B_version_sensitive';
		domain = 'package_versions';
		riskLevel = 'medium';
		reasons.push('Package versions, deprecations, licenses, and peer compatibility require registry verification (Category B).');
	} else if (isMobileOrFrameworkVersion) {
		category = 'B_version_sensitive';
		domain = /react\s*native|expo|flutter|android|xcode|ios|swift/i.test(lower) ? 'mobile_platform' : 'framework_releases';
		riskLevel = 'medium';
		reasons.push('Framework/SDK versions, build toolchains, and compatibility constraints are version-sensitive (Category B).');
	} else if (isPureStableConcept) {
		category = 'A_stable';
		domain = 'stable_concepts';
		riskLevel = 'low';
		reasons.push('Fundamental programming/CS concept is stable — live web research is not required (Category A).');
	} else if (options?.currentVersionOrId) {
		category = 'B_version_sensitive';
		domain = 'sdk_compatibility';
		riskLevel = 'medium';
		reasons.push(`Version/identifier "${options.currentVersionOrId}" specified — check current support and compatibility.`);
	} else {
		category = 'A_stable';
		domain = 'stable_concepts';
		riskLevel = 'low';
		reasons.push('General engineering topic with no volatile version/provider signals detected.');
	}

	if (detectedLegacySignals.length > 0) {
		riskLevel = category === 'D_critical' ? 'critical' : 'high';
		reasons.push(...detectedLegacySignals);
	}

	const recommendedTtlMs = getTtlForDomain(domain, policies);
	let cacheStatus: LeiFreshnessAssessment['cacheStatus'] = 'none';
	let lastVerifiedAt: number | undefined;

	if (options?.existingEvidence && !options.existingEvidence.invalidated) {
		lastVerifiedAt = options.existingEvidence.researchedAtMs;
		const ageMs = nowMs - lastVerifiedAt;
		const isVerifiedState = options.existingEvidence.verificationStatus === 'verified_official_docs'
			|| options.existingEvidence.verificationStatus === 'verified_official_api'
			|| options.existingEvidence.verificationStatus === 'cross_checked';
		if (!isVerifiedState || nowMs >= options.existingEvidence.expiresAtMs) {
			cacheStatus = 'expired';
			reasons.push('Cached evidence is expired or unverified — fresh research required.');
		} else if (ageMs > recommendedTtlMs * 0.75) {
			cacheStatus = 'stale';
			reasons.push('Cached evidence is nearing expiration — refresh recommended.');
		} else {
			cacheStatus = 'fresh';
		}
	}

	const needsLiveResearch = detectedLegacySignals.length > 0
		|| (category !== 'A_stable' && (cacheStatus === 'none' || cacheStatus === 'expired' || (category === 'D_critical' && cacheStatus !== 'fresh')));

	const recommendedOfficialUrls = [...(OFFICIAL_SEED_URLS[technology] ?? [])];
	const cleanTopic = scrubSecretsFromQuery(topic);
	const suggestedSearchQueries: string[] = [];
	if (needsLiveResearch) {
		if (technology === 'nvidia') {
			suggestedSearchQueries.push('NVIDIA NIM API available LLM models catalog docs.api.nvidia.com');
			if (options?.currentVersionOrId) {
				suggestedSearchQueries.push(`NVIDIA "${scrubSecretsFromQuery(options.currentVersionOrId)}" model deprecation replacement`);
			}
		} else {
			suggestedSearchQueries.push(`${cleanTopic} official documentation latest version release notes`);
			if (options?.currentVersionOrId) {
				suggestedSearchQueries.push(`${technology} ${scrubSecretsFromQuery(options.currentVersionOrId)} deprecation compatibility`);
			}
		}
	}

	return {
		topic: cleanTopic,
		technology,
		category,
		domain,
		needsLiveResearch,
		riskLevel,
		reasons,
		detectedLegacySignals,
		recommendedOfficialUrls,
		suggestedSearchQueries,
		cacheStatus,
		lastVerifiedAt,
		recommendedTtlMs,
	};
}

// ── Verification & Conflict Evaluation Engine (Part 8) ─────────────────────────────────

export function evaluateVerificationEvidence(params: {
	sources: readonly LeiSourceReference[];
	hasOfficialApiResponse?: boolean;
	conflicts?: readonly LeiEvidenceConflict[];
	isDeprecated?: boolean;
	isUnavailable?: boolean;
	isSuperseded?: boolean;
}): { status: LeiVerificationStatus; confidence: number } {
	const conflicts = params.conflicts ?? [];
	if (params.isUnavailable) {
		return { status: 'unavailable', confidence: 0 };
	}
	if (params.isSuperseded) {
		return { status: 'superseded', confidence: 0.9 };
	}
	if (params.isDeprecated) {
		return { status: 'deprecated', confidence: 0.92 };
	}
	if (conflicts.length > 0) {
		return { status: 'conflicting_sources', confidence: 0.45 };
	}

	const inspected = params.sources.filter(s => s.inspectedFullDocument);
	const officialInspected = inspected.filter(s => s.tier <= 7 && s.authorityScore >= 85);
	const uniqueOfficialDomains = new Set(officialInspected.map(s => s.domain));

	if (params.hasOfficialApiResponse && officialInspected.length >= 1) {
		return { status: 'cross_checked', confidence: 0.96 };
	}
	if (params.hasOfficialApiResponse) {
		return { status: 'verified_official_api', confidence: 0.93 };
	}
	if (uniqueOfficialDomains.size >= 2) {
		return { status: 'cross_checked', confidence: 0.92 };
	}
	if (officialInspected.length >= 1) {
		return { status: 'verified_official_docs', confidence: 0.88 };
	}
	if (inspected.length >= 1 || params.sources.some(s => s.tier <= 8)) {
		return { status: 'provisionally_verified', confidence: 0.6 };
	}
	return { status: 'unverified', confidence: 0.2 };
}

export function computeKnowledgeFreshness(
	evidence: readonly LeiEvidenceRecord[],
	activeOperationRunning: boolean,
	networkAvailable: boolean,
	nowMs = Date.now(),
): LeiKnowledgeFreshness {
	if (activeOperationRunning) return 'current_research';
	const active = evidence.filter(e => !e.invalidated);
	if (active.length === 0) {
		return networkAvailable ? 'unknown_freshness' : 'unknown_freshness';
	}
	let hasExpired = false;
	let hasStale = false;
	let newestAgeMs = Number.POSITIVE_INFINITY;
	for (const rec of active) {
		const age = nowMs - rec.researchedAtMs;
		if (age < newestAgeMs) newestAgeMs = age;
		if (nowMs >= rec.expiresAtMs) hasExpired = true;
		else if (age > rec.cachePolicyMs * 0.75) hasStale = true;
	}
	if (newestAgeMs < 15 * 60 * 1000 && !hasExpired) return 'current_research';
	if (hasExpired && newestAgeMs >= 60 * 60 * 1000) return 'expired_information';
	if (hasExpired) return 'refresh_recommended';
	if (hasStale) return 'stale_information';
	return 'fresh_verified_cache';
}

// ── Capability-Aware Model Selection (Parts 6.2 & 11 — Zero Hardcoded Defaults) ───────

export function inferCapabilitiesFromModelId(modelId: string): LeiDiscoveredModel['capabilities'] {
	const lower = modelId.toLowerCase();
	const vision = /(-vl\b|\bvl-|vision|omni|multimodal|gpt-4o|gpt-5|claude-3|claude-4|gemini|pixtral|llava|qwen.*vl|nemotron.*vl)/.test(lower);
	const audio = /(omni|audio|whisper|speech|voice|realtime)/.test(lower);
	const video = /(omni|nemotron-3\.5-super-vl|gemini-2|gemini-3)/.test(lower);
	const reasoning = /(reasoning|think|r1\b|o1\b|o3\b|o4\b|qwq|nemotron-3|nemotron-3\.5|opus|sonnet-4)/.test(lower);
	const embeddings = /(embed|bge-|e5-|rerank|nv-embed)/.test(lower);
	const coding = !embeddings && /(code|coder|codestral|starcoder|nemotron|claude|gpt-|gemini|deepseek|qwen|llama-3|mistral-large)/.test(lower);
	const toolCalling = !embeddings && !/gemma-2b|base\b|instruct-v0\.1|tiny/.test(lower);
	const structuredOutput = toolCalling;

	const inputModalities = ['text'];
	if (vision) inputModalities.push('image');
	if (video) inputModalities.push('video');
	if (audio) inputModalities.push('audio');

	return {
		coding,
		vision,
		video,
		audio,
		reasoning,
		toolCalling,
		structuredOutput,
		streaming: !embeddings,
		embeddings,
		inputModalities,
		outputModalities: embeddings ? ['embedding'] : ['text'],
	};
}

export function selectBestModelForTask(
	candidates: readonly LeiDiscoveredModel[],
	requirements: LeiModelTaskRequirements = {},
): { selected?: LeiDiscoveredModel; reason: string; preserveUserModel: boolean } {
	const active = candidates.filter(m => !m.deprecated && m.verificationStatus !== 'unavailable');
	if (active.length === 0) {
		return {
			selected: undefined,
			reason: 'No active, verified candidate models were available from discovery.',
			preserveUserModel: false,
		};
	}

	const requiresVision = requirements.requiresVision === true || requirements.taskType === 'vision';
	const requiresAudio = requirements.requiresAudio === true;
	const requiresToolCalling = requirements.requiresToolCalling === true || requirements.taskType === 'agentic' || requirements.taskType === 'coding';
	const requiresStructured = requirements.requiresStructuredOutput === true;
	const requiresReasoning = requirements.requiresReasoning === true || requirements.taskType === 'reasoning';
	const isEmbeddings = requirements.taskType === 'embeddings';

	const checkHardRequirements = (m: LeiDiscoveredModel): string[] => {
		const missing: string[] = [];
		if (isEmbeddings && !m.capabilities.embeddings) missing.push('embeddings');
		if (!isEmbeddings && m.capabilities.embeddings) missing.push('chat/text generation (embedding-only model)');
		if (requiresVision && !m.capabilities.vision) missing.push('vision/image input');
		if (requiresAudio && !m.capabilities.audio) missing.push('audio input');
		if (requiresToolCalling && m.capabilities.toolCalling === false) missing.push('tool calling');
		if (requiresStructured && m.capabilities.structuredOutput === false) missing.push('structured output');
		if (requirements.minContextWindow && m.capabilities.contextWindow && m.capabilities.contextWindow < requirements.minContextWindow) {
			missing.push(`context window >= ${requirements.minContextWindow}`);
		}
		return missing;
	};

	// Preserve user-selected model unless deprecated/unavailable/incompatible (Part 6.2)
	if (requirements.userSelectedModelId) {
		const userModel = active.find(m => m.modelId.toLowerCase() === requirements.userSelectedModelId!.toLowerCase());
		if (userModel) {
			const missing = checkHardRequirements(userModel);
			if (missing.length === 0) {
				return {
					selected: userModel,
					reason: `Preserved user-selected model "${userModel.modelId}" because it is active and satisfies all task requirements.`,
					preserveUserModel: true,
				};
			}
		}
	}

	const eligible = active.filter(m => checkHardRequirements(m).length === 0);
	const pool = eligible.length > 0 ? eligible : active;

	const scored = pool.map(m => {
		let score = 0;

		// Availability & verification fidelity
		if (m.availability.endpointTested && m.availability.endpointTestResult === 'passed') score += 35;
		else if (m.availability.accountAccessible === true) score += 25;
		else if (m.availability.publiclyListed) score += 15;
		else if (m.availability.documented) score += 10;

		if (m.verificationStatus === 'cross_checked' || m.verificationStatus === 'verified_official_api') score += 15;
		else if (m.verificationStatus === 'verified_official_docs') score += 10;

		// Capability matching (Part 6.2: do NOT pick a VL model automatically for text-only tasks!)
		if (requiresVision) {
			if (m.capabilities.vision) score += 45;
			else score -= 80;
		} else if (requirements.taskType === 'classification' || requirements.preferLowLatency) {
			// Prefer lighter/faster text models when vision is not requested
			if (m.capabilities.vision) score -= 8;
			if (/mini|flash|haiku|lightning|bolt|nano|8b|7b|4b|30b/i.test(m.modelId)) score += 22;
		} else if (!requiresVision && (requirements.taskType === 'coding' || requirements.taskType === 'chat' || requirements.taskType === 'general')) {
			// Slight preference for dedicated non-VL models on text-only tasks when equally strong
			if (m.capabilities.vision) score -= 4;
		}

		if (requiresReasoning && m.capabilities.reasoning) score += 25;
		if (requiresToolCalling && m.capabilities.toolCalling) score += 18;
		if (requiresStructured && m.capabilities.structuredOutput) score += 10;
		if (requirements.taskType === 'coding' && m.capabilities.coding) score += 20;

		if (m.capabilities.contextWindow) {
			if (requirements.taskType === 'long_context' && m.capabilities.contextWindow >= 256_000) score += 25;
			else if (m.capabilities.contextWindow >= 128_000) score += 10;
		}

		return { model: m, score };
	});

	scored.sort((a, b) => b.score - a.score);
	const best = scored[0]?.model;
	if (!best) {
		return { selected: undefined, reason: 'No suitable candidate model found.', preserveUserModel: false };
	}

	const capsList: string[] = [];
	if (best.capabilities.coding) capsList.push('coding');
	if (best.capabilities.vision) capsList.push('vision');
	if (best.capabilities.reasoning) capsList.push('reasoning');
	if (best.capabilities.toolCalling) capsList.push('tool calling');
	if (best.capabilities.contextWindow) capsList.push(`${Math.round(best.capabilities.contextWindow / 1000)}K context`);

	const accessNote = best.availability.endpointTested && best.availability.endpointTestResult === 'passed'
		? 'verified via live endpoint test'
		: best.availability.accountAccessible === true
			? 'verified accessible via provider API'
			: best.availability.publiclyListed
				? 'listed in official catalog'
				: 'documented in official provider docs';

	const unsatisfiedNote = eligible.length === 0
		? ` (warning: no candidate met all strict constraints: ${checkHardRequirements(best).join(', ')})`
		: '';

	return {
		selected: best,
		reason: `Selected "${best.modelId}" (${accessNote}; capabilities: ${capsList.join(', ') || 'text'}) for ${requirements.taskType ?? 'general'} workload${unsatisfiedNote}.`,
		preserveUserModel: false,
	};
}

// ── Document Fact Extractors (Date, Versions, Deprecations) ────────────────────────────

export function extractDocumentMetadata(text: string): {
	publishedOrUpdatedDate?: string;
	versions: string[];
	deprecationNotices: string[];
	findings: string[];
} {
	const dateMatch = text.match(/\b(202[4-9]-\d{2}-\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+202[4-9])\b/i);
	const versionMatches = [...new Set((text.match(/\bv?\d+\.\d+(?:\.\d+)?(?:-[a-z0-9.]+)?\b/gi) ?? []).slice(0, 12))];

	const lines = text.split(/\n+/).map(l => l.trim()).filter(l => l.length >= 20 && l.length <= 320);
	const deprecationNotices = lines
		.filter(l => /\b(deprecat|retired|end[- ]of[- ]life|eol|removed|superseded|replaced\s+by|sunset|migration)\b/i.test(l))
		.slice(0, 5);

	const findings = lines
		.filter(l => /\b(release|version|model|support|compatib|endpoint|context|vision|tool\s*call|security|cve|advisory|install|require)\b/i.test(l))
		.slice(0, 6);

	return {
		publishedOrUpdatedDate: dateMatch?.[1],
		versions: versionMatches,
		deprecationNotices,
		findings,
	};
}

// ── Concise LLM Tool Result Formatters ─────────────────────────────────────────────────

export function formatVerificationBadge(status: LeiVerificationStatus | 'not_applicable'): string {
	switch (status) {
		case 'verified_official_docs': return 'Verified (Official Documentation)';
		case 'verified_official_api': return 'Verified (Official API Response)';
		case 'cross_checked': return 'Cross-Checked (Multiple Authoritative Sources)';
		case 'provisionally_verified': return 'Provisionally Verified';
		case 'conflicting_sources': return 'Conflicting Sources';
		case 'unverified': return 'Unverified';
		case 'deprecated': return 'Deprecated';
		case 'unavailable': return 'Unavailable';
		case 'superseded': return 'Superseded';
		case 'not_applicable': return 'Not Applicable';
	}
}

export function formatFreshnessReportForLLM(a: LeiFreshnessAssessment): string {
	return [
		`## Live Engineering Intelligence — Freshness Assessment`,
		`- **Topic:** ${a.topic} (\`${a.technology}\`)`,
		`- **Category:** \`${a.category}\` | **Domain:** \`${a.domain}\` | **Risk:** \`${a.riskLevel}\``,
		`- **Live Research Required:** ${a.needsLiveResearch ? 'YES' : 'NO'} (Cache: \`${a.cacheStatus}\`)`,
		a.detectedLegacySignals.length ? `- **Legacy / Outdated Signals:**\n${a.detectedLegacySignals.map(s => `  - ${s}`).join('\n')}` : '',
		`- **Reasons:**\n${a.reasons.map(r => `  - ${r}`).join('\n')}`,
		a.recommendedOfficialUrls.length ? `- **Official Sources to Inspect:** ${a.recommendedOfficialUrls.join(', ')}` : '',
	].filter(Boolean).join('\n');
}

export function formatResearchResultForLLM(r: LeiResearchResult): string {
	const srcLines = r.sources.slice(0, 6).map(s =>
		`  - [${s.title || s.domain}](${s.url}) — ${s.authorityLabel} (score ${s.authorityScore}, ${s.inspectedFullDocument ? 'inspected full doc' : 'search result'}${s.lastUpdatedDate ? `, updated ${s.lastUpdatedDate}` : ''})`
	);
	const conflictLines = r.conflicts.map(c => `  - **${c.aspect}:** "${c.claimA}" (${c.sourceA}) vs "${c.claimB}" (${c.sourceB}) — ${c.resolutionHint}`);
	return [
		`## Live Engineering Intelligence — Research Report`,
		`- **Topic:** ${r.topic} (\`${r.technology}\`)`,
		`- **Verification:** ${formatVerificationBadge(r.verificationStatus)} | **Cache:** ${r.fromCache ? 'Fresh Verified Cache' : 'Live Research'} | **Duration:** ${r.durationMs}ms`,
		r.error ? `- **Error / Limitation:** ${r.error}` : '',
		`- **Summary:** ${r.summary}`,
		r.detectedVersions.length ? `- **Versions / Identifiers Observed:** ${r.detectedVersions.join(', ')}` : '',
		r.deprecationNotices.length ? `- **Deprecation Notices:**\n${r.deprecationNotices.map(d => `  - ${d}`).join('\n')}` : '',
		r.keyFindings.length ? `- **Key Findings:**\n${r.keyFindings.map(f => `  - ${f}`).join('\n')}` : '',
		r.recommendations.length ? `- **Recommendations:**\n${r.recommendations.map(rec => `  - ${rec}`).join('\n')}` : '',
		conflictLines.length ? `- **Conflicting Sources Detected:**\n${conflictLines.join('\n')}` : '',
		srcLines.length ? `- **Authoritative Sources:**\n${srcLines.join('\n')}` : '',
		r.evidence ? `- **Evidence ID:** \`${r.evidence.id}\` (recorded ${r.evidence.researchDate})` : '',
	].filter(Boolean).join('\n');
}

export function formatModelDiscoveryForLLM(r: LeiModelDiscoveryReport): string {
	const topModels = r.models.slice(0, 10).map(m => {
		const flags = [
			m.capabilities.coding ? 'code' : '',
			m.capabilities.vision ? 'vision' : '',
			m.capabilities.reasoning ? 'reasoning' : '',
			m.capabilities.toolCalling ? 'tools' : '',
			m.capabilities.contextWindow ? `${Math.round(m.capabilities.contextWindow / 1000)}K` : '',
		].filter(Boolean).join(', ');
		const access = m.availability.endpointTested ? `endpoint:${m.availability.endpointTestResult}` : m.availability.accountAccessible === true ? 'account-accessible' : m.availability.publiclyListed ? 'public-catalog' : 'documented';
		return `  - \`${m.modelId}\` [${flags || 'text'}] (${access}${m.deprecated ? ', DEPRECATED' : ''})`;
	});
	return [
		`## Live Engineering Intelligence — Model Discovery (${r.provider})`,
		`- **Verification:** ${formatVerificationBadge(r.verificationStatus)} | **Method:** \`${r.discoveryMethod}\``,
		r.error ? `- **Limitation / Error:** ${r.error}` : '',
		r.recommendedModel ? `- **Recommended Model:** \`${r.recommendedModel.modelId}\` — ${r.recommendationReason}` : `- **Recommendation:** ${r.recommendationReason}`,
		topModels.length ? `- **Discovered Models (${r.models.length} total):**\n${topModels.join('\n')}` : '',
		r.sources.length ? `- **Sources:** ${r.sources.map(s => `${s.authorityLabel} (${s.url})`).join('; ')}` : '',
		r.evidenceId ? `- **Evidence ID:** \`${r.evidenceId}\`` : '',
	].filter(Boolean).join('\n');
}

export function formatModelVerificationForLLM(r: LeiModelVerificationReport): string {
	return [
		`## Live Engineering Intelligence — Model Verification`,
		`- **Provider:** \`${r.provider}\` | **Model:** \`${r.requestedModelId}\``,
		`- **Verification:** ${formatVerificationBadge(r.verificationStatus)}`,
		`- **Current:** ${r.isCurrent ? 'Yes' : 'No'} | **Deprecated:** ${r.isDeprecated ? 'YES' : 'No'} | **Legacy Pattern:** ${r.isLegacyPattern ? 'YES' : 'No'}`,
		`- **Availability:** documented=${r.availability.documented}, publiclyListed=${r.availability.publiclyListed}, accountAccessible=${String(r.availability.accountAccessible)}, endpointTested=${r.availability.endpointTested}`,
		r.missingCapabilities.length ? `- **Missing Capabilities:** ${r.missingCapabilities.join(', ')}` : '',
		`- **Analysis:** ${r.explanation}`,
		r.recommendedAlternative ? `- **Recommended Alternative:** \`${r.recommendedAlternative.modelId}\` (${r.recommendedAlternative.verificationStatus})` : '',
		r.sources.length ? `- **Sources:** ${r.sources.map(s => s.url).join(', ')}` : '',
	].filter(Boolean).join('\n');
}

export function formatDependencyReportForLLM(r: LeiDependencyReport): string {
	return [
		`## Live Engineering Intelligence — Dependency Verification`,
		`- **Package:** \`${r.packageName}\` (\`${r.ecosystem}\`) | **Verification:** ${formatVerificationBadge(r.verificationStatus)}`,
		`- **Latest Version:** \`${r.latestVersion ?? 'unknown'}\`${r.currentProjectVersion ? ` | **Current in Project:** \`${r.currentProjectVersion}\`` : ''} | **Verdict:** \`${r.compatibilityVerdict}\``,
		r.deprecated ? `- **DEPRECATED:** ${r.deprecationMessage || 'Package marked deprecated in registry'}` : '',
		r.license ? `- **License:** ${r.license}${r.runtimeRequirement ? ` | **Runtime:** ${r.runtimeRequirement}` : ''}` : '',
		r.vulnerabilities.length ? `- **Known Vulnerabilities (${r.vulnerabilities.length}):**\n${r.vulnerabilities.slice(0, 5).map(v => `  - \`${v.id}\` (${v.severity}): ${v.summary}${v.fixedVersions.length ? ` [fix: ${v.fixedVersions.join(', ')}]` : ''}`).join('\n')}` : '- **Known Vulnerabilities:** 0 reported by OSV',
		r.installCommand ? `- **Verified Install Command:** \`${r.installCommand}\`` : '',
		r.notes.length ? `- **Notes:**\n${r.notes.map(n => `  - ${n}`).join('\n')}` : '',
		r.error ? `- **Error:** ${r.error}` : '',
	].filter(Boolean).join('\n');
}

export function formatSecurityAuditForLLM(r: LeiSecurityAuditReport): string {
	return [
		`## Live Engineering Intelligence — Security Advisory Check`,
		`- **Target:** \`${r.target}\`${r.version ? `@${r.version}` : ''} | **Verification:** ${formatVerificationBadge(r.verificationStatus)}`,
		`- **Advisories:** ${r.advisories.length} (Critical: ${r.criticalCount}, High: ${r.highCount}, Moderate: ${r.moderateCount}, Low: ${r.lowCount})`,
		r.advisories.length ? r.advisories.slice(0, 6).map(a => `  - \`${a.id}\` [${a.severity}]: ${a.summary} (${a.sourceUrl})${a.fixedVersions.length ? ` — fixed in ${a.fixedVersions.join(', ')}` : ''}`).join('\n') : '  - No matching advisories returned.',
		r.owaspGuidance.length ? `- **OWASP Guidance:**\n${r.owaspGuidance.map(g => `  - ${g}`).join('\n')}` : '',
		r.upgradeImpactNotes.length ? `- **Upgrade Impact Analysis:**\n${r.upgradeImpactNotes.map(n => `  - ${n}`).join('\n')}` : '',
		r.error ? `- **Error:** ${r.error}` : '',
	].filter(Boolean).join('\n');
}

export function formatFailureDiagnosisForLLM(r: LeiFailureDiagnosisReport): string {
	return [
		`## Live Engineering Intelligence — Failure Diagnosis`,
		`- **Technology:** \`${r.technology}\`${r.detectedVersion ? ` (${r.detectedVersion})` : ''} | **Outdated Info Likely:** ${r.likelyOutdatedCause ? 'YES' : 'Uncertain'}`,
		`- **Root Cause:** ${r.rootCauseSummary}`,
		`- **Recommended Fix:** ${r.recommendedFix}`,
		r.migrationSteps.length ? `- **Controlled Repair Steps:**\n${r.migrationSteps.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}` : '',
		formatResearchResultForLLM(r.research),
	].filter(Boolean).join('\n');
}
