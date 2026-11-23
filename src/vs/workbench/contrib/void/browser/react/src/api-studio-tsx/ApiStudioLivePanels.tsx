/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useMemo, useState } from 'react';
import {
	Activity,
	AlertTriangle,
	CheckCircle2,
	Clock,
	Gauge,
	Play,
	Server,
	ShieldAlert,
	ShieldCheck,
	Square,
	Trash2,
	XCircle,
} from 'lucide-react';
import {
	ApiLiveEvent,
	ApiLoadTestResult,
	ApiManagedRuntimeInfo,
	ApiProductionReadinessReport,
	ApiSecurityReport,
	ApiTimingBreakdown,
} from '../../../../common/apiStudioTypes.js';
import { KodiaBadge, KodiaCard, KodiaPrimaryButton, KodiaSecondaryButton } from '../util/KodiaDesignSystem.js';

export const TimingWaterfall: React.FC<{ timing: ApiTimingBreakdown }> = ({ timing }) => {
	const total = Math.max(1, timing.totalMs);
	const rows = [
		{ label: 'DNS Lookup', ms: timing.dnsMs, color: '#38bdf8' },
		{ label: 'TCP Connect', ms: timing.connectMs, color: '#818cf8' },
		{ label: 'TLS Handshake', ms: timing.tlsMs, color: '#c084fc' },
		{ label: 'Waiting (TTFB)', ms: timing.ttfbMs, color: '#34d399' },
		{ label: 'Content Download', ms: timing.downloadMs, color: '#f59e0b' },
	];

	return (
		<div className='p-3 space-y-2.5'>
			<div className='flex items-center justify-between text-xs'>
				<span className='font-medium text-void-fg-1 flex items-center gap-1.5'>
					<Clock size={13} /> Measured Network Timing Breakdown
				</span>
				<KodiaBadge tone='accent'>Total: {timing.totalMs} ms</KodiaBadge>
			</div>
			<p className='text-[11px] text-void-fg-3'>
				{timing.measuredPhases
					? 'Measured directly from Node transport socket events (unavailable phases such as TLS on plain HTTP are marked n/a).'
					: 'Transport phase breakdown unavailable for failed/blocked request.'}
			</p>
			<div className='space-y-2 pt-1'>
				{rows.map(r => {
					const pct = r.ms !== null ? Math.min(100, Math.max(2, (r.ms / total) * 100)) : 0;
					return (
						<div key={r.label} className='grid grid-cols-[130px_1fr_70px] items-center gap-2 text-[11px]'>
							<span className='text-void-fg-2'>{r.label}</span>
							<div className='h-2.5 rounded bg-void-bg-3 overflow-hidden'>
								{r.ms !== null && (
									<div className='h-full rounded' style={{ width: `${pct}%`, backgroundColor: r.color }} />
								)}
							</div>
							<span className='font-mono text-right text-void-fg-2'>
								{r.ms !== null ? `${r.ms} ms` : 'n/a'}
							</span>
						</div>
					);
				})}
			</div>
		</div>
	);
};

