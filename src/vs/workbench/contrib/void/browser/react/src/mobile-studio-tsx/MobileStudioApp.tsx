/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useCallback, useEffect, useState } from 'react';
import {
	Activity,
	Cpu,
	Hammer,
	Layers,
	Play,
	RefreshCw,
	Rocket,
	Search,
	ShieldAlert,
	Smartphone,
	Zap,
} from 'lucide-react';
import '../styles.css';
import { useAccessor, useIsDark } from '../util/services.js';
import { KodiaBadge, KodiaCard, KodiaPrimaryButton, KodiaSecondaryButton } from '../util/KodiaDesignSystem.js';
import {
	MobileAppCategory,
	MobileBackendStack,
	MobileDatabaseId,
	MobileFrameworkId,
	MobileStudioSection,
	MobileTargetPlatform,
} from '../../../../common/mobileEngineeringTypes.js';
import { MobileWorkbenchState } from '../../../mobileEngineeringService.js';

const SECTIONS: readonly { id: MobileStudioSection; label: string; icon: React.ReactNode }[] = [
	{ id: 'overview', label: 'Overview & Intel', icon: <Smartphone size={13} /> },
	{ id: 'architecture', label: 'Architecture & Scaffold', icon: <Layers size={13} /> },
	{ id: 'devices', label: 'Device & Simulator Lab', icon: <Cpu size={13} /> },
	{ id: 'build', label: 'Build & Tests', icon: <Hammer size={13} /> },
	{ id: 'security', label: 'MASVS Security & Perf', icon: <ShieldAlert size={13} /> },
	{ id: 'release', label: 'Store Readiness', icon: <Rocket size={13} /> },
];

