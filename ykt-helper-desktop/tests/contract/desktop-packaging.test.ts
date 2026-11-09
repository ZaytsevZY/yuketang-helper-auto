import { createRequire } from 'node:module';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  createConfig: macConfig,
} = require('../../desktop/forge.macos.config.cjs');
const {
  createConfig: winConfig,
} = require('../../desktop/forge.windows.config.cjs');

describe('platform-specific desktop packaging', () => {
  it('isolates macOS, Windows installer and portable output and resources', () => {
    const mac = macConfig({});
    const win = winConfig({});
    const portable = winConfig({ YKT_PORTABLE: '1' });
    expect(new Set([mac.outDir, win.outDir, portable.outDir]).size).toBe(3);
    expect(mac.outDir).toMatch(/macos[/\\]local$/);
    expect(mac.packagerConfig.appBundleId).toBe('cn.yuketang.helper.desktop');
    expect(
      mac.packagerConfig.extraResource.some((file: string) =>
        file.endsWith('ykt.cmd'),
      ),
    ).toBe(false);
    expect(mac.hooks.postPackage).toBeUndefined();
    expect(win.packagerConfig.osxSign).toBeUndefined();
    expect(win.makers.map((maker: { name: string }) => maker.name)).toEqual([
      '@electron-forge/maker-squirrel',
    ]);
    expect(
      portable.makers.map((maker: { name: string }) => maker.name),
    ).toEqual(['@electron-forge/maker-zip']);
    expect(
      mac.makers.every(
        (maker: { platforms: string[] }) => maker.platforms.join() === 'darwin',
      ),
    ).toBe(true);
  });

  it('requires real signing and notarization credentials for release and fails on signing errors', () => {
    for (const env of [
      { YKT_MAC_RELEASE: '1' },
      { YKT_MAC_RELEASE: '1', YKT_MAC_SIGN_IDENTITY: '-' },
      {
        YKT_MAC_RELEASE: '1',
        YKT_MAC_SIGN_IDENTITY: 'Developer ID Application: Test',
      },
    ])
      expect(() => macConfig(env)).toThrow(/正式发行需要/);
    const release = macConfig({
      YKT_MAC_RELEASE: '1',
      YKT_MAC_SIGN_IDENTITY: 'Developer ID Application: Test',
      YKT_MAC_NOTARY_PROFILE: 'test-profile',
    });
    expect(release.outDir).not.toBe(macConfig({}).outDir);
    expect(release.packagerConfig.osxSign.continueOnError).toBe(false);
    expect(release.packagerConfig.osxNotarize).toEqual({
      keychainProfile: 'test-profile',
    });
    expect(macConfig({}).packagerConfig.osxSign.continueOnError).toBe(false);
    expect(macConfig({}).packagerConfig.osxNotarize).toBeUndefined();
  });

  it('rejects mismatched platforms before any platform-specific hook runs', async () => {
    await expect(
      winConfig({}).hooks.generateAssets({}, 'darwin', 'arm64'),
    ).rejects.toThrow(/不匹配/);
    await expect(
      macConfig({}).hooks.generateAssets({}, 'win32', 'x64'),
    ).rejects.toThrow(/不匹配/);
    await expect(
      macConfig({}).hooks.generateAssets({}, 'darwin', 'ia32'),
    ).rejects.toThrow(/不支持/);
  });

  it('excludes build configuration, credentials and all existing artifacts from app.asar', () => {
    const { ignore } = macConfig({}).packagerConfig;
    const excluded = (file: string) =>
      ignore.some((pattern: RegExp) => pattern.test(file));
    for (const file of [
      '/out/windows/installer/app.exe',
      '/out/macos/local/app.app',
      '/.env',
      '/build/signing.p12',
      '/forge.macos.config.cjs',
      '/.electron-cache',
      '/cli/ykt-cli.cjs',
    ]) {
      expect(excluded(file), file).toBe(true);
    }
    for (const file of [
      '',
      '/package.json',
      '/main/index.cjs',
      '/preload/index.cjs',
      '/renderer/index.html',
      '/node_modules',
    ]) {
      expect(excluded(file), file).toBe(false);
    }
  });

  it('keeps Windows locale trimming and CLI launcher, and removes stale portable markers for installers', async () => {
    const outputPath = await mkdtemp(join(tmpdir(), 'ykt-package-'));
    try {
      await mkdir(join(outputPath, 'locales'));
      for (const locale of ['en-US.pak', 'zh-CN.pak', 'de.pak'])
        await writeFile(join(outputPath, 'locales', locale), 'fixture');
      const result = {
        platform: 'win32',
        arch: 'x64',
        outputPaths: [outputPath],
      };
      await winConfig({ YKT_PORTABLE: '1' }).hooks.postPackage({}, result);
      expect(await readFile(join(outputPath, 'portable.flag'), 'utf8')).toBe(
        'portable\n',
      );
      expect(await readFile(join(outputPath, 'ykt.cmd'), 'utf8')).toContain(
        'ELECTRON_RUN_AS_NODE',
      );
      expect((await readdir(join(outputPath, 'locales'))).sort()).toEqual([
        'en-US.pak',
        'zh-CN.pak',
      ]);
      await winConfig({}).hooks.postPackage({}, result);
      await expect(
        readFile(join(outputPath, 'portable.flag')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(outputPath, { recursive: true, force: true });
    }
  });
});
