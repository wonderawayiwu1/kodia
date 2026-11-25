/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
	computeNextCronRun,
	cronMatchesDate,
	DynamicSubagentRegistry,
	KodiaTaskScheduler,
	sanitizeArtifactFilename,
	validateCronExpression,
} from '../../common/antigravityEngines.js';
import {
	analyzeGitDiffForBugs,
	extractCodeItem,
	extractCodeOutline,
	formatScopedRuleMarkdown,
	parseScopedRuleFile,
	sanitizeWorkspaceDocName,
} from '../../common/cursorAntigravityEngines.js';
import { BUILTIN_SLASH_COMMANDS } from '../../common/customCommands.js';
import { KodiaBrowserMainService } from '../../electron-main/browserMainService.js';

suite('Kodia - Antigravity Engines (Scheduler, Dynamic Subagents, Artifacts & Browser+)', function () {
	this.timeout(60_000);

	test('validates 5-field cron expressions, matches dates, and computes next run', () => {
		assert.strictEqual(validateCronExpression('*/5 * * * *').valid, true);
		assert.strictEqual(validateCronExpression('0 9 * * 1-5').valid, true);
		assert.strictEqual(validateCronExpression('bad cron').valid, false);

		const wed9am = new Date(2026, 10, 25, 9, 0, 0); // Wed Nov 25 2026 09:00
		assert.strictEqual(cronMatchesDate('0 9 * * 1-5', wed9am), true);
		assert.strictEqual(cronMatchesDate('15 9 * * 1-5', wed9am), false);
		assert.strictEqual(cronMatchesDate('*/5 * * * *', wed9am), true);

		const next = computeNextCronRun('*/10 * * * *', new Date(2026, 10, 25, 9, 3, 0));
		assert.ok(next, 'should compute next run');
		assert.strictEqual(next!.getMinutes(), 10);
	});

	test('KodiaTaskScheduler fires one-shot timers and supports pause/resume/cancel', async () => {
		const fired: string[] = [];
		const scheduler = new KodiaTaskScheduler((task) => {
			fired.push(task.id);
		});
		try {
			const t1 = scheduler.schedule({ threadId: 't1', prompt: 'Quick check', durationSeconds: 1 });
			assert.strictEqual(t1.kind, 'timer');
			assert.strictEqual(t1.status, 'active');

			const cronTask = scheduler.schedule({ threadId: 't1', prompt: 'Hourly check', cronExpression: '0 * * * *' });
			assert.strictEqual(scheduler.pause(cronTask.id)?.status, 'paused');
			assert.strictEqual(scheduler.resume(cronTask.id)?.status, 'active');
			assert.strictEqual(scheduler.cancel(cronTask.id), true);
			assert.strictEqual(scheduler.get(cronTask.id)?.status, 'cancelled');

			await new Promise(r => setTimeout(r, 1250));
			assert.ok(fired.includes(t1.id), 'timer should have triggered callback');
			assert.strictEqual(scheduler.get(t1.id)?.status, 'completed');
		} finally {
			scheduler.dispose();
		}
	});

	test('DynamicSubagentRegistry defines custom agents and serializes .kodia/agents markdown', () => {
		const reg = new DynamicSubagentRegistry();
		const def = reg.define({
			name: 'Billing Auditor!',
			description: 'Audits Stripe billing flows',
			systemPrompt: 'Verify idempotency keys and webhook signatures.',
			canChangeFiles: false,
			allowedTools: ['read_file', 'search_for_files'],
		});
		assert.strictEqual(def.name, 'billing_auditor_');
		assert.strictEqual(reg.toProfile('billing_auditor_')?.canChangeFiles, false);
		const md = reg.toAgentMarkdown(def);
		assert.ok(md.includes('name: billing_auditor_'));
		assert.ok(md.includes('tools: read_file, search_for_files'));
		assert.ok(md.includes('Verify idempotency keys'));
	});

	test('sanitizeArtifactFilename prevents path traversal and ensures .md extension', () => {
		assert.strictEqual(sanitizeArtifactFilename('../evil/plan'), 'plan.md');
		assert.strictEqual(sanitizeArtifactFilename('implementation_plan.md'), 'implementation_plan.md');
		assert.strictEqual(sanitizeArtifactFilename('My Report!'), 'My_Report.md');
	});

	test('Cursor + Antigravity engines: code outline, view_code_item, BugBot diff review, scoped .mdc/.md rules & 14 built-in slash commands', () => {
		const sampleTs = [
			'export interface User { id: string; }',
			'export class AuthService {',
			'  async login(email: string) {',
			'    return email.trim();',
			'  }',
			'}',
			'export function helperFn() { return 42; }',
		].join('\n');
		const outline = extractCodeOutline(sampleTs, 'auth.ts');
		assert.ok(outline.some(i => i.kind === 'interface' && i.name === 'User'));
		assert.ok(outline.some(i => i.kind === 'class' && i.name === 'AuthService'));
		assert.ok(outline.some(i => i.kind === 'method' && i.container === 'AuthService' && i.name === 'login'));
		assert.ok(outline.some(i => i.kind === 'function' && i.name === 'helperFn'));

		const item = extractCodeItem(sampleTs, 'AuthService.login', 'auth.ts');
		assert.ok(item && item.code.includes('return email.trim()'));

		const riskyDiff = [
			'+++ b/src/api.ts',
			'@@ -1,2 +1,5 @@',
			'+const key = "sk-1234567890abcdefghijklmnop";',
			'+const sql = `SELECT * FROM users WHERE id = ${userId}`;',
			'+try { run(); } catch {}',
		].join('\n');
		const review = analyzeGitDiffForBugs(riskyDiff, 'unstaged');
		assert.strictEqual(review.verdict, 'request_changes');
		assert.ok(review.findings.some(f => f.severity === 'critical' && f.category === 'security'));
		assert.ok(review.findings.some(f => f.category === 'bug' && f.message.includes('Empty catch')));

		const formattedRule = formatScopedRuleMarkdown({ description: 'React rules', globs: ['**/*.tsx'], alwaysApply: true, body: 'Prefer functional components.' });
		const parsedRule = parseScopedRuleFile('react', '.cursor/rules/react.mdc', 'cursor', formattedRule);
		assert.deepStrictEqual(parsedRule.globs, ['**/*.tsx']);
		assert.strictEqual(parsedRule.alwaysApply, true);
		assert.strictEqual(sanitizeWorkspaceDocName('../my-notes'), 'my-notes.md');

		assert.ok(BUILTIN_SLASH_COMMANDS.length >= 14);
		for (const expected of ['plan', 'goal', 'boost', 'grill-me', 'teamwork', 'browser', 'review', 'fix', 'test', 'ui', 'schedule', 'learn', 'docs', 'compact']) {
			assert.ok(BUILTIN_SLASH_COMMANDS.some(c => c.name === expected), `expected built-in /${expected}`);
		}
	});

	test('Antigravity+ Browser Engine supports annotated screenshots, @index targeting, hover, type, keys, scroll, ARIA tree, evaluate, dialogs, storage & upload', async () => {
		const browser = new KodiaBrowserMainService();
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kodia-ag-browser-'));
		const uploadFixture = path.join(tempDir, 'sample.txt');
		fs.writeFileSync(uploadFixture, 'hello kodia upload');
		const htmlPath = path.join(tempDir, 'app.html');
		fs.writeFileSync(htmlPath, `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Antigravity Browser+ Test</title></head>
<body style="margin:0;height:2400px;font-family:sans-serif">
	<header><nav aria-label="Main Nav"><a href="#top" id="nav-home">Home</a></nav></header>
	<main>
		<h1>Interactive Playground</h1>
		<button id="hover-btn" onmouseenter="document.getElementById('status').textContent='hovered'">Hover Me</button>
		<input id="search-input" type="text" placeholder="Search..." onkeydown="if(event.key==='Enter'){document.getElementById('status').textContent='searched:'+this.value}" />
		<button id="alert-btn" onclick="window.prompt('Enter code'); document.getElementById('status').textContent='dialog-done'">Trigger Dialog</button>
		<input id="file-input" type="file" onchange="document.getElementById('status').textContent='uploaded:'+this.files[0].name" />
		<div id="status">ready</div>
	</main>
</body>
</html>`);
		const fileUrl = `file:///${path.resolve(htmlPath).replace(/\\/g, '/')}`;

		try {
			const launched = await browser.launchBrowser({ headless: true });
			const tab = await browser.newTab(launched.sessionId, { url: fileUrl });

			// 1. Annotated visual screenshot with numbered element map
			const shot = await browser.takeScreenshot(launched.sessionId, tab.tabId, { type: 'viewport', annotated: true });
			assert.ok(shot.annotatedElements && shot.annotatedElements.length >= 4, 'expected annotated element map');
			const hoverRef = shot.annotatedElements!.find(e => e.selector === '#hover-btn');
			assert.ok(hoverRef, 'expected #hover-btn in annotated elements');
			fs.rmSync(shot.path, { force: true });

			// 2. Hover via "@index" shortcut from annotated screenshot
			await browser.hoverElement(launched.sessionId, tab.tabId, `@${hoverRef!.index}`);
			const hoveredVal = await browser.evaluateScript(launched.sessionId, tab.tabId, `document.getElementById('status').textContent`);
			assert.strictEqual(hoveredVal.value, 'hovered');

			// 3. Type text key-by-key + press Enter + waitForText
			await browser.typeText(launched.sessionId, tab.tabId, { selector: '#search-input', text: 'nemotron', pressEnter: true });
			const waited = await browser.waitForText(launched.sessionId, tab.tabId, 'searched:nemotron', { timeoutMs: 5000 });
			assert.strictEqual(waited.matched, true);

			// 4. Scroll page down & back to top
			const scrolledDown = await browser.scrollPage(launched.sessionId, tab.tabId, { direction: 'down', amount: 500 });
			assert.ok(scrolledDown.scrollY >= 400, `expected scrollY >= 400, got ${scrolledDown.scrollY}`);
			const scrolledTop = await browser.scrollPage(launched.sessionId, tab.tabId, { direction: 'top' });
			assert.strictEqual(scrolledTop.scrollY, 0);

			// 5. Accessibility / ARIA snapshot
			const aria = await browser.getAccessibilitySnapshot(launched.sessionId, tab.tabId);
			assert.ok(aria.landmarks.some(l => l.role === 'main'), 'expected main landmark');
			assert.ok(aria.landmarks.some(l => l.role === 'navigation'), 'expected navigation landmark');
			assert.ok(aria.nodes.some(n => n.role === 'heading' && n.name.includes('Interactive Playground')));

			// 6. Auto dialog handling (never hangs!)
			await browser.handleDialog(launched.sessionId, tab.tabId, { action: 'accept', promptText: '4242' });
			await browser.clickElement(launched.sessionId, tab.tabId, '#alert-btn');
			const dialogInfo = await browser.handleDialog(launched.sessionId, tab.tabId, { action: 'accept' });
			assert.ok(dialogInfo.recentDialogs.some(d => d.type === 'prompt' && d.message === 'Enter code' && d.actionTaken === 'accepted'));

			// 7. File upload
			const up = await browser.uploadFile(launched.sessionId, tab.tabId, '#file-input', [uploadFixture]);
			assert.strictEqual(up.uploaded.length, 1);
			const upStatus = await browser.evaluateScript(launched.sessionId, tab.tabId, `document.getElementById('status').textContent`);
			assert.strictEqual(upStatus.value, 'uploaded:sample.txt');

			// 8. Browser storage inspection + secret redaction
			await browser.inspectStorage(launched.sessionId, tab.tabId, { action: 'set_local', key: 'theme', value: 'dark' });
			await browser.inspectStorage(launched.sessionId, tab.tabId, { action: 'set_local', key: 'auth_token', value: 'super-secret-value' });
			const stored = await browser.inspectStorage(launched.sessionId, tab.tabId, { action: 'read' });
			assert.strictEqual(stored.localStorage.theme, 'dark');
			assert.ok(stored.localStorage.auth_token.startsWith('[REDACTED'), 'sensitive keys must be redacted');
		} finally {
			await browser.shutdown();
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});
});
