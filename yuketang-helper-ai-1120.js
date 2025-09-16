// ==UserScript==
// @name         AI雨课堂助手
// @version      1.12.0
// @namespace    https://github.com/ZaytsevZY/yuketang-helper-ai
// @author       ZaytsevZY/
// @description  雨课堂辅助工具：课堂习题提示，AI解答习题
// @license MIT
// @icon         https://www.google.com/s2/favicons?sz=64&domain=yuketang.cn
// @match        https://*.yuketang.cn/lesson/fullscreen/v3/*
// @match        https://*.yuketang.cn/v2/web/*
// @grant        GM_addStyle
// @grant        GM_notification
// @grant        GM_xmlhttpRequest
// @grant        GM_getTab
// @grant        GM_getTabs
// @grant        GM_saveTab
// @grant        GM_openInTab
// @grant        unsafeWindow
// @run-at       document-start
// @require      https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js
// ==/UserScript==

// 感谢hotwords123前辈制作的雨课堂助手。本助手基于本仓库修改：https://github.com/hotwords123/yuketang-helper

(function() {
    'use strict';

    // 存储课件和问题数据
    let presentations = new Map(); // 存储课件
    let slides = new Map(); // 存储幻灯片
    let problems = new Map(); // 存储问题
    let problemStatus = new Map(); // 存储问题状态
    let encounteredProblems = []; // 用于列表展示的问题

    // 当前选中的内容
    let currentPresentationId = null;
    let currentSlideId = null;

    // 存储管理类
    class StorageManager {
        constructor(prefix) {
            this.prefix = prefix;
        }

        get(key, defaultValue = null) {
            let value = localStorage.getItem(this.prefix + key);
            if (value) {
                try {
                    return JSON.parse(value);
                } catch (err) {
                    console.error(err);
                }
            }
            return defaultValue;
        }

        set(key, value) {
            localStorage.setItem(this.prefix + key, JSON.stringify(value));
        }

        remove(key) {
            localStorage.removeItem(this.prefix + key);
        }

        getMap(key) {
            try {
                return new Map(this.get(key, []));
            } catch (err) {
                console.error(err);
                return new Map();
            }
        }

        setMap(key, map) {
            this.set(key, [...map]);
        }

        alterMap(key, callback) {
            const map = this.getMap(key);
            callback(map);
            this.setMap(key, map);
        }
    }

    // 初始化存储管理器
    const storage = new StorageManager("ykt-helper:");

    // 问题类型映射
    const PROBLEM_TYPE_MAP = {
        1: "单选题",
        2: "多选题",
        3: "投票题",
        4: "填空题",
        5: "主观题"
    };

    // 默认配置
    const DEFAULT_CONFIG = {
        notifyProblems: true,
        autoAnswer: false,
        ai: {
            provider: 'deepseek',
            apiKey: storage.get('aiApiKey', ''),
            endpoint: 'https://api.deepseek.com/v1/chat/completions',
            model: 'deepseek-chat',
            temperature: 0.3,
            maxTokens: 1000
        },
        showAllSlides: false,
        maxPresentations: 5
    };

    // 读取配置
    const config = {
        ...DEFAULT_CONFIG,
        ...storage.get("config", {})
    };

    // 保存配置
    function saveConfig() {
        storage.set("config", config);
    }

    // 计算随机间隔时间
    function randInt(l, r) {
        return l + Math.floor(Math.random() * (r - l + 1));
    }

    // 计算幻灯片样式
    function coverStyle(presentation) {
        if (!presentation) return {};
        const { width, height } = presentation;
        return { aspectRatio: width + "/" + height };
    }

    // Load Font Awesome
    function loadFontAwesome() {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
        document.head.appendChild(link);
    }

    // Load jsPDF
    function loadJsPDF() {
        return new Promise((resolve) => {
            if (typeof jspdf !== 'undefined') {
                resolve(jspdf);
                return;
            }

            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
            script.onload = () => resolve(window.jspdf);
            document.head.appendChild(script);
        });
    }

    // Load html2canvas for screenshots
    function loadHtml2Canvas() {
        return new Promise((resolve) => {
            if (typeof html2canvas !== 'undefined') {
                resolve();
                return;
            }

            const script = document.createElement('script');
            script.src = 'https://html2canvas.hertzen.com/dist/html2canvas.min.js';
            script.onload = resolve;
            document.head.appendChild(script);
        });
    }

    // Load dependencies
    loadFontAwesome();
    loadHtml2Canvas();
    loadJsPDF();

    // 捕获题目截图
    async function captureProblemScreenshot() {
        try {
            // 确保html2canvas已加载
            await loadHtml2Canvas();

            // 查找题目区域元素 (根据雨课堂DOM结构调整选择器)
            const problemElement = document.querySelector('.ques-title') ||
                                   document.querySelector('.problem-body') ||
                                   document.querySelector('.ppt-inner') ||
                                   document.querySelector('.ppt-courseware-inner');

            if (!problemElement) {
                // 如果找不到特定元素，就截取整个可见区域
                return await html2canvas(document.body);
            }

            // 截取题目区域
            return await html2canvas(problemElement);
        } catch (error) {
            console.error('[雨课堂助手] 截图失败:', error);
            return null;
        }
    }

    // 拦截WebSocket通信
    function interceptWebSockets() {
        console.log("[雨课堂助手] 拦截WebSocket通信");
        const originalWebSocket = unsafeWindow.WebSocket;

        unsafeWindow.WebSocket = function(url, protocols) {
            const ws = new originalWebSocket(url, protocols);

            // 如果是雨课堂的WebSocket连接
            if (url.includes("wsapp")) {
                console.log("[雨课堂助手] 检测到雨课堂WebSocket连接");

                // 监听接收消息
                ws.addEventListener('message', function(event) {
                    try {
                        const data = JSON.parse(event.data);

                        // 解析题目信息
                        if (data.op === "unlockproblem") {
                            console.log("[雨课堂助手] 检测到新题目", data.problem);
                            handleProblemUnlocked(data.problem);
                        } else if (data.op === "fetchtimeline") {
                            // 解析timeline中的题目
                            if (data.timeline) {
                                for (const item of data.timeline) {
                                    if (item.type === "problem") {
                                        console.log("[雨课堂助手] 从timeline中检测到题目", item);
                                        handleProblemUnlocked(item);
                                    }
                                }
                            }
                        } else if (data.op === "lessonfinished") {
                            // 课程结束
                            if (typeof GM_notification === 'function') {
                                GM_notification({
                                    title: "下课提示",
                                    text: "当前课程已结束",
                                    timeout: 5000
                                });
                            }
                        }
                    } catch (e) {
                        // 忽略解析错误
                        console.error("[雨课堂助手] 解析WebSocket消息失败", e);
                    }
                });
            }

            return ws;
        };

        // 复制原始WebSocket的属性
        unsafeWindow.WebSocket.prototype = originalWebSocket.prototype;
        unsafeWindow.WebSocket.CLOSED = originalWebSocket.CLOSED;
        unsafeWindow.WebSocket.CLOSING = originalWebSocket.CLOSING;
        unsafeWindow.WebSocket.CONNECTING = originalWebSocket.CONNECTING;
        unsafeWindow.WebSocket.OPEN = originalWebSocket.OPEN;
    }

    // 拦截XMLHttpRequest
    function interceptXHR() {
        console.log("[雨课堂助手] 拦截XMLHttpRequest");
        const originalXHR = unsafeWindow.XMLHttpRequest;

        unsafeWindow.XMLHttpRequest = function() {
            const xhr = new originalXHR();

            const originalOpen = xhr.open;
            xhr.open = function(method, url) {
                // 检测题目信息请求
                if (url.includes("/api/v3/lesson/presentation/fetch")) {
                    xhr.addEventListener('load', function() {
                        try {
                            const response = JSON.parse(xhr.responseText);
                            if (response.code === 0) {
                                const presentationId = new URL(url, window.location.href).searchParams.get("presentation_id");
                                console.log("[雨课堂助手] 获取到课件信息", presentationId);
                                onPresentationLoaded(presentationId, response.data);
                            }
                        } catch (e) {
                            console.error("[雨课堂助手] 解析XHR响应失败", e);
                        }
                    });
                }
                else if (url.includes("/api/v3/lesson/problem") || url.includes("/presentation/fetch")) {
                    xhr.addEventListener('load', function() {
                        try {
                            const response = JSON.parse(xhr.responseText);
                            if (response.data && response.data.problem) {
                                console.log("[雨课堂助手] XHR获取到题目信息", response.data.problem);
                                enhanceProblemInfo(response.data.problem);
                            }
                        } catch (e) {
                            console.error("[雨课堂助手] 解析XHR响应失败", e);
                        }
                    });
                }
                else if (url.includes("/api/v3/lesson/problem/answer")) {
                    xhr.addEventListener('load', function() {
                        try {
                            const response = JSON.parse(xhr.responseText);
                            const payload = JSON.parse(this._requestPayload || "{}");
                            if (response.code === 0 && payload.problemId) {
                                onAnswerProblem(payload.problemId, payload.result);
                            }
                        } catch (e) {
                            console.error("[雨课堂助手] 解析XHR响应失败", e);
                        }
                    });
                }

                const originalSend = xhr.send;
                xhr.send = function(body) {
                    if (url.includes("/api/v3/lesson/problem/answer") && body) {
                        try {
                            xhr._requestPayload = body;
                        } catch (e) {
                            console.error("[雨课堂助手] 保存请求数据失败", e);
                        }
                    }
                    return originalSend.apply(this, arguments);
                };

                return originalOpen.apply(this, arguments);
            };

            return xhr;
        };

        // 复制原始XHR的属性
        unsafeWindow.XMLHttpRequest.prototype = originalXHR.prototype;
    }

    // 处理课件加载
    function onPresentationLoaded(id, data) {
        const presentation = { id, ...data };
        presentations.set(id, presentation);

        for (const slide of presentation.slides) {
            slides.set(slide.id, slide);
            const problem = slide.problem;
            if (problem) {
                problems.set(problem.problemId, problem);

                // 如果encounteredProblems中没有这个问题，添加它
                if (!encounteredProblems.some(p => p.problemId === problem.problemId)) {
                    encounteredProblems.push({
                        problemId: problem.problemId,
                        problemType: problem.problemType,
                        body: problem.body || `题目ID: ${problem.problemId}`,
                        options: problem.options || [],
                        blanks: problem.blanks || [],
                        answers: problem.answers || [],
                        // 关联幻灯片和课件信息
                        slide: slide,
                        presentationId: id
                    });
                }
            }
        }

        // 存储课件数据到本地存储
        storage.alterMap("presentations", (map) => {
            map.set(id, data);
            const excess = map.size - config.maxPresentations;
            if (excess > 0) {
                const keys = [...map.keys()].slice(0, excess);
                for (const key of keys) {
                    map.delete(key);
                }
            }
        });

        // 更新UI
        updatePresentationList();
    }

    // 增强问题信息
    async function enhanceProblemInfo(problem) {
        if (!problem || !problem.problemId) return;

        // 更新问题信息
        problems.set(problem.problemId, problem);

        // 检查是否已经在列表中
        const existingIndex = encounteredProblems.findIndex(p => p.problemId === problem.problemId);

        if (existingIndex === -1) {
            // 新问题，添加到列表
            encounteredProblems.push({
                problemId: problem.problemId,
                problemType: problem.problemType,
                body: problem.body || `题目ID: ${problem.problemId}`,
                options: problem.options || [],
                blanks: problem.blanks || [],
                answers: problem.answers || [],
                // 尝试查找关联的幻灯片
                presentationId: null,
                slide: null,
                screenshot: null,
                screenshotTime: Date.now()
            });

            // 尝试查找关联的幻灯片
            for (const [slideId, slide] of slides.entries()) {
                if (slide.problem && slide.problem.problemId === problem.problemId) {
                    const problemIndex = encounteredProblems.length - 1;
                    encounteredProblems[problemIndex].slide = slide;
                    // 查找幻灯片所属的课件
                    for (const [presId, presentation] of presentations.entries()) {
                        if (presentation.slides.some(s => s.id === slideId)) {
                            encounteredProblems[problemIndex].presentationId = presId;
                            break;
                        }
                    }
                    break;
                }
            }
        } else {
            // 更新现有问题信息
            encounteredProblems[existingIndex] = {
                ...encounteredProblems[existingIndex],
                problemType: problem.problemType,
                body: problem.body || encounteredProblems[existingIndex].body,
                options: problem.options || encounteredProblems[existingIndex].options,
                blanks: problem.blanks || encounteredProblems[existingIndex].blanks,
                answers: problem.answers || encounteredProblems[existingIndex].answers
            };
        }

        // 尝试捕获屏幕截图 (如果未关联幻灯片截图)
        const problemIndex = existingIndex === -1 ? encounteredProblems.length - 1 : existingIndex;
        if (!encounteredProblems[problemIndex].slide) {
            setTimeout(async () => {
                const canvas = await captureProblemScreenshot();
                if (canvas) {
                    // 将canvas转为图片数据URL
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.7); // 使用JPEG并压缩以减小大小
                    encounteredProblems[problemIndex].screenshot = dataUrl;
                }
            }, 1000);
        }

        // 更新UI
        updateProblemList();
    }

    // 处理题目作答
    function onAnswerProblem(problemId, result) {
        const problem = problems.get(problemId);
        if (problem) {
            problem.result = result;

            // 更新encounteredProblems中的信息
            const index = encounteredProblems.findIndex(p => p.problemId === problemId);
            if (index !== -1) {
                encounteredProblems[index].result = result;
            }

            // 更新UI
            updateProblemList();
        }
    }

    // 处理新题目
    function handleProblemUnlocked(problemData) {
        if (!problemData || !problemData.prob) return;

        const problem = problems.get(problemData.prob);
        const slide = slides.get(problemData.sid);

        if (!slide || !problem) {
            console.log("[雨课堂助手] 题目或幻灯片信息不完整", problemData);
            return;
        }

        // 更新问题状态
        const status = {
            presentationId: problemData.pres,
            slideId: problemData.sid,
            startTime: problemData.dt,
            endTime: problemData.dt + 1000 * problemData.limit,
            done: !!problem.result,
            answering: false
        };

        problemStatus.set(problemData.prob, status);

        // 如果问题已经截止，不需要进一步处理
        if (Date.now() > status.endTime) return;

        // 如果问题已经回答，不需要进一步处理
        if (problem.result) return;

        // 显示通知
        if (config.notifyProblems) {
            notifyProblem(problem, slide);
        }

        // 更新UI
        updateActiveProblems();
    }

    // 显示问题通知
    function notifyProblem(problem, slide) {
        if (typeof GM_notification !== 'function') return;

        GM_notification({
            title: "雨课堂习题提示",
            text: getProblemDetail(problem),
            image: slide ? slide.thumbnail : null,
            timeout: 5000
        });
    }

    // 获取问题详情文本
    function getProblemDetail(problem) {
        if (!problem) {
            return "题目未找到";
        }
        const lines = [problem.body];
        if (Array.isArray(problem.options)) {
            lines.push(...problem.options.map(({ key, value }) => `${key}. ${value}`));
        }
        return lines.join("\n");
    }

    // 格式化问题为AI查询
    function formatProblemForAI(problem) {
        if (!problem) return '';

        let formattedQuestion = `题目类型：${PROBLEM_TYPE_MAP[problem.problemType] || '未知'}\n题目：${problem.body || ""}`;

        // 添加选项
        if (problem.options && problem.options.length > 0) {
            formattedQuestion += "\n选项：";
            problem.options.forEach(option => {
                formattedQuestion += `\n${option.key}. ${option.value}`;
            });
        }

        return formattedQuestion;
    }

    // 显示简单的通知Toast
    function showToast(message, duration = 2000) {
        const toast = document.createElement('div');
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0, 0, 0, 0.7);
            color: white;
            padding: 10px 20px;
            border-radius: 4px;
            z-index: 10000000;
            max-width: 80%;
        `;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.5s';
            setTimeout(() => toast.remove(), 500);
        }, duration);
    }

    // 向DeepSeek API发送请求
    async function queryDeepSeek(question) {
        const apiKey = config.ai.apiKey;

        if (!apiKey || apiKey === '') {
            throw new Error('请先设置API密钥');
        }

        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: config.ai.endpoint,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                data: JSON.stringify({
                    model: config.ai.model,
                    messages: [
                        {
                            role: 'system',
                            content: '你是一个专业学习助手，你的任务是帮助回答雨课堂中的题目。请直接给出答案并简要解释。'
                        },
                        {
                            role: 'user',
                            content: question
                        }
                    ],
                    temperature: config.ai.temperature,
                    max_tokens: config.ai.maxTokens
                }),
                onload: function(response) {
                    try {
                        const data = JSON.parse(response.responseText);
                        if (data.error) {
                            reject(new Error(`API错误: ${data.error.message}`));
                        } else if (data.choices && data.choices[0]) {
                            resolve(data.choices[0].message.content);
                        } else {
                            reject(new Error('API返回结果格式异常'));
                        }
                    } catch (e) {
                        reject(new Error(`解析API响应失败: ${e.message}`));
                    }
                },
                onerror: function(error) {
                    reject(new Error(`请求失败: ${error.statusText}`));
                }
            });
        });
    }

    // 创建AI回答面板
    function createAIAnswerPanel() {
        const panel = document.createElement('div');
        panel.id = 'ykt-ai-answer-panel';
        panel.innerHTML = `
            <div id="ykt-ai-error" style="display: none;"></div>
            <div id="ykt-ai-question"></div>
            <div id="ykt-ai-loading" style="display: none;">
                <i class="fas fa-circle-notch fa-spin"></i> 正在思考中...
            </div>
            <div id="ykt-ai-answer"></div>
        `;
        document.body.appendChild(panel);
        return panel;
    }

    // 创建课件浏览面板
    function createPresentationPanel() {
        const panel = document.createElement('div');
        panel.id = 'ykt-presentation-panel';
        panel.innerHTML = `
            <div class="panel-header">
                <h3>课件浏览</h3>
                <div class="panel-controls">
                    <label>
                        <input type="checkbox" id="ykt-show-all-slides"> 切换全部页面/问题页面
                    </label>
                    <span class="close-btn"><i class="fas fa-times"></i></span>
                </div>
            </div>
            <div class="panel-body">
                <div class="panel-left">
                    <div id="ykt-presentation-list" class="presentation-list"></div>
                </div>
                <div class="panel-right">
                    <div id="ykt-slide-view" class="slide-view">
                        <div class="slide-cover">
                            <div class="empty-message">选择左侧的幻灯片查看详情</div>
                        </div>
                        <div id="ykt-problem-view" class="problem-view"></div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(panel);

        // 添加关闭按钮功能
        panel.querySelector('.close-btn').addEventListener('click', () => {
            showPresentationPanel(false);
        });

        // 显示全部幻灯片切换
        const checkbox = panel.querySelector('#ykt-show-all-slides');
        checkbox.checked = config.showAllSlides;
        checkbox.addEventListener('change', () => {
            config.showAllSlides = checkbox.checked;
            saveConfig();
            updatePresentationList();
        });

        return panel;
    }

    // 创建问题列表面板
    function createProblemListPanel() {
        const panel = document.createElement('div');
        panel.id = 'ykt-problem-list-panel';
        panel.innerHTML = `
            <div class="panel-header">
                <h3>课堂习题列表</h3>
                <span class="close-btn"><i class="fas fa-times"></i></span>
            </div>
            <div class="panel-body">
                <div id="ykt-problem-list"></div>
            </div>
        `;
        document.body.appendChild(panel);

        // 添加关闭按钮功能
        panel.querySelector('.close-btn').addEventListener('click', () => {
            showProblemListPanel(false);
        });

        return panel;
    }

    // 创建活动问题面板
    function createActiveProblemsPanel() {
        const panel = document.createElement('div');
        panel.id = 'ykt-active-problems-panel';
        panel.innerHTML = `
            <div id="ykt-active-problems" class="active-problems"></div>
        `;
        document.body.appendChild(panel);
        return panel;
    }

    // 显示/隐藏AI面板
    function showAIPanel(show = true) {
        const panel = document.getElementById('ykt-ai-answer-panel');
        if (!panel) return;

        if (show) {
            panel.classList.add('visible');
        } else {
            panel.classList.remove('visible');
        }
    }

    // 显示/隐藏课件浏览面板
    function showPresentationPanel(show = true) {
        const panel = document.getElementById('ykt-presentation-panel');
        if (!panel) return;

        if (show) {
            updatePresentationList();
            panel.classList.add('visible');
        } else {
            panel.classList.remove('visible');
        }
    }

    // 显示/隐藏题目列表面板
    function showProblemListPanel(show = true) {
        const panel = document.getElementById('ykt-problem-list-panel');
        if (!panel) return;

        if (show) {
            updateProblemList();
            panel.classList.add('visible');
        } else {
            panel.classList.remove('visible');
        }
    }

    // 创建教程面板
