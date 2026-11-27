/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useState } from 'react';
import { Shield, Play, FolderSearch, Lock, ExternalLink, RefreshCw, CheckCircle2, Sparkles, AlertTriangle, Zap } from 'lucide-react';
import '../styles.css';
import { useAccessor, useIsDark } from '../util/services.js';
import { CodeReviewWorkbenchState } from '../../../codeReviewService.js';
import type { KacraeFinding } from '../../../../common/kacraeTypes.js';

export const CodeReviewSidebarView: React.FC = () => {
	const isDark = useIsDark();
	const accessor = useAccessor();
	const codeReviewService = accessor.get('ICodeReviewService');
	const [state, setState] = useState<CodeReviewWorkbenchState>(codeReviewService.state);

	const fixFindingWithAI = (f: KacraeFinding) => {
		void codeReviewService.fixFindingsWithKodiaAI([f]);
	};

	useEffect(() => {
		const sub = codeReviewService.onDidChange(() => setState(codeReviewService.state));
		return () => sub.dispose();
	}, [codeReviewService]);

	const session = codeReviewService.getActiveSession();
	const openFindings = (session?.findings ?? []).filter(
		f => f.lifecycle !== 'suppressed' && f.lifecycle !== 'false_positive' && f.lifecycle !== 'verified_resolved'
	);
	const pendingSet = new Set(state.pendingAiFixIds);

	return (
		<div className={`@@void-scope ${isDark ? 'dark' : ''}`} style={{ width: '100%', height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
			<div className='flex-1 min-h-0 w-full flex flex-col gap-3 p-3 text-xs text-void-fg-1 bg-void-bg-2 select-none' style={{ minHeight: 0, overflowY: 'auto' }}>
				{/* Header */}
				<div className='flex items-center justify-between gap-2 pb-2 border-b border-void-border-2'>
					<div className='flex items-center gap-2 min-w-0'>
						<div className='w-6 h-6 rounded-md bg-sky-500/15 border border-sky-500/30 flex items-center justify-center shrink-0'>
							<Shield size={13} className='text-sky-400' />
						</div>
						<div className='min-w-0'>
							<div className='font-semibold text-void-fg-1 truncate'>Kodia Code Review</div>
							<div className='text-[10px] text-void-fg-3 truncate'>KACRAE Assurance Engine</div>
						</div>
					</div>
					<button
						type='button'
						onClick={() => void codeReviewService.openWorkbench('overview')}
						className='px-2 py-1 rounded-md bg-void-bg-1 border border-void-border-2 text-void-fg-2 hover:text-void-fg-1 hover:bg-void-bg-3 hover:border-void-border-1 flex items-center gap-1 text-[11px] font-medium cursor-pointer transition-colors shrink-0'
						title='Open Full-Page KACRAE Workbench (Ctrl+Alt+R)'
					>
						<ExternalLink size={11} />
						<span>Open</span>
					</button>
				</div>

				{/* Primary Actions */}
				<div className='flex flex-col gap-1.5'>
					<button
						type='button'
						disabled={state.isRunning}
						onClick={() => void codeReviewService.startReview({ scope: 'modified_files', depth: 'standard', openWorkbench: true })}
						className='w-full px-3 py-2 rounded-md bg-sky-600 hover:bg-sky-500 text-white font-medium flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer transition-colors shadow-xs'
					>
						<Play size={12} />
						<span>{state.isRunning ? `Running (${state.activePhase})...` : 'Review Current Changes'}</span>
					</button>
					<div className='grid grid-cols-2 gap-1.5'>
						<button
							type='button'
							disabled={state.isRunning}
							onClick={() => void codeReviewService.startReview({ scope: 'entire_project', depth: 'deep', openWorkbench: true })}
							className='px-2.5 py-1.5 rounded-md bg-void-bg-1 hover:bg-void-bg-3 border border-void-border-2 text-void-fg-1 flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer transition-colors text-[11px]'
						>
							<FolderSearch size={12} className='text-sky-400 shrink-0' />
							<span className='truncate'>Full Project</span>
						</button>
						<button
							type='button'
							disabled={state.isRunning}
							onClick={() => void codeReviewService.startReview({ scope: 'modified_files', depth: 'security', openWorkbench: true })}
							className='px-2.5 py-1.5 rounded-md bg-void-bg-1 hover:bg-void-bg-3 border border-void-border-2 text-void-fg-1 flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer transition-colors text-[11px]'
						>
							<Lock size={12} className='text-amber-400 shrink-0' />
							<span className='truncate'>Security</span>
						</button>
					</div>
					<button
						type='button'
						onClick={() => void codeReviewService.openWorkbench('functional_completeness')}
						className='w-full px-2.5 py-1.5 rounded-md bg-void-bg-1 hover:bg-void-bg-3 border border-void-border-2 text-void-fg-2 hover:text-void-fg-1 flex items-center justify-center gap-1.5 cursor-pointer transition-colors text-[11px]'
					>
						<CheckCircle2 size={12} className='text-emerald-400 shrink-0' />
						<span>Functional Completeness Audit</span>
					</button>
				</div>

				{/* Progress Bar while running */}
				{state.isRunning && (
					<div className='p-2.5 rounded-md bg-void-bg-1 border border-sky-500/35 flex flex-col gap-1.5'>
						<div className='flex items-center justify-between text-[11px]'>
							<span className='font-medium text-sky-300 capitalize'>{state.activePhase}</span>
							<span className='text-void-fg-3 font-mono'>{state.progressPct}%</span>
						</div>
						<div className='w-full h-1.5 rounded-full bg-void-bg-3 overflow-hidden'>
							<div className='h-full bg-sky-500 transition-all duration-300' style={{ width: `${state.progressPct}%` }} />
						</div>
					</div>
				)}

				{/* Session Summary or Empty State */}
				{session ? (
					<div className='flex flex-col gap-2.5 pt-2 border-t border-void-border-2 flex-1 min-h-0'>
						<div className='flex items-center justify-between'>
							<span className='font-semibold text-void-fg-1 text-[11px]'>Active Session</span>
							<span className='text-[10px] text-void-fg-3 font-mono'>{session.filesAnalyzedCount} files · {session.durationMs}ms</span>
						</div>

						<div className='grid grid-cols-4 gap-1.5 text-center'>
							<div className='p-1.5 rounded-md bg-red-500/10 border border-red-500/25 text-red-400 font-bold'>
								{session.counts.critical}
								<div className='text-[9px] font-medium opacity-80'>CRIT</div>
							</div>
							<div className='p-1.5 rounded-md bg-orange-500/10 border border-orange-500/25 text-orange-400 font-bold'>
								{session.counts.high}
								<div className='text-[9px] font-medium opacity-80'>HIGH</div>
							</div>
							<div className='p-1.5 rounded-md bg-amber-500/10 border border-amber-500/25 text-amber-300 font-bold'>
								{session.counts.medium}
								<div className='text-[9px] font-medium opacity-80'>MED</div>
							</div>
							<div className='p-1.5 rounded-md bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 font-bold'>
								{session.counts.resolved}
								<div className='text-[9px] font-medium opacity-80'>FIXED</div>
							</div>
						</div>

						<div className='text-[11px] font-semibold text-void-fg-2 flex items-center justify-between'>
							<span>Priority Findings</span>
							<span className='text-[10px] px-1.5 py-0.2 rounded-full bg-void-bg-1 border border-void-border-2 text-void-fg-3'>{openFindings.length}</span>
						</div>

						<div className='flex flex-col gap-1.5 flex-1 min-h-0 overflow-y-auto pr-1'>
							{openFindings.slice(0, 25).map(f => (
								<div
									key={f.id}
									onClick={() => {
										codeReviewService.selectFinding(f.id);
										void codeReviewService.openWorkbench('current_review');
									}}
									className='text-left p-2 rounded-md bg-void-bg-1 border border-void-border-2 hover:border-sky-500/50 hover:bg-void-bg-3/60 cursor-pointer transition-colors'
								>
									<div className='flex items-center justify-between gap-1.5 mb-0.5'>
										<span className={`text-[9px] uppercase font-bold px-1 py-0.2 rounded ${f.severity === 'critical' ? 'bg-red-500/15 text-red-400' : f.severity === 'high' ? 'bg-orange-500/15 text-orange-400' : 'bg-amber-500/15 text-amber-300'}`}>
											{f.severity}
										</span>
										<span className='text-[10px] text-void-fg-3 font-mono truncate flex-1 text-right'>{f.location.file}:{f.location.startLine}</span>
									</div>
									<div className='text-[11px] text-void-fg-1 font-medium truncate'>{f.title}</div>
									<div className='flex items-center justify-end gap-1 mt-1'>
										<button
											type='button'
											onClick={ev => { ev.stopPropagation(); void codeReviewService.openFindingInEditor(f.location.file, f.location.startLine); }}
											className='px-1.5 py-0.5 rounded bg-void-bg-2 hover:bg-void-bg-3 border border-void-border-2 text-[10px] text-void-fg-2 cursor-pointer'
										>
											Open
										</button>
										<button
											type='button'
											disabled={pendingSet.has(f.id)}
											onClick={ev => { ev.stopPropagation(); fixFindingWithAI(f); }}
											className={`px-1.5 py-0.5 rounded border text-[10px] font-medium flex items-center gap-0.5 cursor-pointer ${pendingSet.has(f.id)
												? 'bg-amber-500/20 border-amber-500/40 text-amber-300 animate-pulse'
												: 'bg-emerald-600/20 hover:bg-emerald-600/35 border-emerald-500/40 text-emerald-300'}`}
										>
											<Zap size={9} /> {pendingSet.has(f.id) ? 'Fixing...' : 'Fix'}
										</button>
									</div>
								</div>
							))}
							{openFindings.length === 0 && (
								<div className='p-3 rounded-md bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-[11px] flex items-center gap-1.5'>
									<CheckCircle2 size={13} className='shrink-0' />
									<span>No unresolved findings in this session.</span>
								</div>
							)}
						</div>
					</div>
				) : (
					<div className='p-3 rounded-lg bg-void-bg-1 border border-void-border-2 flex flex-col gap-2'>
						<div className='flex items-center gap-1.5 text-void-fg-1 font-medium text-[11px]'>
							<Sparkles size={12} className='text-sky-400 shrink-0' />
							<span>Ready to Inspect</span>
						</div>
						<p className='text-[11px] text-void-fg-3 leading-relaxed'>
							Run a change review, full-project deep scan, or security audit above to inspect real findings, attack paths, functional completeness, and architecture maps.
						</p>
						<div className='text-[10px] text-void-fg-3 flex items-center gap-1 pt-1 border-t border-void-border-2/70'>
							<AlertTriangle size={10} className='text-amber-400 shrink-0' />
							<span>Shortcut: <kbd className='px-1 py-0.2 rounded bg-void-bg-2 border border-void-border-2'>Ctrl+Alt+R</kbd></span>
						</div>
					</div>
				)}

				{/* Footer */}
				<button
					type='button'
					onClick={() => void codeReviewService.refreshFromDisk()}
					className='mt-auto w-full px-2.5 py-1.5 rounded-md bg-void-bg-1 hover:bg-void-bg-3 border border-void-border-2 text-void-fg-2 hover:text-void-fg-1 flex items-center justify-center gap-1.5 cursor-pointer transition-colors text-[11px]'
				>
					<RefreshCw size={11} />
					<span>Refresh Workspace State</span>
				</button>
			</div>
		</div>
	);
};
