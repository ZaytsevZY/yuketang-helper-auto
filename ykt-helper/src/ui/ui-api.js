// src/ui/ui-api.js
import { gm } from '../core/env.js';
import { storage } from '../core/storage.js';
import { DEFAULT_CONFIG } from '../core/types.js';
import { repo } from '../state/repo.js';
import { toast } from './toast.js';
import * as SettingsPanel from './panels/settings.js';
import * as AIPanel from './panels/ai.js';
import * as PresPanel from './panels/presentation.js';
import * as ProbListPanel from './panels/problem-list.js';
import * as ActivePanel from './panels/active-problems.js';
import * as TutorialPanel from './panels/tutorial.js';
import { PROBLEM_TYPE_MAP } from '../core/types.js'

const _config = Object.assign({}, DEFAULT_CONFIG, storage.get('config', {}));
_config.ai.kimiApiKey = storage.get('kimiApiKey', _config.ai.kimiApiKey);
_config.TYPE_MAP = _config.TYPE_MAP || PROBLEM_TYPE_MAP;
if (typeof _config.autoJoinEnabled === 'undefined') _config.autoJoinEnabled = false;
if (typeof _config.autoAnswerOnAutoJoin === 'undefined') _config.autoAnswerOnAutoJoin = true;
if (typeof _config.notifyProblems === 'undefined') _config.notifyProblems = true;           // 是否开启提醒
if (typeof _config.notifyPopupDuration === 'undefined') _config.notifyPopupDuration = 5000; // 弹窗时长(ms)
if (typeof _config.notifyVolume === 'undefined') _config.notifyVolume = 0.6;                // 提示音量(0~1)
_config.autoJoinEnabled = !!_config.autoJoinEnabled;
_config.autoAnswerOnAutoJoin = !!_config.autoAnswerOnAutoJoin;

function saveConfig() { 
  try {
      // 只持久化需要的字段，避免循环引用
      storage.set('config', {
        ...this.config,
        autoJoinEnabled: !!this.config.autoJoinEnabled,
        autoAnswerOnAutoJoin: !!this.config.autoAnswerOnAutoJoin,
      });
    } catch (e) { console.warn('[ui.saveConfig] failed', e); }
}

// 面板层级管理
let currentZIndex = 10000000;

