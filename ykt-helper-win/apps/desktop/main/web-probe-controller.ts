import { createHash } from 'node:crypto';
import type {
  NetworkEntry,
  WebProbeAsset,
  WebProbeEvidence,
  WebProbeReport,
  WebProbeRequest,
  WebProbeResponse,
} from '@ykt/contracts';
import { sanitizeHeaders, sanitizeText, sanitizeUrl } from '@ykt/routing';
import type { WebSourceAnalysis } from './web-source-analysis.js';

export interface WebProbePage {
  url: string;
  assets: { url: string; discoveredBy: 'page' | 'loaded' }[];
  fetch: (url: string, options: RequestInit) => Promise<Response>;
  authorization: () => Promise<string | null>;
}
type Analyze = (
  source: string,
  url: string,
  signal: AbortSignal,
) => Promise<WebSourceAnalysis>;
const SOURCE_LIMIT = 8 * 1024 * 1024;
const CACHE_LIMIT = 32 * 1024 * 1024;
const RESPONSE_LIMIT = 64 * 1024;
const ASSET_LIMIT = 500;

export class WebProbeController {
  #report: WebProbeReport | null = null;
  #sources = new Map<string, string>();
  #urls = new Map<string, string>();
  #bytes = 0;
  #operation: AbortController | null = null;

  constructor(
    private readonly page: () => Promise<WebProbePage>,
    private readonly entries: () => readonly NetworkEntry[],
    private readonly analyze: Analyze,
  ) {}

  snapshot(): WebProbeReport | null {
    return this.#report;
  }
  cancel(): void {
    this.#operation?.abort(new Error('探测已停止'));
  }

  async scan(): Promise<WebProbeReport> {
    return this.exclusive(async (signal) => {
      const page = await this.page();
      assertWebProbeUrl(page.url);
      this.#sources.clear();
      this.#urls.clear();
      this.#bytes = 0;
      this.#report = {
        version: 1,
        pageUrl: sanitizeUrl(page.url),
        analyzedAt: new Date().toISOString(),
        assets: [],
        findings: [],
        observed: [],
        warnings: [],
        probes: [],
      };
      for (const asset of page.assets) this.addAsset(asset);
      // The selected page's script/performance inventory includes loaded lazy
      // chunks. Unloaded manifest candidates are analyzed only on demand.
      const initial = this.#report.assets.slice(0, 12);
      for (const asset of initial) {
        signal.throwIfAborted();
        await this.loadAsset(page, asset.url, signal);
      }
      if (this.#report.assets.some((asset) => asset.status === 'pending'))
        this.warn('仍有脚本未分析');
      if (!initial.length) this.warn('当前页面没有外部脚本');
      this.observe(page.url);
      return this.#report;
    });
  }

  async analyzeAsset(url: unknown): Promise<WebProbeReport> {
    if (
      typeof url !== 'string' ||
      !this.#report?.assets.some((asset) => asset.url === url)
    )
      throw new Error('请选择已发现的脚本');
    return this.exclusive(async (signal) => {
      const page = await this.samePage();
      await this.loadAsset(page, url, signal);
      this.observe(page.url);
      return this.#report!;
    });
  }

  search(query: unknown): readonly WebProbeEvidence[] {
    if (
      typeof query !== 'string' ||
      query.trim().length < 2 ||
      query.length > 200
    )
      throw new Error('关键词长度应为 2–200 个字符');
    const hits: WebProbeEvidence[] = [];
    for (const [url, source] of this.#sources) {
      const lineStarts = [
        0,
        ...Array.from(source.matchAll(/\n/g), (match) => match.index! + 1),
      ];
      let offset = source.indexOf(query);
      while (offset >= 0 && hits.length < 100) {
        let low = 0;
        let high = lineStarts.length;
        while (low + 1 < high) {
          const mid = (low + high) >>> 1;
          if (lineStarts[mid]! <= offset) low = mid;
          else high = mid;
        }
        hits.push({
          sourceUrl: url,
          offset,
          line: low + 1,
          column: offset - lineStarts[low]! + 1,
          snippet: sanitizeText(
            source.slice(
              Math.max(0, offset - 250),
              offset + query.length + 750,
            ),
          ),
        });
        offset = source.indexOf(query, offset + query.length);
      }
      if (hits.length >= 100) break;
    }
    return hits;
  }

