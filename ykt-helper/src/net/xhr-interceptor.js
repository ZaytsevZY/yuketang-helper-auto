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

// ===== 自动进入课堂所需的最小 API 封装 =====
// 说明：使用 fetch，浏览器自动带上 cookie；与拦截器互不影响

/** 拉取“正在上课”的课堂列表 */
export async function getOnLesson() {
  const url = '/api/v3/classroom/on-lesson';
  const resp = await fetch(url, { credentials: 'include' });
  if (!resp.ok) throw new Error(`getOnLesson HTTP ${resp.status}`);
  const data = await resp.json();
  // 常见返回结构：{ code:0, data:{ onLessonClassrooms:[{ lessonId, status, ... }] } }
  const list = data?.data?.onLessonClassrooms || data?.result || [];
  return Array.isArray(list) ? list : [];
}

/** 课堂 checkin，返回 { token, setAuth } */
export async function checkinClass(lessonId) {
  const url = '/api/v3/lesson/checkin';
  const resp = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ lessonId })
  });
  if (!resp.ok) throw new Error(`checkinClass HTTP ${resp.status}`);
  // 读取响应体（包含 lessonToken）与响应头（Set-Auth）
  const data = await resp.json();
  const token = data?.data?.lessonToken || data?.result?.lessonToken || data?.lessonToken;
  // Set-Auth 可能用于后续接口的 Authorization: Bearer <Set-Auth>（可选）
  const setAuth = resp.headers.get('Set-Auth') || resp.headers.get('set-auth') || null;
  return { token, setAuth, raw: data };
}