/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React from 'react';
import { Compass } from 'lucide-react';
import { useAccessor, useSettingsState } from '../util/services.js';
import { SettingGroup, SettingsSection, SettingSwitch } from './SettingsControls.js';
import { KodiaBadge, KodiaSecondaryButton } from '../util/KodiaDesignSystem.js';
import { ArpeiResearchMode, ArpeiSettings, DEFAULT_ARPEI_SETTINGS } from '../../../../common/arpeiTypes.js';

export const ArpeiSettingsSection = ({ onRecordChange }: { onRecordChange?: (label: string) => void }) => {
	const accessor = useAccessor();
	const voidSettingsService = accessor.get('IVoidSettingsService');
	const arpeiService = accessor.get('IArpeiService');
	const settingsState = useSettingsState();

	const current: ArpeiSettings = {
		...DEFAULT_ARPEI_SETTINGS,
		...(settingsState.globalSettings.arpei ?? {}),
	};

	const update = <K extends keyof ArpeiSettings>(key: K, value: ArpeiSettings[K], label: string) => {
		voidSettingsService.setGlobalSetting('arpei', { ...current, [key]: value });
		onRecordChange?.(`Research Intelligence (ARPEI): ${label}`);
	};

	return (
		<SettingsSection
			title='Research-to-Product Intelligence (ARPEI)'
			description='Configure live web research, deep product discovery, pre-implementation readiness gates, persistent visual memory, responsive screenshot comparisons, and research safety policies.'
			badge={<KodiaBadge tone='accent'><Compass size={11} /> ARPEI · Deep Product Discovery</KodiaBadge>}
		>
			<div className='flex items-center justify-end pb-1'>
				<KodiaSecondaryButton onClick={() => void arpeiService.openWorkspace('overview')}>
					<Compass size={12} /> Open Research Intelligence Workspace (Ctrl+Alt+P)
				</KodiaSecondaryButton>
			</div>

			<SettingGroup title='Research Decision & Deep Discovery Gate' description='Controls research-first defaults, pre-implementation readiness gate, and page budgets.'>
				<SettingSwitch value={current.enabled} onChange={v => update('enabled', v, `Enabled ${v ? 'on' : 'off'}`)} label='Enable ARPEI Research-to-Product Intelligence' description='Automatically classifies requests and coordinates live browser, documentation, and asset research.' />
				<SettingSwitch value={current.autoResearchSubstantialApps} onChange={v => update('autoResearchSubstantialApps', v, 'Auto research toggled')} label='Research automatically for substantial application builds' description='Performs live domain and reference investigation before implementation while skipping trivial edits.' />
				<SettingSwitch value={current.enforcePreImplementationReadinessGate} onChange={v => update('enforcePreImplementationReadinessGate', v, 'Readiness gate toggled')} label='Evaluate 13-point Pre-Implementation Research Readiness Gate' description='Ensures domain, roles, workflows, requirements, and unknowns are documented before major coding.' />
				<div className='grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1'>
					<label className='flex flex-col gap-1'>
						<span className='text-xs font-medium text-void-fg-1'>Default research mode</span>
						<select value={current.defaultResearchMode} onChange={e => update('defaultResearchMode', e.target.value as ArpeiResearchMode, `Mode: ${e.target.value}`)} className='px-2.5 py-1.5 text-xs rounded-md bg-void-bg-1 border border-void-border-2 text-void-fg-1'>
							<option value='autonomous_research_and_build'>Autonomous Research &amp; Build</option>
							<option value='research_only'>Research Only</option>
							<option value='plan_first'>Plan First</option>
							<option value='user_directed_research'>User-Directed Research</option>
							<option value='existing_project_enhancement'>Existing Project Enhancement</option>
							<option value='fast_implementation'>Fast Implementation</option>
						</select>
					</label>
					<label className='flex flex-col gap-1'>
						<span className='text-xs font-medium text-void-fg-1'>Max reference pages / session</span>
						<input type='number' min={1} max={30} value={current.maxReferencePagesPerSession} onChange={e => update('maxReferencePagesPerSession', Math.max(1, Number(e.target.value) || 8), 'Max pages updated')} className='px-2.5 py-1.5 text-xs rounded-md bg-void-bg-1 border border-void-border-2 text-void-fg-1' />
					</label>
					<label className='flex flex-col gap-1'>
						<span className='text-xs font-medium text-void-fg-1'>Evidence freshness window (hours)</span>
						<input type='number' min={1} max={2160} value={current.freshnessMaxAgeHours} onChange={e => update('freshnessMaxAgeHours', Math.max(1, Number(e.target.value) || 168), 'Freshness window updated')} className='px-2.5 py-1.5 text-xs rounded-md bg-void-bg-1 border border-void-border-2 text-void-fg-1' />
					</label>
				</div>
			</SettingGroup>

			<SettingGroup title='Visual Memory, Comparison & Responsible Research' description='Controls multi-viewport screenshot capture, pixel diff comparisons, and external action safety.'>
				<SettingSwitch value={current.captureResponsiveScreenshots} onChange={v => update('captureResponsiveScreenshots', v, 'Responsive captures toggled')} label='Capture desktop & mobile responsive reference screenshots' description='Persists multi-viewport visual memory so implementation agents and comparisons use real layouts.' />
				<SettingSwitch value={current.enableVisualComparison} onChange={v => update('enableVisualComparison', v, 'Visual comparison toggled')} label='Enable reference-to-implementation visual comparison' description='Compares rendered implementation screenshots against reference captures while verifying functionality separately.' />
				<SettingSwitch value={current.confirmConsequentialExternalActions} onChange={v => update('confirmConsequentialExternalActions', v, 'Confirmation guard toggled')} label='Require confirmation for consequential external actions' description='Blocks unconfirmed purchases, payments, publishing, messaging, or destructive external form submits.' />
			</SettingGroup>
		</SettingsSection>
	);
};
