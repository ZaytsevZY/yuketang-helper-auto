import { describe, expect, it, vi } from 'vitest';
import { BrowserEnvironment, type AssignmentSnapshot } from '@ykt/contracts';
import { createAssignmentCollection } from '../../apps/desktop/renderer/src/assignment-collection.js';

const snapshot: AssignmentSnapshot = {
  environment: BrowserEnvironment.Pro,
  fetchedAt: 100,
  assignments: [],
  warnings: [],
};

describe('application-owned assignment state', () => {
  it('initializes once, shares in-flight refreshes and retains data between page visits', async () => {
    let finish!: (result: AssignmentSnapshot) => void;
    const load = vi.fn(
      () =>
        new Promise<AssignmentSnapshot>((resolve) => {
          finish = resolve;
        }),
    );
    const collection = createAssignmentCollection(load);
    const startup = collection.initialize();
    const nextVisit = collection.initialize();
    const duringStartup = collection.refresh();
    expect(nextVisit).toBe(startup);
    expect(duringStartup).toBe(startup);
    expect(collection.state.loading).toBe(true);
    await Promise.resolve();
    finish(snapshot);
    await startup;
    expect(collection.state.snapshot).toEqual(snapshot);
    await collection.initialize();
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenLastCalledWith(false);
    const refresh = collection.refresh();
    expect(collection.state.snapshot).toEqual(snapshot);
    await Promise.resolve();
    expect(load).toHaveBeenLastCalledWith(true);
    finish({ ...snapshot, fetchedAt: 200 });
    await refresh;
    expect(collection.state.snapshot?.fetchedAt).toBe(200);
  });

  it('keeps startup errors until an explicit refresh after login', async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('请登录'))
      .mockResolvedValue(snapshot);
    const collection = createAssignmentCollection(load);
    await collection.initialize();
    await collection.initialize();
    expect(load).toHaveBeenCalledTimes(1);
    expect(collection.state.error).toBe('请登录');
    expect(collection.state.loading).toBe(false);
    await collection.refresh();
    expect(collection.state.error).toBe('');
    expect(collection.state.snapshot).toEqual(snapshot);
  });

  it('keeps the previous result visible when a manual refresh fails', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce(snapshot)
      .mockRejectedValue(new Error('网络错误'));
    const collection = createAssignmentCollection(load);
    await collection.initialize();
    await collection.refresh();
    await collection.initialize();
    expect(load).toHaveBeenCalledTimes(2);
    expect(collection.state.snapshot).toEqual(snapshot);
    expect(collection.state.error).toBe('网络错误');
    expect(collection.state.loading).toBe(false);
  });
});
