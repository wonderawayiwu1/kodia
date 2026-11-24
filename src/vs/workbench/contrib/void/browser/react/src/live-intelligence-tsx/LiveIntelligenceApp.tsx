/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useState } from 'react';
import {
	Activity,
	AlertTriangle,
	BookOpen,
	CheckCircle2,
	Cpu,
	ExternalLink,
	Globe,
	Loader2,
	Package,
	RefreshCw,
	Search,
	Settings,
	ShieldAlert,
	Sparkles,
	XCircle,
} from 'lucide-react';
import '../styles.css';
import { useAccessor } from '../util/services.js';
import type { LeiDashboardTab } from '../../../liveIntelligenceService.js';
import type {
	LeiDependencyReport,
	LeiEvidenceRecord,
	LeiLiveSnapshot,
	LeiModelDiscoveryReport,
	LeiModelVerificationReport,
	LeiPackageEcosystem,
	LeiResearchResult,
	LeiSecurityAuditReport,
} from '../../../../common/liveIntelligenceTypes.js';

export const LiveIntelligenceApp: React.FC = () => {
	const accessor = useAccessor();
	const leiService = accessor.get('ILiveIntelligenceService');

	const [tab, setTab] = useState<LeiDashboardTab>(() => leiService.getActiveTab());
	const [snapshot, setSnapshot] = useState<LeiLiveSnapshot>(() => leiService.getCachedSnapshot());
	const [evidence, setEvidence] = useState<readonly LeiEvidenceRecord[]>([]);
	const [includeStale, setIncludeStale] = useState(false);

	// Research tab state
	const [topic, setTopic] = useState('');
	const [techInput, setTechInput] = useState('');
	const [verInput, setVerInput] = useState('');
	const [researchRes, setResearchRes] = useState<LeiResearchResult | null>(null);

	// Model Intelligence tab state
	const [provider, setProvider] = useState('nvidia');
	const [taskType, setTaskType] = useState<'coding' | 'vision' | 'reasoning' | 'agentic' | 'general'>('coding');
	const [requiresVision, setRequiresVision] = useState(false);
	const [verifyModelId, setVerifyModelId] = useState('');
	const [modelDiscovery, setModelDiscovery] = useState<LeiModelDiscoveryReport | null>(null);
	const [modelVerif, setModelVerif] = useState<LeiModelVerificationReport | null>(null);

	// Dependency & Security tab state
	const [pkgName, setPkgName] = useState('');
	const [ecosystem, setEcosystem] = useState<LeiPackageEcosystem>('npm');
	const [pkgVersion, setPkgVersion] = useState('');
	const [depReport, setDepReport] = useState<LeiDependencyReport | null>(null);
	const [secReport, setSecReport] = useState<LeiSecurityAuditReport | null>(null);

	const [busy, setBusy] = useState<string | null>(null);

	useEffect(() => {
		let mounted = true;
		const loadAll = async () => {
			const [snap, recs] = await Promise.all([
				leiService.getSnapshot(),
				leiService.inspectEvidence({ includeStale }),
			]);
			if (mounted) {
				setSnapshot(snap);
				setEvidence(recs);
			}
		};
		void loadAll();
		const d1 = leiService.onDidChangeSnapshot(s => {
			setSnapshot(s);
			void leiService.inspectEvidence({ includeStale }).then(r => { if (mounted) setEvidence(r); });
		});
		const d2 = leiService.onDidChangeActiveTab(t => setTab(t));
		return () => { mounted = false; d1.dispose(); d2.dispose(); };
	}, [leiService, includeStale]);

	const openUrl = (url: string) => { try { window.open(url, '_blank', 'noopener,noreferrer'); } catch { /* ignore */ } };

	const runResearch = async () => {
		if (!topic.trim()) return;
		setBusy('research');
		try {
			const res = await leiService.researchTechnology({
				topic: topic.trim(),
				technology: techInput.trim() || undefined,
				currentVersionOrId: verInput.trim() || undefined,
				forceRefresh: true,
			});
			setResearchRes(res);
		} finally {
			setBusy(null);
		}
	};

	const runModelDiscovery = async () => {
		setBusy('discover-models');
		try {
			const res = await leiService.discoverProviderModels({
				provider,
				requirements: { taskType, requiresVision, requiresToolCalling: taskType === 'coding' || taskType === 'agentic' },
				forceRefresh: true,
			});
			setModelDiscovery(res);
		} finally {
			setBusy(null);
		}
	};

	const runModelVerify = async () => {
		if (!verifyModelId.trim()) return;
		setBusy('verify-model');
		try {
			const res = await leiService.verifyModelSelection({
				provider,
				modelId: verifyModelId.trim(),
				requirements: { taskType, requiresVision },
				forceRefresh: true,
			});
			setModelVerif(res);
		} finally {
			setBusy(null);
		}
	};

	const runDepCheck = async () => {
		if (!pkgName.trim()) return;
		setBusy('dep');
		try {
			const res = await leiService.checkDependency({
				packageName: pkgName.trim(),
				ecosystem,
				currentVersion: pkgVersion.trim() || undefined,
				forceRefresh: true,
			});
			setDepReport(res);
		} finally {
			setBusy(null);
		}
	};

	const runSecCheck = async () => {
		if (!pkgName.trim()) return;
		setBusy('sec');
		try {
			const res = await leiService.checkSecurityAdvisories({
				target: pkgName.trim(),
				ecosystem,
				version: pkgVersion.trim() || undefined,
				forceRefresh: true,
			});
			setSecReport(res);
		} finally {
			setBusy(null);
		}
	};

	const tabs: { id: LeiDashboardTab; label: string; icon: React.ReactNode }[] = [
		{ id: 'overview', label: 'Overview & Live Feed', icon: <Activity size={13} /> },
		{ id: 'research', label: 'Technology Research', icon: <Search size={13} /> },
		{ id: 'models', label: 'AI Model Intelligence', icon: <Cpu size={13} /> },
		{ id: 'dependencies', label: 'Dependencies & Security', icon: <Package size={13} /> },
		{ id: 'evidence', label: `Evidence (${evidence.length})`, icon: <BookOpen size={13} /> },
		{ id: 'policies', label: 'Freshness Policies', icon: <Settings size={13} /> },
	];

	return (
		<div className='h-full w-full flex flex-col bg-void-bg-2 text-void-fg-1 text-xs overflow-hidden'>
			{/* Header */}
			<div className='px-4 py-3 border-b border-void-border-2 bg-void-bg-1 flex items-center justify-between gap-3 flex-shrink-0'>
				<div className='flex items-center gap-2.5'>
					<Globe size={18} className='text-emerald-400' />
					<div>
						<div className='font-semibold text-sm flex items-center gap-2'>
							<span>Kodia Live Engineering Intelligence (LEI)</span>
							<span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${snapshot.systemStatus === 'active' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35' : snapshot.systemStatus === 'unavailable' ? 'bg-rose-500/15 text-rose-300 border-rose-500/35' : 'bg-amber-500/15 text-amber-300 border-amber-500/35'}`}>
								{snapshot.activeOperations.length > 0 ? 'Researching' : snapshot.systemStatus}
							</span>
						</div>
						<div className='text-[11px] text-void-fg-3'>{snapshot.currentTask}</div>
					</div>
				</div>
				<div className='flex items-center gap-2'>
					<button
						type='button'
						onClick={() => void leiService.refreshStaleKnowledge()}
						className='inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-void-bg-2 hover:bg-void-bg-3 border border-void-border-2 cursor-pointer'
					>
						<RefreshCw size={12} />
						<span>Refresh Stale</span>
					</button>
				</div>
			</div>

			{/* Nav Bar */}
			<div className='flex items-center gap-1 px-4 py-1.5 border-b border-void-border-2 bg-void-bg-1/80 overflow-x-auto flex-shrink-0'>
				{tabs.map(t => (
					<button
						key={t.id}
						type='button'
						onClick={() => { setTab(t.id); leiService.setActiveTab(t.id); }}
						className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] whitespace-nowrap cursor-pointer border ${tab === t.id ? 'bg-void-bg-3 text-void-fg-1 border-sky-500/50 font-medium' : 'border-transparent text-void-fg-3 hover:text-void-fg-1 hover:bg-void-bg-2'}`}
					>
						{t.icon}
						<span>{t.label}</span>
					</button>
				))}
			</div>

			{/* Content */}
			<div className='flex-1 overflow-y-auto p-4 flex flex-col gap-4'>
				{tab === 'overview' && (
					<>
						<div className='grid grid-cols-2 md:grid-cols-4 gap-3'>
							<div className='p-3 rounded-md bg-void-bg-1 border border-void-border-2'>
								<div className='text-void-fg-3 text-[10px]'>Verified Evidence</div>
								<div className='text-lg font-semibold text-emerald-300'>{snapshot.verifiedEvidenceCount} / {snapshot.evidenceCount}</div>
							</div>
							<div className='p-3 rounded-md bg-void-bg-1 border border-void-border-2'>
								<div className='text-void-fg-3 text-[10px]'>Knowledge Freshness</div>
								<div className='text-sm font-semibold mt-1'>{snapshot.knowledgeFreshness.replace(/_/g, ' ')}</div>
							</div>
							<div className='p-3 rounded-md bg-void-bg-1 border border-void-border-2'>
								<div className='text-void-fg-3 text-[10px]'>Stale / Conflicts</div>
								<div className='text-lg font-semibold text-amber-300'>{snapshot.staleEvidenceCount} / {snapshot.conflictCount}</div>
							</div>
							<div className='p-3 rounded-md bg-void-bg-1 border border-void-border-2'>
								<div className='text-void-fg-3 text-[10px]'>Network & Live Search</div>
								<div className='text-sm font-semibold mt-1'>{snapshot.networkAvailable ? 'Online' : 'Unavailable'}</div>
							</div>
						</div>

						<div className='p-3 rounded-md bg-void-bg-1 border border-void-border-2 flex flex-col gap-2'>
							<div className='font-semibold flex items-center justify-between'>
								<span>Live Research & Verification Event Stream</span>
								<span className='text-[10px] text-void-fg-3'>{snapshot.recentEvents.length} events</span>
							</div>
							{snapshot.recentEvents.length === 0 ? (
								<div className='text-void-fg-3 py-4 text-center'>No live research events recorded yet. Run a technology, model, or dependency verification to inspect real-time events.</div>
							) : (
								<div className='flex flex-col gap-1 max-h-80 overflow-y-auto'>
									{snapshot.recentEvents.map(ev => (
										<div key={ev.eventId} className='flex items-start justify-between gap-2 p-1.5 rounded bg-void-bg-2/70 border border-void-border-2/60 text-[11px]'>
											<div className='min-w-0'>
												<span className='font-mono text-sky-300 mr-2'>[{ev.type}]</span>
												<span className='font-medium'>{ev.technology}</span> — <span className='text-void-fg-2'>{ev.detail || ev.taskSummary}</span>
											</div>
											<span className='text-[10px] text-void-fg-3 whitespace-nowrap'>{new Date(ev.timestamp).toLocaleTimeString()}</span>
										</div>
									))}
								</div>
							)}
						</div>
					</>
				)}

				{tab === 'research' && (
					<div className='p-3 rounded-md bg-void-bg-1 border border-void-border-2 flex flex-col gap-3'>
						<div className='font-semibold'>Authoritative Technology, Framework & API Research</div>
						<div className='grid grid-cols-1 md:grid-cols-3 gap-2'>
							<input value={topic} onChange={e => setTopic(e.target.value)} placeholder='Topic (e.g. Expo SDK 53 React Native compatibility)' className='md:col-span-2 px-2.5 py-1.5 rounded bg-void-bg-2 border border-void-border-2' />
							<input value={techInput} onChange={e => setTechInput(e.target.value)} placeholder='Technology (optional)' className='px-2.5 py-1.5 rounded bg-void-bg-2 border border-void-border-2' />
						</div>
						<div className='flex items-center gap-2'>
							<input value={verInput} onChange={e => setVerInput(e.target.value)} placeholder='Current version or identifier (optional)' className='flex-1 px-2.5 py-1.5 rounded bg-void-bg-2 border border-void-border-2' />
							<button type='button' disabled={busy !== null} onClick={() => void runResearch()} className='inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/40 text-sky-200 font-medium cursor-pointer'>
								{busy === 'research' ? <Loader2 size={12} className='animate-spin' /> : <Search size={12} />}
								<span>Inspect Official Docs</span>
							</button>
						</div>
						{researchRes && (
							<div className='p-3 rounded bg-void-bg-2 border border-void-border-2 flex flex-col gap-2'>
								<div className='flex items-center justify-between'>
									<span className='font-semibold'>{researchRes.topic}</span>
									<span className='text-[10px] px-2 py-0.5 rounded bg-void-bg-1 border border-void-border-2'>{researchRes.verificationStatus}</span>
								</div>
								<div className='text-void-fg-2'>{researchRes.summary}</div>
								{researchRes.error && <div className='text-rose-300 flex items-center gap-1'><XCircle size={12} /> {researchRes.error}</div>}
								{researchRes.deprecationNotices.length > 0 && (
									<div className='text-amber-300 flex flex-col gap-0.5'>
										{researchRes.deprecationNotices.map((d, i) => <div key={i} className='flex items-center gap-1'><AlertTriangle size={11} /> {d}</div>)}
									</div>
								)}
								<div className='flex flex-wrap gap-1.5'>
									{researchRes.sources.map(s => (
										<button key={s.url} type='button' onClick={() => openUrl(s.url)} className='inline-flex items-center gap-1 px-2 py-1 rounded bg-void-bg-1 border border-void-border-2 text-sky-300 text-[10px] cursor-pointer'>
											<ExternalLink size={10} />
											<span>{s.authorityLabel} ({s.authorityScore})</span>
										</button>
									))}
								</div>
							</div>
						)}
					</div>
				)}

				{tab === 'models' && (
					<div className='p-3 rounded-md bg-void-bg-1 border border-void-border-2 flex flex-col gap-3'>
						<div className='font-semibold'>AI Model & Provider Intelligence (NVIDIA + Universal Dynamic Discovery)</div>
						<div className='grid grid-cols-1 md:grid-cols-4 gap-2'>
							<select value={provider} onChange={e => setProvider(e.target.value)} className='px-2 py-1.5 rounded bg-void-bg-2 border border-void-border-2'>
								{['nvidia', 'openai', 'anthropic', 'gemini', 'groq', 'mistral', 'deepseek', 'openrouter', 'ollama'].map(p => (
									<option key={p} value={p}>{p.toUpperCase()}</option>
								))}
							</select>
							<select value={taskType} onChange={e => setTaskType(e.target.value as any)} className='px-2 py-1.5 rounded bg-void-bg-2 border border-void-border-2'>
								<option value='coding'>Coding</option>
								<option value='vision'>Vision / Multimodal</option>
								<option value='reasoning'>Reasoning</option>
								<option value='agentic'>Agentic / Tool Calling</option>
								<option value='general'>General Chat</option>
							</select>
							<label className='flex items-center gap-1.5 px-2 py-1.5 rounded bg-void-bg-2 border border-void-border-2 cursor-pointer'>
								<input type='checkbox' checked={requiresVision} onChange={e => setRequiresVision(e.target.checked)} />
								<span>Requires Vision</span>
							</label>
							<button type='button' disabled={busy !== null} onClick={() => void runModelDiscovery()} className='inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-200 font-medium cursor-pointer'>
								{busy === 'discover-models' ? <Loader2 size={12} className='animate-spin' /> : <Sparkles size={12} />}
								<span>Discover Models</span>
							</button>
						</div>

						<div className='flex items-center gap-2'>
							<input value={verifyModelId} onChange={e => setVerifyModelId(e.target.value)} placeholder='Verify specific model ID (e.g. nvidia/llama-3.1-nemotron-70b-instruct)' className='flex-1 px-2.5 py-1.5 rounded bg-void-bg-2 border border-void-border-2' />
							<button type='button' disabled={busy !== null} onClick={() => void runModelVerify()} className='px-3 py-1.5 rounded bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/40 text-sky-200 font-medium cursor-pointer'>
								{busy === 'verify-model' ? 'Verifying…' : 'Verify Model ID'}
							</button>
						</div>

						{modelVerif && (
							<div className='p-3 rounded bg-void-bg-2 border border-void-border-2 flex flex-col gap-1'>
								<div className='font-semibold flex items-center justify-between'>
									<span>Verification: {modelVerif.requestedModelId}</span>
									<span className='text-[10px] px-2 py-0.5 rounded bg-void-bg-1 border border-void-border-2'>{modelVerif.verificationStatus}</span>
								</div>
								<div className='text-void-fg-2'>{modelVerif.explanation}</div>
								{modelVerif.recommendedAlternative && (
									<div className='text-emerald-300'>Recommended replacement: <span className='font-mono'>{modelVerif.recommendedAlternative.modelId}</span></div>
								)}
							</div>
						)}

						{modelDiscovery && (
							<div className='p-3 rounded bg-void-bg-2 border border-void-border-2 flex flex-col gap-2'>
								<div className='font-semibold flex items-center justify-between'>
									<span>{modelDiscovery.provider.toUpperCase()} — {modelDiscovery.models.length} active models ({modelDiscovery.discoveryMethod})</span>
									<span className='text-[10px]'>{modelDiscovery.verificationStatus}</span>
								</div>
								<div className='text-emerald-300'>{modelDiscovery.recommendationReason}</div>
								{modelDiscovery.error && <div className='text-rose-300'>{modelDiscovery.error}</div>}
								<div className='grid grid-cols-1 md:grid-cols-2 gap-1.5 max-h-64 overflow-y-auto'>
									{modelDiscovery.models.slice(0, 20).map(m => (
										<div key={m.modelId} className='p-2 rounded bg-void-bg-1 border border-void-border-2 flex items-center justify-between gap-2'>
											<span className='font-mono text-[11px] truncate'>{m.modelId}</span>
											<span className='text-[10px] text-void-fg-3 whitespace-nowrap'>{m.capabilities.inputModalities.join('+')}</span>
										</div>
									))}
								</div>
							</div>
						)}
					</div>
				)}

				{tab === 'dependencies' && (
					<div className='p-3 rounded-md bg-void-bg-1 border border-void-border-2 flex flex-col gap-3'>
						<div className='font-semibold'>Dependency Registry & OSV Security Advisory Intelligence</div>
						<div className='grid grid-cols-1 md:grid-cols-4 gap-2'>
							<select value={ecosystem} onChange={e => setEcosystem(e.target.value as LeiPackageEcosystem)} className='px-2 py-1.5 rounded bg-void-bg-2 border border-void-border-2'>
								<option value='npm'>npm</option>
								<option value='pypi'>PyPI</option>
								<option value='pub'>pub.dev (Flutter/Dart)</option>
								<option value='crates'>crates.io (Rust)</option>
								<option value='packagist'>Packagist (PHP)</option>
							</select>
							<input value={pkgName} onChange={e => setPkgName(e.target.value)} placeholder='Package name (e.g. react, fastapi, dio)' className='px-2.5 py-1.5 rounded bg-void-bg-2 border border-void-border-2' />
							<input value={pkgVersion} onChange={e => setPkgVersion(e.target.value)} placeholder='Current version (optional)' className='px-2.5 py-1.5 rounded bg-void-bg-2 border border-void-border-2' />
							<div className='flex gap-1.5'>
								<button type='button' disabled={busy !== null} onClick={() => void runDepCheck()} className='flex-1 px-2.5 py-1.5 rounded bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/40 text-sky-200 cursor-pointer'>
									Check Pkg
								</button>
								<button type='button' disabled={busy !== null} onClick={() => void runSecCheck()} className='flex-1 px-2.5 py-1.5 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 cursor-pointer'>
									OSV CVEs
								</button>
							</div>
						</div>

						{depReport && (
							<div className='p-3 rounded bg-void-bg-2 border border-void-border-2 flex flex-col gap-1'>
								<div className='font-semibold flex items-center justify-between'>
									<span>{depReport.ecosystem}:{depReport.packageName} — Latest: {depReport.latestVersion ?? 'unknown'}</span>
									<span className='text-[10px] px-2 py-0.5 rounded bg-void-bg-1 border border-void-border-2'>{depReport.compatibilityVerdict}</span>
								</div>
								<div className='text-void-fg-3'>License: {depReport.license ?? 'unknown'} · Vulnerabilities: {depReport.vulnerabilities.length} · Verification: {depReport.verificationStatus}</div>
								{depReport.installCommand && <div className='font-mono text-emerald-300'>{depReport.installCommand}</div>}
								{depReport.notes.map((n, i) => <div key={i} className='text-void-fg-2'>• {n}</div>)}
							</div>
						)}

						{secReport && (
							<div className='p-3 rounded bg-void-bg-2 border border-void-border-2 flex flex-col gap-1'>
								<div className='font-semibold flex items-center gap-1.5'>
									<ShieldAlert size={13} className='text-amber-300' />
									<span>Security Audit: {secReport.target} — {secReport.advisories.length} advisory(ies) ({secReport.criticalCount} critical, {secReport.highCount} high)</span>
								</div>
								{secReport.advisories.slice(0, 8).map(a => (
									<div key={a.id} className='flex items-center justify-between gap-2 text-[11px] py-1 border-t border-void-border-2/60'>
										<div className='min-w-0'>
											<span className='font-mono text-amber-300 mr-1.5'>{a.id}</span>
											<span>{a.summary}</span>
										</div>
										<button type='button' onClick={() => openUrl(a.sourceUrl)} className='text-sky-300 hover:underline whitespace-nowrap cursor-pointer'>View</button>
									</div>
								))}
							</div>
						)}
					</div>
				)}

				{tab === 'evidence' && (
					<div className='p-3 rounded-md bg-void-bg-1 border border-void-border-2 flex flex-col gap-2'>
						<div className='flex items-center justify-between'>
							<span className='font-semibold'>Persistent Verified Evidence Repository</span>
							<label className='flex items-center gap-1.5 text-[11px] cursor-pointer'>
								<input type='checkbox' checked={includeStale} onChange={e => setIncludeStale(e.target.checked)} />
								<span>Include stale/invalidated</span>
							</label>
						</div>
						{evidence.length === 0 ? (
							<div className='text-void-fg-3 py-4 text-center'>No evidence records stored yet.</div>
						) : (
							evidence.map(rec => (
								<div key={rec.id} className='p-2.5 rounded bg-void-bg-2 border border-void-border-2 flex flex-col gap-1'>
									<div className='flex items-center justify-between gap-2'>
										<span className='font-semibold flex items-center gap-1.5'>
											<CheckCircle2 size={12} className='text-emerald-400' />
											<span>{rec.technology}</span>
											<span className='font-mono text-[10px] text-sky-300'>{rec.exactIdentifierOrVersion}</span>
										</span>
										<span className='text-[10px] text-void-fg-3'>{rec.verificationStatus} · {rec.researchDate}</span>
									</div>
									<div className='text-void-fg-2'>{rec.finding}</div>
									<div className='flex flex-wrap gap-1'>
										{rec.sources.map(s => (
											<button key={s.url} type='button' onClick={() => openUrl(s.url)} className='text-[10px] text-sky-300 hover:underline cursor-pointer'>
												{s.authorityLabel}
											</button>
										))}
									</div>
								</div>
							))
						)}
					</div>
				)}

				{tab === 'policies' && (
					<div className='p-3 rounded-md bg-void-bg-1 border border-void-border-2 flex flex-col gap-3'>
						<div className='font-semibold'>Freshness Cache & Invalidation Policies</div>
						<label className='flex items-center gap-2 cursor-pointer'>
							<input
								type='checkbox'
								checked={snapshot.policies.enabled}
								onChange={e => void leiService.updatePolicies({ enabled: e.target.checked })}
							/>
							<span>Enable automatic Live Engineering Intelligence freshness verification</span>
						</label>
						<div className='grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]'>
							<div className='p-2 rounded bg-void-bg-2 border border-void-border-2'>
								<div className='text-void-fg-3 text-[10px]'>AI Models TTL</div>
								<div className='font-mono'>{Math.round(snapshot.policies.aiModelsTtlMs / 3600000)}h</div>
							</div>
							<div className='p-2 rounded bg-void-bg-2 border border-void-border-2'>
								<div className='text-void-fg-3 text-[10px]'>Package Versions TTL</div>
								<div className='font-mono'>{Math.round(snapshot.policies.packageVersionsTtlMs / 3600000)}h</div>
							</div>
							<div className='p-2 rounded bg-void-bg-2 border border-void-border-2'>
								<div className='text-void-fg-3 text-[10px]'>Security Advisories TTL</div>
								<div className='font-mono'>{Math.round(snapshot.policies.securityAdvisoriesTtlMs / 3600000)}h</div>
							</div>
							<div className='p-2 rounded bg-void-bg-2 border border-void-border-2'>
								<div className='text-void-fg-3 text-[10px]'>Framework Releases TTL</div>
								<div className='font-mono'>{Math.round(snapshot.policies.frameworkReleasesTtlMs / 3600000)}h</div>
							</div>
						</div>
					</div>
				)}
			</div>
		</div>
	);
};
