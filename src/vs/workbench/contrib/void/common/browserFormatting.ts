/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { BrowserAccessibilitySnapshot, BrowserInspectResult, BrowserTabResult, NetworkLogEntry } from './browserServiceTypes.js';

const MAX_TEXT_CHARS = 3000;
const MAX_LISTED_ELEMENTS = 60;

/** "url — title", plus the HTTP status / load error when the page did not load cleanly. */
export function formatBrowserPage(result: Pick<BrowserTabResult, 'url' | 'title' | 'status' | 'loadError'>): string {
	const problem = result.loadError ? ` [LOAD ERROR: ${result.loadError}]` : '';
	return `${result.url} — ${result.title || '(no title)'}${result.status !== undefined ? ` (HTTP ${result.status})` : ''}${problem}`;
}

/**
 * What the model reads after browser_inspect_page. Problems come first (load errors, layout defects, console
 * errors, failed requests) because they are what a browser-driven repair acts on; then text, controls and forms.
 */
export function formatBrowserInspection(result: BrowserInspectResult): string {
	const lines: string[] = [];
	lines.push(`Page: ${formatBrowserPage(result)}`);
	if (result.viewport) { lines.push(`Viewport: ${result.viewport.width}x${result.viewport.height}`); }

	const issues = result.layoutIssues ?? [];
	if (issues.length > 0) {
		lines.push(`\nLAYOUT PROBLEMS (${issues.length}, measured on the rendered page):`);
		for (const i of issues) { lines.push(`  [${i.kind}] ${i.selector} — ${i.detail}`); }
	} else {
		lines.push('\nLayout problems: none detected (no horizontal overflow, covered or off-screen controls, or clipped text).');
	}
	if (result.consoleErrors > 0) {
		lines.push(`\nCONSOLE ERRORS (${result.consoleErrors}):`);
		for (const e of result.recentConsoleErrors ?? []) { lines.push(`  ${e}`); }
	}
	if (result.networkFailures > 0) {
		lines.push(`\nFAILED REQUESTS (${result.networkFailures}):`);
		for (const f of result.recentNetworkFailures ?? []) { lines.push(`  ${f}`); }
	}

	lines.push(`\nVisible text:\n${result.text.slice(0, MAX_TEXT_CHARS)}${result.text.length > MAX_TEXT_CHARS ? '...' : ''}`);

	if (result.elements.length > 0) {
		// controls a user can see first; hidden ones are still listed (marked) because they may be the bug
		const ordered = [...result.elements.filter(e => e.visible), ...result.elements.filter(e => !e.visible)];
		lines.push('\nInteractive elements (each selector matches exactly one element):');
		for (const e of ordered.slice(0, MAX_LISTED_ELEMENTS)) {
			const flags = [
				e.disabled ? 'disabled' : '',
				!e.visible ? 'HIDDEN' : !e.inViewport ? 'outside viewport' : '',
				e.checked !== undefined ? (e.checked ? 'checked' : 'unchecked') : '',
			].filter(Boolean);
			const opts = e.options && e.options.length > 0 ? ` options=[${e.options.join(', ')}]` : '';
			lines.push(`  [${e.type}] ${e.selector} — ${e.label || '(no label)'}${flags.length ? ` (${flags.join(', ')})` : ''}${opts}${e.value !== undefined ? ` value="${e.value}"` : ''}`);
		}
		const total = Math.max(result.totalElements ?? 0, result.elements.length);
		if (total > MAX_LISTED_ELEMENTS) { lines.push(`  ... and ${total - MAX_LISTED_ELEMENTS} more elements`); }
	} else {
		lines.push('\nInteractive elements: none.');
	}
	if (result.forms.length > 0) {
		lines.push('\nForms:');
		for (const f of result.forms) { lines.push(`  form ${f.selector} action="${f.action ?? ''}" method="${f.method ?? ''}"`); }
	}
	return lines.join('\n');
}

export function formatAccessibilitySnapshot(snap: BrowserAccessibilitySnapshot): string {
	const lines: string[] = [
		`Accessibility Snapshot: ${snap.url} — ${snap.title || '(no title)'}`,
		`Summary: ${snap.summary}`,
	];
	if (snap.focusedElement) {
		lines.push(`Focused: [${snap.focusedElement.role}] "${snap.focusedElement.name}" (${snap.focusedElement.selector ?? ''})`);
	}
	if (snap.landmarks.length > 0) {
		lines.push('\nLandmarks:');
		for (const l of snap.landmarks.slice(0, 20)) {
			lines.push(`  [${l.role}] ${l.selector} — "${l.label}"`);
		}
	}
	if (snap.nodes.length > 0) {
		lines.push('\nSemantic Nodes:');
		for (const n of snap.nodes.slice(0, 120)) {
			const attrs = [
				n.level ? `level=${n.level}` : '',
				n.checked !== undefined ? `checked=${n.checked}` : '',
				n.expanded !== undefined ? `expanded=${n.expanded}` : '',
				n.disabled ? 'disabled' : '',
				n.focused ? 'FOCUSED' : '',
				n.value !== undefined ? `value="${n.value}"` : '',
			].filter(Boolean);
			lines.push(`  [${n.role}] ${n.selector ?? ''} "${n.name}"${attrs.length ? ` (${attrs.join(', ')})` : ''}`);
		}
	}
	return lines.join('\n');
}

export function formatNetworkLog(entries: NetworkLogEntry[]): string {
	if (entries.length === 0) return 'No network requests recorded for this tab.';
	const lines = [`Network log (${entries.length} request${entries.length === 1 ? '' : 's'}):`];
	for (const e of entries) {
		const statusStr = e.status !== undefined ? `${e.status}` : (e.errorText ?? 'FAILED');
		const dur = e.durationMs !== undefined ? ` ${e.durationMs}ms` : '';
		const ct = e.contentType ? ` [${e.contentType}]` : '';
		lines.push(`  ${e.method} ${statusStr}${dur} (${e.resourceType})${ct} ${e.url}`);
	}
	return lines.join('\n');
}
