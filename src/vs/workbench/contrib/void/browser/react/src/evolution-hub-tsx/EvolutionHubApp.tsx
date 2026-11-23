/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useCallback, useEffect, useState } from 'react';
import {
	Activity,
	CalendarClock,
	CheckCircle2,
	Cloud,
	Compass,
	FileText,
	Flame,
	Layers,
	Lock,
	PackageCheck,
	RefreshCw,
	Rocket,
	ShieldAlert,
	Sparkles,
	Trash2,
} from 'lucide-react';
import { useAccessor, useIsDark } from '../util/services.js';
import { KodiaBadge, KodiaCard, KodiaPrimaryButton, KodiaSecondaryButton } from '../util/KodiaDesignSystem.js';
import { EvolutionWorkbenchState } from '../../../evolutionService.js';
import {
	EvolutionDomain,
	EvolutionHubSection,
	EvolutionVerdict,
} from '../../../../common/evolutionTypes.js';

const TABS: { id: EvolutionHubSection; label: string; icon: React.ReactNode }[] = [
	{ id: 'radar', label: 'Capability Radar', icon: <Compass size={13} /> },
	{ id: 'supply-chain', label: 'Supply-Chain & SBOM', icon: <PackageCheck size={13} /> },
	{ id: 'iac-finops', label: 'Cloud / IaC & FinOps', icon: <Cloud size={13} /> },
	{ id: 'prod-release', label: 'Incident & Release', icon: <Rocket size={13} /> },
	{ id: 'privacy-legacy', label: 'Privacy & Modernization', icon: <Lock size={13} /> },
	{ id: 'proposals', label: 'Evolution Proposals', icon: <Sparkles size={13} /> },
];

function verdictTone(v: EvolutionVerdict): 'success' | 'warning' | 'danger' | 'neutral' {
	if (v === 'ADOPT_CANDIDATE') { return 'success'; }
	if (v === 'MONITOR') { return 'warning'; }
	if (v === 'REJECT_HYPE' || v === 'REJECT_INCOMPATIBLE') { return 'danger'; }
	return 'neutral';
}

function sevTone(s: string): 'danger' | 'warning' | 'accent' | 'neutral' {
	if (s === 'critical' || s === 'blocker') { return 'danger'; }
	if (s === 'high' || s === 'attention') { return 'warning'; }
	if (s === 'medium') { return 'accent'; }
	return 'neutral';
}

