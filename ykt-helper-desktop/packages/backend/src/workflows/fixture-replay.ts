import {
  ProblemType,
  type Lesson,
  type LessonEvent,
  type LessonFixture,
  type Presentation,
  type Problem,
} from '@ykt/contracts';

import { InMemoryLessonRepository } from '../repositories/lesson-repository.js';
import {
  LessonStateMachine,
  type Clock,
  type TransitionResult,
} from './lesson-state-machine.js';

export interface LessonReplayResult {
  repository: InMemoryLessonRepository;
  transitions: readonly TransitionResult[];
}

export function parseLessonFixture(text: string): LessonFixture {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value) || value.version !== 1 || !isLesson(value.lesson)) {
    throw new Error('Invalid lesson fixture header.');
  }
  if (!Array.isArray(value.events) || !value.events.every(isLessonEvent)) {
    throw new Error('Invalid lesson fixture events.');
  }
  return {
    version: 1,
    lesson: value.lesson,
    events: value.events,
  };
}

export function replayLessonFixture(
  fixture: LessonFixture,
  clock?: Clock,
): LessonReplayResult {
  const repository = new InMemoryLessonRepository();
  const session = repository.upsertLesson(fixture.lesson);
  let replayTime = 0;
  const replayClock: Clock = clock ?? { now: () => replayTime };
  const machine = new LessonStateMachine(session, replayClock);
  return {
    repository,
    transitions: fixture.events.map((event) => {
      replayTime = event.occurredAt;
      return machine.apply(event);
    }),
  };
}

function isLesson(value: unknown): value is Lesson {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    (value.status === 'upcoming' ||
      value.status === 'active' ||
      value.status === 'ended')
  );
}

function isLessonEvent(value: unknown): value is LessonEvent {
  if (
    !isRecord(value) ||
    typeof value.type !== 'string' ||
    typeof value.lessonId !== 'string' ||
    typeof value.occurredAt !== 'number'
  ) {
    return false;
  }
  switch (value.type) {
    case 'lesson.started':
    case 'lesson.ended':
      return true;
    case 'presentation.loaded':
      return isPresentation(value.presentation);
    case 'problem.published':
      return isProblem(value.problem);
    case 'problem.unlocked':
      return (
        typeof value.problemId === 'string' &&
        typeof value.presentationId === 'string' &&
        typeof value.slideId === 'string' &&
        typeof value.unlockedAt === 'number' &&
        (value.deadlineAt === null || typeof value.deadlineAt === 'number')
      );
    case 'problem.answered':
      return typeof value.problemId === 'string' && isAnswer(value.answer);
    case 'problem.closed':
      return typeof value.problemId === 'string';
    default:
      return false;
  }
}

function isPresentation(value: unknown): value is Presentation {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.lessonId === 'string' &&
    typeof value.title === 'string' &&
    isNullableNumber(value.width) &&
    isNullableNumber(value.height) &&
    Array.isArray(value.slides) &&
    value.slides.every(
      (slide) =>
        isRecord(slide) &&
        typeof slide.id === 'string' &&
        typeof slide.index === 'number' &&
        typeof slide.title === 'string' &&
        (slide.imageUrl === null || typeof slide.imageUrl === 'string') &&
        (slide.problem === null || isProblem(slide.problem)),
    )
  );
}

function isProblem(value: unknown): value is Problem {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.lessonId === 'string' &&
    typeof value.presentationId === 'string' &&
    typeof value.slideId === 'string' &&
    Object.values(ProblemType).includes(value.type as Problem['type']) &&
    typeof value.prompt === 'string' &&
    isStringArray(value.options) &&
    isStringArray(value.blanks) &&
    (value.result === null || isAnswer(value.result))
  );
}

function isAnswer(value: unknown): boolean {
  return (
    isStringArray(value) ||
    (isRecord(value) &&
      typeof value.content === 'string' &&
      isStringArray(value.pics))
  );
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === 'number';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
