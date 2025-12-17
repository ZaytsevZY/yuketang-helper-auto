// src/index.js
import { installWSInterceptor } from './net/ws-interceptor.js';
import { installXHRInterceptor } from './net/xhr-interceptor.js';
import  './net/fetch-interceptor.js';
import { injectStyles } from './ui/styles.js';
import { installToolbar } from './ui/toolbar.js';
import { actions } from './state/actions.js';
import { ui } from './ui/ui-api.js'; 

(function loadFA() {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
  document.head.appendChild(link);
})();

function maybeAutoReloadOnMount() {
  try {
    // If the script is mounted after DOM is already ready, reload once so XHR/WS interceptors can arm early.
    // Guarded by sessionStorage to avoid infinite reload loops.
    const key = '__ykt_helper_auto_reload_once__';
    if (document.readyState === 'loading') return false;
    if (!window.sessionStorage) return false;
    if (window.sessionStorage.getItem(key) === '1') return false;

    window.sessionStorage.setItem(key, '1');
    console.log('[YKT-Helper][INFO] Late mount detected; reloading once to arm interceptors.');
    window.setTimeout(() => window.location.reload(), 50);
    return true;
  } catch {
    return false;
  }
}
function startPeriodicReload(opts = {}) {
  try {
    const intervalMs = Number.isFinite(opts.intervalMs) ? opts.intervalMs : 5 * 60 * 1000;
    const onlyWhenHidden = (opts.onlyWhenHidden !== false);
    const skipLessonPages = (opts.skipLessonPages !== false);

    if (!Number.isFinite(intervalMs) || intervalMs <= 0) return;

    window.setInterval(() => {
      try {
        if (skipLessonPages && /\/lesson\//.test(window.location.pathname)) return;
        if (onlyWhenHidden && !document.hidden) return;

        console.log('[YKT-Helper][INFO] Periodic reload triggered to avoid zombie session.');
        window.location.reload();
      } catch {}
    }, intervalMs);
  } catch {}
}
(function main() {
  if (maybeAutoReloadOnMount()) return;
  startPeriodicReload({ intervalMs: 5 * 60 * 1000, onlyWhenHidden: true, skipLessonPages: true });
  // 样式/图标
  injectStyles();

  // 挂 UI
  ui._mountAll?.();  

  // 再装网络拦截
  installWSInterceptor();
  installXHRInterceptor();

  // 加载工具条
  installToolbar();

  // 启动自动作答轮询
  actions.startAutoAnswerLoop();

  // 更新课件加载
  actions.launchLessonHelper();
})();

