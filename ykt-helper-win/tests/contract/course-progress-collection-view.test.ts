import { describe, expect, it, vi } from 'vitest';
import {
  BrowserEnvironment,
  type CourseProgressRangeMonths,
  type CourseProgressSnapshot,
} from '@ykt/contracts';
import { createCourseProgressCollection } from '../../apps/desktop/renderer/src/course-progress-collection.js';

function snapshot(
  rangeMonths: CourseProgressRangeMonths,
): CourseProgressSnapshot {
  return {
    environment: BrowserEnvironment.Pro,
    rangeMonths,
    fetchedAt: 100,
    scannedLessons: 0,
    lessons: [],
    warnings: [],
  };
}

describe('course progress time range', () => {
  it('starts with one month and replaces old-range results when the user expands the scan', async () => {
    const load = vi.fn(async (rangeMonths: CourseProgressRangeMonths) =>
      snapshot(rangeMonths),
    );
    const collection = createCourseProgressCollection(load);
    await collection.initialize();
    expect(load).toHaveBeenLastCalledWith(1, false);
    expect(collection.state.snapshot?.rangeMonths).toBe(1);

    const expanded = collection.setRange(12);
    expect(collection.state.rangeMonths).toBe(12);
    expect(collection.state.snapshot).toBeNull();
    await expanded;
    expect(load).toHaveBeenLastCalledWith(12, false);
    expect(collection.state.snapshot?.rangeMonths).toBe(12);

    await collection.refresh();
    expect(load).toHaveBeenLastCalledWith(12, true);
    await collection.initialize();
    expect(load).toHaveBeenCalledTimes(3);
  });
});
