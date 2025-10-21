// src/index.js
import { installWSInterceptor } from './net/ws-interceptor.js';
import { installXHRInterceptor } from './net/xhr-interceptor.js';
import  './net/fetch-interceptor.js';
import { injectStyles } from './ui/styles.js';
import { installToolbar } from './ui/toolbar.js';
import { actions } from './state/actions.js';
import { ui } from './ui/ui-api.js'; // ✅ 补：导入 ui

// 可选：统一放到 core/env.js 的 ensureFontAwesome；这里保留现有注入方式也可以
(function loadFA() {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
  document.head.appendChild(link);
})();

(function main() {
  // 1) 样式/图标
  injectStyles();

  // 2) 先挂 UI（面板、事件桥接）
  ui._mountAll?.();  // ✅ 现在 ui 已导入，确保执行到位

  // 3) 再装网络拦截
  installWSInterceptor();
  installXHRInterceptor();

  // 4) 装工具条（按钮会用到 ui.config 状态）
  installToolbar();

  // 5) 启动自动作答轮询（替代原来的 tickAutoAnswer 占位）
  actions.startAutoAnswerLoop();

  // 6)1.16.4 更新课件加载
  actions.launchLessonHelper();
})();
