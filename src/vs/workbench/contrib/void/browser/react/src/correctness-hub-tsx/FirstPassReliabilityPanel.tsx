/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useState } from 'react';
import {
	BrainCircuit,
	CheckCircle2,
	ClipboardCheck,
	FileCode2,
	GitMerge,
	Layers,
	Loader2,
	Network,
	ShieldCheck,
	Users,
} from 'lucide-react';
import { useAccessor } from '../util/services.js';
import { KodiaBadge, KodiaCard } from '../util/KodiaDesignSystem.js';
import type { FpereLiveSnapshot } from '../../../../common/firstPassReliabilityTypes.js';

export const FirstPassReliabilityPanel: React.FC = () => {
	const accessor = useAccessor();
	const fpere = accessor.get('IFirstPassReliabilityService');
	const [snap, setSnap] = useState<FpereLiveSnapshot>(() => fpere.getCachedSnapshot());
	const [busy, setBusy] = useState<string | null>(null);
	const [note, setNote] = useState<string | null>(null);

	useEffect(() => {
		let mounted = true;
		void fpere.getSnapshot().then(s => { if (mounted) setSnap(s); });
		const d = fpere.onDidChangeSnapshot(s => setSnap(s));
		return () => { mounted = false; d.dispose(); };
	}, [fpere]);

	const run = async (key: string, fn: () => Promise<string>) => {
		setBusy(key);
		setNote(null);
		try {
			const msg = await fn();
			setNote(msg);
		} finally {
			setBusy(null);
		}
	};

	const stageTone = snap.currentStage === 'failed' || snap.currentStage === 'blocked'
		? 'danger'
		: snap.currentStage === 'verified' || snap.currentStage === 'tests_passed' || snap.currentStage === 'build_verified' || snap.currentStage === 'runtime_verified' || snap.currentStage === 'integrated'
			? 'success'
			: 'accent';

	return (
		<KodiaCard className='flex flex-col gap-3 border-emerald-500/30'>
			<div className='flex flex-wrap items-center justify-between gap-2'>
				<div className='flex items-center gap-2'>
					<Layers size={15} className='text-emerald-400' />
					<span className='font-semibold text-void-fg-1'>First-Pass Reliability & Engineering Reasoning (FPERE + ERIC)</span>
					<KodiaBadge tone={stageTone}>{snap.currentPhase} · {snap.currentStage}</KodiaBadge>
				</div>
				<div className='flex flex-wrap items-center gap-1.5 text-[11px]'>
					<button
						type='button'
						disabled={busy !== null}
						onClick={() => void run('arch', async () => (await fpere.analyzeArchitecture()).summary)}
						className='inline-flex items-center gap-1 px-2 py-1 rounded bg-void-bg-2 hover:bg-void-bg-3 border border-void-border-2 text-void-fg-2 cursor-pointer disabled:opacity-50'
					>
						{busy === 'arch' ? <Loader2 size={11} className='animate-spin' /> : <Network size={11} />}
						<span>Analyze Repo</span>
					</button>
					<button
						type='button'
						disabled={busy !== null}
						onClick={() => void run('imp', async () => (await fpere.validateImportsAndExports()).summary)}
						className='inline-flex items-center gap-1 px-2 py-1 rounded bg-void-bg-2 hover:bg-void-bg-3 border border-void-border-2 text-void-fg-2 cursor-pointer disabled:opacity-50'
					>
						{busy === 'imp' ? <Loader2 size={11} className='animate-spin' /> : <CheckCircle2 size={11} />}
						<span>Validate Imports</span>
					</button>
					<button
						type='button'
						disabled={busy !== null}
						onClick={() => void run('int', async () => (await fpere.checkFullStackIntegration()).summary)}
						className='inline-flex items-center gap-1 px-2 py-1 rounded bg-void-bg-2 hover:bg-void-bg-3 border border-void-border-2 text-void-fg-2 cursor-pointer disabled:opacity-50'
					>
						{busy === 'int' ? <Loader2 size={11} className='animate-spin' /> : <GitMerge size={11} />}
						<span>Integration Check</span>
					</button>
					<button
						type='button'
						disabled={busy !== null}
						onClick={() => void run('sem', async () => (await fpere.analyzeSemanticCorrectness()).summary)}
						className='inline-flex items-center gap-1 px-2 py-1 rounded bg-void-bg-2 hover:bg-void-bg-3 border border-void-border-2 text-void-fg-2 cursor-pointer disabled:opacity-50'
					>
						{busy === 'sem' ? <Loader2 size={11} className='animate-spin' /> : <BrainCircuit size={11} />}
						<span>Semantic Audit</span>
					</button>
					<button
						type='button'
						disabled={busy !== null}
						onClick={() => void run('api', async () => (await fpere.verifyInstalledApiUsage()).summary)}
						className='inline-flex items-center gap-1 px-2 py-1 rounded bg-void-bg-2 hover:bg-void-bg-3 border border-void-border-2 text-void-fg-2 cursor-pointer disabled:opacity-50'
					>
						{busy === 'api' ? <Loader2 size={11} className='animate-spin' /> : <FileCode2 size={11} />}
						<span>Verify APIs</span>
					</button>
					<button
						type='button'
						disabled={busy !== null}
						onClick={() => void run('rev', async () => (await fpere.runIndependentReview()).summary)}
						className='inline-flex items-center gap-1 px-2 py-1 rounded bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/40 text-sky-200 cursor-pointer disabled:opacity-50'
					>
						{busy === 'rev' ? <Loader2 size={11} className='animate-spin' /> : <ClipboardCheck size={11} />}
						<span>Independent Review</span>
					</button>
					<button
						type='button'
						disabled={busy !== null}
						onClick={() => void run('gate', async () => (await fpere.runFirstPassQualityGate({ unitLabel: 'Workspace Quality Gate', runCompiler: true })).summary)}
						className='inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-200 cursor-pointer disabled:opacity-50'
					>
						{busy === 'gate' ? <Loader2 size={11} className='animate-spin' /> : <ShieldCheck size={11} />}
						<span>Run Quality Gate</span>
					</button>
				</div>
			</div>

			{note && (
				<div className='px-2.5 py-1.5 rounded bg-void-bg-2 border border-void-border-2 text-[11px] text-void-fg-2'>{note}</div>
			)}

			<div className='grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]'>
				<div className='p-2 rounded bg-void-bg-2 border border-void-border-2'>
					<div className='text-[10px] text-void-fg-3'>Architecture Exports / APIs</div>
					<div className='font-semibold'>
						{snap.architecture ? `${snap.architecture.totalExports} exports · ${snap.architecture.totalApiEndpoints} APIs` : 'Not analyzed'}
					</div>
				</div>
				<div className='p-2 rounded bg-void-bg-2 border border-void-border-2'>
					<div className='text-[10px] text-void-fg-3'>Import / Export Gate</div>
					<div className={`font-semibold ${snap.lastImportReport?.passed === false ? 'text-rose-300' : 'text-emerald-300'}`}>
						{snap.lastImportReport ? (snap.lastImportReport.passed ? 'PASS (0 errors)' : `${snap.lastImportReport.errorCount} error(s)`) : 'Idle'}
					</div>
				</div>
				<div className='p-2 rounded bg-void-bg-2 border border-void-border-2'>
					<div className='text-[10px] text-void-fg-3'>Full-Stack Integration</div>
					<div className={`font-semibold ${snap.lastIntegrationReport?.passed === false ? 'text-rose-300' : 'text-emerald-300'}`}>
						{snap.lastIntegrationReport ? (snap.lastIntegrationReport.passed ? 'PASS' : `${snap.lastIntegrationReport.issues.length} mismatch(es)`) : 'Idle'}
					</div>
				</div>
				<div className='p-2 rounded bg-void-bg-2 border border-void-border-2'>
					<div className='text-[10px] text-void-fg-3 flex items-center gap-1'><Users size={10} /> Active Agent Leases</div>
					<div className='font-semibold'>{snap.activeLeases.length} lease(s) · {snap.repairHistory.length} repair(s)</div>
				</div>
				<div className='p-2 rounded bg-void-bg-2 border border-void-border-2'>
					<div className='text-[10px] text-void-fg-3'>ERIC Semantic Audit</div>
					<div className={`font-semibold ${snap.lastSemanticReport?.passed === false ? 'text-rose-300' : 'text-emerald-300'}`}>
						{snap.lastSemanticReport
							? (snap.lastSemanticReport.passed
								? `PASS (${snap.lastSemanticReport.warningCount} warn)`
								: `${snap.lastSemanticReport.criticalCount} crit · ${snap.lastSemanticReport.errorCount} err`)
							: 'Idle'}
					</div>
				</div>
				<div className='p-2 rounded bg-void-bg-2 border border-void-border-2'>
					<div className='text-[10px] text-void-fg-3'>ERIC Installed API Check</div>
					<div className={`font-semibold ${snap.lastApiVerification?.passed === false ? 'text-rose-300' : 'text-emerald-300'}`}>
						{snap.lastApiVerification
							? (snap.lastApiVerification.passed
								? `PASS (${snap.lastApiVerification.usagesChecked} calls)`
								: `${snap.lastApiVerification.issues.length} invalid API(s)`)
							: 'Idle'}
					</div>
				</div>
				<div className='p-2 rounded bg-void-bg-2 border border-void-border-2'>
					<div className='text-[10px] text-void-fg-3'>Independent Review Verdict</div>
					<div className={`font-semibold ${snap.lastIndependentReview?.verdict === 'needs_fixes' ? 'text-rose-300' : snap.lastIndependentReview?.verdict === 'verified_with_evidence' ? 'text-emerald-300' : 'text-amber-300'}`}>
						{snap.lastIndependentReview ? snap.lastIndependentReview.verdict : 'Not run'}
					</div>
				</div>
				<div className='p-2 rounded bg-void-bg-2 border border-void-border-2'>
					<div className='text-[10px] text-void-fg-3'>Verified Failure Lessons</div>
					<div className='font-semibold'>
						{snap.engineeringLessonsCount ?? 0} lesson(s){snap.behavioralSpec ? ` · Spec: ${snap.behavioralSpec.featureName}` : ''}
					</div>
				</div>
			</div>

			{snap.recentEvents.length > 0 && (
				<div className='flex flex-col gap-1 max-h-36 overflow-y-auto text-[10px]'>
					{snap.recentEvents.slice(0, 6).map(ev => (
						<div key={ev.eventId} className='flex items-center justify-between gap-2 px-2 py-1 rounded bg-void-bg-2/70 border border-void-border-2/60'>
							<span className='truncate'><span className='font-mono text-emerald-300 mr-1.5'>[{ev.phase}]</span>{ev.message}</span>
							<span className='text-void-fg-3 whitespace-nowrap'>{new Date(ev.timestampMs).toLocaleTimeString()}</span>
						</div>
					))}
				</div>
			)}
		</KodiaCard>
	);
};
