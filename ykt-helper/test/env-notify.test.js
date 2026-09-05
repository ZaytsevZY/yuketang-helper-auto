import assert from 'node:assert/strict';
import test from 'node:test';

async function withWindow(fakeWindow, callback) {
  const previous = globalThis.window;
  globalThis.window = fakeWindow;
  try {
    const moduleUrl = new URL('../src/core/env.js', import.meta.url);
    moduleUrl.searchParams.set('test', String(Math.random()));
    const { gm } = await import(moduleUrl.href);
    await callback(gm);
  } finally {
    globalThis.window = previous;
  }
}

test('uses a granted browser notification when a mobile host has no GM notification API', async () => {
  const notices = [];
  class FakeNotification {
    static permission = 'granted';
    constructor(title, options) {
      this.title = title;
      this.options = options;
      notices.push(this);
    }
    close() {}
  }

  await withWindow({ Notification: FakeNotification }, gm => {
    gm.notify({ title: '新题提醒', text: '请查看课堂', timeout: 1 });
  });

  assert.equal(notices.length, 1);
  assert.equal(notices[0].title, '新题提醒');
  assert.equal(notices[0].options.body, '请查看课堂');
});

test('does not invoke the browser notification constructor without granted permission', async () => {
  let calls = 0;
  class FakeNotification {
    static permission = 'default';
    constructor() { calls += 1; }
  }

  await withWindow({ Notification: FakeNotification }, gm => {
    gm.notify({ title: '新题提醒', text: '请查看课堂' });
  });

  assert.equal(calls, 0);
});