function createTutorialPanel() {
    const panel = document.createElement('div');
    panel.id = 'ykt-tutorial-panel';
    panel.innerHTML = `
        <div class="panel-header">
            <h3>AI雨课堂助手使用教程</h3>
            <span class="close-btn"><i class="fas fa-times"></i></span>
        </div>
        <div class="panel-body">
            <div class="tutorial-content">
                <h4>功能介绍</h4>
                <p>AI雨课堂助手是一个为雨课堂提供辅助功能的工具，可以帮助你更好地参与课堂互动。</p>
                <p>项目仓库：https://github.com/ZaytsevZY/yuketang-helper-ai</p>
                <p>插件安装地址：https://greasyfork.org/zh-CN/scripts/531469-ai雨课堂助手</p>

                <h4>工具栏按钮说明</h4>
                <ul>
                    <li><i class="fas fa-bell"></i> <strong>习题提醒</strong>：切换是否在新习题出现时显示通知提示，蓝色代表开启状态。</li>
                    <li><i class="fas fa-file-powerpoint"></i> <strong>课件浏览</strong>：查看课件和习题列表，包括已经发布过的所有题目。</li>
                    <li><i class="fas fa-robot"></i> <strong>AI解答</strong>：使用AI智能解答当前习题，再次点击可关闭解答面板。</li>
                    <li><i class="fas fa-cog"></i> <strong>AI设置</strong>：设置DeepSeek API密钥等配置。</li>
                    <li><i class="fas fa-question-circle"></i> <strong>使用教程</strong>：显示/隐藏当前教程页面。</li>
                </ul>

                <h4>课件浏览功能</h4>
                <p>在课件浏览界面，你可以：</p>
                <ul>
                    <li>查看课件的所有页面，特别是习题页面</li>
                    <li>切换显示全部页面/仅习题页面</li>
                    <li>查看详细题目信息和参考答案</li>
                    <li>下载课件为PDF格式</li>
                </ul>

                <h4>AI解答功能</h4>
                <p>使用AI解答功能前需要设置DeepSeek API密钥：</p>
                <ol>
                    <li>点击设置按钮（<i class="fas fa-cog"></i>）</li>
                    <li>输入你的DeepSeek API密钥</li>
                    <li>点击AI解答按钮（<i class="fas fa-robot"></i>）未打开问题列表时，ai解答最后一道问题；打开问题列表并选择一个问题时，ai解答选中的问题</li>
                </ol>

                <h4>注意事项</h4>
                <p>1. 本工具仅供学习参考，请独立思考解决问题</p>
                <p>2. AI解答功能需要消耗API额度，请合理使用</p>
                <p>3. 答案仅供参考，不保证100%正确</p>
            </div>
        </div>
    `;
    document.body.appendChild(panel);

    // 添加关闭按钮功能
    panel.querySelector('.close-btn').addEventListener('click', () => {
        showTutorialPanel(false);
        // 关闭时也取消按钮的激活状态
        const helpBtn = document.getElementById('ykt-btn-help');
        if (helpBtn) helpBtn.classList.remove('active');
    });

    return panel;
}

