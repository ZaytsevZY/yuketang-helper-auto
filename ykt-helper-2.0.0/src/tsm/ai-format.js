// src/tsm/ai-format.js
export function formatProblemForAI(problem, TYPE_MAP) {
  let q = `请回答以下${TYPE_MAP[problem.problemType] || '题目'}，按照格式回复：先给出答案，然后给出解释。\n\n题目：${problem.body || ''}`;
  if (problem.options?.length) {
    q += '\n选项：';
    for (const o of problem.options) q += `\n${o.key}. ${o.value}`;
  }
  q += `

请按照以下格式回答：
答案: [你的答案]
解释: [详细解释]

注意：
- 单选题和投票题请回答选项字母
- 多选题请回答多个选项字母
- 填空题请直接给出答案内容
- 主观题请给出完整回答`;
  return q;
}

export function formatProblemForDisplay(problem, TYPE_MAP) {
  let s = `${TYPE_MAP[problem.problemType] || '题目'}：${problem.body || ''}`;
  if (problem.options?.length) {
    s += '\n\n选项：';
    for (const o of problem.options) s += `\n${o.key}. ${o.value}`;
  }
  return s;
}

export function parseAIAnswer(problem, aiAnswer) {
  try {
    const lines = String(aiAnswer || '').split('\n');
    let answerLine = '';
    for (const line of lines) {
      if (line.includes('答案:') || line.includes('答案：')) {
        answerLine = line.replace(/答案[:：]\s*/, '').trim();
        break;
      }
    }
    if (!answerLine) answerLine = lines[0]?.trim() || '';

    switch (problem.problemType) {
      case 1: // 单选
      case 3: { // 投票
        let m = answerLine.match(/[ABCD]/i);
        if (m) return [m[0].toUpperCase()];
        m = answerLine.match(/[A-Za-z]/);
        if (m) return [m[0].toUpperCase()];
        return null;
      }
      case 2: { // 多选
        let ms = answerLine.match(/[ABCD]/gi);
        if (ms?.length) return [...new Set(ms.map(x => x.toUpperCase()))].sort();
        ms = answerLine.match(/[A-Za-z]/g);
        if (ms?.length) return [...new Set(ms.map(x => x.toUpperCase()))].sort();
        return null;
      }
      case 4: { // 填空
        const blanks = answerLine.split(/[,，\s]+/).filter(Boolean);
        return blanks.length ? blanks : null;
      }
      case 5: // 主观
        return { content: answerLine, pics: [] };
      default:
        return null;
    }
  } catch (e) {
    console.error('[parseAIAnswer] failed', e);
    return null;
  }
}
