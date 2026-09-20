import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { WebContents } from 'electron';
import type { WebSourceAnalysis } from './web-source-analysis.js';
import {
  assertWebProbeUrl,
  type WebProbePage,
} from './web-probe-controller.js';

export async function webProbePage(
  contents: WebContents,
): Promise<WebProbePage> {
  const url = contents.getURL();
  assertWebProbeUrl(url);
  // Fixed read-only inventory; remote script text is never evaluated. Resource
  // Timing catches lazy script elements that the SPA has already removed.
  const assets: WebProbePage['assets'] = await contents.executeJavaScript(
    `(() => [
    ...Array.from(document.scripts, s => ({url:s.src,discoveredBy:'page'})).filter(s => s.url),
    ...performance.getEntriesByType('resource').filter(r => r.initiatorType === 'script').map(r => ({url:r.name,discoveredBy:'loaded'}))
  ].slice(0, 1000))()`,
    false,
  );
  if (contents.getURL() !== url) throw new Error('页面已变更，请重试');
  return {
    url,
    assets,
    fetch: (target, options) => contents.session.fetch(target, options),
    authorization: async () => {
      if (contents.isDestroyed() || contents.getURL() !== url)
        throw new Error('页面已变更，请重试');
      const token: unknown = await contents.executeJavaScript(
        "localStorage.getItem('Authorization')",
        false,
      );
      if (contents.getURL() !== url) throw new Error('页面已变更，请重试');
      return typeof token === 'string' && token.length < 16_384 ? token : null;
    },
  };
}

export function analyzeInWorker(
  source: string,
  url: string,
  signal: AbortSignal,
): Promise<WebSourceAnalysis> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(join(__dirname, 'web-probe-worker.cjs'), {
      resourceLimits: { maxOldGenerationSizeMb: 512 },
    });
    let settled = false;
    const finish = (error: Error | null, result?: WebSourceAnalysis) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      void worker.terminate();
      if (error) reject(error);
      else resolve(result!);
    };
    const abort = () => finish(new Error('探测已停止'));
    const timer = setTimeout(() => finish(new Error('脚本解析超时')), 20_000);
    signal.addEventListener('abort', abort, { once: true });
    worker.once('message', (result: WebSourceAnalysis) => finish(null, result));
    worker.once('error', (error) => finish(error));
    worker.once('exit', (code) => {
      if (code !== 0) finish(new Error('脚本解析线程已退出'));
    });
    worker.postMessage({ source, url });
  });
}
