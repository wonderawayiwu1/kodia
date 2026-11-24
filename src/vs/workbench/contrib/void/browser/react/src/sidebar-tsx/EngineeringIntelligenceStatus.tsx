/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useState } from 'react';
import {
	AlertTriangle,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	ExternalLink,
	Globe,
	Loader2,
	RefreshCw,
	Search,
	ShieldAlert,
	Sparkles,
	XCircle,
} from 'lucide-react';
import { useAccessor } from '../util/services.js';
import type {
	LeiEvidenceRecord,
	LeiKnowledgeFreshness,
	LeiLiveSnapshot,
	LeiResearchMode,
	LeiVerificationStatus,
} from '../../../../common/liveIntelligenceTypes.js';

function formatResearchModeLabel(mode: LeiResearchMode): string {
	switch (mode) {
		case 'live_research_enabled': return 'Live research enabled';
		case 'research_in_progress': return 'Research in progress';
		case 'cached_verified': return 'Cached verified information';
		case 'research_not_required': return 'Research not required';
		case 'research_unavailable': return 'Research unavailable';
	}
}

function formatVerificationLabel(status: LeiVerificationStatus | 'not_applicable'): { label: string; tone: 'success' | 'info' | 'warning' | 'danger' | 'neutral' } {
	switch (status) {
		case 'verified_official_docs': return { label: 'Verified (Official Docs)', tone: 'success' };
		case 'verified_official_api': return { label: 'Verified (Official API)', tone: 'success' };
		case 'cross_checked': return { label: 'Cross-checked', tone: 'success' };
		case 'provisionally_verified': return { label: 'Provisionally verified', tone: 'info' };
		case 'conflicting_sources': return { label: 'Conflicting', tone: 'warning' };
		case 'deprecated': return { label: 'Deprecated', tone: 'warning' };
		case 'superseded': return { label: 'Superseded', tone: 'warning' };
		case 'unavailable': return { label: 'Failed / Unavailable', tone: 'danger' };
		case 'unverified': return { label: 'Unverified', tone: 'neutral' };
		case 'not_applicable': return { label: 'Not applicable', tone: 'neutral' };
	}
}

function formatFreshnessLabel(freshness: LeiKnowledgeFreshness): { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' } {
	switch (freshness) {
		case 'current_research': return { label: 'Current research', tone: 'success' };
		case 'fresh_verified_cache': return { label: 'Fresh verified cache', tone: 'success' };
		case 'refresh_recommended': return { label: 'Refresh recommended', tone: 'warning' };
		case 'stale_information': return { label: 'Stale information', tone: 'warning' };
		case 'expired_information': return { label: 'Expired information', tone: 'danger' };
		case 'unknown_freshness': return { label: 'Unknown freshness', tone: 'neutral' };
	}
}

function formatRelativeTime(ts?: number): string {
	if (!ts) return 'not yet verified';
	const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
	if (diffSec < 60) return `${diffSec}s ago`;
	if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
	if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
	return new Date(ts).toLocaleDateString();
}

const BADGE_CLASSES: Record<'success' | 'info' | 'warning' | 'danger' | 'neutral', string> = {
	success: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35',
	info: 'bg-sky-500/15 text-sky-300 border-sky-500/35',
	warning: 'bg-amber-500/15 text-amber-300 border-amber-500/35',
	danger: 'bg-rose-500/15 text-rose-300 border-rose-500/35',
	neutral: 'bg-zinc-500/15 text-void-fg-3 border-void-border-2',
};

export interface EngineeringIntelligenceStatusProps {
	variant: 'chat' | 'factory';
	contextTopic?: string;
}

