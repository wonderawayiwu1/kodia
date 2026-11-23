/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IEnvironmentMainService } from '../../../../../platform/environment/electron-main/environmentMainService.js';
import { IProductService } from '../../../../../platform/product/common/productService.js';
import { DisablementReason, IUpdateService, State } from '../../../../../platform/update/common/update.js';
import { VoidCheckUpdateRespose } from '../../common/voidUpdateServiceTypes.js';
import { KODIA_INNO_SILENT_UPDATE_ARGS, VoidMainUpdateService } from '../../electron-main/voidUpdateMainService.js';

// the button the notification offers (none when there is no message)
const actionOf = (res: VoidCheckUpdateRespose) => res?.message ? res.action : undefined;

class TestableVoidMainUpdateService extends VoidMainUpdateService {
	public spawned: Array<{ installerPath: string; args: string[] }> = [];
	public quitScheduled = false;

	protected override _spawnInstaller(installerPath: string, args: string[]): void {
		this.spawned.push({ installerPath, args });
	}

	protected override _scheduleQuitForUpdate(): void {
		this.quitScheduled = true;
	}
}

suite('Kodia - update checks', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	const realFetch = globalThis.fetch;
	let fetchCalls = 0;
	const latestRelease = (tag: string, assets?: Array<{ name: string; browser_download_url: string }>, binaryPayload?: Uint8Array) => {
		globalThis.fetch = (async (input: string | URL | Request) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
			if (assets && binaryPayload && assets.some(a => a.browser_download_url === url)) {
				return new Response(Buffer.from(binaryPayload), { status: 200 });
			}
			fetchCalls += 1;
			return new Response(JSON.stringify({ tag_name: tag, html_url: `https://github.com/wonderawayiwu1/kodia/releases/tag/${tag}`, assets }), { status: 200 });
		}) as typeof fetch;
	};
	setup(() => { fetchCalls = 0; });
	teardown(() => { globalThis.fetch = realFetch; });

	// a release build of 1.141.0-2.5.5: no update URL, so VS Code's updater is disabled
	const service = ({
		updateMode = 'default',
		reason = DisablementReason.MissingConfiguration,
		localInstallerPath = '',
		commit,
		date,
		autoDownload = true,
	}: {
		updateMode?: string;
		reason?: DisablementReason;
		localInstallerPath?: string;
		commit?: string;
		date?: string;
		autoDownload?: boolean;
	} = {}) => {
		const product = { version: '1.141.0', voidVersion: '2.5.5', commit, date } as unknown as IProductService;
		const environment = { isBuilt: true } as IEnvironmentMainService;
		const update = { state: State.Disabled(reason), checkForUpdates: async () => { } } as unknown as IUpdateService;
		const configValues: Record<string, unknown> = {
			'update.mode': updateMode,
			'kodia.update.localInstallerPath': localInstallerPath,
			'kodia.update.autoDownload': autoDownload,
		};
		const configuration = { getValue: (key: string) => configValues[key] } as unknown as IConfigurationService;
		return disposables.add(new TestableVoidMainUpdateService(product, environment, update, configuration));
	};

	test('the automatic check announces a newer release, once', async () => {
		latestRelease('1.141.0-2.6.0');
		const s = service();
		assert.strictEqual(actionOf(await s.check(false)), 'reinstall');
		assert.strictEqual((await s.check(false))?.message, null, 'not again 3 hours later');
		assert.strictEqual(actionOf(await s.check(true)), 'reinstall', 'the command always answers');
	});

	test('the automatic check stays quiet when up to date', async () => {
		latestRelease('1.141.0-2.5.5');
		assert.strictEqual((await service().check(false))?.message, null);
		assert.strictEqual((await service().check(true))?.message, 'Kodia is up-to-date!');
	});

	test('no automatic check when the user turned update checks off', async () => {
		latestRelease('1.141.0-2.6.0');
		assert.strictEqual((await service({ updateMode: 'none' }).check(false))?.message, null);
		assert.strictEqual((await service({ updateMode: 'manual' }).check(false))?.message, null);
		assert.strictEqual((await service({ reason: DisablementReason.DisabledByEnvironment }).check(false))?.message, null);
		assert.strictEqual(fetchCalls, 0);
		assert.strictEqual(actionOf(await service({ updateMode: 'none' }).check(true)), 'reinstall', 'the command still checks');
	});

	test('auto-downloads newer GitHub Windows installer and offers Restart to Update', async function () {
		if (process.platform !== 'win32') {
			this.skip();
		}
		const tag = `1.141.0-2.9.${Date.now() % 10000}`;
		const fakePe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]); // 'MZ' PE header
		latestRelease(
			tag,
			[{ name: 'kodia-installer-x64.exe', browser_download_url: `https://example.invalid/${tag}/kodia-installer-x64.exe` }],
			fakePe,
		);

		const s = service();
		const res = await s.check(false);
		assert.strictEqual(actionOf(res), 'restart');
		assert.strictEqual(res?.source, 'github');
		assert.ok(res?.installerPath && fs.existsSync(res.installerPath), 'installer downloaded to temp cache');

		const status = await s.getUpdateStatus();
		assert.strictEqual(status.state, 'ready');
		assert.strictEqual(status.source, 'github');

		const applyRes = await s.restartAndApplyUpdate();
		assert.strictEqual(applyRes.launched, true);
		assert.strictEqual(s.spawned.length, 1);
		assert.strictEqual(s.spawned[0].installerPath, res.installerPath);
		assert.deepStrictEqual(s.spawned[0].args, [...KODIA_INNO_SILENT_UPDATE_ARGS]);
		assert.strictEqual(s.quitScheduled, true);

		// Clean up temp download directory
		fs.rmSync(path.dirname(res.installerPath), { recursive: true, force: true });
	});

	test('detects newer local build manifest and avoids false loops on matching build', async () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kodia-local-update-test-'));
		try {
			const installerPath = path.join(tmpDir, 'kodia-installer-x64.exe');
			fs.writeFileSync(installerPath, Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x01, 0x02]));

			const currentDate = '2026-11-23T10:00:00.000Z';
			const newerDate = '2026-11-23T12:00:00.000Z';

			// 1. Matching commit & same date -> should NOT trigger update
			fs.writeFileSync(path.join(tmpDir, 'kodia-update.json'), JSON.stringify({
				version: '1.141.0',
				voidVersion: '2.5.5',
				commit: 'aaaaaaa1111111',
				date: currentDate,
			}));
			const sSame = service({ localInstallerPath: tmpDir, commit: 'aaaaaaa1111111', date: currentDate });
			assert.strictEqual((await sSame.checkLocalOnly())?.message, null);
			assert.strictEqual((await sSame.restartAndApplyUpdate()).launched, false);

			// 2. Newer build timestamp & different commit -> triggers Restart to Update without network
			fs.writeFileSync(path.join(tmpDir, 'kodia-update.json'), JSON.stringify({
				version: '1.141.0',
				voidVersion: '2.5.5',
				commit: 'bbbbbbb2222222',
				date: newerDate,
				buildId: '1.141.0-2.5.5@bbbbbbb2222222',
			}));
			const sNew = service({ localInstallerPath: tmpDir, commit: 'aaaaaaa1111111', date: currentDate });
			const res = await sNew.checkLocalOnly();
			assert.strictEqual(actionOf(res), 'restart');
			assert.strictEqual(res?.source, 'local');
			assert.strictEqual(res?.installerPath, installerPath);
			assert.strictEqual(fetchCalls, 0, 'local check makes zero network calls');

			// Second automatic poll does not re-spam the notification, while status stays ready
			assert.strictEqual((await sNew.checkLocalOnly())?.message, null);
			assert.strictEqual((await sNew.getUpdateStatus()).state, 'ready');

			const applyRes = await sNew.restartAndApplyUpdate();
			assert.strictEqual(applyRes.launched, true);
			assert.strictEqual(sNew.spawned.length, 1);
			assert.strictEqual(sNew.spawned[0].installerPath, installerPath);
			assert.strictEqual(sNew.quitScheduled, true);
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});
