/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export type FactoryProjectProfileId =
	| 'mobile-app'
	| 'web-app'
	| 'saas-platform'
	| 'api-backend'
	| 'ecommerce'
	| 'desktop-electron'
	| 'cli-tool'
	| 'ai-agent-system'
	| 'data-pipeline';

export interface MobileFactoryConfig {
	readonly platform: 'android' | 'ios' | 'both';
	readonly framework: 'react-native-expo' | 'react-native-cli' | 'flutter' | 'android-kotlin' | 'ios-swift' | 'kotlin-multiplatform' | 'dotnet-maui' | 'ionic-capacitor';
	readonly appCategory: 'general' | 'ai-powered' | 'enterprise' | 'ecommerce' | 'fintech' | 'social' | 'on-demand' | 'healthcare' | 'education' | 'iot-companion' | 'offline-first' | 'game';
	readonly backend: 'auto' | 'none' | 'node-express' | 'node-nestjs' | 'python-fastapi' | 'python-django' | 'go-gin' | 'rust-axum' | 'java-spring' | 'php-laravel' | 'supabase' | 'firebase';
	readonly database: 'auto' | 'none' | 'postgresql' | 'mysql' | 'sqlite' | 'mongodb' | 'redis' | 'firestore' | 'supabase';
	readonly includeAuth: boolean;
	readonly includeAI: boolean;
	readonly includeOffline: boolean;
	readonly includeRealtime: boolean;
}

export const DEFAULT_MOBILE_FACTORY_CONFIG: MobileFactoryConfig = {
	platform: 'both',
	framework: 'react-native-expo',
	appCategory: 'general',
	backend: 'auto',
	database: 'auto',
	includeAuth: true,
	includeAI: false,
	includeOffline: true,
	includeRealtime: false,
};

export interface FactoryProjectProfile {
	readonly id: FactoryProjectProfileId;
	readonly label: string;
	readonly summary: string;
	readonly defaultStack: string;
	readonly deliverables: readonly string[];
}

export const FACTORY_PROJECT_PROFILES: readonly FactoryProjectProfile[] = [
	{
		id: 'mobile-app',
		label: 'Mobile Application',
		summary: 'Android, iOS & cross-platform apps (React Native, Flutter, Kotlin, Swift) with backend API, DB, AI, offline sync, security & store readiness.',
		defaultStack: 'React Native (Expo/CLI) / Flutter / Kotlin / Swift + Multi-Language Backend + SQLite/Postgres',
		deliverables: ['Mobile architecture & ADRs', 'Adaptive Material 3 / iOS HIG UI', 'Backend API & DB schema', 'Offline sync & security (MASVS)', 'Unit/UI/integration tests & Store readiness'],
	},
	{
		id: 'web-app',
		label: 'Full-Stack Web App',
		summary: 'Responsive frontend, REST/JSON API, relational DB, auth, and automated tests.',
		defaultStack: 'TypeScript + React/Vite + Node/Express + SQLite/Postgres',
		deliverables: ['Architecture spec', 'Database schema & migrations', 'API endpoints', 'Responsive UI', 'Unit & E2E tests'],
	},
	{
		id: 'saas-platform',
		label: 'Multi-Tenant SaaS Platform',
		summary: 'Organizations, RBAC, billing hooks, admin console, audit logs, and CI config.',
		defaultStack: 'TypeScript + Next.js/React + API + Relational DB + RBAC',
		deliverables: ['Tenant data model', 'Auth & RBAC', 'Dashboard & settings', 'Audit trail', 'Verification suite'],
	},
	{
		id: 'api-backend',
		label: 'Backend API & Microservice',
		summary: 'Typed REST/OpenAPI service, validation, persistence, health checks, and contract tests.',
		defaultStack: 'Node/TypeScript or Python/FastAPI + OpenAPI + SQLite/Postgres',
		deliverables: ['OpenAPI schema', 'Validated routes', 'Repository layer', 'Integration tests', 'Dockerfile'],
	},
	{
		id: 'ecommerce',
		label: 'Enterprise E-Commerce',
		summary: 'Catalog, cart, checkout flow, order management, admin dashboard, and test fixtures.',
		defaultStack: 'TypeScript + React + Node API + SQLite/Postgres',
		deliverables: ['Product & order schema', 'Storefront UI', 'Checkout & payment adapter', 'Admin dashboard', 'Journey tests'],
	},
	{
		id: 'desktop-electron',
		label: 'Desktop Application',
		summary: 'Cross-platform Electron desktop app with secure preload IPC and offline storage.',
		defaultStack: 'Electron + TypeScript + React + SQLite',
		deliverables: ['Main/Preload IPC', 'Workbench UI', 'Local persistence', 'Packaging config', 'Smoke tests'],
	},
	{
		id: 'cli-tool',
		label: 'Developer CLI & SDK',
		summary: 'Zero-bloat CLI with subcommands, JSON output mode, config loading, and unit tests.',
		defaultStack: 'Node/TypeScript or Go',
		deliverables: ['Command parser', 'Core library SDK', 'Help & docs', 'Automated CLI tests'],
	},
	{
		id: 'ai-agent-system',
		label: 'AI Agent & Workflow Platform',
		summary: 'Tool-calling orchestration, provider abstraction, memory, evals, and observability.',
		defaultStack: 'TypeScript/Python + OpenAI-compatible SDK + Eval harness',
		deliverables: ['Tool registry', 'Execution loop', 'Memory & guardrails', 'Deterministic eval suite'],
	},
	{
		id: 'data-pipeline',
		label: 'Data / ETL Pipeline',
		summary: 'Schema validation, incremental extract/transform/load stages, lineage, and data quality tests.',
		defaultStack: 'Python or TypeScript + SQLite/DuckDB',
		deliverables: ['Schema contracts', 'Idempotent ETL stages', 'Data quality assertions', 'Runbook'],
	},
];

