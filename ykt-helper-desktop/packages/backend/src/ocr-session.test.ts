import { ProblemType } from '@ykt/contracts';
import { describe, expect, it, vi } from 'vitest';
import { BackendRuntime } from './runtime.js';
import { InMemoryLessonRepository } from './repositories/lesson-repository.js';

const originalImage = 'data:image/png;base64,b2xk';
const updatedImage = 'data:image/png;base64,bmV3';
const answer =
  '{"answer":"B","explanation":"answer explanation","confidence":1,"failureReason":null}';
interface RequestBody {
  model: string;
  messages: unknown[];
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function setup(
  complete: (
    body: RequestBody,
    signal: AbortSignal | null | undefined,
  ) => Promise<string>,
) {
  const lessons = new InMemoryLessonRepository();
  const lesson = lessons.upsertLesson({
    id: 'lesson',
    title: 'Test',
    status: 'active',
  });
  lesson.upsertPresentation({
    id: 'deck',
    lessonId: 'lesson',
    title: 'Test',
    width: 1280,
    height: 720,
    slides: [
      {
        id: 'slide',
        index: 0,
        title: '',
        imageUrl: null,
        problem: {
          id: 'problem',
          lessonId: 'lesson',
          presentationId: 'deck',
          slideId: 'slide',
          type: ProblemType.SingleChoice,
          prompt: '题目内容',
          options: ['A', 'B'],
          blanks: [],
          result: null,
        },
      },
    ],
  });
  const requests: RequestBody[] = [];
  const runtime = new BackendRuntime({
    lessons,
    fetcher: vi.fn(async (url, init) => {
      if (String(url).endsWith('/models'))
        return Response.json({
          data: [
            { id: 'text' },
            { id: 'vision', input_modalities: ['text', 'image'] },
            { id: 'ocr', input_modalities: ['text', 'image'] },
          ],
        });
      const body = JSON.parse(String(init?.body)) as RequestBody;
      requests.push(body);
      return Response.json({
        choices: [{ message: { content: await complete(body, init?.signal) } }],
      });
    }),
  });
  await runtime.start();
  const [profile] = await runtime.facade.connectAiProfile({
    baseUrl: 'https://example.com/v1',
    apiKey: 'fixture',
  });
  await runtime.facade.updateAiProfileSelection({
    id: profile!.id,
    model: 'text',
    visionModel: 'vision',
    ocrModel: 'ocr',
    translationModel: 'text',
    temperature: null,
  });
  return {
    runtime,
    requests,
    generate: (input: {
      retry?: boolean;
      imageUrls?: string[];
      customPrompt?: string;
    }) =>
      runtime.facade.generateAnswerProposal({
        problemId: 'problem',
        sessionId: 'chat',
        ...input,
      }),
  };
}

describe('OCR session lifecycle', () => {
  it('removes stale OCR when retry recognition fails and falls back to the new image', async () => {
    let ocrCalls = 0;
    const fixture = await setup(async ({ model }) => {
      if (model !== 'ocr') return answer;
      if (++ocrCalls === 1) return 'OLD OCR';
      throw new Error('OCR unavailable');
    });
    try {
      await fixture.generate({ imageUrls: [originalImage] });
      const result = await fixture.generate({
        retry: true,
        imageUrls: [updatedImage],
      });
      expect(result.status).toBe('ready');
      expect(result.warnings?.[0]).toContain('OCR unavailable');
      const messages = JSON.stringify(fixture.requests.at(-1)?.messages);
      expect(messages).toContain(updatedImage);
      expect(messages).not.toContain(originalImage);
      expect(messages).not.toContain('OLD OCR');
    } finally {
      await fixture.runtime.stop();
    }
  });

  it('replaces initial OCR on retry while preserving the original question and follow-up history', async () => {
    let ocrCalls = 0;
    const fixture = await setup(async ({ model }) =>
      model === 'ocr' ? (++ocrCalls === 1 ? 'OLD OCR' : 'NEW OCR') : answer,
    );
    try {
      await fixture.generate({
        imageUrls: [originalImage],
        customPrompt: 'Original request',
      });
      await fixture.generate({ customPrompt: 'Follow-up request' });
      const result = await fixture.generate({
        retry: true,
        imageUrls: [updatedImage],
        customPrompt: 'Follow-up request',
      });
      expect(result.status).toBe('ready');
      const messages = JSON.stringify(fixture.requests.at(-1)?.messages);
      expect(messages).toContain('NEW OCR');
      expect(messages).not.toContain('OLD OCR');
      expect(messages).toContain(updatedImage);
      expect(messages).not.toContain(originalImage);
      expect(messages).toContain('Original request');
      expect(messages.match(/Follow-up request/g)).toHaveLength(1);
      expect(messages.match(/answer explanation/g)).toHaveLength(1);
      const retryMessages = fixture.requests.at(-1)?.messages;
      await fixture.generate({ retry: true });
      expect(ocrCalls).toBe(2);
      expect(fixture.requests.at(-1)?.messages).toEqual(retryMessages);
      expect(fixture.requests.at(-1)?.model).toBe('vision');
    } finally {
      await fixture.runtime.stop();
    }
  });

  it.each(['resolve', 'reject'] as const)(
    'aborts old OCR before retry and ignores its late %s',
    async (outcome) => {
      const started = deferred<AbortSignal | null | undefined>();
      const release = deferred<string>();
      let ocrCalls = 0;
      const fixture = await setup(async ({ model }, signal) => {
        if (model !== 'ocr') return answer;
        if (++ocrCalls > 1) return 'CURRENT OCR';
        started.resolve(signal);
        const text = await release.promise;
        if (outcome === 'reject') throw new Error('late OCR error');
        return text;
      });
      try {
        const oldRequest = fixture.generate({ imageUrls: [originalImage] });
        const signal = await started.promise;
        const current = await fixture.generate({
          retry: true,
          imageUrls: [updatedImage],
        });
        release.resolve('STALE OCR');
        const stale = await oldRequest;
        expect(current.status).toBe('ready');
        expect(signal?.aborted).toBe(true);
        expect(stale.status).toBe('failed');
        expect(stale.warnings).toEqual([]);
        expect(
          fixture.requests.filter((request) => request.model === 'vision'),
        ).toHaveLength(1);
        await fixture.generate({ customPrompt: 'Explain' });
        const messages = JSON.stringify(fixture.requests.at(-1)?.messages);
        expect(messages).toContain('CURRENT OCR');
        expect(messages).not.toContain('STALE OCR');
      } finally {
        release.resolve('');
        await fixture.runtime.stop();
      }
    },
  );

  it('does not return a ready proposal for a superseded answer completion', async () => {
    const started = deferred<void>();
    const release = deferred<string>();
    let answerCalls = 0;
    const fixture = await setup(async ({ model }) => {
      if (model === 'ocr') return 'OCR';
      if (++answerCalls === 1) {
        started.resolve();
        return release.promise;
      }
      return answer;
    });
    try {
      const oldRequest = fixture.generate({ imageUrls: [originalImage] });
      await started.promise;
      expect(
        (await fixture.generate({ retry: true, imageUrls: [updatedImage] }))
          .status,
      ).toBe('ready');
      release.resolve(answer.replace('answer explanation', 'STALE ANSWER'));
      expect((await oldRequest).status).toBe('failed');
      await fixture.generate({ customPrompt: 'Explain' });
      expect(JSON.stringify(fixture.requests.at(-1)?.messages)).not.toContain(
        'STALE ANSWER',
      );
    } finally {
      release.resolve(answer);
      await fixture.runtime.stop();
    }
  });
});
