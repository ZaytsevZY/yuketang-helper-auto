// userscript.meta.js
// userscript.meta.js
export const meta = `
// ==UserScript==
// @name         AI雨课堂助手（模块化构建版）
// @namespace    https://github.com/ZaytsevZY/yuketang-helper-auto
// @version      1.18.6
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
`;
