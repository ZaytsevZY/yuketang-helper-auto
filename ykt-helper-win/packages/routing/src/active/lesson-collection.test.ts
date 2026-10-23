import { BrowserEnvironment } from '@ykt/contracts';
import { describe, expect, it, vi } from 'vitest';
import { BrowserLessonCollector } from './browser-lesson-collector.js';

const url =
  'https://www.yuketang.cn/api/v3/lesson/presentation/fetch?presentation_id=deck-1';
function setup() {
  const collector = new BrowserLessonCollector();
  const received = vi.fn();
  collector.watchLesson(
    BrowserEnvironment.Standard,
    'lesson-1',
    'deck-1',
    received,
  );
  return { collector, received };
}

describe('PPT collection diagnostics', () => {
  it('separates a rejected API response from a changed PPT format', async () => {
    const { collector } = setup();
    await collector.observeHttp({
      url,
      statusCode: 200,
      body: '{"code":50004,"data":null}',
    });
    expect(collector.getCollectionStatus('lesson-1')).toMatchObject({
      phase: 'response-error',
      detail: '课件接口返回错误码 50004',
    });
  });
  it.each([
    ['invalid JSON', '{', '有效 JSON'],
    ['unknown schema', '{"data":{"unknown":[]}}', 'slides / pages'],
  ])(
    'reports %s instead of silently accepting an empty deck',
    async (_name, body, detail) => {
      const { collector, received } = setup();
      await collector.observeHttp({ url, statusCode: 200, body });
      expect(collector.getCollectionStatus('lesson-1')).toMatchObject({
        phase: 'format-error',
        detail: expect.stringContaining(detail),
      });
      expect(received).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error' }),
      );
      expect(received).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'presentation' }),
      );
    },
  );

  it('keeps an explicitly empty slide list valid and retries after an error', async () => {
    const { collector } = setup();
    await collector.observeHttp({ url, statusCode: 503, body: '' });
    expect(collector.getCollectionStatus('lesson-1')).toMatchObject({
      phase: 'network-error',
      detail: 'HTTP 503',
    });
    await collector.observeHttp({
      url,
      statusCode: 200,
      body: '{"data":{"slides":[]}}',
    });
    expect(collector.getCollectionStatus('lesson-1')).toMatchObject({
      phase: 'ready',
      slideCount: 0,
      problemCount: 0,
    });
  });

  it('does not attribute another tab or environment request to the connected classroom', () => {
    const { collector } = setup();
    collector.observeCollectionRequest({
      url: url.replace('deck-1', 'other-deck'),
      phase: 'network-error',
    });
    collector.observeCollectionRequest({
      url: url.replace('www.', 'pro.'),
      phase: 'receiving',
      receivedBytes: 4096,
    });
    expect(collector.getCollectionStatus('lesson-1')?.phase).toBe('waiting');
    collector.unwatchLesson('lesson-1');
    expect(collector.getCollectionStatus('lesson-1')).toBeNull();
  });

  it('updates archived PPT counts as lazy slide images arrive', async () => {
    const { collector } = setup();
    collector.onArchivedPresentation(vi.fn());
    await collector.observeHttp({
      url: 'https://www.yuketang.cn/api/v3/classroom-report/student/review?lesson_id=lesson-1',
      statusCode: 200,
      contextId: 'tab-1',
      body: JSON.stringify({
        code: 0,
        data: {
          timelineList: [
            {
              type: 'slide',
              id: 's1',
              cover: 'https://thu-pri-ups.yuketang.cn/common_uploads/image1',
            },
          ],
        },
      }),
    });
    expect(collector.getCollectionStatus('lesson-1')).toMatchObject({
      phase: 'ready',
      slideCount: 1,
    });
    // Concurrent report metadata must not replace ready with waiting/receiving.
    collector.observeCollectionRequest({
      url: 'https://www.yuketang.cn/api/v3/classroom-report/student/detail?lesson_id=lesson-1',
      phase: 'receiving',
    });
    expect(collector.getCollectionStatus('lesson-1')?.phase).toBe('ready');
  });
});
