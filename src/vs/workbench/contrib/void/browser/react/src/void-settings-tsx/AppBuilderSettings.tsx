/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useState } from 'react';
import { Globe, KeyRound, Radar, Rocket, ShieldCheck, Smartphone } from 'lucide-react';
import { useAccessor, useSettingsState } from '../util/services.js';
import { SettingGroup, SettingsSection, SettingSwitch } from './SettingsControls.js';
import { KodiaBadge, KodiaCard, KodiaPrimaryButton, KodiaSecondaryButton } from '../util/KodiaDesignSystem.js';
import {
	DEFAULT_UABE_ENGINE_SETTINGS,
	UabeBuildMode,
	UabeEngineSettings,
	UabeProjectState,
} from '../../../../common/universalAppBuilderTypes.js';
import { KODIA_OPEN_API_STUDIO_ACTION_ID } from '../../../apiStudioService.js';
import { KODIA_OPEN_CORRECTNESS_HUB_ACTION_ID } from '../../../correctnessService.js';
import { KODIA_OPEN_LIVE_INTELLIGENCE_ACTION_ID } from '../../../liveIntelligenceService.js';
import { KODIA_OPEN_MOBILE_STUDIO_ACTION_ID } from '../../../mobileEngineeringService.js';

const BUILD_MODES: readonly { id: UabeBuildMode; label: string; desc: string }[] = [
	{ id: 'autonomous_build', label: 'Autonomous Build (Default)', desc: 'End-to-end requirements, architecture, implementation, preview, tests, repair & handover.' },
	{ id: 'plan_first', label: 'Plan First', desc: 'Generate architecture, contracts, stack & IRIRE requirements first, then wait for approval.' },
	{ id: 'user_chooses', label: 'User Chooses Per Project', desc: 'Select build mode individually per project and persist it in .kodia/app-builder/.' },
];