export type RequirementStatus = 'unstarted' | 'in_progress' | 'implemented' | 'verified';

export interface ProjectRequirement {
	readonly id: string;
	readonly title: string;
	readonly description: string;
	readonly priority: 'high' | 'medium' | 'low';
	readonly status: RequirementStatus;
	readonly acceptanceCriteria: readonly string[];
	readonly linkedFiles: readonly string[];
	readonly linkedTests: readonly string[];
	readonly createdAt: string;
	readonly updatedAt: string;
}

export interface AutopilotObjective {
	readonly id: string;
	readonly title: string;
	readonly instruction: string;
	readonly enabled: boolean;
	readonly runCount: number;
	readonly lastRunAt?: string;
	readonly lastThreadId?: string;
	readonly createdAt: string;
}

export interface ArchitectureDecisionRecord {
	readonly id: string;
	readonly title: string;
	readonly status: 'proposed' | 'accepted' | 'superseded';
	readonly context: string;
	readonly decision: string;
	readonly consequences: string;
	readonly relatedFiles: readonly string[];
	readonly createdAt: string;
}

export function buildSoftwareFactoryPrompt(
	idea: string,
	profileId: FactoryProjectProfileId,
	requirements: readonly ProjectRequirement[],
	mobileConfig?: MobileFactoryConfig,
): string {
	const profile = FACTORY_PROJECT_PROFILES.find(p => p.id === profileId) ?? FACTORY_PROJECT_PROFILES[0];
	const reqLines = requirements.length > 0
		? `\nTracked Requirements to satisfy:\n${requirements.map(r => `- [${r.id}] (${r.priority}) ${r.title}: ${r.description}`).join('\n')}\n`
		: '';

	if (profileId === 'mobile-app') {
		const cfg = mobileConfig ?? DEFAULT_MOBILE_FACTORY_CONFIG;
		return [
			`[Kodia Autonomous Mobile Application Factory — Three-Engine Unified Orchestration]`,
			`Objective: ${idea.trim()}`,
			`Target Platforms: ${cfg.platform} | Framework: ${cfg.framework} | Category: ${cfg.appCategory}`,
			`Backend: ${cfg.backend} | Database: ${cfg.database} | Auth: ${cfg.includeAuth} | AI: ${cfg.includeAI} | Offline-First: ${cfg.includeOffline} | Real-Time: ${cfg.includeRealtime}`,
			`Target Deliverables: ${profile.deliverables.join(', ')}`,
			reqLines,
			`Autonomous Mobile Engineering Protocol:`,
			`1. Run Live Engineering Intelligence freshness checks first (lei_assess_freshness, lei_discover_models if AI-powered, lei_check_dependency for key mobile SDKs/packages) so all chosen SDKs, APIs, and model IDs are verified current.`,
			`2. Open Mobile Studio (mobile_open_studio) and probe real host SDKs/devices (mobile_probe_environment) + inspect workspace (mobile_inspect_project).`,
			`3. Design the Three-Engine architecture (mobile_design_architecture) coordinating Mobile + Universal Software + AI Engineering Engines, and create a structured Task Plan (create_task_plan).`,
			`4. Scaffold and implement the complete mobile client (navigation, state, adaptive Material 3 / iOS HIG UI, offline sync, native integrations) AND full backend/database/AI proxy using mobile_scaffold_project and file tools — NEVER embed privileged API keys in mobile code.`,
			`5. Execute real mobile & backend tests (mobile_build_and_test), device/emulator checks where installed (mobile_device_action), OWASP MASVS security audit (mobile_audit_security), performance audit (mobile_audit_performance), and independent store readiness (mobile_assess_readiness).`,
			`6. Report verified vs environment-blocked results honestly with evidence.`,
		].join('\n');
	}

	return [
		`[Kodia Autonomous Software Factory — ${profile.label}]`,
		`Objective: ${idea.trim()}`,
		`Recommended Stack (adapt if workspace already uses another stack): ${profile.defaultStack}`,
		`Target Deliverables: ${profile.deliverables.join(', ')}`,
		reqLines,
		`Execution Protocol:`,
		`1. Run Live Engineering Intelligence (lei_assess_freshness, lei_discover_models for any AI providers, lei_check_dependency / lei_check_security for dependencies) to verify current APIs, models, and versions before implementation.`,
		`2. Inspect the existing workspace (ls_dir, env_inspect, project_health_scan).`,
		`3. Create a structured Task Plan (create_task_plan) decomposing architecture, backend, frontend, database, tests, and verification.`,
		`4. Record key architectural decisions (record_architecture_decision) with verified LEI evidence and keep requirements updated (factory_manage_requirements).`,
		`5. Implement all files directly using filesystem tools — never merely describe code.`,
		`6. Run real build, lint, tests, and evaluate_quality_gates; if any SDK/API/model fails, use lei_diagnose_error instead of retrying obsolete calls; record verification proof via record_verification_evidence before finishing.`,
	].join('\n');
}

