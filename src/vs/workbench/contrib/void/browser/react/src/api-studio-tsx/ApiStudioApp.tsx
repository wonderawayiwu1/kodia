/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
	Activity,
	CheckCircle2,
	Code2,
	Compass,
	Copy,
	Download,
	FileCode2,
	FolderKanban,
	Gauge,
	Globe,
	History,
	KeyRound,
	Layers,
	Play,
	Plus,
	Radio,
	RefreshCw,
	Save,
	Search,
	Send,
	Server,
	ShieldCheck,
	Sliders,
	Square,
	Trash2,
	Upload,
	X,
	XCircle,
} from 'lucide-react';
import { useAccessor } from '../util/services.js';
import { KodiaBadge, KodiaCard, KodiaPrimaryButton, KodiaSecondaryButton } from '../util/KodiaDesignSystem.js';
import { ApiStudioWorkbenchState } from '../../../apiStudioService.js';
import {
	ApiAssertionKind,
	ApiAssertionSpec,
	ApiBodyMode,
	ApiCollection,
	ApiEnvironment,
	ApiHttpMethod,
	ApiKeyValuePair,
	ApiRequestSpec,
	ApiStudioLayoutPreset,
	ApiStudioSection,
} from '../../../../common/apiStudioTypes.js';
import {
	assessApiProductionReadiness,
	ClientCodeTarget,
	compareApiResponses,
	exportCollectionToPostman,
	exportTestRunToCsv,
	generateApiClientCode,
	generateApiTestSuiteFromDiscovery,
	generateOpenApiSpecFromDiscovery,
	importFromCurl,
	importFromPostmanCollection,
} from '../../../../common/apiStudioIntelligence.js';
import { ApiStudioJsonTree } from './ApiStudioJsonTree.js';
import {
	LiveEventStreamPanel,
	LoadTestDashboard,
	RuntimesTopologyView,
	SecurityAndReadinessView,
	TimingWaterfall,
} from './ApiStudioLivePanels.js';

const METHOD_COLORS: Record<string, string> = {
	GET: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
	POST: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
	PUT: 'text-sky-400 bg-sky-500/10 border-sky-500/30',
	PATCH: 'text-violet-400 bg-violet-500/10 border-violet-500/30',
	DELETE: 'text-rose-400 bg-rose-500/10 border-rose-500/30',
	HEAD: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30',
	OPTIONS: 'text-slate-300 bg-slate-500/10 border-slate-500/30',
	WS: 'text-fuchsia-400 bg-fuchsia-500/10 border-fuchsia-500/30',
	GRAPHQL: 'text-pink-400 bg-pink-500/10 border-pink-500/30',
	GRPC: 'text-teal-400 bg-teal-500/10 border-teal-500/30',
};

type ReqConfigTab = 'params' | 'auth' | 'headers' | 'body' | 'pre' | 'tests' | 'settings';
type ResViewTab = 'pretty' | 'tree' | 'raw' | 'headers' | 'cookies' | 'timing' | 'assertions' | 'sse' | 'diff';

