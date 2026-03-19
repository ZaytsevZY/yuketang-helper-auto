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
if (typeof _config.iftex === 'undefined') _config.iftex = true;
if (typeof _config.ai === 'undefined' || !_config.ai) _config.ai = {};
if (typeof _config.ai.ocrApi === 'undefined') _config.ai.ocrApi = '';
if (typeof _config.ai.ocrApiKey === 'undefined') _config.ai.ocrApiKey = '';
if (typeof _config.ai.translateApi === 'undefined') _config.ai.translateApi = '';
if (typeof _config.ai.translateApiKey === 'undefined') _config.ai.translateApiKey = '';
if (typeof _config.ai.translateModel === 'undefined') _config.ai.translateModel = '';
if (typeof _config.notifyProblems === 'undefined') _config.notifyProblems = true;           
if (typeof _config.notifyPopupDuration === 'undefined') _config.notifyPopupDuration = 5000; 
if (typeof _config.notifyVolume === 'undefined') _config.notifyVolume = 0.6;                
if (typeof _config.customNotifyAudioSrc === 'undefined') _config.customNotifyAudioSrc = ''; 
if (typeof _config.customNotifyAudioName === 'undefined') _config.customNotifyAudioName = ''; 
_config.autoJoinEnabled = !!_config.autoJoinEnabled;
_config.autoAnswerOnAutoJoin = !!_config.autoAnswerOnAutoJoin;

function saveConfig() { 
  try {
      storage.set('config', {
        ...this.config,
        autoJoinEnabled: !!this.config.autoJoinEnabled,
        autoAnswerOnAutoJoin: !!this.config.autoAnswerOnAutoJoin,
      });
    } catch (e) { console.warn('[ui.saveConfig] failed', e); }
}

// 面板层级管理
let currentZIndex = 10000000;

function enableNotifyDrag(wrapper, handle, bringToFront) {
  if (!wrapper || !handle) return;

  let dragging = false;
  let startX = 0;
  let startY = 0;
  let originLeft = 0;
  let originTop = 0;

  const onPointerMove = (ev) => {
    if (!dragging) return;
    const nextLeft = Math.max(8, originLeft + ev.clientX - startX);
    const nextTop = Math.max(8, originTop + ev.clientY - startY);
    wrapper.style.left = `${nextLeft}px`;
    wrapper.style.top = `${nextTop}px`;
    wrapper.style.right = 'auto';
    wrapper.style.bottom = 'auto';
  };

  const stopDrag = () => {
    dragging = false;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', stopDrag);
    window.removeEventListener('pointercancel', stopDrag);
  };

  handle.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    if (ev.target?.closest?.('button, a, input, textarea, select')) return;
    const rect = wrapper.getBoundingClientRect();
    dragging = true;
    startX = ev.clientX;
    startY = ev.clientY;
    originLeft = rect.left;
    originTop = rect.top;
    wrapper.style.left = `${rect.left}px`;
    wrapper.style.top = `${rect.top}px`;
    wrapper.style.right = 'auto';
    wrapper.style.bottom = 'auto';
    bringToFront?.(wrapper);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stopDrag);
    window.addEventListener('pointercancel', stopDrag);
    ev.preventDefault();
  });
}

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

  // 题目提醒
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
        cursor: 'default',
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

      const head = document.createElement('div');
      Object.assign(head.style, {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px',
        marginBottom: '6px',
        cursor: 'move',
        userSelect: 'none',
        touchAction: 'none',
      });

      const title = document.createElement('div');
      title.textContent = '习题已发布';
      Object.assign(title.style, { fontWeight: '600', fontSize: '15px', flex: '1 1 auto' });

      const closeBtn = document.createElement('button');
      closeBtn.textContent = 'x';
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
        flex: '0 0 auto',
      });
      closeBtn.addEventListener('mouseenter', () => (closeBtn.style.opacity = '1'));
      closeBtn.addEventListener('mouseleave', () => (closeBtn.style.opacity = '0.7'));

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

      head.appendChild(title);
      head.appendChild(closeBtn);
      body.appendChild(head);
      body.appendChild(detail);
      wrapper.appendChild(body);

      document.body.appendChild(wrapper);
      this._bringToFront(wrapper);

      const timeout = Math.max(2000, +this.config.notifyPopupDuration || 5000);
      const timer = setTimeout(() => wrapper.remove(), timeout);
      closeBtn.onclick = () => {
        clearTimeout(timer);
        wrapper.remove();
      };
      enableNotifyDrag(wrapper, head, (el) => this._bringToFront(el));

      this._playNotifySound(+this.config.notifyVolume || 0.6);
    } catch (e) {
      console.warn('[雨课堂助手][WARN][ui.notifyProblem] failed:', e);
    }
  },

  // 播放自定义提示音  
  _playNotifySound(volume = 0.6) {
    const src = (this.config.customNotifyAudioSrc || '').trim();
    if (src) {
      try {
        if (!this.__notifyAudioEl) {
          this.__notifyAudioEl = new Audio();
          this.__notifyAudioEl.preload = 'auto';
        }
        const el = this.__notifyAudioEl;
        el.pause();
        // 若用户更换了音频，或首次设置，更新 src
        if (el.src !== src) el.src = src;
        el.volume = Math.max(0, Math.min(1, volume));
        el.currentTime = 0;
        const p = el.play();
        // 失败时回退
        if (p && typeof p.catch === 'function') {
          p.catch(() => this._playNotifyTone(volume));
        }
        return;
      } catch (e) {
        console.warn('[雨课堂助手][WARN] custom audio failed, fallback to tone:', e);
        // 回退到合成音
      }
    }
    this._playNotifyTone(volume);
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

  // 供设置页调用：写入/清除自定义提示音
  setCustomNotifyAudio({ src, name }) {
    this.config.customNotifyAudioSrc = src || '';
    this.config.customNotifyAudioName = name || '';
    this.saveConfig();
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
