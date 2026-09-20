import { describe, expect, it, vi } from 'vitest';
import { BrowserEnvironment, type AssignmentSnapshot } from '@ykt/contracts';
import { createBackendRuntime } from '@ykt/backend';
import { YuketangActiveClient } from '@ykt/routing';
import {
  AssignmentAuthError,
  fetchAssignments,
} from '../../packages/routing/src/active/assignments.js';

const snapshot: AssignmentSnapshot = {
  environment: BrowserEnvironment.Pro,
  fetchedAt: 100,
  assignments: [],
  warnings: [],
};
function facadeWith(collect: () => Promise<AssignmentSnapshot>) {
  const client = new YuketangActiveClient({
    credentials: {
      load: async () => ({ cookieHeader: '', bearerToken: null, userId: null }),
    },
  });
  vi.spyOn(client, 'listAssignments').mockImplementation(collect);
  return createBackendRuntime({ activeClient: client }).facade;
}

describe('assignment collection lifetime', () => {
  it('shares startup, remount and explicit refresh calls while a collection is running', async () => {
    let finish!: (value: AssignmentSnapshot) => void;
    const collect = vi.fn(
      () =>
        new Promise<AssignmentSnapshot>((resolve) => {
          finish = resolve;
        }),
    );
    const facade = facadeWith(collect);
    const first = facade.listAssignments(BrowserEnvironment.Pro);
    const remount = facade.listAssignments(BrowserEnvironment.Pro);
    const refresh = facade.listAssignments(BrowserEnvironment.Pro, true);
    await vi.waitFor(() => expect(collect).toHaveBeenCalledTimes(1));
    finish(snapshot);
    expect(await Promise.all([first, remount, refresh])).toEqual([
      snapshot,
      snapshot,
      snapshot,
    ]);
    expect(await facade.listAssignments(BrowserEnvironment.Pro)).toEqual(
      snapshot,
    );
    expect(collect).toHaveBeenCalledTimes(1);
    const next = facade.listAssignments(BrowserEnvironment.Pro, true);
    await vi.waitFor(() => expect(collect).toHaveBeenCalledTimes(2));
    finish({ ...snapshot, fetchedAt: 200 });
    expect((await next).fetchedAt).toBe(200);
    expect(collect).toHaveBeenCalledTimes(2);
  });

  it('does not retry startup authentication failures on passive reads', async () => {
    const collect = vi
      .fn()
      .mockRejectedValueOnce(new Error('请登录'))
      .mockResolvedValue(snapshot);
    const facade = facadeWith(collect);
    await expect(
      facade.listAssignments(BrowserEnvironment.Pro),
    ).rejects.toThrow('请登录');
    await expect(
      facade.listAssignments(BrowserEnvironment.Pro),
    ).rejects.toThrow('请登录');
    expect(collect).toHaveBeenCalledTimes(1);
    expect(await facade.listAssignments(BrowserEnvironment.Pro, true)).toEqual(
      snapshot,
    );
    expect(collect).toHaveBeenCalledTimes(2);
  });
});

describe('bounded course collection', () => {
  it('collects four courses concurrently but keeps each course pagination sequential', async () => {
    vi.useFakeTimers();
    try {
      let running = 0,
        peak = 0;
      const activeCourses = new Set<string>();
      const pages: string[] = [];
      const get = async (input: string) => {
        const url = new URL(input);
        if (url.pathname.includes('/courses/list'))
          return {
            data: {
              list: Array.from({ length: 14 }, (_, i) => ({
                classroom_id: i + 1,
              })),
            },
          };
        const cid = url.pathname.split('/').at(-1)!;
        expect(activeCourses.has(cid)).toBe(false);
        activeCourses.add(cid);
        peak = Math.max(peak, ++running);
        const page = Number(url.searchParams.get('page'));
        pages.push(`${cid}:${page}`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        activeCourses.delete(cid);
        running--;
        return {
          data: {
            activities:
              page === 0 && cid === '1'
                ? Array.from({ length: 200 }, (_, id) => ({ id, type: 1 }))
                : [],
          },
        };
      };
      const start = Date.now();
      const request = fetchAssignments(get, '2598', Date.now);
      await vi.runAllTimersAsync();
      await request;
      expect(peak).toBe(4);
      expect(pages.filter((p) => p.startsWith('1:'))).toEqual(['1:0', '1:1']);
      expect(Date.now() - start).toBe(4000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('drains existing workers on authentication failure without starting more courses', async () => {
    const finish: Array<() => void> = [];
    const requested: string[] = [];
    const get = async (input: string) => {
      const url = new URL(input);
      if (url.pathname.includes('/courses/list'))
        return {
          data: {
            list: Array.from({ length: 10 }, (_, i) => ({
              classroom_id: i + 1,
            })),
          },
        };
      const cid = url.pathname.split('/').at(-1)!;
      requested.push(cid);
      if (cid === '1') throw new AssignmentAuthError();
      await new Promise<void>((resolve) => finish.push(resolve));
      return { data: { activities: [] } };
    };
    let settled = false;
    const task = fetchAssignments(get, '2598', Date.now).catch((error) => {
      settled = true;
      return error;
    });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(requested).toHaveLength(4);
    expect(settled).toBe(false);
    finish.forEach((resolve) => resolve());
    expect(await task).toBeInstanceOf(AssignmentAuthError);
    expect(requested).toHaveLength(4);
  });
});
