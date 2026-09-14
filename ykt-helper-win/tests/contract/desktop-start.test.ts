import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('desktop start command', () => {
  it('forwards command-line flags through the nested workspace script', async () => {
    const rootPackageJson = await readPackageJson('../../package.json');
    const desktopPackageJson = await readPackageJson(
      '../../apps/desktop/package.json',
    );

    expect(rootPackageJson.scripts?.start).toBe(
      'npm run start -w @ykt/desktop --',
    );
    expect(desktopPackageJson.scripts?.start).toBe('electron . --');
  });
});

async function readPackageJson(relativeUrl: string): Promise<{
  scripts?: Record<string, string>;
}> {
  return JSON.parse(
    await readFile(new URL(relativeUrl, import.meta.url), 'utf8'),
  ) as { scripts?: Record<string, string> };
}
