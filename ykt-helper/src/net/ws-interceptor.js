// src/net/ws-interceptor.js
import { gm } from '../core/env.js';
import { actions } from '../state/actions.js';

export function installWSInterceptor() {
  class MyWebSocket extends WebSocket {
    static handlers = [];
    static addHandler(h) { this.handlers.push(h); }
    constructor(url, protocols) {
      super(url, protocols);
      const parsed = new URL(url, location.href);
      for (const h of this.constructor.handlers) h(this, parsed);
    }
    intercept(cb) {
      const raw = this.send;
      this.send = (data) => { try { cb(JSON.parse(data)); } catch {} return raw.call(this, data); };
    }
    listen(cb) { this.addEventListener('message', (e) => { try { cb(JSON.parse(e.data)); } catch {} }); }
  }

  MyWebSocket.addHandler((ws, url) => {
    if (url.pathname === '/wsapp/') {
      ws.listen((msg) => {
        switch (msg.op) {
          case 'fetchtimeline': actions.onFetchTimeline(msg.timeline); break;
          case 'unlockproblem': actions.onUnlockProblem(msg.problem); break;
          case 'lessonfinished': actions.onLessonFinished(); break;
        }
      });
    }
  });

  gm.uw.WebSocket = MyWebSocket;
}