  async probe(input: unknown): Promise<WebProbeResponse> {
    const request = validateRequest(input);
    return this.exclusive(async (signal) => {
      const page = await this.samePage();
      const url = new URL(request.url, page.url);
      assertWebProbeUrl(url.href);
      if (url.origin !== new URL(page.url).origin)
        throw new Error('GET 探测仅限当前页面同源接口');
      if (/[{}]/.test(decodeURIComponent(url.href)))
        throw new Error('请先填写路径和查询参数中的占位符');
      const headers: Record<string, string> = {
        XTBZ: request.xtbz ?? 'ykt',
        'X-Client': 'h5',
        Accept: 'application/json',
        Referer: page.url,
      };
      const token = await page.authorization();
      if (token)
        headers.Authorization = /^Bearer\s/i.test(token)
          ? token
          : `Bearer ${token}`;
      const start = Date.now();
      // Never follow an API redirect with session credentials. Keep 3xx and
      // application-level errors visible as evidence instead of guessing status.
      const response = await page.fetch(url.href, {
        method: 'GET',
        credentials: 'include',
        headers,
        redirect: 'manual',
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      });
      const body = await readBounded(response, RESPONSE_LIMIT, true);
      const result: WebProbeResponse = {
        url: sanitizeUrl(url.href),
        timestamp: new Date().toISOString(),
        statusCode: response.status,
        durationMs: Date.now() - start,
        headers: sanitizeHeaders(
          Object.fromEntries(response.headers.entries()),
        ),
        body: sanitizeText(body.text),
        truncated: body.truncated,
      };
      this.#report = {
        ...this.#report!,
        probes: [...this.#report!.probes.slice(-19), result],
      };
      return result;
    });
  }

