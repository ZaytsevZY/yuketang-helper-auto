import assert from 'node:assert/strict';
import test from 'node:test';

const loadReminderPreferences = () => import('../src/core/reminder-preferences.js');

const EVENT_SWITCHES = [
  ['problem-start', 'notifyProblemStarts'],
  ['assessment-publish', 'notifyAssessmentPublishes'],
  ['courseware-publish', 'notifyCoursewarePublishes'],
  ['other-publish', 'notifyOtherPublishes'],
  ['lesson-finished', 'notifyLessonFinished'],
  ['auto-answer-scheduled', 'notifyAutoAnswerScheduled'],
  ['auto-answer-started', 'notifyAutoAnswerStarted'],
  ['auto-answer-succeeded', 'notifyAutoAnswerSucceeded'],
  ['auto-answer-failed', 'notifyAutoAnswerFailed'],
];

test('lets users disable every classroom reminder event independently', async () => {
  const { REMINDER_DEFAULTS, isReminderEnabled } = await loadReminderPreferences();

  for (const [kind, key] of EVENT_SWITCHES) {
    assert.equal(isReminderEnabled(kind, REMINDER_DEFAULTS), true, `${kind} default`);
    assert.equal(isReminderEnabled(kind, { ...REMINDER_DEFAULTS, [key]: false }), false, key);
  }
});

test('uses the master reminder switch to silence every event', async () => {
  const { REMINDER_DEFAULTS, isReminderEnabled } = await loadReminderPreferences();

  for (const [kind] of EVENT_SWITCHES) {
    assert.equal(isReminderEnabled(kind, { ...REMINDER_DEFAULTS, notifyProblems: false }), false, kind);
  }
});

test('lets users independently choose native notification, popup, and sound delivery', async () => {
  const { REMINDER_DEFAULTS, getReminderChannels } = await loadReminderPreferences();

  assert.deepEqual(getReminderChannels(REMINDER_DEFAULTS), {
    native: true,
    popup: true,
    sound: true,
  });
  assert.deepEqual(getReminderChannels({ ...REMINDER_DEFAULTS, notifyNative: false }), {
    native: false,
    popup: true,
    sound: true,
  });
  assert.deepEqual(getReminderChannels({ ...REMINDER_DEFAULTS, notifyPopup: false }), {
    native: true,
    popup: false,
    sound: true,
  });
  assert.deepEqual(getReminderChannels({ ...REMINDER_DEFAULTS, notifySound: false }), {
    native: true,
    popup: true,
    sound: false,
  });
});

test('preserves a user-selected zero notification volume', async () => {
  const { getReminderVolume } = await loadReminderPreferences();

  assert.equal(getReminderVolume({ notifyVolume: 0 }), 0);
  assert.equal(getReminderVolume({ notifyVolume: 0.35 }), 0.35);
  assert.equal(getReminderVolume({ notifyVolume: 4 }), 1);
  assert.equal(getReminderVolume({ notifyVolume: -1 }), 0);
  assert.equal(getReminderVolume({ notifyVolume: '' }), 0.6);
  assert.equal(getReminderVolume({}), 0.6);
});
