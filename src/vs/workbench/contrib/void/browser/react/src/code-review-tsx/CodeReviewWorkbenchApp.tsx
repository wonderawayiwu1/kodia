/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useMemo, useState } from 'react';
import {
	Activity,
	AlertTriangle,
	BarChart3,
	BookOpen,
	Bot,
	CheckCircle2,
	Cpu,
	Database,
	Download,
	FileCode2,
	FolderGit2,
	GitPullRequest,
	Globe,
	History,
	Layers,
	Lock,
	Network,
	PanelBottom,
	PanelLeft,
	PanelRight,
	Pause,
	Play,
	RefreshCw,
	Scale,
	Search,
	Server,
	Settings,
	Shield,
	Sliders,
	Square,
	TestTube2,
	Wrench,
	Zap,
} from 'lucide-react';
import {
	KacraeExportReportRequest,
	KacraeFinding,
	KacraeReviewDepth,
	KacraeReviewRule,
	KacraeReviewScope,
	KacraeSeverity,
	KacraeWorkbenchSection,
} from '../../../../common/kacraeTypes.js';
import '../styles.css';
import { CodeReviewWorkbenchState } from '../../../codeReviewService.js';
import { useAccessor, useIsDark } from '../util/services.js';
import { AttackPathVisualizer, DependencyGraphCanvas, QualityTrendChart } from './CodeReviewVisuals.js';

interface NavDef {
	readonly id: KacraeWorkbenchSection;
	readonly group: 'Review' | 'Intelligence' | 'Assurance' | 'Configure';
	readonly label: string;
	readonly icon: React.ReactNode;
}

const NAV_ITEMS: readonly NavDef[] = [
	{ id: 'overview', group: 'Review', label: 'Overview', icon: <BarChart3 size={13} /> },
	{ id: 'current_review', group: 'Review', label: 'Current Review', icon: <Shield size={13} /> },
	{ id: 'change_review', group: 'Review', label: 'Change Review', icon: <FolderGit2 size={13} /> },
	{ id: 'full_project_review', group: 'Review', label: 'Full Project Review', icon: <Layers size={13} /> },
	{ id: 'pull_request_review', group: 'Review', label: 'Pull Request Review', icon: <GitPullRequest size={13} /> },

	{ id: 'security_intelligence', group: 'Intelligence', label: 'Security Intelligence', icon: <Lock size={13} /> },
	{ id: 'architecture_intelligence', group: 'Intelligence', label: 'Architecture Intelligence', icon: <Network size={13} /> },
	{ id: 'correctness_analysis', group: 'Intelligence', label: 'Correctness Analysis', icon: <CheckCircle2 size={13} /> },
	{ id: 'functional_completeness', group: 'Intelligence', label: 'Functional Completeness', icon: <CheckCircle2 size={13} /> },
	{ id: 'performance_analysis', group: 'Intelligence', label: 'Performance Analysis', icon: <Zap size={13} /> },
	{ id: 'test_intelligence', group: 'Intelligence', label: 'Test Intelligence', icon: <TestTube2 size={13} /> },
	{ id: 'dependency_intelligence', group: 'Intelligence', label: 'Dependency Intelligence', icon: <Cpu size={13} /> },
	{ id: 'database_review', group: 'Intelligence', label: 'Database Review', icon: <Database size={13} /> },
	{ id: 'api_contract_review', group: 'Intelligence', label: 'API & Contract Review', icon: <Globe size={13} /> },
	{ id: 'technical_debt', group: 'Intelligence', label: 'Technical Debt', icon: <Wrench size={13} /> },

	{ id: 'compliance_governance', group: 'Assurance', label: 'Compliance & Governance', icon: <Scale size={13} /> },
	{ id: 'review_history', group: 'Assurance', label: 'Review History', icon: <History size={13} /> },
	{ id: 'review_reports', group: 'Assurance', label: 'Review Reports', icon: <Download size={13} /> },
	{ id: 'coding_standards_rules', group: 'Assurance', label: 'Coding Standards & Rules', icon: <BookOpen size={13} /> },

	{ id: 'review_automation', group: 'Configure', label: 'Review Automation', icon: <Activity size={13} /> },
	{ id: 'ai_review_config', group: 'Configure', label: 'AI Review Configuration', icon: <Bot size={13} /> },
	{ id: 'provider_model_config', group: 'Configure', label: 'Provider & Model Setup', icon: <Server size={13} /> },
	{ id: 'enterprise_admin', group: 'Configure', label: 'Enterprise Administration', icon: <Sliders size={13} /> },
	{ id: 'settings_diagnostics', group: 'Configure', label: 'Settings & Diagnostics', icon: <Settings size={13} /> },
];

const SEV_BADGE: Record<KacraeSeverity, string> = {
	critical: 'bg-red-500/20 text-red-400 border-red-500/40',
	high: 'bg-orange-500/20 text-orange-400 border-orange-500/40',
	medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40',
	low: 'bg-blue-500/20 text-blue-400 border-blue-500/40',
	info: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
};

