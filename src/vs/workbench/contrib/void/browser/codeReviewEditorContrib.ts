/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * KACRAE Native Inline Editor Integration & Contextual Commands (Part 4.5 & Part 4.7)
 *
 * Provides:
 *  - Inline Monaco editor decorations (gutter severity markers, range highlights, subtle verification/finding badges)
 *  - Configurable decoration density (off | compact | standard | detailed)
 *  - Rich HoverProvider displaying evidence, classification, confidence, preconditions, and impact
 *  - CodeActionProvider offering quick-fix actions (Explain, Propose Fix, Apply Verified Fix, Suppress with Justification)
 *  - All 18 contextual editor & Command Palette review actions
 *  - Debounced continuous review-on-save listener (opt-in via settings)
 */

import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { Range } from '../../../../editor/common/core/range.js';
import { EditorContextKeys } from '../../../../editor/common/editorContextKeys.js';
import { CodeAction, CodeActionList } from '../../../../editor/common/languages.js';
import { IModelDeltaDecoration, ITextModel, OverviewRulerLane } from '../../../../editor/common/model.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { Action2, MenuId, MenuRegistry, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { KacraeFinding, KacraeReviewDepth, KacraeReviewScope } from '../common/kacraeTypes.js';
import { ICodeReviewService } from './codeReviewService.js';

const KACRAE_EDITOR_SUBMENU_ID = new MenuId('kodia.codeReview.editorContextSubmenu');

MenuRegistry.appendMenuItem(MenuId.EditorContext, {
	submenu: KACRAE_EDITOR_SUBMENU_ID,
	title: 'Kodia Code Review',
	group: '1_modification',
	order: 1,
	when: EditorContextKeys.editorTextFocus,
});

function normalizeFsRel(workspaceRoot: string, fsPath: string): string {
	const normRoot = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '');
	const normFile = fsPath.replace(/\\/g, '/');
	if (normRoot && normFile.toLowerCase().startsWith(normRoot.toLowerCase() + '/')) {
		return normFile.slice(normRoot.length + 1);
	}
	return normFile;
}

function findingsForModel(codeReviewService: ICodeReviewService, model: ITextModel): KacraeFinding[] {
	const root = codeReviewService.getWorkspaceRoot();
	const rel = normalizeFsRel(root, model.uri.fsPath);
	const all = codeReviewService.getActiveFindings();
	return all.filter(f => {
		if (f.lifecycle === 'suppressed' || f.lifecycle === 'false_positive') { return false; }
		const fPath = f.location.file.replace(/\\/g, '/');
		return fPath === rel || rel.endsWith('/' + fPath) || fPath.endsWith('/' + rel);
	});
}

// ============================================================================
// 1. Inline Decorations, HoverProvider & CodeActionProvider Contribution
// ============================================================================

