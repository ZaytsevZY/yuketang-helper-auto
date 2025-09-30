// src/tsm/ai-format.js

// 改进的 AI prompt 格式化函数
export function formatProblemForAI(problem, TYPE_MAP) {
  const problemType = TYPE_MAP[problem.problemType] || '题目';
  let q = `请分析以下${problemType}并严格按照要求格式回答。\n\n题目：${problem.body || ''}`;
  
  if (problem.options?.length) {
    q += '\n选项：';
    for (const o of problem.options) q += `\n${o.key}. ${o.value}`;
  }

  // 根据题目类型给出精确的格式要求
  switch (problem.problemType) {
    case 1: // 单选题
      q += `

请严格按照以下格式回答：
答案: [单个字母，如A]
解释: [简要解释，50字以内]

重要提醒：
- 单选题只能选择一个选项
- 答案必须是单个大写字母（A、B、C、D等）
- 解释要简洁明了`;
      break;

    case 2: // 多选题
      q += `

请严格按照以下格式回答：
答案: [多个字母用顿号分开，如A、B、C]
解释: [简要解释，80字以内]

重要提醒：
- 多选题可以选择多个选项
- 多个答案用中文顿号（、）分开
- 所有字母必须大写`;
      break;

    case 3: // 投票题
      q += `

请严格按照以下格式回答：
答案: [单个字母，如A]
解释: [简要解释，50字以内]

重要提醒：
- 投票题只能选择一个选项
- 答案必须是单个大写字母`;
      break;

    case 4: // 填空题
      q += `

请严格按照以下格式回答：
答案: [填空内容]
解释: [简要解释，60字以内]

重要提醒：
- 如果有多个空，用逗号分开
- 答案要准确简洁
- 避免冗余词汇`;
      break;

    case 5: // 主观题
      q += `

请严格按照以下格式回答：
答案: [完整回答，100字以内，题目复杂可适当增加]
解释: [补充说明，可选]

重要提醒：
- 主观题需要完整回答
- 控制在100字以内，特别复杂的题目可以适当增加
- 要点清晰，逻辑明确`;
      break;

    default:
      q += `

请严格按照以下格式回答：
答案: [你的答案]
解释: [详细解释]`;
  }

  return q;
}

// 改进的融合模式 prompt 格式化函数
export function formatProblemForVision(problem, TYPE_MAP, hasTextInfo = false) {
  const problemType = TYPE_MAP[problem.problemType] || '题目';
  
  let basePrompt = hasTextInfo 
    ? `请结合提供的文本信息和图片内容分析以下${problemType}，并严格按照格式要求回答。`
    : `请仔细观察图片内容，识别并分析${problemType}，严格按照格式要求回答。`;

  if (hasTextInfo && problem.body) {
    basePrompt += `\n\n【文本信息】\n题目：${problem.body}`;
    if (problem.options?.length) {
      basePrompt += '\n选项：';
      for (const o of problem.options) basePrompt += `\n${o.key}. ${o.value}`;
    }
    basePrompt += '\n\n【要求】请结合图片内容验证并完善上述信息，如有冲突以图片为准。';
  } else {
    basePrompt += '\n\n【要求】请完全基于图片内容识别题目类型、题干和选项。';
  }

  // 根据题目类型添加具体格式要求
  switch (problem.problemType) {
    case 1: // 单选题
      basePrompt += `

请严格按照以下格式回答：
答案: [单个字母，如A]
解释: [选择理由，50字以内]

格式要求：
- 必须是单个大写字母
- 解释简洁明了`;
      break;

    case 2: // 多选题
      basePrompt += `

请严格按照以下格式回答：
答案: [多个字母用顿号分开，如A、B、C]
解释: [选择理由，80字以内]

格式要求：
- 多个选项用中文顿号（、）分开
- 所有字母大写
- 按字母顺序排列`;
      break;

    case 3: // 投票题
      basePrompt += `

请严格按照以下格式回答：
答案: [单个字母，如A]
解释: [选择理由，50字以内]

格式要求：
- 必须是单个大写字母`;
      break;

    case 4: // 填空题
      basePrompt += `

请严格按照以下格式回答：
答案: [填空内容]
解释: [解题思路，60字以内]

格式要求：
- 多个空用逗号分开
- 答案精确简洁`;
      break;

    case 5: // 主观题
      basePrompt += `

请严格按照以下格式回答：
答案: [完整回答，100字以内]
解释: [补充说明，可选]

格式要求：
- 回答完整但简洁
- 一般控制在100字以内
- 特别复杂的可适当增加`;
      break;

    default:
      basePrompt += `

请严格按照以下格式回答：
答案: [你的答案]
解释: [详细解释]`;
  }

  return basePrompt;
}

