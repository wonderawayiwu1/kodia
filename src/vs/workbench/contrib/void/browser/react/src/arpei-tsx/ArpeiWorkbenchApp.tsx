/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useState } from 'react';
import {
	Activity,
	AlertTriangle,
	BookOpen,
	Camera,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	Compass,
	ExternalLink,
	Globe,
	History,
	Image,
	Layers,
	Palette,
	Pause,
	Play,
	RefreshCw,
	Rocket,
	Search,
	Sparkles,
	Square,
	X,
} from 'lucide-react';
import '../styles.css';
import { ArpeiResearchMode, ArpeiScreenshotRecord, ArpeiWorkspaceSection } from '../../../../common/arpeiTypes.js';
import { ArpeiWorkbenchState } from '../../../arpeiService.js';
import { useAccessor, useIsDark } from '../util/services.js';

const PIPELINE_STEPS = [
	{ label: '1. Domain', minPct: 10 },
	{ label: '2. Web Search', minPct: 20 },
	{ label: '3. Live Browser', minPct: 45 },
	{ label: '4. Visual Assets', minPct: 80 },
	{ label: '5. Ready', minPct: 95 },
] as const;

const QUICK_EXAMPLES = [
	{ label: 'Udemy (Online Courses)', prompt: 'Udemy', url: 'https://www.udemy.com', desc: 'Inspect real course marketplace UX, web docs, and capture live screenshots.' },
	{ label: 'Stripe (Payments SaaS)', prompt: 'Stripe', url: 'https://stripe.com', desc: 'Explore Stripe product pages, developer docs, pricing, and design system.' },
	{ label: 'Linear (Issue Tracker)', prompt: 'Linear', url: 'https://linear.app', desc: 'Capture modern dark-mode SaaS UI, workflows, and engineering patterns.' },
	{ label: 'Custom AI / RAG App', prompt: 'Modern AI knowledge workspace with hybrid RAG search, document citations, and real-time streaming chat', url: '', desc: 'Run deep technical web search, architecture discovery, and readiness checks.' },
];