export const ApiStudioApp: React.FC = () => {
	const accessor = useAccessor();
	const apiService = accessor.get('IApiStudioService');
	const apiMain = accessor.get('IKodiaApiStudioMainService');
	const toolsService = accessor.get('IToolsService');

	const [state, setState] = useState<ApiStudioWorkbenchState>(() => apiService.state);
	const [sidebarWidth, setSidebarWidth] = useState(250);
	const [showLiveDrawer, setShowLiveDrawer] = useState(true);
	const [navSearch, setNavSearch] = useState('');

	// Request builder tabs & busy states
	const [reqTab, setReqTab] = useState<ReqConfigTab>('params');
	const [resTab, setResTab] = useState<ResViewTab>('pretty');
	const [sending, setSending] = useState(false);
	const [activeExecId, setActiveExecId] = useState<string | null>(null);
	const [busyOp, setBusyOp] = useState<string | null>(null);
	const [statusMsg, setStatusMsg] = useState<string>('');

	// Modals: Code Gen & Import/Export
	const [showCodeGen, setShowCodeGen] = useState(false);
	const [codeTarget, setCodeTarget] = useState<ClientCodeTarget>('curl');
	const [showImportModal, setShowImportModal] = useState(false);
	const [importKind, setImportKind] = useState<'curl' | 'postman'>('curl');
	const [importText, setImportText] = useState('');

	// Protocol-specific local inputs
	const [wsUrl, setWsUrl] = useState('ws://127.0.0.1:3000/ws');
	const [wsMsg, setWsMsg] = useState('{"type":"ping"}');
	const [selectedWsId, setSelectedWsId] = useState<string>('');
	const [gqlUrl, setGqlUrl] = useState('http://127.0.0.1:3000/graphql');
	const [gqlQuery, setGqlQuery] = useState('query {\n  __typename\n}');
	const [gqlVars, setGqlVars] = useState('{}');
	const [grpcAddr, setGrpcAddr] = useState('127.0.0.1:50051');
	const [grpcMethod, setGrpcMethod] = useState('');
	const [grpcPayload, setGrpcPayload] = useState('{}');
	const [grpcOutput, setGrpcOutput] = useState('');

	// Mock server creator
	const [mockName, setMockName] = useState('Local Mock API');
	const [mockPath, setMockPath] = useState('/api/mock/health');
	const [mockBody, setMockBody] = useState('{"status":"ok","source":"kodia-mock"}');

	// Environment editor
	const [newEnvName, setNewEnvName] = useState('Local');
	const [newEnvBaseUrl, setNewEnvBaseUrl] = useState('http://127.0.0.1:3000');
	const [newEnvKind, setNewEnvKind] = useState<ApiEnvironment['kind']>('local');

	const workspaceRoot = apiService.getWorkspaceRoot();
	const req = state.activeRequest;
	const res = state.latestResponse;

	useEffect(() => {
		setState(apiService.state);
		const d = apiService.onDidChange(() => setState({ ...apiService.state }));
		void apiService.refreshFromDisk();
		return () => d.dispose();
	}, [apiService]);

	const activeEnv = useMemo(
		() => state.environments.find(e => e.id === state.activeEnvironmentId) ?? null,
		[state.environments, state.activeEnvironmentId],
	);

	const updateReq = useCallback((patch: Partial<ApiRequestSpec>) => {
		apiService.setActiveRequest({ ...apiService.state.activeRequest, ...patch });
	}, [apiService]);

	const flash = (msg: string) => {
		setStatusMsg(msg);
		setTimeout(() => setStatusMsg(prev => (prev === msg ? '' : prev)), 3500);
	};

	const handleSendRequest = async () => {
		if (!apiMain || !req.url.trim()) { return; }
		const execId = `ui-${Date.now().toString(36)}`;
		setSending(true);
		setActiveExecId(execId);
		try {
			const response = await apiMain.executeRequest(workspaceRoot, {
				request: req,
				environmentId: state.activeEnvironmentId ?? undefined,
				executionId: execId,
				persistHistory: true,
			});
			apiService.recordResponse(response);
			await apiService.refreshFromDisk();
			if (response.sseEvents && response.sseEvents.length > 0) {
				setResTab('sse');
			}
		} finally {
			setSending(false);
			setActiveExecId(null);
		}
	};

	const handleCancelRequest = async () => {
		if (!apiMain || !activeExecId) { return; }
		await apiMain.cancelExecution(activeExecId);
		setSending(false);
		setActiveExecId(null);
	};

	const handleSaveToCollection = async () => {
		if (!apiMain) { return; }
		const now = new Date().toISOString();
		const target = state.collections[0] ?? {
			id: `col-default-${Date.now().toString(36)}`,
			name: 'Workspace APIs',
			variables: [],
			requests: [],
			createdAt: now,
			updatedAt: now,
		};
		const nextReqs = [req, ...target.requests.filter(r => r.id !== req.id)];
		const updated: ApiCollection = { ...target, requests: nextReqs, updatedAt: now };
		const all = await apiMain.saveCollection(workspaceRoot, updated);
		apiService.recordCollections(all);
		flash(`Saved "${req.name}" to ${updated.name}`);
	};

	const handleDiscoverApis = async () => {
		setBusyOp('discover');
		try {
			const { result } = await toolsService.callTool.api_discover_project({ max_files: 150 });
			const report = await result;
			apiService.recordDiscovery(report);
			apiService.setActiveSection('explorer');
			flash(`Discovered ${report.routes.length} API route(s)`);
		} finally {
			setBusyOp(null);
		}
	};

	const handleGenerateAndRunSuite = async (runAfter: boolean) => {
		if (!apiMain) { return; }
		setBusyOp('suite');
		try {
			let disc = state.discovery;
			if (!disc) {
				const { result } = await toolsService.callTool.api_discover_project({ max_files: 150 });
				disc = await result;
				apiService.recordDiscovery(disc);
			}
			const baseUrl = activeEnv?.baseUrl || state.runtimes.find(r => r.baseUrl)?.baseUrl || 'http://127.0.0.1:3000';
			const suite = generateApiTestSuiteFromDiscovery({ baseUrl, discovery: disc });
			const all = await apiMain.saveTestSuite(workspaceRoot, suite);
			apiService.recordSuites(all);
			if (runAfter && suite.requests.length > 0) {
				apiService.setActiveSection('runner');
				const run = await apiMain.runTestSuite(workspaceRoot, { suiteId: suite.id, environmentId: state.activeEnvironmentId ?? undefined });
				apiService.recordTestRun(run);
				await apiService.refreshFromDisk();
			} else {
				apiService.setActiveSection('suites');
			}
		} finally {
			setBusyOp(null);
		}
	};

	const handleRunSuiteById = async (suiteId: string) => {
		if (!apiMain) { return; }
		setBusyOp('runner');
		apiService.setActiveSection('runner');
		try {
			const run = await apiMain.runTestSuite(workspaceRoot, { suiteId, environmentId: state.activeEnvironmentId ?? undefined });
			apiService.recordTestRun(run);
			await apiService.refreshFromDisk();
		} finally {
			setBusyOp(null);
		}
	};

	const handleRunLoad = async (cfg: { name: string; url: string; method: 'GET' | 'POST'; virtualUsers: number; durationSeconds: number; p95ThresholdMs: number }) => {
		if (!apiMain) { return; }
		setBusyOp('load');
		try {
			const run = await apiMain.runLoadTest(workspaceRoot, {
				name: cfg.name,
				request: {
					id: `load-${Date.now().toString(36)}`,
					name: cfg.name,
					protocol: 'http',
					method: cfg.method,
					url: cfg.url,
					params: [],
					headers: [],
					auth: { type: 'none' },
					body: { mode: 'none' },
				},
				virtualUsers: cfg.virtualUsers,
				durationSeconds: cfg.durationSeconds,
				p95ThresholdMs: cfg.p95ThresholdMs,
				environmentId: state.activeEnvironmentId ?? undefined,
			});
			apiService.recordLoadRun(run);
			await apiService.refreshFromDisk();
		} finally {
			setBusyOp(null);
		}
	};

	const handleRunSecurity = async () => {
		setBusyOp('security');
		try {
			const baseUrl = activeEnv?.baseUrl || state.runtimes.find(r => r.baseUrl)?.baseUrl;
			const { result } = await toolsService.callTool.api_security_audit({ base_url: baseUrl, allow_live_probes: true });
			const rep = await result;
			apiService.recordSecurityReport(rep);
		} finally {
			setBusyOp(null);
		}
	};

	const handleRunReadiness = async () => {
		setBusyOp('readiness');
		try {
			const rep = assessApiProductionReadiness({
				discovery: state.discovery,
				latestTestRun: state.testRuns[0] ?? null,
				latestLoadRun: state.loadRuns[0] ?? null,
				latestSecurityReport: state.securityReports[0] ?? null,
				runtimes: state.runtimes,
			});
			apiService.recordReadiness(rep);
		} finally {
			setBusyOp(null);
		}
	};

	const handleImportSubmit = async () => {
		if (!apiMain || !importText.trim()) { return; }
		try {
			const now = new Date().toISOString();
			if (importKind === 'curl') {
				const parsedReq = importFromCurl(importText.trim());
				apiService.setActiveRequest(parsedReq);
				const col: ApiCollection = {
					id: `col-curl-${Date.now().toString(36)}`,
					name: 'Imported cURL',
					variables: [],
					requests: [parsedReq],
					createdAt: now,
					updatedAt: now,
				};
				const all = await apiMain.saveCollection(workspaceRoot, col);
				apiService.recordCollections(all);
				flash('Imported cURL request and loaded into editor');
			} else {
				const col = importFromPostmanCollection(importText.trim());
				const all = await apiMain.saveCollection(workspaceRoot, col);
				apiService.recordCollections(all);
				if (col.requests[0]) { apiService.setActiveRequest(col.requests[0]); }
				flash(`Imported Postman collection "${col.name}" (${col.requests.length} requests)`);
			}
			setShowImportModal(false);
			setImportText('');
		} catch (e) {
			flash(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
		}
	};

	const handleApplyPreset = (preset: ApiStudioLayoutPreset) => {
		apiService.setLayoutPreset(preset);
		if (preset === 'request-builder') { apiService.setActiveSection('requests'); setShowLiveDrawer(true); }
		else if (preset === 'live-runner') { apiService.setActiveSection('runner'); setShowLiveDrawer(true); }
		else if (preset === 'performance') { apiService.setActiveSection('performance'); setShowLiveDrawer(true); }
		else if (preset === 'security') { apiService.setActiveSection('security'); }
		else if (preset === 'enterprise-topology') { apiService.setActiveSection('topology'); setShowLiveDrawer(true); }
	};

	// Sync query params <-> URL bar
	const updateParamsList = (nextParams: ApiKeyValuePair[]) => {
		try {
			const u = new URL(req.url);
			u.search = '';
			for (const p of nextParams) {
				if (p.enabled && p.key.trim()) { u.searchParams.set(p.key.trim(), p.value); }
			}
			updateReq({ params: nextParams, url: u.toString() });
		} catch {
			updateReq({ params: nextParams });
		}
	};

	const navItems: Array<{ id: ApiStudioSection; label: string; icon: React.ReactNode; badge?: string | number }> = [
		{ id: 'overview', label: 'Overview', icon: <Compass size={13} /> },
		{ id: 'requests', label: 'Request Builder', icon: <Send size={13} /> },
		{ id: 'collections', label: 'Collections', icon: <FolderKanban size={13} />, badge: state.collections.length || undefined },
		{ id: 'explorer', label: 'API Explorer', icon: <Globe size={13} />, badge: state.discovery?.routes.length || undefined },
		{ id: 'specs', label: 'OpenAPI & Specs', icon: <FileCode2 size={13} />, badge: state.discovery?.specFiles.length || undefined },
		{ id: 'graphql', label: 'GraphQL', icon: <Code2 size={13} /> },
		{ id: 'grpc', label: 'gRPC', icon: <Layers size={13} />, badge: state.discovery?.grpcMethods.length || undefined },
		{ id: 'websockets', label: 'WebSockets', icon: <Radio size={13} />, badge: state.webSockets.filter(w => w.status === 'open').length || undefined },
		{ id: 'environments', label: 'Environments', icon: <Sliders size={13} />, badge: state.environments.length || undefined },
		{ id: 'suites', label: 'Test Suites', icon: <CheckCircle2 size={13} />, badge: state.suites.length || undefined },
		{ id: 'runner', label: 'Live Test Runner', icon: <Play size={13} />, badge: state.testRuns.length || undefined },
		{ id: 'performance', label: 'Performance & Load', icon: <Gauge size={13} />, badge: state.loadRuns.length || undefined },
		{ id: 'security', label: 'Security Audit', icon: <ShieldCheck size={13} />, badge: state.securityReports[0]?.findings.length || undefined },
		{ id: 'mocks', label: 'Mock Servers', icon: <Server size={13} />, badge: state.mockServers.length || undefined },
		{ id: 'topology', label: 'Runtimes & Topology', icon: <Activity size={13} />, badge: state.runtimes.filter(r => r.status === 'ready').length || undefined },
		{ id: 'history', label: 'History & Diff', icon: <History size={13} />, badge: state.history.length || undefined },
		{ id: 'readiness', label: 'Production Readiness', icon: <KeyRound size={13} /> },
	];

	const formattedResponseBody = useMemo(() => {
		if (!res?.body) { return ''; }
		try { return JSON.stringify(JSON.parse(res.body), null, 2); } catch { return res.body; }
	}, [res]);

	const diffVsPrev = useMemo(() => {
		if (!res || state.history.length < 2) { return null; }
		return compareApiResponses(state.history[1].response, res, 'Previous', 'Current');
	}, [res, state.history]);

	const openApiPreview = useMemo(() => {
		if (!state.discovery) { return ''; }
		return JSON.stringify(generateOpenApiSpecFromDiscovery({
			title: 'Workspace API',
			serverUrl: activeEnv?.baseUrl || 'http://127.0.0.1:3000',
			discovery: state.discovery,
		}), null, 2);
	}, [state.discovery, activeEnv]);

	return (
		<div className='void-scope w-full h-full flex flex-col bg-void-bg-2 text-void-fg-1 select-text overflow-hidden'>
			{/* Top Studio Command Bar */}
			<header className='h-11 px-3 border-b border-void-border-2 bg-void-bg-1 flex items-center gap-2 shrink-0'>
				<div className='flex items-center gap-2 mr-2'>
					<div className='w-6 h-6 rounded-md flex items-center justify-center bg-sky-500/15 border border-sky-500/30'>
						<Globe size={14} className='text-sky-400' />
					</div>
					<div className='leading-tight'>
						<div className='text-xs font-semibold tracking-tight'>Kodia API Engineering Studio</div>
						<div className='text-[10px] text-void-fg-3'>Live Protocol Testing · Discovery · Load · Security · Readiness</div>
					</div>
				</div>

				{/* Layout Presets */}
				<div className='hidden xl:flex items-center gap-1 bg-void-bg-2 p-0.5 rounded-md border border-void-border-2'>
					{([
						['request-builder', 'Builder'],
						['live-runner', 'Test Runner'],
						['performance', 'Performance'],
						['security', 'Security'],
						['enterprise-topology', 'Topology'],
					] as const).map(([id, label]) => (
						<button
							key={id}
							type='button'
							onClick={() => handleApplyPreset(id)}
							className={`px-2 py-0.5 rounded text-[10px] cursor-pointer transition-colors ${state.layoutPreset === id ? 'bg-void-bg-3 text-void-fg-1 font-medium' : 'text-void-fg-3 hover:text-void-fg-1'}`}
						>
							{label}
						</button>
					))}
				</div>

				<div className='ml-auto flex items-center gap-2'>
					{statusMsg && <span className='text-[11px] text-emerald-400 hidden md:inline'>{statusMsg}</span>}

					{/* Active Environment Switcher */}
					<div className='flex items-center gap-1.5'>
						<select
							aria-label='Active API Environment'
							value={state.activeEnvironmentId ?? ''}
							onChange={async e => {
								const nextId = e.target.value || null;
								if (apiMain) {
									await apiMain.setActiveEnvironment(workspaceRoot, nextId);
									apiService.recordEnvironments(state.environments, nextId);
								}
							}}
							className='px-2 py-1 text-[11px] rounded bg-void-bg-2 border border-void-border-2 text-void-fg-1'
						>
							<option value=''>No Environment</option>
							{state.environments.map(e => (
								<option key={e.id} value={e.id}>{e.name} ({e.kind})</option>
							))}
						</select>
						{activeEnv && (activeEnv.kind === 'production' || activeEnv.isProtected) && (
							<KodiaBadge tone='error'>PROTECTED PROD</KodiaBadge>
						)}
					</div>

					<KodiaSecondaryButton disabled={busyOp === 'discover'} onClick={() => void handleDiscoverApis()} className='!py-1 !px-2 !text-[11px]'>
						<Search size={11} /> {busyOp === 'discover' ? 'Scanning...' : 'Discover APIs'}
					</KodiaSecondaryButton>
					<KodiaSecondaryButton onClick={() => setShowImportModal(true)} className='!py-1 !px-2 !text-[11px]'>
						<Upload size={11} /> Import
					</KodiaSecondaryButton>
					<KodiaSecondaryButton onClick={() => setShowLiveDrawer(v => !v)} className='!py-1 !px-2 !text-[11px]'>
						<Activity size={11} /> Live ({state.liveEvents.length})
					</KodiaSecondaryButton>
					<button type='button' onClick={() => void apiService.refreshFromDisk()} title='Sync persistent workspace state' className='p-1.5 rounded border border-void-border-2 text-void-fg-2 hover:text-void-fg-1 cursor-pointer'>
						<RefreshCw size={12} />
					</button>
				</div>
			</header>

			{/* Main 3-Pane Studio Workspace */}
			<div className='flex-1 flex min-h-0 overflow-hidden'>
				{/* Resizable Left Explorer Sidebar */}
				<aside style={{ width: sidebarWidth }} className='border-r border-void-border-2 bg-void-bg-1/80 flex flex-col shrink-0 min-h-0'>
					<div className='p-2 border-b border-void-border-2'>
						<div className='flex items-center gap-1.5 px-2 py-1 rounded bg-void-bg-2 border border-void-border-2'>
							<Search size={11} className='text-void-fg-3' />
							<input
								value={navSearch}
								onChange={e => setNavSearch(e.target.value)}
								placeholder='Search sections & routes...'
								className='bg-transparent text-[11px] text-void-fg-1 outline-none w-full'
							/>
						</div>
					</div>
					<nav className='flex-1 overflow-auto p-1.5 space-y-0.5'>
						{navItems
							.filter(item => !navSearch.trim() || item.label.toLowerCase().includes(navSearch.toLowerCase()))
							.map(item => {
								const active = state.activeSection === item.id;
								return (
									<button
										key={item.id}
										type='button'
										onClick={() => apiService.setActiveSection(item.id)}
										className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs cursor-pointer transition-colors ${active ? 'bg-void-bg-3 text-void-fg-1 font-medium border border-void-border-2' : 'text-void-fg-2 hover:bg-void-bg-2/70 hover:text-void-fg-1'}`}
									>
										<span className={active ? 'text-sky-400' : 'text-void-fg-3'}>{item.icon}</span>
										<span className='truncate'>{item.label}</span>
										{item.badge !== undefined && (
											<span className='ml-auto px-1.5 py-0.2 rounded-full text-[9px] bg-void-bg-2 border border-void-border-2 text-void-fg-2 font-mono'>
												{item.badge}
											</span>
										)}
									</button>
								);
							})}

						{state.discovery && state.discovery.routes.length > 0 && (
							<div className='pt-3 mt-2 border-t border-void-border-2'>
								<div className='px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-void-fg-3'>
									Quick Routes ({state.discovery.routes.length})
								</div>
								<div className='space-y-0.5'>
									{state.discovery.routes
										.filter(r => !navSearch.trim() || r.path.toLowerCase().includes(navSearch.toLowerCase()))
										.slice(0, 20)
										.map(r => (
											<button
												key={r.id}
												type='button'
												onClick={() => {
													const base = activeEnv?.baseUrl || state.runtimes.find(rt => rt.baseUrl)?.baseUrl || 'http://127.0.0.1:3000';
													updateReq({
														id: `rt-${r.id}`,
														name: `${r.method} ${r.path}`,
														method: (r.method === 'ALL' || r.method === 'WS' || r.method === 'GRAPHQL' || r.method === 'GRPC' ? 'GET' : r.method),
														protocol: r.protocol,
														url: `${base.replace(/\/+$/, '')}${r.path}`,
													});
													apiService.setActiveSection('requests');
												}}
												className='w-full flex items-center gap-1.5 px-2 py-1 rounded hover:bg-void-bg-2 text-left cursor-pointer'
											>
												<span className={`px-1 rounded text-[9px] font-mono font-semibold border ${METHOD_COLORS[r.method] ?? METHOD_COLORS.GET}`}>
													{r.method}
												</span>
												<span className='text-[11px] font-mono text-void-fg-2 truncate'>{r.path}</span>
											</button>
										))}
								</div>
							</div>
						)}
					</nav>
					<div className='px-2.5 py-1.5 border-t border-void-border-2 flex items-center justify-between text-[10px] text-void-fg-3'>
						<span>Sidebar Width</span>
						<div className='flex gap-1'>
							<button type='button' onClick={() => setSidebarWidth(w => Math.max(180, w - 30))} className='px-1.5 rounded border border-void-border-2 cursor-pointer'>-</button>
							<button type='button' onClick={() => setSidebarWidth(w => Math.min(380, w + 30))} className='px-1.5 rounded border border-void-border-2 cursor-pointer'>+</button>
						</div>
					</div>
				</aside>

				{/* Center + Bottom Live Activity Column */}
				<main className='flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden'>
					<div className='flex-1 min-h-0 overflow-hidden flex flex-col'>
						{/* SECTION: OVERVIEW DASHBOARD */}
						{state.activeSection === 'overview' && (
							<div className='p-4 space-y-4 overflow-auto h-full'>
								<div className='flex items-center justify-between'>
									<div>
										<h2 className='text-sm font-semibold text-void-fg-1'>API Engineering Project Overview</h2>
										<p className='text-xs text-void-fg-3'>Live metrics computed exclusively from real workspace discovery, runtime status, test suites, load runs, and security audits.</p>
									</div>
									<div className='flex gap-2'>
										<KodiaSecondaryButton onClick={() => void handleDiscoverApis()}>Discover APIs</KodiaSecondaryButton>
										<KodiaPrimaryButton onClick={() => void handleGenerateAndRunSuite(true)}>Generate & Run Full Suite</KodiaPrimaryButton>
									</div>
								</div>
								<div className='grid grid-cols-2 md:grid-cols-4 gap-3'>
									{[
										{ label: 'Discovered Routes', val: state.discovery?.routes.length ?? 0, sec: 'explorer' as const },
										{ label: 'Active Runtimes', val: state.runtimes.filter(r => r.status === 'ready').length, sec: 'topology' as const },
										{ label: 'Latest Pass Rate', val: state.testRuns[0] ? `${Math.round(state.testRuns[0].passRate * 100)}%` : 'Not Run', sec: 'runner' as const },
										{ label: 'Security Score', val: state.securityReports[0] ? `${state.securityReports[0].score}/100` : 'Not Run', sec: 'security' as const },
										{ label: 'Collections', val: state.collections.length, sec: 'collections' as const },
										{ label: 'Request History', val: state.history.length, sec: 'history' as const },
										{ label: 'Latest Load RPS', val: state.loadRuns[0] ? `${state.loadRuns[0].rps} RPS` : 'Not Run', sec: 'performance' as const },
										{ label: 'Readiness Status', val: state.latestReadiness?.overallStatus.toUpperCase() ?? 'Not Evaluated', sec: 'readiness' as const },
									].map(m => (
										<button
											key={m.label}
											type='button'
											onClick={() => apiService.setActiveSection(m.sec)}
											className='text-left p-3 rounded-lg border border-void-border-2 bg-void-bg-1 hover:border-sky-500/40 cursor-pointer transition-colors'
										>
											<div className='text-[11px] text-void-fg-3'>{m.label}</div>
											<div className='text-lg font-semibold font-mono text-void-fg-1 mt-1'>{m.val}</div>
										</button>
									))}
								</div>
								{state.discovery && (
									<KodiaCard className='p-3 space-y-1.5 text-xs'>
										<div className='font-semibold text-void-fg-1'>Detected Architecture Stack</div>
										<div className='text-void-fg-2'>{state.discovery.summary}</div>
										<div className='flex flex-wrap gap-1.5 pt-1'>
											{state.discovery.frameworks.map(fw => <KodiaBadge key={fw} tone='accent'>{fw}</KodiaBadge>)}
											{state.discovery.protocols.map(pr => <KodiaBadge key={pr} tone='neutral'>{pr.toUpperCase()}</KodiaBadge>)}
											{state.discovery.databases.map(db => <KodiaBadge key={db} tone='success'>{db}</KodiaBadge>)}
										</div>
									</KodiaCard>
								)}
							</div>
						)}

						{/* SECTION: MAIN INTERACTIVE REQUEST BUILDER + RESPONSE INSPECTOR */}
						{state.activeSection === 'requests' && (
							<div className='flex-1 flex flex-col min-h-0 overflow-hidden'>
								{/* Request URL Bar */}
								<div className='p-2.5 border-b border-void-border-2 bg-void-bg-1/50 flex items-center gap-2 shrink-0'>
									<select
										aria-label='HTTP Method'
										value={req.method}
										onChange={e => updateReq({ method: e.target.value as ApiHttpMethod })}
										className={`px-2.5 py-1.5 rounded-md text-xs font-mono font-semibold border cursor-pointer ${METHOD_COLORS[req.method] ?? METHOD_COLORS.GET}`}
									>
										{(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const).map(m => (
											<option key={m} value={m} className='bg-void-bg-1 text-void-fg-1'>{m}</option>
										))}
									</select>
									<input
										list='kodia-api-route-suggestions'
										value={req.url}
										onChange={e => updateReq({ url: e.target.value })}
										onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { void handleSendRequest(); } }}
										placeholder='https://api.example.com/v1/resource or {{baseUrl}}/health'
										className='flex-1 px-3 py-1.5 rounded-md bg-void-bg-1 border border-void-border-2 text-xs font-mono text-void-fg-1 outline-none focus:border-sky-500/60'
									/>
									<datalist id='kodia-api-route-suggestions'>
										{(state.discovery?.routes ?? []).map(r => (
											<option key={r.id} value={`${(activeEnv?.baseUrl || 'http://127.0.0.1:3000').replace(/\/+$/, '')}${r.path}`} />
										))}
										{state.history.slice(0, 15).map(h => (
											<option key={h.id} value={h.response.resolvedUrl} />
										))}
									</datalist>

									{sending ? (
										<KodiaSecondaryButton onClick={() => void handleCancelRequest()} className='!border-rose-500/50 !text-rose-400'>
											<Square size={11} /> Cancel
										</KodiaSecondaryButton>
									) : (
										<KodiaPrimaryButton onClick={() => void handleSendRequest()}>
											<Send size={12} /> Send
										</KodiaPrimaryButton>
									)}
									<KodiaSecondaryButton onClick={() => void handleSaveToCollection()} title='Save to collection'>
										<Save size={12} /> Save
									</KodiaSecondaryButton>
									<KodiaSecondaryButton onClick={() => setShowCodeGen(true)} title='Generate client code / SDK'>
										<Code2 size={12} /> Code
									</KodiaSecondaryButton>
								</div>

								{/* Split: Request Config (Top) & Response Inspector (Bottom) */}
								<div className='flex-1 grid grid-rows-2 min-h-0 overflow-hidden divide-y divide-void-border-2'>
									{/* Request Config Pane */}
									<div className='flex flex-col min-h-0 overflow-hidden'>
										<div className='px-2.5 py-1 border-b border-void-border-2 bg-void-bg-1/30 flex items-center gap-1 shrink-0 overflow-x-auto'>
											{([
												['params', `Params (${req.params.filter(p => p.enabled).length})`],
												['auth', `Auth (${req.auth.type})`],
												['headers', `Headers (${req.headers.filter(h => h.enabled).length})`],
												['body', `Body (${req.body.mode})`],
												['pre', 'Pre-request'],
												['tests', `Tests & Assertions (${req.assertions?.length ?? 0})`],
												['settings', 'Settings'],
											] as const).map(([id, label]) => (
												<button
													key={id}
													type='button'
													onClick={() => setReqTab(id)}
													className={`px-2.5 py-1 rounded text-[11px] cursor-pointer whitespace-nowrap ${reqTab === id ? 'bg-void-bg-3 text-void-fg-1 font-medium' : 'text-void-fg-3 hover:text-void-fg-1'}`}
												>
													{label}
												</button>
											))}
										</div>

										<div className='flex-1 overflow-auto p-2.5'>
											{reqTab === 'params' && (
												<div className='space-y-1.5'>
													{req.params.map((p, idx) => (
														<div key={p.id} className='flex items-center gap-1.5'>
															<input type='checkbox' checked={p.enabled} onChange={e => updateParamsList(req.params.map((x, i) => i === idx ? { ...x, enabled: e.target.checked } : x))} />
															<input value={p.key} onChange={e => updateParamsList(req.params.map((x, i) => i === idx ? { ...x, key: e.target.value } : x))} placeholder='Key' className='flex-1 px-2 py-1 text-xs font-mono rounded bg-void-bg-1 border border-void-border-2' />
															<input value={p.value} onChange={e => updateParamsList(req.params.map((x, i) => i === idx ? { ...x, value: e.target.value } : x))} placeholder='Value (supports {{var}})' className='flex-1 px-2 py-1 text-xs font-mono rounded bg-void-bg-1 border border-void-border-2' />
															<button type='button' onClick={() => updateParamsList(req.params.filter((_, i) => i !== idx))} className='p-1 text-void-fg-3 hover:text-rose-400 cursor-pointer'><Trash2 size={12} /></button>
														</div>
													))}
													<KodiaSecondaryButton onClick={() => updateParamsList([...req.params, { id: `p-${Date.now()}`, key: '', value: '', enabled: true }])} className='!py-1 !text-[11px]'>
														<Plus size={11} /> Add Query Param
													</KodiaSecondaryButton>
												</div>
											)}

											{reqTab === 'auth' && (
												<div className='space-y-2.5 max-w-xl'>
													<select
														value={req.auth.type}
														onChange={e => {
															const t = e.target.value;
															if (t === 'none') { updateReq({ auth: { type: 'none' } }); }
															else if (t === 'bearer') { updateReq({ auth: { type: 'bearer', token: '{{authToken}}' } }); }
															else if (t === 'basic') { updateReq({ auth: { type: 'basic', username: '', password: '' } }); }
															else if (t === 'api-key') { updateReq({ auth: { type: 'api-key', key: 'X-API-Key', value: '{{apiKey}}', addTo: 'header' } }); }
															else if (t === 'oauth2') { updateReq({ auth: { type: 'oauth2', grantType: 'client_credentials', accessToken: '{{accessToken}}' } }); }
															else { updateReq({ auth: { type: 'custom', headerName: 'X-Custom-Auth', headerValue: '' } }); }
														}}
														className='px-2.5 py-1.5 text-xs rounded bg-void-bg-1 border border-void-border-2 text-void-fg-1'
													>
														<option value='none'>No Auth</option>
														<option value='bearer'>Bearer Token / JWT</option>
														<option value='basic'>Basic Auth</option>
														<option value='api-key'>API Key (Header or Query)</option>
														<option value='oauth2'>OAuth 2.0 / OIDC</option>
														<option value='custom'>Custom Auth Header</option>
													</select>
													{req.auth.type === 'bearer' && (
														<input value={req.auth.token} onChange={e => updateReq({ auth: { type: 'bearer', token: e.target.value } })} placeholder='Token or {{authToken}}' className='w-full px-2.5 py-1.5 text-xs font-mono rounded bg-void-bg-1 border border-void-border-2' />
													)}
													{req.auth.type === 'basic' && (
														<div className='grid grid-cols-2 gap-2'>
															<input value={req.auth.username} onChange={e => updateReq({ auth: { ...req.auth as { type: 'basic'; username: string; password: string }, username: e.target.value } })} placeholder='Username' className='px-2.5 py-1.5 text-xs rounded bg-void-bg-1 border border-void-border-2' />
															<input type='password' value={req.auth.password} onChange={e => updateReq({ auth: { ...req.auth as { type: 'basic'; username: string; password: string }, password: e.target.value } })} placeholder='Password' className='px-2.5 py-1.5 text-xs rounded bg-void-bg-1 border border-void-border-2' />
														</div>
													)}
													{req.auth.type === 'api-key' && (
														<div className='grid grid-cols-3 gap-2'>
															<input value={req.auth.key} onChange={e => updateReq({ auth: { ...req.auth as { type: 'api-key'; key: string; value: string; addTo: 'header' | 'query' }, key: e.target.value } })} placeholder='Header/Param Key' className='px-2.5 py-1.5 text-xs font-mono rounded bg-void-bg-1 border border-void-border-2' />
															<input value={req.auth.value} onChange={e => updateReq({ auth: { ...req.auth as { type: 'api-key'; key: string; value: string; addTo: 'header' | 'query' }, value: e.target.value } })} placeholder='Value' className='px-2.5 py-1.5 text-xs font-mono rounded bg-void-bg-1 border border-void-border-2' />
															<select value={req.auth.addTo} onChange={e => updateReq({ auth: { ...req.auth as { type: 'api-key'; key: string; value: string; addTo: 'header' | 'query' }, addTo: e.target.value as 'header' | 'query' } })} className='px-2 py-1.5 text-xs rounded bg-void-bg-1 border border-void-border-2'>
																<option value='header'>Header</option>
																<option value='query'>Query Param</option>
															</select>
														</div>
													)}
													{req.auth.type === 'oauth2' && (
														<input value={req.auth.accessToken ?? ''} onChange={e => updateReq({ auth: { ...req.auth as { type: 'oauth2'; grantType: 'client_credentials' }, accessToken: e.target.value } })} placeholder='OAuth2 Access Token or {{accessToken}}' className='w-full px-2.5 py-1.5 text-xs font-mono rounded bg-void-bg-1 border border-void-border-2' />
													)}
													{req.auth.type === 'custom' && (
														<div className='grid grid-cols-2 gap-2'>
															<input value={req.auth.headerName} onChange={e => updateReq({ auth: { type: 'custom', headerName: e.target.value, headerValue: (req.auth as { headerValue: string }).headerValue } })} placeholder='Header Name' className='px-2.5 py-1.5 text-xs font-mono rounded bg-void-bg-1 border border-void-border-2' />
															<input value={req.auth.headerValue} onChange={e => updateReq({ auth: { type: 'custom', headerName: (req.auth as { headerName: string }).headerName, headerValue: e.target.value } })} placeholder='Header Value' className='px-2.5 py-1.5 text-xs font-mono rounded bg-void-bg-1 border border-void-border-2' />
														</div>
													)}
												</div>
											)}

											{reqTab === 'headers' && (
												<div className='space-y-1.5'>
													{req.headers.map((h, idx) => (
														<div key={h.id} className='flex items-center gap-1.5'>
															<input type='checkbox' checked={h.enabled} onChange={e => updateReq({ headers: req.headers.map((x, i) => i === idx ? { ...x, enabled: e.target.checked } : x) })} />
															<input value={h.key} onChange={e => updateReq({ headers: req.headers.map((x, i) => i === idx ? { ...x, key: e.target.value } : x) })} placeholder='Header name' className='flex-1 px-2 py-1 text-xs font-mono rounded bg-void-bg-1 border border-void-border-2' />
															<input value={h.value} onChange={e => updateReq({ headers: req.headers.map((x, i) => i === idx ? { ...x, value: e.target.value } : x) })} placeholder='Value' className='flex-1 px-2 py-1 text-xs font-mono rounded bg-void-bg-1 border border-void-border-2' />
															<button type='button' onClick={() => updateReq({ headers: req.headers.filter((_, i) => i !== idx) })} className='p-1 text-void-fg-3 hover:text-rose-400 cursor-pointer'><Trash2 size={12} /></button>
														</div>
													))}
													<KodiaSecondaryButton onClick={() => updateReq({ headers: [...req.headers, { id: `h-${Date.now()}`, key: '', value: '', enabled: true }] })} className='!py-1 !text-[11px]'>
														<Plus size={11} /> Add Header
													</KodiaSecondaryButton>
												</div>
											)}

											{reqTab === 'body' && (
												<div className='flex flex-col h-full gap-2'>
													<div className='flex items-center gap-2'>
														{(['none', 'json', 'xml', 'soap', 'text', 'form-urlencoded'] as ApiBodyMode[]).map(m => (
															<button
																key={m}
																type='button'
																onClick={() => updateReq({ body: { ...req.body, mode: m } })}
																className={`px-2 py-0.5 rounded text-[11px] cursor-pointer ${req.body.mode === m ? 'bg-void-bg-3 text-void-fg-1 font-medium' : 'text-void-fg-3 hover:text-void-fg-1'}`}
															>
																{m}
															</button>
														))}
														{req.body.mode === 'json' && (
															<button
																type='button'
																onClick={() => {
																	try { updateReq({ body: { ...req.body, raw: JSON.stringify(JSON.parse(req.body.raw || '{}'), null, 2) } }); } catch { flash('Invalid JSON body'); }
																}}
																className='ml-auto px-2 py-0.5 rounded text-[10px] border border-void-border-2 text-void-fg-2 hover:text-void-fg-1 cursor-pointer'
															>
																Format JSON
															</button>
														)}
													</div>
													{req.body.mode !== 'none' && (
														<textarea
															value={req.body.raw ?? ''}
															onChange={e => updateReq({ body: { ...req.body, raw: e.target.value } })}
															placeholder={req.body.mode === 'json' ? '{\n  "key": "value"\n}' : 'Request payload...'}
															className='flex-1 min-h-[100px] w-full p-2.5 rounded bg-void-bg-1 border border-void-border-2 font-mono text-xs text-void-fg-1 outline-none resize-none'
														/>
													)}
												</div>
											)}

											{reqTab === 'pre' && (
												<div className='flex flex-col h-full gap-1.5'>
													<div className='text-[11px] text-void-fg-3'>Sandboxed JS pre-request script (`kodia.env.get/set`, `kodia.request`, `console.log`).</div>
													<textarea
														value={req.preRequestScript ?? ''}
														onChange={e => updateReq({ preRequestScript: e.target.value })}
														placeholder={'// Example:\nkodia.env.set("correlationId", "req-" + Date.now());'}
														className='flex-1 min-h-[100px] w-full p-2.5 rounded bg-void-bg-1 border border-void-border-2 font-mono text-xs text-void-fg-1 outline-none resize-none'
													/>
												</div>
											)}

											{reqTab === 'tests' && (
												<div className='space-y-2'>
													<div className='space-y-1.5'>
														{(req.assertions ?? []).map((a, idx) => (
															<div key={a.id} className='flex items-center gap-1.5'>
																<select
																	value={a.kind}
																	onChange={e => {
																		const list = [...(req.assertions ?? [])];
																		list[idx] = { ...a, kind: e.target.value as ApiAssertionKind };
																		updateReq({ assertions: list });
																	}}
																	className='px-2 py-1 text-xs rounded bg-void-bg-1 border border-void-border-2'
																>
																	<option value='status_equals'>Status Equals</option>
																	<option value='status_range'>Status Range</option>
																	<option value='jsonpath_equals'>JSONPath Equals</option>
																	<option value='jsonpath_exists'>JSONPath Exists</option>
																	<option value='body_contains'>Body Contains</option>
																	<option value='header_exists'>Header Exists</option>
																	<option value='response_time_lt'>Response Time Less Than (ms)</option>
																	<option value='json_schema_keys'>JSON Required Keys</option>
																</select>
																<input value={a.target ?? ''} onChange={e => { const l = [...(req.assertions ?? [])]; l[idx] = { ...a, target: e.target.value }; updateReq({ assertions: l }); }} placeholder='Target (e.g. $.id)' className='flex-1 px-2 py-1 text-xs font-mono rounded bg-void-bg-1 border border-void-border-2' />
																<input value={a.expected ?? ''} onChange={e => { const l = [...(req.assertions ?? [])]; l[idx] = { ...a, expected: e.target.value }; updateReq({ assertions: l }); }} placeholder='Expected' className='flex-1 px-2 py-1 text-xs font-mono rounded bg-void-bg-1 border border-void-border-2' />
																<button type='button' onClick={() => updateReq({ assertions: (req.assertions ?? []).filter((_, i) => i !== idx) })} className='p-1 text-void-fg-3 hover:text-rose-400 cursor-pointer'><Trash2 size={12} /></button>
															</div>
														))}
														<KodiaSecondaryButton
															onClick={() => updateReq({
																assertions: [...(req.assertions ?? []), { id: `a-${Date.now()}`, name: 'Status 200', kind: 'status_equals', expected: '200', enabled: true } satisfies ApiAssertionSpec],
															})}
															className='!py-1 !text-[11px]'
														>
															<Plus size={11} /> Add Assertion
														</KodiaSecondaryButton>
													</div>
													<textarea
														value={req.testScript ?? ''}
														onChange={e => updateReq({ testScript: e.target.value })}
														placeholder={'// Sandboxed test script:\nkodia.test("has valid JSON", () => { kodia.expect(kodia.response.status).toBe(200); });'}
														className='w-full h-24 p-2 rounded bg-void-bg-1 border border-void-border-2 font-mono text-xs text-void-fg-1 outline-none'
													/>
												</div>
											)}

											{reqTab === 'settings' && (
												<div className='grid grid-cols-2 gap-3 max-w-md text-xs'>
													<label className='flex flex-col gap-1'>
														<span className='text-void-fg-3'>Request Name</span>
														<input value={req.name} onChange={e => updateReq({ name: e.target.value })} className='px-2 py-1 rounded bg-void-bg-1 border border-void-border-2' />
													</label>
													<label className='flex flex-col gap-1'>
														<span className='text-void-fg-3'>Timeout (ms)</span>
														<input type='number' value={req.timeoutMs ?? 15000} onChange={e => updateReq({ timeoutMs: Number(e.target.value) || 15000 })} className='px-2 py-1 rounded bg-void-bg-1 border border-void-border-2' />
													</label>
												</div>
											)}
										</div>
									</div>

									{/* Response Inspection Pane */}
									<div className='flex flex-col min-h-0 overflow-hidden bg-void-bg-2'>
										<div className='px-2.5 py-1.5 border-b border-void-border-2 bg-void-bg-1/50 flex flex-wrap items-center gap-2 shrink-0'>
											<div className='flex items-center gap-1'>
												{([
													['pretty', 'Pretty'],
													['tree', 'JSON Tree'],
													['raw', 'Raw'],
													['headers', `Headers (${Object.keys(res?.headers ?? {}).length})`],
													['cookies', `Cookies (${res?.cookies.length ?? 0})`],
													['timing', 'Timing'],
													['assertions', `Assertions (${res?.assertionResults.filter(a => a.passed).length ?? 0}/${res?.assertionResults.length ?? 0})`],
													['sse', `SSE (${res?.sseEvents?.length ?? 0})`],
													['diff', 'Diff'],
												] as const).map(([id, label]) => (
													<button
														key={id}
														type='button'
														onClick={() => setResTab(id)}
														className={`px-2 py-0.5 rounded text-[11px] cursor-pointer ${resTab === id ? 'bg-void-bg-3 text-void-fg-1 font-medium' : 'text-void-fg-3 hover:text-void-fg-1'}`}
													>
														{label}
													</button>
												))}
											</div>
											{res && (
												<div className='ml-auto flex items-center gap-2 text-[11px] font-mono'>
													{res.isMock && <KodiaBadge tone='warning'>MOCK SERVER</KodiaBadge>}
													<KodiaBadge tone={res.ok ? 'success' : res.status >= 400 || res.error ? 'error' : 'warning'}>
														{res.status ? `${res.status} ${res.statusText}` : res.statusText}
													</KodiaBadge>
													<span className='text-void-fg-2'>{res.timing.totalMs} ms</span>
													<span className='text-void-fg-3'>{res.sizeBytes} B</span>
												</div>
											)}
										</div>

										<div className='flex-1 min-h-0 overflow-auto'>
											{!res ? (
												<div className='p-6 text-xs text-void-fg-3'>
													Send a request (or press Ctrl+Enter in the URL bar) to inspect real HTTP status, headers, cookies, measured DNS/TCP/TLS/TTFB timing waterfall, JSON tree, and assertions.
												</div>
											) : resTab === 'pretty' ? (
												<pre className='p-3 text-xs font-mono text-void-fg-1 whitespace-pre-wrap break-words'>{res.error ? `Error: ${res.error}` : formattedResponseBody}</pre>
											) : resTab === 'tree' ? (
												<ApiStudioJsonTree rawBody={res.body} />
											) : resTab === 'raw' ? (
												<pre className='p-3 text-xs font-mono text-void-fg-2 whitespace-pre-wrap break-all'>{res.body}</pre>
											) : resTab === 'headers' ? (
												<div className='p-3 space-y-3 text-xs font-mono'>
													<div>
														<div className='font-sans font-semibold text-void-fg-1 mb-1'>Response Headers</div>
														{Object.entries(res.headers).map(([k, v]) => (
															<div key={k} className='grid grid-cols-[200px_1fr] gap-2 py-0.5 border-b border-void-border-2/40'>
																<span className='text-sky-300'>{k}</span>
																<span className='text-void-fg-2 break-all'>{v}</span>
															</div>
														))}
													</div>
													<div>
														<div className='font-sans font-semibold text-void-fg-1 mb-1'>Transmitted Request Headers (Secrets Redacted)</div>
														{Object.entries(res.transmittedHeaders).map(([k, v]) => (
															<div key={k} className='grid grid-cols-[200px_1fr] gap-2 py-0.5 border-b border-void-border-2/40'>
																<span className='text-amber-300'>{k}</span>
																<span className='text-void-fg-2 break-all'>{v}</span>
															</div>
														))}
													</div>
												</div>
											) : resTab === 'cookies' ? (
												<div className='p-3 text-xs font-mono space-y-1'>
													{res.cookies.length === 0 ? <div className='font-sans text-void-fg-3'>No Set-Cookie headers returned.</div> : res.cookies.map((c, i) => (
														<div key={i} className='p-2 rounded bg-void-bg-1 border border-void-border-2'>
															<span className='text-sky-300 font-semibold'>{c.name}</span>={c.value} · HttpOnly={String(Boolean(c.httpOnly))} · Secure={String(Boolean(c.secure))} · SameSite={c.sameSite ?? 'none'}
														</div>
													))}
												</div>
											) : resTab === 'timing' ? (
												<TimingWaterfall timing={res.timing} />
											) : resTab === 'assertions' ? (
												<div className='p-3 space-y-1.5 text-xs'>
													{res.assertionResults.length === 0 ? <div className='text-void-fg-3'>No assertions configured for this request.</div> : res.assertionResults.map(a => (
														<div key={a.id} className='flex items-center gap-2 p-2 rounded bg-void-bg-1 border border-void-border-2'>
															{a.passed ? <CheckCircle2 size={13} className='text-emerald-400 shrink-0' /> : <XCircle size={13} className='text-rose-400 shrink-0' />}
															<span className='font-medium text-void-fg-1'>{a.name}</span>
															<span className='text-void-fg-3'>{a.message}</span>
														</div>
													))}
												</div>
											) : resTab === 'sse' ? (
												<div className='p-3 space-y-1.5 text-xs font-mono'>
													{(res.sseEvents ?? []).length === 0 ? <div className='font-sans text-void-fg-3'>No SSE stream events captured on this response.</div> : (res.sseEvents ?? []).map((ev, i) => (
														<div key={i} className='p-2 rounded bg-void-bg-1 border border-void-border-2'>
															<span className='text-sky-400'>[{ev.event ?? 'message'}]</span> {ev.id ? `id=${ev.id} ` : ''}{ev.data}
														</div>
													))}
												</div>
											) : (
												<div className='p-3 space-y-2 text-xs'>
													{!diffVsPrev ? <div className='text-void-fg-3'>Execute at least two requests to compare responses structurally.</div> : (
														<>
															<div className='font-medium text-void-fg-1'>{diffVsPrev.summary}</div>
															{diffVsPrev.bodyDiffs.map((d, i) => (
																<div key={i} className='p-1.5 rounded bg-void-bg-1 border border-void-border-2 font-mono text-[11px]'>
																	<span className='uppercase text-amber-400 mr-2'>[{d.kind}]</span>
																	<span className='text-sky-300'>{d.path}</span>: {d.left ?? 'none'} {'->'} {d.right ?? 'none'}
																</div>
															))}
														</>
													)}
												</div>
											)}
										</div>
									</div>
								</div>
							</div>
						)}

						{/* SECTION: COLLECTIONS */}
						{state.activeSection === 'collections' && (
							<div className='p-4 space-y-3 overflow-auto h-full'>
								<div className='flex items-center justify-between'>
									<h3 className='text-sm font-semibold'>Collections & Saved Requests ({state.collections.length})</h3>
									<KodiaSecondaryButton onClick={() => setShowImportModal(true)}><Upload size={12} /> Import cURL / Postman</KodiaSecondaryButton>
								</div>
								{state.collections.length === 0 ? (
									<KodiaCard className='p-6 text-xs text-void-fg-3'>No collections saved yet. Save a request from the Request Builder or import a Postman/cURL collection.</KodiaCard>
								) : state.collections.map(col => (
									<KodiaCard key={col.id} className='p-3 space-y-2'>
										<div className='flex items-center justify-between'>
											<div className='text-xs font-semibold'>{col.name} ({col.requests.length} requests)</div>
											<div className='flex gap-1.5'>
												<KodiaSecondaryButton onClick={() => {
													const json = JSON.stringify(exportCollectionToPostman(col), null, 2);
													try { void navigator.clipboard?.writeText(json); } catch { /* ignore */ }
													flash(`Copied Postman v2.1 JSON for "${col.name}"`);
												}} className='!py-0.5 !px-2 !text-[10px]'>
													<Download size={10} /> Export Postman
												</KodiaSecondaryButton>
											</div>
										</div>
										<div className='space-y-1'>
											{col.requests.map(r => (
												<button
													key={r.id}
													type='button'
													onClick={() => { apiService.setActiveRequest(r); apiService.setActiveSection('requests'); }}
													className='w-full flex items-center gap-2 px-2 py-1 rounded hover:bg-void-bg-3 text-left text-xs cursor-pointer'
												>
													<span className={`px-1.5 rounded text-[10px] font-mono border ${METHOD_COLORS[r.method] ?? METHOD_COLORS.GET}`}>{r.method}</span>
													<span className='font-medium text-void-fg-1'>{r.name}</span>
													<span className='font-mono text-[11px] text-void-fg-3 truncate ml-auto'>{r.url}</span>
												</button>
											))}
										</div>
									</KodiaCard>
								))}
							</div>
						)}

						{/* SECTION: API EXPLORER */}
						{state.activeSection === 'explorer' && (
							<div className='p-4 space-y-3 overflow-auto h-full'>
								<div className='flex items-center justify-between'>
									<div>
										<h3 className='text-sm font-semibold'>Discovered Project API Explorer</h3>
										<p className='text-xs text-void-fg-3'>{state.discovery?.summary ?? 'Click Discover APIs to scan Express, NestJS, FastAPI, Go, Rust, Spring, ASP.NET, OpenAPI, GraphQL, and Protobuf routes.'}</p>
									</div>
									<div className='flex gap-2'>
										<KodiaSecondaryButton onClick={() => void handleDiscoverApis()}>Rescan Workspace</KodiaSecondaryButton>
										<KodiaPrimaryButton onClick={() => void handleGenerateAndRunSuite(false)}>Generate Test Suite</KodiaPrimaryButton>
									</div>
								</div>
								<div className='space-y-1.5'>
									{(state.discovery?.routes ?? []).map(r => (
										<KodiaCard key={r.id} className='p-2.5 flex items-center gap-2.5 text-xs'>
											<span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold border ${METHOD_COLORS[r.method] ?? METHOD_COLORS.GET}`}>{r.method}</span>
											<span className='font-mono text-void-fg-1 font-medium'>{r.path}</span>
											<KodiaBadge tone='neutral'>{r.framework}</KodiaBadge>
											{r.requiresAuth && <KodiaBadge tone='warning'>AUTH</KodiaBadge>}
											<span className='ml-auto font-mono text-[10px] text-void-fg-3'>{r.filePath}:{r.line}</span>
											<KodiaSecondaryButton
												onClick={() => {
													const base = activeEnv?.baseUrl || state.runtimes.find(rt => rt.baseUrl)?.baseUrl || 'http://127.0.0.1:3000';
													updateReq({
														id: `load-${r.id}`,
														name: `${r.method} ${r.path}`,
														method: (r.method === 'ALL' || r.method === 'WS' || r.method === 'GRAPHQL' || r.method === 'GRPC' ? 'GET' : r.method),
														protocol: r.protocol,
														url: `${base.replace(/\/+$/, '')}${r.path}`,
													});
													apiService.setActiveSection('requests');
												}}
												className='!py-0.5 !px-2 !text-[10px]'
											>
												Test
											</KodiaSecondaryButton>
										</KodiaCard>
									))}
								</div>
							</div>
						)}

						{/* SECTION: SPECS / OPENAPI */}
						{state.activeSection === 'specs' && (
							<div className='p-4 space-y-3 overflow-auto h-full'>
								<div className='flex items-center justify-between'>
									<h3 className='text-sm font-semibold'>OpenAPI 3.1 & API Specification Explorer</h3>
									<KodiaSecondaryButton onClick={() => { try { void navigator.clipboard?.writeText(openApiPreview); } catch { /* ignore */ } flash('Copied OpenAPI 3.1 JSON'); }}>
										<Copy size={11} /> Copy Generated OpenAPI 3.1
									</KodiaSecondaryButton>
								</div>
								<pre className='p-3 rounded bg-void-bg-1 border border-void-border-2 font-mono text-[11px] overflow-auto max-h-[520px] text-void-fg-2'>
									{openApiPreview || 'Run Discover APIs first to generate an OpenAPI 3.1 specification from your project routes.'}
								</pre>
							</div>
						)}

						{/* SECTION: GRAPHQL */}
						{state.activeSection === 'graphql' && (
							<div className='p-4 space-y-3 overflow-auto h-full'>
								<div className='flex items-center gap-2'>
									<input value={gqlUrl} onChange={e => setGqlUrl(e.target.value)} className='flex-1 px-2.5 py-1.5 text-xs font-mono rounded bg-void-bg-1 border border-void-border-2' />
									<KodiaPrimaryButton onClick={async () => {
										if (!apiMain) { return; }
										const gqlReq: ApiRequestSpec = {
											id: `gql-${Date.now().toString(36)}`,
											name: 'GraphQL Operation',
											protocol: 'graphql',
											method: 'POST',
											url: gqlUrl,
											params: [],
											headers: [{ id: 'ct', key: 'Content-Type', value: 'application/json', enabled: true }],
											auth: req.auth,
											body: { mode: 'graphql', graphqlQuery: gqlQuery, graphqlVariables: gqlVars },
										};
										const out = await apiMain.executeRequest(workspaceRoot, { request: gqlReq, environmentId: state.activeEnvironmentId ?? undefined });
										apiService.recordResponse(out);
										apiService.setActiveSection('requests');
									}}>
										<Play size={12} /> Execute Query
									</KodiaPrimaryButton>
								</div>
								<div className='grid grid-cols-1 md:grid-cols-2 gap-3'>
									<textarea value={gqlQuery} onChange={e => setGqlQuery(e.target.value)} className='h-56 p-2.5 rounded bg-void-bg-1 border border-void-border-2 font-mono text-xs' />
									<textarea value={gqlVars} onChange={e => setGqlVars(e.target.value)} placeholder='Variables JSON' className='h-56 p-2.5 rounded bg-void-bg-1 border border-void-border-2 font-mono text-xs' />
								</div>
							</div>
						)}

						{/* SECTION: GRPC */}
						{state.activeSection === 'grpc' && (
							<div className='p-4 space-y-3 overflow-auto h-full'>
								<h3 className='text-sm font-semibold'>gRPC Protocol Buffer Services & Invocation</h3>
								<div className='grid grid-cols-1 md:grid-cols-3 gap-2'>
									<input value={grpcAddr} onChange={e => setGrpcAddr(e.target.value)} placeholder='127.0.0.1:50051' className='px-2.5 py-1.5 text-xs font-mono rounded bg-void-bg-1 border border-void-border-2' />
									<input value={grpcMethod} onChange={e => setGrpcMethod(e.target.value)} placeholder='pkg.Service/Method' className='px-2.5 py-1.5 text-xs font-mono rounded bg-void-bg-1 border border-void-border-2' />
									<KodiaPrimaryButton onClick={async () => {
										if (!apiMain || !grpcMethod.trim()) { return; }
										const out = await apiMain.invokeGrpc(workspaceRoot, { address: grpcAddr, serviceMethod: grpcMethod, payloadJson: grpcPayload });
										setGrpcOutput(out.ok ? out.output : `Error (${out.engine}): ${out.error}`);
									}}>Invoke RPC (grpcurl)</KodiaPrimaryButton>
								</div>
								<textarea value={grpcPayload} onChange={e => setGrpcPayload(e.target.value)} className='w-full h-24 p-2 rounded bg-void-bg-1 border border-void-border-2 font-mono text-xs' />
								{grpcOutput && <pre className='p-2.5 rounded bg-void-bg-1 border border-void-border-2 font-mono text-xs whitespace-pre-wrap'>{grpcOutput}</pre>}
								{(state.discovery?.grpcMethods ?? []).map((gm, i) => (
									<KodiaCard key={i} className='p-2 text-xs font-mono flex items-center justify-between'>
										<span>{gm.serviceName}/{gm.methodName} ({gm.requestType} {'->'} {gm.responseType}) [{gm.streaming}]</span>
										<KodiaSecondaryButton onClick={() => setGrpcMethod(`${gm.serviceName}/${gm.methodName}`)} className='!py-0.5 !px-2 !text-[10px]'>Select</KodiaSecondaryButton>
									</KodiaCard>
								))}
							</div>
						)}

						{/* SECTION: WEBSOCKETS */}
						{state.activeSection === 'websockets' && (
							<div className='p-4 space-y-3 overflow-auto h-full'>
								<div className='flex items-center gap-2'>
									<input value={wsUrl} onChange={e => setWsUrl(e.target.value)} placeholder='ws://127.0.0.1:3000/ws' className='flex-1 px-2.5 py-1.5 text-xs font-mono rounded bg-void-bg-1 border border-void-border-2' />
									<KodiaPrimaryButton onClick={async () => {
										if (!apiMain) { return; }
										const sess = await apiMain.connectWebSocket(workspaceRoot, { url: wsUrl });
										setSelectedWsId(sess.sessionId);
										apiService.recordWebSockets(await apiMain.listWebSockets());
									}}>Connect WS</KodiaPrimaryButton>
								</div>
								{state.webSockets.map(sess => (
									<KodiaCard key={sess.sessionId} className='p-3 space-y-2'>
										<div className='flex items-center justify-between text-xs'>
											<div className='flex items-center gap-2'>
												<span className='font-mono font-semibold'>{sess.url}</span>
												<KodiaBadge tone={sess.status === 'open' ? 'success' : sess.status === 'error' ? 'error' : 'neutral'}>{sess.status}</KodiaBadge>
												{sess.handshakeStatus && <span className='text-[10px] text-void-fg-3'>HTTP {sess.handshakeStatus}</span>}
											</div>
											{sess.status === 'open' && (
												<KodiaSecondaryButton onClick={async () => {
													if (!apiMain) { return; }
													await apiMain.closeWebSocket(sess.sessionId);
													apiService.recordWebSockets(await apiMain.listWebSockets());
												}} className='!py-0.5 !px-2 !text-[10px]'>Disconnect</KodiaSecondaryButton>
											)}
										</div>
										{sess.status === 'open' && (
											<div className='flex gap-2'>
												<input value={selectedWsId === sess.sessionId ? wsMsg : wsMsg} onChange={e => { setSelectedWsId(sess.sessionId); setWsMsg(e.target.value); }} className='flex-1 px-2 py-1 text-xs font-mono rounded bg-void-bg-1 border border-void-border-2' />
												<KodiaPrimaryButton onClick={async () => {
													if (!apiMain) { return; }
													await apiMain.sendWebSocketMessage(sess.sessionId, wsMsg, 'text');
													apiService.recordWebSockets(await apiMain.listWebSockets());
												}} className='!py-1 !text-[11px]'>Send Frame</KodiaPrimaryButton>
											</div>
										)}
										<div className='max-h-44 overflow-auto space-y-1 font-mono text-[11px]'>
											{sess.messages.map(m => (
												<div key={m.id} className='px-2 py-1 rounded bg-void-bg-1 border border-void-border-2/60'>
													<span className={m.direction === 'sent' ? 'text-amber-400' : m.direction === 'received' ? 'text-emerald-400' : 'text-sky-400'}>
														[{m.direction.toUpperCase()}/{m.kind}]
													</span>{' '}
													{m.data}
												</div>
											))}
										</div>
									</KodiaCard>
								))}
							</div>
						)}

						{/* SECTION: ENVIRONMENTS */}
						{state.activeSection === 'environments' && (
							<div className='p-4 space-y-3 overflow-auto h-full'>
								<KodiaCard className='p-3 space-y-2'>
									<div className='text-xs font-semibold'>Create / Update Environment</div>
									<div className='grid grid-cols-1 md:grid-cols-4 gap-2'>
										<input value={newEnvName} onChange={e => setNewEnvName(e.target.value)} placeholder='Name (e.g. Staging)' className='px-2 py-1 text-xs rounded bg-void-bg-1 border border-void-border-2' />
										<select value={newEnvKind} onChange={e => setNewEnvKind(e.target.value as ApiEnvironment['kind'])} className='px-2 py-1 text-xs rounded bg-void-bg-1 border border-void-border-2'>
											<option value='local'>local</option>
											<option value='development'>development</option>
											<option value='testing'>testing</option>
											<option value='staging'>staging</option>
											<option value='production'>production (protected)</option>
										</select>
										<input value={newEnvBaseUrl} onChange={e => setNewEnvBaseUrl(e.target.value)} placeholder='Base URL' className='px-2 py-1 text-xs font-mono rounded bg-void-bg-1 border border-void-border-2' />
										<KodiaPrimaryButton onClick={async () => {
											if (!apiMain) { return; }
											const env: ApiEnvironment = {
												id: `env-${newEnvName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
												name: newEnvName.trim() || 'Local',
												kind: newEnvKind,
												baseUrl: newEnvBaseUrl.trim(),
												isProtected: newEnvKind === 'production',
												variables: [{ id: 'v-base', key: 'baseUrl', value: newEnvBaseUrl.trim(), enabled: true }],
												updatedAt: new Date().toISOString(),
											};
											const saved = await apiMain.saveEnvironment(workspaceRoot, env, true);
											apiService.recordEnvironments(saved.environments, saved.activeEnvironmentId);
											flash(`Saved & activated environment "${env.name}"`);
										}}>Save & Activate</KodiaPrimaryButton>
									</div>
								</KodiaCard>
								{state.environments.map(e => (
									<KodiaCard key={e.id} className='p-3 flex items-center justify-between text-xs'>
										<div>
											<span className='font-semibold'>{e.name}</span>{' '}
											<KodiaBadge tone={e.isProtected || e.kind === 'production' ? 'error' : 'neutral'}>{e.kind}</KodiaBadge>{' '}
											<span className='font-mono text-void-fg-3'>{e.baseUrl}</span>
										</div>
										<KodiaSecondaryButton onClick={async () => {
											if (!apiMain) { return; }
											await apiMain.setActiveEnvironment(workspaceRoot, e.id);
											apiService.recordEnvironments(state.environments, e.id);
										}} className='!py-0.5 !px-2 !text-[10px]'>
											{state.activeEnvironmentId === e.id ? 'Active' : 'Activate'}
										</KodiaSecondaryButton>
									</KodiaCard>
								))}
							</div>
						)}

						{/* SECTION: TEST SUITES & LIVE TEST RUNNER */}
						{(state.activeSection === 'suites' || state.activeSection === 'runner') && (
							<div className='p-4 space-y-3 overflow-auto h-full'>
								<div className='flex items-center justify-between'>
									<h3 className='text-sm font-semibold'>Automated API Test Suites & Live Runner</h3>
									<KodiaPrimaryButton disabled={busyOp === 'suite' || busyOp === 'runner'} onClick={() => void handleGenerateAndRunSuite(true)}>
										<Play size={12} /> Generate & Run Suite
									</KodiaPrimaryButton>
								</div>
								{state.suites.map(s => (
									<KodiaCard key={s.id} className='p-3 flex items-center justify-between text-xs'>
										<div>
											<div className='font-semibold'>{s.name}</div>
											<div className='text-void-fg-3'>{s.requests.length} test(s) · {s.baseUrl}</div>
										</div>
										<KodiaPrimaryButton onClick={() => void handleRunSuiteById(s.id)} className='!py-1 !text-[11px]'>
											<Play size={11} /> Run Suite
										</KodiaPrimaryButton>
									</KodiaCard>
								))}
								{state.testRuns.map(run => (
									<KodiaCard key={run.runId} className='p-3 space-y-2'>
										<div className='flex items-center justify-between text-xs'>
											<div className='font-semibold'>{run.suiteName} · {run.summary}</div>
											<div className='flex items-center gap-1.5'>
												<KodiaBadge tone={run.failed === 0 && run.blocked === 0 ? 'success' : 'error'}>
													{run.passed}/{run.total} passed
												</KodiaBadge>
												<KodiaSecondaryButton onClick={() => { try { void navigator.clipboard?.writeText(exportTestRunToCsv(run)); } catch { /* ignore */ } flash('Copied CSV report'); }} className='!py-0.5 !px-2 !text-[10px]'>
													CSV
												</KodiaSecondaryButton>
											</div>
										</div>
										<div className='space-y-1'>
											{run.cases.map(c => (
												<div key={`${run.runId}-${c.requestId}`} className='flex items-center gap-2 text-[11px] font-mono px-2 py-1 rounded bg-void-bg-1 border border-void-border-2/60'>
													{c.status === 'passed' ? <CheckCircle2 size={12} className='text-emerald-400 shrink-0' /> : <XCircle size={12} className='text-rose-400 shrink-0' />}
													<span className='font-semibold'>{c.method}</span>
													<span className='truncate'>{c.url}</span>
													<span className='text-void-fg-3 ml-auto'>{c.httpStatus ?? 0} · {c.durationMs}ms</span>
													{c.failureReason && <span className='text-rose-400 truncate max-w-xs'>{c.failureReason}</span>}
												</div>
											))}
										</div>
									</KodiaCard>
								))}
							</div>
						)}

						{/* SECTION: PERFORMANCE & LOAD */}
						{state.activeSection === 'performance' && (
							<LoadTestDashboard
								loadRuns={state.loadRuns}
								defaultUrl={req.url}
								running={busyOp === 'load'}
								onRunLoad={cfg => void handleRunLoad(cfg)}
							/>
						)}

						{/* SECTION: SECURITY & PRODUCTION READINESS */}
						{(state.activeSection === 'security' || state.activeSection === 'readiness') && (
							<SecurityAndReadinessView
								mode={state.activeSection}
								securityReport={state.securityReports[0] ?? null}
								readinessReport={state.latestReadiness}
								busy={busyOp === 'security' || busyOp === 'readiness'}
								onRunSecurity={() => void handleRunSecurity()}
								onRunReadiness={() => void handleRunReadiness()}
							/>
						)}

						{/* SECTION: MOCK SERVERS */}
						{state.activeSection === 'mocks' && (
							<div className='p-4 space-y-3 overflow-auto h-full'>
								<KodiaCard className='p-3 space-y-2'>
									<div className='text-xs font-semibold'>Start Disposable Local Mock Server (Always Flagged IS_MOCK)</div>
									<div className='grid grid-cols-1 md:grid-cols-4 gap-2'>
										<input value={mockName} onChange={e => setMockName(e.target.value)} className='px-2 py-1 text-xs rounded bg-void-bg-1 border border-void-border-2' />
										<input value={mockPath} onChange={e => setMockPath(e.target.value)} className='px-2 py-1 text-xs font-mono rounded bg-void-bg-1 border border-void-border-2' />
										<input value={mockBody} onChange={e => setMockBody(e.target.value)} className='px-2 py-1 text-xs font-mono rounded bg-void-bg-1 border border-void-border-2' />
										<KodiaPrimaryButton onClick={async () => {
											if (!apiMain) { return; }
											await apiMain.startMockServer(workspaceRoot, {
												name: mockName,
												routes: [{ id: 'm1', method: 'GET', path: mockPath, status: 200, body: mockBody }],
											});
											apiService.recordMockServers(await apiMain.listMockServers());
										}}>Start Mock Server</KodiaPrimaryButton>
									</div>
								</KodiaCard>
								{state.mockServers.map(m => (
									<KodiaCard key={m.mockId} className='p-3 flex items-center justify-between text-xs'>
										<div className='flex items-center gap-2'>
											<KodiaBadge tone='warning'>MOCK SERVER</KodiaBadge>
											<span className='font-semibold'>{m.name}</span>
											<span className='font-mono text-sky-400'>{m.baseUrl}</span>
											<span className='text-void-fg-3'>{m.requestCount} requests served</span>
										</div>
										<KodiaSecondaryButton onClick={async () => {
											if (!apiMain) { return; }
											await apiMain.stopMockServer(m.mockId);
											apiService.recordMockServers(await apiMain.listMockServers());
										}} className='!py-0.5 !px-2 !text-[10px]'>Stop</KodiaSecondaryButton>
									</KodiaCard>
								))}
							</div>
						)}

						{/* SECTION: RUNTIMES & SERVICE TOPOLOGY */}
						{state.activeSection === 'topology' && (
							<RuntimesTopologyView
								runtimes={state.runtimes}
								mermaidTopology={state.discovery?.mermaidTopology}
								onStartRuntime={async (name, command, port) => {
									if (!apiMain) { return; }
									await apiMain.startRuntime(workspaceRoot, { name, command, port });
									apiService.recordRuntimes(await apiMain.listRuntimes());
								}}
								onStopRuntime={async runtimeId => {
									if (!apiMain) { return; }
									await apiMain.stopRuntime(runtimeId);
									apiService.recordRuntimes(await apiMain.listRuntimes());
								}}
							/>
						)}

						{/* SECTION: HISTORY & DIFF */}
						{state.activeSection === 'history' && (
							<div className='p-4 space-y-2 overflow-auto h-full'>
								<h3 className='text-sm font-semibold'>Execution History ({state.history.length})</h3>
								{state.history.map(h => (
									<KodiaCard key={h.id} className='p-2.5 flex items-center gap-2 text-xs'>
										<span className={`px-1.5 rounded text-[10px] font-mono border ${METHOD_COLORS[h.request.method] ?? METHOD_COLORS.GET}`}>{h.request.method}</span>
										<span className='font-mono truncate flex-1'>{h.response.resolvedUrl}</span>
										<KodiaBadge tone={h.response.ok ? 'success' : 'error'}>{h.response.status || 'ERR'}</KodiaBadge>
										<span className='font-mono text-[11px] text-void-fg-3'>{h.response.timing.totalMs}ms</span>
										<KodiaSecondaryButton onClick={() => { apiService.setActiveRequest(h.request); apiService.recordResponse(h.response); apiService.setActiveSection('requests'); }} className='!py-0.5 !px-2 !text-[10px]'>
											Inspect
										</KodiaSecondaryButton>
									</KodiaCard>
								))}
							</div>
						)}
					</div>

					{/* Bottom Live Execution Stream Drawer */}
					{showLiveDrawer && (
						<div className='h-48 border-t border-void-border-2 bg-void-bg-1 shrink-0 min-h-0'>
							<LiveEventStreamPanel events={state.liveEvents} onClear={() => apiService.clearLiveEvents()} />
						</div>
					)}
				</main>
			</div>

			{/* Code / SDK Generator Modal */}
			{showCodeGen && (
				<div className='fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4'>
					<KodiaCard className='w-full max-w-2xl p-4 space-y-3 bg-void-bg-1'>
						<div className='flex items-center justify-between'>
							<span className='text-sm font-semibold'>Generate API Client / SDK Code</span>
							<button type='button' onClick={() => setShowCodeGen(false)} className='p-1 cursor-pointer'><X size={14} /></button>
						</div>
						<div className='flex flex-wrap gap-1'>
							{(['curl', 'fetch', 'typescript-sdk', 'python', 'go', 'rust', 'csharp', 'java'] as ClientCodeTarget[]).map(t => (
								<button key={t} type='button' onClick={() => setCodeTarget(t)} className={`px-2 py-1 rounded text-xs cursor-pointer ${codeTarget === t ? 'bg-void-bg-3 font-semibold' : 'text-void-fg-3 hover:text-void-fg-1'}`}>{t}</button>
							))}
						</div>
						<pre className='p-3 rounded bg-void-bg-2 border border-void-border-2 font-mono text-xs overflow-auto max-h-72'>{generateApiClientCode(req, codeTarget)}</pre>
						<div className='flex justify-end gap-2'>
							<KodiaPrimaryButton onClick={() => { try { void navigator.clipboard?.writeText(generateApiClientCode(req, codeTarget)); } catch { /* ignore */ } flash('Copied client code'); setShowCodeGen(false); }}>
								<Copy size={12} /> Copy Snippet
							</KodiaPrimaryButton>
						</div>
					</KodiaCard>
				</div>
			)}

			{/* Import Modal (cURL / Postman) */}
			{showImportModal && (
				<div className='fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4'>
					<KodiaCard className='w-full max-w-xl p-4 space-y-3 bg-void-bg-1'>
						<div className='flex items-center justify-between'>
							<span className='text-sm font-semibold'>Import API Collection / Request</span>
							<button type='button' onClick={() => setShowImportModal(false)} className='p-1 cursor-pointer'><X size={14} /></button>
						</div>
						<div className='flex gap-2'>
							<button type='button' onClick={() => setImportKind('curl')} className={`px-2.5 py-1 rounded text-xs cursor-pointer ${importKind === 'curl' ? 'bg-void-bg-3 font-semibold' : 'text-void-fg-3'}`}>cURL Command</button>
							<button type='button' onClick={() => setImportKind('postman')} className={`px-2.5 py-1 rounded text-xs cursor-pointer ${importKind === 'postman' ? 'bg-void-bg-3 font-semibold' : 'text-void-fg-3'}`}>Postman Collection v2.1 JSON</button>
						</div>
						<textarea value={importText} onChange={e => setImportText(e.target.value)} placeholder={importKind === 'curl' ? "curl -X POST 'http://127.0.0.1:3000/api/items' -H 'Content-Type: application/json' -d '{\"name\":\"demo\"}'" : 'Paste Postman v2.1 JSON...'} className='w-full h-44 p-2.5 rounded bg-void-bg-2 border border-void-border-2 font-mono text-xs' />
						<div className='flex justify-end gap-2'>
							<KodiaSecondaryButton onClick={() => setShowImportModal(false)}>Cancel</KodiaSecondaryButton>
							<KodiaPrimaryButton onClick={() => void handleImportSubmit()}>Import</KodiaPrimaryButton>
						</div>
					</KodiaCard>
				</div>
			)}
		</div>
	);
};
