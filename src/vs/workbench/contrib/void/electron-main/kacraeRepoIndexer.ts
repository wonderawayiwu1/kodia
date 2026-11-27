/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * KACRAE Enterprise-Scale Incremental Disk-Backed Repository Indexer & Graph Engine (Part 6 & Part 9)
 *
 * Engineered for very large & multi-million-file repositories:
 *  - Streaming async directory traversal (`fs.promises.opendir`, no recursive stack/memory explosion)
 *  - Bounded-concurrency file processing with cooperative event-loop yielding
 *  - Fast-path (mtimeMs + size) & SHA-256 content fingerprinting so unchanged files are NEVER rescanned
 *  - Sharded NDJSON disk-backed persistence under `.kodia/kacrae/index/`
 *  - Periodic checkpoints for cancellation, pause/resume, and interruption recovery
 *  - Real measured throughput (files/sec), peak heap/RSS MB, and honest partial/interrupted reporting
 *  - Navigable repository intelligence graph + blast-radius queries
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
	KacraeArchitectureTopology,
	KacraeBlastRadiusReport,
	KacraeGraphNodeKind,
	KacraeRepoClassification,
	KacraeRepoGraph,
	KacraeRepoGraphEdge,
	KacraeRepoGraphNode,
	KacraeRepoIndexStats,
	KacraeRepoKind,
} from '../common/kacraeTypes.js';

const DEFAULT_EXCLUDES = new Set([
	'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', 'coverage',
	'.venv', 'venv', '__pycache__', 'target', '.kodia', '.gradle', '.idea', '.vscode-test',
]);

const VENDOR_DIR_NAMES = new Set(['vendor', 'third_party', 'third-party', 'external', 'deps', 'bower_components']);
const GENERATED_DIR_NAMES = new Set(['generated', '__generated__', 'gen', '.gen', 'dist', 'build', 'out', '.next']);

const BINARY_EXTS = new Set([
	'.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.svgz', '.pdf',
	'.zip', '.tar', '.gz', '.7z', '.rar', '.woff', '.woff2', '.ttf', '.eot', '.otf',
	'.mp3', '.mp4', '.mov', '.avi', '.mkv', '.wav', '.exe', '.dll', '.so', '.dylib',
	'.wasm', '.bin', '.dat', '.sqlite', '.db', '.jar', '.class', '.pyc', '.o', '.a',
]);

const EXT_TO_LANGUAGE: Readonly<Record<string, string>> = {
	'.ts': 'TypeScript', '.tsx': 'TypeScript', '.mts': 'TypeScript', '.cts': 'TypeScript',
	'.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
	'.py': 'Python', '.go': 'Go', '.rs': 'Rust', '.java': 'Java', '.kt': 'Kotlin', '.kts': 'Kotlin',
	'.cs': 'C#', '.php': 'PHP', '.rb': 'Ruby', '.ex': 'Elixir', '.exs': 'Elixir', '.scala': 'Scala',
	'.c': 'C', '.h': 'C/C++', '.cpp': 'C++', '.cc': 'C++', '.hpp': 'C++', '.swift': 'Swift', '.zig': 'Zig',
	'.dart': 'Dart', '.sql': 'SQL', '.r': 'R', '.jl': 'Julia', '.ipynb': 'Jupyter',
	'.html': 'HTML', '.css': 'CSS', '.scss': 'SCSS', '.less': 'Less', '.vue': 'Vue', '.svelte': 'Svelte',
	'.yaml': 'YAML', '.yml': 'YAML', '.json': 'JSON', '.toml': 'TOML', '.tf': 'Terraform',
	'.sh': 'Bash', '.bash': 'Bash', '.ps1': 'PowerShell', '.md': 'Markdown', '.graphql': 'GraphQL', '.proto': 'Protobuf',
};

const MAX_TEXT_FILE_BYTES = 512 * 1024; // 512 KB per source file cap to protect memory
const SHARD_COUNT = 8;
const MAX_GRAPH_NODES_FOR_RENDER = 350;

export interface IndexedFileRecord {
	readonly relPath: string;
	readonly size: number;
	readonly mtimeMs: number;
	readonly sha256: string;
	readonly language: string;
	readonly lines: number;
	readonly kind: KacraeGraphNodeKind;
	readonly layer: KacraeRepoGraphNode['layer'];
	readonly exportedSymbols: readonly string[];
	readonly rawImports: readonly string[];
	readonly apiEndpoints: readonly string[];
	readonly dbTables: readonly string[];
	readonly hasAuthBoundary: boolean;
}

interface PersistedIndexManifest {
	readonly schemaVersion: 1;
	readonly workspaceRoot: string;
	readonly updatedAt: string;
	readonly shardCount: number;
	readonly totalFiles: number;
	readonly checkpointId?: string;
	readonly completed: boolean;
}

