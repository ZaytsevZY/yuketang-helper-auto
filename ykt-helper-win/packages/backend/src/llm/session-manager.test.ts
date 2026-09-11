import { describe, expect, it } from 'vitest';

import { LlmSessionManager } from './session-manager.js';

describe('LlmSessionManager', () => {
  it('keeps follow-up context and replaces an in-flight retry', () => {
    const sessions = new LlmSessionManager();
    const first = sessions.begin({
      sessionId: 'session-1',
      problemId: 'problem-1',
      initialMessages: [
        { role: 'system', content: 'Answer the problem.' },
        { role: 'user', content: 'Initial problem' },
      ],
      userMessage: '',
      retry: false,
    });
    const retry = sessions.begin({
      sessionId: first.sessionId,
      problemId: 'problem-1',
      initialMessages: [],
      userMessage: '',
      retry: true,
    });

    expect(first.signal.aborted).toBe(true);
    expect(retry.messages).toHaveLength(2);
    expect(sessions.complete(first, 'stale response')).toBe(false);
    expect(sessions.complete(retry, 'current response')).toBe(true);

    const followUp = sessions.begin({
      sessionId: first.sessionId,
      problemId: 'problem-1',
      initialMessages: [],
      userMessage: 'Explain why.',
      retry: false,
    });
    expect(followUp.messages).toEqual([
      { role: 'system', content: 'Answer the problem.' },
      { role: 'user', content: 'Initial problem' },
      { role: 'assistant', content: 'current response' },
      { role: 'user', content: 'Explain why.' },
    ]);
  });
});
