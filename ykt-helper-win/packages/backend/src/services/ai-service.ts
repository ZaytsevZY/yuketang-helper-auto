import {
  ProblemType,
  type AiModelInfo,
  type AiProfileConfig,
  type AiProfileView,
  type AnswerProposal,
  type AnswerValue,
  type ConnectAiProfileInput,
  type GenerateAnswerProposalInput,
  type GeneratedTextResult,
  type ProblemContext,
  type RecognizeSlideInput,
  type TranslateTextInput,
  type UpdateAiProfileSelectionInput,
} from '@ykt/contracts';
import type { AppDataStore, SecretStore } from '@ykt/storage';

import type { ProblemService } from './problem-service.js';

type Fetcher = typeof fetch;

export class AiService {
  constructor(
    private readonly storage: AppDataStore,
    private readonly secrets: SecretStore,
    private readonly problems: ProblemService,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  async listProfiles(): Promise<readonly AiProfileView[]> {
    const profiles = await this.profiles();
    return Promise.all(profiles.map((profile) => this.profileView(profile)));
  }

  async connectProfile(
    input: ConnectAiProfileInput,
  ): Promise<readonly AiProfileView[]> {
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    const apiKey = input.apiKey.trim();
    if (!apiKey) throw new Error('API Key 不能为空。');
    const models = await this.discoverModels(baseUrl, apiKey);
    const current = await this.profiles();
    const existing = current.find((profile) => profile.baseUrl === baseUrl);
    const id =
      existing?.id ?? uniqueProfileId(profileName(models, baseUrl), current);
    const profile = profileFromDiscovery(id, baseUrl, models, existing);
    const profiles = existing
      ? current.map((item) => (item.id === id ? profile : item))
      : [...current, profile];
    await this.storage.updateSettings({
      aiProfiles: profiles,
      activeAiProfileId: profile.id,
    });
    await this.secrets.set(credentialKey(profile.id), apiKey);
    return this.listProfiles();
  }

  async refreshProfile(id: string): Promise<readonly AiProfileView[]> {
    const profiles = await this.profiles();
    const existing = requireProfile(profiles, id);
    const apiKey = await this.requireCredential(id);
    const models = await this.discoverModels(existing.baseUrl, apiKey);
    const profile = profileFromDiscovery(
      id,
      existing.baseUrl,
      models,
      existing,
    );
    await this.storage.updateSettings({
      aiProfiles: profiles.map((item) => (item.id === id ? profile : item)),
    });
    return this.listProfiles();
  }

  async updateSelection(
    input: UpdateAiProfileSelectionInput,
  ): Promise<readonly AiProfileView[]> {
    const profiles = await this.profiles();
    const profile = requireProfile(profiles, input.id);
    const ids = new Set(profile.models.map((model) => model.id));
    if (!ids.has(input.model)) throw new Error('文本模型不在发现结果中。');
    if (input.visionModel && !ids.has(input.visionModel)) {
      throw new Error('视觉模型不在发现结果中。');
    }
    if (input.ocrModel && !ids.has(input.ocrModel)) {
      throw new Error('OCR 模型不在发现结果中。');
    }
    if (input.translationModel && !ids.has(input.translationModel)) {
      throw new Error('翻译模型不在发现结果中。');
    }
    await this.storage.updateSettings({
      aiProfiles: profiles.map((item) =>
        item.id === input.id
          ? {
              ...item,
              model: input.model,
              visionModel: input.visionModel || input.model,
              ocrModel: input.ocrModel || input.visionModel || input.model,
              translationModel: input.translationModel || input.model,
            }
          : item,
      ),
    });
    return this.listProfiles();
  }

  async deleteProfile(id: string): Promise<readonly AiProfileView[]> {
    const settings = await this.storage.getSettings();
    const profiles = settings.aiProfiles.filter((profile) => profile.id !== id);
    await this.storage.updateSettings({
      aiProfiles: profiles,
      activeAiProfileId:
        settings.activeAiProfileId === id
          ? (profiles[0]?.id ?? '')
          : settings.activeAiProfileId,
    });
    await Promise.all(
      credentialKeys(id).map((key) => this.secrets.delete(key)),
    );
    return this.listProfiles();
  }

  async selectProfile(id: string): Promise<readonly AiProfileView[]> {
    const profiles = await this.profiles();
    if (!profiles.some((profile) => profile.id === id)) {
      throw new Error('AI Profile 不存在。');
    }
    await this.storage.updateSettings({ activeAiProfileId: id });
    return this.listProfiles();
  }

  async resetProfiles(): Promise<void> {
    const settings = await this.storage.getSettings();
    await Promise.all(
      settings.aiProfiles.flatMap((profile) =>
        credentialKeys(profile.id).map((key) => this.secrets.delete(key)),
      ),
    );
  }

  async generateProposal(
    input: GenerateAnswerProposalInput,
  ): Promise<AnswerProposal> {
    const problem = this.problems.getProblem(input.problemId);
    const profile = await this.activeProfile();
    const apiKey = await this.requireCredential(profile.id);
    const images = (input.imageUrls ?? []).filter(Boolean).slice(0, 6);
    const model = images.length
      ? profile.visionModel || profile.model
      : profile.model;
    const rawText = await this.complete({
      url: chatCompletionsUrl(profile.baseUrl),
      apiKey,
      model,
      messages: answerMessages(problem, images, input.customPrompt ?? ''),
    });
    const parsed = parseAnswer(problem, rawText);
    return {
      problemId: problem.id,
      answer: parsed.answer,
      explanation: parsed.explanation,
      rawText,
      profileId: profile.id,
      model,
      contextSources: [
        `problem:${problem.id}`,
        ...images.map((_url, index) => `slide-image:${index + 1}`),
      ],
      createdAt: new Date().toISOString(),
    };
  }

  async recognizeSlide(
    input: RecognizeSlideInput,
  ): Promise<GeneratedTextResult> {
    const profile = await this.activeProfile();
    const apiKey = await this.requireCredential(profile.id);
    const model = profile.ocrModel || profile.visionModel || profile.model;
    const text = await this.complete({
      url: chatCompletionsUrl(profile.baseUrl),
      apiKey,
      model,
      messages: [
        {
          role: 'system',
          content:
            '你是 OCR 助手。只提取图片中可见的文字，保留段落与换行；不要解题、总结或补充。',
        },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: safeImageUrl(input.imageUrl) },
            },
            { type: 'text', text: '请直接输出图片中的全部文字。' },
          ],
        },
      ],
    });
    return { text: text.trim(), profileId: profile.id, model };
  }

  async translateText(input: TranslateTextInput): Promise<GeneratedTextResult> {
    const source = input.text.trim();
    const target = input.targetLanguage.trim();
    if (!source) throw new Error('没有可翻译的文字。');
    if (!target) throw new Error('翻译目标语言不能为空。');
    const profile = await this.activeProfile();
    const apiKey = await this.requireCredential(profile.id);
    const model = profile.translationModel || profile.model;
    const text = await this.complete({
      url: chatCompletionsUrl(profile.baseUrl),
      apiKey,
      model,
      messages: [
        {
          role: 'system',
          content: `将用户文本翻译为${target}。只输出译文，保留段落、编号、公式和专有名词格式。`,
        },
        { role: 'user', content: source },
      ],
    });
    return { text: text.trim(), profileId: profile.id, model };
  }

  private async activeProfile(): Promise<AiProfileConfig> {
    const settings = await this.storage.getSettings();
    const profiles = await this.profiles();
    const profile =
      profiles.find((item) => item.id === settings.activeAiProfileId) ??
      profiles[0];
    if (!profile) throw new Error('请先在“模型”页连接 AI 服务。');
    return profile;
  }

  private async profiles(): Promise<readonly AiProfileConfig[]> {
    const settings = await this.storage.getSettings();
    const stored = settings.aiProfiles ?? [];
    const profiles = stored
      .filter((profile) => !isObsoleteKimiProfile(profile))
      .map(validateStoredProfile);
    if (profiles.length !== stored.length) {
      await this.storage.updateSettings({
        aiProfiles: profiles,
        activeAiProfileId: profiles.some(
          (profile) => profile.id === settings.activeAiProfileId,
        )
          ? settings.activeAiProfileId
          : (profiles[0]?.id ?? ''),
      });
      await Promise.all([
        this.secrets.delete('ai-profile:default:main'),
        this.secrets.delete('ai-profile:default:ocr'),
        this.secrets.delete('ai-profile:default:translation'),
      ]);
    }
    return profiles;
  }

  private async profileView(profile: AiProfileConfig): Promise<AiProfileView> {
    const main = await this.secrets.get(credentialKey(profile.id));
    return {
      ...profile,
      hasApiKey: Boolean(main),
    };
  }

  private async requireCredential(id: string): Promise<string> {
    const value = await this.secrets.get(credentialKey(id));
    if (!value)
      throw new Error('请先在“模型”页配置当前 AI Profile 的 API Key。');
    return value;
  }

  private async discoverModels(
    baseUrl: string,
    apiKey: string,
  ): Promise<readonly AiModelInfo[]> {
    const response = await this.fetcher(modelsUrl(baseUrl), {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error('API Key 无效或没有读取模型的权限。');
      }
      if (response.status === 404) {
        throw new Error('Base URL 不正确，未找到 /models 接口。');
      }
      throw new Error(`模型发现失败：HTTP ${response.status}`);
    }
    const models = parseModelList(await response.json());
    if (!models.length) throw new Error('/models 没有返回可用模型。');
    return models;
  }

  private async complete(input: {
    url: string;
    apiKey: string;
    model: string;
    messages: readonly unknown[];
  }): Promise<string> {
    const response = await this.fetcher(validateEndpoint(input.url), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: input.model,
        messages: input.messages,
        temperature: 1,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      throw new Error(`AI 接口请求失败：HTTP ${response.status}`);
    }
    const value: unknown = await response.json();
    const content = responseContent(value);
    if (!content) throw new Error('AI 接口未返回文本内容。');
    return content;
  }
}