// 显示/隐藏教程面板
function showTutorialPanel(show = true) {
    const panel = document.getElementById('ykt-tutorial-panel');
    if (!panel) return;

    if (show) {
        panel.classList.add('visible');
    } else {
        panel.classList.remove('visible');
    }
}

// 切换教程面板显示/隐藏
function toggleTutorialPanel() {
    const panel = document.getElementById('ykt-tutorial-panel');
    const helpBtn = document.getElementById('ykt-btn-help');

    if (!panel) return;

    const isVisible = panel.classList.contains('visible');

    // 切换面板显示状态
    showTutorialPanel(!isVisible);

    // 切换按钮激活状态
    if (helpBtn) {
        if (!isVisible) {
            helpBtn.classList.add('active');
        } else {
            helpBtn.classList.remove('active');
        }
    }
}

    // 导航到特定幻灯片
    function navigateTo(presentationId, slideId) {
        currentPresentationId = presentationId;
        currentSlideId = slideId;

        // 更新UI
        updateSlideView();

        // 显示课件面板
        showPresentationPanel(true);
    }

// 更新课件列表
function updatePresentationList() {
    const listEl = document.getElementById('ykt-presentation-list');
    if (!listEl) return;

    // 清空现有内容
    listEl.innerHTML = '';

    if (presentations.size === 0) {
        listEl.innerHTML = '<p class="no-presentations">暂无课件记录</p>';
        return;
    }

    // 为每个课件创建展示区
    for (const [id, presentation] of presentations) {
        const presentationContainer = document.createElement('div');
        presentationContainer.className = 'presentation-container';

        // 创建课件标题
        const titleEl = document.createElement('div');
        titleEl.className = 'presentation-title';
        titleEl.innerHTML = `
            <span>${presentation.title}</span>
            <i class="fas fa-download download-btn" title="下载课件"></i>
        `;
        presentationContainer.appendChild(titleEl);

        // 添加下载按钮功能
        titleEl.querySelector('.download-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            downloadPresentation(presentation);
        });

        // 创建幻灯片容器
        const slidesContainer = document.createElement('div');
        slidesContainer.className = 'presentation-slides';

        // 过滤要显示的幻灯片
        let slidesToShow = config.showAllSlides
            ? presentation.slides
            : presentation.slides.filter(slide => slide.problem);

        // 从 GitHub 代码中学习，这里没有显式过滤章节，
        // 但幻灯片显示时会根据有效性过滤，使用这种方法：
        // 1. 创建所有缩略图元素但保留对它们的引用
        // 2. 当图片加载失败时，移除该缩略图元素
        // 3. 这样就能自动过滤掉无法访问的其他章节的幻灯片

        const thumbnailElements = [];

        // 为每个幻灯片创建缩略图
        for (const slide of slidesToShow) {
            const slideEl = document.createElement('div');
            slideEl.className = 'slide-thumbnail';
            thumbnailElements.push(slideEl);

            // 添加样式类
            if (slide.id === currentSlideId) {
                slideEl.classList.add('active');
            }

            // 如果有问题，添加相关样式
            if (slide.problem) {
                const problemId = slide.problem.problemId;
                const status = problemStatus.get(problemId);

                if (status) {
                    slideEl.classList.add('unlocked');
                }

                if (slide.problem.result) {
                    slideEl.classList.add('answered');
                }
            }

            // 设置点击事件
            slideEl.addEventListener('click', () => {
                navigateTo(presentation.id, slide.id);
            });

            // 创建缩略图内容
            const thumbnailImg = document.createElement('img');
            thumbnailImg.style.aspectRatio = `${presentation.width}/${presentation.height}`;
            thumbnailImg.src = slide.thumbnail;

            // 关键部分：处理图片加载失败，移除对应的缩略图元素
            thumbnailImg.onerror = function() {
                // 图片加载失败，说明这个幻灯片可能不属于当前章节
                if (slideEl.parentNode) {
                    slideEl.parentNode.removeChild(slideEl);
                }
            };

            const indexSpan = document.createElement('span');
            indexSpan.className = 'slide-index';
            indexSpan.textContent = slide.index;

            slideEl.appendChild(thumbnailImg);
            slideEl.appendChild(indexSpan);

            slidesContainer.appendChild(slideEl);
        }

        presentationContainer.appendChild(slidesContainer);
        listEl.appendChild(presentationContainer);
    }
}
    // 更新幻灯片视图
    function updateSlideView() {
        const slideViewEl = document.getElementById('ykt-slide-view');
        const problem = currentSlideId ? slides.get(currentSlideId)?.problem : null;

        if (!slideViewEl) return;

        // 获取当前幻灯片和课件
        const slide = currentSlideId ? slides.get(currentSlideId) : null;
        const presentation = currentPresentationId ? presentations.get(currentPresentationId) : null;

        if (!slide || !presentation) {
            slideViewEl.innerHTML = `
                <div class="slide-cover">
                    <div class="empty-message">选择左侧的幻灯片查看详情</div>
                </div>
            `;
            return;
        }

        // 更新幻灯片封面
        const coverHTML = `
            <div class="slide-cover">
                <img src="${slide.cover}" style="aspect-ratio: ${presentation.width}/${presentation.height}">
            </div>
        `;

        // 如果有问题，显示问题视图
        let problemHTML = '';
        if (problem) {
            const canAnswer = problemStatus.has(problem.problemId) && !problem.result;
            const revealedAnswers = problem.result || storage.get(`revealed-answers-${problem.problemId}`);

            let answerHTML = '';
            if (revealedAnswers) {
                if (problem.problemType === 4 && problem.blanks) {
                    // 填空题显示每个空的答案
                    answerHTML = problem.blanks.map((blank, i) =>
                        `<p>答案 ${i+1}：<code>${JSON.stringify(blank.answers)}</code></p>`
                    ).join('');
                } else {
                    // 其他题型显示答案
                    answerHTML = `<p>答案：<code>${JSON.stringify(problem.answers)}</code></p>`;
                }
            } else {
                // 未显示答案，提供查看按钮
                answerHTML = `
                    <p>
                        答案：<a href="#" class="reveal-answer" data-problem-id="${problem.problemId}">查看答案</a>
                    </p>
                `;
            }

            problemHTML = `
                <div class="problem-view">
                    <div class="problem-body">
                        <p>题面：${problem.body || "空"}</p>
                        ${[1, 2, 4].includes(problem.problemType) ? answerHTML : ''}
                        ${problem.remark ? `<p>备注：${problem.remark}</p>` : ''}
                        ${problem.result ? `<p>作答内容：<code>${JSON.stringify(problem.result)}</code></p>` : ''}
                    </div>
                    <div class="problem-actions">
                        <textarea id="answer-content" rows="6" placeholder="自动作答内容"></textarea>
                        <div class="action-buttons">
                            <button id="btn-set-auto-answer">自动作答</button>
                            <button id="btn-submit-answer" ${canAnswer ? '' : 'disabled'}>提交答案</button>
                        </div>
                    </div>
                </div>
            `;
        }

        // 更新视图
        slideViewEl.innerHTML = coverHTML + problemHTML;

        // 添加事件监听
        if (problem) {
            // 答案显示事件
            slideViewEl.querySelectorAll('.reveal-answer').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    const problemId = btn.getAttribute('data-problem-id');
                    storage.set(`revealed-answers-${problemId}`, true);
                    updateSlideView();
                });
            });

            // 自动作答设置事件
            const textArea = slideViewEl.querySelector('#answer-content');
            if (textArea) {
                // 加载现有作答内容
                const autoAnswers = storage.getMap('auto-answer');
                if (autoAnswers.has(problem.problemId)) {
                    const result = autoAnswers.get(problem.problemId);
                    let content = '';

                    switch(problem.problemType) {
                        case 1: // 单选
                        case 2: // 多选
                        case 3: // 投票
                            if (Array.isArray(result)) content = result.join('');
                            break;
                        case 4: // 填空
                            if (Array.isArray(result)) content = result.join('\n');
                            break;
                        case 5: // 主观
                            if (result && typeof result.content === 'string') content = result.content;
                            break;
                    }

                    textArea.value = content;
                }

                // 设置自动作答
                slideViewEl.querySelector('#btn-set-auto-answer').addEventListener('click', () => {
                    const content = textArea.value;

                    if (!content) {
                        storage.alterMap('auto-answer', map => map.delete(problem.problemId));
                        showToast('已重置本题的自动作答内容');
                    } else {
                        const result = parseAnswer(problem.problemType, content);
                        storage.alterMap('auto-answer', map => map.set(problem.problemId, result));
                        showToast('已设置本题的自动作答内容');
                    }
                });

                // 提交答案
                slideViewEl.querySelector('#btn-submit-answer').addEventListener('click', () => {
                    const content = textArea.value;
                    if (!content) {
                        showToast('请输入作答内容');
                        return;
                    }

                    const result = parseAnswer(problem.problemType, content);
                    submitAnswer(problem, result);
                });
            }
        }
    }

    // 解析答案内容
    function parseAnswer(problemType, content) {
        switch (problemType) {
            case 1: // 单选
            case 2: // 多选
            case 3: // 投票
                return content.split('').sort();
            case 4: // 填空
                return content.split('\n').filter(text => !!text);
            case 5: // 主观
                return { content, pics: [] };
        }
    }

    // 提交答案
    async function submitAnswer(problem, result) {
        const { problemId, problemType } = problem;
        const status = problemStatus.get(problemId);

        if (!status) {
            showToast('题目未发布', 3000);
            return;
        }

        if (status.answering) {
            showToast('作答中，请稍后再试', 3000);
            return;
        }

        status.answering = true;

        try {
            // 如果题目已经截止，尝试重试作答
            if (Date.now() >= status.endTime) {
                if (!confirm('作答已经截止，是否重试作答？\n此功能用于补救超时未作答的题目。')) {
                    showToast('已取消作答', 1500);
                    return;
                }

                // 使用重试API
                const dt = status.startTime + 2000; // 在题目开始后2秒答题
                await retryAnswer(problem, result, dt);
            } else {
                // 正常提交答案
                await answerProblem(problem, result);
            }

            // 更新问题结果
            onAnswerProblem(problemId, result);
            showToast('作答完成', 3000);

        } catch (err) {
            console.error('[雨课堂助手] 提交答案失败:', err);
            showToast('作答失败: ' + err.message, 3000);
        } finally {
            status.answering = false;
        }
    }

    // 提交题目答案
    async function answerProblem(problem, result) {
        const url = '/api/v3/lesson/problem/answer';
        const headers = {
            'Content-Type': 'application/json',
            'xtbz': 'ykt',
            'X-Client': 'h5',
            'Authorization': 'Bearer ' + localStorage.getItem('Authorization')
        };

        const data = {
            problemId: problem.problemId,
            problemType: problem.problemType,
            dt: Date.now(),
            result: result
        };

        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', url);

            // 设置请求头
            for (const [key, value] of Object.entries(headers)) {
                xhr.setRequestHeader(key, value);
            }

            xhr.onload = function() {
                try {
                    const response = JSON.parse(xhr.responseText);
                    if (response.code === 0) {
                        resolve(response);
                    } else {
                        reject(new Error(`${response.msg} (${response.code})`));
                    }
                } catch (e) {
                    reject(new Error('解析响应失败'));
                }
            };

            xhr.onerror = function() {
                reject(new Error('网络请求失败'));
            };

            xhr.send(JSON.stringify(data));
        });
    }

    // 重试答题
    async function retryAnswer(problem, result, dt) {
        const url = '/api/v3/lesson/problem/retry';
        const headers = {
            'Content-Type': 'application/json',
            'xtbz': 'ykt',
            'X-Client': 'h5',
            'Authorization': 'Bearer ' + localStorage.getItem('Authorization')
        };

        const data = {
            problems: [{
                problemId: problem.problemId,
                problemType: problem.problemType,
                dt: dt,
                result: result
            }]
        };

        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', url);

            // 设置请求头
            for (const [key, value] of Object.entries(headers)) {
                xhr.setRequestHeader(key, value);
            }

            xhr.onload = function() {
                try {
                    const response = JSON.parse(xhr.responseText);
                    if (response.code === 0) {
                        if (!response.data.success.includes(problem.problemId)) {
                            reject(new Error('服务器未返回成功信息'));
                        } else {
                            resolve(response);
                        }
                    } else {
                        reject(new Error(`${response.msg} (${response.code})`));
                    }
                } catch (e) {
                    reject(new Error('解析响应失败'));
                }
            };

            xhr.onerror = function() {
                reject(new Error('网络请求失败'));
            };

            xhr.send(JSON.stringify(data));
        });
    }

    // 下载课件
    async function downloadPresentation(presentation) {
        showToast('正在准备下载课件，请稍候...', 3000);

        try {
            const jspdf = await loadJsPDF();

            const { width, height } = presentation;
            const doc = new jspdf.jsPDF({
                format: [width, height],
                orientation: width > height ? 'l' : 'p',
                unit: 'px',
                putOnlyUsedFonts: true,
                compress: true,
                hotfixes: ["px_scaling"]
            });

            doc.deletePage(1);
            let parent = null;

            // 下载进度处理
            const totalSlides = presentation.slides.length;

            for (let i = 0; i < totalSlides; i++) {
                const slide = presentation.slides[i];

                // 更新进度
                showToast(`下载课件中: ${i + 1}/${totalSlides}`, 100000);

                // 下载图片
                const resp = await fetch(slide.cover);
                const arrayBuffer = await resp.arrayBuffer();
                const data = new Uint8Array(arrayBuffer);

                // 添加页面
                doc.addPage();
                doc.addImage(data, 'PNG', 0, 0, width, height);

                // 添加目录
                const pageNumber = doc.getNumberOfPages();
                if (parent === null) {
                    parent = doc.outline.add(null, presentation.title, { pageNumber });
                }

                let bookmark = `${slide.index}`;
                if (slide.note) {
                    bookmark += `: ${slide.note}`;
                }
                if (slide.problem) {
                    bookmark += ` - ${PROBLEM_TYPE_MAP[slide.problem.problemType]}`;
                }

                doc.outline.add(parent, bookmark, { pageNumber });
            }

            // 保存文件
            doc.save(presentation.title);
            showToast('课件下载完成', 3000);

        } catch (error) {
            console.error('[雨课堂助手] 下载课件失败:', error);
            showToast('下载失败: ' + error.message, 3000);
        }
    }

    // 更新题目列表
    function updateProblemList() {
        const listEl = document.getElementById('ykt-problem-list');
        if (!listEl) return;

        // 清空现有内容
        listEl.innerHTML = '';

        if (encounteredProblems.length === 0) {
            listEl.innerHTML = '<p class="no-problems">暂无习题记录</p>';
            return;
        }

        // 为每个问题创建容器
        encounteredProblems.forEach((problem, index) => {
            const problemEl = document.createElement('div');
            problemEl.className = 'problem-item';

            const typeText = PROBLEM_TYPE_MAP[problem.problemType] || '未知类型';

            // 如果有幻灯片，添加导航功能
            const hasSlide = problem.slide && problem.presentationId;
            if (hasSlide) {
                problemEl.classList.add('has-slide');
                problemEl.addEventListener('click', () => {
                    navigateTo(problem.presentationId, problem.slide.id);
                });
            }

            // 添加截图HTML
            let screenshotHtml = '';
            if (problem.slide) {
                // 优先使用幻灯片的缩略图
                const presentation = presentations.get(problem.presentationId);
                if (presentation) {
                    screenshotHtml = `
                        <div class="problem-screenshot">
                            <img src="${problem.slide.thumbnail}"
                                style="aspect-ratio: ${presentation.width}/${presentation.height}"
                                alt="题目截图" />
                        </div>
                    `;
                }
            } else if (problem.screenshot) {
                // 否则使用截取的截图
                screenshotHtml = `
                    <div class="problem-screenshot">
                        <img src="${problem.screenshot}" alt="题目截图" />
                    </div>
                `;
            }

            let optionsHtml = '';
            if (problem.options && problem.options.length > 0) {
                optionsHtml = `
                    <div class="problem-options">
                        ${problem.options.map(opt => `<div class="option"><span class="key">${opt.key}</span>. ${opt.value}</div>`).join('')}
                    </div>
                `;
            }

            let answersHtml = '';
            if (problem.answers && problem.answers.length > 0) {
                answersHtml = `
                    <div class="problem-answers">
                        <div class="answer-label">参考答案:</div>
                        <div class="answer-content">${problem.answers.join(', ')}</div>
                    </div>
                `;
            } else if (problem.blanks && problem.blanks.length > 0) {
                answersHtml = `
                    <div class="problem-answers">
                        <div class="answer-label">参考答案:</div>
                        ${problem.blanks.map((blank, i) =>
                            `<div class="answer-content">空格${i+1}: ${blank.answers ? blank.answers.join(' 或 ') : '无'}</div>`
                        ).join('')}
                    </div>
                `;
            }

            problemEl.innerHTML = `
                <div class="problem-header">
                    <span class="problem-index">#${index+1}</span>
                    <span class="problem-type">[${typeText}]</span>
                    <span class="problem-id">ID: ${problem.problemId}</span>
                    ${hasSlide ? '<span class="view-slide"><i class="fas fa-external-link-alt"></i> 查看幻灯片</span>' : ''}
                </div>
                <div class="problem-body">${problem.body || '无题目内容'}</div>
                ${screenshotHtml}
                ${optionsHtml}
                ${answersHtml}
                ${problem.result ? `
                <div class="problem-result">
                    <div class="result-label">提交答案:</div>
                    <div class="result-content">${JSON.stringify(problem.result)}</div>
                </div>` : ''}
            `;

            listEl.appendChild(problemEl);
        });
    }

    // 更新活动题目
    function updateActiveProblems() {
        const container = document.getElementById('ykt-active-problems');
        if (!container) return;

        // 清空现有内容
        container.innerHTML = '';

        // 筛选活动的题目
        const activeProbs = [];
        const now = Date.now();

        for (const [problemId, status] of problemStatus.entries()) {
            // 如果问题已经结束或已经回答，不显示
            if (now > status.endTime || problems.get(problemId)?.result) continue;

            const problem = problems.get(problemId);
            const slide = slides.get(status.slideId);
            const presentation = presentations.get(status.presentationId);

            if (problem && slide && presentation) {
                activeProbs.push({ problem, slide, presentation, status });
            }
        }

        // 如果没有活动题目，返回
        if (activeProbs.length === 0) return;

        // 为每个活动题目创建卡片
        for (const { problem, slide, presentation, status } of activeProbs) {
            const cardEl = document.createElement('div');
            cardEl.className = 'problem-card';

            // 计算剩余时间
            const remainingMs = Math.max(0, status.endTime - now);
            const remainingSec = Math.floor(remainingMs / 1000) % 60;
            const remainingMin = Math.floor(remainingMs / 60000);
            const timeText = `${remainingMin}:${remainingSec.toString().padStart(2, '0')}`;

            // 判断是否有自动回答
            const hasAutoAnswer = storage.getMap('auto-answer').has(problem.problemId);

            cardEl.innerHTML = `
                <div class="card-image">
                    <img src="${slide.thumbnail}" style="aspect-ratio: ${presentation.width}/${presentation.height}">
                </div>
                <div class="card-tag ${hasAutoAnswer ? 'has-auto' : ''}">
                    ${timeText}
                </div>
                <div class="card-actions">
                    <button class="btn-view" title="查看题目"><i class="fas fa-eye"></i></button>
                    <button class="btn-answer" title="回答题目"><i class="fas fa-pen"></i></button>
                </div>
            `;

            // 查看题目
            cardEl.querySelector('.btn-view').addEventListener('click', () => {
                navigateTo(presentation.id, slide.id);
            });

            // 回答题目
            cardEl.querySelector('.btn-answer').addEventListener('click', () => {
                const autoAnswers = storage.getMap('auto-answer');
                if (autoAnswers.has(problem.problemId)) {
                    const result = autoAnswers.get(problem.problemId);
                    if (confirm(`是否提交自动作答内容？\n${JSON.stringify(result)}`)) {
                        submitAnswer(problem, result);
                    }
                } else {
                    // 如果没有自动作答内容，导航到题目页面
                    navigateTo(presentation.id, slide.id);
                }
            });

            container.appendChild(cardEl);
        }
    }

    // 设置错误信息
    function setAIError(message) {
        const errorDiv = document.getElementById('ykt-ai-error');
        if (!errorDiv) return;

        if (message) {
            errorDiv.textContent = message;
            errorDiv.style.display = 'block';
        } else {
            errorDiv.style.display = 'none';
        }
    }

    // 设置加载状态
    function setAILoading(loading) {
        const loadingDiv = document.getElementById('ykt-ai-loading');
        if (!loadingDiv) return;

        loadingDiv.style.display = loading ? 'block' : 'none';
    }

    // 设置问题和答案
    function setQuestionAndAnswer(question, answer) {
        const questionDiv = document.getElementById('ykt-ai-question');
        const answerDiv = document.getElementById('ykt-ai-answer');

        if (!questionDiv || !answerDiv) return;

        questionDiv.textContent = question || '';
        answerDiv.innerHTML = answer ? answer.replace(/\n/g, '<br>') : '';
    }

