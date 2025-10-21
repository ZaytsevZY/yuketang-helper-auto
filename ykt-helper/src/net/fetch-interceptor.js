/**
 * fetch 拦截器 (for Chrome 141+)
 * 作用：在站点改用 fetch() 时，仍能捕获课件数据
 */

import { repo } from '../state/repo.js';
import { actions } from '../state/actions.js';

(function interceptFetch() {
  if (window.__YKT_FETCH_PATCHED__) return;
  window.__YKT_FETCH_PATCHED__ = true;

  const rawFetch = window.fetch;
  window.fetch = async function (...args) {
    const [input, init] = args;
    const url = typeof input === 'string' ? input : input?.url || '';

    // === (1) 打印调试日志，可观察哪些接口走 fetch ===
    if (url.includes('lesson') || url.includes('slide') || url.includes('problem')) {
      console.log('[YKT][fetch-interceptor] 捕获请求:', url);
    }

    const resp = await rawFetch.apply(this, args);

    try {
      // === (2) 只拦截 Rain Classroom 的 JSON 接口 ===
      if (
        url.includes('/lesson') ||
        url.includes('/presentation') ||
        url.includes('/slides') ||
        url.includes('/problem')
      ) {
        const cloned = resp.clone();
        const text = await cloned.text();
        // 这里不能直接 resp.json()，否则流会被消费；必须 clone()
        const json = JSON.parse(text);

        // === (3) 关键：提取 slides 并灌入 repo.slides ===
        if (json && json.data && json.data.slides) {
          const slides = json.data.slides;
          let filled = 0;
          for (const s of slides) {
            const sid = String(s.id);
            if (!repo.slides.has(sid)) {
              repo.slides.set(sid, s);
              filled++;
            }
          }
          console.log(`[YKT][fetch-interceptor] 已填充 slides ${filled}/${slides.length}`);
        }
      }
    } catch (e) {
      console.warn('[YKT][fetch-interceptor] 解析响应失败:', e);
    }

    return resp; // 一定要返回原始 Response
  };

  console.log('[YKT][fetch-interceptor] ✅ fetch() 已被拦截');
})();
