// src/ai/kimi.js
import { gm } from '../core/env.js';

function getActiveProfile(aiCfg) {
  const cfg = aiCfg || {};
  const profiles = Array.isArray(cfg.profiles) ? cfg.profiles : [];
  if (!profiles.length) {
    const legacyKey = cfg.kimiApiKey;
    if (!legacyKey) return null;
    return {
      id: 'legacy',
      name: 'Kimi Legacy',
      baseUrl: 'https://api.moonshot.cn/v1/chat/completions',
      apiKey: legacyKey,
      model: 'moonshot-v1-8k',
      visionModel: 'moonshot-v1-8k-vision-preview',
    };
  }
  const activeId = cfg.activeProfileId;
  let p = profiles.find(p => p.id === activeId);
  if (!p) p = profiles[0];
  if (!p.baseUrl) p.baseUrl = 'https://api.moonshot.cn/v1/chat/completions';
  return p;
}

function makeChatUrl(profile) {
//   const base = (profile.baseUrl || 'https://api.moonshot.cn').replace(/\/+$/,'');
//   return `${base}/v1/chat/completions`;   
    return profile.baseUrl;
}

// -----------------------------------------------
// Unified Prompt blocks for Text & Vision
// -----------------------------------------------
const BASE_SYSTEM_PROMPT = [
  '1) 任何时候优先遵循【用户输入（优先级最高）】中的明确要求；',
  '2) 当输入是课件页面（PPT）图像或题干文本时，先判断是否存在“明确题目”；',
  '3) 若存在明确题目，则输出以下格式的内容：',
  '   单选：格式要求：\n答案: [单个字母]\n解释: [选择理由]\n\n注意：只选一个，如A',
  '   多选：格式要求：\n答案: [多个字母用顿号分开]\n解释: [选择理由]\n\n注意：格式如A、B、C',
  '   投票：格式要求：\n答案: [单个字母]\n解释: [选择理由]\n\n注意：只选一个选项，如A',
  '   填空/主观题: 格式要求：答案: [直接给出答案内容]，解释: [补充说明]',
  '4) 若识别不到明确题目，直接使用回答用户输入的问题',
  '3) 如果PROMPT格式不正确，或者你只接收了图片，输出：',
  '   STATE: NO_PROMPT',
  '   SUMMARY: <介绍页面/上下文的主要内容>',
].join('\n');

// Vision 补充：识别题型与版面元素的步骤说明
const VISION_GUIDE = [
  '【视觉识别要求】',
  'A. 先判断是否为题目页面（是否有题干/选项/空格/问句等）',
  'B. 若是题目，尝试提取题干、选项与关键信息；',
  'C. 否则参考用户输入回答',
].join('\n');



/**
 * 通用 OpenAI 协议文本模型调用
 */
export async function queryAI(question, aiCfg) {
  const profile = getActiveProfile(aiCfg);
  if (!profile || !profile.apiKey) {
    throw new Error('请先在设置中配置 AI API Key');
  }

  const url = makeChatUrl(profile);
  const model = profile.model || 'gpt-4o-mini'; // 默认给一个合理值

  return new Promise((resolve, reject) => {
    gm.xhr({
      method: 'POST',
      url,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${profile.apiKey}`,
      },
      data: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: BASE_SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: [
                  '【文本模式说明】可能为题目文本，也可能为普通问答。请先执行决策闸，再回答。',
                  '【用户输入（优先级最高）】',
                  question || '（无）',
                ].join('\n'),
              },
            ],
          },
        ],
        temperature: 0.6,
      }),
      onload: (res) => {
        try {
          console.log('[雨课堂助手][AI OpenAI] Status:', res.status);
          console.log('[雨课堂助手][AI OpenAI] Response:', res.responseText);

          if (res.status !== 200) {
            reject(new Error(`AI 接口请求失败: ${res.status}`));
            return;
          }
          const data = JSON.parse(res.responseText);
          const content = data.choices?.[0]?.message?.content;
          if (content) resolve(content);
          else reject(new Error('AI返回内容为空'));
        } catch (e) {
          reject(new Error(`解析API响应失败: ${e.message}`));
        }
      },
      onerror: () => reject(new Error('网络请求失败')),
      timeout: 30000,
    });
  });
}

// 通用 OpenAI 协议聊天请求封装（用于 Vision 两步调用）
function chatCompletion(profile, payload, debugLabel = '[AI OpenAI]', timeoutMs = 60000) {
  const url = makeChatUrl(profile);

  return new Promise((resolve, reject) => {
    gm.xhr({
      method: 'POST',
      url,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${profile.apiKey}`,
      },
      data: JSON.stringify(payload),
      timeout: timeoutMs,
      onload: (res) => {
        try {
          console.log(`[雨课堂助手]${debugLabel} Status:`, res.status);
          console.log(`[雨课堂助手]${debugLabel} Response:`, res.responseText);

          if (res.status !== 200) {
            let errorMessage = `AI 请求失败: ${res.status}`;
            try {
              const errorData = JSON.parse(res.responseText);
              if (errorData.error?.message) {
                errorMessage += ` - ${errorData.error.message}`;
              }
              if (errorData.error?.code) {
                errorMessage += ` (${errorData.error.code})`;
              }
            } catch {
              errorMessage += ` - ${res.responseText}`;
            }
            reject(new Error(errorMessage));
            return;
          }

          const data = JSON.parse(res.responseText);
          resolve(data);
        } catch (e) {
          console.error(`[雨课堂助手]${debugLabel} 解析响应失败:`, e);
          reject(new Error(`解析API响应失败: ${e.message}`));
        }
      },
      onerror: (err) => {
        console.error(`[雨课堂助手]${debugLabel} 网络请求失败:`, err);
        reject(new Error('网络请求失败'));
      },
    });
  });
}