// 选择当前要AI解答的问题
function selectCurrentProblem() {
    const presentationPanelOpen = document.getElementById('ykt-presentation-panel')?.classList.contains('visible');

    // 如果课件面板打开且有选中的幻灯片，使用选中幻灯片的问题
    if (presentationPanelOpen && currentSlideId) {
        const slide = slides.get(currentSlideId);
        if (slide && slide.problem) {
            return slide.problem;
        }
    }

    // 如果课件面板关闭或没有选中的问题，找出最后一个已经出现的习题
    let latestProblem = null;
    let latestTime = 0;

    // 遍历所有已解锁的问题
    for (const [problemId, status] of problemStatus.entries()) {
        // 如果这个问题的解锁时间比之前找到的要晚，更新为当前问题
        if (status.startTime > latestTime) {
            const problem = problems.get(problemId);
            if (problem) {
                latestProblem = problem;
                latestTime = status.startTime;
            }
        }
    }

    // 如果找到了最近的问题，返回它
    if (latestProblem) {
        return latestProblem;
    }

    // 若还没找到，从encounteredProblems中找最后一个
    if (encounteredProblems.length > 0) {
        const latestProblemId = encounteredProblems[encounteredProblems.length - 1].problemId;
        return problems.get(latestProblemId);
    }

    return null;
}

    // 处理AI答案请求
