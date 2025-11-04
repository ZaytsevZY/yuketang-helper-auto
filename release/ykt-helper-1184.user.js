// ==UserScript==
// @name         AI雨课堂助手（模块化构建版）
// @namespace    https://github.com/ZaytsevZY/yuketang-helper-auto
// @version      1.18.4
// @description  课堂习题提示，AI解答习题
// @license      MIT
// @icon         https://www.google.com/s2/favicons?sz=64&domain=yuketang.cn
// @match        https://*.yuketang.cn/lesson/fullscreen/v3/*
// @match        https://*.yuketang.cn/v2/web/*
// @match        https://www.yuketang.cn/lesson/fullscreen/v3/*
// @match        https://www.yuketang.cn/v2/web/*
// @match        https://pro.yuketang.cn/lesson/fullscreen/v3/*
// @match        https://pro.yuketang.cn/v2/web/*
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
    // 1.16.4:载入本课（按课程分组）在本地存储过的课件
    loadStoredPresentations() {
      if (!this.currentLessonId) return;
      const key = `presentations-${this.currentLessonId}`;
      const stored = storage.getMap(key);
      for (const [id, data] of stored.entries()) this.setPresentation(id, data);
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
  var tpl$5 = '<div id="ykt-settings-panel" class="ykt-panel">\r\n  <div class="panel-header">\r\n    <h3>AI雨课堂助手设置</h3>\r\n    <span class="close-btn" id="ykt-settings-close"><i class="fas fa-times"></i></span>\r\n  </div>\r\n\r\n  <div class="panel-body">\r\n    <div class="settings-content">\r\n      <div class="setting-group">\r\n        <h4>AI配置</h4>\r\n          \x3c!-- 将DeepSeek相关配置替换为Kimi --\x3e\r\n          <div class="setting-item">\r\n              <label for="kimi-api-key">Kimi API Key:</label>\r\n              <input type="password" id="kimi-api-key" placeholder="输入您的 Kimi API Key">\r\n              <small>从 <a href="https://platform.moonshot.cn/" target="_blank">Kimi开放平台</a> 获取</small>\r\n          </div>\r\n      </div>\r\n\r\n      <div class="setting-group">\r\n        <h4>自动作答设置</h4>\r\n        <div class="setting-item">\r\n          <label class="checkbox-label">\r\n            <input type="checkbox" id="ykt-input-auto-answer">\r\n            <span class="checkmark"></span>\r\n            启用自动作答\r\n          </label>\r\n        </div>\r\n        <div class="setting-item">\r\n          <label class="checkbox-label">\r\n            <input type="checkbox" id="ykt-input-ai-auto-analyze">\r\n            <span class="checkmark"></span>\r\n            打开 AI 页面时自动分析\r\n          </label>\r\n          <small>开启后，进入“AI 解答”面板即自动向 AI 询问当前题目</small>\r\n        </div>\r\n        <div class="setting-item">\r\n          <label for="ykt-input-answer-delay">作答延迟时间 (秒):</label>\r\n          <input type="number" id="ykt-input-answer-delay" min="1" max="60">\r\n          <small>题目出现后等待多长时间开始作答</small>\r\n        </div>\r\n        <div class="setting-item">\r\n          <label for="ykt-input-random-delay">随机延迟范围 (秒):</label>\r\n          <input type="number" id="ykt-input-random-delay" min="0" max="30">\r\n          <small>在基础延迟基础上随机增加的时间范围</small>\r\n        </div><div class="setting-item">\r\n          <label class="checkbox-label">\r\n            <input type="checkbox" id="ykt-ai-pick-main-first">\r\n            <span class="checkmark"></span>\r\n            主界面优先（未勾选则课件浏览优先）\r\n          </label>\r\n          <small>仅在普通打开 AI 面板（ykt:open-ai）时生效；从“提问当前PPT”跳转保持最高优先。</small>\r\n        </div>\r\n      </div>       \r\n      <div class="setting-actions">\r\n        <button id="ykt-btn-settings-save">保存设置</button>\r\n        <button id="ykt-btn-settings-reset">重置为默认</button>\r\n      </div>\r\n    </div>\r\n  </div>\r\n</div>\r\n';
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
    const $autoAnalyze = root$4.querySelector("#ykt-input-ai-auto-analyze");
    const $delay = root$4.querySelector("#ykt-input-answer-delay");
    const $rand = root$4.querySelector("#ykt-input-random-delay");
    const $priorityRadios = root$4.querySelector("#ykt-ai-pick-main-first");
    $api.value = ui.config.ai.kimiApiKey || "";
    $auto.checked = !!ui.config.autoAnswer;
    $autoAnalyze.checked = !!ui.config.aiAutoAnalyze;
    $delay.value = Math.floor(ui.config.autoAnswerDelay / 1e3);
    $rand.value = Math.floor(ui.config.autoAnswerRandomDelay / 1e3);
    ui.config.aiSlidePickPriority || "main";
    $priorityRadios.checked = ui.config.aiSlidePickMainFirst !== false;
    root$4.querySelector("#ykt-settings-close").addEventListener("click", () => showSettingsPanel(false));
    root$4.querySelector("#ykt-btn-settings-save").addEventListener("click", () => {
      ui.config.ai.kimiApiKey = $api.value.trim();
      ui.config.autoAnswer = !!$auto.checked;
      ui.config.aiAutoAnalyze = !!$autoAnalyze.checked;
      ui.config.autoAnswerDelay = Math.max(1e3, (+$delay.value || 0) * 1e3);
      ui.config.autoAnswerRandomDelay = Math.max(0, (+$rand.value || 0) * 1e3);
      ui.config.aiSlidePickPriority = !!$priorityRadios.checked;
      storage.set("kimiApiKey", ui.config.ai.kimiApiKey);
      ui.saveConfig();
      ui.updateAutoAnswerBtn();
      ui.toast("设置已保存");
    });
    root$4.querySelector("#ykt-btn-settings-reset").addEventListener("click", () => {
      if (!confirm("确定要重置为默认设置吗？")) return;
      Object.assign(ui.config, DEFAULT_CONFIG);
      ui.config.ai.kimiApiKey = "";
      ui.config.aiAutoAnalyze = !!(DEFAULT_CONFIG.aiAutoAnalyze ?? false);
      ui.config.aiSlidePickPriority = DEFAULT_CONFIG.aiSlidePickPriority ?? true;
      storage.set("kimiApiKey", "");
      ui.saveConfig();
      ui.updateAutoAnswerBtn();
      $api.value = "";
      $auto.checked = DEFAULT_CONFIG.autoAnswer;
      $delay.value = Math.floor(DEFAULT_CONFIG.autoAnswerDelay / 1e3);
      $rand.value = Math.floor(DEFAULT_CONFIG.autoAnswerRandomDelay / 1e3);
      $autoAnalyze.checked = !!(DEFAULT_CONFIG.aiAutoAnalyze ?? false);
      $priorityRadios.checked = DEFAULT_CONFIG.aiSlidePickPriority ?? true;
      ui.toast("设置已重置");
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
  var tpl$4 = '<div id="ykt-ai-answer-panel" class="ykt-panel">\r\n  <div class="panel-header">\r\n    <h3><i class="fas fa-robot"></i> AI 融合分析</h3>\r\n    <span id="ykt-ai-close" class="close-btn" title="关闭">\r\n      <i class="fas fa-times"></i>\r\n    </span>\r\n  </div>\r\n  <div class="panel-body">\r\n    <div style="margin-bottom: 10px;">\r\n      <strong>当前题目：</strong>\r\n      <div style="font-size: 12px; color: #666; margin: 4px 0;">\r\n        系统将自动识别当前页面的题目\r\n      </div>\r\n      <div id="ykt-ai-text-status" class="text-status warning">\r\n        正在检测题目信息...\r\n      </div>\r\n      <div id="ykt-ai-question-display" class="ykt-question-display">\r\n        提示：系统使用融合模式，同时分析题目文本信息和页面图像，提供最准确的答案。\r\n      </div>\r\n    </div>\r\n    \x3c!-- 当前要提问的PPT预览（来自presentation传入时显示） --\x3e\r\n    <div id="ykt-ai-selected" style="display:none; margin: 10px 0;">\r\n      <strong>已选PPT预览：</strong>\r\n      <div style="font-size: 12px; color: #666; margin: 4px 0;">\r\n        下方小图为即将用于分析的PPT页面截图\r\n      </div>\r\n      <div style="border: 1px solid var(--ykt-border-strong); padding: 6px; border-radius: 6px; display: inline-block;">\r\n        <img id="ykt-ai-selected-thumb"\r\n             alt="已选PPT预览"\r\n             style="max-width: 180px; max-height: 120px; display:block;" />\r\n      </div>\r\n    </div>\r\n    <div style="margin-bottom: 10px;">\r\n      <strong>自定义提示（可选）：</strong>\r\n      <div style="font-size: 12px; color: #666; margin: 4px 0;">\r\n        提示：此内容将追加到系统生成的prompt后面，可用于补充特殊要求或背景信息。\r\n      </div>\r\n      <textarea \r\n        id="ykt-ai-custom-prompt" \r\n        class="ykt-custom-prompt"\r\n        placeholder="例如：请用中文回答、注重解题思路、考虑XXX知识点等"\r\n      ></textarea>\r\n    </div>\r\n\r\n    <button id="ykt-ai-ask" style="width: 100%; height: 32px; border-radius: 6px; border: 1px solid var(--ykt-border-strong); background: #f7f8fa; cursor: pointer; margin-bottom: 10px;">\r\n      <i class="fas fa-brain"></i> 融合模式分析（文本+图像）\r\n    </button>\r\n\r\n    <div id="ykt-ai-loading" class="ai-loading" style="display: none;">\r\n      <i class="fas fa-spinner fa-spin"></i> AI正在使用融合模式分析...\r\n    </div>\r\n    <div id="ykt-ai-error" class="ai-error" style="display: none;"></div>\r\n    <div>\r\n      <strong>AI 分析结果：</strong>\r\n      <div id="ykt-ai-answer" class="ai-answer"></div>\r\n    </div>\r\n  </div>\r\n</div>';
  // src/ai/kimi.js
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
    // ✅ 按照文档要求构建消息格式
        const messages = [ {
      role: "system",
      content: "你是 Kimi，由 Moonshot AI 提供的人工智能助手，你更擅长中文和英文的对话。你会为用户提供安全，有帮助，准确的回答。同时，你会拒绝一切涉及恐怖主义，种族歧视，黄色暴力等问题的回答。Moonshot AI 为专有名词，不可翻译成其他语言。"
    }, {
      role: "user",
      content: [ {
        type: "image_url",
        image_url: {
          url: `data:image/png;base64,${cleanBase64}`
        }
      }, {
        type: "text",
        text: textPrompt || "请分析图片中的题目并给出答案"
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
   */  async function submitAnswer(problem, result, submitOptions = {}) {
    const {startTime: startTime, endTime: endTime, forceRetry: forceRetry = false, retryDtOffsetMs: retryDtOffsetMs = 2e3, headers: headers} = submitOptions;
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
   * Vuex 辅助工具 - 用于获取雨课堂主界面状态
   */
  /**
   * 获取 Vue 根实例
   * @returns {Vue | null}
   */  function getVueApp() {
    try {
      const app = document.querySelector("#app").__vue__;
      return app || null;
    } catch (e) {
      console.error("[getVueApp] 错误:", e);
      return null;
    }
  }
  /**
   * 从 Vuex state 获取主界面当前页面的 slideId
   * @returns {string | null}
   */  function getCurrentMainPageSlideId() {
    try {
      const app = getVueApp();
      if (!app || !app.$store) {
        console.log("[getCurrentMainPageSlideId] 无法获取 Vue 实例或 store");
        return null;
      }
      const currSlide = app.$store.state.currSlide;
      if (!currSlide || !currSlide.sid) {
        console.log("[getCurrentMainPageSlideId] currSlide 或 sid 未定义");
        return null;
      }
      console.log("[getCurrentMainPageSlideId] 获取到 slideId:", currSlide.sid, {
        type: currSlide.type,
        problemID: currSlide.problemID,
        index: currSlide.index
      });
      return currSlide.sid;
    } catch (e) {
      console.error("[getCurrentMainPageSlideId] 错误:", e);
      return null;
    }
  }
  /**
   * 监听主界面页面切换
   * @param {Function} callback - 回调函数 (slideId, slideInfo) => void
   * @returns {Function} - 取消监听的函数
   */  function watchMainPageChange(callback) {
    const app = getVueApp();
    if (!app || !app.$store) {
      console.error("[watchMainPageChange] 无法获取 Vue 实例");
      return () => {};
    }
    const unwatch = app.$store.watch(state => state.currSlide, (newSlide, oldSlide) => {
      if (newSlide && newSlide.sid) {
        console.log("[主界面页面切换]", {
          oldSid: oldSlide?.sid,
          newSid: newSlide.sid,
          type: newSlide.type,
          problemID: newSlide.problemID
        });
        callback(newSlide.sid, newSlide);
      }
    }, {
      deep: false
    });
    console.log("✅ 已启动主界面页面切换监听");
    return unwatch;
  }
  /**
   * 等待 Vue 实例准备就绪
   * @returns {Promise<Vue>}
   */  function waitForVueReady() {
    return new Promise(resolve => {
      const check = () => {
        const app = getVueApp();
        if (app && app.$store) resolve(app); else setTimeout(check, 100);
      };
      check();
    });
  }
  let mounted$4 = false;
  let root$3;
  // 来自 presentation 的优先提示（一次性优先使用）
    let preferredSlideFromPresentation = null;
  function $$4(sel) {
    return document.querySelector(sel);
  }
  function mountAIPanel() {
    if (mounted$4) return root$3;
    const host = document.createElement("div");
    host.innerHTML = tpl$4;
    document.body.appendChild(host.firstElementChild);
    root$3 = document.getElementById("ykt-ai-answer-panel");
    $$4("#ykt-ai-close")?.addEventListener("click", () => showAIPanel(false));
    // 使用融合模式
        $$4("#ykt-ai-ask")?.addEventListener("click", askAIFusionMode);
    // ✅ 新增：启动主界面页面切换监听
        waitForVueReady().then(() => {
      watchMainPageChange((slideId, slideInfo) => {
        console.log("[AI Panel] 主界面页面切换到:", slideId);
        // 自动更新显示
                renderQuestion();
      });
    }).catch(e => {
      console.warn("[AI Panel] Vue 实例初始化失败，将使用备用方案:", e);
    });
    mounted$4 = true;
    return root$3;
  }
  window.addEventListener("ykt:open-ai", () => {
    showAIPanel(true);
  });
  // ✅ 来自 presentation 的“提问当前PPT”事件
    window.addEventListener("ykt:ask-ai-for-slide", ev => {
    const detail = ev?.detail || {};
    const {slideId: slideId, imageUrl: imageUrl} = detail;
    if (slideId) {
      preferredSlideFromPresentation = {
        slideId: slideId,
        imageUrl: imageUrl
      };
      // 若有 URL，直接覆盖 repo 内该页的 image，确保后续 capture 使用该 URL
            const s = repo.slides.get(slideId);
      if (s && imageUrl) s.image = imageUrl;
    }
    // 打开并刷新 UI + 预览
        showAIPanel(true);
    renderQuestion();
    const img = document.getElementById("ykt-ai-selected-thumb");
    const box = document.getElementById("ykt-ai-selected");
    if (img && box) {
      img.src = preferredSlideFromPresentation?.imageUrl || "";
      box.style.display = preferredSlideFromPresentation?.imageUrl ? "" : "none";
    }
  });
  function showAIPanel(visible = true) {
    mountAIPanel();
    root$3.classList.toggle("visible", !!visible);
    if (visible) {
      renderQuestion();
      if (ui.config.aiAutoAnalyze) queueMicrotask(() => {
        askAIFusionMode();
      });
    }
    const aiBtn = document.getElementById("ykt-btn-ai");
    if (aiBtn) aiBtn.classList.toggle("active", !!visible);
  }
  function setAILoading(v) {
    mountAIPanel();
    $$4("#ykt-ai-loading").style.display = v ? "" : "none";
  }
  function setAIError(msg = "") {
    mountAIPanel();
    const el = $$4("#ykt-ai-error");
    el.style.display = msg ? "" : "none";
    el.textContent = msg || "";
  }
  function setAIAnswer(content = "") {
    mountAIPanel();
    $$4("#ykt-ai-answer").textContent = content || "";
  }
  // 新增：获取用户自定义prompt
    function getCustomPrompt() {
    const customPromptEl = $$4("#ykt-ai-custom-prompt");
    if (customPromptEl) {
      const customText = customPromptEl.value.trim();
      return customText || "";
    }
    return "";
  }
  function renderQuestion() {
    // ✅ 显示当前选择逻辑的状态
    let displayText = "";
    let hasPageSelected = false;
    let selectionSource = "";
    // 0. 若来自 presentation 的优先提示存在，则最高优先
        let slide = null;
    if (preferredSlideFromPresentation?.slideId) {
      slide = repo.slides.get(preferredSlideFromPresentation.slideId);
      if (slide) {
        displayText = `来自课件面板：${slide.title || `第 ${slide.page || slide.index || ""} 页`}`;
        selectionSource = "课件浏览（传入）";
        hasPageSelected = true;
      }
    }
    // 1. 若未命中优先提示，检查主界面
        if (!slide) {
      const prio = !!(ui?.config?.aiSlidePickPriority ?? true);
      if (prio) {
        const mainSlideId = getCurrentMainPageSlideId();
        slide = mainSlideId ? repo.slides.get(mainSlideId) : null;
        if (slide) {
          displayText = `主界面当前页: ${slide.title || `第 ${slide.page || slide.index || ""} 页`}`;
          selectionSource = "主界面检测";
          if (slide.problem) displayText += "\n📝 此页面包含题目"; else displayText += "\n📄 此页面为普通内容页";
          hasPageSelected = true;
        }
      } else {
        // 2. 检查课件面板选择
        const presentationPanel = document.getElementById("ykt-presentation-panel");
        const isPresentationPanelOpen = presentationPanel && presentationPanel.classList.contains("visible");
        if (isPresentationPanelOpen && repo.currentSlideId) {
          slide = repo.slides.get(repo.currentSlideId);
          if (slide) {
            displayText = `课件面板选中: ${slide.title || `第 ${slide.page || slide.index || ""} 页`}`;
            selectionSource = "课件浏览面板";
            hasPageSelected = true;
            if (slide.problem) displayText += "\n📝 此页面包含题目"; else displayText += "\n📄 此页面为普通内容页";
          }
        } else {
          displayText = `未检测到当前页面${presentationPanel}\n💡 请在课件面板（非侧边栏）中选择页面。`;
          selectionSource = "无";
        }
      }
    }
    const el = document.querySelector("#ykt-ai-question-display");
    if (el) el.textContent = displayText;
    // 同步预览块显示
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
  // 融合模式AI询问函数（仅图像分析）- 支持自定义prompt
    async function askAIFusionMode() {
    setAIError("");
    setAILoading(true);
    setAIAnswer("");
    try {
      if (!ui.config.ai.kimiApiKey) throw new Error("请先在设置中配置 Kimi API Key");
      // ✅ 智能选择当前页面：优先“presentation 传入”，其后主界面、最后课件面板
            let currentSlideId = null;
      let slide = null;
      let selectionSource = "";
      let forcedImageUrl = null;
      // 0) 优先使用 presentation 传入的 slide
            if (preferredSlideFromPresentation?.slideId) {
        currentSlideId = preferredSlideFromPresentation.slideId;
        slide = repo.slides.get(currentSlideId);
        forcedImageUrl = preferredSlideFromPresentation.imageUrl || null;
        selectionSource = "课件浏览（传入）";
        console.log("[AI Panel] 使用presentation传入的页面:", currentSlideId);
      }
      // 1) 其后：主界面当前页面
            if (!slide) {
        const prio = !!(ui?.config?.aiSlidePickPriority ?? true);
        if (prio) {
          const mainSlideId = getCurrentMainPageSlideId();
          if (mainSlideId) {
            currentSlideId = mainSlideId;
            slide = repo.slides.get(currentSlideId);
            selectionSource = "主界面当前页面";
            console.log("[AI Panel] 使用主界面当前页面:", currentSlideId);
          }
        } else {
          const presentationPanel = document.getElementById("ykt-presentation-panel");
          const isPresentationPanelOpen = presentationPanel && presentationPanel.classList.contains("visible");
          if (isPresentationPanelOpen && repo.currentSlideId) {
            currentSlideId = repo.currentSlideId;
            slide = repo.slides.get(currentSlideId);
            selectionSource = "课件浏览面板";
            console.log("[AI Panel] 使用课件面板选中的页面:", currentSlideId);
          }
        }
      }
      // 3. 检查是否成功获取到页面
            if (!currentSlideId || !slide) throw new Error("无法确定要分析的页面。请在主界面打开一个页面，或在课件浏览中选择页面。");
      console.log("[AI Panel] 页面选择来源:", selectionSource);
      console.log("[AI Panel] 分析页面ID:", currentSlideId);
      console.log("[AI Panel] 页面信息:", slide);
      // ✅ 直接使用选中页面的图片
            console.log("[AI Panel] 获取页面图片...");
      ui.toast(`正在获取${selectionSource}图片...`, 2e3);
      let imageBase64 = null;
      // 若 presentation 传入了 URL，则优先用该 URL（captureSlideImage 会读 slide.image）
            if (forcedImageUrl) 
      // 确保 slide.image 是这张图，captureSlideImage 将基于 slideId 取图
      if (slide) slide.image = forcedImageUrl;
      imageBase64 = await captureSlideImage(currentSlideId);
      if (!imageBase64) throw new Error("无法获取页面图片，请确保页面已加载完成");
      console.log("[AI Panel] ✅ 页面图片获取成功");
      console.log("[AI Panel] 图像大小:", Math.round(imageBase64.length / 1024), "KB");
      // ✅ 构建纯图像分析提示（不使用题目文本）
            let textPrompt = `请仔细观察图片内容，识别并分析其中的题目：\n\n1. 请先判断题目类型（单选题、多选题、填空题、主观题等）\n2. 识别题干内容和选项（如果有）\n3. 根据题目类型给出答案\n\n答案格式要求：\n- 单选题：答案: A\n- 多选题：答案: A、B、C\n- 填空题：答案: [填空内容]\n- 主观题：答案: [完整回答]\n\n请严格按照格式回答。`;
      // 获取用户自定义prompt并追加
            const customPrompt = getCustomPrompt();
      if (customPrompt) {
        textPrompt += `\n\n【用户自定义要求】\n${customPrompt}`;
        console.log("[AI Panel] 用户添加了自定义prompt:", customPrompt);
      }
      ui.toast(`正在分析${selectionSource}内容...`, 3e3);
      console.log("[AI Panel] 调用Vision API...");
      console.log("[AI Panel] 使用的提示:", textPrompt);
      const aiContent = await queryKimiVision(imageBase64, textPrompt, ui.config.ai);
      setAILoading(false);
      console.log("[AI Panel] Vision API调用成功");
      console.log("[AI Panel] AI回答:", aiContent);
      // ✅ 尝试解析答案（如果当前页面有题目的话）
            let parsed = null;
      const problem = slide?.problem;
      if (problem) {
        parsed = parseAIAnswer(problem, aiContent);
        console.log("[AI Panel] 解析结果:", parsed);
      }
      // 构建显示内容
            let displayContent = `${selectionSource}图像分析结果：\n${aiContent}`;
      if (customPrompt) displayContent = `${selectionSource}图像分析结果（包含自定义要求）：\n${aiContent}`;
      if (parsed && problem) {
        setAIAnswer(`${displayContent}\n\nAI 建议答案：${JSON.stringify(parsed)}`);
        // ✅ 只有当前页面有题目时才显示提交按钮
                const submitBtn = document.createElement("button");
        submitBtn.textContent = "提交答案";
        submitBtn.className = "ykt-btn ykt-btn-primary";
        submitBtn.onclick = async () => {
          try {
            if (!problem || !problem.problemId) {
              ui.toast("当前页面没有可提交的题目");
              return;
            }
            console.log("[AI Panel] 准备提交答案");
            console.log("[AI Panel] Problem:", problem);
            console.log("[AI Panel] Parsed:", parsed);
            await submitAnswer(problem, parsed);
            ui.toast("提交成功");
            showAutoAnswerPopup(problem, aiContent);
          } catch (e) {
            console.error("[AI Panel] 提交失败:", e);
            ui.toast(`提交失败: ${e.message}`);
          }
        };
        $$4("#ykt-ai-answer").appendChild(document.createElement("br"));
        $$4("#ykt-ai-answer").appendChild(submitBtn);
      } else {
        // ✅ 如果当前页面没有题目，只显示分析结果
        if (!problem) displayContent += "\n\n💡 当前页面不是题目页面，仅显示内容分析结果。"; else displayContent += "\n\n⚠️ 无法自动解析答案格式，请检查AI回答是否符合要求格式。";
        setAIAnswer(displayContent);
      }
    } catch (e) {
      setAILoading(false);
      console.error("[AI Panel] 页面分析失败:", e);
      // 失败后不清除 preferred，便于用户修正后重试
            let errorMsg = `页面分析失败: ${e.message}`;
      if (e.message.includes("400")) errorMsg += "\n\n可能的解决方案：\n1. 检查 API Key 是否正确\n2. 尝试刷新页面后重试\n3. 确保页面已完全加载";
      setAIError(errorMsg);
    }
  }
  /**
   * 获取主界面当前显示的页面ID
   * @returns {string|null} 当前页面的slideId
   */
  // function getCurrentMainPageSlideId() {
  //   try {
  //     // 方法1：从当前最近遇到的问题获取（最可能是当前页面）
  //     if (repo.encounteredProblems.length > 0) {
  //       const latestProblem = repo.encounteredProblems.at(-1);
  //       const problemStatus = repo.problemStatus.get(latestProblem.problemId);
  //       if (problemStatus && problemStatus.slideId) {
  //         console.log('[getCurrentMainPageSlideId] 从最近问题获取:', problemStatus.slideId);
  //         return problemStatus.slideId;
  //       }
  //     }
  //     // 方法2：从DOM结构尝试获取（雨课堂可能的DOM结构）
  //     const slideElements = [
  //       document.querySelector('[data-slide-id]'),
  //       document.querySelector('.slide-wrapper.active'),
  //       document.querySelector('.ppt-slide.active'),
  //       document.querySelector('.current-slide')
  //     ];
  //     for (const el of slideElements) {
  //       if (el) {
  //         const slideId = el.dataset?.slideId || el.getAttribute('data-slide-id');
  //         if (slideId) {
  //           console.log('[getCurrentMainPageSlideId] 从DOM获取:', slideId);
  //           return slideId;
  //         }
  //       }
  //     }
  //     // 方法3：如果没有找到，返回null
  //     console.log('[getCurrentMainPageSlideId] 无法获取主界面当前页面');
  //     return null;
  //   } catch (e) {
  //     console.error('[getCurrentMainPageSlideId] 获取失败:', e);
  //     return null;
  //   }
  // }
  // 保留其他函数以向后兼容，但现在都指向融合模式
    async function askAIForCurrent() {
    return askAIFusionMode();
  }
  var tpl$3 = '<div id="ykt-presentation-panel" class="ykt-panel">\r\n  <div class="panel-header">\r\n    <h3>课件浏览</h3>\r\n    <div class="panel-controls">\r\n      <label>\r\n        <input type="checkbox" id="ykt-show-all-slides"> 切换全部页面/问题页面\r\n      </label>\r\n      <button id="ykt-ask-current">提问当前PPT</button>\r\n      <button id="ykt-open-problem-list">题目列表</button>\r\n      <button id="ykt-download-current">截图下载</button>\r\n      <button id="ykt-download-pdf">整册下载(PDF)</button>\r\n      <span class="close-btn" id="ykt-presentation-close"><i class="fas fa-times"></i></span>\r\n    </div>\r\n  </div>\r\n\r\n  <div class="panel-body">\r\n    <div class="panel-left">\r\n      <div id="ykt-presentation-list" class="presentation-list"></div>\r\n    </div>\r\n    <div class="panel-right">\r\n      <div id="ykt-slide-view" class="slide-view">\r\n        <div class="slide-cover">\r\n          <div class="empty-message">选择左侧的幻灯片查看详情</div>\r\n        </div>\r\n        <div id="ykt-problem-view" class="problem-view"></div>\r\n      </div>\r\n    </div>\r\n  </div>\r\n</div>\r\n';
  let mounted$3 = false;
  let host;
  function $$3(sel) {
    return document.querySelector(sel);
  }
  function mountPresentationPanel() {
    if (mounted$3) return host;
    const wrapper = document.createElement("div");
    wrapper.innerHTML = tpl$3;
    document.body.appendChild(wrapper.firstElementChild);
    host = document.getElementById("ykt-presentation-panel");
    $$3("#ykt-presentation-close")?.addEventListener("click", () => showPresentationPanel(false));
    $$3("#ykt-open-problem-list")?.addEventListener("click", () => {
      showPresentationPanel(false);
      window.dispatchEvent(new CustomEvent("ykt:open-problem-list"));
    });
    // 1.18.4: 提问当前PPT：把当前 slide 信息传给 AI 面板
        $$3("#ykt-ask-current")?.addEventListener("click", () => {
      if (!repo.currentSlideId) return ui.toast("请先在左侧选择一页PPT", 2500);
      const slide = repo.slides.get(repo.currentSlideId);
      const imageUrl = slide?.image || slide?.thumbnail || "";
      // 通知 AI 面板：优先使用传入的 slide 和 URL
            window.dispatchEvent(new CustomEvent("ykt:ask-ai-for-slide", {
        detail: {
          slideId: repo.currentSlideId,
          imageUrl: imageUrl
        }
      }));
      // 打开 AI 面板
            window.dispatchEvent(new CustomEvent("ykt:open-ai"));
    });
    $$3("#ykt-download-current")?.addEventListener("click", downloadCurrentSlide);
    $$3("#ykt-download-pdf")?.addEventListener("click", downloadPresentationPDF);
    const cb = $$3("#ykt-show-all-slides");
    cb.checked = !!ui.config.showAllSlides;
    cb.addEventListener("change", () => {
      ui.config.showAllSlides = !!cb.checked;
      ui.saveConfig();
      updatePresentationList();
    });
    mounted$3 = true;
    return host;
  }
  // 在 showPresentationPanel 函数中添加按钮状态同步
    function showPresentationPanel(visible = true) {
    mountPresentationPanel();
    host.classList.toggle("visible", !!visible);
    if (visible) updatePresentationList();
    // 同步工具栏按钮状态
        const presBtn = document.getElementById("ykt-btn-pres");
    if (presBtn) presBtn.classList.toggle("active", !!visible);
  }
  // export function updatePresentationList() {
  //   mountPresentationPanel();
  //   const list = $('#ykt-presentation-list');
  //   list.innerHTML = '';
  //   const showAll = !!ui.config.showAllSlides;
  //   const presEntries = [...repo.presentations.values()].slice(-ui.config.maxPresentations);
  //   presEntries.forEach((pres) => {
  //     const item = document.createElement('div');
  //     item.className = 'presentation-item';
  //     const title = document.createElement('div');
  //     title.className = 'presentation-title';
  //     title.textContent = pres.title || `课件 ${pres.id}`;
  //     item.appendChild(title);
  //     const slidesWrap = document.createElement('div');
  //     slidesWrap.className = 'slide-thumb-list';
  //     (pres.slides || []).forEach((s) => {
  //       if (!showAll && !s.problem) return;
  //       const thumb = document.createElement('div');
  //       thumb.className = 'slide-thumb';
  //       thumb.title = s.title || `第 ${s.page} 页`;
  //       if (s.thumbnail) {
  //         const img = document.createElement('img');
  //         img.src = s.thumbnail;
  //         img.alt = thumb.title;
  //         thumb.appendChild(img);
  //       } else {
  //         thumb.textContent = s.title || String(s.page ?? '');
  //       }
  //       thumb.addEventListener('click', () => {
  //         repo.currentPresentationId = pres.id;
  //         repo.currentSlideId = s.id;
  //         updateSlideView();
  //       });
  //       slidesWrap.appendChild(thumb);
  //     });
  //     item.appendChild(slidesWrap);
  //     list.appendChild(item);
  //   });
  // }
  //1.16.4 更新课件加载方法
    function updatePresentationList() {
    mountPresentationPanel();
    const listEl = document.getElementById("ykt-presentation-list");
    if (!listEl) return;
    listEl.innerHTML = "";
    if (repo.presentations.size === 0) {
      listEl.innerHTML = '<p class="no-presentations">暂无课件记录</p>';
      return;
    }
    // 只显示当前课程的课件（基于 URL 与 repo.currentLessonId 过滤）
        const currentPath = window.location.pathname;
    const m = currentPath.match(/\/lesson\/fullscreen\/v3\/([^/]+)/);
    const currentLessonFromURL = m ? m[1] : null;
    const filtered = new Map;
    for (const [id, presentation] of repo.presentations) 
    // 若 URL 和 repo 同时能取到 lessonId，则要求一致
    if (currentLessonFromURL && repo.currentLessonId && currentLessonFromURL === repo.currentLessonId) filtered.set(id, presentation); else if (!currentLessonFromURL) 
    // 向后兼容：无法从 URL 提取课程 ID 时，展示全部
    filtered.set(id, presentation); else if (currentLessonFromURL === repo.currentLessonId) filtered.set(id, presentation);
    const presentationsToShow = filtered.size > 0 ? filtered : repo.presentations;
    for (const [id, presentation] of presentationsToShow) {
      const cont = document.createElement("div");
      cont.className = "presentation-container";
      // 标题 + 下载按钮
            const titleEl = document.createElement("div");
      titleEl.className = "presentation-title";
      titleEl.innerHTML = `\n      <span>${presentation.title || `课件 ${id}`}</span>\n      <i class="fas fa-download download-btn" title="下载课件"></i>\n    `;
      cont.appendChild(titleEl);
      // 下载按钮
            titleEl.querySelector(".download-btn")?.addEventListener("click", e => {
        e.stopPropagation();
        downloadPresentation(presentation);
      });
      // 幻灯片缩略图区域
            const slidesWrap = document.createElement("div");
      slidesWrap.className = "slide-thumb-list";
      // 是否显示全部页
            const showAll = !!ui.config.showAllSlides;
      const slidesToShow = showAll ? presentation.slides || [] : (presentation.slides || []).filter(s => s.problem);
      for (const s of slidesToShow) {
        const thumb = document.createElement("div");
        thumb.className = "slide-thumb";
        // 当前高亮
                if (s.id === repo.currentSlideId) thumb.classList.add("active");
        // 状态样式：解锁 / 已作答
                if (s.problem) {
          const pid = s.problem.problemId;
          const status = repo.problemStatus.get(pid);
          if (status) thumb.classList.add("unlocked");
          if (s.problem.result) thumb.classList.add("answered");
        }
        // 点击跳转
                thumb.addEventListener("click", () => {
          actions.navigateTo(presentation.id, s.id);
        });
        // 缩略图内容
                const img = document.createElement("img");
        if (presentation.width && presentation.height) img.style.aspectRatio = `${presentation.width}/${presentation.height}`;
        img.src = s.thumbnail || "";
        img.alt = s.title || `第 ${s.page ?? ""} 页`;
        // 关键：图片加载失败时移除（可能非本章节的页）
                img.onerror = function() {
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
  // 课件下载入口：切换当前课件后调用现有 PDF 导出逻辑
    function downloadPresentation(presentation) {
    // 先切到该课件，再复用“整册下载(PDF)”按钮逻辑
    repo.currentPresentationId = presentation.id;
    // 这里直接调用现有的 downloadPresentationPDF（定义在本文件尾部）
    // 若你希望仅下载题目页，可根据 ui.config.showAllSlides 控制
        downloadPresentationPDF();
  }
  function updateSlideView() {
    mountPresentationPanel();
    const slideView = $$3("#ykt-slide-view");
    const problemView = $$3("#ykt-problem-view");
    slideView.querySelector(".slide-cover")?.classList.add("hidden");
    problemView.innerHTML = "";
    if (!repo.currentSlideId) {
      slideView.querySelector(".slide-cover")?.classList.remove("hidden");
      return;
    }
    const slide = repo.slides.get(repo.currentSlideId);
    if (!slide) return;
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
    if (!repo.currentSlideId) return ui.toast("请先选择一页课件/题目");
    const slide = repo.slides.get(repo.currentSlideId);
    if (!slide) return;
    try {
      const html2canvas = await ensureHtml2Canvas();
      const el = document.getElementById("ykt-slide-view");
      const canvas = await html2canvas(el, {
        useCORS: true,
        allowTaint: false
      });
      const a = document.createElement("a");
      a.download = `slide-${slide.id}.png`;
      a.href = canvas.toDataURL("image/png");
      a.click();
    } catch (e) {
      ui.toast(`截图失败: ${e.message}`);
    }
  }
  async function downloadPresentationPDF() {
    if (!repo.currentPresentationId) return ui.toast("请先在左侧选择一份课件");
    const pres = repo.presentations.get(repo.currentPresentationId);
    if (!pres || !Array.isArray(pres.slides) || pres.slides.length === 0) return ui.toast("未找到该课件的页面");
    // 是否导出全部页：沿用你面板的“切换全部/题目页”开关语义
        const showAll = !!ui.config.showAllSlides;
    const slides = pres.slides.filter(s => showAll || s.problem);
    if (slides.length === 0) return ui.toast("当前筛选下没有可导出的页面");
    try {
      // 1) 确保 jsPDF 就绪
      await ensureJsPDF();
      const {jsPDF: jsPDF} = window.jspdf || {};
      if (!jsPDF) throw new Error("jsPDF 未加载成功");
      // 2) A4 纸张（pt）：595 x 842（竖版）
            const doc = new jsPDF({
        unit: "pt",
        format: "a4",
        orientation: "portrait"
      });
      const pageW = 595, pageH = 842;
      // 页边距（视觉更好看）
            const margin = 24;
      const maxW = pageW - margin * 2;
      const maxH = pageH - margin * 2;
      // 简单的图片加载器（拿到原始宽高以保持比例居中）
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
          // 无图页可跳过，也可在此尝试 html2canvas 截图（复杂度更高，此处先跳过）
          if (i > 0) doc.addPage();
          continue;
        }
        // 3) 加载图片并按比例缩放到 A4
                const img = await loadImage(url);
        const iw = img.naturalWidth || img.width;
        const ih = img.naturalHeight || img.height;
        const r = Math.min(maxW / iw, maxH / ih);
        const w = Math.floor(iw * r);
        const h = Math.floor(ih * r);
        const x = Math.floor((pageW - w) / 2);
        const y = Math.floor((pageH - h) / 2);
        // 4) 首页直接画，后续页先 addPage
                if (i > 0) doc.addPage();
        // 通过 <img> 对象加图（jsPDF 自动推断类型；如需可改成 'PNG'）
                doc.addImage(img, "PNG", x, y, w, h);
      }
      // 5) 文件名：保留课件标题或 id
            const name = (pres.title || `课件-${pres.id}`).replace(/[\\/:*?"<>|]/g, "_");
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
          endTime: endTime
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
              forceRetry: true
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
          forceRetry: true
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
  var tpl = '<div id="ykt-tutorial-panel" class="ykt-panel">\r\n  <div class="panel-header">\r\n    <h3>雨课堂助手使用教程</h3>\r\n    <h5>1.18.4</h5>\r\n    <span class="close-btn" id="ykt-tutorial-close"><i class="fas fa-times"></i></span>\r\n  </div>\r\n\r\n  <div class="panel-body">\r\n    <div class="tutorial-content">\r\n      <h4>功能介绍</h4>\r\n      <p>AI雨课堂助手是一个为雨课堂提供辅助功能的工具，可以帮助你更好地参与课堂互动。</p>\r\n      <p>项目仓库：<a href="https://github.com/ZaytsevZY/yuketang-helper-auto" target="_blank" rel="noopener">GitHub</a></p>\r\n      <p>脚本安装：<a href="https://greasyfork.org/zh-CN/scripts/531469-ai%E9%9B%A8%E8%AF%BE%E5%A0%82%E5%8A%A9%E6%89%8B-%E6%A8%A1%E5%9D%97%E5%8C%96%E6%9E%84%E5%BB%BA%E7%89%88" target="_blank" rel="noopener">GreasyFork</a></p>\r\n\r\n      <h4>工具栏按钮说明</h4>\r\n      <ul>\r\n        <li><i class="fas fa-bell"></i> <b>习题提醒</b>：切换是否在新习题出现时显示通知提示（蓝色=开启）。</li>\r\n        <li><i class="fas fa-file-powerpoint"></i> <b>课件浏览</b>：查看课件与题目页面，提问可见内容。</li>\r\n        <li><i class="fas fa-robot"></i> <b>AI 解答</b>：向 AI 询问当前题目并显示建议答案。</li>\r\n        <li><i class="fas fa-magic-wand-sparkles"></i> <b>自动作答</b>：切换自动作答（蓝色=开启）。</li>\r\n        <li><i class="fas fa-cog"></i> <b>设置</b>：配置 API 密钥与自动作答参数。</li>\r\n        <li><i class="fas fa-question-circle"></i> <b>使用教程</b>：显示/隐藏当前教程页面。</li>\r\n      </ul>\r\n\r\n      <h4>自动作答</h4>\r\n      <ul>\r\n        <li>在设置中开启自动作答并配置延迟/随机延迟。</li>\r\n        <li>需要配置 <del>DeepSeek API</del> Kimi API 密钥。</li>\r\n        <li>答案来自 AI，结果仅供参考。</li>\r\n      </ul>\r\n\r\n      <h4>AI 解答</h4>\r\n      <ol>\r\n        <li>点击设置（<i class="fas fa-cog"></i>）填入 API Key。</li>\r\n        <li>点击 AI 解答（<i class="fas fa-robot"></i>）后会对“当前题目/最近遇到的题目”询问并解析。</li>\r\n      </ol>\r\n\r\n      <h4>注意事项</h4>\r\n      <p>1) 仅供学习参考，请独立思考；</p>\r\n      <p>2) 合理使用 API 额度；</p>\r\n      <p>3) 答案不保证 100% 正确；</p>\r\n      <p>4) 自动作答有一定风险，谨慎开启。</p>\r\n\r\n      <h4>联系方式</h4>\r\n      <ul>\r\n        <li>请在Github issue提出问题</li>\r\n      </ul>\r\n    </div>\r\n  </div>\r\n</div>\r\n';
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
  function saveConfig() {
    storage.set("config", _config);
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
    notifyProblem(problem, slide) {
      // gm.notify({
      //   title: '雨课堂习题提示',
      //   text: this.getProblemDetail(problem),
      //   image: slide?.thumbnail || null,
      //   timeout: 5000,
      // });
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
  // src/state/actions.js
    let _autoLoopStarted = false;
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
      const slideId = status.slideId;
      console.log("[AutoAnswer] 题目所在幻灯片:", slideId);
      console.log("[AutoAnswer] =================================");
      // ✅ 关键修复：直接使用幻灯片的cover图片，而不是截图DOM
            console.log("[AutoAnswer] 使用融合模式分析（文本+幻灯片图片）...");
      const imageBase64 = await captureSlideImage(slideId);
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
        forceRetry: false
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
      await submitAnswer(problem, result);
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
