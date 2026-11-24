/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import * as cp from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ScannedSourceFile } from '../common/projectHealth.js';
import {
	IKodiaUniversalAppBuilderMainService,
	IrireConnectionTestResult,
	IrireExternalRequirement,
	IrireIntegrationMode,
	UabeActivityEvent,
	UabeBriefSourceType,
	UabeBuildMode,
	UabeCheckpointRecord,
	UabeCloudAdapterInfo,
	UabeContractAnalysis,
	UabeExecutionPhase,
	UabeHandoverPackageResult,
	UabeInitProjectRequest,
	UabePlatformTarget,
	UabePreviewState,
	UabeProjectState,
	UabeReliabilityDashboardReport,
	UabeScaffoldResult,
	UabeStackRecommendation,
	UabeVisualEditRequest,
	UabeVisualEditResult,
} from '../common/universalAppBuilderTypes.js';
import {
	applyVisualEditToSourceCode,
	buildHandoverDocuments,
	buildTruthfulReliabilityReport,
	discoverExternalRequirements,
	extractContractToProduct,
	getCloudAdapterCatalog,
	maskSecretValue,
	recommendUniversalStack,
} from '../common/universalAppBuilderEngine.js';
import { FirstPassReliabilityCoreService } from './firstPassReliabilityCore.js';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.kodia', 'handover', '__pycache__', '.venv']);

function scanFiles(workspaceRoot: string, maxFiles = 200): ScannedSourceFile[] {
	const out: ScannedSourceFile[] = [];
	if (!workspaceRoot || !fs.existsSync(workspaceRoot)) return out;
	const walk = (dir: string, depth: number) => {
		if (out.length >= maxFiles || depth > 6) return;
		let entries: fs.Dirent[];
		try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
		for (const e of entries) {
			if (out.length >= maxFiles) break;
			if (e.isDirectory()) {
				if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), depth + 1);
			} else if (e.isFile() && /\.(ts|tsx|js|jsx|mjs|cjs|py|html|css|json|sql|prisma|dart|kt|swift|env|example)$/i.test(e.name)) {
				const abs = path.join(dir, e.name);
				try {
					if (fs.statSync(abs).size > 150_000) continue;
					out.push({ relativePath: path.relative(workspaceRoot, abs).replace(/\\/g, '/'), content: fs.readFileSync(abs, 'utf8') });
				} catch { /* skip */ }
			}
		}
	};
	walk(workspaceRoot, 0);
	return out;
}

function runShell(command: string, cwd: string, timeoutMs = 30_000): Promise<{ ok: boolean; exitCode: number; output: string }> {
	return new Promise(resolve => {
		let out = '';
		const proc = cp.spawn(command, { cwd, shell: true, windowsHide: true });
		const timer = setTimeout(() => {
			try {
				if (process.platform === 'win32' && proc.pid) {
					cp.spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true, timeout: 3000 });
				} else {
					proc.kill('SIGKILL');
				}
			} catch { /* ignore */ }
		}, timeoutMs);
		proc.stdout?.on('data', d => { out += String(d); });
		proc.stderr?.on('data', d => { out += String(d); });
		proc.on('close', code => {
			clearTimeout(timer);
			resolve({ ok: code === 0, exitCode: code ?? 1, output: out.trim().slice(0, 3000) });
		});
		proc.on('error', err => {
			clearTimeout(timer);
			resolve({ ok: false, exitCode: 1, output: err.message });
		});
	});
}

// Machine-scoped AES-256-GCM encryption for local secret vault (.kodia/app-builder/secrets.vault.json)
function deriveVaultKey(workspaceRoot: string): Buffer {
	const seed = `kodia-uabe-vault::${os.hostname()}::${os.userInfo().username}::${path.resolve(workspaceRoot).toLowerCase()}`;
	return crypto.createHash('sha256').update(seed).digest();
}

