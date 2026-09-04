import { BrowserEnvironment } from '@ykt/contracts';
import { YuketangActiveClient, type ActiveHttpTransport } from '@ykt/routing';
import { MemoryAppDataStore } from '@ykt/storage';
import { describe, expect, it } from 'vitest';

import { createBackendRuntime } from './runtime.js';

describe('M5 backend storage', () => {
  it('refreshes user information into the shared persistent store', async () => {
    const dataStore = new MemoryAppDataStore();
    const transport: ActiveHttpTransport = {
      request: async () => ({
        status: 200,
        headers: {},
        body: { data: { user_info: { user_id: 42, name: 'Student' } } },
      }),
    };
    const runtime = createBackendRuntime({
      dataStore,
      activeClient: new YuketangActiveClient({
        credentials: {
          load: async () => ({
            cookieHeader: 'session=test',
            bearerToken: null,
            userId: '42',
          }),
        },
        transport,
      }),
    });
    await runtime.start();

    expect(
      await runtime.facade.refreshUser(BrowserEnvironment.Standard),
    ).toMatchObject({ id: '42', name: 'Student' });
    expect(
      await runtime.facade.getUser(BrowserEnvironment.Standard),
    ).toMatchObject({ id: '42', name: 'Student' });

    await runtime.stop();
  });
});