export const LiveEventStreamPanel: React.FC<{
	events: readonly ApiLiveEvent[];
	onClear: () => void;
}> = ({ events, onClear }) => {
	const [filter, setFilter] = useState('');
	const [typeFilter, setTypeFilter] = useState<'all' | 'requests' | 'tests' | 'runtimes' | 'errors'>('all');

	const filtered = useMemo(() => {
		const q = filter.trim().toLowerCase();
		return [...events].reverse().filter(ev => {
			if (typeFilter === 'requests' && !ev.type.includes('request') && !ev.type.includes('response') && ev.type !== 'stream_message') { return false; }
			if (typeFilter === 'tests' && !ev.type.includes('test') && ev.type !== 'assertion_result') { return false; }
			if (typeFilter === 'runtimes' && !ev.type.startsWith('runtime_') && ev.type !== 'health_check') { return false; }
			if (typeFilter === 'errors' && ev.type !== 'execution_error' && ev.passed !== false && ev.type !== 'runtime_failed') { return false; }
			if (q && !ev.message.toLowerCase().includes(q) && !(ev.url ?? '').toLowerCase().includes(q) && !ev.type.toLowerCase().includes(q)) { return false; }
			return true;
		});
	}, [events, filter, typeFilter]);

	return (
		<div className='flex flex-col h-full min-h-0'>
			<div className='flex flex-wrap items-center gap-1.5 px-2.5 py-1.5 border-b border-void-border-2 bg-void-bg-1/60 shrink-0'>
				<Activity size={12} style={{ color: 'var(--kodia-accent)' }} />
				<span className='text-[11px] font-semibold text-void-fg-1'>Live Execution Stream ({events.length})</span>
				<div className='flex items-center gap-1 ml-2'>
					{(['all', 'requests', 'tests', 'runtimes', 'errors'] as const).map(f => (
						<button
							key={f}
							type='button'
							onClick={() => setTypeFilter(f)}
							className={`px-1.5 py-0.5 rounded text-[10px] cursor-pointer ${typeFilter === f ? 'bg-void-bg-3 text-void-fg-1 font-medium' : 'text-void-fg-3 hover:text-void-fg-1'}`}
						>
							{f}
						</button>
					))}
				</div>
				<input
					value={filter}
					onChange={e => setFilter(e.target.value)}
					placeholder='Filter live events...'
					className='ml-auto px-2 py-0.5 text-[11px] rounded bg-void-bg-1 border border-void-border-2 text-void-fg-1 w-44'
				/>
				<button type='button' onClick={onClear} title='Clear event stream' className='p-1 rounded text-void-fg-3 hover:text-void-fg-1 cursor-pointer'>
					<Trash2 size={12} />
				</button>
			</div>
			<div className='flex-1 overflow-auto divide-y divide-void-border-2/50 font-mono text-[11px]'>
				{filtered.length === 0 ? (
					<div className='p-4 text-xs text-void-fg-3 font-sans'>
						No live execution events yet. Send a request, start an API runtime, or run a test suite to watch real execution events arrive here.
					</div>
				) : filtered.slice(0, 200).map(ev => {
					const badgeColor =
						ev.type === 'execution_error' || ev.type === 'runtime_failed' || ev.passed === false
							? 'text-rose-400 bg-rose-500/10'
							: ev.type === 'response_completed' || ev.type === 'runtime_ready' || ev.passed === true
								? 'text-emerald-400 bg-emerald-500/10'
								: 'text-sky-400 bg-sky-500/10';
					return (
						<div key={ev.eventId} className='px-2.5 py-1 flex items-center gap-2 hover:bg-void-bg-3/40'>
							<span className='text-[10px] text-void-fg-3 shrink-0'>#{ev.seq}</span>
							<span className='text-[10px] text-void-fg-3 shrink-0'>{ev.timestamp.slice(11, 19)}</span>
							<span className={`px-1.5 py-0.2 rounded text-[9px] font-semibold uppercase shrink-0 ${badgeColor}`}>
								{ev.type.replace(/_/g, ' ')}
							</span>
							{ev.status !== undefined && ev.status > 0 && (
								<span className={`text-[10px] font-semibold shrink-0 ${ev.status < 300 ? 'text-emerald-400' : ev.status < 400 ? 'text-amber-400' : 'text-rose-400'}`}>
									{ev.status}
								</span>
							)}
							<span className='text-void-fg-1 truncate'>{ev.message}</span>
							{ev.durationMs !== undefined && (
								<span className='ml-auto text-[10px] text-void-fg-3 shrink-0'>{ev.durationMs}ms</span>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
};

export const LoadTestDashboard: React.FC<{
	loadRuns: readonly ApiLoadTestResult[];
	defaultUrl: string;
	running: boolean;
	onRunLoad: (cfg: { name: string; url: string; method: 'GET' | 'POST'; virtualUsers: number; durationSeconds: number; p95ThresholdMs: number }) => void;
}> = ({ loadRuns, defaultUrl, running, onRunLoad }) => {
	const [name, setName] = useState('Local Baseline Load');
	const [url, setUrl] = useState(defaultUrl);
	const [method, setMethod] = useState<'GET' | 'POST'>('GET');
	const [vus, setVus] = useState(10);
	const [duration, setDuration] = useState(5);
	const [p95Limit, setP95Limit] = useState(500);

	const latest = loadRuns[0];
	const maxRps = Math.max(1, ...(latest?.timeline.map(b => b.rps) ?? [1]));
	const maxP95 = Math.max(1, ...(latest?.timeline.map(b => b.p95LatencyMs) ?? [1]));

	return (
		<div className='p-4 space-y-4 overflow-auto h-full'>
			<KodiaCard className='p-3 space-y-3'>
				<div className='flex items-center justify-between'>
					<div className='flex items-center gap-2'>
						<Gauge size={15} style={{ color: 'var(--kodia-accent)' }} />
						<h3 className='text-xs font-semibold text-void-fg-1'>Performance & Concurrent Load Testing Engine</h3>
					</div>
					<KodiaPrimaryButton disabled={running || !url.trim()} onClick={() => onRunLoad({ name, url, method, virtualUsers: vus, durationSeconds: duration, p95ThresholdMs: p95Limit })}>
						<Play size={12} /> {running ? 'Running Load Test...' : 'Run Load Test'}
					</KodiaPrimaryButton>
				</div>
				<div className='grid grid-cols-2 lg:grid-cols-6 gap-2 text-xs'>
					<label className='flex flex-col gap-1 col-span-2'>
						<span className='text-[10px] text-void-fg-3'>Target Endpoint URL</span>
						<input value={url} onChange={e => setUrl(e.target.value)} className='px-2 py-1 rounded bg-void-bg-1 border border-void-border-2 text-void-fg-1 text-xs font-mono' />
					</label>
					<label className='flex flex-col gap-1'>
						<span className='text-[10px] text-void-fg-3'>Profile Name</span>
						<input value={name} onChange={e => setName(e.target.value)} className='px-2 py-1 rounded bg-void-bg-1 border border-void-border-2 text-void-fg-1 text-xs' />
					</label>
					<label className='flex flex-col gap-1'>
						<span className='text-[10px] text-void-fg-3'>Virtual Users</span>
						<input type='number' min={1} max={200} value={vus} onChange={e => setVus(Math.max(1, Number(e.target.value) || 1))} className='px-2 py-1 rounded bg-void-bg-1 border border-void-border-2 text-void-fg-1 text-xs' />
					</label>
					<label className='flex flex-col gap-1'>
						<span className='text-[10px] text-void-fg-3'>Duration (sec)</span>
						<input type='number' min={1} max={120} value={duration} onChange={e => setDuration(Math.max(1, Number(e.target.value) || 1))} className='px-2 py-1 rounded bg-void-bg-1 border border-void-border-2 text-void-fg-1 text-xs' />
					</label>
					<label className='flex flex-col gap-1'>
						<span className='text-[10px] text-void-fg-3'>P95 Threshold (ms)</span>
						<div className='flex gap-1'>
							<select value={method} onChange={e => setMethod(e.target.value as 'GET' | 'POST')} className='px-1.5 py-1 rounded bg-void-bg-1 border border-void-border-2 text-void-fg-1 text-xs'>
								<option value='GET'>GET</option>
								<option value='POST'>POST</option>
							</select>
							<input type='number' min={10} value={p95Limit} onChange={e => setP95Limit(Math.max(10, Number(e.target.value) || 500))} className='px-2 py-1 rounded bg-void-bg-1 border border-void-border-2 text-void-fg-1 text-xs w-full' />
						</div>
					</label>
				</div>
			</KodiaCard>

			{latest && (
				<>
					<div className='grid grid-cols-2 md:grid-cols-6 gap-2.5'>
						{[
							{ label: 'Throughput', value: `${latest.rps} RPS` },
							{ label: 'Total Requests', value: String(latest.totalRequests) },
							{ label: 'Error Rate', value: `${(latest.errorRate * 100).toFixed(2)}%` },
							{ label: 'P50 Latency', value: `${latest.latencyMs.p50} ms` },
							{ label: 'P95 Latency', value: `${latest.latencyMs.p95} ms` },
							{ label: 'P99 Latency', value: `${latest.latencyMs.p99} ms` },
						].map(card => (
							<KodiaCard key={card.label} className='p-2.5'>
								<div className='text-[10px] text-void-fg-3'>{card.label}</div>
								<div className='text-sm font-semibold font-mono text-void-fg-1 mt-0.5'>{card.value}</div>
							</KodiaCard>
						))}
					</div>

					<KodiaCard className='p-3 space-y-2'>
						<div className='flex items-center justify-between text-xs'>
							<span className='font-medium text-void-fg-1'>Measured RPS & P95 Latency Over Time</span>
							<div className='flex items-center gap-2'>
								<KodiaBadge tone={latest.passedThresholds ? 'success' : 'danger'}>
									{latest.passedThresholds ? 'Thresholds Passed' : 'Thresholds Failed'}
								</KodiaBadge>
								{latest.generatorSaturated && <KodiaBadge tone='warning'>Generator Saturated</KodiaBadge>}
							</div>
						</div>
						{latest.timeline.length > 0 ? (
							<svg viewBox='0 0 600 130' className='w-full h-32 bg-void-bg-1 rounded border border-void-border-2'>
								{latest.timeline.map((b, idx) => {
									const x = 18 + (idx / Math.max(1, latest.timeline.length - 1)) * 564;
									const rpsH = (b.rps / maxRps) * 95;
									const p95Y = 115 - (b.p95LatencyMs / maxP95) * 95;
									return (
										<g key={b.second}>
											<rect x={x - 6} y={115 - rpsH} width={12} height={rpsH} fill='#38bdf8' opacity={0.45} rx={2} />
											<circle cx={x} cy={p95Y} r={3.5} fill='#f59e0b' />
										</g>
									);
								})}
								<text x='12' y='14' fill='currentColor' fontSize='9' opacity='0.65'>Blue bars: RPS (max {maxRps}) · Amber dots: P95 ms (max {maxP95}ms)</text>
							</svg>
						) : (
							<div className='text-xs text-void-fg-3'>Completed in {latest.durationMs}ms ({latest.summary})</div>
						)}
					</KodiaCard>
				</>
			)}
		</div>
	);
};

export const SecurityAndReadinessView: React.FC<{
	mode: 'security' | 'readiness';
	securityReport: ApiSecurityReport | null;
	readinessReport: ApiProductionReadinessReport | null;
	busy: boolean;
	onRunSecurity: () => void;
	onRunReadiness: () => void;
}> = ({ mode, securityReport, readinessReport, busy, onRunSecurity, onRunReadiness }) => {
	if (mode === 'security') {
		return (
			<div className='p-4 space-y-3 overflow-auto h-full'>
				<div className='flex items-center justify-between'>
					<div>
						<h3 className='text-sm font-semibold text-void-fg-1 flex items-center gap-1.5'>
							<ShieldCheck size={15} style={{ color: 'var(--kodia-accent)' }} /> API Security Assessment Engine
						</h3>
						<p className='text-xs text-void-fg-3'>Combines static codebase checks with safe live endpoint probes (headers, CORS, auth rejection, error leakage).</p>
					</div>
					<KodiaPrimaryButton disabled={busy} onClick={onRunSecurity}>
						<ShieldAlert size={12} /> {busy ? 'Auditing...' : 'Run Security Audit'}
					</KodiaPrimaryButton>
				</div>
				{securityReport ? (
					<div className='space-y-2.5'>
						<KodiaCard className='p-3 flex items-center justify-between'>
							<div className='text-xs text-void-fg-1'>{securityReport.summary}</div>
							<KodiaBadge tone={securityReport.score >= 85 ? 'success' : securityReport.score >= 60 ? 'warning' : 'danger'}>
								Score: {securityReport.score}/100
							</KodiaBadge>
						</KodiaCard>
						{securityReport.findings.map(f => (
							<KodiaCard key={f.id} className='p-3 space-y-1'>
								<div className='flex items-center gap-2 text-xs font-medium text-void-fg-1'>
									<KodiaBadge tone={f.severity === 'critical' || f.severity === 'high' ? 'danger' : 'warning'}>{f.severity.toUpperCase()}</KodiaBadge>
									<KodiaBadge tone='neutral'>{f.confidence}</KodiaBadge>
									<span>{f.title}</span>
								</div>
								<div className='text-[11px] font-mono text-void-fg-3'>{f.endpoint ?? `${f.file ?? ''}:${f.line ?? ''}`}</div>
								<div className='text-[11px] text-void-fg-2'>Evidence: {f.evidence}</div>
								<div className='text-[11px] text-emerald-400'>Remediation: {f.remediation}</div>
							</KodiaCard>
						))}
					</div>
				) : (
					<KodiaCard className='p-6 text-xs text-void-fg-3'>Run an API security audit to inspect static code risks and live endpoint defenses.</KodiaCard>
				)}
			</div>
		);
	}

	return (
		<div className='p-4 space-y-3 overflow-auto h-full'>
			<div className='flex items-center justify-between'>
				<div>
					<h3 className='text-sm font-semibold text-void-fg-1'>Evidence-Based API Production Readiness</h3>
					<p className='text-xs text-void-fg-3'>Evaluates 6 engineering pillars strictly from real discovery, functional test runs, load baselines, and security audits.</p>
				</div>
				<KodiaPrimaryButton disabled={busy} onClick={onRunReadiness}>
					{busy ? 'Evaluating...' : 'Evaluate Readiness'}
				</KodiaPrimaryButton>
			</div>
			{readinessReport ? (
				<div className='space-y-3'>
					<KodiaCard className='p-3 flex items-center justify-between'>
						<div className='text-xs font-medium text-void-fg-1'>{readinessReport.summary}</div>
						<KodiaBadge tone={readinessReport.overallStatus === 'passed' ? 'success' : readinessReport.overallStatus === 'failed' ? 'danger' : 'warning'}>
							{readinessReport.overallStatus.toUpperCase()} · {readinessReport.overallScore}/100
						</KodiaBadge>
					</KodiaCard>
					<div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5'>
						{readinessReport.pillars.map(p => (
							<KodiaCard key={p.pillar} className='p-3 space-y-1.5'>
								<div className='flex items-center justify-between'>
									<span className='text-xs font-semibold uppercase text-void-fg-1'>{p.pillar}</span>
									<span className='flex items-center gap-1 text-[11px]'>
										{p.status === 'passed' ? <CheckCircle2 size={12} className='text-emerald-400' /> : p.status === 'failed' ? <XCircle size={12} className='text-rose-400' /> : <AlertTriangle size={12} className='text-amber-400' />}
										<span className='uppercase text-[10px] text-void-fg-2'>{p.status.replace('_', ' ')} ({p.score})</span>
									</span>
								</div>
								{p.evidence.map((e, i) => <div key={i} className='text-[11px] text-emerald-400/90'>• {e}</div>)}
								{p.gaps.map((g, i) => <div key={i} className='text-[11px] text-void-fg-3'>• {g}</div>)}
							</KodiaCard>
						))}
					</div>
				</div>
			) : (
				<KodiaCard className='p-6 text-xs text-void-fg-3'>Click Evaluate Readiness to compute an evidence-backed assessment across all 6 pillars.</KodiaCard>
			)}
		</div>
	);
};

export const RuntimesTopologyView: React.FC<{
	runtimes: readonly ApiManagedRuntimeInfo[];
	mermaidTopology?: string;
	onStartRuntime: (name: string, command: string, port?: number) => void;
	onStopRuntime: (runtimeId: string) => void;
}> = ({ runtimes, mermaidTopology, onStartRuntime, onStopRuntime }) => {
	const [svcName, setSvcName] = useState('local-api');
	const [cmd, setCmd] = useState('npm run dev');
	const [port, setPort] = useState('3000');

	return (
		<div className='p-4 space-y-3 overflow-auto h-full'>
			<KodiaCard className='p-3 space-y-2.5'>
				<div className='flex items-center justify-between'>
					<span className='text-xs font-semibold text-void-fg-1 flex items-center gap-1.5'>
						<Server size={14} style={{ color: 'var(--kodia-accent)' }} /> Multi-Service API Runtime Manager
					</span>
				</div>
				<div className='grid grid-cols-1 md:grid-cols-4 gap-2'>
					<input value={svcName} onChange={e => setSvcName(e.target.value)} placeholder='Service name' className='px-2 py-1 text-xs rounded bg-void-bg-1 border border-void-border-2 text-void-fg-1' />
					<input value={cmd} onChange={e => setCmd(e.target.value)} placeholder='Start command (e.g. node server.js)' className='px-2 py-1 text-xs rounded bg-void-bg-1 border border-void-border-2 text-void-fg-1 font-mono md:col-span-2' />
					<div className='flex gap-1.5'>
						<input value={port} onChange={e => setPort(e.target.value)} placeholder='Port' className='px-2 py-1 text-xs rounded bg-void-bg-1 border border-void-border-2 text-void-fg-1 w-20 font-mono' />
						<KodiaPrimaryButton onClick={() => onStartRuntime(svcName.trim() || 'api', cmd.trim(), Number(port) || undefined)} className='flex-1 justify-center'>
							<Play size={11} /> Start
						</KodiaPrimaryButton>
					</div>
				</div>
			</KodiaCard>

			<div className='space-y-2'>
				{runtimes.length === 0 ? (
					<KodiaCard className='p-4 text-xs text-void-fg-3'>No managed API services started in this session.</KodiaCard>
				) : runtimes.map(rt => (
					<KodiaCard key={rt.runtimeId} className='p-3 space-y-2'>
						<div className='flex items-center justify-between gap-2'>
							<div className='flex items-center gap-2 text-xs'>
								<span className='font-semibold text-void-fg-1'>{rt.name}</span>
								<KodiaBadge tone={rt.status === 'ready' ? 'success' : rt.status === 'failed' ? 'danger' : 'neutral'}>{rt.status}</KodiaBadge>
								{rt.baseUrl && <span className='font-mono text-[11px] text-sky-400'>{rt.baseUrl}</span>}
								{rt.pid && <span className='text-[10px] text-void-fg-3'>PID {rt.pid}</span>}
							</div>
							{(rt.status === 'ready' || rt.status === 'starting') && (
								<KodiaSecondaryButton onClick={() => onStopRuntime(rt.runtimeId)} className='!py-0.5 !px-2 !text-[10px]'>
									<Square size={10} /> Stop
								</KodiaSecondaryButton>
							)}
						</div>
						{rt.recentLogs.length > 0 && (
							<pre className='text-[10px] font-mono bg-void-bg-1 border border-void-border-2 rounded p-2 max-h-36 overflow-auto text-void-fg-2 whitespace-pre-wrap'>
								{rt.recentLogs.slice(-25).join('\n')}
							</pre>
						)}
					</KodiaCard>
				))}
			</div>

			{mermaidTopology && (
				<KodiaCard className='p-3 space-y-1.5'>
					<div className='text-xs font-semibold text-void-fg-1'>Discovered Service & Dependency Topology (Mermaid)</div>
					<pre className='text-[11px] font-mono bg-void-bg-1 border border-void-border-2 rounded p-2.5 overflow-auto text-void-fg-2'>{mermaidTopology}</pre>
				</KodiaCard>
			)}
		</div>
	);
};
