/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useMemo, useState } from 'react';
import {
	KacraeAttackPath,
	KacraeBlastRadiusReport,
	KacraeRepoGraph,
	KacraeRepoGraphNode,
	KacraeReviewSession,
} from '../../../../common/kacraeTypes.js';

const LAYER_COLORS: Record<KacraeRepoGraphNode['layer'], string> = {
	frontend: '#3b82f6',
	api: '#8b5cf6',
	backend: '#10b981',
	auth: '#ef4444',
	data: '#f59e0b',
	infra: '#64748b',
	test: '#06b6d4',
	shared: '#94a3b8',
};

export const DependencyGraphCanvas: React.FC<{
	graph: KacraeRepoGraph;
	blastRadius?: KacraeBlastRadiusReport | null;
	onOpenFile: (file: string) => void;
	onQueryBlastRadius: (file: string) => void;
}> = ({ graph, blastRadius, onOpenFile, onQueryBlastRadius }) => {
	const [zoom, setZoom] = useState(1);
	const [pan, setPan] = useState({ x: 0, y: 0 });
	const [dragging, setDragging] = useState<{ x: number; y: number } | null>(null);
	const [search, setSearch] = useState('');
	const [layerFilter, setLayerFilter] = useState<string>('all');
	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

	const filteredNodes = useMemo(() => {
		const q = search.trim().toLowerCase();
		return graph.nodes
			.filter(n => (layerFilter === 'all' || n.layer === layerFilter) && (!q || n.id.toLowerCase().includes(q) || n.exportedSymbols.some(s => s.toLowerCase().includes(q))))
			.slice(0, 90);
	}, [graph.nodes, layerFilter, search]);

	const visibleIds = useMemo(() => new Set(filteredNodes.map(n => n.id)), [filteredNodes]);
	const filteredEdges = useMemo(() => graph.edges.filter(e => visibleIds.has(e.from) && visibleIds.has(e.to)).slice(0, 260), [graph.edges, visibleIds]);

	const positions = useMemo(() => {
		const map = new Map<string, { x: number; y: number }>();
		const layerOrder: KacraeRepoGraphNode['layer'][] = ['frontend', 'api', 'auth', 'backend', 'data', 'shared', 'infra', 'test'];
		const grouped = new Map<string, KacraeRepoGraphNode[]>();
		for (const l of layerOrder) { grouped.set(l, []); }
		for (const n of filteredNodes) {
			(grouped.get(n.layer) ?? grouped.get('shared')!).push(n);
		}
		let colIdx = 0;
		for (const l of layerOrder) {
			const bucket = grouped.get(l) ?? [];
			if (!bucket.length) { continue; }
			const x = 90 + colIdx * 155;
			bucket.forEach((n, idx) => {
				map.set(n.id, { x, y: 55 + idx * 54 });
			});
			colIdx++;
		}
		return map;
	}, [filteredNodes]);

	const blastSet = useMemo(() => {
		const s = new Set<string>();
		if (blastRadius?.found) {
			s.add(blastRadius.target);
			blastRadius.directlyAffectedFiles.forEach(f => s.add(f));
			blastRadius.indirectlyAffectedFiles.forEach(f => s.add(f));
		}
		return s;
	}, [blastRadius]);

	const selectedNode = filteredNodes.find(n => n.id === selectedNodeId) ?? null;

	return (
		<div className='flex flex-col gap-2'>
			<div className='flex flex-wrap items-center gap-2 text-xs'>
				<input
					type='text'
					value={search}
					onChange={e => setSearch(e.target.value)}
					placeholder='Filter nodes or symbols...'
					className='px-2 py-1 rounded bg-void-bg-1 border border-void-border-2 text-void-fg-1 text-xs w-48'
				/>
				<select
					value={layerFilter}
					onChange={e => setLayerFilter(e.target.value)}
					className='px-2 py-1 rounded bg-void-bg-1 border border-void-border-2 text-void-fg-1 text-xs'
				>
					<option value='all'>All layers ({graph.nodes.length})</option>
					{Object.keys(LAYER_COLORS).map(l => (
						<option key={l} value={l}>{l}</option>
					))}
				</select>
				<button onClick={() => setZoom(z => Math.min(2.2, Number((z + 0.2).toFixed(2))))} className='px-2 py-1 rounded bg-void-bg-2 border border-void-border-2 text-void-fg-1'>+</button>
				<button onClick={() => setZoom(z => Math.max(0.4, Number((z - 0.2).toFixed(2))))} className='px-2 py-1 rounded bg-void-bg-2 border border-void-border-2 text-void-fg-1'>-</button>
				<button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} className='px-2 py-1 rounded bg-void-bg-2 border border-void-border-2 text-void-fg-1'>Reset</button>
				<span className='text-void-fg-3 ml-auto'>
					Showing {filteredNodes.length} of {graph.totalNodeCount} nodes · {filteredEdges.length} of {graph.totalEdgeCount} edges
					{graph.truncatedForRender ? ' (progressive cap active)' : ''}
				</span>
			</div>

			<div
				className='relative rounded-md border border-void-border-2 bg-void-bg-1 overflow-hidden select-none'
				style={{ height: 340, cursor: dragging ? 'grabbing' : 'grab' }}
				onMouseDown={e => setDragging({ x: e.clientX - pan.x, y: e.clientY - pan.y })}
				onMouseMove={e => { if (dragging) { setPan({ x: e.clientX - dragging.x, y: e.clientY - dragging.y }); } }}
				onMouseUp={() => setDragging(null)}
				onMouseLeave={() => setDragging(null)}
			>
				<svg width='100%' height='100%'>
					<g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
						{filteredEdges.map((e, idx) => {
							const a = positions.get(e.from);
							const b = positions.get(e.to);
							if (!a || !b) { return null; }
							const highlighted = selectedNodeId === e.from || selectedNodeId === e.to || (blastSet.has(e.from) && blastSet.has(e.to));
							return (
								<line
									key={`${e.from}-${e.to}-${idx}`}
									x1={a.x}
									y1={a.y}
									x2={b.x}
									y2={b.y}
									stroke={highlighted ? '#f97316' : 'rgba(148,163,184,0.35)'}
									strokeWidth={highlighted ? 1.8 : 1}
								/>
							);
						})}
						{filteredNodes.map(n => {
							const pos = positions.get(n.id);
							if (!pos) { return null; }
							const isSelected = n.id === selectedNodeId;
							const inBlast = blastSet.has(n.id);
							const fill = LAYER_COLORS[n.layer] ?? '#94a3b8';
							return (
								<g
									key={n.id}
									transform={`translate(${pos.x}, ${pos.y})`}
									style={{ cursor: 'pointer' }}
									onClick={ev => { ev.stopPropagation(); setSelectedNodeId(n.id); }}
									onDoubleClick={ev => { ev.stopPropagation(); onOpenFile(n.id); }}
								>
									<rect
										x={-58}
										y={-14}
										width={116}
										height={28}
										rx={5}
										fill='var(--vscode-editor-background)'
										stroke={isSelected ? '#38bdf8' : inBlast ? '#ef4444' : fill}
										strokeWidth={isSelected || inBlast ? 2.2 : 1.2}
									/>
									<circle cx={-48} cy={0} r={4} fill={fill} />
									<text x={-38} y={3} fontSize={10} fill='var(--vscode-foreground)'>
										{n.label.slice(0, 14)}
									</text>
								</g>
							);
						})}
					</g>
				</svg>
			</div>

			{selectedNode && (
				<div className='p-2.5 rounded-md border border-void-border-2 bg-void-bg-2 text-xs flex flex-wrap items-center justify-between gap-2'>
					<div>
						<div className='font-semibold text-void-fg-1'>{selectedNode.id}</div>
						<div className='text-void-fg-3'>
							Layer: {selectedNode.layer} · {selectedNode.language} · {selectedNode.lines} lines · Imports: {selectedNode.imports.length} · Imported by: {selectedNode.importedBy.length} · Instability: {selectedNode.couplingInstability}
						</div>
					</div>
					<div className='flex gap-2'>
						<button onClick={() => onQueryBlastRadius(selectedNode.id)} className='px-2 py-1 rounded bg-void-bg-1 border border-void-border-2 text-void-fg-1'>
							Compute Blast Radius
						</button>
						<button onClick={() => onOpenFile(selectedNode.id)} className='px-2 py-1 rounded bg-void-bg-1 border border-void-border-2 text-void-fg-1'>
							Open Source File
						</button>
					</div>
				</div>
			)}
		</div>
	);
};