export const EvolutionHubApp: React.FC = () => {
	const isDark = useIsDark();
	const accessor = useAccessor();
	const evolutionService = accessor.get('IEvolutionService');
	const toolsService = accessor.get('IToolsService');

	const [state, setState] = useState<EvolutionWorkbenchState>(() => evolutionService.state);
	const [busy, setBusy] = useState<string | null>(null);
	const [banner, setBanner] = useState<string | null>(null);
	const [showEvents, setShowEvents] = useState(true);

	// Technology evaluator form
	const [techName, setTechName] = useState('');
	const [techDomain, setTechDomain] = useState<EvolutionDomain>('engineering-techniques');
	const [techSummary, setTechSummary] = useState('');
	const [techLicense, setTechLicense] = useState('MIT');
	const [techMaturity, setTechMaturity] = useState<'experimental' | 'emerging' | 'production-proven' | 'declining'>('emerging');
	const [techBenchmarks, setTechBenchmarks] = useState(2);

	// Incident forensics form
	const [incService, setIncService] = useState('api-gateway');
	const [incLogs, setIncLogs] = useState('');

	useEffect(() => {
		const sync = () => setState(evolutionService.state);
		const d = evolutionService.onDidChange(sync);
		void evolutionService.refreshFromDisk();
		return () => d.dispose();
	}, [evolutionService]);

	const runAction = useCallback(async (label: string, fn: () => Promise<void>) => {
		setBusy(label);
		setBanner(null);
		try { await fn(); }
		catch (err) { setBanner(`Error (${label}): ${err instanceof Error ? err.message : String(err)}`); }
		finally { setBusy(null); }
	}, []);

	const handleRunRadar = useCallback(() => runAction('Running Capability Evolution Radar', async () => {
		const c = await toolsService.callTool.evolution_run_capability_radar({});
		const r = await c.result;
		setBanner(r.summary);
		evolutionService.setActiveSection('radar');
	}), [runAction, toolsService, evolutionService]);

	const handleScheduleAudit = useCallback(() => runAction('Scheduling periodic audit', async () => {
		const c = await toolsService.callTool.evolution_schedule_periodic_audit({ interval_hours: 168 });
		const r = await c.result;
		setBanner(r.message);
	}), [runAction, toolsService]);

	const handleSupplyChain = useCallback(() => runAction('Auditing supply chain & CycloneDX SBOM', async () => {
		const c = await toolsService.callTool.evolution_supply_chain_sbom({ run_live_audit: true });
		const r = await c.result;
		setBanner(r.summary);
		evolutionService.setActiveSection('supply-chain');
	}), [runAction, toolsService, evolutionService]);

	const handleIacFinOps = useCallback(() => runAction('Auditing IaC & FinOps', async () => {
		const c = await toolsService.callTool.evolution_audit_iac_finops({});
		const r = await c.result;
		setBanner(r.summary);
		evolutionService.setActiveSection('iac-finops');
	}), [runAction, toolsService, evolutionService]);

	const handleReleasePlan = useCallback(() => runAction('Planning autonomous release', async () => {
		const c = await toolsService.callTool.evolution_plan_release({});
		const r = await c.result;
		setBanner(r.summary);
		evolutionService.setActiveSection('prod-release');
	}), [runAction, toolsService, evolutionService]);

	const handleAnalyzeIncident = useCallback(() => {
		if (!incLogs.trim()) { return; }
		void runAction('Analyzing incident logs', async () => {
			const c = await toolsService.callTool.evolution_analyze_incident({
				service_name: incService.trim() || 'service',
				log_text: incLogs,
			});
			const r = await c.result;
			setBanner(r.summary);
		});
	}, [incService, incLogs, runAction, toolsService]);

	const handlePrivacyAndLegacy = useCallback(() => runAction('Auditing privacy & legacy modernization', async () => {
		const c1 = await toolsService.callTool.evolution_audit_privacy_compliance({});
		const p = await c1.result;
		setBanner(p.summary);
		evolutionService.setActiveSection('privacy-legacy');
	}), [runAction, toolsService, evolutionService]);

	const handleEvaluateTech = useCallback(() => {
		if (!techName.trim() || !techSummary.trim()) { return; }
		void runAction('Evaluating technology candidate', async () => {
			const c = await toolsService.callTool.evolution_evaluate_technology({
				name: techName.trim(),
				domain: techDomain,
				summary: techSummary.trim(),
				license: techLicense.trim() || undefined,
				maturity: techMaturity,
				benchmarks_count: techBenchmarks,
			});
			const r = await c.result;
			setBanner(`${r.name}: ${r.verdict} (Signal ${r.signalScore}/100, Hype Risk ${r.hypeRiskScore}/100, autoInstallAllowed=false)`);
			setTechName('');
			setTechSummary('');
		});
	}, [techName, techDomain, techSummary, techLicense, techMaturity, techBenchmarks, runAction, toolsService]);

	const handleUpdateProposal = useCallback((id: string, status: 'approved' | 'deferred' | 'rejected' | 'implemented') =>
		runAction('Updating proposal', async () => {
			await toolsService.callTool.evolution_manage_proposals({ action: 'update_status', id, status });
		}), [runAction, toolsService]);

	const handleDeleteProposal = useCallback((id: string) =>
		runAction('Removing proposal', async () => {
			await toolsService.callTool.evolution_manage_proposals({ action: 'remove', id });
		}), [runAction, toolsService]);

	const latestRadar = state.radarReports[0];
	const latestSbom = state.supplyChainReports[0];
	const latestIac = state.iacFinOpsReports[0];
	const latestIncident = state.incidentReports[0];
	const latestRelease = state.releasePlans[0];
	const latestPrivacy = state.privacyReports[0];
	const latestMod = state.modernizationReports[0];

	return (
		<div className={`@@void-scope ${isDark ? 'dark' : ''} h-full w-full flex flex-col bg-void-bg-2 text-void-fg-1 overflow-hidden`}>
			{/* Header Toolbar */}
			<div className='flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-void-border-2 bg-void-bg-1 flex-shrink-0'>
				<div className='flex items-center gap-2.5'>
					<Compass size={17} className='text-violet-400' />
					<div>
						<div className='text-sm font-semibold text-void-fg-1 leading-tight'>Kodia Next-Gen Evolution, Supply-Chain & Ops Hub</div>
						<div className='text-[11px] text-void-fg-3'>Capability Radar · CycloneDX 1.5 SBOM · IaC/FinOps · Incident/SLO & Releases · GDPR/AI-Act · Strangler-Fig</div>
					</div>
				</div>
				<div className='flex flex-wrap items-center gap-1.5'>
					<KodiaPrimaryButton onClick={handleRunRadar} disabled={!!busy}>
						<Compass size={12} /> Run Radar
					</KodiaPrimaryButton>
					<KodiaSecondaryButton onClick={handleSupplyChain} disabled={!!busy}>
						<PackageCheck size={12} /> SBOM Audit
					</KodiaSecondaryButton>
					<KodiaSecondaryButton onClick={handleIacFinOps} disabled={!!busy}>
						<Cloud size={12} /> IaC & FinOps
					</KodiaSecondaryButton>
					<KodiaSecondaryButton onClick={handleReleasePlan} disabled={!!busy}>
						<Rocket size={12} /> Plan Release
					</KodiaSecondaryButton>
					<KodiaSecondaryButton onClick={handlePrivacyAndLegacy} disabled={!!busy}>
						<Lock size={12} /> Privacy & Legacy
					</KodiaSecondaryButton>
					<KodiaSecondaryButton onClick={handleScheduleAudit} disabled={!!busy}>
						<CalendarClock size={12} /> Schedule Weekly
					</KodiaSecondaryButton>
					<KodiaSecondaryButton onClick={() => void evolutionService.refreshFromDisk()} disabled={!!busy}>
						<RefreshCw size={12} />
					</KodiaSecondaryButton>
					<KodiaSecondaryButton onClick={() => setShowEvents(v => !v)}>
						<Activity size={12} /> ({state.liveEvents.length})
					</KodiaSecondaryButton>
				</div>
			</div>

			{(busy || banner) && (
				<div className='px-4 py-1.5 text-xs bg-void-bg-3 border-b border-void-border-2 flex items-center justify-between gap-2 flex-shrink-0'>
					<span className='truncate'>{busy ? `Running: ${busy}…` : banner}</span>
					{banner && !busy && <button type='button' onClick={() => setBanner(null)} className='text-[10px] text-void-fg-3 hover:text-void-fg-1 cursor-pointer'>Dismiss</button>}
				</div>
			)}

			{/* Section Tabs */}
			<div className='flex items-center gap-1 px-3 py-1.5 border-b border-void-border-2 bg-void-bg-1/70 overflow-x-auto flex-shrink-0'>
				{TABS.map(t => {
					const active = state.activeSection === t.id;
					return (
						<button
							key={t.id}
							type='button'
							onClick={() => evolutionService.setActiveSection(t.id)}
							style={active ? { borderColor: 'var(--kodia-accent)' } : undefined}
							className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md whitespace-nowrap cursor-pointer ${active
								? 'bg-void-bg-3 text-void-fg-1 font-medium border'
								: 'text-void-fg-3 hover:text-void-fg-1 hover:bg-void-bg-2 border border-transparent'
							}`}
						>
							{t.icon}
							<span>{t.label}</span>
						</button>
					);
				})}
			</div>

			{/* Body */}
			<div className='flex-1 min-h-0 overflow-y-auto p-4 space-y-4'>
				{/* TAB 1: CONTINUOUS CAPABILITY EVOLUTION RADAR (§6) */}
				{state.activeSection === 'radar' && (
					<div className='space-y-4'>
						<KodiaCard className='!p-3 space-y-2.5'>
							<div className='flex items-center justify-between gap-2'>
								<span className='text-xs font-semibold'>Evaluate Emerging Technology / Dependency (Signal vs. Hype Filter)</span>
								<KodiaBadge tone='neutral'>autoInstallAllowed: FALSE</KodiaBadge>
							</div>
							<div className='grid grid-cols-1 md:grid-cols-3 gap-2'>
								<input type='text' value={techName} onChange={e => setTechName(e.target.value)} placeholder='Technology name…' className='px-2.5 py-1.5 text-xs rounded bg-void-bg-1 border border-void-border-2 text-void-fg-1' />
								<input type='text' value={techLicense} onChange={e => setTechLicense(e.target.value)} placeholder='SPDX License (MIT, Apache-2.0, AGPL-3.0)…' className='px-2.5 py-1.5 text-xs rounded bg-void-bg-1 border border-void-border-2 text-void-fg-1' />
								<select value={techDomain} onChange={e => setTechDomain(e.target.value as EvolutionDomain)} className='px-2.5 py-1.5 text-xs rounded bg-void-bg-1 border border-void-border-2 text-void-fg-1'>
									<option value='engineering-techniques'>Engineering Techniques</option>
									<option value='languages-frameworks'>Languages & Frameworks</option>
									<option value='testing-verification'>Testing & Verification</option>
									<option value='ai-agents'>AI & Agents</option>
									<option value='security-threats'>Security Threats</option>
									<option value='developer-workflows'>Developer Workflows</option>
									<option value='infrastructure-cloud'>Infrastructure & Cloud</option>
									<option value='hardware-embedded'>Hardware & Embedded</option>
									<option value='kodia-self-improvement'>Kodia Self-Improvement</option>
								</select>
							</div>
							<input type='text' value={techSummary} onChange={e => setTechSummary(e.target.value)} placeholder='What real engineering problem does it solve?' className='w-full px-2.5 py-1.5 text-xs rounded bg-void-bg-1 border border-void-border-2 text-void-fg-1' />
							<div className='flex flex-wrap items-center justify-between gap-2 text-xs'>
								<div className='flex items-center gap-3'>
									<select value={techMaturity} onChange={e => setTechMaturity(e.target.value as typeof techMaturity)} className='px-2 py-1 rounded bg-void-bg-1 border border-void-border-2'>
										<option value='production-proven'>Production-Proven</option>
										<option value='emerging'>Emerging</option>
										<option value='experimental'>Experimental</option>
										<option value='declining'>Declining</option>
									</select>
									<label className='flex items-center gap-1.5'>
										<span>Benchmarks/Evidence:</span>
										<input type='number' min={0} max={20} value={techBenchmarks} onChange={e => setTechBenchmarks(Number(e.target.value) || 0)} className='w-16 px-2 py-1 rounded bg-void-bg-1 border border-void-border-2' />
									</label>
								</div>
								<KodiaPrimaryButton onClick={handleEvaluateTech} disabled={!techName.trim() || !techSummary.trim() || !!busy}>
									Evaluate Signal vs Hype
								</KodiaPrimaryButton>
							</div>
						</KodiaCard>

						{!latestRadar ? (
							<KodiaCard className='!p-6 text-center space-y-2'>
								<Compass size={20} className='mx-auto text-violet-400' />
								<div className='text-xs text-void-fg-2'>Run the Permanent Capability Evolution Radar to evaluate emerging techniques, security threats, and Kodia self-improvement candidates.</div>
								<KodiaPrimaryButton onClick={handleRunRadar} disabled={!!busy}>Run Capability Radar</KodiaPrimaryButton>
							</KodiaCard>
						) : (
							<div className='space-y-2.5'>
								<KodiaCard className='!p-3'>
									<div className='text-xs font-semibold'>{latestRadar.summary}</div>
									<div className='text-[11px] text-void-fg-3 mt-1'>Detected ecosystems: {latestRadar.workspaceEcosystems.join(', ') || 'Generic'} · Next scheduled check: {new Date(latestRadar.nextRecommendedAuditAt).toLocaleDateString()}</div>
								</KodiaCard>
								{latestRadar.evaluations.map(ev => (
									<KodiaCard key={ev.id} className='!p-3 space-y-1'>
										<div className='flex flex-wrap items-center justify-between gap-2'>
											<div className='flex items-center gap-2'>
												<KodiaBadge tone={verdictTone(ev.verdict)}>{ev.verdict}</KodiaBadge>
												<span className='text-xs font-semibold'>{ev.name}</span>
												<span className='text-[10px] font-mono text-void-fg-3'>{ev.domain}</span>
											</div>
											<span className='text-[11px] font-mono text-void-fg-2'>Signal {ev.signalScore}/100 · Hype {ev.hypeRiskScore}/100</span>
										</div>
										<div className='text-[11px] text-void-fg-2'>{ev.rationale.join(' · ')}</div>
										<div className='text-[11px] text-emerald-400/90'>Action: {ev.recommendedAction}</div>
									</KodiaCard>
								))}
							</div>
						)}
					</div>
				)}

				{/* TAB 2: SUPPLY-CHAIN & CYCLONEDX 1.5 SBOM */}
				{state.activeSection === 'supply-chain' && (
					<div className='space-y-3'>
						{!latestSbom ? (
							<KodiaCard className='!p-6 text-center space-y-2'>
								<PackageCheck size={20} className='mx-auto text-emerald-400' />
								<div className='text-xs text-void-fg-2'>Generate a CycloneDX 1.5 SBOM and audit licenses, pinning, typosquatting, lifecycle scripts, and advisories.</div>
								<KodiaPrimaryButton onClick={handleSupplyChain} disabled={!!busy}>Run Supply-Chain & SBOM Audit</KodiaPrimaryButton>
							</KodiaCard>
						) : (
							<>
								<KodiaCard className='!p-3 space-y-1'>
									<div className='text-xs font-semibold'>{latestSbom.summary}</div>
									<div className='text-[11px] text-void-fg-3'>{latestSbom.liveAuditNote}{latestSbom.sbomPath ? ` · SBOM: ${latestSbom.sbomPath}` : ''}</div>
								</KodiaCard>
								{latestSbom.findings.map(f => (
									<KodiaCard key={f.id} className='!p-3 space-y-1'>
										<div className='flex items-center justify-between gap-2'>
											<div className='flex items-center gap-2'>
												<KodiaBadge tone={sevTone(f.severity)}>{f.severity}</KodiaBadge>
												<span className='text-xs font-semibold'>{f.title}</span>
											</div>
											<span className='text-[11px] font-mono text-void-fg-3'>{f.file}</span>
										</div>
										<div className='text-xs text-void-fg-2'>{f.detail}</div>
										<div className='text-[11px] text-emerald-400/90'>Fix: {f.remediation}</div>
									</KodiaCard>
								))}
							</>
						)}
					</div>
				)}

				{/* TAB 3: CLOUD / IaC & FINOPS */}
				{state.activeSection === 'iac-finops' && (
					<div className='space-y-3'>
						{!latestIac ? (
							<KodiaCard className='!p-6 text-center space-y-2'>
								<Cloud size={20} className='mx-auto text-sky-400' />
								<div className='text-xs text-void-fg-2'>Audit Dockerfiles, Kubernetes YAML, Terraform (.tf), GitHub Actions workflows, and monthly FinOps cloud spend.</div>
								<KodiaPrimaryButton onClick={handleIacFinOps} disabled={!!busy}>Run IaC & FinOps Audit</KodiaPrimaryButton>
							</KodiaCard>
						) : (
							<>
								<KodiaCard className='!p-3 flex flex-wrap items-center justify-between gap-2'>
									<div className='text-xs font-semibold'>{latestIac.summary}</div>
									<KodiaBadge tone={latestIac.budgetExceeded ? 'danger' : 'success'}>
										Est. ${latestIac.estimatedMonthlyUsd}/mo (Save ~${latestIac.potentialMonthlySavingsUsd}/mo)
									</KodiaBadge>
								</KodiaCard>
								{latestIac.findings.map(f => (
									<KodiaCard key={f.id} className='!p-3 space-y-1'>
										<div className='flex items-center justify-between gap-2'>
											<div className='flex items-center gap-2'>
												<KodiaBadge tone={sevTone(f.severity)}>{f.severity}</KodiaBadge>
												<span className='text-xs font-semibold'>{f.title}</span>
												<span className='text-[10px] font-mono text-void-fg-3'>{f.ruleId}</span>
											</div>
											<span className='text-[11px] font-mono text-void-fg-3'>{f.file}:{f.line}</span>
										</div>
										<div className='text-xs text-void-fg-2'>{f.detail}</div>
										<div className='text-[11px] text-emerald-400/90'>Remediation: {f.remediation}</div>
									</KodiaCard>
								))}
								{latestIac.costBreakdown.length > 0 && (
									<KodiaCard className='!p-3 space-y-1.5'>
										<div className='text-xs font-semibold'>FinOps Cost & Right-Sizing Breakdown</div>
										{latestIac.costBreakdown.map((c, i) => (
											<div key={i} className='text-xs bg-void-bg-1 p-2 rounded border border-void-border-2 flex flex-wrap justify-between gap-2'>
												<span><strong>{c.resource}</strong> ({c.sourceFile}) — {c.recommendation}</span>
												<span className='font-mono text-sky-400'>${c.estimatedMonthlyUsd}/mo (save ${c.rightSizingSavingsUsd})</span>
											</div>
										))}
									</KodiaCard>
								)}
							</>
						)}
					</div>
				)}

				{/* TAB 4: PRODUCTION INCIDENT FORENSICS & AUTONOMOUS RELEASE */}
				{state.activeSection === 'prod-release' && (
					<div className='space-y-4'>
						<KodiaCard className='!p-3 space-y-2'>
							<div className='text-xs font-semibold flex items-center gap-1.5'><Flame size={13} className='text-amber-400' /> Production Incident & SLO Burn-Rate Forensics</div>
							<input type='text' value={incService} onChange={e => setIncService(e.target.value)} placeholder='Service name…' className='w-full px-2.5 py-1.5 text-xs rounded bg-void-bg-1 border border-void-border-2 text-void-fg-1' />
							<textarea rows={3} value={incLogs} onChange={e => setIncLogs(e.target.value)} placeholder='Paste production HTTP/app logs (with optional latency=123ms fields)…' className='w-full px-2.5 py-1.5 text-xs font-mono rounded bg-void-bg-1 border border-void-border-2 text-void-fg-1' />
							<div className='flex justify-end gap-2'>
								<KodiaSecondaryButton onClick={handleReleasePlan} disabled={!!busy}><Rocket size={12} /> Plan Release from Git</KodiaSecondaryButton>
								<KodiaPrimaryButton onClick={handleAnalyzeIncident} disabled={!incLogs.trim() || !!busy}>Analyze Incident</KodiaPrimaryButton>
							</div>
						</KodiaCard>

						{latestIncident && (
							<KodiaCard className='!p-3 space-y-2'>
								<div className='flex items-center justify-between gap-2'>
									<span className='text-xs font-semibold'>{latestIncident.summary}</span>
									<KodiaBadge tone={latestIncident.sloBreached ? 'danger' : 'success'}>{latestIncident.sloBreached ? 'SLO BREACHED' : 'SLO OK'}</KodiaBadge>
								</div>
								<pre className='text-[11px] font-mono bg-void-bg-1 p-2 rounded whitespace-pre-wrap text-void-fg-2 max-h-56 overflow-y-auto'>{latestIncident.postmortemDraft}</pre>
							</KodiaCard>
						)}

						{latestRelease && (
							<KodiaCard className='!p-3 space-y-2'>
								<div className='flex items-center justify-between gap-2'>
									<span className='text-xs font-semibold flex items-center gap-1.5'><FileText size={13} /> {latestRelease.summary}</span>
									<KodiaBadge tone={latestRelease.releaseSafe ? 'success' : 'danger'}>{latestRelease.releaseSafe ? 'MIGRATIONS SAFE' : 'MIGRATION RISK'}</KodiaBadge>
								</div>
								<pre className='text-[11px] font-mono bg-void-bg-1 p-2 rounded whitespace-pre-wrap text-void-fg-2 max-h-56 overflow-y-auto'>{latestRelease.changelogMarkdown}</pre>
							</KodiaCard>
						)}
					</div>
				)}

				{/* TAB 5: DATA PRIVACY COMPLIANCE & LEGACY MODERNIZATION */}
				{state.activeSection === 'privacy-legacy' && (
					<div className='space-y-4'>
						{!latestPrivacy && !latestMod ? (
							<KodiaCard className='!p-6 text-center space-y-2'>
								<ShieldAlert size={20} className='mx-auto text-amber-400' />
								<div className='text-xs text-void-fg-2'>Audit GDPR/SOC2/HIPAA/EU AI Act data governance and generate Strangler-Fig legacy modernization waves.</div>
								<KodiaPrimaryButton onClick={handlePrivacyAndLegacy} disabled={!!busy}>Run Privacy & Modernization Audit</KodiaPrimaryButton>
							</KodiaCard>
						) : (
							<>
								{latestPrivacy && (
									<KodiaCard className='!p-3 space-y-2'>
										<div className='text-xs font-semibold'>{latestPrivacy.summary}</div>
										<div className='flex flex-wrap gap-2'>
											{(['GDPR', 'SOC2', 'HIPAA', 'EU_AI_ACT'] as const).map(fw => (
												<KodiaBadge key={fw} tone={sevTone(latestPrivacy.frameworkSummary[fw].status)}>
													{fw}: {latestPrivacy.frameworkSummary[fw].status} ({latestPrivacy.frameworkSummary[fw].findings})
												</KodiaBadge>
											))}
										</div>
										{latestPrivacy.findings.map(f => (
											<div key={f.id} className='text-xs p-2 rounded bg-void-bg-1 border border-void-border-2'>
												<strong>{f.title}</strong> ({f.file}:{f.line}) — {f.remediation}
											</div>
										))}
									</KodiaCard>
								)}
								{latestMod && (
									<KodiaCard className='!p-3 space-y-2'>
										<div className='text-xs font-semibold flex items-center gap-1.5'><Layers size={13} /> {latestMod.summary}</div>
										{latestMod.waves.map(w => (
											<div key={w.wave} className='text-xs p-2 rounded bg-void-bg-1 border border-void-border-2 space-y-0.5'>
												<div className='font-semibold'>Wave {w.wave} ({w.risk} risk): {w.title}</div>
												<div className='text-void-fg-2'>{w.strategy}</div>
												<div className='text-[11px] text-emerald-400/90'>Gate: {w.verificationGate}</div>
											</div>
										))}
									</KodiaCard>
								)}
							</>
						)}
					</div>
				)}

				{/* TAB 6: GOVERNED EVOLUTION PROPOSALS */}
				{state.activeSection === 'proposals' && (
					<div className='space-y-2.5'>
						{state.proposals.length === 0 ? (
							<KodiaCard className='!p-6 text-center'>
								<CheckCircle2 size={20} className='mx-auto text-emerald-400 mb-1.5' />
								<div className='text-xs text-void-fg-2'>No capability evolution proposals stored yet. Evaluate an ADOPT_CANDIDATE in Capability Radar to record one.</div>
							</KodiaCard>
						) : state.proposals.map(p => (
							<KodiaCard key={p.id} className='!p-3 space-y-1.5'>
								<div className='flex flex-wrap items-center justify-between gap-2'>
									<div className='flex items-center gap-2'>
										<KodiaBadge tone={verdictTone(p.verdict)}>{p.status.toUpperCase()}</KodiaBadge>
										<span className='text-xs font-semibold'>{p.title}</span>
										<KodiaBadge tone='neutral'>autoInstall: false</KodiaBadge>
									</div>
									<div className='flex items-center gap-1.5'>
										<button type='button' onClick={() => void handleUpdateProposal(p.id, 'approved')} className='text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 cursor-pointer'>Approve</button>
										<button type='button' onClick={() => void handleUpdateProposal(p.id, 'deferred')} className='text-[10px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-400 cursor-pointer'>Defer</button>
										<button type='button' onClick={() => void handleUpdateProposal(p.id, 'rejected')} className='text-[10px] px-2 py-0.5 rounded bg-rose-500/15 text-rose-400 cursor-pointer'>Reject</button>
										<button type='button' onClick={() => void handleDeleteProposal(p.id)} className='text-void-fg-3 hover:text-rose-400 cursor-pointer'><Trash2 size={12} /></button>
									</div>
								</div>
								<div className='text-xs text-void-fg-2'>{p.justification}</div>
							</KodiaCard>
						))}
					</div>
				)}
			</div>

			{/* Live Event Stream */}
			{showEvents && (
				<div className='h-32 border-t border-void-border-2 bg-void-bg-1 flex flex-col flex-shrink-0'>
					<div className='flex items-center justify-between px-3 py-1 border-b border-void-border-2 text-[11px]'>
						<span className='font-semibold text-void-fg-2 flex items-center gap-1.5'><Activity size={11} className='text-violet-400' /> Live Evolution & Ops Stream ({state.liveEvents.length})</span>
						<button type='button' onClick={() => evolutionService.clearLiveEvents()} className='text-void-fg-3 hover:text-void-fg-1 cursor-pointer'>Clear</button>
					</div>
					<div className='flex-1 overflow-y-auto px-3 py-1 space-y-0.5 font-mono text-[11px]'>
						{state.liveEvents.length === 0 ? (
							<div className='text-void-fg-3 py-2'>No live events emitted yet.</div>
						) : [...state.liveEvents].reverse().map(ev => (
							<div key={ev.eventId} className='flex items-center gap-2 text-void-fg-2'>
								<span className='text-void-fg-3 shrink-0'>#{ev.seq}</span>
								<span className='text-violet-400 shrink-0'>[{ev.type}]</span>
								<span className='truncate'>{ev.message}</span>
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
};
