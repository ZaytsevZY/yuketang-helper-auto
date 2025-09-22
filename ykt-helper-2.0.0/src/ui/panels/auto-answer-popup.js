// src/ui/auto-answer-popup.js
import { ui } from '../ui-api.js';
import { formatProblemForDisplay } from '../../tsm/ai-format.js';

// 简单 HTML 转义，避免把题目中的 <> 等插入为标签
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/**
 * 显示自动作答成功弹窗
 * @param {object} problem - 题目对象
 * @param {string} aiAnswer - 原始 AI 文本（未解析前）
 * @param {object} [cfg] - 可选配置（用于局部覆写）
 */
export function showAutoAnswerPopup(problem, aiAnswer, cfg = {}) {
  // 避免重复
  const existed = document.getElementById('ykt-auto-answer-popup');
  if (existed) existed.remove();

  const popup = document.createElement('div');
  popup.id = 'ykt-auto-answer-popup';
  popup.className = 'auto-answer-popup';

  // 模块版签名：需要传 TYPE_MAP
  const questionText = formatProblemForDisplay(
    problem,
    (ui.config && ui.config.TYPE_MAP) || {}
  );

  // 采用“全屏遮罩 + 内部卡片”的结构，外层用于点击关闭
  popup.innerHTML = `
    <div class="popup-content">
      <div class="popup-header">
        <h4><i class="fas fa-robot"></i> AI自动作答成功</h4>
        <span class="close-btn" title="关闭"><i class="fas fa-times"></i></span>
      </div>
      <div class="popup-body">
        <div class="popup-row popup-question">
          <div class="label">题目：</div>
          <div class="content">${esc(questionText).replace(/\n/g, '<br>')}</div>
        </div>
        <div class="popup-row popup-answer">
          <div class="label">AI回答：</div>
          <div class="content">${esc(aiAnswer || '').replace(/\n/g, '<br>')}</div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(popup);

  // 关闭按钮
  popup.querySelector('.close-btn')?.addEventListener('click', () => popup.remove());

  // 点击遮罩关闭（只在点击外层时才关闭）
  popup.addEventListener('click', (e) => {
    if (e.target === popup) popup.remove();
  });

  // 自动关闭
  const ac = (ui.config && ui.config.autoAnswerPopup) || {};
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
