/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React from 'react';
import { Shield } from 'lucide-react';
import { useAccessor, useSettingsState } from '../util/services.js';
import { SettingGroup, SettingsSection, SettingSwitch } from './SettingsControls.js';
import { KodiaBadge, KodiaSecondaryButton } from '../util/KodiaDesignSystem.js';
import {
	DEFAULT_KACRAE_SETTINGS,
	KacraeDecorationDensity,
	KacraeEnterpriseRole,
	KacraeReviewDepth,
	KacraeReviewScope,
	KacraeSeverity,
	KacraeSettings,
} from '../../../../common/kacraeTypes.js';

export const CodeReviewSettingsSection = ({ onRecordChange }: { onRecordChange?: (label: string) => void }) => {
	const accessor = useAccessor();
	const voidSettingsService = accessor.get('IVoidSettingsService');
	const codeReviewService = accessor.get('ICodeReviewService');
	const settingsState = useSettingsState();

	const current: KacraeSettings = {
		...DEFAULT_KACRAE_SETTINGS,
		...(settingsState.globalSettings.kacrae ?? {}),
	};

	const update = <K extends keyof KacraeSettings>(key: K, value: KacraeSettings[K], label: string) => {
		voidSettingsService.setGlobalSetting('kacrae', { ...current, [key]: value });
		onRecordChange?.(`Code Review (KACRAE): ${label}`);
	};

	return (
		<SettingsSection
			title='Autonomous Code Review & Assurance (KACRAE)'
			description='Configure review scopes, depth, inline editor decorations, Multi-Model Review Council routing, large-repository budgets, local-only privacy, and enterprise assurance policies.'
			badge={<KodiaBadge tone='accent'><Shield size={11} /> KACRAE · 23 Workbench Views</KodiaBadge>}
		>
			<div className='flex items-center justify-end pb-1'>
				<KodiaSecondaryButton onClick={() => void codeReviewService.openWorkbench('overview')}>
					<Shield size={12} /> Open Code Review Workbench (Ctrl+Alt+R)
				</KodiaSecondaryButton>
			</div>

			<SettingGroup title='General' description='Enable KACRAE, default review scope/depth, notifications, continuous triggers, and inline decoration density.'>
				<SettingSwitch
					value={current.enabled}
					onChange={v => update('enabled', v, `Enabled ${v ? 'on' : 'off'}`)}
					label='Enable Kodia Code Review (KACRAE)'
					description='Enables inline review decorations, workbench analysis, and live review events.'
				/>
				<SettingSwitch
					value={current.notificationsEnabled}
					onChange={v => update('notificationsEnabled', v, `Notifications ${v ? 'on' : 'off'}`)}
					label='Show review completion notifications'
					description='Display summary notifications when review sessions complete.'
				/>
				<SettingSwitch
					value={current.reviewOnSave}
					onChange={v => update('reviewOnSave', v, `Review on save ${v ? 'on' : 'off'}`)}
					label='Continuous review on file save'
					description='Automatically runs fast incremental checks when source files are saved.'
				/>
				<SettingSwitch
					value={current.backgroundReviewEnabled}
					onChange={v => update('backgroundReviewEnabled', v, `Background review ${v ? 'on' : 'off'}`)}
					label='Enable background incremental indexing'
					description='Keeps the disk-backed repository intelligence graph warm without blocking the editor.'
				/>
				<div className='grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1'>
					<label className='flex flex-col gap-1'>
						<span className='text-xs font-medium text-void-fg-1'>Default review depth</span>
						<select
							value={current.defaultDepth}
							onChange={e => update('defaultDepth', e.target.value as KacraeReviewDepth, `Default depth: ${e.target.value}`)}
							className='px-2.5 py-1.5 text-xs rounded-md bg-void-bg-1 border border-void-border-2 text-void-fg-1'
						>
							<option value='quick'>Quick Review</option>
							<option value='standard'>Standard Review</option>
							<option value='deep'>Deep Review</option>
							<option value='security'>Security Review</option>
							<option value='enterprise_assurance'>Enterprise Assurance</option>
							<option value='continuous'>Continuous Review</option>
							<option value='custom'>Custom Profile</option>
						</select>
					</label>
					<label className='flex flex-col gap-1'>
						<span className='text-xs font-medium text-void-fg-1'>Default review scope</span>
						<select
							value={current.defaultScope}
							onChange={e => update('defaultScope', e.target.value as KacraeReviewScope, `Default scope: ${e.target.value}`)}
							className='px-2.5 py-1.5 text-xs rounded-md bg-void-bg-1 border border-void-border-2 text-void-fg-1'
						>
							<option value='modified_files'>Modified Files</option>
							<option value='git_staged'>Git Staged Changes</option>
							<option value='git_unstaged'>Git Unstaged Changes</option>
							<option value='current_file'>Current File</option>
							<option value='entire_project'>Entire Project</option>
							<option value='branch_comparison'>Branch Comparison</option>
						</select>
					</label>
					<label className='flex flex-col gap-1'>
						<span className='text-xs font-medium text-void-fg-1'>Inline decoration density</span>
						<select
							value={current.decorationDensity}
							onChange={e => update('decorationDensity', e.target.value as KacraeDecorationDensity, `Decoration density: ${e.target.value}`)}
							className='px-2.5 py-1.5 text-xs rounded-md bg-void-bg-1 border border-void-border-2 text-void-fg-1'
						>
							<option value='off'>Off</option>
							<option value='compact'>Compact (Gutter only)</option>
							<option value='standard'>Standard (High/Critical inline)</option>
							<option value='detailed'>Detailed (All inline annotations)</option>
						</select>
					</label>
				</div>
			</SettingGroup>

			<SettingGroup title='Review Behavior' description='Severity thresholds, false-positive confidence floor, suppression policy, and history retention.'>
				<SettingSwitch
					value={current.requireSuppressionJustification}
					onChange={v => update('requireSuppressionJustification', v, `Suppression justification ${v ? 'required' : 'optional'}`)}
					label='Require justification when suppressing findings'
					description='Records explicit audit justification whenever a finding is dismissed or suppressed.'
				/>
				<div className='grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1'>
					<label className='flex flex-col gap-1'>
						<span className='text-xs font-medium text-void-fg-1'>Minimum severity</span>
						<select
							value={current.minSeverity}
							onChange={e => update('minSeverity', e.target.value as KacraeSeverity, `Min severity: ${e.target.value}`)}
							className='px-2.5 py-1.5 text-xs rounded-md bg-void-bg-1 border border-void-border-2 text-void-fg-1'
						>
							<option value='info'>Info</option>
							<option value='low'>Low</option>
							<option value='medium'>Medium</option>
							<option value='high'>High</option>
							<option value='critical'>Critical</option>
						</select>
					</label>
					<label className='flex flex-col gap-1'>
						<span className='text-xs font-medium text-void-fg-1'>Confidence threshold (0.0–1.0)</span>
						<input
							type='number'
							step={0.05}
							min={0}
							max={1}
							value={current.minConfidence}
							onChange={e => update('minConfidence', Math.max(0, Math.min(1, Number(e.target.value) || 0.45)), 'Confidence threshold updated')}
							className='px-2.5 py-1.5 text-xs rounded-md bg-void-bg-1 border border-void-border-2 text-void-fg-1'
						/>
					</label>
					<label className='flex flex-col gap-1'>
						<span className='text-xs font-medium text-void-fg-1'>History retention (days)</span>
						<input
							type='number'
							min={1}
							max={3650}
							value={current.historyRetentionDays}
							onChange={e => update('historyRetentionDays', Math.max(1, Number(e.target.value) || 90), 'Retention updated')}
							className='px-2.5 py-1.5 text-xs rounded-md bg-void-bg-1 border border-void-border-2 text-void-fg-1'
						/>
					</label>
				</div>
			</SettingGroup>

			<SettingGroup title='AI Review Council & Free/Local Inference' description='Configure multi-model council roles, free/local preferences, and context budgets. Deterministic analysis always works without paid AI.'>
				<SettingSwitch
					value={current.enableAiCouncil}
					onChange={v => update('enableAiCouncil', v, `AI Council ${v ? 'on' : 'off'}`)}
					label='Enable Multi-Model AI Review Council'
					description='Supplements deterministic analyzers with configured local, free hosted, or BYOK models.'
				/>
				<SettingSwitch
					value={current.preferLocalModels}
					onChange={v => update('preferLocalModels', v, `Prefer local models ${v ? 'on' : 'off'}`)}
					label='Prefer local inference (Ollama / LM Studio / vLLM / MLX)'
					description='Routes routine review roles to local models first for zero-cost private execution.'
				/>
				<SettingSwitch
					value={current.preferFreeHostedModels}
					onChange={v => update('preferFreeHostedModels', v, `Prefer free models ${v ? 'on' : 'off'}`)}
					label='Prefer legitimate free hosted tiers within quota'
					description='Uses configured free tiers before escalating to user-funded paid BYOK models.'
				/>
			</SettingGroup>

			<SettingGroup title='Analysis Tools & Domain Engines' description='Enable or disable deterministic compilers, security scanners, DB/API analyzers, tests, and adversarial review.'>
				<SettingSwitch value={current.enableCompilerChecks} onChange={v => update('enableCompilerChecks', v, 'Compiler checks toggled')} label='Run language compilers (tsc, node --check, python)' description='Confirms syntax and static type errors directly via installed toolchains.' />
				<SettingSwitch value={current.enableSecurityScanners} onChange={v => update('enableSecurityScanners', v, 'Security scanners toggled')} label='Enable security, taint & multi-tenant isolation scanners' description='Detects injection, auth/authz flaws, secrets, and cross-tenant data leaks.' />
				<SettingSwitch value={current.enableDatabaseReview} onChange={v => update('enableDatabaseReview', v, 'DB review toggled')} label='Enable database & migration safety analyzer' description='Detects destructive migrations, table locks, N+1 queries, and unbounded selects.' />
				<SettingSwitch value={current.enableApiContractReview} onChange={v => update('enableApiContractReview', v, 'API contract review toggled')} label='Enable API & OpenAPI contract drift analyzer' description='Cross-checks OpenAPI specs against implemented server endpoints.' />
				<SettingSwitch value={current.enableAdversarialReview} onChange={v => update('enableAdversarialReview', v, 'Adversarial review toggled')} label='Enable adversarial counterexample reviewer' description='Challenges implementations with concrete edge-case & concurrency counterexamples.' />
			</SettingGroup>

			<SettingGroup title='Performance & Large-Repository Budgets' description='Controls bounded concurrency, memory protection, and incremental indexing for enterprise-scale monorepos.'>
				<SettingSwitch value={current.largeRepositoryMode} onChange={v => update('largeRepositoryMode', v, 'Large-repo mode toggled')} label='Enable Large-Repository Mode' description='Prioritizes changed files, sharded disk indexing, and progressive graph virtualization.' />
				<div className='grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1'>
					<label className='flex flex-col gap-1'>
						<span className='text-xs font-medium text-void-fg-1'>Indexing concurrency</span>
						<input type='number' min={1} max={32} value={current.indexingConcurrency} onChange={e => update('indexingConcurrency', Math.max(1, Math.min(32, Number(e.target.value) || 8)), 'Concurrency updated')} className='px-2.5 py-1.5 text-xs rounded-md bg-void-bg-1 border border-void-border-2 text-void-fg-1' />
					</label>
					<label className='flex flex-col gap-1'>
						<span className='text-xs font-medium text-void-fg-1'>Max files per standard review</span>
						<input type='number' min={20} max={50000} value={current.maxFilesPerStandardReview} onChange={e => update('maxFilesPerStandardReview', Math.max(20, Number(e.target.value) || 500), 'Max files updated')} className='px-2.5 py-1.5 text-xs rounded-md bg-void-bg-1 border border-void-border-2 text-void-fg-1' />
					</label>
					<label className='flex flex-col gap-1'>
						<span className='text-xs font-medium text-void-fg-1'>Memory budget (MB)</span>
						<input type='number' min={128} max={8192} value={current.memoryBudgetMb} onChange={e => update('memoryBudgetMb', Math.max(128, Number(e.target.value) || 512), 'Memory budget updated')} className='px-2.5 py-1.5 text-xs rounded-md bg-void-bg-1 border border-void-border-2 text-void-fg-1' />
					</label>
				</div>
			</SettingGroup>

			<SettingGroup title='Security, Privacy & Enterprise Governance' description='Enforce air-gapped/local-only review, strict secret redaction, RBAC permissions, and independent repair verification.'>
				<SettingSwitch value={current.localOnlyMode} onChange={v => update('localOnlyMode', v, `Local-only mode ${v ? 'on' : 'off'}`)} label='Strict Local-Only / Offline Review Mode' description='Blocks all external AI provider requests; runs deterministic analyzers and local models only.' />
				<SettingSwitch value={current.redactSecretsStrictly} onChange={v => update('redactSecretsStrictly', v, 'Strict secret redaction toggled')} label='Strictly redact secrets from findings, logs & AI context' description='Ensures credentials are never written verbatim into findings, audit logs, or external prompts.' />
				<SettingSwitch value={current.requireIndependentVerification} onChange={v => update('requireIndependentVerification', v, 'Independent verification toggled')} label='Require independent verification after autonomous repairs' description='Re-runs static checks, compilers, and tests before marking any repaired finding resolved.' />
				<SettingSwitch value={current.blockReleaseOnCritical} onChange={v => update('blockReleaseOnCritical', v, 'Release gate toggled')} label='Block release readiness on unresolved critical findings' description='Prevents readiness verdicts from passing when critical defects or security flaws remain open.' />
				<div className='grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1'>
					<label className='flex flex-col gap-1'>
						<span className='text-xs font-medium text-void-fg-1'>Active Enterprise RBAC Role</span>
						<select
							value={current.enterpriseRole}
							onChange={e => update('enterpriseRole', e.target.value as KacraeEnterpriseRole, `RBAC role: ${e.target.value}`)}
							className='px-2.5 py-1.5 text-xs rounded-md bg-void-bg-1 border border-void-border-2 text-void-fg-1'
						>
							<option value='viewer'>Viewer (Read-only)</option>
							<option value='reviewer'>Reviewer (Triage &amp; Suppress)</option>
							<option value='approver'>Approver (Apply &amp; Verify Repairs)</option>
							<option value='security_officer'>Security Officer</option>
							<option value='admin'>Enterprise Admin</option>
						</select>
					</label>
					<label className='flex flex-col gap-1'>
						<span className='text-xs font-medium text-void-fg-1'>Organization Policy Name</span>
						<input
							type='text'
							value={current.organizationPolicyName}
							onChange={e => update('organizationPolicyName', e.target.value, 'Policy name updated')}
							className='px-2.5 py-1.5 text-xs rounded-md bg-void-bg-1 border border-void-border-2 text-void-fg-1'
						/>
					</label>
				</div>
			</SettingGroup>
		</SettingsSection>
	);
};