export class CodeReviewEditorContrib extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.kodia.codeReviewEditor';

	private readonly _decorationsByEditor = new WeakMap<ICodeEditor, string[]>();

	constructor(
		@ICodeEditorService private readonly _codeEditorService: ICodeEditorService,
		@ICodeReviewService private readonly _codeReviewService: ICodeReviewService,
		@ILanguageFeaturesService languageFeaturesService: ILanguageFeaturesService,
	) {
		super();

		this._register(this._codeReviewService.onDidChange(() => this._refreshAllEditors()));
		this._register(this._codeEditorService.onCodeEditorAdd(editor => {
			this._applyDecorations(editor);
			this._register(editor.onDidChangeModel(() => this._applyDecorations(editor)));
		}));

		// Hover Provider with Evidence, Classification, Confidence & Impact
		this._register(languageFeaturesService.hoverProvider.register({ pattern: '**' }, {
			provideHover: (model, position) => {
				const density = this._codeReviewService.getSettings().decorationDensity;
				if (density === 'off') { return null; }
				const hits = findingsForModel(this._codeReviewService, model).filter(
					f => position.lineNumber >= f.location.startLine && position.lineNumber <= f.location.endLine,
				);
				if (hits.length === 0) { return null; }

				const contents = hits.slice(0, 4).map(f => {
					const md = new MarkdownString('', { isTrusted: true, supportThemeIcons: true });
					const statusTag = f.lifecycle === 'verified_resolved' ? '$(pass-filled) Verified Resolved' : `${f.severity.toUpperCase()} · ${f.classification.replace(/_/g, ' ')}`;
					md.appendMarkdown(`**Kodia KACRAE [${f.ruleId}]** — ${statusTag} (${Math.round(f.confidence * 100)}% confidence)\n\n`);
					md.appendMarkdown(`**${f.title}**\n\n`);
					md.appendMarkdown(`${f.explanation}\n\n`);
					if (f.whyItMatters) { md.appendMarkdown(`*Why it matters:* ${f.whyItMatters}\n\n`); }
					if (f.evidence.length > 0) { md.appendMarkdown(`*Evidence:* \`${f.evidence[0].slice(0, 140)}\`\n`); }
					return md;
				});

				return {
					range: new Range(hits[0].location.startLine, 1, hits[0].location.endLine, model.getLineMaxColumn(Math.min(hits[0].location.endLine, model.getLineCount()))),
					contents,
				};
			},
		}));

		// Quick-Fix CodeAction Provider
		this._register(languageFeaturesService.codeActionProvider.register({ pattern: '**' }, {
			provideCodeActions: (model, range): CodeActionList => {
				const session = this._codeReviewService.getActiveSession();
				if (!session) { return { actions: [], dispose: () => { } }; }
				const hits = findingsForModel(this._codeReviewService, model).filter(
					f => f.location.startLine <= range.endLineNumber && f.location.endLine >= range.startLineNumber,
				);
				const actions: CodeAction[] = [];
				for (const f of hits.slice(0, 3)) {
					actions.push({
						title: `KACRAE: Inspect "${f.title}" in Workbench`,
						kind: 'quickfix',
						command: {
							id: 'kodia.review.inspectFindingById',
							title: 'Inspect Finding',
							arguments: [f.id],
						},
					});
					if (f.suggestedFix && f.lifecycle !== 'verified_resolved') {
						actions.push({
							title: `KACRAE: Apply & Verify Fix (${f.ruleId})`,
							kind: 'quickfix',
							isPreferred: f.suggestedFix.safeForAutoApply,
							command: {
								id: 'kodia.review.applyFixById',
								title: 'Apply Fix',
								arguments: [session.id, f.id],
							},
						});
					}
					actions.push({
						title: `KACRAE: Suppress Finding (${f.ruleId}) with Justification`,
						kind: 'quickfix',
						command: {
							id: 'kodia.review.suppressFindingById',
							title: 'Suppress Finding',
							arguments: [session.id, f.id],
						},
					});
				}
				return { actions, dispose: () => { } };
			},
		}));

		this._refreshAllEditors();
	}

	private _refreshAllEditors(): void {
		for (const editor of this._codeEditorService.listCodeEditors()) {
			this._applyDecorations(editor);
		}
	}

	private _applyDecorations(editor: ICodeEditor): void {
		const model = editor.getModel();
		const prev = this._decorationsByEditor.get(editor) ?? [];
		const settings = this._codeReviewService.getSettings();
		if (!model || !settings.enabled || settings.decorationDensity === 'off') {
			if (prev.length > 0) {
				editor.deltaDecorations(prev, []);
				this._decorationsByEditor.set(editor, []);
			}
			return;
		}

		const hits = findingsForModel(this._codeReviewService, model);
		const maxLine = model.getLineCount();
		const nextDecs: IModelDeltaDecoration[] = [];

		for (const f of hits.slice(0, 120)) {
			const startLine = Math.max(1, Math.min(maxLine, f.location.startLine));
			const endLine = Math.max(startLine, Math.min(maxLine, f.location.endLine));
			const isResolved = f.lifecycle === 'verified_resolved';
			const sevClass = isResolved ? 'kacrae-resolved' : `kacrae-sev-${f.severity}`;
			const showAfter = settings.decorationDensity === 'detailed' || (settings.decorationDensity === 'standard' && (f.severity === 'critical' || f.severity === 'high' || isResolved));

			nextDecs.push({
				range: new Range(startLine, 1, endLine, model.getLineMaxColumn(endLine)),
				options: {
					description: `kacrae-finding-${f.ruleId}`,
					isWholeLine: true,
					className: `kacrae-inline-line ${sevClass}`,
					glyphMarginClassName: `kacrae-gutter-marker ${sevClass}`,
					overviewRuler: {
						color: isResolved ? '#10b981' : f.severity === 'critical' ? '#ef4444' : f.severity === 'high' ? '#f97316' : '#eab308',
						position: OverviewRulerLane.Right,
					},
					after: showAfter ? {
						content: isResolved ? `  ✓ Verified (${f.ruleId})` : `  ⚑ [${f.severity.toUpperCase()}] ${f.title.slice(0, 56)}`,
						inlineClassName: `kacrae-inline-annotation ${sevClass}`,
					} : undefined,
				},
			});
		}

		const nextIds = editor.deltaDecorations(prev, nextDecs);
		this._decorationsByEditor.set(editor, nextIds);
	}
}

