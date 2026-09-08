import type { Lesson, Problem } from '@ykt/contracts';

import { LessonSession } from '../domain/lesson-session.js';

export interface LessonRepository {
  upsertLesson(lesson: Lesson): LessonSession;
  getSession(lessonId: string): LessonSession | undefined;
  listLessons(): readonly Lesson[];
  findProblem(
    problemId: string,
  ): { session: LessonSession; problem: Problem } | undefined;
}

export class InMemoryLessonRepository implements LessonRepository {
  readonly #sessions = new Map<string, LessonSession>();

  upsertLesson(lesson: Lesson): LessonSession {
    const existing = this.#sessions.get(lesson.id);
    if (existing) {
      existing.setLessonStatus(lesson.status);
      return existing;
    }
    const session = new LessonSession(lesson);
    this.#sessions.set(lesson.id, session);
    return session;
  }

  getSession(lessonId: string): LessonSession | undefined {
    return this.#sessions.get(lessonId);
  }

  listLessons(): readonly Lesson[] {
    return [...this.#sessions.values()].map((session) => session.lesson);
  }

  findProblem(
    problemId: string,
  ): { session: LessonSession; problem: Problem } | undefined {
    for (const session of this.#sessions.values()) {
      const problem = session.problems.get(problemId);
      if (problem) return { session, problem };
    }
    return undefined;
  }
}
