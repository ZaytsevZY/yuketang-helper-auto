// mock-gm.js
// 在 userscript 之前加载，阻止自动重载 + 提供 GM API 存根

// 阻止 maybeAutoReloadOnMount() 触发重载
try { sessionStorage.setItem('__ykt_helper_auto_reload_once__', '1'); } catch (e) {}

// 阻止 startPeriodicReload() 周期性重载
window.location.reload = function () {
  console.log('[DEBUG] location.reload() suppressed');
};

// GM API 不需要额外 mock：
// - GM_addStyle: env.js 已有原生 DOM 回退 (createElement('style'))
// - unsafeWindow: env.js 回退到 window
// - GM_notification: 可选检查，不会崩溃
// - GM_getTab / GM_saveTab: 可选检查，不会崩溃
// - GM_xmlhttpRequest: 仅 AI 功能使用，UI 调试不需要
