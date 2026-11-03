import { describe, expect, it } from 'vitest';
import {
  assignmentRetentionCutoff,
  isAssignmentRetained,
} from '@ykt/contracts';

describe('assignment retention window', () => {
  it.each([
    ['2026-10-13T12:34:56.789Z', '2026-07-13T12:34:56.789Z'],
    ['2026-01-01T00:00:00Z', '2025-10-01T00:00:00Z'],
    ['2026-05-31T08:00:00Z', '2026-02-28T08:00:00Z'],
    ['2024-05-31T08:00:00Z', '2024-02-29T08:00:00Z'],
    ['2026-12-31T08:00:00Z', '2026-09-30T08:00:00Z'],
  ])(
    'subtracts three calendar months from %s with month-end clamping',
    (now, cutoff) => {
      expect(assignmentRetentionCutoff(Date.parse(now))).toBe(
        Date.parse(cutoff),
      );
    },
  );

  it('keeps the exact boundary, future and undated items, but removes older deadlines', () => {
    const now = Date.parse('2026-10-13T08:00:00Z');
    const cutoff = assignmentRetentionCutoff(now);
    expect(isAssignmentRetained({ deadline: cutoff - 1 }, now)).toBe(false);
    for (const deadline of [cutoff, now - 1, now + 365 * 86400_000, null])
      expect(isAssignmentRetained({ deadline }, now)).toBe(true);
  });
});