registerWorkbenchContribution2(CodeReviewEditorContrib.ID, CodeReviewEditorContrib, WorkbenchPhase.AfterRestored);

// ============================================================================
// 2. Internal Quick-Fix Helper Commands
// ============================================================================

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'kodia.review.inspectFindingById', title: 'Kodia Review: Inspect Finding' });
	}
	async run(accessor: ServicesAccessor, findingId?: string): Promise<void> {
		const svc = accessor.get(ICodeReviewService);
		if (findingId) { svc.selectFinding(findingId); }
		await svc.openWorkbench('current_review');
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'kodia.review.applyFixById', title: 'Kodia Review: Apply & Verify Fix' });
	}
	async run(accessor: ServicesAccessor, sessionId?: string, findingId?: string): Promise<void> {
		const svc = accessor.get(ICodeReviewService);
		const notif = accessor.get(INotificationService);
		const sid = sessionId ?? svc.getActiveSession()?.id;
		const fid = findingId ?? svc.state.selectedFindingId ?? svc.getActiveFindings()[0]?.id;
		if (!sid || !fid) {
			notif.info('Select a KACRAE finding first to apply a fix.');
			return;
		}
		try {
			const rec = await svc.proposeOrApplyRepair({ sessionId: sid, findingId: fid, dryRun: false });
			notif.info(`KACRAE repair ${rec.status}: ${rec.verification?.outputSnippet ?? rec.file}`);
		} catch (e) {
			notif.error(`KACRAE repair failed: ${e instanceof Error ? e.message : String(e)}`);
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'kodia.review.suppressFindingById', title: 'Kodia Review: Suppress Finding with Justification' });
	}
	async run(accessor: ServicesAccessor, sessionId?: string, findingId?: string): Promise<void> {
		const svc = accessor.get(ICodeReviewService);
		const quickInput = accessor.get(IQuickInputService);
		const notif = accessor.get(INotificationService);
		const sid = sessionId ?? svc.getActiveSession()?.id;
		const fid = findingId ?? svc.state.selectedFindingId;
		if (!sid || !fid) { return; }
		const reason = await quickInput.input({
			title: 'Suppress KACRAE Finding',
			prompt: 'Enter a clear engineering justification for suppressing this finding (recorded in audit trail)',
			placeHolder: 'e.g., Validated by upstream API gateway schema filter',
		});
		if (!reason || !reason.trim()) { return; }
		await svc.updateFindingLifecycle(sid, fid, 'suppressed', reason.trim());
		notif.info('Finding suppressed with recorded audit justification.');
	}
});

