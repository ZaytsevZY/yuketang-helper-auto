import { parseLessonPage, type Lesson } from '@ykt/contracts';
import { describe, expect, it } from 'vitest';
import { chooseClassroom } from '../../apps/desktop/renderer/src/classroom-selection.js';

const id = '1785174499833394944';
const url = `https://pro.yuketang.cn/v2/web/student-lesson-report/3202313/${id}/9086232`;
const lessons: Lesson[] = [
  { id: '1764118559357124352', title: '旧课堂', status: 'ended' },
  { id, title: 'lec3-cnn-v3.6', status: 'ended' },
  { id: '123', title: '进行中课堂', status: 'active' },
];

describe('classroom selection for the current browser page', () => {
  it('preserves the full report ID and selects its ended lesson ahead of old or live lessons', () => {
    expect(parseLessonPage(url)).toEqual({
      environment: 'pro',
      lessonId: id,
      archived: true,
    });
    expect(chooseClassroom(lessons, url, lessons[0]!.id)).toBe(id);
    expect(chooseClassroom([lessons[0]!], url)).toBe('');
  });
  it('recognizes mobile reports and live pages while rejecting unrelated URLs', () => {
    expect(
      parseLessonPage(`https://www.yuketang.cn/m/v2/lesson/student/${id}`)
        ?.archived,
    ).toBe(true);
    expect(
      parseLessonPage('https://pro.yuketang.cn/lesson/fullscreen/v3/123')
        ?.archived,
    ).toBe(false);
    for (const invalid of [
      'invalid',
      url.replace('pro.yuketang.cn', 'pro.yuketang.cn.example.com'),
      url.replace('https:', 'http:'),
      url.replace('https://', 'https://user:pass@'),
    ])
      expect(parseLessonPage(invalid)).toBeNull();
  });
  it('retains normal fallback selection outside lesson pages', () => {
    expect(chooseClassroom(lessons, 'https://pro.yuketang.cn/web', id)).toBe(
      '123',
    );
    expect(
      chooseClassroom(lessons.slice(0, 2), 'https://pro.yuketang.cn/web', id),
    ).toBe(id);
  });
});
