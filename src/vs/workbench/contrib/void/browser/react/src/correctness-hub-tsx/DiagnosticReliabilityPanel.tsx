/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useState } from 'react';
import {
	AlertTriangle,
	CheckCircle2,
	Cpu,
	FileCode2,
	Loader2,
	PackageCheck,
	RefreshCw,
	RotateCcw,
	Search,
	ShieldCheck,
	Trash2,
	Wrench,
} from 'lucide-react';
import { useAccessor } from '../util/services.js';
import { KodiaBadge, KodiaCard } from '../util/KodiaDesignSystem.js';
import type {
	KdreClassifiedDiagnostic,
	KdreInvestigationReport,
	KdreLiveSnapshot,
	KdreRecoveryActionKind,
} from '../../../../common/diagnosticReliabilityTypes.js';

function stateTone(state: KdreLiveSnapshot['systemState']): 'success' | 'warning' | 'danger' | 'accent' | 'neutral' {
	switch (state) {
		case 'ready': return 'success';
		case 'verifying':
		case 'updating':
		case 'initializing': return 'accent';
		case 'degraded':
		case 'stale': return 'warning';
		case 'unavailable': return 'danger';
	}
}

function confidenceTone(c: KdreClassifiedDiagnostic['confidence']): 'success' | 'warning' | 'danger' | 'accent' | 'neutral' {
	switch (c) {
		case 'high': return 'danger';
		case 'medium': return 'accent';
		case 'low': return 'warning';
		case 'stale': return 'neutral';
		case 'conflicting': return 'warning';
	}
}

