import assert from 'node:assert/strict';
import test from 'node:test';

const loadSettingsForm = () => import('../src/core/settings-form.js');

test('does not mutate any profile field when temperature validation fails', async () => {
  const { applyProfileForm } = await loadSettingsForm();
  const profile = {
    id: 'profile-1',
    name: 'old name',
    baseUrl: 'https://old.example/v1',
    apiKey: 'old-key',
    model: 'old-model',
    visionModel: 'old-vision',
    temperature: 0.2,
  };

  const result = applyProfileForm(profile, {
    name: 'new name',
    baseUrl: 'https://new.example/v1',
    apiKey: 'new-key',
    model: 'new-model',
    visionModel: 'new-vision',
    temperature: '2.1',
  });

  assert.deepEqual(result, { ok: false, field: 'temperature' });
  assert.deepEqual(profile, {
    id: 'profile-1',
    name: 'old name',
    baseUrl: 'https://old.example/v1',
    apiKey: 'old-key',
    model: 'old-model',
    visionModel: 'old-vision',
    temperature: 0.2,
  });
});

test('writes every profile field together after temperature validation succeeds', async () => {
  const { applyProfileForm } = await loadSettingsForm();
  const profile = {
    id: 'profile-1',
    name: 'old name',
    baseUrl: 'https://old.example/v1',
    apiKey: 'old-key',
    model: 'old-model',
    visionModel: 'old-vision',
    temperature: '',
  };

  const result = applyProfileForm(profile, {
    name: 'new name',
    baseUrl: 'https://new.example/v1',
    apiKey: 'new-key',
    model: 'new-model',
    visionModel: 'new-vision',
    temperature: '1',
  });

  assert.equal(result.ok, true);
  assert.deepEqual(profile, {
    id: 'profile-1',
    name: 'new name',
    baseUrl: 'https://new.example/v1',
    apiKey: 'new-key',
    model: 'new-model',
    visionModel: 'new-vision',
    temperature: 1,
  });
});

test('syncs every reminder checkbox from the current configuration when a panel opens', async () => {
  const { syncReminderForm } = await loadSettingsForm();
  const fields = Object.fromEntries([
    'notifyProblems',
    'notifyProblemStarts',
    'notifyAssessmentPublishes',
    'notifyCoursewarePublishes',
    'notifyOtherPublishes',
    'notifyLessonFinished',
    'notifyAutoAnswerScheduled',
    'notifyAutoAnswerStarted',
    'notifyAutoAnswerSucceeded',
    'notifyAutoAnswerFailed',
    'notifyNative',
    'notifyPopup',
    'notifySound',
  ].map(key => [key, { checked: true }]));

  syncReminderForm(fields, {
    notifyProblems: false,
    notifyProblemStarts: false,
    notifyAssessmentPublishes: true,
    notifyCoursewarePublishes: false,
    notifyOtherPublishes: true,
    notifyLessonFinished: false,
    notifyAutoAnswerScheduled: true,
    notifyAutoAnswerStarted: false,
    notifyAutoAnswerSucceeded: true,
    notifyAutoAnswerFailed: false,
    notifyNative: false,
    notifyPopup: true,
    notifySound: false,
  });

  assert.deepEqual(Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.checked])), {
    notifyProblems: false,
    notifyProblemStarts: false,
    notifyAssessmentPublishes: true,
    notifyCoursewarePublishes: false,
    notifyOtherPublishes: true,
    notifyLessonFinished: false,
    notifyAutoAnswerScheduled: true,
    notifyAutoAnswerStarted: false,
    notifyAutoAnswerSucceeded: true,
    notifyAutoAnswerFailed: false,
    notifyNative: false,
    notifyPopup: true,
    notifySound: false,
  });
});
