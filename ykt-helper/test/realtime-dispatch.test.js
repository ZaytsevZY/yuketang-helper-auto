import assert from 'node:assert/strict';
import test from 'node:test';

const loadRealtimeDispatch = () => import('../src/core/realtime-dispatch.js');

test('sends mobile realtime problem events through the notification-only path', async () => {
  const { dispatchRealtimeMessage } = await loadRealtimeDispatch();
  const calls = [];

  const result = dispatchRealtimeMessage({
    op: 'unlockproblem',
    problem: 'problem-101',
    sid: 'slide-5',
  }, {
    getRuntimeMode: () => 'mobile-reminder',
    handlers: {
      onUnlockProblem(problem, options) {
        calls.push({ problem, options });
      },
    },
  });

  assert.equal(result.realtime.kind, 'unlockproblem');
  assert.equal(result.notificationOnly, true);
  assert.deepEqual(calls, [{
    problem: { op: 'unlockproblem', problem: 'problem-101', sid: 'slide-5', prob: 'problem-101' },
    options: { notificationOnly: true },
  }]);
});

test('keeps desktop realtime events on the normal action path', async () => {
  const { dispatchRealtimeMessage } = await loadRealtimeDispatch();
  const calls = [];

  dispatchRealtimeMessage({ op: 'fetchtimeline', timeline: [{ type: 'problem' }] }, {
    getRuntimeMode: () => 'desktop',
    handlers: {
      onFetchTimeline(timeline, options) {
        calls.push({ timeline, options });
      },
    },
  });

  assert.deepEqual(calls, [{
    timeline: [{ type: 'problem' }],
    options: { notificationOnly: false },
  }]);
});
