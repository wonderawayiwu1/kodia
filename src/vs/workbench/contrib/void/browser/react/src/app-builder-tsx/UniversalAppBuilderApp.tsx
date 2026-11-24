/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useState } from 'react';
import {
	Activity,
	AlertTriangle,
	CheckCircle2,
	Cloud,
	ExternalLink,
	Eye,
	FileCheck2,
	FileText,
	Globe,
	KeyRound,
	Laptop,
	Layers,
	Loader2,
	Monitor,
	Package,
	Paintbrush,
	Play,
	Radar,
	RefreshCw,
	Rocket,
	RotateCcw,
	Settings,
	ShieldCheck,
	Smartphone,
	Sparkles,
	Tablet,
	Wand2,
} from 'lucide-react';
import '../styles.css';
import { useAccessor, useIsDark } from '../util/services.js';
import { KodiaBadge, KodiaCard, KodiaPrimaryButton, KodiaSecondaryButton } from '../util/KodiaDesignSystem.js';
import { VOID_OPEN_SETTINGS_ACTION_ID } from '../../../voidSettingsPane.js';
import { KODIA_OPEN_API_STUDIO_ACTION_ID } from '../../../apiStudioService.js';
import { KODIA_OPEN_CORRECTNESS_HUB_ACTION_ID } from '../../../correctnessService.js';
import { KODIA_OPEN_LIVE_INTELLIGENCE_ACTION_ID } from '../../../liveIntelligenceService.js';
import { KODIA_OPEN_MOBILE_STUDIO_ACTION_ID } from '../../../mobileEngineeringService.js';
import type {
	IrireExternalRequirement,
	UabeBriefSourceType,
	UabeBuildMode,
	UabeCloudAdapterInfo,
	UabePillarStatus,
	UabePlatformTarget,
	UabeProjectState,
	UabeViewportPreset,
	UabeVisualEditResult,
	UabeWorkspaceTab,
} from '../../../../common/universalAppBuilderTypes.js';

const PLATFORM_CHOICES: readonly { id: UabePlatformTarget; label: string }[] = [
	{ id: 'web', label: 'Web App' },
	{ id: 'fullstack', label: 'Full-Stack' },
	{ id: 'ai_app', label: 'AI-Powered' },
	{ id: 'enterprise_saas', label: 'SaaS / Admin' },
	{ id: 'ecommerce', label: 'E-Commerce' },
	{ id: 'mobile_rn', label: 'Mobile (RN/Expo)' },
	{ id: 'mobile_flutter', label: 'Mobile (Flutter)' },
	{ id: 'mobile_android', label: 'Android Native' },
	{ id: 'mobile_ios', label: 'iOS Native' },
	{ id: 'desktop_electron', label: 'Desktop (Electron)' },
	{ id: 'desktop_tauri', label: 'Desktop (Tauri)' },
];

const VIEWPORTS: Record<UabeViewportPreset, { label: string; width: number; height: number }> = {
	mobile: { label: 'Mobile', width: 390, height: 740 },
	tablet: { label: 'Tablet', width: 768, height: 900 },
	laptop: { label: 'Laptop', width: 1280, height: 800 },
	desktop: { label: 'Desktop', width: 1440, height: 900 },
	wide: { label: 'Wide', width: 1680, height: 960 },
	custom: { label: 'Custom', width: 1024, height: 768 },
};

function pillarBadgeTone(status: UabePillarStatus): 'success' | 'danger' | 'warning' | 'neutral' | 'accent' {
	switch (status) {
		case 'passed': return 'success';
		case 'failed': return 'danger';
		case 'warning':
		case 'blocked': return 'warning';
		case 'not_applicable': return 'neutral';
		default: return 'accent';
	}
}

