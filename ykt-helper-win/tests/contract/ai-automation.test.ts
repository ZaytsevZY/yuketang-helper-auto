import { effectScope, nextTick } from 'vue';
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
  it('runs the complete generation and managed submission flow', async () => {
    const { panel, api, problem } = setupPanel({
      llmAutoGenerate: true,
      llmManagedSubmit: true,
      aiAnalyzeLatestOnOpen: true,
    });

    await panel.onAvailableProblem(problem);
    await vi.runAllTimersAsync();

    expect(api.generateAnswerProposal).toHaveBeenCalledOnce();
    expect(api.validateAnswer).toHaveBeenCalledOnce();
    expect(api.submitAnswer).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        problemId: problem.id,
        confirmedBy: 'agent',
      }),
    );
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
    submitAnswer: vi.fn(async () => ({
      problemId: problem.id,
      status: 'submitted',
      submittedAt: new Date().toISOString(),
    })),
    listProblems: vi.fn(async () => [problem]),
    listPresentations: vi.fn(async () => []),
  };
  vi.stubGlobal('window', { yuketang: api });
  const scope = effectScope();
  scopes.push(scope);
  const panel = scope.run(() =>
    (AssistantPanel as any).setup(
      {
        page: 'settings',
        environment: BrowserEnvironment.Standard,
        runtime: undefined,
        browserUrl: undefined,
        collapsed: false,
      },
      { expose: vi.fn(), emit: vi.fn() },
    ),
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
  return { panel, api, problem };
}
