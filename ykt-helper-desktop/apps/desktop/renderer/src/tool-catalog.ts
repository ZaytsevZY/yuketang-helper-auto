import type { ToolPanelId } from '@ykt/contracts';
export const toolLabels: Record<ToolPanelId, string> = {
  tools: '全部工具',
  classroom: '课堂',
  assignments: '作业',
  courses: '课程',
  problems: '题目',
  ai: 'AI',
  courseware: '课件',
  profiles: '模型',
  settings: '设置',
  simulator: '模拟',
  diagnostics: '诊断',
  network: '网络',
};
export const toolIcons: Record<ToolPanelId, string> = {
  tools: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  classroom: 'M3 4h18v12H3zM8 21l4-5 4 5M7 8h10M7 12h6',
  assignments: 'M8 4H5v17h14V4h-3M8 3h8v4H8zM8 12h8M8 16h5',
  courses:
    'M12 5v16M12 5C8 2 4 3 2 4v15c4-2 7-1 10 2 3-3 6-4 10-2V4c-2-1-6-2-10 1',
  problems:
    'M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 4M12 17v1M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  ai: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z',
  courseware: 'M3 4h18v13H3zM8 21h8M12 17v4M7 12l3-3 3 3 3-5 2 5',
  profiles: 'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6',
  settings: 'M4 7h16M4 17h16M8 4v6M16 14v6',
  simulator: 'M8 4v16l12-8z',
  diagnostics: 'M9 3h6v4H9zM7 5H4v16h16V5h-3M8 12h8M8 16h5',
  network: 'M3 12h4l3-7 4 14 3-7h4',
};