export const UniversalAppBuilderApp: React.FC = () => {
	const isDark = useIsDark();
	const accessor = useAccessor();
	const uabe = accessor.get('IUniversalAppBuilderService');
	const fpere = accessor.get('IFirstPassReliabilityService');
	const chatThreadService = accessor.get('IChatThreadService');
	const commandService = accessor.get('ICommandService');
	const notificationService = accessor.get('INotificationService');

	const [state, setState] = useState<UabeProjectState>(() => uabe.getCachedProjectState());
	const [activeTab, setActiveTab] = useState<UabeWorkspaceTab>(() => uabe.getActiveTab());
	const [adapters, setAdapters] = useState<readonly UabeCloudAdapterInfo[]>([]);
	const [busy, setBusy] = useState<string | null>(null);
	const [banner, setBanner] = useState<{ tone: 'info' | 'success' | 'error'; text: string } | null>(null);

	// Create / Brief form state
	const [appName, setAppName] = useState(state.name || '');
	const [brief, setBrief] = useState(state.brief || '');
	const [sourceType, setSourceType] = useState<UabeBriefSourceType>('idea');
	const [selectedPlatforms, setSelectedPlatforms] = useState<UabePlatformTarget[]>([...state.platforms]);
	const [preferredStack, setPreferredStack] = useState('');

	// Preview & Visual Editor state
	const [previewUrl, setPreviewUrl] = useState(state.preview.url || 'http://localhost:3000');
	const [previewKey, setPreviewKey] = useState(0);
	const [veFile, setVeFile] = useState('public/index.html');
	const [veSelector, setVeSelector] = useState('Get Started');
	const [veNewText, setVeNewText] = useState('');
	const [veColor, setVeColor] = useState('');
	const [veBgColor, setVeBgColor] = useState('');
	const [vePadding, setVePadding] = useState('');
	const [veAddClasses, setVeAddClasses] = useState('');
	const [lastVisualEdit, setLastVisualEdit] = useState<UabeVisualEditResult | null>(null);

	// IRIRE credential inputs per requirement ID
	const [secretInputs, setSecretInputs] = useState<Record<string, string>>({});
	const [expandedGuideId, setExpandedGuideId] = useState<string | null>(null);

	// Reliability & Handover form state
	const [relTestCmd, setRelTestCmd] = useState('npm test');
	const [relBuildCmd, setRelBuildCmd] = useState('');
	const [clientName, setClientName] = useState('Client Delivery Team');

	useEffect(() => {
		let mounted = true;
		void uabe.getProjectState().then(s => {
			if (!mounted) return;
			setState(s);
			if (s.brief) setBrief(s.brief);
			if (s.name) setAppName(s.name);
			setPreviewUrl(s.preview.url);
			setSelectedPlatforms([...s.platforms]);
		});
		void uabe.listCloudAdapters().then(list => { if (mounted) setAdapters(list); });
		const d1 = uabe.onDidChangeProject(s => setState(s));
		const d2 = uabe.onDidChangeActiveTab(t => setActiveTab(t));
		return () => { mounted = false; d1.dispose(); d2.dispose(); };
	}, [uabe]);

	const runAction = async (key: string, fn: () => Promise<string>) => {
		setBusy(key);
		setBanner(null);
		try {
			const msg = await fn();
			setBanner({ tone: 'success', text: msg });
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			setBanner({ tone: 'error', text: msg });
		} finally {
			setBusy(null);
		}
	};

	const togglePlatform = (id: UabePlatformTarget) => {
		setSelectedPlatforms(prev => prev.includes(id)
			? (prev.length > 1 ? prev.filter(p => p !== id) : prev)
			: [...prev, id]);
	};

	const launchAutonomousBuildInChat = () => {
		const trimmed = brief.trim() || state.brief.trim();
		if (!trimmed) {
			setBanner({ tone: 'error', text: 'Describe your application idea or paste a client brief first.' });
			return;
		}
		const modeDirective = state.buildMode === 'plan_first'
			? 'OPERATING MODE: PLAN FIRST — Produce full requirements matrix, architecture, stack, DB/API contracts, IRIRE external credentials list, and testing strategy, then wait for approval before modifying source code.'
			: 'OPERATING MODE: AUTONOMOUS BUILD — Execute end-to-end through requirements, contract-first blueprint (FPERE), IRIRE external requirement discovery, incremental implementation, semantic & installed-API verification (ERIC), live preview/tests, and honest reliability reporting.';
		const prompt = [
			`[Kodia Universal App Builder Engine — ${appName.trim() || state.name}]`,
			modeDirective,
			`Target Platforms: ${selectedPlatforms.join(', ')}`,
			preferredStack.trim() ? `Preferred Stack: ${preferredStack.trim()}` : '',
			'',
			'Requirements / Brief:',
			trimmed,
		].filter(Boolean).join('\n');

		const tid = chatThreadService.state.currentThreadId;
		if (chatThreadService.streamState[tid]?.isRunning) {
			chatThreadService.enqueueUserMessage(tid, prompt);
			notificationService.info('Queued Universal App Builder task in active Kodia Chat thread.');
		} else {
			void chatThreadService.addUserMessageAndStreamResponse({ userMessage: prompt, threadId: tid });
			notificationService.info('Started Universal App Builder workflow in Kodia Chat.');
		}
	};

	const pendingMandatoryCount = state.integrations.filter(i => i.classification === 'mandatory' && !i.configured).length;

	const tabs: { id: UabeWorkspaceTab; label: string; icon: React.ReactNode; badge?: string }[] = [
		{ id: 'create', label: 'Create & Brief', icon: <Rocket size={13} /> },
		{ id: 'requirements', label: 'Requirements & Stack', icon: <FileText size={13} />, badge: state.contractAnalysis ? String(state.contractAnalysis.requirements.length) : undefined },
		{ id: 'preview', label: 'Preview & Visual Edit', icon: <Eye size={13} /> },
		{ id: 'integrations', label: 'Integrations (IRIRE)', icon: <KeyRound size={13} />, badge: pendingMandatoryCount > 0 ? `${pendingMandatoryCount} needed` : state.integrations.length ? String(state.integrations.length) : undefined },
		{ id: 'baas', label: 'BaaS & Cloud', icon: <Cloud size={13} /> },
		{ id: 'reliability', label: 'Reliability', icon: <ShieldCheck size={13} /> },
		{ id: 'handover', label: 'Client Handover', icon: <Package size={13} /> },
		{ id: 'activity', label: 'Checkpoints & Feed', icon: <Activity size={13} />, badge: state.checkpoints.length ? String(state.checkpoints.length) : undefined },
	];

	return (
		<div className={`@@void-scope ${isDark ? 'dark' : ''} bg-void-bg-2 text-void-fg-1 h-full w-full flex flex-col overflow-hidden`}>
			{/* Top Studio Header */}
			<header className='px-4 py-3 border-b border-void-border-2 bg-void-bg-1 flex flex-wrap items-center justify-between gap-3 shrink-0'>
				<div className='flex items-center gap-2.5 min-w-0'>
					<div
						style={{ backgroundColor: 'var(--kodia-accent)', color: 'var(--kodia-accent-fg)' }}
						className='w-8 h-8 rounded-lg flex items-center justify-center shrink-0 shadow-xs'
					>
						<Rocket size={16} />
					</div>
					<div className='min-w-0'>
						<div className='flex items-center gap-2 flex-wrap'>
							<h1 className='text-sm font-semibold tracking-tight truncate'>Kodia Universal App Builder Engine</h1>
							<KodiaBadge tone='accent'>{state.phase.replace(/_/g, ' ')}</KodiaBadge>
							{pendingMandatoryCount > 0 && (
								<KodiaBadge tone='warning'>{pendingMandatoryCount} credential(s) needed</KodiaBadge>
							)}
						</div>
						<p className='text-[11px] text-void-fg-3 truncate'>
							{state.name} · Full-Stack, AI, Mobile &amp; Desktop Engineering · FPERE + ERIC + IRIRE + LEI
						</p>
					</div>
				</div>

				{/* Per-Project Build Mode Switcher + Connected Studios */}
				<div className='flex flex-wrap items-center gap-2'>
					<div className='flex items-center rounded-md border border-void-border-2 bg-void-bg-2 p-0.5 text-[11px]' role='group' aria-label='Per-Project Build Mode'>
						{([
							{ id: 'autonomous_build', label: 'Autonomous Build' },
							{ id: 'plan_first', label: 'Plan First' },
							{ id: 'user_chooses', label: 'Ask Per Project' },
						] as const).map(m => {
							const active = state.buildMode === m.id;
							return (
								<button
									key={m.id}
									type='button'
									onClick={() => void runAction('mode', async () => { await uabe.setProjectBuildMode(m.id); return `Per-project build mode set to ${m.label}.`; })}
									style={active ? { backgroundColor: 'var(--kodia-accent)', color: 'var(--kodia-accent-fg)' } : undefined}
									className={`px-2 py-1 rounded cursor-pointer transition-all ${active ? 'font-medium shadow-xs' : 'text-void-fg-3 hover:text-void-fg-1'}`}
								>
									{m.label}
								</button>
							);
						})}
					</div>

					<div className='flex items-center gap-1'>
						<button type='button' title='Live Engineering Intelligence (Ctrl+Alt+I)' onClick={() => void commandService.executeCommand(KODIA_OPEN_LIVE_INTELLIGENCE_ACTION_ID)} className='p-1.5 rounded border border-void-border-2 bg-void-bg-2 hover:bg-void-bg-3 text-void-fg-2 cursor-pointer'><Radar size={13} /></button>
						<button type='button' title='API Engineering Studio (Ctrl+Alt+A)' onClick={() => void commandService.executeCommand(KODIA_OPEN_API_STUDIO_ACTION_ID)} className='p-1.5 rounded border border-void-border-2 bg-void-bg-2 hover:bg-void-bg-3 text-void-fg-2 cursor-pointer'><Globe size={13} /></button>
						<button type='button' title='Mobile Engineering Studio (Ctrl+Alt+M)' onClick={() => void commandService.executeCommand(KODIA_OPEN_MOBILE_STUDIO_ACTION_ID)} className='p-1.5 rounded border border-void-border-2 bg-void-bg-2 hover:bg-void-bg-3 text-void-fg-2 cursor-pointer'><Smartphone size={13} /></button>
						<button type='button' title='Correctness & FPERE/ERIC Hub (Ctrl+Alt+D)' onClick={() => void commandService.executeCommand(KODIA_OPEN_CORRECTNESS_HUB_ACTION_ID)} className='p-1.5 rounded border border-void-border-2 bg-void-bg-2 hover:bg-void-bg-3 text-void-fg-2 cursor-pointer'><ShieldCheck size={13} /></button>
						<button type='button' title='Kodia Settings' onClick={() => void commandService.executeCommand(VOID_OPEN_SETTINGS_ACTION_ID)} className='p-1.5 rounded border border-void-border-2 bg-void-bg-2 hover:bg-void-bg-3 text-void-fg-2 cursor-pointer'><Settings size={13} /></button>
					</div>
				</div>
			</header>

			{/* Workspace Tabs */}
			<nav className='kodia-thin-tabs px-4 py-1.5 border-b border-void-border-2 bg-void-bg-1/70 flex items-center gap-1 overflow-x-auto shrink-0'>
				{tabs.map(t => {
					const active = activeTab === t.id;
					return (
						<button
							key={t.id}
							type='button'
							onClick={() => { setActiveTab(t.id); uabe.setActiveTab(t.id); }}
							style={active ? { borderColor: 'var(--kodia-accent)' } : undefined}
							className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs whitespace-nowrap cursor-pointer transition-all ${active
								? 'bg-void-bg-3 text-void-fg-1 font-medium border shadow-xs'
								: 'text-void-fg-3 hover:text-void-fg-1 hover:bg-void-bg-2 border border-transparent'}`}
						>
							{t.icon}
							<span>{t.label}</span>
							{t.badge && (
								<span className='text-[10px] px-1.5 py-0.2 rounded-full bg-void-bg-2 border border-void-border-2 text-void-fg-2'>{t.badge}</span>
							)}
						</button>
					);
				})}
			</nav>

			{banner && (
				<div className={`mx-4 mt-3 px-3 py-2 rounded-md border text-xs flex items-center justify-between gap-2 shrink-0 ${banner.tone === 'error'
					? 'bg-rose-500/10 border-rose-500/40 text-rose-200'
					: 'bg-emerald-500/10 border-emerald-500/40 text-emerald-200'}`}>
					<span>{banner.text}</span>
					<button type='button' onClick={() => setBanner(null)} className='text-[11px] opacity-80 hover:opacity-100 cursor-pointer'>Dismiss</button>
				</div>
			)}

			{/* Main Scrollable Workspace Content */}
			<main className='flex-1 overflow-y-auto p-4'>
				<div className='max-w-6xl mx-auto flex flex-col gap-4'>

					{/* TAB 1: CREATE & BRIEF */}
					{activeTab === 'create' && (
						<div className='grid grid-cols-1 lg:grid-cols-3 gap-4'>
							<KodiaCard className='lg:col-span-2 flex flex-col gap-3'>
								<div className='flex items-center justify-between gap-2'>
									<div className='flex items-center gap-2'>
										<Sparkles size={15} className='text-sky-400' />
										<h2 className='text-sm font-semibold'>Describe Your Application, Client Brief, or Contract</h2>
									</div>
									<select
										value={sourceType}
										onChange={e => setSourceType(e.target.value as UabeBriefSourceType)}
										className='text-xs px-2 py-1 rounded bg-void-bg-2 border border-void-border-2 text-void-fg-1'
										aria-label='Brief Source Type'
									>
										<option value='idea'>Product Idea</option>
										<option value='client_brief'>Client Brief</option>
										<option value='contract'>Client Contract / SOW</option>
										<option value='prd'>Product Requirements (PRD)</option>
										<option value='api_spec'>API Specification</option>
										<option value='existing_code'>Existing Codebase Upgrade</option>
									</select>
								</div>

								<div className='grid grid-cols-1 sm:grid-cols-2 gap-2'>
									<input
										type='text'
										value={appName}
										onChange={e => setAppName(e.target.value)}
										placeholder='Application name (e.g. Acme Inventory SaaS)'
										className='px-3 py-2 text-xs rounded-md bg-void-bg-2 border border-void-border-2 text-void-fg-1'
									/>
									<input
										type='text'
										value={preferredStack}
										onChange={e => setPreferredStack(e.target.value)}
										placeholder='Optional preferred stack (e.g. Next.js + FastAPI + Postgres)'
										className='px-3 py-2 text-xs rounded-md bg-void-bg-2 border border-void-border-2 text-void-fg-1'
									/>
								</div>

								<textarea
									value={brief}
									onChange={e => setBrief(e.target.value)}
									rows={7}
									placeholder='Paste a simple sentence, full client contract, SOW, feature list, or technical specification. Kodia will extract traceable requirements, recommend the optimal architecture, discover required API keys/accounts (IRIRE), and build + verify end-to-end...'
									className='w-full p-3 text-xs rounded-md bg-void-bg-2 border border-void-border-2 text-void-fg-1 resize-y font-sans leading-relaxed'
								/>

								<div>
									<div className='text-[11px] text-void-fg-3 mb-1.5 font-medium'>Target Platforms (multi-select)</div>
									<div className='flex flex-wrap gap-1.5'>
										{PLATFORM_CHOICES.map(p => {
											const on = selectedPlatforms.includes(p.id);
											return (
												<button
													key={p.id}
													type='button'
													onClick={() => togglePlatform(p.id)}
													style={on ? { backgroundColor: 'var(--kodia-accent)', color: 'var(--kodia-accent-fg)' } : undefined}
													className={`px-2.5 py-1 rounded-full text-[11px] border cursor-pointer transition-all ${on
														? 'border-transparent font-medium'
														: 'bg-void-bg-2 border-void-border-2 text-void-fg-2 hover:bg-void-bg-3'}`}
												>
													{p.label}
												</button>
											);
										})}
									</div>
								</div>

								<div className='flex flex-wrap items-center gap-2 pt-1'>
									<KodiaPrimaryButton
										disabled={busy !== null || !brief.trim()}
										onClick={() => void runAction('init', async () => {
											const s = await uabe.initializeProject({
												name: appName.trim() || undefined,
												brief: brief.trim(),
												sourceType,
												buildMode: state.buildMode,
												preferredPlatforms: selectedPlatforms,
												preferredStack: preferredStack.trim() || undefined,
											});
											setActiveTab('requirements');
											return `Project "${s.name}" initialized: ${s.contractAnalysis?.requirements.length ?? 0} requirement(s) & ${s.integrations.length} integration requirement(s) discovered.`;
										})}
									>
										{busy === 'init' ? <Loader2 size={13} className='animate-spin' /> : <Wand2 size={13} />}
										<span>Analyze Requirements, Stack &amp; Integrations</span>
									</KodiaPrimaryButton>

									<KodiaSecondaryButton disabled={busy !== null} onClick={launchAutonomousBuildInChat}>
										<Play size={13} />
										<span>{state.buildMode === 'plan_first' ? 'Run Plan-First in Chat' : 'Start Autonomous Build in Chat'}</span>
									</KodiaSecondaryButton>
								</div>
							</KodiaCard>

							{/* Quick Verified Scaffolds */}
							<KodiaCard className='flex flex-col gap-3'>
								<div className='flex items-center gap-2'>
									<Layers size={15} className='text-emerald-400' />
									<h2 className='text-sm font-semibold'>Verified Instant Scaffolds</h2>
								</div>
								<p className='text-[11px] text-void-fg-3'>
									Generate clean, runnable starter foundations with built-in tests and automatic rollback checkpoints.
								</p>
								<div className='flex flex-col gap-2'>
									{([
										{ id: 'website', label: 'Modern Responsive Website', desc: 'Semantic HTML/CSS + Visual-Edit ready + tests' },
										{ id: 'fullstack_business', label: 'Full-Stack Business App', desc: 'REST API + CRUD store + client + integration tests' },
										{ id: 'ai_app', label: 'AI-Powered Application', desc: 'Backend AI proxy + missing-key guard + .env.example' },
										{ id: 'mobile_rn', label: 'React Native / Expo Mobile', desc: 'Typed mobile screen foundation + tests' },
										{ id: 'desktop_electron', label: 'Electron Desktop App', desc: 'Context-isolated secure preload + renderer + tests' },
									] as const).map(tpl => (
										<button
											key={tpl.id}
											type='button'
											disabled={busy !== null}
											onClick={() => void runAction(`tpl-${tpl.id}`, async () => {
												const res = await uabe.scaffoldApplication({ template: tpl.id, appName: appName.trim() || tpl.label });
												return res.summary;
											})}
											className='text-left p-2.5 rounded-md bg-void-bg-2 hover:bg-void-bg-3 border border-void-border-2 cursor-pointer transition-all disabled:opacity-50'
										>
											<div className='text-xs font-medium text-void-fg-1 flex items-center justify-between'>
												<span>{tpl.label}</span>
												{busy === `tpl-${tpl.id}` && <Loader2 size={12} className='animate-spin' />}
											</div>
											<div className='text-[11px] text-void-fg-3 mt-0.5'>{tpl.desc}</div>
										</button>
									))}
								</div>
							</KodiaCard>
						</div>
					)}

					{/* TAB 2: REQUIREMENTS & STACK */}
					{activeTab === 'requirements' && (
						<div className='flex flex-col gap-4'>
							{state.stack && (
								<KodiaCard className='flex flex-col gap-2'>
									<div className='flex items-center justify-between'>
										<h2 className='text-sm font-semibold'>Recommended Universal Architecture &amp; Stack</h2>
										<KodiaBadge tone='accent'>{state.stack.architectureStyle.replace(/_/g, ' ')}</KodiaBadge>
									</div>
									<p className='text-xs text-void-fg-2'>{state.stack.rationale}</p>
									<div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 pt-1 text-xs'>
										<div className='p-2 rounded bg-void-bg-2 border border-void-border-2'><div className='text-[10px] text-void-fg-3'>Frontend</div><div className='font-medium'>{state.stack.frontend}</div></div>
										<div className='p-2 rounded bg-void-bg-2 border border-void-border-2'><div className='text-[10px] text-void-fg-3'>Backend</div><div className='font-medium'>{state.stack.backend}</div></div>
										<div className='p-2 rounded bg-void-bg-2 border border-void-border-2'><div className='text-[10px] text-void-fg-3'>Database</div><div className='font-medium'>{state.stack.database}</div></div>
										<div className='p-2 rounded bg-void-bg-2 border border-void-border-2'><div className='text-[10px] text-void-fg-3'>Specialized Layer</div><div className='font-medium'>{state.stack.aiLayer || state.stack.mobile || state.stack.desktop || state.stack.baasOrCloud || 'Standard Web'}</div></div>
									</div>
								</KodiaCard>
							)}

							<KodiaCard className='flex flex-col gap-3'>
								<div className='flex items-center justify-between'>
									<h2 className='text-sm font-semibold'>Contract-to-Product Requirements Traceability Matrix</h2>
									<KodiaBadge tone='neutral'>{state.contractAnalysis?.requirements.length ?? 0} requirement(s)</KodiaBadge>
								</div>
								{!state.contractAnalysis ? (
									<div className='text-xs text-void-fg-3 py-4 text-center'>No requirements extracted yet. Paste your idea or contract in &ldquo;Create &amp; Brief&rdquo; and click Analyze.</div>
								) : (
									<div className='flex flex-col gap-2'>
										{state.contractAnalysis.ambiguities.length > 0 && (
											<div className='p-2.5 rounded bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200'>
												<div className='font-semibold mb-1'>Ambiguities to Confirm:</div>
												<ul className='list-disc pl-4 space-y-0.5'>
													{state.contractAnalysis.ambiguities.map((a, i) => <li key={i}>{a}</li>)}
												</ul>
											</div>
										)}
										<div className='overflow-x-auto'>
											<table className='w-full text-left text-xs border-collapse'>
												<thead>
													<tr className='border-b border-void-border-2 text-void-fg-3 text-[11px]'>
														<th className='py-1.5 pr-3'>ID</th>
														<th className='py-1.5 pr-3'>Category</th>
														<th className='py-1.5 pr-3'>Requirement</th>
														<th className='py-1.5 pr-3'>Source</th>
														<th className='py-1.5'>Status</th>
													</tr>
												</thead>
												<tbody>
													{state.contractAnalysis.requirements.map(r => (
														<tr key={r.id} className='border-b border-void-border-2/60'>
															<td className='py-2 pr-3 font-mono text-[11px] text-sky-300'>{r.id}</td>
															<td className='py-2 pr-3'><KodiaBadge tone='neutral'>{r.category}</KodiaBadge></td>
															<td className='py-2 pr-3 font-medium'>{r.title}</td>
															<td className='py-2 pr-3 text-void-fg-3 font-mono text-[10px]'>{r.source}</td>
															<td className='py-2'><KodiaBadge tone={r.status === 'verified' ? 'success' : r.status === 'blocked' ? 'warning' : 'accent'}>{r.status}</KodiaBadge></td>
														</tr>
													))}
												</tbody>
											</table>
										</div>
									</div>
								)}
							</KodiaCard>
						</div>
					)}

					{/* TAB 3: LIVE PREVIEW & REAL VISUAL-TO-SOURCE EDITOR */}
					{activeTab === 'preview' && (
						<div className='grid grid-cols-1 lg:grid-cols-3 gap-4'>
							<KodiaCard className='lg:col-span-2 flex flex-col gap-3'>
								<div className='flex flex-wrap items-center justify-between gap-2'>
									<div className='flex items-center gap-2 flex-1 min-w-[200px]'>
										<input
											type='text'
											value={previewUrl}
											onChange={e => setPreviewUrl(e.target.value)}
											placeholder='http://localhost:3000'
											className='flex-1 px-2.5 py-1.5 text-xs rounded bg-void-bg-2 border border-void-border-2 text-void-fg-1 font-mono'
										/>
										<KodiaSecondaryButton onClick={() => {
											setPreviewKey(k => k + 1);
											void uabe.updatePreviewState({ url: previewUrl, status: 'running' });
										}}>
											<RefreshCw size={12} /> Load
										</KodiaSecondaryButton>
										<KodiaSecondaryButton onClick={() => window.open(previewUrl, '_blank', 'noopener,noreferrer')}>
											<ExternalLink size={12} /> External
										</KodiaSecondaryButton>
									</div>
									<div className='flex items-center gap-1'>
										{([
											{ id: 'mobile', icon: <Smartphone size={12} /> },
											{ id: 'tablet', icon: <Tablet size={12} /> },
											{ id: 'laptop', icon: <Laptop size={12} /> },
											{ id: 'desktop', icon: <Monitor size={12} /> },
										] as const).map(v => (
											<button
												key={v.id}
												type='button'
												title={`${VIEWPORTS[v.id].label} (${VIEWPORTS[v.id].width}x${VIEWPORTS[v.id].height})`}
												onClick={() => void uabe.updatePreviewState({ viewport: v.id, width: VIEWPORTS[v.id].width, height: VIEWPORTS[v.id].height })}
												className={`p-1.5 rounded border cursor-pointer ${state.preview.viewport === v.id ? 'bg-void-bg-3 border-sky-400 text-sky-300' : 'bg-void-bg-2 border-void-border-2 text-void-fg-3'}`}
											>
												{v.icon}
											</button>
										))}
									</div>
								</div>

								<div className='rounded-lg border border-void-border-2 bg-void-bg-1 p-3 overflow-auto flex justify-center min-h-[420px]'>
									<iframe
										key={previewKey}
										src={previewUrl}
										title='Kodia Live Application Preview'
										style={{ width: Math.min(state.preview.width, 1000), height: 420 }}
										className='rounded border border-void-border-2 bg-white'
									/>
								</div>
							</KodiaCard>

							{/* Visual Editing with Real Source-Code Sync */}
							<KodiaCard className='flex flex-col gap-2.5'>
								<div className='flex items-center gap-2'>
									<Paintbrush size={15} className='text-violet-400' />
									<h2 className='text-sm font-semibold'>Visual Edit → Real Source Sync</h2>
								</div>
								<p className='text-[11px] text-void-fg-3'>
									Modify visible text, colors, spacing, or classes directly in the real component/HTML file with an automatic rollback checkpoint.
								</p>

								<label className='text-[11px] flex flex-col gap-1'>
									<span className='text-void-fg-3'>Source File (workspace-relative)</span>
									<input type='text' value={veFile} onChange={e => setVeFile(e.target.value)} className='px-2.5 py-1.5 text-xs rounded bg-void-bg-2 border border-void-border-2 font-mono' />
								</label>
								<label className='text-[11px] flex flex-col gap-1'>
									<span className='text-void-fg-3'>Target Element Text / Selector / ID</span>
									<input type='text' value={veSelector} onChange={e => setVeSelector(e.target.value)} className='px-2.5 py-1.5 text-xs rounded bg-void-bg-2 border border-void-border-2' />
								</label>
								<label className='text-[11px] flex flex-col gap-1'>
									<span className='text-void-fg-3'>Replace Text (optional)</span>
									<input type='text' value={veNewText} onChange={e => setVeNewText(e.target.value)} placeholder='e.g. Launch Workspace' className='px-2.5 py-1.5 text-xs rounded bg-void-bg-2 border border-void-border-2' />
								</label>
								<div className='grid grid-cols-2 gap-2'>
									<label className='text-[11px] flex flex-col gap-1'>
										<span className='text-void-fg-3'>Text Color</span>
										<input type='text' value={veColor} onChange={e => setVeColor(e.target.value)} placeholder='#ffffff' className='px-2 py-1 text-xs rounded bg-void-bg-2 border border-void-border-2 font-mono' />
									</label>
									<label className='text-[11px] flex flex-col gap-1'>
										<span className='text-void-fg-3'>Background</span>
										<input type='text' value={veBgColor} onChange={e => setVeBgColor(e.target.value)} placeholder='#2563eb' className='px-2 py-1 text-xs rounded bg-void-bg-2 border border-void-border-2 font-mono' />
									</label>
								</div>
								<div className='grid grid-cols-2 gap-2'>
									<label className='text-[11px] flex flex-col gap-1'>
										<span className='text-void-fg-3'>Padding</span>
										<input type='text' value={vePadding} onChange={e => setVePadding(e.target.value)} placeholder='12px 24px' className='px-2 py-1 text-xs rounded bg-void-bg-2 border border-void-border-2 font-mono' />
									</label>
									<label className='text-[11px] flex flex-col gap-1'>
										<span className='text-void-fg-3'>Add Classes</span>
										<input type='text' value={veAddClasses} onChange={e => setVeAddClasses(e.target.value)} placeholder='rounded-lg shadow-md' className='px-2 py-1 text-xs rounded bg-void-bg-2 border border-void-border-2 font-mono' />
									</label>
								</div>

								<KodiaPrimaryButton
									disabled={busy !== null}
									onClick={() => void runAction('vedit', async () => {
										const styleChanges: Record<string, string> = {};
										if (veColor.trim()) styleChanges.color = veColor.trim();
										if (veBgColor.trim()) styleChanges.backgroundColor = veBgColor.trim();
										if (vePadding.trim()) styleChanges.padding = vePadding.trim();
										const res = await uabe.applyVisualEdit({
											filePath: veFile.trim(),
											selectorOrText: veSelector.trim(),
											newText: veNewText.trim() || undefined,
											styleChanges: Object.keys(styleChanges).length ? styleChanges : undefined,
											addClasses: veAddClasses.trim() ? veAddClasses.trim().split(/\s+/) : undefined,
										});
										setLastVisualEdit(res);
										if (res.applied) setPreviewKey(k => k + 1);
										return res.summary;
									})}
								>
									<Paintbrush size={12} /> Apply to Real Source Code
								</KodiaPrimaryButton>

								{lastVisualEdit && (
									<div className='p-2 rounded bg-void-bg-2 border border-void-border-2 text-[11px] space-y-1'>
										<div className={lastVisualEdit.applied ? 'text-emerald-300 font-medium' : 'text-amber-300 font-medium'}>{lastVisualEdit.summary}</div>
										{lastVisualEdit.afterSnippet && (
											<pre className='text-[10px] font-mono overflow-x-auto text-void-fg-2 bg-void-bg-1 p-1.5 rounded'>{lastVisualEdit.afterSnippet}</pre>
										)}
										{lastVisualEdit.checkpointId && (
											<button
												type='button'
												onClick={() => void runAction('rb-ve', async () => (await uabe.rollbackCheckpoint(lastVisualEdit.checkpointId!)).message)}
												className='inline-flex items-center gap-1 text-[10px] text-sky-300 hover:underline cursor-pointer'
											>
												<RotateCcw size={10} /> Undo via Checkpoint ({lastVisualEdit.checkpointId})
											</button>
										)}
									</div>
								)}
							</KodiaCard>
						</div>
					)}

					{/* TAB 4: INTEGRATIONS & CREDENTIALS (IRIRE) */}
					{activeTab === 'integrations' && (
						<div className='flex flex-col gap-3'>
							<div className='flex items-center justify-between gap-2'>
								<div>
									<h2 className='text-sm font-semibold'>Intelligent Requirements &amp; Integration Readiness (IRIRE)</h2>
									<p className='text-[11px] text-void-fg-3'>Auto-discovered external accounts, verified official links, encrypted local secret vault, and connection validation.</p>
								</div>
								<KodiaSecondaryButton disabled={busy !== null} onClick={() => void runAction('irire-scan', async () => {
									const list = await uabe.discoverExternalRequirements();
									return `IRIRE scanned workspace & brief: ${list.length} external requirement(s) found.`;
								})}>
									<RefreshCw size={12} /> Rescan Workspace
								</KodiaSecondaryButton>
							</div>

							{state.integrations.length === 0 ? (
								<KodiaCard className='text-xs text-void-fg-3 text-center py-6'>
									No external paid/cloud credentials detected yet. Describe an app using MongoDB Atlas, Supabase, Stripe, NVIDIA NIM, OpenAI, or Firebase — or click Rescan Workspace.
								</KodiaCard>
							) : (
								<div className='grid grid-cols-1 gap-3'>
									{state.integrations.map((req: IrireExternalRequirement) => {
										const openGuide = expandedGuideId === req.id;
										return (
											<KodiaCard key={req.id} className='flex flex-col gap-2.5'>
												<div className='flex flex-wrap items-center justify-between gap-2'>
													<div className='flex items-center gap-2 flex-wrap'>
														<KeyRound size={14} className={req.configured ? 'text-emerald-400' : 'text-amber-400'} />
														<span className='text-xs font-semibold'>{req.providerName}</span>
														<code className='text-[11px] px-1.5 py-0.5 rounded bg-void-bg-2 border border-void-border-2'>{req.envVarName}</code>
														<KodiaBadge tone={req.configured ? 'success' : req.classification === 'mandatory' ? 'warning' : 'neutral'}>
															{req.configured ? `Configured (${req.mode})` : `${req.classification} · missing`}
														</KodiaBadge>
													</div>
													<div className='flex items-center gap-1.5 text-[11px]'>
														{req.officialSignupUrl && (
															<button type='button' onClick={() => window.open(req.officialSignupUrl, '_blank', 'noopener,noreferrer')} className='inline-flex items-center gap-1 px-2 py-1 rounded bg-void-bg-2 hover:bg-void-bg-3 border border-void-border-2 cursor-pointer'>
																<ExternalLink size={10} /> Official Account
															</button>
														)}
														{req.officialDocsUrl && (
															<button type='button' onClick={() => window.open(req.officialDocsUrl, '_blank', 'noopener,noreferrer')} className='inline-flex items-center gap-1 px-2 py-1 rounded bg-void-bg-2 hover:bg-void-bg-3 border border-void-border-2 cursor-pointer'>
																<ExternalLink size={10} /> Docs
															</button>
														)}
														<button type='button' onClick={() => setExpandedGuideId(openGuide ? null : req.id)} className='px-2 py-1 rounded bg-void-bg-2 hover:bg-void-bg-3 border border-void-border-2 cursor-pointer'>
															{openGuide ? 'Hide Setup Guide' : 'Step-by-Step Guide'}
														</button>
													</div>
												</div>

												<div className='text-xs text-void-fg-2'>{req.reason} <span className='text-void-fg-3'>· Billing: {req.billingRequirement}</span></div>

												<div className='flex flex-wrap items-center gap-2'>
													<input
														type='password'
														value={secretInputs[req.id] ?? ''}
														onChange={e => setSecretInputs(prev => ({ ...prev, [req.id]: e.target.value }))}
														placeholder={req.maskedValue ? `Stored: ${req.maskedValue} (enter new value to rotate)` : `Paste ${req.envVarName} securely (encrypted in Kodia vault)...`}
														className='flex-1 min-w-[220px] px-2.5 py-1.5 text-xs rounded bg-void-bg-2 border border-void-border-2 font-mono'
													/>
													<KodiaPrimaryButton
														disabled={busy !== null || !(secretInputs[req.id] ?? '').trim()}
														onClick={() => void runAction(`save-${req.id}`, async () => {
															const r = await uabe.configureIntegrationSecret({
																requirementId: req.id,
																envVarName: req.envVarName,
																secretValue: secretInputs[req.id] ?? '',
															});
															setSecretInputs(prev => ({ ...prev, [req.id]: '' }));
															return r.message;
														})}
													>
														Save Securely
													</KodiaPrimaryButton>
													<KodiaSecondaryButton
														disabled={busy !== null}
														onClick={() => void runAction(`test-${req.id}`, async () => (await uabe.testIntegrationConnection(req.id)).message)}
													>
														Test Connection
													</KodiaSecondaryButton>
												</div>

												{req.lastTestMessage && (
													<div className='text-[11px] text-void-fg-3 bg-void-bg-2 px-2.5 py-1.5 rounded border border-void-border-2'>{req.lastTestMessage}</div>
												)}

												{openGuide && (
													<div className='p-3 rounded bg-void-bg-2 border border-void-border-2 text-xs space-y-2'>
														<div className='font-semibold text-void-fg-1'>Step-by-Step Setup Instructions ({req.providerName})</div>
														<ol className='list-decimal pl-5 space-y-1 text-void-fg-2'>
															{req.setupSteps.map((s, i) => <li key={i}>{s}</li>)}
														</ol>
														{req.alternatives.length > 0 && (
															<div className='pt-1 border-t border-void-border-2'>
																<div className='text-[11px] font-semibold text-void-fg-2 mb-1'>Local / Free Alternatives:</div>
																{req.alternatives.map((alt, i) => (
																	<div key={i} className='text-[11px] text-void-fg-3'>• <strong className='text-void-fg-2'>{alt.providerName}:</strong> {alt.note}</div>
																))}
															</div>
														)}
													</div>
												)}
											</KodiaCard>
										);
									})}
								</div>
							)}
						</div>
					)}

					{/* TAB 5: BAAS & CLOUD CATALOG */}
					{activeTab === 'baas' && (
						<div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3'>
							{adapters.map(a => (
								<KodiaCard key={a.id} className='flex flex-col justify-between gap-2.5'>
									<div className='space-y-1.5'>
										<div className='flex items-center justify-between gap-2'>
											<span className='text-xs font-semibold'>{a.name}</span>
											<KodiaBadge tone={a.pricingTier === 'free_available' || a.pricingTier === 'self_hosted_oss' ? 'success' : 'warning'}>
												{a.pricingTier.replace(/_/g, ' ')}
											</KodiaBadge>
										</div>
										<p className='text-[11px] text-void-fg-3'>{a.pricingDisclosure}</p>
										<div className='flex flex-wrap gap-1'>
											{a.capabilities.map(c => (
												<span key={c} className='text-[10px] px-1.5 py-0.5 rounded bg-void-bg-2 border border-void-border-2 text-void-fg-2'>{c}</span>
											))}
										</div>
									</div>
									<div className='flex items-center justify-between gap-2 pt-2 border-t border-void-border-2 text-[11px]'>
										<button type='button' onClick={() => window.open(a.officialDocsUrl, '_blank', 'noopener,noreferrer')} className='inline-flex items-center gap-1 text-sky-300 hover:underline cursor-pointer'>
											<ExternalLink size={10} /> Official Docs
										</button>
										<button
											type='button'
											onClick={() => void runAction(`adopt-${a.id}`, async () => {
												setPreferredStack(prev => prev ? `${prev}, ${a.name}` : a.name);
												await uabe.discoverExternalRequirements(`${state.brief}\nUse ${a.name}`);
												setActiveTab('integrations');
												return `Added ${a.name} to project integration requirements.`;
											})}
											className='px-2 py-1 rounded bg-void-bg-2 hover:bg-void-bg-3 border border-void-border-2 text-void-fg-1 cursor-pointer'
										>
											Add to Project
										</button>
									</div>
								</KodiaCard>
							))}
						</div>
					)}

					{/* TAB 6: HONEST RELIABILITY DASHBOARD */}
					{activeTab === 'reliability' && (
						<div className='flex flex-col gap-3'>
							<KodiaCard className='flex flex-wrap items-center justify-between gap-3'>
								<div className='flex flex-wrap items-center gap-2 flex-1'>
									<input type='text' value={relTestCmd} onChange={e => setRelTestCmd(e.target.value)} placeholder='Optional test command (e.g. npm test)' className='px-2.5 py-1.5 text-xs rounded bg-void-bg-2 border border-void-border-2 font-mono flex-1 min-w-[160px]' />
									<input type='text' value={relBuildCmd} onChange={e => setRelBuildCmd(e.target.value)} placeholder='Optional build command (e.g. npm run build)' className='px-2.5 py-1.5 text-xs rounded bg-void-bg-2 border border-void-border-2 font-mono flex-1 min-w-[160px]' />
								</div>
								<div className='flex flex-wrap items-center gap-1.5'>
									<KodiaSecondaryButton disabled={busy !== null} onClick={() => void runAction('eric-sem', async () => (await fpere.analyzeSemanticCorrectness()).summary)}>
										Semantic Audit
									</KodiaSecondaryButton>
									<KodiaSecondaryButton disabled={busy !== null} onClick={() => void runAction('eric-api', async () => (await fpere.verifyInstalledApiUsage()).summary)}>
										Verify APIs
									</KodiaSecondaryButton>
									<KodiaPrimaryButton disabled={busy !== null} onClick={() => void runAction('rel', async () => {
										const r = await uabe.evaluateReliabilityDashboard({
											runCompiler: true,
											testCommand: relTestCmd.trim() || undefined,
											buildCommand: relBuildCmd.trim() || undefined,
										});
										return r.summary;
									})}>
										{busy === 'rel' ? <Loader2 size={12} className='animate-spin' /> : <ShieldCheck size={12} />}
										<span>Run Truthful Reliability Check</span>
									</KodiaPrimaryButton>
								</div>
							</KodiaCard>

							{state.reliability && (
								<KodiaCard className='flex flex-col gap-3'>
									<div className='flex items-center justify-between gap-2 flex-wrap'>
										<div className='flex items-center gap-2'>
											{state.reliability.overallStatus === 'verified_against_executed_checks'
												? <CheckCircle2 size={16} className='text-emerald-400' />
												: <AlertTriangle size={16} className='text-amber-400' />}
											<span className='text-sm font-semibold'>{state.reliability.summary}</span>
										</div>
										<KodiaBadge tone={state.reliability.overallStatus === 'verified_against_executed_checks' ? 'success' : state.reliability.overallStatus === 'needs_fixes' ? 'danger' : 'warning'}>
											{state.reliability.overallStatus}
										</KodiaBadge>
									</div>

									<div className='grid grid-cols-1 md:grid-cols-2 gap-2'>
										{state.reliability.pillars.map(p => (
											<div key={p.id} className='p-2.5 rounded bg-void-bg-2 border border-void-border-2 flex flex-col gap-1'>
												<div className='flex items-center justify-between gap-2'>
													<span className='text-xs font-medium'>{p.label}</span>
													<KodiaBadge tone={pillarBadgeTone(p.status)}>{p.status.replace(/_/g, ' ')}</KodiaBadge>
												</div>
												<div className='text-[11px] text-void-fg-3'>{p.detail}</div>
											</div>
										))}
									</div>
								</KodiaCard>
							)}
						</div>
					)}

					{/* TAB 7: CLIENT DELIVERY & HANDOVER */}
					{activeTab === 'handover' && (
						<KodiaCard className='flex flex-col gap-3'>
							<div className='flex items-center justify-between flex-wrap gap-2'>
								<div>
									<h2 className='text-sm font-semibold'>Professional Client Delivery &amp; Handover Engine</h2>
									<p className='text-[11px] text-void-fg-3'>Generates architecture docs, install &amp; operations guide, truthful QA report, interactive HTML slide deck, and secret-free .env.example inside handover/.</p>
								</div>
								<div className='flex items-center gap-2'>
									<input type='text' value={clientName} onChange={e => setClientName(e.target.value)} placeholder='Client name' className='px-2.5 py-1.5 text-xs rounded bg-void-bg-2 border border-void-border-2' />
									<KodiaPrimaryButton disabled={busy !== null} onClick={() => void runAction('handover', async () => (await uabe.generateClientHandover({ clientName: clientName.trim() || 'Client Team', projectTitle: appName.trim() || state.name })).summary)}>
										{busy === 'handover' ? <Loader2 size={12} className='animate-spin' /> : <FileCheck2 size={12} />}
										<span>Generate Handover Package</span>
									</KodiaPrimaryButton>
								</div>
							</div>

							{state.lastHandover && (
								<div className='space-y-2 pt-2 border-t border-void-border-2'>
									<div className='flex items-center gap-2 text-xs'>
										<KodiaBadge tone={state.lastHandover.zeroSecretsVerified ? 'success' : 'danger'}>
											{state.lastHandover.zeroSecretsVerified ? 'Zero Secrets Verified' : 'Secret Scan Failed'}
										</KodiaBadge>
										<span className='text-void-fg-2'>{state.lastHandover.summary}</span>
									</div>
									<div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2'>
										{state.lastHandover.filesGenerated.map(f => (
											<div key={f.relativePath} className='p-2.5 rounded bg-void-bg-2 border border-void-border-2 text-xs'>
												<div className='font-mono text-sky-300 text-[11px]'>{f.relativePath}</div>
												<div className='text-[11px] text-void-fg-3 mt-0.5'>{f.description}</div>
											</div>
										))}
									</div>
								</div>
							)}
						</KodiaCard>
					)}

					{/* TAB 8: CHECKPOINTS & LIVE ACTIVITY */}
					{activeTab === 'activity' && (
						<div className='grid grid-cols-1 lg:grid-cols-2 gap-4'>
							<KodiaCard className='flex flex-col gap-2.5'>
								<h2 className='text-sm font-semibold'>Safe File Checkpoints &amp; Rollback ({state.checkpoints.length})</h2>
								{state.checkpoints.length === 0 ? (
									<div className='text-xs text-void-fg-3'>No checkpoints saved yet. Scaffolds and visual edits automatically create safe rollback checkpoints.</div>
								) : (
									<div className='flex flex-col gap-2'>
										{state.checkpoints.map(cp => (
											<div key={cp.id} className='p-2.5 rounded bg-void-bg-2 border border-void-border-2 flex items-center justify-between gap-2 text-xs'>
												<div>
													<div className='font-medium'>{cp.label}</div>
													<div className='text-[10px] text-void-fg-3'>{cp.files.length} file(s) · {new Date(cp.createdAtMs).toLocaleString()}</div>
												</div>
												<KodiaSecondaryButton disabled={busy !== null} onClick={() => void runAction(`rb-${cp.id}`, async () => (await uabe.rollbackCheckpoint(cp.id)).message)}>
													<RotateCcw size={11} /> Rollback
												</KodiaSecondaryButton>
											</div>
										))}
									</div>
								)}
							</KodiaCard>

							<KodiaCard className='flex flex-col gap-2.5'>
								<h2 className='text-sm font-semibold'>Real-Time Engineering Activity Feed</h2>
								<div className='flex flex-col gap-1.5 max-h-96 overflow-y-auto text-[11px]'>
									{state.recentEvents.length === 0 ? (
										<div className='text-void-fg-3'>No activity recorded yet.</div>
									) : state.recentEvents.map(ev => (
										<div key={ev.id} className='px-2.5 py-1.5 rounded bg-void-bg-2 border border-void-border-2 flex items-center justify-between gap-2'>
											<span className='truncate'><span className='font-mono text-sky-300 mr-1.5'>[{ev.phase}]</span>{ev.message}</span>
											<span className='text-[10px] text-void-fg-3 whitespace-nowrap'>{new Date(ev.timestampMs).toLocaleTimeString()}</span>
										</div>
									))}
								</div>
							</KodiaCard>
						</div>
					)}
				</div>
			</main>
		</div>
	);
};
