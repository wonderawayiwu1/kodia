/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { buildProjectDigitalTwin } from './digitalTwin.js';
import { ScannedSourceFile } from './projectHealth.js';
import {
	FpereArchitectureReport,
	FpereBlueprint,
	FpereCheckpointKind,
	FpereImportExportReport,
	FpereIntegrationReport,
	FpereModuleSummary,
	FpereQualityGateReport,
	FpereQualityStage,
	FpereRepairPlan,
	FpereTaskDagNode,
	FpereValidationIssue,
} from './firstPassReliabilityTypes.js';

const NODE_BUILTINS = new Set([
	'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console', 'constants', 'crypto',
	'dgram', 'diagnostics_channel', 'dns', 'domain', 'events', 'fs', 'http', 'http2', 'https',
	'inspector', 'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring',
	'readline', 'repl', 'stream', 'string_decoder', 'sys', 'test', 'timers', 'tls', 'trace_events',
	'tty', 'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
]);

const PYTHON_STDLIB = new Set([
	'abc', 'argparse', 'asyncio', 'base64', 'collections', 'contextlib', 'copy', 'csv', 'dataclasses',
	'datetime', 'decimal', 'enum', 'functools', 'glob', 'hashlib', 'hmac', 'http', 'importlib', 'io',
	'itertools', 'json', 'logging', 'math', 'os', 'pathlib', 'pickle', 'platform', 'queue', 'random',
	're', 'secrets', 'shutil', 'signal', 'socket', 'sqlite3', 'ssl', 'statistics', 'string', 'subprocess',
	'sys', 'tempfile', 'threading', 'time', 'traceback', 'typing', 'unittest', 'urllib', 'uuid', 'warnings', 'weakref',
]);

function normPath(p: string): string {
	return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

function detectLanguage(p: string): string {
	const l = p.toLowerCase();
	if (l.endsWith('.tsx') || l.endsWith('.ts') || l.endsWith('.mts') || l.endsWith('.cts')) return 'TypeScript';
	if (l.endsWith('.jsx') || l.endsWith('.js') || l.endsWith('.mjs') || l.endsWith('.cjs')) return 'JavaScript';
	if (l.endsWith('.py')) return 'Python';
	if (l.endsWith('.php')) return 'PHP';
	if (l.endsWith('.go')) return 'Go';
	if (l.endsWith('.rs')) return 'Rust';
	if (l.endsWith('.dart')) return 'Dart';
	if (l.endsWith('.kt') || l.endsWith('.kts')) return 'Kotlin';
	if (l.endsWith('.swift')) return 'Swift';
	if (l.endsWith('.java')) return 'Java';
	if (l.endsWith('.cs')) return 'C#';
	if (l.endsWith('.sql') || l.endsWith('.prisma')) return 'Database';
	return 'Other';
}

function classifyLayer(p: string, content: string): FpereModuleSummary['layer'] {
	const l = p.toLowerCase();
	if (/(?:^|\/)(?:__tests__|tests?|spec)\/|(?:\.test|\.spec|_test)\.[a-z0-9]+$/i.test(l)) return 'test';
	if (/(?:tsconfig|jsconfig|package|composer|pyproject|cargo|go\.mod|\.env|vite\.config|next\.config)/i.test(l)) return 'config';
	if (/(?:auth|login|jwt|oauth|session|guard|middleware)/i.test(l)) return 'auth';
	if (/(?:prisma|schema|migration|models?|entities|repositories|database|db\/|\.sql$)/i.test(l)) return 'database';
	if (/(?:routes?|controllers?|endpoints?|handlers?|api\/)/i.test(l)) return 'api';
	if (/(?:ai|llm|rag|embed|prompt|agent|model|nvidia|openai|anthropic)/i.test(l)) return 'ai';
	if (/(?:mobile|android|ios|screens?|expo|flutter|lib\/main\.dart)/i.test(l)) return 'mobile';
	if (/\.(tsx|jsx|vue|svelte)$/.test(l) || /(?:components?|pages?|views?|frontend|client|web|ui\/)/i.test(l)) return 'frontend';
	if (/(?:services?|server|backend|workers?|jobs?|queue)/i.test(l) || /\b(fastify|express|Flask|FastAPI|django)\b/.test(content)) return 'backend';
	if (/(?:shared|common|types|contracts|utils|lib\/)/i.test(l)) return 'shared';
	return 'other';
}

function extractExportsDetailed(content: string, filePath: string): { named: Set<string>; hasDefault: boolean } {
	const named = new Set<string>();
	let hasDefault = false;
	const l = filePath.toLowerCase();

	if (/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(l)) {
		if (/\bexport\s+default\b/.test(content) || /\bmodule\.exports\s*=/.test(content)) {
			hasDefault = true;
		}
		const declRe = /\bexport\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\*?|class|interface|type|enum|const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
		let m: RegExpExecArray | null;
		while ((m = declRe.exec(content)) !== null) {
			named.add(m[1]);
		}
		const braceRe = /\bexport\s+(?:type\s+)?\{([^}]+)\}/g;
		while ((m = braceRe.exec(content)) !== null) {
			for (const part of m[1].split(',')) {
				const cleaned = part.replace(/\btype\s+/g, '').trim();
				if (!cleaned) continue;
				const asMatch = /\bas\s+([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(cleaned);
				const name = asMatch ? asMatch[1] : cleaned.split(/\s+/)[0];
				if (name === 'default') hasDefault = true;
				else if (name) named.add(name);
			}
		}
		// CommonJS module.exports = { a, b }
		const cjsObj = /\bmodule\.exports\s*=\s*\{([^}]+)\}/.exec(content);
		if (cjsObj) {
			for (const part of cjsObj[1].split(',')) {
				const k = part.split(':')[0]?.trim();
				if (k && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k)) named.add(k);
			}
		}
		const cjsDot = /\bexports\.([A-Za-z_$][A-Za-z0-9_$]*)\s*=/g;
		while ((m = cjsDot.exec(content)) !== null) named.add(m[1]);
	} else if (l.endsWith('.py')) {
		const pyRe = /^(?:async\s+)?(?:def|class)\s+([A-Za-z_][A-Za-z0-9_]*)/gm;
		let m: RegExpExecArray | null;
		while ((m = pyRe.exec(content)) !== null) named.add(m[1]);
		const constRe = /^([A-Z][A-Z0-9_]{1,})\s*=/gm;
		while ((m = constRe.exec(content)) !== null) named.add(m[1]);
	}

	return { named, hasDefault };
}

