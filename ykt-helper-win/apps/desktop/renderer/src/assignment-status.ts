import type { Assignment } from '@ykt/contracts';

export function assignmentStatusLabel(item: Assignment): string {
  // 考试交卷状态与作答进度分别读取；作业有作答记录不代表最终提交。
  if (item.examStatus === 'invalid') return '已作废';
  if (item.examStatus === 'absent') return '缺考';
  if (item.graded === true) return '已批改';
  if (item.examStatus === 'submitted') return '已交卷';
  return {
    unanswered: '未作答',
    partial: item.totalCount ? '部分作答' : '有作答记录',
    answered: '全部已答',
    unknown: '状态未知',
  }[item.status];
}

export function matchesAssignmentStatus(
  item: Assignment,
  filter: string,
  now: number,
): boolean {
  if (filter === 'all') return true;
  if (filter === 'graded') return item.graded === true;
  if (filter === 'submitted') return item.examStatus === 'submitted';
  if (filter === 'overdue')
    return item.deadline !== null && item.deadline <= now;
  if (filter === 'unknown') return assignmentStatusLabel(item) === '状态未知';
  return item.status === filter;
}
