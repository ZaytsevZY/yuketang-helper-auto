// @vitest-environment jsdom
import { expect, it } from 'vitest';
import type { AssignmentDetail } from '@ykt/contracts';
import { assignmentAiDraft } from '../../apps/desktop/renderer/src/assignment-ai';

const detail: AssignmentDetail = {
  assignment: {
    title: '测试',
    courseName: '课程',
  } as AssignmentDetail['assignment'],
  mode: 'exam-review',
  fetchedAt: 1,
  fontUrl: null,
  descriptionHtml: '',
  maxRetry: 0,
  lateAllowed: false,
  lateDeadline: null,
  problems: [
    {
      id: '1',
      index: 1,
      type: 1,
      typeText: '单选题',
      score: 10,
      bodyHtml:
        '<p>A &lt; B &amp; C</p><p>$x^2$<br>第二行</p><script>secret()</script><img src="https://pro.yuketang.cn/img.png" alt="示意图" onerror="evil()">',
      options: [{ label: 'A', html: '<b>选项一</b>' }],
      answerHtml: 'B',
      attachments: [],
      status: 'graded',
      myScore: 0,
      correct: false,
      correctAnswerHtml: 'A',
      explanationHtml: '<p>参考解析</p>',
      remarkHtml: '',
      comments: [],
      externalUrl: null,
      maxRetry: 0,
      remainingRetries: null,
      allowResults: [],
    },
  ],
};
it('extracts readable structured text and released feedback without active HTML or image downloads', () => {
  const draft = assignmentAiDraft(detail, 0)!;
  expect(draft.hasEncryptedText).toBe(false);
  for (const text of [
    'A < B & C',
    '$x^2$\n第二行',
    'A. 选项一',
    '我的作答\nB',
    '参考答案\nA',
    '参考解析',
    '[图片：示意图]',
    '得分 0 / 10',
  ])
    expect(draft.text).toContain(text);
  expect(draft.text).not.toMatch(/<script|secret\(\)|evil\(\)|https:\/\//);
});
it('keeps substituted Unicode intact and labels it as undecoded, including font-only evidence', () => {
  const draft = assignmentAiDraft(
    {
      ...detail,
      problems: [
        {
          ...detail.problems[0]!,
          bodyHtml: '<span class="xuetangx-com-encrypted-font">𛈒ABC</span>',
        },
      ],
    },
    0,
  )!;
  expect(draft.hasEncryptedText).toBe(true);
  expect(draft.text).toContain('【未解码字符：𛈒ABC】');
  expect(
    assignmentAiDraft(
      { ...detail, fontUrl: 'https://pro.yuketang.cn/f.ttf' },
      0,
    )?.hasEncryptedText,
  ).toBe(true);
});
it('does not offer extraction for exam covers or missing questions', () => {
  expect(assignmentAiDraft({ ...detail, mode: 'exam-cover' }, 0)).toBeNull();
  expect(assignmentAiDraft({ ...detail, problems: [] }, 0)).toBeNull();
});

it('extracts only the selected question and excludes whole-paper descriptions and other answers', () => {
  const first = detail.problems[0]!;
  const paper = {
    ...detail,
    descriptionHtml: '整卷说明不得混入',
    problems: [
      first,
      {
        ...first,
        id: first.id,
        index: 7,
        bodyHtml: '第二题独立题干',
        answerHtml: '第二题作答',
        explanationHtml: '第二题解析',
      },
    ],
  };
  const draft = assignmentAiDraft(paper, 1)!;
  expect(draft.title).toBe('测试 · 第 7 题');
  expect(draft.text).toContain('第二题独立题干');
  expect(draft.text).toContain('第二题作答');
  expect(draft.text).toContain('第二题解析');
  expect(draft.text).not.toContain('A < B');
  expect(draft.text).not.toContain('参考解析');
  expect(draft.text).not.toContain('整卷说明不得混入');
  expect(draft.text.match(/第 \d+ 题/g)).toEqual(['第 7 题']);
  for (const position of [-1, 0.5, 2, NaN])
    expect(assignmentAiDraft(paper, position)).toBeNull();
});
