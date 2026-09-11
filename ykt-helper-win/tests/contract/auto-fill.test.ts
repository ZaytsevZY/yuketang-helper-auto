import { effectScope, nextTick } from 'vue';
import type * as Vue from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DefaultAppSettings, ProblemType } from '@ykt/contracts';
import { createBackendRuntime } from '@ykt/backend';
import AssistantPanel from '../../apps/desktop/renderer/src/components/AssistantPanel.vue';

vi.mock('vue', async (importOriginal) => ({
  ...(await importOriginal<typeof Vue>()),
  onMounted: vi.fn(),
  onUnmounted: vi.fn(),
  useSSRContext: () => ({ modules: new Set() }),
}));

const scopes: ReturnType<typeof effectScope>[] = [];
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setupPanel() {
  vi.useFakeTimers();
  const api = {
    generateAnswerProposal: vi.fn(async ({ problemId }) => ({
      id: `proposal-${problemId}`,
      problemId,
      status: 'ready',
      answer: ['A', 'C'],
    })),
    validateAnswer: vi.fn(async () => ({ valid: true, issues: [] })),
    submitAnswer: vi.fn(async () => ({
      submittedAt: new Date().toISOString(),
    })),
    listProblems: vi.fn(async () => []),
    listPresentations: vi.fn(async () => []),
    updateSettings: vi.fn(async (patch) => ({
      ...DefaultAppSettings,
      ...patch,
    })),
  };
  vi.stubGlobal('window', { yuketang: api });
  const emit = vi.fn();
  const scope = effectScope();
  scopes.push(scope);
  const panel = scope.run(() =>
    (AssistantPanel as any).setup(
      { page: 'classroom', environment: 'changjiang' },
      { expose: vi.fn(), emit },
    ),
  );
  panel.applySettings({
    ...DefaultAppSettings,
    llmAutoGenerate: true,
    llmManagedSubmit: false,
    notifyProblems: false,
  });
  const problem = {
    id: 'p1',
    lessonId: 'l1',
    type: ProblemType.MultipleChoice,
    status: 'available',
    prompt: 'Select options',
    options: ['one', 'two', 'three'],
  };
  panel.problems.value = [problem];
  panel.selectedLessonId.value = 'l1';
  return { panel, api, problem, emit };
}

