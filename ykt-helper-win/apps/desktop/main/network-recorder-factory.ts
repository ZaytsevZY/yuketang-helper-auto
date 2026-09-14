import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { NetworkRecorder } from '@ykt/routing';

interface DevelopmentRecorderModule {
  createDevelopmentNetworkRecorder?: () => NetworkRecorder;
  default?: {
    createDevelopmentNetworkRecorder?: () => NetworkRecorder;
  };
}

export function shouldUseDevelopmentNetworkRecorder(
  argv: readonly string[],
  isPackaged: boolean,
): boolean {
  return !isPackaged && argv.includes('--debug');
}

export async function createNetworkRecorderForDesktop(input: {
  readonly argv: readonly string[];
  readonly isPackaged: boolean;
  readonly moduleDirectory: string;
}): Promise<NetworkRecorder> {
  if (!shouldUseDevelopmentNetworkRecorder(input.argv, input.isPackaged)) {
    return new NetworkRecorder();
  }

  const modulePath = join(
    input.moduleDirectory,
    'development-network-recorder.cjs',
  );
  if (!existsSync(modulePath)) {
    throw new Error(
      'Development network recorder is missing. Run the desktop main build before starting with --debug.',
    );
  }

  const loaded = (await import(
    pathToFileURL(modulePath).href
  )) as DevelopmentRecorderModule;
  const create =
    loaded.createDevelopmentNetworkRecorder ??
    loaded.default?.createDevelopmentNetworkRecorder;
  if (!create) {
    throw new Error(
      'Development network recorder has an invalid module shape.',
    );
  }
  return create();
}