  private async samePage(): Promise<WebProbePage> {
    const page = await this.page();
    assertWebProbeUrl(page.url);
    if (!this.#report || sanitizeUrl(page.url) !== this.#report.pageUrl)
      throw new Error('页面已变更，请重新分析当前页面');
    return page;
  }

  private async exclusive<T>(
    action: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (this.#operation) throw new Error('已有探测正在进行');
    const operation = new AbortController();
    this.#operation = operation;
    try {
      return await action(operation.signal);
    } finally {
      this.#operation = null;
    }
  }

  private addAsset(asset: {
    url: string;
    discoveredBy: WebProbeAsset['discoveredBy'];
  }): void {
    try {
      assertWebProbeUrl(asset.url);
    } catch {
      this.warn('已忽略非雨课堂 HTTPS 脚本');
      return;
    }
    const url = sanitizeUrl(asset.url);
    if (this.#urls.has(url)) return;
    if (this.#urls.size >= ASSET_LIMIT) {
      this.warn(`脚本清单达到 ${ASSET_LIMIT} 条上限`);
      return;
    }
    this.#urls.set(url, asset.url);
    this.#report = {
      ...this.#report!,
      assets: [
        ...this.#report!.assets,
        {
          ...asset,
          url,
          status: 'pending',
          bytes: null,
          sha256: null,
          error: null,
        },
      ],
    };
  }

  private async loadAsset(
    page: WebProbePage,
    key: string,
    signal: AbortSignal,
  ): Promise<void> {
    if (
      this.#sources.has(key) &&
      this.#report?.assets.find((asset) => asset.url === key)?.status ===
        'analyzed'
    )
      return;
    const previousSource = this.#sources.get(key);
    if (previousSource !== undefined) {
      this.#bytes -= Buffer.byteLength(previousSource);
      this.#sources.delete(key);
    }
    try {
      if (this.#bytes >= CACHE_LIMIT)
        throw new Error('脚本缓存达到 32 MiB 上限');
      let url = this.#urls.get(key)!;
      let response: Response | undefined;
      for (let redirects = 0; redirects <= 3; redirects++) {
        assertWebProbeUrl(url);
        response = await page.fetch(url, {
          method: 'GET',
          credentials: 'omit',
          redirect: 'manual',
          signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
        });
        if (response.status < 300 || response.status >= 400) break;
        await response.body?.cancel();
        const location = response.headers.get('location');
        if (!location || redirects === 3)
          throw new Error('脚本重定向过多或缺少目标');
        url = new URL(location, url).href;
      }
      if (!response?.ok)
        throw new Error(`脚本下载失败：HTTP ${response?.status ?? 0}`);
      const mime = response.headers.get('content-type') ?? '';
      if (/text\/html|application\/json/i.test(mime)) {
        await response.body?.cancel();
        throw new Error('返回内容不是 JavaScript');
      }
      const { text: source, bytes } = await readBounded(
        response,
        Math.min(SOURCE_LIMIT, CACHE_LIMIT - this.#bytes),
      );
      signal.throwIfAborted();
      const analysis = await this.analyze(source, key, signal);
      this.#sources.set(key, source);
      this.#bytes += bytes;
      const findings = analysis.findings.map((finding) => ({
        ...finding,
        path: sanitizeText(finding.path),
        evidence: {
          ...finding.evidence,
          snippet: sanitizeText(finding.evidence.snippet),
        },
      }));
      this.#report = {
        ...this.#report!,
        findings: [...this.#report!.findings, ...findings].slice(0, 15_000),
      };
      if (this.#report.findings.length >= 15_000)
        this.warn('候选清单达到 15000 条上限');
      this.updateAsset(key, {
        status: analysis.warnings.some((value) =>
          value.startsWith('脚本解析失败'),
        )
          ? 'error'
          : 'analyzed',
        bytes,
        sha256: createHash('sha256').update(source).digest('hex'),
        error: analysis.warnings.join('；') || null,
      });
      for (const warning of analysis.warnings) this.warn(`${key}: ${warning}`);
      for (const asset of analysis.assets) this.addAsset(asset);
    } catch (error) {
      signal.throwIfAborted();
      this.updateAsset(key, {
        status: 'error',
        error: sanitizeText(
          error instanceof Error ? error.message : '脚本分析失败',
        ),
      });
    }
  }

  private updateAsset(url: string, patch: Partial<WebProbeAsset>): void {
    this.#report = {
      ...this.#report!,
      assets: this.#report!.assets.map((asset) =>
        asset.url === url ? { ...asset, ...patch } : asset,
      ),
    };
  }
  private warn(value: string): void {
    if (this.#report && !this.#report.warnings.includes(value))
      this.#report = {
        ...this.#report,
        warnings: [...this.#report.warnings, value].slice(0, 100),
      };
  }
  private observe(pageUrl: string): void {
    const seen = new Map<string, WebProbeReport['observed'][number]>();
    for (const entry of this.entries()) {
      if (
        entry.kind !== 'http' ||
        !['XHR', 'Fetch'].includes(entry.resourceType)
      )
        continue;
      try {
        const url = new URL(entry.url);
        if (url.origin !== new URL(pageUrl).origin) continue;
        seen.set(`${entry.method}:${url.pathname}`, {
          method: entry.method,
          url: sanitizeUrl(url.href),
          statusCode: entry.statusCode,
          parameters: [...new Set(url.searchParams.keys())],
        });
      } catch {
        /* Ignore malformed capture entries. */
      }
    }
    this.#report = {
      ...this.#report!,
      observed: [...seen.values()].slice(-500),
    };
  }
}

export function assertWebProbeUrl(value: string): void {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !(url.hostname === 'yuketang.cn' || url.hostname.endsWith('.yuketang.cn'))
  )
    throw new Error('仅支持雨课堂 HTTPS 地址');
}
function validateRequest(input: unknown): WebProbeRequest {
  if (!input || typeof input !== 'object') throw new Error('无效探测请求');
  const { url, xtbz } = input as WebProbeRequest;
  if (
    typeof url !== 'string' ||
    !url.trim() ||
    url.length > 4000 ||
    (xtbz !== undefined &&
      (typeof xtbz !== 'string' || !/^[\w-]{1,40}$/.test(xtbz)))
  )
    throw new Error('无效探测网址或 XTBZ');
  return { url, ...(xtbz !== undefined ? { xtbz } : {}) };
}
export async function readBounded(
  response: Response,
  limit: number,
  allowTruncation = false,
): Promise<{ text: string; bytes: number; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) return { text: '', bytes: 0, truncated: false };
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (bytes + value.length > limit) {
        if (!allowTruncation)
          throw new Error(`正文超过 ${Math.round(limit / 1024)} KiB 上限`);
        chunks.push(value.slice(0, limit - bytes));
        bytes = limit;
        truncated = true;
        break;
      }
      chunks.push(value);
      bytes += value.length;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return { text: Buffer.concat(chunks).toString('utf8'), bytes, truncated };
}
