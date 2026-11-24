/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
	Activity,
	Bot,
	Bug,
	CheckCircle2,
	Cloud,
	Code2,
	Cpu,
	Download,
	GitBranch,
	KeyRound,
	Layers,
	Loader2,
	Play,
	Plus,
	Redo2,
	Save,
	ShieldCheck,
	Sparkles,
	Trash2,
	Undo2,
	Wand2,
	Workflow,
	ZoomIn,
	ZoomOut,
} from 'lucide-react';
import '../styles.css';
import { useAccessor, useIsDark } from '../util/services.js';
import { KodiaBadge, KodiaCard, KodiaPrimaryButton, KodiaSecondaryButton } from '../util/KodiaDesignSystem.js';
import type {
	UaepCodegenTarget,
	UaepCompileReport,
	UaepConnectorSpec,
	UaepDeploymentTarget,
	UaepExecutionRecord,
	UaepHostingOptionAssessment,
	UaepNodeCategory,
	UaepNodeTypeSpec,
	UaepOperationsSnapshot,
	UaepStudioSection,
	UaepWorkflowDefinition,
} from '../../../../common/universalAutomationTypes.js';

const CATEGORY_COLORS: Record<UaepNodeCategory, string> = {
	trigger: 'border-emerald-500/60 bg-emerald-500/10 text-emerald-300',
	action: 'border-sky-500/60 bg-sky-500/10 text-sky-300',
	logic: 'border-amber-500/60 bg-amber-500/10 text-amber-300',
	data: 'border-cyan-500/60 bg-cyan-500/10 text-cyan-300',
	developer: 'border-violet-500/60 bg-violet-500/10 text-violet-300',
	ai: 'border-fuchsia-500/60 bg-fuchsia-500/10 text-fuchsia-300',
};

