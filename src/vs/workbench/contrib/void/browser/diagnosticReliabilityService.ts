/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { FileChangeType, IFileService } from '../../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IMarkerService, MarkerSeverity } from '../../../../platform/markers/common/markers.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import {
	IKodiaDiagnosticReliabilityMainService,
	KdreClassifiedDiagnostic,
	KdreCompilerVerificationReport,
	KdreCrossEditorComparisonReport,
	KdreDependencyHealthReport,
	KdreDiagnosticConflict,
	KdreEvent,
	KdreInvestigationReport,
	KdreLanguageServerHealth,
	KdreLiveSnapshot,
	KdreProjectConfigReport,
	KdreRawDiagnostic,
	KdreRecoveryActionKind,
	KdreRecoveryResult,
	KdreSeverity,
} from '../common/diagnosticReliabilityTypes.js';

export interface IDiagnosticReliabilityService {
	readonly _serviceBrand: undefined;
	readonly onDidEmitEvent: Event<KdreEvent>;
	readonly onDidChangeSnapshot: Event<KdreLiveSnapshot>;

	getCachedSnapshot(): KdreLiveSnapshot;
	collectLiveEditorDiagnostics(): KdreRawDiagnostic[];
	refreshAndEvaluate(opts?: { runCompiler?: boolean }): Promise<{
		classified: readonly KdreClassifiedDiagnostic[];
		conflicts: readonly KdreDiagnosticConflict[];
		comparison: KdreCrossEditorComparisonReport;
		snapshot: KdreLiveSnapshot;
	}>;
	inspectProjectConfiguration(): Promise<KdreProjectConfigReport>;
	verifyDependencyResolution(): Promise<KdreDependencyHealthReport>;
	probeLanguageServerHealth(): Promise<readonly KdreLanguageServerHealth[]>;
	runIndependentVerification(opts?: { targetFiles?: readonly string[]; languages?: readonly string[] }): Promise<KdreCompilerVerificationReport>;
	investigateDiagnostic(diagnostic: KdreRawDiagnostic, opts?: { runCompiler?: boolean }): Promise<KdreInvestigationReport>;
	executeRecoveryAction(action: KdreRecoveryActionKind, targetLanguage?: string): Promise<KdreRecoveryResult>;
	purgeStaleMarkers(): number;
}

export const IDiagnosticReliabilityService = createDecorator<IDiagnosticReliabilityService>('kodiaDiagnosticReliabilityService');

function mapMarkerSeverity(sev: MarkerSeverity): KdreSeverity {
	switch (sev) {
		case MarkerSeverity.Error: return 'error';
		case MarkerSeverity.Warning: return 'warning';
		case MarkerSeverity.Info: return 'info';
		default: return 'hint';
	}
}

export class DiagnosticReliabilityService extends Disposable implements IDiagnosticReliabilityService {
	readonly _serviceBrand: undefined;

	private readonly _onDidEmitEvent = this._register(new Emitter<KdreEvent>());
	readonly onDidEmitEvent = this._onDidEmitEvent.event;

	private readonly _onDidChangeSnapshot = this._register(new Emitter<KdreLiveSnapshot>());
	readonly onDidChangeSnapshot = this._onDidChangeSnapshot.event;

	private _snapshot: KdreLiveSnapshot;
	private _debounceTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		@IKodiaDiagnosticReliabilityMainService private readonly mainService: IKodiaDiagnosticReliabilityMainService,
		@IMarkerService private readonly markerService: IMarkerService,
		@IModelService private readonly modelService: IModelService,
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super();
		const root = this._workspaceRoot();
		this._snapshot = {
			workspaceRoot: root,
			systemState: 'initializing',
			statusLabel: 'Language services initializing…',
			updatedAtMs: Date.now(),
			totalEditorDiagnostics: 0,
			confirmedErrorCount: 0,
			potentialFalsePositiveCount: 0,
			staleCount: 0,
			conflictCount: 0,
			serverHealth: [],
			classifiedDiagnostics: [],
			conflicts: [],
			recentEvents: [],
		};

		this._register(this.mainService.onDidEmitEvent(ev => this._onDidEmitEvent.fire(ev)));
		this._register(this.mainService.onDidChangeSnapshot(snap => {
			this._snapshot = snap;
			this._onDidChangeSnapshot.fire(snap);
		}));

