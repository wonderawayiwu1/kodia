/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useState } from 'react';
import {
	Activity,
	ArrowRight,
	BookOpen,
	Camera,
	CheckCircle2,
	Compass,
	ExternalLink,
	Globe,
	Play,
	RefreshCw,
	Sparkles,
	Square,
} from 'lucide-react';
import '../styles.css';
import { ArpeiWorkbenchState } from '../../../arpeiService.js';
import { useAccessor, useIsDark } from '../util/services.js';

export const ArpeiSidebarView: React.FC = () => {
	const isDark = useIsDark();
	const accessor = useAccessor();
	const arpeiService = accessor.get('IArpeiService');
	const [state, setState] = useState<ArpeiWorkbenchState>(arpeiService.state);
	const [quickPrompt, setQuickPrompt] = useState('');

	useEffect(() => {
		const sub = arpeiService.onDidChange(() => setState(arpeiService.state));
		void arpeiService.refreshFromDisk();
		return () => sub.dispose();
	}, [arpeiService]);

	const session = arpeiService.getActiveSession();
	const latestShot = session?.screenshots.find(sc => Boolean(sc.thumbnailDataUrl));

	const runQuickInvestigate = async () => {
		const q = quickPrompt.trim();
		if (!q || state.isRunning) { return; }
		setQuickPrompt('');
		await arpeiService.openWorkspace('overview');
		void arpeiService.runFullLiveInvestigation({ userPrompt: q });
	};

	return (
		<div
			className={`@@void-scope ${isDark ? 'dark' : ''}`}
			style={{ width: '100%', height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
		>
			<div
				className='flex-1 flex flex-col gap-3 p-3 text-xs text-void-fg-1 bg-void-bg-2 select-none'
				style={{ minHeight: 0, overflowY: 'auto' }}
			>
				{/* Header */}
				<div className='flex items-center justify-between gap-2 pb-2 border-b border-void-border-2 shrink-0'>
					<div className='flex items-center gap-2 min-w-0'>
						<div className='w-6 h-6 rounded-md bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center shrink-0'>
							<Compass size={13} className='text-cyan-400' />
						</div>
						<div className='min-w-0'>
							<div className='font-semibold text-void-fg-1 truncate'>Research Intelligence</div>
							<div className='text-[10px] text-void-fg-3 truncate'>Live Product &amp; Web Discovery</div>
						</div>
					</div>
					<button
						type='button'
						onClick={() => void arpeiService.openWorkspace('overview')}
						className='px-2 py-1 rounded-md bg-void-bg-1 border border-void-border-2 text-void-fg-2 hover:text-void-fg-1 hover:bg-void-bg-3 flex items-center gap-1 text-[11px] font-medium cursor-pointer transition-colors shrink-0'
						title='Open ARPEI Research Intelligence Workspace (Ctrl+Alt+P)'
					>
						<ExternalLink size={11} />
						<span>Open</span>
					</button>
				</div>

				{/* Quick Live Investigate Input */}
				<div className='flex flex-col gap-1.5 shrink-0'>
					<div className='flex gap-1.5'>
						<input
							value={quickPrompt}
							onChange={e => setQuickPrompt(e.target.value)}
							onKeyDown={e => { if (e.key === 'Enter') { void runQuickInvestigate(); } }}
							placeholder='Research any app (e.g. Udemy)...'
							className='flex-1 min-w-0 px-2.5 py-1.5 rounded-md bg-void-bg-1 border border-void-border-2 text-void-fg-1 placeholder:text-void-fg-3 text-[11px] focus:border-sky-500/70 focus:outline-none'
						/>
						<button
							type='button'
							disabled={!quickPrompt.trim() || state.isRunning}
							onClick={() => void runQuickInvestigate()}
							title='Start Live Research'
							className='px-2.5 py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 disabled:opacity-45 text-white cursor-pointer transition-colors shrink-0 flex items-center justify-center'
						>
							<Play size={11} />
						</button>
					</div>
					<button
						type='button'
						onClick={() => void arpeiService.openWorkspace('overview')}
						className='w-full px-3 py-1.5 rounded-md bg-void-bg-1 hover:bg-void-bg-3 border border-void-border-2 text-void-fg-1 font-medium flex items-center justify-center gap-1.5 cursor-pointer transition-colors text-[11px]'
					>
						<Sparkles size={11} className='text-cyan-400' />
						<span>Open Full Research Studio</span>
						<ArrowRight size={11} />
					</button>
				</div>

				{/* Live Running Indicator */}
				{state.isRunning && (
					<div className='p-2.5 rounded-lg bg-sky-500/10 border border-sky-500/35 flex flex-col gap-2 shrink-0'>
						<div className='flex items-center justify-between gap-2'>
							<span className='text-[11px] font-semibold text-sky-300 flex items-center gap-1.5'>
								<span className='w-2 h-2 rounded-full bg-sky-400 animate-pulse' />
								Live Research Running
							</span>
							<button
								type='button'
								onClick={() => void arpeiService.cancelActiveResearch()}
								className='px-1.5 py-0.5 rounded bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-300 text-[10px] font-medium flex items-center gap-1 cursor-pointer'
							>
								<Square size={9} /> Stop
							</button>
						</div>
						<div className='w-full h-1.5 rounded-full bg-void-bg-1 overflow-hidden'>
							<div
								className='h-full bg-sky-500 transition-all duration-300'
								style={{ width: `${Math.max(8, Math.min(100, state.progressPct || 15))}%` }}
							/>
						</div>
						<div className='text-[10px] text-void-fg-2 leading-snug'>
							{state.activeStage ?? state.activeBrowserStatus.currentAction ?? 'Running live investigation...'}
						</div>
						{state.activeBrowserStatus.currentUrl && (
							<div className='font-mono text-[10px] text-cyan-400 truncate'>
								{state.activeBrowserStatus.currentUrl}
							</div>
						)}
					</div>
				)}

				{/* Quick Workspace Links */}
				<div className='grid grid-cols-3 gap-1.5 shrink-0'>
					<button
						type='button'
						onClick={() => void arpeiService.openWorkspace('live_browser')}
						className='px-1.5 py-1.5 rounded-md bg-void-bg-1 hover:bg-void-bg-3 border border-void-border-2 text-void-fg-2 hover:text-void-fg-1 flex items-center justify-center gap-1 cursor-pointer transition-colors text-[10px]'
					>
						<Activity size={11} className='text-emerald-400 shrink-0' />
						<span className='truncate'>Live</span>
					</button>
					<button
						type='button'
						onClick={() => void arpeiService.openWorkspace('screenshot_gallery')}
						className='px-1.5 py-1.5 rounded-md bg-void-bg-1 hover:bg-void-bg-3 border border-void-border-2 text-void-fg-2 hover:text-void-fg-1 flex items-center justify-center gap-1 cursor-pointer transition-colors text-[10px]'
					>
						<Camera size={11} className='text-violet-400 shrink-0' />
						<span className='truncate'>Visuals</span>
					</button>
					<button
						type='button'
						onClick={() => void arpeiService.openWorkspace('technical_research')}
						className='px-1.5 py-1.5 rounded-md bg-void-bg-1 hover:bg-void-bg-3 border border-void-border-2 text-void-fg-2 hover:text-void-fg-1 flex items-center justify-center gap-1 cursor-pointer transition-colors text-[10px]'
					>
						<BookOpen size={11} className='text-sky-400 shrink-0' />
						<span className='truncate'>Web</span>
					</button>
				</div>

				{/* Active Session Summary Card */}
				{session ? (
					<div className='p-3 rounded-lg bg-void-bg-1 border border-void-border-2 flex flex-col gap-2.5 shrink-0'>
						<div className='min-w-0'>
							<div className='text-[10px] uppercase tracking-wider text-void-fg-3'>Active Session</div>
							<div className='font-semibold text-void-fg-1 truncate mt-0.5'>{session.title}</div>
							<div className='text-[11px] text-cyan-400 truncate'>{session.domainDiscovery.softwareCategory}</div>
						</div>
						<div className='grid grid-cols-2 gap-1.5 text-center'>
							<div className='p-1.5 rounded-md bg-void-bg-2 border border-void-border-2'>
								<div className='text-sm font-bold text-void-fg-1'>{session.evidence.length}</div>
								<div className='text-[9px] uppercase text-void-fg-3'>Web Sources</div>
							</div>
							<div className='p-1.5 rounded-md bg-void-bg-2 border border-void-border-2'>
								<div className='text-sm font-bold text-void-fg-1'>{session.pages.filter(p => p.status === 'inspected').length}</div>
								<div className='text-[9px] uppercase text-void-fg-3'>Pages</div>
							</div>
							<div className='p-1.5 rounded-md bg-void-bg-2 border border-void-border-2'>
								<div className='text-sm font-bold text-void-fg-1'>{session.screenshots.length}</div>
								<div className='text-[9px] uppercase text-void-fg-3'>Screenshots</div>
							</div>
							<div className='p-1.5 rounded-md bg-void-bg-2 border border-void-border-2'>
								<div className='text-sm font-bold text-void-fg-1'>{session.assets.length}</div>
								<div className='text-[9px] uppercase text-void-fg-3'>Assets</div>
							</div>
						</div>

						{latestShot?.thumbnailDataUrl && (
							<button
								type='button'
								onClick={() => void arpeiService.openWorkspace('screenshot_gallery')}
								className='w-full rounded-md overflow-hidden border border-void-border-2 bg-void-bg-2 cursor-pointer hover:border-sky-500/50 transition-colors text-left'
							>
								<img
									src={latestShot.thumbnailDataUrl}
									alt={latestShot.pageTitle}
									className='w-full h-24 object-cover object-top block'
								/>
								<div className='px-2 py-1 text-[10px] text-void-fg-2 truncate'>
									{latestShot.pageTitle}
								</div>
							</button>
						)}

						<div className='flex items-center justify-between pt-1.5 border-t border-void-border-2 text-[11px]'>
							<span className='text-void-fg-3 flex items-center gap-1'><CheckCircle2 size={11} /> Readiness</span>
							<span className={`font-semibold capitalize ${session.readinessGate.readyToImplement ? 'text-emerald-400' : 'text-amber-400'}`}>
								{session.readinessGate.verdict.replace(/_/g, ' ')}
							</span>
						</div>
					</div>
				) : (
					<div className='p-3 rounded-lg bg-void-bg-1 border border-void-border-2 flex flex-col gap-2 shrink-0'>
						<div className='font-medium text-void-fg-1 text-[11px] flex items-center gap-1.5'>
							<Globe size={12} className='text-cyan-400' />
							<span>Autonomous Live Discovery</span>
						</div>
						<p className='text-[11px] text-void-fg-3 leading-relaxed'>
							Type any product name or idea above to run live web search, launch Playwright Chromium to capture real screenshots, extract design tokens, and generate a ready-to-build blueprint.
						</p>
						<div className='text-[10px] text-void-fg-3 pt-1 border-t border-void-border-2/70'>
							Shortcut: <kbd className='px-1 py-0.2 rounded bg-void-bg-2 border border-void-border-2'>Ctrl+Alt+P</kbd>
						</div>
					</div>
				)}

				{state.sessions.length > 0 && (
					<div className='flex flex-col gap-1 shrink-0'>
						<div className='text-[10px] uppercase tracking-wider text-void-fg-3 px-0.5'>Recent Sessions ({state.sessions.length})</div>
						{state.sessions.slice(0, 8).map(s => (
							<button
								key={s.id}
								type='button'
								onClick={() => { arpeiService.setActiveSession(s.id); void arpeiService.openWorkspace('overview'); }}
								className={`text-left px-2 py-1.5 rounded-md border text-[11px] cursor-pointer transition-colors flex items-center justify-between gap-2 ${s.id === session?.id
									? 'bg-sky-500/15 border-sky-500/40 text-sky-300 font-medium'
									: 'bg-void-bg-1 border-void-border-2 text-void-fg-2 hover:bg-void-bg-3 hover:text-void-fg-1'}`}
							>
								<span className='truncate'>{s.title}</span>
								<span className='text-[9px] text-void-fg-3 shrink-0'>{s.screenshots.length}img</span>
							</button>
						))}
					</div>
				)}

				{/* Footer */}
				<button
					type='button'
					onClick={() => void arpeiService.refreshFromDisk()}
					className='mt-auto w-full px-2.5 py-1.5 rounded-md bg-void-bg-1 hover:bg-void-bg-3 border border-void-border-2 text-void-fg-2 hover:text-void-fg-1 flex items-center justify-center gap-1.5 cursor-pointer transition-colors text-[11px] shrink-0'
				>
					<RefreshCw size={11} />
					<span>Refresh Sessions</span>
				</button>
			</div>
		</div>
	);
};
