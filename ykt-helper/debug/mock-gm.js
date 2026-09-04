// Local browser host for userscript, extension and Electron/WebView smoke tests.
// Business transports stay mocked; AI GM requests use the loopback allowlisted proxy.
(function installYktMockRuntime() {
  'use strict';

  const nativeFetch = window.fetch.bind(window);

  const state = {
    online: true,
    fixtures: null,
    requests: [],
    sockets: new Set(),
    sequence: 0,
  };
  const vueWatchers = new Set();

  try {
    sessionStorage.setItem('__ykt_helper_auto_reload_once__', '1');
    const query = new URLSearchParams(location.search);
    query.set('ykt_mock', '1');
    history.replaceState({}, '', `/lesson/fullscreen/v3/mock-lesson/exercise/3?${query}`);
  } catch (_) {}

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function record(kind, detail) {
    const entry = { id: ++state.sequence, at: Date.now(), kind, detail: clone(detail) };
    state.requests.push(entry);
    window.dispatchEvent(new CustomEvent('ykt-mock:log', { detail: entry }));
    return entry;
  }

  function jsonResponse(status, body) {
    return { status, body };
  }

  function parseBody(body) {
    if (typeof body !== 'string') return body || null;
    try { return JSON.parse(body); } catch (_) { return body; }
  }

  function route(method, rawUrl, body) {
    const url = new URL(rawUrl, location.origin);
    const path = url.pathname;
    const parsedBody = parseBody(body);
    record('http', { method, path, body: parsedBody });

    if (!state.online) return jsonResponse(503, { code: 503, msg: 'YKT mock network is offline' });
    if (path === '/api/v3/lesson/presentation/fetch') {
      return jsonResponse(200, { code: 0, data: clone(state.fixtures?.presentation || { slides: [] }) });
    }
    if (path === '/api/v3/lesson/problem/answer') {
      window.dispatchEvent(new CustomEvent('ykt-mock:answer', { detail: clone(parsedBody) }));
      return jsonResponse(200, { code: 0, data: { accepted: true }, msg: 'mock answer accepted' });
    }
    if (path === '/api/v3/lesson/problem/retry') {
      const id = parsedBody?.problems?.[0]?.problemId;
      return jsonResponse(200, { code: 0, data: { success: id == null ? [] : [id] }, msg: 'mock retry accepted' });
    }
    if (path.endsWith('/classroom/on-lesson')) {
      return jsonResponse(200, { code: 0, data: { onLessonClassrooms: [] } });
    }
    if (path.endsWith('/lesson/checkin')) {
      return jsonResponse(200, { code: 0, data: { lessonToken: 'mock-lesson-token' } });
    }
    if (path.includes('/lesson/presentation')) {
      return jsonResponse(200, { code: 0, data: { presentationId: state.fixtures?.presentationId || 'mock-presentation' } });
    }
    return jsonResponse(404, { code: 404, msg: `No mock route for ${method} ${path}` });
  }

  const mockStore = {
    state: { currSlide: null },
    watch(selector, callback) {
      const watcher = { selector, callback, previous: selector(this.state) };
      vueWatchers.add(watcher);
      return () => vueWatchers.delete(watcher);
    },
  };

  function setCurrentSlide(slide) {
    mockStore.state.currSlide = clone(slide);
    for (const watcher of vueWatchers) {
      const next = watcher.selector(mockStore.state);
      const previous = watcher.previous;
      watcher.previous = next;
      watcher.callback(next, previous);
    }
    record('vuex:curr-slide', mockStore.state.currSlide);
  }

  class MockXMLHttpRequest extends EventTarget {
    constructor() {
      super();
      this.readyState = 0;
      this.status = 0;
      this.responseText = '';
      this.response = '';
      this.responseType = '';
      this.requestHeaders = {};
      this.responseHeaders = { 'content-type': 'application/json' };
      this.method = 'GET';
      this.url = '';
    }
    open(method, url, async = true) {
      this.method = String(method || 'GET').toUpperCase();
      this.url = new URL(url, location.origin).toString();
      this.async = async !== false;
      this.readyState = 1;
      this._emit('readystatechange');
    }
    setRequestHeader(name, value) { this.requestHeaders[String(name).toLowerCase()] = String(value); }
    getResponseHeader(name) { return this.responseHeaders[String(name).toLowerCase()] || null; }
    getAllResponseHeaders() { return 'content-type: application/json\r\n'; }
    send(body = null) {
      this.requestBody = body;
      const complete = () => {
        const result = route(this.method, this.url, body);
        this.status = result.status;
        this.readyState = 4;
        this.responseText = JSON.stringify(result.body);
        this.response = this.responseType === 'json' ? clone(result.body) : this.responseText;
        this._emit('readystatechange');
        this._emit(result.status >= 200 && result.status < 400 ? 'load' : 'error');
        this._emit('loadend');
      };
      window.setTimeout(complete, 0);
    }
    abort() { this.readyState = 0; this._emit('abort'); }
    _emit(type) {
      const event = new Event(type);
      this.dispatchEvent(event);
      const handler = this[`on${type}`];
      if (typeof handler === 'function') handler.call(this, event);
    }
  }

  class MockWebSocket extends EventTarget {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    constructor(url, protocols) {
      super();
      this.url = new URL(url, location.href).toString();
      this.protocols = protocols;
      this.readyState = MockWebSocket.CONNECTING;
      this.CONNECTING = 0;
      this.OPEN = 1;
      this.CLOSING = 2;
      this.CLOSED = 3;
      state.sockets.add(this);
      record('ws:connect', { url: new URL(this.url).pathname });
      window.setTimeout(() => {
        this.readyState = MockWebSocket.OPEN;
        this._emit('open', new Event('open'));
      }, 0);
    }
    send(data) { record('ws:send', parseBody(data)); }
    close(code = 1000, reason = 'mock close') {
      this.readyState = MockWebSocket.CLOSED;
      state.sockets.delete(this);
      this._emit('close', new CloseEvent('close', { code, reason, wasClean: true }));
    }
    _receive(message) {
      if (this.readyState !== MockWebSocket.OPEN) return;
      this._emit('message', new MessageEvent('message', { data: JSON.stringify(message) }));
    }
    _emit(type, event) {
      this.dispatchEvent(event);
      const handler = this[`on${type}`];
      if (typeof handler === 'function') handler.call(this, event);
    }
  }

  async function mockFetch(input, init = {}) {
    const url = typeof input === 'string' ? input : input?.url;
    const method = String(init.method || input?.method || 'GET').toUpperCase();
    const result = route(method, url, init.body);
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  window.__YKT_HELPER_DEBUG_MODE__ = true;
  const appRoot = document.querySelector('#app');
  if (appRoot) appRoot.__vue__ = { $store: mockStore };
  window.unsafeWindow = window;
  window.XMLHttpRequest = MockXMLHttpRequest;
  window.WebSocket = MockWebSocket;
  window.fetch = mockFetch;
  window.GM_addStyle = (css) => {
    const style = document.createElement('style');
    style.dataset.yktMockGmStyle = 'true';
    style.textContent = css;
    document.head.appendChild(style);
  };
  window.GM_notification = (options) => record('gm:notification', options);
  window.GM_getTab = (callback) => callback({ type: 'lesson', lessonId: 'mock-lesson' });
  window.GM_saveTab = (tab) => record('gm:save-tab', tab);
  window.GM_xmlhttpRequest = (options = {}) => {
    const controller = new AbortController();
    const method = String(options.method || 'GET').toUpperCase();
    const target = String(options.url || '');
    let safeTarget = target;
    try {
      const parsed = new URL(target);
      safeTarget = `${parsed.origin}${parsed.pathname}`;
    } catch (_) {}
    record('gm:xhr-proxy', { method, url: safeTarget });

    const timeout = Number(options.timeout || 0);
    const timer = timeout > 0 ? window.setTimeout(() => controller.abort('timeout'), timeout) : null;
    nativeFetch(`/__ykt_proxy__?url=${encodeURIComponent(target)}`, {
      method,
      headers: options.headers || {},
      body: method === 'GET' || method === 'HEAD' ? undefined : options.data,
      signal: controller.signal,
    }).then(async (response) => {
      if (timer) window.clearTimeout(timer);
      const responseText = await response.text();
      const result = {
        status: response.status,
        statusText: response.statusText,
        responseText,
        response: options.responseType === 'json' ? JSON.parse(responseText || 'null') : responseText,
        readyState: 4,
        finalUrl: target,
        responseHeaders: [...response.headers.entries()].map(([key, value]) => `${key}: ${value}`).join('\r\n'),
      };
      options.onload?.(result);
      options.onloadend?.(result);
    }).catch((error) => {
      if (timer) window.clearTimeout(timer);
      const result = { status: 0, error: error?.message || String(error), readyState: 4, finalUrl: target };
      if (controller.signal.aborted && controller.signal.reason === 'timeout') options.ontimeout?.(result);
      else options.onerror?.(result);
      options.onloadend?.(result);
    });
    return { abort: () => controller.abort('abort') };
  };

  window.__YKT_MOCK__ = Object.freeze({
    version: '2.0.0',
    setFixtures(fixtures) {
      state.fixtures = clone(fixtures);
      setCurrentSlide({
        sid: fixtures?.slideId || null,
        type: fixtures?.problem ? 'problem' : 'slide',
        problemID: fixtures?.problem?.problemId || null,
        index: 0,
      });
      record('fixture:set', { scenario: fixtures?.scenario, problemId: fixtures?.problem?.problemId });
    },
    setCurrentSlide,
    request(method, url, body) { return clone(route(String(method).toUpperCase(), url, body)); },
    emit(message) {
      record('ws:receive', message);
      for (const socket of state.sockets) socket._receive(clone(message));
      window.dispatchEvent(new CustomEvent('ykt-mock:signal', { detail: clone(message) }));
    },
    setOnline(online) {
      state.online = Boolean(online);
      record('network', { online: state.online });
      window.dispatchEvent(new CustomEvent('ykt-mock:network', { detail: { online: state.online } }));
      return state.online;
    },
    isOnline() { return state.online; },
    getSnapshot() {
      return clone({ online: state.online, fixtures: state.fixtures, requests: state.requests, socketCount: state.sockets.size });
    },
    clearLog() { state.requests.length = 0; state.sequence = 0; },
  });
})();