export const AttackPathVisualizer: React.FC<{
	paths: readonly KacraeAttackPath[];
	onOpenFile: (file: string, line?: number) => void;
}> = ({ paths, onOpenFile }) => {
	if (!paths.length) {
		return <div className='text-xs text-void-fg-3 py-3'>No attack paths identified in the current review session.</div>;
	}
	return (
		<div className='flex flex-col gap-3'>
			{paths.map(ap => (
				<div key={ap.id} className='p-3 rounded-md border border-void-border-2 bg-void-bg-1'>
					<div className='flex items-center justify-between gap-2 mb-2'>
						<span className='text-xs font-semibold text-void-fg-1'>{ap.title}</span>
						<span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${ap.confirmed ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'}`}>
							{ap.confirmed ? 'CONFIRMED PATH' : 'THEORETICAL PATH'} · {ap.severity.toUpperCase()}
						</span>
					</div>
					<div className='flex flex-wrap items-center gap-2'>
						{ap.steps.map((st, idx) => (
							<React.Fragment key={`${ap.id}-${idx}`}>
								<button
									onClick={() => onOpenFile(st.file, st.line)}
									className={`text-left px-2.5 py-1.5 rounded border text-xs ${st.present ? 'border-void-border-2 bg-void-bg-2' : 'border-red-500/60 bg-red-500/10'}`}
								>
									<div className='font-medium text-void-fg-1'>{st.label}</div>
									<div className='text-[10px] text-void-fg-3'>{st.file}:{st.line}</div>
									<div className='text-[10px] text-void-fg-2 max-w-[200px] truncate'>{st.detail}</div>
								</button>
								{idx < ap.steps.length - 1 && <span className='text-void-fg-3 text-xs'>→</span>}
							</React.Fragment>
						))}
					</div>
				</div>
			))}
		</div>
	);
};

export const QualityTrendChart: React.FC<{ sessions: readonly KacraeReviewSession[] }> = ({ sessions }) => {
	const points = useMemo(() => [...sessions].slice(0, 12).reverse(), [sessions]);
	if (points.length === 0) {
		return <div className='text-xs text-void-fg-3'>Run at least one review session to populate quality trend measurements.</div>;
	}
	const w = 480;
	const h = 110;
	const stepX = points.length > 1 ? (w - 40) / (points.length - 1) : 0;
	const scorePath = points.map((s, i) => `${i === 0 ? 'M' : 'L'} ${20 + i * stepX} ${h - 16 - (s.healthScore.score / 100) * (h - 32)}`).join(' ');

	return (
		<div className='rounded-md border border-void-border-2 bg-void-bg-1 p-2'>
			<div className='text-[11px] font-medium text-void-fg-2 mb-1'>Documented Health Score Trend ({points.length} session{points.length === 1 ? '' : 's'})</div>
			<svg viewBox={`0 0 ${w} ${h}`} className='w-full' style={{ height: 110 }}>
				<line x1={20} y1={h - 16} x2={w - 20} y2={h - 16} stroke='rgba(148,163,184,0.25)' />
				<line x1={20} y1={16} x2={w - 20} y2={16} stroke='rgba(148,163,184,0.15)' strokeDasharray='3 3' />
				{points.length > 1 && <path d={scorePath} fill='none' stroke='#3b82f6' strokeWidth={2} />}
				{points.map((s, i) => {
					const cx = 20 + i * stepX;
					const cy = h - 16 - (s.healthScore.score / 100) * (h - 32);
					return (
						<g key={s.id}>
							<circle cx={cx} cy={cy} r={3.5} fill='#3b82f6' />
							<text x={cx} y={cy - 6} textAnchor='middle' fontSize={9} fill='var(--vscode-foreground)'>{s.healthScore.score}</text>
						</g>
					);
				})}
			</svg>
		</div>
	);
};