// ============================================================================
// 3. All 18 Contextual Editor & Command Palette Actions (Part 4.7)
// ============================================================================

interface ReviewActionDef {
	readonly id: string;
	readonly title: string;
	readonly menuTitle: string;
	readonly order: number;
	readonly scope: KacraeReviewScope;
	readonly depth: KacraeReviewDepth;
	readonly section?: 'current_review' | 'security_intelligence' | 'architecture_intelligence' | 'database_review' | 'api_contract_review' | 'test_intelligence' | 'review_reports';
	readonly requireSelection?: boolean;
	readonly mode?: 'review' | 'investigate' | 'fix' | 'verify' | 'report';
}

const CONTEXTUAL_REVIEW_ACTIONS: readonly ReviewActionDef[] = [
	{ id: 'kodia.review.currentFile', title: 'Kodia Review: Review Current File', menuTitle: 'Review Current File', order: 1, scope: 'current_file', depth: 'standard' },
	{ id: 'kodia.review.selectedCode', title: 'Kodia Review: Review Selected Code', menuTitle: 'Review Selected Code', order: 2, scope: 'selected_code', depth: 'standard', requireSelection: true },
	{ id: 'kodia.review.currentChanges', title: 'Kodia Review: Review Current Changes', menuTitle: 'Review Current Changes', order: 3, scope: 'modified_files', depth: 'standard' },
	{ id: 'kodia.review.stagedChanges', title: 'Kodia Review: Review Staged Changes', menuTitle: 'Review Staged Changes', order: 4, scope: 'git_staged', depth: 'standard' },
	{ id: 'kodia.review.entireProject', title: 'Kodia Review: Review Entire Project', menuTitle: 'Review Entire Project', order: 5, scope: 'entire_project', depth: 'deep' },
	{ id: 'kodia.review.currentFunction', title: 'Kodia Review: Review Current Function', menuTitle: 'Review Current Function', order: 6, scope: 'current_function', depth: 'standard' },
	{ id: 'kodia.review.currentClass', title: 'Kodia Review: Review Current Class', menuTitle: 'Review Current Class', order: 7, scope: 'current_class', depth: 'standard' },
	{ id: 'kodia.review.apiEndpoint', title: 'Kodia Review: Review API Endpoint', menuTitle: 'Review API Endpoint', order: 8, scope: 'current_file', depth: 'standard', section: 'api_contract_review' },
	{ id: 'kodia.review.databaseMigration', title: 'Kodia Review: Review Database Migration', menuTitle: 'Review Database Migration', order: 9, scope: 'current_file', depth: 'standard', section: 'database_review' },
	{ id: 'kodia.review.security', title: 'Kodia Review: Review Security', menuTitle: 'Review Security', order: 10, scope: 'current_file', depth: 'security', section: 'security_intelligence' },
	{ id: 'kodia.review.architectureImpact', title: 'Kodia Review: Review Architecture Impact', menuTitle: 'Review Architecture Impact', order: 11, scope: 'entire_project', depth: 'deep', section: 'architecture_intelligence' },
	{ id: 'kodia.review.generateMissingTests', title: 'Kodia Review: Generate Missing Tests', menuTitle: 'Generate Missing Tests', order: 12, scope: 'current_file', depth: 'standard', section: 'test_intelligence' },
	{ id: 'kodia.review.investigateFinding', title: 'Kodia Review: Investigate Finding', menuTitle: 'Investigate Finding', order: 13, scope: 'current_file', depth: 'deep', mode: 'investigate' },
	{ id: 'kodia.review.fixFinding', title: 'Kodia Review: Fix Finding', menuTitle: 'Fix Finding', order: 14, scope: 'current_file', depth: 'standard', mode: 'fix' },
	{ id: 'kodia.review.verifyFix', title: 'Kodia Review: Verify Fix', menuTitle: 'Verify Fix', order: 15, scope: 'current_file', depth: 'standard', mode: 'verify' },
	{ id: 'kodia.review.explainRisk', title: 'Kodia Review: Explain Risk', menuTitle: 'Explain Risk', order: 16, scope: 'current_file', depth: 'security', mode: 'investigate' },
	{ id: 'kodia.review.compareImplementations', title: 'Kodia Review: Compare Implementations', menuTitle: 'Compare Implementations', order: 17, scope: 'branch_comparison', depth: 'standard' },
	{ id: 'kodia.review.generateReport', title: 'Kodia Review: Generate Review Report', menuTitle: 'Generate Review Report', order: 18, scope: 'modified_files', depth: 'standard', section: 'review_reports', mode: 'report' },
];

