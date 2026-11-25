/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React from 'react';
import { Cloud, Cpu, KeyRound, ShieldCheck, Workflow } from 'lucide-react';
import { useAccessor, useSettingsState } from '../util/services.js';
import { SettingGroup, SettingsSection, SettingSwitch } from './SettingsControls.js';
import { KodiaBadge, KodiaCard, KodiaPrimaryButton, KodiaSecondaryButton } from '../util/KodiaDesignSystem.js';
import {
	DEFAULT_UAEP_ENGINE_SETTINGS,
	UaepAiProviderId,
	UaepCodegenTarget,
	UaepEngineSettings,
} from '../../../../common/universalAutomationTypes.js';
import { getUaepAiProviderPreset, UAEP_AI_PROVIDER_PRESETS } from '../../../../common/universalAutomationEngine.js';

export const AutomationSettingsSection = ({ onRecordChange }: { onRecordChange?: (label: string) => void }) => {
	const accessor = useAccessor();
	const voidSettingsService = accessor.get('IVoidSettingsService');
	const uaepService = accessor.get('IUniversalAutomationService');
	const settingsState = useSettingsState();

	const current: UaepEngineSettings = {
		...DEFAULT_UAEP_ENGINE_SETTINGS,
		...(settingsState.globalSettings.uaep ?? {}),
	};

	const update = <K extends keyof UaepEngineSettings>(key: K, value: UaepEngineSettings[K], label: string) => {
		voidSettingsService.setGlobalSetting('uaep', { ...current, [key]: value });
		onRecordChange?.(`Automation Studio (UAEP): ${label}`);
	};

	return (
		<SettingsSection
			title='Universal Automation Studio (UAEP)'
			description='Configure visual-to-code compilation targets, durable workflow runtime defaults, multi-tenant vault security, sandboxed execution, and standalone/embedded platform generation.'
			badge={<KodiaBadge tone='accent'><Workflow size={11} /> Visual-to-Code · Durable Runtime</KodiaBadge>}
		>
			<KodiaCard className='flex flex-wrap items-center gap-2 !p-3'>
				<KodiaPrimaryButton onClick={() => void uaepService.openStudio('canvas')}>
					<Workflow size={12} /> Open Automation Studio (Ctrl+Alt+W)
				</KodiaPrimaryButton>
				<KodiaSecondaryButton onClick={() => void uaepService.openStudio('credentials')}>
					<KeyRound size={12} /> Tenant Vault
				</KodiaSecondaryButton>
				<KodiaSecondaryButton onClick={() => void uaepService.openStudio('deployment')}>
					<Cloud size={12} /> Compile &amp; Deploy
				</KodiaSecondaryButton>
				<KodiaSecondaryButton onClick={() => void uaepService.openStudio('embedded')}>
					<Cpu size={12} /> Embedded Platform Generator
				</KodiaSecondaryButton>
				<KodiaSecondaryButton onClick={() => void uaepService.openStudio('security')}>
					<ShieldCheck size={12} /> Audit Logs
				</KodiaSecondaryButton>
			</KodiaCard>

			<SettingGroup title='Free-First AI Provider Defaults (NVIDIA NIM, Groq, OpenRouter, Gemini, Ollama)' description='Choose which AI provider and model new Automation Studio AI nodes default to. Free-tier and local providers are prioritized over paid OpenAI.'>
				<div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
					<label className='flex flex-col gap-1 text-xs'>
						<span className='font-medium text-void-fg-1'>Default AI Provider</span>
						<select
							value={current.defaultAiProvider}
							onChange={e => {
								const preset = getUaepAiProviderPreset(e.target.value);
								voidSettingsService.setGlobalSetting('uaep', {
									...current,
									defaultAiProvider: preset.id as UaepAiProviderId,
									defaultAiModel: preset.defaultModel || current.defaultAiModel,
								});
								onRecordChange?.(`Automation Studio (UAEP): Default AI provider → ${preset.label}`);
							}}
							className='px-2.5 py-1.5 rounded bg-void-bg-1 border border-void-border-2 text-void-fg-1'
						>
							{UAEP_AI_PROVIDER_PRESETS.map(p => (
								<option key={p.id} value={p.id}>{p.label}</option>
							))}
						</select>
					</label>
					<label className='flex flex-col gap-1 text-xs'>
						<span className='font-medium text-void-fg-1'>Default AI Model ID (Verify Live via LEI)</span>
						<input
							value={current.defaultAiModel}
							onChange={e => update('defaultAiModel', e.target.value, 'Default AI model updated')}
							placeholder='e.g. nvidia/nemotron-3.5-super-vl-120b-a12b'
							className='px-2.5 py-1.5 rounded bg-void-bg-1 border border-void-border-2 text-void-fg-1 font-mono'
						/>
					</label>
				</div>
				<div className='text-[11px] text-void-fg-3 mt-1.5'>
					{getUaepAiProviderPreset(current.defaultAiProvider).note}
				</div>
			</SettingGroup>

			<SettingGroup title='Compiler & Runtime Defaults' description='Controls execution model, generated source language, retry policies, and node timeouts.'>
				<div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3'>
					<label className='flex flex-col gap-1 text-xs'>
						<span className='font-medium text-void-fg-1'>Execution Model</span>
						<select
							value={current.defaultExecutionModel}
							onChange={e => update('defaultExecutionModel', e.target.value as 'interpreted' | 'generated_code', `Execution model → ${e.target.value}`)}
							className='px-2.5 py-1.5 rounded bg-void-bg-1 border border-void-border-2 text-void-fg-1'
						>
							<option value='interpreted'>Interpreted Durable IR</option>
							<option value='generated_code'>Generated Standalone Code</option>
						</select>
					</label>
					<label className='flex flex-col gap-1 text-xs'>
						<span className='font-medium text-void-fg-1'>Codegen Target</span>
						<select
							value={current.defaultCodegenTarget}
							onChange={e => update('defaultCodegenTarget', e.target.value as UaepCodegenTarget, `Codegen target → ${e.target.value}`)}
							className='px-2.5 py-1.5 rounded bg-void-bg-1 border border-void-border-2 text-void-fg-1'
						>
							<option value='typescript'>TypeScript</option>
							<option value='javascript'>JavaScript (ESM)</option>
							<option value='python'>Python</option>
						</select>
					</label>
					<label className='flex flex-col gap-1 text-xs'>
						<span className='font-medium text-void-fg-1'>Default Retries</span>
						<input
							type='number'
							min={1}
							max={10}
							value={current.defaultRetryAttempts}
							onChange={e => update('defaultRetryAttempts', Math.max(1, Number(e.target.value) || 3), 'Retry attempts updated')}
							className='px-2.5 py-1.5 rounded bg-void-bg-1 border border-void-border-2 text-void-fg-1'
						/>
					</label>
					<label className='flex flex-col gap-1 text-xs'>
						<span className='font-medium text-void-fg-1'>Node Timeout (ms)</span>
						<input
							type='number'
							min={1000}
							max={120000}
							value={current.defaultNodeTimeoutMs}
							onChange={e => update('defaultNodeTimeoutMs', Math.max(1000, Number(e.target.value) || 15000), 'Timeout updated')}
							className='px-2.5 py-1.5 rounded bg-void-bg-1 border border-void-border-2 text-void-fg-1'
						/>
					</label>
				</div>
			</SettingGroup>

			<SettingGroup title='Enterprise Security, Multi-Tenancy & Isolation' description='Enforces sandboxed custom code execution, tenant isolation, hash-chained audit logs, and secret-free exports.'>
				<SettingSwitch
					value={current.enforceSandboxedCodeNodes}
					onChange={v => update('enforceSandboxedCodeNodes', v, `Sandboxed code nodes ${v ? 'on' : 'off'}`)}
					label='Enforce isolated VM sandboxing for custom JavaScript/TypeScript developer nodes'
					description='Blocks host filesystem, process, and child_process access inside workflow code nodes.'
				/>
				<SettingSwitch
					value={current.enforceTenantIsolation}
					onChange={v => update('enforceTenantIsolation', v, `Tenant isolation ${v ? 'on' : 'off'}`)}
					label='Enforce strict per-tenant isolation across workflows, executions & encrypted vaults'
					description='Prevents cross-tenant reads, executions, or credential access and logs denied attempts.'
				/>
				<SettingSwitch
					value={current.enableTamperEvidentAuditLogs}
					onChange={v => update('enableTamperEvidentAuditLogs', v, `Audit logs ${v ? 'on' : 'off'}`)}
					label='Record SHA-256 hash-chained audit trails for workflow, credential & deployment operations'
					description='Maintains tamper-evident operational history suitable for enterprise & regulated reviews.'
				/>
				<SettingSwitch
					value={current.requireHumanApprovalForSensitiveAiActions}
					onChange={v => update('requireHumanApprovalForSensitiveAiActions', v, `AI approval guard ${v ? 'on' : 'off'}`)}
					label='Require Human Approval Gates before high-impact AI agent write/payment actions'
					description='Pauses executions durably until an authorized reviewer approves or rejects.'
				/>
				<SettingSwitch
					value={current.preventSecretsInExports}
					onChange={v => update('preventSecretsInExports', v, `Secret-free exports ${v ? 'on' : 'off'}`)}
					label='Verify zero tenant secrets in exported portable deployment packages'
					description='Scans and redacts all exported Dockerfiles, manifests, and env templates.'
				/>
			</SettingGroup>
		</SettingsSection>
	);
};