export interface KacraeIndexControl {
	isCancelled: () => boolean;
	isPaused: () => boolean;
	onProgress?: (info: { processed: number; discovered: number; unchanged: number; currentFile: string }) => void;
}

function normRel(p: string): string {
	return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

function hashToShard(relPath: string): number {
	let h = 0;
	for (let i = 0; i < relPath.length; i++) {
		h = (h * 31 + relPath.charCodeAt(i)) | 0;
	}
	return Math.abs(h) % SHARD_COUNT;
}

function isTestPath(rel: string): boolean {
	const l = rel.toLowerCase();
	return /(?:^|\/)(?:__tests__|tests?|spec)\//.test(l) || /\.(?:test|spec)\.[a-z0-9]+$/.test(l) || /_test\.[a-z0-9]+$/.test(l);
}

function classifyLayer(rel: string, kind: KacraeGraphNodeKind, content: string): KacraeRepoGraphNode['layer'] {
	const l = rel.toLowerCase();
	if (kind === 'test') { return 'test'; }
	if (kind === 'auth' || /(?:^|\/)(?:auth|oauth|jwt|rbac|iam|session|security)/.test(l)) { return 'auth'; }
	if (kind === 'database' || /(?:^|\/)(?:db|database|prisma|migrations?|models?|repositories?|dao|schema)/.test(l)) { return 'data'; }
	if (kind === 'api' || /(?:^|\/)(?:api|routes?|controllers?|endpoints?|graphql|grpc)/.test(l)) { return 'api'; }
	if (kind === 'config' || /(?:dockerfile|k8s|kubernetes|terraform|helm|\.ya?ml$|\.toml$)/.test(l)) { return 'infra'; }
	if (/(?:^|\/)(?:components?|pages?|views?|ui|frontend|client|screens?)|\.(?:tsx|jsx|vue|svelte|css|scss|html)$/.test(l)) { return 'frontend'; }
	if (/(?:^|\/)(?:services?|server|backend|workers?|jobs?|queues?|domain)/.test(l) || /\b(?:express|fastify|koa|http\.createServer)\b/.test(content)) { return 'backend'; }
	return 'shared';
}

function extractFileMetadata(rel: string, content: string, size: number, mtimeMs: number, sha256: string): IndexedFileRecord {
	const ext = path.extname(rel).toLowerCase();
	const base = path.basename(rel).toLowerCase();
	const language = base === 'dockerfile' ? 'Dockerfile' : (EXT_TO_LANGUAGE[ext] ?? 'Other');
	const lines = content.split(/\r?\n/).length;

	const exportedSymbols = new Set<string>();
	const symPatterns = [
		/\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|enum|const|let)\s+([A-Za-z_$][\w$]*)/g,
		/^\s*(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)/gm,
		/\bfunc\s+(?:\([^)]*\)\s*)?([A-Z][A-Za-z0-9_]*)\s*\(/g,
		/\bpub\s+(?:async\s+)?(?:fn|struct|enum|trait)\s+([A-Za-z_]\w*)/g,
		/\bpublic\s+(?:static\s+)?(?:class|interface|enum|record|void|[A-Z]\w*)\s+([A-Za-z_]\w*)/g,
	];
	for (const re of symPatterns) {
		let m: RegExpExecArray | null;
		while ((m = re.exec(content)) !== null) {
			if (m[1]) { exportedSymbols.add(m[1]); }
			if (exportedSymbols.size >= 40) { break; }
		}
	}

	const rawImports = new Set<string>();
	const impPatterns = [
		/\b(?:import|export)\s+(?:[\s\S]{0,180}?\s+from\s+)?['"]([^'"\n]+)['"]/g,
		/\brequire\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
		/^\s*from\s+([A-Za-z0-9_.]+)\s+import\b/gm,
		/^\s*import\s+([A-Za-z0-9_.]+)/gm,
	];
	for (const re of impPatterns) {
		let m: RegExpExecArray | null;
		while ((m = re.exec(content)) !== null) {
			if (m[1] && m[1].length <= 160) { rawImports.add(m[1]); }
			if (rawImports.size >= 60) { break; }
		}
	}

	const apiEndpoints = new Set<string>();
	const apiPatterns = [
		/\b(?:app|router|fastify|server)\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`\n]{1,120})['"`]/gi,
		/@(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`\n]{1,120})['"`]/gi,
	];
	for (const re of apiPatterns) {
		let m: RegExpExecArray | null;
		while ((m = re.exec(content)) !== null) {
			apiEndpoints.add(`${m[1].toUpperCase()} ${m[2]}`);
			if (apiEndpoints.size >= 25) { break; }
		}
	}

	const dbTables = new Set<string>();
	const dbPatterns = [
		/\b(?:CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?[`"'\[]?([A-Za-z_]\w*)/gi,
		/\b(?:FROM|INTO|UPDATE|JOIN)\s+[`"'\[]?([a-zA-Z_][a-zA-Z0-9_]{2,})\b/g,
		/^\s*model\s+([A-Z][A-Za-z0-9_]*)\s*\{/gm,
	];
	const sqlNoise = new Set(['select', 'where', 'values', 'set', 'null', 'true', 'false', 'from', 'import', 'return', 'const', 'function', 'class', 'async', 'await']);
	for (const re of dbPatterns) {
		let m: RegExpExecArray | null;
		while ((m = re.exec(content)) !== null) {
			const tbl = m[1];
			if (tbl && !sqlNoise.has(tbl.toLowerCase())) {
				if (re === dbPatterns[1] && !/\b(?:SELECT|INSERT|UPDATE|DELETE)\b/i.test(content)) { continue; }
				dbTables.add(tbl);
			}
			if (dbTables.size >= 20) { break; }
		}
	}

	const hasAuthBoundary = /\b(?:jwt\.verify|requireAuth|authenticate|authorize|passport|oauth|saml|oidc|rbac|verifyToken|middleware)\b/i.test(content);

	let kind: KacraeGraphNodeKind = 'file';
	if (isTestPath(rel)) { kind = 'test'; }
	else if (hasAuthBoundary && /auth|security|guard|middleware/i.test(rel)) { kind = 'auth'; }
	else if (apiEndpoints.size > 0) { kind = 'api'; }
	else if (dbTables.size > 0 || ext === '.sql' || /migration|schema|prisma/i.test(rel)) { kind = 'database'; }
	else if (/worker|queue|job|cron/i.test(rel)) { kind = 'worker'; }
	else if (/\.(?:json|ya?ml|toml|env|ini|conf)$|dockerfile/i.test(rel)) { kind = 'config'; }
	else if (exportedSymbols.size > 0) { kind = 'module'; }

	const layer = classifyLayer(rel, kind, content);

	return {
		relPath: rel,
		size,
		mtimeMs,
		sha256,
		language,
		lines,
		kind,
		layer,
		exportedSymbols: [...exportedSymbols],
		rawImports: [...rawImports],
		apiEndpoints: [...apiEndpoints],
		dbTables: [...dbTables],
		hasAuthBoundary,
	};
}

export class KacraeRepoIndexer {
	private getIndexDir(workspaceRoot: string): string {
		return path.join(workspaceRoot, '.kodia', 'kacrae', 'index');
	}

	private loadExistingRecords(indexDir: string): Map<string, IndexedFileRecord> {
		const map = new Map<string, IndexedFileRecord>();
		const shardsDir = path.join(indexDir, 'shards');
		if (!fs.existsSync(shardsDir)) { return map; }
		for (let i = 0; i < SHARD_COUNT; i++) {
			const shardPath = path.join(shardsDir, `shard-${i}.ndjson`);
			if (!fs.existsSync(shardPath)) { continue; }
			try {
				const raw = fs.readFileSync(shardPath, 'utf8');
				for (const line of raw.split(/\r?\n/)) {
					if (!line.trim()) { continue; }
					const rec = JSON.parse(line) as IndexedFileRecord;
					if (rec && typeof rec.relPath === 'string') {
						map.set(rec.relPath, rec);
					}
				}
			} catch { /* ignore corrupted shard; will rebuild */ }
		}
		return map;
	}

	private persistRecordsSharded(
		workspaceRoot: string,
		indexDir: string,
		records: Map<string, IndexedFileRecord>,
		completed: boolean,
		checkpointId?: string,
	): void {
		const shardsDir = path.join(indexDir, 'shards');
		fs.mkdirSync(shardsDir, { recursive: true });
		const buckets: string[][] = Array.from({ length: SHARD_COUNT }, () => []);
		for (const rec of records.values()) {
			buckets[hashToShard(rec.relPath)].push(JSON.stringify(rec));
		}
		for (let i = 0; i < SHARD_COUNT; i++) {
			const shardPath = path.join(shardsDir, `shard-${i}.ndjson`);
			const tmpPath = `${shardPath}.tmp`;
			fs.writeFileSync(tmpPath, buckets[i].join('\n') + (buckets[i].length ? '\n' : ''), 'utf8');
			fs.renameSync(tmpPath, shardPath);
		}
		const manifest: PersistedIndexManifest = {
			schemaVersion: 1,
			workspaceRoot,
			updatedAt: new Date().toISOString(),
			shardCount: SHARD_COUNT,
			totalFiles: records.size,
			checkpointId,
			completed,
		};
		const manifestPath = path.join(indexDir, 'manifest.json');
		const tmpManifest = `${manifestPath}.tmp`;
		fs.writeFileSync(tmpManifest, JSON.stringify(manifest, null, 2), 'utf8');
		fs.renameSync(tmpManifest, manifestPath);
	}

	async indexWorkspace(
		workspaceRoot: string,
		opts?: {
			concurrency?: number;
			maxFiles?: number;
			excludePatterns?: readonly string[];
			incremental?: boolean;
			control?: KacraeIndexControl;
		},
	): Promise<{ stats: KacraeRepoIndexStats; graph: KacraeRepoGraph; records: Map<string, IndexedFileRecord> }> {
		const startedAt = new Date().toISOString();
		const t0 = Date.now();
		const indexDir = this.getIndexDir(workspaceRoot);
		const concurrency = Math.max(1, Math.min(32, opts?.concurrency ?? 8));
		const maxFiles = opts?.maxFiles ?? 250_000;
		const incremental = opts?.incremental !== false;

		const excludes = new Set<string>([...DEFAULT_EXCLUDES, ...(opts?.excludePatterns ?? [])]);
		const existingRecords = incremental ? this.loadExistingRecords(indexDir) : new Map<string, IndexedFileRecord>();
		const nextRecords = new Map<string, IndexedFileRecord>();

		const vendorDirs = new Set<string>();
		const generatedDirs = new Set<string>();
		const packageJsonPaths: string[] = [];
		const frameworks = new Set<string>();
		const packageManagers = new Set<string>();
		const testFrameworks = new Set<string>();

		let totalDiscoveredFiles = 0;
		let indexedFiles = 0;
		let unchangedCachedFiles = 0;
		let skippedExcludedFiles = 0;
		let skippedBinaryOrLargeFiles = 0;
		let largeFileCount = 0;
		let binaryFileCount = 0;
		let peakHeapMb = 0;
		let peakRssMb = 0;
		let partial = false;
		let interrupted = false;
		let partialReason: string | undefined;
		const checkpointId = `chk-${Date.now().toString(36)}`;

		const sampleMem = () => {
			const m = process.memoryUsage();
			peakHeapMb = Math.max(peakHeapMb, m.heapUsed / (1024 * 1024));
			peakRssMb = Math.max(peakRssMb, m.rss / (1024 * 1024));
		};
		sampleMem();

		// Streaming iterative directory traversal (zero recursion)
		const dirQueue: string[] = [workspaceRoot];
		const discoveredQueue: { absPath: string; relPath: string }[] = [];

		const waitWhilePaused = async () => {
			while (opts?.control?.isPaused() && !opts?.control?.isCancelled()) {
				await new Promise(r => setTimeout(r, 40));
			}
		};

		const processFile = async (item: { absPath: string; relPath: string }) => {
			if (opts?.control?.isCancelled()) {
				interrupted = true;
				partial = true;
				partialReason = 'Indexing cancelled by user';
				return;
			}
			await waitWhilePaused();

			const ext = path.extname(item.relPath).toLowerCase();
			if (BINARY_EXTS.has(ext)) {
				binaryFileCount++;
				skippedBinaryOrLargeFiles++;
				return;
			}

			let st: fs.Stats;
			try {
				st = await fs.promises.stat(item.absPath);
			} catch {
				return;
			}

			if (st.size > MAX_TEXT_FILE_BYTES) {
				largeFileCount++;
				skippedBinaryOrLargeFiles++;
				return;
			}

			// Incremental fast-path: unchanged mtimeMs + size -> zero disk read!
			const cached = existingRecords.get(item.relPath);
			if (incremental && cached && cached.size === st.size && Math.abs(cached.mtimeMs - st.mtimeMs) < 1) {
				nextRecords.set(item.relPath, cached);
				unchangedCachedFiles++;
				return;
			}

			let buf: Buffer;
			try {
				buf = await fs.promises.readFile(item.absPath);
			} catch {
				return;
			}

			// Quick null-byte binary check on first 1KB
			const probeLen = Math.min(buf.length, 1024);
			for (let b = 0; b < probeLen; b++) {
				if (buf[b] === 0) {
					binaryFileCount++;
					skippedBinaryOrLargeFiles++;
					return;
				}
			}

			const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
			if (incremental && cached && cached.sha256 === sha256) {
				// Content identical even though mtime changed — refresh mtime only!
				nextRecords.set(item.relPath, { ...cached, mtimeMs: st.mtimeMs });
				unchangedCachedFiles++;
				return;
			}

			const content = buf.toString('utf8');
			const base = path.basename(item.relPath);
			if (base === 'package.json') {
				packageJsonPaths.push(item.relPath);
				try {
					const pkg = JSON.parse(content) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
					const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
					if (deps.react) { frameworks.add('React'); }
					if (deps.next) { frameworks.add('Next.js'); }
					if (deps.vue) { frameworks.add('Vue'); }
					if (deps.express) { frameworks.add('Express'); }
					if (deps.fastify) { frameworks.add('Fastify'); }
					if (deps.prisma || deps['@prisma/client']) { frameworks.add('Prisma'); }
					if (deps.jest) { testFrameworks.add('Jest'); }
					if (deps.vitest) { testFrameworks.add('Vitest'); }
					if (deps.mocha) { testFrameworks.add('Mocha'); }
				} catch { /* ignore */ }
			} else if (base === 'package-lock.json') { packageManagers.add('npm'); }
			else if (base === 'pnpm-lock.yaml') { packageManagers.add('pnpm'); }
			else if (base === 'yarn.lock') { packageManagers.add('yarn'); }
			else if (base === 'Cargo.toml') { packageManagers.add('cargo'); testFrameworks.add('cargo test'); }
			else if (base === 'go.mod') { packageManagers.add('go'); testFrameworks.add('go test'); }
			else if (base === 'pyproject.toml' || base === 'requirements.txt') { packageManagers.add('pip/python'); }

			const rec = extractFileMetadata(item.relPath, content, st.size, st.mtimeMs, sha256);
			nextRecords.set(item.relPath, rec);
			indexedFiles++;
		};

		// Bounded worker pool draining discovered files in streaming batches
		const drainBatch = async () => {
			if (discoveredQueue.length === 0) { return; }
			const batch = discoveredQueue.splice(0, discoveredQueue.length);
			let cursor = 0;
			const workers = Array.from({ length: Math.min(concurrency, batch.length) }, async () => {
				while (cursor < batch.length) {
					if (opts?.control?.isCancelled()) {
						interrupted = true;
						partial = true;
						partialReason = 'Indexing cancelled by user';
						return;
					}
					const idx = cursor++;
					await processFile(batch[idx]);
					if ((idx + 1) % 100 === 0) {
						sampleMem();
						opts?.control?.onProgress?.({
							processed: indexedFiles + unchangedCachedFiles,
							discovered: totalDiscoveredFiles,
							unchanged: unchangedCachedFiles,
							currentFile: batch[idx].relPath,
						});
						await new Promise(r => setImmediate(r));
					}
				}
			});
			await Promise.all(workers);
			sampleMem();
		};

		if (workspaceRoot && fs.existsSync(workspaceRoot)) {
			while (dirQueue.length > 0) {
				if (opts?.control?.isCancelled()) {
					interrupted = true;
					partial = true;
					partialReason = 'Indexing cancelled by user';
					break;
				}
				await waitWhilePaused();

				const curDir = dirQueue.shift()!;
				let dirHandle: fs.Dir;
				try {
					dirHandle = await fs.promises.opendir(curDir);
				} catch {
					continue;
				}
				try {
					for await (const entry of dirHandle) {
						const abs = path.join(curDir, entry.name);
						const rel = normRel(path.relative(workspaceRoot, abs));
						if (entry.isDirectory()) {
							if (VENDOR_DIR_NAMES.has(entry.name)) { vendorDirs.add(rel); }
							if (GENERATED_DIR_NAMES.has(entry.name)) { generatedDirs.add(rel); }
							if (excludes.has(entry.name) || excludes.has(rel)) {
								skippedExcludedFiles++;
								continue;
							}
							dirQueue.push(abs);
						} else if (entry.isFile()) {
							totalDiscoveredFiles++;
							if (totalDiscoveredFiles > maxFiles) {
								partial = true;
								partialReason = `Reached configured maxFiles budget (${maxFiles}); remaining files deferred for incremental indexing.`;
								break;
							}
							discoveredQueue.push({ absPath: abs, relPath: rel });
							if (discoveredQueue.length >= 250) {
								await drainBatch();
								// Write periodic checkpoint for large repos (>1000 files)
								if ((indexedFiles + unchangedCachedFiles) % 1000 < 250 && indexedFiles > 0) {
									this.persistRecordsSharded(workspaceRoot, indexDir, nextRecords, false, checkpointId);
								}
							}
						}
					}
				} catch { /* ignore unreadable dir */ }

				if (partial && totalDiscoveredFiles > maxFiles) {
					break;
				}
			}
			if (!interrupted) {
				await drainBatch();
			}
		}

		// Persist final sharded index to disk
		if (workspaceRoot && fs.existsSync(workspaceRoot)) {
			this.persistRecordsSharded(workspaceRoot, indexDir, nextRecords, !partial && !interrupted, checkpointId);
		}

		const graph = this.buildGraphFromRecords(nextRecords);
		const classification = this.classifyRepository(nextRecords, packageJsonPaths, frameworks, packageManagers, testFrameworks, [...generatedDirs], [...vendorDirs], binaryFileCount, largeFileCount);
		const durationMs = Math.max(1, Date.now() - t0);
		const processedTotal = indexedFiles + unchangedCachedFiles;
		const throughputFilesPerSec = Number(((processedTotal / durationMs) * 1000).toFixed(1));
		sampleMem();

		const stats: KacraeRepoIndexStats = {
			workspaceRoot,
			indexDir,
			startedAt,
			completedAt: new Date().toISOString(),
			durationMs,
			totalDiscoveredFiles,
			indexedFiles,
			unchangedCachedFiles,
			skippedExcludedFiles,
			skippedBinaryOrLargeFiles,
			totalSymbols: [...nextRecords.values()].reduce((a, r) => a + r.exportedSymbols.length, 0),
			totalEdges: graph.totalEdgeCount,
			throughputFilesPerSec,
			peakHeapMb: Number(peakHeapMb.toFixed(1)),
			peakRssMb: Number(peakRssMb.toFixed(1)),
			partial,
			interrupted,
			partialReason,
			checkpointId,
			classification,
		};

		return { stats, graph, records: nextRecords };
	}

	loadCachedGraph(workspaceRoot: string): { graph: KacraeRepoGraph; records: Map<string, IndexedFileRecord> } | null {
		const indexDir = this.getIndexDir(workspaceRoot);
		if (!fs.existsSync(path.join(indexDir, 'manifest.json'))) { return null; }
		const records = this.loadExistingRecords(indexDir);
		if (records.size === 0) { return null; }
		return { graph: this.buildGraphFromRecords(records), records };
	}

	private classifyRepository(
		records: Map<string, IndexedFileRecord>,
		packageJsonPaths: readonly string[],
		frameworks: Set<string>,
		packageManagers: Set<string>,
		testFrameworks: Set<string>,
		generatedDirs: readonly string[],
		vendorDirs: readonly string[],
		binaryFileCount: number,
		largeFileCount: number,
	): KacraeRepoClassification {
		const languages: Record<string, number> = {};
		let codeFiles = 0;
		let docFiles = 0;
		let infraFiles = 0;
		const serviceDirs = new Set<string>();

		for (const rec of records.values()) {
			languages[rec.language] = (languages[rec.language] ?? 0) + 1;
			if (rec.language === 'Markdown') { docFiles++; }
			else if (rec.layer === 'infra') { infraFiles++; }
			else { codeFiles++; }
			const parts = rec.relPath.split('/');
			if ((parts[0] === 'services' || parts[0] === 'packages' || parts[0] === 'apps') && parts[1]) {
				serviceDirs.add(`${parts[0]}/${parts[1]}`);
			}
		}

		const kinds: KacraeRepoKind[] = [];
		const majorCodeLangs = Object.entries(languages).filter(([lang, cnt]) =>
			!['JSON', 'YAML', 'Markdown', 'TOML', 'Other'].includes(lang) && cnt >= 2,
		);
		if (packageJsonPaths.length >= 2 || serviceDirs.size >= 2) { kinds.push('monorepo'); }
		if (majorCodeLangs.length >= 2) { kinds.push('polyglot'); }
		if ([...serviceDirs].some(d => d.startsWith('services/'))) { kinds.push('microservices'); }
		if (packageJsonPaths.length >= 2) { kinds.push('multi_package'); }
		if (frameworks.has('React') || frameworks.has('Next.js') || frameworks.has('Vue')) { kinds.push('web_app'); }
		if (frameworks.has('Express') || frameworks.has('Fastify') || (languages['Go'] ?? 0) > 0 || (languages['Python'] ?? 0) > 0) { kinds.push('backend_service'); }
		if (codeFiles === 0 && docFiles > 0) { kinds.push('documentation'); }
		if (infraFiles > codeFiles && infraFiles > 0) { kinds.push('infrastructure'); }
		if (kinds.length === 0) { kinds.push('library'); }

		return {
			kinds,
			languages,
			frameworks: [...frameworks],
			packageManagers: [...packageManagers],
			testFrameworks: [...testFrameworks],
			generatedDirs,
			vendorDirs,
			binaryFileCount,
			largeFileCount,
		};
	}

	buildGraphFromRecords(records: Map<string, IndexedFileRecord>): KacraeRepoGraph {
		const pathSet = new Set<string>(records.keys());
		const edges: KacraeRepoGraphEdge[] = [];
		const importsMap = new Map<string, Set<string>>();
		const importedByMap = new Map<string, Set<string>>();

		const resolveRelativeImport = (fromRel: string, spec: string): string | null => {
			if (!spec.startsWith('.')) { return null; }
			const fromDir = path.posix.dirname(fromRel);
			const joined = normRel(path.posix.normalize(path.posix.join(fromDir, spec)));
			const candidates = [
				joined,
				joined.replace(/\.js$/, '.ts'),
				joined.replace(/\.js$/, '.tsx'),
				`${joined}.ts`, `${joined}.tsx`, `${joined}.js`, `${joined}.jsx`, `${joined}.mjs`, `${joined}.py`,
				`${joined}/index.ts`, `${joined}/index.tsx`, `${joined}/index.js`,
			];
			for (const c of candidates) {
				if (pathSet.has(c)) { return c; }
			}
			return null;
		};

		for (const rec of records.values()) {
			for (const spec of rec.rawImports) {
				const target = resolveRelativeImport(rec.relPath, spec);
				if (!target || target === rec.relPath) { continue; }
				if (!importsMap.has(rec.relPath)) { importsMap.set(rec.relPath, new Set()); }
				importsMap.get(rec.relPath)!.add(target);
				if (!importedByMap.has(target)) { importedByMap.set(target, new Set()); }
				importedByMap.get(target)!.add(rec.relPath);
				edges.push({
					from: rec.relPath,
					to: target,
					kind: rec.kind === 'test' ? 'tests' : 'imports',
				});
			}
		}

		// Detect cycles via bounded iterative DFS
		const cycles: string[][] = [];
		const seenCycleKey = new Set<string>();
		const visited = new Set<string>();
		const onStack = new Set<string>();
		const stack: string[] = [];

		const dfs = (u: string, depth: number) => {
			if (cycles.length >= 25 || depth > 40) { return; }
			visited.add(u);
			onStack.add(u);
			stack.push(u);
			for (const v of importsMap.get(u) ?? []) {
				if (onStack.has(v)) {
					const idx = stack.indexOf(v);
					if (idx >= 0) {
						const cyc = stack.slice(idx);
						const key = [...cyc].sort().join('|');
						if (!seenCycleKey.has(key)) {
							seenCycleKey.add(key);
							cycles.push(cyc);
						}
					}
				} else if (!visited.has(v)) {
					dfs(v, depth + 1);
				}
			}
			stack.pop();
			onStack.delete(u);
		};
		for (const id of records.keys()) {
			if (!visited.has(id)) { dfs(id, 0); }
			if (cycles.length >= 25) { break; }
		}

		const testPaths = [...records.values()].filter(r => r.kind === 'test').map(r => r.relPath);
		const allNodes: KacraeRepoGraphNode[] = [];
		const layers: Record<KacraeRepoGraphNode['layer'], string[]> = {
			frontend: [], backend: [], api: [], data: [], auth: [], test: [], infra: [], shared: [],
		};
		const layeringViolations: { from: string; to: string; reason: string }[] = [];
		const highCouplingModules: { id: string; fanIn: number; fanOut: number; instability: number }[] = [];
		const singlePointsOfFailure: string[] = [];
		const securityBoundaries: { file: string; kind: string; routes: string[] }[] = [];

		for (const rec of records.values()) {
			const imp = [...(importsMap.get(rec.relPath) ?? [])];
			const impBy = [...(importedByMap.get(rec.relPath) ?? [])];
			const fanIn = impBy.length;
			const fanOut = imp.length;
			const instability = fanIn + fanOut > 0 ? Number((fanOut / (fanIn + fanOut)).toFixed(2)) : 0;
			const baseStem = path.basename(rec.relPath, path.extname(rec.relPath)).toLowerCase();
			const relatedTests = rec.kind === 'test' ? [] : [
				...new Set([
					...impBy.filter(p => isTestPath(p)),
					...testPaths.filter(tp => baseStem.length >= 3 && tp.toLowerCase().includes(baseStem)),
				]),
			].slice(0, 10);

			layers[rec.layer].push(rec.relPath);

			if (fanIn >= 5 && fanOut >= 3) {
				highCouplingModules.push({ id: rec.relPath, fanIn, fanOut, instability });
			}
			if (fanIn >= 6) {
				singlePointsOfFailure.push(rec.relPath);
			}
			if (rec.hasAuthBoundary || rec.apiEndpoints.length > 0) {
				securityBoundaries.push({
					file: rec.relPath,
					kind: rec.hasAuthBoundary ? 'auth_boundary' : 'api_entry',
					routes: [...rec.apiEndpoints],
				});
			}

			// Layering rule: frontend should not directly import data/database layer
			if (rec.layer === 'frontend') {
				for (const target of imp) {
					const targetRec = records.get(target);
					if (targetRec?.layer === 'data') {
						layeringViolations.push({
							from: rec.relPath,
							to: target,
							reason: 'Frontend/UI module directly imports database/data-access module, bypassing API/service boundary.',
						});
					}
				}
			}

			allNodes.push({
				id: rec.relPath,
				label: path.basename(rec.relPath),
				kind: rec.kind,
				layer: rec.layer,
				language: rec.language,
				lines: rec.lines,
				symbolCount: rec.exportedSymbols.length,
				exportedSymbols: rec.exportedSymbols,
				apiEndpoints: rec.apiEndpoints,
				dbTables: rec.dbTables,
				imports: imp,
				importedBy: impBy,
				relatedTests,
				findingCount: 0,
				couplingInstability: instability,
			});
		}

		// Progressive rendering cap so millions of nodes are NEVER dumped into a browser DOM!
		const truncatedForRender = allNodes.length > MAX_GRAPH_NODES_FOR_RENDER;
		const prioritizedNodes = truncatedForRender
			? [...allNodes]
				.sort((a, b) => (b.importedBy.length + b.imports.length + b.apiEndpoints.length * 3) - (a.importedBy.length + a.imports.length + a.apiEndpoints.length * 3))
				.slice(0, MAX_GRAPH_NODES_FOR_RENDER)
			: allNodes;
		const renderedIdSet = new Set(prioritizedNodes.map(n => n.id));
		const renderedEdges = truncatedForRender
			? edges.filter(e => renderedIdSet.has(e.from) && renderedIdSet.has(e.to)).slice(0, 1200)
			: edges;

		const topology: KacraeArchitectureTopology = {
			layers,
			cycles,
			layeringViolations: layeringViolations.slice(0, 50),
			highCouplingModules: highCouplingModules.sort((a, b) => (b.fanIn + b.fanOut) - (a.fanIn + a.fanOut)).slice(0, 25),
			singlePointsOfFailure: singlePointsOfFailure.slice(0, 20),
			securityBoundaries: securityBoundaries.slice(0, 40),
		};

		return {
			builtAt: new Date().toISOString(),
			totalNodeCount: allNodes.length,
			totalEdgeCount: edges.length,
			truncatedForRender,
			nodes: prioritizedNodes,
			edges: renderedEdges,
			topology,
		};
	}

	computeBlastRadius(graph: KacraeRepoGraph, target: string): KacraeBlastRadiusReport {
		const norm = normRel(target);
		const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));
		const startNode = nodeMap.get(norm)
			?? graph.nodes.find(n => n.id.endsWith(`/${norm}`) || n.label.toLowerCase() === norm.toLowerCase());

		if (!startNode) {
			return {
				target,
				found: false,
				riskLevel: 'low',
				directlyAffectedFiles: [],
				indirectlyAffectedFiles: [],
				affectedApis: [],
				affectedDbTables: [],
				coveringTests: [],
				securityBoundaryCrossed: false,
				summary: `Component "${target}" not found in indexed repository graph.`,
			};
		}

		const direct = new Set(startNode.importedBy);
		const indirect = new Set<string>();
		const queue = [...direct];
		const visited = new Set<string>([startNode.id, ...direct]);

		while (queue.length > 0 && indirect.size < 200) {
			const cur = queue.shift()!;
			const curNode = nodeMap.get(cur);
			if (!curNode) { continue; }
			for (const dep of curNode.importedBy) {
				if (!visited.has(dep)) {
					visited.add(dep);
					indirect.add(dep);
					queue.push(dep);
				}
			}
		}

		const affectedIds = [startNode.id, ...direct, ...indirect];
		const affectedApis = new Set<string>();
		const affectedDbTables = new Set<string>();
		const coveringTests = new Set<string>(startNode.relatedTests);
		let securityBoundaryCrossed = startNode.layer === 'auth' || startNode.apiEndpoints.length > 0;

		for (const id of affectedIds) {
			const n = nodeMap.get(id);
			if (!n) { continue; }
			for (const a of n.apiEndpoints) { affectedApis.add(a); }
			for (const t of n.dbTables) { affectedDbTables.add(t); }
			for (const tst of n.relatedTests) { coveringTests.add(tst); }
			if (n.layer === 'auth') { securityBoundaryCrossed = true; }
		}

		const totalBlast = direct.size + indirect.size;
		const riskLevel: KacraeBlastRadiusReport['riskLevel'] =
			(securityBoundaryCrossed && totalBlast >= 3) || totalBlast >= 12 ? 'critical' :
			securityBoundaryCrossed || totalBlast >= 5 || affectedApis.size > 0 ? 'high' :
			totalBlast >= 2 || affectedDbTables.size > 0 ? 'medium' : 'low';

		return {
			target: startNode.id,
			found: true,
			riskLevel,
			directlyAffectedFiles: [...direct],
			indirectlyAffectedFiles: [...indirect],
			affectedApis: [...affectedApis],
			affectedDbTables: [...affectedDbTables],
			coveringTests: [...coveringTests],
			securityBoundaryCrossed,
			summary: `Changing ${startNode.id} directly impacts ${direct.size} file(s), transitively impacts ${indirect.size} file(s), touches ${affectedApis.size} API(s) and ${affectedDbTables.size} DB table(s), with ${coveringTests.size} covering test(s). Risk: ${riskLevel.toUpperCase()}.`,
		};
	}
}

