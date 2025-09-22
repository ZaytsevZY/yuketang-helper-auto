import { createApp } from 'vue';
import { GM_openInTab, GM_getTab, GM_saveTab, GM_getTabs, unsafeWindow } from '$';
import './style.css';
import App from './App.vue';
import storage from './storage';
import * as API from "./api";
import { MyWebSocket, MyXMLHttpRequest } from './network';

const url = new URL(window.location.href);

if (url.pathname.startsWith("/lesson/fullscreen/v3/")) {
  launchLessonHelper();
} else if (url.pathname.startsWith("/v2/web/")) {
  pollActiveLessons();
}

function launchLessonHelper() {
  GM_getTab((tab) => {
    tab.type = "lesson";
    tab.lessonId = url.pathname.split("/")[4];
    GM_saveTab(tab);
  });

  const run = () => {
    const el = document.createElement('div');
    document.body.append(el);
    createApp(App).mount(el);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
}

function pollActiveLessons() {
  const enteredLessonIds = new Set();

  function updateLessonIds() {
    return new Promise((resolve) => {
      GM_getTabs((tabs) => {
        for (const key in tabs) {
          const tab = tabs[key];
          if (tab.type === "lesson") {
            enteredLessonIds.add(tab.lessonId);
          }
        }
        resolve();
      });
    });
  }

  async function checkActiveLessons() {
    const resp = await API.getActiveLessons();
    if (resp.code !== 0) {
      throw new Error("Failed to get active lessons: " + resp.msg);
    }

    for (const lesson of resp.data.onLessonClassrooms) {
      const { classroomId, lessonId } = lesson;

      if (!enteredLessonIds.has(lessonId)) {
        const url = new URL(`/lesson/fullscreen/v3/${lessonId}`, location.origin);
        GM_openInTab(url.href, { active: false });
        enteredLessonIds.add(lessonId);
      }
    }
  }

  updateLessonIds();

  setInterval(async () => {
    await updateLessonIds();
    await checkActiveLessons();
  }, 5000);
}

unsafeWindow.WebSocket = MyWebSocket;
unsafeWindow.XMLHttpRequest = MyXMLHttpRequest;
unsafeWindow.yktStorage = storage;
unsafeWindow.yktAPI = API;