async function singleStepVisionCall(profile, cleanBase64List, textPrompt, options = {}) {
  const visionModel = profile.visionModel || profile.model;
  const timeoutMs = options.timeout || 60000;

  const visionTextHeader = [
    '【融合模式说明】你将看到一张课件/PPT截图与可选的附加文本。',
    VISION_GUIDE,
  ].join('\n');

  const imageBlocks = []
  for (const b64 of cleanBase64List) {
    imageBlocks.push({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${b64}` },
    });
  }

  const messages = [
    { role: 'system', content: BASE_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        ...imageBlocks,
        {
          type: 'text',
          text: [
            visionTextHeader,
            '【用户输入（优先级最高）】',
            textPrompt || '（无）',
          ].join('\n'),
        },
      ],
    },
  ];

  const data = await chatCompletion(
    profile,
    {
      model: visionModel,
      messages,
      temperature: 0.3,
    },
    '[AI OpenAI Vision 单步]',
    timeoutMs,
  );

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('AI返回内容为空');
  }
  console.log('[AI OpenAI Vision] 成功获取回答(单步)');
  return content;
}


/**
 * 通用 OpenAI 协议 Vision 模型（图像+文本）
 */
export async function queryAIVision(imageBase64, textPrompt, aiCfg, options = {}) {
  const profile = getActiveProfile(aiCfg);
  if (!profile || !profile.apiKey) {
    throw new Error('请先在设置中配置 AI API Key');
  }

  // ===== 兼容单图 / 多图 =====
  const inputList = Array.isArray(imageBase64) ? imageBase64 : [imageBase64];
  const cleanBase64List = inputList
    .filter(Boolean)
    .map(x => String(x).replace(/^data:image\/[^;]+;base64,/, ''))
    .filter(x => !!x);
  if (cleanBase64List.length === 0) throw new Error('图像数据格式错误');

  const visionModel = profile.visionModel || profile.model;
  const textModel = profile.model;
  const hasSeparateTextModel = !!textModel && textModel !== visionModel;

  const {
    disableTwoStep = false,
    twoStepDebug = false,
    timeout: timeoutMs = 60000,
  } = options || {};

  // -------- 0. 如果只有 VLM（或者显式关闭两步），回退到单步逻辑 --------
  if (!hasSeparateTextModel || disableTwoStep) {
    if (twoStepDebug) {
      console.log('[雨课堂助手][INFO][vision] use single-step vision', {
        hasSeparateTextModel,
        disableTwoStep,
      });
    }
    return singleStepVisionCall(profile, cleanBase64List, textPrompt, { timeout: timeoutMs });
  }

  if (twoStepDebug) {
    console.log('[雨课堂助手][INFO][vision] use TWO-STEP pipeline', {
      visionModel,
      textModel,
    });
  }

  // ===================== Step 1: Vision 抽结构化题目 =====================
  const STEP1_SYSTEM_PROMPT = `
你是一个“题目结构化助手”。你将看到课件截图和可选的附加文本，请从中提取出清晰的题目结构，并以 JSON 格式输出。

你不仅要识别文字（类似 OCR），还要理解图片里的内容（例如物体、颜色、形状、数量、相对位置等），并把这些与题目有关的信息转化为题干或补充说明的一部分。

请尽量识别：
- question_type: "single_choice" | "multiple_choice" | "fill_in" | "subjective" | "visual_only" | "unknown"
- stem: 题干文本（如果题干主要依赖图片，请用自然语言描述图片中与题目相关的内容，可保留数学公式信息）
- options: 一个对象，键为 "A"、"B"、"C"、"D" 等，值为选项内容文字（若不是选择题可为空对象）
- image_facts: （可选）一个字符串数组，列出与解题有关的关键图像事实，例如 ["图中是一根黄色的香蕉", "背景是白色"]。
- requires_image_for_solution: 布尔值。如果即使你尽力用文字描述图片，仍然很难仅凭文字保证答对（例如复杂几何图形或高度依赖精确位置关系的题目），请设为 true；如果你的文字描述已经足够让人类或文字模型解题，请设为 false。

输出示例（仅示例，不是固定模板）：
{
  "question_type": "single_choice",
  "stem": "根据图片中的水果，选择它的颜色。",
  "options": {
    "A": "红色",
    "B": "黄色",
    "C": "蓝色",
    "D": "绿色"
  },
  "image_facts": [
    "图片中是一根黄色的香蕉，背景为白色"
  ],
  "requires_image_for_solution": false
}

如果无法识别题目或截图并非题目，请尽量给出你能看到的内容，但仍然保持上述 JSON 结构（字段缺省时可以用 null、空对象或空数组）。
仅输出 JSON，不要任何额外文字。
`.trim();

  const step1Messages = [
    { role: 'system', content: STEP1_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        ...cleanBase64List.map(b64 => ({
          type: 'image_url',
          image_url: { url: `data:image/png;base64,${b64}` },
        })),
        textPrompt
          ? {
              type: 'text',
              text: `【辅助文本】\n${textPrompt}`,
            }
          : {
              type: 'text',
              text: '【辅助文本】（无额外文本，仅根据截图识别题目）',
            },
      ],
    },
  ];

  let structuredQuestion;
  try {
    const data1 = await chatCompletion(
      profile,
      {
        model: visionModel,
        messages: step1Messages,
        temperature: 0.1,
      },
      '[AI OpenAI Vision Step1]',
      timeoutMs,
    );

    const content1 = data1.choices?.[0]?.message?.content || '';
    if (twoStepDebug) {
      console.log('[雨课堂助手][DEBUG][vision-step1] raw content:', content1);
    }

    const jsonMatch = content1.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('no JSON found in step1 result');

    structuredQuestion = JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.warn('[雨课堂助手][WARN][vision-step1] failed, fallback to single-step', err);
    return singleStepVisionCall(profile, cleanBase64List, textPrompt, { timeout: timeoutMs });
  }

  if (!structuredQuestion || !structuredQuestion.stem) {
    console.warn('[雨课堂助手][WARN][vision-step1] invalid structuredQuestion, fallback');
    return singleStepVisionCall(profile, cleanBase64List, textPrompt, { timeout: timeoutMs });
  }

  if (twoStepDebug) {
    console.log('[雨课堂助手][INFO][vision-step1] structuredQuestion:', structuredQuestion);
  }

  // 如果模型明确表示“必须依赖原始图像才能解题”，则回退到单步 Vision，避免纯文本推理丢失关键信息
  if (structuredQuestion.requires_image_for_solution === true) {
    console.warn('[雨课堂助手][INFO][vision] step1 says image is essential, fallback to single-step');
    return singleStepVisionCall(profile, cleanBase64List, textPrompt, { timeout: timeoutMs });
  }

  // ===================== Step 2: Text 模型纯文本推理解题 =====================
  const {
    question_type,
    stem,
    options: sqOptions = {},
    image_facts = [],
  } = structuredQuestion;

  let solvePrompt = '你是一个严谨的解题助手，请根据下面的题目进行推理解答：\n\n';

  solvePrompt += `【题干】\n${stem}\n\n`;

  const optionKeys = Object.keys(sqOptions);
  if (optionKeys.length > 0) {
    solvePrompt += '【选项】\n';
    for (const key of optionKeys) {
      solvePrompt += `${key}. ${sqOptions[key]}\n`;
    }
    solvePrompt += '\n';
  }

  solvePrompt += '请在心里逐步推理，但只按以下格式输出：\n';

  if (question_type === 'single_choice' || question_type === 'unknown') {
    solvePrompt += '答案: [单个大写字母]\n解释: [简要说明你的推理过程]\n';
  } else if (question_type === 'multiple_choice') {
    solvePrompt += '答案: [多个大写字母，用顿号分隔，如 A、C、D]\n解释: [简要说明你的推理过程]\n';
  } else if (question_type === 'fill_in') {
    solvePrompt += '答案: [直接给出需要填入的内容，多个空用逗号分隔]\n解释: [简要说明你的推理过程]\n';
  } else if (question_type === 'subjective') {
    solvePrompt += '答案: [完整回答]\n解释: [可选的补充说明]\n';
  }

  // 将图像关键信息一并提供给文本模型，用于弥补完全无图像输入的劣势
  if (Array.isArray(image_facts) && image_facts.length > 0) {
    solvePrompt += '【图像关键信息】\n';
    for (const fact of image_facts) {
      if (typeof fact === 'string' && fact.trim()) {
        solvePrompt += `- ${fact.trim()}\n`;
      }
    }
    solvePrompt += '\n';
  }

  const step2Messages = [
    {
      role: 'system',
      content:
        '你是一个解题助手，请严格按照用户指定的输出格式作答，尽量保证答案正确。',
    },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: solvePrompt,
        },
      ],
    },
  ];

  try {
    const data2 = await chatCompletion(
      profile,
      {
        model: textModel,
        messages: step2Messages,
        temperature: 0.2,
      },
      '[AI OpenAI Vision Step2]',
      timeoutMs,
    );

    const content2 = data2.choices?.[0]?.message?.content || '';
    if (!content2) {
      throw new Error('AI返回内容为空');
    }
    if (twoStepDebug) {
      console.log('[雨课堂助手][INFO][vision-step2] final content:', content2);
    }
    return content2;
  } catch (err) {
    console.warn('[雨课堂助手][WARN][vision-step2] failed, fallback to single-step', err);
    return singleStepVisionCall(profile, cleanBase64List, textPrompt, { timeout: timeoutMs });
  }
}

