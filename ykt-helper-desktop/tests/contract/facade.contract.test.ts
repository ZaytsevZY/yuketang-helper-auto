import { createBackendRuntime } from '@ykt/backend';
import type { RuntimeStatus, YuketangFacade } from '@ykt/contracts';
import { describe, expect, it } from 'vitest';

async function readStatus(adapter: YuketangFacade): Promise<RuntimeStatus> {
  return adapter.getStatus();
}

describe('facade contract', () => {
  it('provides one serializable contract for desktop IPC and CLI output', async () => {
    const runtime = createBackendRuntime();
    await runtime.start();

    const status = await readStatus(runtime.facade);
    expect(JSON.parse(JSON.stringify(status))).toEqual(status);
    expect(status.capabilities).toContain('status');
  });
});