function extractEnvVars(content: string): string[] {
	const found = new Set<string>();
	const patterns = [
		/\bprocess\.env\.([A-Z][A-Z0-9_]{2,})\b/g,
		/\bprocess\.env\[['"]([A-Z][A-Z0-9_]{2,})['"]\]/g,
		/\bimport\.meta\.env\.([A-Z][A-Z0-9_]{2,})\b/g,
		/\bos\.(?:environ\.get|getenv)\(\s*['"]([A-Z][A-Z0-9_]{2,})['"]/g,
		/\bos\.environ\[['"]([A-Z][A-Z0-9_]{2,})['"]\]/g,
	];
	for (const re of patterns) {
		let m: RegExpExecArray | null;
		while ((m = re.exec(content)) !== null) {
			if (m[1] && !/^(NODE_ENV|PATH|HOME|USER|PWD|CI|PORT|HOST|TERM|COMSPEC|TEMP|TMP)$/.test(m[1])) {
				found.add(m[1]);
			}
		}
	}
	return [...found];
}

function resolveRelativeImportTarget(fromFile: string, specifier: string, fileSet: ReadonlySet<string>): string | undefined {
	const fromDir = fromFile.includes('/') ? fromFile.slice(0, fromFile.lastIndexOf('/')) : '';
	const rawParts = (fromDir ? `${fromDir}/${specifier}` : specifier).split('/');
	const resolved: string[] = [];
	for (const part of rawParts) {
		if (!part || part === '.') continue;
		if (part === '..') resolved.pop();
		else resolved.push(part);
	}
	const base = resolved.join('/');
	const strippedJs = base.replace(/\.(js|mjs|cjs|jsx)$/, '');

	const candidates = [
		base,
		`${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}.js`, `${base}.jsx`, `${base}.mjs`, `${base}.cjs`, `${base}.json`,
		`${strippedJs}.ts`, `${strippedJs}.tsx`, `${strippedJs}.mts`, `${strippedJs}.js`, `${strippedJs}.jsx`,
		`${base}/index.ts`, `${base}/index.tsx`, `${base}/index.js`, `${base}/index.jsx`,
		`${strippedJs}/index.ts`, `${strippedJs}/index.tsx`, `${strippedJs}/index.js`,
	];

	for (const cand of candidates) {
		if (fileSet.has(cand)) return cand;
	}
	return undefined;
}

// ── 1. Deep Project Understanding Engine (Section 4) ───────────────────────────────────

export function analyzeRepositoryArchitecture(
	workspaceRoot: string,
	files: readonly ScannedSourceFile[],
): FpereArchitectureReport {
	const twin = buildProjectDigitalTwin(files);
	const languages = new Set<string>();
	const frameworks = new Set<string>();
	const entryPoints: string[] = [];
	const declaredPackages = new Set<string>();
	const envVarsDeclared = new Set<string>();
	const envVarsReferenced = new Set<string>();
	const modules: FpereModuleSummary[] = [];

	let camelFiles = 0;
	let snakeFiles = 0;
	let kebabFiles = 0;

	for (const f of files) {
		const rel = normPath(f.relativePath);
		const lang = detectLanguage(rel);
		if (lang !== 'Other' && lang !== 'Database') languages.add(lang);

		const stem = (rel.split('/').pop() ?? rel).replace(/\.[^.]+$/, '');
		if (/^[a-z]+(?:[A-Z][a-z0-9]+)+$/.test(stem)) camelFiles++;
		else if (/^[a-z0-9]+_[a-z0-9_]+$/.test(stem)) snakeFiles++;
		else if (/^[a-z0-9]+-[a-z0-9-]+$/.test(stem)) kebabFiles++;

		if (/(?:^|\/)(?:index|main|app|server)\.(ts|tsx|js|jsx|py|go|rs|dart)$/i.test(rel)) {
			entryPoints.push(rel);
		}

		if (rel === 'package.json' || rel.endsWith('/package.json')) {
			try {
				const pkg = JSON.parse(f.content);
				const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}), ...(pkg.peerDependencies ?? {}) };
				for (const d of Object.keys(deps)) declaredPackages.add(d);
				if (deps.react) frameworks.add('React');
				if (deps.next) frameworks.add('Next.js');
				if (deps['react-native']) frameworks.add('React Native');
				if (deps.expo) frameworks.add('Expo');
				if (deps.fastify) frameworks.add('Fastify');
				if (deps.express) frameworks.add('Express');
				if (deps['@nestjs/core']) frameworks.add('NestJS');
				if (deps.prisma || deps['@prisma/client']) frameworks.add('Prisma');
			} catch { /* ignore */ }
		}

		if (rel === 'requirements.txt' || rel.endsWith('/requirements.txt')) {
			for (const line of f.content.split(/\r?\n/)) {
				const pkg = line.trim().split(/[=<>!~\[]/)[0]?.trim().toLowerCase();
				if (pkg && !pkg.startsWith('#')) declaredPackages.add(pkg);
			}
		}

		if (rel.endsWith('.env.example') || rel.endsWith('.env.sample') || rel.endsWith('.env.template')) {
			for (const line of f.content.split(/\r?\n/)) {
				const m = /^\s*([A-Z][A-Z0-9_]{2,})\s*=/.exec(line);
				if (m) envVarsDeclared.add(m[1]);
			}
		}

		const exp = extractExportsDetailed(f.content, rel);
		const node = twin.nodeById[rel];
		const envs = extractEnvVars(f.content);
		for (const e of envs) envVarsReferenced.add(e);

		modules.push({
			path: rel,
			layer: classifyLayer(rel, f.content),
			language: lang,
			exportedSymbols: [...exp.named],
			hasDefaultExport: exp.hasDefault,
			importedModules: node?.imports ?? [],
			apiEndpoints: node?.apiEndpoints ?? [],
			dbEntities: node?.dbEntities ?? [],
			envVarsUsed: envs,
		});
	}

	const namingConvention: FpereArchitectureReport['namingConvention'] =
		camelFiles > snakeFiles && camelFiles > kebabFiles ? 'camelCase'
			: snakeFiles > camelFiles && snakeFiles > kebabFiles ? 'snake_case'
				: kebabFiles > camelFiles && kebabFiles > snakeFiles ? 'kebab-case'
					: 'mixed';

	return {
		workspaceRoot,
		analyzedAtMs: Date.now(),
		languages: [...languages],
		frameworks: [...frameworks],
		entryPoints: entryPoints.slice(0, 12),
		declaredPackages: [...declaredPackages],
		totalFiles: files.length,
		totalExports: modules.reduce((s, m) => s + m.exportedSymbols.length, 0),
		totalApiEndpoints: twin.totalApis,
		totalDbEntities: twin.totalDbEntities,
		envVarsDeclared: [...envVarsDeclared],
		envVarsReferenced: [...envVarsReferenced],
		modules,
		namingConvention,
		circularDependencies: twin.architecture.cycles,
		summary: `Analyzed ${files.length} file(s) across ${[...languages].join(', ') || 'unknown'}: ${modules.reduce((s, m) => s + m.exportedSymbols.length, 0)} exports, ${twin.totalApis} API endpoint(s), ${twin.totalDbEntities} DB model(s), ${twin.architecture.cycles.length} circular cycle(s).`,
	};
}

// ── 2. Write-Time & Continuous Import/Export + Hygiene Validator (Sections 6 & 7) ──────

export function validateImportsAndExports(
	workspaceRoot: string,
	files: readonly ScannedSourceFile[],
	targetFiles?: readonly string[],
): FpereImportExportReport {
	const issues: FpereValidationIssue[] = [];
	const fileMap = new Map<string, ScannedSourceFile>();
	const exportsByFile = new Map<string, { named: Set<string>; hasDefault: boolean; hasStarReexport: boolean }>();
	const declaredNpm = new Set<string>();
	const declaredPy = new Set<string>();
	const pathAliasPrefixes: string[] = [];

	for (const f of files) {
		const rel = normPath(f.relativePath);
		fileMap.set(rel, f);
		const exp = extractExportsDetailed(f.content, rel);
		const hasStarReexport = /\bexport\s+\*\s+from\s+['"]/.test(f.content);
		exportsByFile.set(rel, { ...exp, hasStarReexport });

		if (rel === 'package.json' || rel.endsWith('/package.json')) {
			try {
				const pkg = JSON.parse(f.content);
				for (const d of Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}), ...(pkg.peerDependencies ?? {}), ...(pkg.optionalDependencies ?? {}) })) {
					declaredNpm.add(d);
				}
			} catch { /* ignore */ }
		}
		if (rel === 'tsconfig.json' || rel.endsWith('/tsconfig.json')) {
			const m = /"paths"\s*:\s*\{([^}]+)\}/.exec(f.content);
			if (m) {
				for (const km of m[1].matchAll(/"([^"]+?)\*?"\s*:/g)) {
					pathAliasPrefixes.push(km[1].replace(/\*$/, ''));
				}
			}
		}
		if (rel === 'requirements.txt' || rel.endsWith('/requirements.txt')) {
			for (const line of f.content.split(/\r?\n/)) {
				const pkg = line.trim().split(/[=<>!~\[]/)[0]?.trim().toLowerCase().replace(/-/g, '_');
				if (pkg && !pkg.startsWith('#')) declaredPy.add(pkg);
			}
		}
		if (rel === 'pyproject.toml' || rel.endsWith('/pyproject.toml')) {
			for (const m of f.content.matchAll(/["']([a-zA-Z0-9_-]+)(?:[=<>!~\[]|["'])/g)) {
				declaredPy.add(m[1].toLowerCase().replace(/-/g, '_'));
			}
		}
	}

	const fileSet = new Set(fileMap.keys());
	const hasPackageJson = [...fileSet].some(p => p === 'package.json' || p.endsWith('/package.json'));
	const hasPyManifest = [...fileSet].some(p => p === 'requirements.txt' || p === 'pyproject.toml' || p.endsWith('/requirements.txt') || p.endsWith('/pyproject.toml'));

	const targetSet = targetFiles?.length ? new Set(targetFiles.map(normPath)) : undefined;
	const filesToCheck = targetSet
		? [...fileMap.values()].filter(f => targetSet.has(normPath(f.relativePath)))
		: [...fileMap.values()];

	let nextId = 1;
	for (const f of filesToCheck) {
		const rel = normPath(f.relativePath);
		const isCodeTsJs = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i.test(rel);
		const isPy = /\.py$/i.test(rel);
		const isTest = /(?:^|\/)(?:__tests__|tests?|spec)\/|(?:\.test|\.spec|_test)\.[a-z0-9]+$/i.test(rel);
		const lines = f.content.split(/\r?\n/);

		if (isCodeTsJs) {
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				const lineNo = i + 1;

				// Check ESM imports: import { a, b } from 'spec' | import Default from 'spec' | import 'spec'
				const impMatch = /^\s*import\s+(?:type\s+)?(?:(\*\s+as\s+[A-Za-z_$][A-Za-z0-9_$]*)|(\{[^}]+\})|([A-Za-z_$][A-Za-z0-9_$]*)(?:\s*,\s*(\{[^}]+\}))?)?\s*(?:from\s+)?['"]([^'"]+)['"]/.exec(line);
				if (impMatch) {
					const namedBlock = impMatch[2] || impMatch[4];
					const defaultName = impMatch[3];
					const spec = impMatch[5];

					if (spec.startsWith('.')) {
						const resolved = resolveRelativeImportTarget(rel, spec, fileSet);
						if (!resolved) {
							issues.push({
								id: `FPERE-IMP-${nextId++}`,
								kind: 'broken_relative_import',
								severity: 'error',
								file: rel,
								line: lineNo,
								symbolOrTarget: spec,
								message: `Relative import "${spec}" does not resolve to any file in the project.`,
								suggestedFix: `Create the target module or fix the relative import path in ${rel}:${lineNo}.`,
							});
						} else {
							const targetExp = exportsByFile.get(resolved);
							if (targetExp && !targetExp.hasStarReexport) {
								if (defaultName && !targetExp.hasDefault && !/\.(json|css|scss|svg|png|jpg)$/.test(resolved)) {
									issues.push({
										id: `FPERE-DEF-${nextId++}`,
										kind: 'missing_default_export',
										severity: 'error',
										file: rel,
										line: lineNo,
										symbolOrTarget: defaultName,
										message: `Default import "${defaultName}" from "${spec}" (${resolved}), but target module has no default export.`,
										suggestedFix: `Use a named import matching exports of ${resolved} (${[...targetExp.named].slice(0, 6).join(', ') || 'none'}) or add export default.`,
									});
								}
								if (namedBlock) {
									const inner = namedBlock.slice(1, -1);
									for (const rawSym of inner.split(',')) {
										const cleaned = rawSym.replace(/\btype\s+/g, '').trim();
										if (!cleaned) continue;
										const origName = cleaned.split(/\s+as\s+/)[0]?.trim();
										if (origName && origName !== 'default' && !targetExp.named.has(origName)) {
											issues.push({
												id: `FPERE-EXP-${nextId++}`,
												kind: 'missing_named_export',
												severity: 'error',
												file: rel,
												line: lineNo,
												symbolOrTarget: origName,
												message: `Named import "${origName}" is not exported by "${spec}" (${resolved}). Available exports: ${[...targetExp.named].slice(0, 8).join(', ') || 'none'}.`,
												suggestedFix: `Export "${origName}" from ${resolved} or update the import in ${rel}:${lineNo}.`,
											});
										}
									}
								}
							}
						}
					} else if (hasPackageJson) {
						const cleanSpec = spec.replace(/^node:/, '');
						const pkgName = cleanSpec.startsWith('@')
							? cleanSpec.split('/').slice(0, 2).join('/')
							: cleanSpec.split('/')[0];
						const isAlias = pathAliasPrefixes.some(pref => spec.startsWith(pref)) || spec.startsWith('@/') || spec.startsWith('~/');
						if (!NODE_BUILTINS.has(pkgName) && !isAlias && !declaredNpm.has(pkgName) && !pkgName.startsWith('vscode')) {
							issues.push({
								id: `FPERE-PKG-${nextId++}`,
								kind: 'undeclared_package_import',
								severity: 'error',
								file: rel,
								line: lineNo,
								symbolOrTarget: pkgName,
								message: `External package "${pkgName}" imported in ${rel}:${lineNo} is not declared in package.json.`,
								suggestedFix: `Verify compatibility and install "${pkgName}" into package.json, or replace with an already-installed package.`,
							});
						}
					}
				}

				// Check anti-cheat / quality hygiene (Section 19): @ts-ignore / @ts-nocheck / unimplemented placeholders
				if (/@ts-ignore|@ts-nocheck/.test(line) && !isTest) {
					issues.push({
						id: `FPERE-SUP-${nextId++}`,
						kind: 'type_suppression_abuse',
						severity: 'warning',
						file: rel,
						line: lineNo,
						message: 'TypeScript suppression directive (@ts-ignore / @ts-nocheck) hides type errors instead of fixing them.',
						suggestedFix: 'Fix the underlying type mismatch rather than suppressing the compiler.',
					});
				}
				if (/throw\s+new\s+Error\s*\(\s*['"`][^'"`]*not\s+implemented/i.test(line) && !isTest) {
					issues.push({
						id: `FPERE-STUB-${nextId++}`,
						kind: 'unimplemented_placeholder',
						severity: 'error',
						file: rel,
						line: lineNo,
						message: 'Unimplemented placeholder stub ("Not implemented") detected in production source.',
						suggestedFix: 'Implement the real behavior before marking this module complete.',
					});
				}
			}
		} else if (isPy) {
			const pyLocalModules = new Set(
				[...fileSet].filter(p => p.endsWith('.py')).map(p => p.split('/').pop()!.replace(/\.py$/, '')),
			);
			const pyTopDirs = new Set([...fileSet].filter(p => p.includes('/')).map(p => p.split('/')[0]));
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				const lineNo = i + 1;
				const pyImp = /^\s*(?:from\s+([A-Za-z0-9_.]+)\s+import|import\s+([A-Za-z0-9_]+))/.exec(line);
				if (pyImp && hasPyManifest) {
					const mod = (pyImp[1] || pyImp[2] || '').trim();
					if (mod && !mod.startsWith('.')) {
						const top = mod.split('.')[0].toLowerCase().replace(/-/g, '_');
						if (!PYTHON_STDLIB.has(top) && !pyLocalModules.has(top) && !pyTopDirs.has(top) && !declaredPy.has(top)) {
							issues.push({
								id: `FPERE-PYPKG-${nextId++}`,
								kind: 'undeclared_package_import',
								severity: 'warning',
								file: rel,
								line: lineNo,
								symbolOrTarget: top,
								message: `Python module "${top}" imported at ${rel}:${lineNo} is not declared in requirements.txt / pyproject.toml.`,
								suggestedFix: `Add "${top}" to requirements.txt / pyproject.toml or use a stdlib/local module.`,
							});
						}
					}
				}
				if (/raise\s+NotImplementedError\b/.test(line) && !isTest) {
					issues.push({
						id: `FPERE-PYSTUB-${nextId++}`,
						kind: 'unimplemented_placeholder',
						severity: 'error',
						file: rel,
						line: lineNo,
						message: 'Unimplemented NotImplementedError stub detected in Python production code.',
						suggestedFix: 'Implement the real logic before finishing.',
					});
				}
			}
		}
	}

	const twin = buildProjectDigitalTwin(files);
	for (const cycle of twin.architecture.cycles.slice(0, 5)) {
		issues.push({
			id: `FPERE-CYC-${nextId++}`,
			kind: 'circular_dependency',
			severity: 'warning',
			file: cycle[0] ?? 'workspace',
			line: 1,
			message: `Circular import cycle detected: ${cycle.join(' -> ')}`,
			suggestedFix: 'Extract shared types/interfaces into a dedicated contracts module to break the cycle.',
		});
	}

	const errorCount = issues.filter(i => i.severity === 'error').length;
	const warningCount = issues.filter(i => i.severity === 'warning').length;
	return {
		workspaceRoot,
		checkedAtMs: Date.now(),
		filesChecked: filesToCheck.length,
		errorCount,
		warningCount,
		passed: errorCount === 0,
		issues,
		summary: errorCount === 0
			? `Import/export & hygiene check PASSED across ${filesToCheck.length} file(s) (${warningCount} warning(s)).`
			: `Found ${errorCount} first-pass error(s) and ${warningCount} warning(s) across ${filesToCheck.length} file(s).`,
	};
}

