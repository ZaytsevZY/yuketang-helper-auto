// src/ai/deepseek.js
import { gm } from '../core/env.js';

export function queryDeepSeek(question, aiCfg) {
  const { apiKey, endpoint, model, temperature, maxTokens } = aiCfg || {};
  if (!apiKey) return Promise.reject(new Error('请先设置API密钥'));

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
          console.log('[雨课堂助手] API响应状态:', res.status);
          console.log('[雨课堂助手] API响应内容:', res.responseText);
          if (res.status !== 200) {
            reject(new Error(`API请求失败: HTTP ${res.status}`));
            return;
          }
          if (data.error) {
            reject(new Error(`API错误: ${data.error.message}`));
            return;
          }
          const content = data.choices?.[0]?.message?.content?.trim?.();
          if (content && content.length > 10) {
            console.log('[雨课堂助手] AI回答:', content);
            resolve(content);
          } else {
            reject(new Error('AI返回内容为空或过短'));
          }
        } catch (e) { reject(new Error(`解析API响应失败: ${e.message}`)); }
      },
      onerror: (err) => {
        console.error('[雨课堂助手] 网络请求失败:', err);
        reject(new Error(`请求失败: ${err?.statusText || '网络错误'}`));
      },
      ontimeout: () => reject(new Error('请求超时，请检查网络连接')),
      timeout: 30000,
    });
  });
}