for (const spec of CONTEXTUAL_REVIEW_ACTIONS) {
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: spec.id,
				title: { value: spec.title, original: spec.title },
				f1: true,
				menu: [{
					id: KACRAE_EDITOR_SUBMENU_ID,
					group: 'navigation',
					order: spec.order,
					when: EditorContextKeys.editorTextFocus,
				}],
			});
		}

		async run(accessor: ServicesAccessor): Promise<void> {
			const svc = accessor.get(ICodeReviewService);
			const editorService = accessor.get(ICodeEditorService);
			const notif = accessor.get(INotificationService);

			const activeEditor = editorService.getActiveCodeEditor();
			const model = activeEditor?.getModel();
			const root = svc.getWorkspaceRoot();

			if (spec.mode === 'report') {
				const session = svc.getActiveSession() ?? await svc.startReview({ scope: 'modified_files', depth: 'standard', openWorkbench: true });
				const res = await svc.exportReport({ sessionId: session.id, format: 'html', reportType: 'technical' });
				await svc.openWorkbench('review_reports');
				notif.info(`Exported KACRAE HTML report to ${res.filePath}`);
				return;
			}

			if (spec.mode === 'investigate' || spec.mode === 'fix' || spec.mode === 'verify') {
				const session = svc.getActiveSession();
				const finding = session?.findings.find(f => f.id === svc.state.selectedFindingId) ?? session?.findings[0];
				if (!session || !finding) {
					notif.info('No active finding yet — running review on current scope first.');
				} else if (spec.mode === 'fix' || spec.mode === 'verify') {
					const rec = await svc.proposeOrApplyRepair({ sessionId: session.id, findingId: finding.id, dryRun: spec.mode === 'verify' });
					await svc.openWorkbench('current_review');
					notif.info(`KACRAE ${spec.mode}: ${rec.status} (${rec.file})`);
					return;
				} else {
					svc.selectFinding(finding.id);
					await svc.openWorkbench('current_review');
					return;
				}
			}

			if (spec.requireSelection) {
				const sel = activeEditor?.getSelection();
				if (!model || !sel || sel.isEmpty()) {
					notif.info('Select code in the editor first to review selected code.');
					return;
				}
				const rel = normalizeFsRel(root, model.uri.fsPath);
				await svc.startReview({
					scope: 'selected_code',
					depth: spec.depth,
					selectedSnippet: {
						file: rel,
						startLine: sel.startLineNumber,
						endLine: sel.endLineNumber,
						code: model.getValueInRange(sel),
					},
					openWorkbench: true,
				});
				return;
			}

			const targetFiles = (spec.scope === 'current_file' || spec.scope === 'current_function' || spec.scope === 'current_class') && model
				? [normalizeFsRel(root, model.uri.fsPath)]
				: undefined;

			await svc.startReview({
				scope: spec.scope,
				depth: spec.depth,
				targetFiles,
				openWorkbench: true,
			});
			if (spec.section) {
				svc.setActiveSection(spec.section);
			}
		}
	});
}

