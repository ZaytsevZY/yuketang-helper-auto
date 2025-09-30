/**
 * Vuex 辅助工具 - 用于获取雨课堂主界面状态
 */

/**
 * 获取 Vue 根实例
 * @returns {Vue | null}
 */
export function getVueApp() {
    try {
        const app = document.querySelector('#app').__vue__;
        return app || null;
    } catch (e) {
        console.error('[getVueApp] 错误:', e);
        return null;
    }
}

/**
 * 从 Vuex state 获取主界面当前页面的 slideId
 * @returns {string | null}
 */
export function getCurrentMainPageSlideId() {
    try {
        const app = getVueApp();
        if (!app || !app.$store) {
            console.log('[getCurrentMainPageSlideId] 无法获取 Vue 实例或 store');
            return null;
        }

        const currSlide = app.$store.state.currSlide;
        if (!currSlide || !currSlide.sid) {
            console.log('[getCurrentMainPageSlideId] currSlide 或 sid 未定义');
            return null;
        }

        console.log('[getCurrentMainPageSlideId] 获取到 slideId:', currSlide.sid, {
            type: currSlide.type,
            problemID: currSlide.problemID,
            index: currSlide.index
        });

        return currSlide.sid;
    } catch (e) {
        console.error('[getCurrentMainPageSlideId] 错误:', e);
        return null;
    }
}

/**
 * 监听主界面页面切换
 * @param {Function} callback - 回调函数 (slideId, slideInfo) => void
 * @returns {Function} - 取消监听的函数
 */
export function watchMainPageChange(callback) {
    const app = getVueApp();
    if (!app || !app.$store) {
        console.error('[watchMainPageChange] 无法获取 Vue 实例');
        return () => {};
    }

    const unwatch = app.$store.watch(
        (state) => state.currSlide,
        (newSlide, oldSlide) => {
            if (newSlide && newSlide.sid) {
                console.log('[主界面页面切换]', {
                    oldSid: oldSlide?.sid,
                    newSid: newSlide.sid,
                    type: newSlide.type,
                    problemID: newSlide.problemID
                });
                
                callback(newSlide.sid, newSlide);
            }
        },
        { deep: false }
    );

    console.log('✅ 已启动主界面页面切换监听');
    return unwatch;
}

/**
 * 等待 Vue 实例准备就绪
 * @returns {Promise<Vue>}
 */
export function waitForVueReady() {
    return new Promise((resolve) => {
        const check = () => {
            const app = getVueApp();
            if (app && app.$store) {
                resolve(app);
            } else {
                setTimeout(check, 100);
            }
        };
        check();
    });
}