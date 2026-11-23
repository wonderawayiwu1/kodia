/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { useAccessor, useSettingsState } from '../util/services.js';
import { SettingGroup, SettingsSection, SettingSwitch } from './SettingsControls.js';
import { KodiaBadge, KodiaSecondaryButton } from '../util/KodiaDesignSystem.js';
import { CorrectnessEngineSettings, DEFAULT_CORRECTNESS_ENGINE_SETTINGS } from '../../../../common/correctnessTypes.js';

export const CorrectnessSettingsSection = ({ onRecordChange }: { onRecordChange?: (label: string) => void }) => {
	const accessor = useAccessor();
	const voidSettingsService = accessor.get('IVoidSettingsService');
	const correctnessService = accessor.get('ICorrectnessService');
	const settingsState = useSettingsState();

	const current: CorrectnessEngineSettings = {
		...DEFAULT_CORRECTNESS_ENGINE_SETTINGS,
		...(settingsState.globalSettings.correctness ?? {}),
	};

	const update = <K extends keyof CorrectnessEngineSettings>(key: K, value: CorrectnessEngineSettings[K], label: string) => {
		voidSettingsService.setGlobalSetting('correctness', { ...current, [key]: value });
		onRecordChange?.(`Correctness Engine: ${label}`);
	};

	return (
		<SettingsSection
			title='Deep Debugging & Correctness Engine'
			description='Configure incremental multi-layer analysis, taint tracking, property/fuzz & mutation defaults, independent verification gates, and honest release readiness policies.'
			badge={<KodiaBadge tone='accent'><ShieldCheck size={11} /> 14 Tools · Independent Verifier</KodiaBadge>}
		>
			<div className='flex items-center justify-end pb-1'>
				<KodiaSecondaryButton onClick={() => void correctnessService.openHub('diagnostics')}>
					<ShieldCheck size={12} /> Open Debugging & Correctness Hub (Ctrl+Alt+D)
				</KodiaSecondaryButton>
			</div>

			<SettingGroup title='Analysis, Taint & Hub Behavior' description='Controls dependency-aware incremental diagnostics, security taint scanning, and automatic Hub opening.'>
				<SettingSwitch
					value={current.enableIncrementalAnalysis}
					onChange={v => update('enableIncrementalAnalysis', v, `Incremental analysis ${v ? 'on' : 'off'}`)}
					label='Enable dependency-aware incremental analysis'
					description='Caches unchanged file diagnostics and re-analyzes only changed files plus transitive dependents.'
				/>
				<SettingSwitch
					value={current.enableTaintAnalysis}
					onChange={v => update('enableTaintAnalysis', v, `Taint analysis ${v ? 'on' : 'off'}`)}
					label='Enable source → sanitizer → sink data-flow & taint analysis'
					description='Detects SQL injection, shell injection, unsafe eval, XSS, path traversal, SSRF, and secret logging.'
				/>
				<SettingSwitch
					value={current.autoOpenHubOnDeepInvestigation}
					onChange={v => update('autoOpenHubOnDeepInvestigation', v, `Auto-open Hub ${v ? 'on' : 'off'}`)}
					label='Open native Correctness Hub during deep debugging investigations'
					description='Opens the in-editor Debugging & Correctness Hub so live findings and verification verdicts stay visible.'
				/>
			</SettingGroup>

			<SettingGroup title='Independent Verification, Fuzz & Mutation Defaults' description='Enforces adversarial verification before declaring repairs done and bounds fuzz/mutation budgets.'>
				<SettingSwitch
					value={current.requireIndependentVerificationForRepairs}
					onChange={v => update('requireIndependentVerificationForRepairs', v, `Require Independent Verification ${v ? 'on' : 'off'}`)}
					label='Require Independent Verification before approving code repairs'
					description='Re-runs compilers, static/taint scans, and real test commands independently and rejects broken or unverified fixes.'
				/>
				<SettingSwitch
					value={current.blockReleaseOnCriticalFindings}
					onChange={v => update('blockReleaseOnCriticalFindings', v, `Block release on criticals ${v ? 'on' : 'off'}`)}
					label='Block release readiness when critical static or taint findings remain'
					description='Ensures Release Readiness reports not_ready_failures instead of verified_against_checks whenever critical defects exist.'
				/>
				<div className='grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1'>
					<label className='flex flex-col gap-1'>
						<span className='text-xs font-medium text-void-fg-1'>Default fuzz iterations</span>
						<input
							type='number'
							min={10}
							max={5000}
							value={current.fuzzDefaultIterations}
							onChange={e => update('fuzzDefaultIterations', Math.max(10, Number(e.target.value) || 150), 'Fuzz iterations updated')}
							className='px-2.5 py-1.5 text-xs rounded-md bg-void-bg-1 border border-void-border-2 text-void-fg-1'
						/>
					</label>
					<label className='flex flex-col gap-1'>
						<span className='text-xs font-medium text-void-fg-1'>Max mutants per run</span>
						<input
							type='number'
							min={1}
							max={200}
							value={current.mutationMaxMutantsPerRun}
							onChange={e => update('mutationMaxMutantsPerRun', Math.max(1, Number(e.target.value) || 25), 'Max mutants updated')}
							className='px-2.5 py-1.5 text-xs rounded-md bg-void-bg-1 border border-void-border-2 text-void-fg-1'
						/>
					</label>
					<label className='flex flex-col gap-1'>
						<span className='text-xs font-medium text-void-fg-1'>Mutant timeout (ms)</span>
						<input
							type='number'
							min={1000}
							max={120000}
							value={current.mutationTimeoutMs}
							onChange={e => update('mutationTimeoutMs', Math.max(1000, Number(e.target.value) || 12000), 'Mutant timeout updated')}
							className='px-2.5 py-1.5 text-xs rounded-md bg-void-bg-1 border border-void-border-2 text-void-fg-1'
						/>
					</label>
				</div>
			</SettingGroup>
		</SettingsSection>
	);
};
