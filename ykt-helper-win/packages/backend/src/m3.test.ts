import { readFile } from 'node:fs/promises';

import {
  ProblemType,
  type Lesson,
  type Presentation,
  type Problem,
} from '@ykt/contracts';
import { describe, expect, it } from 'vitest';

import { LessonSession } from './domain/lesson-session.js';
import {
  fromLegacyProblemType,
  toLegacyProblemType,
} from './domain/problem-type.js';
import { InMemoryLessonRepository } from './repositories/lesson-repository.js';
import {
  AnswerService,
  parseManualAnswer,
  planSubmission,
} from './services/answer-service.js';
import {
  parseLessonFixture,
  replayLessonFixture,
} from './workflows/fixture-replay.js';
import { LessonStateMachine } from './workflows/lesson-state-machine.js';

const lesson: Lesson = {
  id: 'lesson-1',
  title: 'Lesson',
  status: 'upcoming',
};

const problem: Problem = {
  id: 'problem-1',
  lessonId: lesson.id,
  presentationId: 'presentation-1',
  slideId: 'slide-1',
  type: ProblemType.SingleChoice,
  prompt: 'Question',
  options: ['One', 'Two', 'Three'],
  blanks: [],
  result: null,
};

const presentation: Presentation = {
  id: problem.presentationId,
  lessonId: lesson.id,
  title: 'Slides',
  width: null,
  height: null,
  slides: [
    {
      id: problem.slideId,
      index: 0,
      title: 'Question',
      imageUrl: null,
      problem,
    },
  ],
};

describe('M3 backend core', () => {
  it('maps the five legacy problem types', () => {
    expect([1, 2, 3, 4, 5].map(fromLegacyProblemType)).toEqual([
      ProblemType.SingleChoice,
      ProblemType.MultipleChoice,
      ProblemType.Poll,
      ProblemType.FillBlank,
      ProblemType.Subjective,
    ]);
    expect(toLegacyProblemType(ProblemType.FillBlank)).toBe(4);
    expect(fromLegacyProblemType(99)).toBe(ProblemType.Unknown);
  });

  it('replays a recorded fixture into an available problem without a browser', async () => {
    const text = await readFile(
      new URL('../../../tests/fixtures/lesson-unlock.json', import.meta.url),
      'utf8',
    );
    const fixture = parseLessonFixture(text);
    const replay = replayLessonFixture(fixture);
    const session = replay.repository.getSession(fixture.lesson.id);

    expect(replay.transitions.every((item) => item.applied)).toBe(true);
    expect(session?.lesson.status).toBe('active');
    expect(session?.getProblemContext('problem-1', 1300)?.status).toBe(
      'available',
    );
  });

  it('rejects an unlock before its presentation and problem are loaded', () => {
    const session = new LessonSession(lesson);
    const machine = new LessonStateMachine(session, { now: () => 1000 });

    expect(
      machine.apply({
        type: 'problem.unlocked',
        lessonId: lesson.id,
        occurredAt: 1000,
        problemId: problem.id,
        presentationId: problem.presentationId,
        slideId: problem.slideId,
        unlockedAt: 1000,
        deadlineAt: 2000,
      }),
    ).toEqual({ applied: false, reason: 'problem is not loaded' });
  });

  it('keeps lesson state isolated and derives timeout from the deadline', () => {
    const repository = new InMemoryLessonRepository();
    const first = repository.upsertLesson(lesson);
    const second = repository.upsertLesson({
      id: 'lesson-2',
      title: 'Other lesson',
      status: 'active',
    });
    first.upsertPresentation(presentation);
    first.unlockProblem(
      problem.id,
      problem.presentationId,
      problem.slideId,
      1000,
      2000,
      1000,
    );

    expect(first.getProblemContext(problem.id, 2000)?.status).toBe('expired');
    expect(second.problems.size).toBe(0);
  });

  it('does not downgrade an answered problem when stale classroom data is replayed', () => {
    const session = new LessonSession(lesson);
    session.upsertPresentation(presentation);
    session.unlockProblem(
      problem.id,
      problem.presentationId,
      problem.slideId,
      1000,
      2000,
      1000,
    );
    session.answerProblem(problem.id, ['A']);

    session.upsertPresentation(presentation);
    session.unlockProblem(
      problem.id,
      problem.presentationId,
      problem.slideId,
      1000,
      2000,
      1000,
    );

    expect(session.getProblemContext(problem.id, 1000)).toMatchObject({
      status: 'answered',
      result: ['A'],
    });
  });

  it('normalizes manual answers and validates their format', () => {
    const service = new AnswerService();
    const context = {
      ...problem,
      status: 'available' as const,
      unlockedAt: 1000,
      deadlineAt: 2000,
    };

    expect(parseManualAnswer(ProblemType.MultipleChoice, 'c a a')).toEqual([
      'A',
      'C',
    ]);
    expect(service.validate(context, 'b')).toEqual({
      valid: true,
      issues: [],
      normalizedAnswer: ['B'],
    });
    expect(service.validate(context, 'A C').issues).toContain(
      'exactly one option is required',
    );
    expect(
      service.validate({ ...context, type: ProblemType.Subjective }, [
        'not-subjective',
      ]).valid,
    ).toBe(false);
  });

  it('builds normal and retry payload times using the legacy rules', () => {
    expect(
      planSubmission({
        problem,
        answer: ['A'],
        now: 1500,
        startTime: 1000,
        endTime: 2000,
      }),
    ).toMatchObject({ route: 'answer', payload: { dt: 1500, problemType: 1 } });

    expect(
      planSubmission({
        problem,
        answer: ['B'],
        now: 2500,
        startTime: 1000,
        endTime: 2000,
      }),
    ).toMatchObject({
      route: 'retry',
      payload: { problems: [{ dt: 3000, problemType: 1 }] },
    });
  });
});
