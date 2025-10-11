// src/ai/kimi.js
import { gm } from '../core/env.js';

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
                        content: '你是 Kimi，由 Moonshot AI 提供的人工智能助手。请简洁准确地回答用户的问题，特别是选择题请直接给出答案选项。'
                    },
                    {
                        role: 'user',
                        content: question
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

    const systemPrompt = '你将分析一张PPT。请尝试分析PPT上显示的问题，同时你需要考虑用户提出的问题。用户提出的问题是：'
    
    // ✅ 按照文档要求构建消息格式
    const messages = [
        {
            role: 'system',
            content: '你是 Kimi，由 Moonshot AI 提供的人工智能助手，你更擅长中文和英文的对话。你会为用户提供安全，有帮助，准确的回答。同时，你会拒绝一切涉及恐怖主义，种族歧视，黄色暴力等问题的回答。Moonshot AI 为专有名词，不可翻译成其他语言。'
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
                    text: systemPrompt + (textPrompt || '')
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