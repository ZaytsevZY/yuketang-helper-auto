import tpl from './settings.html';
import { ui } from '../ui-api.js';
import { DEFAULT_CONFIG } from '../../core/types.js';
import { storage } from '../../core/storage.js';

let mounted = false;
let root;

export function mountSettingsPanel() {
  if (mounted) return root;
  root = document.createElement('div');
  root.innerHTML = tpl;
  document.body.appendChild(root.firstElementChild);
  root = document.getElementById('ykt-settings-panel');

  // 初始化表单
  const $api = root.querySelector('#kimi-api-key');
  const $auto = root.querySelector('#ykt-input-auto-answer');
  const $autoJoin = root.querySelector('#ykt-input-auto-join');
  const $autoJoinAutoAnswer = root.querySelector('#ykt-input-auto-join-auto-answer');
  const $autoAnalyze = root.querySelector('#ykt-input-ai-auto-analyze');
  const $delay = root.querySelector('#ykt-input-answer-delay');
  const $rand = root.querySelector('#ykt-input-random-delay');
  const $priorityRadios = root.querySelector('#ykt-ai-pick-main-first');
  const $notifyDur = root.querySelector('#ykt-input-notify-duration');
  const $notifyVol = root.querySelector('#ykt-input-notify-volume');

  $api.value = ui.config.ai.kimiApiKey || '';
  if (typeof ui.config.autoJoinEnabled === 'undefined') ui.config.autoJoinEnabled = false;
  if (typeof ui.config.autoAnswerOnAutoJoin === 'undefined') ui.config.autoAnswerOnAutoJoin = true;
  $autoJoin.checked = !!ui.config.autoJoinEnabled;
  $autoJoinAutoAnswer.checked = !!ui.config.autoAnswerOnAutoJoin;
  $auto.checked = !!ui.config.autoAnswer;
  $autoAnalyze.checked = !!ui.config.aiAutoAnalyze;
  $delay.value = Math.floor(ui.config.autoAnswerDelay / 1000);
  $rand.value = Math.floor(ui.config.autoAnswerRandomDelay / 1000);
  const curPriority = ui.config.aiSlidePickPriority || 'main';
  $priorityRadios.checked = (ui.config.aiSlidePickMainFirst !== false);
  $notifyDur.value = Math.max(2, Math.floor((+ui.config.notifyPopupDuration || 5000) / 1000));
  $notifyVol.value = Math.round(100 * Math.max(0, Math.min(1, +ui.config.notifyVolume ?? 0.6)));

  root.querySelector('#ykt-settings-close').addEventListener('click', () => showSettingsPanel(false));

  root.querySelector('#ykt-btn-settings-save').addEventListener('click', () => {
    ui.config.ai.kimiApiKey = $api.value.trim();
    ui.config.autoJoinEnabled = !!$autoJoin.checked;
    ui.config.autoAnswerOnAutoJoin = !!$autoJoinAutoAnswer.checked;
    ui.config.autoAnswer = !!$auto.checked;
    ui.config.aiAutoAnalyze = !!$autoAnalyze.checked;
    ui.config.autoAnswerDelay = Math.max(1000, (+$delay.value || 0) * 1000);
    ui.config.autoAnswerRandomDelay = Math.max(0, (+$rand.value || 0) * 1000);
    ui.config.aiSlidePickPriority = !!$priorityRadios.checked;
    ui.config.notifyPopupDuration = Math.max(2000, (+$notifyDur.value || 0) * 1000);
    ui.config.notifyVolume = Math.max(0, Math.min(1, (+$notifyVol.value || 0) / 100));

    storage.set('kimiApiKey', ui.config.ai.kimiApiKey);
    ui.saveConfig();
    ui.updateAutoAnswerBtn();
    ui.toast('设置已保存');

    if (!before && ui.config.autoJoinEnabled) {
      try {
        const { actions } = require('../../state/actions.js'); // 按你们构建链路适配
        actions.maybeStartAutoJoin?.();
      } catch {}
    }
  });

  root.querySelector('#ykt-btn-settings-reset').addEventListener('click', () => {
    if (!confirm('确定要重置为默认设置吗？')) return;
    Object.assign(ui.config, DEFAULT_CONFIG);
    ui.config.ai.kimiApiKey = '';
    ui.config.autoJoinEnabled = false;
    ui.config.autoAnswerOnAutoJoin = true;
    ui.config.aiAutoAnalyze = !!(DEFAULT_CONFIG.aiAutoAnalyze ?? false);
    ui.config.aiSlidePickPriority = (DEFAULT_CONFIG.aiSlidePickPriority ?? true);
    ui.config.notifyPopupDuration = 5000;
    ui.config.notifyVolume = 0.6;
    storage.set('kimiApiKey', '');
    ui.saveConfig();
    ui.updateAutoAnswerBtn();

    $api.value = '';
    $autoJoin.checked = true;
    $autoJoinAutoAnswer.checked = true;
    $auto.checked = DEFAULT_CONFIG.autoAnswer;
    $delay.value = Math.floor(DEFAULT_CONFIG.autoAnswerDelay / 1000);
    $rand.value = Math.floor(DEFAULT_CONFIG.autoAnswerRandomDelay / 1000);
    $autoAnalyze.checked = !!(DEFAULT_CONFIG.aiAutoAnalyze ?? false);
    $priorityRadios.checked = (DEFAULT_CONFIG.aiSlidePickPriority ?? true)

    ui.toast('设置已重置');
  });

  // === 新增：测试习题提醒按钮 ===
  const $btnTest = root.querySelector('#ykt-btn-test-notify');
  if ($btnTest) {
    $btnTest.addEventListener('click', () => {
      // 构造一个小示例
      const mockProblem = {
        problemId: 'TEST-001',
        body: '【测试题】下列哪个选项是质数？',
        options: [
          { key: 'A', value: '12' },
          { key: 'B', value: '17' },
          { key: 'C', value: '21' },
          { key: 'D', value: '28' },
        ],
      };
      const mockSlide = { thumbnail: null };
      ui.notifyProblem(mockProblem, mockSlide);
      ui.toast('已触发测试提醒（请留意右下角弹窗与提示音）', 2500);
    });
  }

  mounted = true;
  return root;
}

export function showSettingsPanel(visible = true) {
  mountSettingsPanel();
  const panel = document.getElementById('ykt-settings-panel');
  if (!panel) return;
  panel.classList.toggle('visible', !!visible);
}

export function toggleSettingsPanel() {
  mountSettingsPanel();
  const panel = document.getElementById('ykt-settings-panel');
  showSettingsPanel(!panel.classList.contains('visible'));
}