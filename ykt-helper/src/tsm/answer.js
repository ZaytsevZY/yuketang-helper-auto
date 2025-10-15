// src/tsm/answer.js
// Refactored from v1.16.1 userscript to module style.
// Exposes three primary APIs:
//   - answerProblem(problem, result, options)
//   - retryAnswer(problem, result, dt, options)
//   - submitAnswer(problem, result, submitOptions)  // orchestrates answer vs retry
//
// Differences vs userscript:
// - No global UI (confirm/Toast). Callers control UX.
// - Uses options to pass deadline window and behavior flags.
// - Allows header overrides for testing and non-browser envs.

// === 新增：设置与课堂上下文（仅内部使用，不导出） ===
import { ui } from '../ui/ui-api.js';
import { repo } from '../state/repo.js';

function sleep(ms) { return new Promise(r => setTimeout(r, Math.max(0, ms|0))); }
function calcAutoWaitMs() {
  const base = Math.max(0, (ui?.config?.autoAnswerDelay ?? 0));
  const rand = Math.max(0, (ui?.config?.autoAnswerRandomDelay ?? 0));
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
  'Content-Type': 'application/json',
  'xtbz': 'ykt',
  'X-Client': 'h5',
  'Authorization': 'Bearer ' + (typeof localStorage !== 'undefined' ? localStorage.getItem('Authorization') : ''),
});

/**
 * Low-level POST helper using XMLHttpRequest to align with site requirements.
 * @param {string} url
 * @param {object} data
 * @param {Record<string,string>} headers
 * @returns {Promise<any>}
 */
function xhrPost(url, data, headers) {
  return new Promise((resolve, reject) => {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      for (const [k, v] of Object.entries(headers || {})) xhr.setRequestHeader(k, v);
      xhr.onload = () => {
        try {
          const resp = JSON.parse(xhr.responseText);
          if (resp && typeof resp === 'object') {
            resolve(resp);
          } else {
            reject(new Error('解析响应失败'));
          }
        } catch {
          reject(new Error('解析响应失败'));
        }
      };
      xhr.onerror = () => reject(new Error('网络请求失败'));
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
 */
export async function answerProblem(problem, result, options = {}) {
  const url = '/api/v3/lesson/problem/answer';
  const headers = { ...DEFAULT_HEADERS(), ...(options.headers || {}) };
  const payload = {
    problemId: problem.problemId,
    problemType: problem.problemType,
    dt: options.dt ?? Date.now(),
    result,
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
 */
export async function retryAnswer(problem, result, dt, options = {}) {
  const url = '/api/v3/lesson/problem/retry';
  const headers = { ...DEFAULT_HEADERS(), ...(options.headers || {}) };
  const payload = {
    problems: [{
      problemId: problem.problemId,
      problemType: problem.problemType,
      dt,
      result,
    }],
  };

  const resp = await xhrPost(url, payload, headers);
  if (resp.code !== 0) {
    throw new Error(`${resp.msg} (${resp.code})`);
  }
  const okList = resp?.data?.success || [];
  if (!Array.isArray(okList) || !okList.includes(problem.problemId)) {
    throw new Error('服务器未返回成功信息');
  }
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
 */
export async function submitAnswer(problem, result, submitOptions = {}) {
  const {
    startTime,
    endTime,
    forceRetry = false,
    retryDtOffsetMs = 2000,
    headers,
  } = submitOptions;

  // ===== 新增：在进入提交主流程前，依据设置做“是否允许自动答题”的判定与可选等待 =====
  const lessonId = _lessonId ?? repo?.currentLessonId ?? null;
  // 仅当 autoGate=true 时才应用“自动进入课堂/默认自动答题”的逻辑；保持老调用方不受影响
  if (autoGate && shouldAutoAnswerForLesson_(lessonId)) {
    const ms = typeof waitMs === 'number' ? Math.max(0, waitMs) : calcAutoWaitMs();
    if (ms > 0) {
      // 如果设置了截止时间，避免把等待拖到截止之后（预留 80ms 安全边界）
      const guard = (typeof endTime === 'number') ? Math.max(0, endTime - Date.now() - 80) : ms;
      await sleep(Math.min(ms, guard));
    }
  }

  const now = Date.now();
  const pastDeadline = typeof endTime === 'number' && now >= endTime;

  if (pastDeadline) {
    if (!forceRetry) {
      const err = new Error('DEADLINE_PASSED');
      err.name = 'DeadlineError';
      err.details = { startTime, endTime, now };
      throw err;
    }
    const base = typeof startTime === 'number' ? startTime : now - retryDtOffsetMs;
    const dt = base + retryDtOffsetMs;
    const resp = await retryAnswer(problem, result, dt, { headers });
    return { route: 'retry', resp };
  }

  const resp = await answerProblem(problem, result, { headers, dt: now });
  return { route: 'answer', resp };
}
