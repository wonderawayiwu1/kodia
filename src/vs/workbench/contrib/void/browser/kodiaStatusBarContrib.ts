/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IStatusbarEntryAccessor, IStatusbarService, StatusbarAlignment } from '../../../services/statusbar/browser/statusbar.js';
import { IVoidSettingsService } from '../common/voidSettingsService.js';
import { IChatThreadService } from './chatThreadService.js';
import { KODIA_OPEN_CORRECTNESS_HUB_ACTION_ID } from './correctnessService.js';
import { IDiagnosticReliabilityService } from './diagnosticReliabilityService.js';
import { KODIA_CYCLE_AUTONOMY_ACTION_ID } from './kodiaEditorActions.js';
import { VOID_OPEN_SETTINGS_ACTION_ID } from './voidSettingsPane.js';

export class KodiaStatusBarContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.kodiaStatusBar';

	private readonly _modelEntry: IStatusbarEntryAccessor;
	private readonly _autonomyEntry: IStatusbarEntryAccessor;
	private readonly _kdreEntry: IStatusbarEntryAccessor;

	constructor(
		@IStatusbarService statusbarService: IStatusbarService,
		@IVoidSettingsService private readonly _settingsService: IVoidSettingsService,
		@IChatThreadService private readonly _chatThreadService: IChatThreadService,
		@IDiagnosticReliabilityService private readonly _kdreService: IDiagnosticReliabilityService,
	) {
		super();

		this._modelEntry = this._register(statusbarService.addEntry(
			this._buildModelEntry(),
			'kodia.statusbar.model',
			StatusbarAlignment.RIGHT,
			102,
		));

		this._autonomyEntry = this._register(statusbarService.addEntry(
			this._buildAutonomyEntry(),
			'kodia.statusbar.autonomy',
			StatusbarAlignment.RIGHT,
			101,
		));

		this._kdreEntry = this._register(statusbarService.addEntry(
			this._buildKdreEntry(),
			'kodia.statusbar.kdre',
			StatusbarAlignment.LEFT,
			98,
		));

		this._register(this._kdreService.onDidChangeSnapshot(() => {
			this._kdreEntry.update(this._buildKdreEntry());
		}));

		this._register(this._settingsService.onDidChangeState(() => {
			this._modelEntry.update(this._buildModelEntry());
			this._autonomyEntry.update(this._buildAutonomyEntry());
		}));

		let lastRunning = this._isAnyThreadRunning();
		this._register(this._chatThreadService.onDidChangeStreamState(() => {
			const nowRunning = this._isAnyThreadRunning();
			if (nowRunning !== lastRunning) {
				lastRunning = nowRunning;
				this._modelEntry.update(this._buildModelEntry());
			}
		}));
	}

	private _isAnyThreadRunning(): boolean {
		const ss = this._chatThreadService.streamState;
		for (const tid of Object.keys(ss)) {
			if (ss[tid]?.isRunning) { return true; }
		}
		return false;
	}

	private _buildModelEntry() {
		const running = this._isAnyThreadRunning();
		const sel = this._settingsService.state.modelSelectionOfFeature.Chat;
		const shortModel = sel ? (sel.modelName.split('/').pop() ?? sel.modelName).slice(0, 26) : 'No Model';
		return {
			name: 'Kodia AI Model',
			text: running ? `$(sync~spin) Kodia · ${shortModel}` : `$(sparkle) Kodia · ${shortModel}`,
			ariaLabel: running ? `Kodia Agent running with ${shortModel}` : `Kodia AI model ${shortModel}`,
			tooltip: sel
				? `Kodia AI (${sel.providerName} / ${sel.modelName}) — Click to open Kodia Settings`
				: 'Kodia AI — Click to configure a model provider',
			command: VOID_OPEN_SETTINGS_ACTION_ID,
		};
	}

	private _buildAutonomyEntry() {
		const mode = this._settingsService.state.globalSettings.agentAutonomyMode ?? 'agent';
		const icon = mode === 'autonomous' ? '$(zap)' : mode === 'agent' ? '$(rocket)' : '$(shield)';
		const label = mode === 'autonomous' ? 'Auto' : mode === 'agent' ? 'Agent' : 'Assist';
		return {
			name: 'Kodia Autonomy Mode',
			text: `${icon} ${label}`,
			ariaLabel: `Kodia Autonomy Mode: ${label}`,
			tooltip: `Kodia Autonomy Mode: ${label} — Click to cycle Assist / Agent / Auto`,
			command: KODIA_CYCLE_AUTONOMY_ACTION_ID,
		};
	}

	private _buildKdreEntry() {
		const snap = this._kdreService.getCachedSnapshot();
		const icon = snap.systemState === 'verifying' || snap.systemState === 'initializing' || snap.systemState === 'updating'
			? '$(sync~spin)'
			: snap.systemState === 'unavailable'
				? '$(error)'
				: snap.systemState === 'degraded' || snap.systemState === 'stale'
					? '$(warning)'
					: '$(verified)';
		const detail = snap.conflictCount > 0
			? `KDRE: ${snap.conflictCount} conflict(s)`
			: snap.staleCount > 0
				? `KDRE: ${snap.staleCount} stale`
				: snap.systemState === 'verifying'
					? 'KDRE: Verifying…'
					: snap.systemState === 'degraded'
						? 'KDRE: Degraded'
						: snap.systemState === 'unavailable'
							? 'KDRE: Unavailable'
							: 'KDRE: Ready';
		return {
			name: 'Kodia Diagnostic Reliability',
			text: `${icon} ${detail}`,
			ariaLabel: `Kodia Diagnostic Reliability: ${snap.statusLabel}`,
			tooltip: `Kodia Diagnostic Reliability Engine — ${snap.statusLabel} (Editor: ${snap.totalEditorDiagnostics}, Confirmed: ${snap.confirmedErrorCount}, Conflicts: ${snap.conflictCount}, Stale: ${snap.staleCount}). Click to open Diagnostics & Correctness Hub.`,
			command: KODIA_OPEN_CORRECTNESS_HUB_ACTION_ID,
		};
	}
}

registerWorkbenchContribution2(KodiaStatusBarContribution.ID, KodiaStatusBarContribution, WorkbenchPhase.AfterRestored);
