// src/ai/kimi.js
import { gm } from '../core/env.js';

// -----------------------------------------------
// Unified Prompt blocks for Text & Vision
// -----------------------------------------------
const BASE_SYSTEM_PROMPT = [
 '你是 Kimi，由 Moonshot AI 提供的人工智能助手。你需要在以下规则下工作：',
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
 * 调用 Kimi 文本模型
 * @param {string} question 题目内容
 * @param {Object} aiCfg AI配置
 * @returns {Promise<string>} AI回答
 */
export async function queryKimi(question, aiCfg) {
    const apiKey = aiCfg.kimiApiKey;
    if (!apiKey) {
        throw new Error('请先配置 Kimi API Key');
    }

    return new Promise((resolve, reject) => {
        gm.xhr({
            method: 'POST',
            url: 'https://api.moonshot.cn/v1/chat/completions',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            data: JSON.stringify({
                model: 'moonshot-v1-8k', // ✅ 文本模型
                messages: [
                    {
                        role: 'system',
                        content: BASE_SYSTEM_PROMPT
                    },
                    {
                        role: 'user',
                        // 将用户输入高亮到专门段落
                        content: [
                          {
                            type: 'text',
                            text: [
                              '【文本模式说明】可能为题目文本，也可能为普通问答。请先执行决策闸，再回答。',
                              '【用户输入（优先级最高）】',
                              question || '（无）'
                            ].join('\n')
                          }
                        ]
                    }
                ],
                temperature: 0.6
            }),
            onload: (res) => {
                try {
                    console.log('[Kimi API] Status:', res.status);
                    console.log('[Kimi API] Response:', res.responseText);
                    
                    if (res.status !== 200) {
                        reject(new Error(`Kimi API 请求失败: ${res.status}`));
                        return;
                    }
                    const data = JSON.parse(res.responseText);
                    const content = data.choices?.[0]?.message?.content;
                    if (content) {
                        resolve(content);
                    } else {
                        reject(new Error('AI返回内容为空'));
                    }
                } catch (e) {
                    reject(new Error(`解析API响应失败: ${e.message}`));
                }
            },
            onerror: () => reject(new Error('网络请求失败')),
            timeout: 30000
        });
    });
}

/**
 * 调用 Kimi Vision模型（图像+文本）
 * @param {string} imageBase64 图像的base64编码
 * @param {string} textPrompt 文本提示（可包含题干）
 * @param {Object} aiCfg AI配置
 * @returns {Promise<string>} AI回答
 */
export async function queryKimiVision(imageBase64, textPrompt, aiCfg) {
    const apiKey = aiCfg.kimiApiKey;
    if (!apiKey) {
        throw new Error('请先配置 Kimi API Key');
    }

    // ✅ 检查图像数据格式
    if (!imageBase64 || typeof imageBase64 !== 'string') {
        throw new Error('图像数据格式错误');
    }

    // ✅ 确保 base64 数据格式正确
    const cleanBase64 = imageBase64.replace(/^data:image\/[^;]+;base64,/, '');

    // 统一化：使用 BASE_SYSTEM_PROMPT + VISION_GUIDE，并要求先做“是否有题目”的决策
    const visionTextHeader = [
      '【融合模式说明】你将看到一张课件/PPT截图与可选的附加文本。',
      VISION_GUIDE
    ].join('\n');
    
    // ✅ 按照文档要求构建消息格式
    const messages = [
        {
            role: 'system',
            content: BASE_SYSTEM_PROMPT,
        },
        {
            role: 'user',
            content: [
                {
                    type: 'image_url',
                    image_url: {
                        url: `data:image/png;base64,${cleanBase64}` // ✅ 按照文档格式
                    }
                },
                {
                    type: 'text',
                    text: [
                     visionTextHeader,
                      '【用户输入（优先级最高）】',
                      textPrompt || '（无）'
                    ].join('\n')
                }
            ]
        }
    ];

    return new Promise((resolve, reject) => {
        console.log('[Kimi Vision] 发送请求...');
        console.log('[Kimi Vision] 模型: moonshot-v1-8k-vision-preview');
        console.log('[Kimi Vision] 图片数据长度:', cleanBase64.length);
        
        gm.xhr({
            method: 'POST',
            url: 'https://api.moonshot.cn/v1/chat/completions',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            data: JSON.stringify({
                model: 'moonshot-v1-8k-vision-preview', // ✅ 使用 Vision 专用模型
                messages: messages,
                temperature: 0.3, // ✅ 根据文档示例调整
                // 不需要 max_tokens，文档中没有提到
            }),
            onload: (res) => {
                try {
                    console.log('[Kimi Vision] Status:', res.status);
                    console.log('[Kimi Vision] Response:', res.responseText);
                    
                    if (res.status !== 200) {
                        // ✅ 提供更详细的错误信息
                        let errorMessage = `Kimi Vision API 请求失败: ${res.status}`;
                        try {
                            const errorData = JSON.parse(res.responseText);
                            if (errorData.error?.message) {
                                errorMessage += ` - ${errorData.error.message}`;
                            }
                            if (errorData.error?.code) {
                                errorMessage += ` (${errorData.error.code})`;
                            }
                        } catch (e) {
                            errorMessage += ` - ${res.responseText}`;
                        }
                        reject(new Error(errorMessage));
                        return;
                    }
                    
                    const data = JSON.parse(res.responseText);
                    const content = data.choices?.[0]?.message?.content;
                    if (content) {
                        console.log('[Kimi Vision] 成功获取回答');
                        resolve(content);
                    } else {
                        reject(new Error('AI返回内容为空'));
                    }
                } catch (e) {
                    console.error('[Kimi Vision] 解析响应失败:', e);
                    reject(new Error(`解析API响应失败: ${e.message}`));
                }
            },
            onerror: (err) => {
                console.error('[Kimi Vision] 网络请求失败:', err);
                reject(new Error('网络请求失败'));
            },
            timeout: 60000 // ✅ Vision 请求可能需要更长时间
        });
    });
}