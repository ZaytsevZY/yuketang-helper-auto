import type {
  AnswerValue,
  Lesson,
  Presentation,
  Problem,
  ProblemContext,
  Slide,
} from '@ykt/contracts';

export interface ProblemRuntimeState {
  problemId: string;
  presentationId: string;
  slideId: string;
  status: 'locked' | 'available' | 'answered' | 'expired';
  unlockedAt: number | null;
  deadlineAt: number | null;
}

export class LessonSession {
  readonly presentations = new Map<string, Presentation>();
  readonly slides = new Map<string, Slide>();
  readonly problems = new Map<string, Problem>();
  readonly problemStates = new Map<string, ProblemRuntimeState>();
  #lesson: Lesson;

  constructor(lesson: Lesson) {
    this.#lesson = { ...lesson };
  }

  get lesson(): Lesson {
    return { ...this.#lesson };
  }

  setLessonStatus(status: Lesson['status']): void {
    this.#lesson = { ...this.#lesson, status };
  }

  upsertPresentation(presentation: Presentation): void {
    this.presentations.set(presentation.id, presentation);
    for (const slide of presentation.slides) {
      this.slides.set(slide.id, slide);
      if (slide.problem) this.upsertProblem(slide.problem);
    }
  }

  upsertProblem(problem: Problem): void {
    this.problems.set(problem.id, problem);
    if (!this.problemStates.has(problem.id)) {
      this.problemStates.set(problem.id, {
        problemId: problem.id,
        presentationId: problem.presentationId,
        slideId: problem.slideId,
        status: problem.result ? 'answered' : 'locked',
        unlockedAt: null,
        deadlineAt: null,
      });
    }
  }

  unlockProblem(
    problemId: string,
    presentationId: string,
    slideId: string,
    unlockedAt: number,
    deadlineAt: number | null,
    now: number,
  ): void {
    const problem = this.problems.get(problemId);
    this.problemStates.set(problemId, {
      problemId,
      presentationId,
      slideId,
      status: problem?.result
        ? 'answered'
        : deadlineAt !== null && now >= deadlineAt
          ? 'expired'
          : 'available',
      unlockedAt,
      deadlineAt,
    });
  }

  closeProblem(problemId: string): void {
    const state = this.problemStates.get(problemId);
    if (state && state.status !== 'answered') {
      this.problemStates.set(problemId, { ...state, status: 'expired' });
    }
  }

  answerProblem(problemId: string, answer: AnswerValue): void {
    const problem = this.problems.get(problemId);
    if (!problem) return;
    this.problems.set(problemId, { ...problem, result: answer });

    const state = this.problemStates.get(problemId);
    if (state) {
      this.problemStates.set(problemId, { ...state, status: 'answered' });
    }
  }

  getProblemContext(
    problemId: string,
    now: number,
  ): ProblemContext | undefined {
    const problem = this.problems.get(problemId);
    if (!problem) return undefined;
    const storedState = this.problemStates.get(problemId);
    const status = problem.result
      ? 'answered'
      : storedState?.deadlineAt !== null &&
          storedState?.deadlineAt !== undefined &&
          now >= storedState.deadlineAt
        ? 'expired'
        : (storedState?.status ?? 'locked');

    return {
      ...problem,
      status,
      unlockedAt: storedState?.unlockedAt ?? null,
      deadlineAt: storedState?.deadlineAt ?? null,
    };
  }
}
