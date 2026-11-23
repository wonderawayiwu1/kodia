/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React from 'react';
import { Globe } from 'lucide-react';
import { useAccessor, useSettingsState } from '../util/services.js';
import { SettingGroup, SettingsSection, SettingSwitch } from './SettingsControls.js';
import { KodiaBadge, KodiaSecondaryButton } from '../util/KodiaDesignSystem.js';
import { ApiStudioSettings, DEFAULT_API_STUDIO_SETTINGS } from '../../../../common/apiStudioTypes.js';

export const ApiStudioSettingsSection = ({ onRecordChange }: { onRecordChange?: (label: string) => void }) => {
	const accessor = useAccessor();
	const voidSettingsService = accessor.get('IVoidSettingsService');
	const apiStudioService = accessor.get('IApiStudioService');
	const settingsState = useSettingsState();

	const current: ApiStudioSettings = {
		...DEFAULT_API_STUDIO_SETTINGS,
		...(settingsState.globalSettings.apiStudio ?? {}),
	};

	const update = <K extends keyof ApiStudioSettings>(key: K, value: ApiStudioSettings[K], label: string) => {
		voidSettingsService.setGlobalSetting('apiStudio', { ...current, [key]: value });
		onRecordChange?.(`API Studio: ${label}`);
	};

	return (
		<SettingsSection
			title='Kodia API Engineering Studio'
			description='Configure native in-editor API Studio auto-launch, protocol timeouts, sandboxed scripting, production environment safeguards, and performance/security defaults.'
			badge={<KodiaBadge tone='accent'><Globe size={11} /> 20 API Tools · Native Editor Studio</KodiaBadge>}
		>
			<div className='flex items-center justify-end pb-1'>
				<KodiaSecondaryButton onClick={() => void apiStudioService.openStudio({ section: 'requests' })}>
					<Globe size={12} /> Open Native API Studio (Ctrl+Alt+A)
				</KodiaSecondaryButton>
			</div>

			<SettingGroup title='Workspace & Native Studio Behavior' description='Controls automatic opening of API Studio inside the workbench when testing, debugging, or inspecting APIs.'>
				<SettingSwitch
					value={current.autoOpenStudioOnApiTasks}
					onChange={v => update('autoOpenStudioOnApiTasks', v, `Auto-open Studio ${v ? 'on' : 'off'}`)}
					label='Automatically open native API Studio on API testing & discovery tasks'
					description='Opens the in-editor API Studio tab when you ask Kodia to test, inspect, load-test, or audit an API.'
				/>
				<SettingSwitch
					value={current.followRedirects}
					onChange={v => update('followRedirects', v, `Follow redirects ${v ? 'on' : 'off'}`)}
					label='Follow HTTP redirects automatically (up to 5 hops)'
					description='Tracks every redirect hop in the response inspector while resolving final payloads.'
				/>
				<div className='grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1'>
					<label className='flex flex-col gap-1'>
						<span className='text-xs font-medium text-void-fg-1'>Default timeout (ms)</span>
						<input
							type='number'
							min={500}
							max={120000}
							value={current.defaultTimeoutMs}
							onChange={e => update('defaultTimeoutMs', Math.max(500, Number(e.target.value) || 15000), 'Timeout updated')}
							className='px-2.5 py-1.5 text-xs rounded-md bg-void-bg-1 border border-void-border-2 text-void-fg-1'
						/>
					</label>
					<label className='flex flex-col gap-1'>
						<span className='text-xs font-medium text-void-fg-1'>Script sandbox timeout (ms)</span>
						<input
							type='number'
							min={200}
							max={10000}
							value={current.scriptTimeoutMs}
							onChange={e => update('scriptTimeoutMs', Math.max(200, Number(e.target.value) || 2000), 'Script timeout updated')}
							className='px-2.5 py-1.5 text-xs rounded-md bg-void-bg-1 border border-void-border-2 text-void-fg-1'
						/>
					</label>
					<label className='flex flex-col gap-1'>
						<span className='text-xs font-medium text-void-fg-1'>Default load concurrency (VUs)</span>
						<input
							type='number'
							min={1}
							max={200}
							value={current.defaultLoadConcurrency}
							onChange={e => update('defaultLoadConcurrency', Math.max(1, Number(e.target.value) || 10), 'Concurrency updated')}
							className='px-2.5 py-1.5 text-xs rounded-md bg-void-bg-1 border border-void-border-2 text-void-fg-1'
						/>
					</label>
				</div>
			</SettingGroup>

			<SettingGroup title='Security, Sandboxing & Production Safeguards' description='Protects live production environments and prevents secret exposure in request history or exports.'>
				<SettingSwitch
					value={current.protectProductionEnvironments}
					onChange={v => update('protectProductionEnvironments', v, `Production protection ${v ? 'on' : 'off'}`)}
					label='Protect production environments against destructive requests'
					description='Blocks DELETE/PUT/PATCH requests targeting production or protected environments unless explicitly confirmed.'
				/>
				<SettingSwitch
					value={current.redactSecretsInHistory}
					onChange={v => update('redactSecretsInHistory', v, `Secret redaction ${v ? 'on' : 'off'}`)}
					label='Redact Authorization headers, tokens, and secret variables in history & exports'
					description='Masks Bearer tokens, API keys, Basic credentials, and secret environment values before persisting history.'
				/>
				<SettingSwitch
					value={current.enableScriptSandbox}
					onChange={v => update('enableScriptSandbox', v, `Script sandbox ${v ? 'on' : 'off'}`)}
					label='Run pre-request and test scripts inside isolated VM sandbox'
					description='Restricts scripts from accessing host filesystem or OS processes while supporting kodia.env and kodia.expect.'
				/>
				<SettingSwitch
					value={current.allowLiveSecurityProbesOnLocalhost}
					onChange={v => update('allowLiveSecurityProbesOnLocalhost', v, `Local security probes ${v ? 'on' : 'off'}`)}
					label='Allow safe live API security probes against localhost targets'
					description='Checks security headers, CORS reflection, unauthenticated access, and stack trace leakage on local test services.'
				/>
			</SettingGroup>
		</SettingsSection>
	);
};