export const MobileStudioApp: React.FC = () => {
	const isDark = useIsDark();
	const accessor = useAccessor();
	const mobileService = accessor.get('IMobileEngineeringService');
	const toolsService = accessor.get('IToolsService');

	const [state, setState] = useState<MobileWorkbenchState>(() => mobileService.state);
	const [busy, setBusy] = useState<string | null>(null);
	const [errorMsg, setErrorMsg] = useState<string | null>(null);

	// Architecture / Scaffold form state
	const [projectName, setProjectName] = useState('KodiaMobileApp');
	const [targetDir, setTargetDir] = useState('');
	const [objective, setObjective] = useState('Build a cross-platform mobile app with authentication, offline-first sync, and REST API backend.');
	const [platform, setPlatform] = useState<MobileTargetPlatform>('both');
	const [framework, setFramework] = useState<MobileFrameworkId>('react-native-expo');
	const [category, setCategory] = useState<MobileAppCategory>('general');
	const [backend, setBackend] = useState<MobileBackendStack>('python-fastapi');
	const [database, setDatabase] = useState<MobileDatabaseId>('sqlite');
	const [includeAI, setIncludeAI] = useState(false);
	const [includeOffline, setIncludeOffline] = useState(true);
	const [buildTargetDir, setBuildTargetDir] = useState('');

	useEffect(() => {
		const sync = () => setState(mobileService.state);
		const d = mobileService.onDidChange(sync);
		void mobileService.refreshFromDisk();
		return () => d.dispose();
	}, [mobileService]);

	const runAction = useCallback(async (label: string, fn: () => Promise<unknown>) => {
		setBusy(label);
		setErrorMsg(null);
		try {
			await fn();
			await mobileService.refreshFromDisk();
		} catch (e) {
			setErrorMsg(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(null);
		}
	}, [mobileService]);

	const handleProbe = useCallback(() => runAction('Probing SDKs & devices…', async () => {
		await toolsService.callTool.mobile_probe_environment({});
	}), [runAction, toolsService]);

	const handleInspect = useCallback(() => runAction('Inspecting mobile workspace…', async () => {
		await toolsService.callTool.mobile_inspect_project({});
	}), [runAction, toolsService]);

	const handleDesign = useCallback(() => runAction('Designing Three-Engine mobile architecture…', async () => {
		await toolsService.callTool.mobile_design_architecture({
			objective,
			platform,
			framework,
			app_category: category,
			backend,
			database,
			include_ai: includeAI,
			include_offline: includeOffline,
			include_auth: true,
		});
		mobileService.setActiveSection('architecture');
	}), [runAction, toolsService, objective, platform, framework, category, backend, database, includeAI, includeOffline, mobileService]);

	const handleScaffold = useCallback(() => runAction('Scaffolding real mobile project…', async () => {
		await toolsService.callTool.mobile_scaffold_project({
			project_name: projectName.trim() || 'KodiaMobileApp',
			target_dir: targetDir.trim() || undefined,
			objective,
			framework,
			platform,
			app_category: category,
			backend,
			database,
			include_ai: includeAI,
			include_offline: includeOffline,
			include_auth: true,
		});
		await toolsService.callTool.mobile_inspect_project({});
	}), [runAction, toolsService, projectName, targetDir, objective, framework, platform, category, backend, database, includeAI, includeOffline]);

	const handleBuildTest = useCallback((mode: 'test' | 'build' | 'typecheck' | 'backend_test') => runAction(`Running mobile ${mode}…`, async () => {
		await toolsService.callTool.mobile_build_and_test({
			mode,
			target_dir: buildTargetDir.trim() || targetDir.trim() || undefined,
			framework,
		});
		mobileService.setActiveSection('build');
	}), [runAction, toolsService, buildTargetDir, targetDir, framework, mobileService]);

	const handleSecurityPerf = useCallback(() => runAction('Running MASVS security & performance audits…', async () => {
		await toolsService.callTool.mobile_audit_security({});
		await toolsService.callTool.mobile_audit_performance({});
		mobileService.setActiveSection('security');
	}), [runAction, toolsService, mobileService]);

	const handleReadiness = useCallback(() => runAction('Evaluating store & production readiness…', async () => {
		await toolsService.callTool.mobile_assess_readiness({});
		mobileService.setActiveSection('release');
	}), [runAction, toolsService, mobileService]);

	const env = state.environment;
	const intel = state.projectIntel;
	const arch = state.architecture;
	const sec = state.securityAudit;
	const perf = state.performanceAudit;
	const ready = state.readinessReport;

	return (
		<div className={`@@void-scope h-full w-full flex flex-col bg-void-bg-2 text-void-fg-1 text-xs ${isDark ? 'dark' : ''}`}>
			{/* Top Header */}
			<div className='flex items-center justify-between gap-2 px-4 py-2.5 border-b border-void-border-2 bg-void-bg-1 flex-shrink-0'>
				<div className='flex items-center gap-2 min-w-0'>
					<Smartphone size={16} className='text-blue-400 flex-shrink-0' />
					<span className='font-semibold text-sm truncate'>Kodia Mobile Application Engineering Studio</span>
					<KodiaBadge tone='accent'>{intel?.detected ? intel.frameworkLabel : 'Three-Engine Ready'}</KodiaBadge>
				</div>
				<div className='flex items-center gap-1.5 flex-shrink-0'>
					<KodiaSecondaryButton onClick={() => void handleProbe()} disabled={!!busy}>
						<Cpu size={12} />
						<span>Probe SDKs</span>
					</KodiaSecondaryButton>
					<KodiaSecondaryButton onClick={() => void handleInspect()} disabled={!!busy}>
						<Search size={12} />
						<span>Inspect Repo</span>
					</KodiaSecondaryButton>
					<KodiaSecondaryButton onClick={() => void mobileService.refreshFromDisk()} disabled={!!busy}>
						<RefreshCw size={12} />
						<span>Refresh</span>
					</KodiaSecondaryButton>
				</div>
			</div>

			{/* Section Nav */}
			<div className='kodia-thin-tabs flex items-center gap-1 px-4 py-1.5 border-b border-void-border-2 bg-void-bg-1/70 overflow-x-auto flex-shrink-0'>
				{SECTIONS.map(secTab => {
					const active = state.activeSection === secTab.id;
					return (
						<button
							key={secTab.id}
							type='button'
							onClick={() => mobileService.setActiveSection(secTab.id)}
							style={active ? { borderColor: 'var(--kodia-accent)' } : undefined}
							className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs whitespace-nowrap cursor-pointer transition-colors ${active
								? 'bg-void-bg-3 text-void-fg-1 font-medium border'
								: 'text-void-fg-3 hover:text-void-fg-1 hover:bg-void-bg-2 border border-transparent'
								}`}
						>
							{secTab.icon}
							<span>{secTab.label}</span>
						</button>
					);
				})}
			</div>

			{busy && (
				<div className='px-4 py-1.5 bg-blue-500/10 border-b border-blue-500/20 text-blue-300 flex items-center gap-2 text-[11px]'>
					<Zap size={12} className='animate-pulse' />
					<span>{busy}</span>
				</div>
			)}
			{errorMsg && (
				<div className='px-4 py-1.5 bg-red-500/10 border-b border-red-500/20 text-red-300 text-[11px]'>
					Error: {errorMsg}
				</div>
			)}

			{/* Main Body */}
			<div className='flex-1 overflow-y-auto p-4 grid grid-cols-1 lg:grid-cols-3 gap-4'>
				<div className='lg:col-span-2 flex flex-col gap-3'>
					{state.activeSection === 'overview' && (
						<>
							<div className='grid grid-cols-2 sm:grid-cols-4 gap-2'>
								<KodiaCard>
									<div className='text-[10px] text-void-fg-3'>Framework</div>
									<div className='text-sm font-semibold mt-0.5'>{intel?.detected ? intel.frameworkLabel : 'Not Scanned'}</div>
								</KodiaCard>
								<KodiaCard>
									<div className='text-[10px] text-void-fg-3'>Devices / AVDs</div>
									<div className='text-sm font-semibold mt-0.5'>{env ? `${env.devices.length} / ${env.androidAvds.length}` : '—'}</div>
								</KodiaCard>
								<KodiaCard>
									<div className='text-[10px] text-void-fg-3'>MASVS Security</div>
									<div className='text-sm font-semibold mt-0.5'>{sec ? `${sec.score}/100` : '—'}</div>
								</KodiaCard>
								<KodiaCard>
									<div className='text-[10px] text-void-fg-3'>Store Readiness</div>
									<div className='text-sm font-semibold mt-0.5'>{ready ? `${ready.readinessScore}/100` : '—'}</div>
								</KodiaCard>
							</div>

							<KodiaCard className='flex flex-col gap-2'>
								<div className='flex items-center justify-between'>
									<span className='font-semibold'>Mobile Project Intelligence</span>
									<KodiaSecondaryButton onClick={() => void handleInspect()} disabled={!!busy}>Scan Workspace</KodiaSecondaryButton>
								</div>
								{intel ? (
									<div className='space-y-1 text-[11px] text-void-fg-2'>
										<div><strong>Detected:</strong> {intel.frameworkLabel} ({intel.totalFilesScanned} files scanned)</div>
										<div><strong>Targets:</strong> {intel.targets.join(', ') || 'none'} | <strong>Languages:</strong> {intel.languages.join(', ') || 'none'}</div>
										<div><strong>Screens:</strong> {intel.screens.length} | <strong>Tests:</strong> {intel.testFiles.length} | <strong>Backend:</strong> {intel.backendDetected ? `${intel.backendDetected.stack} (${intel.backendDetected.path})` : 'none'}</div>
										{intel.permissionsDeclared.length > 0 && (
											<div><strong>Permissions:</strong> {intel.permissionsDeclared.join(', ')}</div>
										)}
									</div>
								) : (
									<div className='text-void-fg-3'>Click "Scan Workspace" to detect framework, screens, navigation, state, offline DBs, permissions, backend, and tests.</div>
								)}
							</KodiaCard>
						</>
					)}

					{state.activeSection === 'architecture' && (
						<>
							<KodiaCard className='flex flex-col gap-2.5'>
								<div className='font-semibold'>Three-Engine Mobile Architecture & Real Scaffolding</div>
								<div className='grid grid-cols-1 sm:grid-cols-2 gap-2'>
									<input value={projectName} onChange={e => setProjectName(e.target.value)} placeholder='Project name' className='px-2.5 py-1.5 rounded bg-void-bg-1 border border-void-border-2 text-xs' />
									<input value={targetDir} onChange={e => setTargetDir(e.target.value)} placeholder='Optional subfolder (e.g. apps/mobile)' className='px-2.5 py-1.5 rounded bg-void-bg-1 border border-void-border-2 text-xs' />
								</div>
								<textarea rows={3} value={objective} onChange={e => setObjective(e.target.value)} className='w-full p-2 rounded bg-void-bg-1 border border-void-border-2 text-xs' />
								<div className='grid grid-cols-2 sm:grid-cols-4 gap-2'>
									<select value={platform} onChange={e => setPlatform(e.target.value as MobileTargetPlatform)} className='px-2 py-1.5 rounded bg-void-bg-1 border border-void-border-2 text-xs'>
										<option value='both'>Android + iOS</option>
										<option value='android'>Android Only</option>
										<option value='ios'>iOS Only</option>
									</select>
									<select value={framework} onChange={e => setFramework(e.target.value as MobileFrameworkId)} className='px-2 py-1.5 rounded bg-void-bg-1 border border-void-border-2 text-xs'>
										<option value='react-native-expo'>React Native (Expo)</option>
										<option value='react-native-cli'>React Native CLI</option>
										<option value='flutter'>Flutter (Dart)</option>
										<option value='android-kotlin'>Native Android (Kotlin)</option>
										<option value='ios-swift'>Native iOS (Swift)</option>
										<option value='kotlin-multiplatform'>Kotlin Multiplatform</option>
										<option value='dotnet-maui'>.NET MAUI</option>
										<option value='ionic-capacitor'>Ionic / Capacitor</option>
									</select>
									<select value={backend} onChange={e => setBackend(e.target.value as MobileBackendStack)} className='px-2 py-1.5 rounded bg-void-bg-1 border border-void-border-2 text-xs'>
										<option value='python-fastapi'>Python / FastAPI</option>
										<option value='node-express'>Node / Express</option>
										<option value='node-nestjs'>Node / NestJS</option>
										<option value='go-gin'>Go / Gin</option>
										<option value='rust-axum'>Rust / Axum</option>
										<option value='java-spring'>Java / Spring Boot</option>
										<option value='php-laravel'>PHP / Laravel</option>
										<option value='supabase'>Supabase</option>
										<option value='firebase'>Firebase</option>
										<option value='none'>No Backend (Local)</option>
									</select>
									<select value={database} onChange={e => setDatabase(e.target.value as MobileDatabaseId)} className='px-2 py-1.5 rounded bg-void-bg-1 border border-void-border-2 text-xs'>
										<option value='sqlite'>SQLite</option>
										<option value='postgresql'>PostgreSQL</option>
										<option value='mysql'>MySQL</option>
										<option value='mongodb'>MongoDB</option>
										<option value='redis'>Redis</option>
										<option value='firestore'>Firestore</option>
										<option value='supabase'>Supabase DB</option>
										<option value='none'>None</option>
									</select>
								</div>
								<div className='flex flex-wrap items-center gap-3 text-[11px]'>
									<label className='flex items-center gap-1.5 cursor-pointer'>
										<input type='checkbox' checked={includeOffline} onChange={e => setIncludeOffline(e.target.checked)} />
										<span>Offline-First Sync Queue</span>
									</label>
									<label className='flex items-center gap-1.5 cursor-pointer'>
										<input type='checkbox' checked={includeAI} onChange={e => setIncludeAI(e.target.checked)} />
										<span>AI-Powered (Secure Proxy / Edge AI)</span>
									</label>
									<select value={category} onChange={e => setCategory(e.target.value as MobileAppCategory)} className='px-2 py-1 rounded bg-void-bg-1 border border-void-border-2 text-[11px]'>
										<option value='general'>General App</option>
										<option value='ai-powered'>AI-Powered</option>
										<option value='enterprise'>Enterprise</option>
										<option value='ecommerce'>E-Commerce</option>
										<option value='fintech'>Fintech</option>
										<option value='healthcare'>Healthcare</option>
										<option value='social'>Social</option>
										<option value='on-demand'>On-Demand</option>
										<option value='offline-first'>Offline-First</option>
										<option value='iot-companion'>IoT Companion</option>
									</select>
								</div>
								<div className='flex items-center gap-2'>
									<KodiaSecondaryButton onClick={() => void handleDesign()} disabled={!!busy}>Design Architecture</KodiaSecondaryButton>
									<KodiaPrimaryButton onClick={() => void handleScaffold()} disabled={!!busy}>
										<Hammer size={12} />
										<span>Generate Real Project Files</span>
									</KodiaPrimaryButton>
								</div>
							</KodiaCard>

							{arch && (
								<KodiaCard className='flex flex-col gap-1.5 text-[11px]'>
									<div className='font-semibold text-void-fg-1'>Architecture Blueprint — {arch.engineMode}</div>
									<div><strong>Engines:</strong> {arch.enginesEngaged.join(' + ')}</div>
									<div><strong>Pattern:</strong> {arch.architecturePattern} | <strong>State:</strong> {arch.stateManagement}</div>
									<div><strong>Navigation:</strong> {arch.navigationStrategy}</div>
									<div><strong>Offline:</strong> {arch.offlineStrategy.enabled ? `${arch.offlineStrategy.localStore} — ${arch.offlineStrategy.syncProtocol}` : 'Standard caching'}</div>
									<div><strong>AI:</strong> {arch.aiStrategy.enabled ? `${arch.aiStrategy.mode} (${arch.aiStrategy.runtimes.join(', ')})` : 'Disabled'}</div>
									<pre className='p-2 rounded bg-void-bg-1 border border-void-border-2 overflow-x-auto text-[10px] mt-1'>{arch.mermaidDiagram}</pre>
								</KodiaCard>
							)}
						</>
					)}

					{state.activeSection === 'devices' && (
						<KodiaCard className='flex flex-col gap-2'>
							<div className='flex items-center justify-between'>
								<span className='font-semibold'>Real SDK, Device & Simulator Lab</span>
								<KodiaPrimaryButton onClick={() => void handleProbe()} disabled={!!busy}>Probe Host Toolchains</KodiaPrimaryButton>
							</div>
							{env ? (
								<>
									<div className='text-[11px] text-void-fg-3'>Host: {env.hostPlatform}/{env.hostArch} • Probed {env.probedAt}</div>
									<div className='grid grid-cols-1 sm:grid-cols-2 gap-1.5'>
										{env.toolchains.map(tc => (
											<div key={tc.id} className='p-2 rounded bg-void-bg-1 border border-void-border-2 flex items-center justify-between gap-2'>
												<div className='min-w-0'>
													<div className='font-medium truncate'>{tc.name}</div>
													<div className='text-[10px] text-void-fg-3 truncate'>{tc.version ?? tc.note ?? 'Not installed'}</div>
												</div>
												<KodiaBadge tone={tc.installed ? 'success' : 'warning'}>{tc.installed ? 'Installed' : 'Missing'}</KodiaBadge>
											</div>
										))}
									</div>
									{env.platformLimitations.length > 0 && (
										<div className='p-2 rounded bg-amber-500/10 border border-amber-500/20 text-amber-200 text-[11px]'>
											{env.platformLimitations.map((l, idx) => <div key={idx}>• {l}</div>)}
										</div>
									)}
								</>
							) : (
								<div className='text-void-fg-3'>Run "Probe Host Toolchains" to discover real installed SDKs, ADB devices, Android AVDs, and iOS Simulators.</div>
							)}
						</KodiaCard>
					)}

					{state.activeSection === 'build' && (
						<KodiaCard className='flex flex-col gap-2.5'>
							<div className='font-semibold'>Real Mobile & Backend Build / Test Runner</div>
							<input value={buildTargetDir} onChange={e => setBuildTargetDir(e.target.value)} placeholder='Target project path (leave blank for workspace root)' className='px-2.5 py-1.5 rounded bg-void-bg-1 border border-void-border-2 text-xs' />
							<div className='flex flex-wrap gap-2'>
								<KodiaPrimaryButton onClick={() => void handleBuildTest('test')} disabled={!!busy}><Play size={12} /><span>Run Mobile Tests</span></KodiaPrimaryButton>
								<KodiaSecondaryButton onClick={() => void handleBuildTest('backend_test')} disabled={!!busy}>Run Backend Tests</KodiaSecondaryButton>
								<KodiaSecondaryButton onClick={() => void handleBuildTest('typecheck')} disabled={!!busy}>Typecheck</KodiaSecondaryButton>
								<KodiaSecondaryButton onClick={() => void handleBuildTest('build')} disabled={!!busy}>Build Artifact</KodiaSecondaryButton>
							</div>
							{state.lastBuildTest && (
								<div className='p-2.5 rounded bg-void-bg-1 border border-void-border-2 space-y-1 text-[11px]'>
									<div className='flex items-center justify-between'>
										<span className='font-semibold'>{state.lastBuildTest.mode} — {state.lastBuildTest.command}</span>
										<KodiaBadge tone={state.lastBuildTest.status === 'verified' ? 'success' : state.lastBuildTest.status === 'blocked_by_env' ? 'warning' : 'danger'}>{state.lastBuildTest.status}</KodiaBadge>
									</div>
									<div className='text-void-fg-2'>{state.lastBuildTest.summary}</div>
									{(state.lastBuildTest.stdout || state.lastBuildTest.stderr) && (
										<pre className='p-2 rounded bg-black/30 overflow-x-auto max-h-60 text-[10px]'>{state.lastBuildTest.stdout || state.lastBuildTest.stderr}</pre>
									)}
								</div>
							)}
						</KodiaCard>
					)}

					{state.activeSection === 'security' && (
						<KodiaCard className='flex flex-col gap-2'>
							<div className='flex items-center justify-between'>
								<span className='font-semibold'>OWASP MASVS Security & Performance Audit</span>
								<KodiaPrimaryButton onClick={() => void handleSecurityPerf()} disabled={!!busy}>Run Audits</KodiaPrimaryButton>
							</div>
							{sec && (
								<div className='space-y-1 text-[11px]'>
									<div><strong>MASVS Score:</strong> {sec.score}/100 ({sec.criticalCount} critical, {sec.highCount} high, {sec.mediumCount} medium)</div>
									{sec.findings.map((f, idx) => (
										<div key={idx} className='p-2 rounded bg-red-500/10 border border-red-500/20'>
											<strong>[{f.severity.toUpperCase()}][{f.masvsCategory}]</strong> {f.file}:{f.line} — {f.title}
											<div className='text-void-fg-3 mt-0.5'>{f.remediation}</div>
										</div>
									))}
									{sec.passedChecks.map((c, idx) => <div key={idx} className='text-emerald-400'>✓ {c}</div>)}
								</div>
							)}
							{perf && (
								<div className='pt-2 border-t border-void-border-2 space-y-1 text-[11px]'>
									<div><strong>Performance Score:</strong> {perf.score}/100 ({perf.findings.length} static finding(s))</div>
									{perf.recommendations.map((r, idx) => <div key={idx} className='text-void-fg-3'>• {r}</div>)}
								</div>
							)}
						</KodiaCard>
					)}

					{state.activeSection === 'release' && (
						<KodiaCard className='flex flex-col gap-2'>
							<div className='flex items-center justify-between'>
								<span className='font-semibold'>Independent Mobile Production & Store Readiness</span>
								<KodiaPrimaryButton onClick={() => void handleReadiness()} disabled={!!busy}>Evaluate Readiness</KodiaPrimaryButton>
							</div>
							{ready ? (
								<div className='space-y-2 text-[11px]'>
									<div className='flex items-center gap-2'>
										<span className='font-semibold'>Overall:</span>
										<KodiaBadge tone={ready.overallStatus === 'ready' ? 'success' : ready.overallStatus === 'conditionally_ready' ? 'warning' : 'danger'}>
											{ready.overallStatus.toUpperCase()} ({ready.readinessScore}/100)
										</KodiaBadge>
									</div>
									{ready.dimensions.map((d, idx) => (
										<div key={idx} className='p-2 rounded bg-void-bg-1 border border-void-border-2'>
											<div className='flex items-center justify-between'>
												<span className='font-medium'>{d.dimension}</span>
												<KodiaBadge tone={d.status === 'verified' ? 'success' : d.status === 'failed' ? 'danger' : 'warning'}>{d.status}</KodiaBadge>
											</div>
											<div className='text-void-fg-3 mt-0.5'>{d.evidence}</div>
										</div>
									))}
								</div>
							) : (
								<div className='text-void-fg-3'>Click "Evaluate Readiness" for an evidence-based Android Play Store & Apple App Store readiness audit.</div>
							)}
						</KodiaCard>
					)}
				</div>

				{/* Right column: Live Execution Feed */}
				<div className='flex flex-col gap-3'>
					<KodiaCard className='flex flex-col gap-2 max-h-[520px] overflow-hidden'>
						<div className='flex items-center justify-between'>
							<span className='font-semibold flex items-center gap-1.5'><Activity size={13} /> Live Mobile Engineering Feed</span>
							<button type='button' onClick={() => mobileService.clearLiveEvents()} className='text-[11px] text-void-fg-3 hover:text-void-fg-1 cursor-pointer'>Clear</button>
						</div>
						<div className='flex-1 overflow-y-auto space-y-1.5 text-[11px]'>
							{state.liveEvents.length === 0 ? (
								<div className='text-void-fg-3'>No live events yet. Probe SDKs, inspect a workspace, scaffold, or run tests.</div>
							) : (
								[...state.liveEvents].reverse().map(ev => (
									<div key={ev.eventId} className='p-2 rounded bg-void-bg-1 border border-void-border-2'>
										<div className='flex items-center justify-between gap-1'>
											<span className='font-medium truncate'>{ev.title}</span>
											<span className='text-[9px] text-void-fg-3 uppercase'>{ev.kind}</span>
										</div>
										<div className='text-[10px] text-void-fg-3 mt-0.5 break-words'>{ev.detail}</div>
									</div>
								))
							)}
						</div>
					</KodiaCard>
				</div>
			</div>
		</div>
	);
};
