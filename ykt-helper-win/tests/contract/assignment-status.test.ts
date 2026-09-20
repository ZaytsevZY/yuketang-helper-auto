import type { Assignment } from '@ykt/contracts';
import { describe, expect, it } from 'vitest';
import {
  assignmentStatusLabel,
  matchesAssignmentStatus,
} from '../../apps/desktop/renderer/src/assignment-status';

const base: Assignment = {
  id: 'hw-1',
  classroomId: '1',
  courseName: '课程',
  title: '作业',
  kind: 'homework',
  deadline: 200,
  url: 'https://pro.yuketang.cn/',
  status: 'answered',
  answeredCount: 2,
  totalCount: 2,
  questions: [],
  statusMessage: null,
  graded: null,
  score: null,
  totalScore: null,
  audited: false,
};

describe('assignment grading presentation', () => {
  it('labels and filters graded homework without losing answer progress', () => {
    const item = { ...base, graded: true };
    expect(assignmentStatusLabel(item)).toBe('已批改');
    expect(matchesAssignmentStatus(item, 'graded', 100)).toBe(true);
    expect(matchesAssignmentStatus(item, 'answered', 100)).toBe(true);
    expect(matchesAssignmentStatus(item, 'unknown', 100)).toBe(false);
  });

  it.each([false, null])(
    'does not call pending or unknown grading completed (%s)',
    (graded) => {
      const item = { ...base, graded };
      expect(assignmentStatusLabel(item)).toBe('全部已答');
      expect(matchesAssignmentStatus(item, 'graded', 100)).toBe(false);
    },
  );

  it('keeps a graded exam in both submitted and graded filters', () => {
    const item: Assignment = {
      ...base,
      kind: 'exam',
      graded: true,
      examStatus: 'submitted',
      score: 0,
      totalScore: 100,
    };
    expect(assignmentStatusLabel(item)).toBe('已批改');
    expect(matchesAssignmentStatus(item, 'submitted', 100)).toBe(true);
    expect(matchesAssignmentStatus(item, 'graded', 100)).toBe(true);
  });

  it('shows a confirmed submission even when answer counts are unavailable', () => {
    const item: Assignment = {
      ...base,
      kind: 'exam',
      status: 'unknown',
      examStatus: 'submitted',
      answeredCount: null,
      totalCount: null,
    };
    expect(assignmentStatusLabel(item)).toBe('已交卷');
    expect(matchesAssignmentStatus(item, 'unknown', 100)).toBe(false);
  });

  it.each([
    ['invalid', '已作废'],
    ['absent', '缺考'],
  ] as const)('preserves exam outcome %s', (examStatus, label) => {
    expect(assignmentStatusLabel({ ...base, examStatus, graded: true })).toBe(
      label,
    );
  });
});
