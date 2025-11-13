/**
 * Vuex 辅助工具 - 用于获取雨课堂主界面状态（附加调试日志）
 */

const L = (...a) => console.log('[雨课堂助手][DBG][vuex-helper]', ...a);
const W = (...a) => console.warn('[雨课堂助手][WARN][vuex-helper]', ...a);
const E = (...a) => console.error('[雨课堂助手][ERR][vuex-helper]', ...a);

export function getVueApp() {
  try {
    const app = document.querySelector('#app')?.__vue__;
    if (!app) W('getVueApp: 找不到 #app.__vue__');
    return app || null;
  } catch (e) {
    E('getVueApp 错误:', e);
    return null;
  }
}

/**
 * 统一返回「字符串」，并打印原始类型
 */
export function getCurrentMainPageSlideId() {
  try {
    const app = getVueApp();
    if (!app || !app.$store) {
      W('getCurrentMainPageSlideId: 无 app 或 store');
      return null;
    }
    const currSlide = app.$store.state?.currSlide;
    if (!currSlide) {
      L('getCurrentMainPageSlideId: currSlide 为 null/undefined');
      return null;
    }
    const rawSid = currSlide.sid;
    const sidStr = rawSid == null ? null : String(rawSid);

    console.log(
      '[getCurrentMainPageSlideId] 获取到 slideId:',
      sidStr,
      '{type:', currSlide.type, ', problemID:', currSlide.problemID, ', index:', currSlide.index, '}',
      '(raw type:', typeof rawSid, ', raw value:', rawSid, ')'
    );

    return sidStr;
  } catch (e) {
    E('getCurrentMainPageSlideId 错误:', e);
    return null;
  }
}

export function watchMainPageChange(callback) {
  const app = getVueApp();
  if (!app || !app.$store) {
    E('watchMainPageChange: 无法获取 Vue 实例或 store');
    return () => {};
  }
  const unwatch = app.$store.watch(
    (state) => state.currSlide,
    (ns, os) => {
      const newSid = ns?.sid == null ? null : String(ns.sid);
      const oldSid = os?.sid == null ? null : String(os.sid);
      L('主界面页面切换', {
        oldSid, newSid,
        newType: ns?.type, newProblemID: ns?.problemID, newIndex: ns?.index,
        rawNewSidType: typeof ns?.sid
      });
      if (newSid) callback(newSid, ns);
    },
    { deep: false }
  );
  L('已启动主界面页面切换监听');
  return unwatch;
}

export function waitForVueReady() {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const check = () => {
      const app = getVueApp();
      if (app && app.$store) {
        L('waitForVueReady: ok, elapsed(ms)=', Date.now() - t0);
        resolve(app);
      } else {
        setTimeout(check, 100);
      }
    };
    check();
  });
}
