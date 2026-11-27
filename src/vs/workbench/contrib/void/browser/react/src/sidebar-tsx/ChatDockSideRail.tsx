/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, FileDiff, Globe, Loader2, Rocket, X, XCircle } from 'lucide-react';
import { useAccessor, useCommandBarState } from '../util/services.js';
import type { LeiLiveSnapshot } from '../../../../common/liveIntelligenceTypes.js';
import type { UabeProjectState } from '../../../../common/universalAppBuilderTypes.js';

export type ChatDockPanelKey = 'appBuilder' | 'intelligence' | 'changes';

export interface ChatDockVisibilityState {
	appBuilder: boolean;
	intelligence: boolean;
	changes: boolean;
}

const STORAGE_KEY = 'kodia.chatDock.visiblePanels.v1';

const DEFAULT_VISIBILITY: ChatDockVisibilityState = {
	appBuilder: false,
	intelligence: false,
	changes: false,
};

function loadInitialVisibility(): ChatDockVisibilityState {
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) { return DEFAULT_VISIBILITY; }
		const parsed = JSON.parse(raw) as Partial<ChatDockVisibilityState>;
		return {
			appBuilder: Boolean(parsed.appBuilder),
			intelligence: Boolean(parsed.intelligence),
			changes: Boolean(parsed.changes),
		};
	} catch {
		return DEFAULT_VISIBILITY;
	}
}

export function useChatDockVisibility() {
	const [visible, setVisible] = useState<ChatDockVisibilityState>(loadInitialVisibility);

	const toggle = useCallback((key: ChatDockPanelKey) => {
		setVisible(prev => {
			const next = { ...prev, [key]: !prev[key] };
			try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
			return next;
		});
	}, []);

	const hide = useCallback((key: ChatDockPanelKey) => {
		setVisible(prev => {
			if (!prev[key]) { return prev; }
			const next = { ...prev, [key]: false };
			try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
			return next;
		});
	}, []);

	return { visible, toggle, hide };
}

export interface ChatDockSideRailProps {
	visible: ChatDockVisibilityState;
	onToggle: (key: ChatDockPanelKey) => void;
	showChangesToggle?: boolean;
	isRunning?: boolean;
	awaitingUser?: boolean;
}

/**
 * Ultra-compact vertical toggle rail docked alongside the chat input box so the
 * App Builder/Tools bar, Live Engineering Intelligence bar, and File Changes/Usage bar
 * take ZERO vertical height until toggled open on demand.
 */
