import assert from 'node:assert/strict';
import test from 'node:test';

const loadScreenWakeLock = () => import('../src/core/screen-wake-lock.js');

class FakeDocument {
  constructor() {
    this.visibilityState = 'visible';
    this.hidden = false;
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    this.listeners.set(type, listeners.filter(item => item !== listener));
  }

  setVisibility(visibilityState) {
    this.visibilityState = visibilityState;
    this.hidden = visibilityState !== 'visible';
    for (const listener of this.listeners.get('visibilitychange') || []) listener();
  }
}

class FakeWakeLockSentinel {
  constructor() {
    this.released = false;
    this.releaseCount = 0;
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  async release() {
    this.releaseCount += 1;
    this.released = true;
    for (const listener of this.listeners.get('release') || []) listener();
  }
}

function makeWakeLockEnvironment({ pathname = '/v2/web/lesson/42' } = {}) {
  const document = new FakeDocument();
  const sentinels = [];
  const requests = [];
  const navigator = {
    wakeLock: {
      async request(type) {
        requests.push(type);
        const sentinel = new FakeWakeLockSentinel();
        sentinels.push(sentinel);
        return sentinel;
      },
    },
  };
  const location = { pathname };
  return { document, location, navigator, requests, sentinels };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

test('recognizes both classroom URL shapes', async () => {
  const { isClassroomPath } = await loadScreenWakeLock();

  assert.equal(isClassroomPath('/lesson/fullscreen/v3/lesson-1'), true);
  assert.equal(isClassroomPath('/v2/web/lesson/lesson-1'), true);
  assert.equal(isClassroomPath('/v2/web/index'), false);
});

test('acquires the screen wake lock only while an enabled classroom is visible', async () => {
  const { createScreenWakeLock } = await loadScreenWakeLock();
  const env = makeWakeLockEnvironment();
  const wakeLock = createScreenWakeLock({
    getDocument: () => env.document,
    getLocation: () => env.location,
    getNavigator: () => env.navigator,
  });

  const result = await wakeLock.setEnabled(true);

  assert.deepEqual(env.requests, ['screen']);
  assert.equal(result.active, true);
  assert.equal(env.sentinels[0].released, false);
});

test('releases the screen wake lock as soon as the user disables it', async () => {
  const { createScreenWakeLock } = await loadScreenWakeLock();
  const env = makeWakeLockEnvironment();
  const wakeLock = createScreenWakeLock({
    getDocument: () => env.document,
    getLocation: () => env.location,
    getNavigator: () => env.navigator,
  });

  await wakeLock.setEnabled(true);
  const result = await wakeLock.setEnabled(false);

  assert.equal(result.active, false);
  assert.equal(env.sentinels[0].released, true);
  assert.equal(env.sentinels[0].releaseCount, 1);
});

test('reacquires the wake lock when the visible classroom returns from the background', async () => {
  const { createScreenWakeLock } = await loadScreenWakeLock();
  const env = makeWakeLockEnvironment();
  const wakeLock = createScreenWakeLock({
    getDocument: () => env.document,
    getLocation: () => env.location,
    getNavigator: () => env.navigator,
  });

  await wakeLock.setEnabled(true);
  env.document.setVisibility('hidden');
  await flush();
  assert.equal(env.sentinels[0].released, true);

  env.document.setVisibility('visible');
  await flush();
  assert.deepEqual(env.requests, ['screen', 'screen']);
  assert.equal(env.sentinels[1].released, false);
});

test('does not request a wake lock outside a classroom page', async () => {
  const { createScreenWakeLock } = await loadScreenWakeLock();
  const env = makeWakeLockEnvironment({ pathname: '/v2/web/index' });
  const wakeLock = createScreenWakeLock({
    getDocument: () => env.document,
    getLocation: () => env.location,
    getNavigator: () => env.navigator,
  });

  const result = await wakeLock.setEnabled(true);

  assert.equal(result.active, false);
  assert.equal(result.reason, 'not-classroom');
  assert.deepEqual(env.requests, []);
});

test('reports an unsupported browser without throwing', async () => {
  const { createScreenWakeLock } = await loadScreenWakeLock();
  const env = makeWakeLockEnvironment();
  const wakeLock = createScreenWakeLock({
    getDocument: () => env.document,
    getLocation: () => env.location,
    getNavigator: () => ({}),
  });

  const result = await wakeLock.setEnabled(true);

  assert.equal(result.active, false);
  assert.equal(result.reason, 'unsupported');
});
