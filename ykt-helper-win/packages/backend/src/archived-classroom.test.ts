import { BrowserEnvironment } from '@ykt/contracts';
import { BrowserLessonCollector, YuketangActiveClient } from '@ykt/routing';
import { describe, expect, it } from 'vitest';

import { createBackendRuntime } from './runtime.js';

const oldId = '1764118559357124352';
const currentId = '1785174499833394944';
const cover =
  'https://thu-pri-ups.yuketang.cn/common_uploads/15853706/test-slide';

// Minimal shapes from the ended report's lesson-info/review responses. No
// student detail, headers, credentials or signed resource URLs are retained.
function fixture() {
  const collector = new BrowserLessonCollector();
  const requests: string[] = [];
  const client = new YuketangActiveClient({
    credentials: {
      load: async () => ({
        cookieHeader: '',
        bearerToken: null,
        userId: 'test',
      }),
    },
    transport: {
      request: async (request) => {
        requests.push(request.url);
        expect(request.method).toBe('GET');
        if (request.url.includes('/student/lesson-info'))
          return {
            status: 200,
            headers: {},
            body: {
              code: 0,
              data: { lessonName: 'lec3-cnn-v3.6', courseName: '深度学习' },
            },
          };
        if (request.url.includes('/student/review'))
          return {
            status: 200,
            headers: {},
            body: {
              code: 0,
              data: {
                timelineList: [
                  { id: 'slide-1', type: 'slide', index: 1, cover },
                ],
              },
            },
          };
        return {
          status: 200,
          headers: {},
          body: { data: { onLessonClassrooms: [] } },
        };
      },
    },
    browserCollector: collector,
    socketFactory: () => {
      throw new Error('Ended reports must not open a live socket');
    },
  });
  const runtime = createBackendRuntime({ activeClient: client });
  const observe = (lessonId: string, endpoint: string, data: unknown) =>
    collector.observeHttp({
      url: `https://pro.yuketang.cn/api/v3/classroom-report/${endpoint}?lesson_id=${lessonId}`,
      statusCode: 200,
      body: JSON.stringify({ code: 0, data }),
      contextId: 'same-browser-tab',
    });
  return { runtime, collector, requests, observe };
}

describe('ended classroom report discovery', () => {
  it('refreshes the current ended page without passive traffic or a live connection', async () => {
    const f = fixture();
    await f.runtime.start();
    try {
      expect(
        await f.runtime.facade.refreshLessons(
          BrowserEnvironment.Pro,
          currentId,
        ),
      ).toEqual([
        { id: currentId, title: '深度学习 · lec3-cnn-v3.6', status: 'ended' },
      ]);
      expect(
        (await f.runtime.facade.listPresentations(currentId))[0]?.slides,
      ).toHaveLength(1);
      expect(f.requests).toHaveLength(3);
      // A fresh browser context can deliver only metadata after the explicit refresh.
      await f.observe(currentId, 'student/lesson-info', {
        lessonName: 'lec3-cnn-v3.6',
        courseName: '深度学习',
      });
      expect(
        (await f.runtime.facade.listPresentations(currentId))[0]?.slides,
      ).toHaveLength(1);
    } finally {
      await f.runtime.stop();
    }
  });

  it('discovers the current report with extensionless slides after an older classroom', async () => {
    const f = fixture();
    await f.runtime.start();
    try {
      await f.observe(oldId, 'student/detail', {
        slides: [
          {
            id: 'old',
            cover: 'https://thu-private-qn.yuketang.cn/slide/old.jpg',
          },
        ],
      });
      await f.observe(currentId, 'student/lesson-info', {
        lessonId: currentId,
        lessonName: 'lec3-cnn-v3.6',
        courseName: '深度学习',
      });
      await f.observe(currentId, 'student/review', {
        timelineList: [
          {
            id: 'slide-1',
            presentationId: 'deck-1',
            index: 1,
            type: 'slide',
            cover,
          },
          {
            id: 'slide-2',
            presentationId: 'deck-1',
            index: 2,
            type: 'slide',
            cover: `${cover}-2`,
          },
        ],
      });
      const lessons = await f.runtime.facade.refreshLessons(
        BrowserEnvironment.Pro,
      );
      expect(lessons).toContainEqual({
        id: currentId,
        title: '深度学习 · lec3-cnn-v3.6',
        status: 'ended',
      });
      expect(await f.runtime.facade.listPresentations(currentId)).toMatchObject(
        [
          {
            slides: [
              { id: 'slide-1', imageUrl: cover },
              { id: 'slide-2', imageUrl: `${cover}-2` },
            ],
          },
        ],
      );
      expect(
        (await f.runtime.facade.listPresentations(oldId))[0]?.slides,
      ).toHaveLength(1);
      expect(
        f.requests.every((url) => url.endsWith('/classroom/on-lesson')),
      ).toBe(true);
    } finally {
      await f.runtime.stop();
    }
  });

  it('discovers a named lesson before its images arrive and updates an existing fallback title', async () => {
    const f = fixture();
    await f.runtime.start();
    try {
      await f.observe(currentId, 'student/detail', {
        slides: [
          {
            id: 'old-shape',
            cover: 'https://thu-private-qn.yuketang.cn/slide/first.jpg',
          },
        ],
      });
      expect(await f.runtime.facade.listLessons()).toContainEqual({
        id: currentId,
        title: '已结束课堂',
        status: 'ended',
      });
      await f.observe(currentId, 'student/lesson-info', {
        lessonName: 'lec3-cnn-v3.6',
      });
      expect(await f.runtime.facade.listLessons()).toContainEqual({
        id: currentId,
        title: 'lec3-cnn-v3.6',
        status: 'ended',
      });
      await f.observe(oldId, 'lesson/basic-info', {
        lessonName: '8月31日授课',
      });
      expect(await f.runtime.facade.listLessons()).toContainEqual({
        id: oldId,
        title: '8月31日授课',
        status: 'ended',
      });
    } finally {
      await f.runtime.stop();
    }
  });
});
