(function installClassroomBus() {
  'use strict';

  const CHANNEL = 'ykt-local-classroom-v1';
  const STATE_KEY = '__ykt_local_classroom_state_v1__';
  const EVENT_KEY = '__ykt_local_classroom_event_v1__';
  const listeners = new Set();
  const seen = new Set();
  const source = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL) : null;

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function deliver(message) {
    if (!message || message.source === source || seen.has(message.id)) return;
    seen.add(message.id);
    if (seen.size > 200) seen.delete(seen.values().next().value);
    for (const listener of listeners) listener(clone(message));
  }

  if (channel) channel.addEventListener('message', (event) => deliver(event.data));
  window.addEventListener('storage', (event) => {
    if (event.key !== EVENT_KEY || !event.newValue) return;
    try { deliver(JSON.parse(event.newValue)); } catch (_) {}
  });

  function send(type, payload) {
    const message = { id: `${source}-${Date.now()}-${Math.random().toString(36).slice(2)}`, type, payload: clone(payload), source, at: Date.now() };
    channel?.postMessage(message);
    try { localStorage.setItem(EVENT_KEY, JSON.stringify(message)); } catch (_) {}
    window.dispatchEvent(new CustomEvent('ykt-classroom:sent', { detail: clone(message) }));
    return message;
  }

  window.__YKT_CLASSROOM__ = Object.freeze({
    send,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    saveState(state) {
      try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch (_) {}
      send('classroom-state', state);
    },
    loadState() {
      try { return JSON.parse(localStorage.getItem(STATE_KEY) || 'null'); } catch (_) { return null; }
    },
    reset() {
      try {
        localStorage.removeItem(STATE_KEY);
        localStorage.removeItem(EVENT_KEY);
      } catch (_) {}
      send('classroom-reset', null);
    },
  });
})();