function validateStoredProfile(value: AiProfileConfig): AiProfileConfig {
  const record = value as unknown as Record<string, unknown>;
  const id = String(record.id ?? '').trim();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id)) {
    throw new Error('AI Profile ID 只能包含字母、数字、短横线和下划线。');
  }
  const model = String(record.model ?? '').trim();
  if (!model) throw new Error('文本模型不能为空。');
  const discovered = Array.isArray(record.models)
    ? record.models.map(parseModel).filter((item) => item !== null)
    : [];
  const legacyModels = [model, String(record.visionModel ?? '').trim()]
    .concat([
      String(record.ocrModel ?? '').trim(),
      String(record.translationModel ?? '').trim(),
    ])
    .filter(Boolean)
    .filter((item, index, all) => all.indexOf(item) === index)
    .map(minimalModel);
  const visionModel = String(record.visionModel ?? '').trim() || model;
  return {
    id,
    name: String(record.name ?? '').trim() || id,
    baseUrl: normalizeBaseUrl(String(record.baseUrl ?? '')),
    model,
    visionModel,
    ocrModel: String(record.ocrModel ?? '').trim() || visionModel,
    translationModel: String(record.translationModel ?? '').trim() || model,
    models: discovered.length ? discovered : legacyModels,
    discoveredAt: String(record.discoveredAt ?? ''),
  };
}

