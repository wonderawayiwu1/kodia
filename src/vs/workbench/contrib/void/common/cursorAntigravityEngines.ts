/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// ============================================================================
// Cursor + Antigravity Superpower Engines:
//   1. Outline / AST Symbol Extractor (view_file_outline / view_code_item)
//   2. BugBot Automated Diff Reviewer (review_code_changes)
//   3. Scoped Rules (.kodia/rules/*.md & .cursor/rules/*.mdc) Parser/Formatter
//   4. Notepads (.kodia/notepads/*.md) Sanitizer
//   5. Generative UI Interactive Widget Payload (render_interactive_widget)
// ============================================================================

export interface CodeOutlineItem {
	name: string;
	kind: 'class' | 'interface' | 'type' | 'enum' | 'function' | 'method' | 'const' | 'namespace' | 'struct' | 'trait' | 'module';
	startLine: number;
	endLine: number;
	signature: string;
	container?: string;
}

export interface CodeReviewFinding {
	severity: 'critical' | 'high' | 'medium' | 'low';
	category: 'security' | 'bug' | 'type-safety' | 'hygiene' | 'performance';
	file: string;
	line: number;
	message: string;
	snippet: string;
}

export interface CodeReviewReport {
	scope: string;
	filesChanged: number;
	additions: number;
	deletions: number;
	findings: CodeReviewFinding[];
	summary: string;
	verdict: 'approve' | 'approve_with_notes' | 'request_changes';
}

export interface ScopedRuleDocument {
	name: string;
	path: string;
	source: 'kodia' | 'cursor';
	description: string;
	globs?: string[];
	alwaysApply: boolean;
	body: string;
}

export interface InteractiveWidgetPayload {
	id: string;
	title: string;
	kind: 'diagram' | 'chart' | 'ui_preview' | 'interactive' | 'table' | 'other';
	html: string;
	heightPx: number;
	createdAt: number;
}

// ---------- 1. Fast Multi-Language Symbol Outline & Item Extractor ----------

/**
 * Extracts a structured symbol outline (classes, interfaces, functions, methods, types, structs)
 * with exact 1-based start/end line ranges across TS/JS/TSX/Python/Go/Rust/PHP/Java/C#/C++.
 */
