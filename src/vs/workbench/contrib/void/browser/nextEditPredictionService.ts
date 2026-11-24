/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { Range } from '../../../../editor/common/core/range.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import {
	buildNextEditPredictionRequest,
	findDeterministicNextEditTargets,
	NextEditTarget,
	parseNextEditPredictionResponse,
	RecentEditRecord,
} from '../common/nextEditPrediction.js';
import { ILLMMessageService } from '../common/sendLLMMessageService.js';
import { IVoidSettingsService } from '../common/voidSettingsService.js';
import { IConvertToLLMMessageService } from './convertToLLMMessageService.js';

export const INextEditPredictionService = createDecorator<INextEditPredictionService>('kodiaNextEditPredictionService');

export interface INextEditPredictionService {
	readonly _serviceBrand: undefined;
	recordEdit(edit: RecentEditRecord): void;
	getRecentEdits(uri?: string): readonly RecentEditRecord[];
	predictNextEditForActiveEditor(): Promise<NextEditTarget | null>;
}

const MAX_RECENT_EDITS = 25;

export class NextEditPredictionService extends Disposable implements INextEditPredictionService {
	readonly _serviceBrand: undefined;

	private readonly _recentEdits: RecentEditRecord[] = [];
	private readonly _trackedModels = new Set<string>();
	private readonly _lineCache = new Map<string, Map<number, string>>();

	constructor(
		@ICodeEditorService private readonly _codeEditorService: ICodeEditorService,
		@ILLMMessageService private readonly _llmMessageService: ILLMMessageService,
		@IConvertToLLMMessageService private readonly _convertToLLMMessageService: IConvertToLLMMessageService,
		@IVoidSettingsService private readonly _voidSettingsService: IVoidSettingsService,
	) {
		super();
		this._attachActiveEditorTracking();
	}

	private _attachActiveEditorTracking(): void {
		const attach = (editor?: import('../../../../editor/browser/editorBrowser.js').ICodeEditor | null) => {
			const target = editor ?? this._codeEditorService.getActiveCodeEditor();
			if (!target || target.isSimpleWidget) { return; }
			const model = target.getModel();
			if (!model || model.uri.scheme !== 'file') { return; }
			const key = model.uri.toString();
			if (this._trackedModels.has(key)) { return; }
			this._trackedModels.add(key);

			const fileLineCache = new Map<number, string>();
			this._lineCache.set(key, fileLineCache);

			const contentDisp = model.onDidChangeContent(e => {
				// O(1) per edited line instead of copying the entire file with getLinesContent() on every keystroke
				const maxLine = model.getLineCount();
				for (const change of e.changes) {
					const ln = change.range.startLineNumber;
					if (ln < 1 || ln > maxLine) { continue; }
					const afterLine = model.getLineContent(ln);
					const beforeLine = fileLineCache.get(ln) ?? '';
					if (beforeLine !== afterLine) {
						fileLineCache.set(ln, afterLine);
						if (fileLineCache.size > 200) {
							const oldestKey = fileLineCache.keys().next().value;
							if (oldestKey !== undefined) { fileLineCache.delete(oldestKey); }
						}
						this.recordEdit({
							uri: key,
							lineNumber: ln,
							beforeLine,
							afterLine,
							timestamp: Date.now(),
						});
					}
				}
			});
			const disposeDisp = model.onWillDispose(() => {
				this._trackedModels.delete(key);
				this._lineCache.delete(key);
				contentDisp.dispose();
				disposeDisp.dispose();
			});
			this._register(contentDisp);
			this._register(disposeDisp);
		};

		attach();
		this._register(this._codeEditorService.onCodeEditorAdd(ed => attach(ed)));
	}

	recordEdit(edit: RecentEditRecord): void {
		this._recentEdits.push(edit);
		while (this._recentEdits.length > MAX_RECENT_EDITS) {
			this._recentEdits.shift();
		}
	}

	getRecentEdits(uri?: string): readonly RecentEditRecord[] {
		if (!uri) { return this._recentEdits; }
		return this._recentEdits.filter(e => e.uri === uri);
	}