function profileFromDiscovery(
  id: string,
  baseUrl: string,
  models: readonly AiModelInfo[],
  existing?: AiProfileConfig,
): AiProfileConfig {
  const ids = new Set(models.map((model) => model.id));
  const textModel =
    (existing?.model && ids.has(existing.model) ? existing.model : '') ||
    defaultTextModel(models).id;
  const visionModel =
    (existing?.visionModel && ids.has(existing.visionModel)
      ? existing.visionModel
      : '') || defaultVisionModel(models, textModel);
  const ocrModel =
    (existing?.ocrModel && ids.has(existing.ocrModel)
      ? existing.ocrModel
      : '') || visionModel;
  const translationModel =
    (existing?.translationModel && ids.has(existing.translationModel)
      ? existing.translationModel
      : '') || textModel;
  return {
    id,
    name: existing?.name || profileName(models, baseUrl),
    baseUrl,
    model: textModel,
    visionModel,
    ocrModel,
    translationModel,
    models,
    discoveredAt: new Date().toISOString(),
  };
}

function requireProfile(
  profiles: readonly AiProfileConfig[],
  id: string,
): AiProfileConfig {
  const profile = profiles.find((item) => item.id === id);
  if (!profile) throw new Error('AI Profile 不存在。');
  return profile;
}

