import assert from 'node:assert/strict';
import test from 'node:test';

const loadRuntimeMode = () => import('../src/core/runtime-mode.js');

test('uses the notification-only runtime on mobile /m/v2 routes', async () => {
  const { getRuntimeMode } = await loadRuntimeMode();

  assert.equal(getRuntimeMode('/m/v2'), 'mobile-reminder');
  assert.equal(getRuntimeMode('/m/v2/lesson/42'), 'mobile-reminder');
  assert.equal(getRuntimeMode('/v2/web/lesson/42'), 'desktop');
});

test('waits at the root entry but never starts desktop features on mobile routes', async () => {
  const { shouldStartDesktopRuntime } = await loadRuntimeMode();

  assert.equal(shouldStartDesktopRuntime('/'), false);
  assert.equal(shouldStartDesktopRuntime('/m/v2'), false);
  assert.equal(shouldStartDesktopRuntime('/m/v2/lesson/42'), false);
  assert.equal(shouldStartDesktopRuntime('/v2/web/lesson/42'), true);
});