export const EngineeringIntelligenceStatus: React.FC<EngineeringIntelligenceStatusProps> = React.memo(({ variant, contextTopic }) => {
	const accessor = useAccessor();
	const leiService = accessor.get('ILiveIntelligenceService');
	const [snapshot, setSnapshot] = useState<LeiLiveSnapshot>(() => leiService.getCachedSnapshot());
	const [expanded, setExpanded] = useState(variant === 'factory');
	const [quickTopic, setQuickTopic] = useState('');
	const [evidence, setEvidence] = useState<readonly LeiEvidenceRecord[]>([]);
	const [busyAction, setBusyAction] = useState<string | null>(null);

	useEffect(() => {
		let mounted = true;
		void leiService.getSnapshot().then(snap => { if (mounted) setSnapshot(snap); });
		void leiService.inspectEvidence({ includeStale: false }).then(recs => { if (mounted) setEvidence(recs.slice(0, 5)); });
		const dSnap = leiService.onDidChangeSnapshot(snap => {
			setSnapshot(snap);
			void leiService.inspectEvidence({ includeStale: false }).then(recs => { if (mounted) setEvidence(recs.slice(0, 5)); });
		});
		return () => {
			mounted = false;
			dSnap.dispose();
		};
	}, [leiService]);

	const isResearching = snapshot.activeOperations.length > 0;
	const verif = formatVerificationLabel(snapshot.verificationStatus);
	const fresh = formatFreshnessLabel(snapshot.knowledgeFreshness);

	// Top status badge driven strictly by real backend state (Part 14.3)
	const primaryBadge: { label: string; tone: 'success' | 'info' | 'warning' | 'danger' | 'neutral' } = isResearching
		? { label: 'Researching', tone: 'info' }
		: snapshot.systemStatus === 'unavailable' || snapshot.researchMode === 'research_unavailable'
			? { label: 'Unavailable', tone: 'danger' }
			: snapshot.systemStatus === 'disabled'
				? { label: 'Disabled', tone: 'neutral' }
				: snapshot.systemStatus === 'degraded' || snapshot.staleEvidenceCount > 0 || snapshot.conflictCount > 0
					? { label: snapshot.conflictCount > 0 ? 'Conflicting' : 'Refresh required', tone: 'warning' }
					: snapshot.systemStatus === 'initializing'
						? { label: 'Initializing', tone: 'info' }
						: { label: 'Active', tone: 'success' };

	const handleResearchNow = async () => {
		const topic = (quickTopic || contextTopic || 'NVIDIA NIM current models and React Native Expo SDK compatibility').trim();
		setBusyAction('research');
		try {
			await leiService.researchTechnology({ topic, forceRefresh: true });
			setQuickTopic('');
		} finally {
			setBusyAction(null);
		}
	};

	const handleRefreshModels = async () => {
		setBusyAction('models');
		try {
			await leiService.discoverProviderModels({ provider: 'nvidia', forceRefresh: true });
		} finally {
			setBusyAction(null);
		}
	};

	const handleRefreshStale = async () => {
		setBusyAction('refresh');
		try {
			await leiService.refreshStaleKnowledge();
		} finally {
			setBusyAction(null);
		}
	};

	const handleCancelActive = async () => {
		if (!snapshot.activeOperationId) return;
		await leiService.cancelOperation(snapshot.activeOperationId);
	};

	const openExternal = (url: string) => {
		try { window.open(url, '_blank', 'noopener,noreferrer'); } catch { /* ignore */ }
	};

	const sourceSummary = snapshot.sources.length > 0
		? snapshot.sources.slice(0, 2).map(s => s.authorityLabel).join(', ')
		: 'Awaiting live lookup';

	return (
		<div className={`rounded-md border border-void-border-2 bg-void-bg-1/95 text-[11px] ${variant === 'chat' ? 'mx-2 mb-1.5' : ''}`}>
			{/* Compact Header Row */}
			<div
				className='flex items-center justify-between gap-2 px-2.5 py-1.5 cursor-pointer hover:bg-void-bg-2/70 transition-colors select-none'
				onClick={() => setExpanded(prev => !prev)}
				role='button'
				aria-expanded={expanded}
				title='Toggle Live Engineering Intelligence details and evidence'
			>
				<div className='flex items-center gap-1.5 min-w-0'>
					{expanded ? <ChevronDown size={12} className='text-void-fg-3 flex-shrink-0' /> : <ChevronRight size={12} className='text-void-fg-3 flex-shrink-0' />}
					{isResearching ? (
						<Loader2 size={12} className='text-sky-400 animate-spin flex-shrink-0' />
					) : primaryBadge.tone === 'danger' ? (
						<XCircle size={12} className='text-rose-400 flex-shrink-0' />
					) : primaryBadge.tone === 'warning' ? (
						<AlertTriangle size={12} className='text-amber-400 flex-shrink-0' />
					) : (
						<Globe size={12} className='text-emerald-400 flex-shrink-0' />
					)}
					<span className='font-semibold text-void-fg-1 whitespace-nowrap'>Engineering Intelligence</span>
					<span className={`px-1.5 py-0.2 rounded-full border text-[10px] font-medium whitespace-nowrap ${BADGE_CLASSES[primaryBadge.tone]}`}>
						{primaryBadge.label}
					</span>
					{!expanded && (
						<span className='text-void-fg-3 truncate text-[10px] ml-1'>
							{snapshot.currentTask}
						</span>
					)}
				</div>

				<div className='flex items-center gap-1.5 flex-shrink-0' onClick={e => e.stopPropagation()}>
					<span className={`hidden sm:inline-flex px-1.5 py-0.2 rounded border text-[10px] ${BADGE_CLASSES[verif.tone]}`}>
						{verif.label}
					</span>
					{isResearching && snapshot.activeOperationId && (
						<button
							type='button'
							onClick={handleCancelActive}
							className='px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 text-[10px] cursor-pointer'
							title='Cancel active research operation'
						>
							Cancel
						</button>
					)}
					<button
						type='button'
						onClick={() => void leiService.openDashboard('overview')}
						className='p-1 rounded text-void-fg-3 hover:text-void-fg-1 hover:bg-void-bg-3 cursor-pointer'
						title='Open Live Engineering Intelligence Dashboard (Ctrl+Alt+I)'
					>
						<ExternalLink size={11} />
					</button>
				</div>
			</div>

			{/* Expanded Live Status & Evidence Drawer */}
			{expanded && (
				<div className='px-2.5 pb-2.5 pt-1.5 border-t border-void-border-2/80 flex flex-col gap-2'>
					{/* Core Status Grid (Part 14.1 & 14.2) */}
					<div className='grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]'>
						<div>
							<span className='text-void-fg-3'>Mode: </span>
							<span className='text-void-fg-1 font-medium'>{formatResearchModeLabel(snapshot.researchMode)}</span>
						</div>
						<div>
							<span className='text-void-fg-3'>Verification: </span>
							<span className={`font-medium ${verif.tone === 'success' ? 'text-emerald-300' : verif.tone === 'danger' ? 'text-rose-300' : verif.tone === 'warning' ? 'text-amber-300' : 'text-void-fg-1'}`}>
								{verif.label}
							</span>
						</div>
						<div className='col-span-2 truncate'>
							<span className='text-void-fg-3'>Current task: </span>
							<span className='text-void-fg-1'>{snapshot.currentTask}</span>
						</div>
						<div className='col-span-2 truncate'>
							<span className='text-void-fg-3'>Sources: </span>
							<span className='text-void-fg-2'>{sourceSummary}</span>
						</div>
						<div>
							<span className='text-void-fg-3'>Knowledge freshness: </span>
							<span className={`font-medium ${fresh.tone === 'success' ? 'text-emerald-300' : fresh.tone === 'danger' ? 'text-rose-300' : fresh.tone === 'warning' ? 'text-amber-300' : 'text-void-fg-2'}`}>
								{fresh.label}
							</span>
						</div>
						<div>
							<span className='text-void-fg-3'>Last verified: </span>
							<span className='text-void-fg-2'>{formatRelativeTime(snapshot.lastVerifiedAtMs)} ({snapshot.verifiedEvidenceCount}/{snapshot.evidenceCount} verified)</span>
						</div>
					</div>

					{/* Consulted Source Links */}
					{snapshot.sources.length > 0 && (
						<div className='flex flex-wrap gap-1'>
							{snapshot.sources.slice(0, 4).map(src => (
								<button
									key={src.url}
									type='button'
									onClick={() => openExternal(src.url)}
									className='inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-void-bg-2 hover:bg-void-bg-3 border border-void-border-2 text-[10px] text-sky-300 cursor-pointer max-w-[220px] truncate'
									title={`${src.title} — ${src.authorityLabel} (${src.url})`}
								>
									<ExternalLink size={9} className='flex-shrink-0' />
									<span className='truncate'>{src.domain || src.authorityLabel}</span>
								</button>
							))}
						</div>
					)}

					{/* Factory Per-Task Verification Feed (Part 14.5) */}
					{variant === 'factory' && snapshot.recentOperations.length > 0 && (
						<div className='rounded bg-void-bg-2/70 border border-void-border-2 p-1.5 flex flex-col gap-1'>
							<div className='text-[10px] font-semibold text-void-fg-2 flex items-center justify-between'>
								<span>Recent Engineering Verifications</span>
								<span className='text-void-fg-3'>{snapshot.recentOperations.length} ops</span>
							</div>
							{snapshot.recentOperations.slice(0, 3).map(op => {
								const opVerif = formatVerificationLabel(op.verificationStatus);
								return (
									<div key={op.operationId} className='flex items-center justify-between gap-2 text-[10px] py-0.5 border-t border-void-border-2/50 first:border-t-0'>
										<div className='min-w-0 flex-1'>
											<div className='text-void-fg-1 truncate font-medium'>{op.taskLabel}</div>
											<div className='text-void-fg-3 truncate'>
												{op.selectedIdentifierOrVersion ? `Selected: ${op.selectedIdentifierOrVersion} · ` : ''}
												{op.sources[0]?.authorityLabel ?? (op.error ? op.error : 'No external source')}
											</div>
										</div>
										<span className={`px-1.5 py-0.2 rounded border text-[9px] whitespace-nowrap ${BADGE_CLASSES[opVerif.tone]}`}>
											{opVerif.label}
										</span>
									</div>
								);
							})}
						</div>
					)}

					{/* Recent Verified Evidence Summary */}
					{evidence.length > 0 && variant === 'chat' && (
						<div className='flex flex-col gap-0.5 text-[10px] text-void-fg-2 bg-void-bg-2/60 rounded p-1.5 border border-void-border-2/70'>
							<div className='font-medium text-void-fg-1 flex items-center gap-1'>
								<CheckCircle2 size={10} className='text-emerald-400' />
								<span>Recent Verified Evidence</span>
							</div>
							{evidence.slice(0, 2).map(rec => (
								<div key={rec.id} className='truncate text-void-fg-3'>
									<span className='text-void-fg-1 font-mono'>{rec.technology}</span> ({rec.exactIdentifierOrVersion}): {rec.finding}
								</div>
							))}
						</div>
					)}

					{/* Functional Controls (Part 14.7 — every control triggers a real backend op) */}
					<div className='flex items-center gap-1'>
						<input
							type='text'
							value={quickTopic}
							onChange={e => setQuickTopic(e.target.value)}
							onKeyDown={e => { if (e.key === 'Enter') void handleResearchNow(); }}
							placeholder='Research tech, model, SDK, or package…'
							className='flex-1 min-w-0 px-2 py-1 rounded bg-void-bg-2 border border-void-border-2 text-[10px] text-void-fg-1 placeholder:text-void-fg-3'
						/>
						<button
							type='button'
							disabled={busyAction !== null}
							onClick={() => void handleResearchNow()}
							className='inline-flex items-center gap-1 px-2 py-1 rounded bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/40 text-sky-200 text-[10px] font-medium cursor-pointer disabled:opacity-50'
							title='Run live authoritative research now'
						>
							<Search size={10} />
							<span>{busyAction === 'research' ? 'Running…' : 'Research'}</span>
						</button>
					</div>

					<div className='flex flex-wrap items-center gap-1'>
						<button
							type='button'
							disabled={busyAction !== null}
							onClick={() => void handleRefreshModels()}
							className='inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-void-bg-2 hover:bg-void-bg-3 border border-void-border-2 text-[10px] text-void-fg-2 cursor-pointer disabled:opacity-50'
						>
							<Sparkles size={10} />
							<span>{busyAction === 'models' ? 'Discovering…' : 'Refresh AI Models'}</span>
						</button>
						<button
							type='button'
							disabled={busyAction !== null}
							onClick={() => void handleRefreshStale()}
							className='inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-void-bg-2 hover:bg-void-bg-3 border border-void-border-2 text-[10px] text-void-fg-2 cursor-pointer disabled:opacity-50'
						>
							<RefreshCw size={10} />
							<span>{busyAction === 'refresh' ? 'Refreshing…' : 'Refresh Stale'}</span>
						</button>
						<button
							type='button'
							onClick={() => void leiService.openDashboard('dependencies')}
							className='inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-void-bg-2 hover:bg-void-bg-3 border border-void-border-2 text-[10px] text-void-fg-2 cursor-pointer'
						>
							<ShieldAlert size={10} />
							<span>Deps & Security</span>
						</button>
						<button
							type='button'
							onClick={() => void leiService.openDashboard('evidence')}
							className='inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-void-bg-2 hover:bg-void-bg-3 border border-void-border-2 text-[10px] text-void-fg-2 cursor-pointer'
						>
							<Globe size={10} />
							<span>Full Dashboard</span>
						</button>
					</div>
				</div>
			)}
		</div>
	);
});