export function extractCodeOutline(content: string, filePath?: string): CodeOutlineItem[] {
	const lines = content.split(/\r?\n/);
	const ext = (filePath ?? '').split('.').pop()?.toLowerCase() ?? '';
	const isPython = ext === 'py';
	const items: CodeOutlineItem[] = [];

	const findBraceEnd = (startIdx: number): number => {
		let depth = 0;
		let sawOpen = false;
		for (let i = startIdx; i < lines.length; i++) {
			const line = lines[i];
			for (let c = 0; c < line.length; c++) {
				const ch = line[c];
				if (ch === '{') { depth++; sawOpen = true; }
				else if (ch === '}') {
					depth--;
					if (sawOpen && depth <= 0) return i + 1;
				}
			}
			if (!sawOpen && i - startIdx > 4) return startIdx + 1;
		}
		return Math.min(lines.length, startIdx + 1);
	};

	const findPythonIndentEnd = (startIdx: number): number => {
		const baseIndent = (lines[startIdx].match(/^\s*/) ?? [''])[0].length;
		let lastNonEmpty = startIdx;
		for (let i = startIdx + 1; i < lines.length; i++) {
			const trimmed = lines[i].trim();
			if (!trimmed || trimmed.startsWith('#')) continue;
			const indent = (lines[i].match(/^\s*/) ?? [''])[0].length;
			if (indent <= baseIndent) return lastNonEmpty + 1;
			lastNonEmpty = i;
		}
		return lastNonEmpty + 1;
	};

	let currentClass: { name: string; endLine: number } | undefined;

	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i];
		const trimmed = raw.trim();
		const lineNo = i + 1;
		if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('#')) {
			continue;
		}
		if (currentClass && lineNo > currentClass.endLine) {
			currentClass = undefined;
		}

		if (isPython) {
			const pyClass = /^class\s+([A-Za-z_]\w*)/.exec(trimmed);
			if (pyClass) {
				const endLine = findPythonIndentEnd(i);
				currentClass = { name: pyClass[1], endLine };
				items.push({ name: pyClass[1], kind: 'class', startLine: lineNo, endLine, signature: trimmed.slice(0, 120) });
				continue;
			}
			const pyDef = /^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/.exec(trimmed);
			if (pyDef) {
				const endLine = findPythonIndentEnd(i);
				const container = currentClass && raw.startsWith(' ') ? currentClass.name : undefined;
				items.push({ name: pyDef[1], kind: container ? 'method' : 'function', startLine: lineNo, endLine, signature: trimmed.slice(0, 120), container });
			}
			continue;
		}

		// TS / JS / Java / C# / PHP / Go / Rust top-level and class symbols
		const classMatch = /^(?:export\s+)?(?:default\s+)?(?:abstract\s+|final\s+|public\s+|internal\s+|pub\s+)?(class|interface|enum|struct|trait|namespace|module)\s+([A-Za-z_]\w*)/.exec(trimmed);
		if (classMatch) {
			const kind = classMatch[1] as CodeOutlineItem['kind'];
			const name = classMatch[2];
			const endLine = findBraceEnd(i);
			if (kind === 'class' || kind === 'struct' || kind === 'interface' || kind === 'trait') {
				currentClass = { name, endLine };
			}
			items.push({ name, kind, startLine: lineNo, endLine, signature: trimmed.slice(0, 120) });
			continue;
		}

		const typeMatch = /^(?:export\s+)?type\s+([A-Za-z_]\w*)\s*(?:<[^>]+>)?\s*=/.exec(trimmed);
		if (typeMatch) {
			items.push({ name: typeMatch[1], kind: 'type', startLine: lineNo, endLine: trimmed.includes('{') ? findBraceEnd(i) : lineNo, signature: trimmed.slice(0, 120) });
			continue;
		}

		const fnMatch = /^(?:export\s+)?(?:default\s+)?(?:pub\s+)?(?:async\s+)?(?:function|func|fn)\s*(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*(?:<[^>]+>)?\s*\(/.exec(trimmed);
		if (fnMatch) {
			const endLine = findBraceEnd(i);
			items.push({ name: fnMatch[1], kind: 'function', startLine: lineNo, endLine, signature: trimmed.slice(0, 120) });
			continue;
		}

		const arrowConstMatch = /^(?:export\s+)?const\s+([A-Za-z_]\w*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_]\w*)\s*=>/.exec(trimmed);
		if (arrowConstMatch) {
			const endLine = trimmed.includes('{') ? findBraceEnd(i) : lineNo;
			items.push({ name: arrowConstMatch[1], kind: 'const', startLine: lineNo, endLine, signature: trimmed.slice(0, 120) });
			continue;
		}

		// Methods inside a class / interface
		if (currentClass && /^\s{1,8}/.test(raw)) {
			const methodMatch = /^(?:public\s+|private\s+|protected\s+|static\s+|readonly\s+|override\s+|async\s+|get\s+|set\s+)*([A-Za-z_]\w*)\s*(?:<[^>]+>)?\s*\([^)]*\)/.exec(trimmed);
			if (methodMatch) {
				const mName = methodMatch[1];
				if (!['if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'super', 'this'].includes(mName)) {
					const endLine = trimmed.includes('{') ? findBraceEnd(i) : lineNo;
					items.push({ name: mName, kind: 'method', startLine: lineNo, endLine, signature: trimmed.slice(0, 120), container: currentClass.name });
				}
			}
		}
	}

	return items;
}

/** Finds a named symbol (`ClassName.methodName` or `symbolName`) and returns its numbered source code. */
export function extractCodeItem(content: string, symbolName: string, filePath?: string): { item: CodeOutlineItem; code: string } | undefined {
	const outline = extractCodeOutline(content, filePath);
	const needle = symbolName.trim();
	const dotParts = needle.split('.');
	let match: CodeOutlineItem | undefined;
	if (dotParts.length === 2) {
		const [cls, mem] = dotParts;
		match = outline.find(i => i.container === cls && i.name === mem)
			?? outline.find(i => i.container?.toLowerCase() === cls.toLowerCase() && i.name.toLowerCase() === mem.toLowerCase());
	} else {
		match = outline.find(i => i.name === needle)
			?? outline.find(i => i.name.toLowerCase() === needle.toLowerCase());
	}
	if (!match) return undefined;
	const lines = content.split(/\r?\n/);
	const slice = lines.slice(Math.max(0, match.startLine - 1), Math.min(lines.length, match.endLine));
	const numbered = slice.map((l, idx) => `${match!.startLine + idx}: ${l}`).join('\n');
	return { item: match, code: numbered };
}

// ---------- 2. Cursor BugBot-Style Automated Diff & Security Reviewer ----------

