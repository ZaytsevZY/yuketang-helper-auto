function cleanProblemBody(body, problemType, TYPE_MAP) {
  if (!body) return '';
  
  const typeLabel = TYPE_MAP[problemType];
  if (!typeLabel) return body;
  
  // 去除题目开头的类型标识，如 "填空题：" "单选题：" 等
  const pattern = new RegExp(`^${typeLabel}[：:\\s]+`, 'i');
  return body.replace(pattern, '').trim();
}

// 改进的 AI prompt 格式化函数
export function formatProblemForAI(problem, TYPE_MAP) {
  const problemType = TYPE_MAP[problem.problemType] || '题目';
  
  const cleanBody = cleanProblemBody(problem.body, problem.problemType, TYPE_MAP);
  
  let q = `分析以下${problemType}并按格式回答：\n\n题目：${cleanBody}`;
  
  if (problem.options?.length) {
    q += '\n选项：';
    for (const o of problem.options) q += `\n${o.key}. ${o.value}`;
  }

  // 根据题目类型给出精确的格式要求
  switch (problem.problemType) {
    case 1: // 单选题
      q += `\n\n格式要求：\n答案: [单个字母]\n解释: [简要说明]\n\n注意：只选一个选项，答案为大写字母如A`;
      break;

    case 2: // 多选题
      q += `\n\n格式要求：\n答案: [多个字母用顿号分开]\n解释: [简要说明]\n\n注意：可选多个，格式如A、B、C`;
      break;

    case 3: // 投票题
      q += `\n\n格式要求：\n答案: [单个字母]\n解释: [简要说明]\n\n注意：只选一个选项，答案为大写字母`;
      break;

    case 4: // 填空题
      q += `\n\n这是一道填空题。

重要说明：
- 题目内容已经去除了"填空题："等标识
- 你只需要分析题目要求，给出需要填入的答案
- 不要在答案中重复任何题目类型的字样

格式要求：
答案: [直接给出需要填入的内容]
解释: [简要说明]

示例：
如果题目是"光合作用的产物是___和___"
答案: 氧气,葡萄糖
解释: 光合作用产生氧气和葡萄糖

多个填空用逗号分开`;
      break;

    case 5: // 主观题
      q += `\n\n格式要求：\n答案: [完整回答]\n解释: [补充说明，可选]\n\n注意：直接回答问题，不要重复题目`;
      break;

    default:
      q += `\n\n格式要求：\n答案: [你的答案]\n解释: [详细解释]`;
  }

  return q;
}