export const DiagnosticReliabilityPanel: React.FC = () => {
	const accessor = useAccessor();
	const kdre = accessor.get('IDiagnosticReliabilityService');

	const [snapshot, setSnapshot] = useState<KdreLiveSnapshot>(() => kdre.getCachedSnapshot());
	const [busy, setBusy] = useState<string | null>(null);
	const [actionNote, setActionNote] = useState<string | null>(null);
	const [selectedInvestigation, setSelectedInvestigation] = useState<KdreInvestigationReport | null>(null);

	useEffect(() => {
		const d = kdre.onDidChangeSnapshot(s => setSnapshot(s));
		return () => d.dispose();
	}, [kdre]);

	const runVerifyAll = async () => {
		setBusy('verify');
		setActionNote(null);
		try {
			const res = await kdre.refreshAndEvaluate({ runCompiler: true });
			setActionNote(res.comparison.summary);
		} finally {
			setBusy(null);
		}
	};

	const runRecovery = async (action: KdreRecoveryActionKind) => {
		setBusy(action);
		setActionNote(null);
		try {
			const res = await kdre.executeRecoveryAction(action);
			setActionNote(res.summary);
			await kdre.refreshAndEvaluate({ runCompiler: false });
		} finally {
			setBusy(null);
		}
	};

	const runInvestigate = async (diag: KdreClassifiedDiagnostic) => {
		setBusy(`inv-${diag.id}`);
		try {
			const rep = await kdre.investigateDiagnostic(diag.raw, { runCompiler: true });
			setSelectedInvestigation(rep);
		} finally {
			setBusy(null);
		}
	};

	return (
		<KodiaCard className='flex flex-col gap-3 border-sky-500/30'>
			{/* Header & Status */}
			<div className='flex flex-wrap items-center justify-between gap-2'>
				<div className='flex items-center gap-2'>
					<ShieldCheck size={15} className='text-sky-400' />
					<span className='font-semibold text-void-fg-1'>Kodia Diagnostic Reliability Engine (KDRE)</span>
					<KodiaBadge tone={stateTone(snapshot.systemState)}>{snapshot.statusLabel}</KodiaBadge>
				</div>
				<div className='flex flex-wrap items-center gap-1.5 text-[11px]'>
					<button
						type='button'
						disabled={busy !== null}
						onClick={() => void runVerifyAll()}
						className='inline-flex items-center gap-1 px-2 py-1 rounded bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/40 text-sky-200 cursor-pointer disabled:opacity-50'
					>
						{busy === 'verify' ? <Loader2 size={11} className='animate-spin' /> : <CheckCircle2 size={11} />}
						<span>Verify with Compiler</span>
					</button>
					<button
						type='button'
						disabled={busy !== null}
						onClick={() => void runRecovery('reload_project_config')}
						className='inline-flex items-center gap-1 px-2 py-1 rounded bg-void-bg-2 hover:bg-void-bg-3 border border-void-border-2 text-void-fg-2 cursor-pointer disabled:opacity-50'
					>
						<RefreshCw size={11} />
						<span>Reload Config</span>
					</button>
					<button
						type='button'
						disabled={busy !== null}
						onClick={() => void runRecovery('purge_stale_markers')}
						className='inline-flex items-center gap-1 px-2 py-1 rounded bg-void-bg-2 hover:bg-void-bg-3 border border-void-border-2 text-void-fg-2 cursor-pointer disabled:opacity-50'
					>
						<Trash2 size={11} />
						<span>Purge Stale</span>
					</button>
					<button
						type='button'
						disabled={busy !== null}
						onClick={() => void runRecovery('restart_language_server')}
						className='inline-flex items-center gap-1 px-2 py-1 rounded bg-void-bg-2 hover:bg-void-bg-3 border border-void-border-2 text-void-fg-2 cursor-pointer disabled:opacity-50'
					>
						<RotateCcw size={11} />
						<span>Restart TS Server</span>
					</button>
					<button
						type='button'
						disabled={busy !== null}
						onClick={() => void runRecovery('recheck_dependencies')}
						className='inline-flex items-center gap-1 px-2 py-1 rounded bg-void-bg-2 hover:bg-void-bg-3 border border-void-border-2 text-void-fg-2 cursor-pointer disabled:opacity-50'
					>
						<PackageCheck size={11} />
						<span>Check Deps</span>
					</button>
				</div>
			</div>

			{actionNote && (
				<div className='px-2.5 py-1.5 rounded bg-void-bg-2 border border-void-border-2 text-[11px] text-void-fg-2'>
					{actionNote}
				</div>
			)}

			{/* Summary KPI Strip */}
			<div className='grid grid-cols-2 md:grid-cols-5 gap-2 text-[11px]'>
				<div className='p-2 rounded bg-void-bg-2 border border-void-border-2'>
					<div className='text-[10px] text-void-fg-3'>Editor Diagnostics</div>
					<div className='font-semibold text-sm'>{snapshot.totalEditorDiagnostics}</div>
				</div>
				<div className='p-2 rounded bg-void-bg-2 border border-void-border-2'>
					<div className='text-[10px] text-void-fg-3'>Compiler Confirmed</div>
					<div className='font-semibold text-sm text-rose-300'>{snapshot.confirmedErrorCount}</div>
				</div>
				<div className='p-2 rounded bg-void-bg-2 border border-void-border-2'>
					<div className='text-[10px] text-void-fg-3'>LSP/Compiler Conflicts</div>
					<div className='font-semibold text-sm text-amber-300'>{snapshot.conflictCount}</div>
				</div>
				<div className='p-2 rounded bg-void-bg-2 border border-void-border-2'>
					<div className='text-[10px] text-void-fg-3'>Potentially Stale</div>
					<div className='font-semibold text-sm text-sky-300'>{snapshot.staleCount}</div>
				</div>
				<div className='p-2 rounded bg-void-bg-2 border border-void-border-2'>
					<div className='text-[10px] text-void-fg-3'>Workspace TS / Deps</div>
					<div className='font-mono text-[11px] truncate'>
						{snapshot.projectConfig?.workspaceTypeScriptVersion ? `TS ${snapshot.projectConfig.workspaceTypeScriptVersion}` : (snapshot.projectConfig?.detectedLanguages[0] ?? 'Scanning')}
						{' · '}
						{snapshot.dependencyHealth?.healthy === false ? 'Deps warn' : 'OK'}
					</div>
				</div>
			</div>

			{/* Project Config & Language Server Health Row */}
			{(snapshot.serverHealth.length > 0 || (snapshot.projectConfig?.issues.length ?? 0) > 0 || (snapshot.dependencyHealth?.resolutionWarnings.length ?? 0) > 0) && (
				<div className='grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]'>
					<div className='p-2 rounded bg-void-bg-2/70 border border-void-border-2 flex flex-col gap-1'>
						<div className='font-medium text-void-fg-2 flex items-center gap-1'>
							<Cpu size={11} />
							<span>Language Server Health ({snapshot.serverHealth.length})</span>
						</div>
						{snapshot.serverHealth.map(s => (
							<div key={s.language} className='flex items-center justify-between gap-2 text-[10px]'>
								<span className='truncate'>{s.serverName} {s.version ? `(${s.version})` : ''}</span>
								<span className={s.status === 'healthy' ? 'text-emerald-300' : s.status === 'degraded' ? 'text-amber-300' : 'text-rose-300'}>
									{s.status}
								</span>
							</div>
						))}
					</div>
					<div className='p-2 rounded bg-void-bg-2/70 border border-void-border-2 flex flex-col gap-1'>
						<div className='font-medium text-void-fg-2 flex items-center gap-1'>
							<FileCode2 size={11} />
							<span>Project Config & Resolution</span>
						</div>
						<div className='text-[10px] text-void-fg-3'>
							Configs: {snapshot.projectConfig?.configFiles.slice(0, 6).map(c => c.path).join(', ') || 'none'}
						</div>
						{snapshot.projectConfig?.issues.map((i, idx) => (
							<div key={idx} className='text-[10px] text-amber-300 flex items-start gap-1'><AlertTriangle size={10} className='mt-0.5 flex-shrink-0' /> {i}</div>
						))}
						{snapshot.dependencyHealth?.resolutionWarnings.map((w, idx) => (
							<div key={idx} className='text-[10px] text-amber-300 flex items-start gap-1'><Wrench size={10} className='mt-0.5 flex-shrink-0' /> {w}</div>
						))}
					</div>
				</div>
			)}

			{/* Classified Live Diagnostics & Conflicts */}
			{snapshot.classifiedDiagnostics.length > 0 && (
				<div className='flex flex-col gap-1.5 max-h-64 overflow-y-auto'>
					{snapshot.classifiedDiagnostics.slice(0, 20).map(item => (
						<div key={item.id} className='p-2 rounded bg-void-bg-2 border border-void-border-2 flex items-start justify-between gap-2 text-[11px]'>
							<div className='min-w-0 flex-1'>
								<div className='flex flex-wrap items-center gap-1.5'>
									<KodiaBadge tone={confidenceTone(item.confidence)}>{item.classification}</KodiaBadge>
									<span className='font-mono text-[10px] text-void-fg-3'>{item.raw.file}:{item.raw.line}</span>
									<span className='text-[10px] text-void-fg-3'>({item.raw.source}{item.raw.code ? ` ${item.raw.code}` : ''})</span>
								</div>
								<div className='text-void-fg-1 mt-0.5'>{item.raw.message}</div>
								<div className='text-[10px] text-void-fg-3 mt-0.5'>{item.explanation}</div>
							</div>
							<button
								type='button'
								disabled={busy !== null}
								onClick={() => void runInvestigate(item)}
								className='inline-flex items-center gap-1 px-2 py-1 rounded bg-void-bg-1 hover:bg-void-bg-3 border border-void-border-2 text-[10px] text-sky-300 whitespace-nowrap cursor-pointer'
							>
								<Search size={10} />
								<span>Investigate</span>
							</button>
						</div>
					))}
				</div>
			)}

			{/* Selected Diagnostic Investigation Evidence */}
			{selectedInvestigation && (
				<div className='p-2.5 rounded bg-void-bg-2 border border-sky-500/40 flex flex-col gap-1 text-[11px]'>
					<div className='font-semibold flex items-center justify-between'>
						<span>Investigation: {selectedInvestigation.file}:{selectedInvestigation.line} ({selectedInvestigation.rootCauseCategory})</span>
						<KodiaBadge tone={selectedInvestigation.isLikelyFalsePositive ? 'warning' : 'danger'}>
							{selectedInvestigation.isLikelyFalsePositive ? 'Likely False Positive' : 'Confirmed / Unverified'}
						</KodiaBadge>
					</div>
					<div className='text-void-fg-2'>{selectedInvestigation.conclusion}</div>
					<div className='text-[10px] text-emerald-300'>Recommended: {selectedInvestigation.recommendedFix}</div>
					<div className='grid grid-cols-1 md:grid-cols-2 gap-1 mt-1'>
						{selectedInvestigation.checksPerformed.map((c, i) => (
							<div key={i} className='text-[10px] text-void-fg-3'>
								<span className={c.passed ? 'text-emerald-300' : 'text-amber-300'}>[{c.passed ? 'OK' : 'CHECK'}]</span> {c.check}: {c.detail}
							</div>
						))}
					</div>
				</div>
			)}
		</KodiaCard>
	);
};
