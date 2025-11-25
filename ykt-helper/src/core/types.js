// src/core/types.js
export const PROBLEM_TYPE_MAP = {
  1: '单选题',
  2: '多选题',
  3: '投票题',
  4: '填空题',
  5: '主观题',
};

export const DEFAULT_CONFIG = {
  notifyProblems: true,
  autoAnswer: false,
  autoAnswerDelay: 3000,
  autoAnswerRandomDelay: 2000,
  iftex: true,
  ai: {
    provider: 'kimi', // ✅ 改为 kimi
    kimiApiKey: '', // ✅ 添加 kimi 专用字段
    apiKey: '', // 保持兼容
    endpoint: 'https://api.moonshot.cn/v1/chat/completions', // ✅ Kimi API 端点
    model: 'moonshot-v1-8k', // ✅ 文本模型
    visionModel: 'moonshot-v1-8k-vision-preview', // ✅ 添加 Vision 模型配置
    temperature: 0.3,
    maxTokens: 1000,
  },
  profiles: [
    {
      id: 'default',
      name: 'Kimi',
      baseUrl: 'https://api.moonshot.cn/v1/chat/completions', // OpenAI 协议兼容
      apiKey: '',                          // 从旧 kimiApiKey 迁移
      model: 'moonshot-v1-8k',
      visionModel: 'moonshot-v1-8k-vision-preview',
    },
  ],
  activeProfileId: 'default',
  showAllSlides: false,
  maxPresentations: 5,
};