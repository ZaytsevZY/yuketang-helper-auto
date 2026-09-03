import assert from 'node:assert/strict';
import test from 'node:test';

const loadPublishReminder = () => import('../src/state/publish-reminder.js');

const assessment = {
  category: 'assessment',
  dedupeKey: 'assessment:quiz-7',
  title: '考试/测试题组已发布',
  detail: '第三章测试',
};

test('notifies a published group once while repeated websocket events arrive', async () => {
  const { createPublishReminder } = await loadPublishReminder();
  const notices = [];
  const reminder = createPublishReminder({
    notify: event => notices.push(event),
    now: () => 1_000,
  });

  assert.equal(reminder.handle(assessment, {}), true);
  assert.equal(reminder.handle(assessment, {}), false);
  assert.deepEqual(notices, [assessment]);
});

test('does not notify a release category that the user disabled', async () => {
  const { createPublishReminder } = await loadPublishReminder();
  const notices = [];
  const reminder = createPublishReminder({
    notify: event => notices.push(event),
  });

  assert.equal(reminder.handle(assessment, { notifyAssessmentPublishes: false }), false);
  assert.deepEqual(notices, []);
});

test('allows the same group to notify again after the dedupe window', async () => {
  const { createPublishReminder } = await loadPublishReminder();
  const notices = [];
  let now = 1_000;
  const reminder = createPublishReminder({
    notify: event => notices.push(event),
    now: () => now,
    dedupeMs: 60_000,
  });

  reminder.handle(assessment, {});
  now += 60_001;

  assert.equal(reminder.handle(assessment, {}), true);
  assert.equal(notices.length, 2);
});
