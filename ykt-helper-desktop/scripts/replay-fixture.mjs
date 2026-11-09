import { readFile } from 'node:fs/promises';
import process from 'node:process';

import { parseNetworkFixture, replayNetworkFixture } from '@ykt/routing';

const fixturePath = process.argv[2];
if (!fixturePath) {
  process.stderr.write('Usage: npm run fixture:replay -- <fixture.json>\n');
  process.exitCode = 2;
} else {
  try {
    const fixture = parseNetworkFixture(await readFile(fixturePath, 'utf8'));
    for (const event of replayNetworkFixture(fixture)) {
      process.stdout.write(`${JSON.stringify(event)}\n`);
    }
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Fixture replay failed.'}\n`,
    );
    process.exitCode = 1;
  }
}
