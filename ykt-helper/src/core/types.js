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
    provider: 'kimi', 
    kimiApiKey: '', 
    apiKey: '', 
    endpoint: 'https://api.moonshot.cn/v1/chat/completions', 
    model: 'moonshot-v1-8k', 
    visionModel: 'moonshot-v1-8k-vision-preview', 
    temperature: 0.3,
    maxTokens: 1000,
  },
  profiles: [
    {
      id: 'default',
      name: 'Kimi',
      baseUrl: 'https://api.moonshot.cn/v1/chat/completions', 
      apiKey: '',                     
      model: 'moonshot-v1-8k',
      visionModel: 'moonshot-v1-8k-vision-preview',
    },
  ],
  activeProfileId: 'default',
  showAllSlides: false,
  maxPresentations: 5,
};