export function formatProblemForDisplay(problem, TYPE_MAP) {
  let s = `${TYPE_MAP[problem.problemType] || '题目'}：${problem.body || ''}`;
  if (problem.options?.length) {
    s += '\n\n选项：';
    for (const o of problem.options) s += `\n${o.key}. ${o.value}`;
  }
  return s;
}

// 改进的答案解析函数
export function parseAIAnswer(problem, aiAnswer) {
  try {
    const lines = String(aiAnswer || '').split('\n');
    let answerLine = '';
    
    // 寻找答案行
    for (const line of lines) {
      if (line.includes('答案:') || line.includes('答案：')) {
        answerLine = line.replace(/答案[:：]\s*/, '').trim();
        break;
      }
    }
    
    // 如果没找到答案行，尝试第一行
    if (!answerLine) {
      answerLine = lines[0]?.trim() || '';
    }

    console.log('[parseAIAnswer] 题目类型:', problem.problemType, '答案行:', answerLine);

    switch (problem.problemType) {
      case 1: // 单选题
      case 3: { // 投票题
        // 优先匹配常见选项字母
        let m = answerLine.match(/[ABCDEFGHIJKLMNOPQRSTUVWXYZ]/);
        if (m) {
          console.log('[parseAIAnswer] 单选/投票解析结果:', [m[0]]);
          return [m[0]];
        }
        
        // 尝试从中文描述中提取
        const chineseMatch = answerLine.match(/选择?([ABCDEFGHIJKLMNOPQRSTUVWXYZ])/);
        if (chineseMatch) {
          console.log('[parseAIAnswer] 单选/投票中文解析结果:', [chineseMatch[1]]);
          return [chineseMatch[1]];
        }
        
        console.log('[parseAIAnswer] 单选/投票解析失败');
        return null;
      }
      
      case 2: { // 多选题
        // 处理用顿号分开的格式：A、B、C
        if (answerLine.includes('、')) {
          const options = answerLine.split('、')
            .map(s => s.trim().match(/[ABCDEFGHIJKLMNOPQRSTUVWXYZ]/))
            .filter(m => m)
            .map(m => m[0]);
          if (options.length > 0) {
            const result = [...new Set(options)].sort();
            console.log('[parseAIAnswer] 多选顿号解析结果:', result);
            return result;
          }
        }
        
        // 处理逗号分开的格式：A,B,C 或 A, B, C
        if (answerLine.includes(',') || answerLine.includes('，')) {
          const options = answerLine.split(/[,，]/)
            .map(s => s.trim().match(/[ABCDEFGHIJKLMNOPQRSTUVWXYZ]/))
            .filter(m => m)
            .map(m => m[0]);
          if (options.length > 0) {
            const result = [...new Set(options)].sort();
            console.log('[parseAIAnswer] 多选逗号解析结果:', result);
            return result;
          }
        }
        
        // 处理连续字母格式：ABC 或 A B C
        const letters = answerLine.match(/[ABCDEFGHIJKLMNOPQRSTUVWXYZ]/g);
        if (letters && letters.length > 1) {
          const result = [...new Set(letters)].sort();
          console.log('[parseAIAnswer] 多选连续解析结果:', result);
          return result;
        }
        
        // 如果只有一个字母，也返回数组格式
        if (letters && letters.length === 1) {
          console.log('[parseAIAnswer] 多选单个解析结果:', letters);
          return letters;
        }
        
        console.log('[parseAIAnswer] 多选解析失败');
        return null;
      }
      
      case 4: { // 填空题
        // 移除可能的标点和多余空格
        let cleanAnswer = answerLine.replace(/^[^\w\u4e00-\u9fa5]+/, '').replace(/[^\w\u4e00-\u9fa5]+$/, '');
        
        // 处理多个空的情况，支持逗号、分号等分隔符
        const blanks = cleanAnswer.split(/[,，;；\s]+/).filter(Boolean);
        if (blanks.length > 0) {
          console.log('[parseAIAnswer] 填空解析结果:', blanks);
          return blanks;
        }
        
        console.log('[parseAIAnswer] 填空解析失败');
        return null;
      }
      
      case 5: { // 主观题
        // 主观题保留完整内容，但去除前后空白
        const content = answerLine.trim();
        if (content) {
          const result = { content, pics: [] };
          console.log('[parseAIAnswer] 主观题解析结果:', result);
          return result;
        }
        
        console.log('[parseAIAnswer] 主观题解析失败');
        return null;
      }
      
      default:
        console.log('[parseAIAnswer] 未知题目类型:', problem.problemType);
        return null;
    }
  } catch (e) {
    console.error('[parseAIAnswer] 解析失败', e);
    return null;
  }
}