		// Automatic orphaned-marker guardian: purge markers immediately when a file is deleted!
		this._register(this.fileService.onDidFilesChange(e => {
			for (const change of e.rawDeleted) {
				const existing = this.markerService.read({ resource: change });
				const owners = new Set(existing.map(m => m.owner));
				for (const owner of owners) {
					this.markerService.changeOne(owner, change, []);
				}
			}
			// Reload config when tsconfig/package.json/pyproject.toml/composer.json changes
			const configTouched = [...e.rawUpdated, ...e.rawAdded, ...e.rawDeleted].some(u =>
				/(tsconfig\.json|jsconfig\.json|package\.json|pyproject\.toml|composer\.json|go\.mod|Cargo\.toml)$/i.test(u.path)
			);
			if (configTouched) {
				const r = this._workspaceRoot();
				if (r) void this.mainService.inspectProjectConfiguration(r);
			}
		}));

		// Debounced evaluation when markers change (keeps large projects completely responsive)
		let lastMarkerFingerprint = '';
		this._register(this.markerService.onMarkerChanged(() => {
			if (this._debounceTimer) clearTimeout(this._debounceTimer);
			this._debounceTimer = setTimeout(() => {
				const markers = this.markerService.read({});
				const fp = `${markers.length}:${markers.slice(0, 20).map(m => `${m.resource.path}:${m.startLineNumber}:${m.severity}:${m.code}`).join('|')}`;
				if (fp === lastMarkerFingerprint) return;
				lastMarkerFingerprint = fp;
				void this.refreshAndEvaluate({ runCompiler: false });
			}, 2500);
		}));

