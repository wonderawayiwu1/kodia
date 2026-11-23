/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
	Activity,
	AlertTriangle,
	Bug,
	CheckCircle2,
	Copy,
	Download,
	FileCheck2,
	FlaskConical,
	GitBranch,
	Play,
	RefreshCw,
	Search,
	ShieldAlert,
	ShieldCheck,
	Terminal,
	Trash2,
	XCircle,
} from 'lucide-react';
import { useAccessor, useIsDark } from '../util/services.js';
import { KodiaBadge, KodiaCard, KodiaPrimaryButton, KodiaSecondaryButton } from '../util/KodiaDesignSystem.js';
import { CorrectnessWorkbenchState } from '../../../correctnessService.js';
import {
	CorrectnessDiagnostic,
	CorrectnessHubSection,
	FuzzTestConfig,
	HypothesisCertainty,
	IndependentVerdict,
	ReleaseReadinessOutcome,
} from '../../../../common/correctnessTypes.js';

const TABS: { id: CorrectnessHubSection; label: string; icon: React.ReactNode }[] = [
	{ id: 'diagnostics', label: 'Live Diagnostics', icon: <Bug size={13} /> },
	{ id: 'taint', label: 'Taint Flows', icon: <ShieldAlert size={13} /> },
	{ id: 'investigate', label: 'Root-Cause', icon: <Search size={13} /> },
	{ id: 'impact', label: 'Impact & Plan', icon: <GitBranch size={13} /> },
	{ id: 'fuzz', label: 'Fuzz / Property', icon: <FlaskConical size={13} /> },
	{ id: 'mutation', label: 'Mutation Testing', icon: <Activity size={13} /> },
	{ id: 'verify', label: 'Verify & Proofs', icon: <FileCheck2 size={13} /> },
	{ id: 'readiness', label: 'Release Readiness', icon: <ShieldCheck size={13} /> },
];

function severityBadgeTone(sev: string): 'danger' | 'warning' | 'accent' | 'neutral' {
	if (sev === 'critical' || sev === 'error') { return 'danger'; }
	if (sev === 'high' || sev === 'warning') { return 'warning'; }
	if (sev === 'medium') { return 'accent'; }
	return 'neutral';
}

function certaintyLabel(c: HypothesisCertainty): { text: string; tone: 'success' | 'accent' | 'warning' | 'neutral' } {
	switch (c) {
		case 'confirmed_root_cause': return { text: 'Confirmed Root Cause', tone: 'success' };
		case 'strongly_supported': return { text: 'Strongly Supported', tone: 'accent' };
		case 'possible_factor': return { text: 'Possible Factor', tone: 'warning' };
		default: return { text: 'Unresolved Uncertainty', tone: 'neutral' };
	}
}

function verdictTone(v: IndependentVerdict): 'success' | 'danger' | 'warning' {
	if (v === 'APPROVED') { return 'success'; }
	if (v === 'REJECTED') { return 'danger'; }
	return 'warning';
}

function readinessMeta(outcome: ReleaseReadinessOutcome): { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' } {
	switch (outcome) {
		case 'verified_against_checks': return { label: 'Verified Against Executed Checks', tone: 'success' };
		case 'conditionally_ready': return { label: 'Conditionally Ready (Manual Review)', tone: 'warning' };
		case 'not_ready_failures': return { label: 'Not Ready — Active Failures', tone: 'danger' };
		case 'blocked_infrastructure': return { label: 'Blocked by Infrastructure', tone: 'danger' };
		default: return { label: 'Verification Incomplete', tone: 'neutral' };
	}
}

