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

(function main() {
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