export const ArpeiWorkbenchApp: React.FC = () => {
	const isDark = useIsDark();
	const accessor = useAccessor();
	const arpeiService = accessor.get('IArpeiService');
	const chatThreadService = accessor.get('IChatThreadService');
	const commandService = accessor.get('ICommandService');

	const [state, setState] = useState<ArpeiWorkbenchState>(arpeiService.state);
	const [prompt, setPrompt] = useState('');
	const [refUrl, setRefUrl] = useState('');
	const [mode, setMode] = useState<ArpeiResearchMode>('autonomous_research_and_build');
	const [extraUrl, setExtraUrl] = useState('');
	const [extraSearchQuery, setExtraSearchQuery] = useState('');
	const [implUrl, setImplUrl] = useState('');
	const [assetQuery, setAssetQuery] = useState('');
	const [memoryQuery, setMemoryQuery] = useState('');
	const [memoryResult, setMemoryResult] = useState<string | null>(null);
	const [statusMsg, setStatusMsg] = useState<string | null>(null);
	const [showCoverageMatrix, setShowCoverageMatrix] = useState(false);
	const [lightboxShot, setLightboxShot] = useState<ArpeiScreenshotRecord | null>(null);

	useEffect(() => {
		const sub = arpeiService.onDidChange(() => setState(arpeiService.state));
		void arpeiService.refreshFromDisk();
		return () => sub.dispose();
	}, [arpeiService]);

	const session = arpeiService.getActiveSession();
	const activeSection = state.activeSection;

	const startLiveInvestigation = async (overridePrompt?: string, overrideUrl?: string) => {
		const targetPrompt = (overridePrompt ?? prompt).trim();
		const targetUrl = (overrideUrl ?? refUrl).trim();
		if (!targetPrompt || state.isRunning) { return; }
		if (overridePrompt !== undefined) { setPrompt(overridePrompt); }
		if (overrideUrl !== undefined) { setRefUrl(overrideUrl); }
		setStatusMsg(null);
		try {
			const done = await arpeiService.runFullLiveInvestigation({
				userPrompt: targetPrompt,
				referenceUrl: targetUrl || undefined,
				mode,
				maxPages: 4,
			});
			setStatusMsg(`Live investigation complete: ${done.evidence.length} web/doc sources, ${done.pages.filter(p => p.status === 'inspected').length} inspected pages, ${done.screenshots.length} screenshots, ${done.assets.length} assets.`);
		} catch (e) {
			setStatusMsg(`Research error: ${e instanceof Error ? e.message : String(e)}`);
		}
	};

	const sendResearchToKodiaChat = () => {
		const s = arpeiService.getActiveSession();
		if (!s) { return; }
		const reqLines = s.traceability.slice(0, 12).map(t => `- [${t.requirementId}] ${t.productRequirement}`).join('\n');
		const evLines = s.evidence.slice(0, 6).map(e => `- ${e.sourceTitle} (${e.sourceUrl}): ${e.summary.slice(0, 160)}`).join('\n');
		const chatPrompt = [
			`Build this product using the live ARPEI Research Session \`${s.id}\`:`,
			`- **Goal**: ${s.userPrompt}`,
			`- **Domain**: ${s.domainDiscovery.softwareCategory} (${s.domainDiscovery.industry})`,
			`- **Verified Research**: ${s.evidence.length} web/doc sources | ${s.pages.filter(p => p.status === 'inspected').length} inspected pages | ${s.screenshots.length} captured screenshots | ${s.assets.length} assets`,
			reqLines ? `\n**Traced Requirements**:\n${reqLines}` : '',
			evLines ? `\n**Verified Web & Product Evidence**:\n${evLines}` : '',
			`\nQuery \`arpei_query_research_memory\` for session \`${s.id}\` as needed, implement the complete working application, and verify all features end-to-end.`,
		].filter(Boolean).join('\n');

		const tid = chatThreadService.state.currentThreadId;
		void commandService.executeCommand('workbench.view.void');
		if (chatThreadService.streamState[tid]?.isRunning) {
			chatThreadService.enqueueUserMessage(tid, chatPrompt);
		} else {
			void chatThreadService.addUserMessageAndStreamResponse({ userMessage: chatPrompt, threadId: tid });
		}
		setStatusMsg('Sent complete live research blueprint to Kodia AI Chat — building now.');
	};

	const inspectedPagesCount = session?.pages.filter(p => p.status === 'inspected').length ?? 0;
	const restrictedPagesCount = session?.pages.filter(p => p.status === 'restricted').length ?? 0;

	const NAV_ITEMS: readonly { id: ArpeiWorkspaceSection; label: string; badge?: number; icon: React.ReactNode }[] = [
		{ id: 'overview', label: 'Overview', icon: <Compass size={13} /> },
		{ id: 'live_browser', label: 'Live Activity Feed', badge: state.liveEvents.length || undefined, icon: <Activity size={13} /> },
		{ id: 'screenshot_gallery', label: 'Screenshots', badge: session?.screenshots.length || undefined, icon: <Camera size={13} /> },
		{ id: 'reference_explorer', label: 'Inspected Pages', badge: session?.pages.length || undefined, icon: <Globe size={13} /> },
		{ id: 'technical_research', label: 'Web & Docs Search', badge: session?.evidence.length || undefined, icon: <BookOpen size={13} /> },
		{ id: 'design_intelligence', label: 'Design Tokens', icon: <Palette size={13} /> },
		{ id: 'asset_intelligence', label: 'Visual Assets', badge: session?.assets.length || undefined, icon: <Image size={13} /> },
		{ id: 'requirements_traceability', label: 'Readiness & Plan', badge: session?.traceability.length || undefined, icon: <Layers size={13} /> },
		{ id: 'research_history', label: 'Past Sessions', badge: state.sessions.length || undefined, icon: <History size={13} /> },
	];

	const recentEvents = [...state.liveEvents].slice(-6).reverse();

	const renderBody = () => {
		if (!session && activeSection !== 'research_history' && activeSection !== 'live_browser') {
			return (
				<div className='max-w-4xl mx-auto flex flex-col gap-5'>
					<div className='p-6 rounded-xl border border-void-border-2 bg-void-bg-1 flex flex-col gap-4'>
						<div className='flex items-start gap-3.5'>
							<div className='w-11 h-11 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center shrink-0'>
								<Sparkles size={22} className='text-cyan-400' />
							</div>
							<div className='flex flex-col gap-1'>
								<div className='text-base font-semibold text-void-fg-1'>Kodia Live Research Intelligence</div>
								<div className='text-xs text-void-fg-2 leading-relaxed'>
									Enter any product name, website, or software idea above and click <strong>Investigate Live</strong>. Kodia automatically runs live web search, opens real pages in Playwright Chromium, captures desktop &amp; mobile screenshots, extracts UI/design patterns, gathers assets, and creates an actionable blueprint for Kodia Chat.
								</div>
							</div>
						</div>

						<div className='grid grid-cols-1 sm:grid-cols-3 gap-2.5'>
							<div className='p-3 rounded-lg bg-void-bg-2 border border-void-border-2'>
								<div className='font-semibold text-void-fg-1 text-xs flex items-center gap-1.5 mb-1'>
									<Search size={13} className='text-sky-400' /> 1. Live Web &amp; Docs Search
								</div>
								<div className='text-[11px] text-void-fg-3'>Searches live web results &amp; official documentation automatically — no API keys required.</div>
							</div>
							<div className='p-3 rounded-lg bg-void-bg-2 border border-void-border-2'>
								<div className='font-semibold text-void-fg-1 text-xs flex items-center gap-1.5 mb-1'>
									<Camera size={13} className='text-violet-400' /> 2. Live Browser &amp; Screenshots
								</div>
								<div className='text-[11px] text-void-fg-3'>Launches Playwright Chromium, inspects real pages &amp; controls, and renders live screenshots right here.</div>
							</div>
							<div className='p-3 rounded-lg bg-void-bg-2 border border-void-border-2'>
								<div className='font-semibold text-void-fg-1 text-xs flex items-center gap-1.5 mb-1'>
									<Rocket size={13} className='text-emerald-400' /> 3. 1-Click Build in Chat
								</div>
								<div className='text-[11px] text-void-fg-3'>Hands all verified research, design tokens, and requirements straight to Kodia AI Chat to build.</div>
							</div>
						</div>
					</div>

					<div className='p-4 rounded-xl border border-void-border-2 bg-void-bg-1 flex flex-col gap-3'>
						<div className='text-[11px] font-semibold uppercase tracking-wider text-void-fg-3'>Try a 1-Click Live Investigation</div>
						<div className='grid grid-cols-1 sm:grid-cols-2 gap-2.5'>
							{QUICK_EXAMPLES.map(ex => (
								<button
									key={ex.label}
									type='button'
									disabled={state.isRunning}
									onClick={() => void startLiveInvestigation(ex.prompt, ex.url)}
									className='text-left p-3 rounded-lg bg-void-bg-2 hover:bg-void-bg-3 border border-void-border-2 hover:border-sky-500/50 cursor-pointer transition-colors flex flex-col gap-1 disabled:opacity-45'
								>
									<div className='flex items-center justify-between gap-2'>
										<span className='text-xs font-semibold text-void-fg-1'>{ex.label}</span>
										<span className='text-[10px] text-sky-400 font-medium flex items-center gap-0.5'>Run Live <Play size={9} /></span>
									</div>
									<div className='text-[11px] text-void-fg-3'>{ex.desc}</div>
								</button>
							))}
						</div>
					</div>
				</div>
			);
		}

		switch (activeSection) {
			case 'overview':
				return session && (
					<div className='flex flex-col gap-4 text-xs max-w-6xl'>
						{/* Hero Session & Action Card */}
						<div className='p-4 rounded-xl border border-sky-500/30 bg-sky-500/10 flex flex-wrap items-center justify-between gap-3'>
							<div className='min-w-0'>
								<div className='flex items-center gap-2 flex-wrap'>
									<span className='text-sm font-bold text-void-fg-1'>{session.title}</span>
									<span className='px-2 py-0.5 rounded-full bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 text-[10px] font-medium'>
										{session.domainDiscovery.softwareCategory}
									</span>
								</div>
								<div className='text-[11px] text-void-fg-2 mt-1'>{session.summary}</div>
							</div>
							<div className='flex flex-wrap gap-2 shrink-0'>
								<button
									type='button'
									disabled={state.isRunning}
									onClick={() => void startLiveInvestigation(session.userPrompt, session.referenceUrls[0] ?? '')}
									className='px-3 py-1.5 rounded-md bg-void-bg-1 hover:bg-void-bg-3 border border-void-border-2 text-void-fg-1 font-medium flex items-center gap-1.5 cursor-pointer disabled:opacity-45'
								>
									<RefreshCw size={12} className={state.isRunning ? 'animate-spin text-sky-400' : 'text-sky-400'} />
									<span>Re-run Live</span>
								</button>
								<button
									type='button'
									onClick={() => arpeiService.setActiveSection('live_browser')}
									className='px-3 py-1.5 rounded-md bg-void-bg-1 hover:bg-void-bg-3 border border-void-border-2 text-void-fg-1 font-medium flex items-center gap-1.5 cursor-pointer'
								>
									<Activity size={12} className='text-emerald-400' />
									<span>Live Feed ({state.liveEvents.length})</span>
								</button>
								<button
									type='button'
									onClick={sendResearchToKodiaChat}
									className='px-3.5 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-semibold flex items-center gap-1.5 cursor-pointer transition-colors shadow-xs'
								>
									<Rocket size={13} />
									<span>Build App in Kodia Chat</span>
								</button>
							</div>
						</div>

						{/* 4 Crisp Live KPI Cards */}
						<div className='grid grid-cols-2 lg:grid-cols-4 gap-3'>
							<button
								type='button'
								onClick={() => arpeiService.setActiveSection('technical_research')}
								className='text-left p-3.5 rounded-xl border border-void-border-2 bg-void-bg-1 hover:border-sky-500/40 cursor-pointer transition-colors'
							>
								<div className='text-[10px] uppercase tracking-wider text-void-fg-3'>Web &amp; Doc Sources</div>
								<div className='text-2xl font-bold text-sky-400 mt-1'>{session.evidence.length}</div>
								<div className='text-[10px] text-void-fg-3 mt-0.5'>Click to view verified findings</div>
							</button>
							<button
								type='button'
								onClick={() => arpeiService.setActiveSection('reference_explorer')}
								className='text-left p-3.5 rounded-xl border border-void-border-2 bg-void-bg-1 hover:border-cyan-500/40 cursor-pointer transition-colors'
							>
								<div className='text-[10px] uppercase tracking-wider text-void-fg-3'>Live Pages Inspected</div>
								<div className='text-2xl font-bold text-cyan-400 mt-1'>
									{inspectedPagesCount}
									<span className='text-xs font-normal text-void-fg-3 ml-1'>/ {session.pages.length}</span>
								</div>
								<div className='text-[10px] text-void-fg-3 mt-0.5'>
									{session.interactions.length} interactions{restrictedPagesCount > 0 ? ` · ${restrictedPagesCount} restricted` : ''}
								</div>
							</button>
							<button
								type='button'
								onClick={() => arpeiService.setActiveSection('screenshot_gallery')}
								className='text-left p-3.5 rounded-xl border border-void-border-2 bg-void-bg-1 hover:border-violet-500/40 cursor-pointer transition-colors'
							>
								<div className='text-[10px] uppercase tracking-wider text-void-fg-3'>Live Screenshots</div>
								<div className='text-2xl font-bold text-violet-400 mt-1'>{session.screenshots.length}</div>
								<div className='text-[10px] text-void-fg-3 mt-0.5'>{session.assets.length} visual asset(s) saved</div>
							</button>
							<button
								type='button'
								onClick={() => arpeiService.setActiveSection('requirements_traceability')}
								className='text-left p-3.5 rounded-xl border border-void-border-2 bg-void-bg-1 hover:border-emerald-500/40 cursor-pointer transition-colors'
							>
								<div className='text-[10px] uppercase tracking-wider text-void-fg-3'>Readiness Gate</div>
								<div className={`text-sm font-bold uppercase mt-2 ${session.readinessGate.readyToImplement ? 'text-emerald-400' : 'text-amber-400'}`}>
									{session.readinessGate.verdict.replace(/_/g, ' ')}
								</div>
								<div className='text-[10px] text-void-fg-3 mt-1'>{session.traceability.length} traced requirements</div>
							</button>
						</div>

						{session.domainDiscovery.requiresQualifiedHumanReview && (
							<div className='p-3 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-200 flex items-start gap-2'>
								<AlertTriangle size={14} className='shrink-0 mt-0.5' />
								<div><strong>Regulated / High-Consequence Domain:</strong> {session.domainDiscovery.humanReviewReason}</div>
							</div>
						)}

						{/* Live Visual Screenshot Strip */}
						<div className='p-4 rounded-xl border border-void-border-2 bg-void-bg-1 flex flex-col gap-3'>
							<div className='flex items-center justify-between gap-2'>
								<div className='font-semibold text-void-fg-1 flex items-center gap-1.5'>
									<Camera size={14} className='text-violet-400' />
									<span>Live Captured Screenshots ({session.screenshots.length})</span>
								</div>
								{session.screenshots.length > 0 && (
									<button
										type='button'
										onClick={() => arpeiService.setActiveSection('screenshot_gallery')}
										className='text-[11px] text-sky-400 hover:underline cursor-pointer'
									>
										View full gallery &rarr;
									</button>
								)}
							</div>
							{session.screenshots.length > 0 ? (
								<div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3'>
									{session.screenshots.slice(0, 6).map(sc => (
										<button
											key={sc.id}
											type='button'
											onClick={() => setLightboxShot(sc)}
											className='text-left rounded-lg overflow-hidden border border-void-border-2 bg-void-bg-2 hover:border-sky-500/50 cursor-pointer transition-colors flex flex-col'
										>
											{sc.thumbnailDataUrl ? (
												<img
													src={sc.thumbnailDataUrl}
													alt={sc.pageTitle}
													className='w-full h-36 object-cover object-top bg-black/30 block'
												/>
											) : (
												<div className='w-full h-36 bg-void-bg-3 flex items-center justify-center text-void-fg-3 text-[11px]'>
													Saved on disk ({sc.viewport.width}x{sc.viewport.height})
												</div>
											)}
											<div className='p-2.5 flex flex-col gap-0.5'>
												<div className='flex items-center justify-between gap-1'>
													<span className='font-semibold text-void-fg-1 truncate'>{sc.pageTitle}</span>
													<span className='text-[10px] text-violet-400 shrink-0'>{sc.viewport.width}x{sc.viewport.height}</span>
												</div>
												<div className='font-mono text-[10px] text-void-fg-3 truncate'>{sc.sourceUrl}</div>
											</div>
										</button>
									))}
								</div>
							) : (
								<div className='p-4 rounded-lg bg-void-bg-2 border border-void-border-2 text-void-fg-3 text-[11px] flex flex-wrap items-center justify-between gap-2'>
									<span>
										{state.isRunning
											? 'Playwright Chromium is navigating & capturing live screenshots right now...'
											: restrictedPagesCount > 0
												? `The target site returned an anti-bot/access restriction (${restrictedPagesCount} restricted page). Try entering a public docs, demo, or competitor URL in Inspected Pages.`
												: 'No screenshots captured yet. Click "Re-run Live" or inspect a specific URL in Inspected Pages.'}
									</span>
									<button
										type='button'
										onClick={() => arpeiService.setActiveSection('reference_explorer')}
										className='px-2.5 py-1 rounded bg-void-bg-1 border border-void-border-2 text-void-fg-1 hover:bg-void-bg-3 cursor-pointer'
									>
										Inspect a URL
									</button>
								</div>
							)}
						</div>

						{/* Top Live Web & Product Findings */}
						<div className='p-4 rounded-xl border border-void-border-2 bg-void-bg-1 flex flex-col gap-2.5'>
							<div className='flex items-center justify-between gap-2'>
								<div className='font-semibold text-void-fg-1 flex items-center gap-1.5'>
									<BookOpen size={14} className='text-sky-400' />
									<span>Verified Web &amp; Product Findings ({session.evidence.length})</span>
								</div>
								<button
									type='button'
									onClick={() => arpeiService.setActiveSection('technical_research')}
									className='text-[11px] text-sky-400 hover:underline cursor-pointer'
								>
									Search &amp; view all &rarr;
								</button>
							</div>
							{session.evidence.length > 0 ? (
								<div className='grid grid-cols-1 md:grid-cols-2 gap-2.5'>
									{session.evidence.slice(0, 6).map(ev => (
										<div key={ev.id} className='p-3 rounded-lg bg-void-bg-2 border border-void-border-2 flex flex-col gap-1'>
											<div className='flex items-start justify-between gap-2'>
												<span className='font-semibold text-void-fg-1 leading-snug'>{ev.sourceTitle}</span>
												<span className='text-[10px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 shrink-0'>
													{ev.sourceKind.replace(/_/g, ' ')}
												</span>
											</div>
											<div className='font-mono text-[10px] text-cyan-400 truncate'>{ev.sourceUrl}</div>
											<div className='text-[11px] text-void-fg-2 line-clamp-3 leading-relaxed'>{ev.summary}</div>
										</div>
									))}
								</div>
							) : (
								<div className='text-[11px] text-void-fg-3'>
									{state.isRunning ? 'Searching the web & verifying sources live...' : 'No external web evidence recorded yet.'}
								</div>
							)}
						</div>

						{/* Collapsible 18-Category Deep Discovery Coverage Matrix */}
						<div className='rounded-xl border border-void-border-2 bg-void-bg-1 overflow-hidden'>
							<button
								type='button'
								onClick={() => setShowCoverageMatrix(v => !v)}
								className='w-full px-4 py-3 flex items-center justify-between text-left hover:bg-void-bg-2 cursor-pointer transition-colors'
							>
								<span className='font-semibold text-void-fg-1 flex items-center gap-1.5'>
									{showCoverageMatrix ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
									<span>18-Category Deep Discovery Coverage Matrix</span>
								</span>
								<span className='text-[11px] text-void-fg-3'>
									{session.deepDiscoveryCoverage.filter(c => c.status !== 'not_investigated').length} / {session.deepDiscoveryCoverage.length} covered
								</span>
							</button>
							{showCoverageMatrix && (
								<div className='p-4 pt-1 grid grid-cols-1 md:grid-cols-3 gap-2 border-t border-void-border-2'>
									{session.deepDiscoveryCoverage.map(c => (
										<div key={c.category} className='p-2.5 rounded-lg bg-void-bg-2 border border-void-border-2'>
											<div className='flex justify-between gap-2 font-medium'>
												<span className='text-void-fg-1'>{c.label}</span>
												<span className='text-[10px] text-sky-400 shrink-0'>{c.status.replace(/_/g, ' ')}</span>
											</div>
											<div className='text-[10px] text-void-fg-3 mt-1 leading-snug'>{c.summary}</div>
										</div>
									))}
								</div>
							)}
						</div>
					</div>
				);

			case 'live_browser':
				return (
					<div className='flex flex-col gap-4 text-xs max-w-5xl'>
						<div className='p-4 rounded-xl border border-void-border-2 bg-void-bg-1 flex flex-wrap items-center justify-between gap-3'>
							<div className='min-w-0'>
								<div className='font-semibold text-void-fg-1 flex items-center gap-2'>
									<span className={`w-2.5 h-2.5 rounded-full ${state.isRunning || state.activeBrowserStatus.running ? 'bg-emerald-400 animate-pulse' : 'bg-void-fg-3'}`} />
									<span>Live Engine Status: {state.isRunning || state.activeBrowserStatus.running ? 'ACTIVE' : 'IDLE'}</span>
								</div>
								<div className='text-[11px] text-void-fg-2 mt-1'>
									{state.activeStage ?? state.activeBrowserStatus.currentAction ?? 'Ready — click Investigate Live above to watch web search, browser navigation, and screenshot capture in real time.'}
								</div>
								{state.activeBrowserStatus.currentUrl && (
									<div className='font-mono text-[10px] text-cyan-400 mt-0.5 truncate'>{state.activeBrowserStatus.currentUrl}</div>
								)}
							</div>
							<div className='flex gap-1.5 shrink-0'>
								<button type='button' onClick={() => void arpeiService.pauseActiveResearch()} className='px-2.5 py-1.5 rounded-md bg-void-bg-2 hover:bg-void-bg-3 border border-void-border-2 flex items-center gap-1 cursor-pointer'><Pause size={11} /> Pause</button>
								<button type='button' onClick={() => void arpeiService.resumeActiveResearch()} className='px-2.5 py-1.5 rounded-md bg-void-bg-2 hover:bg-void-bg-3 border border-void-border-2 flex items-center gap-1 cursor-pointer'><Play size={11} /> Resume</button>
								<button type='button' onClick={() => void arpeiService.cancelActiveResearch()} className='px-2.5 py-1.5 rounded-md bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/40 flex items-center gap-1 cursor-pointer'><Square size={11} /> Stop</button>
							</div>
						</div>

						<div className='p-4 rounded-xl border border-void-border-2 bg-void-bg-1 flex flex-col gap-2'>
							<div className='font-semibold text-void-fg-1'>Real-Time Activity Stream ({state.liveEvents.length})</div>
							{state.liveEvents.length > 0 ? (
								<div className='flex flex-col gap-1.5'>
									{[...state.liveEvents].reverse().map(ev => (
										<div key={ev.eventId} className='p-2.5 rounded-lg bg-void-bg-2 border border-void-border-2 flex flex-col gap-0.5'>
											<div className='flex items-center justify-between gap-2'>
												<span className={`font-mono text-[10px] font-semibold uppercase ${ev.status === 'error' || ev.status === 'blocked' ? 'text-amber-400' : 'text-cyan-400'}`}>
													{ev.type.replace(/_/g, ' ')}
												</span>
												<span className='text-[10px] text-void-fg-3'>{new Date(ev.timestamp).toLocaleTimeString()}</span>
											</div>
											<div className='text-[11px] text-void-fg-1'>{ev.detail}</div>
											{ev.url && <div className='font-mono text-[10px] text-sky-400 truncate'>{ev.url}</div>}
										</div>
									))}
								</div>
							) : (
								<div className='text-[11px] text-void-fg-3 py-4 text-center'>No live events recorded yet. Start an investigation above to watch every step live.</div>
							)}
						</div>

						{session && session.interactions.length > 0 && (
							<div className='p-4 rounded-xl border border-void-border-2 bg-void-bg-1 flex flex-col gap-2'>
								<div className='font-semibold text-void-fg-1'>Observed UI Control Interactions ({session.interactions.length})</div>
								{session.interactions.map(int => (
									<div key={int.id} className='p-2.5 rounded-lg bg-void-bg-2 border border-void-border-2'>
										<div className='flex items-center justify-between gap-2'>
											<span className='font-medium text-void-fg-1'>{int.actionKind.toUpperCase()}: {int.label}</span>
											<span className={`text-[10px] font-semibold ${int.outcomeChangedDomOrUrl ? 'text-emerald-400' : 'text-void-fg-3'}`}>
												{int.outcomeChangedDomOrUrl ? 'DOM/URL Updated' : 'No Change'}
											</span>
										</div>
										<div className='text-[11px] text-void-fg-2 mt-0.5'>{int.observedBehavior}</div>
									</div>
								))}
							</div>
						)}
					</div>
				);

			case 'reference_explorer':
				return session && (
					<div className='flex flex-col gap-4 text-xs max-w-5xl'>
						{/* Live Inspect Additional URL Bar */}
						<div className='p-3.5 rounded-xl border border-void-border-2 bg-void-bg-1 flex flex-wrap items-center gap-2'>
							<Globe size={14} className='text-cyan-400 shrink-0' />
							<input
								value={extraUrl}
								onChange={e => setExtraUrl(e.target.value)}
								placeholder='Inspect any public website URL live (e.g. https://docs.stripe.com)...'
								className='flex-1 min-w-[220px] px-3 py-1.5 rounded-md bg-void-bg-2 border border-void-border-2 text-void-fg-1 text-xs focus:border-sky-500/70 focus:outline-none'
							/>
							<button
								type='button'
								disabled={state.isRunning || !extraUrl.trim()}
								onClick={async () => {
									const url = extraUrl.trim().startsWith('http') ? extraUrl.trim() : `https://${extraUrl.trim()}`;
									setExtraUrl('');
									await arpeiService.exploreReferenceProduct({
										sessionId: session.id,
										rootUrl: url,
										discoverReferences: false,
										maxPages: 3,
										captureScreenshots: true,
										testInteractions: true,
									});
								}}
								className='px-3 py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 disabled:opacity-45 text-white font-medium cursor-pointer flex items-center gap-1'
							>
								<Play size={11} /> Inspect Live
							</button>
						</div>

						{session.referenceCoverage.map(cov => (
							<div key={cov.rootUrl} className='p-4 rounded-xl border border-void-border-2 bg-void-bg-1'>
								<div className='font-semibold text-void-fg-1 mb-1'>Reference Coverage: {cov.rootUrl}</div>
								<div className='text-[11px] text-void-fg-3 mb-3'>
									Inspected {cov.inspectedPagesCount}/{cov.discoveredPagesCount} pages · Restricted: {cov.restrictedPagesCount} · Screenshots: {cov.screenshotsCapturedCount} · Interactions: {cov.interactionsTestedCount}
								</div>
								<div className='grid grid-cols-2 md:grid-cols-4 gap-2'>
									{cov.rows.map(r => (
										<div key={r.area} className='p-2.5 rounded-lg bg-void-bg-2 border border-void-border-2'>
											<div className='font-medium text-void-fg-1'>{r.area}</div>
											<div className='text-[10px] text-sky-400 uppercase mt-0.5'>{r.status.replace(/_/g, ' ')}</div>
											<div className='text-[10px] text-void-fg-3 mt-0.5'>{r.notes}</div>
										</div>
									))}
								</div>
							</div>
						))}

						<div className='flex flex-col gap-2'>
							<div className='font-semibold text-void-fg-1'>Visited &amp; Discovered Pages ({session.pages.length})</div>
							{session.pages.map(pg => (
								<div key={pg.url} className='p-3 rounded-xl border border-void-border-2 bg-void-bg-1 flex flex-col gap-1.5'>
									<div className='flex items-start justify-between gap-2'>
										<div className='min-w-0'>
											<div className='font-semibold text-void-fg-1 truncate'>{pg.title}</div>
											<div className='font-mono text-[10px] text-cyan-400 truncate'>{pg.url}</div>
										</div>
										<span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase shrink-0 ${pg.status === 'inspected' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'}`}>
											{pg.status}
										</span>
									</div>
									<div className='text-[11px] text-void-fg-3'>
										Layer: {pg.layer.replace(/_/g, ' ')} · Interactive Elements: {pg.interactiveElementsCount} · Forms: {pg.formsCount} · Screenshots: {pg.screenshotIds.length}
										{pg.restrictionReason ? ` · ${pg.restrictionReason}` : ''}
									</div>
									{pg.navigationItems.length > 0 && (
										<div className='flex flex-wrap gap-1 pt-1'>
											{pg.navigationItems.slice(0, 10).map((nav, idx) => (
												<span key={idx} className='px-1.5 py-0.5 rounded bg-void-bg-2 border border-void-border-2 text-[10px] text-void-fg-2'>{nav}</span>
											))}
										</div>
									)}
								</div>
							))}
							{session.pages.length === 0 && (
								<div className='p-4 rounded-xl border border-void-border-2 bg-void-bg-1 text-void-fg-3 text-center'>
									No pages inspected yet. Enter a public URL above and click Inspect Live.
								</div>
							)}
						</div>
					</div>
				);

			case 'screenshot_gallery':
				return session && (
					<div className='flex flex-col gap-4 text-xs max-w-6xl'>
						<div className='p-3.5 rounded-xl border border-void-border-2 bg-void-bg-1 flex flex-wrap items-center gap-2'>
							<span className='font-semibold text-void-fg-1'>Compare Reference vs Your Local App:</span>
							<input
								value={implUrl}
								onChange={e => setImplUrl(e.target.value)}
								placeholder='Your local app URL (e.g. http://localhost:5173)'
								className='flex-1 min-w-[200px] px-2.5 py-1.5 rounded-md bg-void-bg-2 border border-void-border-2 text-void-fg-1 text-xs focus:outline-none'
							/>
							<button
								type='button'
								disabled={!implUrl.trim() || session.screenshots.length === 0 || state.isRunning}
								onClick={async () => {
									const refShot = session.screenshots.find(s => s.kind === 'reference') ?? session.screenshots[0];
									if (!refShot) { return; }
									const cmp = await arpeiService.compareReferenceVsImplementation({ sessionId: session.id, referenceScreenshotId: refShot.id, implementationUrl: implUrl.trim() });
									setStatusMsg(`Visual comparison: ${cmp.similarityPct}% similarity (${cmp.diffPercentage}% pixel diff).`);
								}}
								className='px-3 py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 text-white font-medium disabled:opacity-40 cursor-pointer'
							>
								Compare Visually
							</button>
						</div>

						{session.visualComparisons.map(c => (
							<div key={c.id} className='p-3.5 rounded-xl border border-void-border-2 bg-void-bg-1'>
								<div className='font-semibold text-void-fg-1'>{c.pageLabel} ({c.viewport.width}x{c.viewport.height}) — {c.similarityPct}% visual similarity ({c.diffPercentage}% pixel diff)</div>
								<div className='text-[11px] text-amber-300 mt-1'>{c.functionalVerificationNote}</div>
							</div>
						))}

						{session.screenshots.length > 0 ? (
							<div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
								{session.screenshots.map(sc => (
									<div key={sc.id} className='rounded-xl overflow-hidden border border-void-border-2 bg-void-bg-1 flex flex-col'>
										<button
											type='button'
											onClick={() => setLightboxShot(sc)}
											className='w-full bg-black/30 cursor-pointer hover:opacity-95 transition-opacity block'
											title='Click to zoom full screenshot'
										>
											{sc.thumbnailDataUrl ? (
												<img
													src={sc.thumbnailDataUrl}
													alt={sc.pageTitle}
													className='w-full h-56 object-cover object-top block'
												/>
											) : (
												<div className='w-full h-44 flex items-center justify-center text-void-fg-3 text-xs'>
													PNG stored at {sc.filePath}
												</div>
											)}
										</button>
										<div className='p-3 flex flex-col gap-1'>
											<div className='flex items-center justify-between gap-2'>
												<span className='font-semibold text-void-fg-1 truncate'>{sc.pageTitle}</span>
												<span className='text-[10px] px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-300 shrink-0'>
													{sc.kind} · {sc.viewport.width}x{sc.viewport.height}
												</span>
											</div>
											<div className='font-mono text-[10px] text-cyan-400 truncate'>{sc.sourceUrl}</div>
											<div className='text-[11px] text-void-fg-2'>{sc.description}</div>
											{sc.componentObservations.length > 0 && (
												<div className='flex flex-wrap gap-1 pt-1'>
													{sc.componentObservations.slice(0, 5).map((obs, i) => (
														<span key={i} className='px-1.5 py-0.5 rounded bg-void-bg-2 border border-void-border-2 text-[10px] text-void-fg-3 truncate max-w-[200px]'>{obs}</span>
													))}
												</div>
											)}
										</div>
									</div>
								))}
							</div>
						) : (
							<div className='p-6 rounded-xl border border-void-border-2 bg-void-bg-1 text-center text-void-fg-3'>
								No screenshots captured yet for this session. Run a live investigation or inspect a public URL in <strong>Inspected Pages</strong>.
							</div>
						)}
					</div>
				);

			case 'technical_research':
				return session && (
					<div className='flex flex-col gap-4 text-xs max-w-5xl'>
						{/* Live Web Search Bar */}
						<div className='p-3.5 rounded-xl border border-void-border-2 bg-void-bg-1 flex flex-wrap gap-2'>
							<input
								value={extraSearchQuery}
								onChange={e => setExtraSearchQuery(e.target.value)}
								onKeyDown={e => {
									if (e.key === 'Enter' && extraSearchQuery.trim() && !state.isRunning) {
										const q = extraSearchQuery.trim();
										setExtraSearchQuery('');
										void arpeiService.researchTechnicalAndDomain({ sessionId: session.id, queries: [q] });
									}
								}}
								placeholder='Run an additional live web & documentation search...'
								className='flex-1 min-w-[220px] px-3 py-1.5 rounded-md bg-void-bg-2 border border-void-border-2 text-void-fg-1 text-xs focus:border-sky-500/70 focus:outline-none'
							/>
							<button
								type='button'
								disabled={state.isRunning || !extraSearchQuery.trim()}
								onClick={async () => {
									const q = extraSearchQuery.trim();
									setExtraSearchQuery('');
									await arpeiService.researchTechnicalAndDomain({ sessionId: session.id, queries: [q] });
								}}
								className='px-3 py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 disabled:opacity-45 text-white font-medium flex items-center gap-1 cursor-pointer'
							>
								<Search size={11} /> Search Web Live
							</button>
						</div>

						{/* Memory Filter */}
						<div className='p-3 rounded-xl border border-void-border-2 bg-void-bg-1 flex gap-2'>
							<input
								value={memoryQuery}
								onChange={e => setMemoryQuery(e.target.value)}
								placeholder='Filter saved project research memory...'
								className='flex-1 px-2.5 py-1.5 rounded-md bg-void-bg-2 border border-void-border-2 text-void-fg-1 text-xs focus:outline-none'
							/>
							<button
								type='button'
								onClick={async () => {
									const res = await arpeiService.queryResearchMemory(memoryQuery, session.id);
									setMemoryResult(`Matched ${res.matchedEvidence.length} sources, ${res.matchedScreenshots.length} screenshots, ${res.matchedRequirements.length} requirements, ${res.matchedAssets.length} assets (${res.staleEvidenceCount} stale).`);
								}}
								className='px-3 py-1.5 rounded-md bg-void-bg-2 hover:bg-void-bg-3 border border-void-border-2 text-void-fg-1 flex items-center gap-1 cursor-pointer'
							>
								<Search size={11} /> Query Memory
							</button>
						</div>
						{memoryResult && <div className='text-sky-300 text-[11px]'>{memoryResult}</div>}

						<div className='flex flex-col gap-2.5'>
							{session.evidence.map(ev => (
								<div key={ev.id} className='p-3.5 rounded-xl border border-void-border-2 bg-void-bg-1 flex flex-col gap-1'>
									<div className='flex items-start justify-between gap-2'>
										<span className='font-semibold text-void-fg-1'>{ev.sourceTitle}</span>
										<span className='text-[10px] px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300 shrink-0'>
											{ev.epistemicStatus.replace(/_/g, ' ')} · {Math.round(ev.confidence * 100)}%
										</span>
									</div>
									<div className='font-mono text-[10px] text-cyan-400 truncate flex items-center gap-1'>
										<ExternalLink size={10} className='shrink-0' />
										<span>{ev.sourceUrl}</span>
									</div>
									<div className='text-void-fg-2 leading-relaxed mt-0.5'>{ev.summary}</div>
								</div>
							))}
							{session.evidence.length === 0 && (
								<div className='p-6 rounded-xl border border-void-border-2 bg-void-bg-1 text-center text-void-fg-3'>
									No web sources gathered yet. Type a query above and click <strong>Search Web Live</strong>.
								</div>
							)}
						</div>
					</div>
				);

			case 'design_intelligence':
				return session?.designSpec ? (
					<div className='flex flex-col gap-4 text-xs max-w-5xl'>
						<div className='p-4 rounded-xl border border-void-border-2 bg-void-bg-1 flex flex-col gap-3'>
							<div className='font-semibold text-sm text-void-fg-1'>Extracted Design Specification ({session.designSpec.fidelityMode.replace(/_/g, ' ')})</div>
							<div className='text-void-fg-2'>{session.designSpec.visualDirection}</div>
							<div className='flex flex-wrap gap-2'>
								{session.designSpec.palette.map(c => (
									<div key={c.token} className='flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-void-bg-2 border border-void-border-2'>
										<span className='w-4 h-4 rounded border border-white/20 shrink-0' style={{ backgroundColor: c.hex }} />
										<span className='font-mono text-[11px]'>{c.token}: {c.hex}</span>
									</div>
								))}
							</div>
							<div className='grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-1'>
								<div className='p-3 rounded-lg bg-void-bg-2 border border-void-border-2'>
									<div className='text-[10px] uppercase text-void-fg-3'>Typography</div>
									<div className='text-void-fg-1 font-medium mt-0.5'>{session.designSpec.typography.headingFont} / {session.designSpec.typography.bodyFont}</div>
								</div>
								<div className='p-3 rounded-lg bg-void-bg-2 border border-void-border-2'>
									<div className='text-[10px] uppercase text-void-fg-3'>Navigation Pattern</div>
									<div className='text-void-fg-1 mt-0.5'>{session.designSpec.navigationPattern}</div>
								</div>
							</div>
							<div className='text-[11px] text-void-fg-3 italic'>{session.designSpec.originalityDisclaimer}</div>
						</div>
					</div>
				) : (
					<div className='p-6 rounded-xl border border-void-border-2 bg-void-bg-1 text-xs text-void-fg-3 max-w-3xl'>
						Inspect a public website in <strong>Inspected Pages</strong> or run <strong>Investigate Live</strong> to extract live colors, fonts, and navigation patterns.
					</div>
				);

			case 'asset_intelligence':
				return session && (
					<div className='flex flex-col gap-4 text-xs max-w-5xl'>
						<div className='p-3.5 rounded-xl border border-void-border-2 bg-void-bg-1 flex gap-2'>
							<input
								value={assetQuery}
								onChange={e => setAssetQuery(e.target.value)}
								placeholder='Search & download licensed assets (e.g. online learning hero illustration)'
								className='flex-1 px-3 py-1.5 rounded-md bg-void-bg-2 border border-void-border-2 text-void-fg-1 text-xs focus:outline-none'
							/>
							<button
								type='button'
								disabled={state.isRunning || !assetQuery.trim()}
								onClick={async () => {
									const q = assetQuery.trim();
									setAssetQuery('');
									await arpeiService.discoverAndDownloadAssets({ sessionId: session.id, queries: [{ query: q, usage: 'application-visual', altText: q }], downloadToLocal: true });
								}}
								className='px-3 py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 disabled:opacity-45 text-white font-medium cursor-pointer'
							>
								Discover &amp; Download
							</button>
						</div>
						<div className='grid grid-cols-1 md:grid-cols-2 gap-3'>
							{session.assets.map(a => (
								<div key={a.id} className='p-3.5 rounded-xl border border-void-border-2 bg-void-bg-1 flex flex-col gap-1'>
									<div className='flex justify-between gap-2 font-semibold'>
										<span className='text-void-fg-1 truncate'>{a.altText}</span>
										<span className='text-emerald-400 text-[10px] uppercase shrink-0'>{a.downloadStatus.replace(/_/g, ' ')}</span>
									</div>
									<div className='text-[11px] text-void-fg-3'>Source: {a.source} · License: {a.license}</div>
									{a.localPath && <div className='font-mono text-[10px] text-cyan-400 truncate'>{a.localPath}</div>}
								</div>
							))}
						</div>
					</div>
				);

			case 'requirements_traceability':
				return session && (
					<div className='flex flex-col gap-4 text-xs max-w-5xl'>
						<div className='p-4 rounded-xl border border-void-border-2 bg-void-bg-1'>
							<div className='flex justify-between items-center mb-3'>
								<span className='font-semibold text-void-fg-1'>13-Point Pre-Implementation Research Readiness Gate</span>
								<span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${session.readinessGate.readyToImplement ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'}`}>
									{session.readinessGate.verdict.replace(/_/g, ' ')}
								</span>
							</div>
							<div className='grid grid-cols-1 md:grid-cols-2 gap-2'>
								{session.readinessGate.checks.map(ch => (
									<div key={ch.id} className='p-2 rounded-lg bg-void-bg-2 border border-void-border-2 flex justify-between gap-2'>
										<span className='text-void-fg-1'>{ch.label}</span>
										<span className={`text-[10px] font-semibold shrink-0 ${ch.status === 'satisfied' ? 'text-emerald-400' : 'text-amber-400'}`}>
											{ch.status.replace(/_/g, ' ')}
										</span>
									</div>
								))}
							</div>
						</div>
						<div className='font-semibold text-void-fg-1'>Traced Product Requirements ({session.traceability.length})</div>
						<div className='flex flex-col gap-2'>
							{session.traceability.map(tr => (
								<div key={tr.requirementId} className='p-3 rounded-xl border border-void-border-2 bg-void-bg-1'>
									<div className='flex justify-between gap-2 font-semibold'>
										<span className='text-void-fg-1'>{tr.requirementId} · {tr.origin.replace(/_/g, ' ')}</span>
										<span className='text-[10px] text-sky-400 uppercase'>{tr.verificationStatus.replace(/_/g, ' ')}</span>
									</div>
									<div className='text-void-fg-1 mt-1'>{tr.productRequirement}</div>
									<div className='text-[11px] text-void-fg-3 mt-0.5'>Architecture: {tr.architecturalDecision}</div>
								</div>
							))}
						</div>
					</div>
				);

			case 'research_history':
				return (
					<div className='flex flex-col gap-2.5 text-xs max-w-4xl'>
						<div className='font-semibold text-void-fg-1'>Saved Research Sessions ({state.sessions.length})</div>
						{state.sessions.map(s => (
							<button
								key={s.id}
								type='button'
								onClick={() => { arpeiService.setActiveSession(s.id); arpeiService.setActiveSection('overview'); }}
								className={`text-left p-3.5 rounded-xl border cursor-pointer transition-colors ${s.id === session?.id ? 'border-sky-500/60 bg-sky-500/10' : 'border-void-border-2 bg-void-bg-1 hover:bg-void-bg-2'}`}
							>
								<div className='flex justify-between gap-2 font-semibold'>
									<span className='text-void-fg-1'>{s.title}</span>
									<span className='text-void-fg-3 text-[11px] shrink-0'>{new Date(s.createdAt).toLocaleString()}</span>
								</div>
								<div className='text-void-fg-2 mt-1'>{s.summary}</div>
								<div className='text-[10px] text-void-fg-3 mt-1.5'>
									{s.evidence.length} sources · {s.pages.length} pages · {s.screenshots.length} screenshots · {s.assets.length} assets
								</div>
							</button>
						))}
						{state.sessions.length === 0 && (
							<div className='p-6 rounded-xl border border-void-border-2 bg-void-bg-1 text-center text-void-fg-3'>
								No saved research sessions yet.
							</div>
						)}
					</div>
				);
		}
	};

	return (
		<div
			className={`@@void-scope ${isDark ? 'dark' : ''}`}
			style={{ width: '100%', height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
		>
			<div
				className='flex-1 flex flex-col bg-void-bg-3 text-void-fg-1'
				style={{ minHeight: 0, overflow: 'hidden' }}
			>
				{/* Top Research Command Bar */}
				<div className='flex flex-wrap items-center gap-2 px-3.5 py-2.5 border-b border-void-border-2 bg-void-bg-2 text-xs shrink-0'>
					<div className='flex items-center gap-2 font-semibold mr-1'>
						<div className='w-6 h-6 rounded-md bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center'>
							<Compass size={14} className='text-cyan-400' />
						</div>
						<span className='tracking-tight text-void-fg-1'>Research Intelligence</span>
					</div>
					<input
						value={prompt}
						onChange={e => setPrompt(e.target.value)}
						onKeyDown={e => { if (e.key === 'Enter' && prompt.trim() && !state.isRunning) { void startLiveInvestigation(); } }}
						placeholder='Enter product or idea to research live (e.g. Udemy, Stripe, AI CRM)...'
						className='flex-1 min-w-[220px] px-3 py-1.5 rounded-md bg-void-bg-1 border border-void-border-2 text-void-fg-1 placeholder:text-void-fg-3 text-xs focus:border-sky-500/70 focus:outline-none'
					/>
					<input
						value={refUrl}
						onChange={e => setRefUrl(e.target.value)}
						onKeyDown={e => { if (e.key === 'Enter' && prompt.trim() && !state.isRunning) { void startLiveInvestigation(); } }}
						placeholder='Optional URL (https://...)'
						className='w-52 px-3 py-1.5 rounded-md bg-void-bg-1 border border-void-border-2 text-void-fg-1 placeholder:text-void-fg-3 text-xs focus:border-sky-500/70 focus:outline-none'
					/>
					<select
						value={mode}
						onChange={e => setMode(e.target.value as ArpeiResearchMode)}
						className='px-2.5 py-1.5 rounded-md bg-void-bg-1 border border-void-border-2 text-void-fg-1 text-xs cursor-pointer focus:outline-none'
					>
						<option value='autonomous_research_and_build'>Research &amp; Build</option>
						<option value='research_only'>Research Only</option>
						<option value='plan_first'>Plan First</option>
						<option value='existing_project_enhancement'>Enhance Project</option>
					</select>
					{state.isRunning ? (
						<button
							type='button'
							onClick={() => void arpeiService.cancelActiveResearch()}
							className='px-3.5 py-1.5 rounded-md bg-red-600 hover:bg-red-500 text-white font-medium cursor-pointer transition-colors flex items-center gap-1.5 shadow-xs'
						>
							<Square size={11} /> Stop
						</button>
					) : (
						<button
							type='button'
							disabled={!prompt.trim()}
							onClick={() => void startLiveInvestigation()}
							className='px-3.5 py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 text-white font-medium disabled:opacity-45 cursor-pointer disabled:cursor-not-allowed transition-colors flex items-center gap-1.5 shadow-xs'
						>
							<Play size={12} /> Investigate Live
						</button>
					)}
					<button
						type='button'
						onClick={() => void arpeiService.refreshFromDisk()}
						title='Refresh Sessions'
						className='p-1.5 rounded-md bg-void-bg-1 hover:bg-void-bg-3 border border-void-border-2 text-void-fg-2 hover:text-void-fg-1 cursor-pointer transition-colors'
					>
						<RefreshCw size={12} />
					</button>
				</div>

				{/* Live Progress Banner — Visible while running so user sees EVERY live step */}
				{state.isRunning && (
					<div className='px-4 py-2.5 bg-sky-500/10 border-b border-sky-500/30 flex flex-col gap-2 shrink-0 text-xs'>
						<div className='flex flex-wrap items-center justify-between gap-2'>
							<div className='flex items-center gap-2 font-semibold text-sky-300'>
								<span className='w-2 h-2 rounded-full bg-sky-400 animate-pulse' />
								<span>{state.activeStage ?? 'Running live research investigation...'}</span>
							</div>
							<div className='flex items-center gap-1.5 flex-wrap'>
								{PIPELINE_STEPS.map(st => {
									const done = state.progressPct >= st.minPct;
									return (
										<span
											key={st.label}
											className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${done ? 'bg-sky-500/20 border-sky-400/50 text-sky-200' : 'bg-void-bg-1 border-void-border-2 text-void-fg-3'}`}
										>
											{st.label}
										</span>
									);
								})}
							</div>
						</div>
						<div className='w-full h-1.5 rounded-full bg-void-bg-1 overflow-hidden'>
							<div
								className='h-full bg-sky-500 transition-all duration-300'
								style={{ width: `${Math.max(8, Math.min(100, state.progressPct || 12))}%` }}
							/>
						</div>
						{recentEvents.length > 0 && (
							<div className='flex flex-col gap-0.5 font-mono text-[10px] text-void-fg-2'>
								{recentEvents.slice(0, 3).map(ev => (
									<div key={ev.eventId} className='flex items-center gap-2 truncate'>
										<span className='text-cyan-400 shrink-0'>{ev.type}</span>
										<span className='truncate'>{ev.detail}</span>
									</div>
								))}
							</div>
						)}
					</div>
				)}

				{(statusMsg || state.lastError) && !state.isRunning && (
					<div className='px-4 py-1.5 bg-void-bg-1 border-b border-void-border-2 text-[11px] text-void-fg-2 flex justify-between items-center gap-2 shrink-0'>
						<span className='flex items-center gap-1.5 truncate'>
							<CheckCircle2 size={12} className={state.lastError ? 'text-amber-400 shrink-0' : 'text-emerald-400 shrink-0'} />
							<span className='truncate'>{statusMsg ?? state.lastError}</span>
						</span>
						<button type='button' onClick={() => setStatusMsg(null)} className='text-void-fg-3 hover:text-void-fg-1 cursor-pointer shrink-0'>Dismiss</button>
					</div>
				)}

				{/* Main 2-Column Scrollable Workspace */}
				<div className='flex-1 flex' style={{ minHeight: 0, overflow: 'hidden' }}>
					<div
						className='w-52 shrink-0 border-r border-void-border-2 bg-void-bg-2 p-2.5 flex flex-col gap-1'
						style={{ minHeight: 0, overflowY: 'auto' }}
					>
						<div className='px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-void-fg-3'>Research Studio</div>
						{NAV_ITEMS.map(sec => (
							<button
								key={sec.id}
								type='button'
								onClick={() => arpeiService.setActiveSection(sec.id)}
								className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md text-left text-xs cursor-pointer transition-colors ${activeSection === sec.id
									? 'bg-sky-500/15 text-sky-300 border border-sky-500/35 font-medium'
									: 'text-void-fg-2 hover:text-void-fg-1 hover:bg-void-bg-1 border border-transparent'}`}
							>
								<span className='flex items-center gap-2 min-w-0'>
									{sec.icon}
									<span className='truncate'>{sec.label}</span>
								</span>
								{sec.badge !== undefined && (
									<span className='px-1.5 py-0.2 rounded-full bg-void-bg-1 border border-void-border-2 text-[10px] text-void-fg-3 shrink-0'>
										{sec.badge}
									</span>
								)}
							</button>
						))}
					</div>

					<div
						className='flex-1 min-w-0 p-5 pb-16'
						style={{ minHeight: 0, overflowY: 'auto' }}
					>
						{renderBody()}
					</div>
				</div>
			</div>

			{/* Fullscreen Screenshot Lightbox Modal */}
			{lightboxShot && (
				<div
					className='fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6'
					onClick={() => setLightboxShot(null)}
				>
					<div
						className='max-w-5xl max-h-full w-full rounded-xl border border-void-border-2 bg-void-bg-2 overflow-hidden flex flex-col shadow-2xl'
						onClick={e => e.stopPropagation()}
					>
						<div className='px-4 py-2.5 border-b border-void-border-2 flex items-center justify-between gap-3 text-xs'>
							<div className='min-w-0'>
								<div className='font-semibold text-void-fg-1 truncate'>{lightboxShot.pageTitle}</div>
								<div className='font-mono text-[10px] text-cyan-400 truncate'>{lightboxShot.sourceUrl} · {lightboxShot.viewport.width}x{lightboxShot.viewport.height}</div>
							</div>
							<button
								type='button'
								onClick={() => setLightboxShot(null)}
								className='p-1.5 rounded-md bg-void-bg-1 hover:bg-void-bg-3 border border-void-border-2 text-void-fg-1 cursor-pointer shrink-0'
							>
								<X size={14} />
							</button>
						</div>
						<div className='p-4 flex-1 flex items-center justify-center bg-black/40' style={{ minHeight: 0, overflow: 'auto' }}>
							{lightboxShot.thumbnailDataUrl ? (
								<img src={lightboxShot.thumbnailDataUrl} alt={lightboxShot.pageTitle} className='max-w-full rounded-lg border border-void-border-2 shadow-lg' />
							) : (
								<div className='text-void-fg-3 text-xs'>Preview unavailable — saved at {lightboxShot.filePath}</div>
							)}
						</div>
					</div>
				</div>
			)}
		</div>
	);
};
