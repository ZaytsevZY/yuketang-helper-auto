import { reactive } from 'vue';
import { BrowserEnvironment, type AssignmentSnapshot } from '@ykt/contracts';

/** Owned by the application, not by the conditionally mounted assignment page. */
export function createAssignmentCollection(
  load: (refresh: boolean) => Promise<AssignmentSnapshot>,
) {
  const state = reactive({
    snapshot: null as AssignmentSnapshot | null,
    loading: false,
    error: '',
  });
  let initialized = false;
  let pending: Promise<void> | undefined;

  function collect(refresh: boolean): Promise<void> {
    if (pending) return pending;
    initialized = true;
    state.loading = true;
    state.error = '';
    pending = Promise.resolve()
      .then(() => load(refresh))
      .then(
        (result) => {
          state.snapshot = result;
        },
        (error) => {
          state.error =
            error instanceof Error ? error.message : '作业读取失败，请重试。';
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
      initialized ? (pending ?? Promise.resolve()) : collect(false),
    refresh: () => collect(true),
  };
}

export const assignmentCollection = createAssignmentCollection((refresh) =>
  window.yuketang.listAssignments(BrowserEnvironment.Pro, refresh),
);
