import { effectScope, nextTick, reactive } from 'vue';
import type * as Vue from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BrowserEnvironment,
  DefaultAppSettings,
  ProblemType,
  type AnswerProposal,
  type ProblemContext,
} from '@ykt/contracts';
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

describe('LLM automation settings', () => {
  it('labels the selected classroom with both its name and full id', async () => {
    const { panel } = setupPanel({});
    panel.lessons.value = [
      {
        id: '1785336445811421568',
        title: '2026秋-深度学习-0',
        status: 'active',
      },
    ];
    panel.selectedLessonId.value = '1785336445811421568';
    await nextTick();

    expect(panel.selectedLessonLabel.value).toBe(
      '2026秋-深度学习-0 · ID：1785336445811421568',
    );
  });

  it('runs the complete generation and managed submission flow', async () => {
    const { panel, api, problem } = setupPanel({
      llmAutoGenerate: true,
      llmManagedSubmit: true,
      aiAnalyzeLatestOnOpen: true,
    });

    await panel.onAvailableProblem(problem);
    await vi.runAllTimersAsync();

    expect(api.generateAnswerProposal).toHaveBeenCalledOnce();
    expect(api.validateAnswer).not.toHaveBeenCalled();
    expect(api.submitAnswer).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        problemId: problem.id,
        confirmedBy: 'agent',
      }),
    );
  });

  it('generates and submits each queued question once when their timers fire together', async () => {
    const { panel, api, problem } = setupPanel({
      llmAutoGenerate: true,
      llmManagedSubmit: true,
    });
    const second = { ...problem, id: 'problem-2', slideId: 'slide-2' };
    panel.problems.value = [problem, second];
    api.listProblems.mockImplementation(async () => panel.problems.value);
    await Promise.all([
      panel.onAvailableProblem(problem),
      panel.onAvailableProblem(second),
    ]);
    await vi.runAllTimersAsync();
    expect(
      api.generateAnswerProposal.mock.calls.map(([input]) => input.problemId),
    ).toEqual([problem.id, second.id]);
    expect(
      api.submitAnswer.mock.calls.map(([input]) => input.problemId),
    ).toEqual([problem.id, second.id]);
  });

  it('keeps each question result when two model requests finish in reverse order', async () => {
    const { panel, api, problem } = setupPanel({
      llmAutoGenerate: true,
      llmManagedSubmit: true,
    });
    const second = { ...problem, id: 'problem-2', slideId: 'slide-2' };
    const proposals = [
      await api.generateAnswerProposal({ problemId: problem.id }),
      await api.generateAnswerProposal({ problemId: second.id }),
    ];
    const pending = new Map<string, (proposal: AnswerProposal) => void>();
    api.generateAnswerProposal
      .mockClear()
      .mockImplementation(
        ({ problemId }) =>
          new Promise((resolve) => pending.set(problemId, resolve)),
      );
    panel.problems.value = [problem, second];
    api.listProblems.mockImplementation(async () => panel.problems.value);
    await Promise.all([
      panel.onAvailableProblem(problem),
      panel.onAvailableProblem(second),
    ]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.generateAnswerProposal).toHaveBeenCalledTimes(2);
    pending.get(second.id)!(proposals[1]!);
    await vi.advanceTimersByTimeAsync(0);
    expect(
      panel.problems.value.find((item: ProblemContext) => item.id === second.id)
        .status,
    ).toBe('answered');
    pending.get(problem.id)!(proposals[0]!);
    await vi.advanceTimersByTimeAsync(0);
    expect(
      api.submitAnswer.mock.calls.map(([input]) => input.problemId),
    ).toEqual([second.id, problem.id]);
    expect(
      panel.problems.value.every(
        (item: ProblemContext) => item.status === 'answered',
      ),
    ).toBe(true);
  });

  it('does not let an older poll overwrite the state refreshed after submission', async () => {
    const { panel, api, problem } = setupPanel({
      llmAutoGenerate: true,
      llmManagedSubmit: true,
    });
    let finish!: (value: ProblemContext[]) => void;
    api.listProblems.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const oldPoll = panel.loadLessonData();
    const answered: ProblemContext = {
      ...problem,
      result: ['A'],
      status: 'answered',
    };
    api.listProblems.mockResolvedValueOnce([answered]);
    await panel.applyAutomaticProposal(
      problem,
      await api.generateAnswerProposal({ problemId: problem.id }),
    );
    expect(panel.problems.value[0].status).toBe('answered');
    finish([problem]);
    await oldPoll;
    expect(panel.problems.value[0].status).toBe('answered');
  });

  it('keeps a successful submission answered even when refreshing presentations fails', async () => {
    const { panel, api, problem } = setupPanel({
      llmAutoGenerate: true,
      llmManagedSubmit: true,
    });
    api.listPresentations.mockRejectedValueOnce(
      new Error('presentation unavailable'),
    );
    api.listProblems.mockResolvedValueOnce([
      { ...problem, result: ['A'], status: 'answered' },
    ]);
    await panel.applyAutomaticProposal(
      problem,
      await api.generateAnswerProposal({ problemId: problem.id }),
    );
    expect(panel.problems.value[0].status).toBe('answered');
  });

  it('continues with the next question after a successful POST and failed problem refresh', async () => {
    const { panel, api, problem } = setupPanel({
      llmAutoGenerate: true,
      llmManagedSubmit: true,
    });
    api.listProblems.mockRejectedValueOnce(new Error('refresh unavailable'));
    await panel.onAvailableProblem(problem);
    await vi.runAllTimersAsync();
    expect(panel.problems.value[0]).toMatchObject({
      status: 'answered',
      result: ['A'],
    });
    const second = { ...problem, id: 'problem-2', slideId: 'slide-2' };
    panel.problems.value.push(second);
    api.listProblems.mockImplementation(async () => panel.problems.value);
    await panel.onAvailableProblem(second);
    await vi.runAllTimersAsync();
    expect(
      api.submitAnswer.mock.calls.map(([input]) => input.problemId),
    ).toEqual([problem.id, second.id]);
    expect(
      panel.problems.value.every(
        (item: ProblemContext) => item.status === 'answered',
      ),
    ).toBe(true);
  });

  it('handles a rejected submission without blocking the next question', async () => {
    const { panel, api, problem } = setupPanel({
      llmAutoGenerate: true,
      llmManagedSubmit: true,
    });
    api.submitAnswer.mockRejectedValueOnce(new Error('server rejected answer'));
    await panel.onAvailableProblem(problem);
    await vi.runAllTimersAsync();
    expect(panel.errorMessage.value).toContain('server rejected answer');
    expect(panel.problems.value[0].status).toBe('available');
    const second = { ...problem, id: 'problem-2', slideId: 'slide-2' };
    panel.problems.value.push(second);
    api.listProblems.mockImplementation(async () => panel.problems.value);
    await panel.onAvailableProblem(second);
    await vi.runAllTimersAsync();
    expect(api.submitAnswer).toHaveBeenCalledTimes(2);
    expect(
      panel.problems.value.find((item: ProblemContext) => item.id === second.id)
        .status,
    ).toBe('answered');
  });

  it('does not post a late model response after moving to another classroom or answering elsewhere', async () => {
    for (const change of ['classroom', 'answered']) {
      const { panel, api, problem } = setupPanel({
        llmAutoGenerate: true,
        llmManagedSubmit: true,
      });
      panel.selectedProblemId.value = problem.id;
      await nextTick();
      const proposal = await api.generateAnswerProposal({
        problemId: problem.id,
      });
      let finish!: (value: AnswerProposal) => void;
      api.generateAnswerProposal.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const pending = panel.analyzeProblem(true);
      if (change === 'classroom')
        panel.selectedLessonId.value = 'another-classroom';
      else
        panel.problems.value = [
          { ...problem, status: 'answered', result: ['B'] },
        ];
      finish(proposal);
      await pending;
      expect(api.submitAnswer).not.toHaveBeenCalled();
    }
  });

  it('ignores an old classroom response after switching classrooms', async () => {
    const { panel, api, problem } = setupPanel({});
    let finish!: (value: ProblemContext[]) => void;
    api.listProblems.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = panel.loadLessonData();
    const next = {
      ...problem,
      id: 'other-problem',
      lessonId: 'another-classroom',
    };
    panel.selectedLessonId.value = next.lessonId;
    api.listProblems.mockResolvedValueOnce([next]);
    await panel.loadLessonData();
    finish([problem]);
    await pending;
    expect(panel.problems.value).toEqual([next]);
  });

  it('does not clear the next classroom draft when an earlier POST finishes late', async () => {
    const { panel, api, problem } = setupPanel({
      llmAutoGenerate: true,
      llmManagedSubmit: true,
    });
    const proposal = await api.generateAnswerProposal({
      problemId: problem.id,
    });
    let finish!: (value: Awaited<ReturnType<typeof api.submitAnswer>>) => void;
    api.submitAnswer.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = panel.applyAutomaticProposal(problem, proposal);
    const next = {
      ...problem,
      id: 'other-problem',
      lessonId: 'other-classroom',
    };
    panel.selectedLessonId.value = next.lessonId;
    panel.problems.value = [next];
    panel.selectedProblemId.value = next.id;
    await nextTick();
    panel.confirmed.value = true;
    panel.appliedProposalId.value = 'next-proposal';
    finish({
      problemId: problem.id,
      status: 'submitted',
      route: 'answer',
      submittedAt: new Date().toISOString(),
    });
    await pending;
    expect(panel.problems.value).toEqual([next]);
    expect(panel.confirmed.value).toBe(true);
    expect(panel.appliedProposalId.value).toBe('next-proposal');
    expect(api.listProblems).not.toHaveBeenCalled();
  });

  it('coalesces overlapping automatic submissions for the same question', async () => {
    const { panel, api, problem } = setupPanel({
      llmAutoGenerate: true,
      llmManagedSubmit: true,
    });
    const proposal = await api.generateAnswerProposal({
      problemId: problem.id,
    });
    await Promise.all([
      panel.applyAutomaticProposal(problem, proposal),
      panel.applyAutomaticProposal(problem, proposal),
    ]);
    expect(api.submitAnswer).toHaveBeenCalledOnce();
    expect(panel.problems.value[0].status).toBe('answered');
    await panel.applyAutomaticProposal(problem, proposal);
    expect(api.submitAnswer).toHaveBeenCalledOnce();
  });

  it('can generate an answer without validating or submitting it', async () => {
    const { panel, api, problem } = setupPanel({
      llmAutoGenerate: false,
      llmManagedSubmit: false,
    });

    await panel.onAvailableProblem(problem);
    panel.applySettings({
      ...DefaultAppSettings,
      llmAutoGenerate: true,
      llmManagedSubmit: false,
      autoAnswerDelay: 1000,
      autoAnswerRandomDelay: 0,
      notifyProblems: false,
    });
    await panel.onAvailableProblem(problem);
    await vi.runAllTimersAsync();

    expect(api.generateAnswerProposal).toHaveBeenCalledOnce();
    expect(api.validateAnswer).not.toHaveBeenCalled();
    expect(api.submitAnswer).not.toHaveBeenCalled();
    expect(panel.infoMessage.value).toContain('等待手动核对');
  });

  it('selects and analyzes the latest available problem on AI page open', async () => {
    const { panel, api, problem } = setupPanel({
      aiAnalyzeLatestOnOpen: true,
    });
    const latest: ProblemContext = {
      ...problem,
      id: 'problem-latest',
      unlockedAt: 2000,
    };
    panel.problems.value = [problem, latest];

    await panel.analyzeLatestProblemOnOpen();
    await nextTick();

    expect(panel.selectedProblemId.value).toBe(latest.id);
    expect(api.generateAnswerProposal).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ problemId: latest.id }),
    );
  });

  it('always sends the problem slide from the problem-page AI entry', async () => {
    const { panel, api, problem, emit } = setupPanel({
      aiCaptureCurrentPage: true,
    });
    const imageUrl = 'https://example.test/problem-slide.png';
    panel.presentations.value = [
      {
        id: problem.presentationId,
        lessonId: problem.lessonId,
        title: '题目课件',
        width: 1920,
        height: 1080,
        slides: [
          {
            id: problem.slideId,
            index: 0,
            title: '题目页',
            imageUrl,
            problem,
          },
        ],
      },
    ];
    panel.selectedProblemId.value = problem.id;
    panel.aiSlideSelection.value = ['unrelated-slide'];
    await nextTick();

    panel.openAiForProblem();
    await panel.analyzeProblem(false);

    expect(emit).toHaveBeenCalledWith('selectPage', 'ai');
    expect(api.generateAnswerProposal).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        problemId: problem.id,
        imageUrls: [imageUrl],
        imageSource: 'slide',
        captureCurrentPage: false,
      }),
    );
  });

  it('turns off managed submission when automatic generation is disabled', async () => {
    const { panel } = setupPanel({
      llmAutoGenerate: true,
      llmManagedSubmit: true,
    });

    panel.settingsDraft.value.llmAutoGenerate = false;
    await nextTick();

    expect(panel.settingsDraft.value.llmManagedSubmit).toBe(false);
  });

  it('keeps an existing available problem eligible when generation is enabled later', async () => {
    const { panel, api, problem } = setupPanel({
      llmAutoGenerate: false,
    });
    panel.connectedLessonIds.add(problem.lessonId);

    await panel.automationTick();
    expect(api.generateAnswerProposal).not.toHaveBeenCalled();

    panel.applySettings({
      ...DefaultAppSettings,
      llmAutoGenerate: true,
      autoAnswerDelay: 1000,
      autoAnswerRandomDelay: 0,
      notifyProblems: false,
    });
    await panel.automationTick();
    await vi.runAllTimersAsync();

    expect(api.generateAnswerProposal).toHaveBeenCalledOnce();
  });
});

