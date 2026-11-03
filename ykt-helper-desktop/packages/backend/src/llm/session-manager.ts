import { randomUUID } from 'node:crypto';

interface SessionState {
  readonly problemId: string;
  readonly messages: unknown[];
  readonly initialUserMessage: string;
  initialMessageCount: number;
  requestVersion: number;
  activeRequest: AbortController | undefined;
}

export interface BeginLlmTurnInput {
  readonly sessionId?: string;
  readonly problemId: string;
  readonly initialMessages: readonly unknown[];
  readonly userMessage: string;
  readonly retry: boolean;
}

export interface LlmTurn {
  readonly sessionId: string;
  readonly requestVersion: number;
  readonly messages: readonly unknown[];
  readonly signal: AbortSignal;
  readonly isNewSession: boolean;
  readonly initialUserMessage: string;
}

export class LlmSessionManager {
  readonly #sessions = new Map<string, SessionState>();

  begin(input: BeginLlmTurnInput): LlmTurn {
    const sessionId = input.sessionId?.trim() || randomUUID();
    if (sessionId.length > 128) throw new Error('AI 会话 ID 过长。');

    let session = this.#sessions.get(sessionId);
    const isNewSession = !session;
    if (!session) {
      session = {
        problemId: input.problemId,
        messages: [...input.initialMessages],
        initialUserMessage: input.userMessage,
        initialMessageCount: input.initialMessages.length,
        requestVersion: 0,
        activeRequest: undefined,
      };
      this.#sessions.set(sessionId, session);
    } else {
      if (session.problemId !== input.problemId) {
        throw new Error('AI 会话与当前题目不匹配。');
      }
      if (input.retry) {
        if (messageRole(session.messages.at(-1)) === 'assistant') {
          session.messages.pop();
        }
      } else {
        const message = input.userMessage.trim();
        if (!message) throw new Error('请输入要追问的内容。');
        session.messages.push({ role: 'user', content: message });
      }
    }

    session.activeRequest?.abort();
    const controller = new AbortController();
    session.activeRequest = controller;
    session.requestVersion += 1;
    return {
      sessionId,
      requestVersion: session.requestVersion,
      messages: [...session.messages],
      signal: controller.signal,
      isNewSession,
      initialUserMessage: session.initialUserMessage,
    };
  }

  assertCurrent(turn: LlmTurn): void {
    const session = this.#sessions.get(turn.sessionId);
    if (
      turn.signal.aborted ||
      session?.requestVersion !== turn.requestVersion ||
      session.activeRequest?.signal !== turn.signal
    ) {
      throw new Error('此请求已取消或被较新的请求替代。');
    }
  }

  replaceInitialMessages(turn: LlmTurn, messages: readonly unknown[]): LlmTurn {
    this.assertCurrent(turn);
    const session = this.#sessions.get(turn.sessionId)!;
    session.messages.splice(0, session.initialMessageCount, ...messages);
    session.initialMessageCount = messages.length;
    return { ...turn, messages: [...session.messages] };
  }

  complete(turn: LlmTurn, content: string): boolean {
    const session = this.#sessions.get(turn.sessionId);
    if (
      !session ||
      session.requestVersion !== turn.requestVersion ||
      turn.signal.aborted ||
      session.activeRequest?.signal !== turn.signal
    )
      return false;
    session.activeRequest = undefined;
    session.messages.push({ role: 'assistant', content });
    return true;
  }

  fail(turn: LlmTurn): void {
    const session = this.#sessions.get(turn.sessionId);
    if (session?.requestVersion === turn.requestVersion) {
      session.activeRequest?.abort();
      session.activeRequest = undefined;
    }
  }
}

function messageRole(value: unknown): string | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? String((value as { role?: unknown }).role ?? '')
    : undefined;
}