export const ChatDockSideRail: React.FC<ChatDockSideRailProps> = React.memo(({
	visible,
	onToggle,
	showChangesToggle = true,
	isRunning = false,
	awaitingUser = false,
}) => {
	const accessor = useAccessor();
	const uabe = accessor.get('IUniversalAppBuilderService');
	const leiService = accessor.get('ILiveIntelligenceService');
	const { sortedURIs } = useCommandBarState();

	const [uabeState, setUabeState] = useState<UabeProjectState>(() => uabe.getCachedProjectState());
	const [leiSnap, setLeiSnap] = useState<LeiLiveSnapshot>(() => leiService.getCachedSnapshot());

	useEffect(() => {
		const dUabe = uabe.onDidChangeProject(s => setUabeState(s));
		const dLei = leiService.onDidChangeSnapshot(s => setLeiSnap(s));
		return () => {
			dUabe.dispose();
			dLei.dispose();
		};
	}, [uabe, leiService]);

	const pendingCreds = uabeState.integrations.filter(i => i.classification === 'mandatory' && !i.configured).length;
	const relStatus = uabeState.reliability?.overallStatus;
	const appDotColor = pendingCreds > 0
		? 'bg-amber-400'
		: relStatus === 'needs_fixes'
			? 'bg-rose-400'
			: relStatus === 'verified_against_executed_checks'
				? 'bg-emerald-400'
				: null;

	const isLeiResearching = leiSnap.activeOperations.length > 0;
	const leiWarn = leiSnap.systemStatus === 'degraded' || leiSnap.staleEvidenceCount > 0 || leiSnap.conflictCount > 0;
	const leiErr = leiSnap.systemStatus === 'unavailable' || leiSnap.researchMode === 'research_unavailable';
	const leiLabel = isLeiResearching
		? 'Researching'
		: leiErr
			? 'Unavailable'
			: leiWarn
				? (leiSnap.conflictCount > 0 ? 'Conflicting' : 'Refresh required')
				: leiSnap.systemStatus === 'disabled'
					? 'Disabled'
					: 'Active';

	const numFilesChanged = sortedURIs.length;

	const baseBtn = 'relative w-6 h-6 rounded-md border flex items-center justify-center cursor-pointer transition-all select-none flex-shrink-0';
	const activeBtn = 'bg-sky-500/20 border-sky-400/70 text-sky-300 shadow-xs';
	const idleBtn = 'bg-void-bg-1 border-void-border-2 text-void-fg-3 hover:text-void-fg-1 hover:bg-void-bg-2 hover:border-void-border-1';

	return (
		<div
			className='flex flex-col items-center justify-start gap-1 pt-0.5 flex-shrink-0 select-none'
			aria-label='Toggle chat toolbars'
		>
			{/* 1. App Builder / Automation / Auto Build / IRIRE / Reliability / Handover */}
			<button
				type='button'
				onClick={() => onToggle('appBuilder')}
				aria-pressed={visible.appBuilder}
				title={`${visible.appBuilder ? 'Hide' : 'Show'} App Builder, Automation, Auto Build, IRIRE, Reliability & Handover bar${pendingCreds > 0 ? ` (${pendingCreds} key(s) needed)` : ''}`}
				className={`${baseBtn} ${visible.appBuilder ? activeBtn : idleBtn}`}
			>
				<Rocket size={12} className={visible.appBuilder ? 'text-sky-300' : 'text-sky-400/90'} />
				{appDotColor && (
					<span className={`absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full ${appDotColor}`} />
				)}
			</button>

			{/* 2. Live Engineering Intelligence */}
			<button
				type='button'
				onClick={() => onToggle('intelligence')}
				aria-pressed={visible.intelligence}
				title={`${visible.intelligence ? 'Hide' : 'Show'} Engineering Intelligence (${leiLabel})`}
				className={`${baseBtn} ${visible.intelligence ? activeBtn : idleBtn}`}
			>
				{isLeiResearching ? (
					<Loader2 size={12} className='text-sky-400 animate-spin' />
				) : leiErr ? (
					<XCircle size={12} className='text-rose-400' />
				) : leiWarn ? (
					<AlertTriangle size={12} className='text-amber-400' />
				) : (
					<Globe size={12} className='text-emerald-400' />
				)}
				{!isLeiResearching && (leiWarn || leiErr) && (
					<span className={`absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full ${leiErr ? 'bg-rose-400' : 'bg-amber-400'}`} />
				)}
			</button>

			{/* 3. Files Changed & Token Usage / Thread Status */}
			{showChangesToggle && (
				<button
					type='button'
					onClick={() => onToggle('changes')}
					aria-pressed={visible.changes}
					title={`${visible.changes ? 'Hide' : 'Show'} File Changes & Token Usage bar (${numFilesChanged === 0 ? 'No files with changes' : `${numFilesChanged} file${numFilesChanged === 1 ? '' : 's'} with changes`})`}
					className={`${baseBtn} ${visible.changes ? activeBtn : idleBtn}`}
				>
					<FileDiff size={12} />
					{numFilesChanged > 0 ? (
						<span className='absolute -top-1 -right-1 min-w-[13px] h-[13px] px-0.5 rounded-full bg-sky-500 text-[8px] font-bold text-white flex items-center justify-center leading-none'>
							{numFilesChanged > 9 ? '9+' : numFilesChanged}
						</span>
					) : awaitingUser ? (
						<span className='absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse' />
					) : isRunning ? (
						<span className='absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse' />
					) : null}
				</button>
			)}
		</div>
	);
});

export const ChatDockDismissWrapper: React.FC<{
	label: string;
	onHide: () => void;
	children: React.ReactNode;
}> = ({ label, onHide, children }) => (
	<div className='relative group/dock'>
		{children}
		<button
			type='button'
			onClick={onHide}
			title={`Hide ${label}`}
			aria-label={`Hide ${label}`}
			className='absolute top-1 right-3 z-10 w-4 h-4 rounded flex items-center justify-center bg-void-bg-2/90 border border-void-border-2 text-void-fg-3 hover:text-void-fg-1 hover:bg-void-bg-3 opacity-0 group-hover/dock:opacity-100 transition-opacity cursor-pointer'
		>
			<X size={10} />
		</button>
	</div>
);
