import assert from 'node:assert/strict';
import test from 'node:test';

const loadPublishEvents = () => import('../src/core/publish-events.js');

test('classifies an exam or test group publication as an assessment reminder', async () => {
  const { classifyPublishEvent } = await loadPublishEvents();

  const event = classifyPublishEvent({
    op: 'publishproblem',
    quiz: { id: 'quiz-7', title: '第三章测试' },
  });

  assert.deepEqual(event, {
    category: 'assessment',
    dedupeKey: 'assessment:quiz-7',
    title: '考试/测试题组已发布',
    detail: '第三章测试',
  });
});

test('reads an assessment group nested inside a websocket data payload', async () => {
  const { classifyPublishEvent } = await loadPublishEvents();

  const event = classifyPublishEvent({
    op: 'sendproblem',
    data: { quiz: { id: 'quiz-42', name: '单元测验' } },
  });

  assert.deepEqual(event, {
    category: 'assessment',
    dedupeKey: 'assessment:quiz-42',
    title: '考试/测试题组已发布',
    detail: '单元测验',
  });
});

test('classifies a published presentation as a courseware reminder', async () => {
  const { classifyPublishEvent } = await loadPublishEvents();

  const event = classifyPublishEvent({
    op: 'publishpresentation',
    presentation: { id: 'ppt-9', title: '概率论第 2 讲' },
  });

  assert.deepEqual(event, {
    category: 'courseware',
    dedupeKey: 'courseware:ppt-9',
    title: '课件已发布',
    detail: '概率论第 2 讲',
  });
});

test('does not mistake a displayed slide for a newly published courseware item', async () => {
  const { classifyPublishEvent } = await loadPublishEvents();

  assert.equal(classifyPublishEvent({
    op: 'showslide',
    data: { slide: { id: 'slide-2', title: '第 2 页' } },
  }), null);
});

test('does not treat opening an existing presentation as a courseware publication', async () => {
  const { classifyPublishEvent } = await loadPublishEvents();

  assert.equal(classifyPublishEvent({
    op: 'openpresentation',
    presentation: { id: 'ppt-9', title: '概率论第 2 讲' },
  }), null);
});

test('keeps an unclassified publish event selectable as a generic release reminder', async () => {
  const { classifyPublishEvent } = await loadPublishEvents();

  const event = classifyPublishEvent({
    op: 'publishactivity',
    activity: { id: 'activity-5', title: '课堂活动' },
  });

  assert.deepEqual(event, {
    category: 'other',
    dedupeKey: 'other:activity-5',
    title: '课堂内容已发布',
    detail: '课堂活动',
  });
});

test('ignores ordinary websocket messages that are not publication events', async () => {
  const { classifyPublishEvent } = await loadPublishEvents();

  assert.equal(classifyPublishEvent({ op: 'chatmessage', text: 'hello' }), null);
});

test('honors each publish-reminder category independently', async () => {
  const { isPublishReminderEnabled } = await loadPublishEvents();

  assert.equal(isPublishReminderEnabled({ category: 'assessment' }, {
    notifyAssessmentPublishes: false,
    notifyCoursewarePublishes: true,
    notifyOtherPublishes: true,
  }), false);
  assert.equal(isPublishReminderEnabled({ category: 'courseware' }, {
    notifyAssessmentPublishes: false,
    notifyCoursewarePublishes: true,
    notifyOtherPublishes: true,
  }), true);
  assert.equal(isPublishReminderEnabled({ category: 'other' }, {
    notifyAssessmentPublishes: false,
    notifyCoursewarePublishes: true,
    notifyOtherPublishes: false,
  }), false);
});

test('uses the existing bell switch as a global off switch for publish reminders', async () => {
  const { isPublishReminderEnabled } = await loadPublishEvents();

  assert.equal(isPublishReminderEnabled({ category: 'assessment' }, {
    notifyProblems: false,
    notifyAssessmentPublishes: true,
  }), false);
});

test('routes a group publication to the notification path rather than the answer path', async () => {
  const { getRealtimeEvent } = await loadPublishEvents();

  assert.deepEqual(getRealtimeEvent({
    op: 'sendproblem',
    quiz: { id: 'quiz-8', title: '随堂测试' },
  }), {
    kind: 'publish',
    event: {
      category: 'assessment',
      dedupeKey: 'assessment:quiz-8',
      title: '考试/测试题组已发布',
      detail: '随堂测试',
    },
  });
});