function setupPanel(settings: Record<string, boolean>) {
  vi.useFakeTimers();
  const problem: ProblemContext = {
    id: 'problem-1',
    lessonId: 'lesson-1',
    presentationId: 'presentation-1',
    slideId: 'slide-1',
    type: ProblemType.SingleChoice,
    prompt: '选择正确答案',
    options: ['选项 A', '选项 B'],
    blanks: [],
    result: null,
    status: 'available',
    unlockedAt: 1000,
    deadlineAt: null,
  };
  const proposal: AnswerProposal = {
    id: 'proposal-1',
    sessionId: 'session-1',
    problemId: problem.id,
    status: 'ready',
    answer: ['A'],
    explanation: '选择 A。',
    confidence: 0.9,
    failureReason: null,
    validationIssues: [],
    rawText: '{"answer":["A"]}',
    profileId: 'profile-1',
    model: 'model-1',
    contextSources: [`problem:${problem.id}`],
    createdAt: new Date().toISOString(),
  };
  const api = {
    generateAnswerProposal: vi.fn(
      async ({ problemId }: { problemId: string }) => ({
        ...proposal,
        problemId,
      }),
    ),
    validateAnswer: vi.fn(async () => ({
      valid: true,
      issues: [],
      normalizedAnswer: ['A'],
    })),
    submitAnswer: vi.fn(async ({ problemId }: { problemId: string }) => ({
      problemId,
      status: 'submitted',
      route: 'answer',
      submittedAt: new Date().toISOString(),
    })),
    listProblems: vi.fn(async () => [problem]),
    listPresentations: vi.fn(async () => []),
    getLessonCollectionStatus: vi.fn(async () => null),
  };
  vi.stubGlobal('window', { yuketang: api });
  const scope = effectScope();
  scopes.push(scope);
  const emit = vi.fn();
  const props = reactive({
    page: 'settings',
    environment: BrowserEnvironment.Standard,
    runtime: undefined,
    browserUrl: undefined,
    collapsed: false,
  });
  const panel = scope.run(() =>
    (AssistantPanel as any).setup(props, { expose: vi.fn(), emit }),
  );
  panel.applySettings({
    ...DefaultAppSettings,
    ...settings,
    autoAnswerDelay: 1000,
    autoAnswerRandomDelay: 0,
    notifyProblems: false,
  });
  panel.problems.value = [problem];
  panel.selectedLessonId.value = problem.lessonId;
  return { panel, api, problem, emit, props };
}

