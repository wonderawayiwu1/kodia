/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Search } from 'lucide-react';
import { queryJsonPath } from '../../../../common/apiStudioIntelligence.js';

interface JsonTreeProps {
	rawBody: string;
}

const JsonNode: React.FC<{
	keyName?: string;
	value: unknown;
	path: string;
	depth: number;
	defaultExpanded: boolean;
	searchTerm: string;
	onCopy: (text: string) => void;
}> = ({ keyName, value, path, depth, defaultExpanded, searchTerm, onCopy }) => {
	const [expanded, setExpanded] = useState(defaultExpanded || depth < 2);
	const isObj = value !== null && typeof value === 'object';
	const isArr = Array.isArray(value);
	const entries = isObj ? (isArr ? (value as unknown[]).map((v, i) => [String(i), v] as const) : Object.entries(value as Record<string, unknown>)) : [];

	const matchesSearch = searchTerm.trim().length > 0 && (
		(keyName && keyName.toLowerCase().includes(searchTerm.toLowerCase()))
		|| (!isObj && String(value).toLowerCase().includes(searchTerm.toLowerCase()))
	);

	const valueColor =
		value === null ? 'text-void-fg-3 italic'
			: typeof value === 'string' ? 'text-emerald-400'
				: typeof value === 'number' ? 'text-amber-400'
					: typeof value === 'boolean' ? 'text-sky-400'
						: 'text-void-fg-1';

	const typeTag = isArr ? `array[${entries.length}]` : value === null ? 'null' : typeof value;

	return (
		<div className='font-mono text-[11px] leading-5'>
			<div
				className={`group flex items-center gap-1.5 px-1.5 py-0.5 rounded hover:bg-void-bg-3/70 ${matchesSearch ? 'bg-amber-500/15' : ''}`}
				style={{ paddingLeft: `${depth * 14 + 4}px` }}
			>
				{isObj ? (
					<button type='button' onClick={() => setExpanded(e => !e)} className='text-void-fg-3 hover:text-void-fg-1 cursor-pointer'>
						{expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
					</button>
				) : (
					<span className='w-3 inline-block' />
				)}
				{keyName !== undefined && (
					<span className='text-sky-300 font-medium'>{keyName}:</span>
				)}
				{isObj ? (
					<span className='text-void-fg-3 text-[10px]'>
						{isArr ? `[${entries.length}]` : `{${entries.length}}`}
					</span>
				) : (
					<span className={`${valueColor} break-all`}>
						{typeof value === 'string' ? `"${value.slice(0, 240)}${value.length > 240 ? '...' : ''}"` : String(value)}
					</span>
				)}
				<span className='text-[9px] text-void-fg-3/70 ml-1'>{typeTag}</span>
				<span className='ml-auto opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity'>
					<button
						type='button'
						title={`Copy JSONPath: ${path}`}
						onClick={() => onCopy(path)}
						className='px-1 py-0.5 rounded text-[9px] bg-void-bg-1 border border-void-border-2 text-void-fg-2 hover:text-void-fg-1 cursor-pointer'
					>
						Path
					</button>
					<button
						type='button'
						title='Copy value'
						onClick={() => onCopy(typeof value === 'string' ? value : JSON.stringify(value, null, 2))}
						className='px-1 py-0.5 rounded text-[9px] bg-void-bg-1 border border-void-border-2 text-void-fg-2 hover:text-void-fg-1 cursor-pointer flex items-center gap-0.5'
					>
						<Copy size={9} /> Val
					</button>
				</span>
			</div>
			{isObj && expanded && entries.slice(0, 200).map(([k, v]) => (
				<JsonNode
					key={`${path}.${k}`}
					keyName={k}
					value={v}
					path={isArr ? `${path}[${k}]` : `${path}.${k}`}
					depth={depth + 1}
					defaultExpanded={defaultExpanded}
					searchTerm={searchTerm}
					onCopy={onCopy}
				/>
			))}
			{isObj && expanded && entries.length > 200 && (
				<div className='text-[10px] text-void-fg-3 italic py-0.5' style={{ paddingLeft: `${(depth + 1) * 14 + 16}px` }}>
					... {entries.length - 200} additional entries truncated for smooth rendering
				</div>
			)}
		</div>
	);
};

export const ApiStudioJsonTree: React.FC<JsonTreeProps> = ({ rawBody }) => {
	const [searchTerm, setSearchTerm] = useState('');
	const [jsonPathExpr, setJsonPathExpr] = useState('$');
	const [expandAll, setExpandAll] = useState(false);
	const [copiedHint, setCopiedHint] = useState('');

	const parsed = useMemo(() => {
		try {
			return { ok: true as const, data: JSON.parse(rawBody) };
		} catch (e) {
			return { ok: false as const, error: e instanceof Error ? e.message : 'Not valid JSON' };
		}
	}, [rawBody]);

	const pathPreview = useMemo(() => {
		if (!parsed.ok || !jsonPathExpr.trim()) { return null; }
		return queryJsonPath(parsed.data, jsonPathExpr.trim());
	}, [parsed, jsonPathExpr]);

	const handleCopy = (text: string) => {
		try { void navigator.clipboard?.writeText(text); } catch { /* ignore */ }
		setCopiedHint(`Copied ${text.slice(0, 36)}`);
		setTimeout(() => setCopiedHint(''), 1800);
	};

	if (!parsed.ok) {
		return (
			<div className='p-3 text-xs text-void-fg-3'>
				Response body is not valid JSON ({parsed.error}). Switch to Raw or Preview tab.
			</div>
		);
	}

	return (
		<div className='flex flex-col h-full min-h-0'>
			<div className='flex flex-wrap items-center gap-2 px-2.5 py-1.5 border-b border-void-border-2 bg-void-bg-1/50 shrink-0'>
				<div className='flex items-center gap-1 bg-void-bg-1 border border-void-border-2 rounded px-2 py-0.5 flex-1 min-w-[140px]'>
					<Search size={11} className='text-void-fg-3' />
					<input
						value={searchTerm}
						onChange={e => setSearchTerm(e.target.value)}
						placeholder='Filter keys or values...'
						className='bg-transparent text-[11px] text-void-fg-1 outline-none w-full'
					/>
				</div>
				<div className='flex items-center gap-1 bg-void-bg-1 border border-void-border-2 rounded px-2 py-0.5 flex-1 min-w-[160px]'>
					<span className='text-[10px] font-mono text-void-fg-3'>JSONPath:</span>
					<input
						value={jsonPathExpr}
						onChange={e => setJsonPathExpr(e.target.value)}
						placeholder='$.data[0].id'
						className='bg-transparent text-[11px] font-mono text-void-fg-1 outline-none w-full'
					/>
				</div>
				<button
					type='button'
					onClick={() => setExpandAll(e => !e)}
					className='px-2 py-0.5 rounded text-[10px] border border-void-border-2 bg-void-bg-1 text-void-fg-2 hover:text-void-fg-1 cursor-pointer'
				>
					{expandAll ? 'Default Depth' : 'Expand All'}
				</button>
				{copiedHint && <span className='text-[10px] text-emerald-400'>{copiedHint}</span>}
			</div>

			{pathPreview && jsonPathExpr.trim() !== '$' && (
				<div className='px-3 py-1.5 bg-void-bg-3/50 border-b border-void-border-2 text-[11px] font-mono flex items-center justify-between gap-2 shrink-0'>
					<span className='truncate'>
						<span className='text-void-fg-3'>Result: </span>
						{pathPreview.found
							? <span className='text-emerald-400'>{JSON.stringify(pathPreview.value)?.slice(0, 220)}</span>
							: <span className='text-rose-400'>Not found</span>}
					</span>
					{pathPreview.found && (
						<button
							type='button'
							onClick={() => handleCopy(JSON.stringify(pathPreview.value, null, 2))}
							className='px-1.5 py-0.5 rounded text-[10px] bg-void-bg-1 border border-void-border-2 text-void-fg-2 cursor-pointer shrink-0'
						>
							Copy
						</button>
					)}
				</div>
			)}

			<div className='flex-1 overflow-auto p-2' key={expandAll ? 'expanded' : 'collapsed'}>
				<JsonNode value={parsed.data} path='$' depth={0} defaultExpanded={expandAll} searchTerm={searchTerm} onCopy={handleCopy} />
			</div>
		</div>
	);
};
