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
          console.log('[AI OpenAI] Status:', res.status);
          console.log('[AI OpenAI] Response:', res.responseText);

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

/**
 * 通用 OpenAI 协议 Vision 模型（图像+文本）
 */
export async function queryAIVision(imageBase64, textPrompt, aiCfg) {
  const profile = getActiveProfile(aiCfg);
  if (!profile || !profile.apiKey) {
    throw new Error('请先在设置中配置 AI API Key');
  }

  if (!imageBase64 || typeof imageBase64 !== 'string') {
    throw new Error('图像数据格式错误');
  }
  const cleanBase64 = imageBase64.replace(/^data:image\/[^;]+;base64,/, '');

  const visionModel = profile.visionModel || profile.model;
  const url = makeChatUrl(profile);

  const visionTextHeader = [
    '【融合模式说明】你将看到一张课件/PPT截图与可选的附加文本。',
    VISION_GUIDE,
  ].join('\n');

  const messages = [
    { role: 'system', content: BASE_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: { url: `data:image/png;base64,${cleanBase64}` },
        },
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

  return new Promise((resolve, reject) => {
    console.log('[AI OpenAI Vision] 发送请求...');
    console.log('[AI OpenAI Vision] 模型:', visionModel);
    console.log('[AI OpenAI Vision] 图片数据长度:', cleanBase64.length);

    gm.xhr({
      method: 'POST',
      url,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${profile.apiKey}`,
      },
      data: JSON.stringify({
        model: visionModel,
        messages,
        temperature: 0.3,
      }),
      onload: (res) => {
        try {
          console.log('[AI OpenAI Vision] Status:', res.status);
          console.log('[AI OpenAI Vision] Response:', res.responseText);

          if (res.status !== 200) {
            let errorMessage = `AI Vision 请求失败: ${res.status}`;
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
          const content = data.choices?.[0]?.message?.content;
          if (content) {
            console.log('[AI OpenAI Vision] 成功获取回答');
            resolve(content);
          } else {
            reject(new Error('AI返回内容为空'));
          }
        } catch (e) {
          console.error('[AI OpenAI Vision] 解析响应失败:', e);
          reject(new Error(`解析API响应失败: ${e.message}`));
        }
      },
      onerror: (err) => {
        console.error('[AI OpenAI Vision] 网络请求失败:', err);
        reject(new Error('网络请求失败'));
      },
      timeout: 60000,
    });
  });
}