export const AppBuilderSettingsSection = ({ onRecordChange }: { onRecordChange?: (label: string) => void }) => {
	const accessor = useAccessor();
	const voidSettingsService = accessor.get('IVoidSettingsService');
	const uabeService = accessor.get('IUniversalAppBuilderService');
	const commandService = accessor.get('ICommandService');
	const settingsState = useSettingsState();

	const [projectState, setProjectState] = useState<UabeProjectState>(() => uabeService.getCachedProjectState());

	useEffect(() => {
		let mounted = true;
		void uabeService.getProjectState().then(s => { if (mounted) setProjectState(s); });
		const d = uabeService.onDidChangeProject(s => setProjectState(s));
		return () => { mounted = false; d.dispose(); };
	}, [uabeService]);

	const current: UabeEngineSettings = {
		...DEFAULT_UABE_ENGINE_SETTINGS,
		...(settingsState.globalSettings.uabe ?? {}),
	};

	const update = <K extends keyof UabeEngineSettings>(key: K, value: UabeEngineSettings[K], label: string) => {
		voidSettingsService.setGlobalSetting('uabe', { ...current, [key]: value });
		onRecordChange?.(`Universal App Builder: ${label}`);
	};

	return (
		<SettingsSection
			title='Universal App Builder Engine (UABE)'
			description='Configure autonomous full-stack, mobile, desktop & AI application building, IRIRE external credential guidance, visual source-code sync, honest reliability gates, and client handover.'
			badge={<KodiaBadge tone='accent'><Rocket size={11} /> UABE + IRIRE + FPERE + ERIC</KodiaBadge>}
		>
			{/* Interactive One-Click Studio Launcher Bar */}
			<KodiaCard className='flex flex-wrap items-center justify-between gap-2 !p-3'>
				<div className='flex flex-wrap items-center gap-2'>
					<KodiaPrimaryButton onClick={() => void uabeService.openWorkspace('create')}>
						<Rocket size={12} /> Open Universal App Builder (Ctrl+Alt+U)
					</KodiaPrimaryButton>
					<KodiaSecondaryButton onClick={() => void uabeService.openWorkspace('integrations')}>
						<KeyRound size={12} /> Integrations (IRIRE)
					</KodiaSecondaryButton>
					<KodiaSecondaryButton onClick={() => void commandService.executeCommand(KODIA_OPEN_LIVE_INTELLIGENCE_ACTION_ID)}>
						<Radar size={12} /> Live Intelligence
					</KodiaSecondaryButton>
					<KodiaSecondaryButton onClick={() => void commandService.executeCommand(KODIA_OPEN_CORRECTNESS_HUB_ACTION_ID)}>
						<ShieldCheck size={12} /> Correctness Hub
					</KodiaSecondaryButton>
					<KodiaSecondaryButton onClick={() => void commandService.executeCommand(KODIA_OPEN_MOBILE_STUDIO_ACTION_ID)}>
						<Smartphone size={12} /> Mobile Studio
					</KodiaSecondaryButton>
					<KodiaSecondaryButton onClick={() => void commandService.executeCommand(KODIA_OPEN_API_STUDIO_ACTION_ID)}>
						<Globe size={12} /> API Studio
					</KodiaSecondaryButton>
				</div>
			</KodiaCard>

			<SettingGroup
				title='Default & Per-Project Build Mode'
				description='Choose the default build workflow for new projects, or override the active workspace project mode immediately without changing other projects.'
			>
				<div className='grid grid-cols-1 md:grid-cols-3 gap-2.5'>
					{BUILD_MODES.map(m => {
						const active = current.defaultBuildMode === m.id;
						return (
							<KodiaCard
								key={m.id}
								onClick={() => update('defaultBuildMode', m.id, `Default build mode → ${m.label}`)}
								className={`!p-3 cursor-pointer flex flex-col gap-1 ${active ? '!border-[var(--kodia-accent)] bg-void-bg-3' : ''}`}
							>
								<div className='flex items-center justify-between gap-1'>
									<span className='text-xs font-semibold text-void-fg-1'>{m.label}</span>
									{active && <KodiaBadge tone='accent'>Default</KodiaBadge>}
								</div>
								<p className='text-[11px] text-void-fg-3 leading-relaxed'>{m.desc}</p>
							</KodiaCard>
						);
					})}
				</div>

				<div className='mt-2 p-2.5 rounded-md bg-void-bg-1 border border-void-border-2 flex flex-wrap items-center justify-between gap-2 text-xs'>
					<div>
						<span className='font-medium text-void-fg-1'>Current Workspace Project Mode ({projectState.name}): </span>
						<KodiaBadge tone='accent'>{projectState.buildMode.replace(/_/g, ' ')}</KodiaBadge>
					</div>
					<div className='flex items-center gap-1'>
						{BUILD_MODES.map(m => (
							<button
								key={m.id}
								type='button'
								onClick={() => {
									void uabeService.setProjectBuildMode(m.id);
									onRecordChange?.(`Project "${projectState.name}" mode → ${m.id}`);
								}}
								className={`px-2 py-1 rounded text-[11px] border cursor-pointer ${projectState.buildMode === m.id
									? 'bg-void-bg-3 border-[var(--kodia-accent)] text-void-fg-1 font-medium'
									: 'bg-void-bg-2 border-void-border-2 text-void-fg-3 hover:text-void-fg-1'}`}
							>
								{m.id === 'autonomous_build' ? 'Autonomous' : m.id === 'plan_first' ? 'Plan First' : 'Per Project'}
							</button>
						))}
					</div>
				</div>
			</SettingGroup>

			<SettingGroup
				title='Autonomous Workflow, IRIRE & Visual Source Sync'
				description='Controls workspace interactivity, automatic external credential discovery, live preview, and visual-to-code editing.'
			>
				<SettingSwitch
					value={current.autoOpenAppBuilderOnBuildIntent}
					onChange={v => update('autoOpenAppBuilderOnBuildIntent', v, `Auto-open App Builder ${v ? 'on' : 'off'}`)}
					label='Open Universal App Builder automatically for full-application build requests'
					description='Surfaces live requirements, preview, integrations, and reliability tabs alongside Chat.'
				/>
				<SettingSwitch
					value={current.autoDiscoverExternalRequirements}
					onChange={v => update('autoDiscoverExternalRequirements', v, `IRIRE auto-discovery ${v ? 'on' : 'off'}`)}
					label='Automatically discover required accounts, API keys & setup guides (IRIRE)'
					description='Identifies databases, AI providers, payments, OAuth, email & cloud credentials with official links and guided onboarding.'
				/>
				<SettingSwitch
					value={current.autoOpenLivePreviewOnServerStart}
					onChange={v => update('autoOpenLivePreviewOnServerStart', v, `Auto-open Live Preview ${v ? 'on' : 'off'}`)}
					label='Open live embedded preview automatically when an app dev server starts'
					description='Supports mobile/tablet/laptop/desktop responsive testing without static mockups.'
				/>
				<SettingSwitch
					value={current.enableVisualEditSourceSync}
					onChange={v => update('enableVisualEditSourceSync', v, `Visual Edit Source Sync ${v ? 'on' : 'off'}`)}
					label='Enable visual editing synchronized to real source code with rollback checkpoints'
					description='Maps visual property edits directly to real HTML/JSX/CSS files instead of temporary preview-only styles.'
				/>
				<SettingSwitch
					value={current.showEngineStatusInChat}
					onChange={v => update('showEngineStatusInChat', v, `Chat Engine Controls ${v ? 'on' : 'off'}`)}
					label='Show interactive App Builder, Build Mode & IRIRE control strip in Chat'
					description='Gives one-click access to Build Mode, missing credentials, Reliability Gate, and Handover right inside Chat.'
				/>
			</SettingGroup>

			<SettingGroup
				title='Reliability, Security & Handover Safeguards'
				description='Enforces truthful verification evidence, zero-secret handover packages, and safe zero-surprise defaults.'
			>
				<SettingSwitch
					value={current.requireEvidenceBeforeCompletion}
					onChange={v => update('requireEvidenceBeforeCompletion', v, `Evidence-first completion ${v ? 'on' : 'off'}`)}
					label='Enforce honest evidence-based completion reporting (FPERE + ERIC)'
					description='Explicitly distinguishes verified checks from unverified or blocked items; never reports fake 100% completion.'
				/>
				<SettingSwitch
					value={current.enforceSecretRedactionInHandover}
					onChange={v => update('enforceSecretRedactionInHandover', v, `Handover secret redaction ${v ? 'on' : 'off'}`)}
					label='Enforce automatic secret scanning & redaction in Client Handover packages'
					description='Guarantees no API keys, passwords, or connection credentials are bundled into handover documentation or templates.'
				/>
				<SettingSwitch
					value={current.preferFreeLocalDefaultsWhenNoCredentials}
					onChange={v => update('preferFreeLocalDefaultsWhenNoCredentials', v, `Free/local defaults ${v ? 'on' : 'off'}`)}
					label='Prefer free local/sandbox adapters when paid cloud credentials are missing'
					description='Allows development and testing to continue uninterrupted while marking external integrations as pending credentials.'
				/>
			</SettingGroup>
		</SettingsSection>
	);
};
