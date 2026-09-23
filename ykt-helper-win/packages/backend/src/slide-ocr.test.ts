import { ProblemType } from '@ykt/contracts';
import { describe, expect, it, vi } from 'vitest';
import { BackendRuntime } from './runtime.js';
import { InMemoryLessonRepository } from './repositories/lesson-repository.js';

describe('slide question OCR', () => {
  it('reads the image before answering placeholder options and retains OCR for follow-up', async () => {
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
    const requests: Array<{ model: string; messages: unknown[] }> = [];
    const fetcher = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url).endsWith('/models'))
          return Response.json({
            data: [
              { id: 'vision', input_modalities: ['text', 'image'] },
              { id: 'ocr', input_modalities: ['text', 'image'] },
            ],
          });
        const request = JSON.parse(String(init?.body));
        requests.push(request);
        return Response.json({
          choices: [
            {
              message: {
                content:
                  request.model === 'ocr'
                    ? '1+1等于多少？ A. 3 B. 2'
                    : '{"answer":"B","explanation":"1+1=2","confidence":1,"failureReason":null}',
              },
            },
          ],
        });
      },
    );
    const runtime = new BackendRuntime({ lessons, fetcher });
    await runtime.start();
    try {
      const [profile] = await runtime.facade.connectAiProfile({
        baseUrl: 'https://example.com/v1',
        apiKey: 'test',
      });
      await runtime.facade.updateAiProfileSelection({
        id: profile!.id,
        model: 'vision',
        visionModel: 'vision',
        ocrModel: 'ocr',
        translationModel: 'vision',
        temperature: null,
      });
      const proposal = await runtime.facade.generateAnswerProposal({
        problemId: 'problem',
        sessionId: 'chat',
        imageUrls: ['data:image/png;base64,aW1hZ2U='],
      });
      expect(requests.map((request) => request.model)).toEqual([
        'ocr',
        'vision',
      ]);
      expect(JSON.stringify(requests[1]?.messages)).toContain('1+1等于多少');
      expect(JSON.stringify(requests[1]?.messages)).toContain(
        'data:image/png;base64,aW1hZ2U=',
      );
      expect(proposal.contextSources).toContain('ocr:1');
      expect(proposal.answer).toEqual(['B']);
      await runtime.facade.generateAnswerProposal({
        problemId: 'problem',
        sessionId: 'chat',
        customPrompt: '为什么？',
      });
      expect(requests).toHaveLength(3);
      expect(JSON.stringify(requests[2]?.messages)).toContain('1+1等于多少');
      for (const [name, response] of [
        ['empty', Response.json({ choices: [{ message: { content: '' } }] })],
        ['http-500', new Response('', { status: 500 })],
      ] as const) {
        fetcher.mockResolvedValueOnce(response);
        const fallback = await runtime.facade.generateAnswerProposal({
          problemId: 'problem',
          sessionId: name,
          imageUrls: ['data:image/png;base64,aW1hZ2U='],
        });
        expect(fallback.status).toBe('ready');
        expect(fallback.answer).toEqual(['B']);
        expect(fallback.warnings?.[0]).toContain('直接读取原图');
        expect(fallback.contextSources).not.toContain('ocr:1');
        expect(JSON.stringify(requests.at(-1)?.messages)).toContain(
          'data:image/png;base64,aW1hZ2U=',
        );
      }
      fetcher.mockResolvedValueOnce(new Response('', { status: 500 }));
      fetcher.mockResolvedValueOnce(new Response('', { status: 503 }));
      const failed = await runtime.facade.generateAnswerProposal({
        problemId: 'problem',
        sessionId: 'both-failed',
        imageUrls: ['data:image/png;base64,aW1hZ2U='],
      });
      expect(failed.status).toBe('failed');
      expect(failed.answer).toBeNull();
      expect(failed.failureReason).toContain('503');
      expect(failed.warnings?.[0]).toContain('500');
    } finally {
      await runtime.stop();
    }
  });
});
