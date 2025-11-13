// src/net/ws-interceptor.js
import { gm } from '../core/env.js';
import { actions } from '../state/actions.js';
import { repo } from '../state/repo.js';

export function installWSInterceptor() {

  // 环境识别（标准/荷塘/未知），主要用于日志和后续按需适配
  function detectEnvironmentAndAdaptAPI() {
    const hostname = location.hostname;
    let envType = 'unknown';
    if (hostname === 'www.yuketang.cn') {
      envType = 'standard';
      console.log('[雨课堂助手][INFO] 检测到标准雨课堂环境');
    } else if (hostname === 'pro.yuketang.cn') {
      envType = 'pro';
      console.log('[雨课堂助手][INFO] 检测到荷塘雨课堂环境');
    } else {
      console.log('[雨课堂助手][INFO] 未知环境:', hostname);
    }
    return envType;
  }

  class MyWebSocket extends WebSocket {
    static handlers = [];
    static addHandler(h) { this.handlers.push(h); }
    constructor(url, protocols) {
      super(url, protocols);
      const parsed = new URL(url, location.href);
      for (const h of this.constructor.handlers) h(this, parsed);
    }
    intercept(cb) {
      const raw = this.send;
      this.send = (data) => { try { cb(JSON.parse(data)); } catch {} return raw.call(this, data); };
    }
    listen(cb) { this.addEventListener('message', (e) => { try { cb(JSON.parse(e.data)); } catch {} }); }
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
    console.log('[雨课堂助手][INFO] 拦截WebSocket通信 - 环境:', envType);
    console.log('[雨课堂助手][INFO] WebSocket连接尝试:', url.href);

    // 更宽松的路径匹配
    const wsPath = url.pathname || '';
    const isRainClassroomWS =
      wsPath === '/wsapp/' ||
      wsPath.includes('/ws') ||
      wsPath.includes('/websocket') ||
      url.href.includes('websocket');

    if (!isRainClassroomWS) {
      console.log('[雨课堂助手][ERR] 非雨课堂WebSocket:', wsPath);
      return;
    }
    console.log('[雨课堂助手][INFO] 检测到雨课堂WebSocket连接:', wsPath);

    // 发送侧拦截（可用于调试）
    ws.intercept((message) => {
      console.log('[雨课堂助手][INFO] WebSocket发送:', message);
    });

    // 接收侧统一分发
    ws.listen((message) => {
      try {
        console.log('[雨课堂助手][INFO] WebSocket接收:', message);
        switch (message.op) {
          case 'fetchtimeline':
            console.log('[雨课堂助手][INFO] 收到时间线:', message.timeline);
            actions.onFetchTimeline(message.timeline);
            break;
          case 'unlockproblem':
            console.log('[雨课堂助手][INFO] 收到解锁问题:', message.problem);
            actions.onUnlockProblem(message.problem);
            break;
          case 'lessonfinished':
            console.log('[雨课堂助手][INFO] 课程结束');
            actions.onLessonFinished();
            break;
          default:
            console.log('[雨课堂助手][WARN] 未知WebSocket操作:', message.op, message);
        }
        // 监听后端传递的url
        const url = (function findUrl(obj){
        if (!obj || typeof obj !== 'object') return null;
        if (typeof obj.url === 'string') return obj.url;
        if (Array.isArray(obj)) { for (const it of obj){ const u = findUrl(it); if (u) return u; } }
        else { for (const k in obj){ const v = obj[k]; if (v && typeof v==='object'){ const u = findUrl(v); if (u) return u; } } }
        return null;
      })(message);
      if (url) {
        window.dispatchEvent(new CustomEvent('ykt:url-change', { detail: { url, raw: message } }));
        // 如需持久化到 repo，请取消下一行注释（确保已在 repo 定义该字段）
        repo.currentSelectedUrl = url;
        console.debug('[雨课堂助手][INFO] 当前选择 URL:', url);
      }
      } catch (e) {
        console.debug('[雨课堂助手][ERR] 解析WebSocket消息失败', e, message);
      }
    });
  });

  gm.uw.WebSocket = MyWebSocket;
}

// ===== 主动为某个课堂建立/复用 WebSocket 连接 =====
export function connectOrAttachLessonWS({ lessonId, auth }) {
  if (!lessonId || !auth) {
    console.warn('[雨课堂助手][WARN] 缺少 lessonId 或 auth，放弃建链');
    return null;
  }
  if (repo.isLessonConnected(lessonId)) {
    return repo.lessonSockets.get(lessonId);
  }

  // 根据当前域名选择 ws 地址（标准/荷塘）
  const host = location.hostname === 'pro.yuketang.cn'
    ? 'wss://pro.yuketang.cn/wsapp/'
    : 'wss://www.yuketang.cn/wsapp/';

  const ws = new WebSocket(host);

  ws.addEventListener('open', () => {
    try {
      const hello = {
        op: 'hello',
        // userid 可选：尽力获取，获取不到也不阻断流程
        userid: getUserIdSafe(),
        role: 'student',
        auth,              // 关键：lessonToken
        lessonid: lessonId // 关键：目标课堂
      };
      ws.send(JSON.stringify(hello));
      console.log('[雨课堂助手][INFO][AutoJoin] 已发送 hello 握手:', hello);
    } catch (e) {
      console.error('[雨课堂助手][INFO][AutoJoin] 发送 hello 失败:', e);
    }
  });

  ws.addEventListener('close', () => {
    console.log('[雨课堂助手][WARN][AutoJoin] 课堂 WS 关闭:', lessonId);
  });
  ws.addEventListener('error', (e) => {
    console.error('[雨课堂助手][ERR][AutoJoin] 课堂 WS 错误:', lessonId, e);
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
  return undefined;
}