// ── 3. Full-Stack Integration Contract Validator (Section 10) ──────────────────────────

function normalizeApiPath(raw: string): string {
	return raw
		.replace(/\$\{[^}]+\}/g, ':param')
		.replace(/\{[^}]+\}/g, ':param')
		.replace(/:[A-Za-z0-9_]+/g, ':param')
		.replace(/\?.*$/, '')
		.replace(/\/+$/, '') || '/';
}

export function validateFullStackIntegration(
	workspaceRoot: string,
	files: readonly ScannedSourceFile[],
	checkpoint: FpereCheckpointKind = 'full_stack_workflow',
	blueprint?: FpereBlueprint,
): FpereIntegrationReport {
	const issues: FpereValidationIssue[] = [];
	const backendRoutes = new Map<string, { method: string; path: string; file: string }>();
	const frontendCalls: { method: string; path: string; file: string; line: number }[] = [];
	const dbModels = new Set<string>();
	const envDeclared = new Set<string>();
	const envReferenced = new Map<string, { file: string; line: number }>();

	let nextId = 1;

	for (const f of files) {
		const rel = normPath(f.relativePath);
		const layer = classifyLayer(rel, f.content);
		const lines = f.content.split(/\r?\n/);

		if (rel.endsWith('.env.example') || rel.endsWith('.env.sample') || rel.endsWith('.env')) {
			for (const l of lines) {
				const m = /^\s*([A-Z][A-Z0-9_]{2,})\s*=/.exec(l);
				if (m) envDeclared.add(m[1]);
			}
		}

		// Extract backend routes
		const routePatterns = [
			/\b(?:app|router|fastify|server|Route)\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`\n]{1,120})['"`]/gi,
			/@(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`\n]{1,120})['"`]/gi,
		];
		for (const re of routePatterns) {
			let m: RegExpExecArray | null;
			while ((m = re.exec(f.content)) !== null) {
				const method = m[1].toUpperCase();
				const np = normalizeApiPath(m[2]);
				backendRoutes.set(`${method} ${np}`, { method, path: np, file: rel });
			}
		}
		// Python http.server style: if path == '/api/...' or req_path == '/api/...'
		const pyRouteRe = /(?:path|req_path)\s*==\s*['"](\/api\/[^'"]+)['"]/g;
		let pm: RegExpExecArray | null;
		while ((pm = pyRouteRe.exec(f.content)) !== null) {
			const np = normalizeApiPath(pm[1]);
			backendRoutes.set(`ANY ${np}`, { method: 'ANY', path: np, file: rel });
		}

		// Extract DB models / tables
		for (const m of f.content.matchAll(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"'\[]?([A-Za-z_][A-Za-z0-9_]*)/gi)) {
			dbModels.add(m[1].toLowerCase());
		}
		for (const m of f.content.matchAll(/^\s*model\s+([A-Z][A-Za-z0-9_]*)\s*\{/gm)) {
			dbModels.add(m[1].toLowerCase());
		}

		// Extract frontend API calls & check for client-side AI secret leaks
		if (layer === 'frontend' || layer === 'mobile') {
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				const fetchM = /\bfetch\s*\(\s*(?:`[^`]*?(\/api\/[^`?\s]+)`|['"](\/api\/[^'"?\s]+)['"])/.exec(line);
				if (fetchM) {
					const rawPath = fetchM[1] || fetchM[2];
					const hasOptionsObj = /,\s*\{/.test(line.slice(fetchM.index));
					const methodScope = hasOptionsObj ? lines.slice(i, i + 4).join(' ') : line.slice(fetchM.index);
					const methodM = /method\s*:\s*['"](GET|POST|PUT|PATCH|DELETE)['"]/i.exec(methodScope);
					frontendCalls.push({
						method: methodM ? methodM[1].toUpperCase() : 'GET',
						path: normalizeApiPath(rawPath),
						file: rel,
						line: i + 1,
					});
				}
				const axiosM = /\baxios\.(get|post|put|patch|delete)\s*\(\s*[`'"](?:https?:\/\/[^/]+)?(\/api\/[^`'"?\s]+)[`'"]/i.exec(line);
				if (axiosM) {
					frontendCalls.push({
						method: axiosM[1].toUpperCase(),
						path: normalizeApiPath(axiosM[2]),
						file: rel,
						line: i + 1,
					});
				}
				// Hardcoded AI provider keys in frontend/mobile
				if (/\b(nvapi-[A-Za-z0-9_-]{10,}|sk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,})\b/.test(line)) {
					issues.push({
						id: `FPERE-AISEC-${nextId++}`,
						kind: 'ai_client_secret_leak',
						severity: 'error',
						file: rel,
						line: i + 1,
						message: 'Hardcoded AI provider API key detected in client/frontend code.',
						suggestedFix: 'Move AI provider calls to a backend proxy endpoint using server-side environment variables.',
					});
				}
			}
		}

		// Track referenced env vars
		for (let i = 0; i < lines.length; i++) {
			for (const ev of extractEnvVars(lines[i])) {
				if (!envReferenced.has(ev)) envReferenced.set(ev, { file: rel, line: i + 1 });
			}
		}
	}

	// Cross-check frontend API calls against backend routes (when backend routes exist!)
	let matchedApiContracts = 0;
	if (backendRoutes.size > 0) {
		for (const call of frontendCalls) {
			const exact = backendRoutes.has(`${call.method} ${call.path}`) || backendRoutes.has(`ANY ${call.path}`);
			if (exact) {
				matchedApiContracts++;
			} else {
				issues.push({
					id: `FPERE-API-${nextId++}`,
					kind: 'api_contract_mismatch',
					severity: 'error',
					file: call.file,
					line: call.line,
					symbolOrTarget: `${call.method} ${call.path}`,
					message: `Frontend calls "${call.method} ${call.path}", but no matching backend route was found. Defined routes: ${[...backendRoutes.keys()].slice(0, 6).join(', ')}.`,
					suggestedFix: `Implement "${call.method} ${call.path}" in the backend router or align the frontend request path/method.`,
				});
			}
		}
	}

	// Cross-check Blueprint required contracts if present
	if (blueprint) {
		for (const api of blueprint.apiContracts) {
			const np = normalizeApiPath(api.path);
			if (backendRoutes.size > 0 && !backendRoutes.has(`${api.method} ${np}`) && !backendRoutes.has(`ANY ${np}`)) {
				issues.push({
					id: `FPERE-BPAPI-${nextId++}`,
					kind: 'api_contract_mismatch',
					severity: 'error',
					file: api.backendFile ?? 'blueprint',
					line: 1,
					symbolOrTarget: `${api.method} ${np}`,
					message: `Blueprint API contract "${api.method} ${np}" is not yet implemented in backend routes.`,
					suggestedFix: `Implement "${api.method} ${np}" matching the agreed contract.`,
				});
			}
		}
		for (const model of blueprint.dbModels) {
			if (dbModels.size > 0 && !dbModels.has(model.name.toLowerCase()) && !dbModels.has(`${model.name.toLowerCase()}s`)) {
				issues.push({
					id: `FPERE-BPDB-${nextId++}`,
					kind: 'db_contract_mismatch',
					severity: 'error',
					file: model.schemaFile ?? 'blueprint',
					line: 1,
					symbolOrTarget: model.name,
					message: `Blueprint database model "${model.name}" was not found in database schemas/migrations.`,
					suggestedFix: `Define table/model "${model.name}" in the database schema.`,
				});
			}
		}
	}

	// Cross-check referenced env vars against .env.example (when .env.example exists)
	if (envDeclared.size > 0) {
		for (const [varName, loc] of envReferenced.entries()) {
			if (!envDeclared.has(varName)) {
				issues.push({
					id: `FPERE-ENV-${nextId++}`,
					kind: 'missing_env_declaration',
					severity: 'warning',
					file: loc.file,
					line: loc.line,
					symbolOrTarget: varName,
					message: `Environment variable "${varName}" is referenced in ${loc.file}:${loc.line} but missing from .env.example.`,
					suggestedFix: `Document "${varName}=" in .env.example so setup and deployment stay consistent.`,
				});
			}
		}
	}

	const errorCount = issues.filter(i => i.severity === 'error').length;
	return {
		workspaceRoot,
		checkedAtMs: Date.now(),
		checkpoint,
		frontendApiCallsFound: frontendCalls.length,
		backendRoutesFound: backendRoutes.size,
		matchedApiContracts,
		dbModelsFound: dbModels.size,
		envVarsChecked: envReferenced.size,
		passed: errorCount === 0,
		issues,
		summary: errorCount === 0
			? `Integration checkpoint (${checkpoint}) PASSED: ${matchedApiContracts}/${frontendCalls.length} API calls matched, ${dbModels.size} DB model(s), ${envReferenced.size} env var(s).`
			: `Integration checkpoint (${checkpoint}) FAILED with ${errorCount} contract mismatch(es).`,
	};
}

// ── 4. Dependency-Aware Task DAG Scheduler (Section 5 & 11) ───────────────────────────

export function evaluateTaskDagReadiness(tasks: readonly FpereTaskDagNode[]): {
	readyTaskIds: string[];
	blockedTaskIds: string[];
	cycles: string[][];
} {
	const byId = new Map(tasks.map(t => [t.id, t]));
	const readyTaskIds: string[] = [];
	const blockedTaskIds: string[] = [];

	for (const t of tasks) {
		if (t.status === 'verified' || t.status === 'in_progress') continue;
		const depsDone = t.dependsOn.every(depId => byId.get(depId)?.status === 'verified');
		if (depsDone) readyTaskIds.push(t.id);
		else blockedTaskIds.push(t.id);
	}

	// Cycle detection via DFS
	const cycles: string[][] = [];
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const dfs = (id: string, stack: string[]) => {
		if (visiting.has(id)) {
			const idx = stack.indexOf(id);
			if (idx >= 0) cycles.push([...stack.slice(idx), id]);
			return;
		}
		if (visited.has(id)) return;
		visiting.add(id);
		stack.push(id);
		const node = byId.get(id);
		if (node) {
			for (const dep of node.dependsOn) {
				if (byId.has(dep)) dfs(dep, stack);
			}
		}
		stack.pop();
		visiting.delete(id);
		visited.add(id);
	};
	for (const t of tasks) dfs(t.id, []);

	return { readyTaskIds, blockedTaskIds, cycles };
}

// ── 5. First-Pass Quality Gate & Controlled Root-Cause Repair (Sections 8 & 9) ────────

export function computeQualityGateStage(params: {
	importExportPassed: boolean;
	integrationPassed: boolean;
	compilerRan: boolean;
	compilerPassed: boolean;
	testsRan: boolean;
	testsPassed: boolean;
	buildRan: boolean;
	buildPassed: boolean;
	runtimeRan?: boolean;
	runtimePassed?: boolean;
	blocked?: boolean;
}): FpereQualityStage {
	if (params.blocked) return 'blocked';
	if (!params.importExportPassed || !params.integrationPassed) return 'failed';
	if (params.compilerRan && !params.compilerPassed) return 'failed';
	if (params.testsRan && !params.testsPassed) return 'failed';
	if (params.buildRan && !params.buildPassed) return 'failed';
	if (params.runtimeRan && !params.runtimePassed) return 'failed';

	if (params.runtimeRan && params.runtimePassed) return 'runtime_verified';
	if (params.buildRan && params.buildPassed) return 'build_verified';
	if (params.testsRan && params.testsPassed) return 'tests_passed';
	if (params.compilerRan && params.compilerPassed && params.integrationPassed) return 'integrated';
	if (params.compilerRan && params.compilerPassed) return 'type_checks_passed';
	return 'static_checks_passed';
}

export function classifyRootCauseForRepair(errorSummary: string, attemptNumber: number, maxRetries: number, files: readonly string[]): FpereRepairPlan {
	const lower = errorSummary.toLowerCase();
	let rootCauseClass: FpereRepairPlan['rootCauseClass'] = 'model_code_defect';
	let smallestCoherentFix = 'Inspect the failing symbol/file and apply the minimal targeted fix.';

	if (/cannot find module|does not resolve|missing_named_export|missing_default_export|broken_relative_import|is not exported/.test(lower)) {
		rootCauseClass = 'broken_import_or_export';
		smallestCoherentFix = 'Align the import specifier and exported symbol name against the actual target module exports.';
	} else if (/undeclared_package|not declared in package\.json|enoent.*node_modules|no module named/.test(lower)) {
		rootCauseClass = 'missing_dependency';
		smallestCoherentFix = 'Verify compatibility via Live Engineering Intelligence, add the dependency to the manifest, and install it.';
	} else if (/api_contract|db_contract|404|method not allowed|no such table|column .* does not exist/.test(lower)) {
		rootCauseClass = 'api_or_db_contract_mismatch';
		smallestCoherentFix = 'Reconcile the frontend/backend API route or database schema against the shared Blueprint contract.';
	} else if (/tsconfig|env|environment variable|eaddrinuse|config/.test(lower)) {
		rootCauseClass = 'config_or_env_error';
		smallestCoherentFix = 'Fix the configuration or .env declaration without weakening strict compiler settings.';
	} else if (/tsserver|language server|stale|conflict/.test(lower)) {
		rootCauseClass = 'compiler_or_lsp_issue';
		smallestCoherentFix = 'Verify with independent compiler (kdre_verify_compilers) and run kdre_recover if LSP drifted.';
	} else if (/network|offline|unauthorized|401|403|blocked/.test(lower)) {
		rootCauseClass = 'external_or_blocked';
		smallestCoherentFix = 'Report the external/environment blocker honestly with evidence rather than looping retries.';
	}

	const escalated = attemptNumber > maxRetries || rootCauseClass === 'external_or_blocked';
	return {
		repairId: `fpere-rep-${Date.now().toString(36)}-${attemptNumber}`,
		attemptNumber,
		maxRetries,
		escalated,
		rootCauseClass,
		affectedFiles: files,
		rootCauseSummary: `Root cause classified as "${rootCauseClass}" (attempt ${attemptNumber}/${maxRetries}): ${errorSummary.slice(0, 180)}`,
		smallestCoherentFix,
		verificationSteps: [
			'Apply the minimal fix without weakening types, strict mode, or tests.',
			'Re-run fpere_validate_imports and independent compiler verification.',
			'Re-run affected unit/integration tests to verify zero regressions.',
		],
	};
}

// ── Concise LLM Formatters ─────────────────────────────────────────────────────────────

export function formatArchitectureForLLM(r: FpereArchitectureReport): string {
	return [
		`## FPERE Deep Repository Architecture`,
		`- **Summary:** ${r.summary}`,
		`- **Languages:** ${r.languages.join(', ') || 'none'} | **Frameworks:** ${r.frameworks.join(', ') || 'none'} | **Naming:** ${r.namingConvention}`,
		r.entryPoints.length ? `- **Entry Points:** ${r.entryPoints.join(', ')}` : '',
		r.declaredPackages.length ? `- **Declared Packages (${r.declaredPackages.length}):** ${r.declaredPackages.slice(0, 20).join(', ')}` : '',
		r.circularDependencies.length ? `- **Circular Dependencies:** ${r.circularDependencies.map(c => c.join(' -> ')).join('; ')}` : '',
	].filter(Boolean).join('\n');
}

export function formatImportExportForLLM(r: FpereImportExportReport): string {
	return [
		`## FPERE Import/Export & Hygiene Check`,
		`- **Status:** ${r.passed ? 'PASSED' : 'FAILED'} (${r.errorCount} error(s), ${r.warningCount} warning(s) across ${r.filesChecked} file(s))`,
		...r.issues.slice(0, 15).map(i => `  - [${i.severity.toUpperCase()}][${i.kind}] ${i.file}:${i.line} — ${i.message} (Fix: ${i.suggestedFix})`),
	].join('\n');
}

export function formatIntegrationForLLM(r: FpereIntegrationReport): string {
	return [
		`## FPERE Full-Stack Integration Checkpoint (${r.checkpoint})`,
		`- **Result:** ${r.summary}`,
		...r.issues.slice(0, 15).map(i => `  - [${i.severity.toUpperCase()}][${i.kind}] ${i.file}:${i.line} — ${i.message}`),
	].join('\n');
}

export function formatQualityGateForLLM(r: FpereQualityGateReport): string {
	return [
		`## FPERE First-Pass Quality Gate — ${r.unitLabel}`,
		`- **Stage:** \`${r.stage}\` | **Passed:** ${r.passed ? 'YES' : 'NO'}`,
		...r.checks.map(c => `  - [${!c.executed ? 'SKIP' : c.passed ? 'PASS' : 'FAIL'}] ${c.name}: ${c.detail}`),
		r.blockingIssues.length ? `\n### Blocking Issues (${r.blockingIssues.length}):\n${r.blockingIssues.slice(0, 10).map(b => `  - ${b.file}:${b.line} [${b.kind}]: ${b.message}`).join('\n')}` : '',
	].filter(Boolean).join('\n');
}
