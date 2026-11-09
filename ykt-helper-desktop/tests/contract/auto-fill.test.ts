import { effectScope, nextTick, reactive } from 'vue';
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
      status: 'submitted',
      route: 'answer',
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
  const props = reactive({
    page: 'classroom',
    environment: 'changjiang',
    runtime: undefined,
    browserUrl: undefined,
    collapsed: false,
  });
  const panel = scope.run(() =>
    (AssistantPanel as any).setup(props, { expose: vi.fn(), emit }),
  );
  panel.applySettings({
    ...DefaultAppSettings,
    llmAutoGenerate: true,
    llmManagedSubmit: false,
    autoAnswerDelay: 1000,
    autoAnswerRandomDelay: 0,
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
  return { panel, api, problem, emit, props };
}

describe('automatic draft-only answers', () => {
  it.each(['before request', 'while pending'])(
    'preserves an answer entered %s and its confirmation',
    async (when) => {
      const { panel, api, problem, emit } = setupPanel();
      panel.selectedProblemId.value = problem.id;
      await nextTick();
      if (when === 'before request') panel.answerDraft.value = 'B';
      await nextTick();
      let resolve!: (value: any) => void;
      api.generateAnswerProposal.mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      );
      const analysis = panel.analyzeProblem(true);
      if (when === 'while pending') panel.answerDraft.value = 'B';
      await nextTick();
      panel.confirmed.value = true;
      resolve({
        id: 'proposal-p1',
        problemId: 'p1',
        status: 'ready',
        answer: ['A'],
      });
      await analysis;
      await nextTick();
      expect(panel.answerDraft.value).toBe('B');
      expect(panel.confirmed.value).toBe(true);
      expect(panel.appliedProposalId.value).toBe('');
      expect(
        panel.currentAiSession.value.messages.at(-1).proposal.answer,
      ).toEqual(['A']);
      expect(emit).not.toHaveBeenCalledWith('selectPage', 'problems');
      expect(api.submitAnswer).not.toHaveBeenCalled();
      expect(panel.infoMessage.value).toContain('保留');
    },
  );

  it('requires explicit user confirmation before manual submission', async () => {
    const { panel, api, problem } = setupPanel();
    await panel.onAvailableProblem(problem);
    await vi.advanceTimersByTimeAsync(6000);
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

  it('preserves an edited saved draft when the response arrives after switching questions', async () => {
    const { panel, api, problem } = setupPanel();
    panel.problems.value.push({ ...problem, id: 'p2' });
    panel.selectedProblemId.value = problem.id;
    await nextTick();
    await panel.analyzeProblem(true);
    let resolve!: (value: any) => void;
    api.generateAnswerProposal.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const analysis = panel.analyzeProblem(true);
    panel.answerDraft.value = 'B';
    await nextTick();
    panel.selectedProblemId.value = 'p2';
    await nextTick();
    resolve({
      id: 'proposal-new',
      problemId: 'p1',
      status: 'ready',
      answer: ['A'],
    });
    await analysis;
    panel.selectedProblemId.value = 'p1';
    await nextTick();
    expect(panel.answerDraft.value).toBe('B');
    expect(panel.appliedProposalId.value).toBe('proposal-p1');
    expect(api.submitAnswer).not.toHaveBeenCalled();
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

  it('preserves a manual draft switched away from before the first AI response', async () => {
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
    panel.answerDraft.value = 'B';
    await nextTick();
    panel.selectedProblemId.value = 'p2';
    await nextTick();
    resolve({ id: 'proposal-p1', status: 'ready', answer: ['A'] });
    await analysis;
    panel.selectedProblemId.value = problem.id;
    await nextTick();
    expect(panel.answerDraft.value).toBe('B');
    expect(panel.appliedProposalId.value).toBe('');
    expect(api.submitAnswer).not.toHaveBeenCalled();
  });

  it('isolates drafts in classrooms that reuse a problem id', async () => {
    const { panel, problem } = setupPanel();
    panel.selectedProblemId.value = problem.id;
    await nextTick();
    await panel.analyzeProblem(true);
    panel.answerDraft.value = 'B';
    await nextTick();
    panel.selectedLessonId.value = 'l2';
    panel.problems.value = [{ ...problem, lessonId: 'l2' }];
    await nextTick();
    expect(panel.answerDraft.value).toBe('');
    expect(panel.appliedProposalId.value).toBe('');
    panel.answerDraft.value = 'C';
    await nextTick();
    panel.selectedLessonId.value = problem.lessonId;
    panel.problems.value = [problem];
    await nextTick();
    expect(panel.answerDraft.value).toBe('B');
    expect(panel.appliedProposalId.value).toBe('proposal-p1');
  });

  it('isolates drafts across browser environments', async () => {
    const { panel, api, problem, props } = setupPanel();
    Object.assign(api, {
      getSettings: vi.fn(async () => panel.settings.value),
      listAiProfiles: vi.fn(async () => []),
      getUser: vi.fn(async () => null),
      listLessons: vi.fn(async () => []),
      getNetworkSnapshot: vi.fn(async () => ({ entries: [] })),
    });
    panel.selectedProblemId.value = problem.id;
    await nextTick();
    panel.answerDraft.value = 'B';
    await nextTick();
    props.environment = 'standard';
    await vi.advanceTimersByTimeAsync(0);
    panel.problems.value = [problem];
    panel.selectedLessonId.value = problem.lessonId;
    await nextTick();
    expect(panel.answerDraft.value).toBe('');
    panel.answerDraft.value = 'C';
    await nextTick();
    props.environment = 'changjiang';
    await vi.advanceTimersByTimeAsync(0);
    panel.problems.value = [problem];
    panel.selectedLessonId.value = problem.lessonId;
    await nextTick();
    expect(panel.answerDraft.value).toBe('B');
  });

  it.each(['disabled', 'expired'])(
    'rechecks a busy queued question after it becomes %s',
    async (reason) => {
      const { panel, api, problem } = setupPanel();
      panel.busy.value = 'settings';
      await panel.onAvailableProblem(problem);
      await vi.advanceTimersByTimeAsync(6000);
      expect(api.generateAnswerProposal).not.toHaveBeenCalled();
      if (reason === 'disabled') panel.settings.value.llmAutoGenerate = false;
      else panel.problems.value = [{ ...problem, deadlineAt: Date.now() - 1 }];
      panel.busy.value = '';
      await vi.advanceTimersByTimeAsync(1000);
      expect(api.generateAnswerProposal).not.toHaveBeenCalled();
      expect(panel.scheduledProblems.size).toBe(0);
    },
  );

  it('binds simultaneous queued requests to their own problems and slide images', async () => {
    const { panel, api, problem } = setupPanel();
    const first = { ...problem, presentationId: 'deck', slideId: 's1' };
    const second = { ...first, id: 'p2', slideId: 's2' };
    panel.problems.value = [first, second];
    panel.presentations.value = [
      {
        id: 'deck',
        slides: [
          { id: 's1', imageUrl: 'https://example.test/first.png' },
          { id: 's2', imageUrl: 'https://example.test/second.png' },
        ],
      },
    ];
    await panel.onAvailableProblem(first);
    await panel.onAvailableProblem(second);
    // Fire both callbacks before flushing Vue's nextTick continuations.
    vi.advanceTimersByTime(6000);
    await vi.advanceTimersByTimeAsync(0);
    expect(
      api.generateAnswerProposal.mock.calls
        .map(([input]) => ({
          problemId: input.problemId,
          imageUrls: input.imageUrls,
        }))
        .sort((left, right) => left.problemId.localeCompare(right.problemId)),
    ).toEqual([
      { problemId: 'p1', imageUrls: ['https://example.test/first.png'] },
      { problemId: 'p2', imageUrls: ['https://example.test/second.png'] },
    ]);
    panel.selectedProblemId.value = first.id;
    await nextTick();
    expect(panel.answerDraft.value).toBe('AC');
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

  it('runs overlapping automatic requests independently and keeps both drafts', async () => {
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
    expect(api.generateAnswerProposal).toHaveBeenCalledTimes(2);
    expect(panel.selectedProblemId.value).toBe('p2');
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
