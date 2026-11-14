(() => {
  if (window !== window.top || window.__yktMobileObserver) return;
  window.__yktMobileObserver = true;
  const lesson = () => /\/lesson\/fullscreen\/v3\/(\d+)/.exec(location.pathname)?.[1];
  const send = (kind, data, id) => {
    const lessonId = lesson();
    if (!lessonId || !window.YktClassroom) return;
    const payload = JSON.stringify({kind, lessonId, data, id});
    if (payload.length < 4 * 1024 * 1024) window.YktClassroom.postMessage(payload);
  };
  const presentationUrl = raw => {
    try {
      const url = new URL(raw, location.href);
      return url.origin === location.origin && url.pathname === '/api/v3/lesson/presentation/fetch' ? url : null;
    } catch (_) { return null; }
  };
  const capture = (raw, text) => {
    const url = presentationUrl(raw);
    if (!url || typeof text !== 'string') return;
    try { send('presentation', JSON.parse(text), url.searchParams.get('presentation_id') || url.searchParams.get('presentationId')); } catch (_) {}
  };
  const fetchOriginal = window.fetch;
  if (fetchOriginal) window.fetch = function(...args) {
    return fetchOriginal.apply(this, args).then(response => {
      if (response.ok && presentationUrl(response.url)) response.clone().text().then(text => capture(response.url, text)).catch(() => {});
      return response;
    });
  };
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(...args) {
    this.addEventListener('load', () => {
      if (this.status < 200 || this.status >= 300) return;
      try { capture(this.responseURL, this.responseType === 'json' ? JSON.stringify(this.response) : this.responseText); } catch (_) {}
    }, {once:true});
    return open.apply(this, args);
  };
  const NativeSocket = window.WebSocket;
  window.WebSocket = new Proxy(NativeSocket, {
    construct(target, args) {
      const socket = Reflect.construct(target, args);
      let valid = false;
      try { const u = new URL(args[0], location.href); valid = u.protocol === 'wss:' && u.host === location.host && u.pathname === '/wsapp/'; } catch (_) {}
      if (valid) socket.addEventListener('message', event => {
        if (typeof event.data === 'string') {
          try { send('event', JSON.parse(event.data)); } catch (_) {}
        }
      });
      return socket;
    }
  });
})();
