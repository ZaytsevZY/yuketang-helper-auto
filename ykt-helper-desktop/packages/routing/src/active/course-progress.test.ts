import { describe, expect, it } from 'vitest';

import { fetchCourseProgress } from './course-progress.js';

const lessonId = '1781559351092572544';
const currentTime = Date.parse('2026-10-07T12:00:00+08:00');

describe('course progress collection', () => {
  it('matches ended lecture activities to student reports without treating page views as watching', async () => {
    const requested: string[] = [];
    const snapshot = await fetchCourseProgress(
      async (url) => {
        requested.push(url);
        if (url.includes('/courses/list'))
          return {
            errcode: 0,
            data: {
              list: [{ classroom_id: 3202313, name: '示例课程', role: 5 }],
            },
          };
        if (url.includes('/logs/learn/'))
          return {
            errcode: 0,
            data: {
              activities: [
                {
                  type: 14,
                  courseware_id: lessonId,
                  title: '第一讲',
                  create_time: 1790215225000,
                  attend_status: false,
                  is_finished: true,
                },
                {
                  type: 14,
                  courseware_id: '123',
                  title: '进行中',
                  attend_status: false,
                  is_finished: false,
                },
                {
                  type: 19,
                  courseware_id: '456',
                  title: '作业',
                  is_finished: true,
                },
              ],
            },
          };
        if (url.includes('/student/detail'))
          return {
            code: 0,
            data: {
              detail: { checkInTime: 0, checkinSource: -1, valid: 0 },
              live: {
                lives_count: 1,
                finish_live: 0,
                finish_live_count: 0,
                live_rate: 0,
                replay_count: 1,
                finish_replay: 0,
                finish_replay_count: 0,
                replay_rate: 0,
              },
            },
          };
        throw new Error(`Unexpected URL: ${url}`);
      },
      () => currentTime,
    );

    expect(snapshot.scannedLessons).toBe(1);
    expect(snapshot.lessons[0]).toMatchObject({
      lessonId,
      courseName: '示例课程',
      title: '第一讲',
      attention: ['checkin-unrecorded', 'live-unwatched', 'replay-unwatched'],
      liveRate: 0,
      replayRate: 0,
    });
    expect(
      requested.filter((url) => url.includes('/student/detail')),
    ).toHaveLength(1);
  });

  it('keeps uncertain check-in status out of the attention list and identifies partial replay', async () => {
    const snapshot = await fetchCourseProgress(
      async (url) => {
        if (url.includes('/courses/list'))
          return {
            errcode: 0,
            data: { list: [{ classroom_id: 1, name: '课程', role: 5 }] },
          };
        if (url.includes('/logs/learn/'))
          return {
            errcode: 0,
            data: {
              activities: [
                {
                  type: 14,
                  courseware_id: lessonId,
                  title: '课堂',
                  create_time: Date.parse('2026-09-24T12:00:00+08:00'),
                  attend_status: null,
                  is_finished: true,
                },
              ],
            },
          };
        return {
          code: 0,
          data: {
            detail: { checkInTime: 0, checkinSource: -1, valid: 0 },
            live: {
              lives_count: 1,
              finish_live: 1,
              finish_live_count: 1,
              live_rate: 1,
              replay_count: 1,
              finish_replay: 0,
              finish_replay_count: 0,
              replay_rate: 0.4,
            },
          },
        };
      },
      () => currentTime,
    );
    expect(snapshot.lessons[0]?.attention).toEqual(['replay-incomplete']);
  });

  it('defaults to one month, skips old reports, and stops ordered log pagination at the cutoff', async () => {
    const requested: string[] = [];
    const snapshot = await fetchCourseProgress(
      async (url) => {
        requested.push(url);
        if (url.includes('/courses/list'))
          return {
            errcode: 0,
            data: { list: [{ classroom_id: 1, name: '课程', role: 5 }] },
          };
        if (url.includes('/logs/learn/'))
          return {
            errcode: 0,
            data: {
              activities: [
                {
                  type: 14,
                  courseware_id: '1',
                  is_finished: true,
                  create_time: Date.parse('2026-10-01T12:00:00+08:00'),
                },
                ...Array.from({ length: 199 }, (_, index) => ({
                  type: 14,
                  courseware_id: String(index + 2),
                  is_finished: true,
                  create_time: Date.parse('2026-08-01T12:00:00+08:00'),
                })),
              ],
            },
          };
        return { code: 0, data: { detail: {}, live: {} } };
      },
      () => currentTime,
    );
    expect(snapshot.rangeMonths).toBe(1);
    expect(snapshot.scannedLessons).toBe(1);
    expect(snapshot.lessons).toHaveLength(1);
    expect(
      requested.filter((url) => url.includes('/logs/learn/')),
    ).toHaveLength(1);
    expect(
      requested.filter((url) => url.includes('/student/detail')),
    ).toHaveLength(1);
  });

  it('allows up to one year and rejects a longer range', async () => {
    const get = async (url: string) => {
      if (url.includes('/courses/list'))
        return {
          errcode: 0,
          data: { list: [{ classroom_id: 1, name: '课程', role: 5 }] },
        };
      if (url.includes('/logs/learn/'))
        return {
          errcode: 0,
          data: {
            activities: [
              {
                type: 14,
                courseware_id: '1',
                is_finished: true,
                create_time: Date.parse('2026-02-01T12:00:00+08:00'),
              },
              {
                type: 14,
                courseware_id: '2',
                is_finished: true,
                create_time: Date.parse('2025-08-01T12:00:00+08:00'),
              },
            ],
          },
        };
      return { code: 0, data: { detail: {}, live: {} } };
    };
    const snapshot = await fetchCourseProgress(get, () => currentTime, 12);
    expect(snapshot.rangeMonths).toBe(12);
    expect(snapshot.lessons.map((item) => item.lessonId)).toEqual(['1']);
    await expect(
      fetchCourseProgress(get, () => currentTime, 24 as 12),
    ).rejects.toThrow('仅支持最近');
  });
});
