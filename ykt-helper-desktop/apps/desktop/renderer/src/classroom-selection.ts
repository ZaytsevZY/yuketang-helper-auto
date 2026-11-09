import { parseLessonPage, type Lesson } from '@ykt/contracts';

/** A report that has not been discovered must not silently display another lesson. */
export function chooseClassroom(
  lessons: readonly Lesson[],
  browserUrl: string | undefined,
  previousId = '',
): string {
  const page = parseLessonPage(browserUrl);
  if (page)
    return lessons.find((lesson) => lesson.id === page.lessonId)?.id ?? '';
  return (
    lessons.find((lesson) => lesson.status === 'active')?.id ??
    lessons.find((lesson) => lesson.id === previousId)?.id ??
    lessons[0]?.id ??
    ''
  );
}
