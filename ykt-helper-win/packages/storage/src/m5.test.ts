import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { BrowserEnvironment } from '@ykt/contracts';
import { afterAll, describe, expect, it } from 'vitest';

import { DiskResourceCache } from './disk-resource-cache.js';
import { FileSecretStore } from './file-secret-store.js';
import { SqliteAppDataStore } from './sqlite-app-data-store.js';
import type { SecretCodec } from './types.js';

describe('M5 persistent storage', () => {
  afterAll(async () => {
    await Promise.all(
      temporaryDirectories.map((path) =>
        rm(path, { recursive: true, force: true }),
      ),
    );
  });

  it('restores settings, users and courseware metadata after reopening', async () => {
    const directory = temporaryDirectory('app-data');
    const path = join(directory, 'data.sqlite');
    const first = new SqliteAppDataStore(path);
    await first.updateSettings({
      autoAnswerDelay: 4500,
      autoAnswer: true,
      aiAutoAnalyze: true,
    });
    await first.saveUser({
      environment: BrowserEnvironment.Standard,
      id: '42',
      name: 'Student',
      updatedAt: '2026-09-04T00:00:00.000Z',
    });
    await first.putDocument({
      key: 'standard:presentation:7',
      kind: 'presentation',
      value: { id: '7', slides: [] },
      updatedAt: '2026-09-04T00:00:00.000Z',
      expiresAt: null,
    });
    await first.appendLog({
      level: 'info',
      scope: 'request',
      message: 'Authorization: Bearer plain-token',
      details: { cookie: 'plain-cookie', status: 200 },
    });
    first.close();

    const second = new SqliteAppDataStore(path);
    expect(await second.getSettings()).toMatchObject({
      autoAnswerDelay: 4500,
      llmAutoGenerate: true,
      llmManagedSubmit: true,
      aiAnalyzeLatestOnOpen: true,
      aiCaptureCurrentPage: true,
    });
    expect(await second.getUser(BrowserEnvironment.Standard)).toMatchObject({
      id: '42',
      name: 'Student',
    });
    expect(await second.getDocument('standard:presentation:7')).toMatchObject({
      kind: 'presentation',
      value: { id: '7', slides: [] },
    });
    expect(JSON.stringify(await second.listLogs())).not.toContain(
      'plain-token',
    );
    expect(JSON.stringify(await second.listLogs())).not.toContain(
      'plain-cookie',
    );
    await expect(
      second.updateSettings({ apiKey: 'must-not-enter-sqlite' }),
    ).rejects.toThrow('SecretStore');
    await expect(
      second.updateSettings({
        ai: { profiles: [{ apiKey: 'nested-secret' }] },
      }),
    ).rejects.toThrow('SecretStore');
    second.close();

    expect((await readFile(path)).toString()).not.toContain('plain-token');
    expect((await readFile(path)).toString()).not.toContain('plain-cookie');
  });

  it('caches bounded binary resources with browser-style expiry', async () => {
    let now = 1000;
    const directory = temporaryDirectory('resource-cache');
    const slideUrl = 'https://example.test/slide.png?token=signed-secret';
    const cache = await DiskResourceCache.open({
      directory,
      maxBytes: 5,
      maxEntryBytes: 4,
      now: () => now,
    });
    await cache.put(slideUrl, {
      body: Uint8Array.from([1, 2, 3]),
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'max-age=1',
        ETag: 'slide-v1',
      },
    });
    expect(await cache.match(slideUrl)).toMatchObject({
      stale: false,
      etag: 'slide-v1',
    });
    now = 2500;
    expect(await cache.match(slideUrl)).toMatchObject({
      stale: true,
    });

    now = 3000;
    await cache.put('https://example.test/slides.pdf', {
      body: Uint8Array.from([4, 5, 6]),
      headers: { 'Content-Type': 'application/pdf' },
    });
    expect(cache.stats()).toMatchObject({ entries: 1, bytes: 3, maxBytes: 5 });
    expect(await cache.match(slideUrl)).toBeNull();
    cache.close();
    expect(
      (await readFile(join(directory, 'cache.sqlite'))).toString(),
    ).not.toContain('signed-secret');
  });

  it('stores credentials only through an encrypted codec', async () => {
    const path = join(temporaryDirectory('secrets'), 'credentials.json');
    const secrets = new FileSecretStore(path, new ReverseCodec());
    await secrets.set('token', 'sensitive-value');
    expect(await secrets.get('token')).toBe('sensitive-value');
    expect(await readFile(path, 'utf8')).not.toContain('sensitive-value');
    await secrets.delete('token');
    expect(await secrets.get('token')).toBeNull();
  });
});

class ReverseCodec implements SecretCodec {
  encrypt(value: string): Uint8Array {
    return Buffer.from([...value].reverse().join(''));
  }

  decrypt(value: Uint8Array): string {
    return [...Buffer.from(value).toString()].reverse().join('');
  }
}

function temporaryDirectory(name: string): string {
  const path = join(
    process.env.TEMP ?? process.cwd(),
    `ykt-helper-${name}-${process.pid}-${Math.random().toString(16).slice(2)}`,
  );
  temporaryDirectories.push(path);
  return path;
}

const temporaryDirectories: string[] = [];