async function handleAskAI() {
    const aiPanel = document.getElementById('ykt-ai-answer-panel');
    const aiButton = document.getElementById('ykt-btn-ai');

    // 检查AI面板是否已显示，实现切换功能
    if (aiPanel && aiPanel.classList.contains('visible')) {
        // 如果已显示，则隐藏面板并移除按钮激活状态
        showAIPanel(false);
        aiButton.classList.remove('active');
        return;
    }

    // 如果未显示，激活按钮（变蓝）
    aiButton.classList.add('active');

    const problem = selectCurrentProblem();

    if (!problem) {
        showToast("没有检测到题目");
        return;
    }

    // 查找当前问题对应的幻灯片和课件
    let slideId = null;
    let presentationId = null;

    // 尝试查找问题对应的幻灯片
    for (const [id, slide] of slides.entries()) {
        if (slide.problem && slide.problem.problemId === problem.problemId) {
            slideId = id;
            // 查找幻灯片对应的课件
            for (const [presId, presentation] of presentations.entries()) {
                if (presentation.slides.some(s => s.id === slideId)) {
                    presentationId = presId;
                    break;
                }
            }
            break;
        }
    }

    // 如果找到了幻灯片和课件，更新当前选择的状态
    if (slideId && presentationId) {
        currentSlideId = slideId;
        currentPresentationId = presentationId;
        updatePresentationList();
    }

    const question = formatProblemForAI(problem);

    // 显示当前处理的问题标题
    showToast(`正在处理题目: ${problem.body.substring(0, 30)}${problem.body.length > 30 ? '...' : ''}`, 2000);

    showAIPanel(true);
    setAIError('');
    setAILoading(true);
    setQuestionAndAnswer(question, '');

    try {
        const answer = await queryDeepSeek(question);
        setAILoading(false);
        setQuestionAndAnswer(question, answer);
    } catch (error) {
        console.error('AI请求失败:', error);
        setAILoading(false);
        setAIError(error.message);
    }
}

    // 清除AI回答
    function clearAIAnswer() {
        showAIPanel(false);
    }

    // 切换题目列表/课件
    function togglePresentationPanel() {
        const panel = document.getElementById('ykt-presentation-panel');
        showPresentationPanel(!panel?.classList.contains('visible'));
    }

    // 切换题目列表显示
    function toggleProblemList() {
        const panel = document.getElementById('ykt-problem-list-panel');
        showProblemListPanel(!panel?.classList.contains('visible'));
    }

    // 切换通知功能
    function toggleNotify() {
        config.notifyProblems = !config.notifyProblems;
        saveConfig();
        showToast(`习题提醒：${config.notifyProblems ? "开" : "关"}`);

        // 更新按钮状态
        const btnBell = document.getElementById('ykt-btn-bell');
        if (btnBell) {
            if (config.notifyProblems) {
                btnBell.classList.add('active');
            } else {
                btnBell.classList.remove('active');
            }
        }
    }

    // 添加样式
    function addStyles() {
        GM_addStyle(`
            /* 移除水印 */
            #watermark_layer {
                display: none !important;
                visibility: hidden !important;
            }

            /* 工具栏样式 */
            #ykt-helper-toolbar {
                position: fixed;
                z-index: 9999999;
                left: 15px;
                bottom: 15px;
                width: 210px;
                height: 36px;
                padding: 5px;
                display: flex;
                flex-direction: row;
                justify-content: space-between;
                align-items: center;
                background: #ffffff;
                border: 1px solid #cccccc;
                border-radius: 4px;
                box-shadow: 0 1px 4px 3px rgba(0,0,0,0.1);
            }

            #ykt-helper-toolbar .btn {
                display: inline-block;
                padding: 4px;
                cursor: pointer;
                color: #607190;
            }

            #ykt-helper-toolbar .btn:hover {
                color: #1e3050;
            }

            #ykt-helper-toolbar .btn.active {
                color: #1d63df;
            }

            /* AI答案面板样式 */
            #ykt-ai-answer-panel {
                position: fixed;
                z-index: 9999998;
                left: 15px;
                bottom: 60px;
                width: 400px;
                max-height: 500px;
                padding: 10px;
                background: #ffffff;
                border: 1px solid #cccccc;
                border-radius: 4px;
                box-shadow: 0 1px 4px 3px rgba(0,0,0,0.1);
                overflow-y: auto;
                display: none;
            }

            #ykt-ai-answer-panel.visible {
                display: block;
            }

            #ykt-ai-loading {
                text-align: center;
                padding: 20px;
            }

            #ykt-ai-error {
                color: red;
                margin-bottom: 10px;
            }

            #ykt-ai-question {
                font-weight: bold;
                margin-bottom: 10px;
                padding-bottom: 10px;
                border-bottom: 1px solid #eee;
            }

            #ykt-ai-answer {
                white-space: pre-wrap;
            }

            /* 课件浏览面板样式 */
            #ykt-presentation-panel {
                position: fixed;
                z-index: 9999996;
                left: 50%;
                top: 50%;
                transform: translate(-50%, -50%);
                width: 90%;
                height: 90%;
                background: #ffffff;
                border: 1px solid #cccccc;
                border-radius: 4px;
                box-shadow: 0 1px 4px 3px rgba(0,0,0,0.1);
                display: none;
                flex-direction: column;
            }

            #ykt-presentation-panel.visible {
                display: flex;
            }

            #ykt-presentation-panel .panel-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 10px 15px;
                border-bottom: 1px solid #eee;
            }

            #ykt-presentation-panel .panel-header h3 {
                margin: 0;
            }

            #ykt-presentation-panel .panel-controls {
                display: flex;
                align-items: center;
                gap: 15px;
            }

            #ykt-presentation-panel .close-btn {
                cursor: pointer;
                padding: 5px;
            }

            #ykt-presentation-panel .panel-body {
                flex: 1;
                display: grid;
                grid-template-columns: 240px 1fr;
                overflow: hidden;
            }

            #ykt-presentation-panel .panel-left {
                border-right: 1px solid #eee;
                overflow-y: auto;
                padding: 10px;
            }

            #ykt-presentation-panel .panel-right {
                overflow-y: auto;
                padding: 25px 40px;
            }

            #ykt-presentation-panel .presentation-title {
                font-weight: bold;
                margin: 10px 0;
                display: flex;
                justify-content: space-between;
                align-items: center;
                position: relative;
            }

            #ykt-presentation-panel .presentation-title:after {
                content: "";
                display: inline-block;
                height: 1px;
                background: #aaaaaa;
                position: absolute;
                width: 100%;
                left: 0;
                bottom: -5px;
            }

            #ykt-presentation-panel .download-btn {
                cursor: pointer;
                color: #607190;
            }

            #ykt-presentation-panel .download-btn:hover {
                color: #1e3050;
            }

            #ykt-presentation-panel .presentation-slides {
                display: flex;
                flex-direction: column;
                gap: 10px;
                margin: 10px 0;
            }

            #ykt-presentation-panel .slide-thumbnail {
                position: relative;
                border: 2px solid #dddddd;
                cursor: pointer;
            }

            #ykt-presentation-panel .slide-thumbnail img {
                display: block;
                width: 100%;
            }

            #ykt-presentation-panel .slide-thumbnail .slide-index {
                position: absolute;
                top: 0;
                left: 0;
                display: inline-block;
                padding: 3px 5px;
                font-size: small;
                color: #f7f7f7;
                background: rgba(64,64,64,.4);
            }

            #ykt-presentation-panel .slide-thumbnail.active {
                border-color: #2d70e7;
            }

            #ykt-presentation-panel .slide-thumbnail.active .slide-index {
                background: #2d70e7;
            }

            #ykt-presentation-panel .slide-thumbnail.unlocked {
                border-color: #d7d48e;
            }

            #ykt-presentation-panel .slide-thumbnail.unlocked.active {
                border-color: #e6cb2d;
            }

            #ykt-presentation-panel .slide-thumbnail.unlocked.active .slide-index {
                background: #e6cb2d;
            }

            #ykt-presentation-panel .slide-thumbnail.answered {
                border-color: #8dd790;
            }

            #ykt-presentation-panel .slide-thumbnail.answered.active {
                border-color: #4caf50;
            }

            #ykt-presentation-panel .slide-thumbnail.answered.active .slide-index {
                background: #4caf50;
            }

            #ykt-presentation-panel .slide-cover {
                border: 1px solid #dddddd;
                box-shadow: 0 1px 4px 3px rgba(0,0,0,0.1);
                text-align: center;
            }

            #ykt-presentation-panel .slide-cover img {
                max-width: 100%;
            }

            #ykt-presentation-panel .slide-cover .empty-message {
                padding: 50px 0;
                color: #888;
            }

            #ykt-presentation-panel .problem-view {
                margin-top: 25px;
            }

            #ykt-presentation-panel .problem-actions {
                margin-top: 15px;
            }

            #ykt-presentation-panel .problem-actions textarea {
                width: 100%;
                min-height: 80px;
                padding: 8px;
                border: 1px solid #ddd;
                border-radius: 4px;
                resize: vertical;
            }

            #ykt-presentation-panel .action-buttons {
                margin-top: 15px;
                text-align: center;
            }

            #ykt-presentation-panel .action-buttons button {
                margin: 0 10px;
                padding: 6px 15px;
                background: #f5f5f5;
                border: 1px solid #ddd;
                border-radius: 4px;
                cursor: pointer;
            }

            #ykt-presentation-panel .action-buttons button:hover {
                background: #e8e8e8;
            }

            #ykt-presentation-panel .action-buttons button:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }

            /* 题目列表面板样式 */
            #ykt-problem-list-panel {
                position: fixed;
                z-index: 9999997;
                left: 50%;
                top: 50%;
                transform: translate(-50%, -50%);
                width: 80%;
                max-width: 800px;
                height: 80%;
                background: #ffffff;
                border: 1px solid #cccccc;
                border-radius: 4px;
                box-shadow: 0 1px 4px 3px rgba(0,0,0,0.1);
                display: none;
                flex-direction: column;
            }

            #ykt-problem-list-panel.visible {
                display: flex;
            }

            #ykt-problem-list-panel .panel-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 10px 15px;
                border-bottom: 1px solid #eee;
            }

            #ykt-problem-list-panel .panel-header h3 {
                margin: 0;
            }

            #ykt-problem-list-panel .close-btn {
                cursor: pointer;
                padding: 5px;
            }

            #ykt-problem-list-panel .panel-body {
                flex: 1;
                overflow-y: auto;
                padding: 15px;
            }

            #ykt-problem-list-panel .no-problems {
                text-align: center;
                color: #888;
                margin-top: 20px;
            }

            #ykt-problem-list-panel .problem-item {
                margin-bottom: 20px;
                padding: 10px;
                border: 1px solid #eee;
                border-radius: 4px;
            }

            #ykt-problem-list-panel .problem-item.has-slide {
                border-color: #d7d48e;
                cursor: pointer;
            }

            #ykt-problem-list-panel .problem-item.has-slide:hover {
                background: #fafafa;
            }

            #ykt-problem-list-panel .problem-header {
                margin-bottom: 10px;
                padding-bottom: 5px;
                border-bottom: 1px solid #eee;
                display: flex;
                align-items: center;
            }

            #ykt-problem-list-panel .problem-index {
                font-weight: bold;
                margin-right: 10px;
            }

            #ykt-problem-list-panel .problem-type {
                color: #1d63df;
                margin-right: 10px;
            }

            #ykt-problem-list-panel .problem-id {
                color: #888;
                font-size: 0.9em;
                margin-right: auto;
            }

            #ykt-problem-list-panel .view-slide {
                color: #1d63df;
                font-size: 0.9em;
                cursor: pointer;
            }

            #ykt-problem-list-panel .problem-body {
                font-weight: bold;
                margin-bottom: 10px;
            }

            #ykt-problem-list-panel .problem-options {
                margin-bottom: 10px;
            }

            #ykt-problem-list-panel .option {
                margin: 5px 0;
            }

            #ykt-problem-list-panel .key {
                font-weight: bold;
            }

            #ykt-problem-list-panel .problem-answers,
            #ykt-problem-list-panel .problem-result {
                background: #f9f9f9;
                padding: 10px;
                border-radius: 4px;
                margin-bottom: 10px;
            }

            #ykt-problem-list-panel .answer-label,
            #ykt-problem-list-panel .result-label {
                font-weight: bold;
                margin-bottom: 5px;
            }

            #ykt-problem-list-panel .answer-label {
                color: #4caf50;
            }

            #ykt-problem-list-panel .result-label {
                color: #1d63df;
            }

            #ykt-problem-list-panel .answer-content,
            #ykt-problem-list-panel .result-content {
                font-family: monospace;
            }

            /* 题目截图样式 */
            #ykt-problem-list-panel .problem-screenshot {
                margin: 10px 0;
                text-align: center;
                border: 1px solid #eee;
                padding: 5px;
            }

            #ykt-problem-list-panel .problem-screenshot img {
                max-width: 100%;
                max-height: 300px;
                object-fit: contain;
            }

            /* 活动问题面板 */
            #ykt-active-problems-panel {
                position: fixed;
                z-index: 9999995;
                left: 15px;
                bottom: 65px;
                display: flex;
                flex-direction: column;
            }

            #ykt-active-problems {
                display: flex;
                flex-direction: column;
                gap: 10px;
            }

            .problem-card {
                position: relative;
                width: 180px;
                height: 120px;
                background: #fff;
                border: 1px solid #ddd;
                border-radius: 4px;
                box-shadow: 0 1px 4px rgba(0,0,0,0.1);
                overflow: hidden;
            }

            .problem-card .card-image {
                width: 100%;
                height: 100%;
                overflow: hidden;
            }

            .problem-card .card-image img {
                width: 100%;
                height: 100%;
                object-fit: cover;
            }

            .problem-card .card-tag {
                position: absolute;
                bottom: 0;
                left: 0;
                padding: 4px 8px;
                background: rgba(0,0,0,0.7);
                color: white;
                font-size: 12px;
            }

            .problem-card .card-tag.has-auto {
                background: rgba(29, 99, 223, 0.7);
            }

            .problem-card .card-actions {
                position: absolute;
                bottom: 5px;
                right: 5px;
                display: flex;
                gap: 5px;
            }

            .problem-card .card-actions button {
                width: 28px;
                height: 28px;
                border-radius: 50%;
                border: none;
                background: rgba(255,255,255,0.8);
                color: #333;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
            }

            .problem-card .card-actions button:hover {
                background: rgba(255,255,255,0.9);
            }

                    /* 教程面板样式 */
        #ykt-tutorial-panel {
            position: fixed;
            z-index: 9999997;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
            width: 80%;
            max-width: 700px;
            height: 80%;
            background: #ffffff;
            border: 1px solid #cccccc;
            border-radius: 4px;
            box-shadow: 0 1px 4px 3px rgba(0,0,0,0.1);
            display: none;
            flex-direction: column;
        }

        #ykt-tutorial-panel.visible {
            display: flex;
        }

        #ykt-tutorial-panel .panel-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 15px;
            border-bottom: 1px solid #eee;
        }

        #ykt-tutorial-panel .panel-header h3 {
            margin: 0;
        }

        #ykt-tutorial-panel .close-btn {
            cursor: pointer;
            padding: 5px;
        }

        #ykt-tutorial-panel .panel-body {
            flex: 1;
            overflow-y: auto;
            padding: 20px 25px;
        }

        #ykt-tutorial-panel .tutorial-content h4 {
            margin-top: 20px;
            margin-bottom: 10px;
            color: #1d63df;
        }

        #ykt-tutorial-panel .tutorial-content p,
        #ykt-tutorial-panel .tutorial-content ul,
        #ykt-tutorial-panel .tutorial-content ol {
            margin-bottom: 15px;
            line-height: 1.5;
        }

        #ykt-tutorial-panel .tutorial-content ul,
        #ykt-tutorial-panel .tutorial-content ol {
            padding-left: 20px;
        }

        #ykt-tutorial-panel .tutorial-content li {
            margin-bottom: 8px;
        }
        `);
    }