function encryptSecret(workspaceRoot: string, plaintext: string): string {
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv('aes-256-gcm', deriveVaultKey(workspaceRoot), iv);
	const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

function decryptSecret(workspaceRoot: string, payload: string): string | undefined {
	try {
		const parts = payload.split(':');
		if (parts.length !== 4 || parts[0] !== 'v1') return undefined;
		const decipher = crypto.createDecipheriv('aes-256-gcm', deriveVaultKey(workspaceRoot), Buffer.from(parts[1], 'base64'));
		decipher.setAuthTag(Buffer.from(parts[2], 'base64'));
		return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64')), decipher.final()]).toString('utf8');
	} catch {
		return undefined;
	}
}

export class UniversalAppBuilderCoreService extends Disposable implements IKodiaUniversalAppBuilderMainService {
	readonly _serviceBrand: undefined;

	private readonly _onDidEmitEvent = this._register(new Emitter<UabeActivityEvent>());
	readonly onDidEmitEvent = this._onDidEmitEvent.event;

	private readonly _onDidChangeProject = this._register(new Emitter<UabeProjectState>());
	readonly onDidChangeProject = this._onDidChangeProject.event;

	private readonly _fpere: FirstPassReliabilityCoreService;
	private _seq = 0;
	private _states = new Map<string, UabeProjectState>();

	constructor(fpere?: FirstPassReliabilityCoreService) {
		super();
		this._fpere = fpere ?? this._register(new FirstPassReliabilityCoreService());
	}

	private _uabeDir(workspaceRoot: string): string {
		const dir = path.join(workspaceRoot, '.kodia', 'app-builder');
		fs.mkdirSync(dir, { recursive: true });
		return dir;
	}

	private _persistState(workspaceRoot: string, state: UabeProjectState): void {
		if (!workspaceRoot || !fs.existsSync(workspaceRoot)) return;
		try {
			fs.writeFileSync(path.join(this._uabeDir(workspaceRoot), 'project.json'), JSON.stringify(state, null, 2), 'utf8');
		} catch { /* non-fatal */ }
	}

	private _loadSecrets(workspaceRoot: string): Record<string, string> {
		if (!workspaceRoot) return {};
		const fp = path.join(workspaceRoot, '.kodia', 'app-builder', 'secrets.vault.json');
		if (!fs.existsSync(fp)) return {};
		try {
			const encMap = JSON.parse(fs.readFileSync(fp, 'utf8')) as Record<string, string>;
			const out: Record<string, string> = {};
			for (const [k, v] of Object.entries(encMap)) {
				const dec = decryptSecret(workspaceRoot, v);
				if (dec !== undefined) out[k] = dec;
			}
			return out;
		} catch {
			return {};
		}
	}

	private _saveSecret(workspaceRoot: string, envVarName: string, secretValue: string): void {
		const dir = this._uabeDir(workspaceRoot);
		const fp = path.join(dir, 'secrets.vault.json');
		let encMap: Record<string, string> = {};
		if (fs.existsSync(fp)) {
			try { encMap = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { encMap = {}; }
		}
		encMap[envVarName] = encryptSecret(workspaceRoot, secretValue);
		fs.writeFileSync(fp, JSON.stringify(encMap, null, 2), 'utf8');
	}

	private _getOrInit(workspaceRoot: string): UabeProjectState {
		const existing = this._states.get(workspaceRoot);
		if (existing) return existing;
		if (workspaceRoot) {
			const fp = path.join(workspaceRoot, '.kodia', 'app-builder', 'project.json');
			if (fs.existsSync(fp)) {
				try {
					const parsed = JSON.parse(fs.readFileSync(fp, 'utf8')) as UabeProjectState;
					this._states.set(workspaceRoot, parsed);
					return parsed;
				} catch { /* recreate */ }
			}
		}
		const now = Date.now();
		const fresh: UabeProjectState = {
			projectId: `uabe-${crypto.randomBytes(4).toString('hex')}`,
			name: workspaceRoot ? path.basename(workspaceRoot) : 'New Kodia App',
			brief: '',
			workspaceRoot,
			buildMode: 'autonomous_build',
			phase: 'idle',
			platforms: ['web'],
			integrations: [],
			preview: {
				url: 'http://localhost:3000',
				status: 'stopped',
				viewport: 'desktop',
				width: 1440,
				height: 900,
				visualEditEnabled: false,
				consoleErrors: [],
				networkFailures: [],
			},
			checkpoints: [],
			recentEvents: [],
			createdAtMs: now,
			updatedAtMs: now,
		};
		this._states.set(workspaceRoot, fresh);
		return fresh;
	}

	private _emit(
		workspaceRoot: string,
		phase: UabeExecutionPhase,
		message: string,
		severity: UabeActivityEvent['severity'] = 'info',
		patch?: Partial<UabeProjectState>,
	): UabeProjectState {
		const cur = this._getOrInit(workspaceRoot);
		const ev: UabeActivityEvent = {
			id: `uabe-ev-${++this._seq}-${Date.now()}`,
			sequence: this._seq,
			timestampMs: Date.now(),
			phase,
			severity,
			message,
		};
		const next: UabeProjectState = {
			...cur,
			...patch,
			phase,
			updatedAtMs: Date.now(),
			recentEvents: [ev, ...cur.recentEvents].slice(0, 50),
		};
		this._states.set(workspaceRoot, next);
		this._persistState(workspaceRoot, next);
		this._onDidEmitEvent.fire(ev);
		this._onDidChangeProject.fire(next);
		return next;
	}

	async getProjectState(workspaceRoot: string): Promise<UabeProjectState> {
		return this._getOrInit(workspaceRoot);
	}

	async initializeProject(workspaceRoot: string, req: UabeInitProjectRequest): Promise<UabeProjectState> {
		const cur = this._getOrInit(workspaceRoot);
		const analysis = extractContractToProduct(req.brief, req.sourceType ?? 'idea', req.preferredPlatforms);
		let existingDeps: Record<string, string> | undefined;
		const pkgPath = path.join(workspaceRoot, 'package.json');
		if (workspaceRoot && fs.existsSync(pkgPath)) {
			try {
				const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
				existingDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
			} catch { /* ignore */ }
		}
		const stack = recommendUniversalStack(analysis, req.preferredStack, existingDeps);
		const files = scanFiles(workspaceRoot);
		const secrets = this._loadSecrets(workspaceRoot);
		const integrations = discoverExternalRequirements(req.brief, stack, files, secrets);
		const mode = req.buildMode ?? cur.buildMode ?? 'autonomous_build';
		const hasPendingMandatory = integrations.some(i => i.classification === 'mandatory' && !i.configured);

		return this._emit(
			workspaceRoot,
			hasPendingMandatory ? 'waiting_for_credentials' : 'designing_architecture',
			`Initialized "${req.name || analysis.projectTitle}" (${mode}) — ${analysis.requirements.length} requirement(s), ${integrations.length} external requirement(s) discovered.`,
			hasPendingMandatory ? 'warning' : 'success',
			{
				name: req.name || analysis.projectTitle,
				brief: req.brief,
				buildMode: mode,
				platforms: analysis.detectedPlatforms,
				contractAnalysis: analysis,
				stack,
				integrations,
			},
		);
	}

	async setProjectBuildMode(workspaceRoot: string, mode: UabeBuildMode): Promise<UabeProjectState> {
		return this._emit(
			workspaceRoot,
			this._getOrInit(workspaceRoot).phase,
			`Project build mode updated to "${mode}" (persisted per-project).`,
			'info',
			{ buildMode: mode },
		);
	}

	async analyzeContractOrBrief(workspaceRoot: string, req: { brief: string; sourceType?: UabeBriefSourceType }): Promise<UabeContractAnalysis> {
		const analysis = extractContractToProduct(req.brief, req.sourceType ?? 'contract');
		this._emit(
			workspaceRoot,
			'understanding_requirements',
			`Extracted ${analysis.requirements.length} traceable requirement(s) from ${analysis.sourceType} for "${analysis.projectTitle}".`,
			'success',
			{ brief: req.brief, contractAnalysis: analysis, platforms: analysis.detectedPlatforms },
		);
		return analysis;
	}

	async recommendStack(workspaceRoot: string, req?: { preferredStack?: string; preferredPlatforms?: readonly UabePlatformTarget[] }): Promise<UabeStackRecommendation> {
		const cur = this._getOrInit(workspaceRoot);
		const analysis = cur.contractAnalysis ?? extractContractToProduct(cur.brief || cur.name, 'idea', req?.preferredPlatforms);
		let existingDeps: Record<string, string> | undefined;
		const pkgPath = path.join(workspaceRoot, 'package.json');
		if (workspaceRoot && fs.existsSync(pkgPath)) {
			try {
				const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
				existingDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
			} catch { /* ignore */ }
		}
		const stack = recommendUniversalStack(analysis, req?.preferredStack, existingDeps);
		this._emit(workspaceRoot, 'designing_architecture', stack.rationale, 'success', { stack });
		return stack;
	}

	async discoverExternalRequirements(workspaceRoot: string, briefOverride?: string): Promise<readonly IrireExternalRequirement[]> {
		const cur = this._getOrInit(workspaceRoot);
		const files = scanFiles(workspaceRoot);
		const secrets = this._loadSecrets(workspaceRoot);
		const integrations = discoverExternalRequirements(briefOverride ?? cur.brief, cur.stack, files, secrets);
		const pending = integrations.filter(i => i.classification === 'mandatory' && !i.configured).length;
		this._emit(
			workspaceRoot,
			pending > 0 ? 'waiting_for_credentials' : 'configuring_integrations',
			`IRIRE discovered ${integrations.length} external requirement(s) (${pending} mandatory pending credentials).`,
			pending > 0 ? 'warning' : 'success',
			{ integrations },
		);
		return integrations;
	}

	async configureIntegrationSecret(
		workspaceRoot: string,
		req: { requirementId: string; envVarName: string; secretValue: string; mode?: IrireIntegrationMode },
	): Promise<{ ok: boolean; requirement?: IrireExternalRequirement; message: string }> {
		if (!req.secretValue.trim()) {
			return { ok: false, message: 'Refused to save empty credential value.' };
		}
		this._saveSecret(workspaceRoot, req.envVarName, req.secretValue.trim());

		const cur = this._getOrInit(workspaceRoot);
		let matched: IrireExternalRequirement | undefined;
		const updated = cur.integrations.map(item => {
			if (item.id === req.requirementId || item.envVarName === req.envVarName) {
				matched = {
					...item,
					configured: true,
					maskedValue: maskSecretValue(req.secretValue),
					mode: req.mode ?? 'local_dev',
				};
				return matched;
			}
			return item;
		});

		this._emit(
			workspaceRoot,
			'configuring_integrations',
			`Saved encrypted credential for ${req.envVarName} (${maskSecretValue(req.secretValue)}) in local Kodia vault.`,
			'success',
			{ integrations: updated },
		);
		return {
			ok: true,
			requirement: matched,
			message: `Credential ${req.envVarName} encrypted and stored securely (not placed in source code or handover files).`,
		};
	}

	async testIntegrationConnection(workspaceRoot: string, requirementId: string): Promise<IrireConnectionTestResult> {
		const cur = this._getOrInit(workspaceRoot);
		const item = cur.integrations.find(i => i.id === requirementId || i.envVarName === requirementId);
		const secrets = this._loadSecrets(workspaceRoot);
		const now = Date.now();

		if (!item) {
			return {
				requirementId,
				providerName: 'Unknown',
				envVarName: requirementId,
				ok: false,
				mode: 'failed',
				formatValid: false,
				liveChecked: false,
				message: `Integration requirement "${requirementId}" not found.`,
				testedAtMs: now,
			};
		}

		const val = secrets[item.envVarName]?.trim() ?? '';
		if (!val) {
			return {
				requirementId: item.id,
				providerName: item.providerName,
				envVarName: item.envVarName,
				ok: false,
				mode: 'pending_credentials',
				formatValid: false,
				liveChecked: false,
				message: `No credential stored for ${item.envVarName}. Follow the guided setup steps to add it.`,
				testedAtMs: now,
			};
		}

		// Format validation per provider (honest: format check alone never claims live_verified!)
		let formatValid = val.length >= 8;
		let formatReason = 'Credential format valid.';
		if (item.envVarName === 'MONGODB_URI' && !/^mongodb(\+srv)?:\/\//.test(val)) {
			formatValid = false;
			formatReason = 'MONGODB_URI must begin with mongodb:// or mongodb+srv://.';
		} else if (item.envVarName === 'DATABASE_URL' && !/^(postgres(ql)?|mysql|sqlite|file):/i.test(val)) {
			formatValid = false;
			formatReason = 'DATABASE_URL must begin with postgresql://, mysql://, or file:.';
		} else if (item.envVarName === 'NVIDIA_API_KEY' && !/^nvapi-/.test(val)) {
			formatValid = false;
			formatReason = 'NVIDIA API keys typically start with nvapi-.';
		} else if (item.envVarName === 'STRIPE_SECRET_KEY' && !/^sk_(test|live)_/.test(val)) {
			formatValid = false;
			formatReason = 'Stripe secret keys must start with sk_test_ or sk_live_.';
		} else if (item.envVarName === 'SUPABASE_URL' && !/^https?:\/\//.test(val)) {
			formatValid = false;
			formatReason = 'SUPABASE_URL must be an https:// URL.';
		}

		const mode: IrireIntegrationMode = !formatValid ? 'failed' : /^sk_test_/.test(val) ? 'sandbox' : 'local_dev';
		const message = formatValid
			? `${formatReason} Stored securely (live remote provider call requires authorized network test — marked "${mode}", not falsely marked live_verified).`
			: `Credential format check failed: ${formatReason}`;

		const updated = cur.integrations.map(i => i.id === item.id ? { ...i, mode, lastTestedAtMs: now, lastTestMessage: message } : i);
		this._emit(workspaceRoot, 'configuring_integrations', `${item.providerName}: ${message}`, formatValid ? 'success' : 'error', { integrations: updated });

		return {
			requirementId: item.id,
			providerName: item.providerName,
			envVarName: item.envVarName,
			ok: formatValid,
			mode,
			formatValid,
			liveChecked: false,
			message,
			testedAtMs: now,
		};
	}

	async listCloudAdapters(): Promise<readonly UabeCloudAdapterInfo[]> {
		return getCloudAdapterCatalog();
	}

	async applyVisualEdit(workspaceRoot: string, req: UabeVisualEditRequest): Promise<UabeVisualEditResult> {
		const abs = path.isAbsolute(req.filePath) ? req.filePath : path.join(workspaceRoot, req.filePath);
		if (!fs.existsSync(abs)) {
			return { applied: false, filePath: req.filePath, summary: `Target file not found: ${req.filePath}`, limitationReason: 'File does not exist on disk.' };
		}
		const rel = path.relative(workspaceRoot, abs).replace(/\\/g, '/');
		const content = fs.readFileSync(abs, 'utf8');
		const res = applyVisualEditToSourceCode(content, { ...req, filePath: rel });
		if (!res.applied || res.updatedContent === undefined) {
			return res;
		}
		const cpRec = await this.createCheckpoint(workspaceRoot, `Before visual edit (${rel}:${res.matchedLine})`, [rel]);
		fs.writeFileSync(abs, res.updatedContent, 'utf8');
		this._emit(workspaceRoot, 'implementing', res.summary, 'success');
		return {
			applied: true,
			filePath: rel,
			checkpointId: cpRec.id,
			matchedLine: res.matchedLine,
			beforeSnippet: res.beforeSnippet,
			afterSnippet: res.afterSnippet,
			summary: res.summary,
		};
	}

	async updatePreviewState(workspaceRoot: string, patch: Partial<UabePreviewState>): Promise<UabePreviewState> {
		const cur = this._getOrInit(workspaceRoot);
		const nextPreview: UabePreviewState = { ...cur.preview, ...patch, lastCheckedAtMs: Date.now() };
		this._emit(
			workspaceRoot,
			nextPreview.status === 'running' ? 'preview_running' : cur.phase,
			`Preview updated: ${nextPreview.url} (${nextPreview.status}, ${nextPreview.viewport} ${nextPreview.width}x${nextPreview.height})`,
			nextPreview.status === 'error' ? 'error' : 'info',
			{ preview: nextPreview },
		);
		return nextPreview;
	}

	async scaffoldApplication(
		workspaceRoot: string,
		req: { template: 'website' | 'fullstack_business' | 'ai_app' | 'mobile_rn' | 'desktop_electron'; appName: string },
	): Promise<UabeScaffoldResult> {
		const safeTitle = req.appName.trim() || 'Kodia App';
		const written: string[] = [];
		const writeFile = (rel: string, content: string) => {
			const abs = path.join(workspaceRoot, rel);
			fs.mkdirSync(path.dirname(abs), { recursive: true });
			fs.writeFileSync(abs, content, 'utf8');
			written.push(rel);
		};

		let testCommand = 'node --test';
		let startCommand = 'node src/server.mjs';

		if (req.template === 'website') {
			writeFile('package.json', JSON.stringify({ name: safeTitle.toLowerCase().replace(/[^a-z0-9-]/g, '-'), version: '1.0.0', type: 'module', scripts: { test: 'node --test', build: 'node -e "console.log(\'build ok\')"' } }, null, 2));
			writeFile('public/index.html', `<!DOCTYPE html>\n<html lang="en">\n<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${safeTitle}</title><link rel="stylesheet" href="./styles.css"></head>\n<body>\n  <main class="hero">\n    <h1 class="hero-title">${safeTitle}</h1>\n    <p class="hero-subtitle">Built cleanly with Kodia Universal App Builder Engine.</p>\n    <button id="cta-btn" class="btn-primary">Get Started</button>\n  </main>\n</body>\n</html>\n`);
			writeFile('public/styles.css', `:root { --bg: #0f172a; --fg: #f8fafc; --accent: #38bdf8; }\nbody { margin: 0; font-family: system-ui, sans-serif; background: var(--bg); color: var(--fg); }\n.hero { max-width: 960px; margin: 0 auto; padding: 64px 24px; }\n.btn-primary { background: var(--accent); color: #0f172a; border: 0; padding: 12px 20px; border-radius: 8px; font-weight: 600; cursor: pointer; }\n`);
			writeFile('tests/website.test.mjs', `import assert from 'node:assert/strict';\nimport fs from 'node:fs';\nimport test from 'node:test';\ntest('index.html contains app title and responsive viewport', () => {\n  const html = fs.readFileSync('public/index.html', 'utf8');\n  assert.ok(html.includes('${safeTitle}'));\n  assert.ok(html.includes('name="viewport"'));\n});\n`);
			startCommand = 'npx serve public';
		} else if (req.template === 'fullstack_business') {
			writeFile('package.json', JSON.stringify({ name: safeTitle.toLowerCase().replace(/[^a-z0-9-]/g, '-'), version: '1.0.0', type: 'module', scripts: { start: 'node src/server.mjs', test: 'node --test' } }, null, 2));
			writeFile('src/store.mjs', `export function createItemStore() {\n  const items = new Map();\n  let seq = 1;\n  return {\n    list(q = '') { const all = [...items.values()]; return q ? all.filter(i => i.name.toLowerCase().includes(q.toLowerCase())) : all; },\n    create(name, role = 'user') { if (!name || !name.trim()) throw new Error('name required'); const item = { id: seq++, name: name.trim(), role, createdAt: Date.now() }; items.set(item.id, item); return item; },\n    remove(id) { return items.delete(Number(id)); },\n  };\n}\n`);
			writeFile('src/server.mjs', `import http from 'node:http';\nimport { createItemStore } from './store.mjs';\nexport function createAppServer(store = createItemStore()) {\n  return http.createServer(async (req, res) => {\n    const url = new URL(req.url || '/', 'http://localhost');\n    if (req.method === 'GET' && url.pathname === '/api/items') {\n      res.writeHead(200, { 'Content-Type': 'application/json' });\n      return res.end(JSON.stringify({ items: store.list(url.searchParams.get('q') || '') }));\n    }\n    if (req.method === 'POST' && url.pathname === '/api/items') {\n      let body = ''; for await (const chunk of req) body += chunk;\n      const parsed = JSON.parse(body || '{}');\n      const created = store.create(parsed.name, parsed.role);\n      res.writeHead(201, { 'Content-Type': 'application/json' });\n      return res.end(JSON.stringify(created));\n    }\n    res.writeHead(404, { 'Content-Type': 'application/json' });\n    res.end(JSON.stringify({ error: 'Not found' }));\n  });\n}\n`);
			writeFile('src/client.mjs', `export async function fetchItems(baseUrl, query = '') {\n  const res = await fetch(\`\${baseUrl}/api/items?q=\${encodeURIComponent(query)}\`);\n  if (!res.ok) throw new Error(\`HTTP \${res.status}\`);\n  return res.json();\n}\n`);
			writeFile('tests/fullstack.test.mjs', `import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { createItemStore } from '../src/store.mjs';\ntest('CRUD store creates, filters, and deletes items', () => {\n  const s = createItemStore();\n  const a = s.create('Invoice #101', 'admin');\n  s.create('Order #202', 'staff');\n  assert.strictEqual(s.list('invoice').length, 1);\n  assert.strictEqual(s.remove(a.id), true);\n  assert.strictEqual(s.list().length, 1);\n});\n`);
		} else if (req.template === 'ai_app') {
			writeFile('package.json', JSON.stringify({ name: safeTitle.toLowerCase().replace(/[^a-z0-9-]/g, '-'), version: '1.0.0', type: 'module', scripts: { start: 'node src/aiProxy.mjs', test: 'node --test' } }, null, 2));
			writeFile('.env.example', `AI_PROVIDER_API_KEY=\nAI_MODEL_ID=\n`);
			writeFile('src/aiProxy.mjs', `export function getAiRuntimeStatus(env = process.env) {\n  const apiKey = (env.AI_PROVIDER_API_KEY || '').trim();\n  const modelId = (env.AI_MODEL_ID || '').trim();\n  if (!apiKey) return { ready: false, mode: 'pending_credentials', message: 'Set AI_PROVIDER_API_KEY in server environment (never in browser code).' };\n  return { ready: true, mode: 'configured', modelId: modelId || 'verify-via-lei' };\n}\n`);
			writeFile('tests/aiProxy.test.mjs', `import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { getAiRuntimeStatus } from '../src/aiProxy.mjs';\ntest('reports pending_credentials honestly when API key is missing', () => {\n  const status = getAiRuntimeStatus({});\n  assert.strictEqual(status.ready, false);\n  assert.strictEqual(status.mode, 'pending_credentials');\n});\n`);
			startCommand = 'node src/aiProxy.mjs';
		} else if (req.template === 'desktop_electron') {
			writeFile('package.json', JSON.stringify({ name: safeTitle.toLowerCase().replace(/[^a-z0-9-]/g, '-'), version: '1.0.0', main: 'src/main.cjs', scripts: { test: 'node --test' } }, null, 2));
			writeFile('src/preload.cjs', `// Secure context-isolated desktop preload bridge\nmodule.exports = { appName: '${safeTitle}', contextIsolation: true, nodeIntegration: false };\n`);
			writeFile('src/renderer.html', `<!DOCTYPE html><html><body><h1>${safeTitle} Desktop</h1></body></html>\n`);
			writeFile('tests/desktop.test.mjs', `import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { createRequire } from 'node:module';\nconst req = createRequire(import.meta.url);\ntest('preload enforces contextIsolation and disables nodeIntegration', () => {\n  const p = req('../src/preload.cjs');\n  assert.strictEqual(p.contextIsolation, true);\n  assert.strictEqual(p.nodeIntegration, false);\n});\n`);
			startCommand = 'npx electron .';
		} else {
			writeFile('package.json', JSON.stringify({ name: safeTitle.toLowerCase().replace(/[^a-z0-9-]/g, '-'), version: '1.0.0', type: 'module', scripts: { test: 'node --test' } }, null, 2));
			writeFile('src/AppScreen.tsx', `export function AppScreen() { return '${safeTitle} Mobile Screen'; }\n`);
			writeFile('tests/mobile.test.mjs', `import assert from 'node:assert/strict';\nimport fs from 'node:fs';\nimport test from 'node:test';\ntest('mobile screen file exists', () => {\n  assert.ok(fs.readFileSync('src/AppScreen.tsx', 'utf8').includes('${safeTitle}'));\n});\n`);
			startCommand = 'npx expo start';
		}

		const cpRec = await this.createCheckpoint(workspaceRoot, `Scaffolded ${req.template}: ${safeTitle}`, written);
		this._emit(workspaceRoot, 'implementing', `Scaffolded ${req.template} application "${safeTitle}" (${written.length} files).`, 'success');
		return {
			template: req.template,
			filesWritten: written,
			checkpointId: cpRec.id,
			testCommand,
			startCommand,
			summary: `Scaffolded "${safeTitle}" (${req.template}) with ${written.length} file(s). Run \`${testCommand}\` to verify.`,
		};
	}

	async evaluateReliabilityDashboard(
		workspaceRoot: string,
		opts?: { runCompiler?: boolean; testCommand?: string; buildCommand?: string },
	): Promise<UabeReliabilityDashboardReport> {
		const cur = this._getOrInit(workspaceRoot);
		const importReport = await this._fpere.validateImportsAndExports(workspaceRoot);
		const integrationReport = await this._fpere.checkFullStackIntegration(workspaceRoot);
		const semanticReport = await this._fpere.analyzeSemanticCorrectness(workspaceRoot);
		const apiVerification = await this._fpere.verifyInstalledApiUsage(workspaceRoot);

		let compilerRan = false;
		let compilerErrors = 0;
		if (opts?.runCompiler) {
			const gate = await this._fpere.runFirstPassQualityGate(workspaceRoot, { runCompiler: true });
			const compCheck = gate.checks.find(c => c.name.includes('Compiler'));
			compilerRan = Boolean(compCheck?.executed);
			compilerErrors = gate.compilerErrors;
		}

		let testRan = false;
		let testPassed = false;
		let testDetail: string | undefined;
		if (opts?.testCommand) {
			testRan = true;
			const tr = await runShell(opts.testCommand, workspaceRoot, 35_000);
			testPassed = tr.ok;
			testDetail = tr.ok ? `Passed: ${opts.testCommand}` : `Failed (exit ${tr.exitCode}): ${tr.output.slice(0, 240)}`;
		}

		let buildRan = false;
		let buildPassed = false;
		let buildDetail: string | undefined;
		if (opts?.buildCommand) {
			buildRan = true;
			const br = await runShell(opts.buildCommand, workspaceRoot, 45_000);
			buildPassed = br.ok;
			buildDetail = br.ok ? `Passed: ${opts.buildCommand}` : `Failed (exit ${br.exitCode}): ${br.output.slice(0, 240)}`;
		}

		const report = buildTruthfulReliabilityReport({
			workspaceRoot,
			importReport,
			integrationReport,
			semanticReport,
			apiVerification,
			integrations: cur.integrations,
			compilerRan,
			compilerErrors,
			testRan,
			testPassed,
			testDetail,
			buildRan,
			buildPassed,
			buildDetail,
			previewRunning: cur.preview.status === 'running',
			platforms: cur.platforms,
		});

		this._emit(
			workspaceRoot,
			report.overallStatus === 'verified_against_executed_checks' ? 'ready_for_review' : report.overallStatus === 'needs_fixes' ? 'investigating_errors' : 'verifying',
			report.summary,
			report.overallStatus === 'verified_against_executed_checks' ? 'success' : report.overallStatus === 'needs_fixes' ? 'error' : 'warning',
			{ reliability: report },
		);
		return report;
	}

	async generateClientHandover(
		workspaceRoot: string,
		opts?: { clientName?: string; projectTitle?: string },
	): Promise<UabeHandoverPackageResult> {
		const cur = this._getOrInit(workspaceRoot);
		const outDir = path.join(workspaceRoot, 'handover');
		fs.mkdirSync(outDir, { recursive: true });

		const built = buildHandoverDocuments(cur, opts?.clientName, opts?.projectTitle);
		const filesGenerated: UabeHandoverPackageResult['filesGenerated'][number][] = [];
		const kindOf = (name: string): UabeHandoverPackageResult['filesGenerated'][number]['kind'] =>
			name.endsWith('.html') ? 'presentation'
			: name === '.env.example' ? 'env_template'
			: name.endsWith('.json') ? 'manifest'
			: name.includes('VERIFICATION') ? 'qa_report'
			: name.includes('INSTALL') ? 'ops' : 'docs';

		// Double-check that NO stored secret value ever appears in any handover output file!
		const storedSecrets = Object.values(this._loadSecrets(workspaceRoot)).filter(s => s.length >= 6);
		let extraRedactions = 0;

		for (const [fileName, rawContent] of Object.entries(built.files)) {
			let content = rawContent;
			for (const secret of storedSecrets) {
				if (content.includes(secret)) {
					content = content.split(secret).join('<REDACTED_SECRET_CONFIGURE_IN_ENV>');
					extraRedactions++;
				}
			}
			fs.writeFileSync(path.join(outDir, fileName), content, 'utf8');
			filesGenerated.push({
				relativePath: `handover/${fileName}`,
				kind: kindOf(fileName),
				description: `Generated client handover ${kindOf(fileName)} artifact`,
			});
		}

		// Independent secret verification scan across written handover files
		let zeroSecretsVerified = true;
		for (const f of filesGenerated) {
			const text = fs.readFileSync(path.join(workspaceRoot, f.relativePath), 'utf8');
			if (storedSecrets.some(s => text.includes(s))) {
				zeroSecretsVerified = false;
				break;
			}
		}

		const result: UabeHandoverPackageResult = {
			generatedAtMs: Date.now(),
			outputDir: 'handover',
			filesGenerated,
			secretsRedactedCount: built.redactions + extraRedactions,
			zeroSecretsVerified,
			summary: `Generated ${filesGenerated.length} client handover deliverable(s) in handover/ (zero-secrets verified: ${zeroSecretsVerified}).`,
		};

		this._emit(workspaceRoot, 'preparing_handover', result.summary, zeroSecretsVerified ? 'success' : 'error', { lastHandover: result });
		return result;
	}

	async createCheckpoint(workspaceRoot: string, label: string, files: readonly string[]): Promise<UabeCheckpointRecord> {
		const id = `cp-${crypto.randomBytes(4).toString('hex')}`;
		const cpDir = path.join(this._uabeDir(workspaceRoot), 'checkpoints', id);
		fs.mkdirSync(cpDir, { recursive: true });

		const savedFiles: string[] = [];
		const snapshots: Record<string, string | null> = {};
		for (const f of files) {
			const rel = f.replace(/\\/g, '/').replace(/^\.\//, '');
			const abs = path.join(workspaceRoot, rel);
			snapshots[rel] = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
			savedFiles.push(rel);
		}
		fs.writeFileSync(path.join(cpDir, 'snapshot.json'), JSON.stringify(snapshots, null, 2), 'utf8');

		const record: UabeCheckpointRecord = { id, label, createdAtMs: Date.now(), files: savedFiles };
		const cur = this._getOrInit(workspaceRoot);
		const checkpoints = [record, ...cur.checkpoints].slice(0, 30);
		this._emit(workspaceRoot, cur.phase, `Saved checkpoint "${label}" (${savedFiles.length} file(s)).`, 'info', { checkpoints });
		return record;
	}

	async rollbackCheckpoint(workspaceRoot: string, checkpointId: string): Promise<{ restored: boolean; filesRestored: readonly string[]; message: string }> {
		const snapPath = path.join(workspaceRoot, '.kodia', 'app-builder', 'checkpoints', checkpointId, 'snapshot.json');
		if (!fs.existsSync(snapPath)) {
			return { restored: false, filesRestored: [], message: `Checkpoint "${checkpointId}" not found.` };
		}
		const snapshots = JSON.parse(fs.readFileSync(snapPath, 'utf8')) as Record<string, string | null>;
		const filesRestored: string[] = [];
		for (const [rel, content] of Object.entries(snapshots)) {
			const abs = path.join(workspaceRoot, rel);
			if (content === null) {
				if (fs.existsSync(abs)) fs.rmSync(abs, { force: true });
			} else {
				fs.mkdirSync(path.dirname(abs), { recursive: true });
				fs.writeFileSync(abs, content, 'utf8');
			}
			filesRestored.push(rel);
		}
		this._emit(workspaceRoot, 'implementing', `Rolled back checkpoint "${checkpointId}" (${filesRestored.length} file(s) restored).`, 'warning');
		return { restored: true, filesRestored, message: `Restored ${filesRestored.length} file(s) from checkpoint ${checkpointId}.` };
	}
}
