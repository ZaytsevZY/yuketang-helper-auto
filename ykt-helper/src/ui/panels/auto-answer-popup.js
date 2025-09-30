// src/ui/panels/auto-answer-popup.js
import { ui } from '../ui-api.js';

// 简单 HTML 转义
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/**
 * 显示自动作答成功弹窗
 * @param {object} problem - 题目对象（保留参数以兼容现有调用）
 * @param {string} aiAnswer - AI 回答文本
 * @param {object} [cfg] - 可选配置
 */
export function showAutoAnswerPopup(problem, aiAnswer, cfg = {}) {
  // 避免重复
  const existed = document.getElementById('ykt-auto-answer-popup');
  if (existed) existed.remove();

  const popup = document.createElement('div');
  popup.id = 'ykt-auto-answer-popup';
  popup.className = 'auto-answer-popup';

  popup.innerHTML = `
    <div class="popup-content">
      <div class="popup-header">
        <h4><i class="fas fa-robot"></i> AI自动作答成功</h4>
        <span class="close-btn" title="关闭"><i class="fas fa-times"></i></span>
      </div>
      <div class="popup-body">
        <div class="popup-row popup-answer">
          <div class="label">AI分析结果：</div>
          <div class="content">${esc(aiAnswer || '无AI回答').replace(/\n/g, '<br>')}</div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(popup);

  // 关闭按钮
  popup.querySelector('.close-btn')?.addEventListener('click', () => popup.remove());

  // 点击遮罩关闭
  popup.addEventListener('click', (e) => {
    if (e.target === popup) popup.remove();
  });

  // 自动关闭
  const ac = ui.config?.autoAnswerPopup || {};
  const autoClose = cfg.autoClose ?? ac.autoClose ?? true;
  const autoDelay = cfg.autoCloseDelay ?? ac.autoCloseDelay ?? 4000;
  
  if (autoClose) {
    setTimeout(() => {
      if (popup.parentNode) popup.remove();
    }, autoDelay);
  }

  // 入场动画
  requestAnimationFrame(() => popup.classList.add('visible'));
}