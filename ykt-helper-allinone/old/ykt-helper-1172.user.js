// ==UserScript==
// @name         AI雨课堂助手（模块化构建版）
// @namespace    https://github.com/your/repo
// @version      1.17.2-mod
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
  var tpl$5 = '<div id="ykt-settings-panel" class="ykt-panel">\n  <div class="panel-header">\n    <h3>AI雨课堂助手设置</h3>\n    <span class="close-btn" id="ykt-settings-close"><i class="fas fa-times"></i></span>\n  </div>\n\n  <div class="panel-body">\n    <div class="settings-content">\n      <div class="setting-group">\n        <h4>AI配置</h4>\n          \x3c!-- 将DeepSeek相关配置替换为Kimi --\x3e\n          <div class="setting-item">\n              <label for="kimi-api-key">Kimi API Key:</label>\n              <input type="password" id="kimi-api-key" placeholder="输入您的 Kimi API Key">\n              <small>从 <a href="https://platform.moonshot.cn/" target="_blank">Kimi开放平台</a> 获取</small>\n          </div>\n      </div>\n\n      <div class="setting-group">\n        <h4>自动作答设置</h4>\n        <div class="setting-item">\n          <label class="checkbox-label">\n            <input type="checkbox" id="ykt-input-auto-answer">\n            <span class="checkmark"></span>\n            启用自动作答\n          </label>\n        </div>\n        <div class="setting-item">\n          <label class="checkbox-label">\n            <input type="checkbox" id="ykt-input-ai-auto-analyze">\n            <span class="checkmark"></span>\n            打开 AI 页面时自动分析\n          </label>\n          <small>开启后，进入“AI 解答”面板即自动向 AI 询问当前题目</small>\n        </div>\n        <div class="setting-item">\n          <label for="ykt-input-answer-delay">作答延迟时间 (秒):</label>\n          <input type="number" id="ykt-input-answer-delay" min="1" max="60">\n          <small>题目出现后等待多长时间开始作答</small>\n        </div>\n        <div class="setting-item">\n          <label for="ykt-input-random-delay">随机延迟范围 (秒):</label>\n          <input type="number" id="ykt-input-random-delay" min="0" max="30">\n          <small>在基础延迟基础上随机增加的时间范围</small>\n        </div>\n      </div>\n\n      <div class="setting-actions">\n        <button id="ykt-btn-settings-save">保存设置</button>\n        <button id="ykt-btn-settings-reset">重置为默认</button>\n      </div>\n    </div>\n  </div>\n</div>\n';
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
    $api.value = ui.config.ai.kimiApiKey || "";
    $auto.checked = !!ui.config.autoAnswer;
    $autoAnalyze.checked = !!ui.config.aiAutoAnalyze;
    $delay.value = Math.floor(ui.config.autoAnswerDelay / 1e3);
    $rand.value = Math.floor(ui.config.autoAnswerRandomDelay / 1e3);
    root$4.querySelector("#ykt-settings-close").addEventListener("click", () => showSettingsPanel(false));
    root$4.querySelector("#ykt-btn-settings-save").addEventListener("click", () => {
      ui.config.ai.kimiApiKey = $api.value.trim();
      ui.config.autoAnswer = !!$auto.checked;
      ui.config.aiAutoAnalyze = !!$autoAnalyze.checked;
      ui.config.autoAnswerDelay = Math.max(1e3, (+$delay.value || 0) * 1e3);
      ui.config.autoAnswerRandomDelay = Math.max(0, (+$rand.value || 0) * 1e3);
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
      storage.set("kimiApiKey", "");
      ui.saveConfig();
      ui.updateAutoAnswerBtn();
      $api.value = "";
      $auto.checked = DEFAULT_CONFIG.autoAnswer;
      $delay.value = Math.floor(DEFAULT_CONFIG.autoAnswerDelay / 1e3);
      $rand.value = Math.floor(DEFAULT_CONFIG.autoAnswerRandomDelay / 1e3);
      $autoAnalyze.checked = !!(DEFAULT_CONFIG.aiAutoAnalyze ?? false);
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
  var tpl$4 = '<div id="ykt-ai-answer-panel" class="ykt-panel">\n  <div class="panel-header">\n    <h3><i class="fas fa-robot"></i> AI 解答</h3>\n    <span id="ykt-ai-close" class="close-btn" title="关闭">\n      <i class="fas fa-times"></i>\n    </span>\n  </div>\n  <div class="panel-body">\n    <div class="ai-question-wrap">\n      <textarea id="ykt-ai-question-input" class="ai-question" placeholder="在此编辑要询问 AI 的题目…"></textarea>\n      <div class="ai-question-hint" style="font-size:12px;color:#666;margin-top:6px;">\n        提示：可直接编辑上面的题面再点击“向 AI 询问当前题目”或启用自动分析。\n      </div>\n    </div>\n    <div id="ykt-ai-loading" class="ai-loading" style="display: none;">\n      <i class="fas fa-spinner fa-spin"></i> AI正在分析...\n    </div>\n    <div id="ykt-ai-error" class="ai-error" style="display: none;"></div>\n    <div id="ykt-ai-answer" class="ai-answer"></div>\n    <div class="ai-actions">\n      <button id="ykt-ai-ask">向 AI 询问当前题目</button>\n      <button id="ykt-ai-ask-vision">Vision模式分析</button>\n    </div>\n  </div>\n</div>';
  // src/tsm/ai-format.js
    function formatProblemForAI(problem, TYPE_MAP) {
    let q = `请回答以下${TYPE_MAP[problem.problemType] || "题目"}，按照格式回复：先给出答案，然后给出解释。\n\n题目：${problem.body || ""}`;
    if (problem.options?.length) {
      q += "\n选项：";
      for (const o of problem.options) q += `\n${o.key}. ${o.value}`;
    }
    q += `\n\n请按照以下格式回答：\n答案: [你的答案]\n解释: [详细解释]\n\n注意：\n- 单选题和投票题请回答选项字母\n- 多选题请回答多个选项字母\n- 填空题请直接给出答案内容\n- 主观题请给出完整回答`;
    return q;
  }
  function formatProblemForDisplay(problem, TYPE_MAP) {
    let s = `${TYPE_MAP[problem.problemType] || "题目"}：${problem.body || ""}`;
    if (problem.options?.length) {
      s += "\n\n选项：";
      for (const o of problem.options) s += `\n${o.key}. ${o.value}`;
    }
    return s;
  }
  function parseAIAnswer(problem, aiAnswer) {
    try {
      const lines = String(aiAnswer || "").split("\n");
      let answerLine = "";
      for (const line of lines) if (line.includes("答案:") || line.includes("答案：")) {
        answerLine = line.replace(/答案[:：]\s*/, "").trim();
        break;
      }
      if (!answerLine) answerLine = lines[0]?.trim() || "";
      switch (problem.problemType) {
       case 1:
        break;

 // 单选
               case 3:
        {
          // 投票
          let m = answerLine.match(/[ABCD]/i);
          if (m) return [ m[0].toUpperCase() ];
          m = answerLine.match(/[A-Za-z]/);
          if (m) return [ m[0].toUpperCase() ];
          return null;
        }

       case 2:
        {
          // 多选
          let ms = answerLine.match(/[ABCD]/gi);
          if (ms?.length) return [ ...new Set(ms.map(x => x.toUpperCase())) ].sort();
          ms = answerLine.match(/[A-Za-z]/g);
          if (ms?.length) return [ ...new Set(ms.map(x => x.toUpperCase())) ].sort();
          return null;
        }

       case 4:
        {
          // 填空
          const blanks = answerLine.split(/[,，\s]+/).filter(Boolean);
          return blanks.length ? blanks : null;
        }

       case 5:
        // 主观
        return {
          content: answerLine,
          pics: []
        };

       default:
        return null;
      }
    } catch (e) {
      console.error("[parseAIAnswer] failed", e);
      return null;
    }
  }
  // src/ai/kimi.js
  /**
   * 调用 Kimi 文本模型
   * @param {string} question 题目内容
   * @param {Object} aiCfg AI配置
   * @returns {Promise<string>} AI回答
   */  async function queryKimi(question, aiCfg) {
    const apiKey = aiCfg.kimiApiKey;
    if (!apiKey) throw new Error("请先配置 Kimi API Key");
    return new Promise((resolve, reject) => {
      gm.xhr({
        method: "POST",
        url: "https://api.moonshot.cn/v1/chat/completions",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        data: JSON.stringify({
          model: "moonshot-v1-8k",
          // ✅ 文本模型
          messages: [ {
            role: "system",
            content: "你是 Kimi，由 Moonshot AI 提供的人工智能助手。请简洁准确地回答用户的问题，特别是选择题请直接给出答案选项。"
          }, {
            role: "user",
            content: question
          } ],
          temperature: .6
        }),
        onload: res => {
          try {
            console.log("[Kimi API] Status:", res.status);
            console.log("[Kimi API] Response:", res.responseText);
            if (res.status !== 200) {
              reject(new Error(`Kimi API 请求失败: ${res.status}`));
              return;
            }
            const data = JSON.parse(res.responseText);
            const content = data.choices?.[0]?.message?.content;
            if (content) resolve(content); else reject(new Error("AI返回内容为空"));
          } catch (e) {
            reject(new Error(`解析API响应失败: ${e.message}`));
          }
        },
        onerror: () => reject(new Error("网络请求失败")),
        timeout: 3e4
      });
    });
  }
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
  var kimi =  Object.freeze({
    __proto__: null,
    queryKimi: queryKimi,
    queryKimiVision: queryKimiVision
  });
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
  // src/ui/auto-answer-popup.js
  // 简单 HTML 转义，避免把题目中的 <> 等插入为标签
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
   * @param {object} problem - 题目对象
   * @param {string} aiAnswer - 原始 AI 文本（未解析前）
   * @param {object} [cfg] - 可选配置（用于局部覆写）
   */  function showAutoAnswerPopup(problem, aiAnswer, cfg = {}) {
    // 避免重复
    const existed = document.getElementById("ykt-auto-answer-popup");
    if (existed) existed.remove();
    const popup = document.createElement("div");
    popup.id = "ykt-auto-answer-popup";
    popup.className = "auto-answer-popup";
    // 模块版签名：需要传 TYPE_MAP
        const questionText = formatProblemForDisplay(problem, ui.config && ui.config.TYPE_MAP || {});
    // 采用“全屏遮罩 + 内部卡片”的结构，外层用于点击关闭
        popup.innerHTML = `\n    <div class="popup-content">\n      <div class="popup-header">\n        <h4><i class="fas fa-robot"></i> AI自动作答成功</h4>\n        <span class="close-btn" title="关闭"><i class="fas fa-times"></i></span>\n      </div>\n      <div class="popup-body">\n        <div class="popup-row popup-question">\n          <div class="label">题目：</div>\n          <div class="content">${esc(questionText).replace(/\n/g, "<br>")}</div>\n        </div>\n        <div class="popup-row popup-answer">\n          <div class="label">AI回答：</div>\n          <div class="content">${esc(aiAnswer || "").replace(/\n/g, "<br>")}</div>\n        </div>\n      </div>\n    </div>\n  `;
    document.body.appendChild(popup);
    // 关闭按钮
        popup.querySelector(".close-btn")?.addEventListener("click", () => popup.remove());
    // 点击遮罩关闭（只在点击外层时才关闭）
        popup.addEventListener("click", e => {
      if (e.target === popup) popup.remove();
    });
    // 自动关闭
        const ac = ui.config && ui.config.autoAnswerPopup || {};
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
        // ✅ 设置背景色
        scale: 1,
        // ✅ 设置缩放比例
        width: Math.min(el.scrollWidth, 1200),
        // ✅ 限制宽度
        height: Math.min(el.scrollHeight, 800)
      });
    } catch (e) {
      console.error("[captureProblemScreenshot] failed", e);
      return null;
    }
  }
  // 新增：获取问题页面截图的base64数据，供Vision API使用
    async function captureProblemForVision() {
    try {
      console.log("[captureProblemForVision] 开始截图...");
      const canvas = await captureProblemScreenshot();
      if (!canvas) {
        console.error("[captureProblemForVision] 截图失败");
        return null;
      }
      console.log("[captureProblemForVision] 截图成功，转换为base64...");
      // ✅ 转换为 JPEG 格式以减小文件大小
            const base64 = canvas.toDataURL("image/jpeg", .8).split(",")[1];
      console.log("[captureProblemForVision] base64 长度:", base64.length);
      // ✅ 检查图片大小，如果太大则压缩
            if (base64.length > 1e6) {
        // 1MB
        console.log("[captureProblemForVision] 图片过大，进行压缩...");
        // 重新生成更小的图片
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
  var screenshoot =  Object.freeze({
    __proto__: null,
    captureProblemForVision: captureProblemForVision,
    captureProblemScreenshot: captureProblemScreenshot
  });
  let mounted$4 = false;
  let root$3;
  function $$4(sel) {
    return document.querySelector(sel);
  }
  function mountAIPanel() {
    if (mounted$4) return root$3;
    const host = document.createElement("div");
    host.innerHTML = tpl$4;
    document.body.appendChild(host.firstElementChild);
    root$3 = document.getElementById("ykt-ai-answer-panel");
    // 关闭面板
        $$4("#ykt-ai-close")?.addEventListener("click", () => showAIPanel(false));
    // 手动点击按钮触发 AI 分析
        $$4("#ykt-ai-ask")?.addEventListener("click", askAIForCurrent);
    // Vision 模式按钮
        $$4("#ykt-ai-ask-vision")?.addEventListener("click", askAIVisionForCurrent);
    mounted$4 = true;
    return root$3;
  }
  window.addEventListener("ykt:open-ai", () => {
    showAIPanel(true);
 // 打开面板
    });
  function showAIPanel(visible = true) {
    mountAIPanel();
    root$3.classList.toggle("visible", !!visible);
    if (visible) {
      renderQuestion();
      // 自动分析：只有开关打开时才调用
            if (ui.config.aiAutoAnalyze) queueMicrotask(() => {
        askAIForCurrent();
      });
    }
    // 同步工具栏按钮状态
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
  function renderQuestion() {
    const p = repo.currentSlideId ? repo.slides.get(repo.currentSlideId)?.problem : null;
    const problem = p || (repo.encounteredProblems.at(-1) ? repo.problems.get(repo.encounteredProblems.at(-1).problemId) : null);
    const text = problem ? formatProblemForDisplay(problem, ui.config.TYPE_MAP || {}) : "未选择题目";
    const el = document.querySelector("#ykt-ai-question-input");
    if (el) 
    // 若用户已经编辑过则不覆盖；首次为空时才灌入默认题面
    if (!el.value.trim()) el.value = text;
  }
  function getEditedQuestion() {
    const el = document.querySelector("#ykt-ai-question-input");
    const v = el ? el.value.trim() : "";
    return v;
  }
  // 新增：使用Vision模式询问AI
  // 在 askAIVisionForCurrent 函数中添加更多调试信息
    async function askAIVisionForCurrent() {
    const slide = repo.currentSlideId ? repo.slides.get(repo.currentSlideId) : null;
    const problem = slide?.problem || (repo.encounteredProblems.at(-1) ? repo.problems.get(repo.encounteredProblems.at(-1).problemId) : null);
    setAIError("");
    setAILoading(true);
    setAIAnswer("");
    try {
      // 1. 检查 API Key
      if (!ui.config.ai.kimiApiKey) throw new Error("请先在设置中配置 Kimi API Key");
      // 2. 截取当前页面图像
            ui.toast("正在截取页面图像...", 2e3);
      console.log("[Vision] 开始截图...");
      const imageBase64 = await captureProblemForVision();
      if (!imageBase64) throw new Error("无法截取页面图像，请确保页面内容已加载完成");
      console.log("[Vision] 截图完成，图像大小:", imageBase64.length);
      // 3. 准备文本提示
            const edited = getEditedQuestion();
      let textPrompt = edited && edited.length > 0 ? `请分析图片并结合以下用户输入的题目信息作答。用户输入的题目信息是：\n\n${edited}\n\n请按“答案/解释”的格式返回。` : "请分析图片中的题目并给出答案。按照以下格式回答：\n答案: [你的答案]\n解释: [详细解释]";
      if (!edited && problem && problem.body) {
        const problemText = formatProblemForAI(problem, ui.config.TYPE_MAP || {});
        textPrompt = `请结合以下题目信息分析图片：\n\n${problemText}\n\n请仔细观察图片内容，给出准确答案。`;
      }
      // 4. 调用Vision API
            ui.toast("正在使用Vision模式分析...", 3e3);
      console.log("[Vision] 调用API...");
      const aiContent = await queryKimiVision(imageBase64, textPrompt, ui.config.ai);
      setAILoading(false);
      console.log("[Vision] API调用成功");
      setAIAnswer(`Vision模式回答：\n${aiContent}`);
      // 5. 如果有题目对象，尝试解析答案并提供提交按钮
            if (problem) {
        const parsed = parseAIAnswer(problem, aiContent);
        if (parsed) {
          setAIAnswer(`Vision模式回答：\n${aiContent}\n\nAI 建议答案：${JSON.stringify(parsed)}`);
          const submitBtn = document.createElement("button");
          submitBtn.textContent = "提交答案";
          submitBtn.onclick = async () => {
            try {
              await submitAnswer(problem, parsed);
              ui.toast("提交成功");
              showAutoAnswerPopup(problem, aiContent);
            } catch (e) {
              ui.toast(`提交失败: ${e.message}`);
            }
          };
          $$4("#ykt-ai-answer").appendChild(document.createElement("br"));
          $$4("#ykt-ai-answer").appendChild(submitBtn);
        } else setAIAnswer(`Vision模式回答：\n${aiContent}\n\n注意：无法自动解析答案格式，请手动查看上述回答。`);
      }
    } catch (e) {
      setAILoading(false);
      console.error("[Vision] 完整错误信息:", e);
      // ✅ 提供降级建议
            let errorMsg = `Vision模式失败: ${e.message}`;
      if (e.message.includes("400")) errorMsg += "\n\n可能的解决方案：\n1. 检查 API Key 是否正确\n2. 尝试刷新页面后重试\n3. 使用普通文本模式";
      setAIError(errorMsg);
    }
  }
  // 修改原有的askAIForCurrent，保持兼容
    async function askAIForCurrent() {
    const slide = repo.currentSlideId ? repo.slides.get(repo.currentSlideId) : null;
    const problem = slide?.problem || (repo.encounteredProblems.at(-1) ? repo.problems.get(repo.encounteredProblems.at(-1).problemId) : null);
    const edited = getEditedQuestion();
 // ← 读取用户编辑内容
    // 若没有题面文本（用户也没编辑）且无法拿到 problem，则自动切到 Vision 模式
        if (!edited && (!problem || !problem.body)) {
      ui.toast("未检测到题目文本，自动使用Vision模式", 2e3);
      return askAIVisionForCurrent();
    }
    setAIError("");
    setAILoading(true);
    setAIAnswer("");
    try {
      // 1) 构造要问 AI 的文本：优先使用“用户编辑”的题面
      const q = edited || formatProblemForAI(problem, ui.config.TYPE_MAP || {});
      // 2) 请求
            const aiContent = await queryKimi(q, ui.config.ai);
      // 3) 若有 problem，尝试解析并提供“提交答案”
            let parsed = null;
      if (problem) parsed = parseAIAnswer(problem, aiContent);
      setAILoading(false);
      if (parsed) {
        setAIAnswer(`AI 建议答案：${JSON.stringify(parsed)}`);
        const submitBtn = document.createElement("button");
        submitBtn.textContent = "提交答案";
        submitBtn.onclick = async () => {
          try {
            await submitAnswer(problem, parsed);
            ui.toast("提交成功");
            showAutoAnswerPopup(problem, typeof aiContent === "string" ? aiContent : JSON.stringify(aiContent, null, 2));
          } catch (e) {
            ui.toast(`提交失败: ${e.message}`);
          }
        };
        document.querySelector("#ykt-ai-answer").appendChild(document.createElement("br"));
        document.querySelector("#ykt-ai-answer").appendChild(submitBtn);
      } else 
      // 无法解析就直接把原文显示给用户
      setAIAnswer(typeof aiContent === "string" ? aiContent : JSON.stringify(aiContent, null, 2));
    } catch (e) {
      setAILoading(false);
      setAIError(e.message);
    }
  }
  var tpl$3 = '<div id="ykt-presentation-panel" class="ykt-panel">\n  <div class="panel-header">\n    <h3>课件浏览</h3>\n    <div class="panel-controls">\n      <label>\n        <input type="checkbox" id="ykt-show-all-slides"> 切换全部页面/问题页面\n      </label>\n      <button id="ykt-open-problem-list">题目列表</button>\n      <button id="ykt-download-current">截图下载</button>\n      <button id="ykt-download-pdf">整册下载(PDF)</button>\n      <span class="close-btn" id="ykt-presentation-close"><i class="fas fa-times"></i></span>\n    </div>\n  </div>\n\n  <div class="panel-body">\n    <div class="panel-left">\n      <div id="ykt-presentation-list" class="presentation-list"></div>\n    </div>\n    <div class="panel-right">\n      <div id="ykt-slide-view" class="slide-view">\n        <div class="slide-cover">\n          <div class="empty-message">选择左侧的幻灯片查看详情</div>\n        </div>\n        <div id="ykt-problem-view" class="problem-view"></div>\n      </div>\n    </div>\n  </div>\n</div>\n';
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
  var tpl$2 = '<div id="ykt-problem-list-panel" class="ykt-panel">\n  <div class="panel-header">\n    <h3>课堂习题列表</h3>\n    <span class="close-btn" id="ykt-problem-list-close"><i class="fas fa-times"></i></span>\n  </div>\n\n  <div class="panel-body">\n    <div id="ykt-problem-list" class="problem-list">\n      \x3c!-- 由 problem-list.js 动态填充：\n           .problem-row\n             .problem-title\n             .problem-meta\n             .problem-actions (查看 / AI解答 / 已作答) --\x3e\n    </div>\n  </div>\n</div>\n';
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
  var tpl$1 = '<div id="ykt-active-problems-panel" class="ykt-active-wrapper">\n  <div id="ykt-active-problems" class="active-problems"></div>\n</div>\n';
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
    repo.problemStatus.forEach((status, pid) => {
      const p = repo.problems.get(pid);
      if (!p || p.result) return;
      const card = document.createElement("div");
      card.className = "active-problem-card";
      const title = document.createElement("div");
      title.className = "ap-title";
      title.textContent = (p.body || `题目 ${pid}`).slice(0, 80);
      card.appendChild(title);
      const remain = Math.max(0, Math.floor((status.endTime - now) / 1e3));
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
  }
  var tpl = '<div id="ykt-tutorial-panel" class="ykt-panel">\n  <div class="panel-header">\n    <h3>雨课堂助手使用教程</h3>\n    <h5>1.17.1<h5>\n    <span class="close-btn" id="ykt-tutorial-close"><i class="fas fa-times"></i></span>\n  </div>\n\n  <div class="panel-body">\n    <div class="tutorial-content">\n      <h4>功能介绍</h4>\n      <p>AI雨课堂助手是一个为雨课堂提供辅助功能的工具，可以帮助你更好地参与课堂互动。</p>\n      <p>项目仓库：<a href="https://github.com/ZaytsevZY/yuketang-helper-ai" target="_blank" rel="noopener">GitHub</a></p>\n      <p>脚本安装：<a href="https://greasyfork.org/zh-CN/scripts/531469-ai雨课堂助手" target="_blank" rel="noopener">GreasyFork</a></p>\n\n      <h4>工具栏按钮说明</h4>\n      <ul>\n        <li><i class="fas fa-bell"></i> <b>习题提醒</b>：切换是否在新习题出现时显示通知提示（蓝色=开启）。</li>\n        <li><i class="fas fa-file-powerpoint"></i> <b>课件浏览</b>：查看课件与题目页面。</li>\n        <li><i class="fas fa-robot"></i> <b>AI 解答</b>：向 AI 询问当前题目并显示建议答案。</li>\n        <li><i class="fas fa-magic-wand-sparkles"></i> <b>自动作答</b>：切换自动作答（蓝色=开启）。</li>\n        <li><i class="fas fa-cog"></i> <b>设置</b>：配置 API 密钥与自动作答参数。</li>\n        <li><i class="fas fa-question-circle"></i> <b>使用教程</b>：显示/隐藏当前教程页面。</li>\n      </ul>\n\n      <h4>自动作答</h4>\n      <ul>\n        <li>在设置中开启自动作答并配置延迟/随机延迟。</li>\n        <li>需要配置 <del>DeepSeek API</del> Kimi API 密钥。</li>\n        <li>答案来自 AI，结果仅供参考。</li>\n      </ul>\n\n      <h4>AI 解答</h4>\n      <ol>\n        <li>点击设置（<i class="fas fa-cog"></i>）填入 API Key。</li>\n        <li>点击 AI 解答（<i class="fas fa-robot"></i>）后会对“当前题目/最近遇到的题目”询问并解析。</li>\n      </ol>\n\n      <h4>注意事项</h4>\n      <p>1) 仅供学习参考，请独立思考；</p>\n      <p>2) 合理使用 API 额度；</p>\n      <p>3) 答案不保证 100% 正确；</p>\n      <p>4) 自动作答有一定风险，谨慎开启。</p>\n\n      <h4>联系方式</h4>\n      <ul>\n        <li>请在Github issue提出问题</li>\n      </ul>\n    </div>\n  </div>\n</div>\n';
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
      gm.notify({
        title: "雨课堂习题提示",
        text: this.getProblemDetail(problem),
        image: slide?.thumbnail || null,
        timeout: 5e3
      });
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
  // 内部自动答题处理函数
    async function handleAutoAnswerInternal(problem) {
    const status = repo.problemStatus.get(problem.problemId);
    if (!status || status.answering || problem.result) return;
    if (Date.now() >= status.endTime) return;
    try {
      let aiAnswer, parsed;
      // 优先使用文本模式，如果没有题干则使用Vision模式
            if (problem.body && problem.body.trim()) {
        const q = formatProblemForAI(problem, PROBLEM_TYPE_MAP);
        aiAnswer = await queryKimi(q, ui.config.ai);
        parsed = parseAIAnswer(problem, aiAnswer);
      }
      // 如果文本模式失败或没有题干，尝试Vision模式
            if (!parsed) {
        const {captureProblemForVision: captureProblemForVision} = await Promise.resolve().then(function() {
          return screenshoot;
        });
        const {queryKimiVision: queryKimiVision} = await Promise.resolve().then(function() {
          return kimi;
        });
        const imageBase64 = await captureProblemForVision();
        if (imageBase64) {
          const textPrompt = problem.body ? `请结合题目信息分析图片：\n${formatProblemForAI(problem, PROBLEM_TYPE_MAP)}` : "请分析图片中的题目并给出答案";
          aiAnswer = await queryKimiVision(imageBase64, textPrompt, ui.config.ai);
          parsed = parseAIAnswer(problem, aiAnswer);
        }
      }
      if (!parsed) return ui.toast("无法解析AI答案，跳过自动作答", 2e3);
      await submitAnswer(problem, parsed);
      actions.onAnswerProblem(problem.problemId, parsed);
      ui.toast(`自动作答完成: ${String(problem.body || "").slice(0, 30)}...`, 3e3);
      showAutoAnswerPopup(problem, typeof aiAnswer === "string" ? aiAnswer : JSON.stringify(aiAnswer, null, 2));
    } catch (e) {
      console.error("[AutoAnswer] failed", e);
      ui.toast(`自动作答失败: ${e.message}`, 3e3);
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
      if (!problem || !slide) return;
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
      if (Date.now() > status.endTime || problem.result) return;
      // toast + 通知
            if (ui.config.notifyProblems) ui.notifyProblem(problem, slide);
      // 自动作答
            if (ui.config.autoAnswer) {
        const delay = ui.config.autoAnswerDelay + randInt(0, ui.config.autoAnswerRandomDelay);
        status.autoAnswerTime = Date.now() + delay;
        ui.toast(`将在 ${Math.floor(delay / 1e3)} 秒后自动作答本题`, 3e3);
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
    // 定时器驱动（由 index.js 安装）
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
    //1.16.4: 进入课堂：设置 lessonId +（可选）写入 Tab 信息 + 载入本课已存课件
    launchLessonHelper() {
      // 从 URL 提取 lessonId（/lesson/fullscreen/v3/<lessonId>/...）
      const path = window.location.pathname;
      const m = path.match(/\/lesson\/fullscreen\/v3\/([^/]+)/);
      repo.currentLessonId = m ? m[1] : null;
      if (repo.currentLessonId) console.log(`[雨课堂助手] 检测到课堂页面 lessonId: ${repo.currentLessonId}`);
      // GM_* Tab 状态（存在才用，向后兼容）
            if (typeof window.GM_getTab === "function" && typeof window.GM_saveTab === "function" && repo.currentLessonId) window.GM_getTab(tab => {
        tab.type = "lesson";
        tab.lessonId = repo.currentLessonId;
        window.GM_saveTab(tab);
      });
      // 载入"本课"的历史课件
            repo.loadStoredPresentations();
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
  var css = '/* ===== 通用 & 修复 ===== */\n#watermark_layer { display: none !important; visibility: hidden !important; }\n.hidden { display: none !important; }\n\n:root{\n  --ykt-z: 10000000;\n  --ykt-border: #ddd;\n  --ykt-border-strong: #ccc;\n  --ykt-bg: #fff;\n  --ykt-fg: #222;\n  --ykt-muted: #607190;\n  --ykt-accent: #1d63df;\n  --ykt-hover: #1e3050;\n  --ykt-shadow: 0 10px 30px rgba(0,0,0,.18);\n}\n\n/* ===== 工具栏 ===== */\n#ykt-helper-toolbar{\n  position: fixed; z-index: calc(var(--ykt-z) + 1);\n  left: 15px; bottom: 15px;\n  /* 移除固定宽度，让内容自适应 */\n  height: 36px; padding: 5px;\n  display: flex; gap: 6px; align-items: center;\n  background: var(--ykt-bg);\n  border: 1px solid var(--ykt-border-strong);\n  border-radius: 4px;\n  box-shadow: 0 1px 4px 3px rgba(0,0,0,.1);\n}\n\n#ykt-helper-toolbar .btn{\n  display: inline-block; padding: 4px; cursor: pointer;\n  color: var(--ykt-muted); line-height: 1;\n}\n#ykt-helper-toolbar .btn:hover{ color: var(--ykt-hover); }\n#ykt-helper-toolbar .btn.active{ color: var(--ykt-accent); }\n\n/* ===== 面板通用样式 ===== */\n.ykt-panel{\n  position: fixed; right: 20px; bottom: 60px;\n  width: 560px; max-height: 72vh; overflow: auto;\n  background: var(--ykt-bg); color: var(--ykt-fg);\n  border: 1px solid var(--ykt-border-strong); border-radius: 8px;\n  box-shadow: var(--ykt-shadow);\n  display: none; \n  /* 提高z-index，确保后打开的面板在最上层 */\n  z-index: var(--ykt-z);\n}\n.ykt-panel.visible{ \n  display: block; \n  /* 动态提升z-index */\n  z-index: calc(var(--ykt-z) + 10);\n}\n\n.panel-header{\n  display: flex; align-items: center; justify-content: space-between;\n  gap: 12px; padding: 10px 12px; border-bottom: 1px solid var(--ykt-border);\n}\n.panel-header h3{ margin: 0; font-size: 16px; font-weight: 600; }\n.panel-body{ padding: 10px 12px; }\n.close-btn{ cursor: pointer; color: var(--ykt-muted); }\n.close-btn:hover{ color: var(--ykt-hover); }\n\n/* ===== 设置面板 (#ykt-settings-panel) ===== */\n#ykt-settings-panel .settings-content{ display: flex; flex-direction: column; gap: 14px; }\n#ykt-settings-panel .setting-group{ border: 1px dashed var(--ykt-border); border-radius: 6px; padding: 10px; }\n#ykt-settings-panel .setting-group h4{ margin: 0 0 8px 0; font-size: 14px; }\n#ykt-settings-panel .setting-item{ display: flex; align-items: center; gap: 8px; margin: 8px 0; flex-wrap: wrap; }\n#ykt-settings-panel label{ font-size: 13px; }\n#ykt-settings-panel input[type="text"],\n#ykt-settings-panel input[type="number"]{\n  height: 30px; border: 1px solid var(--ykt-border-strong);\n  border-radius: 4px; padding: 0 8px; min-width: 220px;\n}\n#ykt-settings-panel small{ color: #666; }\n#ykt-settings-panel .setting-actions{ display: flex; gap: 8px; margin-top: 6px; }\n#ykt-settings-panel button{\n  height: 30px; padding: 0 12px; border-radius: 6px;\n  border: 1px solid var(--ykt-border-strong); background: #f7f8fa; cursor: pointer;\n}\n#ykt-settings-panel button:hover{ background: #eef3ff; border-color: var(--ykt-accent); }\n\n/* 自定义复选框（与手写脚本一致的视觉语义） */\n#ykt-settings-panel .checkbox-label{ position: relative; padding-left: 26px; cursor: pointer; user-select: none; }\n#ykt-settings-panel .checkbox-label input{ position: absolute; opacity: 0; cursor: pointer; height: 0; width: 0; }\n#ykt-settings-panel .checkbox-label .checkmark{\n  position: absolute; left: 0; top: 50%; transform: translateY(-50%);\n  height: 16px; width: 16px; border:1px solid var(--ykt-border-strong); border-radius: 3px; background: #fff;\n}\n#ykt-settings-panel .checkbox-label input:checked ~ .checkmark{\n  background: var(--ykt-accent); border-color: var(--ykt-accent);\n}\n#ykt-settings-panel .checkbox-label .checkmark:after{\n  content: ""; position: absolute; display: none;\n  left: 5px; top: 1px; width: 4px; height: 8px; border: solid #fff; border-width: 0 2px 2px 0; transform: rotate(45deg);\n}\n#ykt-settings-panel .checkbox-label input:checked ~ .checkmark:after{ display: block; }\n\n/* ===== AI 解答面板 (#ykt-ai-answer-panel) ===== */\n#ykt-ai-answer-panel .ai-question{\n  white-space: pre-wrap; background: #fafafa; border: 1px solid var(--ykt-border);\n  padding: 8px; border-radius: 6px; margin-bottom: 8px; max-height: 160px; overflow: auto;\n}\n#ykt-ai-answer-panel .ai-loading{ color: var(--ykt-accent); margin-bottom: 6px; }\n#ykt-ai-answer-panel .ai-error{ color: #b00020; margin-bottom: 6px; }\n#ykt-ai-answer-panel .ai-answer{ white-space: pre-wrap; margin-top: 4px; }\n#ykt-ai-answer-panel .ai-actions{ margin-top: 10px; }\n#ykt-ai-answer-panel .ai-actions button{\n  height: 30px; padding: 0 12px; border-radius: 6px;\n  border: 1px solid var(--ykt-border-strong); background: #f7f8fa; cursor: pointer;\n}\n#ykt-ai-answer-panel .ai-actions button:hover{ background: #eef3ff; border-color: var(--ykt-accent); }\n\n/* ===== 课件浏览面板 (#ykt-presentation-panel) ===== */\n#ykt-presentation-panel{ width: 900px; }\n#ykt-presentation-panel .panel-controls{ display: flex; align-items: center; gap: 8px; }\n#ykt-presentation-panel .panel-body{\n  display: grid; grid-template-columns: 300px 1fr; gap: 10px;\n}\n#ykt-presentation-panel .presentation-title{\n  font-weight: 600; padding: 6px 0; border-bottom: 1px solid var(--ykt-border);\n}\n#ykt-presentation-panel .slide-thumb-list{ display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 8px; }\n#ykt-presentation-panel .slide-thumb{\n  border: 1px solid var(--ykt-border); border-radius: 6px; background: #fafafa;\n  min-height: 60px; display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 4px; text-align: center;\n}\n#ykt-presentation-panel .slide-thumb:hover{ border-color: var(--ykt-accent); background: #eef3ff; }\n#ykt-presentation-panel .slide-thumb img{ max-width: 100%; max-height: 120px; object-fit: contain; display: block; }\n\n#ykt-presentation-panel .slide-view{\n  position: relative; border: 1px solid var(--ykt-border); border-radius: 8px; min-height: 360px; background: #fff; overflow: hidden;\n}\n#ykt-presentation-panel .slide-cover{ display: flex; align-items: center; justify-content: center; min-height: 360px; }\n#ykt-presentation-panel .slide-cover img{ max-width: 100%; max-height: 100%; object-fit: contain; display: block; }\n\n#ykt-presentation-panel .problem-box{\n  position: absolute; left: 12px; right: 12px; bottom: 12px;\n  background: rgba(255,255,255,.96); border: 1px solid var(--ykt-border);\n  border-radius: 8px; padding: 10px; box-shadow: 0 6px 18px rgba(0,0,0,.12);\n}\n#ykt-presentation-panel .problem-head{ font-weight: 600; margin-bottom: 6px; }\n#ykt-presentation-panel .problem-options{ display: grid; grid-template-columns: 1fr; gap: 4px; }\n#ykt-presentation-panel .problem-option{ padding: 6px 8px; border: 1px solid var(--ykt-border); border-radius: 6px; background: #fafafa; }\n\n/* ===== 题目列表面板 (#ykt-problem-list-panel) ===== */\n#ykt-problem-list{ display: flex; flex-direction: column; gap: 10px; }\n#ykt-problem-list .problem-row{\n  border: 1px solid var(--ykt-border); border-radius: 8px; padding: 8px; background: #fafafa;\n}\n#ykt-problem-list .problem-title{ font-weight: 600; margin-bottom: 4px; }\n#ykt-problem-list .problem-meta{ color: #666; font-size: 12px; margin-bottom: 6px; }\n#ykt-problem-list .problem-actions{ display: flex; gap: 8px; align-items: center; }\n#ykt-problem-list .problem-actions button{\n  height: 28px; padding: 0 10px; border-radius: 6px; border: 1px solid var(--ykt-border-strong); background: #f7f8fa; cursor: pointer;\n}\n#ykt-problem-list .problem-actions button:hover{ background: #eef3ff; border-color: var(--ykt-accent); }\n#ykt-problem-list .problem-done{ color: #0a7a2f; font-weight: 600; }\n\n/* ===== 活动题目列表（右下角小卡片） ===== */\n#ykt-active-problems-panel.ykt-active-wrapper{\n  position: fixed; right: 20px; bottom: 60px; z-index: var(--ykt-z);\n}\n#ykt-active-problems{ display: flex; flex-direction: column; gap: 8px; max-height: 60vh; overflow: auto; }\n#ykt-active-problems .active-problem-card{\n  width: 320px; background: #fff; border: 1px solid var(--ykt-border);\n  border-radius: 8px; box-shadow: var(--ykt-shadow); padding: 10px;\n}\n#ykt-active-problems .ap-title{ font-weight: 600; margin-bottom: 4px; }\n#ykt-active-problems .ap-info{ color: #666; font-size: 12px; margin-bottom: 8px; }\n#ykt-active-problems .ap-actions{ display: flex; gap: 8px; }\n#ykt-active-problems .ap-actions button{\n  height: 28px; padding: 0 10px; border-radius: 6px; border: 1px solid var(--ykt-border-strong); background: #f7f8fa; cursor: pointer;\n}\n#ykt-active-problems .ap-actions button:hover{ background: #eef3ff; border-color: var(--ykt-accent); }\n\n/* ===== 教程面板 (#ykt-tutorial-panel) ===== */\n#ykt-tutorial-panel .tutorial-content h4{ margin: 8px 0 6px; }\n#ykt-tutorial-panel .tutorial-content p,\n#ykt-tutorial-panel .tutorial-content li{ line-height: 1.5; }\n#ykt-tutorial-panel .tutorial-content a{ color: var(--ykt-accent); text-decoration: none; }\n#ykt-tutorial-panel .tutorial-content a:hover{ text-decoration: underline; }\n\n/* ===== 小屏适配 ===== */\n@media (max-width: 1200px){\n  #ykt-presentation-panel{ width: 760px; }\n  #ykt-presentation-panel .panel-body{ grid-template-columns: 260px 1fr; }\n}\n@media (max-width: 900px){\n  .ykt-panel{ right: 12px; left: 12px; width: auto; }\n  #ykt-presentation-panel{ width: auto; }\n  #ykt-presentation-panel .panel-body{ grid-template-columns: 1fr; }\n}\n\n/* ===== 自动作答成功弹窗 ===== */\n.auto-answer-popup{\n  position: fixed; inset: 0; z-index: calc(var(--ykt-z) + 2);\n  background: rgba(0,0,0,.2);\n  display: flex; align-items: flex-end; justify-content: flex-end;\n  opacity: 0; transition: opacity .18s ease;\n}\n.auto-answer-popup.visible{ opacity: 1; }\n\n.auto-answer-popup .popup-content{\n  width: min(560px, 96vw);\n  background: #fff; border: 1px solid var(--ykt-border-strong);\n  border-radius: 10px; box-shadow: var(--ykt-shadow);\n  margin: 16px; overflow: hidden;\n}\n\n.auto-answer-popup .popup-header{\n  display: flex; align-items: center; justify-content: space-between;\n  gap: 12px; padding: 10px 12px; border-bottom: 1px solid var(--ykt-border);\n}\n.auto-answer-popup .popup-header h4{ margin: 0; font-size: 16px; }\n.auto-answer-popup .close-btn{ cursor: pointer; color: var(--ykt-muted); }\n.auto-answer-popup .close-btn:hover{ color: var(--ykt-hover); }\n\n.auto-answer-popup .popup-body{ padding: 10px 12px; display: flex; flex-direction: column; gap: 10px; }\n.auto-answer-popup .popup-row{ display: grid; grid-template-columns: 56px 1fr; gap: 8px; align-items: start; }\n.auto-answer-popup .label{ color: #666; font-size: 12px; line-height: 1.8; }\n.auto-answer-popup .content{ white-space: normal; word-break: break-word; }\n\n/* ===== 1.16.6: 课件浏览面板：固定右侧详细视图，左侧独立滚动 ===== */\n#ykt-presentation-panel {\n  --ykt-panel-max-h: 72vh;           /* 与 .ykt-panel 的最大高度保持一致 */\n}\n\n/* 两列布局：左列表 + 右详细视图 */\n#ykt-presentation-panel .panel-body{\n  display: grid;\n  grid-template-columns: 300px 1fr;  /* 左列宽度可按需调整 */\n  gap: 12px;\n  overflow: hidden;                  /* 避免内部再出现双滚动条 */\n  align-items: start;\n}\n\n/* 左侧：只让左列滚动，限制在面板可视高度内 */\n#ykt-presentation-panel .panel-left{\n  max-height: var(--ykt-panel-max-h);\n  overflow: auto;\n  min-width: 0;                      /* 防止子元素撑破 */\n}\n\n/* 右侧：粘性定位为“固定”，始终在面板可视区内 */\n#ykt-presentation-panel .panel-right{\n  position: sticky;\n  top: 0;                            /* 相对可滚动祖先（面板）吸顶 */\n  align-self: start;\n}\n\n/* 右侧详细视图自身也限制高度并允许内部滚动 */\n#ykt-presentation-panel .slide-view{\n  max-height: var(--ykt-panel-max-h);\n  overflow: auto;\n  border: 1px solid var(--ykt-border);\n  border-radius: 8px;\n  background: #fff;\n}\n\n/* 小屏自适配：堆叠布局时取消 sticky，避免遮挡 */\n@media (max-width: 900px){\n  #ykt-presentation-panel .panel-body{\n    grid-template-columns: 1fr;\n  }\n  #ykt-presentation-panel .panel-right{\n    position: static;\n  }\n}\n';
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
