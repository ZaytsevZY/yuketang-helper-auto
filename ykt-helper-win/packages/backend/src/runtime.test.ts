import { ErrorCode, type YuketangError } from '@ykt/contracts';
import { describe, expect, it } from 'vitest';

import { createBackendRuntime } from './runtime.js';

describe('BackendRuntime', () => {
  it('exposes the same baseline facade to every adapter', async () => {
    const runtime = createBackendRuntime();

    expect((await runtime.facade.getStatus()).state).toBe('stopped');
    await runtime.start();
    expect(await runtime.facade.getStatus()).toEqual({
      state: 'running',
      version: '2.0.0',
      capabilities: [
        'status',
        'lessons',
        'problems',
        'answer-validation',
        'fixture-replay',
        'storage',
        'ai-profiles',
        'ai-proposals',
        'ocr',
        'translation',
        'classroom-notices',
      ],
    });
    expect(await runtime.facade.listLessons()).toEqual([]);
  });

  it('does not pretend M0 can submit answers', async () => {
    const runtime = createBackendRuntime();

    await expect(
      runtime.facade.submitAnswer({ problemId: 'p1', answer: 'A' }),
    ).rejects.toMatchObject<Partial<YuketangError>>({
      code: ErrorCode.NotImplemented,
    });
  });
});