function parseModelList(value: unknown): readonly AiModelInfo[] {
  const data = asRecord(value)?.data;
  if (!Array.isArray(data)) throw new Error('/models 返回格式不受支持。');
  const models = data.map(parseModel).filter((item) => item !== null);
  return [...new Map(models.map((model) => [model.id, model])).values()].sort(
    (left, right) => left.id.localeCompare(right.id),
  );
}

function parseModel(value: unknown): AiModelInfo | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = String(record.id ?? '').trim();
  if (!id) return null;
  const modalities = asRecord(record.modalities);
  const architecture = asRecord(record.architecture);
  return {
    id,
    name: String(record.name ?? record.display_name ?? id).trim() || id,
    ownedBy: String(record.owned_by ?? record.ownedBy ?? '').trim(),
    created: finiteNumber(record.created),
    inputModalities: stringList(
      record.input_modalities ??
        modalities?.input ??
        architecture?.input_modalities,
    ),
    outputModalities: stringList(
      record.output_modalities ??
        modalities?.output ??
        architecture?.output_modalities,
    ),
    supportedParameters: stringList(record.supported_parameters),
    contextWindow: finiteNumber(
      record.context_window ??
        record.context_length ??
        record.max_context_length,
    ),
    outputLimit: finiteNumber(
      record.max_output_tokens ?? record.max_completion_tokens,
    ),
  };
}

function minimalModel(id: string): AiModelInfo {
  return {
    id,
    name: id,
    ownedBy: '',
    created: null,
    inputModalities: [],
    outputModalities: [],
    supportedParameters: [],
    contextWindow: null,
    outputLimit: null,
  };
}

function defaultTextModel(models: readonly AiModelInfo[]): AiModelInfo {
  return (
    models.find(
      (model) =>
        !/(embed|embedding|rerank|moderation|tts|audio|image)/i.test(
          model.id,
        ) && !/preview/i.test(model.id),
    ) ?? models[0]!
  );
}

function defaultVisionModel(
  models: readonly AiModelInfo[],
  fallback: string,
): string {
  return (
    models.find((model) => model.inputModalities.includes('image'))?.id ??
    models.find((model) => /vision|multimodal|[-_.]vl/i.test(model.id))?.id ??
    fallback
  );
}

function profileName(models: readonly AiModelInfo[], baseUrl: string): string {
  const owner = models.find((model) => model.ownedBy)?.ownedBy;
  const source =
    owner ||
    new URL(baseUrl).hostname.replace(/^api\./, '').split('.')[0] ||
    'Provider';
  return source
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(' ');
}

function uniqueProfileId(
  name: string,
  profiles: readonly AiProfileConfig[],
): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'provider';
  const used = new Set(profiles.map((profile) => profile.id));
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

