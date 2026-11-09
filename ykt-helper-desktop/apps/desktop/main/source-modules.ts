import { join } from 'node:path';

import type { SourceModuleId } from '@ykt/contracts';

export const sourceModuleIds: readonly SourceModuleId[] = [
  'renderer',
  'ipc',
  'backend',
  'routing',
  'storage',
];

export function isSourceModuleId(value: unknown): value is SourceModuleId {
  return (
    typeof value === 'string' &&
    (sourceModuleIds as readonly string[]).includes(value)
  );
}

export function sourceModulePath(id: SourceModuleId): string {
  const paths: Record<SourceModuleId, string> = {
    renderer: join(__dirname, '../../renderer/src/App.vue'),
    ipc: join(__dirname, '../../preload/index.ts'),
    backend: join(__dirname, '../../../../packages/backend/src/runtime.ts'),
    routing: join(
      __dirname,
      '../../../../packages/routing/src/active/client.ts',
    ),
    storage: join(
      __dirname,
      '../../../../packages/storage/src/sqlite-app-data-store.ts',
    ),
  };
  return paths[id];
}