export const AutomationStudioApp: React.FC = () => {
	const isDark = useIsDark();
	const accessor = useAccessor();
	const uaep = accessor.get('IUniversalAutomationService');

	const [section, setSection] = useState<UaepStudioSection>(() => uaep.getActiveSection());
	const [tenantId, setTenantId] = useState('default');
	const [snap, setSnap] = useState<UaepOperationsSnapshot>(() => uaep.getCachedSnapshot());
	const [nodeLib, setNodeLib] = useState<readonly UaepNodeTypeSpec[]>([]);
	const [connectors, setConnectors] = useState<readonly UaepConnectorSpec[]>([]);
	const [templates, setTemplates] = useState<readonly UaepWorkflowDefinition[]>([]);
	const [hosting, setHosting] = useState<readonly UaepHostingOptionAssessment[]>([]);

	// Active workflow editor state + Undo/Redo stacks
	const [activeWf, setActiveWf] = useState<UaepWorkflowDefinition | null>(null);
	const [undoStack, setUndoStack] = useState<UaepWorkflowDefinition[]>([]);
	const [redoStack, setRedoStack] = useState<UaepWorkflowDefinition[]>([]);
	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
	const [connectingFromId, setConnectingFromId] = useState<string | null>(null);
	const [zoom, setZoom] = useState(1);
	const [nodeSearch, setNodeSearch] = useState('');

	// Drag state
	const dragRef = useRef<{ nodeId: string; startX: number; startY: number; origX: number; origY: number } | null>(null);

	// AI Generation, Compiler, Debugger, Credentials, Deployment & Embedded forms
	const [aiPrompt, setAiPrompt] = useState('');
	const [modifyPrompt, setModifyPrompt] = useState('');
	const [compileTarget, setCompileTarget] = useState<UaepCodegenTarget>('typescript');
	const [compileReport, setCompileReport] = useState<UaepCompileReport | null>(null);
	const [activeExecution, setActiveExecution] = useState<UaepExecutionRecord | null>(null);
	const [triggerJson, setTriggerJson] = useState('{"email": "dev@acme.io", "orderId": "ORD-1001", "status": "ok"}');
	const [credName, setCredName] = useState('');
	const [credProvider, setCredProvider] = useState('openai');
	const [credEnvKey, setCredEnvKey] = useState('OPENAI_API_KEY');
	const [credSecret, setCredSecret] = useState('');
	const [deployTarget, setDeployTarget] = useState<UaepDeploymentTarget>('docker_compose');
	const [embeddedName, setEmbeddedName] = useState('Acme Automation Cloud');
	const [embeddedMultiTenant, setEmbeddedMultiTenant] = useState(true);
	const [busy, setBusy] = useState<string | null>(null);
	const [banner, setBanner] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

	useEffect(() => {
		let mounted = true;
		const boot = async () => {
			const [s, lib, conn, tpls, host] = await Promise.all([
				uaep.getSnapshot(tenantId),
				uaep.getNodeLibrary(),
				uaep.getConnectorCatalog(),
				uaep.getWorkflowTemplates(),
				uaep.assessDeploymentTargets(),
			]);
			if (!mounted) return;
			setSnap(s);
			setNodeLib(lib);
			setConnectors(conn);
			setTemplates(tpls);
			setHosting(host);
			if (!activeWf && s.workflows.length > 0) setActiveWf(s.workflows[0]);
		};
		void boot();
		const d1 = uaep.onDidChangeSnapshot(s => { if (mounted && s.activeTenantId === tenantId) setSnap(s); });
		const d2 = uaep.onDidChangeActiveSection(sec => setSection(sec));
		return () => { mounted = false; d1.dispose(); d2.dispose(); };
	}, [uaep, tenantId]);

	const run = async (key: string, fn: () => Promise<string>) => {
		setBusy(key);
		setBanner(null);
		try {
			const text = await fn();
			setBanner({ tone: 'success', text });
			const nextSnap = await uaep.getSnapshot(tenantId);
			setSnap(nextSnap);
		} catch (e) {
			setBanner({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
		} finally {
			setBusy(null);
		}
	};

	const mutateWf = (updater: (wf: UaepWorkflowDefinition) => UaepWorkflowDefinition) => {
		if (!activeWf) return;
		setUndoStack(prev => [...prev.slice(-24), activeWf]);
		setRedoStack([]);
		setActiveWf(updater(activeWf));
	};

	const handleUndo = () => {
		if (!activeWf || undoStack.length === 0) return;
		const prev = undoStack[undoStack.length - 1];
		setUndoStack(s => s.slice(0, -1));
		setRedoStack(s => [...s, activeWf]);
		setActiveWf(prev);
	};

	const handleRedo = () => {
		if (!activeWf || redoStack.length === 0) return;
		const next = redoStack[redoStack.length - 1];
		setRedoStack(s => s.slice(0, -1));
		setUndoStack(s => [...s, activeWf]);
		setActiveWf(next);
	};

	const createBlankWorkflow = () => {
		const now = Date.now();
		const wf: UaepWorkflowDefinition = {
			id: `wf-${now.toString(36)}`,
			tenantId,
			name: `Untitled Automation ${snap.workflows.length + 1}`,
			description: 'Visual-to-code durable workflow',
			version: 1,
			status: 'draft',
			executionModel: 'interpreted',
			environment: 'development',
			tags: [],
			versionHistory: [],
			createdAtMs: now,
			updatedAtMs: now,
			nodes: [
				{ id: 'trig_1', type: 'trigger.manual', category: 'trigger', label: 'Manual Trigger', position: { x: 60, y: 120 }, config: {} },
				{ id: 'tx_1', type: 'data.transform', category: 'data', label: 'Transform Payload', position: { x: 310, y: 120 }, config: { mappings: { normalized: 'true' } } },
			],
			edges: [{ id: 'e1', sourceNodeId: 'trig_1', sourcePort: 'default', targetNodeId: 'tx_1', targetPort: 'default' }],
		};
		setActiveWf(wf);
		setSelectedNodeId('trig_1');
		setSection('canvas');
	};

	const addNodeFromLibrary = (spec: UaepNodeTypeSpec) => {
		if (!activeWf) { createBlankWorkflow(); return; }
		const id = `${spec.category}_${Date.now().toString(36).slice(-4)}`;
		const last = activeWf.nodes[activeWf.nodes.length - 1];
		const pos = { x: (last?.position.x ?? 40) + 210, y: last?.position.y ?? 120 };
		mutateWf(wf => ({
			...wf,
			nodes: [...wf.nodes, { id, type: spec.type, category: spec.category, label: spec.label, description: spec.description, position: pos, config: { ...spec.defaultConfig } }],
			edges: last ? [...wf.edges, { id: `e-${last.id}-${id}`, sourceNodeId: last.id, sourcePort: 'default', targetNodeId: id, targetPort: 'default' }] : wf.edges,
		}));
		setSelectedNodeId(id);
	};

	const selectedNode = useMemo(() => activeWf?.nodes.find(n => n.id === selectedNodeId) ?? null, [activeWf, selectedNodeId]);

	const filteredNodes = useMemo(() => {
		const q = nodeSearch.trim().toLowerCase();
		if (!q) return nodeLib;
		return nodeLib.filter(n => n.label.toLowerCase().includes(q) || n.type.toLowerCase().includes(q) || n.category.includes(q));
	}, [nodeLib, nodeSearch]);

	const navItems: { id: UaepStudioSection; label: string; icon: React.ReactNode; badge?: string }[] = [
		{ id: 'overview', label: 'Overview', icon: <Activity size={13} /> },
		{ id: 'canvas', label: 'Visual Canvas', icon: <Workflow size={13} />, badge: activeWf ? String(activeWf.nodes.length) : undefined },
		{ id: 'templates', label: 'Templates', icon: <Sparkles size={13} />, badge: String(templates.length) },
		{ id: 'executions', label: 'Executions & Debug', icon: <Bug size={13} />, badge: String(snap.totalExecutions) },
		{ id: 'connectors', label: 'Connectors SDK', icon: <Layers size={13} />, badge: String(connectors.length) },
		{ id: 'credentials', label: 'Tenant Vault', icon: <KeyRound size={13} />, badge: String(snap.credentials.length) },
		{ id: 'deployment', label: 'Compile & Deploy', icon: <Cloud size={13} /> },
		{ id: 'embedded', label: 'Embedded Platform', icon: <Cpu size={13} /> },
		{ id: 'security', label: 'Security & Audit', icon: <ShieldCheck size={13} /> },
	];

	return (
		<div className={`@@void-scope ${isDark ? 'dark' : ''} h-full w-full flex flex-col bg-void-bg-2 text-void-fg-1 text-xs overflow-hidden`}>
			{/* Top Studio Toolbar */}
			<header className='px-4 py-2.5 border-b border-void-border-2 bg-void-bg-1 flex flex-wrap items-center justify-between gap-2 shrink-0'>
				<div className='flex items-center gap-2.5 min-w-0'>
					<div style={{ backgroundColor: 'var(--kodia-accent)', color: 'var(--kodia-accent-fg)' }} className='w-8 h-8 rounded-lg flex items-center justify-center shrink-0 shadow-xs'>
						<Workflow size={16} />
					</div>
					<div className='min-w-0'>
						<div className='flex items-center gap-2 flex-wrap'>
							<h1 className='text-sm font-semibold truncate'>Kodia Automation Studio (UAEP)</h1>
							<KodiaBadge tone='accent'>Tenant: {tenantId}</KodiaBadge>
							<KodiaBadge tone='success'>Worker: {snap.workerHealth.status}</KodiaBadge>
						</div>
						<p className='text-[11px] text-void-fg-3 truncate'>Visual-to-Code Compiler · Durable Runtime · Multi-Tenant Vault · Independent &amp; Embedded Deployment</p>
					</div>
				</div>

				<div className='flex flex-wrap items-center gap-1.5'>
					<input
						type='text'
						value={tenantId}
						onChange={e => setTenantId(e.target.value.trim() || 'default')}
						title='Active Tenant / Organization ID'
						className='w-28 px-2 py-1 text-[11px] rounded bg-void-bg-2 border border-void-border-2 font-mono'
						placeholder='tenant-id'
					/>
					<KodiaSecondaryButton onClick={createBlankWorkflow}><Plus size={12} /> New</KodiaSecondaryButton>
					<KodiaSecondaryButton disabled={!activeWf || undoStack.length === 0} onClick={handleUndo}><Undo2 size={12} /></KodiaSecondaryButton>
					<KodiaSecondaryButton disabled={!activeWf || redoStack.length === 0} onClick={handleRedo}><Redo2 size={12} /></KodiaSecondaryButton>
					<KodiaSecondaryButton disabled={!activeWf || busy !== null} onClick={() => activeWf && void run('save', async () => {
						const saved = await uaep.saveWorkflow({ ...activeWf, tenantId });
						setActiveWf(saved);
						return `Saved "${saved.name}" v${saved.version}.`;
					})}><Save size={12} /> Save</KodiaSecondaryButton>
					<KodiaSecondaryButton disabled={!activeWf || busy !== null} onClick={() => activeWf && void run('compile', async () => {
						const saved = await uaep.saveWorkflow({ ...activeWf, tenantId });
						setActiveWf(saved);
						const rep = await uaep.compileWorkflow({ workflowId: saved.id, tenantId, targetLanguage: compileTarget });
						setCompileReport(rep);
						return rep.summary;
					})}><Code2 size={12} /> Validate &amp; Compile</KodiaSecondaryButton>
					<KodiaPrimaryButton disabled={!activeWf || busy !== null} onClick={() => activeWf && void run('exec', async () => {
						const saved = await uaep.saveWorkflow({ ...activeWf, tenantId });
						setActiveWf(saved);
						let parsed: Record<string, unknown> = {};
						try { parsed = JSON.parse(triggerJson || '{}'); } catch { /* default empty */ }
						const exec = await uaep.executeWorkflow({ workflowId: saved.id, tenantId, triggerInput: parsed, stopAtBreakpoints: true });
						setActiveExecution(exec);
						return `Execution ${exec.executionId} finished with status "${exec.status}" (${exec.steps.length} steps).`;
					})}>
						{busy === 'exec' ? <Loader2 size={12} className='animate-spin' /> : <Play size={12} />} Execute
					</KodiaPrimaryButton>
				</div>
			</header>

			{/* Section Tabs */}
			<nav className='kodia-thin-tabs px-4 py-1.5 border-b border-void-border-2 bg-void-bg-1/75 flex items-center gap-1 overflow-x-auto shrink-0'>
				{navItems.map(t => {
					const active = section === t.id;
					return (
						<button
							key={t.id}
							type='button'
							onClick={() => { setSection(t.id); uaep.setActiveSection(t.id); }}
							style={active ? { borderColor: 'var(--kodia-accent)' } : undefined}
							className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] whitespace-nowrap cursor-pointer border transition-all ${active
								? 'bg-void-bg-3 text-void-fg-1 font-medium shadow-xs'
								: 'border-transparent text-void-fg-3 hover:text-void-fg-1 hover:bg-void-bg-2'}`}
						>
							{t.icon}
							<span>{t.label}</span>
							{t.badge && <span className='text-[10px] px-1.5 rounded-full bg-void-bg-2 border border-void-border-2'>{t.badge}</span>}
						</button>
					);
				})}
			</nav>

			{banner && (
				<div className={`mx-4 mt-2.5 px-3 py-1.5 rounded-md border text-xs flex items-center justify-between gap-2 shrink-0 ${banner.tone === 'error' ? 'bg-rose-500/10 border-rose-500/40 text-rose-200' : 'bg-emerald-500/10 border-emerald-500/40 text-emerald-200'}`}>
					<span>{banner.text}</span>
					<button type='button' onClick={() => setBanner(null)} className='text-[11px] opacity-80 hover:opacity-100 cursor-pointer'>Dismiss</button>
				</div>
			)}

			{/* Main Content */}
			<div className='flex-1 min-h-0 overflow-hidden flex flex-col'>

				{/* TAB: VISUAL CANVAS WORKFLOW BUILDER */}
				{section === 'canvas' && (
					<div className='flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 overflow-hidden'>
						{/* Left: AI Generator + Searchable Node Library */}
						<aside className='lg:col-span-3 border-r border-void-border-2 bg-void-bg-1/50 p-3 flex flex-col gap-3 overflow-y-auto'>
							<div className='space-y-1.5'>
								<div className='flex items-center gap-1.5 text-[11px] font-semibold'><Bot size={12} className='text-fuchsia-400' /> AI Workflow Generator</div>
								<textarea
									value={aiPrompt}
									onChange={e => setAiPrompt(e.target.value)}
									rows={3}
									placeholder='Describe automation in natural language (e.g. When customer registers, verify email, add to CRM, send welcome email)...'
									className='w-full p-2 text-[11px] rounded bg-void-bg-2 border border-void-border-2 resize-none'
								/>
								<KodiaPrimaryButton
									className='w-full'
									disabled={busy !== null || !aiPrompt.trim()}
									onClick={() => void run('ai-gen', async () => {
										const res = await uaep.generateWorkflowFromPrompt({ prompt: aiPrompt.trim(), tenantId });
										setActiveWf(res.workflow);
										setCompileReport(res.compileReport);
										setAiPrompt('');
										return `Generated "${res.workflow.name}" (${res.workflow.nodes.length} nodes) — ${res.compileReport.summary}`;
									})}
								>
									<Wand2 size={12} /> Generate Visual Workflow
								</KodiaPrimaryButton>
							</div>

							{activeWf && (
								<div className='space-y-1.5 pt-2 border-t border-void-border-2'>
									<div className='text-[11px] font-semibold text-void-fg-2'>Conversational Modify</div>
									<div className='flex gap-1'>
										<input
											value={modifyPrompt}
											onChange={e => setModifyPrompt(e.target.value)}
											placeholder='e.g. Add human approval / Add retry'
											className='flex-1 px-2 py-1 text-[11px] rounded bg-void-bg-2 border border-void-border-2'
										/>
										<KodiaSecondaryButton disabled={!modifyPrompt.trim() || busy !== null} onClick={() => void run('mod', async () => {
											const saved = await uaep.saveWorkflow({ ...activeWf, tenantId });
											const res = await uaep.modifyWorkflowFromPrompt({ workflowId: saved.id, tenantId, instruction: modifyPrompt.trim() });
											setActiveWf(res.workflow);
											setCompileReport(res.compileReport);
											setModifyPrompt('');
											return res.changeSummary;
										})}>Apply</KodiaSecondaryButton>
									</div>
								</div>
							)}

							<div className='space-y-1.5 pt-2 border-t border-void-border-2 flex-1 min-h-0 flex flex-col'>
								<div className='text-[11px] font-semibold text-void-fg-2'>Node Library ({filteredNodes.length})</div>
								<input value={nodeSearch} onChange={e => setNodeSearch(e.target.value)} placeholder='Search nodes (trigger, http, ai, logic)...' className='px-2 py-1 text-[11px] rounded bg-void-bg-2 border border-void-border-2' />
								<div className='flex-1 overflow-y-auto space-y-1 pr-0.5'>
									{filteredNodes.map(n => (
										<button
											key={n.type}
											type='button'
											onClick={() => addNodeFromLibrary(n)}
											className='w-full text-left p-2 rounded bg-void-bg-2 hover:bg-void-bg-3 border border-void-border-2 cursor-pointer transition-colors'
										>
											<div className='flex items-center justify-between gap-1'>
												<span className='font-medium text-[11px] truncate'>{n.label}</span>
												<span className={`text-[9px] px-1.5 py-0.2 rounded border uppercase ${CATEGORY_COLORS[n.category]}`}>{n.category}</span>
											</div>
											<div className='text-[10px] text-void-fg-3 truncate mt-0.5'>{n.description}</div>
										</button>
									))}
								</div>
							</div>
						</aside>

						{/* Center: Interactive Drag-and-Drop SVG Canvas */}
						<div className='lg:col-span-6 flex flex-col min-h-0 overflow-hidden bg-void-bg-2 relative'>
							<div className='px-3 py-1.5 border-b border-void-border-2 bg-void-bg-1/60 flex items-center justify-between gap-2 text-[11px]'>
								<div className='flex items-center gap-2 min-w-0'>
									{activeWf ? (
										<input
											value={activeWf.name}
											onChange={e => mutateWf(w => ({ ...w, name: e.target.value }))}
											className='font-semibold bg-transparent border-b border-transparent focus:border-sky-400 text-xs text-void-fg-1 truncate'
										/>
									) : <span className='text-void-fg-3'>Select or create a workflow</span>}
									{activeWf && <KodiaBadge tone='neutral'>v{activeWf.version} · {activeWf.edges.length} edges</KodiaBadge>}
								</div>
								<div className='flex items-center gap-1'>
									<button type='button' onClick={() => setZoom(z => Math.max(0.5, Number((z - 0.1).toFixed(1))))} className='p-1 rounded bg-void-bg-2 border border-void-border-2 cursor-pointer'><ZoomOut size={11} /></button>
									<span className='font-mono text-[10px] w-9 text-center'>{Math.round(zoom * 100)}%</span>
									<button type='button' onClick={() => setZoom(z => Math.min(1.5, Number((z + 0.1).toFixed(1))))} className='p-1 rounded bg-void-bg-2 border border-void-border-2 cursor-pointer'><ZoomIn size={11} /></button>
								</div>
							</div>

							<div
								className='flex-1 overflow-auto relative select-none'
								style={{ backgroundImage: 'radial-gradient(color-mix(in srgb, var(--void-fg-3) 22%, transparent) 1px, transparent 1px)', backgroundSize: '18px 18px' }}
								onMouseMove={e => {
									const d = dragRef.current;
									if (!d || !activeWf) return;
									const dx = (e.clientX - d.startX) / zoom;
									const dy = (e.clientY - d.startY) / zoom;
									setActiveWf(wf => wf ? ({
										...wf,
										nodes: wf.nodes.map(n => n.id === d.nodeId ? { ...n, position: { x: Math.max(16, Math.round(d.origX + dx)), y: Math.max(16, Math.round(d.origY + dy)) } } : n),
									}) : wf);
								}}
								onMouseUp={() => { dragRef.current = null; }}
							>
								{!activeWf ? (
									<div className='h-full flex flex-col items-center justify-center gap-3 p-6 text-center'>
										<Workflow size={32} className='text-void-fg-3 opacity-60' />
										<div className='text-sm font-medium'>Start Designing Your Visual-to-Code Automation</div>
										<div className='text-xs text-void-fg-3 max-w-md'>Create a blank workflow, pick a template, or describe a business process in the AI Workflow Generator on the left.</div>
										<KodiaPrimaryButton onClick={createBlankWorkflow}><Plus size={12} /> Create Workflow</KodiaPrimaryButton>
									</div>
								) : (
									<div style={{ transform: `scale(${zoom})`, transformOrigin: 'top left', width: 1400, height: 760, position: 'relative' }}>
										{/* SVG Bezier Connections */}
										<svg width={1400} height={760} className='absolute inset-0 pointer-events-none'>
											{activeWf.edges.map(edge => {
												const src = activeWf.nodes.find(n => n.id === edge.sourceNodeId);
												const tgt = activeWf.nodes.find(n => n.id === edge.targetNodeId);
												if (!src || !tgt) return null;
												const x1 = src.position.x + 190;
												const y1 = src.position.y + 34;
												const x2 = tgt.position.x;
												const y2 = tgt.position.y + 34;
												const cx = (x1 + x2) / 2;
												return (
													<g key={edge.id}>
														<path d={`M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`} fill='none' stroke='var(--kodia-accent)' strokeWidth={2} strokeOpacity={0.75} />
														<circle cx={x2} cy={y2} r={3.5} fill='var(--kodia-accent)' />
													</g>
												);
											})}
										</svg>

										{/* Draggable Node Cards */}
										{activeWf.nodes.map(node => {
											const isSel = selectedNodeId === node.id;
											const step = activeExecution?.steps.slice().reverse().find(s => s.nodeId === node.id);
											return (
												<div
													key={node.id}
													style={{ left: node.position.x, top: node.position.y, width: 190 }}
													onMouseDown={e => {
														setSelectedNodeId(node.id);
														dragRef.current = { nodeId: node.id, startX: e.clientX, startY: e.clientY, origX: node.position.x, origY: node.position.y };
													}}
													onClick={e => {
														e.stopPropagation();
														if (connectingFromId && connectingFromId !== node.id) {
															mutateWf(wf => ({
																...wf,
																edges: [...wf.edges, { id: `e-${connectingFromId}-${node.id}-${Date.now().toString(36).slice(-3)}`, sourceNodeId: connectingFromId, sourcePort: 'default', targetNodeId: node.id, targetPort: 'default' }],
															}));
															setConnectingFromId(null);
														}
													}}
													className={`absolute rounded-lg border p-2.5 bg-void-bg-1 shadow-sm cursor-grab active:cursor-grabbing transition-shadow ${isSel ? 'ring-2 ring-[var(--kodia-accent)] border-[var(--kodia-accent)]' : 'border-void-border-2 hover:border-void-border-1'}`}
												>
													<div className='flex items-center justify-between gap-1'>
														<span className={`text-[9px] px-1.5 py-0.2 rounded border uppercase font-medium ${CATEGORY_COLORS[node.category]}`}>{node.category}</span>
														<div className='flex items-center gap-1'>
															{node.breakpoint && <span title='Breakpoint set' className='w-2 h-2 rounded-full bg-rose-500 inline-block' />}
															{step && <span className={`text-[9px] font-mono ${step.status === 'completed' ? 'text-emerald-400' : step.status === 'failed' ? 'text-rose-400' : 'text-amber-300'}`}>{step.status}</span>}
														</div>
													</div>
													<div className='font-semibold text-[11px] text-void-fg-1 truncate mt-1'>{node.label}</div>
													<div className='text-[9px] font-mono text-void-fg-3 truncate'>{node.type}</div>
													<div className='flex items-center justify-between mt-2 pt-1 border-t border-void-border-2/60 text-[9px]'>
														<span className='font-mono text-void-fg-3'>{node.id}</span>
														<button
															type='button'
															onClick={e => { e.stopPropagation(); setConnectingFromId(connectingFromId === node.id ? null : node.id); }}
															className={`px-1.5 py-0.5 rounded border cursor-pointer ${connectingFromId === node.id ? 'bg-sky-500/20 border-sky-400 text-sky-200' : 'bg-void-bg-2 border-void-border-2 text-void-fg-3 hover:text-void-fg-1'}`}
														>
															{connectingFromId === node.id ? 'Click Target…' : 'Connect →'}
														</button>
													</div>
												</div>
											);
										})}
									</div>
								)}
							</div>

							{/* Bottom Live Execution Strip */}
							{activeExecution && (
								<div className='px-3 py-2 border-t border-void-border-2 bg-void-bg-1 flex flex-wrap items-center justify-between gap-2 text-[11px]'>
									<div className='flex items-center gap-2'>
										<KodiaBadge tone={activeExecution.status === 'completed' ? 'success' : activeExecution.status === 'failed' ? 'danger' : 'warning'}>{activeExecution.status}</KodiaBadge>
										<span className='font-mono'>{activeExecution.executionId}</span>
										<span className='text-void-fg-3'>{activeExecution.steps.length} step(s)</span>
									</div>
									<div className='flex items-center gap-1.5'>
										{(activeExecution.status === 'waiting_approval' || activeExecution.status === 'paused_breakpoint' || activeExecution.status === 'interrupted') && (
											<KodiaPrimaryButton onClick={() => void run('resume', async () => {
												const r = await uaep.resumeExecution({ executionId: activeExecution.executionId, tenantId, approvalGranted: true });
												setActiveExecution(r);
												return `Resumed ${r.executionId} → ${r.status}.`;
											})}>Approve / Resume</KodiaPrimaryButton>
										)}
										<KodiaSecondaryButton onClick={() => setSection('executions')}>Inspect Steps</KodiaSecondaryButton>
									</div>
								</div>
							)}
						</div>

						{/* Right: Selected Node Inspector */}
						<aside className='lg:col-span-3 border-l border-void-border-2 bg-void-bg-1/50 p-3 flex flex-col gap-3 overflow-y-auto'>
							<div className='font-semibold text-xs flex items-center justify-between'>
								<span>Node Inspector</span>
								{selectedNode && (
									<button
										type='button'
										onClick={() => {
											mutateWf(wf => ({
												...wf,
												nodes: wf.nodes.filter(n => n.id !== selectedNode.id),
												edges: wf.edges.filter(e => e.sourceNodeId !== selectedNode.id && e.targetNodeId !== selectedNode.id),
											}));
											setSelectedNodeId(null);
										}}
										className='text-rose-400 hover:text-rose-300 cursor-pointer'
										title='Delete node'
									>
										<Trash2 size={12} />
									</button>
								)}
							</div>

							{!selectedNode ? (
								<div className='text-[11px] text-void-fg-3'>Click any node on the canvas to configure inputs, credentials, retries, breakpoints, or run a single-node test.</div>
							) : (
								<div className='flex flex-col gap-2.5'>
									<label className='flex flex-col gap-1 text-[11px]'>
										<span className='text-void-fg-3'>Label</span>
										<input
											value={selectedNode.label}
											onChange={e => mutateWf(wf => ({ ...wf, nodes: wf.nodes.map(n => n.id === selectedNode.id ? { ...n, label: e.target.value } : n) }))}
											className='px-2 py-1 rounded bg-void-bg-2 border border-void-border-2'
										/>
									</label>
									<label className='flex flex-col gap-1 text-[11px]'>
										<span className='text-void-fg-3'>Credential Reference (Tenant Vault Key)</span>
										<input
											value={selectedNode.credentialRef ?? ''}
											onChange={e => mutateWf(wf => ({ ...wf, nodes: wf.nodes.map(n => n.id === selectedNode.id ? { ...n, credentialRef: e.target.value || undefined } : n) }))}
											placeholder='e.g. OPENAI_API_KEY'
											className='px-2 py-1 rounded bg-void-bg-2 border border-void-border-2 font-mono'
										/>
									</label>
									<label className='flex flex-col gap-1 text-[11px]'>
										<span className='text-void-fg-3'>Idempotency Key Expression</span>
										<input
											value={selectedNode.idempotencyKeyExpr ?? ''}
											onChange={e => mutateWf(wf => ({ ...wf, nodes: wf.nodes.map(n => n.id === selectedNode.id ? { ...n, idempotencyKeyExpr: e.target.value || undefined } : n) }))}
											placeholder='e.g. order-{{orderId}}'
											className='px-2 py-1 rounded bg-void-bg-2 border border-void-border-2 font-mono'
										/>
									</label>
									<label className='flex items-center gap-2 text-[11px] cursor-pointer'>
										<input
											type='checkbox'
											checked={!!selectedNode.breakpoint}
											onChange={e => mutateWf(wf => ({ ...wf, nodes: wf.nodes.map(n => n.id === selectedNode.id ? { ...n, breakpoint: e.target.checked } : n) }))}
										/>
										<span>Pause at Debugger Breakpoint</span>
									</label>
									<label className='flex flex-col gap-1 text-[11px]'>
										<span className='text-void-fg-3'>Node Config (JSON)</span>
										<textarea
											rows={6}
											value={JSON.stringify(selectedNode.config, null, 2)}
											onChange={e => {
												try {
													const parsed = JSON.parse(e.target.value);
													mutateWf(wf => ({ ...wf, nodes: wf.nodes.map(n => n.id === selectedNode.id ? { ...n, config: parsed } : n) }));
												} catch { /* wait until valid JSON */ }
											}}
											className='p-2 rounded bg-void-bg-2 border border-void-border-2 font-mono text-[10px]'
										/>
									</label>
									<label className='flex flex-col gap-1 text-[11px]'>
										<span className='text-void-fg-3'>Trigger / Sample Input (JSON)</span>
										<textarea rows={3} value={triggerJson} onChange={e => setTriggerJson(e.target.value)} className='p-2 rounded bg-void-bg-2 border border-void-border-2 font-mono text-[10px]' />
									</label>
									<KodiaSecondaryButton disabled={busy !== null} onClick={() => activeWf && void run('test-node', async () => {
										const saved = await uaep.saveWorkflow({ ...activeWf, tenantId });
										let sample: Record<string, unknown> = {};
										try { sample = JSON.parse(triggerJson || '{}'); } catch { /* ignore */ }
										const res = await uaep.testSingleNode({ workflowId: saved.id, nodeId: selectedNode.id, tenantId, sampleInput: sample });
										return `Single-node test (${selectedNode.label}): ${res.status} (${res.durationMs ?? 0}ms)${res.error ? ` — ${res.error}` : ''}`;
									})}>
										<Play size={11} /> Test This Node
									</KodiaSecondaryButton>
								</div>
							)}
						</aside>
					</div>
				)}

				{/* OTHER TABS */}
				{section !== 'canvas' && (
					<div className='flex-1 overflow-y-auto p-5'>
						<div className='max-w-6xl mx-auto flex flex-col gap-4'>

							{section === 'overview' && (
								<>
									<div className='grid grid-cols-2 lg:grid-cols-4 gap-3'>
										<KodiaCard><div className='text-[10px] text-void-fg-3'>Workflows (Tenant)</div><div className='text-lg font-semibold'>{snap.totalWorkflows}</div></KodiaCard>
										<KodiaCard><div className='text-[10px] text-void-fg-3'>Completed / Failed Runs</div><div className='text-lg font-semibold text-emerald-400'>{snap.completedExecutions} <span className='text-rose-400'>/ {snap.failedExecutions}</span></div></KodiaCard>
										<KodiaCard><div className='text-[10px] text-void-fg-3'>Paused / Waiting Approval</div><div className='text-lg font-semibold text-amber-400'>{snap.pausedOrWaitingExecutions}</div></KodiaCard>
										<KodiaCard><div className='text-[10px] text-void-fg-3'>AI Tokens Tracked</div><div className='text-lg font-semibold text-sky-400'>{snap.totalAiTokensUsed}</div></KodiaCard>
									</div>
									<KodiaCard className='flex flex-col gap-2'>
										<div className='font-semibold text-sm'>Saved Workflows ({snap.workflows.length})</div>
										{snap.workflows.length === 0 ? (
											<div className='text-void-fg-3 py-4 text-center'>No workflows yet for tenant &ldquo;{tenantId}&rdquo;. Create one in Visual Canvas or load a Template.</div>
										) : snap.workflows.map(w => (
											<div key={w.id} className='p-2.5 rounded bg-void-bg-1 border border-void-border-2 flex items-center justify-between gap-2'>
												<div>
													<div className='font-semibold'>{w.name} <KodiaBadge tone='neutral'>v{w.version}</KodiaBadge></div>
													<div className='text-[11px] text-void-fg-3'>{w.nodes.length} nodes · {w.edges.length} edges · {w.status}</div>
												</div>
												<div className='flex gap-1.5'>
													<KodiaSecondaryButton onClick={() => { setActiveWf(w); setSection('canvas'); }}>Open Canvas</KodiaSecondaryButton>
													<KodiaSecondaryButton onClick={() => void run(`del-${w.id}`, async () => (await uaep.deleteWorkflow(w.id, tenantId)).message)}><Trash2 size={11} /></KodiaSecondaryButton>
												</div>
											</div>
										))}
									</KodiaCard>
								</>
							)}

							{section === 'templates' && (
								<div className='grid grid-cols-1 md:grid-cols-2 gap-3'>
									{templates.map(t => (
										<KodiaCard key={t.id} className='flex flex-col justify-between gap-2'>
											<div>
												<div className='font-semibold text-sm'>{t.name}</div>
												<div className='text-[11px] text-void-fg-3 mt-0.5'>{t.description}</div>
												<div className='flex flex-wrap gap-1 mt-2'>
													{t.nodes.map(n => <KodiaBadge key={n.id} tone='neutral'>{n.label}</KodiaBadge>)}
												</div>
											</div>
											<KodiaPrimaryButton onClick={() => { setActiveWf({ ...t, tenantId, id: `wf-${Date.now().toString(36)}` }); setSection('canvas'); }}>Load into Canvas</KodiaPrimaryButton>
										</KodiaCard>
									))}
								</div>
							)}

							{section === 'executions' && (
								<KodiaCard className='flex flex-col gap-3'>
									<div className='font-semibold text-sm'>Durable Execution History &amp; Step Debugger ({snap.recentExecutions.length})</div>
									{snap.recentExecutions.length === 0 ? <div className='text-void-fg-3'>No executions recorded yet.</div> : snap.recentExecutions.map(ex => (
										<div key={ex.executionId} className='p-3 rounded bg-void-bg-1 border border-void-border-2 space-y-2'>
											<div className='flex flex-wrap items-center justify-between gap-2'>
												<div className='flex items-center gap-2'>
													<KodiaBadge tone={ex.status === 'completed' ? 'success' : ex.status === 'failed' ? 'danger' : 'warning'}>{ex.status}</KodiaBadge>
													<span className='font-semibold'>{ex.workflowName}</span>
													<code className='text-[10px] text-void-fg-3'>{ex.executionId}</code>
												</div>
												<div className='flex items-center gap-1.5'>
													{(ex.status === 'waiting_approval' || ex.status === 'paused_breakpoint' || ex.status === 'interrupted') && (
														<KodiaPrimaryButton onClick={() => void run(`res-${ex.executionId}`, async () => {
															const r = await uaep.resumeExecution({ executionId: ex.executionId, tenantId, approvalGranted: true });
															setActiveExecution(r);
															return `Resumed ${r.executionId} → ${r.status}.`;
														})}>Resume</KodiaPrimaryButton>
													)}
													<span className='text-[10px] text-void-fg-3'>{new Date(ex.startedAtMs).toLocaleString()}</span>
												</div>
											</div>
											<div className='flex flex-wrap gap-1.5'>
												{ex.steps.map((st, idx) => (
													<div key={`${st.nodeId}-${idx}`} className='px-2 py-1 rounded bg-void-bg-2 border border-void-border-2 text-[10px]'>
														<span className='font-medium'>{st.label}</span>: <span className={st.status === 'completed' ? 'text-emerald-400' : st.status === 'failed' ? 'text-rose-400' : 'text-amber-300'}>{st.status}</span>{st.idempotencyHit ? ' (idem-hit)' : ''}
													</div>
												))}
											</div>
											{ex.error && <div className='text-[11px] text-rose-300'>{ex.error}</div>}
										</div>
									))}
								</KodiaCard>
							)}

							{section === 'connectors' && (
								<div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3'>
									{connectors.map(c => (
										<KodiaCard key={c.id} className='flex flex-col gap-1.5'>
											<div className='flex items-center justify-between'><span className='font-semibold'>{c.name}</span><KodiaBadge tone='accent'>{c.category}</KodiaBadge></div>
											<div className='text-[11px] text-void-fg-3'>{c.description}</div>
											<div className='flex flex-wrap gap-1 pt-1'>{c.operations.map(op => <span key={op} className='text-[10px] px-1.5 py-0.5 rounded bg-void-bg-1 border border-void-border-2 font-mono'>{op}</span>)}</div>
										</KodiaCard>
									))}
								</div>
							)}

							{section === 'credentials' && (
								<KodiaCard className='flex flex-col gap-3'>
									<div className='font-semibold text-sm'>Multi-Tenant Encrypted Credential Vault (Tenant: {tenantId})</div>
									<div className='grid grid-cols-1 md:grid-cols-5 gap-2'>
										<input value={credName} onChange={e => setCredName(e.target.value)} placeholder='Credential Name' className='px-2 py-1.5 rounded bg-void-bg-2 border border-void-border-2' />
										<input value={credProvider} onChange={e => setCredProvider(e.target.value)} placeholder='Provider (nvidia/stripe)' className='px-2 py-1.5 rounded bg-void-bg-2 border border-void-border-2' />
										<input value={credEnvKey} onChange={e => setCredEnvKey(e.target.value)} placeholder='ENV_KEY' className='px-2 py-1.5 rounded bg-void-bg-2 border border-void-border-2 font-mono' />
										<input type='password' value={credSecret} onChange={e => setCredSecret(e.target.value)} placeholder='Secret value (AES-256-GCM)' className='px-2 py-1.5 rounded bg-void-bg-2 border border-void-border-2 font-mono' />
										<KodiaPrimaryButton disabled={!credSecret.trim() || !credEnvKey.trim() || busy !== null} onClick={() => void run('cred', async () => {
											const m = await uaep.saveTenantCredential({ tenantId, name: credName.trim() || credEnvKey, provider: credProvider.trim() || 'custom', envKey: credEnvKey.trim(), secretValue: credSecret.trim() });
											setCredSecret('');
											return `Encrypted credential ${m.envKey} (${m.maskedPreview}) stored for tenant "${tenantId}".`;
										})}>Save Encrypted</KodiaPrimaryButton>
									</div>
									<div className='space-y-1.5'>
										{snap.credentials.map(c => (
											<div key={c.id} className='p-2 rounded bg-void-bg-1 border border-void-border-2 flex items-center justify-between text-xs'>
												<div><span className='font-semibold'>{c.name}</span> <code className='ml-1.5 text-sky-400'>{c.envKey}</code></div>
												<div className='font-mono text-void-fg-3'>{c.maskedPreview}</div>
											</div>
										))}
									</div>
								</KodiaCard>
							)}

							{section === 'deployment' && (
								<div className='flex flex-col gap-4'>
									<KodiaCard className='flex flex-col gap-3'>
										<div className='flex flex-wrap items-center justify-between gap-2'>
											<div className='font-semibold text-sm'>Visual-to-Code Compiler &amp; Portable Deployment Exporter</div>
											<div className='flex items-center gap-2'>
												<select value={compileTarget} onChange={e => setCompileTarget(e.target.value as UaepCodegenTarget)} className='px-2 py-1 rounded bg-void-bg-2 border border-void-border-2'>
													<option value='typescript'>TypeScript</option>
													<option value='javascript'>JavaScript (ESM)</option>
													<option value='python'>Python</option>
												</select>
												<select value={deployTarget} onChange={e => setDeployTarget(e.target.value as UaepDeploymentTarget)} className='px-2 py-1 rounded bg-void-bg-2 border border-void-border-2'>
													{hosting.map(h => <option key={h.target} value={h.target}>{h.label}</option>)}
												</select>
												<KodiaPrimaryButton disabled={!activeWf || busy !== null} onClick={() => activeWf && void run('export', async () => {
													const saved = await uaep.saveWorkflow({ ...activeWf, tenantId });
													return (await uaep.exportPortablePackage({ workflowId: saved.id, tenantId, target: deployTarget })).summary;
												})}><Download size={12} /> Export Standalone Runtime</KodiaPrimaryButton>
											</div>
										</div>
										{compileReport && (
											<div className='p-3 rounded bg-void-bg-1 border border-void-border-2 space-y-2'>
												<div className='flex items-center gap-2'><CheckCircle2 size={14} className={compileReport.valid ? 'text-emerald-400' : 'text-rose-400'} /><span className='font-semibold'>{compileReport.summary}</span></div>
												<pre className='p-2 rounded bg-void-bg-2 border border-void-border-2 text-[10px] font-mono max-h-60 overflow-auto'>{Object.values(compileReport.generatedFiles)[0]}</pre>
											</div>
										)}
									</KodiaCard>
									<div className='grid grid-cols-1 md:grid-cols-2 gap-3'>
										{hosting.map(h => (
											<KodiaCard key={h.target} className='flex flex-col gap-1'>
												<div className='flex items-center justify-between gap-2'><span className='font-semibold'>{h.label}</span><KodiaBadge tone={h.supportsPermanentWorkers ? 'success' : 'warning'}>{h.supportsPermanentWorkers ? '24/7 Workers' : 'Limited Workers'}</KodiaBadge></div>
												<div className='text-[11px] text-void-fg-2'>{h.recommendedFor}</div>
												{h.caveats.map((c, i) => <div key={i} className='text-[10px] text-void-fg-3'>• {c}</div>)}
											</KodiaCard>
										))}
									</div>
								</div>
							)}

							{section === 'embedded' && (
								<KodiaCard className='flex flex-col gap-3'>
									<div className='font-semibold text-sm'>Embedded Multi-Tenant Automation Platform Generator</div>
									<p className='text-xs text-void-fg-3'>Generate a complete standalone n8n-like automation application (with its own visual builder, multi-tenant isolation, durable engine, tests &amp; Dockerfile) that runs with zero dependency on Kodia.</p>
									<div className='flex flex-wrap items-center gap-2'>
										<input value={embeddedName} onChange={e => setEmbeddedName(e.target.value)} className='flex-1 min-w-[200px] px-2.5 py-1.5 rounded bg-void-bg-2 border border-void-border-2' placeholder='Platform Name' />
										<label className='flex items-center gap-1.5 text-xs cursor-pointer'><input type='checkbox' checked={embeddedMultiTenant} onChange={e => setEmbeddedMultiTenant(e.target.checked)} /> Multi-Tenant Isolation</label>
										<KodiaPrimaryButton disabled={busy !== null || !embeddedName.trim()} onClick={() => void run('emb', async () => (await uaep.generateEmbeddedPlatform({ appName: embeddedName.trim(), multiTenant: embeddedMultiTenant })).summary)}>
											<GitBranch size={12} /> Generate Standalone Platform
										</KodiaPrimaryButton>
									</div>
								</KodiaCard>
							)}

							{section === 'security' && (
								<KodiaCard className='flex flex-col gap-2'>
									<div className='font-semibold text-sm'>Hash-Chained Tamper-Evident Audit Log ({snap.recentAuditLogs.length})</div>
									{snap.recentAuditLogs.length === 0 ? <div className='text-void-fg-3'>No audit events recorded yet.</div> : snap.recentAuditLogs.map(a => (
										<div key={a.id} className='p-2 rounded bg-void-bg-1 border border-void-border-2 flex items-center justify-between gap-2 text-[11px]'>
											<div className='min-w-0 truncate'><KodiaBadge tone={a.outcome === 'allowed' ? 'success' : 'danger'}>{a.outcome}</KodiaBadge> <span className='font-mono ml-1'>{a.action}</span> — <span className='text-void-fg-2'>{a.detail}</span></div>
											<span className='font-mono text-[9px] text-void-fg-3 whitespace-nowrap'>{a.entryHash.slice(0, 10)}</span>
										</div>
									))}
								</KodiaCard>
							)}
						</div>
					</div>
				)}
			</div>
		</div>
	);
};