function isObsoleteKimiProfile(value: AiProfileConfig): boolean {
  const record = value as unknown as Record<string, unknown>;
  return (
    record.id === 'default' &&
    record.model === 'moonshot-v1-8k' &&
    record.visionModel === 'moonshot-v1-8k-vision-preview'
  );
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(String(value ?? '').trim());
  if (!['https:', 'http:'].includes(url.protocol)) {
    throw new Error('AI 接口必须使用 HTTP 或 HTTPS。');
  }
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname
    .replace(/\/(?:chat\/completions|models)\/?$/i, '')
    .replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

function modelsUrl(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/models`;
}

function chatCompletionsUrl(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/chat/completions`;
}

function validateEndpoint(value: string): string {
  const url = new URL(String(value ?? '').trim());
  if (!['https:', 'http:'].includes(url.protocol)) {
    throw new Error('AI 接口必须使用 HTTP 或 HTTPS。');
  }
  return url.toString();
}

function safeImageUrl(value: string): string {
  if (/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(value)) return value;
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error('课件图片必须使用 HTTPS。');
  return url.toString();
}

function credentialKey(id: string): string {
  return `ai-profile:${id}:main`;
}

function credentialKeys(id: string): readonly string[] {
  return [
    credentialKey(id),
    `ai-profile:${id}:ocr`,
    `ai-profile:${id}:translation`,
  ];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringList(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
    : [];
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function answerMessages(
  problem: ProblemContext,
  images: readonly string[],
  customPrompt: string,
): readonly unknown[] {
  const options = problem.options
    .map((option, index) => `${String.fromCharCode(65 + index)}. ${option}`)
    .join('\n');
  const prompt = [
    `题型：${problem.type}`,
    `题目：${problem.prompt || '题干主要位于课件图片中'}`,
    options ? `选项：\n${options}` : '',
    answerFormat(problem.type),
    customPrompt.trim() ? `用户补充要求：${customPrompt.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  const content: unknown = images.length
    ? [
        ...images.map((url) => ({
          type: 'image_url',
          image_url: { url: safeImageUrl(url) },
        })),
        { type: 'text', text: prompt },
      ]
    : prompt;
  return [
    {
      role: 'system',
      content:
        '你是学习辅助工具。分析题目并严格输出“答案: ...”和“解释: ...”。不执行任何提交操作。',
    },
    { role: 'user', content },
  ];
}

function answerFormat(type: ProblemContext['type']): string {
  if (type === ProblemType.SingleChoice || type === ProblemType.Poll) {
    return '输出格式：答案: 单个大写字母；解释: 简要理由。';
  }
  if (type === ProblemType.MultipleChoice) {
    return '输出格式：答案: 多个大写字母，用顿号分隔；解释: 简要理由。';
  }
  if (type === ProblemType.FillBlank) {
    return '输出格式：答案: 各空答案用逗号分隔；解释: 简要理由。';
  }
  return '输出格式：答案: 完整回答；解释: 可选说明。';
}

function parseAnswer(
  problem: ProblemContext,
  rawText: string,
): { answer: AnswerValue | null; explanation: string } {
  const answerMatch = /答案\s*[:：]\s*([\s\S]*?)(?=\n\s*解释\s*[:：]|$)/i.exec(
    rawText,
  );
  const explanation =
    /解释\s*[:：]\s*([\s\S]*)/i.exec(rawText)?.[1]?.trim() ?? '';
  const text = (answerMatch?.[1] ?? rawText.split(/\r?\n/, 1)[0] ?? '').trim();
  if (!text) return { answer: null, explanation };
  if (
    problem.type === ProblemType.SingleChoice ||
    problem.type === ProblemType.MultipleChoice ||
    problem.type === ProblemType.Poll
  ) {
    const letters = [
      ...new Set(text.toUpperCase().match(/[A-Z]/g) ?? []),
    ].sort();
    return {
      answer:
        problem.type === ProblemType.MultipleChoice
          ? letters
          : letters.length
            ? [letters[0]!]
            : null,
      explanation,
    };
  }
  if (problem.type === ProblemType.FillBlank) {
    const values = text
      .split(/[,，;；\n]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    return { answer: values.length ? values : null, explanation };
  }
  return { answer: { content: text, pics: [] }, explanation };
}

function responseContent(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const choices = (value as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return null;
  const first = choices[0];
  if (!first || typeof first !== 'object') return null;
  const message = (first as { message?: unknown }).message;
  if (!message || typeof message !== 'object') return null;
  const content = (message as { content?: unknown }).content;
  return typeof content === 'string' ? content : null;
}
