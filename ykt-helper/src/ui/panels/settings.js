// settings.js (new version)
import tpl from './settings.html';
import { ui } from '../ui-api.js';
import { DEFAULT_CONFIG } from '../../core/types.js';
import { storage } from '../../core/storage.js';

let mounted = false;
let root;

// ---- AI Profile helpers ----
function ensureAIProfiles(configAI) {
  if (!configAI) return;

  // 只有 kimiApiKey 时创建第一个 profile
  if (!Array.isArray(configAI.profiles) || configAI.profiles.length === 0) {
    const legacyKey = configAI.kimiApiKey || configAI.apiKey || storage.get('kimiApiKey') || '';
    configAI.profiles = [
      {
        id: 'default',
        name: 'Kimi',
        baseUrl: 'https://api.moonshot.cn/v1/chat/completions',
        apiKey: legacyKey,
        model: 'moonshot-v1-8k',
        visionModel: 'moonshot-v1-8k-vision-preview',
      },
    ];
    configAI.activeProfileId = 'default';
  }

  if (!configAI.activeProfileId) {
    configAI.activeProfileId = configAI.profiles[0].id;
  }
}

function getActiveProfile(configAI) {
  ensureAIProfiles(configAI);
  const list = configAI.profiles;
  const id = configAI.activeProfileId;
  return list.find(p => p.id === id) || list[0];
}

// ------------------------------

