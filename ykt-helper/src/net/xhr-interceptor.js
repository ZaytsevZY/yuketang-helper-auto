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
    if (hostname === 'www.yuketang.cn') { console.log('[雨课堂助手][INFO] 检测到标准雨课堂环境'); return 'standard'; }
    if (hostname === 'pro.yuketang.cn') { console.log('[雨课堂助手][INFO] 检测到荷塘雨课堂环境'); return 'pro'; }
    if (hostname === 'changjiang.yuketang.cn') { console.log('[雨课堂助手][INFO] 检测到长江雨课堂环境'); return 'changjiang'; }
    console.log('[雨课堂助手][ERR] 未知环境:', hostname); return 'unknown';
  }

  MyXHR.addHandler((xhr, method, url) => {
    const envType = detectEnvironmentAndAdaptAPI();
    const pathname = url.pathname || '';
    console.log('[雨课堂助手][INFO] XHR请求:', method, pathname, url.search);

    // 课件：精确路径或包含关键字
    if (
      pathname === '/api/v3/lesson/presentation/fetch' ||
      (pathname.includes('presentation') && pathname.includes('fetch'))
    ) {
      console.log('[雨课堂助手][INFO] 拦截课件请求');
      xhr.intercept((resp) => {
        const id = url.searchParams.get('presentation_id');
        console.log('[雨课堂助手][INFO] 课件响应:', resp);
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
      console.log('[雨课堂助手][INFO] 拦截答题请求');
      xhr.intercept((resp, payload) => {
        try {
          const { problemId, result } = JSON.parse(payload || '{}');
          if (resp && (resp.code === 0 || resp.success)) {
            actions.onAnswerProblem(problemId, result);
          }
        } catch (e) {
          console.error('[雨课堂助手][ERR] 解析答题响应失败:', e);
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
      console.log('[雨课堂助手][WARN] 其他API:', method, pathname);
    }
  });

  gm.uw.XMLHttpRequest = MyXHR;

}

// ===== 自动进入课堂所需的最小 API 封装 =====
// 说明：使用 fetch，浏览器自动带上 cookie；与拦截器互不影响

/** 拉取“正在上课”的课堂列表 */
/** 拉取“正在上课”的课堂列表（多端候选 + 详细日志） */
export async function getOnLesson() {
  const origin = location.origin;
  const same = (p) => new URL(p, origin).toString();
  const candidates = [
    same('/api/v3/classroom/on-lesson'),
    same('/mooc-api/v1/lms/classroom/on-lesson'),
    same('/apiv3/classroom/on-lesson'),
  ];

  const tries = [];
  let finalList = [];
  let lastErr = null;

  for (const url of candidates) {
    const item = { url, ok: false, status: 0, note: '' };
    try {
      const r = await fetch(url, { credentials: 'include' });
      item.status = r.status;
      if (!r.ok) {
        item.note = `HTTP ${r.status}`;
        tries.push(item);
        continue;
      }
      const text = await r.text();
      // 打个缩略，避免把整段 JSON 打爆
      item.bodySnippet = text.slice(0, 300);
      let j = {};
      try { j = JSON.parse(text); } catch (_) { item.note = 'JSON parse failed'; }
      const list = j?.data?.onLessonClassrooms || j?.result || j?.data || [];
      item.parsedLength = Array.isArray(list) ? list.length : -1;
      if (Array.isArray(list) && list.length) {
        item.ok = true;
        tries.push(item);
        finalList = list;
        break;
      } else {
        item.note ||= 'empty list';
        tries.push(item);
      }
    } catch (e) {
      item.note = (e && e.message) || 'fetch error';
      tries.push(item);
      lastErr = e;
    }
  }

  // 统一打印调试信息（折叠组，方便查看）
  try {
    console.groupCollapsed(
      `%c[getOnLesson] host=%s  result=%s  candidates=%d`,
      'color:#09f',
      location.hostname,
      finalList.length ? `OK(${finalList.length})` : 'EMPTY',
      candidates.length
    );
      tries.forEach((t, i) => {
      console.log(
        `#${i+1}`,
        { url: t.url, ok: t.ok, status: t.status, note: t.note, parsedLength: t.parsedLength, bodySnippet: t.bodySnippet }
      );
    });
    if (!finalList.length && lastErr) console.warn('[getOnLesson] last error:', lastErr);
    console.groupEnd();
  } catch {}

  return finalList;
}

// src/net/xhr-interceptor.js
export async function checkinClass(lessonId, opts = {}) {
  const origin = location.origin;
  const same = (p) => new URL(p, origin).toString();
  const classroomId = opts?.classroomId;

  const headers = {
    'content-type': 'application/json',
    'xtbz': 'ykt',
  };

  // 针对不同网关，使用各自的 payload 形态
  const candidates = [
    {
      url: same('/api/v3/lesson/checkin'),
      payload: { lessonId, ...(classroomId ? { classroomId } : {}) }, // v3: 驼峰
      name: 'v3-same',
    },
    {
      url: 'https://pro.yuketang.cn/api/v3/lesson/checkin',
      payload: { lessonId, ...(classroomId ? { classroomId } : {}) },
      name: 'v3-pro',
    },
    {
      url: 'https://www.yuketang.cn/api/v3/lesson/checkin',
      payload: { lessonId, ...(classroomId ? { classroomId } : {}) },
      name: 'v3-www',
    },
    {
      url: same('/mooc-api/v1/lms/lesson/checkin'),
      payload: { lesson_id: lessonId, ...(classroomId ? { classroom_id: classroomId } : {}) }, // 旧网关：蛇形
      name: 'mooc-same',
    },
    {
      url: same('/apiv3/lesson/checkin'),
      payload: { lessonId, ...(classroomId ? { classroomId } : {}) },
      name: 'apiv3-same',
    },
  ];

  const tries = [];
  let lastErr;

  for (const cand of candidates) {
    const item = { url: cand.url, name: cand.name, status: 0, note: '' };
    try {
      const resp = await fetch(cand.url, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify(cand.payload),
      });
      item.status = resp.status;
      const text = await resp.text().catch(() => '');
      item.bodySnippet = text.slice(0, 300);

      if (!resp.ok) {
        item.note = `HTTP ${resp.status}`;
        // 如果 400/401/403，继续试下一条
        tries.push(item);
        continue;
      }

      let data = {};
      try { data = JSON.parse(text); } catch { item.note = 'JSON parse failed'; }
      const token =
        data?.data?.lessonToken ||
        data?.result?.lessonToken ||
        data?.lessonToken;

      const setAuth = resp.headers.get('Set-Auth') || resp.headers.get('set-auth') || null;
      item.note = token ? 'OK' : 'no token in body';
      tries.push(item);

      if (token) {
        try {
          console.groupCollapsed('%c[checkinClass] OK %s', 'color:#0a0', cand.name);
          console.log('payload:', cand.payload);
          console.log('setAuth:', !!setAuth);
          console.groupEnd();
        } catch {}
        return { token, setAuth, raw: data };
      }
    } catch (e) {
      item.note = e.message || 'fetch error';
      tries.push(item);
      lastErr = e;
    }
  }

  try {
    console.groupCollapsed('%c[checkinClass] FAILED host=%s', 'color:#f33', location.hostname);
    console.log('lessonId:', lessonId, 'classroomId:', classroomId);
    tries.forEach((t, i) => console.log(`#${i + 1}`, t));
    if (lastErr) console.warn('lastErr:', lastErr);
    console.groupEnd();
  } catch {}
  // 抛给上层，由上层走“直跳 lesson 页”的兜底逻辑
  throw new Error('checkinClass HTTP 400');
}

/** 获取当前/最近激活的 presentationId（多候选，自适配不同网关） */
export async function getActivePresentationId(lessonId) {
  const origin = location.origin;
  const same = (p) => new URL(p, origin).toString();
  // 常见候选：不同环境接口命名不一，这里都试一下
  const qs = (id) => `?lessonId=${encodeURIComponent(id)}`;
  const candidates = [
    same(`/api/v3/lesson/presentation/active${qs(lessonId)}`),
    same(`/api/v3/lesson/presentation/current${qs(lessonId)}`),
    same(`/api/v3/lesson/presentation${qs(lessonId)}`),
    same(`/apiv3/lesson/presentation${qs(lessonId)}`),
    same(`/mooc-api/v1/lms/lesson/presentation${qs(lessonId)}`),
  ];

  for (const url of candidates) {
    try {
      const r = await fetch(url, { credentials: 'include' });
      if (!r.ok) continue;
      const j = await r.json().catch(() => ({}));
      // 兼容多种返回结构
      const fromData = j?.data || j?.result || j;
      if (!fromData) continue;
      // 可能直接是对象 {presentationId: xxx}，也可能在列表里
      const pid =
        fromData.presentationId ||
        fromData.presentation_id ||
        (Array.isArray(fromData) && (fromData[0]?.presentationId || fromData[0]?.presentation_id));
      if (pid) {
        console.log('[雨课堂助手][DBG][getActivePresentationId] OK', { url, presentationId: pid });
        return String(pid);
      }
    } catch (e) {
      // 忽略，试下一个
    }
  }
  console.warn('[雨课堂助手][WARN][getActivePresentationId] no pid found for lesson', lessonId);
  return null;
}