export const CodeReviewWorkbenchApp: React.FC = () => {
	const isDark = useIsDark();
	const accessor = useAccessor();
	const codeReviewService = accessor.get('ICodeReviewService');
	const commandService = accessor.get('ICommandService');

	const [state, setState] = useState<CodeReviewWorkbenchState>(codeReviewService.state);
	const [scope, setScope] = useState<KacraeReviewScope>('modified_files');
	const [depth, setDepth] = useState<KacraeReviewDepth>('standard');
	const [searchQuery, setSearchQuery] = useState('');
	const [sevFilter, setSevFilter] = useState<string>('all');
	const [showLeft, setShowLeft] = useState(true);
	const [showRight, setShowRight] = useState(true);
	const [showBottom, setShowBottom] = useState(false);

	const pendingFixSet = useMemo(() => new Set(state.pendingAiFixIds), [state.pendingAiFixIds]);

	const fixFindingWithKodiaAI = (f: KacraeFinding) => {
		void codeReviewService.fixFindingsWithKodiaAI([f]);
		setStatusMsg(`Fixing "${f.title}" with Kodia AI — dashboard will auto-verify & update FIXED live when done.`);
	};

	const fixTopIssuesWithKodiaAI = (list: readonly KacraeFinding[]) => {
		const targets = list
			.filter(f => f.lifecycle !== 'verified_resolved' && f.lifecycle !== 'suppressed' && f.lifecycle !== 'false_positive')
			.slice(0, 5);
		if (targets.length === 0) { return; }
		void codeReviewService.fixFindingsWithKodiaAI(targets);
		setStatusMsg(`Fixing top ${targets.length} issue(s) with Kodia AI — dashboard will auto-verify & update FIXED live when done.`);
	};

	const [suppressReason, setSuppressReason] = useState('');
	const [aiExplanation, setAiExplanation] = useState<string | null>(null);
	const [aiBusy, setAiBusy] = useState(false);
	const [statusMsg, setStatusMsg] = useState<string | null>(null);

	// Rule editor form state
	const [newRuleName, setNewRuleName] = useState('');
	const [newRulePattern, setNewRulePattern] = useState('');
	const [newRuleSeverity, setNewRuleSeverity] = useState<KacraeSeverity>('high');
	const [newRuleDesc, setNewRuleDesc] = useState('');

	// Report exporter state
	const [reportType, setReportType] = useState<KacraeExportReportRequest['reportType']>('technical');
	const [reportFormat, setReportFormat] = useState<KacraeExportReportRequest['format']>('html');
	const [lastExportPath, setLastExportPath] = useState<string | null>(null);

	// PR / Branch comparison inputs
	const [gitBaseRef, setGitBaseRef] = useState('HEAD~1');
	const [gitHeadRef, setGitHeadRef] = useState('HEAD');
	// Live functional completeness URL input
	const [fcAppUrl, setFcAppUrl] = useState('');
	const [liveFcReport, setLiveFcReport] = useState<NonNullable<NonNullable<typeof state.sessions[number]>['functionalCompleteness']> | null>(null);

	useEffect(() => {
		const sub = codeReviewService.onDidChange(() => setState(codeReviewService.state));
		void codeReviewService.refreshFromDisk();
		return () => sub.dispose();
	}, [codeReviewService]);

	const session = codeReviewService.getActiveSession();
	const activeSection = state.activeSection;

	const filteredFindings = useMemo(() => {
		const all = session?.findings ?? [];
		const q = searchQuery.trim().toLowerCase();
		return all.filter(f => {
			if (sevFilter !== 'all' && f.severity !== sevFilter) { return false; }
			if (!q) { return true; }
			return f.title.toLowerCase().includes(q) || f.location.file.toLowerCase().includes(q) || f.ruleId.toLowerCase().includes(q) || f.category.toLowerCase().includes(q);
		});
	}, [session, searchQuery, sevFilter]);

	const selectedFinding: KacraeFinding | null = useMemo(() => {
		if (!session) { return null; }
		return session.findings.find(f => f.id === state.selectedFindingId) ?? filteredFindings[0] ?? null;
	}, [session, state.selectedFindingId, filteredFindings]);

	useEffect(() => {
		setAiExplanation(null);
	}, [selectedFinding?.id]);

	const runReview = async (overrideScope?: KacraeReviewScope, overrideDepth?: KacraeReviewDepth) => {
		setStatusMsg(null);
		try {
			const s = await codeReviewService.startReview({
				scope: overrideScope ?? scope,
				depth: overrideDepth ?? depth,
				gitBaseRef: (overrideScope ?? scope) === 'branch_comparison' || (overrideScope ?? scope) === 'pull_request' ? gitBaseRef : undefined,
				gitHeadRef: (overrideScope ?? scope) === 'branch_comparison' || (overrideScope ?? scope) === 'pull_request' ? gitHeadRef : undefined,
			});
			setStatusMsg(`Completed: ${s.summary}`);
		} catch (e) {
			setStatusMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
		}
	};

	const renderFindingTable = (list: readonly KacraeFinding[], emptyText: string) => (
		<div className='flex flex-col gap-2'>
			{list.length > 0 && (
				<div className='px-3 py-2 rounded-lg bg-sky-500/10 border border-sky-500/25 text-[11px] text-void-fg-2 flex flex-wrap items-center justify-between gap-2'>
					<span><strong>How to fix:</strong> Click any issue to inspect details on the right, or click <strong>Fix with AI</strong> to let Kodia edit &amp; verify the code automatically.</span>
					<button
						type='button'
						onClick={() => fixTopIssuesWithKodiaAI(list)}
						className='px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-medium flex items-center gap-1 cursor-pointer transition-colors shrink-0'
					>
						<Zap size={11} /> Fix Top {Math.min(5, list.length)} with AI
					</button>
				</div>
			)}
			{list.map(f => {
				const selected = selectedFinding?.id === f.id;
				return (
					<div
						key={f.id}
						onClick={() => codeReviewService.selectFinding(f.id)}
						className={`p-2.5 rounded-lg border cursor-pointer transition-colors ${selected ? 'border-sky-500 bg-void-bg-2 shadow-xs' : 'border-void-border-2 bg-void-bg-1 hover:border-void-border-1'}`}
					>
						<div className='flex flex-wrap items-center gap-1.5 mb-1'>
							<span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold uppercase ${SEV_BADGE[f.severity]}`}>{f.severity}</span>
							<span className='text-[10px] px-1.5 py-0.5 rounded bg-void-bg-3 text-void-fg-2'>{f.classification.replace(/_/g, ' ')}</span>
							<span className='text-[10px] text-void-fg-3 font-mono'>{f.ruleId}</span>
							<span className={`text-[10px] ml-auto font-medium ${f.lifecycle === 'verified_resolved' ? 'text-emerald-400' : f.lifecycle === 'suppressed' ? 'text-void-fg-3' : 'text-void-fg-2'}`}>
								{f.lifecycle.replace(/_/g, ' ')}
							</span>
						</div>
						<div className='text-xs font-medium text-void-fg-1'>{f.title}</div>
						<div className='flex items-center justify-between gap-2 mt-1.5 text-[11px] text-void-fg-3'>
							<button
								type='button'
								onClick={ev => { ev.stopPropagation(); void codeReviewService.openFindingInEditor(f.location.file, f.location.startLine); }}
								className='font-mono text-sky-400 hover:underline truncate cursor-pointer'
								title='Jump to this line in editor'
							>
								{f.location.file}:{f.location.startLine}
							</button>
							{f.lifecycle === 'verified_resolved' ? (
								<span className='px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-[10px] font-semibold flex items-center gap-1 shrink-0'>
									<CheckCircle2 size={10} /> Fixed &amp; Verified
								</span>
							) : (
								<button
									type='button'
									disabled={pendingFixSet.has(f.id)}
									onClick={ev => { ev.stopPropagation(); fixFindingWithKodiaAI(f); }}
									className={`px-2 py-0.5 rounded border text-[10px] font-medium flex items-center gap-1 cursor-pointer transition-colors shrink-0 ${pendingFixSet.has(f.id)
										? 'bg-amber-500/20 border-amber-500/40 text-amber-300 animate-pulse'
										: 'bg-emerald-600/20 hover:bg-emerald-600/35 border-emerald-500/40 text-emerald-300'}`}
									title='Automatically fix this issue using Kodia AI Chat'
								>
									<Zap size={10} /> {pendingFixSet.has(f.id) ? 'Fixing with AI...' : 'Fix with AI'}
								</button>
							)}
						</div>
					</div>
				);
			})}
			{list.length === 0 && (
				<div className='p-6 rounded-lg border border-dashed border-void-border-2 text-center text-xs text-void-fg-3'>
					{emptyText}
				</div>
			)}
		</div>
	);

	const renderCentralContent = () => {
		switch (activeSection) {
			case 'overview':
				return (
					<div className='flex flex-col gap-4'>
						{!session ? (
							<div className='p-6 rounded-xl border border-void-border-2 bg-void-bg-1 flex flex-col gap-4 shadow-sm'>
								<div className='flex items-start gap-3'>
									<div className='w-10 h-10 rounded-lg bg-sky-500/15 border border-sky-500/30 flex items-center justify-center shrink-0'>
										<Shield size={20} className='text-sky-400' />
									</div>
									<div className='flex flex-col gap-1'>
										<div className='text-base font-semibold text-void-fg-1'>Kodia Autonomous Code Review &amp; Software Assurance Engine (KACRAE)</div>
										<div className='text-xs text-void-fg-2 leading-relaxed max-w-3xl'>
											Inspect technical correctness, multi-tenant isolation, concurrency races, security attack paths, functional completeness (dead UI buttons, stubbed APIs &amp; broken flows), database migrations, OpenAPI contracts, architecture topology, and test quality.
										</div>
									</div>
								</div>
								<div className='flex flex-wrap gap-2 pt-1'>
									<button type='button' onClick={() => void runReview('modified_files', 'standard')} className='px-3.5 py-2 rounded-md bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium cursor-pointer transition-colors flex items-center gap-1.5 shadow-xs'>
										<Play size={12} /> Start Standard Change Review
									</button>
									<button type='button' onClick={() => void runReview('entire_project', 'deep')} className='px-3.5 py-2 rounded-md bg-void-bg-2 hover:bg-void-bg-3 border border-void-border-2 text-void-fg-1 text-xs font-medium cursor-pointer transition-colors flex items-center gap-1.5'>
										<Layers size={12} className='text-sky-400' /> Start Full Project Deep Review
									</button>
									<button type='button' onClick={() => void runReview('entire_project', 'security')} className='px-3.5 py-2 rounded-md bg-void-bg-2 hover:bg-void-bg-3 border border-void-border-2 text-void-fg-1 text-xs font-medium cursor-pointer transition-colors flex items-center gap-1.5'>
										<Lock size={12} className='text-amber-400' /> Start Security Intelligence Scan
									</button>
									<button type='button' onClick={() => codeReviewService.setActiveSection('functional_completeness')} className='px-3.5 py-2 rounded-md bg-void-bg-2 hover:bg-void-bg-3 border border-void-border-2 text-void-fg-1 text-xs font-medium cursor-pointer transition-colors flex items-center gap-1.5'>
										<CheckCircle2 size={12} className='text-emerald-400' /> Functional Completeness Audit
									</button>
								</div>
							</div>
						) : (
							<>
								<div className='grid grid-cols-2 lg:grid-cols-5 gap-2.5'>
									<div className='p-3 rounded-md border border-void-border-2 bg-void-bg-1'>
										<div className='text-[10px] uppercase text-void-fg-3'>Health Index</div>
										<div className='text-xl font-bold text-void-fg-1'>{session.healthScore.score}/100</div>
										<div className='text-[10px] text-void-fg-3'>{session.partialScan ? 'Partial scope' : 'Full scope'}</div>
									</div>
									<div className='p-3 rounded-md border border-void-border-2 bg-void-bg-1'>
										<div className='text-[10px] uppercase text-void-fg-3'>Critical / High</div>
										<div className='text-xl font-bold text-red-400'>{session.counts.critical} / {session.counts.high}</div>
										<div className='text-[10px] text-void-fg-3'>{session.counts.confirmed} confirmed</div>
									</div>
									<div className='p-3 rounded-md border border-void-border-2 bg-void-bg-1'>
										<div className='text-[10px] uppercase text-void-fg-3'>Attack Paths</div>
										<div className='text-xl font-bold text-orange-400'>{session.attackPaths.length}</div>
										<div className='text-[10px] text-void-fg-3'>{session.databaseReport.tenantIsolationRisks} tenant risks</div>
									</div>
									<div className='p-3 rounded-md border border-void-border-2 bg-void-bg-1'>
										<div className='text-[10px] uppercase text-void-fg-3'>Verified Fixed</div>
										<div className='text-xl font-bold text-emerald-400'>{session.counts.resolved}</div>
										<div className='text-[10px] text-void-fg-3'>{session.counts.suppressed} suppressed</div>
									</div>
									<div className='p-3 rounded-md border border-void-border-2 bg-void-bg-1'>
										<div className='text-[10px] uppercase text-void-fg-3'>Readiness</div>
										<div className='text-xs font-bold text-void-fg-1 mt-1'>{session.readiness.verdict.replace(/_/g, ' ')}</div>
										<div className='text-[10px] text-void-fg-3'>{session.filesAnalyzedCount} files · {session.durationMs}ms</div>
									</div>
								</div>

								<div className='p-3 rounded-md border border-void-border-2 bg-void-bg-1 text-xs'>
									<div className='font-semibold text-void-fg-1 mb-1'>Documented Health Methodology &amp; Evidence Boundaries</div>
									<div className='text-void-fg-2 mb-2'>{session.healthScore.methodology}</div>
									<div className='grid grid-cols-1 md:grid-cols-4 gap-2'>
										{session.healthScore.components.map(c => (
											<div key={c.dimension} className='p-2 rounded bg-void-bg-2 border border-void-border-2'>
												<div className='flex justify-between font-medium'><span>{c.dimension}</span><span>{c.score}/100 ({c.weightPct}%)</span></div>
												<div className='text-[10px] text-void-fg-3 mt-0.5'>{c.basis}</div>
												{c.missingData && <div className='text-[10px] text-amber-400 mt-0.5'>Missing: {c.missingData}</div>}
											</div>
										))}
									</div>
									<div className='text-[11px] text-void-fg-3 mt-2 italic'>{session.readiness.explicitDisclaimer}</div>
								</div>

								<QualityTrendChart sessions={state.sessions} />

								<div>
									<div className='text-xs font-semibold text-void-fg-1 mb-2'>Highest Priority Findings</div>
									{renderFindingTable(session.findings.slice(0, 12), 'No findings in active review session.')}
								</div>
							</>
						)}
					</div>
				);

			case 'current_review':
				return (
					<div className='flex flex-col gap-3'>
						<div className='flex flex-wrap items-center gap-2'>
							<div className='relative flex-1 min-w-[200px]'>
								<Search size={12} className='absolute left-2.5 top-2 text-void-fg-3' />
								<input
									type='text'
									value={searchQuery}
									onChange={e => setSearchQuery(e.target.value)}
									placeholder='Search findings by file, rule ID, title, or category...'
									className='w-full pl-7 pr-2.5 py-1.5 rounded bg-void-bg-1 border border-void-border-2 text-xs text-void-fg-1'
								/>
							</div>
							<select value={sevFilter} onChange={e => setSevFilter(e.target.value)} className='px-2.5 py-1.5 rounded bg-void-bg-1 border border-void-border-2 text-xs text-void-fg-1'>
								<option value='all'>All Severities ({session?.findings.length ?? 0})</option>
								<option value='critical'>Critical</option>
								<option value='high'>High</option>
								<option value='medium'>Medium</option>
								<option value='low'>Low</option>
							</select>
						</div>
						{renderFindingTable(filteredFindings, 'No findings match the current filter. Start a review or widen your filter.')}
					</div>
				);

			case 'change_review':
				return (
					<div className='flex flex-col gap-3'>
						<div className='p-3 rounded-md border border-void-border-2 bg-void-bg-1 flex flex-wrap items-center gap-2'>
							<span className='text-xs font-semibold'>Git Change Review Scopes:</span>
							<button onClick={() => void runReview('git_unstaged', 'standard')} className='px-2.5 py-1 rounded bg-blue-600 text-white text-xs'>Review Unstaged Changes</button>
							<button onClick={() => void runReview('git_staged', 'standard')} className='px-2.5 py-1 rounded bg-void-bg-2 border border-void-border-2 text-xs'>Review Staged Changes</button>
							<button onClick={() => void runReview('latest_commit', 'standard')} className='px-2.5 py-1 rounded bg-void-bg-2 border border-void-border-2 text-xs'>Review Latest Commit</button>
							{session?.gitBranch && <span className='text-xs text-void-fg-3 ml-auto font-mono'>Branch: {session.gitBranch} ({session.gitRevision})</span>}
						</div>
						{renderFindingTable(filteredFindings, 'Run a staged, unstaged, or commit review to inspect Git change findings.')}
					</div>
				);

			case 'full_project_review':
				return (
					<div className='flex flex-col gap-3'>
						<div className='p-3 rounded-md border border-void-border-2 bg-void-bg-1 flex flex-col gap-2'>
							<div className='flex flex-wrap items-center justify-between gap-2'>
								<div>
									<div className='text-xs font-semibold'>Enterprise-Scale Incremental Repository Intelligence</div>
									<div className='text-[11px] text-void-fg-3'>Streaming disk-backed sharded indexing with SHA-256 fingerprinting and bounded concurrency.</div>
								</div>
								<div className='flex gap-2'>
									<button onClick={() => void codeReviewService.indexRepository({ incremental: true })} className='px-2.5 py-1 rounded bg-void-bg-2 border border-void-border-2 text-xs'>Incremental Re-Index</button>
									<button onClick={() => void runReview('entire_project', 'deep')} className='px-2.5 py-1 rounded bg-blue-600 text-white text-xs'>Run Full Project Deep Review</button>
								</div>
							</div>
							{state.latestIndexStats && (
								<div className='grid grid-cols-2 md:grid-cols-5 gap-2 pt-2 text-xs'>
									<div className='p-2 rounded bg-void-bg-2'>Discovered: <strong>{state.latestIndexStats.totalDiscoveredFiles}</strong></div>
									<div className='p-2 rounded bg-void-bg-2'>Re-indexed: <strong>{state.latestIndexStats.indexedFiles}</strong></div>
									<div className='p-2 rounded bg-void-bg-2'>Cached Skipped: <strong>{state.latestIndexStats.unchangedCachedFiles}</strong></div>
									<div className='p-2 rounded bg-void-bg-2'>Throughput: <strong>{state.latestIndexStats.throughputFilesPerSec} f/s</strong></div>
									<div className='p-2 rounded bg-void-bg-2'>Peak Heap: <strong>{state.latestIndexStats.peakHeapMb} MB</strong></div>
								</div>
							)}
						</div>
						{renderFindingTable(filteredFindings, 'Run Full Project Deep Review to inspect repository-wide findings.')}
					</div>
				);

			case 'pull_request_review':
				return (
					<div className='flex flex-col gap-3'>
						<div className='p-3 rounded-md border border-void-border-2 bg-void-bg-1 flex flex-wrap items-center gap-2 text-xs'>
							<span>Base Ref:</span>
							<input value={gitBaseRef} onChange={e => setGitBaseRef(e.target.value)} className='px-2 py-1 rounded bg-void-bg-2 border border-void-border-2 w-28 font-mono' />
							<span>Head Ref:</span>
							<input value={gitHeadRef} onChange={e => setGitHeadRef(e.target.value)} className='px-2 py-1 rounded bg-void-bg-2 border border-void-border-2 w-28 font-mono' />
							<button onClick={() => void runReview('pull_request', 'deep')} className='px-3 py-1 rounded bg-blue-600 text-white font-medium'>Review Branch / PR Diff</button>
						</div>
						{renderFindingTable(filteredFindings, 'Specify base and head Git references (e.g. main vs HEAD) to run a Pull Request review locally without requiring GitHub.')}
					</div>
				);

			case 'security_intelligence':
				return (
					<div className='flex flex-col gap-4'>
						<div className='flex items-center justify-between'>
							<div className='text-xs font-semibold'>Security Attack-Path Analysis &amp; Vulnerability Intelligence</div>
							<button onClick={() => void runReview(scope, 'security')} className='px-2.5 py-1 rounded bg-blue-600 text-white text-xs'>Run Dedicated Security Review</button>
						</div>
						<AttackPathVisualizer paths={session?.attackPaths ?? []} onOpenFile={(f, l) => void codeReviewService.openFindingInEditor(f, l)} />
						{renderFindingTable((session?.findings ?? []).filter(f => f.category === 'security' || f.category === 'tenant_isolation' || f.category === 'secrets' || f.category === 'prompt_injection'), 'No security, secret, or tenant-isolation findings in current session.')}
					</div>
				);

			case 'architecture_intelligence':
				return (
					<div className='flex flex-col gap-4'>
						{state.latestGraph ? (
							<>
								<DependencyGraphCanvas
									graph={state.latestGraph}
									blastRadius={state.latestBlastRadius}
									onOpenFile={f => void codeReviewService.openFindingInEditor(f, 1)}
									onQueryBlastRadius={f => void codeReviewService.queryGraph('blast_radius', f)}
								/>
								{state.latestBlastRadius && (
									<div className='p-3 rounded-md border border-void-border-2 bg-void-bg-1 text-xs'>
										<div className='font-semibold text-void-fg-1'>Blast-Radius Report: {state.latestBlastRadius.target} ({state.latestBlastRadius.riskLevel.toUpperCase()})</div>
										<div className='text-void-fg-2 mt-1'>{state.latestBlastRadius.summary}</div>
									</div>
								)}
								<div className='grid grid-cols-1 md:grid-cols-2 gap-3 text-xs'>
									<div className='p-3 rounded-md border border-void-border-2 bg-void-bg-1'>
										<div className='font-semibold mb-1'>Circular Dependencies ({state.latestGraph.topology.cycles.length})</div>
										{state.latestGraph.topology.cycles.map((c, i) => (
											<div key={i} className='font-mono text-[11px] text-amber-400 py-0.5'>{c.join(' → ')} → {c[0]}</div>
										))}
										{state.latestGraph.topology.cycles.length === 0 && <div className='text-void-fg-3'>None detected.</div>}
									</div>
									<div className='p-3 rounded-md border border-void-border-2 bg-void-bg-1'>
										<div className='font-semibold mb-1'>Layering Violations ({state.latestGraph.topology.layeringViolations.length})</div>
										{state.latestGraph.topology.layeringViolations.map((v, i) => (
											<div key={i} className='text-[11px] text-red-400 py-0.5'>{v.from} → {v.to}: {v.reason}</div>
										))}
										{state.latestGraph.topology.layeringViolations.length === 0 && <div className='text-void-fg-3'>None detected.</div>}
									</div>
								</div>
							</>
						) : (
							<div className='p-6 rounded-md border border-dashed border-void-border-2 text-center text-xs text-void-fg-3'>
								Index the repository to build the interactive dependency graph and architecture topology map.
								<div className='mt-2'><button onClick={() => void codeReviewService.indexRepository({ incremental: true })} className='px-3 py-1 rounded bg-blue-600 text-white'>Index Repository Now</button></div>
							</div>
						)}
					</div>
				);

			case 'correctness_analysis':
				return (
					<div className='flex flex-col gap-4'>
						<div className='text-xs font-semibold'>Adversarial Counterexamples ({session?.adversarialChallenges.length ?? 0})</div>
						{(session?.adversarialChallenges ?? []).map(ch => (
							<div key={ch.id} className='p-3 rounded-md border border-void-border-2 bg-void-bg-1 text-xs'>
								<div className='flex items-center justify-between'>
									<span className='font-semibold text-void-fg-1'>{ch.hypothesis}</span>
									<span className='text-[10px] font-mono text-blue-400 cursor-pointer' onClick={() => void codeReviewService.openFindingInEditor(ch.targetFile, ch.line)}>{ch.targetFile}:{ch.line}</span>
								</div>
								<div className='text-void-fg-2 mt-1'>Counterexample: <code className='bg-void-bg-2 px-1 rounded'>{ch.counterexampleInput}</code></div>
								<div className='text-void-fg-3 mt-0.5'>Risk: {ch.observedOrRiskBehavior}</div>
								<pre className='mt-2 p-2 rounded bg-void-bg-2 text-[11px] overflow-x-auto'>{ch.executableTestSnippet}</pre>
							</div>
						))}
						{renderFindingTable((session?.findings ?? []).filter(f => f.category === 'correctness' || f.category === 'business_logic' || f.category === 'concurrency'), 'No correctness, business-logic, or concurrency findings in current session.')}
					</div>
				);

			case 'functional_completeness': {
				const fc = liveFcReport ?? session?.functionalCompleteness;
				return (
					<div className='flex flex-col gap-3 text-xs'>
						<div className='p-3 rounded-md border border-void-border-2 bg-void-bg-1 flex flex-wrap items-center gap-2'>
							<span className='font-semibold'>Functional Completeness &amp; Static-UI Verification</span>
							<input
								value={fcAppUrl}
								onChange={e => setFcAppUrl(e.target.value)}
								placeholder='Optional live app URL (e.g. http://localhost:3000) for browser + API verification'
								className='flex-1 min-w-[240px] px-2 py-1 rounded bg-void-bg-2 border border-void-border-2 text-xs'
							/>
							<button
								onClick={async () => {
									setStatusMsg('Running Functional Completeness verification...');
									const rep = await codeReviewService.verifyFunctionalCompleteness({ appUrl: fcAppUrl.trim() || undefined, useBrowser: Boolean(fcAppUrl.trim()) });
									setLiveFcReport(rep);
									setStatusMsg(rep.summary);
								}}
								className='px-3 py-1 rounded bg-blue-600 text-white font-medium'
							>
								Verify Completeness
							</button>
						</div>
						{fc ? (
							<>
								<div className='grid grid-cols-3 md:grid-cols-6 gap-2 text-center'>
									<div className='p-2 rounded bg-emerald-500/15 text-emerald-400'><strong>{fc.counts.complete}</strong><div className='text-[10px]'>Complete</div></div>
									<div className='p-2 rounded bg-yellow-500/15 text-yellow-400'><strong>{fc.counts.partially_implemented}</strong><div className='text-[10px]'>Partial</div></div>
									<div className='p-2 rounded bg-orange-500/15 text-orange-400'><strong>{fc.counts.placeholder}</strong><div className='text-[10px]'>Placeholder</div></div>
									<div className='p-2 rounded bg-red-500/15 text-red-400'><strong>{fc.counts.nonfunctional}</strong><div className='text-[10px]'>Nonfunctional</div></div>
									<div className='p-2 rounded bg-red-600/20 text-red-300'><strong>{fc.counts.broken}</strong><div className='text-[10px]'>Broken</div></div>
									<div className='p-2 rounded bg-void-bg-2 text-void-fg-3'><strong>{fc.counts.unverified}</strong><div className='text-[10px]'>Unverified</div></div>
								</div>
								<div className='text-void-fg-2'>{fc.summary}</div>
								<div className='overflow-x-auto rounded border border-void-border-2'>
									<table className='w-full text-left border-collapse text-[11px]'>
										<thead className='bg-void-bg-2 text-void-fg-2'>
											<tr>
												<th className='p-2 border-b border-void-border-2'>Feature &amp; Expected Behavior</th>
												<th className='p-2 border-b border-void-border-2'>Sources / UI / Backend</th>
												<th className='p-2 border-b border-void-border-2'>Method &amp; Evidence</th>
												<th className='p-2 border-b border-void-border-2'>Status</th>
												<th className='p-2 border-b border-void-border-2'>Remediation</th>
											</tr>
										</thead>
										<tbody>
											{fc.matrix.map(row => (
												<tr key={row.id} className='border-b border-void-border-2 bg-void-bg-1'>
													<td className='p-2 align-top'><div className='font-semibold text-void-fg-1'>{row.feature}</div><div className='text-void-fg-3'>{row.expectedBehavior}</div></td>
													<td className='p-2 align-top font-mono text-[10px]'>
														{row.sourceFiles.map(sf => (
															<div key={sf} className='text-blue-400 cursor-pointer hover:underline' onClick={() => void codeReviewService.openFindingInEditor(sf, 1)}>{sf}</div>
														))}
														{row.backendDependencies.map(bd => <div key={bd} className='text-void-fg-3'>{bd}</div>)}
													</td>
													<td className='p-2 align-top'>
														<div className='font-medium'>{row.verificationMethod} ({row.certainty})</div>
														<div className='text-void-fg-3'>{row.testResults}</div>
													</td>
													<td className='p-2 align-top font-semibold uppercase'>{row.status.replace(/_/g, ' ')}</td>
													<td className='p-2 align-top text-void-fg-2'>{row.remediation}</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							</>
						) : (
							<div className='p-6 rounded border border-dashed border-void-border-2 text-center text-void-fg-3'>
								Run a review or click "Verify Completeness" above to build the Functional Completeness Matrix.
							</div>
						)}
					</div>
				);
			}

			case 'performance_analysis':
				return (
					<div className='flex flex-col gap-3 text-xs'>
						<div className='p-3 rounded-md border border-void-border-2 bg-void-bg-1'>
							<div className='font-semibold mb-1'>Measured Telemetry vs Theoretical Static Risks</div>
							<div className='text-void-fg-3 mb-2'>{session?.performanceReport.disclaimer ?? 'Static observations are never presented as measured runtime bottlenecks.'}</div>
							<div className='grid grid-cols-3 gap-2'>
								{(session?.performanceReport.measuredMetrics ?? []).map(m => (
									<div key={m.label} className='p-2 rounded bg-void-bg-2 border border-void-border-2'>
										<div className='text-[10px] text-void-fg-3'>{m.label}</div>
										<div className='text-sm font-bold'>{m.value} <span className='text-[10px] font-normal'>{m.unit}</span></div>
									</div>
								))}
							</div>
						</div>
						{(session?.performanceReport.observations ?? []).map(obs => (
							<div key={obs.id} className='p-2.5 rounded-md border border-void-border-2 bg-void-bg-1'>
								<div className='flex justify-between'><span className='font-semibold'>{obs.title}</span><span className='text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400'>{obs.kind}</span></div>
								<div className='text-void-fg-2 mt-1'>{obs.detail}</div>
								<div className='text-void-fg-3 mt-0.5'>Remediation: {obs.remediation}</div>
							</div>
						))}
					</div>
				);

			case 'test_intelligence':
				return (
					<div className='flex flex-col gap-3 text-xs'>
						<div className='grid grid-cols-3 gap-2'>
							<div className='p-2.5 rounded bg-void-bg-1 border border-void-border-2'>Test Files: <strong>{session?.testReport.testFilesCount ?? 0}</strong></div>
							<div className='p-2.5 rounded bg-void-bg-1 border border-void-border-2'>Untested Critical Modules: <strong>{session?.testReport.untestedCriticalFiles.length ?? 0}</strong></div>
							<div className='p-2.5 rounded bg-void-bg-1 border border-void-border-2'>Weak/Tautological Tests: <strong>{session?.testReport.weakOrTautologicalTests.length ?? 0}</strong></div>
						</div>
						{(session?.testReport.generatedTests ?? []).map(gt => (
							<div key={gt.id} className='p-3 rounded-md border border-void-border-2 bg-void-bg-1'>
								<div className='flex items-center justify-between'>
									<span className='font-semibold'>{gt.targetFile} → {gt.suggestedTestPath}</span>
									<span className='text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400'>{gt.testKind} · {gt.framework}</span>
								</div>
								<div className='text-void-fg-3 mt-1'>{gt.rationale}</div>
								<pre className='mt-2 p-2 rounded bg-void-bg-2 text-[11px] overflow-x-auto'>{gt.testCode}</pre>
							</div>
						))}
					</div>
				);

			case 'database_review':
				return (
					<div className='flex flex-col gap-3 text-xs'>
						<div className='grid grid-cols-2 md:grid-cols-4 gap-2'>
							<div className='p-2.5 rounded bg-void-bg-1 border border-void-border-2'>DBs Detected: <strong>{session?.databaseReport.databasesDetected.join(', ') || 'None'}</strong></div>
							<div className='p-2.5 rounded bg-void-bg-1 border border-void-border-2'>Destructive Migrations: <strong className='text-red-400'>{session?.databaseReport.destructiveMigrations ?? 0}</strong></div>
							<div className='p-2.5 rounded bg-void-bg-1 border border-void-border-2'>Locking Migrations: <strong className='text-orange-400'>{session?.databaseReport.lockingMigrations ?? 0}</strong></div>
							<div className='p-2.5 rounded bg-void-bg-1 border border-void-border-2'>N+1 Query Risks: <strong className='text-yellow-400'>{session?.databaseReport.nPlusOneRisks ?? 0}</strong></div>
						</div>
						{renderFindingTable(session?.databaseReport.findings ?? [], 'No database or migration safety issues detected in current session.')}
					</div>
				);

			case 'api_contract_review':
				return (
					<div className='flex flex-col gap-3 text-xs'>
						<div className='grid grid-cols-3 gap-2'>
							<div className='p-2.5 rounded bg-void-bg-1 border border-void-border-2'>Protocols: <strong>{session?.apiContractReport.protocolsDetected.join(', ') || 'None'}</strong></div>
							<div className='p-2.5 rounded bg-void-bg-1 border border-void-border-2'>Spec Endpoints: <strong>{session?.apiContractReport.specEndpoints.length ?? 0}</strong></div>
							<div className='p-2.5 rounded bg-void-bg-1 border border-void-border-2'>Implemented: <strong>{session?.apiContractReport.implementedEndpoints.length ?? 0}</strong></div>
						</div>
						{renderFindingTable(session?.apiContractReport.findings ?? [], 'No OpenAPI / route contract mismatches detected in current session.')}
					</div>
				);

			case 'compliance_governance':
				return (
					<div className='flex flex-col gap-3 text-xs'>
						<div className='p-3 rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-200'>
							{session?.complianceReport.disclaimer ?? 'Automated evidence mapping supports governance audits and never substitutes for independent formal certification.'}
						</div>
						<div className='grid grid-cols-1 md:grid-cols-2 gap-2'>
							{(session?.complianceReport.controls ?? []).map(c => (
								<div key={`${c.framework}-${c.controlId}`} className='p-2.5 rounded border border-void-border-2 bg-void-bg-1'>
									<div className='flex justify-between font-semibold'>
										<span>{c.framework} · {c.controlId}</span>
										<span className={c.status === 'evidence_present' ? 'text-emerald-400' : 'text-red-400'}>{c.status.replace(/_/g, ' ')}</span>
									</div>
									<div className='text-void-fg-1 mt-0.5'>{c.controlTitle}</div>
									<div className='text-void-fg-3 mt-0.5'>{c.evidenceSummary}</div>
								</div>
							))}
						</div>
						{session?.traceability && (
							<div className='p-3 rounded-md border border-void-border-2 bg-void-bg-1'>
								<div className='font-semibold mb-2'>Requirements &amp; Acceptance Traceability ({session.traceability.coveredAndTested}/{session.traceability.totalRequirements} covered &amp; tested)</div>
								{session.traceability.links.map(l => (
									<div key={l.requirement.id} className='py-1.5 border-t border-void-border-2 flex justify-between gap-2'>
										<div><strong>{l.requirement.id}</strong>: {l.requirement.title}</div>
										<span className='text-[10px] uppercase font-semibold'>{l.status}</span>
									</div>
								))}
							</div>
						)}
					</div>
				);

			case 'review_history':
				return (
					<div className='flex flex-col gap-2 text-xs'>
						{state.sessions.map(s => (
							<div
								key={s.id}
								onClick={() => { codeReviewService.setActiveSession(s.id); codeReviewService.setActiveSection('current_review'); }}
								className={`p-3 rounded-md border cursor-pointer ${s.id === session?.id ? 'border-blue-500 bg-void-bg-2' : 'border-void-border-2 bg-void-bg-1'}`}
							>
								<div className='flex justify-between font-semibold'>
									<span>{s.title}</span>
									<span className='text-void-fg-3'>{new Date(s.createdAt).toLocaleString()}</span>
								</div>
								<div className='text-void-fg-2 mt-1'>{s.summary}</div>
							</div>
						))}
						{state.sessions.length === 0 && <div className='text-void-fg-3'>No persisted review history yet.</div>}
					</div>
				);

			case 'review_reports':
				return (
					<div className='flex flex-col gap-3 text-xs'>
						<div className='p-4 rounded-md border border-void-border-2 bg-void-bg-1 flex flex-col gap-3'>
							<div className='font-semibold text-sm'>Visual Report Designer &amp; Evidence Exporter</div>
							<div className='flex flex-wrap gap-3'>
								<select value={reportType} onChange={e => setReportType(e.target.value as KacraeExportReportRequest['reportType'])} className='px-2.5 py-1.5 rounded bg-void-bg-2 border border-void-border-2'>
									<option value='executive'>Executive Summary</option>
									<option value='technical'>Technical Engineering Report</option>
									<option value='security'>Security Assurance Report</option>
									<option value='architecture'>Architecture Report</option>
									<option value='compliance'>Compliance Evidence Package</option>
									<option value='release_readiness'>Release Readiness Assessment</option>
								</select>
								<select value={reportFormat} onChange={e => setReportFormat(e.target.value as KacraeExportReportRequest['format'])} className='px-2.5 py-1.5 rounded bg-void-bg-2 border border-void-border-2'>
									<option value='html'>HTML Interactive Report</option>
									<option value='pdf_html'>Print-Ready PDF HTML</option>
									<option value='markdown'>Markdown (.md)</option>
									<option value='json'>Structured JSON</option>
									<option value='sarif'>SARIF 2.1.0</option>
								</select>
								<button
									disabled={!session}
									onClick={async () => {
										if (!session) { return; }
										const res = await codeReviewService.exportReport({ sessionId: session.id, format: reportFormat, reportType });
										setLastExportPath(`${res.filePath} (${res.bytes} bytes)`);
									}}
									className='px-3 py-1.5 rounded bg-blue-600 text-white font-medium disabled:opacity-50'
								>
									Export Report to Workspace
								</button>
							</div>
							{lastExportPath && <div className='text-emerald-400 font-mono text-[11px]'>Exported: {lastExportPath}</div>}
						</div>
					</div>
				);

			case 'coding_standards_rules':
				return (
					<div className='flex flex-col gap-3 text-xs'>
						<div className='p-3 rounded-md border border-void-border-2 bg-void-bg-1 flex flex-col gap-2'>
							<div className='font-semibold'>Create Custom Scoped Review Rule</div>
							<div className='grid grid-cols-1 md:grid-cols-3 gap-2'>
								<input value={newRuleName} onChange={e => setNewRuleName(e.target.value)} placeholder='Rule name (e.g. Forbid console.log)' className='px-2 py-1.5 rounded bg-void-bg-2 border border-void-border-2' />
								<input value={newRulePattern} onChange={e => setNewRulePattern(e.target.value)} placeholder='Regex pattern (e.g. console\.log\()' className='px-2 py-1.5 rounded bg-void-bg-2 border border-void-border-2 font-mono' />
								<select value={newRuleSeverity} onChange={e => setNewRuleSeverity(e.target.value as KacraeSeverity)} className='px-2 py-1.5 rounded bg-void-bg-2 border border-void-border-2'>
									<option value='critical'>Critical</option>
									<option value='high'>High</option>
									<option value='medium'>Medium</option>
									<option value='low'>Low</option>
								</select>
							</div>
							<input value={newRuleDesc} onChange={e => setNewRuleDesc(e.target.value)} placeholder='Description & remediation guidance' className='px-2 py-1.5 rounded bg-void-bg-2 border border-void-border-2' />
							<button
								onClick={async () => {
									if (!newRuleName.trim() || !newRulePattern.trim()) { return; }
									const rule: KacraeReviewRule = {
										id: `CUSTOM-${Date.now().toString(36).toUpperCase()}`,
										name: newRuleName.trim(),
										description: newRuleDesc.trim() || newRuleName.trim(),
										scope: 'repository',
										enabled: true,
										severity: newRuleSeverity,
										category: 'correctness',
										pattern: newRulePattern.trim(),
										remediation: newRuleDesc.trim() || 'Follow repository coding standard.',
										updatedAt: new Date().toISOString(),
									};
									await codeReviewService.manageRules({ action: 'upsert', rule });
									setNewRuleName(''); setNewRulePattern(''); setNewRuleDesc('');
								}}
								className='self-start px-3 py-1 rounded bg-blue-600 text-white font-medium'
							>
								Save Rule
							</button>
						</div>
						{state.rules.map(r => (
							<div key={r.id} className='p-2.5 rounded border border-void-border-2 bg-void-bg-1 flex items-center justify-between gap-2'>
								<div>
									<div className='font-semibold'>{r.name} <span className='font-mono text-[10px] text-void-fg-3'>({r.id})</span></div>
									<div className='font-mono text-[11px] text-void-fg-3'>/{r.pattern}/ · {r.severity} · {r.scope}</div>
								</div>
								<div className='flex gap-1.5'>
									<button onClick={() => void codeReviewService.manageRules({ action: 'toggle', ruleId: r.id })} className='px-2 py-1 rounded bg-void-bg-2 border border-void-border-2'>{r.enabled ? 'Disable' : 'Enable'}</button>
									<button onClick={() => void codeReviewService.manageRules({ action: 'delete', ruleId: r.id })} className='px-2 py-1 rounded bg-red-500/20 text-red-400 border border-red-500/40'>Delete</button>
								</div>
							</div>
						))}
					</div>
				);

			case 'ai_review_config':
				return (
					<div className='flex flex-col gap-3 text-xs'>
						<div className='p-3 rounded-md border border-void-border-2 bg-void-bg-1'>
							<div className='font-semibold mb-1'>Multi-Model Review Council Routing Plan</div>
							<div className='text-void-fg-3 mb-2'>{session?.councilPlan.fallbackNote ?? 'Deterministic static, security, architecture, and test engines always operate independently of AI provider status.'}</div>
							<div className='grid grid-cols-1 md:grid-cols-2 gap-2'>
								{(session?.councilPlan.assignments ?? []).map(a => (
									<div key={a.role} className='p-2 rounded bg-void-bg-2 border border-void-border-2'>
										<div className='flex justify-between font-semibold'>
											<span>{a.role.replace(/_/g, ' ')}</span>
											<span className='text-[10px] text-blue-400'>{a.tier.replace(/_/g, ' ')}</span>
										</div>
										<div className='text-[11px] text-void-fg-2'>{a.providerName ? `${a.providerName} / ${a.modelName}` : 'Deterministic Analyzers'}</div>
										<div className='text-[10px] text-void-fg-3'>{a.rationale}</div>
									</div>
								))}
							</div>
						</div>
					</div>
				);

			case 'provider_model_config':
				return (
					<div className='flex flex-col gap-3 text-xs'>
						<div className='flex items-center justify-between'>
							<div className='font-semibold'>Free &amp; Local Inference Setup Assistant (Ollama / LM Studio / vLLM)</div>
							<button onClick={() => void codeReviewService.refreshFromDisk()} className='px-2.5 py-1 rounded bg-void-bg-2 border border-void-border-2'>Re-Detect Local Runtimes</button>
						</div>
						{state.localRuntimes.map(rt => (
							<div key={rt.runtime} className='p-3 rounded-md border border-void-border-2 bg-void-bg-1'>
								<div className='flex items-center justify-between'>
									<span className='font-semibold uppercase'>{rt.runtime} ({rt.endpoint})</span>
									<span className={rt.reachable ? 'text-emerald-400 font-semibold' : 'text-void-fg-3'}>{rt.reachable ? 'REACHABLE' : rt.installed ? 'INSTALLED (STOPPED)' : 'NOT DETECTED'}</span>
								</div>
								<div className='text-void-fg-3 mt-1'>{rt.hardwareNote} · Recommended: <code className='bg-void-bg-2 px-1 rounded'>{rt.recommendedModel}</code></div>
								{rt.models.length > 0 && <div className='mt-1 text-void-fg-2'>Available models: {rt.models.map(m => m.name).join(', ')}</div>}
								<ul className='list-disc pl-4 mt-1 text-void-fg-3'>
									{rt.setupSteps.map((s, idx) => <li key={idx}>{s}</li>)}
								</ul>
							</div>
						))}
					</div>
				);

			case 'enterprise_admin':
				return (
					<div className='flex flex-col gap-3 text-xs'>
						<div className='p-3 rounded-md border border-void-border-2 bg-void-bg-1 flex items-center justify-between gap-2'>
							<div>
								<div className='font-semibold'>KACRAE Permanent Quality &amp; Large-Repository Benchmark</div>
								<div className='text-void-fg-3'>Measures real precision, recall, false-positive rate, latency, and incremental indexing throughput on controlled corpora.</div>
							</div>
							<button onClick={() => void codeReviewService.runQualityBenchmark(400)} className='px-3 py-1.5 rounded bg-blue-600 text-white font-medium'>Run Benchmark</button>
						</div>
						{state.latestBenchmark && (
							<div className='p-3 rounded-md border border-void-border-2 bg-void-bg-1'>
								<div className='grid grid-cols-2 md:grid-cols-5 gap-2 mb-2'>
									<div className='p-2 rounded bg-void-bg-2'>Precision: <strong>{Math.round(state.latestBenchmark.precision * 100)}%</strong></div>
									<div className='p-2 rounded bg-void-bg-2'>Recall: <strong>{Math.round(state.latestBenchmark.recall * 100)}%</strong></div>
									<div className='p-2 rounded bg-void-bg-2'>FPR: <strong>{Math.round(state.latestBenchmark.falsePositiveRate * 100)}%</strong></div>
									<div className='p-2 rounded bg-void-bg-2'>F1: <strong>{Math.round(state.latestBenchmark.f1Score * 100)}%</strong></div>
									<div className='p-2 rounded bg-void-bg-2'>Avg Latency: <strong>{state.latestBenchmark.avgLatencyMs}ms</strong></div>
								</div>
								{state.latestBenchmark.scaleBenchmark && (
									<div className='text-void-fg-2'>
										Scale test ({state.latestBenchmark.scaleBenchmark.fileCount} files): Full index {state.latestBenchmark.scaleBenchmark.fullIndexMs}ms ({state.latestBenchmark.scaleBenchmark.throughputFilesPerSec} f/s), Incremental rescan {state.latestBenchmark.scaleBenchmark.incrementalRescanMs}ms ({state.latestBenchmark.scaleBenchmark.unchangedSkipped} unchanged skipped), Peak Heap {state.latestBenchmark.scaleBenchmark.peakHeapMb}MB.
									</div>
								)}
							</div>
						)}
						<div className='font-semibold'>Immutable Enterprise Audit Trail ({state.auditLog.length})</div>
						<div className='flex flex-col gap-1 max-h-64 overflow-y-auto'>
							{state.auditLog.slice(0, 30).map(a => (
								<div key={a.id} className='p-2 rounded bg-void-bg-1 border border-void-border-2'>
									<div className='flex justify-between text-[10px] text-void-fg-3'>
										<span>{a.action} · actor={a.actor} ({a.role})</span>
										<span>{new Date(a.timestamp).toLocaleString()}</span>
									</div>
									<div className='text-void-fg-1'>{a.detail}</div>
								</div>
							))}
						</div>
					</div>
				);

			case 'dependency_intelligence':
			case 'settings_diagnostics':
				return (
					<div className='flex flex-col gap-3 text-xs'>
						<div className='flex items-center justify-between'>
							<div className='font-semibold'>Installed Analysis Tool Adapters &amp; Diagnostics</div>
							<button onClick={() => void commandService.executeCommand('workbench.action.openVoidSettings')} className='px-2.5 py-1 rounded bg-void-bg-2 border border-void-border-2'>Open Kodia Code Review Settings</button>
						</div>
						<div className='grid grid-cols-1 md:grid-cols-2 gap-2'>
							{state.externalTools.map(t => (
								<div key={t.id} className='p-2.5 rounded border border-void-border-2 bg-void-bg-1 flex items-center justify-between gap-2'>
									<div>
										<div className='font-semibold'>{t.name}</div>
										<div className='text-[10px] text-void-fg-3'>{t.category} · License: {t.licenseNote}{t.version ? ` · ${t.version}` : ''}</div>
									</div>
									<span className={`text-[10px] font-semibold ${t.available ? 'text-emerald-400' : 'text-void-fg-3'}`}>{t.available ? 'AVAILABLE' : 'OPTIONAL'}</span>
								</div>
							))}
						</div>
					</div>
				);

			case 'technical_debt':
				return renderFindingTable((session?.findings ?? []).filter(f => f.severity === 'medium' || f.severity === 'low' || f.category === 'architecture' || f.category === 'technical_debt'), 'No technical debt findings in current session.');

			case 'review_automation':
				return (
					<div className='flex flex-col gap-3 text-xs'>
						<div className='p-3 rounded-md border border-void-border-2 bg-void-bg-1'>
							<div className='font-semibold mb-1'>Project Review Memory &amp; Continuous Learning ({state.memory.length})</div>
							<div className='text-void-fg-3 mb-2'>Strictly distinguishes verified repository facts, user-approved conventions, model suggestions, and unverified assumptions.</div>
							{state.memory.map(m => (
								<div key={m.id} className='p-2 rounded bg-void-bg-2 border border-void-border-2 mb-1.5 flex items-center justify-between gap-2'>
									<div>
										<div className='font-medium'>{m.topic} <span className='text-[10px] text-blue-400'>[{m.kind}]</span></div>
										<div className='text-void-fg-2'>{m.statement}</div>
									</div>
									<div className='flex gap-1'>
										{!m.approvedByUser && <button onClick={() => void codeReviewService.manageMemory({ action: 'approve', entryId: m.id })} className='px-2 py-0.5 rounded bg-emerald-600/30 text-emerald-300'>Approve</button>}
										<button onClick={() => void codeReviewService.manageMemory({ action: 'delete', entryId: m.id })} className='px-2 py-0.5 rounded bg-red-500/20 text-red-400'>Delete</button>
									</div>
								</div>
							))}
							{state.memory.length === 0 && <div className='text-void-fg-3'>No project review memory entries recorded yet.</div>}
						</div>
					</div>
				);

			default:
				return renderFindingTable(filteredFindings, 'No findings in this view.');
		}
	};

	return (
		<div className={`@@void-scope ${isDark ? 'dark' : ''}`} style={{ width: '100%', height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
		<div className='flex-1 min-h-0 flex flex-col w-full bg-void-bg-3 text-void-fg-1 overflow-hidden'>
			{/* Top Command Bar */}
			<div className='flex flex-wrap items-center gap-2 px-3.5 py-2.5 border-b border-void-border-2 bg-void-bg-2 text-xs shrink-0'>
				<div className='flex items-center gap-2 font-semibold mr-2'>
					<div className='w-6 h-6 rounded-md bg-sky-500/15 border border-sky-500/30 flex items-center justify-center'>
						<Shield size={14} className='text-sky-400' />
					</div>
					<span className='tracking-tight text-void-fg-1'>KACRAE</span>
					<span className='text-[11px] font-normal text-void-fg-3 hidden md:inline'>Autonomous Code Review &amp; Assurance</span>
				</div>

				<select value={scope} onChange={e => setScope(e.target.value as KacraeReviewScope)} className='px-2.5 py-1.5 rounded-md bg-void-bg-1 border border-void-border-2 text-void-fg-1 text-xs cursor-pointer focus:border-sky-500/70 focus:outline-none'>
					<option value='modified_files'>Modified Files</option>
					<option value='git_unstaged'>Git Unstaged</option>
					<option value='git_staged'>Git Staged</option>
					<option value='latest_commit'>Latest Commit</option>
					<option value='branch_comparison'>Branch Comparison</option>
					<option value='pull_request'>Pull Request</option>
					<option value='entire_project'>Entire Project</option>
					<option value='monorepo'>Monorepo</option>
				</select>

				<select value={depth} onChange={e => setDepth(e.target.value as KacraeReviewDepth)} className='px-2.5 py-1.5 rounded-md bg-void-bg-1 border border-void-border-2 text-void-fg-1 text-xs cursor-pointer focus:border-sky-500/70 focus:outline-none'>
					<option value='quick'>Quick Review</option>
					<option value='standard'>Standard Review</option>
					<option value='deep'>Deep Review</option>
					<option value='security'>Security Review</option>
					<option value='enterprise_assurance'>Enterprise Assurance</option>
				</select>

				{!state.isRunning ? (
					<button type='button' onClick={() => void runReview()} className='px-3 py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 text-white font-medium flex items-center gap-1.5 cursor-pointer transition-colors shadow-xs'>
						<Play size={12} /> Start Review
					</button>
				) : (
					<div className='flex items-center gap-1.5'>
						<span className='text-sky-400 font-medium'>{state.activePhase} ({state.progressPct}%)</span>
						<button type='button' onClick={() => void codeReviewService.pauseActiveReview()} className='p-1.5 rounded-md bg-void-bg-1 hover:bg-void-bg-3 border border-void-border-2 text-void-fg-1 cursor-pointer' title='Pause'><Pause size={12} /></button>
						<button type='button' onClick={() => void codeReviewService.resumeActiveReview()} className='p-1.5 rounded-md bg-void-bg-1 hover:bg-void-bg-3 border border-void-border-2 text-void-fg-1 cursor-pointer' title='Resume'><Play size={12} /></button>
						<button type='button' onClick={() => void codeReviewService.cancelActiveReview()} className='p-1.5 rounded-md bg-red-500/15 hover:bg-red-500/25 text-red-400 border border-red-500/35 cursor-pointer' title='Cancel'><Square size={12} /></button>
					</div>
				)}

				<button type='button' onClick={() => void codeReviewService.refreshFromDisk()} className='p-1.5 rounded-md bg-void-bg-1 hover:bg-void-bg-3 border border-void-border-2 text-void-fg-2 hover:text-void-fg-1 cursor-pointer transition-colors' title='Refresh'>
					<RefreshCw size={12} />
				</button>

				<div className='ml-auto flex items-center gap-1'>
					<button type='button' onClick={() => setShowLeft(v => !v)} className={`p-1.5 rounded-md border cursor-pointer transition-colors ${showLeft ? 'bg-sky-500/15 border-sky-500/50 text-sky-300' : 'bg-void-bg-1 border-void-border-2 text-void-fg-3 hover:text-void-fg-1'}`} title='Toggle Left Navigation'><PanelLeft size={13} /></button>
					<button type='button' onClick={() => setShowRight(v => !v)} className={`p-1.5 rounded-md border cursor-pointer transition-colors ${showRight ? 'bg-sky-500/15 border-sky-500/50 text-sky-300' : 'bg-void-bg-1 border-void-border-2 text-void-fg-3 hover:text-void-fg-1'}`} title='Toggle Finding Inspector'><PanelRight size={13} /></button>
					<button type='button' onClick={() => setShowBottom(v => !v)} className={`p-1.5 rounded-md border cursor-pointer transition-colors ${showBottom ? 'bg-sky-500/15 border-sky-500/50 text-sky-300' : 'bg-void-bg-1 border-void-border-2 text-void-fg-3 hover:text-void-fg-1'}`} title='Toggle Activity Region'><PanelBottom size={13} /></button>
				</div>
			</div>

			{statusMsg && (
				<div className='px-3 py-1 bg-void-bg-1 border-b border-void-border-2 text-[11px] text-void-fg-2 flex justify-between'>
					<span>{statusMsg}</span>
					<button onClick={() => setStatusMsg(null)} className='text-void-fg-3 hover:underline'>Dismiss</button>
				</div>
			)}

			{/* Main Multi-Region Body */}
			<div className='flex flex-1 min-h-0 overflow-hidden' style={{ minHeight: 0 }}>
				{/* Left Navigation */}
				{showLeft && (
					<div className='w-52 shrink-0 min-h-0 border-r border-void-border-2 bg-void-bg-2 p-2 flex flex-col gap-2' style={{ minHeight: 0, overflowY: 'auto' }}>
						{(['Review', 'Intelligence', 'Assurance', 'Configure'] as const).map(grp => (
							<div key={grp} className='flex flex-col gap-0.5'>
								<div className='px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-void-fg-3'>{grp}</div>
								{NAV_ITEMS.filter(n => n.group === grp).map(item => (
									<button
										key={item.id}
										type='button'
										onClick={() => codeReviewService.setActiveSection(item.id)}
										className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-xs cursor-pointer transition-colors ${activeSection === item.id ? 'bg-sky-500/15 text-sky-300 border border-sky-500/35 font-medium' : 'text-void-fg-2 hover:text-void-fg-1 hover:bg-void-bg-1 border border-transparent'}`}
									>
										{item.icon}
										<span className='truncate'>{item.label}</span>
									</button>
								))}
							</div>
						))}
					</div>
				)}

				{/* Central Workspace */}
				<div className='flex-1 min-w-0 min-h-0 p-4 pb-10' style={{ minHeight: 0, overflowY: 'auto' }}>
					{renderCentralContent()}
				</div>

				{/* Right Inspection Area */}
				{showRight && (
					<div className='w-80 xl:w-96 shrink-0 min-h-0 border-l border-void-border-2 bg-void-bg-2 p-3.5 pb-12 flex flex-col gap-3 text-xs' style={{ minHeight: 0, overflowY: 'auto' }}>
						<div className='font-semibold text-void-fg-1 flex items-center justify-between pb-1.5 border-b border-void-border-2'>
							<span>Finding Inspector</span>
							{selectedFinding && <span className='text-[10px] font-mono text-void-fg-3'>{selectedFinding.ruleId}</span>}
						</div>

						{selectedFinding && session ? (
							<>
								<div className='flex flex-wrap gap-1.5'>
									<span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold uppercase ${SEV_BADGE[selectedFinding.severity]}`}>{selectedFinding.severity}</span>
									<span className='text-[10px] px-1.5 py-0.5 rounded bg-void-bg-1 border border-void-border-2'>{selectedFinding.classification.replace(/_/g, ' ')}</span>
									<span className='text-[10px] px-1.5 py-0.5 rounded bg-void-bg-1 border border-void-border-2'>{Math.round(selectedFinding.confidence * 100)}% conf</span>
									{selectedFinding.cwe && <span className='text-[10px] px-1.5 py-0.5 rounded bg-void-bg-1 border border-void-border-2'>{selectedFinding.cwe}</span>}
								</div>

								<div className='font-semibold text-sm text-void-fg-1 leading-snug'>{selectedFinding.title}</div>

								{/* Primary Action Row — Always Visible at Top of Inspector! */}
								<div className='flex flex-wrap gap-1.5'>
									{selectedFinding.lifecycle === 'verified_resolved' ? (
										<div className='flex-1 min-w-[140px] px-3 py-2 rounded-md bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 font-semibold flex items-center justify-center gap-1.5'>
											<CheckCircle2 size={13} /> Verified Fixed
										</div>
									) : (
										<button
											type='button'
											disabled={pendingFixSet.has(selectedFinding.id)}
											onClick={() => fixFindingWithKodiaAI(selectedFinding)}
											className={`flex-1 min-w-[140px] px-3 py-2 rounded-md font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors shadow-xs ${pendingFixSet.has(selectedFinding.id)
												? 'bg-amber-600 text-white animate-pulse'
												: 'bg-emerald-600 hover:bg-emerald-500 text-white'}`}
										>
											<Zap size={13} /> {pendingFixSet.has(selectedFinding.id) ? 'Fixing with Kodia AI...' : 'Fix with Kodia AI'}
										</button>
									)}
									<button
										type='button'
										onClick={() => void codeReviewService.openFindingInEditor(selectedFinding.location.file, selectedFinding.location.startLine)}
										className='px-2.5 py-2 rounded-md bg-void-bg-1 hover:bg-void-bg-3 border border-void-border-2 text-void-fg-1 font-medium flex items-center gap-1 cursor-pointer transition-colors'
										title='Open this file at the exact line in editor'
									>
										<FileCode2 size={12} className='text-sky-400' /> Open File
									</button>
								</div>

								<button
									type='button'
									onClick={() => void codeReviewService.openFindingInEditor(selectedFinding.location.file, selectedFinding.location.startLine)}
									className='text-left font-mono text-[11px] text-sky-400 hover:underline flex items-center gap-1 cursor-pointer'
								>
									<FileCode2 size={12} className='shrink-0' /> <span className='truncate'>{selectedFinding.location.file}:{selectedFinding.location.startLine}</span>
								</button>

								<div className='p-2 rounded bg-void-bg-1 border border-void-border-2'>
									<div className='text-[10px] uppercase text-void-fg-3 mb-1'>Explanation &amp; Impact</div>
									<div className='text-void-fg-1'>{selectedFinding.explanation}</div>
									<div className='text-void-fg-2 mt-1'>{selectedFinding.whyItMatters}</div>
									<div className='text-void-fg-3 mt-1'>Impact: {selectedFinding.impact}</div>
								</div>

								<pre className='p-2 rounded bg-void-bg-1 border border-void-border-2 text-[11px] overflow-x-auto font-mono'>{selectedFinding.codeContext}</pre>

								{selectedFinding.evidence.length > 0 && (
									<div className='p-2 rounded bg-void-bg-1 border border-void-border-2'>
										<div className='text-[10px] uppercase text-void-fg-3 mb-1'>Evidence</div>
										<ul className='list-disc pl-4 text-[11px] text-void-fg-2'>
											{selectedFinding.evidence.map((e, i) => <li key={i}>{e}</li>)}
										</ul>
									</div>
								)}

								{selectedFinding.suggestedFix && (
									<div className='p-2 rounded bg-void-bg-1 border border-void-border-2 flex flex-col gap-1.5'>
										<div className='text-[10px] uppercase text-emerald-400 font-semibold'>Suggested Controlled Repair</div>
										<div className='text-void-fg-1'>{selectedFinding.suggestedFix.summary}</div>
										<pre className='p-1.5 rounded bg-void-bg-2 text-[10px] overflow-x-auto font-mono'>{selectedFinding.suggestedFix.diffPreview}</pre>
										<div className='flex gap-1.5'>
											<button
												onClick={async () => {
													const rec = await codeReviewService.proposeOrApplyRepair({ sessionId: session.id, findingId: selectedFinding.id, dryRun: true });
													setStatusMsg(`Proposed repair ${rec.id} for ${rec.file}`);
												}}
												className='px-2 py-1 rounded bg-void-bg-2 border border-void-border-2'
											>
												Preview Patch
											</button>
											<button
												onClick={async () => {
													const rec = await codeReviewService.proposeOrApplyRepair({ sessionId: session.id, findingId: selectedFinding.id, dryRun: false });
													setStatusMsg(`Repair ${rec.status} (${rec.independentVerdict ?? 'checked'})`);
												}}
												className='px-2 py-1 rounded bg-emerald-600 text-white font-medium'
											>
												Apply &amp; Verify Fix
											</button>
										</div>
									</div>
								)}

								{selectedFinding.verification && (
									<div className='p-2 rounded bg-emerald-500/10 border border-emerald-500/40'>
										<div className='font-semibold text-emerald-400'>Verification: {selectedFinding.verification.verdict}</div>
										<div className='text-[11px] text-void-fg-2 mt-0.5'>{selectedFinding.verification.outputSnippet}</div>
									</div>
								)}

								<div className='flex flex-col gap-1.5 border-t border-void-border-2 pt-2'>
									<button
										disabled={aiBusy}
										onClick={async () => {
											setAiBusy(true);
											try { setAiExplanation(await codeReviewService.runAiCouncilAnalysisOnFinding(selectedFinding)); }
											finally { setAiBusy(false); }
										}}
										className='px-2.5 py-1.5 rounded bg-void-bg-1 border border-void-border-2 hover:brightness-110 flex items-center justify-center gap-1.5'
									>
										<Bot size={12} /> {aiBusy ? 'Consulting AI Council...' : 'Investigate with AI Council'}
									</button>
									{aiExplanation && (
										<div className='p-2 rounded bg-void-bg-1 border border-void-border-2 text-[11px] whitespace-pre-wrap text-void-fg-2'>
											{aiExplanation}
										</div>
									)}
								</div>

								<div className='flex flex-col gap-1.5 border-t border-void-border-2 pt-2'>
									<div className='text-[10px] uppercase text-void-fg-3'>Lifecycle &amp; Suppression</div>
									<div className='flex flex-wrap gap-1'>
										<button onClick={() => void codeReviewService.updateFindingLifecycle(session.id, selectedFinding.id, 'confirmed', 'Confirmed by engineer')} className='px-2 py-0.5 rounded bg-void-bg-1 border border-void-border-2'>Confirm</button>
										<button onClick={() => void codeReviewService.updateFindingLifecycle(session.id, selectedFinding.id, 'investigating', 'Under investigation')} className='px-2 py-0.5 rounded bg-void-bg-1 border border-void-border-2'>Investigate</button>
										<button onClick={() => void codeReviewService.updateFindingLifecycle(session.id, selectedFinding.id, 'false_positive', 'Marked false positive')} className='px-2 py-0.5 rounded bg-void-bg-1 border border-void-border-2'>False Positive</button>
									</div>
									<div className='flex gap-1'>
										<input
											value={suppressReason}
											onChange={e => setSuppressReason(e.target.value)}
											placeholder='Suppression justification (required)...'
											className='flex-1 px-2 py-1 rounded bg-void-bg-1 border border-void-border-2 text-[11px]'
										/>
										<button
											disabled={!suppressReason.trim()}
											onClick={async () => {
												await codeReviewService.updateFindingLifecycle(session.id, selectedFinding.id, 'suppressed', suppressReason.trim());
												setSuppressReason('');
											}}
											className='px-2 py-1 rounded bg-void-bg-1 border border-void-border-2 disabled:opacity-40'
										>
											Suppress
										</button>
									</div>
								</div>
							</>
						) : (
							<div className='text-void-fg-3'>Select a finding to inspect full evidence, source context, attack paths, and controlled repair options.</div>
						)}
					</div>
				)}
			</div>

			{/* Bottom Activity Region */}
			{showBottom && (
				<div className='h-36 shrink-0 border-t border-void-border-2 bg-void-bg-1 flex flex-col text-xs'>
					<div className='px-3 py-1.5 border-b border-void-border-2 bg-void-bg-2 flex items-center justify-between text-[11px]'>
						<span className='font-semibold flex items-center gap-1.5 text-void-fg-1'><Activity size={12} className='text-sky-400' /> Review Execution Timeline &amp; Verification Activity ({state.liveEvents.length})</span>
						<span className='text-void-fg-3'>{state.repairs.length} repair(s) · {state.auditLog.length} audit record(s)</span>
					</div>
					<div className='flex-1 overflow-y-auto px-3 py-1.5 font-mono text-[11px] flex flex-col gap-0.5'>
						{[...state.liveEvents].slice(-40).reverse().map(ev => (
							<div key={ev.eventId} className='flex items-center gap-2 text-void-fg-2'>
								<span className='text-void-fg-3 shrink-0'>[{new Date(ev.timestamp).toLocaleTimeString()}]</span>
								<span className='text-sky-400 shrink-0'>{ev.type}</span>
								<span className='truncate'>{ev.message}</span>
							</div>
						))}
						{state.liveEvents.length === 0 && (
							<div className='text-void-fg-3 flex items-center gap-1.5'><AlertTriangle size={11} className='text-amber-400' /> No live backend review events recorded in this session yet.</div>
						)}
					</div>
				</div>
			)}
		</div>
		</div>
	);
};

