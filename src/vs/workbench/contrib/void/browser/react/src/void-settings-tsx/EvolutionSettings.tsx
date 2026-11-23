/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React from 'react';
import { Compass } from 'lucide-react';
import { useAccessor, useSettingsState } from '../util/services.js';
import { SettingGroup, SettingsSection, SettingSwitch } from './SettingsControls.js';
import { KodiaBadge, KodiaSecondaryButton } from '../util/KodiaDesignSystem.js';
import { DEFAULT_EVOLUTION_ENGINE_SETTINGS, EvolutionEngineSettings } from '../../../../common/evolutionTypes.js';

export const EvolutionSettingsSection = ({ onRecordChange }: { onRecordChange?: (label: string) => void }) => {
	const accessor = useAccessor();
	const voidSettingsService = accessor.get('IVoidSettingsService');
	const evolutionService = accessor.get('IEvolutionService');
	const settingsState = useSettingsState();

	const current: EvolutionEngineSettings = {
		...DEFAULT_EVOLUTION_ENGINE_SETTINGS,
		...(settingsState.globalSettings.evolution ?? {}),
	};

	const update = <K extends keyof EvolutionEngineSettings>(key: K, value: EvolutionEngineSettings[K], label: string) => {
		voidSettingsService.setGlobalSetting('evolution', { ...current, [key]: value });
		onRecordChange?.(`Evolution Engine: ${label}`);
	};

	return (
		<SettingsSection
			title='Evolution, Supply-Chain & Enterprise Ops'
			description='Configure Kodia permanent capability-discovery cadence, license compatibility safeguards, SLO budgets, and FinOps cost alert thresholds.'
			badge={<KodiaBadge tone='accent'><Compass size={11} /> 12 Tools · Zero Blind Installs</KodiaBadge>}
		>
			<div className='flex items-center justify-end pb-1'>
				<KodiaSecondaryButton onClick={() => void evolutionService.openHub('radar')}>
					<Compass size={12} /> Open Evolution & Ops Hub (Ctrl+Alt+E)
				</KodiaSecondaryButton>
			</div>

			<SettingGroup title='Continuous Capability Discovery & Supply-Chain Policy' description='Prevents blind dependency installation and enforces periodic ecosystem & security audits.'>
				<SettingSwitch
					value={current.enablePeriodicCapabilityAudit}
					onChange={v => update('enablePeriodicCapabilityAudit', v, `Periodic audit ${v ? 'on' : 'off'}`)}
					label='Enable periodic Capability Evolution Radar audits'
					description='Evaluates emerging techniques, frameworks, security threats, and Kodia self-improvement candidates on a regular schedule.'
				/>
				<SettingSwitch
					value={current.requireApprovalBeforeDependencyIntegration}
					onChange={v => update('requireApprovalBeforeDependencyIntegration', v, `Require approval ${v ? 'on' : 'off'}`)}
					label='Require explicit user approval before integrating new dependencies'
					description='Never auto-installs dependencies discovered by the capability radar; records governed proposals first.'
				/>
				<SettingSwitch
					value={current.blockCopyleftLicensesInCommercialMode}
					onChange={v => update('blockCopyleftLicensesInCommercialMode', v, `Block copyleft ${v ? 'on' : 'off'}`)}
					label='Elevate strong copyleft licenses (GPL/AGPL/SSPL) to critical findings'
					description='Flags strong copyleft licenses as critical supply-chain blockers for proprietary commercial projects.'
				/>
			</SettingGroup>

			<SettingGroup title='SLO & Cloud FinOps Thresholds' description='Default targets used by Incident Forensics and Infrastructure Cost Audits.'>
				<div className='grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1'>
					<label className='flex flex-col gap-1'>
						<span className='text-xs font-medium text-void-fg-1'>Audit interval (hours)</span>
						<input type='number' min={1} max={720} value={current.auditIntervalHours} onChange={e => update('auditIntervalHours', Math.max(1, Number(e.target.value) || 168), 'Audit interval updated')} className='px-2.5 py-1.5 text-xs rounded-md bg-void-bg-1 border border-void-border-2 text-void-fg-1' />
					</label>
					<label className='flex flex-col gap-1'>
						<span className='text-xs font-medium text-void-fg-1'>Default P95 latency budget (ms)</span>
						<input type='number' min={10} max={30000} value={current.defaultP95LatencyBudgetMs} onChange={e => update('defaultP95LatencyBudgetMs', Math.max(10, Number(e.target.value) || 400), 'P95 budget updated')} className='px-2.5 py-1.5 text-xs rounded-md bg-void-bg-1 border border-void-border-2 text-void-fg-1' />
					</label>
					<label className='flex flex-col gap-1'>
						<span className='text-xs font-medium text-void-fg-1'>Monthly cloud budget (USD)</span>
						<input type='number' min={10} max={1000000} value={current.monthlyCloudBudgetUsd} onChange={e => update('monthlyCloudBudgetUsd', Math.max(10, Number(e.target.value) || 500), 'Cloud budget updated')} className='px-2.5 py-1.5 text-xs rounded-md bg-void-bg-1 border border-void-border-2 text-void-fg-1' />
					</label>
				</div>
			</SettingGroup>
		</SettingsSection>
	);
};
