(function installLocalDebugLogger() {
  'use strict';

  const nativeFetch = window.fetch.bind(window);
  const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const role = location.pathname.includes('teacher') ? 'teacher' : location.pathname.includes('/lesson/') ? 'student' : 'debug';
  const queue = [];
  let flushTimer = null;

  function redactString(value) {
    return String(value)
      .replace(/data:(image|video)\/[^;,]+;base64,[A-Za-z0-9+/=_-]+/gi, '[REDACTED_MEDIA_BASE64]')
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
      .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, 'sk-[REDACTED]')
      .slice(0, 8000);
  }

  function sanitize(value, key = '', depth = 0, seen = new WeakSet()) {
    if (/api.?key|authorization|password|secret|token/i.test(key)) return '[REDACTED]';
    if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'string') return redactString(value);
    if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
    if (value instanceof Error) return { name: value.name, message: redactString(value.message), stack: redactString(value.stack || '') };
    if (depth >= 5) return '[MAX_DEPTH]';
    if (typeof value === 'object') {
      if (seen.has(value)) return '[CIRCULAR]';
      seen.add(value);
      if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitize(item, '', depth + 1, seen));
      const output = {};
      for (const [childKey, childValue] of Object.entries(value).slice(0, 100)) {
        output[childKey] = sanitize(childValue, childKey, depth + 1, seen);
      }
      return output;
    }
    return redactString(value);
  }

  function enqueue(level, args, source = 'console') {
    queue.push({ at: new Date().toISOString(), sessionId, role, source, level, args: args.map((arg) => sanitize(arg)) });
    if (queue.length >= 30) flush();
    else if (!flushTimer) flushTimer = window.setTimeout(flush, 750);
  }

  function flush() {
    if (flushTimer) window.clearTimeout(flushTimer);
    flushTimer = null;
    if (!queue.length) return;
    const batch = queue.splice(0, queue.length);
    nativeFetch('/__ykt_logs__', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
      keepalive: true,
    }).catch(() => {});
  }

  for (const method of ['debug', 'info', 'log', 'warn', 'error']) {
    const original = console[method].bind(console);
    console[method] = (...args) => {
      original(...args);
      enqueue(method, args);
    };
  }
  window.addEventListener('error', (event) => enqueue('error', [event.error || event.message], 'window.error'));
  window.addEventListener('unhandledrejection', (event) => enqueue('error', [event.reason], 'unhandledrejection'));
  window.addEventListener('ykt-mock:log', (event) => enqueue('info', [event.detail], 'ykt-mock'));
  window.addEventListener('ykt-mock:signal', (event) => enqueue('info', [event.detail], 'ykt-mock-signal'));
  window.addEventListener('ykt-classroom:sent', (event) => enqueue('info', [event.detail], 'classroom-bus'));
  window.addEventListener('pagehide', flush);
  window.__YKT_LOCAL_LOGGER__ = Object.freeze({ sessionId, role, flush });
  enqueue('info', ['local debug logging enabled', { role, path: location.pathname }], 'logger');
})();