describe('automatic draft-only answers', () => {
  it('requires validation and explicit user confirmation before manual submission', async () => {
    const { panel, api, problem } = setupPanel();
    await panel.onAvailableProblem(problem);
    await vi.advanceTimersByTimeAsync(6000);
    await panel.submitAnswer();
    expect(api.submitAnswer).not.toHaveBeenCalled();
    await panel.validateAnswer();
    await panel.submitAnswer();
    expect(api.submitAnswer).not.toHaveBeenCalled();
    panel.confirmed.value = true;
    await panel.submitAnswer();
    expect(api.submitAnswer).toHaveBeenCalledExactlyOnceWith({
      problemId: 'p1',
      answer: 'AC',
      proposalId: 'proposal-p1',
      confirmedBy: 'user',
    });
  });

  it('does not fill or submit when the model fails', async () => {
    const { panel, api, problem } = setupPanel();
    api.generateAnswerProposal.mockRejectedValueOnce(
      new Error('model unavailable'),
    );
    await panel.onAvailableProblem(problem);
    await vi.advanceTimersByTimeAsync(6000);
    expect(panel.answerDraft.value).toBe('');
    expect(panel.currentAiSession.value.messages.at(-1).content).toBe(
      'model unavailable',
    );
    expect(api.submitAnswer).not.toHaveBeenCalled();
  });

  it('cancels pending work when the feature is disabled', async () => {
    const { panel, api, problem } = setupPanel();
    await panel.onAvailableProblem(problem);
    panel.settings.value.llmAutoGenerate = false;
    await vi.advanceTimersByTimeAsync(6000);
    expect(api.generateAnswerProposal).not.toHaveBeenCalled();
    expect(api.submitAnswer).not.toHaveBeenCalled();
  });

  it('selects a new question and fills options without validating or submitting', async () => {
    const { panel, api, problem, emit } = setupPanel();
    await panel.onAvailableProblem(problem);
    await vi.advanceTimersByTimeAsync(6000);
    expect(panel.selectedProblemId.value).toBe('p1');
    expect(panel.selectedLetters.value).toEqual(['A', 'C']);
    expect(panel.confirmed.value).toBe(false);
    expect(panel.canSubmit.value).toBe(false);
    expect(emit).toHaveBeenCalledWith('selectPage', 'problems');
    expect(api.validateAnswer).not.toHaveBeenCalled();
    expect(api.submitAnswer).not.toHaveBeenCalled();
    expect(panel.infoMessage.value).toContain('尚未提交');
  });

  it('waits while busy and preserves separate drafts for multiple questions', async () => {
    const { panel, api, problem } = setupPanel();
    const second = { ...problem, id: 'p2' };
    panel.problems.value.push(second);
    panel.busy.value = 'settings';
    await panel.onAvailableProblem(problem);
    await panel.onAvailableProblem(second);
    await vi.advanceTimersByTimeAsync(6000);
    expect(api.generateAnswerProposal).not.toHaveBeenCalled();
    panel.busy.value = '';
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.generateAnswerProposal).toHaveBeenCalledTimes(2);
    panel.selectedProblemId.value = 'p1';
    await nextTick();
    expect(panel.answerDraft.value).toBe('AC');
    panel.answerDraft.value = 'B';
    await nextTick();
    panel.selectedProblemId.value = 'p2';
    await nextTick();
    expect(panel.answerDraft.value).toBe('AC');
    panel.selectedProblemId.value = 'p1';
    await nextTick();
    expect(panel.answerDraft.value).toBe('B');
    expect(api.submitAnswer).not.toHaveBeenCalled();
  });

  it('keeps in-flight draft-only analysis from submitting after the mode changes', async () => {
    const { panel, api, problem } = setupPanel();
    panel.selectedProblemId.value = problem.id;
    await nextTick();
    let resolve!: (value: any) => void;
    api.generateAnswerProposal.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const analysis = panel.analyzeProblem(true);
    panel.settings.value.llmManagedSubmit = true;
    resolve({
      id: 'proposal-p1',
      problemId: 'p1',
      status: 'ready',
      answer: ['B'],
    });
    await analysis;
    expect(panel.answerDraft.value).toBe('B');
    expect(api.submitAnswer).not.toHaveBeenCalled();
  });

  it('serializes overlapping automatic requests and keeps both drafts', async () => {
    const { panel, api, problem } = setupPanel();
    const second = { ...problem, id: 'p2' };
    panel.problems.value.push(second);
    let resolve!: (value: any) => void;
    api.generateAnswerProposal.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await panel.onAvailableProblem(problem);
    await panel.onAvailableProblem(second);
    await vi.advanceTimersByTimeAsync(6000);
    expect(api.generateAnswerProposal).toHaveBeenCalledTimes(1);
    expect(panel.selectedProblemId.value).toBe('p1');
    resolve({
      id: 'proposal-p1',
      problemId: 'p1',
      status: 'ready',
      answer: ['B'],
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.generateAnswerProposal).toHaveBeenCalledTimes(2);
    expect(panel.answerDraft.value).toBe('AC');
    panel.selectedProblemId.value = 'p1';
    await nextTick();
    expect(panel.answerDraft.value).toBe('B');
    expect(api.submitAnswer).not.toHaveBeenCalled();
  });

  it.each(['lesson changed', 'deadline passed'])(
    'does not prefill after %s while AI is pending',
    async (reason) => {
      const { panel, api, problem, emit } = setupPanel();
      panel.selectedProblemId.value = problem.id;
      await nextTick();
      let resolve!: (value: any) => void;
      api.generateAnswerProposal.mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      );
      const analysis = panel.analyzeProblem(true);
      if (reason === 'lesson changed') panel.selectedLessonId.value = 'l2';
      else panel.problems.value = [{ ...problem, deadlineAt: Date.now() - 1 }];
      resolve({
        id: 'proposal-p1',
        problemId: 'p1',
        status: 'ready',
        answer: ['A'],
      });
      await analysis;
      expect(panel.answerDraft.value).toBe('');
      expect(emit).not.toHaveBeenCalledWith('selectPage', 'problems');
      expect(api.submitAnswer).not.toHaveBeenCalled();
    },
  );

  it('does not overwrite another question when an AI response arrives late', async () => {
    const { panel, api, problem } = setupPanel();
    panel.problems.value.push({ ...problem, id: 'p2' });
    panel.selectedProblemId.value = problem.id;
    await nextTick();
    let resolve!: (value: any) => void;
    api.generateAnswerProposal.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const analysis = panel.analyzeProblem(true);
    panel.selectedProblemId.value = 'p2';
    await nextTick();
    panel.answerDraft.value = 'B';
    resolve({
      id: 'proposal-p1',
      problemId: 'p1',
      status: 'ready',
      answer: ['A'],
    });
    await analysis;
    expect(panel.answerDraft.value).toBe('B');
    expect(api.submitAnswer).not.toHaveBeenCalled();
    panel.selectedProblemId.value = 'p1';
    await nextTick();
    expect(panel.answerDraft.value).toBe('A');
    expect(panel.appliedProposalId.value).toBe('proposal-p1');
  });

  it('persists generation without managed submission using upstream settings', async () => {
    const { panel, api } = setupPanel();
    await panel.saveSettings();
    expect(api.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        llmAutoGenerate: true,
        llmManagedSubmit: false,
      }),
    );
  });

  it('blocks agent submissions at the backend while leaving user submissions available', async () => {
    const runtime = createBackendRuntime();
    await runtime.start();
    await runtime.facade.updateSettings({
      llmAutoGenerate: true,
      llmManagedSubmit: false,
    });
    const input = { problemId: 'missing', answer: ['A'] };
    await expect(
      runtime.facade.submitAnswer({ ...input, confirmedBy: 'agent' }),
    ).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    await expect(
      runtime.facade.submitAnswer({ ...input, confirmedBy: 'user' }),
    ).rejects.not.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    await runtime.stop();
  });
});
