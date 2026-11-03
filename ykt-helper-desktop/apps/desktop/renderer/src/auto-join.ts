import type { Lesson } from '@ykt/contracts';

export async function enterActiveLessons(
  lessons: readonly Lesson[],
  connectedLessonIds: Set<string>,
  enterLesson: (lessonId: string) => Promise<void>,
): Promise<readonly string[]> {
  const enteredLessonIds: string[] = [];
  for (const lesson of lessons) {
    if (lesson.status !== 'active' || connectedLessonIds.has(lesson.id)) {
      continue;
    }
    await enterLesson(lesson.id);
    connectedLessonIds.add(lesson.id);
    enteredLessonIds.push(lesson.id);
  }
  return enteredLessonIds;
}
