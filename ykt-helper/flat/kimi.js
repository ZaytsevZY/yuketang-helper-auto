// src/ai/kimi.js
import { env } from '../core/env.js';

/**
 * 调用 Kimi API 进行问答
 * @param {string} question 题目内容
 * @param {Object} aiCfg AI配置
 * @returns {Promise<string>} AI回答
 */
export async function queryKimi(question, aiCfg) {
    const apiKey = aiCfg.kimiApiKey;
    if (!apiKey) {
        throw new Error('请先配置 Kimi API Key');
    }

    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
    };

    const body = {
        model: 'kimi-k2-0905-preview',
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
    };

    try {
        const response = await fetch('https://api.moonshot.cn/v1/chat/completions', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            throw new Error(`Kimi API 请求失败: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        return data.choices[0].message.content;
    } catch (error) {
        console.error('Kimi API 调用失败:', error);
        throw new Error(`Kimi API 调用失败: ${error.message}`);
    }
}