	async predictNextEditForActiveEditor(): Promise<NextEditTarget | null> {
		const editor = this._codeEditorService.getActiveCodeEditor();
		const model = editor?.getModel();
		if (!editor || !model) { return null; }

		const uriStr = model.uri.toString();
		const editsForFile = this.getRecentEdits(uriStr);
		const lines = model.getLinesContent();

		// 1. Instant deterministic prediction (0ms latency, works offline!)
		if (editsForFile.length > 0) {
			const lastEdit = editsForFile[editsForFile.length - 1];
			const deterministic = findDeterministicNextEditTargets(lines, lastEdit, 1);
			if (deterministic.length > 0) {
				return deterministic[0];
			}
		}

		// 2. Fallback to fast LLM prediction (reasoning explicitly disabled)
		const modelSelection = this._voidSettingsService.state.modelSelectionOfFeature.Chat;
		if (!modelSelection) { return null; }

		const cursorLine = editor.getPosition()?.lineNumber ?? 1;
		const windowStartLine = Math.max(1, cursorLine - 30);
		const windowEndLine = Math.min(lines.length, cursorLine + 30);
		const windowContent = lines.slice(windowStartLine - 1, windowEndLine).join('\n');

		const { systemMessage, userMessage } = buildNextEditPredictionRequest({
			filePath: model.uri.fsPath,
			languageId: model.getLanguageId(),
			cursorLine,
			windowStartLine,
			windowContent,
			recentEdits: editsForFile,
		});

		const { messages, separateSystemMessage } = this._convertToLLMMessageService.prepareLLMSimpleMessages({
			simpleMessages: [{ role: 'user', content: userMessage }],
			systemMessage,
			modelSelection,
			featureName: 'Chat',
		});

		const reasoningOpts = modelSelection.providerName === 'nvidia'
			? { reasoningEnabled: true, reasoningEffort: 'none' }
			: { reasoningEnabled: false };

		return new Promise<NextEditTarget | null>(resolve => {
			let settled = false;
			const done = (val: NextEditTarget | null) => {
				if (settled) { return; }
				settled = true;
				resolve(val);
			};
			const reqId = this._llmMessageService.sendLLMMessage({
				messagesType: 'chatMessages',
				messages,
				separateSystemMessage,
				chatMode: null,
				modelSelection,
				modelSelectionOptions: reasoningOpts,
				overridesOfModel: this._voidSettingsService.state.overridesOfModel,
				logging: { loggingName: 'Next-Edit Prediction' },
				onText: () => { },
				onFinalMessage: ({ fullText }) => done(parseNextEditPredictionResponse(fullText ?? '')),
				onError: () => done(null),
				onAbort: () => done(null),
			});
			if (!reqId) { done(null); }
		});
	}
}

registerSingleton(INextEditPredictionService, NextEditPredictionService, InstantiationType.Delayed);

registerAction2(class KodiaPredictNextEditAction extends Action2 {
	constructor() {
		super({
			id: 'kodia.predictNextEdit',
			title: { value: 'Kodia: Predict Next Edit (Tab-to-Jump)', original: 'Kodia: Predict Next Edit (Tab-to-Jump)' },
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const nextEditService = accessor.get(INextEditPredictionService);
		const codeEditorService = accessor.get(ICodeEditorService);
		const notificationService = accessor.get(INotificationService);
		const quickInputService = accessor.get(IQuickInputService);

		const editor = codeEditorService.getActiveCodeEditor();
		const model = editor?.getModel();
		if (!editor || !model) {
			notificationService.info('Open a code file first to use Kodia Next-Edit Prediction.');
			return;
		}

		const target = await nextEditService.predictNextEditForActiveEditor();
		if (!target) {
			notificationService.info('Kodia Next-Edit: no follow-up edit predicted right now.');
			return;
		}

		editor.revealLineInCenter(target.lineNumber);
		editor.setPosition({ lineNumber: target.lineNumber, column: 1 });

		const pick = await quickInputService.pick([
			{
				label: `Apply predicted edit on line ${target.lineNumber}`,
				description: target.reason,
				detail: `${target.originalLine.trim()}  →  ${target.suggestedLine.trim()}`,
				apply: true,
			},
			{
				label: 'Jump only (keep current line)',
				apply: false,
			},
		], { placeHolder: `Kodia Next-Edit Prediction (${target.reason})` });

		if (pick?.apply && target.lineNumber >= 1 && target.lineNumber <= model.getLineCount()) {
			const maxCol = model.getLineMaxColumn(target.lineNumber);
			editor.executeEdits('kodia.nextEdit', [{
				range: new Range(target.lineNumber, 1, target.lineNumber, maxCol),
				text: target.suggestedLine,
			}]);
		}
	}
});
