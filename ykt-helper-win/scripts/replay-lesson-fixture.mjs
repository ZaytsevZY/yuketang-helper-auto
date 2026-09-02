import { readFile } from 'node:fs/promises';
import process from 'node:process';

import { parseLessonFixture, replayLessonFixture } from '@ykt/backend';

const fixturePath = process.argv[2];
if (!fixturePath) {
  process.stderr.write('Usage: npm run lesson:replay -- <fixture.json>\n');
  process.exitCode = 2;
} else {
  try {
    const fixture = parseLessonFixture(await readFile(fixturePath, 'utf8'));
    const result = replayLessonFixture(fixture);
    const session = result.repository.getSession(fixture.lesson.id);
    const now = fixture.events.at(-1)?.occurredAt ?? 0;
    process.stdout.write(
      `${JSON.stringify({
        lesson: session?.lesson,
        transitions: result.transitions,
        problems: [...(session?.problems.keys() ?? [])].map((id) =>
          session?.getProblemContext(id, now),
        ),
      })}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Lesson replay failed.'}\n`,
    );
    process.exitCode = 1;
  }
}
