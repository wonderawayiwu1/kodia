/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useState } from 'react';
import { Activity, Pause, Play, Square, ExternalLink, CheckCircle2, AlertTriangle } from 'lucide-react';
import '../styles.css';
import { useAccessor, useIsDark } from '../util/services.js';
import { CodeReviewWorkbenchState } from '../../../codeReviewService.js';

export const CodeReviewLivePanel: React.FC = () => {
	const isDark = useIsDark();
	const accessor = useAccessor();
	const codeReviewService = accessor.get('ICodeReviewService');
	const [state, setState] = useState<CodeReviewWorkbenchState>(codeReviewService.state);

	useEffect(() => {
		const sub = codeReviewService.onDidChange(() => setState(codeReviewService.state));
		return () => sub.dispose();
	}, [codeReviewService]);

	const session = codeReviewService.getActiveSession();
	const recentEvents = [...state.liveEvents].slice(-30).reverse();

	return (
		<div className={`@@void-scope ${isDark ? 'dark' : ''}`} style={{ width: '100%', height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
			<div className='flex-1 min-h-0 flex flex-col gap-2.5 p-3 text-xs text-void-fg-1 bg-void-bg-2 w-full overflow-hidden'>
				<div className='flex items-center justify-between pb-2 border-b border-void-border-2'>
					<div className='flex items-center gap-1.5 font-semibold'>
						<Activity size={14} className='text-sky-400' />
						<span>Live Code Review</span>
					</div>
					<button
						type='button'
						onClick={() => void codeReviewService.openWorkbench('current_review')}
						className='px-2 py-1 rounded-md bg-void-bg-1 hover:bg-void-bg-3 border border-void-border-2 text-[11px] text-void-fg-2 hover:text-void-fg-1 flex items-center gap-1 cursor-pointer transition-colors'
					>
						<ExternalLink size={10} /> Full View
					</button>
				</div>

				<div className='p-2.5 rounded-md bg-void-bg-1 border border-void-border-2 flex flex-col gap-1.5'>
					<div className='flex items-center justify-between'>
						<span className='font-medium capitalize'>Phase: {state.activePhase}</span>
						<span className='text-[11px] text-void-fg-3 font-mono'>{state.progressPct}%</span>
					</div>
					<div className='w-full h-1.5 rounded-full bg-void-bg-3 overflow-hidden'>
						<div className='h-full bg-sky-500 transition-all duration-300' style={{ width: `${state.progressPct}%` }} />
					</div>
					{state.isRunning && (
						<div className='flex gap-1.5 pt-1'>
							<button type='button' onClick={() => void codeReviewService.pauseActiveReview()} className='px-2 py-1 rounded bg-void-bg-2 hover:bg-void-bg-3 border border-void-border-2 flex items-center gap-1 cursor-pointer text-[11px]'><Pause size={10} /> Pause</button>
							<button type='button' onClick={() => void codeReviewService.resumeActiveReview()} className='px-2 py-1 rounded bg-void-bg-2 hover:bg-void-bg-3 border border-void-border-2 flex items-center gap-1 cursor-pointer text-[11px]'><Play size={10} /> Resume</button>
							<button type='button' onClick={() => void codeReviewService.cancelActiveReview()} className='px-2 py-1 rounded bg-red-500/15 hover:bg-red-500/25 text-red-400 border border-red-500/35 flex items-center gap-1 cursor-pointer text-[11px]'><Square size={10} /> Cancel</button>
						</div>
					)}
				</div>

				{session && (
					<div className='grid grid-cols-3 gap-1.5 text-center'>
						<div className='p-2 rounded-md bg-void-bg-1 border border-void-border-2'>
							<div className='text-sm font-bold text-red-400'>{session.counts.critical + session.counts.high}</div>
							<div className='text-[10px] text-void-fg-3'>Crit/High</div>
						</div>
						<div className='p-2 rounded-md bg-void-bg-1 border border-void-border-2'>
							<div className='text-sm font-bold text-void-fg-1'>{session.findings.length}</div>
							<div className='text-[10px] text-void-fg-3'>Findings</div>
						</div>
						<div className='p-2 rounded-md bg-void-bg-1 border border-void-border-2'>
							<div className='text-sm font-bold text-emerald-400'>{session.counts.resolved}</div>
							<div className='text-[10px] text-void-fg-3'>Verified</div>
						</div>
					</div>
				)}

				{state.repairs.length > 0 && (
					<div className='flex flex-col gap-1'>
						<div className='text-[11px] font-medium text-void-fg-2'>Recent Repairs &amp; Verification</div>
						{state.repairs.slice(0, 4).map(r => (
							<div key={r.id} className='p-1.5 rounded-md bg-void-bg-1 border border-void-border-2 flex items-center justify-between gap-1'>
								<span className='truncate text-[11px] font-mono'>{r.file}</span>
								<span className={`text-[10px] flex items-center gap-0.5 shrink-0 ${r.status === 'verified' ? 'text-emerald-400' : 'text-amber-400'}`}>
									{r.status === 'verified' ? <CheckCircle2 size={10} /> : <AlertTriangle size={10} />}
									{r.status}
								</span>
							</div>
						))}
					</div>
				)}

				<div className='flex items-center justify-between pt-1'>
					<span className='text-[11px] font-medium text-void-fg-2'>Backend Event Stream ({state.liveEvents.length})</span>
					{state.liveEvents.length > 0 && (
						<button type='button' onClick={() => codeReviewService.clearLiveEvents()} className='text-[10px] text-void-fg-3 hover:text-void-fg-1 hover:underline cursor-pointer'>Clear</button>
					)}
				</div>

				<div className='flex-1 flex flex-col gap-1.5 min-h-0' style={{ minHeight: 0, overflowY: 'auto' }}>
					{recentEvents.map(ev => (
						<div key={ev.eventId} className='p-2 rounded-md bg-void-bg-1 border border-void-border-2 text-[11px]'>
							<div className='flex items-center justify-between text-[10px] text-void-fg-3 mb-0.5'>
								<span className='font-mono text-sky-400'>#{ev.seq} · {ev.type}</span>
								<span>{new Date(ev.timestamp).toLocaleTimeString()}</span>
							</div>
							<div className='text-void-fg-1 break-words'>{ev.message}</div>
						</div>
					))}
					{recentEvents.length === 0 && (
						<div className='p-3 rounded-md bg-void-bg-1 border border-dashed border-void-border-2 text-[11px] text-void-fg-3 text-center'>
							Waiting for real backend review events.
						</div>
					)}
				</div>
			</div>
		</div>
	);
};
