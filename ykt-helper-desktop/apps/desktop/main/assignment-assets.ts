import { createHash } from 'node:crypto';
import type { ResourceCache } from '@ykt/storage';
import type { AssignmentAsset } from '@ykt/contracts';

const TTL = 7 * 24 * 60 * 60 * 1000;
const BACKOFF = 10 * 60 * 1000;
const LIMITS = { font: 4 * 1024 * 1024, image: 12 * 1024 * 1024 };

export function isAssignmentAssetUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      (!u.port || u.port === '443') &&
      ['yuketang.cn', 'xuetangx.com', 'xuetangx.cn'].some(
        (domain) => u.hostname === domain || u.hostname.endsWith(`.${domain}`),
      )
    );
  } catch {
    return false;
  }
}

export function fontMime(bytes: Uint8Array): string | null {
  if (bytes.length < 60 || bytes.length > LIMITS.font) return null;
  const magic = Buffer.from(bytes.subarray(0, 4)).toString('latin1');
  return (
    (
      {
        wOF2: 'font/woff2',
        wOFF: 'font/woff',
        OTTO: 'font/otf',
        '\x00\x01\x00\x00': 'font/ttf',
      } as Record<string, string>
    )[magic] ?? null
  );
}

function imageMime(bytes: Uint8Array): string | null {
  const b = Buffer.from(bytes);
  if (b.length < 12) return null;
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'image/png';
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return 'image/jpeg';
  if (/^GIF8[79]a/.test(b.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (
    b.subarray(0, 4).toString() === 'RIFF' &&
    b.subarray(8, 12).toString() === 'WEBP'
  )
    return 'image/webp';
  // Active SVG documents are deliberately not proxied as images.
  return null;
}

export class AssignmentAssets {
  private pending = new Map<string, Promise<AssignmentAsset>>();
  private failures = new Map<string, number>();
  private forced = new Map<string, number>();
  private active = 0;
  private queue: (() => void)[] = [];

  constructor(
    private readonly fetch: (
      url: string,
      init: RequestInit,
    ) => Promise<Response>,
    private readonly cache: ResourceCache,
    private readonly scope: () => Promise<string>,
    private readonly now = Date.now,
  ) {}

  async get(
    url: string,
    kind: 'font' | 'image',
    force = false,
  ): Promise<AssignmentAsset> {
    if (!isAssignmentAssetUrl(url))
      throw new Error('此资源地址不受支持，请在官网查看。');
    const account = await this.scope();
    // Never persist Cookie values; account/session changes isolate successful cache and backoff.
    const key = `https://assignment-cache.invalid/${createHash('sha256')
      .update(account + '\0' + kind + '\0' + url)
      .digest('hex')}`;
    const pending = this.pending.get(key);
    if (pending) return pending;
    const now = this.now();
    for (const map of [this.failures, this.forced]) {
      for (const [k, time] of map)
        if (now - time >= BACKOFF || now < time) map.delete(k);
    }
    const forceAllowed = force && !this.forced.has(key);
    if (this.failures.has(key) && !forceAllowed)
      throw new Error('资源暂不可用，请稍后重试或在官网查看。');
    if (forceAllowed) this.forced.set(key, now);
    const job = this.load(url, key, kind, forceAllowed)
      .catch((error) => {
        this.failures.set(key, this.now());
        throw error;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, job);
    return job;
  }

  private async load(
    url: string,
    key: string,
    kind: 'font' | 'image',
    force: boolean,
  ): Promise<AssignmentAsset> {
    if (kind === 'font' && !force) {
      const cached = await this.cache.match(key).catch(() => null);
      if (cached && !cached.stale && cached.expiresAt <= this.now() + TTL) {
        const mime = fontMime(cached.body);
        if (mime && cached.contentType === mime)
          return {
            dataUrl: `data:${mime};base64,${Buffer.from(cached.body).toString('base64')}`,
          };
      }
    }
    if (this.active >= 4)
      await new Promise<void>((resolve) => this.queue.push(resolve));
    else this.active++;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        let target = url;
        let response: Response | undefined;
        for (let redirects = 0; redirects <= 3; redirects++) {
          if (!isAssignmentAssetUrl(target))
            throw new Error('资源重定向地址不受支持。');
          response = await this.fetch(target, {
            method: 'GET',
            credentials: 'include',
            redirect: 'manual',
            referrer: 'https://pro.yuketang.cn/',
            headers: { referer: 'https://pro.yuketang.cn/' },
            signal: controller.signal,
            ...(force ? { cache: 'reload' as const } : {}),
          });
          if (![301, 302, 303, 307, 308].includes(response.status)) break;
          const location = response.headers.get('location');
          await response.body?.cancel();
          if (!location) throw new Error('资源重定向无效。');
          target = new URL(location, target).href;
        }
        if (!response?.ok || !response.body) throw new Error('资源下载失败。');
        const limit = LIMITS[kind];
        if (Number(response.headers.get('content-length')) > limit) {
          await response.body.cancel();
          throw new Error('资源过大。');
        }
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > limit) throw new Error('资源过大。');
            chunks.push(value);
          }
        } finally {
          await reader.cancel().catch(() => undefined);
        }
        const bytes = Buffer.concat(chunks);
        const mime = kind === 'font' ? fontMime(bytes) : imageMime(bytes);
        const declared = response.headers
          .get('content-type')
          ?.split(';')[0]
          ?.trim()
          .toLowerCase();
        if (!mime || (declared && /(?:html|json|text\/)/.test(declared)))
          throw new Error('资源格式无效。');
        if (kind === 'font')
          await this.cache
            .put(key, {
              body: bytes,
              headers: {
                'content-type': mime,
                'cache-control': `max-age=${TTL / 1000}`,
              },
            })
            .catch(() => null);
        this.failures.delete(key);
        return { dataUrl: `data:${mime};base64,${bytes.toString('base64')}` };
      } finally {
        clearTimeout(timer);
      }
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.active--;
    }
  }
}
