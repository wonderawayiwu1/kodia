/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useState } from 'react';
import { KeyRound, Package, Rocket, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { useAccessor, useSettingsState } from '../util/services.js';
import type { UabeBuildMode, UabeProjectState } from '../../../../common/universalAppBuilderTypes.js';

const MODE_CYCLE: Record<UabeBuildMode, { next: UabeBuildMode; label: string; tip: string }> = {
	autonomous_build: {
		next: 'plan_first',
		label: 'Auto Build',
		tip: 'Project Build Mode: Autonomous Build (default) — click to switch to Plan First',
	},
	plan_first: {
		next: 'user_chooses',
		label: 'Plan First',
		tip: 'Project Build Mode: Plan First — click to switch to Per-Project Choice',
	},
	user_chooses: {
		next: 'autonomous_build',
		label: 'Per Project',
		tip: 'Project Build Mode: User Chooses Per Project — click to switch to Autonomous Build',
	},
};

export const AppBuilderChatBar: React.FC = () => {
	const accessor = useAccessor();
	const uabe = accessor.get('IUniversalAppBuilderService');
	const settings = useSettingsState();
	const [state, setState] = useState<UabeProjectState>(() => uabe.getCachedProjectState());

	useEffect(() => {
		let mounted = true;
		void uabe.getProjectState().then(s => { if (mounted) setState(s); });
		const d = uabe.onDidChangeProject(s => setState(s));
		return () => { mounted = false; d.dispose(); };
	}, [uabe]);

	if (settings.globalSettings.uabe?.showEngineStatusInChat === false) {
		return null;
	}

	const modeInfo = MODE_CYCLE[state.buildMode] ?? MODE_CYCLE.autonomous_build;
	const pendingCreds = state.integrations.filter(i => i.classification === 'mandatory' && !i.configured).length;
	const relStatus = state.reliability?.overallStatus;

	return (
		<div className='mx-2 mb-1 px-2 py-1 rounded-lg bg-void-bg-1 border border-void-border-2 flex flex-wrap items-center justify-between gap-1.5 text-[10px] select-none'>
			<div className='flex items-center gap-1.5 flex-wrap'>
				<button
					type='button'
					onClick={() => void uabe.openWorkspace('create')}
					title='Open Kodia Universal App Builder Workspace (Ctrl+Alt+U)'
					style={{ borderColor: 'var(--kodia-accent)' }}
					className='inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-void-bg-2 hover:bg-void-bg-3 border text-void-fg-1 font-medium cursor-pointer transition-colors'
				>
					<Rocket size={10} className='text-sky-400' />
					<span>App Builder</span>
				</button>

				<button
					type='button'
					onClick={() => void uabe.setProjectBuildMode(modeInfo.next)}
					title={modeInfo.tip}
					className='inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-void-bg-2 hover:bg-void-bg-3 border border-void-border-2 text-void-fg-2 cursor-pointer transition-colors'
				>
					<SlidersHorizontal size={10} />
					<span>{modeInfo.label}</span>
				</button>

				<button
					type='button'
					onClick={() => void uabe.openWorkspace('integrations')}
					title='Open IRIRE External Requirements, Verified Links & Secure Credentials'
					className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border cursor-pointer transition-colors ${pendingCreds > 0
						? 'bg-amber-500/15 border-amber-500/40 text-amber-200 hover:bg-amber-500/25'
						: 'bg-void-bg-2 border-void-border-2 text-void-fg-2 hover:bg-void-bg-3'}`}
				>
					<KeyRound size={10} />
					<span>{pendingCreds > 0 ? `${pendingCreds} Key(s) Needed` : `IRIRE (${state.integrations.length})`}</span>
				</button>
			</div>

			<div className='flex items-center gap-1'>
				<button
					type='button'
					onClick={() => void uabe.openWorkspace('reliability')}
					title='Open Application Reliability Dashboard (FPERE + ERIC + IRIRE)'
					className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border cursor-pointer transition-colors ${relStatus === 'needs_fixes'
						? 'bg-rose-500/15 border-rose-500/40 text-rose-200'
						: relStatus === 'verified_against_executed_checks'
							? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200'
							: 'bg-void-bg-2 border-void-border-2 text-void-fg-2 hover:bg-void-bg-3'}`}
				>
					<ShieldCheck size={10} />
					<span>Reliability</span>
				</button>
				<button
					type='button'
					onClick={() => void uabe.openWorkspace('handover')}
					title='Generate Client Delivery & Handover Package'
					className='inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-void-bg-2 hover:bg-void-bg-3 border border-void-border-2 text-void-fg-2 cursor-pointer transition-colors'
				>
					<Package size={10} />
					<span>Handover</span>
				</button>
			</div>
		</div>
	);
};
