/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

export interface LiveWebSearchEntry {
	readonly query: string;
	readonly results: ReadonlyArray<{
		readonly title: string;
		readonly url: string;
		readonly snippet?: string;
		readonly publishedDate?: string;
	}>;
}

export interface MandatoryWebQueryPlan {
	readonly shouldAutoSearch: boolean;
	readonly queries: string[];
	readonly matchedTopics: string[];
}

const TRIVIAL_NON_TECHNICAL_RE = /^(?:hi|hello|hey|thanks|thank\s+you|ok|okay|yes|no|sure|cool|great|continue|go\s+ahead|proceed|looks\s+good|done|stop|cancel)[.!?\s]*$/i;

const TECHNICAL_ACTION_RE = /\b(build|create|develop|make|implement|setup|set\s+up|install|upgrade|update|migrate|integrate|connect|configure|scaffold|architect|design|redesign|polish|fix|debug|refactor|deploy|optimize|compare|research|latest|newest|current|updated|modern|best\s+practices?|version|docs|documentation|api|sdk|library|package|framework|database|model|endpoint|auth|payment|stream|sse|webhook|cli)\b/i;

// Curated technology/framework/SDK/provider patterns -> canonical search label
const TECH_TOPICS: ReadonlyArray<{ pattern: RegExp; label: string; group: 'ai' | 'stack' }> = [
	// AI & LLM providers / SDKs
	{ pattern: /\bnvidia(?:\s+nim)?|nemotron\b/i, label: 'NVIDIA NIM API models', group: 'ai' },
	{ pattern: /\bgroq\b/i, label: 'Groq API models SDK', group: 'ai' },
	{ pattern: /\bopenrouter\b/i, label: 'OpenRouter API free models', group: 'ai' },
	{ pattern: /\bcloudflare(?:\s+workers?\s*ai)?|@cf\//i, label: 'Cloudflare Workers AI OpenAI compatible models', group: 'ai' },
	{ pattern: /\bopenai(?:\s+sdk)?|gpt-?[456]/i, label: 'OpenAI Node SDK API', group: 'ai' },
	{ pattern: /\banthropic|claude\b/i, label: 'Anthropic Claude SDK models', group: 'ai' },
	{ pattern: /\bgemini|@google\/genai\b/i, label: 'Google Gemini GenAI SDK models', group: 'ai' },
	{ pattern: /\bollama\b/i, label: 'Ollama API SDK', group: 'ai' },
	{ pattern: /\blangchain|langgraph\b/i, label: 'LangChain JS TypeScript', group: 'ai' },
	{ pattern: /\bvercel\s+ai\s+sdk|\bai\s+sdk\b/i, label: 'Vercel AI SDK', group: 'ai' },
	{ pattern: /\bmcp\b|model\s+context\s+protocol/i, label: 'Model Context Protocol MCP SDK', group: 'ai' },

	// Frontend / UI / CSS / Frameworks
	{ pattern: /\btailwind(?:\s*css)?\b/i, label: 'Tailwind CSS', group: 'stack' },
	{ pattern: /\bnext\.?js\b/i, label: 'Next.js', group: 'stack' },
	{ pattern: /\breact\s*19|\breact\b/i, label: 'React', group: 'stack' },
	{ pattern: /\bvite\b/i, label: 'Vite', group: 'stack' },
	{ pattern: /\bshadcn(?:\/ui)?\b/i, label: 'shadcn/ui', group: 'stack' },
	{ pattern: /\bvue\.?js|\bnuxt\b/i, label: 'Vue Nuxt', group: 'stack' },
	{ pattern: /\bsvelte(?:kit)?\b/i, label: 'SvelteKit', group: 'stack' },
	{ pattern: /\bastro\b/i, label: 'Astro', group: 'stack' },
	{ pattern: /\bflutter\b/i, label: 'Flutter', group: 'stack' },
	{ pattern: /\breact\s+native|\bexpo\b/i, label: 'Expo React Native', group: 'stack' },
	{ pattern: /\belectron\b/i, label: 'Electron', group: 'stack' },
	{ pattern: /\btauri\b/i, label: 'Tauri', group: 'stack' },
	{ pattern: /\bstreamlit\b/i, label: 'Streamlit', group: 'stack' },

	// Backend / DB / Auth / Infra
	{ pattern: /\bexpress(?:\.js)?\b/i, label: 'Express.js', group: 'stack' },
	{ pattern: /\bhono\b/i, label: 'Hono', group: 'stack' },
	{ pattern: /\bfastify\b/i, label: 'Fastify', group: 'stack' },
	{ pattern: /\bnest\.?js\b/i, label: 'NestJS', group: 'stack' },
	{ pattern: /\bfastapi\b/i, label: 'FastAPI Python', group: 'stack' },
	{ pattern: /\bdjango\b/i, label: 'Django', group: 'stack' },
	{ pattern: /\blaravel\b/i, label: 'Laravel PHP', group: 'stack' },
	{ pattern: /\bspring\s*boot\b/i, label: 'Spring Boot', group: 'stack' },
	{ pattern: /\bprisma\b/i, label: 'Prisma ORM', group: 'stack' },
	{ pattern: /\bdrizzle\b/i, label: 'Drizzle ORM', group: 'stack' },
	{ pattern: /\bbetter-sqlite3|sqlite\b/i, label: 'better-sqlite3 Node SQLite', group: 'stack' },
	{ pattern: /\bsupabase\b/i, label: 'Supabase SDK', group: 'stack' },
	{ pattern: /\bfirebase\b/i, label: 'Firebase SDK', group: 'stack' },
	{ pattern: /\bstripe\b/i, label: 'Stripe SDK API', group: 'stack' },
	{ pattern: /\bclerk\b/i, label: 'Clerk Auth SDK', group: 'stack' },
	{ pattern: /\bauth0\b/i, label: 'Auth0 SDK', group: 'stack' },
	{ pattern: /\bplaywright\b/i, label: 'Playwright', group: 'stack' },
	{ pattern: /\btanstack\b/i, label: 'TanStack Query Router', group: 'stack' },
	{ pattern: /\bzod\b/i, label: 'Zod TypeScript', group: 'stack' },
	{ pattern: /\bdocker|kubernetes\b/i, label: 'Docker Compose', group: 'stack' },
	{ pattern: /\btypescript\b/i, label: 'TypeScript', group: 'stack' },
];

/**
 * Generates 1-2 focused, year-stamped web search queries so Kodia ALWAYS grounds
 * coding, build, architecture, API, SDK, and debugging turns in live up-to-date docs.
 */
export function buildMandatoryLiveWebQueries(userText: string, currentYear: number = new Date().getFullYear()): MandatoryWebQueryPlan {
	const cleaned = (userText || '').trim();
	if (cleaned.length < 12 || TRIVIAL_NON_TECHNICAL_RE.test(cleaned)) {
		return { shouldAutoSearch: false, queries: [], matchedTopics: [] };
	}

	const aiTopics: string[] = [];
	const stackTopics: string[] = [];
	for (const entry of TECH_TOPICS) {
		if (entry.pattern.test(cleaned)) {
			if (entry.group === 'ai') aiTopics.push(entry.label);
			else stackTopics.push(entry.label);
		}
	}

	// Also pick up explicit scoped npm packages (e.g. @tanstack/react-query, @tailwindcss/vite)
	const scopedPkgs = [...cleaned.matchAll(/@[a-z0-9-]+\/[a-z0-9._-]+/gi)]
		.map(m => m[0])
		.filter(p => !p.startsWith('@cf/'))
		.slice(0, 3);
	for (const pkg of scopedPkgs) {
		if (!stackTopics.includes(pkg)) stackTopics.push(pkg);
	}

	const matchedTopics = [...aiTopics, ...stackTopics];
	const asksForLatestOrTechnical = TECHNICAL_ACTION_RE.test(cleaned);
	const explicitlyAsksSearch = /\b(search|web\s*search|look\s*up|latest|newest|current|updated|2025|2026|2027|docs|documentation|changelog|release)\b/i.test(cleaned);

	if (matchedTopics.length === 0 && !explicitlyAsksSearch) {
		return { shouldAutoSearch: false, queries: [], matchedTopics: [] };
	}
	if (!asksForLatestOrTechnical && matchedTopics.length === 0) {
		return { shouldAutoSearch: false, queries: [], matchedTopics: [] };
	}

	const queries: string[] = [];
	if (aiTopics.length > 0) {
		queries.push(`${aiTopics.slice(0, 3).join(' ')} latest active models API documentation ${currentYear}`);
	}
	if (stackTopics.length > 0) {
		queries.push(`${stackTopics.slice(0, 4).join(' ')} latest stable version setup guide breaking changes ${currentYear}`);
	}
	if (queries.length === 0 && explicitlyAsksSearch) {
		const snippet = cleaned.replace(/\s+/g, ' ').slice(0, 120);
		queries.push(`${snippet} latest documentation ${currentYear}`);
	}

	return {
		shouldAutoSearch: queries.length > 0,
		queries: queries.slice(0, 2),
		matchedTopics,
	};
}

const MANIFEST_OR_CONFIG_FILE_RE = /(?:^|[\\/])(package\.json|requirements\.txt|pyproject\.toml|cargo\.toml|composer\.json|go\.mod|pubspec\.yaml|tailwind\.config\.[cm]?[jt]s|postcss\.config\.[cm]?[jt]s|vite\.config\.[cm]?[jt]s|next\.config\.[cm]?[jt]s|tsconfig\.json)$/i;

/**
 * Mid-turn freshness check: if the agent starts writing a manifest/config/SDK integration
 * or running package installation without having performed any web search yet this turn,
 * synthesize a targeted live search query for the detected packages/technologies.
 */
export function extractMidTurnWebVerificationQuery(
	toolName: string,
	rawParams: Record<string, unknown>,
	currentYear: number = new Date().getFullYear(),
): string | null {
	if (toolName === 'run_command' || toolName === 'run_persistent_command' || toolName === 'dep_install') {
		const cmd = String(rawParams.command ?? rawParams.packages ?? '');
		const installMatch = /\b(?:npm|pnpm|yarn|bun)\s+(?:install|add|i)\s+([^\n;&|]+)/i.exec(cmd)
			?? /\bpip3?\s+install\s+([^\n;&|]+)/i.exec(cmd);
		if (installMatch) {
			const pkgs = installMatch[1]
				.split(/\s+/)
				.filter(tok => tok && !tok.startsWith('-') && !tok.startsWith('.'))
				.map(tok => tok.replace(/@[\d^~*x].*$/, ''))
				.slice(0, 5);
			if (pkgs.length > 0) {
				return `${pkgs.join(' ')} latest stable version setup breaking changes ${currentYear}`;
			}
		}
		return null;
	}

	if (toolName === 'write_file' || toolName === 'rewrite_file' || toolName === 'edit_file') {
		const uri = String(rawParams.uri ?? rawParams.path ?? rawParams.file_path ?? '');
		const body = String(rawParams.new_content ?? rawParams.content ?? rawParams.search_replace_blocks ?? '');
		const isManifestOrConfig = MANIFEST_OR_CONFIG_FILE_RE.test(uri);

		// Extract technologies referenced in the written file
		const found: string[] = [];
		for (const entry of TECH_TOPICS) {
			if (entry.pattern.test(uri) || entry.pattern.test(body)) {
				if (!found.includes(entry.label)) found.push(entry.label);
				if (found.length >= 4) break;
			}
		}

		if (isManifestOrConfig && found.length > 0) {
			return `${found.join(' ')} latest stable version config documentation ${currentYear}`;
		}
		if (found.some(label => /SDK|API|models|Tailwind|Next\.js|Prisma|Drizzle/i.test(label))) {
			return `${found.slice(0, 3).join(' ')} latest API syntax documentation ${currentYear}`;
		}
	}

	return null;
}

/**
 * Formats live pre-fetched or mid-turn web search results into a concise, high-signal
 * grounding directive for the LLM.
 */
export function formatAutoWebSearchResultsForLLM(
	searches: ReadonlyArray<LiveWebSearchEntry>,
	todayIsoDate: string = new Date().toISOString().slice(0, 10),
): string {
	const nonEmpty = searches.filter(s => s.results.length > 0);
	if (nonEmpty.length === 0) return '';

	const year = todayIsoDate.slice(0, 4);
	const lines: string[] = [
		`=== KODIA MANDATORY LIVE WEB SEARCH GROUNDING (FETCHED ${todayIsoDate}) ===`,
		`CRITICAL: Today is ${todayIsoDate}. Your training memory is OUTDATED. Use the live ${year} web results below as ground truth, and call \`web_search\` / \`fetch_url\` BEFORE writing code for any additional package, SDK, framework config, API endpoint, or error.`,
	];

	for (const s of nonEmpty) {
		lines.push(`\nQuery: "${s.query}"`);
		for (const r of s.results.slice(0, 5)) {
			const dateStr = r.publishedDate ? ` (${r.publishedDate})` : '';
			const snippet = (r.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 260);
			lines.push(`- ${r.title}${dateStr} — ${r.url}${snippet ? `\n  ${snippet}` : ''}`);
		}
	}

	return lines.join('\n');
}