export const ui = {
  get config() { return _config; },
  saveConfig,

  updatePresentationList: PresPanel.updatePresentationList,
  updateSlideView: PresPanel.updateSlideView,
  askAIForCurrent: AIPanel.askAIForCurrent,
  updateProblemList: ProbListPanel.updateProblemList,
  updateActiveProblems: ActivePanel.updateActiveProblems,

  // 提升面板层级的辅助函数
  _bringToFront(panelElement) {
    if (panelElement && panelElement.classList.contains('visible')) {
      currentZIndex += 1;
      panelElement.style.zIndex = currentZIndex;
    }
  },

  // 修改后的面板显示函数，添加z-index管理
  showPresentationPanel(visible = true) {
    PresPanel.showPresentationPanel(visible);
    if (visible) {
      const panel = document.getElementById('ykt-presentation-panel');
      this._bringToFront(panel);
    }
  },

  showProblemListPanel(visible = true) {
    ProbListPanel.showProblemListPanel(visible);
    if (visible) {
      const panel = document.getElementById('ykt-problem-list-panel');
      this._bringToFront(panel);
    }
  },

  showAIPanel(visible = true) {
    AIPanel.showAIPanel(visible);
    if (visible) {
      const panel = document.getElementById('ykt-ai-answer-panel');
      this._bringToFront(panel);
    }
  },

  toggleSettingsPanel() {
    SettingsPanel.toggleSettingsPanel();
    // 检查面板是否变为可见状态
    const panel = document.getElementById('ykt-settings-panel');
    if (panel && panel.classList.contains('visible')) {
      this._bringToFront(panel);
    }
  },

  toggleTutorialPanel() {
    TutorialPanel.toggleTutorialPanel();
    // 检查面板是否变为可见状态
    const panel = document.getElementById('ykt-tutorial-panel');
    if (panel && panel.classList.contains('visible')) {
      this._bringToFront(panel);
    }
  },

  // 在 index.js 初始化时挂载一次
  _mountAll() {
    SettingsPanel.mountSettingsPanel();
    AIPanel.mountAIPanel();
    PresPanel.mountPresentationPanel();
    ProbListPanel.mountProblemListPanel();
    ActivePanel.mountActiveProblemsPanel();
    TutorialPanel.mountTutorialPanel(); 
    window.addEventListener('ykt:open-ai', () => this.showAIPanel(true));
  },

  // === 新增：题目提醒（弹窗 + 声音）===
  notifyProblem(problem, slide) {
    try {
      // 1) 原生通知（如果可用，备用，不阻碍自定义弹窗）
      try {
        this.nativeNotify?.({
          title: '雨课堂习题提示',
          text: this.getProblemDetail(problem),
          image: slide?.thumbnail || null,
          timeout: Math.max(2000, +this.config.notifyPopupDuration || 5000),
        });
      } catch {}

      // 2) 自定义悬浮弹窗
     const wrapper = document.createElement('div');
      wrapper.className = 'ykt-problem-notify';
      // 内联样式，避免依赖外部CSS
      Object.assign(wrapper.style, {
        position: 'fixed',
        right: '20px',
        bottom: '24px',
        maxWidth: '380px',
        background: 'rgba(20,20,20,0.92)',
        color: '#fff',
        borderRadius: '12px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
        padding: '14px 16px',
        display: 'flex',
        gap: '12px',
        alignItems: 'flex-start',
        zIndex: String(++currentZIndex),
        fontSize: '14px',
        lineHeight: '1.5',
        backdropFilter: 'blur(2px)',
        border: '1px solid rgba(255,255,255,0.06)',
      });

      // 缩略图（可选）
      if (slide?.thumbnail) {
        const img = document.createElement('img');
        img.src = slide.thumbnail;
        Object.assign(img.style, {
          width: '56px',
          height: '56px',
          objectFit: 'cover',
          borderRadius: '8px',
          flex: '0 0 auto',
        });
        wrapper.appendChild(img);
      }

      const body = document.createElement('div');
      body.style.flex = '1 1 auto';
      const title = document.createElement('div');
      title.textContent = '习题已发布';
      Object.assign(title.style, { fontWeight: '600', marginBottom: '6px', fontSize: '15px' });
      const detail = document.createElement('pre');
      detail.textContent = this.getProblemDetail(problem);
      Object.assign(detail.style, {
        whiteSpace: 'pre-wrap',
        margin: 0,
        fontFamily: 'inherit',
        opacity: '0.92',
        maxHeight: '220px',
        overflow: 'auto',
      });
      body.appendChild(title);
      body.appendChild(detail);
      wrapper.appendChild(body);

      // 关闭按钮
      const closeBtn = document.createElement('button');
      closeBtn.textContent = '×';
      Object.assign(closeBtn.style, {
        border: 'none',
        background: 'transparent',
        color: '#fff',
        opacity: '0.7',
        fontSize: '18px',
        lineHeight: '18px',
        cursor: 'pointer',
        padding: '0 4px',
        marginLeft: '4px',
      });
      closeBtn.addEventListener('mouseenter', () => (closeBtn.style.opacity = '1'));
      closeBtn.addEventListener('mouseleave', () => (closeBtn.style.opacity = '0.7'));
      closeBtn.onclick = () => wrapper.remove();
      wrapper.appendChild(closeBtn);

      document.body.appendChild(wrapper);
      this._bringToFront(wrapper);

      // 自动移除
      const timeout = Math.max(2000, +this.config.notifyPopupDuration || 5000);
      setTimeout(() => wrapper.remove(), timeout);

      // 3) 播放提示音（WebAudio 简单“叮咚”）
      this._playNotifyTone(+this.config.notifyVolume || 0.6);
    } catch (e) {
      console.warn('[ui.notifyProblem] failed:', e);
    }
  },

  // 简易提示音：两个音高的短促“叮-咚”
  _playNotifyTone(volume = 0.6) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const now = ctx.currentTime;
      const master = ctx.createGain();
      master.gain.value = Math.max(0, Math.min(1, volume));
      master.connect(ctx.destination);

      const tone = (freq, t0, dur = 0.12) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t0);
        gain.gain.setValueAtTime(0, t0);
        gain.gain.linearRampToValueAtTime(1, t0 + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
        osc.connect(gain);
        gain.connect(master);
        osc.start(t0);
        osc.stop(t0 + dur + 0.02);
      };
      tone(880, now);           // A5
      tone(1318.51, now + 0.16); // E6
      // 自动关闭
      setTimeout(() => ctx.close(), 500);
    } catch {}
  },

  getProblemDetail(problem) {
    if (!problem) return '题目未找到';
    const lines = [problem.body || ''];
    if (Array.isArray(problem.options)) {
      lines.push(...problem.options.map(({ key, value }) => `${key}. ${value}`));
    }
    return lines.join('\n');
  },

  toast,
  nativeNotify: gm.notify,

  // Buttons 状态
  updateAutoAnswerBtn() {
    const el = document.getElementById('ykt-btn-auto-answer');
    if (!el) return;
    if (_config.autoAnswer) el.classList.add('active'); else el.classList.remove('active');
  },
};