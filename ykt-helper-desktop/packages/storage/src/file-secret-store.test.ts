import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import type * as FsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileSecretStore } from './file-secret-store.js';
import type { SecretCodec } from './types.js';

const fault = vi.hoisted(() => ({ interruptNextWrite: false }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof FsPromises>();
  return {
    ...fs,
    writeFile: async (...args: Parameters<typeof fs.writeFile>) => {
      if (fault.interruptNextWrite) {
        fault.interruptNextWrite = false;
        await fs.writeFile(args[0], '');
        throw new Error('simulated shutdown after truncate');
      }
      return fs.writeFile(...args);
    },
  };
});
const codec: SecretCodec = {
  encrypt: (value) => Buffer.from([...value].reverse().join('')),
  decrypt: (value) => [...Buffer.from(value).toString()].reverse().join(''),
};
const directories: string[] = [];
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'ykt-secret-store-'));
  directories.push(dir);
  const path = join(dir, 'credentials.json');
  return { dir, path, store: new FileSecretStore(path, codec) };
}
afterEach(async () => {
  fault.interruptNextWrite = false;
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('credential file integrity', () => {
  it('keeps committed credentials when a write is interrupted after truncation', async () => {
    const { path, store } = await setup();
    await store.set('ai-profile:deepseek:main', 'original-api-key');
    const before = await readFile(path);
    fault.interruptNextWrite = true;
    await expect(
      store.set('yuketang:pro:bearer-token', 'new-token'),
    ).rejects.toThrow('simulated shutdown');
    expect(await readFile(path)).toEqual(before);
    expect(
      await new FileSecretStore(path, codec).get('ai-profile:deepseek:main'),
    ).toBe('original-api-key');
    await store.set('another', 'after-failure');
    expect(await store.get('another')).toBe('after-failure');
  });

  it('preserves independent keys across simultaneous writes and multiple instances', async () => {
    const { path, store } = await setup();
    const second = new FileSecretStore(path, codec);
    await store.set('ai-profile:deepseek:main', 'original-api-key');
    await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        (i % 2 ? store : second).set(`token-${i}`, `value-${i}`),
      ),
    );
    const reopened = new FileSecretStore(path, codec);
    expect(await reopened.get('ai-profile:deepseek:main')).toBe(
      'original-api-key',
    );
    for (let i = 0; i < 30; i++)
      expect(await reopened.get(`token-${i}`)).toBe(`value-${i}`);
  });

  it('handles an existing zero-byte file so profile and network credential reads remain available', async () => {
    const { path, store } = await setup();
    await writeFile(path, '');
    expect(await store.get('ai-profile:deepseek:main')).toBeNull();
    await store.set('yuketang:pro:bearer-token', 'new-token');
    expect(await store.get('yuketang:pro:bearer-token')).toBe('new-token');
  });

  it('recovers a damaged primary from a valid encrypted backup and keeps corruption for diagnosis', async () => {
    const { dir, path, store } = await setup();
    await store.set('ai-profile:deepseek:main', 'original-api-key');
    await store.set('yuketang:pro:bearer-token', 'current-token');
    await writeFile(path, '{broken');
    const reopened = new FileSecretStore(path, codec);
    expect(await reopened.get('ai-profile:deepseek:main')).toBe(
      'original-api-key',
    );
    expect(
      (await readdir(dir)).some((name) => name.includes('.corrupt-')),
    ).toBe(true);
    expect(JSON.parse(await readFile(path, 'utf8'))).toHaveProperty(
      'ai-profile:deepseek:main',
    );
  });

  it('rejects unrecoverable nonempty corruption without replacing it with an empty store', async () => {
    const { path, store } = await setup();
    await writeFile(path, '{broken');
    await expect(store.get('token')).rejects.toThrow('凭据文件');
    await expect(store.set('new-token', 'value')).rejects.toThrow('凭据文件');
    expect(await readFile(path, 'utf8')).toBe('{broken');
  });
});
