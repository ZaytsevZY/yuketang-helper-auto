import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiskResourceCache } from '@ykt/storage';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const caches: { cache: DiskResourceCache; directory: string }[] = [];
async function makeCache() {
  const directory = await mkdtemp(join(tmpdir(), 'assignment-cache-test-'));
  const cache = await DiskResourceCache.open({ directory });
  caches.push({ cache, directory });
  return cache;
}
afterEach(async () => {
  for (const { cache, directory } of caches.splice(0)) {
    cache.close();
    await rm(directory, { recursive: true, force: true });
  }
});
import {
  AssignmentAssets,
  fontMime,
  isAssignmentAssetUrl,
} from '../../apps/desktop/main/assignment-assets.js';

const fontUrl = 'https://fe-static-yuketang.yuketang.cn/exam_font.ttf?v=1';
function font() {
  const bytes = new Uint8Array(100);
  bytes.set([0, 1, 0, 0]);
  return bytes;
}
const response = () =>
  new Response(font(), { headers: { 'content-type': 'font/ttf' } });

describe('assignment resource transport', () => {
  it('recognizes font signatures and rejects HTML and short/oversized data', () => {
    expect(fontMime(font())).toBe('font/ttf');
    for (const [signature, mime] of [
      ['wOF2', 'font/woff2'],
      ['wOFF', 'font/woff'],
      ['OTTO', 'font/otf'],
    ]) {
      const bytes = font();
      bytes.set(Buffer.from(signature!));
      expect(fontMime(bytes)).toBe(mime);
    }
    expect(fontMime(Buffer.from('<html>login</html>'))).toBeNull();
    expect(fontMime(new Uint8Array(5 * 1024 * 1024))).toBeNull();
  });

  it.each([
    'https://yuketang.cn.evil.com/a',
    'https://example.com/a',
    'file:///tmp/font',
    'http://pro.yuketang.cn/a',
    'https://user:secret@pro.yuketang.cn/a',
    'https://pro.yuketang.cn:8443/a',
  ])('rejects non-platform font/image proxy target %s', (url) => {
    expect(isAssignmentAssetUrl(url)).toBe(false);
  });

  it('shares pending fetches, caches fonts and isolates session and version', async () => {
    let account = 'user-one';
    const fetch = vi.fn(async () => response());
    const cache = await makeCache();
    const assets = new AssignmentAssets(fetch, cache, async () => account);
    const values = await Promise.all([
      assets.get(fontUrl, 'font'),
      assets.get(fontUrl, 'font'),
    ]);
    expect(values[0]).toEqual(values[1]);
    await assets.get(fontUrl, 'font');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      credentials: 'include',
      redirect: 'manual',
      referrer: 'https://pro.yuketang.cn/',
    });
    expect(fetch.mock.calls[0]?.[1]?.headers).not.toHaveProperty('cookie');
    account = 'user-two';
    await assets.get(fontUrl, 'font');
    await assets.get(fontUrl.replace('v=1', 'v=2'), 'font');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('backs off failures, allows one forced retry and retries after backoff without sticky rejected promises', async () => {
    let now = Date.now();
    const fetch = vi.fn(
      async () =>
        new Response('<html>login</html>', {
          headers: { 'content-type': 'text/html' },
        }),
    );
    const assets = new AssignmentAssets(
      fetch,
      await makeCache(),
      async () => 'scope',
      () => now,
    );
    await expect(assets.get(fontUrl, 'font')).rejects.toThrow();
    await expect(assets.get(fontUrl, 'font')).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(assets.get(fontUrl, 'font', true)).rejects.toThrow();
    await expect(assets.get(fontUrl, 'font', true)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(2);
    now += 10 * 60 * 1000;
    fetch.mockImplementation(async () => response());
    await expect(assets.get(fontUrl, 'font')).resolves.toHaveProperty(
      'dataUrl',
    );
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('checks redirected destinations before issuing the next request', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://example.com/stolen' },
        }),
    );
    const assets = new AssignmentAssets(
      fetch,
      await makeCache(),
      async () => 'scope',
    );
    await expect(assets.get(fontUrl, 'font')).rejects.toThrow('重定向');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('bounds resource concurrency and streams with a size limit', async () => {
    let running = 0,
      peak = 0;
    const fetch = vi.fn(async () => {
      peak = Math.max(peak, ++running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running--;
      return response();
    });
    const assets = new AssignmentAssets(
      fetch,
      await makeCache(),
      async () => 'scope',
    );
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        assets.get(`${fontUrl}&n=${i}`, 'font'),
      ),
    );
    expect(peak).toBe(4);
    const big = new AssignmentAssets(
      async () => new Response(new Uint8Array(4 * 1024 * 1024 + 1)),
      await makeCache(),
      async () => 'scope',
    );
    await expect(big.get(fontUrl, 'font')).rejects.toThrow('过大');
  });

  it('validates cached bytes and expiry before reusing a font', async () => {
    const cache = await makeCache();
    const fetch = vi.fn(async () => response());
    const assets = new AssignmentAssets(fetch, cache, async () => 'scope');
    await assets.get(fontUrl, 'font');
    const match = vi.spyOn(cache, 'match');
    match.mockResolvedValueOnce({
      url: fontUrl,
      body: Buffer.from('<html>login</html>'),
      contentType: 'font/ttf',
      etag: null,
      lastModified: null,
      expiresAt: Date.now() + 1000,
      stale: false,
    });
    await assets.get(fontUrl, 'font');
    expect(fetch).toHaveBeenCalledTimes(2);
    match.mockResolvedValueOnce({
      url: fontUrl,
      body: font(),
      contentType: 'font/ttf',
      etag: null,
      lastModified: null,
      expiresAt: Date.now() - 1,
      stale: true,
    });
    await assets.get(fontUrl, 'font');
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