export function mountSettingsPanel() {
  if (mounted) return root;

  // 注入 HTML
  root = document.createElement('div');
  root.innerHTML = tpl;
  document.body.appendChild(root.firstElementChild);
  root = document.getElementById('ykt-settings-panel');

  const aiCfg = ui.config.ai || (ui.config.ai = {});
  ensureAIProfiles(aiCfg);

  // === 获取所有 AI Profile 相关的 DOM ===
  const $profileSelect = root.querySelector('#ykt-ai-profile-select');
  const $profileAdd = root.querySelector('#ykt-ai-profile-add');
  const $profileDel = root.querySelector('#ykt-ai-profile-del');

  const $profileName = root.querySelector('#ykt-ai-profile-name');
  const $baseUrl = root.querySelector('#ykt-ai-base-url');
  const $api = root.querySelector('#kimi-api-key');
  const $model = root.querySelector('#ykt-ai-model');
  const $visionModel = root.querySelector('#ykt-ai-vision-model');

  // === 其他 UI 原有字段 ===
  const $auto = root.querySelector('#ykt-input-auto-answer');
  const $autoJoin = root.querySelector('#ykt-input-auto-join');
  const $autoJoinAutoAnswer = root.querySelector('#ykt-input-auto-join-auto-answer');
  const $autoAnalyze = root.querySelector('#ykt-input-ai-auto-analyze');
  const $delay = root.querySelector('#ykt-input-answer-delay');
  const $rand = root.querySelector('#ykt-input-random-delay');
  const $priority = root.querySelector('#ykt-ai-pick-main-first');
  const $notifyDur = root.querySelector('#ykt-input-notify-duration');
  const $notifyVol = root.querySelector('#ykt-input-notify-volume');
  const $iftex = root.querySelector('#ykt-ui-tex');

  const $audioFile = root.querySelector('#ykt-input-notify-audio-file');
  const $audioUrl  = root.querySelector('#ykt-input-notify-audio-url');
  const $applyUrl  = root.querySelector('#ykt-btn-apply-audio-url');
  const $preview   = root.querySelector('#ykt-btn-preview-audio');
  const $clear     = root.querySelector('#ykt-btn-clear-audio');
  const $audioName = root.querySelector('#ykt-tip-audio-name');

  // Profile UI
  function refreshProfileSelect() {
    const ai = ui.config.ai;
    $profileSelect.innerHTML = '';
    ai.profiles.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name || p.id;
      if (p.id === ai.activeProfileId) opt.selected = true;
      $profileSelect.appendChild(opt);
    });
  }

  function loadProfileToForm(profileId) {
    const p = ui.config.ai.profiles.find(x => x.id === profileId);
    if (!p) return;

    ui.config.ai.activeProfileId = p.id;

    $profileName.value = p.name || '';
    $baseUrl.value = p.baseUrl || '';
    $api.value = p.apiKey || '';
    $model.value = p.model || '';
    $visionModel.value = p.visionModel || '';
  }

  // 初始化 Profile 下拉框
  refreshProfileSelect();
  loadProfileToForm(ui.config.ai.activeProfileId);

  // 切换 profile
  $profileSelect.addEventListener('change', () => {
    loadProfileToForm($profileSelect.value);
  });

  // 添加 profile
  $profileAdd.addEventListener('click', () => {
    const id = `p_${Date.now().toString(36)}`;
    const newP = {
      id,
      name: 'new api key',
      baseUrl: 'https://api.openai.com/...',
      apiKey: '',
      model: 'gpt-4o-mini',
      visionModel: '',
    };
    ui.config.ai.profiles.push(newP);
    ui.config.ai.activeProfileId = id;

    refreshProfileSelect();
    loadProfileToForm(id);
  });

  // 删除 profile
  $profileDel.addEventListener('click', () => {
    const ai = ui.config.ai;
    if (ai.profiles.length <= 1) {
      ui.toast('至少保留一个配置', 2500);
      return;
    }
    const id = ai.activeProfileId;
    ai.profiles = ai.profiles.filter(p => p.id !== id);
    ai.activeProfileId = ai.profiles[0].id;

    refreshProfileSelect();
    loadProfileToForm(ai.activeProfileId);
  });

  // 初始化原有 UI 配置

  $autoJoin.checked = !!ui.config.autoJoinEnabled;
  $autoJoinAutoAnswer.checked = !!ui.config.autoAnswerOnAutoJoin;
  $auto.checked = !!ui.config.autoAnswer;
  $autoAnalyze.checked = !!ui.config.aiAutoAnalyze;

  $iftex.checked = !!ui.config.iftex;

  $delay.value = Math.floor((ui.config.autoAnswerDelay || 3000) / 1000);
  $rand.value = Math.floor((ui.config.autoAnswerRandomDelay || 1500) / 1000);

  $priority.checked = (ui.config.aiSlidePickPriority !== false);

  $notifyDur.value = Math.floor((ui.config.notifyPopupDuration || 5000) / 1000);
  $notifyVol.value = Math.round(100 * (ui.config.notifyVolume ?? 0.6));

  if (ui.config.customNotifyAudioName) {
    $audioName.textContent = `当前：${ui.config.customNotifyAudioName}`;
  } else {
    $audioName.textContent = '当前：使用内置“叮-咚”提示音';
  }

  // 保存设置

  root.querySelector('#ykt-btn-settings-save').addEventListener('click', () => {
    // --- 保存当前 Profile ---
    const ai = ui.config.ai;
    const pid = ai.activeProfileId;
    const p = ai.profiles.find(x => x.id === pid);
    if (p) {
      p.name = $profileName.value.trim() || p.name;
      p.baseUrl = $baseUrl.value.trim() || p.baseUrl;
      p.apiKey = $api.value.trim();
      p.model = $model.value.trim() || p.model;
      p.visionModel = $visionModel.value.trim() || p.visionModel;
      const curOpt = $profileSelect.querySelector(`option[value="${p.id}"]`);
    if (curOpt) curOpt.textContent = p.name || p.id;
    }

    ai.kimiApiKey = p.apiKey;
    storage.set('kimiApiKey', p.apiKey);
    ui.config.autoJoinEnabled = !!$autoJoin.checked;
    ui.config.autoAnswerOnAutoJoin = !!$autoJoinAutoAnswer.checked;
    ui.config.autoAnswer = !!$auto.checked;
    ui.config.aiAutoAnalyze = !!$autoAnalyze.checked;
    ui.config.autoAnswerDelay = Math.max(1000, (+$delay.value || 0) * 1000);
    ui.config.autoAnswerRandomDelay = Math.max(0, (+$rand.value || 0) * 1000);
    ui.config.iftex = !!$iftex.checked;
    ui.config.aiSlidePickPriority = !!$priority.checked;
    ui.config.notifyPopupDuration = Math.max(2000, (+$notifyDur.value || 0) * 1000);
    ui.config.notifyVolume = Math.max(0, Math.min(1, (+$notifyVol.value || 60) / 100));

    ui.saveConfig();
    ui.updateAutoAnswerBtn();
    ui.toast('设置已保存');
  });

  //--------------------------------------
  //            重置为默认
  //--------------------------------------

  root.querySelector('#ykt-btn-settings-reset').addEventListener('click', () => {
    if (!confirm('确定要重置为默认设置吗？')) return;

    Object.assign(ui.config, JSON.parse(JSON.stringify(DEFAULT_CONFIG)));

    ensureAIProfiles(ui.config.ai);

    const active = getActiveProfile(ui.config.ai);

    // 更新表单
    refreshProfileSelect();
    loadProfileToForm(active.id);

    $autoJoin.checked = false;
    $autoJoinAutoAnswer.checked = true;
    $auto.checked = ui.config.autoAnswer;
    $autoAnalyze.checked = !!ui.config.aiAutoAnalyze;
    $iftex.checked = !!ui.config.iftex;

    $delay.value = Math.floor(ui.config.autoAnswerDelay / 1000);
    $rand.value = Math.floor(ui.config.autoAnswerRandomDelay / 1000);
    $priority.checked = !!ui.config.aiSlidePickPriority;

    $notifyDur.value = 5;
    $notifyVol.value = 60;
    $audioName.textContent = '当前：使用内置“叮-咚”提示音';

    storage.set('kimiApiKey', '');

    ui.saveConfig();
    ui.updateAutoAnswerBtn();
    ui.toast('设置已重置');
  });

  // 音频设置
  const MAX_SIZE = 2 * 1024 * 1024;

  if ($audioFile) {
    $audioFile.addEventListener('change', (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      if (f.size > MAX_SIZE) {
        ui.toast('音频文件过大（>2MB）', 3000);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const src = reader.result;
        ui.setCustomNotifyAudio({ src, name: f.name });
        $audioName.textContent = `当前：${f.name}`;
        ui._playNotifySound(ui.config.notifyVolume);
        ui.toast('已应用自定义提示音');
      };
      reader.readAsDataURL(f);
    });
  }

  if ($applyUrl) {
    $applyUrl.addEventListener('click', () => {
      const url = ($audioUrl.value || '').trim();
      if (!url) return ui.toast('请输入音频URL');

      if (!/^https?:\/\/|^data:audio\//i.test(url)) {
        ui.toast('URL 必须以 http/https 或 data:audio/ 开头');
        return;
      }

      ui.setCustomNotifyAudio({ src: url, name: '' });
      $audioName.textContent = '当前：（自定义URL）';
      ui._playNotifySound(ui.config.notifyVolume);
      ui.toast('已应用自定义音频URL');
    });
  }

  if ($preview) {
    $preview.addEventListener('click', () => {
      ui._playNotifySound(ui.config.notifyVolume);
    });
  }

  if ($clear) {
    $clear.addEventListener('click', () => {
      ui.setCustomNotifyAudio({ src: '', name: '' });
      $audioName.textContent = '当前：使用内置“叮-咚”提示音';
      ui.toast('已清除自定义音频');
    });
  }

  // 测试提醒
  const $btnTest = root.querySelector('#ykt-btn-test-notify');
  if ($btnTest) {
    $btnTest.addEventListener('click', () => {
      const mockProblem = {
        problemId: 'TEST-001',
        body: '【测试题】这是一个测试提醒',
        options: [],
      };
      ui.notifyProblem(mockProblem, { thumbnail: null });
    });
  }

  // 关闭按钮
  root.querySelector('#ykt-settings-close')
      .addEventListener('click', () => showSettingsPanel(false));

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
