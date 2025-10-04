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
  const $autoAnalyze = root.querySelector('#ykt-input-ai-auto-analyze');
  const $delay = root.querySelector('#ykt-input-answer-delay');
  const $rand = root.querySelector('#ykt-input-random-delay');
  const $priorityRadios = root.querySelector('#ykt-ai-pick-main-first');

  $api.value = ui.config.ai.kimiApiKey || '';
  $auto.checked = !!ui.config.autoAnswer;
  $autoAnalyze.checked = !!ui.config.aiAutoAnalyze;
  $delay.value = Math.floor(ui.config.autoAnswerDelay / 1000);
  $rand.value = Math.floor(ui.config.autoAnswerRandomDelay / 1000);
  const curPriority = ui.config.aiSlidePickPriority || 'main';
  $priorityRadios.checked = (ui.config.aiSlidePickMainFirst !== false);

  root.querySelector('#ykt-settings-close').addEventListener('click', () => showSettingsPanel(false));

  root.querySelector('#ykt-btn-settings-save').addEventListener('click', () => {
    ui.config.ai.kimiApiKey = $api.value.trim();
    ui.config.autoAnswer = !!$auto.checked;
    ui.config.aiAutoAnalyze = !!$autoAnalyze.checked;
    ui.config.autoAnswerDelay = Math.max(1000, (+$delay.value || 0) * 1000);
    ui.config.autoAnswerRandomDelay = Math.max(0, (+$rand.value || 0) * 1000);
    ui.config.aiSlidePickPriority = !!$priorityRadios.checked;

    storage.set('kimiApiKey', ui.config.ai.kimiApiKey);
    ui.saveConfig();
    ui.updateAutoAnswerBtn();
    ui.toast('设置已保存');
  });

  root.querySelector('#ykt-btn-settings-reset').addEventListener('click', () => {
    if (!confirm('确定要重置为默认设置吗？')) return;
    Object.assign(ui.config, DEFAULT_CONFIG);
    ui.config.ai.kimiApiKey = '';
    ui.config.aiAutoAnalyze = !!(DEFAULT_CONFIG.aiAutoAnalyze ?? false);
    ui.config.aiSlidePickPriority = (DEFAULT_CONFIG.aiSlidePickPriority ?? true);
    storage.set('kimiApiKey', '');
    ui.saveConfig();
    ui.updateAutoAnswerBtn();

    $api.value = '';
    $auto.checked = DEFAULT_CONFIG.autoAnswer;
    $delay.value = Math.floor(DEFAULT_CONFIG.autoAnswerDelay / 1000);
    $rand.value = Math.floor(DEFAULT_CONFIG.autoAnswerRandomDelay / 1000);
    $autoAnalyze.checked = !!(DEFAULT_CONFIG.aiAutoAnalyze ?? false);
    $priorityRadios.checked = (DEFAULT_CONFIG.aiSlidePickPriority ?? true)

    ui.toast('设置已重置');
  });

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