/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

export type KodiaUpdateSource = 'native' | 'github' | 'local';

export interface KodiaUpdateStatus {
	state: 'idle' | 'checking' | 'downloading' | 'ready' | 'error';
	version?: string;
	source?: KodiaUpdateSource;
	installerPath?: string;
	releaseNotesUrl?: string;
	message?: string;
}

export interface KodiaApplyUpdateResult {
	launched: boolean;
	error?: string;
}

export type VoidCheckUpdateRespose = {
	message: string;
	action?: 'reinstall' | 'restart' | 'download' | 'apply';
	version?: string;
	source?: KodiaUpdateSource;
	installerPath?: string;
	releaseNotesUrl?: string;
} | {
	message: null;
	actions?: undefined;
	action?: undefined;
	version?: string;
	source?: KodiaUpdateSource;
	installerPath?: string;
	releaseNotesUrl?: string;
} | null;