export const CorrectnessHubApp: React.FC = () => {
	const isDark = useIsDark();
	const accessor = useAccessor();
	const correctnessService = accessor.get('ICorrectnessService');
	const correctnessMain = accessor.get('IKodiaCorrectnessMainService');
	const toolsService = accessor.get('IToolsService');

	const [state, setState] = useState<CorrectnessWorkbenchState>(() => correctnessService.state);
	const [busyLabel, setBusyLabel] = useState<string | null>(null);
	const [statusBanner, setStatusBanner] = useState<string | null>(null);
	const [showEvents, setShowEvents] = useState(true);

	// Diagnostics filters & suppression draft
	const [diagFilter, setDiagFilter] = useState('');
	const [suppressTarget, setSuppressTarget] = useState<CorrectnessDiagnostic | null>(null);
	const [suppressReason, setSuppressReason] = useState('');

	// Investigation form
	const [symptom, setSymptom] = useState('');
	const [stackLogs, setStackLogs] = useState('');

	// Impact & repair plan form
	const [impactTargetFiles, setImpactTargetFiles] = useState('');
	const [defectSummary, setDefectSummary] = useState('');
	const [fixStrategy, setFixStrategy] = useState('');

	// Fuzz form
	const [fuzzFile, setFuzzFile] = useState('');
	const [fuzzExport, setFuzzExport] = useState('');
	const [fuzzProperty, setFuzzProperty] = useState('Number.isFinite(result)');
	const [fuzzArgSchema, setFuzzArgSchema] = useState('number,number');
	const [fuzzIterations, setFuzzIterations] = useState(150);
	const [fuzzSeed, setFuzzSeed] = useState(42);

	// Mutation form
	const [mutFile, setMutFile] = useState('');
	const [mutTestCmd, setMutTestCmd] = useState('node --test');
	const [mutMax, setMutMax] = useState(20);

	// Independent verification form
	const [verifyDesc, setVerifyDesc] = useState('');
	const [verifyFiles, setVerifyFiles] = useState('');
	const [verifyCmds, setVerifyCmds] = useState('');
	const [verifyReqs, setVerifyReqs] = useState('');

	// SARIF preview
	const [sarifPreview, setSarifPreview] = useState<string | null>(null);

	useEffect(() => {
		const sync = () => setState(correctnessService.state);
		const d = correctnessService.onDidChange(sync);
		void correctnessService.refreshFromDisk();
		return () => d.dispose();
	}, [correctnessService]);

	const runAction = useCallback(async (label: string, fn: () => Promise<void>) => {
		setBusyLabel(label);
		setStatusBanner(null);
		try {
			await fn();
		} catch (err) {
			setStatusBanner(`Error (${label}): ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			setBusyLabel(null);
		}
	}, []);

	const handleAnalyzeWorkspace = useCallback(() => runAction('Analyzing workspace', async () => {
		const call = await toolsService.callTool.correctness_analyze_workspace({ incremental: true });
		const report = await call.result;
		setStatusBanner(report.summary);
	}), [runAction, toolsService]);

	const handleRunCompilers = useCallback(() => runAction('Running compilers', async () => {
		const call = await toolsService.callTool.correctness_run_compilers({});
		const res = await call.result;
		const avail = res.outcomes.filter(o => o.available).length;
		const failed = res.outcomes.filter(o => o.available && !o.passed).length;
		setStatusBanner(`Compilers checked: ${avail} available, ${failed} failing.`);
	}), [runAction, toolsService]);

	const handleRunTaint = useCallback(() => runAction('Running taint analysis', async () => {
		const call = await toolsService.callTool.correctness_taint_analysis({});
		const report = await call.result;
		setStatusBanner(report.summary);
		correctnessService.setActiveSection('taint');
	}), [runAction, toolsService, correctnessService]);

	const handleExportSarif = useCallback(() => runAction('Exporting SARIF 2.1.0', async () => {
		const call = await toolsService.callTool.correctness_export_sarif({});
		const res = await call.result;
		const json = JSON.stringify(res.sarif, null, 2);
		setSarifPreview(json);
		setStatusBanner(`Generated SARIF 2.1.0 report with ${res.findingCount} finding(s).`);
	}), [runAction, toolsService]);

	const handleAddSuppression = useCallback(() => {
		if (!suppressTarget || !suppressReason.trim()) { return; }
		void runAction('Saving suppression', async () => {
			const list = await correctnessMain.manageSuppressions(correctnessService.getWorkspaceRoot(), {
				action: 'add',
				ruleId: suppressTarget.ruleId,
				filePattern: suppressTarget.file,
				justification: suppressReason.trim(),
			});
			correctnessService.recordSuppressions(list);
			setSuppressTarget(null);
			setSuppressReason('');
			setStatusBanner(`Suppressed ${suppressTarget.ruleId} in ${suppressTarget.file} with recorded justification.`);
		});
	}, [suppressTarget, suppressReason, runAction, correctnessMain, correctnessService]);

	const handleRemoveSuppression = useCallback((id: string) => runAction('Removing suppression', async () => {
		const list = await correctnessMain.manageSuppressions(correctnessService.getWorkspaceRoot(), {
			action: 'remove',
			id,
		});
		correctnessService.recordSuppressions(list);
	}), [runAction, correctnessMain, correctnessService]);

	const handleInvestigate = useCallback(() => {
		if (!symptom.trim()) { return; }
		void runAction('Investigating root cause', async () => {
			const call = await toolsService.callTool.correctness_investigate_root_cause({
				symptom: symptom.trim(),
				stack_trace_or_logs: stackLogs.trim() || undefined,
			});
			const report = await call.result;
			setStatusBanner(report.summary);
		});
	}, [symptom, stackLogs, runAction, toolsService]);

	const handlePlanRepair = useCallback(() => {
		const files = impactTargetFiles.split(',').map(s => s.trim()).filter(Boolean);
		if (!defectSummary.trim() || files.length === 0) { return; }
		void runAction('Planning controlled repair', async () => {
			const call = await toolsService.callTool.correctness_plan_repair({
				defect_summary: defectSummary.trim(),
				target_files: files,
				smallest_fix_strategy: fixStrategy.trim() || 'Apply minimal scoped fix and run targeted regression tests.',
			});
			const plan = await call.result;
			setStatusBanner(`Repair plan ready: ${plan.blastRadiusFiles.length} blast-radius file(s), ${plan.targetedTests.length} test(s).`);
		});
	}, [impactTargetFiles, defectSummary, fixStrategy, runAction, toolsService]);

	const handleRunFuzz = useCallback(() => {
		if (!fuzzFile.trim() || !fuzzExport.trim() || !fuzzProperty.trim()) { return; }
		const allowed = new Set(['number', 'integer', 'string', 'boolean', 'json-object', 'array-number']);
		const schema = fuzzArgSchema
			.split(',')
			.map(s => s.trim())
			.filter((s): s is FuzzTestConfig['argSchema'][number] => allowed.has(s));
		if (schema.length === 0) {
			setStatusBanner('Provide at least one valid arg type: number, integer, string, boolean, json-object, array-number.');
			return;
		}
		void runAction('Running property/fuzz test', async () => {
			const call = await toolsService.callTool.correctness_run_fuzz_test({
				target_file: fuzzFile.trim(),
				export_name: fuzzExport.trim(),
				property_expression: fuzzProperty.trim(),
				arg_schema: schema,
				iterations: fuzzIterations,
				seed: fuzzSeed,
			});
			const report = await call.result;
			setStatusBanner(report.summary);
		});
	}, [fuzzFile, fuzzExport, fuzzProperty, fuzzArgSchema, fuzzIterations, fuzzSeed, runAction, toolsService]);

	const handleRunMutation = useCallback(() => {
		if (!mutFile.trim() || !mutTestCmd.trim()) { return; }
		void runAction('Running isolated mutation tests', async () => {
			const call = await toolsService.callTool.correctness_run_mutation_test({
				target_file: mutFile.trim(),
				test_command: mutTestCmd.trim(),
				max_mutants: mutMax,
			});
			const report = await call.result;
			setStatusBanner(report.summary);
		});
	}, [mutFile, mutTestCmd, mutMax, runAction, toolsService]);

	const handleIndependentVerify = useCallback(() => {
		const files = verifyFiles.split(',').map(s => s.trim()).filter(Boolean);
		if (!verifyDesc.trim() || files.length === 0) { return; }
		const cmds = verifyCmds.split('\n').map(s => s.trim()).filter(Boolean);
		const reqs = verifyReqs.split('\n').map(s => s.trim()).filter(Boolean);
		void runAction('Running Independent Verification', async () => {
			const call = await toolsService.callTool.correctness_independent_verify({
				change_description: verifyDesc.trim(),
				changed_files: files,
				test_commands: cmds.length > 0 ? cmds : undefined,
				requirements: reqs.length > 0 ? reqs : undefined,
				require_tests: true,
			});
			const report = await call.result;
			setStatusBanner(`Independent Verdict: ${report.verdict} — ${report.summary}`);
		});
	}, [verifyDesc, verifyFiles, verifyCmds, verifyReqs, runAction, toolsService]);

	const handleAssessReadiness = useCallback(() => runAction('Assessing release readiness', async () => {
		const call = await toolsService.callTool.correctness_assess_release_readiness({});
		const report = await call.result;
		setStatusBanner(report.summary);
		correctnessService.setActiveSection('readiness');
	}), [runAction, toolsService, correctnessService]);

	const allDiagnostics = useMemo(() => {
		const compilerDiags = state.latestCompilerOutcomes.flatMap(o => o.diagnostics);
		const staticDiags = state.latestIncremental?.diagnostics ?? [];
		const merged = [...compilerDiags, ...staticDiags];
		const q = diagFilter.trim().toLowerCase();
		if (!q) { return merged; }
		return merged.filter(d =>
			d.file.toLowerCase().includes(q)
			|| d.ruleId.toLowerCase().includes(q)
			|| d.title.toLowerCase().includes(q)
			|| d.message.toLowerCase().includes(q)
		);
	}, [state.latestCompilerOutcomes, state.latestIncremental, diagFilter]);

	const activeCount = allDiagnostics.filter(d => !d.suppressed).length;
	const taintCount = state.latestTaint?.unsafeFlows.length ?? 0;
	const latestVerdict = state.verifications[0]?.verdict;
	const latestReadiness = state.readinessReports[0];

	return (
		<div className={`@@void-scope ${isDark ? 'dark' : ''} h-full w-full flex flex-col bg-void-bg-2 text-void-fg-1 overflow-hidden`}>
			{/* Header Toolbar */}
			<div className='flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-void-border-2 bg-void-bg-1 flex-shrink-0'>
				<div className='flex items-center gap-2.5'>
					<ShieldCheck size={17} className='text-emerald-400' />
					<div>
						<div className='text-sm font-semibold text-void-fg-1 leading-tight'>Kodia Deep Debugging & Correctness Hub</div>
						<div className='text-[11px] text-void-fg-3'>Compilers · Taint Analysis · Root-Cause · Fuzz · Mutation · Independent Verification · Proofs</div>
					</div>
				</div>
				<div className='flex flex-wrap items-center gap-1.5'>
					<KodiaSecondaryButton onClick={handleRunCompilers} disabled={!!busyLabel}>
						<Terminal size={12} /> Run Compilers
					</KodiaSecondaryButton>
					<KodiaSecondaryButton onClick={handleAnalyzeWorkspace} disabled={!!busyLabel}>
						<Bug size={12} /> Analyze Workspace
					</KodiaSecondaryButton>
					<KodiaSecondaryButton onClick={handleRunTaint} disabled={!!busyLabel}>
						<ShieldAlert size={12} /> Taint Scan
					</KodiaSecondaryButton>
					<KodiaSecondaryButton onClick={handleExportSarif} disabled={!!busyLabel}>
						<Download size={12} /> Export SARIF
					</KodiaSecondaryButton>
					<KodiaPrimaryButton onClick={handleAssessReadiness} disabled={!!busyLabel}>
						<ShieldCheck size={12} /> Readiness
					</KodiaPrimaryButton>
					<KodiaSecondaryButton onClick={() => void correctnessService.refreshFromDisk()} disabled={!!busyLabel}>
						<RefreshCw size={12} />
					</KodiaSecondaryButton>
					<KodiaSecondaryButton onClick={() => setShowEvents(v => !v)}>
						<Activity size={12} /> Events ({state.liveEvents.length})
					</KodiaSecondaryButton>
				</div>
			</div>

			{/* Status / Busy Strip */}
			{(busyLabel || statusBanner) && (
				<div className='px-4 py-1.5 text-xs bg-void-bg-3 border-b border-void-border-2 flex items-center justify-between gap-2 flex-shrink-0'>
					<span className='text-void-fg-1 truncate'>{busyLabel ? `Running: ${busyLabel}…` : statusBanner}</span>
					{statusBanner && !busyLabel && (
						<button type='button' onClick={() => setStatusBanner(null)} className='text-[10px] text-void-fg-3 hover:text-void-fg-1 cursor-pointer'>
							Dismiss
						</button>
					)}
				</div>
			)}

			{/* Navigation Tabs */}
			<div className='flex items-center gap-1 px-3 py-1.5 border-b border-void-border-2 bg-void-bg-1/70 overflow-x-auto flex-shrink-0'>
				{TABS.map(tab => {
					const active = state.activeSection === tab.id;
					const badge =
						tab.id === 'diagnostics' && activeCount > 0 ? String(activeCount) :
						tab.id === 'taint' && taintCount > 0 ? String(taintCount) :
						tab.id === 'verify' && latestVerdict ? latestVerdict :
						undefined;
					return (
						<button
							key={tab.id}
							type='button'
							onClick={() => correctnessService.setActiveSection(tab.id)}
							style={active ? { borderColor: 'var(--kodia-accent)' } : undefined}
							className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md whitespace-nowrap cursor-pointer transition-colors ${active
								? 'bg-void-bg-3 text-void-fg-1 font-medium border'
								: 'text-void-fg-3 hover:text-void-fg-1 hover:bg-void-bg-2 border border-transparent'
							}`}
						>
							{tab.icon}
							<span>{tab.label}</span>
							{badge && (
								<span className='text-[10px] px-1.5 py-0.2 rounded-full bg-void-bg-1 border border-void-border-2 text-void-fg-2'>
									{badge}
								</span>
							)}
						</button>
					);
				})}
			</div>

			{/* Main Section Body */}
			<div className='flex-1 min-h-0 overflow-y-auto p-4 space-y-4'>
				{/* SARIF Export Modal / Card */}
				{sarifPreview && (
					<KodiaCard className='!p-3 border border-sky-500/40'>
						<div className='flex items-center justify-between mb-2'>
							<span className='text-xs font-semibold text-void-fg-1'>SARIF 2.1.0 Export Preview</span>
							<div className='flex items-center gap-2'>
								<KodiaSecondaryButton onClick={() => { void navigator.clipboard?.writeText(sarifPreview); setStatusBanner('SARIF JSON copied to clipboard.'); }}>
									<Copy size={11} /> Copy JSON
								</KodiaSecondaryButton>
								<KodiaSecondaryButton onClick={() => setSarifPreview(null)}>Close</KodiaSecondaryButton>
							</div>
						</div>
						<pre className='text-[11px] font-mono bg-void-bg-1 p-2 rounded max-h-48 overflow-auto text-void-fg-2'>{sarifPreview.slice(0, 6000)}</pre>
					</KodiaCard>
				)}

				{/* TAB 1: LIVE DIAGNOSTICS */}
				{state.activeSection === 'diagnostics' && (
					<div className='space-y-4'>
						{/* Compiler summary strip */}
						<div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5'>
							{state.latestCompilerOutcomes.length === 0 ? (
								<KodiaCard className='!p-3 col-span-full'>
									<div className='text-xs text-void-fg-3'>No compiler checks run yet. Click <strong>Run Compilers</strong> to execute real JS/TS/Python/Go/Rust checks.</div>
								</KodiaCard>
							) : state.latestCompilerOutcomes.map(o => (
								<KodiaCard key={`${o.engine}-${o.language}`} className='!p-3'>
									<div className='flex items-center justify-between gap-2'>
										<span className='text-xs font-semibold text-void-fg-1'>{o.engine} ({o.language})</span>
										<KodiaBadge tone={!o.available ? 'neutral' : o.passed ? 'success' : 'danger'}>
											{!o.available ? 'Not Installed' : o.passed ? 'PASS' : `${o.diagnostics.length} ERR`}
										</KodiaBadge>
									</div>
									<div className='text-[11px] text-void-fg-3 mt-1 truncate'>{o.note ?? o.command ?? 'Checked'} · {o.durationMs}ms</div>
								</KodiaCard>
							))}
						</div>

						{/* Incremental cache metrics */}
						{state.latestIncremental && (
							<KodiaCard className='!p-3'>
								<div className='flex flex-wrap items-center justify-between gap-2'>
									<div className='text-xs text-void-fg-1 font-medium'>{state.latestIncremental.summary}</div>
									<KodiaBadge tone='accent'>{state.latestIncremental.mode.toUpperCase()}</KodiaBadge>
								</div>
								<div className='text-[11px] text-void-fg-3 mt-1'>
									Analyzed {state.latestIncremental.analyzedFilesCount}/{state.latestIncremental.totalWorkspaceFiles} files · Cached/skipped: {state.latestIncremental.cachedSkippedFilesCount} · Invalidated dependents: {state.latestIncremental.invalidatedDependents.length}
								</div>
							</KodiaCard>
						)}

						{/* Filter + Findings */}
						<div className='flex items-center gap-2'>
							<input
								type='text'
								value={diagFilter}
								onChange={e => setDiagFilter(e.target.value)}
								placeholder='Filter diagnostics by file, ruleId, or message…'
								className='flex-1 px-3 py-1.5 text-xs rounded-md bg-void-bg-1 border border-void-border-2 text-void-fg-1'
							/>
							<span className='text-xs text-void-fg-3'>{allDiagnostics.length} finding(s)</span>
						</div>

						{suppressTarget && (
							<KodiaCard className='!p-3 border border-amber-500/40 space-y-2'>
								<div className='text-xs font-semibold text-void-fg-1'>
									Suppress {suppressTarget.ruleId} in {suppressTarget.file} (justification required)
								</div>
								<div className='flex gap-2'>
									<input
										type='text'
										value={suppressReason}
										onChange={e => setSuppressReason(e.target.value)}
										placeholder='Explain why this finding is intentionally accepted or false positive…'
										className='flex-1 px-2.5 py-1.5 text-xs rounded bg-void-bg-1 border border-void-border-2 text-void-fg-1'
									/>
									<KodiaPrimaryButton onClick={handleAddSuppression} disabled={!suppressReason.trim()}>Save</KodiaPrimaryButton>
									<KodiaSecondaryButton onClick={() => setSuppressTarget(null)}>Cancel</KodiaSecondaryButton>
								</div>
							</KodiaCard>
						)}

						{allDiagnostics.length === 0 ? (
							<KodiaCard className='!p-6 text-center'>
								<CheckCircle2 size={20} className='mx-auto text-emerald-400 mb-1.5' />
								<div className='text-xs text-void-fg-2'>No diagnostics reported for the current scan.</div>
							</KodiaCard>
						) : (
							<div className='space-y-2'>
								{allDiagnostics.map(d => (
									<KodiaCard key={d.id} className={`!p-3 ${d.suppressed ? 'opacity-60' : ''}`}>
										<div className='flex flex-wrap items-center justify-between gap-2'>
											<div className='flex items-center gap-2 min-w-0'>
												<KodiaBadge tone={severityBadgeTone(d.severity)}>{d.severity}</KodiaBadge>
												<span className='text-xs font-semibold text-void-fg-1 truncate'>{d.title}</span>
												<span className='text-[10px] font-mono text-void-fg-3'>{d.ruleId}</span>
												<KodiaBadge tone='neutral'>{d.layer}</KodiaBadge>
											</div>
											<div className='flex items-center gap-2'>
												<span className='text-[11px] font-mono text-void-fg-2'>{d.file}:{d.line}</span>
												{!d.suppressed && (
													<button
														type='button'
														onClick={() => setSuppressTarget(d)}
														className='text-[10px] px-2 py-0.5 rounded bg-void-bg-1 border border-void-border-2 text-void-fg-3 hover:text-void-fg-1 cursor-pointer'
													>
														Suppress
													</button>
												)}
											</div>
										</div>
										<div className='text-xs text-void-fg-2 mt-1'>{d.message}</div>
										{d.evidence && <pre className='text-[11px] font-mono bg-void-bg-1 px-2 py-1 rounded mt-1.5 text-void-fg-3 overflow-x-auto'>{d.evidence}</pre>}
										<div className='text-[11px] text-emerald-400/90 mt-1'>Fix: {d.remediation}</div>
										{d.suppressed && <div className='text-[11px] text-amber-400 mt-1'>Suppressed: {d.suppressionReason}</div>}
									</KodiaCard>
								))}
							</div>
						)}

						{state.suppressions.length > 0 && (
							<KodiaCard className='!p-3 space-y-1.5'>
								<div className='text-xs font-semibold text-void-fg-1'>Recorded Suppressions ({state.suppressions.length})</div>
								{state.suppressions.map(s => (
									<div key={s.id} className='flex items-center justify-between gap-2 text-xs bg-void-bg-1 px-2.5 py-1.5 rounded border border-void-border-2'>
										<span className='truncate'>
											<strong className='font-mono'>{s.ruleId}</strong> {s.filePattern ? `(${s.filePattern})` : '(all files)'} — {s.justification}
										</span>
										<button type='button' onClick={() => void handleRemoveSuppression(s.id)} className='text-rose-400 hover:text-rose-300 cursor-pointer'>
											<Trash2 size={12} />
										</button>
									</div>
								))}
							</KodiaCard>
						)}
					</div>
				)}

				{/* TAB 2: TAINT FLOWS */}
				{state.activeSection === 'taint' && (
					<div className='space-y-3'>
						{!state.latestTaint ? (
							<KodiaCard className='!p-6 text-center space-y-2'>
								<ShieldAlert size={20} className='mx-auto text-amber-400' />
								<div className='text-xs text-void-fg-2'>Run Taint Analysis to trace untrusted sources → propagation → sanitizers → security sinks.</div>
								<KodiaPrimaryButton onClick={handleRunTaint} disabled={!!busyLabel}>Run Taint Scan</KodiaPrimaryButton>
							</KodiaCard>
						) : (
							<>
								<KodiaCard className='!p-3 flex flex-wrap items-center justify-between gap-2'>
									<div className='text-xs font-medium text-void-fg-1'>{state.latestTaint.summary}</div>
									<div className='flex items-center gap-2'>
										<KodiaBadge tone={state.latestTaint.unsafeFlows.length > 0 ? 'danger' : 'success'}>
											{state.latestTaint.unsafeFlows.length} Unsafe Flow(s)
										</KodiaBadge>
										<KodiaBadge tone='neutral'>{state.latestTaint.sanitizedFlowsCount} Sanitized</KodiaBadge>
									</div>
								</KodiaCard>
								{state.latestTaint.unsafeFlows.map(flow => (
									<KodiaCard key={flow.id} className='!p-3 space-y-2'>
										<div className='flex flex-wrap items-center justify-between gap-2'>
											<div className='flex items-center gap-2'>
												<KodiaBadge tone={severityBadgeTone(flow.severity)}>{flow.severity}</KodiaBadge>
												<span className='text-xs font-semibold text-void-fg-1'>{flow.title}</span>
											</div>
											<span className='text-[11px] font-mono text-void-fg-3'>{flow.sourceKind} → {flow.sinkKind}</span>
										</div>
										<div className='text-xs text-void-fg-2'>{flow.explanation}</div>
										<div className='grid grid-cols-1 md:grid-cols-3 gap-2 text-[11px] font-mono'>
											<div className='p-2 rounded bg-void-bg-1 border border-void-border-2'>
												<div className='text-[10px] uppercase text-sky-400 mb-0.5'>Source ({flow.source.file}:{flow.source.line})</div>
												<div className='truncate text-void-fg-2'>{flow.source.expression}</div>
											</div>
											<div className='p-2 rounded bg-void-bg-1 border border-void-border-2'>
												<div className='text-[10px] uppercase text-amber-400 mb-0.5'>Propagation ({flow.propagationPath.length} hop)</div>
												<div className='truncate text-void-fg-2'>{flow.propagationPath.map(h => `${h.symbol}@L${h.line}`).join(' → ') || 'Direct'}</div>
											</div>
											<div className='p-2 rounded bg-void-bg-1 border border-void-border-2'>
												<div className='text-[10px] uppercase text-rose-400 mb-0.5'>Sink ({flow.sink.file}:{flow.sink.line})</div>
												<div className='truncate text-void-fg-2'>{flow.sink.expression}</div>
											</div>
										</div>
										<div className='text-[11px] text-emerald-400/90'>Remediation: {flow.remediation}</div>
									</KodiaCard>
								))}
							</>
						)}
					</div>
				)}

				{/* TAB 3: ROOT-CAUSE INVESTIGATOR */}
				{state.activeSection === 'investigate' && (
					<div className='space-y-4'>
						<KodiaCard className='!p-3 space-y-2.5'>
							<div className='text-xs font-semibold text-void-fg-1'>Ranked Root-Cause Investigation</div>
							<input
								type='text'
								value={symptom}
								onChange={e => setSymptom(e.target.value)}
								placeholder='Describe the observed failure or bug symptom (e.g. "POST /orders returns 500 TypeError")…'
								className='w-full px-3 py-1.5 text-xs rounded bg-void-bg-1 border border-void-border-2 text-void-fg-1'
							/>
							<textarea
								rows={3}
								value={stackLogs}
								onChange={e => setStackLogs(e.target.value)}
								placeholder='Optional stack trace, compiler errors, or runtime logs…'
								className='w-full px-3 py-1.5 text-xs font-mono rounded bg-void-bg-1 border border-void-border-2 text-void-fg-1'
							/>
							<div className='flex justify-end'>
								<KodiaPrimaryButton onClick={handleInvestigate} disabled={!symptom.trim() || !!busyLabel}>
									<Search size={12} /> Investigate Root Cause
								</KodiaPrimaryButton>
							</div>
						</KodiaCard>

						{state.investigations.map(inv => (
							<KodiaCard key={inv.id} className='!p-3 space-y-2.5'>
								<div className='flex items-center justify-between gap-2'>
									<span className='text-xs font-semibold text-void-fg-1'>{inv.symptom}</span>
									<span className='text-[10px] text-void-fg-3'>{new Date(inv.createdAt).toLocaleString()}</span>
								</div>
								<div className='text-xs text-void-fg-2'>{inv.summary}</div>
								<div className='space-y-2'>
									{inv.hypotheses.map(h => {
										const badge = certaintyLabel(h.certainty);
										return (
											<div key={h.rank} className='p-2.5 rounded bg-void-bg-1 border border-void-border-2 space-y-1'>
												<div className='flex flex-wrap items-center justify-between gap-2'>
													<div className='flex items-center gap-2'>
														<span className='text-xs font-bold text-void-fg-1'>#{h.rank}</span>
														<span className='text-xs font-semibold text-void-fg-1'>{h.title}</span>
														<KodiaBadge tone={badge.tone}>{badge.text} ({Math.round(h.confidenceScore * 100)}%)</KodiaBadge>
													</div>
													{h.location && <span className='text-[11px] font-mono text-void-fg-3'>{h.location.file}{h.location.line ? `:${h.location.line}` : ''}</span>}
												</div>
												<div className='text-[11px] text-void-fg-2'>Evidence: {h.supportingEvidence.join(' | ')}</div>
												<div className='text-[11px] text-amber-400/90'>Next Check: {h.nextVerificationStep}</div>
												<div className='text-[11px] text-emerald-400/90'>Proposed Repair: {h.proposedRepair}</div>
											</div>
										);
									})}
								</div>
								{inv.uncertaintyNotes.length > 0 && (
									<div className='text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded p-2'>
										<strong>Remaining Uncertainty:</strong> {inv.uncertaintyNotes.join(' · ')}
									</div>
								)}
							</KodiaCard>
						))}
					</div>
				)}

				{/* TAB 4: CHANGE IMPACT & CONTROLLED REPAIR PLAN */}
				{state.activeSection === 'impact' && (
					<div className='space-y-4'>
						<KodiaCard className='!p-3 space-y-2.5'>
							<div className='text-xs font-semibold text-void-fg-1'>Controlled Repair & Blast-Radius Planner</div>
							<input
								type='text'
								value={defectSummary}
								onChange={e => setDefectSummary(e.target.value)}
								placeholder='Defect summary…'
								className='w-full px-3 py-1.5 text-xs rounded bg-void-bg-1 border border-void-border-2 text-void-fg-1'
							/>
							<input
								type='text'
								value={impactTargetFiles}
								onChange={e => setImpactTargetFiles(e.target.value)}
								placeholder='Target files (comma-separated, e.g. src/auth.ts, src/routes.ts)…'
								className='w-full px-3 py-1.5 text-xs font-mono rounded bg-void-bg-1 border border-void-border-2 text-void-fg-1'
							/>
							<input
								type='text'
								value={fixStrategy}
								onChange={e => setFixStrategy(e.target.value)}
								placeholder='Smallest fix strategy…'
								className='w-full px-3 py-1.5 text-xs rounded bg-void-bg-1 border border-void-border-2 text-void-fg-1'
							/>
							<div className='flex justify-end'>
								<KodiaPrimaryButton onClick={handlePlanRepair} disabled={!defectSummary.trim() || !impactTargetFiles.trim() || !!busyLabel}>
									<GitBranch size={12} /> Compute Blast Radius & Plan
								</KodiaPrimaryButton>
							</div>
						</KodiaCard>

						{state.latestRepairPlan && (
							<KodiaCard className='!p-3 space-y-2'>
								<div className='text-xs font-semibold text-void-fg-1'>Latest Repair Plan: {state.latestRepairPlan.defectSummary}</div>
								<div className='text-xs text-void-fg-2'>Strategy: {state.latestRepairPlan.smallestFixStrategy}</div>
								<div className='grid grid-cols-1 md:grid-cols-2 gap-2 text-xs'>
									<div className='p-2 rounded bg-void-bg-1 border border-void-border-2'>
										<div className='font-semibold text-[11px] mb-1'>Blast Radius ({state.latestRepairPlan.blastRadiusFiles.length} files)</div>
										<div className='font-mono text-[11px] text-void-fg-3 space-y-0.5 max-h-40 overflow-y-auto'>
											{state.latestRepairPlan.blastRadiusFiles.map(f => <div key={f}>{f}</div>)}
										</div>
									</div>
									<div className='p-2 rounded bg-void-bg-1 border border-void-border-2'>
										<div className='font-semibold text-[11px] mb-1'>Targeted Tests ({state.latestRepairPlan.targetedTests.length})</div>
										<div className='font-mono text-[11px] text-void-fg-3 space-y-0.5 max-h-40 overflow-y-auto'>
											{state.latestRepairPlan.targetedTests.length > 0
												? state.latestRepairPlan.targetedTests.map(t => <div key={t}>{t}</div>)
												: <div>No existing test files mapped — add a targeted regression test.</div>}
										</div>
									</div>
								</div>
								<div className='text-[11px] text-amber-400'>Risks: {state.latestRepairPlan.sideEffectRisks.join(' · ')}</div>
								<div className='text-[11px] text-void-fg-3'>Rollback: {state.latestRepairPlan.rollbackStrategy}</div>
							</KodiaCard>
						)}
					</div>
				)}

				{/* TAB 5: PROPERTY-BASED & FUZZ TESTING */}
				{state.activeSection === 'fuzz' && (
					<div className='space-y-4'>
						<KodiaCard className='!p-3 space-y-2.5'>
							<div className='text-xs font-semibold text-void-fg-1'>Property-Based & Fuzz Runner (with Counterexample Minimization)</div>
							<div className='grid grid-cols-1 md:grid-cols-2 gap-2'>
								<input type='text' value={fuzzFile} onChange={e => setFuzzFile(e.target.value)} placeholder='Target JS/CJS file (e.g. src/calc.cjs)' className='px-2.5 py-1.5 text-xs font-mono rounded bg-void-bg-1 border border-void-border-2 text-void-fg-1' />
								<input type='text' value={fuzzExport} onChange={e => setFuzzExport(e.target.value)} placeholder='Exported function name (e.g. divide)' className='px-2.5 py-1.5 text-xs font-mono rounded bg-void-bg-1 border border-void-border-2 text-void-fg-1' />
								<input type='text' value={fuzzProperty} onChange={e => setFuzzProperty(e.target.value)} placeholder='JS property expression using args & result' className='px-2.5 py-1.5 text-xs font-mono rounded bg-void-bg-1 border border-void-border-2 text-void-fg-1' />
								<input type='text' value={fuzzArgSchema} onChange={e => setFuzzArgSchema(e.target.value)} placeholder='Arg schema: number,integer,string,boolean,json-object,array-number' className='px-2.5 py-1.5 text-xs font-mono rounded bg-void-bg-1 border border-void-border-2 text-void-fg-1' />
							</div>
							<div className='flex flex-wrap items-center justify-between gap-2'>
								<div className='flex items-center gap-3 text-xs'>
									<label className='flex items-center gap-1.5'>
										<span>Iterations:</span>
										<input type='number' min={10} max={2000} value={fuzzIterations} onChange={e => setFuzzIterations(Number(e.target.value) || 150)} className='w-20 px-2 py-1 rounded bg-void-bg-1 border border-void-border-2' />
									</label>
									<label className='flex items-center gap-1.5'>
										<span>Seed:</span>
										<input type='number' value={fuzzSeed} onChange={e => setFuzzSeed(Number(e.target.value) || 42)} className='w-20 px-2 py-1 rounded bg-void-bg-1 border border-void-border-2' />
									</label>
								</div>
								<KodiaPrimaryButton onClick={handleRunFuzz} disabled={!fuzzFile.trim() || !fuzzExport.trim() || !!busyLabel}>
									<Play size={12} /> Run Fuzz Test
								</KodiaPrimaryButton>
							</div>
						</KodiaCard>

						{state.fuzzRuns.map(run => (
							<KodiaCard key={run.id} className='!p-3 space-y-2'>
								<div className='flex items-center justify-between gap-2'>
									<div className='flex items-center gap-2'>
										<KodiaBadge tone={run.passed ? 'success' : 'danger'}>{run.passed ? 'PASSED' : 'COUNTEREXAMPLE FOUND'}</KodiaBadge>
										<span className='text-xs font-mono text-void-fg-1'>{run.targetFile}::{run.exportName}</span>
									</div>
									<span className='text-[11px] text-void-fg-3'>{run.iterationsRun} iters · seed {run.seed} · {run.durationMs}ms</span>
								</div>
								<div className='text-xs text-void-fg-2'>{run.summary}</div>
								{run.counterexample && (
									<div className='space-y-1.5 p-2 rounded bg-void-bg-1 border border-rose-500/30 text-xs font-mono'>
										<div className='text-rose-400'>Failure: {run.counterexample.errorOrViolation}</div>
										<div>Raw args: {JSON.stringify(run.counterexample.rawArgs)}</div>
										<div className='text-emerald-400'>Minimized args: {JSON.stringify(run.counterexample.minimizedArgs)}</div>
										<pre className='text-[11px] bg-void-bg-2 p-2 rounded overflow-x-auto text-void-fg-2'>{run.counterexample.regressionTestSnippet}</pre>
									</div>
								)}
							</KodiaCard>
						))}
					</div>
				)}

				{/* TAB 6: MUTATION TESTING */}
				{state.activeSection === 'mutation' && (
					<div className='space-y-4'>
						<KodiaCard className='!p-3 space-y-2.5'>
							<div className='text-xs font-semibold text-void-fg-1'>Isolated Mutation Testing (Workspace Tree Never Mutated)</div>
							<div className='grid grid-cols-1 md:grid-cols-3 gap-2'>
								<input type='text' value={mutFile} onChange={e => setMutFile(e.target.value)} placeholder='Target source file (e.g. src/math.cjs)' className='px-2.5 py-1.5 text-xs font-mono rounded bg-void-bg-1 border border-void-border-2 text-void-fg-1' />
								<input type='text' value={mutTestCmd} onChange={e => setMutTestCmd(e.target.value)} placeholder='Test command (e.g. node --test)' className='px-2.5 py-1.5 text-xs font-mono rounded bg-void-bg-1 border border-void-border-2 text-void-fg-1' />
								<div className='flex items-center gap-2'>
									<input type='number' min={1} max={100} value={mutMax} onChange={e => setMutMax(Number(e.target.value) || 20)} className='w-20 px-2 py-1.5 text-xs rounded bg-void-bg-1 border border-void-border-2 text-void-fg-1' />
									<KodiaPrimaryButton onClick={handleRunMutation} disabled={!mutFile.trim() || !mutTestCmd.trim() || !!busyLabel}>
										<Play size={12} /> Run Mutants
									</KodiaPrimaryButton>
								</div>
							</div>
						</KodiaCard>

						{state.mutationRuns.map(run => (
							<KodiaCard key={run.id} className='!p-3 space-y-2'>
								<div className='flex flex-wrap items-center justify-between gap-2'>
									<div className='flex items-center gap-2'>
										<KodiaBadge tone={run.mutationScore >= 80 ? 'success' : run.mutationScore >= 50 ? 'warning' : 'danger'}>
											Score: {run.mutationScore}%
										</KodiaBadge>
										<span className='text-xs font-mono text-void-fg-1'>{run.targetFile}</span>
									</div>
									<span className='text-[11px] text-void-fg-3'>
										Killed: {run.killed} · Survived: {run.survived} · Timeout: {run.timedOut} / {run.totalMutants}
									</span>
								</div>
								<div className='text-[11px] text-void-fg-3'>{run.limitationsNote}</div>
								<div className='space-y-1 max-h-56 overflow-y-auto'>
									{run.outcomes.map(m => (
										<div key={m.id} className='flex items-center justify-between gap-2 text-[11px] font-mono px-2 py-1 rounded bg-void-bg-1 border border-void-border-2'>
											<span className='truncate'>L{m.line} [{m.operator}]: {m.originalCode} → {m.mutatedCode}</span>
											<KodiaBadge tone={m.status === 'killed' ? 'success' : m.status === 'survived' ? 'danger' : 'warning'}>{m.status}</KodiaBadge>
										</div>
									))}
								</div>
							</KodiaCard>
						))}
					</div>
				)}

				{/* TAB 7: INDEPENDENT VERIFICATION & PROOF-CARRYING RECORDS */}
				{state.activeSection === 'verify' && (
					<div className='space-y-4'>
						<KodiaCard className='!p-3 space-y-2.5'>
							<div className='text-xs font-semibold text-void-fg-1'>Independent Verification Gate (Adversarial Re-Check)</div>
							<input type='text' value={verifyDesc} onChange={e => setVerifyDesc(e.target.value)} placeholder='Change description…' className='w-full px-2.5 py-1.5 text-xs rounded bg-void-bg-1 border border-void-border-2 text-void-fg-1' />
							<input type='text' value={verifyFiles} onChange={e => setVerifyFiles(e.target.value)} placeholder='Changed files (comma-separated)…' className='w-full px-2.5 py-1.5 text-xs font-mono rounded bg-void-bg-1 border border-void-border-2 text-void-fg-1' />
							<div className='grid grid-cols-1 md:grid-cols-2 gap-2'>
								<textarea rows={2} value={verifyCmds} onChange={e => setVerifyCmds(e.target.value)} placeholder='Real verification test commands (one per line)…' className='px-2.5 py-1.5 text-xs font-mono rounded bg-void-bg-1 border border-void-border-2 text-void-fg-1' />
								<textarea rows={2} value={verifyReqs} onChange={e => setVerifyReqs(e.target.value)} placeholder='Requirements covered (one per line, optional)…' className='px-2.5 py-1.5 text-xs rounded bg-void-bg-1 border border-void-border-2 text-void-fg-1' />
							</div>
							<div className='flex justify-end'>
								<KodiaPrimaryButton onClick={handleIndependentVerify} disabled={!verifyDesc.trim() || !verifyFiles.trim() || !!busyLabel}>
									<FileCheck2 size={12} /> Run Independent Verification
								</KodiaPrimaryButton>
							</div>
						</KodiaCard>

						{state.verifications.map(v => (
							<KodiaCard key={v.id} className='!p-3 space-y-2'>
								<div className='flex items-center justify-between gap-2'>
									<div className='flex items-center gap-2'>
										<KodiaBadge tone={verdictTone(v.verdict)}>{v.verdict}</KodiaBadge>
										<span className='text-xs font-semibold text-void-fg-1'>{v.changeDescription}</span>
									</div>
									<span className='text-[10px] text-void-fg-3'>{new Date(v.verifiedAt).toLocaleString()}</span>
								</div>
								{v.rejectionReasons.length > 0 && (
									<div className='text-xs text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded p-2'>
										<strong>Rejection Reasons:</strong> {v.rejectionReasons.join(' | ')}
									</div>
								)}
								<div className='space-y-1'>
									{v.checks.map((c, idx) => (
										<div key={`${v.id}-${idx}`} className='flex items-center justify-between gap-2 text-[11px] px-2 py-1 rounded bg-void-bg-1 border border-void-border-2'>
											<span className='truncate'><strong>{c.name}</strong> ({c.category}) — {c.detail}</span>
											<KodiaBadge tone={c.status === 'passed' ? 'success' : c.status === 'failed' ? 'danger' : 'neutral'}>{c.status}</KodiaBadge>
										</div>
									))}
								</div>
								{v.untestedRisks.length > 0 && (
									<div className='text-[11px] text-amber-400'>Untested risks: {v.untestedRisks.join(' · ')}</div>
								)}
							</KodiaCard>
						))}

						{state.proofs.length > 0 && (
							<div className='space-y-2'>
								<div className='text-xs font-semibold text-void-fg-1'>Proof-Carrying Change Records (.kodia/correctness/proofs)</div>
								{state.proofs.map(p => (
									<KodiaCard key={p.id} className='!p-3 space-y-1'>
										<div className='flex items-center justify-between gap-2'>
											<div className='flex items-center gap-2'>
												<KodiaBadge tone={verdictTone(p.independentVerdict)}>{p.independentVerdict}</KodiaBadge>
												<span className='text-xs font-semibold text-void-fg-1'>{p.title}</span>
											</div>
											<span className='text-[10px] font-mono text-void-fg-3'>{p.id}</span>
										</div>
										<div className='text-[11px] text-void-fg-2'>Files: {p.changedFiles.join(', ')} · Tests: {p.testsExecuted.filter(t => t.passed).length}/{p.testsExecuted.length} passed · Static: {p.staticFindingsCount} · Taint: {p.taintFindingsCount}</div>
										{p.knownLimitations.length > 0 && (
											<div className='text-[11px] text-void-fg-3'>Limitations: {p.knownLimitations.join(' · ')}</div>
										)}
									</KodiaCard>
								))}
							</div>
						)}
					</div>
				)}

				{/* TAB 8: RELEASE READINESS */}
				{state.activeSection === 'readiness' && (
					<div className='space-y-4'>
						{!latestReadiness ? (
							<KodiaCard className='!p-6 text-center space-y-2'>
								<ShieldCheck size={20} className='mx-auto text-emerald-400' />
								<div className='text-xs text-void-fg-2'>Compute an honest, evidence-based release readiness decision across compilers, diagnostics, taint, tests, and independent verification.</div>
								<KodiaPrimaryButton onClick={handleAssessReadiness} disabled={!!busyLabel}>Assess Release Readiness</KodiaPrimaryButton>
							</KodiaCard>
						) : (() => {
							const meta = readinessMeta(latestReadiness.outcome);
							return (
								<div className='space-y-3'>
									<KodiaCard className='!p-4 space-y-2'>
										<div className='flex flex-wrap items-center justify-between gap-2'>
											<div className='flex items-center gap-2'>
												{meta.tone === 'success' ? <CheckCircle2 size={16} className='text-emerald-400' /> : meta.tone === 'danger' ? <XCircle size={16} className='text-rose-400' /> : <AlertTriangle size={16} className='text-amber-400' />}
												<span className='text-sm font-semibold text-void-fg-1'>{meta.label}</span>
											</div>
											<KodiaBadge tone={meta.tone}>{latestReadiness.outcome}</KodiaBadge>
										</div>
										<div className='text-xs text-void-fg-2'>{latestReadiness.summary}</div>
										<div className='text-[11px] text-void-fg-3 bg-void-bg-1 border border-void-border-2 rounded p-2'>
											{latestReadiness.explicitDisclaimer}
										</div>
									</KodiaCard>

									<div className='grid grid-cols-1 md:grid-cols-2 gap-2.5'>
										{latestReadiness.gates.map(g => (
											<KodiaCard key={g.id} className='!p-3 space-y-1'>
												<div className='flex items-center justify-between gap-2'>
													<span className='text-xs font-semibold text-void-fg-1'>{g.label}</span>
													<KodiaBadge tone={g.status === 'passed' ? 'success' : g.status === 'failed' || g.status === 'blocked' ? 'danger' : 'warning'}>{g.status}</KodiaBadge>
												</div>
												<div className='text-[11px] text-void-fg-2'>{g.evidence}</div>
												{g.gap && <div className='text-[11px] text-amber-400'>Gap: {g.gap}</div>}
											</KodiaCard>
										))}
									</div>

									{latestReadiness.blockers.length > 0 && (
										<KodiaCard className='!p-3 border border-rose-500/40'>
											<div className='text-xs font-semibold text-rose-400 mb-1'>Blockers ({latestReadiness.blockers.length})</div>
											<ul className='list-disc pl-4 text-xs text-void-fg-2 space-y-0.5'>
												{latestReadiness.blockers.map((b, i) => <li key={i}>{b}</li>)}
											</ul>
										</KodiaCard>
									)}

									{latestReadiness.unverifiedDimensions.length > 0 && (
										<KodiaCard className='!p-3 border border-amber-500/40'>
											<div className='text-xs font-semibold text-amber-400 mb-1'>Explicitly Unverified Dimensions ({latestReadiness.unverifiedDimensions.length})</div>
											<ul className='list-disc pl-4 text-xs text-void-fg-2 space-y-0.5'>
												{latestReadiness.unverifiedDimensions.map((u, i) => <li key={i}>{u}</li>)}
											</ul>
										</KodiaCard>
									)}
								</div>
							);
						})()}
					</div>
				)}
			</div>

			{/* Bottom Live Investigation & Verification Event Timeline */}
			{showEvents && (
				<div className='h-36 border-t border-void-border-2 bg-void-bg-1 flex flex-col flex-shrink-0'>
					<div className='flex items-center justify-between px-3 py-1 border-b border-void-border-2 text-[11px]'>
						<span className='font-semibold text-void-fg-2 flex items-center gap-1.5'>
							<Activity size={11} className='text-emerald-400' /> Live Correctness & Verification Stream ({state.liveEvents.length})
						</span>
						<button type='button' onClick={() => correctnessService.clearLiveEvents()} className='text-void-fg-3 hover:text-void-fg-1 cursor-pointer'>
							Clear
						</button>
					</div>
					<div className='flex-1 overflow-y-auto px-3 py-1 space-y-0.5 font-mono text-[11px]'>
						{state.liveEvents.length === 0 ? (
							<div className='text-void-fg-3 py-2'>No live events emitted yet.</div>
						) : [...state.liveEvents].reverse().map(ev => (
							<div key={ev.eventId} className='flex items-center gap-2 text-void-fg-2'>
								<span className='text-void-fg-3 shrink-0'>#{ev.seq}</span>
								<span className='text-sky-400 shrink-0'>[{ev.type}]</span>
								<span className='truncate'>{ev.message}</span>
								{typeof ev.durationMs === 'number' && <span className='text-void-fg-3 ml-auto shrink-0'>{ev.durationMs}ms</span>}
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
};