const REVIEW_RULES: ReadonlyArray<{
	severity: CodeReviewFinding['severity'];
	category: CodeReviewFinding['category'];
	pattern: RegExp;
	message: string;
	ignoreTests?: boolean;
}> = [
	{
		severity: 'critical',
		category: 'security',
		pattern: /(?:sk-[A-Za-z0-9]{20,}|nvapi-[A-Za-z0-9_-]{20,}|gsk_[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{25,}|AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/,
		message: 'Potential hardcoded API key or private key detected in added diff lines.',
	},
	{
		severity: 'high',
		category: 'security',
		pattern: /\b(?:dangerouslySetInnerHTML|innerHTML\s*=|eval\s*\(|new\s+Function\s*\(|child_process\.exec\s*\()/,
		message: 'Unsafe DOM injection or dynamic code/shell execution sink — verify input sanitization or use safe parameterized alternatives.',
		ignoreTests: true,
	},
	{
		severity: 'high',
		category: 'security',
		pattern: /(?:SELECT|INSERT|UPDATE|DELETE)\s+[^;\n]*\$\{[^}]+\}/i,
		message: 'Possible SQL injection via template literal interpolation — use parameterized queries instead.',
		ignoreTests: true,
	},
	{
		severity: 'medium',
		category: 'type-safety',
		pattern: /@ts-ignore|@ts-nocheck|eslint-disable(?!-next-line\s+@typescript-eslint\/no-unused-vars)/,
		message: 'Type-checker or linter suppression added — fix the underlying type/lint error instead of suppressing it.',
	},
	{
		severity: 'medium',
		category: 'bug',
		pattern: /catch\s*(?:\([^)]*\))?\s*\{\s*\}/,
		message: 'Empty catch block silently swallows errors — log, handle, or rethrow explicitly.',
		ignoreTests: true,
	},
	{
		severity: 'low',
		category: 'hygiene',
		pattern: /\bconsole\.(?:log|debug)\s*\(/,
		message: 'Debug console.log statement added — verify whether it should be removed before merging.',
		ignoreTests: true,
	},
	{
		severity: 'low',
		category: 'hygiene',
		pattern: /\b(?:TODO|FIXME|HACK|XXX)\b/,
		message: 'Unresolved TODO/FIXME/HACK marker introduced in diff.',
	},
];

/**
 * Analyzes a unified git diff and produces a severity-ranked BugBot-style CodeReviewReport.
 */
export function analyzeGitDiffForBugs(diffText: string, scope: string): CodeReviewReport {
	const findings: CodeReviewFinding[] = [];
	const files = new Set<string>();
	let additions = 0;
	let deletions = 0;
	let currentFile = '(unknown)';
	let currentLine = 0;

	for (const line of diffText.split(/\r?\n/)) {
		if (line.startsWith('+++ b/')) {
			currentFile = line.slice(6).trim();
			files.add(currentFile);
			if (isSensitiveEnvFilePath(currentFile)) {
				findings.push({
					severity: 'critical',
					category: 'security',
					file: currentFile,
					line: 1,
					message: 'Sensitive `.env` file is included in git diff! Never commit real `.env` secrets — add `.env` to `.gitignore` and commit `.env.example` instead.',
					snippet: currentFile,
				});
			}
			continue;
		}
		const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
		if (hunk) {
			currentLine = Number(hunk[1]) - 1;
			continue;
		}
		if (line.startsWith('---') || line.startsWith('diff --git') || line.startsWith('index ')) {
			continue;
		}
		if (line.startsWith('-')) {
			deletions++;
			continue;
		}
		if (line.startsWith('+')) {
			additions++;
			currentLine++;
			const addedContent = line.slice(1);
			const isTestFile = /(?:^|\/)(?:test|tests|__tests__)\/|\.(?:test|spec)\.[jt]sx?$/i.test(currentFile);
			for (const rule of REVIEW_RULES) {
				if (rule.ignoreTests && isTestFile) continue;
				if (rule.pattern.test(addedContent)) {
					if (findings.length < 80) {
						findings.push({
							severity: rule.severity,
							category: rule.category,
							file: currentFile,
							line: Math.max(1, currentLine),
							message: rule.message,
							snippet: addedContent.trim().slice(0, 140),
						});
					}
				}
			}
		} else {
			currentLine++;
		}
	}

	const severityRank = { critical: 0, high: 1, medium: 2, low: 3 };
	findings.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);

	const critHigh = findings.filter(f => f.severity === 'critical' || f.severity === 'high').length;
	const verdict: CodeReviewReport['verdict'] = critHigh > 0
		? 'request_changes'
		: findings.length > 0
			? 'approve_with_notes'
			: 'approve';

	const summary = files.size === 0
		? `No changed files in diff (${scope}).`
		: `Reviewed ${files.size} file(s) (+${additions}/-${deletions}) in ${scope}: ${findings.length} finding(s) (${critHigh} critical/high). Verdict: ${verdict}.`;

	return { scope, filesChanged: files.size, additions, deletions, findings, summary, verdict };
}

// ---------- 3. Scoped Rules (.kodia/rules/*.md & .cursor/rules/*.mdc) ----------

export function parseScopedRuleFile(
	name: string,
	path: string,
	source: 'kodia' | 'cursor',
	content: string,
): ScopedRuleDocument {
	const trimmed = content.trim();
	let description = name;
	let globs: string[] | undefined;
	let alwaysApply = true;
	let body = trimmed;

	const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(trimmed);
	if (fmMatch) {
		body = fmMatch[2].trim();
		for (const line of fmMatch[1].split(/\r?\n/)) {
			const kv = /^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/.exec(line.trim());
			if (!kv) continue;
			const k = kv[1].toLowerCase();
			const v = kv[2].trim().replace(/^["']|["']$/g, '');
			if (k === 'description' && v) description = v;
			else if (k === 'globs' && v) {
				globs = v.replace(/^\[|\]$/g, '').split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
			} else if (k === 'alwaysapply' || k === 'always_apply') {
				alwaysApply = v.toLowerCase() !== 'false';
			}
		}
	}
	return { name, path, source, description, globs, alwaysApply, body };
}

export function formatScopedRuleMarkdown(opts: {
	description: string;
	globs?: string[];
	alwaysApply?: boolean;
	body: string;
}): string {
	const lines = [
		'---',
		`description: ${opts.description.replace(/\r?\n/g, ' ')}`,
		`alwaysApply: ${opts.alwaysApply ?? true}`,
	];
	if (opts.globs && opts.globs.length > 0) {
		lines.push(`globs: ${opts.globs.join(', ')}`);
	}
	lines.push('---', '', opts.body.trim(), '');
	return lines.join('\n');
}

export function sanitizeWorkspaceDocName(raw: string, ext: '.md' | '.mdc' = '.md'): string {
	const base = raw
		.trim()
		.replace(/\\/g, '/')
		.split('/')
		.pop()!
		.replace(/\.(md|mdc)$/i, '')
		.replace(/[^a-zA-Z0-9._-]/g, '_')
		.replace(/^_+|_+$/g, '') || 'untitled';
	return `${base}${ext}`;
}

// ---------- 4. Real-World App-Build Pitfall Guard (Instant Write-Time Diagnostics) ----------

export interface BuildPitfallDiagnostic {
	code: string;
	line: number;
	message: string;
}

/**
 * Catches high-frequency real-world app-build traps immediately on file write/edit:
 * - SQLite single-row `CHECK (id = 1)` on multi-key settings tables (causes silent overwrites)
 * - OpenAI SDK v4-v7 `baseUrl` typo instead of `baseURL`
 * - Tailwind CSS v4 vs v3 config mismatch (`@tailwind base` / v3 postcss config with Tailwind v4)
 * - ESM `export default` in `.js` config files when sibling `package.json` lacks `"type": "module"`
 */
export function detectRealWorldBuildPitfalls(
	filePath: string,
	content: string,
	packageJsonContent?: string,
): BuildPitfallDiagnostic[] {
	const issues: BuildPitfallDiagnostic[] = [];
	const normalizedPath = filePath.replace(/\\/g, '/');
	const baseName = normalizedPath.split('/').pop()?.toLowerCase() ?? '';
	const lines = content.split(/\r?\n/);

	const findLine = (re: RegExp): number => {
		for (let i = 0; i < lines.length; i++) {
			if (re.test(lines[i])) return i + 1;
		}
		return 1;
	};

	// 1. SQLite single-row CHECK (id = 1) on settings/config tables with key/value semantics
	if (/CREATE\s+TABLE[\s\S]{0,220}settings[\s\S]{0,300}CHECK\s*\(\s*id\s*=\s*1\s*\)/i.test(content)) {
		if (/ON\s+CONFLICT\s*\(\s*id\s*\)|setting_key|key\s+TEXT/i.test(content)) {
			issues.push({
				code: 'kodia-sqlite-single-row-settings',
				line: findLine(/CHECK\s*\(\s*id\s*=\s*1\s*\)/i),
				message: 'SQLite pitfall: `CHECK (id = 1)` with `ON CONFLICT(id)` forces every setting into row 1 and overwrites other settings (e.g. API key / model / base URL). Use `setting_key TEXT PRIMARY KEY` (or `UNIQUE`) with `ON CONFLICT(setting_key) DO UPDATE SET ...`.',
			});
		}
	}

	// 2. OpenAI JS/TS SDK `baseUrl` casing bug (must be `baseURL`)
	if (/\bnew\s+OpenAI\s*\([\s\S]{0,250}\bbaseUrl\s*:/m.test(content)) {
		issues.push({
			code: 'kodia-openai-baseurl-casing',
			line: findLine(/\bbaseUrl\s*:/),
			message: 'OpenAI SDK typing bug: the official `openai` package expects `baseURL` (capital URL), not `baseUrl`. Rename `baseUrl` -> `baseURL`.',
		});
	}

	// Parse sibling package.json if available
	let pkg: { type?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | undefined;
	if (packageJsonContent) {
		try { pkg = JSON.parse(packageJsonContent); } catch { }
	}
	const twVersion = pkg?.dependencies?.tailwindcss ?? pkg?.devDependencies?.tailwindcss;
	const isTailwindV4 = typeof twVersion === 'string' && /^\s*[\^~>=<]*4(?:\.|$)/.test(twVersion);

	// 3. Tailwind CSS v4 vs v3 config mismatch
	if (isTailwindV4) {
		if (baseName.endsWith('.css') && /@tailwind\s+base\s*;/i.test(content)) {
			issues.push({
				code: 'kodia-tailwind-v4-directive',
				line: findLine(/@tailwind\s+base/i),
				message: `Tailwind v4 mismatch: package.json installs tailwindcss (${twVersion}) which uses \`@import "tailwindcss";\` + \`@tailwindcss/postcss\`, NOT v3 \`@tailwind base;\`. Either migrate to v4 syntax or pin \`tailwindcss@^3.4\`.`,
			});
		}
		if (baseName.startsWith('postcss.config.') && /\btailwindcss\s*:\s*\{/.test(content) && !content.includes('@tailwindcss/postcss')) {
			issues.push({
				code: 'kodia-tailwind-v4-postcss',
				line: findLine(/\btailwindcss\s*:/),
				message: `Tailwind v4 PostCSS mismatch: tailwindcss (${twVersion}) requires \`@tailwindcss/postcss\` plugin in postcss.config instead of \`tailwindcss: {}\` (or pin \`tailwindcss@^3.4\`).`,
			});
		}
	}

	// 4. ESM `export default` in `.js` config files without `"type": "module"` in package.json
	if (
		/^(?:vite|postcss|tailwind|eslint|vitest|playwright|next)\.config\.js$/i.test(baseName) &&
		/^\s*export\s+default\b/m.test(content) &&
		pkg &&
		pkg.type !== 'module'
	) {
		issues.push({
			code: 'kodia-esm-config-type-module',
			line: findLine(/^\s*export\s+default\b/),
			message: `Node ESM mismatch: \`${baseName}\` uses \`export default\` but package.json is missing \`"type": "module"\` (Node will throw \`Unexpected token 'export'\`). Add \`"type": "module"\` to package.json, rename to \`.mjs\`, or use \`module.exports =\`.`,
		});
	}

	return issues;
}

/** Checks if a path points to a real secret-bearing `.env` file (excluding safe templates like `.env.example`). */
export function isSensitiveEnvFilePath(filePath: string): boolean {
	const base = filePath.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? '';
	if (!base.startsWith('.env')) return false;
	if (/\.(?:example|sample|template|dist|schema)$/i.test(base)) return false;
	return true;
}

/** Parses SSE (`text/event-stream`) text into structured events. */
export interface SseStreamEvent {
	index: number;
	timestampMs: number;
	event: string;
	id?: string;
	data: string;
}

export interface SseStreamTestResult {
	url: string;
	method: string;
	status: number;
	contentType: string;
	ttftMs: number | null;
	totalDurationMs: number;
	eventCount: number;
	events: SseStreamEvent[];
	assembledText: string;
	completedNormally: boolean;
	error?: string;
}

export function extractSseTextDelta(data: string): string {
	const trimmed = data.trim();
	if (!trimmed || trimmed === '[DONE]') return '';
	try {
		const parsed = JSON.parse(trimmed);
		const delta = parsed?.choices?.[0]?.delta?.content
			?? parsed?.delta?.text
			?? parsed?.text
			?? parsed?.content
			?? parsed?.token;
		if (typeof delta === 'string') return delta;
	} catch {
		return trimmed;
	}
	return '';
}
