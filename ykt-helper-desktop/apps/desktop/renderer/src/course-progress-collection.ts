import { reactive } from 'vue';
import {
  BrowserEnvironment,
  type CourseProgressRangeMonths,
  type CourseProgressSnapshot,
} from '@ykt/contracts';

/** Remains alive while the user switches between assistant pages. */
export function createCourseProgressCollection(
  load: (
    rangeMonths: CourseProgressRangeMonths,
    refresh: boolean,
  ) => Promise<CourseProgressSnapshot>,
) {
  const state = reactive({
    rangeMonths: 1 as CourseProgressRangeMonths,
    snapshot: null as CourseProgressSnapshot | null,
    loading: false,
    error: '',
  });
  let initialized = false;
  let pending: Promise<void> | undefined;

  function collect(
    rangeMonths: CourseProgressRangeMonths,
    refresh: boolean,
  ): Promise<void> {
    if (pending) return pending;
    initialized = true;
    if (state.rangeMonths !== rangeMonths) state.snapshot = null;
    state.rangeMonths = rangeMonths;
    state.loading = true;
    state.error = '';
    pending = Promise.resolve()
      .then(() => load(rangeMonths, refresh))
      .then(
        (result) => {
          state.snapshot = result;
        },
        (error) => {
          state.error =
            error instanceof Error
              ? error.message
              : '课程进度读取失败，请重试。';
        },
      )
      .finally(() => {
        state.loading = false;
        pending = undefined;
      });
    return pending;
  }

  return {
    state,
    initialize: () =>
      initialized ? (pending ?? Promise.resolve()) : collect(1, false),
    setRange: (rangeMonths: CourseProgressRangeMonths) =>
      collect(rangeMonths, false),
    refresh: () => collect(state.rangeMonths, true),
  };
}

export const courseProgressCollection = createCourseProgressCollection(
  (rangeMonths, refresh) =>
    window.yuketang.listCourseProgress(
      BrowserEnvironment.Pro,
      rangeMonths,
      refresh,
    ),
);