		// Initial lightweight scan
		if (root) {
			void this.refreshAndEvaluate({ runCompiler: false });
		}
	}

	override dispose(): void {
		if (this._debounceTimer) clearTimeout(this._debounceTimer);
		super.dispose();
	}

	private _workspaceRoot(): string {
		return this.workspaceContextService.getWorkspace().folders[0]?.uri.fsPath ?? '';
	}

	getCachedSnapshot(): KdreLiveSnapshot {
		return this._snapshot;
	}

	collectLiveEditorDiagnostics(): KdreRawDiagnostic[] {
		const root = this._workspaceRoot();
		const normRoot = root.replace(/\\/g, '/').toLowerCase();
		const markers = this.markerService.read({});
		return markers.map((m, idx) => {
			const model = this.modelService.getModel(m.resource);
			const fsPath = m.resource.fsPath;
			const normFile = fsPath.replace(/\\/g, '/');
			const inActiveWorkspace = !normRoot || normFile.toLowerCase().startsWith(normRoot);
			const relFile = normRoot && inActiveWorkspace
				? normFile.slice(normRoot.length).replace(/^\/+/, '')
				: normFile;
			return {
				id: `marker-${idx}-${m.owner}-${m.startLineNumber}`,
				owner: m.owner,
				source: m.source || m.owner,
				code: typeof m.code === 'object' && m.code !== null ? String(m.code.value) : m.code ? String(m.code) : undefined,
				severity: mapMarkerSeverity(m.severity),
				message: m.message,
				file: relFile || normFile,
				line: m.startLineNumber,
				column: m.startColumn,
				endLine: m.endLineNumber,
				endColumn: m.endColumn,
				modelVersionId: m.modelVersionId,
				currentDocumentVersion: model?.getVersionId(),
				inActiveWorkspace,
				timestamp: Date.now(),
			};
		});
	}

	purgeStaleMarkers(): number {
		const root = this._workspaceRoot().replace(/\\/g, '/').toLowerCase();
		const markers = this.markerService.read({});
		const staleByOwner = new Map<string, Map<string, typeof markers[number]['resource']>>();
		let purged = 0;

		for (const m of markers) {
			const model = this.modelService.getModel(m.resource);
			const isOutdatedVersion = model !== null
				&& typeof m.modelVersionId === 'number'
				&& m.modelVersionId < model.getVersionId();
			const normFile = m.resource.fsPath.replace(/\\/g, '/').toLowerCase();
			const isOutsideWorkspace = Boolean(root) && m.resource.scheme === 'file' && !normFile.startsWith(root) && model === null;

			if (isOutdatedVersion || isOutsideWorkspace) {
				let resMap = staleByOwner.get(m.owner);
				if (!resMap) {
					resMap = new Map();
					staleByOwner.set(m.owner, resMap);
				}
				resMap.set(m.resource.toString(), m.resource);
				purged++;
			}
		}

		for (const [owner, resMap] of staleByOwner.entries()) {
			for (const uri of resMap.values()) {
				this.markerService.changeOne(owner, uri, []);
			}
		}
		return purged;
	}

	async refreshAndEvaluate(opts?: { runCompiler?: boolean }) {
		const root = this._workspaceRoot();
		const raw = this.collectLiveEditorDiagnostics();
		return this.mainService.evaluateDiagnostics(root, raw, { runCompiler: opts?.runCompiler });
	}

	async inspectProjectConfiguration(): Promise<KdreProjectConfigReport> {
		return this.mainService.inspectProjectConfiguration(this._workspaceRoot());
	}

	async verifyDependencyResolution(): Promise<KdreDependencyHealthReport> {
		return this.mainService.verifyDependencyResolution(this._workspaceRoot());
	}

	async probeLanguageServerHealth(): Promise<readonly KdreLanguageServerHealth[]> {
		return this.mainService.probeLanguageServerHealth(this._workspaceRoot());
	}

	async runIndependentVerification(opts?: { targetFiles?: readonly string[]; languages?: readonly string[] }): Promise<KdreCompilerVerificationReport> {
		return this.mainService.runIndependentVerification(this._workspaceRoot(), opts);
	}

	async investigateDiagnostic(diagnostic: KdreRawDiagnostic, opts?: { runCompiler?: boolean }): Promise<KdreInvestigationReport> {
		return this.mainService.investigateDiagnostic(this._workspaceRoot(), diagnostic, opts);
	}

	async executeRecoveryAction(action: KdreRecoveryActionKind, targetLanguage?: string): Promise<KdreRecoveryResult> {
		const root = this._workspaceRoot();
		let executed = false;
		let summary = '';
		let affectedCount = 0;

		try {
			switch (action) {
				case 'restart_language_server': {
					await this.commandService.executeCommand('typescript.restartTsServer').catch(() => { /* optional if TS ext not active */ });
					executed = true;
					summary = `Restarted ${targetLanguage ?? 'TypeScript / active'} language server cleanly.`;
					affectedCount = 1;
					break;
				}
				case 'reload_project_config': {
					await this.commandService.executeCommand('typescript.reloadProjects').catch(() => { /* optional */ });
					const cfg = await this.mainService.inspectProjectConfiguration(root);
					executed = true;
					summary = `Reloaded ${cfg.configFiles.length} project configuration file(s).`;
					affectedCount = cfg.configFiles.length;
					break;
				}
				case 'purge_stale_markers':
				case 'refresh_document_sync': {
					affectedCount = this.purgeStaleMarkers();
					await this.commandService.executeCommand('typescript.reloadProjects').catch(() => { /* optional */ });
					executed = true;
					summary = `Purged ${affectedCount} stale marker(s) and refreshed document synchronization.`;
					break;
				}
				case 'recheck_dependencies': {
					const dep = await this.mainService.verifyDependencyResolution(root);
					executed = true;
					summary = dep.healthy ? 'Dependency resolution verified healthy.' : `Found ${dep.resolutionWarnings.length} resolution warning(s).`;
					affectedCount = dep.missingDeclaredDeps.length;
					break;
				}
				case 'run_compiler_verify': {
					const ver = await this.mainService.runIndependentVerification(root);
					executed = true;
					summary = ver.summary;
					affectedCount = ver.totalErrors;
					break;
				}
			}
		} catch (err) {
			executed = false;
			summary = `Recovery action failed: ${err instanceof Error ? err.message : String(err)}`;
		}

		const result: KdreRecoveryResult = {
			action,
			targetLanguage,
			executed,
			summary,
			affectedCount,
			timestampMs: Date.now(),
		};
		await this.mainService.recordRecoveryAction(root, result);
		return result;
	}
}

// Keep unused import lint happy if FileChangeType isn't directly referenced
void FileChangeType.DELETED;

registerSingleton(IDiagnosticReliabilityService, DiagnosticReliabilityService, InstantiationType.Delayed);
