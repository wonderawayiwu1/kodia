/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { SearchRequest, SearchResponse, SearchResult, SearchProviderSettings } from '../common/webSearchTypes.js';
import { WebSearchProvider } from './webSearchProvider.js';
import { WebSearchError } from './webSearchErrors.js';

const DDG_HTML_URL = 'https://html.duckduckgo.com/html/';
const DEFAULT_TIMEOUT_MS = 12_000;

function decodeHtmlEntities(input: string): string {
	return input
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, '\'')
		.replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)))
		.replace(/&#(\d+);/g, (_m, dec: string) => String.fromCharCode(Number(dec)))
		.replace(/<[^>]+>/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function unwrapDuckDuckGoUrl(rawHref: string): string {
	const cleaned = rawHref.replace(/&amp;/g, '&').trim();
	const withScheme = cleaned.startsWith('//') ? `https:${cleaned}` : cleaned;
	try {
		const parsed = new URL(withScheme);
		const uddg = parsed.searchParams.get('uddg');
		if (uddg && /^https?:\/\//i.test(uddg)) {
			return uddg;
		}
		return withScheme;
	} catch {
		return withScheme;
	}
}

/**
 * Zero-API-key DuckDuckGo HTML fallback provider so `web_search` and Kodia's automatic
 * live web grounding ALWAYS work even if no paid search API key is configured or a primary
 * search provider hits a transient rate limit.
 */
export class DuckDuckGoSearchMainService extends WebSearchProvider {
	readonly name = 'duckduckgo' as const;
	readonly requiresApiKey = false;
	readonly maxResultsLimit = 20;
	readonly defaultTimeoutMs = DEFAULT_TIMEOUT_MS;

	validateSettings(settings: SearchProviderSettings): { valid: boolean; errors: string[] } {
		const errors: string[] = [];
		if (settings.maxResults !== undefined && (settings.maxResults < 1 || settings.maxResults > this.maxResultsLimit)) {
			errors.push(`maxResults must be between 1 and ${this.maxResultsLimit}`);
		}
		return { valid: errors.length === 0, errors };
	}

	async testConnection(settings: SearchProviderSettings): Promise<{ success: boolean; message: string }> {
		try {
			const res = await this.search({ query: 'TypeScript documentation', maxResults: 3 }, settings);
			return res.results.length > 0
				? { success: true, message: `DuckDuckGo search reachable (${res.results.length} results).` }
				: { success: false, message: 'DuckDuckGo returned 0 results.' };
		} catch (e) {
			return { success: false, message: e instanceof Error ? e.message : String(e) };
		}
	}

	async search(request: SearchRequest, settings: SearchProviderSettings): Promise<SearchResponse> {
		const startedAt = Date.now();
		const timeoutMs = settings.timeoutMs || this.defaultTimeoutMs;
		const maxResults = Math.min(Math.max(1, request.maxResults ?? settings.maxResults ?? 10), this.maxResultsLimit);

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const body = new URLSearchParams({ q: request.query });
			const res = await fetch(DDG_HTML_URL, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
					'Accept': 'text/html,application/xhtml+xml',
				},
				body: body.toString(),
				signal: controller.signal,
			});
			if (!res.ok) {
				throw WebSearchError.transient(`DuckDuckGo returned HTTP ${res.status}`, this.name, res.status);
			}
			const html = await res.text();
			const rawItems = this._parseHtmlResults(html);
			const normalized: SearchResult[] = [];
			for (let i = 0; i < rawItems.length && normalized.length < maxResults; i++) {
				const item = this.normalizeResult(rawItems[i], normalized.length);
				if (item) normalized.push(item);
			}
			const deduped = this.deduplicateByUrl(normalized).slice(0, maxResults);
			return {
				results: deduped,
				provider: this.name,
				query: request.query,
				totalResults: deduped.length,
				responseTimeMs: Date.now() - startedAt,
			};
		} catch (error) {
			if (error instanceof WebSearchError) throw error;
			const msg = error instanceof Error ? error.message : String(error);
			throw WebSearchError.transient(`DuckDuckGo search failed: ${msg}`, this.name);
		} finally {
			clearTimeout(timer);
		}
	}

	private _parseHtmlResults(html: string): Array<{ title: string; url: string; snippet: string }> {
		const out: Array<{ title: string; url: string; snippet: string }> = [];
		const linkRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
		const snippetRe = /<(?:a|div|span)[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|span)>/gi;

		const links: Array<{ idx: number; url: string; title: string }> = [];
		let m: RegExpExecArray | null;
		while ((m = linkRe.exec(html)) !== null) {
			const url = unwrapDuckDuckGoUrl(m[1]);
			const title = decodeHtmlEntities(m[2]);
			if (title && this.isValidHttpUrl(url)) {
				links.push({ idx: m.index, url, title });
			}
		}

		const snippets: Array<{ idx: number; text: string }> = [];
		while ((m = snippetRe.exec(html)) !== null) {
			const text = decodeHtmlEntities(m[1]);
			if (text) snippets.push({ idx: m.index, text });
		}

		for (let i = 0; i < links.length; i++) {
			const cur = links[i];
			const nextIdx = i + 1 < links.length ? links[i + 1].idx : html.length;
			const snip = snippets.find(s => s.idx > cur.idx && s.idx < nextIdx)?.text ?? '';
			out.push({ title: cur.title, url: cur.url, snippet: snip });
		}
		return out;
	}

	protected normalizeResult(item: unknown, _index: number): SearchResult | null {
		if (!item || typeof item !== 'object') return null;
		const raw = item as { title?: unknown; url?: unknown; snippet?: unknown };
		const title = typeof raw.title === 'string' ? raw.title.trim() : '';
		const url = typeof raw.url === 'string' ? raw.url.trim() : '';
		if (!title || !url || !this.isValidHttpUrl(url)) return null;
		const normalizedUrl = this.normalizeUrl(url);
		return {
			title,
			url: normalizedUrl,
			displayUrl: this.extractDomain(normalizedUrl),
			snippet: typeof raw.snippet === 'string' ? raw.snippet.trim() : '',
			source: this.name,
			retrievalTimestamp: Date.now(),
		};
	}
}