it('prefills assignment extraction in AI without auto-send or leaking classroom/image context', async () => {
  const { panel, api, problem, emit, props } = setupPanel({
    aiAnalyzeLatestOnOpen: true,
    aiCaptureCurrentPage: true,
    llmManagedSubmit: true,
  });
  panel.selectedProblemId.value = problem.id;
  await nextTick();
  const draft = {
    title: '复习试卷',
    text: '请解释：未解码字符𛈒',
    hasEncryptedText: true,
  };
  panel.explainAssignment(draft);
  props.page = 'ai';
  await nextTick();
  expect(emit).toHaveBeenCalledWith('selectPage', 'ai');
  expect(panel.aiCustomPrompt.value).toBe(draft.text);
  expect(api.generateAnswerProposal).not.toHaveBeenCalled();
  panel.aiCustomPrompt.value = '已检查并修改的题干';
  await panel.analyzeProblem(false);
  expect(api.generateAnswerProposal).toHaveBeenCalledWith(
    expect.objectContaining({
      customPrompt: '已检查并修改的题干',
      captureCurrentPage: false,
      imageUrls: [],
      contextId: expect.stringMatching(/^assignment:/),
    }),
  );
  expect(api.generateAnswerProposal.mock.calls[0]![0]).not.toHaveProperty(
    'problemId',
  );
  expect(api.submitAnswer).not.toHaveBeenCalled();
  panel.aiChatDraft.value = '再解释一下';
  await panel.sendAiFollowUp();
  expect(api.generateAnswerProposal).toHaveBeenLastCalledWith(
    expect.objectContaining({
      customPrompt: '再解释一下',
      captureCurrentPage: false,
    }),
  );
  panel.startNewAiChat();
  expect(panel.aiCustomPrompt.value).toBe(draft.text);
});