// 改进的融合模式 prompt 格式化函数
export function formatProblemForVision(problem, TYPE_MAP, hasTextInfo = false) {
  const problemType = TYPE_MAP[problem.problemType] || '题目';
  
  let basePrompt = hasTextInfo 
    ? `结合文本信息和图片内容分析${problemType}，按格式回答：`
    : `观察图片内容，识别${problemType}并按格式回答：`;

  if (hasTextInfo && problem.body) {
    // ✅ 清理题目内容
    const cleanBody = cleanProblemBody(problem.body, problem.problemType, TYPE_MAP);
    
    basePrompt += `\n\n【文本信息】\n题目：${cleanBody}`;
    if (problem.options?.length) {
      basePrompt += '\n选项：';
      for (const o of problem.options) basePrompt += `\n${o.key}. ${o.value}`;
    }
    basePrompt += '\n\n若图片内容与文本冲突，以图片为准。';
  }

  // 根据题目类型添加具体格式要求
  switch (problem.problemType) {
    case 1: // 单选题
      basePrompt += `\n\n格式要求：\n答案: [单个字母]\n解释: [选择理由]\n\n注意：只选一个，如A`;
      break;

    case 2: // 多选题
      basePrompt += `\n\n格式要求：\n答案: [多个字母用顿号分开]\n解释: [选择理由]\n\n注意：格式如A、B、C`;
      break;

    case 3: // 投票题
      basePrompt += `\n\n格式要求：\n答案: [单个字母]\n解释: [选择理由]\n\n注意：只选一个选项`;
      break;

    case 4: // 填空题
      basePrompt += `\n\n这是一道填空题。

重要说明：
- 题目内容已经处理，不含"填空题"等字样
- 观察图片和文本，找出需要填入的内容
- 答案中不要出现任何题目类型标识

格式要求：
答案: [直接给出填空内容]
解释: [简要说明]

示例：
答案: 氧气,葡萄糖
解释: 光合作用的产物

多个填空用逗号分开`;
      break;

    case 5: // 主观题
      basePrompt += `\n\n格式要求：\n答案: [完整回答]\n解释: [补充说明]\n\n注意：直接回答，不要重复题目`;
      break;

    default:
      basePrompt += `\n\n格式要求：\n答案: [你的答案]\n解释: [详细解释]`;
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
    let answerIdx = -1;

    // 先定位“答案:”所在行
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('答案:') || line.includes('答案：')) {
        answerLine = line.replace(/答案[:：]\s*/, '').trim();
        answerIdx = i;
        break;
      }
    }

    // === 对填空题和主观题，允许多行答案 ===
    if ((problem.problemType === 4 || problem.problemType === 5) && answerIdx >= 0) {
      const block = [];

      // 当前行如果有内容，先收进去
      if (answerLine) block.push(answerLine);

      // 继续向下收集，直到遇到“解释:”或文本结束
      for (let i = answerIdx + 1; i < lines.length; i++) {
        const l = lines[i];
        if (/^\s*解释[:：]/.test(l)) break;
        block.push((l || '').trimEnd());
      }

      const merged = block.join('\n').trim();
      if (merged) {
        answerLine = merged;
      }
    }

    // 如果仍然没有任何答案内容，退回到第一行兜底
    if (!answerLine) {
      answerLine = (lines[0] || '').trim();
    }

    console.log(
      '[雨课堂助手][INFO][parseAIAnswer] 题目类型:',
      problem.problemType,
      '原始答案行:',
      answerLine
    );

    switch (problem.problemType) {
      case 1: // 单选题
      case 3: { // 投票题
        let m = answerLine.match(/[ABCDEFGHIJKLMNOPQRSTUVWXYZ]/);
        if (m) {
          console.log('[雨课堂助手][INFO][parseAIAnswer] 单选/投票解析结果:', [m[0]]);
          return [m[0]];
        }
        
        const chineseMatch = answerLine.match(/选择?([ABCDEFGHIJKLMNOPQRSTUVWXYZ])/);
        if (chineseMatch) {
          console.log('[雨课堂助手][INFO][parseAIAnswer] 单选/投票中文解析结果:', [chineseMatch[1]]);
          return [chineseMatch[1]];
        }
        
        console.log('[雨课堂助手][INFO][parseAIAnswer] 单选/投票解析失败');
        return null;
      }
      
      case 2: { // 多选题
        if (answerLine.includes('、')) {
          const options = answerLine.split('、')
            .map(s => s.trim().match(/[ABCDEFGHIJKLMNOPQRSTUVWXYZ]/))
            .filter(m => m)
            .map(m => m[0]);
          if (options.length > 0) {
            const result = [...new Set(options)].sort();
            console.log('[雨课堂助手][INFO][parseAIAnswer] 多选顿号解析结果:', result);
            return result;
          }
        }
        
        if (answerLine.includes(',') || answerLine.includes('，')) {
          const options = answerLine.split(/[,，]/)
            .map(s => s.trim().match(/[ABCDEFGHIJKLMNOPQRSTUVWXYZ]/))
            .filter(m => m)
            .map(m => m[0]);
          if (options.length > 0) {
            const result = [...new Set(options)].sort();
            console.log('[雨课堂助手][INFO][parseAIAnswer] 多选逗号解析结果:', result);
            return result;
          }
        }
        
        const letters = answerLine.match(/[ABCDEFGHIJKLMNOPQRSTUVWXYZ]/g);
        if (letters && letters.length > 1) {
          const result = [...new Set(letters)].sort();
          console.log('[雨课堂助手][INFO][parseAIAnswer] 多选连续解析结果:', result);
          return result;
        }
        
        if (letters && letters.length === 1) {
          console.log('[雨课堂助手][INFO][parseAIAnswer] 多选单个解析结果:', letters);
          return letters;
        }
        
        console.log('[雨课堂助手][INFO][parseAIAnswer] 多选解析失败');
        return null;
      }
      
      case 4: { // 填空题
        // 更激进的清理策略
        let cleanAnswer = answerLine
          .replace(/^(填空题|简答题|问答题|题目|答案是?)[:：\s]*/gi, '')
          .trim();
        
        console.log('[雨课堂助手][INFO][parseAIAnswer] 清理后答案:', cleanAnswer);
        
        // 如果清理后还包含这些词，继续清理
        if (/填空题|简答题|问答题|题目/i.test(cleanAnswer)) {
          cleanAnswer = cleanAnswer.replace(/填空题|简答题|问答题|题目/gi, '').trim();
          console.log('[雨课堂助手][INFO][parseAIAnswer] 二次清理后:', cleanAnswer);
        }
        
        const answerLength = cleanAnswer.length;
        
        if (answerLength <= 50) {
          cleanAnswer = cleanAnswer.replace(/^[^\w\u4e00-\u9fa5]+/, '').replace(/[^\w\u4e00-\u9fa5]+$/, '');
          
          const blanks = cleanAnswer.split(/[,，;；\s]+/).filter(Boolean);
          if (blanks.length > 0) {
            console.log('[雨课堂助手][INFO][parseAIAnswer] 填空解析结果:', blanks);
            return blanks;
          }
        }
        
        if (cleanAnswer) {
          const result = { content: cleanAnswer, pics: [] };
          console.log('[雨课堂助手][INFO][parseAIAnswer] 简答题解析结果:', result);
          return result;
        }
        
        console.log('[雨课堂助手][INFO][parseAIAnswer] 填空/简答解析失败');
        return null;
      }
      
      case 5: { // 主观题
        const content = answerLine
          .replace(/^(主观题|论述题)[:：\s]*/i, '')
          .trim();
          
        if (content) {
          const result = { content, pics: [] };
          console.log('[雨课堂助手][INFO][parseAIAnswer] 主观题解析结果:', result);
          return result;
        }
        
        console.log('[雨课堂助手][INFO][parseAIAnswer] 主观题解析失败');
        return null;
      }
      
      default:
        console.log('[雨课堂助手][INFO][parseAIAnswer] 未知题目类型:', problem.problemType);
        return null;
    }
  } catch (e) {
    console.error('[雨课堂助手][ERR][parseAIAnswer] 解析失败', e);
    return null;
  }
}