// 创建工具栏
function createToolbar() {
    const toolbar = document.createElement('div');
    toolbar.id = 'ykt-helper-toolbar';
    toolbar.innerHTML = `
        <span class="btn ${config.notifyProblems ? 'active' : ''}" id="ykt-btn-bell" title="切换习题提醒">
            <i class="fas fa-bell fa-lg"></i>
        </span>
        <span class="btn" id="ykt-btn-slides" title="查看课件和幻灯片">
            <i class="fas fa-file-powerpoint fa-lg"></i>
        </span>
        <span class="btn" id="ykt-btn-ai" title="AI解答当前习题">
            <i class="fas fa-robot fa-lg"></i>
        </span>
        <span class="btn" id="ykt-btn-settings" title="AI设置">
            <i class="fas fa-cog fa-lg"></i>
        </span>
        <span class="btn" id="ykt-btn-help" title="使用教程">
            <i class="fas fa-question-circle fa-lg"></i>
        </span>
    `;
    document.body.appendChild(toolbar);

    // 创建AI答案面板
    createAIAnswerPanel();

    // 创建课件浏览面板
    createPresentationPanel();

    // 创建教程页面
    createTutorialPanel();

    // 添加按钮事件
    document.getElementById('ykt-btn-bell').addEventListener('click', toggleNotify);
    document.getElementById('ykt-btn-slides').addEventListener('click', togglePresentationPanel);
    document.getElementById('ykt-btn-ai').addEventListener('click', handleAskAI);
    document.getElementById('ykt-btn-settings').addEventListener('click', function() {
        const apiKey = prompt("请输入您的DeepSeek API密钥:", config.ai.apiKey);
        if (apiKey !== null) {
            config.ai.apiKey = apiKey;
            storage.set('aiApiKey', apiKey);
            saveConfig();
            showToast("API密钥已设置");
        }
    });
    document.getElementById('ykt-btn-help').addEventListener('click', toggleTutorialPanel);

    console.log("[雨课堂助手] 工具栏已创建");
}

    // 加载本地存储的课件
    function loadStoredPresentations() {
        const storedPresentations = storage.getMap("presentations");

        // 加载已存储的课件
        for (const [id, data] of storedPresentations.entries()) {
            onPresentationLoaded(id, data);
        }
    }

    // 添加全局更新定时器
    function startUpdateTimers() {
        // 定期更新活动问题
        // setInterval(updateActiveProblems, 1000);
    }

    // 进入课堂
    function launchLessonHelper() {
        const lessonId = window.location.pathname.split("/")[4];
        console.log(`[雨课堂助手] 检测到课堂页面 lessonId: ${lessonId}`);

        // 存储课程ID
        if (typeof GM_getTab === 'function' && typeof GM_saveTab === 'function') {
            GM_getTab((tab) => {
                tab.type = "lesson";
                tab.lessonId = lessonId;
                GM_saveTab(tab);
            });
        }

        createToolbar();
        interceptWebSockets();
        interceptXHR();
        loadStoredPresentations();
        startUpdateTimers();
    }

    // 检查活跃课程
    function pollActiveLessons() {
        console.log("[雨课堂助手] 检测到课程列表页面");
        // 自动进入课程功能可以在这里实现
    }

    // 初始化
    function initialize() {
        // 添加样式
        addStyles();

        const url = new URL(window.location.href);

        if (url.pathname.startsWith("/lesson/fullscreen/v3/")) {
            if (document.readyState === "loading") {
                document.addEventListener("DOMContentLoaded", launchLessonHelper);
            } else {
                launchLessonHelper();
            }
        } else if (url.pathname.startsWith("/v2/web/")) {
            pollActiveLessons();
        }
    }

    // 启动脚本
    initialize();
})();