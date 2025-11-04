// ==UserScript==
// @name         AI雨课堂助手（模块化构建版）
// @namespace    https://github.com/ZaytsevZY/yuketang-helper-auto
// @version      1.19.0
// @description  课堂习题提示，AI解答习题
// @license      MIT
// @icon         https://www.google.com/s2/favicons?sz=64&domain=yuketang.cn
// @match        https://pro.yuketang.cn/web/*
// @match        https://*.yuketang.cn/lesson/fullscreen/v3/*
// @match        https://*.yuketang.cn/v2/web/*
// @match        https://www.yuketang.cn/lesson/fullscreen/v3/*
// @match        https://www.yuketang.cn/v2/web/*
// @match        https://pro.yuketang.cn/lesson/fullscreen/v3/*
// @match        https://pro.yuketang.cn/v2/web/*
// @match        https://pro.yuketang.cn/v2/web/index
// @grant        GM_addStyle
// @grant        GM_notification
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @grant        GM_getTab
// @grant        GM_getTabs
// @grant        GM_saveTab
// @grant        unsafeWindow
// @run-at       document-start
// @require      https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js
// ==/UserScript==
(function() {
  "use strict";
  // src/core/env.js
    const gm = {
    notify(opt) {
      if (typeof window.GM_notification === "function") window.GM_notification(opt);
    },
    addStyle(css) {
      if (typeof window.GM_addStyle === "function") window.GM_addStyle(css); else {
        const s = document.createElement("style");
        s.textContent = css;
        document.head.appendChild(s);
      }
    },
    xhr(opt) {
      if (typeof window.GM_xmlhttpRequest === "function") return window.GM_xmlhttpRequest(opt);
      throw new Error("GM_xmlhttpRequest is not available");
    },
    uw: window.unsafeWindow || window
  };
  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      if ([ ...document.scripts ].some(s => s.src === src)) return resolve();
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`Failed to load: ${src}`));
      document.head.appendChild(s);
    });
  }
  async function ensureHtml2Canvas() {
    const w = gm.uw || window;
 // ★ 用页面 window
        if (typeof w.html2canvas === "function") return w.html2canvas;
    await loadScriptOnce("https://html2canvas.hertzen.com/dist/html2canvas.min.js");
    const h2c = w.html2canvas?.default || w.html2canvas;
    if (typeof h2c === "function") return h2c;
    throw new Error("html2canvas 未正确加载");
  }
  async function ensureJsPDF() {
    if (window.jspdf?.jsPDF) return window.jspdf;
    await loadScriptOnce("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js");
    if (!window.jspdf?.jsPDF) throw new Error("jsPDF 未加载成功");
    return window.jspdf;
  }
  function randInt(l, r) {
    return l + Math.floor(Math.random() * (r - l + 1));
  }
  // src/core/types.js
    const PROBLEM_TYPE_MAP = {
    1: "单选题",
    2: "多选题",
    3: "投票题",
    4: "填空题",
    5: "主观题"
  };
  const DEFAULT_CONFIG = {
    notifyProblems: true,
    autoAnswer: false,
    autoAnswerDelay: 3e3,
    autoAnswerRandomDelay: 2e3,
    ai: {
      provider: "kimi",
      // ✅ 改为 kimi
      kimiApiKey: "",
      // ✅ 添加 kimi 专用字段
      apiKey: "",
      // 保持兼容
      endpoint: "https://api.moonshot.cn/v1/chat/completions",
      // ✅ Kimi API 端点
      model: "moonshot-v1-8k",
      // ✅ 文本模型
      visionModel: "moonshot-v1-8k-vision-preview",
      // ✅ 添加 Vision 模型配置
      temperature: .3,
      maxTokens: 1e3
    },
    showAllSlides: false,
    maxPresentations: 5
  };
  // src/core/storage.js
    class StorageManager {
    constructor(prefix) {
      this.prefix = prefix;
    }
    get(key, dv = null) {
      try {
        const v = localStorage.getItem(this.prefix + key);
        return v ? JSON.parse(v) : dv;
      } catch {
        return dv;
      }
    }
    set(key, value) {
      localStorage.setItem(this.prefix + key, JSON.stringify(value));
    }
    remove(key) {
      localStorage.removeItem(this.prefix + key);
    }
    getMap(key) {
      const arr = this.get(key, []);
      try {
        return new Map(arr);
      } catch {
        return new Map;
      }
    }
    setMap(key, map) {
      this.set(key, [ ...map ]);
    }
    alterMap(key, fn) {
      const m = this.getMap(key);
      fn(m);
      this.setMap(key, m);
    }
  }
  const storage = new StorageManager("ykt-helper:");
  // src/state/repo.js
    const repo = {
    presentations: new Map,
    // id -> presentation
    slides: new Map,
    // slideId -> slide
    problems: new Map,
    // problemId -> problem
    problemStatus: new Map,
    // problemId -> {presentationId, slideId, startTime, endTime, done, autoAnswerTime, answering}
    encounteredProblems: [],
    // [{problemId, ...ref}]
    currentPresentationId: null,
    currentSlideId: null,
    currentLessonId: null,
    currentSelectedUrl: null,
    // 1.16.4:按课程分组存储课件（presentations-<lessonId>）
    setPresentation(id, data) {
      this.presentations.set(id, {
        id: id,
        ...data
      });
      const key = this.currentLessonId ? `presentations-${this.currentLessonId}` : "presentations";
      storage.alterMap(key, m => {
        m.set(id, data);
        // 仍然做容量裁剪（向后兼容）
                const max = storage.get("config", {})?.maxPresentations ?? 5;
        const excess = m.size - max;
        if (excess > 0) [ ...m.keys() ].slice(0, excess).forEach(k => m.delete(k));
      });
    },
    upsertSlide(slide) {
      this.slides.set(slide.id, slide);
    },
    upsertProblem(prob) {
      this.problems.set(prob.problemId, prob);
    },
    pushEncounteredProblem(prob, slide, presentationId) {
      if (!this.encounteredProblems.some(p => p.problemId === prob.problemId)) this.encounteredProblems.push({
        problemId: prob.problemId,
        problemType: prob.problemType,
        body: prob.body || `题目ID: ${prob.problemId}`,
        options: prob.options || [],
        blanks: prob.blanks || [],
        answers: prob.answers || [],
        slide: slide,
        presentationId: presentationId
      });
    },
    // === 自动进入课堂所需的多“线程”（多课堂）状态 ===
    listeningLessons: new Set,
    // lessonId 的集合，表示已经建立WS监听
    lessonTokens: new Map,
    // lessonId -> lessonToken（/lesson/checkin 返回）
    lessonSockets: new Map,
    // lessonId -> WebSocket 实例
    autoJoinRunning: false,
    // 轮询开关
    autoJoinedLessons: new Set,
    // 被“自动进入”的课堂集合（仅标记自动进入建立的连接）
    forceAutoAnswerLessons: new Set,
    // 若需要，可以对某些课强制视为“自动答题开启”
    // 1.16.4:载入本课（按课程分组）在本地存储过的课件
    loadStoredPresentations() {
      if (!this.currentLessonId) return;
      const key = `presentations-${this.currentLessonId}`;
      const stored = storage.getMap(key);
      for (const [id, data] of stored.entries()) this.setPresentation(id, data);
    },
    markLessonConnected(lessonId, ws, token) {
      if (token) this.lessonTokens.set(lessonId, token);
      if (ws) this.lessonSockets.set(lessonId, ws);
      this.listeningLessons.add(lessonId);
    },
    isLessonConnected(lessonId) {
      return this.listeningLessons.has(lessonId) && this.lessonSockets.get(lessonId);
    },
    markLessonAutoJoined(lessonId, enabled = true) {
      if (!lessonId) return;
      if (enabled) this.autoJoinedLessons.add(lessonId); else this.autoJoinedLessons.delete(lessonId);
    }
  };
  // src/ui/toast.js
    function toast(message, duration = 2e3) {
    const el = document.createElement("div");
    el.textContent = message;
    el.style.cssText = `\n    position: fixed; top: 20px; left: 50%; transform: translateX(-50%);\n    background: rgba(0,0,0,.7); color: #fff; padding: 10px 20px;\n    border-radius: 4px; z-index: 10000000; max-width: 80%;\n  `;
    document.body.appendChild(el);
    setTimeout(() => {
      el.style.opacity = "0";
      el.style.transition = "opacity .5s";
      setTimeout(() => el.remove(), 500);
    }, duration);
  }
  var tpl$5 = '<div id="ykt-settings-panel" class="ykt-panel">\r\n  <div class="panel-header">\r\n    <h3>AI雨课堂助手设置</h3>\r\n    <span class="close-btn" id="ykt-settings-close"><i class="fas fa-times"></i></span>\r\n  </div>\r\n\r\n  <div class="panel-body">\r\n    <div class="settings-content">\r\n      <div class="setting-group">\r\n        <h4>AI配置</h4>\r\n          \x3c!-- 将DeepSeek相关配置替换为Kimi --\x3e\r\n          <div class="setting-item">\r\n              <label for="kimi-api-key">Kimi API Key:</label>\r\n              <input type="password" id="kimi-api-key" placeholder="输入您的 Kimi API Key">\r\n              <small>从 <a href="https://platform.moonshot.cn/" target="_blank">Kimi开放平台</a> 获取</small>\r\n          </div>\r\n      </div>\r\n\r\n      <div class="setting-group">\r\n        <h4>自动作答设置</h4>\r\n        <div class="setting-item">\r\n          <label class="checkbox-label">\r\n            <input type="checkbox" id="ykt-input-auto-join">\r\n            <span class="checkmark"></span>\r\n            自动进入课堂\r\n          </label>\r\n          <small>默认自动进入“正在上课”的课堂（与 Python 版一致）。</small>\r\n        </div>\r\n        <div class="setting-item">\r\n          <label class="checkbox-label">\r\n            <input type="checkbox" id="ykt-input-auto-join-auto-answer">\r\n            <span class="checkmark"></span>\r\n            对于自动进入的课堂，默认使用自动答题\r\n          </label>\r\n          <small>仅对“自动进入”的课堂生效，不会影响手动进入课堂的行为。</small>\r\n        </div>\r\n        <div class="setting-item">\r\n          <label class="checkbox-label">\r\n            <input type="checkbox" id="ykt-input-auto-answer">\r\n            <span class="checkmark"></span>\r\n            启用自动作答\r\n          </label>\r\n        </div>\r\n        <div class="setting-item">\r\n          <label class="checkbox-label">\r\n            <input type="checkbox" id="ykt-input-ai-auto-analyze">\r\n            <span class="checkmark"></span>\r\n            打开 AI 页面时自动分析\r\n          </label>\r\n          <small>开启后，进入“AI 解答”面板即自动向 AI 询问当前题目</small>\r\n        </div>\r\n        <div class="setting-item">\r\n          <label for="ykt-input-answer-delay">作答延迟时间 (秒):</label>\r\n          <input type="number" id="ykt-input-answer-delay" min="1" max="60">\r\n          <small>题目出现后等待多长时间开始作答</small>\r\n        </div>\r\n        <div class="setting-item">\r\n          <label for="ykt-input-random-delay">随机延迟范围 (秒):</label>\r\n          <input type="number" id="ykt-input-random-delay" min="0" max="30">\r\n          <small>在基础延迟基础上随机增加的时间范围</small>\r\n        </div><div class="setting-item">\r\n          <label class="checkbox-label">\r\n            <input type="checkbox" id="ykt-ai-pick-main-first">\r\n            <span class="checkmark"></span>\r\n            主界面优先（未勾选则课件浏览优先）\r\n          </label>\r\n          <small>仅在普通打开 AI 面板（ykt:open-ai）时生效；从“提问当前PPT”跳转保持最高优先。</small>\r\n        </div>\r\n      </div>\r\n\r\n      <div class="setting-group">\r\n        <h4>习题提醒</h4>\r\n        <div class="setting-item">\r\n          <label for="ykt-input-notify-duration">弹窗持续时间 (秒):</label>\r\n          <input type="number" id="ykt-input-notify-duration" min="2" max="60" />\r\n          <small>习题出现时，弹窗在屏幕上的停留时长</small>\r\n        </div>\r\n        <div class="setting-item">\r\n          <label for="ykt-input-notify-volume">提醒音量 (0-100):</label>\r\n          <input type="number" id="ykt-input-notify-volume" min="0" max="100" />\r\n          <small>用于提示音的音量大小；建议 30~80</small>\r\n        </div>\r\n        <div class="setting-item">\r\n          <button id="ykt-btn-test-notify">测试习题提醒</button>\r\n        </div>\r\n        <div class="setting-item">\r\n          <label>自定义提示音（其一即可）</label>\r\n          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">\r\n            <input type="file" id="ykt-input-notify-audio-file" accept="audio/*" />\r\n            <input type="text" id="ykt-input-notify-audio-url" placeholder="或粘贴在线音频 URL（http/https/data:）" style="min-width:260px"/>\r\n            <button id="ykt-btn-apply-audio-url">应用URL</button>\r\n            <button id="ykt-btn-preview-audio">预览</button>\r\n            <button id="ykt-btn-clear-audio">清除自定义音频</button>\r\n          </div>\r\n          <small id="ykt-tip-audio-name" style="display:block;opacity:.8;margin-top:6px"></small>\r\n          <small>说明：文件将本地存储为 data URL（默认上限 2MB）。URL 需支持跨域访问；若被浏览器拦截自动播放，请先点击“预览”以授权音频播放。</small>\r\n        </div>\r\n      </div>\r\n\r\n      <div class="setting-actions">\r\n        <button id="ykt-btn-settings-save">保存设置</button>\r\n        <button id="ykt-btn-settings-reset">重置为默认</button>\r\n      </div>\r\n    </div>\r\n  </div>\r\n</div>\r\n';
  let mounted$5 = false;
  let root$4;
  function mountSettingsPanel() {
    if (mounted$5) return root$4;
    root$4 = document.createElement("div");
    root$4.innerHTML = tpl$5;
    document.body.appendChild(root$4.firstElementChild);
    root$4 = document.getElementById("ykt-settings-panel");
    // 初始化表单
        const $api = root$4.querySelector("#kimi-api-key");
    const $auto = root$4.querySelector("#ykt-input-auto-answer");
    const $autoJoin = root$4.querySelector("#ykt-input-auto-join");
    const $autoJoinAutoAnswer = root$4.querySelector("#ykt-input-auto-join-auto-answer");
    const $autoAnalyze = root$4.querySelector("#ykt-input-ai-auto-analyze");
    const $delay = root$4.querySelector("#ykt-input-answer-delay");
    const $rand = root$4.querySelector("#ykt-input-random-delay");
    const $priorityRadios = root$4.querySelector("#ykt-ai-pick-main-first");
    const $notifyDur = root$4.querySelector("#ykt-input-notify-duration");
    const $notifyVol = root$4.querySelector("#ykt-input-notify-volume");
    const $audioFile = root$4.querySelector("#ykt-input-notify-audio-file");
    const $audioUrl = root$4.querySelector("#ykt-input-notify-audio-url");
    const $applyUrl = root$4.querySelector("#ykt-btn-apply-audio-url");
    const $preview = root$4.querySelector("#ykt-btn-preview-audio");
    const $clear = root$4.querySelector("#ykt-btn-clear-audio");
    const $audioName = root$4.querySelector("#ykt-tip-audio-name");
    $api.value = ui.config.ai.kimiApiKey || "";
    if (typeof ui.config.autoJoinEnabled === "undefined") ui.config.autoJoinEnabled = false;
    if (typeof ui.config.autoAnswerOnAutoJoin === "undefined") ui.config.autoAnswerOnAutoJoin = true;
    $autoJoin.checked = !!ui.config.autoJoinEnabled;
    $autoJoinAutoAnswer.checked = !!ui.config.autoAnswerOnAutoJoin;
    $auto.checked = !!ui.config.autoAnswer;
    $autoAnalyze.checked = !!ui.config.aiAutoAnalyze;
    $delay.value = Math.floor(ui.config.autoAnswerDelay / 1e3);
    $rand.value = Math.floor(ui.config.autoAnswerRandomDelay / 1e3);
    ui.config.aiSlidePickPriority || "main";
    $priorityRadios.checked = ui.config.aiSlidePickMainFirst !== false;
    $notifyDur.value = Math.max(2, Math.floor((+ui.config.notifyPopupDuration || 5e3) / 1e3));
    $notifyVol.value = Math.round(100 * Math.max(0, Math.min(1, +ui.config.notifyVolume ?? .6)));
    if (ui.config.customNotifyAudioName || ui.config.customNotifyAudioSrc) $audioName.textContent = `当前：${ui.config.customNotifyAudioName || "(自定义URL)"}`; else $audioName.textContent = "当前：使用内置“叮-咚”提示音";
    root$4.querySelector("#ykt-settings-close").addEventListener("click", () => showSettingsPanel(false));
    root$4.querySelector("#ykt-btn-settings-save").addEventListener("click", () => {
      ui.config.ai.kimiApiKey = $api.value.trim();
      ui.config.autoJoinEnabled = !!$autoJoin.checked;
      ui.config.autoAnswerOnAutoJoin = !!$autoJoinAutoAnswer.checked;
      ui.config.autoAnswer = !!$auto.checked;
      ui.config.aiAutoAnalyze = !!$autoAnalyze.checked;
      ui.config.autoAnswerDelay = Math.max(1e3, (+$delay.value || 0) * 1e3);
      ui.config.autoAnswerRandomDelay = Math.max(0, (+$rand.value || 0) * 1e3);
      ui.config.aiSlidePickPriority = !!$priorityRadios.checked;
      ui.config.notifyPopupDuration = Math.max(2e3, (+$notifyDur.value || 0) * 1e3);
      ui.config.notifyVolume = Math.max(0, Math.min(1, (+$notifyVol.value || 0) / 100));
      storage.set("kimiApiKey", ui.config.ai.kimiApiKey);
      ui.saveConfig();
      ui.updateAutoAnswerBtn();
      ui.toast("设置已保存");
      if (!before && ui.config.autoJoinEnabled) try {
        const {actions: actions} = require("../../state/actions.js");
 // 按你们构建链路适配
                actions.maybeStartAutoJoin?.();
      } catch {}
    });
    root$4.querySelector("#ykt-btn-settings-reset").addEventListener("click", () => {
      if (!confirm("确定要重置为默认设置吗？")) return;
      Object.assign(ui.config, DEFAULT_CONFIG);
      ui.config.ai.kimiApiKey = "";
      ui.config.autoJoinEnabled = false;
      ui.config.autoAnswerOnAutoJoin = true;
      ui.config.aiAutoAnalyze = !!(DEFAULT_CONFIG.aiAutoAnalyze ?? false);
      ui.config.aiSlidePickPriority = DEFAULT_CONFIG.aiSlidePickPriority ?? true;
      ui.config.notifyPopupDuration = 5e3;
      ui.config.notifyVolume = .6;
      ui.setCustomNotifyAudio({
        src: "",
        name: ""
      });
      storage.set("kimiApiKey", "");
      ui.saveConfig();
      ui.updateAutoAnswerBtn();
      $api.value = "";
      $autoJoin.checked = true;
      $autoJoinAutoAnswer.checked = true;
      $auto.checked = DEFAULT_CONFIG.autoAnswer;
      $delay.value = Math.floor(DEFAULT_CONFIG.autoAnswerDelay / 1e3);
      $rand.value = Math.floor(DEFAULT_CONFIG.autoAnswerRandomDelay / 1e3);
      $autoAnalyze.checked = !!(DEFAULT_CONFIG.aiAutoAnalyze ?? false);
      $priorityRadios.checked = DEFAULT_CONFIG.aiSlidePickPriority ?? true;
      $notifyDur.value = 5;
      $notifyVol.value = 60;
      $audioName.textContent = "当前：使用内置“叮-咚”提示音";
      ui.toast("设置已重置");
    });
    // === 新增：自定义音频 - 文件上传 ===
        if ($audioFile) $audioFile.addEventListener("change", async e => {
      const f = e.target.files?.[0];
      if (!f) return;
      // 简单体积限制，避免 localStorage 过大（如 storage 基于 localStorage）
            const MAX = 2 * 1024 * 1024;
 // 2MB
            if (f.size > MAX) {
        ui.toast("音频文件过大（>2MB），请压缩或使用URL方式", 3e3);
        return;
      }
      const reader = new FileReader;
      reader.onload = () => {
        const src = reader.result;
 // data URL
                ui.setCustomNotifyAudio({
          src: src,
          name: f.name
        });
        $audioName.textContent = `当前：${f.name}`;
        // 立即试播，满足浏览器的“用户手势”政策
                ui._playNotifySound(Math.max(0, Math.min(1, (+$notifyVol.value || 60) / 100)));
        ui.toast("已应用自定义提示音（文件）");
      };
      reader.onerror = () => ui.toast("读取音频文件失败", 2500);
      reader.readAsDataURL(f);
    });
    // === 新增：自定义音频 - 应用URL ===
        if ($applyUrl) $applyUrl.addEventListener("click", () => {
      const url = ($audioUrl.value || "").trim();
      if (!url) {
        ui.toast("请输入音频 URL", 2e3);
        return;
      }
      if (!/^https?:\/\/|^data:audio\//i.test(url)) {
        ui.toast("URL 必须以 http/https 或 data:audio/ 开头", 3e3);
        return;
      }
      ui.setCustomNotifyAudio({
        src: url,
        name: ""
      });
      $audioName.textContent = "当前：（自定义URL）";
      // 立即试播
            ui._playNotifySound(Math.max(0, Math.min(1, (+$notifyVol.value || 60) / 100)));
      ui.toast("已应用自定义提示音（URL）");
    });
    // === 新增：预览当前提示音 ===
        if ($preview) $preview.addEventListener("click", () => {
      ui._playNotifySound(Math.max(0, Math.min(1, (+$notifyVol.value || 60) / 100)));
    });
    // === 新增：清除自定义音频 ===
        if ($clear) $clear.addEventListener("click", () => {
      ui.setCustomNotifyAudio({
        src: "",
        name: ""
      });
      $audioName.textContent = "当前：使用内置“叮-咚”提示音";
      ui.toast("已清除自定义提示音");
    });
    // === 新增：测试习题提醒按钮 ===
        const $btnTest = root$4.querySelector("#ykt-btn-test-notify");
    if ($btnTest) $btnTest.addEventListener("click", () => {
      // 构造一个小示例
      const mockProblem = {
        problemId: "TEST-001",
        body: "【测试题】下列哪个选项是质数？",
        options: [ {
          key: "A",
          value: "12"
        }, {
          key: "B",
          value: "17"
        }, {
          key: "C",
          value: "21"
        }, {
          key: "D",
          value: "28"
        } ]
      };
      const mockSlide = {
        thumbnail: null
      };
      ui.notifyProblem(mockProblem, mockSlide);
      ui.toast("已触发测试提醒（请留意右下角弹窗与提示音）", 2500);
    });
    mounted$5 = true;
    return root$4;
  }
  function showSettingsPanel(visible = true) {
    mountSettingsPanel();
    const panel = document.getElementById("ykt-settings-panel");
    if (!panel) return;
    panel.classList.toggle("visible", !!visible);
  }
  function toggleSettingsPanel() {
    mountSettingsPanel();
    const panel = document.getElementById("ykt-settings-panel");
    showSettingsPanel(!panel.classList.contains("visible"));
  }
  var tpl$4 = '<div id="ykt-ai-answer-panel" class="ykt-panel">\r\n  <div class="panel-header">\r\n    <h3><i class="fas fa-robot"></i> AI 融合分析</h3>\r\n    <span id="ykt-ai-close" class="close-btn" title="关闭">\r\n      <i class="fas fa-times"></i>\r\n    </span>\r\n  </div>\r\n  <div class="panel-body">\r\n    <div style="margin-bottom: 10px;">\r\n      <strong>当前题目：</strong>\r\n      <div style="font-size: 12px; color: #666; margin: 4px 0;">\r\n        系统将自动识别当前页面的题目\r\n      </div>\r\n      <div id="ykt-ai-text-status" class="text-status warning">\r\n        正在检测题目信息...\r\n      </div>\r\n      <div id="ykt-ai-question-display" class="ykt-question-display">\r\n        提示：系统使用融合模式，同时分析题目文本信息和页面图像，提供最准确的答案。\r\n      </div>\r\n    </div>\r\n    \x3c!-- 当前要提问的PPT预览（来自presentation传入时显示） --\x3e\r\n    <div id="ykt-ai-selected" style="display:none; margin: 10px 0;">\r\n      <strong>已选PPT预览：</strong>\r\n      <div style="font-size: 12px; color: #666; margin: 4px 0;">\r\n        下方小图为即将用于分析的PPT页面截图\r\n      </div>\r\n      <div style="border: 1px solid var(--ykt-border-strong); padding: 6px; border-radius: 6px; display: inline-block;">\r\n        <img id="ykt-ai-selected-thumb"\r\n             alt="已选PPT预览"\r\n             style="max-width: 180px; max-height: 120px; display:block;" />\r\n      </div>\r\n    </div>\r\n    <div style="margin-bottom: 10px;">\r\n      <strong>自定义提示（可选）：</strong>\r\n      <div style="font-size: 12px; color: #666; margin: 4px 0;">\r\n        提示：此内容将追加到系统生成的prompt后面，可用于补充特殊要求或背景信息。\r\n      </div>\r\n      <textarea \r\n        id="ykt-ai-custom-prompt" \r\n        class="ykt-custom-prompt"\r\n        placeholder="例如：请用中文回答、注重解题思路、考虑XXX知识点等"\r\n      ></textarea>\r\n    </div>\r\n\r\n    <button id="ykt-ai-ask" style="width: 100%; height: 32px; border-radius: 6px; border: 1px solid var(--ykt-border-strong); background: #f7f8fa; cursor: pointer; margin-bottom: 10px;">\r\n      <i class="fas fa-brain"></i> 融合模式分析（文本+图像）\r\n    </button>\r\n\r\n    <div id="ykt-ai-loading" class="ai-loading" style="display: none;">\r\n      <i class="fas fa-spinner fa-spin"></i> AI正在使用融合模式分析...\r\n    </div>\r\n    <div id="ykt-ai-error" class="ai-error" style="display: none;"></div>\r\n    <div>\r\n      <strong>AI 分析结果：</strong>\r\n      <div id="ykt-ai-answer" class="ai-answer"></div>\r\n    </div>\r\n    \x3c!-- ✅ 新增：可编辑答案区（默认隐藏；当检测到题目并成功解析parsed时显示） --\x3e\r\n    <div id="ykt-ai-edit-section" style="display:none; margin-top:12px;">\r\n      <strong>提交前可编辑答案：</strong>\r\n      <div style="font-size: 12px; color: #666; margin: 4px 0;">\r\n        提示：这里是将要提交的“结构化答案”。可直接编辑。支持：\r\n        <br>• 选择题/投票：填写 <code>["A"]</code> 或 <code>A,B</code>\r\n        <br>• 填空题：填写 <code>[" 1"]</code> 或 直接写 <code> 1</code>（自动包成数组）\r\n        <br>• 主观题：可填 JSON（如 <code>{"content":"略","pics":[]}</code>）或直接输入文本\r\n      </div>\r\n      <textarea id="ykt-ai-answer-edit"\r\n        style="width:100%; min-height:88px; border:1px solid var(--ykt-border-strong); border-radius:6px; padding:6px; font-family:monospace;"></textarea>\r\n      <div id="ykt-ai-validate" style="font-size:12px; color:#666; margin-top:6px;"></div>\r\n      <div style="margin-top:8px; display:flex; gap:8px;">\r\n        <button id="ykt-ai-submit" class="ykt-btn ykt-btn-primary" style="flex:0 0 auto;">\r\n          提交编辑后的答案\r\n        </button>\r\n        <button id="ykt-ai-reset-edit" class="ykt-btn" style="flex:0 0 auto;">重置为 AI 建议</button>\r\n      </div>\r\n    </div>\r\n  </div>\r\n</div>';
  // src/ai/kimi.js
  // -----------------------------------------------
  // Unified Prompt blocks for Text & Vision
  // -----------------------------------------------
    const BASE_SYSTEM_PROMPT = [ "你是 Kimi，由 Moonshot AI 提供的人工智能助手。你需要在以下规则下工作：", "1) 任何时候优先遵循【用户输入（优先级最高）】中的明确要求；", "2) 当输入是课件页面（PPT）图像或题干文本时，先判断是否存在“明确题目”；", "3) 若存在明确题目，则输出以下格式的内容：", "   单选：格式要求：\n答案: [单个字母]\n解释: [选择理由]\n\n注意：只选一个，如A", "   多选：格式要求：\n答案: [多个字母用顿号分开]\n解释: [选择理由]\n\n注意：格式如A、B、C", "   投票：格式要求：\n答案: [单个字母]\n解释: [选择理由]\n\n注意：只选一个选项，如A", "   填空/主观题: 格式要求：答案: [直接给出答案内容]，解释: [补充说明]", "4) 若识别不到明确题目，直接使用回答用户输入的问题", "3) 如果PROMPT格式不正确，或者你只接收了图片，输出：", "   STATE: NO_PROMPT", "   SUMMARY: <介绍页面/上下文的主要内容>" ].join("\n");
  // Vision 补充：识别题型与版面元素的步骤说明
    const VISION_GUIDE = [ "【视觉识别要求】", "A. 先判断是否为题目页面（是否有题干/选项/空格/问句等）", "B. 若是题目，尝试提取题干、选项与关键信息；", "C. 否则参考用户输入回答" ].join("\n");
  /**
   * 调用 Kimi Vision模型（图像+文本）
   * @param {string} imageBase64 图像的base64编码
   * @param {string} textPrompt 文本提示（可包含题干）
   * @param {Object} aiCfg AI配置
   * @returns {Promise<string>} AI回答
   */  async function queryKimiVision(imageBase64, textPrompt, aiCfg) {
    const apiKey = aiCfg.kimiApiKey;
    if (!apiKey) throw new Error("请先配置 Kimi API Key");
    // ✅ 检查图像数据格式
        if (!imageBase64 || typeof imageBase64 !== "string") throw new Error("图像数据格式错误");
    // ✅ 确保 base64 数据格式正确
        const cleanBase64 = imageBase64.replace(/^data:image\/[^;]+;base64,/, "");
    // 统一化：使用 BASE_SYSTEM_PROMPT + VISION_GUIDE，并要求先做“是否有题目”的决策
        const visionTextHeader = [ "【融合模式说明】你将看到一张课件/PPT截图与可选的附加文本。", VISION_GUIDE ].join("\n");
    // ✅ 按照文档要求构建消息格式
        const messages = [ {
      role: "system",
      content: BASE_SYSTEM_PROMPT
    }, {
      role: "user",
      content: [ {
        type: "image_url",
        image_url: {
          url: `data:image/png;base64,${cleanBase64}`
        }
      }, {
        type: "text",
        text: [ visionTextHeader, "【用户输入（优先级最高）】", textPrompt || "（无）" ].join("\n")
      } ]
    } ];
    return new Promise((resolve, reject) => {
      console.log("[Kimi Vision] 发送请求...");
      console.log("[Kimi Vision] 模型: moonshot-v1-8k-vision-preview");
      console.log("[Kimi Vision] 图片数据长度:", cleanBase64.length);
      gm.xhr({
        method: "POST",
        url: "https://api.moonshot.cn/v1/chat/completions",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        data: JSON.stringify({
          model: "moonshot-v1-8k-vision-preview",
          // ✅ 使用 Vision 专用模型
          messages: messages,
          temperature: .3
        }),
        onload: res => {
          try {
            console.log("[Kimi Vision] Status:", res.status);
            console.log("[Kimi Vision] Response:", res.responseText);
            if (res.status !== 200) {
              // ✅ 提供更详细的错误信息
              let errorMessage = `Kimi Vision API 请求失败: ${res.status}`;
              try {
                const errorData = JSON.parse(res.responseText);
                if (errorData.error?.message) errorMessage += ` - ${errorData.error.message}`;
                if (errorData.error?.code) errorMessage += ` (${errorData.error.code})`;
              } catch (e) {
                errorMessage += ` - ${res.responseText}`;
              }
              reject(new Error(errorMessage));
              return;
            }
            const data = JSON.parse(res.responseText);
            const content = data.choices?.[0]?.message?.content;
            if (content) {
              console.log("[Kimi Vision] 成功获取回答");
              resolve(content);
            } else reject(new Error("AI返回内容为空"));
          } catch (e) {
            console.error("[Kimi Vision] 解析响应失败:", e);
            reject(new Error(`解析API响应失败: ${e.message}`));
          }
        },
        onerror: err => {
          console.error("[Kimi Vision] 网络请求失败:", err);
          reject(new Error("网络请求失败"));
        },
        timeout: 6e4
      });
    });
  }
  // src/tsm/answer.js
  // Refactored from v1.16.1 userscript to module style.
  // Exposes three primary APIs:
  //   - answerProblem(problem, result, options)
  //   - retryAnswer(problem, result, dt, options)
  //   - submitAnswer(problem, result, submitOptions)  // orchestrates answer vs retry
  
  // Differences vs userscript:
  // - No global UI (confirm/Toast). Callers control UX.
  // - Uses options to pass deadline window and behavior flags.
  // - Allows header overrides for testing and non-browser envs.
    function sleep(ms) {
    return new Promise(r => setTimeout(r, Math.max(0, ms | 0)));
  }
  function calcAutoWaitMs() {
    const base = Math.max(0, ui?.config?.autoAnswerDelay ?? 0);
    const rand = Math.max(0, ui?.config?.autoAnswerRandomDelay ?? 0);
    return base + (rand ? Math.floor(Math.random() * rand) : 0);
  }
  function shouldAutoAnswerForLesson_(lessonId) {
    // 全局开关优先
    if (ui?.config?.autoAnswer) return true;
    if (!lessonId) return false;
    // 对“自动进入”的课堂，若开启“默认自动答题”，也允许
        if (repo?.autoJoinedLessons?.has(lessonId) && ui?.config?.autoAnswerOnAutoJoin) return true;
    // 上层可在特定课堂放行一次
        if (repo?.forceAutoAnswerLessons?.has(lessonId)) return true;
    return false;
  }
  const DEFAULT_HEADERS = () => ({
    "Content-Type": "application/json",
    xtbz: "ykt",
    "X-Client": "h5",
    Authorization: "Bearer " + (typeof localStorage !== "undefined" ? localStorage.getItem("Authorization") : "")
  });
  /**
   * Low-level POST helper using XMLHttpRequest to align with site requirements.
   * @param {string} url
   * @param {object} data
   * @param {Record<string,string>} headers
   * @returns {Promise<any>}
   */  function xhrPost(url, data, headers) {
    return new Promise((resolve, reject) => {
      try {
        const xhr = new XMLHttpRequest;
        xhr.open("POST", url);
        for (const [k, v] of Object.entries(headers || {})) xhr.setRequestHeader(k, v);
        xhr.onload = () => {
          try {
            const resp = JSON.parse(xhr.responseText);
            if (resp && typeof resp === "object") resolve(resp); else reject(new Error("解析响应失败"));
          } catch {
            reject(new Error("解析响应失败"));
          }
        };
        xhr.onerror = () => reject(new Error("网络请求失败"));
        xhr.send(JSON.stringify(data));
      } catch (e) {
        reject(e);
      }
    });
  }
  /**
   * POST /api/v3/lesson/problem/answer
   * Mirrors the 1.16.1 logic (no UI). Returns {code, data, msg, ...} on success code===0.
   * @param {{problemId:number, problemType:number}} problem
   * @param {any} result
   * @param {{headers?:Record<string,string>, dt?:number}} [options]
   */  async function answerProblem(problem, result, options = {}) {
    const url = "/api/v3/lesson/problem/answer";
    const headers = {
      ...DEFAULT_HEADERS(),
      ...options.headers || {}
    };
    const payload = {
      problemId: problem.problemId,
      problemType: problem.problemType,
      dt: options.dt ?? Date.now(),
      result: result
    };
    const resp = await xhrPost(url, payload, headers);
    if (resp.code === 0) return resp;
    throw new Error(`${resp.msg} (${resp.code})`);
  }
  /**
   * POST /api/v3/lesson/problem/retry
   * Expects server to echo success ids in data.success (as in v1.16.1).
   * @param {{problemId:number, problemType:number}} problem
   * @param {any} result
   * @param {number} dt - simulated answer time (epoch ms)
   * @param {{headers?:Record<string,string>}} [options]
   */  async function retryAnswer(problem, result, dt, options = {}) {
    const url = "/api/v3/lesson/problem/retry";
    const headers = {
      ...DEFAULT_HEADERS(),
      ...options.headers || {}
    };
    const payload = {
      problems: [ {
        problemId: problem.problemId,
        problemType: problem.problemType,
        dt: dt,
        result: result
      } ]
    };
    const resp = await xhrPost(url, payload, headers);
    if (resp.code !== 0) throw new Error(`${resp.msg} (${resp.code})`);
    const okList = resp?.data?.success || [];
    if (!Array.isArray(okList) || !okList.includes(problem.problemId)) throw new Error("服务器未返回成功信息");
    return resp;
  }
  /**
   * High-level orchestrator: answer first; if deadline has passed, optionally retry.
   * This is the module adaptation of the 1.16.1 userscript submit flow.
   *
   * @param {{problemId:number, problemType:number}} problem
   * @param {any} result
   * @param {Object} submitOptions
   * @param {number} [submitOptions.startTime] - unlock time (epoch ms). Required for retry path.
   * @param {number} [submitOptions.endTime]   - deadline (epoch ms). If now >= endTime -> retry path.
   * @param {boolean} [submitOptions.forceRetry=false] - when past deadline, directly use retry without prompting.
   * @param {number} [submitOptions.retryDtOffsetMs=2000] - dt = startTime + offset when retrying.
   * @param {Record<string,string>} [submitOptions.headers] - extra/override headers.
   * @returns {Promise<{'route':'answer'|'retry', resp:any}>}
   * @param {number|string} [submitOptions.lessonId] - 所属课堂；缺省时将使用 repo.currentLessonId
   * @param {boolean} [submitOptions.autoGate=true]  - 是否启用“自动进入课堂/默认自动答题”的判定（向后兼容，默认开启）
   * @param {number} [submitOptions.waitMs]          - 覆盖自动等待时间；未提供时按设置计算
   */  async function submitAnswer(problem, result, submitOptions = {}) {
    // 安全解构：避免别名，避免空对象问题
    const startTime = submitOptions?.startTime;
    const endTime = submitOptions?.endTime;
    const forceRetry = submitOptions?.forceRetry ?? false;
    const retryDtOffsetMs = submitOptions?.retryDtOffsetMs ?? 2e3;
    const headers = submitOptions?.headers;
    const autoGate = submitOptions?.autoGate ?? true;
    const waitMs = submitOptions?.waitMs;
    const lessonIdFromOpts = submitOptions && "lessonId" in submitOptions ? submitOptions.lessonId : void 0;
    // 统一拿 lessonId（优先用传入，其次 repo.currentLessonId）
        const lessonId = lessonIdFromOpts ?? repo?.currentLessonId ?? null;
    // 仅当 autoGate=true 时才应用“自动进入课堂/默认自动答题”的逻辑；保持老调用方不受影响
        if (autoGate && shouldAutoAnswerForLesson_(lessonId)) {
      const ms = typeof waitMs === "number" ? Math.max(0, waitMs) : calcAutoWaitMs();
      if (ms > 0) {
        // 如果设置了截止时间，避免把等待拖到截止之后（预留 80ms 安全边界）
        const guard = typeof endTime === "number" ? Math.max(0, endTime - Date.now() - 80) : ms;
        await sleep(Math.min(ms, guard));
      }
    }
    const now = Date.now();
    const pastDeadline = typeof endTime === "number" && now >= endTime;
    if (pastDeadline) {
      if (!forceRetry) {
        const err = new Error("DEADLINE_PASSED");
        err.name = "DeadlineError";
        err.details = {
          startTime: startTime,
          endTime: endTime,
          now: now
        };
        throw err;
      }
      const base = typeof startTime === "number" ? startTime : now - retryDtOffsetMs;
      const dt = base + retryDtOffsetMs;
      const resp = await retryAnswer(problem, result, dt, {
        headers: headers
      });
      return {
        route: "retry",
        resp: resp
      };
    }
    const resp = await answerProblem(problem, result, {
      headers: headers,
      dt: now
    });
    return {
      route: "answer",
      resp: resp
    };
  }
  // src/ui/panels/auto-answer-popup.js
  // 简单 HTML 转义
    function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[c]));
  }
  /**
   * 显示自动作答成功弹窗
   * @param {object} problem - 题目对象（保留参数以兼容现有调用）
   * @param {string} aiAnswer - AI 回答文本
   * @param {object} [cfg] - 可选配置
   */  function showAutoAnswerPopup(problem, aiAnswer, cfg = {}) {
    // 避免重复
    const existed = document.getElementById("ykt-auto-answer-popup");
    if (existed) existed.remove();
    const popup = document.createElement("div");
    popup.id = "ykt-auto-answer-popup";
    popup.className = "auto-answer-popup";
    popup.innerHTML = `\n    <div class="popup-content">\n      <div class="popup-header">\n        <h4><i class="fas fa-robot"></i> AI自动作答成功</h4>\n        <span class="close-btn" title="关闭"><i class="fas fa-times"></i></span>\n      </div>\n      <div class="popup-body">\n        <div class="popup-row popup-answer">\n          <div class="label">AI分析结果：</div>\n          <div class="content">${esc(aiAnswer || "无AI回答").replace(/\n/g, "<br>")}</div>\n        </div>\n      </div>\n    </div>\n  `;
    document.body.appendChild(popup);
    // 关闭按钮
        popup.querySelector(".close-btn")?.addEventListener("click", () => popup.remove());
    // 点击遮罩关闭
        popup.addEventListener("click", e => {
      if (e.target === popup) popup.remove();
    });
    // 自动关闭
        const ac = ui.config?.autoAnswerPopup || {};
    const autoClose = cfg.autoClose ?? ac.autoClose ?? true;
    const autoDelay = cfg.autoCloseDelay ?? ac.autoCloseDelay ?? 4e3;
    if (autoClose) setTimeout(() => {
      if (popup.parentNode) popup.remove();
    }, autoDelay);
    // 入场动画
        requestAnimationFrame(() => popup.classList.add("visible"));
  }
  // src/capture/screenshot.js
    async function captureProblemScreenshot() {
    try {
      const html2canvas = await ensureHtml2Canvas();
      const el = document.querySelector(".ques-title") || document.querySelector(".problem-body") || document.querySelector(".ppt-inner") || document.querySelector(".ppt-courseware-inner") || document.body;
      return await html2canvas(el, {
        useCORS: true,
        allowTaint: false,
        backgroundColor: "#ffffff",
        scale: 1,
        width: Math.min(el.scrollWidth, 1200),
        height: Math.min(el.scrollHeight, 800)
      });
    } catch (e) {
      console.error("[captureProblemScreenshot] failed", e);
      return null;
    }
  }
  /**
   * ✅ 新方法：获取指定幻灯片的截图
   * @param {string} slideId - 幻灯片ID
   * @returns {Promise<string|null>} base64图片数据
   */  async function captureSlideImage(slideId) {
    try {
      console.log("[captureSlideImage] 获取幻灯片图片:", slideId);
      const slide = repo.slides.get(slideId);
      if (!slide) {
        console.error("[captureSlideImage] 找不到幻灯片:", slideId);
        return null;
      }
      // ✅ 使用 cover 或 coverAlt 图片URL
            const imageUrl = slide.coverAlt || slide.cover;
      if (!imageUrl) {
        console.error("[captureSlideImage] 幻灯片没有图片URL");
        return null;
      }
      console.log("[captureSlideImage] 图片URL:", imageUrl);
      // ✅ 下载图片并转换为base64
            const base64 = await downloadImageAsBase64(imageUrl);
      if (!base64) {
        console.error("[captureSlideImage] 下载图片失败");
        return null;
      }
      console.log("[captureSlideImage] ✅ 成功获取图片, 大小:", Math.round(base64.length / 1024), "KB");
      return base64;
    } catch (e) {
      console.error("[captureSlideImage] 失败:", e);
      return null;
    }
  }
  /**
   * ✅ 下载图片并转换为base64
   * @param {string} url - 图片URL
   * @returns {Promise<string|null>}
   */  async function downloadImageAsBase64(url) {
    return new Promise(resolve => {
      try {
        const img = new Image;
        img.crossOrigin = "anonymous";
 // ✅ 允许跨域
                img.onload = () => {
          try {
            const canvas = document.createElement("canvas");
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0);
            // ✅ 转换为JPEG格式，压缩质量0.8
                        const base64 = canvas.toDataURL("image/jpeg", .8).split(",")[1];
            // ✅ 如果图片太大，进一步压缩
                        if (base64.length > 1e6) {
              // 1MB
              console.log("[downloadImageAsBase64] 图片过大，进行压缩...");
              const compressed = canvas.toDataURL("image/jpeg", .5).split(",")[1];
              console.log("[downloadImageAsBase64] 压缩后大小:", Math.round(compressed.length / 1024), "KB");
              resolve(compressed);
            } else resolve(base64);
          } catch (e) {
            console.error("[downloadImageAsBase64] Canvas处理失败:", e);
            resolve(null);
          }
        };
        img.onerror = e => {
          console.error("[downloadImageAsBase64] 图片加载失败:", e);
          resolve(null);
        };
        img.src = url;
      } catch (e) {
        console.error("[downloadImageAsBase64] 失败:", e);
        resolve(null);
      }
    });
  }
  // 原有的 captureProblemForVision 保留作为后备方案
    async function captureProblemForVision() {
    try {
      console.log("[captureProblemForVision] 开始截图...");
      const canvas = await captureProblemScreenshot();
      if (!canvas) {
        console.error("[captureProblemForVision] 截图失败");
        return null;
      }
      console.log("[captureProblemForVision] 截图成功，转换为base64...");
      const base64 = canvas.toDataURL("image/jpeg", .8).split(",")[1];
      console.log("[captureProblemForVision] base64 长度:", base64.length);
      if (base64.length > 1e6) {
        console.log("[captureProblemForVision] 图片过大，进行压缩...");
        const smallerBase64 = canvas.toDataURL("image/jpeg", .5).split(",")[1];
        console.log("[captureProblemForVision] 压缩后长度:", smallerBase64.length);
        return smallerBase64;
      }
      return base64;
    } catch (e) {
      console.error("[captureProblemForVision] failed", e);
      return null;
    }
  }
  // src/tsm/ai-format.js
  // 预处理题目内容，去除题目类型标识
    function cleanProblemBody(body, problemType, TYPE_MAP) {
    if (!body) return "";
    const typeLabel = TYPE_MAP[problemType];
    if (!typeLabel) return body;
    // 去除题目开头的类型标识，如 "填空题：" "单选题：" 等
        const pattern = new RegExp(`^${typeLabel}[：:\\s]+`, "i");
    return body.replace(pattern, "").trim();
  }
  // 改进的融合模式 prompt 格式化函数
    function formatProblemForVision(problem, TYPE_MAP, hasTextInfo = false) {
    const problemType = TYPE_MAP[problem.problemType] || "题目";
    let basePrompt = hasTextInfo ? `结合文本信息和图片内容分析${problemType}，按格式回答：` : `观察图片内容，识别${problemType}并按格式回答：`;
    if (hasTextInfo && problem.body) {
      // ✅ 清理题目内容
      const cleanBody = cleanProblemBody(problem.body, problem.problemType, TYPE_MAP);
      basePrompt += `\n\n【文本信息】\n题目：${cleanBody}`;
      if (problem.options?.length) {
        basePrompt += "\n选项：";
        for (const o of problem.options) basePrompt += `\n${o.key}. ${o.value}`;
      }
      basePrompt += "\n\n若图片内容与文本冲突，以图片为准。";
    }
    // 根据题目类型添加具体格式要求
        switch (problem.problemType) {
     case 1:
      // 单选题
      basePrompt += `\n\n格式要求：\n答案: [单个字母]\n解释: [选择理由]\n\n注意：只选一个，如A`;
      break;

     case 2:
      // 多选题
      basePrompt += `\n\n格式要求：\n答案: [多个字母用顿号分开]\n解释: [选择理由]\n\n注意：格式如A、B、C`;
      break;

     case 3:
      // 投票题
      basePrompt += `\n\n格式要求：\n答案: [单个字母]\n解释: [选择理由]\n\n注意：只选一个选项`;
      break;

     case 4:
      // 填空题
      basePrompt += `\n\n这是一道填空题。\n\n重要说明：\n- 题目内容已经处理，不含"填空题"等字样\n- 观察图片和文本，找出需要填入的内容\n- 答案中不要出现任何题目类型标识\n\n格式要求：\n答案: [直接给出填空内容]\n解释: [简要说明]\n\n示例：\n答案: 氧气,葡萄糖\n解释: 光合作用的产物\n\n多个填空用逗号分开`;
      break;

     case 5:
      // 主观题
      basePrompt += `\n\n格式要求：\n答案: [完整回答]\n解释: [补充说明]\n\n注意：直接回答，不要重复题目`;
      break;

     default:
      basePrompt += `\n\n格式要求：\n答案: [你的答案]\n解释: [详细解释]`;
    }
    return basePrompt;
  }
  // 改进的答案解析函数
    function parseAIAnswer(problem, aiAnswer) {
    try {
      const lines = String(aiAnswer || "").split("\n");
      let answerLine = "";
      // 寻找答案行
            for (const line of lines) if (line.includes("答案:") || line.includes("答案：")) {
        answerLine = line.replace(/答案[:：]\s*/, "").trim();
        break;
      }
      // 如果没找到答案行，尝试第一行
            if (!answerLine) answerLine = lines[0]?.trim() || "";
      console.log("[parseAIAnswer] 题目类型:", problem.problemType, "原始答案行:", answerLine);
      switch (problem.problemType) {
       case 1:
 // 单选题
               case 3:
        {
          // 投票题
          let m = answerLine.match(/[ABCDEFGHIJKLMNOPQRSTUVWXYZ]/);
          if (m) {
            console.log("[parseAIAnswer] 单选/投票解析结果:", [ m[0] ]);
            return [ m[0] ];
          }
          const chineseMatch = answerLine.match(/选择?([ABCDEFGHIJKLMNOPQRSTUVWXYZ])/);
          if (chineseMatch) {
            console.log("[parseAIAnswer] 单选/投票中文解析结果:", [ chineseMatch[1] ]);
            return [ chineseMatch[1] ];
          }
          console.log("[parseAIAnswer] 单选/投票解析失败");
          return null;
        }

       case 2:
        {
          // 多选题
          if (answerLine.includes("、")) {
            const options = answerLine.split("、").map(s => s.trim().match(/[ABCDEFGHIJKLMNOPQRSTUVWXYZ]/)).filter(m => m).map(m => m[0]);
            if (options.length > 0) {
              const result = [ ...new Set(options) ].sort();
              console.log("[parseAIAnswer] 多选顿号解析结果:", result);
              return result;
            }
          }
          if (answerLine.includes(",") || answerLine.includes("，")) {
            const options = answerLine.split(/[,，]/).map(s => s.trim().match(/[ABCDEFGHIJKLMNOPQRSTUVWXYZ]/)).filter(m => m).map(m => m[0]);
            if (options.length > 0) {
              const result = [ ...new Set(options) ].sort();
              console.log("[parseAIAnswer] 多选逗号解析结果:", result);
              return result;
            }
          }
          const letters = answerLine.match(/[ABCDEFGHIJKLMNOPQRSTUVWXYZ]/g);
          if (letters && letters.length > 1) {
            const result = [ ...new Set(letters) ].sort();
            console.log("[parseAIAnswer] 多选连续解析结果:", result);
            return result;
          }
          if (letters && letters.length === 1) {
            console.log("[parseAIAnswer] 多选单个解析结果:", letters);
            return letters;
          }
          console.log("[parseAIAnswer] 多选解析失败");
          return null;
        }

       case 4:
        {
          // 填空题
          // ✅ 更激进的清理策略
          let cleanAnswer = answerLine.replace(/^(填空题|简答题|问答题|题目|答案是?)[:：\s]*/gi, "").trim();
          console.log("[parseAIAnswer] 清理后答案:", cleanAnswer);
          // 如果清理后还包含这些词，继续清理
                    if (/填空题|简答题|问答题|题目/i.test(cleanAnswer)) {
            cleanAnswer = cleanAnswer.replace(/填空题|简答题|问答题|题目/gi, "").trim();
            console.log("[parseAIAnswer] 二次清理后:", cleanAnswer);
          }
          const answerLength = cleanAnswer.length;
          if (answerLength <= 50) {
            cleanAnswer = cleanAnswer.replace(/^[^\w\u4e00-\u9fa5]+/, "").replace(/[^\w\u4e00-\u9fa5]+$/, "");
            const blanks = cleanAnswer.split(/[,，;；\s]+/).filter(Boolean);
            if (blanks.length > 0) {
              console.log("[parseAIAnswer] 填空解析结果:", blanks);
              return blanks;
            }
          }
          if (cleanAnswer) {
            const result = {
              content: cleanAnswer,
              pics: []
            };
            console.log("[parseAIAnswer] 简答题解析结果:", result);
            return result;
          }
          console.log("[parseAIAnswer] 填空/简答解析失败");
          return null;
        }

       case 5:
        {
          // 主观题
          const content = answerLine.replace(/^(主观题|论述题)[:：\s]*/i, "").trim();
          if (content) {
            const result = {
              content: content,
              pics: []
            };
            console.log("[parseAIAnswer] 主观题解析结果:", result);
            return result;
          }
          console.log("[parseAIAnswer] 主观题解析失败");
          return null;
        }

       default:
        console.log("[parseAIAnswer] 未知题目类型:", problem.problemType);
        return null;
      }
    } catch (e) {
      console.error("[parseAIAnswer] 解析失败", e);
      return null;
    }
  }
  /**
   * Vuex 辅助工具 - 用于获取雨课堂主界面状态（附加调试日志）
   */  const L$2 = (...a) => console.log("[YKT][DBG][vuex-helper]", ...a);
  const W$2 = (...a) => console.warn("[YKT][WARN][vuex-helper]", ...a);
  const E = (...a) => console.error("[YKT][ERR][vuex-helper]", ...a);
  function getVueApp() {
    try {
      const app = document.querySelector("#app")?.__vue__;
      if (!app) W$2("getVueApp: 找不到 #app.__vue__");
      return app || null;
    } catch (e) {
      E("getVueApp 错误:", e);
      return null;
    }
  }
  /**
   * 统一返回「字符串」，并打印原始类型
   */  function getCurrentMainPageSlideId() {
    try {
      const app = getVueApp();
      if (!app || !app.$store) {
        W$2("getCurrentMainPageSlideId: 无 app 或 store");
        return null;
      }
      const currSlide = app.$store.state?.currSlide;
      if (!currSlide) {
        L$2("getCurrentMainPageSlideId: currSlide 为 null/undefined");
        return null;
      }
      const rawSid = currSlide.sid;
      const sidStr = rawSid == null ? null : String(rawSid);
      console.log("[getCurrentMainPageSlideId] 获取到 slideId:", sidStr, "{type:", currSlide.type, ", problemID:", currSlide.problemID, ", index:", currSlide.index, "}", "(raw type:", typeof rawSid, ", raw value:", rawSid, ")");
      return sidStr;
    } catch (e) {
      E("getCurrentMainPageSlideId 错误:", e);
      return null;
    }
  }
  function watchMainPageChange(callback) {
    const app = getVueApp();
    if (!app || !app.$store) {
      E("watchMainPageChange: 无法获取 Vue 实例或 store");
      return () => {};
    }
    const unwatch = app.$store.watch(state => state.currSlide, (ns, os) => {
      const newSid = ns?.sid == null ? null : String(ns.sid);
      const oldSid = os?.sid == null ? null : String(os.sid);
      L$2("主界面页面切换", {
        oldSid: oldSid,
        newSid: newSid,
        newType: ns?.type,
        newProblemID: ns?.problemID,
        newIndex: ns?.index,
        rawNewSidType: typeof ns?.sid
      });
      if (newSid) callback(newSid, ns);
    }, {
      deep: false
    });
    L$2("✅ 已启动主界面页面切换监听");
    return unwatch;
  }
  function waitForVueReady() {
    return new Promise(resolve => {
      const t0 = Date.now();
      const check = () => {
        const app = getVueApp();
        if (app && app.$store) {
          L$2("waitForVueReady: ok, elapsed(ms)=", Date.now() - t0);
          resolve(app);
        } else setTimeout(check, 100);
      };
      check();
    });
  }
  const L$1 = (...a) => console.log("[YKT][DBG][ai]", ...a);
  const W$1 = (...a) => console.warn("[YKT][WARN][ai]", ...a);
  let mounted$4 = false;
  let root$3;
  // 来自 presentation 的一次性优先
    let preferredSlideFromPresentation = null;
  function findSlideAcrossPresentations$1(idStr) {
    for (const [, pres] of repo.presentations) {
      const arr = pres?.slides || [];
      const hit = arr.find(s => String(s.id) === idStr);
      if (hit) return hit;
    }
    return null;
  }
  /** —— 运行时自愈：把 repo.slides 的数字键迁移为字符串键 —— */  function normalizeRepoSlidesKeys$1(tag = "ai.mount") {
    try {
      if (!repo || !repo.slides || !(repo.slides instanceof Map)) {
        W$1("normalizeRepoSlidesKeys: repo.slides 不是 Map");
        return;
      }
      const beforeKeys = Array.from(repo.slides.keys());
      const nums = beforeKeys.filter(k => typeof k === "number");
      let moved = 0;
      for (const k of nums) {
        const v = repo.slides.get(k);
        const ks = String(k);
        if (!repo.slides.has(ks)) {
          repo.slides.set(ks, v);
          moved++;
        }
      }
      const afterSample = Array.from(repo.slides.keys()).slice(0, 8);
      L$1(`[normalizeRepoSlidesKeys@${tag}] 总键=${beforeKeys.length}，数字键=${nums.length}，迁移为字符串=${moved}，sample=`, afterSample);
    } catch (e) {
      W$1("normalizeRepoSlidesKeys error:", e);
    }
  }
  function asIdStr(v) {
    return v == null ? null : String(v);
  }
  function isMainPriority() {
    const v = ui?.config?.aiSlidePickPriority;
    const ret = !(v === "presentation");
    L$1("isMainPriority?", {
      cfg: v,
      result: ret
    });
    return ret;
  }
  function fallbackSlideIdFromRecent() {
    try {
      if (repo.encounteredProblems?.length > 0) {
        const latest = repo.encounteredProblems.at(-1);
        const st = repo.problemStatus.get(latest.problemId);
        const sid = st?.slideId ? String(st.slideId) : null;
        L$1("fallbackSlideIdFromRecent", {
          latestProblemId: latest.problemId,
          sid: sid
        });
        return sid;
      }
    } catch (e) {
      W$1("fallbackSlideIdFromRecent error:", e);
    }
    return null;
  }
  function $$4(sel) {
    return document.querySelector(sel);
  }
  function getSlideByAny$1(id) {
    const sid = id == null ? null : String(id);
    if (!sid) return {
      slide: null,
      hit: "none"
    };
    if (repo.slides.has(sid)) return {
      slide: repo.slides.get(sid),
      hit: "string"
    };
    // 141 下 repo.slides 可能未灌入，跨 presentations 搜索并写回
        const cross = findSlideAcrossPresentations$1(sid);
    if (cross) {
      repo.slides.set(sid, cross);
      return {
        slide: cross,
        hit: "cross-fill"
      };
    }
    // 早期版本兼容（很少见）：如果有人把键存成 number，再试一次
        const asNum = Number.isNaN(Number(sid)) ? null : Number(sid);
    if (asNum != null && repo.slides.has(asNum)) {
      const v = repo.slides.get(asNum);
      repo.slides.set(sid, v);
      return {
        slide: v,
        hit: "number→string-migrate"
      };
    }
    return {
      slide: null,
      hit: "miss"
    };
  }
  function mountAIPanel() {
    if (mounted$4) return root$3;
    normalizeRepoSlidesKeys$1("ai.mount");
    const host = document.createElement("div");
    host.innerHTML = tpl$4;
    document.body.appendChild(host.firstElementChild);
    root$3 = document.getElementById("ykt-ai-answer-panel");
    $$4("#ykt-ai-close")?.addEventListener("click", () => showAIPanel(false));
    $$4("#ykt-ai-ask")?.addEventListener("click", askAIFusionMode);
    waitForVueReady().then(() => {
      watchMainPageChange((slideId, slideInfo) => {
        L$1("主界面页面切换事件", {
          slideId: slideId,
          slideInfoType: slideInfo?.type,
          problemID: slideInfo?.problemID,
          index: slideInfo?.index
        });
        preferredSlideFromPresentation = null;
        renderQuestion();
      });
    }).catch(e => {
      W$1("Vue 实例初始化失败，将使用备用方案:", e);
    });
    window.addEventListener("ykt:presentation:slide-selected", ev => {
      L$1("收到小窗选页事件", ev?.detail);
      const sid = asIdStr(ev?.detail?.slideId);
      const imageUrl = ev?.detail?.imageUrl || null;
      if (sid) preferredSlideFromPresentation = {
        slideId: sid,
        imageUrl: imageUrl
      };
      renderQuestion();
    });
    window.addEventListener("ykt:open-ai", () => {
      L$1("收到打开 AI 面板事件");
      showAIPanel(true);
    });
    window.addEventListener("ykt:ask-ai-for-slide", ev => {
      const detail = ev?.detail || {};
      const slideId = asIdStr(detail.slideId);
      const imageUrl = detail.imageUrl || "";
      L$1("收到“提问当前PPT”事件", {
        slideId: slideId,
        imageLen: imageUrl?.length || 0
      });
      if (slideId) {
        preferredSlideFromPresentation = {
          slideId: slideId,
          imageUrl: imageUrl
        };
        const look = getSlideByAny$1(slideId);
        if (look.slide && imageUrl) look.slide.image = imageUrl;
        L$1("提问当前PPT: lookupHit=", look.hit, "hasSlide=", !!look.slide);
      }
      showAIPanel(true);
      renderQuestion();
      const img = document.getElementById("ykt-ai-selected-thumb");
      const box = document.getElementById("ykt-ai-selected");
      if (img && box) {
        img.src = preferredSlideFromPresentation?.imageUrl || "";
        box.style.display = preferredSlideFromPresentation?.imageUrl ? "" : "none";
      }
    });
    mounted$4 = true;
    L$1("mountAIPanel 完成, cfg.aiSlidePickPriority=", ui?.config?.aiSlidePickPriority);
    return root$3;
  }
  function showAIPanel(v = true) {
    mountAIPanel();
    root$3.classList.toggle("visible", !!v);
    if (v) {
      renderQuestion();
      if (ui.config.aiAutoAnalyze) queueMicrotask(() => {
        askAIFusionMode();
      });
    }
    const aiBtn = document.getElementById("ykt-btn-ai");
    if (aiBtn) aiBtn.classList.toggle("active", !!v);
    L$1("showAIPanel", {
      visible: v
    });
  }
  function setAILoading(v) {
    $$4("#ykt-ai-loading").style.display = v ? "" : "none";
  }
  function setAIError(msg = "") {
    const el = $$4("#ykt-ai-error");
    el.style.display = msg ? "" : "none";
    el.textContent = msg || "";
  }
  function setAIAnswer(content = "") {
    $$4("#ykt-ai-answer").textContent = content || "";
  }
  function getCustomPrompt() {
    const el = $$4("#ykt-ai-custom-prompt");
    return el ? el.value.trim() || "" : "";
  }
  function _logMapLookup(where, id) {
    const sid = id == null ? null : String(id);
    const hasS = sid ? repo.slides.has(sid) : false;
    const nid = sid != null && !Number.isNaN(Number(sid)) ? Number(sid) : null;
    const hasN = nid != null ? repo.slides.has(nid) : false;
    const sample = (() => {
      try {
        return Array.from(repo.slides.keys()).slice(0, 8);
      } catch {
        return [];
      }
    })();
    L$1(`${where} -> lookup`, {
      id: sid,
      hasString: hasS,
      hasNumber: hasN,
      sampleKeys: sample
    });
  }
  function renderQuestion() {
    let displayText = "";
    let hasPageSelected = false;
    let selectionSource = "";
    let slide = null;
    if (preferredSlideFromPresentation?.slideId) {
      const sid = asIdStr(preferredSlideFromPresentation.slideId);
      _logMapLookup("renderQuestion(preferred from presentation)", sid);
      const look = getSlideByAny$1(sid);
      slide = look.slide;
      if (slide) {
        displayText = `来自课件面板：${slide.title || `第 ${slide.page || slide.index || ""} 页`}`;
        selectionSource = `课件浏览（传入/${look.hit}键命中）`;
        hasPageSelected = true;
      }
    }
    if (!slide) {
      const prio = isMainPriority();
      if (prio) {
        const mainSid = asIdStr(getCurrentMainPageSlideId());
        _logMapLookup("renderQuestion(main priority)", mainSid);
        const look = getSlideByAny$1(mainSid);
        slide = look.slide;
        if (slide) {
          displayText = `主界面当前页: ${slide.title || `第 ${slide.page || slide.index || ""} 页`}`;
          selectionSource = `主界面检测（${look.hit}键命中）`;
          displayText += slide.problem ? "\n📝 此页面包含题目" : "\n📄 此页面为普通内容页";
          hasPageSelected = true;
        }
      } else {
        const presentationPanel = document.getElementById("ykt-presentation-panel");
        const isOpen = presentationPanel && presentationPanel.classList.contains("visible");
        const curSid = asIdStr(repo.currentSlideId);
        L$1("renderQuestion(presentation priority)", {
          isOpen: isOpen,
          curSid: curSid
        });
        if (isOpen && curSid) {
          _logMapLookup("renderQuestion(pres open, curSid)", curSid);
          const look = getSlideByAny$1(curSid);
          slide = look.slide;
          if (slide) {
            displayText = `课件面板选中: ${slide.title || `第 ${slide.page || slide.index || ""} 页`}`;
            selectionSource = `课件浏览面板（${look.hit}键命中）`;
            displayText += slide.problem ? "\n📝 此页面包含题目" : "\n📄 此页面为普通内容页";
            hasPageSelected = true;
          }
        } else {
          if (!slide && curSid) {
            _logMapLookup("renderQuestion(pres fallback curSid)", curSid);
            const look = getSlideByAny$1(curSid);
            slide = look.slide;
            if (slide) {
              displayText = `课件面板最近选中: ${slide.title || `第 ${slide.page || slide.index || ""} 页`}`;
              selectionSource = `课件浏览（兜底/${look.hit}键命中）`;
              hasPageSelected = true;
            }
          }
          if (!slide) {
            const fb = fallbackSlideIdFromRecent();
            if (fb) {
              _logMapLookup("renderQuestion(fallback recent)", fb);
              const look = getSlideByAny$1(fb);
              slide = look.slide;
              if (slide) {
                displayText = `最近题目关联页: ${slide.title || `第 ${slide.page || slide.index || ""} 页`}`;
                selectionSource = `最近题目（兜底/${look.hit}键命中）`;
                hasPageSelected = true;
              }
            }
          }
          if (!slide) {
            displayText = "未检测到当前页面\n💡 请在主界面或课件面板中选择页面。";
            selectionSource = "无";
          }
        }
      }
    }
    const el = document.querySelector("#ykt-ai-question-display");
    if (el) el.textContent = displayText;
    const img = document.getElementById("ykt-ai-selected-thumb");
    const box = document.getElementById("ykt-ai-selected");
    if (img && box) if (preferredSlideFromPresentation?.imageUrl) {
      img.src = preferredSlideFromPresentation.imageUrl;
      box.style.display = "";
    } else box.style.display = "none";
    const statusEl = document.querySelector("#ykt-ai-text-status");
    if (statusEl) {
      statusEl.textContent = hasPageSelected ? `✓ 已选择页面（来源：${selectionSource}），可进行图像分析` : "⚠ 请选择要分析的页面";
      statusEl.className = hasPageSelected ? "text-status success" : "text-status warning";
    }
  }
  async function askAIFusionMode() {
    setAIError("");
    setAILoading(true);
    setAIAnswer("");
    try {
      if (!ui.config.ai?.kimiApiKey) throw new Error("请先在设置中配置 Kimi API Key");
      let currentSlideId = null;
      let slide = null;
      let selectionSource = "";
      let forcedImageUrl = null;
      if (preferredSlideFromPresentation?.slideId) {
        currentSlideId = asIdStr(preferredSlideFromPresentation.slideId);
        const look = getSlideByAny$1(currentSlideId);
        slide = look.slide;
        forcedImageUrl = preferredSlideFromPresentation.imageUrl || null;
        selectionSource = `课件浏览（传入/${look.hit}键命中）`;
        L$1("[ask] 使用presentation传入的页面:", {
          currentSlideId: currentSlideId,
          lookupHit: look.hit,
          hasSlide: !!slide
        });
      }
      if (!slide) {
        const prio = isMainPriority();
        if (prio) {
          const mainSlideId = asIdStr(getCurrentMainPageSlideId());
          if (mainSlideId) {
            currentSlideId = mainSlideId;
            const look = getSlideByAny$1(currentSlideId);
            slide = look.slide;
            selectionSource = `主界面当前页面（${look.hit}键命中）`;
            L$1("[ask] 使用主界面当前页面:", {
              currentSlideId: currentSlideId,
              lookupHit: look.hit,
              hasSlide: !!slide
            });
          }
        } else {
          const presentationPanel = document.getElementById("ykt-presentation-panel");
          const isOpen = presentationPanel && presentationPanel.classList.contains("visible");
          if (isOpen && repo.currentSlideId != null) {
            currentSlideId = asIdStr(repo.currentSlideId);
            const look = getSlideByAny$1(currentSlideId);
            slide = look.slide;
            selectionSource = `课件浏览面板（${look.hit}键命中）`;
            L$1("[ask] 使用课件面板选中的页面:", {
              currentSlideId: currentSlideId,
              lookupHit: look.hit,
              hasSlide: !!slide
            });
          }
        }
      }
      if (!slide && repo.currentSlideId != null) {
        currentSlideId = asIdStr(repo.currentSlideId);
        const look = getSlideByAny$1(currentSlideId);
        slide = look.slide;
        selectionSource = selectionSource || `课件浏览（兜底/${look.hit}键命中）`;
        L$1("[ask] Fallback 使用 repo.currentSlideId:", {
          currentSlideId: currentSlideId,
          lookupHit: look.hit,
          hasSlide: !!slide
        });
      }
      if (!slide) {
        const fb = fallbackSlideIdFromRecent();
        if (fb) {
          currentSlideId = asIdStr(fb);
          const look = getSlideByAny$1(currentSlideId);
          slide = look.slide;
          selectionSource = selectionSource || `最近题目（兜底/${look.hit}键命中）`;
          L$1("[ask] Fallback 使用 最近题目 slideId:", {
            currentSlideId: currentSlideId,
            lookupHit: look.hit,
            hasSlide: !!slide
          });
        }
      }
      if (!currentSlideId || !slide) throw new Error("无法确定要分析的页面。请在主界面打开一个页面，或在课件浏览中选择页面。");
      L$1("[ask] 页面选择来源:", selectionSource, "页面ID:", currentSlideId, "页面信息:", slide);
      if (forcedImageUrl) {
        slide.image = forcedImageUrl;
 // 强制指定
                L$1("[ask] 使用传入 imageUrl");
      }
      L$1("[ask] 获取页面图片...");
      ui.toast(`正在获取${selectionSource}图片...`, 2e3);
      const imageBase64 = await captureSlideImage(currentSlideId);
      if (!imageBase64) throw new Error("无法获取页面图片，请确保页面已加载完成");
      L$1("[ask] ✅ 页面图片获取成功，大小(KB)=", Math.round(imageBase64.length / 1024));
      let textPrompt = `【页面说明】当前页面可能不是题目页；请结合用户提示作答。`;
      const customPrompt = getCustomPrompt();
      if (customPrompt) {
        textPrompt += `\n\n【用户自定义要求】\n${customPrompt}`;
        L$1("[ask] 用户自定义prompt:", customPrompt);
      }
      ui.toast(`正在分析${selectionSource}内容...`, 3e3);
      L$1("[ask] 调用 Vision API...");
      const aiContent = await queryKimiVision(imageBase64, textPrompt, ui.config.ai);
      setAILoading(false);
      L$1("[ask] Vision API调用成功, 内容长度=", aiContent?.length);
      // 若当前页有题目，尝试解析
            let parsed = null;
      const problem = slide?.problem;
      if (problem) {
        parsed = parseAIAnswer(problem, aiContent);
        L$1("[ask] 解析结果:", parsed);
      }
      let displayContent = `${selectionSource}图像分析结果：\n${aiContent}`;
      if (customPrompt) displayContent = `${selectionSource}图像分析结果（包含自定义要求）：\n${aiContent}`;
      if (parsed && problem) setAIAnswer(`${displayContent}\n\nAI 建议答案：${JSON.stringify(parsed)}`);
      // 省略：编辑区逻辑（与你现有版本一致）
       else {
        if (!problem) displayContent += "\n\n💡 当前页面不是题目页面（或未识别到题目）。";
        setAIAnswer(displayContent);
      }
    } catch (e) {
      setAILoading(false);
      W$1("[ask] 页面分析失败:", e);
      setAIError(`页面分析失败: ${e.message}`);
    }
  }
  async function askAIForCurrent() {
    return askAIFusionMode();
  }
  var tpl$3 = '<div id="ykt-presentation-panel" class="ykt-panel">\r\n  <div class="panel-header">\r\n    <h3>课件浏览</h3>\r\n    <div class="panel-controls">\r\n      <label>\r\n        <input type="checkbox" id="ykt-show-all-slides"> 切换全部页面/问题页面\r\n      </label>\r\n      <button id="ykt-ask-current">提问当前PPT</button>\r\n      <button id="ykt-open-problem-list">题目列表</button>\r\n      <button id="ykt-download-current">截图下载</button>\r\n      <button id="ykt-download-pdf">整册下载(PDF)</button>\r\n      <span class="close-btn" id="ykt-presentation-close"><i class="fas fa-times"></i></span>\r\n    </div>\r\n  </div>\r\n\r\n  <div class="panel-body">\r\n    <div class="panel-left">\r\n      <div id="ykt-presentation-list" class="presentation-list"></div>\r\n    </div>\r\n    <div class="panel-right">\r\n      <div id="ykt-slide-view" class="slide-view">\r\n        <div class="slide-cover">\r\n          <div class="empty-message">选择左侧的幻灯片查看详情</div>\r\n        </div>\r\n        <div id="ykt-problem-view" class="problem-view"></div>\r\n      </div>\r\n    </div>\r\n  </div>\r\n</div>\r\n';
  let mounted$3 = false;
  let host;
  // 在 repo.slides miss 时，跨所有 presentations 的 slides 做兜底搜索
    function findSlideAcrossPresentations(idStr) {
    for (const [, pres] of repo.presentations) {
      const arr = pres?.slides || [];
      const hit = arr.find(s => String(s.id) === idStr);
      if (hit) return hit;
    }
    return null;
  }
  const L = (...a) => console.log("[YKT][DBG][presentation]", ...a);
  const W = (...a) => console.warn("[YKT][WARN][presentation]", ...a);
  function $$3(sel) {
    return document.querySelector(sel);
  }
  /** —— 运行时自愈：把 repo.slides 的数字键迁移为字符串键 —— */  function normalizeRepoSlidesKeys(tag = "presentation.mount") {
    try {
      if (!repo || !repo.slides || !(repo.slides instanceof Map)) {
        W("normalizeRepoSlidesKeys: repo.slides 不是 Map");
        return;
      }
      const beforeKeys = Array.from(repo.slides.keys());
      const nums = beforeKeys.filter(k => typeof k === "number");
      let moved = 0;
      for (const k of nums) {
        const v = repo.slides.get(k);
        const ks = String(k);
        if (!repo.slides.has(ks)) {
          repo.slides.set(ks, v);
          moved++;
        }
        // 保留旧键以防其他模块还在用数字键；仅打印提示
            }
      const afterSample = Array.from(repo.slides.keys()).slice(0, 8);
      L(`[normalizeRepoSlidesKeys@${tag}] 总键=${beforeKeys.length}，数字键=${nums.length}，迁移为字符串=${moved}，sample=`, afterSample);
    } catch (e) {
      W("normalizeRepoSlidesKeys error:", e);
    }
  }
  // Map 查找（string 优先），miss 时跨 presentations 查找并写回 repo.slides
    function getSlideByAny(id) {
    const sid = id == null ? null : String(id);
    if (!sid) return {
      slide: null,
      hit: "none"
    };
    if (repo.slides.has(sid)) return {
      slide: repo.slides.get(sid),
      hit: "string"
    };
    const cross = findSlideAcrossPresentations(sid);
    if (cross) {
      repo.slides.set(sid, cross);
      return {
        slide: cross,
        hit: "cross-fill"
      };
    }
    return {
      slide: null,
      hit: "miss"
    };
  }
  function mountPresentationPanel() {
    if (mounted$3) return host;
    normalizeRepoSlidesKeys("presentation.mount");
    const wrapper = document.createElement("div");
    wrapper.innerHTML = tpl$3;
    document.body.appendChild(wrapper.firstElementChild);
    host = document.getElementById("ykt-presentation-panel");
    $$3("#ykt-presentation-close")?.addEventListener("click", () => showPresentationPanel(false));
    $$3("#ykt-open-problem-list")?.addEventListener("click", () => {
      showPresentationPanel(false);
      window.dispatchEvent(new CustomEvent("ykt:open-problem-list"));
    });
    $$3("#ykt-ask-current")?.addEventListener("click", () => {
      const sid = repo.currentSlideId != null ? String(repo.currentSlideId) : null;
      const lookup = getSlideByAny(sid);
      L("点击“提问当前PPT”", {
        currentSlideId: sid,
        lookupHit: lookup.hit,
        hasSlide: !!lookup.slide
      });
      if (!sid) return ui.toast("请先在左侧选择一页PPT", 2500);
      const imageUrl = lookup.slide?.image || lookup.slide?.thumbnail || "";
      window.dispatchEvent(new CustomEvent("ykt:ask-ai-for-slide", {
        detail: {
          slideId: sid,
          imageUrl: imageUrl
        }
      }));
      window.dispatchEvent(new CustomEvent("ykt:open-ai"));
    });
    $$3("#ykt-download-current")?.addEventListener("click", downloadCurrentSlide);
    $$3("#ykt-download-pdf")?.addEventListener("click", downloadPresentationPDF);
    const cb = $$3("#ykt-show-all-slides");
    cb.checked = !!ui.config.showAllSlides;
    cb.addEventListener("change", () => {
      ui.config.showAllSlides = !!cb.checked;
      ui.saveConfig();
      L("切换 showAllSlides =", ui.config.showAllSlides);
      updatePresentationList();
    });
    mounted$3 = true;
    L("mountPresentationPanel 完成");
    return host;
  }
  function showPresentationPanel(visible = true) {
    mountPresentationPanel();
    host.classList.toggle("visible", !!visible);
    if (visible) updatePresentationList();
    const presBtn = document.getElementById("ykt-btn-pres");
    if (presBtn) presBtn.classList.toggle("active", !!visible);
    L("showPresentationPanel", {
      visible: visible
    });
  }
  function updatePresentationList() {
    mountPresentationPanel();
    const listEl = document.getElementById("ykt-presentation-list");
    if (!listEl) {
      W("updatePresentationList: 缺少容器");
      return;
    }
    listEl.innerHTML = "";
    if (repo.presentations.size === 0) {
      listEl.innerHTML = '<p class="no-presentations">暂无课件记录</p>';
      W("无 presentations");
      return;
    }
    const currentPath = window.location.pathname;
    const m = currentPath.match(/\/lesson\/fullscreen\/v3\/([^/]+)/);
    const currentLessonFromURL = m ? m[1] : null;
    L("过滤课件", {
      currentLessonFromURL: currentLessonFromURL,
      repoCurrentLessonId: repo.currentLessonId
    });
    const filtered = new Map;
    for (const [id, p] of repo.presentations) if (currentLessonFromURL && repo.currentLessonId && currentLessonFromURL === repo.currentLessonId) filtered.set(id, p); else if (!currentLessonFromURL) filtered.set(id, p); else if (currentLessonFromURL === repo.currentLessonId) filtered.set(id, p);
    const presentationsToShow = filtered.size > 0 ? filtered : repo.presentations;
    L("展示课件数量=", presentationsToShow.size);
    try {
      let filled = 0, total = 0;
      for (const [, pres] of presentationsToShow) {
        const arr = pres?.slides || [];
        total += arr.length;
        for (const s of arr) {
          const sid = String(s.id);
          if (!repo.slides.has(sid)) {
            repo.slides.set(sid, s);
            filled++;
          }
        }
      }
      const sample = Array.from(repo.slides.keys()).slice(0, 8);
      L("[hydrate slides → repo.slides]", {
        filled: filled,
        totalVisibleSlides: total,
        sampleKeys: sample
      });
    } catch (e) {
      W("hydrate repo.slides 失败：", e);
    }
    for (const [id, presentation] of presentationsToShow) {
      const cont = document.createElement("div");
      cont.className = "presentation-container";
      const titleEl = document.createElement("div");
      titleEl.className = "presentation-title";
      titleEl.innerHTML = `\n      <span>${presentation.title || `课件 ${id}`}</span>\n      <i class="fas fa-download download-btn" title="下载课件"></i>\n    `;
      cont.appendChild(titleEl);
      titleEl.querySelector(".download-btn")?.addEventListener("click", e => {
        e.stopPropagation();
        L("点击下载课件", {
          presId: String(presentation.id)
        });
        downloadPresentation(presentation);
      });
      const slidesWrap = document.createElement("div");
      slidesWrap.className = "slide-thumb-list";
      const showAll = !!ui.config.showAllSlides;
      const slides = presentation.slides || [];
      const slidesToShow = showAll ? slides : slides.filter(s => s.problem);
      const currentIdStr = repo.currentSlideId != null ? String(repo.currentSlideId) : null;
      L("渲染课件缩略图", {
        presId: String(presentation.id),
        slidesTotal: slides.length,
        slidesShown: slidesToShow.length,
        currentSlideId: currentIdStr
      });
      for (const s of slidesToShow) {
        const presIdStr = String(presentation.id);
        const slideIdStr = String(s.id);
        const thumb = document.createElement("div");
        thumb.className = "slide-thumb";
        thumb.dataset.slideId = slideIdStr;
        if (currentIdStr && slideIdStr === currentIdStr) thumb.classList.add("active");
        if (s.problem) {
          const pid = s.problem.problemId;
          const status = repo.problemStatus.get(pid);
          if (status) thumb.classList.add("unlocked");
          if (s.problem.result) thumb.classList.add("answered");
        }
        thumb.addEventListener("click", () => {
          L("缩略图点击", {
            presIdStr: presIdStr,
            slideIdStr: slideIdStr,
            beforeRepo: {
              curPres: String(repo.currentPresentationId || ""),
              curSlide: String(repo.currentSlideId || "")
            },
            mapHasNow: repo.slides.has(slideIdStr)
          });
          repo.currentPresentationId = presIdStr;
          repo.currentSlideId = slideIdStr;
          // 高亮切换 & 打印 DOM 现状
                    slidesWrap.querySelectorAll(".slide-thumb.active").forEach(el => el.classList.remove("active"));
          thumb.classList.add("active");
          const actives = slidesWrap.querySelectorAll(".slide-thumb.active");
          const allIds = Array.from(slidesWrap.querySelectorAll(".slide-thumb")).map(x => x.dataset.slideId);
          L("高亮状态", {
            activeCount: actives.length,
            activeId: thumb.dataset.slideId,
            allIdsSample: allIds.slice(0, 10)
          });
          updateSlideView();
          // 确保当前选中页已写入 repo.slides（即便上面 hydrate 漏了，这里也兜一次）
                    if (!repo.slides.has(slideIdStr)) {
            const cross = findSlideAcrossPresentations(slideIdStr);
            if (cross) {
              repo.slides.set(slideIdStr, cross);
              L("click-fill repo.slides <- cross", {
                slideIdStr: slideIdStr
              });
            }
          }
          // 打印 repo.slides 的键分布
                    try {
            const keysSample = Array.from(repo.slides.keys()).slice(0, 8);
            const typeDist = keysSample.reduce((m, k) => (m[typeof k] = (m[typeof k] || 0) + 1, 
            m), {});
            L("repo.slides keys sample:", keysSample, "typeDist:", typeDist);
          } catch {}
          const detail = {
            slideId: slideIdStr,
            presentationId: presIdStr
          };
          L("派发事件 ykt:presentation:slide-selected", detail);
          window.dispatchEvent(new CustomEvent("ykt:presentation:slide-selected", {
            detail: detail
          }));
          L("调用 actions.navigateTo ->", {
            presIdStr: presIdStr,
            slideIdStr: slideIdStr
          });
          actions.navigateTo(presIdStr, slideIdStr);
        });
        const img = document.createElement("img");
        if (presentation.width && presentation.height) img.style.aspectRatio = `${presentation.width}/${presentation.height}`;
        img.src = s.thumbnail || "";
        img.alt = s.title || `第 ${s.page ?? ""} 页`;
        img.onerror = function() {
          W("缩略图加载失败，移除该项", {
            slideIdStr: slideIdStr,
            src: img.src
          });
          if (thumb.parentNode) thumb.parentNode.removeChild(thumb);
        };
        const idx = document.createElement("span");
        idx.className = "slide-index";
        idx.textContent = s.index ?? "";
        thumb.appendChild(img);
        thumb.appendChild(idx);
        slidesWrap.appendChild(thumb);
      }
      cont.appendChild(slidesWrap);
      listEl.appendChild(cont);
    }
  }
  function downloadPresentation(presentation) {
    repo.currentPresentationId = String(presentation.id);
    L("downloadPresentation -> 设置 currentPresentationId", repo.currentPresentationId);
    downloadPresentationPDF();
  }
  function updateSlideView() {
    mountPresentationPanel();
    const slideView = $$3("#ykt-slide-view");
    const problemView = $$3("#ykt-problem-view");
    slideView.querySelector(".slide-cover")?.classList.add("hidden");
    problemView.innerHTML = "";
    const curId = repo.currentSlideId != null ? String(repo.currentSlideId) : null;
    const lookup = getSlideByAny(curId);
    L("updateSlideView", {
      curId: curId,
      lookupHit: lookup.hit,
      hasInMap: !!lookup.slide
    });
    if (!curId) {
      slideView.querySelector(".slide-cover")?.classList.remove("hidden");
      return;
    }
    const slide = lookup.slide;
    if (!slide) {
      W("updateSlideView: 根据 curId 未取到 slide", {
        curId: curId
      });
      return;
    }
    const cover = document.createElement("div");
    cover.className = "slide-cover";
    const img = document.createElement("img");
    img.crossOrigin = "anonymous";
    img.src = slide.image || slide.thumbnail || "";
    img.alt = slide.title || "";
    cover.appendChild(img);
    if (slide.problem) {
      const prob = slide.problem;
      const box = document.createElement("div");
      box.className = "problem-box";
      const head = document.createElement("div");
      head.className = "problem-head";
      head.textContent = prob.body || `题目 ${prob.problemId}`;
      box.appendChild(head);
      if (Array.isArray(prob.options) && prob.options.length) {
        const opts = document.createElement("div");
        opts.className = "problem-options";
        prob.options.forEach(o => {
          const li = document.createElement("div");
          li.className = "problem-option";
          li.textContent = `${o.key}. ${o.value}`;
          opts.appendChild(li);
        });
        box.appendChild(opts);
      }
      problemView.appendChild(box);
    }
    slideView.innerHTML = "";
    slideView.appendChild(cover);
    slideView.appendChild(problemView);
  }
  async function downloadCurrentSlide() {
    const sid = repo.currentSlideId != null ? String(repo.currentSlideId) : null;
    const lookup = getSlideByAny(sid);
    L("downloadCurrentSlide", {
      sid: sid,
      lookupHit: lookup.hit,
      has: !!lookup.slide
    });
    if (!sid) return ui.toast("请先选择一页课件/题目");
    const slide = lookup.slide;
    if (!slide) return;
    try {
      const html2canvas = await ensureHtml2Canvas();
      const el = document.getElementById("ykt-slide-view");
      const canvas = await html2canvas(el, {
        useCORS: true,
        allowTaint: false
      });
      const a = document.createElement("a");
      a.download = `slide-${sid}.png`;
      a.href = canvas.toDataURL("image/png");
      a.click();
    } catch (e) {
      ui.toast(`截图失败: ${e.message}`);
    }
  }
  async function downloadPresentationPDF() {
    const pid = repo.currentPresentationId != null ? String(repo.currentPresentationId) : null;
    L("downloadPresentationPDF", {
      pid: pid,
      hasPres: pid ? repo.presentations.has(pid) : false
    });
    if (!pid) return ui.toast("请先在左侧选择一份课件");
    const pres = repo.presentations.get(pid);
    if (!pres || !Array.isArray(pres.slides) || pres.slides.length === 0) return ui.toast("未找到该课件的页面");
    const showAll = !!ui.config.showAllSlides;
    const slides = pres.slides.filter(s => showAll || s.problem);
    if (slides.length === 0) return ui.toast("当前筛选下没有可导出的页面");
    try {
      await ensureJsPDF();
      const {jsPDF: jsPDF} = window.jspdf || {};
      if (!jsPDF) throw new Error("jsPDF 未加载成功");
      const doc = new jsPDF({
        unit: "pt",
        format: "a4",
        orientation: "portrait"
      });
      const pageW = 595, pageH = 842;
      const margin = 24;
      const maxW = pageW - margin * 2;
      const maxH = pageH - margin * 2;
      const loadImage = src => new Promise((resolve, reject) => {
        const img = new Image;
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
      });
      for (let i = 0; i < slides.length; i++) {
        const s = slides[i];
        const url = s.image || s.thumbnail;
        if (!url) {
          if (i > 0) doc.addPage();
          continue;
        }
        const img = await loadImage(url);
        const iw = img.naturalWidth || img.width;
        const ih = img.naturalHeight || img.height;
        const r = Math.min(maxW / iw, maxH / ih);
        const w = Math.floor(iw * r);
        const h = Math.floor(ih * r);
        const x = Math.floor((pageW - w) / 2);
        const y = Math.floor((pageH - h) / 2);
        if (i > 0) doc.addPage();
        doc.addImage(img, "PNG", x, y, w, h);
      }
      const name = (pres.title || `课件-${pid}`).replace(/[\\/:*?"<>|]/g, "_");
      doc.save(`${name}.pdf`);
    } catch (e) {
      ui.toast(`导出 PDF 失败：${e.message || e}`);
    }
  }
  var tpl$2 = '<div id="ykt-problem-list-panel" class="ykt-panel">\r\n  <div class="panel-header">\r\n    <h3>课堂习题列表</h3>\r\n    <span class="close-btn" id="ykt-problem-list-close"><i class="fas fa-times"></i></span>\r\n  </div>\r\n\r\n  <div class="panel-body">\r\n    <div id="ykt-problem-list" class="problem-list">\r\n      \x3c!-- 由 problem-list.js 动态填充：\r\n           .problem-row\r\n             .problem-title\r\n             .problem-meta\r\n             .problem-actions (查看 / AI解答 / 已作答) --\x3e\r\n    </div>\r\n  </div>\r\n</div>\r\n';
  // ==== [ADD] 工具方法 & 取题接口（兼容旧版多端点） ====
    function create(tag, cls) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }
  const HEADERS = () => ({
    "Content-Type": "application/json",
    xtbz: "ykt",
    "X-Client": "h5",
    Authorization: "Bearer " + (typeof localStorage !== "undefined" ? localStorage.getItem("Authorization") || "" : "")
  });
  async function httpGet(url) {
    return new Promise((resolve, reject) => {
      try {
        const xhr = new XMLHttpRequest;
        xhr.open("GET", url, true);
        const h = HEADERS();
        for (const k in h) xhr.setRequestHeader(k, h[k]);
        xhr.onload = () => {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch {
            reject(new Error("解析响应失败"));
          }
        };
        xhr.onerror = () => reject(new Error("网络失败"));
        xhr.send();
      } catch (e) {
        reject(e);
      }
    });
  }
  // 兼容旧版：依次尝试多个端点，先成功先用
    async function fetchProblemDetail(problemId) {
    const candidates = [ `/api/v3/lesson/problem/detail?problemId=${problemId}`, `/api/v3/lesson/problem/get?problemId=${problemId}`, `/mooc-api/v1/lms/problem/detail?problem_id=${problemId}` ];
    for (const url of candidates) try {
      const resp = await httpGet(url);
      if (resp && typeof resp === "object" && (resp.code === 0 || resp.success === true)) return resp;
    } catch (_) {/* try next */}
    throw new Error("无法获取题目信息");
  }
  function pretty(obj) {
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(obj);
    }
  }
  // ==== [ADD] 渲染行上的按钮（查看 / AI解答 / 刷新题目） ====
    function bindRowActions(row, e, prob) {
    const actionsBar = row.querySelector(".problem-actions");
    const btnGo = create("button");
    btnGo.textContent = "查看";
    btnGo.onclick = () => actions.navigateTo(e.presentationId, e.slide?.id || e.slideId);
    actionsBar.appendChild(btnGo);
    const btnAI = create("button");
    btnAI.textContent = "AI解答";
    btnAI.onclick = () => window.dispatchEvent(new CustomEvent("ykt:open-ai", {
      detail: {
        problemId: e.problemId
      }
    }));
    actionsBar.appendChild(btnAI);
    const btnRefresh = create("button");
    btnRefresh.textContent = "刷新题目";
    btnRefresh.onclick = async () => {
      row.classList.add("loading");
      try {
        const resp = await fetchProblemDetail(e.problemId);
        const detail = resp.data?.problem || resp.data || resp.result || {};
        const merged = Object.assign({}, prob || {}, detail, {
          problemId: e.problemId,
          problemType: e.problemType
        });
        repo.problems.set(e.problemId, merged);
        updateRow(row, e, merged);
        ui.toast("已刷新题目");
      } catch (err) {
        ui.toast("刷新失败：" + (err?.message || err));
      } finally {
        row.classList.remove("loading");
      }
    };
    actionsBar.appendChild(btnRefresh);
  }
  function updateRow(row, e, prob) {
    // 标题
    const title = row.querySelector(".problem-title");
    title.textContent = (prob?.body || e.body || prob?.title || `题目 ${e.problemId}`).slice(0, 120);
    // 元信息（含截止时间）
        const meta = row.querySelector(".problem-meta");
    const status = prob?.status || e.status || {};
    const answered = !!(prob?.result || status?.answered || status?.myAnswer);
    const endTime = Number(status?.endTime || prob?.endTime || e.endTime || 0) || void 0;
    meta.textContent = `PID: ${e.problemId} / 类型: ${e.problemType} / 状态: ${answered ? "已作答" : "未作答"} / 截止: ${endTime ? new Date(endTime).toLocaleString() : "未知"}`;
    // 容器
        let detail = row.querySelector(".problem-detail");
    if (!detail) {
      detail = create("div", "problem-detail");
      row.appendChild(detail);
    }
    detail.innerHTML = "";
    // ===== 显示“已作答答案” =====
        const answeredBox = create("div", "answered-box");
    const ansLabel = create("div", "label");
    ansLabel.textContent = "已作答答案";
    const ansPre = create("pre");
    ansPre.textContent = pretty(prob?.result || status?.myAnswer || {});
    answeredBox.appendChild(ansLabel);
    answeredBox.appendChild(ansPre);
    detail.appendChild(answeredBox);
    // ===== 手动答题（含补交） =====
        const editorBox = create("div", "editor-box");
    const editLabel = create("div", "label");
    editLabel.textContent = "手动答题（JSON）";
    const textarea = create("textarea");
    textarea.rows = 6;
    textarea.placeholder = '{"answers":[...]}';
    textarea.value = pretty(prob?.result || status?.myAnswer || prob?.suggested || {});
    editorBox.appendChild(editLabel);
    editorBox.appendChild(textarea);
    const submitBar = create("div", "submit-bar");
    // 保存（仅本地）
        const btnSaveLocal = create("button");
    btnSaveLocal.textContent = "保存(本地)";
    btnSaveLocal.onclick = () => {
      try {
        const parsed = JSON.parse(textarea.value || "{}");
        const merged = Object.assign({}, prob || {}, {
          result: parsed
        });
        repo.problems.set(e.problemId, merged);
        ui.toast("已保存到本地列表");
        updateRow(row, e, merged);
      } catch (err) {
        ui.toast("JSON 解析失败：" + (err?.message || err));
      }
    };
    submitBar.appendChild(btnSaveLocal);
    // 正常提交（过期则提示是否补交）
        const startTime = Number(status?.startTime || prob?.startTime || e.startTime || 0) || void 0;
    const btnSubmit = create("button");
    btnSubmit.textContent = "提交";
    btnSubmit.onclick = async () => {
      try {
        const result = JSON.parse(textarea.value || "{}");
        row.classList.add("loading");
        const {route: route} = await submitAnswer({
          problemId: e.problemId,
          problemType: e.problemType
        }, result, {
          startTime: startTime,
          endTime: endTime,
          lessonId: repo.currentLessonId,
          autoGate: false
        });
        ui.toast(route === "answer" ? "提交成功" : "补交成功");
        const merged = Object.assign({}, prob || {}, {
          result: result
        }, {
          status: {
            ...prob?.status || {},
            answered: true
          }
        });
        repo.problems.set(e.problemId, merged);
        updateRow(row, e, merged);
      } catch (err) {
        if (err?.name === "DeadlineError") ui.confirm("已过截止，是否执行补交？").then(async ok => {
          if (!ok) return;
          try {
            const result = JSON.parse(textarea.value || "{}");
            row.classList.add("loading");
            await submitAnswer({
              problemId: e.problemId,
              problemType: e.problemType
            }, result, {
              startTime: startTime,
              endTime: endTime,
              forceRetry: true,
              lessonId: repo.currentLessonId,
              autoGate: false
            });
            ui.toast("补交成功");
            const merged = Object.assign({}, prob || {}, {
              result: result
            }, {
              status: {
                ...prob?.status || {},
                answered: true
              }
            });
            repo.problems.set(e.problemId, merged);
            updateRow(row, e, merged);
          } catch (e2) {
            ui.toast("补交失败：" + (e2?.message || e2));
          } finally {
            row.classList.remove("loading");
          }
        }); else ui.toast("提交失败：" + (err?.message || err));
      } finally {
        row.classList.remove("loading");
      }
    };
    submitBar.appendChild(btnSubmit);
    // 强制补交
        const btnForceRetry = create("button");
    btnForceRetry.textContent = "强制补交";
    btnForceRetry.onclick = async () => {
      try {
        const result = JSON.parse(textarea.value || "{}");
        row.classList.add("loading");
        await submitAnswer({
          problemId: e.problemId,
          problemType: e.problemType
        }, result, {
          startTime: startTime,
          endTime: endTime,
          forceRetry: true,
          lessonId: repo.currentLessonId,
          autoGate: false
        });
        ui.toast("补交成功");
        const merged = Object.assign({}, prob || {}, {
          result: result
        }, {
          status: {
            ...prob?.status || {},
            answered: true
          }
        });
        repo.problems.set(e.problemId, merged);
        updateRow(row, e, merged);
      } catch (err) {
        ui.toast("补交失败：" + (err?.message || err));
      } finally {
        row.classList.remove("loading");
      }
    };
    submitBar.appendChild(btnForceRetry);
    editorBox.appendChild(submitBar);
    detail.appendChild(editorBox);
  }
  let mounted$2 = false;
  let root$2;
  function $$2(sel) {
    return document.querySelector(sel);
  }
  function mountProblemListPanel() {
    if (mounted$2) return root$2;
    const wrap = document.createElement("div");
    wrap.innerHTML = tpl$2;
    document.body.appendChild(wrap.firstElementChild);
    root$2 = document.getElementById("ykt-problem-list-panel");
    $$2("#ykt-problem-list-close")?.addEventListener("click", () => showProblemListPanel(false));
    window.addEventListener("ykt:open-problem-list", () => showProblemListPanel(true));
    mounted$2 = true;
    updateProblemList();
    return root$2;
  }
  function showProblemListPanel(visible = true) {
    mountProblemListPanel();
    root$2.classList.toggle("visible", !!visible);
    if (visible) updateProblemList();
  }
  function updateProblemList() {
    mountProblemListPanel();
    const container = $$2("#ykt-problem-list");
    container.innerHTML = "";
    (repo.encounteredProblems || []).forEach(e => {
      const prob = repo.problems.get(e.problemId) || {};
      const row = document.createElement("div");
      row.className = "problem-row";
      // 标题和元信息容器，内容由 updateRow 填充
            const title = document.createElement("div");
      title.className = "problem-title";
      row.appendChild(title);
      const meta = document.createElement("div");
      meta.className = "problem-meta";
      row.appendChild(meta);
      const actionsBar = document.createElement("div");
      actionsBar.className = "problem-actions";
      row.appendChild(actionsBar);
      // 绑定按钮（查看 / AI解答 / 刷新题目）
            bindRowActions(row, e, prob);
      // 渲染题目信息 + 已作答答案 + 手动提交/补交 UI
            updateRow(row, e, prob);
      container.appendChild(row);
    });
  }
  var tpl$1 = '<div id="ykt-active-problems-panel" class="ykt-active-wrapper">\r\n  <div id="ykt-active-problems" class="active-problems"></div>\r\n</div>\r\n';
  let mounted$1 = false;
  let root$1;
  function $$1(sel) {
    return document.querySelector(sel);
  }
  function mountActiveProblemsPanel() {
    if (mounted$1) return root$1;
    const wrap = document.createElement("div");
    wrap.innerHTML = tpl$1;
    document.body.appendChild(wrap.firstElementChild);
    root$1 = document.getElementById("ykt-active-problems-panel");
    mounted$1 = true;
    // 轻量刷新计时器
        setInterval(() => updateActiveProblems(), 1e3);
    return root$1;
  }
  function updateActiveProblems() {
    mountActiveProblemsPanel();
    const box = $$1("#ykt-active-problems");
    box.innerHTML = "";
    const now = Date.now();
    let hasActiveProblems = false;
 // ✅ 跟踪是否有活跃题目
        repo.problemStatus.forEach((status, pid) => {
      const p = repo.problems.get(pid);
      if (!p || p.result) return;
      const remain = Math.max(0, Math.floor((status.endTime - now) / 1e3));
      // ✅ 如果倒计时结束（剩余时间为0），跳过显示这个卡片
            if (remain <= 0) {
        console.log(`[ActiveProblems] 题目 ${pid} 倒计时已结束，移除卡片`);
        return;
      }
      // ✅ 有至少一个活跃题目
            hasActiveProblems = true;
      const card = document.createElement("div");
      card.className = "active-problem-card";
      const title = document.createElement("div");
      title.className = "ap-title";
      title.textContent = (p.body || `题目 ${pid}`).slice(0, 80);
      card.appendChild(title);
      const info = document.createElement("div");
      info.className = "ap-info";
      info.textContent = `剩余 ${remain}s`;
      card.appendChild(info);
      const bar = document.createElement("div");
      bar.className = "ap-actions";
      const go = document.createElement("button");
      go.textContent = "查看";
      go.onclick = () => actions.navigateTo(status.presentationId, status.slideId);
      bar.appendChild(go);
      const ai = document.createElement("button");
      ai.textContent = "AI 解答";
      ai.onclick = () => window.dispatchEvent(new CustomEvent("ykt:open-ai"));
      bar.appendChild(ai);
      card.appendChild(bar);
      box.appendChild(card);
    });
    // ✅ 如果没有活跃题目，隐藏整个面板容器
        if (!hasActiveProblems) root$1.style.display = "none"; else root$1.style.display = "";
  }
  var tpl = '<div id="ykt-tutorial-panel" class="ykt-panel">\r\n  <div class="panel-header">\r\n    <h3>雨课堂助手使用教程</h3>\r\n    <h5>1.18.7</h5>\r\n    <span class="close-btn" id="ykt-tutorial-close"><i class="fas fa-times"></i></span>\r\n  </div>\r\n\r\n  <div class="panel-body">\r\n    <div class="tutorial-content">\r\n      <h4>功能介绍</h4>\r\n      <p>AI雨课堂助手是一个为雨课堂提供辅助功能的工具，可以帮助你更好地参与课堂互动。</p>\r\n      <p>项目仓库：<a href="https://github.com/ZaytsevZY/yuketang-helper-auto" target="_blank" rel="noopener">GitHub</a></p>\r\n      <p>脚本安装：<a href="https://greasyfork.org/zh-CN/scripts/531469-ai%E9%9B%A8%E8%AF%BE%E5%A0%82%E5%8A%A9%E6%89%8B-%E6%A8%A1%E5%9D%97%E5%8C%96%E6%9E%84%E5%BB%BA%E7%89%88" target="_blank" rel="noopener">GreasyFork</a></p>\r\n\r\n      <h4>工具栏按钮说明</h4>\r\n      <ul>\r\n        <li><i class="fas fa-bell"></i> <b>习题提醒</b>：切换是否在新习题出现时显示通知提示（蓝色=开启）。</li>\r\n        <li><i class="fas fa-file-powerpoint"></i> <b>课件浏览</b>：查看课件与题目页面，提问可见内容。</li>\r\n        <li><i class="fas fa-robot"></i> <b>AI 解答</b>：向 AI 询问当前题目并显示建议答案。</li>\r\n        <li><i class="fas fa-magic-wand-sparkles"></i> <b>自动作答</b>：切换自动作答（蓝色=开启）。</li>\r\n        <li><i class="fas fa-cog"></i> <b>设置</b>：配置 API 密钥与自动作答参数。</li>\r\n        <li><i class="fas fa-question-circle"></i> <b>使用教程</b>：显示/隐藏当前教程页面。</li>\r\n      </ul>\r\n\r\n      <h4>自动作答</h4>\r\n      <ul>\r\n        <li>在设置中开启自动作答并配置延迟/随机延迟。</li>\r\n        <li>需要配置 <del>DeepSeek API</del> Kimi API 密钥。</li>\r\n        <li>答案来自 AI，结果仅供参考。</li>\r\n      </ul>\r\n\r\n      <h4>AI 解答</h4>\r\n      <ol>\r\n        <li>点击设置（<i class="fas fa-cog"></i>）填入 API Key。</li>\r\n        <li>点击 AI 解答（<i class="fas fa-robot"></i>）后会对“当前题目/最近遇到的题目”询问并解析。</li>\r\n      </ol>\r\n\r\n      <h4>注意事项</h4>\r\n      <p>1) 仅供学习参考，请独立思考；</p>\r\n      <p>2) 合理使用 API 额度；</p>\r\n      <p>3) 答案不保证 100% 正确；</p>\r\n      <p>4) 自动作答有一定风险，谨慎开启。</p>\r\n\r\n      <h4>联系方式</h4>\r\n      <ul>\r\n        <li>请在Github issue提出问题</li>\r\n      </ul>\r\n    </div>\r\n  </div>\r\n</div>\r\n';
  let mounted = false;
  let root;
  function $(sel) {
    return document.querySelector(sel);
  }
  function mountTutorialPanel() {
    if (mounted) return root;
    const host = document.createElement("div");
    host.innerHTML = tpl;
    document.body.appendChild(host.firstElementChild);
    root = document.getElementById("ykt-tutorial-panel");
    $("#ykt-tutorial-close")?.addEventListener("click", () => showTutorialPanel(false));
    mounted = true;
    return root;
  }
  function showTutorialPanel(visible = true) {
    mountTutorialPanel();
    root.classList.toggle("visible", !!visible);
  }
  function toggleTutorialPanel() {
    mountTutorialPanel();
    const vis = root.classList.contains("visible");
    showTutorialPanel(!vis);
    // 同步工具条按钮激活态（如果存在）
        const helpBtn = document.getElementById("ykt-btn-help");
    if (helpBtn) helpBtn.classList.toggle("active", !vis);
  }
  // src/ui/ui-api.js
    const _config = Object.assign({}, DEFAULT_CONFIG, storage.get("config", {}));
  _config.ai.kimiApiKey = storage.get("kimiApiKey", _config.ai.kimiApiKey);
  _config.TYPE_MAP = _config.TYPE_MAP || PROBLEM_TYPE_MAP;
  if (typeof _config.autoJoinEnabled === "undefined") _config.autoJoinEnabled = false;
  if (typeof _config.autoAnswerOnAutoJoin === "undefined") _config.autoAnswerOnAutoJoin = true;
  if (typeof _config.notifyProblems === "undefined") _config.notifyProblems = true;
 // 是否开启提醒
    if (typeof _config.notifyPopupDuration === "undefined") _config.notifyPopupDuration = 5e3;
 // 弹窗时长(ms)
    if (typeof _config.notifyVolume === "undefined") _config.notifyVolume = .6;
 // 提示音量(0~1)
    if (typeof _config.customNotifyAudioSrc === "undefined") _config.customNotifyAudioSrc = "";
 // '' 表示未设置
    if (typeof _config.customNotifyAudioName === "undefined") _config.customNotifyAudioName = "";
 // 仅用于显示
    _config.autoJoinEnabled = !!_config.autoJoinEnabled;
  _config.autoAnswerOnAutoJoin = !!_config.autoAnswerOnAutoJoin;
  function saveConfig() {
    try {
      // 只持久化需要的字段，避免循环引用
      storage.set("config", {
        ...this.config,
        autoJoinEnabled: !!this.config.autoJoinEnabled,
        autoAnswerOnAutoJoin: !!this.config.autoAnswerOnAutoJoin
      });
    } catch (e) {
      console.warn("[ui.saveConfig] failed", e);
    }
  }
  // 面板层级管理
    let currentZIndex = 1e7;
  const ui = {
    get config() {
      return _config;
    },
    saveConfig: saveConfig,
    updatePresentationList: updatePresentationList,
    updateSlideView: updateSlideView,
    askAIForCurrent: askAIForCurrent,
    updateProblemList: updateProblemList,
    updateActiveProblems: updateActiveProblems,
    // 提升面板层级的辅助函数
    _bringToFront(panelElement) {
      if (panelElement && panelElement.classList.contains("visible")) {
        currentZIndex += 1;
        panelElement.style.zIndex = currentZIndex;
      }
    },
    // 修改后的面板显示函数，添加z-index管理
    showPresentationPanel(visible = true) {
      showPresentationPanel(visible);
      if (visible) {
        const panel = document.getElementById("ykt-presentation-panel");
        this._bringToFront(panel);
      }
    },
    showProblemListPanel(visible = true) {
      showProblemListPanel(visible);
      if (visible) {
        const panel = document.getElementById("ykt-problem-list-panel");
        this._bringToFront(panel);
      }
    },
    showAIPanel(visible = true) {
      showAIPanel(visible);
      if (visible) {
        const panel = document.getElementById("ykt-ai-answer-panel");
        this._bringToFront(panel);
      }
    },
    toggleSettingsPanel() {
      toggleSettingsPanel();
      // 检查面板是否变为可见状态
            const panel = document.getElementById("ykt-settings-panel");
      if (panel && panel.classList.contains("visible")) this._bringToFront(panel);
    },
    toggleTutorialPanel() {
      toggleTutorialPanel();
      // 检查面板是否变为可见状态
            const panel = document.getElementById("ykt-tutorial-panel");
      if (panel && panel.classList.contains("visible")) this._bringToFront(panel);
    },
    // 在 index.js 初始化时挂载一次
    _mountAll() {
      mountSettingsPanel();
      mountAIPanel();
      mountPresentationPanel();
      mountProblemListPanel();
      mountActiveProblemsPanel();
      mountTutorialPanel();
      window.addEventListener("ykt:open-ai", () => this.showAIPanel(true));
    },
    // === 新增：题目提醒（弹窗 + 声音）===
    notifyProblem(problem, slide) {
      try {
        // 1) 原生通知（如果可用，备用，不阻碍自定义弹窗）
        try {
          this.nativeNotify?.({
            title: "雨课堂习题提示",
            text: this.getProblemDetail(problem),
            image: slide?.thumbnail || null,
            timeout: Math.max(2e3, +this.config.notifyPopupDuration || 5e3)
          });
        } catch {}
        // 2) 自定义悬浮弹窗
                const wrapper = document.createElement("div");
        wrapper.className = "ykt-problem-notify";
        // 内联样式，避免依赖外部CSS
                Object.assign(wrapper.style, {
          position: "fixed",
          right: "20px",
          bottom: "24px",
          maxWidth: "380px",
          background: "rgba(20,20,20,0.92)",
          color: "#fff",
          borderRadius: "12px",
          boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
          padding: "14px 16px",
          display: "flex",
          gap: "12px",
          alignItems: "flex-start",
          zIndex: String(++currentZIndex),
          fontSize: "14px",
          lineHeight: "1.5",
          backdropFilter: "blur(2px)",
          border: "1px solid rgba(255,255,255,0.06)"
        });
        // 缩略图（可选）
                if (slide?.thumbnail) {
          const img = document.createElement("img");
          img.src = slide.thumbnail;
          Object.assign(img.style, {
            width: "56px",
            height: "56px",
            objectFit: "cover",
            borderRadius: "8px",
            flex: "0 0 auto"
          });
          wrapper.appendChild(img);
        }
        const body = document.createElement("div");
        body.style.flex = "1 1 auto";
        const title = document.createElement("div");
        title.textContent = "习题已发布";
        Object.assign(title.style, {
          fontWeight: "600",
          marginBottom: "6px",
          fontSize: "15px"
        });
        const detail = document.createElement("pre");
        detail.textContent = this.getProblemDetail(problem);
        Object.assign(detail.style, {
          whiteSpace: "pre-wrap",
          margin: 0,
          fontFamily: "inherit",
          opacity: "0.92",
          maxHeight: "220px",
          overflow: "auto"
        });
        body.appendChild(title);
        body.appendChild(detail);
        wrapper.appendChild(body);
        // 关闭按钮
                const closeBtn = document.createElement("button");
        closeBtn.textContent = "×";
        Object.assign(closeBtn.style, {
          border: "none",
          background: "transparent",
          color: "#fff",
          opacity: "0.7",
          fontSize: "18px",
          lineHeight: "18px",
          cursor: "pointer",
          padding: "0 4px",
          marginLeft: "4px"
        });
        closeBtn.addEventListener("mouseenter", () => closeBtn.style.opacity = "1");
        closeBtn.addEventListener("mouseleave", () => closeBtn.style.opacity = "0.7");
        closeBtn.onclick = () => wrapper.remove();
        wrapper.appendChild(closeBtn);
        document.body.appendChild(wrapper);
        this._bringToFront(wrapper);
        // 自动移除
                const timeout = Math.max(2e3, +this.config.notifyPopupDuration || 5e3);
        setTimeout(() => wrapper.remove(), timeout);
        // 3) 播放提示音（WebAudio 简单“叮咚”）
                this._playNotifySound(+this.config.notifyVolume || .6);
      } catch (e) {
        console.warn("[ui.notifyProblem] failed:", e);
      }
    },
    // 播放自定义提示音  
    _playNotifySound(volume = .6) {
      const src = (this.config.customNotifyAudioSrc || "").trim();
      if (src) try {
        // 采用 <audio> 元素，避免跨域 / MIME 导致的 WebAudio 解码问题
        if (!this.__notifyAudioEl) {
          this.__notifyAudioEl = new Audio;
          this.__notifyAudioEl.preload = "auto";
        }
        const el = this.__notifyAudioEl;
        el.pause();
        // 若用户更换了音频，或首次设置，更新 src
                if (el.src !== src) el.src = src;
        el.volume = Math.max(0, Math.min(1, volume));
        el.currentTime = 0;
        const p = el.play();
        // 某些浏览器可能因非用户手势阻止自动播放：失败时回退
                if (p && typeof p.catch === "function") p.catch(() => this._playNotifyTone(volume));
        return;
      } catch (e) {
        console.warn("[ui._playNotifySound] custom audio failed, fallback to tone:", e);
        // 回退到合成音
            }
      this._playNotifyTone(volume);
    },
    // 简易提示音：两个音高的短促“叮-咚”
    _playNotifyTone(volume = .6) {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext);
        const now = ctx.currentTime;
        const master = ctx.createGain();
        master.gain.value = Math.max(0, Math.min(1, volume));
        master.connect(ctx.destination);
        const tone = (freq, t0, dur = .12) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(freq, t0);
          gain.gain.setValueAtTime(0, t0);
          gain.gain.linearRampToValueAtTime(1, t0 + .01);
          gain.gain.exponentialRampToValueAtTime(.001, t0 + dur);
          osc.connect(gain);
          gain.connect(master);
          osc.start(t0);
          osc.stop(t0 + dur + .02);
        };
        tone(880, now);
 // A5
                tone(1318.51, now + .16);
 // E6
        // 自动关闭
                setTimeout(() => ctx.close(), 500);
      } catch {}
    },
    // 供设置页调用：写入/清除自定义提示音
    setCustomNotifyAudio({src: src, name: name}) {
      this.config.customNotifyAudioSrc = src || "";
      this.config.customNotifyAudioName = name || "";
      this.saveConfig();
    },
    getProblemDetail(problem) {
      if (!problem) return "题目未找到";
      const lines = [ problem.body || "" ];
      if (Array.isArray(problem.options)) lines.push(...problem.options.map(({key: key, value: value}) => `${key}. ${value}`));
      return lines.join("\n");
    },
    toast: toast,
    nativeNotify: gm.notify,
    // Buttons 状态
    updateAutoAnswerBtn() {
      const el = document.getElementById("ykt-btn-auto-answer");
      if (!el) return;
      if (_config.autoAnswer) el.classList.add("active"); else el.classList.remove("active");
    }
  };
  // src/net/xhr-interceptor.js
    function installXHRInterceptor() {
    class MyXHR extends XMLHttpRequest {
      static handlers=[];
      static addHandler(h) {
        this.handlers.push(h);
      }
      open(method, url, async) {
        const parsed = new URL(url, location.href);
        for (const h of this.constructor.handlers) h(this, method, parsed);
        return super.open(method, url, async ?? true);
      }
      intercept(cb) {
        let payload;
        const rawSend = this.send;
        this.send = body => {
          payload = body;
          return rawSend.call(this, body);
        };
        this.addEventListener("load", () => {
          try {
            cb(JSON.parse(this.responseText), payload);
          } catch {}
        });
      }
    }
    function detectEnvironmentAndAdaptAPI() {
      const hostname = location.hostname;
      if (hostname === "www.yuketang.cn") {
        console.log("[雨课堂助手] 检测到标准雨课堂环境");
        return "standard";
      }
      if (hostname === "pro.yuketang.cn") {
        console.log("[雨课堂助手] 检测到荷塘雨课堂环境");
        return "pro";
      }
      console.log("[雨课堂助手] 未知环境:", hostname);
      return "unknown";
    }
    MyXHR.addHandler((xhr, method, url) => {
      detectEnvironmentAndAdaptAPI();
      const pathname = url.pathname || "";
      console.log("[雨课堂助手] XHR请求:", method, pathname, url.search);
      // 课件：精确路径或包含关键字
            if (pathname === "/api/v3/lesson/presentation/fetch" || pathname.includes("presentation") && pathname.includes("fetch")) {
        console.log("[雨课堂助手] ✅ 拦截课件请求");
        xhr.intercept(resp => {
          const id = url.searchParams.get("presentation_id");
          console.log("[雨课堂助手] 课件响应:", resp);
          if (resp && (resp.code === 0 || resp.success)) actions.onPresentationLoaded(id, resp.data || resp.result);
        });
        return;
      }
      // 答题
            if (pathname === "/api/v3/lesson/problem/answer" || pathname.includes("problem") && pathname.includes("answer")) {
        console.log("[雨课堂助手] ✅ 拦截答题请求");
        xhr.intercept((resp, payload) => {
          try {
            const {problemId: problemId, result: result} = JSON.parse(payload || "{}");
            if (resp && (resp.code === 0 || resp.success)) actions.onAnswerProblem(problemId, result);
          } catch (e) {
            console.error("[雨课堂助手] 解析答题响应失败:", e);
          }
        });
        return;
      }
      if (url.pathname === "/api/v3/lesson/problem/retry") {
        xhr.intercept((resp, payload) => {
          try {
            // retry 请求体是 { problems: [{ problemId, result, ...}] }
            const body = JSON.parse(payload || "{}");
            const first = Array.isArray(body?.problems) ? body.problems[0] : null;
            if (resp?.code === 0 && first?.problemId) actions.onAnswerProblem(first.problemId, first.result);
          } catch {}
        });
        return;
      }
      if (pathname.includes("/api/")) console.log("[雨课堂助手] 其他API:", method, pathname);
    });
    gm.uw.XMLHttpRequest = MyXHR;
  }
  // ===== 自动进入课堂所需的最小 API 封装 =====
  // 说明：使用 fetch，浏览器自动带上 cookie；与拦截器互不影响
  /** 拉取“正在上课”的课堂列表 */
  /** 拉取“正在上课”的课堂列表（多端候选 + 详细日志） */  async function getOnLesson() {
    const origin = location.origin;
    const same = p => new URL(p, origin).toString();
    const candidates = [ same("/api/v3/classroom/on-lesson"), same("/mooc-api/v1/lms/classroom/on-lesson"), same("/apiv3/classroom/on-lesson") ];
    const tries = [];
    let finalList = [];
    let lastErr = null;
    for (const url of candidates) {
      const item = {
        url: url,
        ok: false,
        status: 0,
        note: ""
      };
      try {
        const r = await fetch(url, {
          credentials: "include"
        });
        item.status = r.status;
        if (!r.ok) {
          item.note = `HTTP ${r.status}`;
          tries.push(item);
          continue;
        }
        const text = await r.text();
        // 打个缩略，避免把整段 JSON 打爆
                item.bodySnippet = text.slice(0, 300);
        let j = {};
        try {
          j = JSON.parse(text);
        } catch (_) {
          item.note = "JSON parse failed";
        }
        const list = j?.data?.onLessonClassrooms || j?.result || j?.data || [];
        item.parsedLength = Array.isArray(list) ? list.length : -1;
        if (Array.isArray(list) && list.length) {
          item.ok = true;
          tries.push(item);
          finalList = list;
          break;
        } else {
          item.note ||= "empty list";
          tries.push(item);
        }
      } catch (e) {
        item.note = e && e.message || "fetch error";
        tries.push(item);
        lastErr = e;
      }
    }
    // 统一打印调试信息（折叠组，方便查看）
        try {
      console.groupCollapsed(`%c[getOnLesson] host=%s  result=%s  candidates=%d`, "color:#09f", location.hostname, finalList.length ? `OK(${finalList.length})` : "EMPTY", candidates.length);
      tries.forEach((t, i) => {
        console.log(`#${i + 1}`, {
          url: t.url,
          ok: t.ok,
          status: t.status,
          note: t.note,
          parsedLength: t.parsedLength,
          bodySnippet: t.bodySnippet
        });
      });
      if (!finalList.length && lastErr) console.warn("[getOnLesson] last error:", lastErr);
      console.groupEnd();
    } catch {}
    return finalList;
  }
  // src/net/xhr-interceptor.js
    async function checkinClass(lessonId, opts = {}) {
    const origin = location.origin;
    const same = p => new URL(p, origin).toString();
    const classroomId = opts?.classroomId;
    const headers = {
      "content-type": "application/json",
      xtbz: "ykt"
    };
    // 针对不同网关，使用各自的 payload 形态
        const candidates = [ {
      url: same("/api/v3/lesson/checkin"),
      payload: {
        lessonId: lessonId,
        ...classroomId ? {
          classroomId: classroomId
        } : {}
      },
      // v3: 驼峰
      name: "v3-same"
    }, {
      url: "https://pro.yuketang.cn/api/v3/lesson/checkin",
      payload: {
        lessonId: lessonId,
        ...classroomId ? {
          classroomId: classroomId
        } : {}
      },
      name: "v3-pro"
    }, {
      url: "https://www.yuketang.cn/api/v3/lesson/checkin",
      payload: {
        lessonId: lessonId,
        ...classroomId ? {
          classroomId: classroomId
        } : {}
      },
      name: "v3-www"
    }, {
      url: same("/mooc-api/v1/lms/lesson/checkin"),
      payload: {
        lesson_id: lessonId,
        ...classroomId ? {
          classroom_id: classroomId
        } : {}
      },
      // 旧网关：蛇形
      name: "mooc-same"
    }, {
      url: same("/apiv3/lesson/checkin"),
      payload: {
        lessonId: lessonId,
        ...classroomId ? {
          classroomId: classroomId
        } : {}
      },
      name: "apiv3-same"
    } ];
    const tries = [];
    let lastErr;
    for (const cand of candidates) {
      const item = {
        url: cand.url,
        name: cand.name,
        status: 0,
        note: ""
      };
      try {
        const resp = await fetch(cand.url, {
          method: "POST",
          credentials: "include",
          headers: headers,
          body: JSON.stringify(cand.payload)
        });
        item.status = resp.status;
        const text = await resp.text().catch(() => "");
        item.bodySnippet = text.slice(0, 300);
        if (!resp.ok) {
          item.note = `HTTP ${resp.status}`;
          // 如果 400/401/403，继续试下一条
                    tries.push(item);
          continue;
        }
        let data = {};
        try {
          data = JSON.parse(text);
        } catch {
          item.note = "JSON parse failed";
        }
        const token = data?.data?.lessonToken || data?.result?.lessonToken || data?.lessonToken;
        const setAuth = resp.headers.get("Set-Auth") || resp.headers.get("set-auth") || null;
        item.note = token ? "OK" : "no token in body";
        tries.push(item);
        if (token) {
          try {
            console.groupCollapsed("%c[checkinClass] OK %s", "color:#0a0", cand.name);
            console.log("payload:", cand.payload);
            console.log("setAuth:", !!setAuth);
            console.groupEnd();
          } catch {}
          return {
            token: token,
            setAuth: setAuth,
            raw: data
          };
        }
      } catch (e) {
        item.note = e.message || "fetch error";
        tries.push(item);
        lastErr = e;
      }
    }
    try {
      console.groupCollapsed("%c[checkinClass] FAILED host=%s", "color:#f33", location.hostname);
      console.log("lessonId:", lessonId, "classroomId:", classroomId);
      tries.forEach((t, i) => console.log(`#${i + 1}`, t));
      if (lastErr) console.warn("lastErr:", lastErr);
      console.groupEnd();
    } catch {}
    // 抛给上层，由上层走“直跳 lesson 页”的兜底逻辑
        throw new Error("checkinClass HTTP 400");
  }
  // src/state/actions.js
    let _autoLoopStarted = false;
  let _autoJoinStarted = false;
  let _autoOnLessonClickStarted = false;
  let _autoOnLessonClickInProgress = false;
  let _routerHooked = false;
  // 1.18.5: 本地默认答案生成（无 API Key 时使用，保持 AutoAnswer 流程通畅）
    function makeDefaultAnswer(problem) {
    switch (problem.problemType) {
     case 1:
 // 单选
           case 2:
 // 多选
           case 3:
      // 投票
      return [ "A" ];

     case 4:
      // 填空
      // 按需求示例返回 [" 1"]（保留前导空格）
      return [ " 1" ];

     case 5:
      // 主观/问答
      return {
        content: "略",
        pics: []
      };

     default:
      // 兜底：按单选处理
      return [ "A" ];
    }
  }
  // 内部自动答题处理函数 - 融合模式（文本+图像）
    async function handleAutoAnswerInternal(problem) {
    const status = repo.problemStatus.get(problem.problemId);
    if (!status || status.answering || problem.result) {
      console.log("[AutoAnswer] 跳过：", {
        hasStatus: !!status,
        answering: status?.answering,
        hasResult: !!problem.result
      });
      return;
    }
    if (Date.now() >= status.endTime) {
      console.log("[AutoAnswer] 跳过：已超时");
      return;
    }
    status.answering = true;
    try {
      console.log("[AutoAnswer] =================================");
      console.log("[AutoAnswer] 开始自动答题");
      console.log("[AutoAnswer] 题目ID:", problem.problemId);
      console.log("[AutoAnswer] 题目类型:", PROBLEM_TYPE_MAP[problem.problemType]);
      console.log("[AutoAnswer] 题目内容:", problem.body?.slice(0, 50) + "...");
      if (!ui.config.ai.kimiApiKey) {
        // ✅ 无 API Key：使用本地默认答案直接提交，确保流程不中断
        const parsed = makeDefaultAnswer(problem);
        console.log("[AutoAnswer] 无 API Key，使用本地默认答案:", JSON.stringify(parsed));
        // 提交答案（根据时限自动选择 answer/retry 逻辑）
                await submitAnswer(problem, parsed, {
          startTime: status.startTime,
          endTime: status.endTime,
          forceRetry: false,
          lessonId: repo.currentLessonId
        });
        // 更新状态与UI
                actions.onAnswerProblem(problem.problemId, parsed);
        status.done = true;
        status.answering = false;
        ui.toast("✅ 使用默认答案完成作答（未配置 API Key）", 3e3);
        showAutoAnswerPopup(problem, "（本地默认答案：无 API Key）");
        console.log("[AutoAnswer] ✅ 默认答案提交流程结束");
        return;
 // 提前返回，避免继续走图像+AI流程
            }
      const slideId = status.slideId;
      console.log("[AutoAnswer] 题目所在幻灯片:", slideId);
      console.log("[AutoAnswer] =================================");
      // ✅ 关键修复：直接使用幻灯片的cover图片，而不是截图DOM
            console.log("[AutoAnswer] 使用融合模式分析（文本+幻灯片图片）...");
      let imageBase64 = await captureSlideImage(slideId);
      // ✅ 如果获取幻灯片图片失败，回退到DOM截图
            if (!imageBase64) {
        console.log("[AutoAnswer] 无法获取幻灯片图片，尝试使用DOM截图...");
        const fallbackImage = await captureProblemForVision();
        if (!fallbackImage) {
          status.answering = false;
          console.error("[AutoAnswer] 所有截图方法都失败");
          return ui.toast("无法获取题目图像，跳过自动作答", 3e3);
        }
        imageBase64 = fallbackImage;
        console.log("[AutoAnswer] ✅ DOM截图成功");
      } else console.log("[AutoAnswer] ✅ 幻灯片图片获取成功");
      console.log("[AutoAnswer] 图片大小:", Math.round(imageBase64.length / 1024), "KB");
      // 构建提示
            const hasTextInfo = problem.body && problem.body.trim();
      const textPrompt = formatProblemForVision(problem, PROBLEM_TYPE_MAP, hasTextInfo);
      console.log("[AutoAnswer] 文本信息:", hasTextInfo ? "有" : "无");
      console.log("[AutoAnswer] 提示长度:", textPrompt.length);
      // 调用 AI
            ui.toast("AI 正在分析题目...", 2e3);
      const aiAnswer = await queryKimiVision(imageBase64, textPrompt, ui.config.ai);
      console.log("[AutoAnswer] ✅ AI回答:", aiAnswer);
      // 解析答案
            const parsed = parseAIAnswer(problem, aiAnswer);
      console.log("[AutoAnswer] 解析结果:", parsed);
      if (!parsed) {
        status.answering = false;
        console.error("[AutoAnswer] 解析失败，AI回答格式不正确");
        return ui.toast("无法解析AI答案，请检查格式", 3e3);
      }
      console.log("[AutoAnswer] ✅ 准备提交答案:", JSON.stringify(parsed));
      // 提交答案
            await submitAnswer(problem, parsed, {
        startTime: status.startTime,
        endTime: status.endTime,
        forceRetry: false,
        lessonId: repo.currentLessonId
      });
      console.log("[AutoAnswer] ✅ 提交成功");
      // 更新状态
            actions.onAnswerProblem(problem.problemId, parsed);
      status.done = true;
      status.answering = false;
      ui.toast(`✅ 自动作答完成`, 3e3);
      showAutoAnswerPopup(problem, aiAnswer);
    } catch (e) {
      console.error("[AutoAnswer] ❌ 失败:", e);
      console.error("[AutoAnswer] 错误堆栈:", e.stack);
      status.answering = false;
      ui.toast(`自动作答失败: ${e.message}`, 4e3);
    }
  }
  const actions = {
    onFetchTimeline(timeline) {
      for (const piece of timeline) if (piece.type === "problem") this.onUnlockProblem(piece);
    },
    onPresentationLoaded(id, data) {
      repo.setPresentation(id, data);
      const pres = repo.presentations.get(id);
      for (const slide of pres.slides) {
        repo.upsertSlide(slide);
        if (slide.problem) {
          repo.upsertProblem(slide.problem);
          repo.pushEncounteredProblem(slide.problem, slide, id);
        }
      }
      ui.updatePresentationList();
    },
    onUnlockProblem(data) {
      const problem = repo.problems.get(data.prob);
      const slide = repo.slides.get(data.sid);
      if (!problem || !slide) {
        console.log("[onUnlockProblem] 题目或幻灯片不存在");
        return;
      }
      console.log("[onUnlockProblem] 题目解锁");
      console.log("[onUnlockProblem] 题目ID:", data.prob);
      console.log("[onUnlockProblem] 幻灯片ID:", data.sid);
      console.log("[onUnlockProblem] 课件ID:", data.pres);
      const status = {
        presentationId: data.pres,
        slideId: data.sid,
        startTime: data.dt,
        endTime: data.dt + 1e3 * data.limit,
        done: !!problem.result,
        autoAnswerTime: null,
        answering: false
      };
      repo.problemStatus.set(data.prob, status);
      if (Date.now() > status.endTime || problem.result) {
        console.log("[onUnlockProblem] 题目已过期或已作答，跳过");
        return;
      }
      if (ui.config.notifyProblems) ui.notifyProblem(problem, slide);
      if (ui.config.autoAnswer) {
        const delay = ui.config.autoAnswerDelay + randInt(0, ui.config.autoAnswerRandomDelay);
        status.autoAnswerTime = Date.now() + delay;
        console.log(`[onUnlockProblem] 将在 ${Math.floor(delay / 1e3)} 秒后自动作答`);
        ui.toast(`将在 ${Math.floor(delay / 1e3)} 秒后使用融合模式自动作答`, 3e3);
      }
      ui.updateActiveProblems();
    },
    onLessonFinished() {
      ui.nativeNotify({
        title: "下课提示",
        text: "当前课程已结束",
        timeout: 5e3
      });
    },
    onAnswerProblem(problemId, result) {
      const p = repo.problems.get(problemId);
      if (p) {
        p.result = result;
        const i = repo.encounteredProblems.findIndex(e => e.problemId === problemId);
        if (i !== -1) repo.encounteredProblems[i].result = result;
        ui.updateProblemList();
      }
    },
    async handleAutoAnswer(problem) {
      return handleAutoAnswerInternal(problem);
    },
    tickAutoAnswer() {
      const now = Date.now();
      for (const [pid, status] of repo.problemStatus) if (status.autoAnswerTime !== null && now >= status.autoAnswerTime) {
        const p = repo.problems.get(pid);
        if (p) {
          status.autoAnswerTime = null;
          this.handleAutoAnswer(p);
        }
      }
    },
    async submit(problem, content) {
      const result = this.parseManual(problem.problemType, content);
      await submitAnswer(problem, result, {
        lessonId: repo.currentLessonId,
        autoGate: false
      });
      this.onAnswerProblem(problem.problemId, result);
    },
    parseManual(problemType, content) {
      switch (problemType) {
       case 1:
       case 2:
       case 3:
        return content.split("").sort();

       case 4:
        return content.split("\n").filter(Boolean);

       case 5:
        return {
          content: content,
          pics: []
        };

       default:
        return null;
      }
    },
    navigateTo(presId, slideId) {
      repo.currentPresentationId = presId;
      repo.currentSlideId = slideId;
      ui.updateSlideView();
      ui.showPresentationPanel(true);
    },
    launchLessonHelper() {
      const path = window.location.pathname;
      const m = path.match(/\/lesson\/fullscreen\/v3\/([^/]+)/);
      repo.currentLessonId = m ? m[1] : null;
      if (repo.currentLessonId) console.log(`[雨课堂助手] 检测到课堂页面 lessonId: ${repo.currentLessonId}`);
      if (typeof window.GM_getTab === "function" && typeof window.GM_saveTab === "function" && repo.currentLessonId) window.GM_getTab(tab => {
        tab.type = "lesson";
        tab.lessonId = repo.currentLessonId;
        window.GM_saveTab(tab);
      });
      repo.loadStoredPresentations();
      this.maybeStartAutoJoin();
 // ← 改成统一入口
            this.installRouterRearm();
 // ← 监听路由变化，自动重挂
        },
    startAutoAnswerLoop() {
      if (_autoLoopStarted) return;
      _autoLoopStarted = true;
      setInterval(() => {
        const now = Date.now();
        repo.problemStatus.forEach((status, pid) => {
          if (status.autoAnswerTime !== null && now >= status.autoAnswerTime) {
            const problem = repo.problems.get(pid);
            if (problem && !problem.result) {
              status.autoAnswerTime = null;
              handleAutoAnswerInternal(problem);
            }
          }
        });
      }, 500);
    },
    // ===== 自动进入课堂：轮询“正在上课”并为每个课堂独立建链 =====
    startAutoJoinLoop() {
      if (_autoJoinStarted) return;
      _autoJoinStarted = true;
      repo.autoJoinRunning = true;
      const loop = async () => {
        if (!repo.autoJoinRunning) return;
        try {
          const list = await getOnLesson();
          // 期望结构：每项至少含 { lessonId, status }，其中 status==1 表示正在上课
                    for (const it of list) {
            const lessonId = it.lessonId || it.lesson_id || it.id;
            const status = it.status;
            if (!lessonId || status !== 1) continue;
            if (repo.isLessonConnected(lessonId)) continue;
 // 已有连接
                        console.log("[AutoJoin] 检测到正在上课的课堂，准备进入:", lessonId);
            try {
              const {token: token, setAuth: setAuth} = await checkinClass(lessonId);
              if (!token) {
                console.warn("[AutoJoin] 未获取到 lessonToken，跳过:", lessonId);
                continue;
              }
              // 建立 WS 并发送 hello（消息会走 ws-interceptor 统一分发）
                            connectOrAttachLessonWS({
                lessonId: lessonId,
                auth: token
              });
              // 标记该课堂为“自动进入”
                            repo.markLessonAutoJoined(lessonId, true);
              // 若设置为“自动进入课堂默认自动答题”，为该课放开自动答题判定
                            if (ui.config.autoAnswerOnAutoJoin) repo.forceAutoAnswerLessons.add(lessonId);
              // 说明：该标记只作为“shouldAutoAnswer”判定的一个加项，不直接改全局 autoAnswer
                        } catch (e) {
              console.error("[AutoJoin] 进入课堂失败:", lessonId, e);
            }
          }
        } catch (e) {
          console.error("[AutoJoin] 拉取正在上课失败:", e);
        } finally {
          // 5 秒一轮，保证多课堂时彼此独立、互不阻塞
          setTimeout(loop, 5e3);
        }
      };
      loop();
    },
    stopAutoJoinLoop() {
      repo.autoJoinRunning = false;
    },
    /** 统一判断并启动自动加入链路（可多次调用，内部防重） */
    maybeStartAutoJoin() {
      if (!ui.config.autoJoinEnabled) return;
      this.startAutoJoinLoop();
      this.startAutoClickOnOnLessonBar();
    },
    /** 前端路由变化时，重新检查并挂载自动加入 */
    installRouterRearm() {
      if (_routerHooked) return;
      _routerHooked = true;
      const uw = gm && gm.uw ? gm.uw : window.unsafeWindow || window;
      const rearm = () => {
        // 重置一次“onlesson 点击守卫”的进行中标记，避免被卡住
        _autoOnLessonClickInProgress = false;
        // 每次路由变更都尝试启动（内部有防重，所以安全）
                this.maybeStartAutoJoin();
      };
      const wrap = (obj, key) => {
        const orig = obj[key];
        obj[key] = function(...args) {
          const ret = orig.apply(this, args);
          try {
            rearm();
          } catch {}
          return ret;
        };
      };
      wrap(uw.history, "pushState");
      wrap(uw.history, "replaceState");
      uw.addEventListener("popstate", rearm);
      uw.addEventListener("visibilitychange", () => {
        if (!document.hidden) rearm();
      });
    },
    // ===== 自动点击“正在上课”条：无需预先拿 lesson_id，复用官方路由逻辑 =====
    startAutoClickOnOnLessonBar() {
      if (_autoOnLessonClickStarted) return;
      _autoOnLessonClickStarted = true;
      // 仅在非课堂页（首页/课表页等）生效
            if (/\/lesson\//.test(location.pathname)) return;
      const uw = gm && gm.uw ? gm.uw : window.unsafeWindow || window;
      async function tryApiJumpFirst() {
        if (_autoOnLessonClickInProgress) return false;
        _autoOnLessonClickInProgress = true;
        try {
          const list = await getOnLesson();
 // ← 强化后的版本
                    const arr = Array.isArray(list) ? list : [];
          // A) 严格：status===1
                    let on = arr.find(x => x?.status === 1 && (x.lessonId || x.lesson_id || x.id));
          // B) 回退：没有严格匹配，但有 lessonId 就用第一条
                    if (!on) {
            const withId = arr.find(x => x && (x.lessonId || x.lesson_id || x.id));
            if (withId) {
              console.warn("[AutoJoin][API] 没有 status===1，但存在 lessonId，使用回退项：", {
                status: withId.status,
                keys: Object.keys(withId || {}),
                sample: withId
              });
              on = withId;
            }
          }
          if (!on) {
            // 详细日志：环境、主机、列表长度与前 3 项
            try {
              console.warn("[AutoJoin][API] EMPTY on-lesson list", {
                host: location.hostname,
                path: location.pathname,
                length: Array.isArray(list) ? list.length : -1,
                sample: Array.isArray(list) ? list.slice(0, 3) : list
              });
            } catch {}
            _autoOnLessonClickInProgress = false;
            return false;
          }
          const lessonId = on.lessonId || on.lesson_id || on.id;
          let target = null;
          if (lessonId) target = `/lesson/fullscreen/v3/${lessonId}`; else target = `/v2/web/lesson/${lessonId}`;
 // 兜底：让站内自己跳转
                    if (location.pathname === target) {
            _autoOnLessonClickInProgress = false;
            return true;
          }
          // 为了少日志，先 replace 再 assign（站内有时也会 push /index）
                    history.replaceState(null, "", location.href);
          location.assign(target);
          return true;
        } catch (e) {
          console.warn("[AutoJoin][API] 跳转失败：", e, {
            host: location.hostname,
            path: location.pathname
          });
          _autoOnLessonClickInProgress = false;
          return false;
        }
      }
      function attachGuardAndTrigger(root = uw.document) {
        const bar = root.querySelector(".onlesson .jump_lesson__bar");
        if (!bar || bar.__ykt_guard_bound__) return false;
        if (_autoOnLessonClickInProgress) return false;
        bar.__ykt_guard_bound__ = true;
        console.log("[AutoJoin][DOM] 发现 onlesson 条，接管点击（捕获阶段）");
        const handler = async ev => {
          ev.preventDefault();
          ev.stopImmediatePropagation?.();
          ev.stopPropagation();
          if (_autoOnLessonClickInProgress) return;
          // 延时阶梯：考虑 WS 刚推完 banner 但接口还没更新
                    const delays = [ 0, 250, 600, 1200, 2e3, 3e3 ];
          for (const d of delays) {
            if (d) await new Promise(r => setTimeout(r, d));
            if (await tryApiJumpFirst()) return;
          }
          console.warn("[AutoJoin][DOM] on-lesson 接口仍为空，放弃本次点击");
          try {
            console.group("%c[AutoJoin][DOM] on-lesson 仍为空，放弃本次点击", "color:#f60");
            console.log("env:", {
              host: location.hostname,
              path: location.pathname,
              href: location.href
            });
            console.log("retryDelays(ms):", delays);
            console.log("hint:", "可能是域/路径不匹配、会话未带上、或 WS/接口不同步导致。请展开上方 [getOnLesson] 折叠日志查看每个候选 URL 的状态与响应片段。");
            console.groupEnd();
          } catch {}
        };
        bar.addEventListener("click", handler, {
          capture: true
        });
        // 触发一次我们自己的 click（优先进入捕获处理器）
                try {
          const W = bar.ownerDocument?.defaultView || uw;
          const ClickEvt = W.MouseEvent || uw.MouseEvent;
          bar.dispatchEvent(new ClickEvt("click", {
            bubbles: true,
            cancelable: true,
            view: W
          }));
        } catch (e) {
          // 兜底：部分环境对 MouseEvent 构造器有限制
          try {
            bar.click();
          } catch (_) {}
        }
        return true;
      }
      // A) 首选：直接 API 跳转（若此时就能拿到 on-lesson，就不必等 DOM）
            tryApiJumpFirst().then(ok => {
        if (ok) return;
        // B) DOM 渲染后接管点击
                if (attachGuardAndTrigger()) return;
        const mo = new uw.MutationObserver(() => {
          if (attachGuardAndTrigger()) {
            mo.disconnect();
            return;
          }
        });
        mo.observe(uw.document.documentElement, {
          childList: true,
          subtree: true
        });
        // setTimeout(() => mo.disconnect(), 10000);
            });
    }
  };
  // src/net/ws-interceptor.js
    function installWSInterceptor() {
    // 环境识别（标准/荷塘/未知），主要用于日志和后续按需适配
    function detectEnvironmentAndAdaptAPI() {
      const hostname = location.hostname;
      let envType = "unknown";
      if (hostname === "www.yuketang.cn") {
        envType = "standard";
        console.log("[雨课堂助手] 检测到标准雨课堂环境");
      } else if (hostname === "pro.yuketang.cn") {
        envType = "pro";
        console.log("[雨课堂助手] 检测到荷塘雨课堂环境");
      } else console.log("[雨课堂助手] 未知环境:", hostname);
      return envType;
    }
    class MyWebSocket extends WebSocket {
      static handlers=[];
      static addHandler(h) {
        this.handlers.push(h);
      }
      constructor(url, protocols) {
        super(url, protocols);
        const parsed = new URL(url, location.href);
        for (const h of this.constructor.handlers) h(this, parsed);
      }
      intercept(cb) {
        const raw = this.send;
        this.send = data => {
          try {
            cb(JSON.parse(data));
          } catch {}
          return raw.call(this, data);
        };
      }
      listen(cb) {
        this.addEventListener("message", e => {
          try {
            cb(JSON.parse(e.data));
          } catch {}
        });
      }
    }
    // MyWebSocket.addHandler((ws, url) => {
    //   if (url.pathname === '/wsapp/') {
    //     ws.listen((msg) => {
    //       switch (msg.op) {
    //         case 'fetchtimeline': actions.onFetchTimeline(msg.timeline); break;
    //         case 'unlockproblem': actions.onUnlockProblem(msg.problem); break;
    //         case 'lessonfinished': actions.onLessonFinished(); break;
    //       }
    //     });
    //   }
    // });
        MyWebSocket.addHandler((ws, url) => {
      const envType = detectEnvironmentAndAdaptAPI();
      console.log("[雨课堂助手] 拦截WebSocket通信 - 环境:", envType);
      console.log("[雨课堂助手] WebSocket连接尝试:", url.href);
      // 更宽松的路径匹配
            const wsPath = url.pathname || "";
      const isRainClassroomWS = wsPath === "/wsapp/" || wsPath.includes("/ws") || wsPath.includes("/websocket") || url.href.includes("websocket");
      if (!isRainClassroomWS) {
        console.log("[雨课堂助手] ❌ 非雨课堂WebSocket:", wsPath);
        return;
      }
      console.log("[雨课堂助手] ✅ 检测到雨课堂WebSocket连接:", wsPath);
      // 发送侧拦截（可用于调试）
            ws.intercept(message => {
        console.log("[雨课堂助手] WebSocket发送:", message);
      });
      // 接收侧统一分发
            ws.listen(message => {
        try {
          console.log("[雨课堂助手] WebSocket接收:", message);
          switch (message.op) {
           case "fetchtimeline":
            console.log("[雨课堂助手] 收到时间线:", message.timeline);
            actions.onFetchTimeline(message.timeline);
            break;

           case "unlockproblem":
            console.log("[雨课堂助手] 收到解锁问题:", message.problem);
            actions.onUnlockProblem(message.problem);
            break;

           case "lessonfinished":
            console.log("[雨课堂助手] 课程结束");
            actions.onLessonFinished();
            break;

           default:
            console.log("[雨课堂助手] 未知WebSocket操作:", message.op, message);
          }
          // 监听后端传递的url
                    const url = function findUrl(obj) {
            if (!obj || typeof obj !== "object") return null;
            if (typeof obj.url === "string") return obj.url;
            if (Array.isArray(obj)) for (const it of obj) {
              const u = findUrl(it);
              if (u) return u;
            } else for (const k in obj) {
              const v = obj[k];
              if (v && typeof v === "object") {
                const u = findUrl(v);
                if (u) return u;
              }
            }
            return null;
          }(message);
          if (url) {
            window.dispatchEvent(new CustomEvent("ykt:url-change", {
              detail: {
                url: url,
                raw: message
              }
            }));
            // 如需持久化到 repo，请取消下一行注释（确保已在 repo 定义该字段）
                        repo.currentSelectedUrl = url;
            console.debug("[雨课堂助手] 当前选择 URL:", url);
          }
        } catch (e) {
          console.debug("[雨课堂助手] 解析WebSocket消息失败", e, message);
        }
      });
    });
    gm.uw.WebSocket = MyWebSocket;
  }
  // ===== 主动为某个课堂建立/复用 WebSocket 连接 =====
    function connectOrAttachLessonWS({lessonId: lessonId, auth: auth}) {
    if (!lessonId || !auth) {
      console.warn("[雨课堂助手][AutoJoin] 缺少 lessonId 或 auth，放弃建链");
      return null;
    }
    if (repo.isLessonConnected(lessonId)) return repo.lessonSockets.get(lessonId);
    // 根据当前域名选择 ws 地址（标准/荷塘）
        const host = location.hostname === "pro.yuketang.cn" ? "wss://pro.yuketang.cn/wsapp/" : "wss://www.yuketang.cn/wsapp/";
    const ws = new WebSocket(host);
    ws.addEventListener("open", () => {
      try {
        const hello = {
          op: "hello",
          // userid 可选：尽力获取，获取不到也不阻断流程
          userid: getUserIdSafe(),
          role: "student",
          auth: auth,
          // 关键：lessonToken
          lessonid: lessonId
        };
        ws.send(JSON.stringify(hello));
        console.log("[雨课堂助手][AutoJoin] 已发送 hello 握手:", hello);
      } catch (e) {
        console.error("[雨课堂助手][AutoJoin] 发送 hello 失败:", e);
      }
    });
    ws.addEventListener("close", () => {
      console.log("[雨课堂助手][AutoJoin] 课堂 WS 关闭:", lessonId);
    });
    ws.addEventListener("error", e => {
      console.error("[雨课堂助手][AutoJoin] 课堂 WS 错误:", lessonId, e);
    });
    repo.markLessonConnected(lessonId, ws, auth);
    return ws;
  }
  function getUserIdSafe() {
    try {
      // 常见挂载点（不同环境可能不同）
      if (window?.YktUser?.id) return window.YktUser.id;
      if (window?.__INITIAL_STATE__?.user?.userId) return window.__INITIAL_STATE__.user.userId;
      // 兜底：从本地存储或 cookie 中猜
            const m = document.cookie.match(/(?:^|;\s*)user_id=(\d+)/);
      if (m) return Number(m[1]);
    } catch {}
    return;
  }
  /**
   * fetch 拦截器 (for Chrome 141+)
   * 作用：在站点改用 fetch() 时，仍能捕获课件数据
   */  (function interceptFetch() {
    if (window.__YKT_FETCH_PATCHED__) return;
    window.__YKT_FETCH_PATCHED__ = true;
    const rawFetch = window.fetch;
    window.fetch = async function(...args) {
      const [input, init] = args;
      const url = typeof input === "string" ? input : input?.url || "";
      // === (1) 打印调试日志，可观察哪些接口走 fetch ===
            if (url.includes("lesson") || url.includes("slide") || url.includes("problem")) console.log("[YKT][fetch-interceptor] 捕获请求:", url);
      const resp = await rawFetch.apply(this, args);
      try {
        // === (2) 只拦截 Rain Classroom 的 JSON 接口 ===
        if (url.includes("/lesson") || url.includes("/presentation") || url.includes("/slides") || url.includes("/problem")) {
          const cloned = resp.clone();
          const text = await cloned.text();
          // 这里不能直接 resp.json()，否则流会被消费；必须 clone()
                    const json = JSON.parse(text);
          // === (3) 关键：提取 slides 并灌入 repo.slides ===
                    if (json && json.data && json.data.slides) {
            const slides = json.data.slides;
            let filled = 0;
            for (const s of slides) {
              const sid = String(s.id);
              if (!repo.slides.has(sid)) {
                repo.slides.set(sid, s);
                filled++;
              }
            }
            console.log(`[YKT][fetch-interceptor] 已填充 slides ${filled}/${slides.length}`);
          }
        }
      } catch (e) {
        console.warn("[YKT][fetch-interceptor] 解析响应失败:", e);
      }
      return resp;
 // 一定要返回原始 Response
        };
    console.log("[YKT][fetch-interceptor] ✅ fetch() 已被拦截");
  })();
  var css = '/* ===== 通用 & 修复 ===== */\r\n#watermark_layer { display: none !important; visibility: hidden !important; }\r\n.hidden { display: none !important; }\r\n\r\n:root{\r\n  --ykt-z: 10000000;\r\n  --ykt-border: #ddd;\r\n  --ykt-border-strong: #ccc;\r\n  --ykt-bg: #fff;\r\n  --ykt-fg: #222;\r\n  --ykt-muted: #607190;\r\n  --ykt-accent: #1d63df;\r\n  --ykt-hover: #1e3050;\r\n  --ykt-shadow: 0 10px 30px rgba(0,0,0,.18);\r\n}\r\n\r\n/* ===== 工具栏 ===== */\r\n#ykt-helper-toolbar{\r\n  position: fixed; z-index: calc(var(--ykt-z) + 1);\r\n  left: 15px; bottom: 15px;\r\n  /* 移除固定宽度，让内容自适应 */\r\n  height: 36px; padding: 5px;\r\n  display: flex; gap: 6px; align-items: center;\r\n  background: var(--ykt-bg);\r\n  border: 1px solid var(--ykt-border-strong);\r\n  border-radius: 4px;\r\n  box-shadow: 0 1px 4px 3px rgba(0,0,0,.1);\r\n}\r\n\r\n#ykt-helper-toolbar .btn{\r\n  display: inline-block; padding: 4px; cursor: pointer;\r\n  color: var(--ykt-muted); line-height: 1;\r\n}\r\n#ykt-helper-toolbar .btn:hover{ color: var(--ykt-hover); }\r\n#ykt-helper-toolbar .btn.active{ color: var(--ykt-accent); }\r\n\r\n/* ===== 面板通用样式 ===== */\r\n.ykt-panel{\r\n  position: fixed; right: 20px; bottom: 60px;\r\n  width: 560px; max-height: 72vh; overflow: auto;\r\n  background: var(--ykt-bg); color: var(--ykt-fg);\r\n  border: 1px solid var(--ykt-border-strong); border-radius: 8px;\r\n  box-shadow: var(--ykt-shadow);\r\n  display: none; \r\n  /* 提高z-index，确保后打开的面板在最上层 */\r\n  z-index: var(--ykt-z);\r\n}\r\n.ykt-panel.visible{ \r\n  display: block; \r\n  /* 动态提升z-index */\r\n  z-index: calc(var(--ykt-z) + 10);\r\n}\r\n\r\n.panel-header{\r\n  display: flex; align-items: center; justify-content: space-between;\r\n  gap: 12px; padding: 10px 12px; border-bottom: 1px solid var(--ykt-border);\r\n}\r\n.panel-header h3{ margin: 0; font-size: 16px; font-weight: 600; }\r\n.panel-body{ padding: 10px 12px; }\r\n.close-btn{ cursor: pointer; color: var(--ykt-muted); }\r\n.close-btn:hover{ color: var(--ykt-hover); }\r\n\r\n/* ===== 设置面板 (#ykt-settings-panel) ===== */\r\n#ykt-settings-panel .settings-content{ display: flex; flex-direction: column; gap: 14px; }\r\n#ykt-settings-panel .setting-group{ border: 1px dashed var(--ykt-border); border-radius: 6px; padding: 10px; }\r\n#ykt-settings-panel .setting-group h4{ margin: 0 0 8px 0; font-size: 14px; }\r\n#ykt-settings-panel .setting-item{ display: flex; align-items: center; gap: 8px; margin: 8px 0; flex-wrap: wrap; }\r\n#ykt-settings-panel label{ font-size: 13px; }\r\n#ykt-settings-panel input[type="text"],\r\n#ykt-settings-panel input[type="number"]{\r\n  height: 30px; border: 1px solid var(--ykt-border-strong);\r\n  border-radius: 4px; padding: 0 8px; min-width: 220px;\r\n}\r\n#ykt-settings-panel small{ color: #666; }\r\n#ykt-settings-panel .setting-actions{ display: flex; gap: 8px; margin-top: 6px; }\r\n#ykt-settings-panel button{\r\n  height: 30px; padding: 0 12px; border-radius: 6px;\r\n  border: 1px solid var(--ykt-border-strong); background: #f7f8fa; cursor: pointer;\r\n}\r\n#ykt-settings-panel button:hover{ background: #eef3ff; border-color: var(--ykt-accent); }\r\n\r\n/* 自定义复选框（与手写脚本一致的视觉语义） */\r\n#ykt-settings-panel .checkbox-label{ position: relative; padding-left: 26px; cursor: pointer; user-select: none; }\r\n#ykt-settings-panel .checkbox-label input{ position: absolute; opacity: 0; cursor: pointer; height: 0; width: 0; }\r\n#ykt-settings-panel .checkbox-label .checkmark{\r\n  position: absolute; left: 0; top: 50%; transform: translateY(-50%);\r\n  height: 16px; width: 16px; border:1px solid var(--ykt-border-strong); border-radius: 3px; background: #fff;\r\n}\r\n#ykt-settings-panel .checkbox-label input:checked ~ .checkmark{\r\n  background: var(--ykt-accent); border-color: var(--ykt-accent);\r\n}\r\n#ykt-settings-panel .checkbox-label .checkmark:after{\r\n  content: ""; position: absolute; display: none;\r\n  left: 5px; top: 1px; width: 4px; height: 8px; border: solid #fff; border-width: 0 2px 2px 0; transform: rotate(45deg);\r\n}\r\n#ykt-settings-panel .checkbox-label input:checked ~ .checkmark:after{ display: block; }\r\n\r\n/* ===== AI 解答面板 (#ykt-ai-answer-panel) ===== */\r\n#ykt-ai-answer-panel .ai-question{\r\n  white-space: pre-wrap; background: #fafafa; border: 1px solid var(--ykt-border);\r\n  padding: 8px; border-radius: 6px; margin-bottom: 8px; max-height: 160px; overflow: auto;\r\n}\r\n#ykt-ai-answer-panel .ai-loading{ color: var(--ykt-accent); margin-bottom: 6px; }\r\n#ykt-ai-answer-panel .ai-error{ color: #b00020; margin-bottom: 6px; }\r\n#ykt-ai-answer-panel .ai-answer{ white-space: pre-wrap; margin-top: 4px; }\r\n#ykt-ai-answer-panel .ai-actions{ margin-top: 10px; }\r\n#ykt-ai-answer-panel .ai-actions button{\r\n  height: 30px; padding: 0 12px; border-radius: 6px;\r\n  border: 1px solid var(--ykt-border-strong); background: #f7f8fa; cursor: pointer;\r\n}\r\n#ykt-ai-answer-panel .ai-actions button:hover{ background: #eef3ff; border-color: var(--ykt-accent); }\r\n\r\n/* ===== 课件浏览面板 (#ykt-presentation-panel) ===== */\r\n#ykt-presentation-panel{ width: 900px; }\r\n#ykt-presentation-panel .panel-controls{ display: flex; align-items: center; gap: 8px; }\r\n#ykt-presentation-panel .panel-body{\r\n  display: grid; grid-template-columns: 300px 1fr; gap: 10px;\r\n}\r\n#ykt-presentation-panel .presentation-title{\r\n  font-weight: 600; padding: 6px 0; border-bottom: 1px solid var(--ykt-border);\r\n}\r\n#ykt-presentation-panel .slide-thumb-list{ display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 8px; }\r\n#ykt-presentation-panel .slide-thumb{\r\n  border: 1px solid var(--ykt-border); border-radius: 6px; background: #fafafa;\r\n  min-height: 60px; display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 4px; text-align: center;\r\n}\r\n#ykt-presentation-panel .slide-thumb:hover{ border-color: var(--ykt-accent); background: #eef3ff; }\r\n#ykt-presentation-panel .slide-thumb img{ max-width: 100%; max-height: 120px; object-fit: contain; display: block; }\r\n\r\n#ykt-presentation-panel .slide-view{\r\n  position: relative; border: 1px solid var(--ykt-border); border-radius: 8px; min-height: 360px; background: #fff; overflow: hidden;\r\n}\r\n#ykt-presentation-panel .slide-cover{ display: flex; align-items: center; justify-content: center; min-height: 360px; }\r\n#ykt-presentation-panel .slide-cover img{ max-width: 100%; max-height: 100%; object-fit: contain; display: block; }\r\n\r\n#ykt-presentation-panel .problem-box{\r\n  position: absolute; left: 12px; right: 12px; bottom: 12px;\r\n  background: rgba(255,255,255,.96); border: 1px solid var(--ykt-border);\r\n  border-radius: 8px; padding: 10px; box-shadow: 0 6px 18px rgba(0,0,0,.12);\r\n}\r\n#ykt-presentation-panel .problem-head{ font-weight: 600; margin-bottom: 6px; }\r\n#ykt-presentation-panel .problem-options{ display: grid; grid-template-columns: 1fr; gap: 4px; }\r\n#ykt-presentation-panel .problem-option{ padding: 6px 8px; border: 1px solid var(--ykt-border); border-radius: 6px; background: #fafafa; }\r\n\r\n/* ===== 题目列表面板 (#ykt-problem-list-panel) ===== */\r\n#ykt-problem-list{ display: flex; flex-direction: column; gap: 10px; }\r\n#ykt-problem-list .problem-row{\r\n  border: 1px solid var(--ykt-border); border-radius: 8px; padding: 8px; background: #fafafa;\r\n}\r\n#ykt-problem-list .problem-title{ font-weight: 600; margin-bottom: 4px; }\r\n#ykt-problem-list .problem-meta{ color: #666; font-size: 12px; margin-bottom: 6px; }\r\n#ykt-problem-list .problem-actions{ display: flex; gap: 8px; align-items: center; }\r\n#ykt-problem-list .problem-actions button{\r\n  height: 28px; padding: 0 10px; border-radius: 6px; border: 1px solid var(--ykt-border-strong); background: #f7f8fa; cursor: pointer;\r\n}\r\n#ykt-problem-list .problem-actions button:hover{ background: #eef3ff; border-color: var(--ykt-accent); }\r\n#ykt-problem-list .problem-done{ color: #0a7a2f; font-weight: 600; }\r\n\r\n/* ===== 活动题目列表（右下角小卡片） ===== */\r\n#ykt-active-problems-panel.ykt-active-wrapper{\r\n  position: fixed; right: 20px; bottom: 60px; z-index: var(--ykt-z);\r\n}\r\n#ykt-active-problems{ display: flex; flex-direction: column; gap: 8px; max-height: 60vh; overflow: auto; }\r\n#ykt-active-problems .active-problem-card{\r\n  width: 320px; background: #fff; border: 1px solid var(--ykt-border);\r\n  border-radius: 8px; box-shadow: var(--ykt-shadow); padding: 10px;\r\n}\r\n#ykt-active-problems .ap-title{ font-weight: 600; margin-bottom: 4px; }\r\n#ykt-active-problems .ap-info{ color: #666; font-size: 12px; margin-bottom: 8px; }\r\n#ykt-active-problems .ap-actions{ display: flex; gap: 8px; }\r\n#ykt-active-problems .ap-actions button{\r\n  height: 28px; padding: 0 10px; border-radius: 6px; border: 1px solid var(--ykt-border-strong); background: #f7f8fa; cursor: pointer;\r\n}\r\n#ykt-active-problems .ap-actions button:hover{ background: #eef3ff; border-color: var(--ykt-accent); }\r\n\r\n/* ===== 教程面板 (#ykt-tutorial-panel) ===== */\r\n#ykt-tutorial-panel .tutorial-content h4{ margin: 8px 0 6px; }\r\n#ykt-tutorial-panel .tutorial-content p,\r\n#ykt-tutorial-panel .tutorial-content li{ line-height: 1.5; }\r\n#ykt-tutorial-panel .tutorial-content a{ color: var(--ykt-accent); text-decoration: none; }\r\n#ykt-tutorial-panel .tutorial-content a:hover{ text-decoration: underline; }\r\n\r\n/* ===== 小屏适配 ===== */\r\n@media (max-width: 1200px){\r\n  #ykt-presentation-panel{ width: 760px; }\r\n  #ykt-presentation-panel .panel-body{ grid-template-columns: 260px 1fr; }\r\n}\r\n@media (max-width: 900px){\r\n  .ykt-panel{ right: 12px; left: 12px; width: auto; }\r\n  #ykt-presentation-panel{ width: auto; }\r\n  #ykt-presentation-panel .panel-body{ grid-template-columns: 1fr; }\r\n}\r\n\r\n/* ===== 自动作答成功弹窗 ===== */\r\n.auto-answer-popup{\r\n  position: fixed; inset: 0; z-index: calc(var(--ykt-z) + 2);\r\n  background: rgba(0,0,0,.2);\r\n  display: flex; align-items: flex-end; justify-content: flex-end;\r\n  opacity: 0; transition: opacity .18s ease;\r\n}\r\n.auto-answer-popup.visible{ opacity: 1; }\r\n\r\n.auto-answer-popup .popup-content{\r\n  width: min(560px, 96vw);\r\n  background: #fff; border: 1px solid var(--ykt-border-strong);\r\n  border-radius: 10px; box-shadow: var(--ykt-shadow);\r\n  margin: 16px; overflow: hidden;\r\n}\r\n\r\n.auto-answer-popup .popup-header{\r\n  display: flex; align-items: center; justify-content: space-between;\r\n  gap: 12px; padding: 10px 12px; border-bottom: 1px solid var(--ykt-border);\r\n}\r\n.auto-answer-popup .popup-header h4{ margin: 0; font-size: 16px; }\r\n.auto-answer-popup .close-btn{ cursor: pointer; color: var(--ykt-muted); }\r\n.auto-answer-popup .close-btn:hover{ color: var(--ykt-hover); }\r\n\r\n.auto-answer-popup .popup-body{ padding: 10px 12px; display: flex; flex-direction: column; gap: 10px; }\r\n.auto-answer-popup .popup-row{ display: grid; grid-template-columns: 56px 1fr; gap: 8px; align-items: start; }\r\n.auto-answer-popup .label{ color: #666; font-size: 12px; line-height: 1.8; }\r\n.auto-answer-popup .content{ white-space: normal; word-break: break-word; }\r\n\r\n/* ===== 1.16.6: 课件浏览面板：固定右侧详细视图，左侧独立滚动 ===== */\r\n#ykt-presentation-panel {\r\n  --ykt-panel-max-h: 72vh;           /* 与 .ykt-panel 的最大高度保持一致 */\r\n}\r\n\r\n/* 两列布局：左列表 + 右详细视图 */\r\n#ykt-presentation-panel .panel-body{\r\n  display: grid;\r\n  grid-template-columns: 300px 1fr;  /* 左列宽度可按需调整 */\r\n  gap: 12px;\r\n  overflow: hidden;                  /* 避免内部再出现双滚动条 */\r\n  align-items: start;\r\n}\r\n\r\n/* 左侧：只让左列滚动，限制在面板可视高度内 */\r\n#ykt-presentation-panel .panel-left{\r\n  max-height: var(--ykt-panel-max-h);\r\n  overflow: auto;\r\n  min-width: 0;                      /* 防止子元素撑破 */\r\n}\r\n\r\n/* 右侧：粘性定位为“固定”，始终在面板可视区内 */\r\n#ykt-presentation-panel .panel-right{\r\n  position: sticky;\r\n  top: 0;                            /* 相对可滚动祖先（面板）吸顶 */\r\n  align-self: start;\r\n}\r\n\r\n/* 右侧详细视图自身也限制高度并允许内部滚动 */\r\n#ykt-presentation-panel .slide-view{\r\n  max-height: var(--ykt-panel-max-h);\r\n  overflow: auto;\r\n  border: 1px solid var(--ykt-border);\r\n  border-radius: 8px;\r\n  background: #fff;\r\n}\r\n\r\n/* 小屏自适配：堆叠布局时取消 sticky，避免遮挡 */\r\n@media (max-width: 900px){\r\n  #ykt-presentation-panel .panel-body{\r\n    grid-template-columns: 1fr;\r\n  }\r\n  #ykt-presentation-panel .panel-right{\r\n    position: static;\r\n  }\r\n}\r\n\r\n/* 在现有样式基础上添加 */\r\n\r\n.text-status {\r\n  font-size: 12px;\r\n  padding: 4px 8px;\r\n  border-radius: 4px;\r\n  margin: 4px 0;\r\n  display: inline-block;\r\n}\r\n\r\n.text-status.success {\r\n  background-color: #d4edda;\r\n  color: #155724;\r\n  border: 1px solid #c3e6cb;\r\n}\r\n\r\n.text-status.warning {\r\n  background-color: #fff3cd;\r\n  color: #856404;\r\n  border: 1px solid #ffeaa7;\r\n}\r\n\r\n.ykt-question-display {\r\n  background: #f8f9fa;\r\n  border: 1px solid #dee2e6;\r\n  border-radius: 4px;\r\n  padding: 8px;\r\n  margin: 4px 0;\r\n  max-height: 150px;\r\n  overflow-y: auto;\r\n  font-family: monospace;\r\n  font-size: 13px;\r\n  line-height: 1.4;\r\n}\r\n\r\n/* 在现有样式基础上添加 */\r\n\r\n.ykt-custom-prompt {\r\n  width: 100%;\r\n  min-height: 60px;\r\n  padding: 8px;\r\n  border: 1px solid #ddd;\r\n  border-radius: 4px;\r\n  font-family: inherit;\r\n  font-size: 13px;\r\n  line-height: 1.4;\r\n  resize: vertical;\r\n  background-color: #fff;\r\n  transition: border-color 0.3s ease;\r\n}\r\n\r\n.ykt-custom-prompt:focus {\r\n  outline: none;\r\n  border-color: #007bff;\r\n  box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.25);\r\n}\r\n\r\n.ykt-custom-prompt::placeholder {\r\n  color: #999;\r\n  font-style: italic;\r\n}\r\n\r\n.ykt-custom-prompt:empty::before {\r\n  content: attr(placeholder);\r\n  color: #999;\r\n  font-style: italic;\r\n  pointer-events: none;\r\n}\r\n\r\n/* 确保输入框在暗色主题下也能正常显示 */\r\n.ykt-panel.dark .ykt-custom-prompt {\r\n  background-color: #2d3748;\r\n  border-color: #4a5568;\r\n  color: #e2e8f0;\r\n}\r\n\r\n.ykt-panel.dark .ykt-custom-prompt::placeholder {\r\n  color: #a0aec0;\r\n}\r\n\r\n.ykt-panel.dark .ykt-custom-prompt:focus {\r\n  border-color: #63b3ed;\r\n  box-shadow: 0 0 0 2px rgba(99, 179, 237, 0.25);\r\n}';
  // src/ui/styles.js
    function injectStyles() {
    gm.addStyle(css);
  }
  // src/ui/toolbar.js
    function installToolbar() {
    // 仅创建容器与按钮；具体面板之后用 HTML/Vue 接入
    const bar = document.createElement("div");
    bar.id = "ykt-helper-toolbar";
    bar.innerHTML = `\n    <span id="ykt-btn-bell" class="btn" title="习题提醒"><i class="fas fa-bell"></i></span>\n    <span id="ykt-btn-pres" class="btn" title="课件浏览"><i class="fas fa-file-powerpoint"></i></span>\n    <span id="ykt-btn-ai" class="btn" title="AI解答"><i class="fas fa-robot"></i></span>\n    <span id="ykt-btn-auto-answer" class="btn" title="自动作答"><i class="fas fa-magic-wand-sparkles"></i></span>\n    <span id="ykt-btn-settings" class="btn" title="设置"><i class="fas fa-cog"></i></span>\n    <span id="ykt-btn-help" class="btn" title="使用教程"><i class="fas fa-question-circle"></i></span>\n  `;
    document.body.appendChild(bar);
    // 初始激活态
        if (ui.config.notifyProblems) bar.querySelector("#ykt-btn-bell")?.classList.add("active");
    ui.updateAutoAnswerBtn();
    // 事件绑定
        bar.querySelector("#ykt-btn-bell")?.addEventListener("click", () => {
      ui.config.notifyProblems = !ui.config.notifyProblems;
      ui.saveConfig();
      ui.toast(`习题提醒：${ui.config.notifyProblems ? "开" : "关"}`);
      bar.querySelector("#ykt-btn-bell")?.classList.toggle("active", ui.config.notifyProblems);
    });
    // 修改课件浏览按钮 - 切换显示/隐藏
        bar.querySelector("#ykt-btn-pres")?.addEventListener("click", () => {
      const btn = bar.querySelector("#ykt-btn-pres");
      const isActive = btn.classList.contains("active");
      ui.showPresentationPanel?.(!isActive);
      btn.classList.toggle("active", !isActive);
    });
    // 修改AI按钮 - 切换显示/隐藏
        bar.querySelector("#ykt-btn-ai")?.addEventListener("click", () => {
      const btn = bar.querySelector("#ykt-btn-ai");
      const isActive = btn.classList.contains("active");
      ui.showAIPanel?.(!isActive);
      btn.classList.toggle("active", !isActive);
    });
    bar.querySelector("#ykt-btn-auto-answer")?.addEventListener("click", () => {
      ui.config.autoAnswer = !ui.config.autoAnswer;
      ui.saveConfig();
      ui.toast(`自动作答：${ui.config.autoAnswer ? "开" : "关"}`);
      ui.updateAutoAnswerBtn();
    });
    bar.querySelector("#ykt-btn-settings")?.addEventListener("click", () => {
      ui.toggleSettingsPanel?.();
    });
    bar.querySelector("#ykt-btn-help")?.addEventListener("click", () => {
      ui.toggleTutorialPanel?.();
    });
  }
  // src/index.js
  // 可选：统一放到 core/env.js 的 ensureFontAwesome；这里保留现有注入方式也可以
    (function loadFA() {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css";
    document.head.appendChild(link);
  })();
  (function main() {
    // 1) 样式/图标
    injectStyles();
    // 2) 先挂 UI（面板、事件桥接）
        ui._mountAll?.();
 // ✅ 现在 ui 已导入，确保执行到位
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
})();
