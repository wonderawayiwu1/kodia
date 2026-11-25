/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useState } from 'react';
import { Check, CheckCircle2, ChevronDown, ChevronRight, Circle, FileText, HelpCircle, Loader2, Minus, Play, Sparkles, XCircle } from 'lucide-react';
import { URI } from '../../../../../../../base/common/uri.js';
import { useAccessor } from '../util/services.js';
import type { ThreadAgentUXState, UserQuestionAnswer } from '../../../../common/antigravityEngines.js';

export const AntigravityAgentUXStrip: React.FC<{ threadId: string; isRunning?: string | false | undefined }> = ({ threadId, isRunning }) => {
	const accessor = useAccessor();
	const chatThreadsService = accessor.get('IChatThreadService');
	const editorService = accessor.get('ICodeEditorService');

	const [ux, setUx] = useState<ThreadAgentUXState>(() => chatThreadsService.getAgentUXState(threadId));
	const [stepsExpanded, setStepsExpanded] = useState(true);
	const [dismissedWidgets, setDismissedWidgets] = useState<Record<string, boolean>>({});
	const [selections, setSelections] = useState<Record<number, string[]>>({});
	const [otherInputs, setOtherInputs] = useState<Record<number, string>>({});

	useEffect(() => {
		setUx(chatThreadsService.getAgentUXState(threadId));
		const d = chatThreadsService.onDidChangeAgentUX(({ threadId: changedId }) => {
			if (changedId === threadId) {
				setUx(chatThreadsService.getAgentUXState(threadId));
			}
		});
		return () => d.dispose();
	}, [chatThreadsService, threadId]);

	// Reset local question selection state whenever a new pendingQuestion arrives
	const pendingQId = ux.pendingQuestion?.id;
	useEffect(() => {
		if (!ux.pendingQuestion) {
			setSelections({});
			setOtherInputs({});
			return;
		}
		const initial: Record<number, string[]> = {};
		ux.pendingQuestion.questions.forEach((q, idx) => {
			if (q.options.length > 0 && !q.is_multi_select) {
				initial[idx] = [q.options[0]];
			} else {
				initial[idx] = [];
			}
		});
		setSelections(initial);
		setOtherInputs({});
	}, [pendingQId]);

	const openArtifact = (filePath: string) => {
		try {
			const uri = URI.file(filePath);
			void editorService.openCodeEditor({ resource: uri, options: { pinned: false } }, null);
		} catch { }
	};

	const hasFocus = Boolean(ux.focus && isRunning);
	const hasSteps = ux.steps.length > 0;
	const hasQuestion = Boolean(ux.pendingQuestion);
	const hasArtifacts = ux.artifacts.length > 0;
	const visibleWidgets = (ux.widgets ?? []).filter(w => !dismissedWidgets[w.id]);
	const hasWidgets = visibleWidgets.length > 0;

	if (!hasFocus && !hasSteps && !hasQuestion && !hasArtifacts && !hasWidgets) {
		return null;
	}

	const doneCount = ux.steps.filter(s => s.status === 'done').length;
	const pct = ux.steps.length > 0 ? Math.round((doneCount / ux.steps.length) * 100) : 0;

	const toggleOption = (qIdx: number, opt: string, multi: boolean) => {
		setSelections(prev => {
			const cur = prev[qIdx] ?? [];
			if (!multi) return { ...prev, [qIdx]: [opt] };
			return cur.includes(opt)
				? { ...prev, [qIdx]: cur.filter(o => o !== opt) }
				: { ...prev, [qIdx]: [...cur, opt] };
		});
	};

	const submitQuestion = () => {
		if (!ux.pendingQuestion) return;
		const answers: UserQuestionAnswer[] = ux.pendingQuestion.questions.map((q, idx) => {
			const chosen = selections[idx] ?? [];
			const other = (otherInputs[idx] ?? '').trim();
			const finalSelected = chosen.length > 0 ? chosen : (other ? ['Other'] : [q.options[0]]);
			return { question: q.question, selected: finalSelected, ...(other ? { otherText: other } : {}) };
		});
		chatThreadsService.answerUserQuestion(threadId, ux.pendingQuestion.id, answers);
	};

	return (
		<div className='mx-2 mb-1.5 flex flex-col gap-1.5'>
			{/* 1. Live Focus Pill */}
			{hasFocus && (
				<div className='flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-sky-500/10 border border-sky-500/30 text-[11px] text-sky-200'>
					<Loader2 size={12} className='animate-spin text-sky-400 flex-shrink-0' />
					<span className='font-medium truncate'>{ux.focus}</span>
				</div>
			)}

			{/* 2. Live Steps Execution Checklist */}
			{hasSteps && (
				<div className='rounded-lg bg-void-bg-1 border border-void-border-2 overflow-hidden'>
					<button
						type='button'
						onClick={() => setStepsExpanded(e => !e)}
						className='w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-[11px] text-void-fg-1 hover:bg-void-bg-2 cursor-pointer transition-colors'
					>
						<div className='flex items-center gap-1.5 min-w-0'>
							{stepsExpanded ? <ChevronDown size={12} className='text-void-fg-3' /> : <ChevronRight size={12} className='text-void-fg-3' />}
							<Sparkles size={11} className='text-sky-400 flex-shrink-0' />
							<span className='font-medium truncate'>Execution Steps</span>
						</div>
						<div className='flex items-center gap-2 flex-shrink-0'>
							<div className='w-14 h-1.5 rounded-full bg-void-bg-3 overflow-hidden'>
								<div className='h-full bg-emerald-400 transition-all duration-300' style={{ width: `${pct}%` }} />
							</div>
							<span className='text-[10px] text-void-fg-3 tabular-nums'>{doneCount}/{ux.steps.length}</span>
						</div>
					</button>
					{stepsExpanded && (
						<div className='px-2.5 pb-2 pt-0.5 flex flex-col gap-1 border-t border-void-border-2/60'>
							{ux.steps.map((step, i) => (
								<div key={`${i}-${step.title}`} className='flex items-center gap-2 text-[11px]'>
									{step.status === 'done' && <CheckCircle2 size={12} className='text-emerald-400 flex-shrink-0' />}
									{step.status === 'in_progress' && <Loader2 size={12} className='animate-spin text-sky-400 flex-shrink-0' />}
									{step.status === 'pending' && <Circle size={12} className='text-void-fg-4 flex-shrink-0' />}
									{step.status === 'failed' && <XCircle size={12} className='text-red-400 flex-shrink-0' />}
									{step.status === 'skipped' && <Minus size={12} className='text-void-fg-4 flex-shrink-0' />}
									<span className={`truncate ${step.status === 'done' ? 'text-void-fg-3 line-through' : step.status === 'in_progress' ? 'text-void-fg-1 font-medium' : step.status === 'failed' ? 'text-red-300' : 'text-void-fg-2'}`}>
										{step.title}
									</span>
								</div>
							))}
						</div>
					)}
				</div>
			)}

			{/* 3. Interactive Clarification Question Card (ask_user_question) */}
			{ux.pendingQuestion && (
				<div className='rounded-lg bg-void-bg-1 border border-amber-500/40 p-2.5 flex flex-col gap-2.5 shadow-sm'>
					<div className='flex items-center justify-between gap-2'>
						<div className='flex items-center gap-1.5 text-[11px] font-semibold text-amber-300'>
							<HelpCircle size={13} />
							<span>Input Needed to Continue</span>
						</div>
						<button
							type='button'
							onClick={() => chatThreadsService.cancelUserQuestion(threadId, ux.pendingQuestion!.id)}
							className='text-[10px] text-void-fg-4 hover:text-void-fg-1 cursor-pointer'
						>
							Dismiss
						</button>
					</div>
					{ux.pendingQuestion.questions.map((q, qIdx) => {
						const chosen = selections[qIdx] ?? [];
						return (
							<div key={qIdx} className='flex flex-col gap-1.5'>
								<div className='text-xs font-medium text-void-fg-1'>
									{qIdx + 1}. {q.question}
									{q.is_multi_select && <span className='ml-1.5 text-[10px] text-void-fg-3 font-normal'>(select one or more)</span>}
								</div>
								<div className='flex flex-col gap-1'>
									{q.options.map((opt, oIdx) => {
										const isSelected = chosen.includes(opt);
										return (
											<button
												key={oIdx}
												type='button'
												onClick={() => toggleOption(qIdx, opt, Boolean(q.is_multi_select))}
												className={`w-full text-left px-2.5 py-1.5 rounded-md border text-[11px] flex items-center gap-2 cursor-pointer transition-colors ${isSelected ? 'bg-sky-500/20 border-sky-400/60 text-sky-100' : 'bg-void-bg-2 border-void-border-2 text-void-fg-2 hover:bg-void-bg-3'}`}
											>
												<span className={`w-3.5 h-3.5 rounded-${q.is_multi_select ? 'sm' : 'full'} border flex items-center justify-center flex-shrink-0 ${isSelected ? 'bg-sky-500 border-sky-400 text-white' : 'border-void-border-1'}`}>
													{isSelected && <Check size={9} />}
												</span>
												<span className='flex-1 min-w-0'>{opt}</span>
											</button>
										);
									})}
								</div>
								<input
									type='text'
									value={otherInputs[qIdx] ?? ''}
									onChange={e => setOtherInputs(prev => ({ ...prev, [qIdx]: e.target.value }))}
									placeholder='Other / custom preference (optional)...'
									className='w-full px-2 py-1 rounded bg-void-bg-2 border border-void-border-2 text-[11px] text-void-fg-1 placeholder:text-void-fg-4 outline-none focus:border-sky-400/60'
								/>
							</div>
						);
					})}
					<div className='flex items-center justify-end gap-1.5 pt-1 border-t border-void-border-2/60'>
						<button
							type='button'
							onClick={submitQuestion}
							className='inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-sky-500 hover:bg-sky-400 text-white text-[11px] font-medium cursor-pointer transition-colors'
						>
							<Check size={12} />
							<span>Submit Answer</span>
						</button>
					</div>
				</div>
			)}

			{/* 4. Structured Workspace Artifacts Tray */}
			{hasArtifacts && (
				<div className='flex flex-col gap-1'>
					{ux.artifacts.map(art => (
						<div key={art.id} className='flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-void-bg-1 border border-void-border-2 text-[11px]'>
							<div className='flex items-center gap-2 min-w-0 flex-1'>
								<FileText size={13} className='text-sky-400 flex-shrink-0' />
								<div className='min-w-0 flex-1'>
									<div className='flex items-center gap-1.5'>
										<span className='font-medium text-void-fg-1 truncate'>{art.title}</span>
										<span className='px-1 py-0.2 rounded bg-void-bg-3 text-[9px] uppercase tracking-wider text-void-fg-3'>{art.kind}</span>
										{art.approved && <span className='px-1 py-0.2 rounded bg-emerald-500/20 text-emerald-300 text-[9px]'>Approved</span>}
									</div>
									<div className='text-[10px] text-void-fg-3 truncate'>{art.summary}</div>
								</div>
							</div>
							<div className='flex items-center gap-1 flex-shrink-0'>
								<button
									type='button'
									onClick={() => openArtifact(art.path)}
									className='px-2 py-0.5 rounded bg-void-bg-2 hover:bg-void-bg-3 border border-void-border-2 text-void-fg-1 text-[10px] cursor-pointer'
								>
									Open
								</button>
								{art.requestFeedback && !art.approved && (
									<button
										type='button'
										onClick={() => void chatThreadsService.approveArtifact(threadId, art.id)}
										className='inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/25 hover:bg-emerald-500/40 border border-emerald-500/50 text-emerald-200 text-[10px] font-medium cursor-pointer'
									>
										<Play size={9} />
										<span>Proceed</span>
									</button>
								)}
							</div>
						</div>
					))}
				</div>
			)}

			{/* 5. Antigravity Generative UI Inline Interactive Widgets */}
			{hasWidgets && (
				<div className='flex flex-col gap-1.5'>
					{visibleWidgets.map(widget => (
						<div key={widget.id} className='rounded-lg bg-void-bg-1 border border-void-border-2 overflow-hidden'>
							<div className='flex items-center justify-between gap-2 px-2.5 py-1.5 bg-void-bg-2/70 border-b border-void-border-2 text-[11px]'>
								<div className='flex items-center gap-1.5 min-w-0'>
									<Sparkles size={11} className='text-sky-400 flex-shrink-0' />
									<span className='font-medium text-void-fg-1 truncate'>{widget.title}</span>
									<span className='px-1 py-0.2 rounded bg-void-bg-3 text-[9px] uppercase tracking-wider text-void-fg-3'>{widget.kind}</span>
								</div>
								<button
									type='button'
									onClick={() => setDismissedWidgets(prev => ({ ...prev, [widget.id]: true }))}
									className='text-[10px] text-void-fg-4 hover:text-void-fg-1 cursor-pointer'
								>
									Hide
								</button>
							</div>
							<iframe
								title={widget.title}
								sandbox='allow-scripts'
								srcDoc={widget.html}
								style={{ width: '100%', height: `${widget.heightPx}px`, border: 0, background: 'transparent' }}
							/>
						</div>
					))}
				</div>
			)}
		</div>
	);
};
