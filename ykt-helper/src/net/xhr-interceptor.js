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

  MyXHR.addHandler((xhr, method, url) => {
    if (url.pathname === '/api/v3/lesson/presentation/fetch') {
      xhr.intercept((resp) => {
        const id = url.searchParams.get('presentation_id');
        if (resp?.code === 0) actions.onPresentationLoaded(id, resp.data);
      });
    }
    if (url.pathname === '/api/v3/lesson/problem/answer') {
      xhr.intercept((resp, payload) => {
        try {
          const { problemId, result } = JSON.parse(payload || '{}');
          if (resp?.code === 0) actions.onAnswerProblem(problemId, result);
        } catch {}
      });
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
    }
  });

  gm.uw.XMLHttpRequest = MyXHR;
}
