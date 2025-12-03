// src/ui/toolbar.js
import { ui } from './ui-api.js';

export function installToolbar() {
  // 仅创建容器与按钮；具体面板之后用 HTML/Vue 接入
  const bar = document.createElement('div');
  bar.id = 'ykt-helper-toolbar';
  bar.innerHTML = `
    <span id="ykt-btn-bell" class="btn" title="习题提醒"><i class="fas fa-bell"></i></span>
    <span id="ykt-btn-pres" class="btn" title="课件浏览"><i class="fas fa-file-powerpoint"></i></span>
    <span id="ykt-btn-ai" class="btn" title="AI解答"><i class="fas fa-robot"></i></span>
    <span id="ykt-btn-auto-answer" class="btn" title="自动作答"><i class="fas fa-magic-wand-sparkles"></i></span>
    <span id="ykt-btn-settings" class="btn" title="设置"><i class="fas fa-cog"></i></span>
    <span id="ykt-btn-help" class="btn" title="使用教程"><i class="fas fa-question-circle"></i></span>
  `;
  document.body.appendChild(bar);

  // 初始激活态
  if (ui.config.notifyProblems) bar.querySelector('#ykt-btn-bell')?.classList.add('active');
  ui.updateAutoAnswerBtn();

  // 事件绑定
  bar.querySelector('#ykt-btn-bell')?.addEventListener('click', () => {
    ui.config.notifyProblems = !ui.config.notifyProblems;
    ui.saveConfig();
    ui.toast(`习题提醒：${ui.config.notifyProblems ? '开' : '关'}`);
    bar.querySelector('#ykt-btn-bell')?.classList.toggle('active', ui.config.notifyProblems);
  });

  // 课件浏览按钮
  bar.querySelector('#ykt-btn-pres')?.addEventListener('click', () => {
    const btn = bar.querySelector('#ykt-btn-pres');
    const isActive = btn.classList.contains('active');
    ui.showPresentationPanel?.(!isActive);
    btn.classList.toggle('active', !isActive);
  });

  // AI按钮
  bar.querySelector('#ykt-btn-ai')?.addEventListener('click', () => {
    const btn = bar.querySelector('#ykt-btn-ai');
    const isActive = btn.classList.contains('active');
    ui.showAIPanel?.(!isActive);
    btn.classList.toggle('active', !isActive);
  });

  bar.querySelector('#ykt-btn-auto-answer')?.addEventListener('click', () => {
    ui.config.autoAnswer = !ui.config.autoAnswer;
    ui.saveConfig();
    ui.toast(`自动作答：${ui.config.autoAnswer ? '开' : '关'}`);
    ui.updateAutoAnswerBtn();
  });

  bar.querySelector('#ykt-btn-settings')?.addEventListener('click', () => {
    ui.toggleSettingsPanel?.();
  });

  bar.querySelector('#ykt-btn-help')?.addEventListener('click', () => {
    ui.toggleTutorialPanel?.();
  });
}