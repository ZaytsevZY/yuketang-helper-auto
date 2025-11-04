// src/net/xhr-interceptor.js
import { gm } from '../core/env.js';
import { actions } from '../state/actions.js';

export function installXHRInterceptor() {
  class MyXHR extends XMLHttpRequest {
    static handlers = [];
    static addHandler(h) { this.handlers.push(h); }
    open(method, url, async) {
      const parsed = new URL(url, location.href);
      for (const h of this.constructor.handlers) h(this, method, parsed);
      return super.open(method, url, async ?? true);
    }
    intercept(cb) {
      let payload;
      const rawSend = this.send;
      this.send = (body) => { payload = body; return rawSend.call(this, body); };
      this.addEventListener('load', () => {
        try { cb(JSON.parse(this.responseText), payload); } catch {}
      });
    }
  }

  function detectEnvironmentAndAdaptAPI() {
    const hostname = location.hostname;
    if (hostname === 'www.yuketang.cn') { console.log('[雨课堂助手] 检测到标准雨课堂环境'); return 'standard'; }
    if (hostname === 'pro.yuketang.cn') { console.log('[雨课堂助手] 检测到荷塘雨课堂环境'); return 'pro'; }
    console.log('[雨课堂助手] 未知环境:', hostname); return 'unknown';
  }

  MyXHR.addHandler((xhr, method, url) => {
    const envType = detectEnvironmentAndAdaptAPI();
    const pathname = url.pathname || '';
    console.log('[雨课堂助手] XHR请求:', method, pathname, url.search);

    // 课件：精确路径或包含关键字
    if (
      pathname === '/api/v3/lesson/presentation/fetch' ||
      (pathname.includes('presentation') && pathname.includes('fetch'))
    ) {
      console.log('[雨课堂助手] ✅ 拦截课件请求');
      xhr.intercept((resp) => {
        const id = url.searchParams.get('presentation_id');
        console.log('[雨课堂助手] 课件响应:', resp);
        if (resp && (resp.code === 0 || resp.success)) {
          actions.onPresentationLoaded(id, resp.data || resp.result);
        }
      });
      return;
    }

    // 答题
    if (
      pathname === '/api/v3/lesson/problem/answer' ||
      (pathname.includes('problem') && pathname.includes('answer'))
    ) {
      console.log('[雨课堂助手] ✅ 拦截答题请求');
      xhr.intercept((resp, payload) => {
        try {
          const { problemId, result } = JSON.parse(payload || '{}');
          if (resp && (resp.code === 0 || resp.success)) {
            actions.onAnswerProblem(problemId, result);
          }
        } catch (e) {
          console.error('[雨课堂助手] 解析答题响应失败:', e);
        }
      });
      return;
    }

    if (url.pathname === '/api/v3/lesson/problem/retry') {
      xhr.intercept((resp, payload) => {
        try {
          // retry 请求体是 { problems: [{ problemId, result, ...}] }
          const body = JSON.parse(payload || '{}');
          const first = Array.isArray(body?.problems) ? body.problems[0] : null;
          if (resp?.code === 0 && first?.problemId) {
            actions.onAnswerProblem(first.problemId, first.result);
          }
        } catch {}
      });
      return;
    }
    if (pathname.includes('/api/')) {
      console.log('[雨课堂助手] 其他API:', method, pathname);
    }
  });

  gm.uw.XMLHttpRequest = MyXHR;
}
