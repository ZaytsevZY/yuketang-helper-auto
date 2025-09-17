// src/ai/deepseek.js
import { gm } from '../core/env.js';

export function queryDeepSeek(question, aiCfg) {
  const { apiKey, endpoint, model, temperature, maxTokens } = aiCfg || {};
  if (!apiKey) return Promise.reject(new Error('请先在设置中填写 DeepSeek API 密钥'));

  return new Promise((resolve, reject) => {
    gm.xhr({
      method: 'POST',
      url: endpoint,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      data: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: '你是一个专业学习助手，你的任务是帮助回答雨课堂中的题目。请按照要求的格式回答，先给出答案，然后给出解释。' },
          { role: 'user', content: question },
        ],
        temperature,
        max_tokens: maxTokens,
      }),
      onload: (res) => {
        try {
          const data = JSON.parse(res.responseText);
          if (data.error) reject(new Error(`API错误: ${data.error.message}`));
          else if (data.choices?.[0]) resolve(data.choices[0].message.content);
          else reject(new Error('API返回结果格式异常'));
        } catch (e) { reject(new Error(`解析API响应失败: ${e.message}`)); }
      },
      onerror: (err) => reject(new Error(`请求失败: ${err?.statusText || 'network error'}`)),
    });
  });
}