export function buildModelCouncilPrompt(question: string): string {
	return [
		`[Kodia Multi-Agent Architecture Council & Solution Competition]`,
		`Engineering Challenge: ${question.trim()}`,
		``,
		`Run an independent 3-perspective technical debate before implementing:`,
		`1. Spawn specialist subagents in parallel (architect, security, performance) or analyze from all three distinct lenses.`,
		`2. Produce at least 2 competing solution architectures with explicit trade-offs (complexity, security, performance, testability, migration risk).`,
		`3. Challenge assumptions and identify edge-case failure modes in each proposal.`,
		`4. Synthesize a concrete recommendation, record it via record_architecture_decision, and state the exact verification plan.`,
	].join('\n');
}

export function computeRequirementCoverage(reqs: readonly ProjectRequirement[]): {
	total: number;
	verified: number;
	implemented: number;
	unstarted: number;
	percentVerified: number;
} {
	const total = reqs.length;
	const verified = reqs.filter(r => r.status === 'verified').length;
	const implemented = reqs.filter(r => r.status === 'implemented' || r.status === 'verified').length;
	const unstarted = reqs.filter(r => r.status === 'unstarted').length;
	const percentVerified = total === 0 ? 0 : Math.round((verified / total) * 100);
	return { total, verified, implemented, unstarted, percentVerified };
}

export interface ISoftwareFactoryService {
	readonly _serviceBrand: undefined;
	readonly onDidChange: Event<void>;

	getRequirements(): readonly ProjectRequirement[];
	addRequirement(input: { title: string; description: string; priority?: 'high' | 'medium' | 'low'; acceptanceCriteria?: readonly string[] }): ProjectRequirement;
	updateRequirement(id: string, patch: Partial<Pick<ProjectRequirement, 'title' | 'description' | 'priority' | 'status' | 'linkedFiles' | 'linkedTests'>>): ProjectRequirement | null;
	removeRequirement(id: string): void;

	getAutopilotObjectives(): readonly AutopilotObjective[];
	addAutopilotObjective(input: { title: string; instruction: string }): AutopilotObjective;
	toggleAutopilotObjective(id: string, enabled: boolean): void;
	removeAutopilotObjective(id: string): void;
	runAutopilotObjectiveNow(id: string): Promise<string | null>;

	getDecisions(): readonly ArchitectureDecisionRecord[];
	addDecision(input: { title: string; context: string; decision: string; consequences?: string; status?: 'proposed' | 'accepted' | 'superseded'; relatedFiles?: readonly string[] }): ArchitectureDecisionRecord;
	removeDecision(id: string): void;

	launchFactoryBuild(idea: string, profileId: FactoryProjectProfileId, mobileConfig?: MobileFactoryConfig): Promise<string>;
	launchModelCouncil(question: string): Promise<string>;
}

export const ISoftwareFactoryService = createDecorator<ISoftwareFactoryService>('kodiaSoftwareFactoryService');
