import { randomUUID } from 'node:crypto';

import {
  ProblemType,
  type AiModelInfo,
  type AiProfileConfig,
  type AiProfileView,
  type AnswerInput,
  type AnswerProposal,
  type AnswerProposalOutcome,
  type AnswerValue,
  type ConnectAiProfileInput,
  type GenerateAnswerProposalInput,
  type GeneratedTextResult,
  type JsonValue,
  type ProblemContext,
  type RecognizeSlideInput,
  type TranslateTextInput,
  type UpdateAiProfileSelectionInput,
} from '@ykt/contracts';
import type { AppDataStore, SecretStore } from '@ykt/storage';

import {
  OPENAI_COMPATIBLE_PROVIDER_ID,
  type AiProviderPlugin,
} from '../llm/provider.js';
import type { ProblemService } from './problem-service.js';

export class AiService {
  constructor(
    private readonly storage: AppDataStore,
    private readonly secrets: SecretStore,
    private readonly problems: ProblemService,
    private readonly providers: readonly AiProviderPlugin[],
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
    const providerId = input.providerId ?? OPENAI_COMPATIBLE_PROVIDER_ID;
    const provider = this.provider(providerId);
    const models = await provider.discoverModels({ baseUrl, apiKey });
    const current = await this.profiles();
    const existing = current.find(
      (profile) =>
        profile.baseUrl === baseUrl && profile.providerId === providerId,
    );
    const id =
      existing?.id ?? uniqueProfileId(profileName(models, baseUrl), current);
    const profile = profileFromDiscovery(
      id,
      providerId,
      baseUrl,
      models,
      existing,
    );
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
    const models = await this.provider(existing.providerId).discoverModels({
      baseUrl: existing.baseUrl,
      apiKey,
    });
    const profile = profileFromDiscovery(
      id,
      existing.providerId,
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
    if (
      input.temperature !== null &&
      (!Number.isFinite(input.temperature) ||
        input.temperature < 0 ||
        input.temperature > 2)
    ) {
      throw new Error('Temperature 必须是 0 到 2 之间的数字，或留空。');
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
              temperature: input.temperature,
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
    const images = (input.imageUrls ?? []).filter(Boolean).slice(0, 6);
    const contextSources = [
      `problem:${problem.id}`,
      ...images.map((_url, index) => `slide-image:${index + 1}`),
    ];
    let profile: AiProfileConfig | undefined;
    let model = '';
    try {
      profile = await this.activeProfile();
      model = images.length
        ? profile.visionModel || profile.model
        : profile.model;
      const rawText = await this.provider(profile.providerId).complete({
        baseUrl: profile.baseUrl,
        apiKey: await this.requireCredential(profile.id),
        model,
        messages: answerMessages(problem, images, input.customPrompt ?? ''),
        ...(profile.temperature === null
          ? {}
          : { temperature: profile.temperature }),
      });
      const parsed = parseProposal(problem, rawText);
      const validation = parsed.answer
        ? this.problems.validateAnswerFormat({
            problemId: problem.id,
            answer: parsed.answer,
          })
        : undefined;
      const validationIssues = validation?.issues ?? [];
      const failureReason =
        parsed.failureReason ||
        (!parsed.answer
          ? '模型没有返回可用答案。'
          : validation && !validation.valid
            ? '模型建议未通过答案校验。'
            : null);
      return this.saveProposal({
        id: randomUUID(),
        problemId: problem.id,
        status: failureReason ? 'failed' : 'ready',
        answer: validation?.normalizedAnswer ?? parsed.answer,
        explanation: parsed.explanation,
        confidence: parsed.confidence,
        failureReason,
        validationIssues,
        rawText,
        profileId: profile.id,
        model,
        contextSources,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      return this.saveProposal({
        id: randomUUID(),
        problemId: problem.id,
        status: 'failed',
        answer: null,
        explanation: '',
        confidence: null,
        failureReason:
          error instanceof Error ? error.message : 'AI 答案建议生成失败。',
        validationIssues: [],
        rawText: '',
        profileId: profile?.id ?? '',
        model,
        contextSources,
        createdAt: new Date().toISOString(),
      });
    }
  }

  async getProposal(id: string): Promise<AnswerProposal | null> {
    const document = await this.storage.getDocument(proposalKey(id));
    return document?.kind === 'answer-proposal'
      ? parseStoredProposal(document.value)
      : null;
  }

  async recordOutcome(
    proposal: AnswerProposal,
    input: AnswerInput,
    submittedAnswer: AnswerValue,
    submittedAt: string,
  ): Promise<AnswerProposalOutcome> {
    if (!input.confirmedBy) {
      throw new Error('采用 AI 建议提交时必须明确确认主体。');
    }
    const outcome: AnswerProposalOutcome = {
      proposalId: proposal.id,
      confirmedBy: input.confirmedBy,
      proposedAnswer: proposal.answer,
      submittedAnswer,
      changed: !sameAnswer(proposal.answer, submittedAnswer),
      submittedAt,
    };
    await this.storage.putDocument({
      key: outcomeKey(proposal.id),
      kind: 'answer-proposal-outcome',
      value: toJsonValue(outcome),
      updatedAt: submittedAt,
      expiresAt: null,
    });
    return outcome;
  }

  async recognizeSlide(
    input: RecognizeSlideInput,
  ): Promise<GeneratedTextResult> {
    const profile = await this.activeProfile();
    const apiKey = await this.requireCredential(profile.id);
    const model = profile.ocrModel || profile.visionModel || profile.model;
    const text = await this.provider(profile.providerId).complete({
      baseUrl: profile.baseUrl,
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
      ...(profile.temperature === null
        ? {}
        : { temperature: profile.temperature }),
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
    const text = await this.provider(profile.providerId).complete({
      baseUrl: profile.baseUrl,
      apiKey,
      model,
      messages: [
        {
          role: 'system',
          content: `将用户文本翻译为${target}。只输出译文，保留段落、编号、公式和专有名词格式。`,
        },
        { role: 'user', content: source },
      ],
      ...(profile.temperature === null
        ? {}
        : { temperature: profile.temperature }),
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

  private provider(id: string): AiProviderPlugin {
    const provider = this.providers.find((item) => item.id === id);
    if (!provider) throw new Error(`AI Provider 未注册：${id}`);
    return provider;
  }

  private async saveProposal(
    proposal: AnswerProposal,
  ): Promise<AnswerProposal> {
    await this.storage.putDocument({
      key: proposalKey(proposal.id),
      kind: 'answer-proposal',
      value: toJsonValue(proposal),
      updatedAt: proposal.createdAt,
      expiresAt: null,
    });
    return proposal;
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
    providerId:
      String(record.providerId ?? '').trim() || OPENAI_COMPATIBLE_PROVIDER_ID,
    baseUrl: normalizeBaseUrl(String(record.baseUrl ?? '')),
    model,
    visionModel,
    ocrModel: String(record.ocrModel ?? '').trim() || visionModel,
    translationModel: String(record.translationModel ?? '').trim() || model,
    temperature: storedTemperature(record.temperature),
    models: discovered.length ? discovered : legacyModels,
    discoveredAt: String(record.discoveredAt ?? ''),
  };
}

function profileFromDiscovery(
  id: string,
  providerId: string,
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
    providerId,
    baseUrl,
    model: textModel,
    visionModel,
    ocrModel,
    translationModel,
    temperature: existing?.temperature ?? null,
    models,
    discoveredAt: new Date().toISOString(),
  };
}

function storedTemperature(value: unknown): number | null {
  if (value === '' || value === undefined || value === null) return null;
  const temperature = Number(value);
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
    return null;
  }
  return temperature;
}

function requireProfile(
  profiles: readonly AiProfileConfig[],
  id: string,
): AiProfileConfig {
  const profile = profiles.find((item) => item.id === id);
  if (!profile) throw new Error('AI Profile 不存在。');
  return profile;
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
        '你是学习辅助工具。分析题目后只输出一个 JSON 对象，字段为 answer、explanation、confidence、failureReason。confidence 为 0 到 1；无法作答时 answer 为 null 并说明 failureReason。不要执行或声称执行任何提交操作。',
    },
    { role: 'user', content },
  ];
}

function answerFormat(type: ProblemContext['type']): string {
  if (type === ProblemType.SingleChoice || type === ProblemType.Poll) {
    return 'answer 使用单个大写字母字符串。';
  }
  if (type === ProblemType.MultipleChoice) {
    return 'answer 使用大写字母字符串数组。';
  }
  if (type === ProblemType.FillBlank) {
    return 'answer 使用字符串数组，每个元素对应一个空。';
  }
  return 'answer 使用完整回答字符串。';
}

interface ParsedProposal {
  answer: AnswerValue | null;
  explanation: string;
  confidence: number | null;
  failureReason: string | null;
}

function parseProposal(
  problem: ProblemContext,
  rawText: string,
): ParsedProposal {
  const jsonText = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    const record = asRecord(JSON.parse(jsonText));
    if (record) {
      return {
        answer: parseStructuredAnswer(problem, record.answer),
        explanation: String(record.explanation ?? '').trim(),
        confidence: normalizeConfidence(record.confidence),
        failureReason:
          record.failureReason === null || record.failureReason === undefined
            ? null
            : String(record.failureReason).trim() || null,
      };
    }
  } catch {
    // Older OpenAI-compatible endpoints may ignore the JSON instruction.
  }
  const legacy = parseAnswer(problem, rawText);
  return {
    ...legacy,
    confidence: normalizeConfidence(
      /置信度\s*[:：]\s*(\d+(?:\.\d+)?%?)/.exec(rawText)?.[1],
    ),
    failureReason: null,
  };
}

function parseStructuredAnswer(
  problem: ProblemContext,
  value: unknown,
): AnswerValue | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    return parseAnswer(problem, `答案: ${value}`).answer;
  }
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return parseAnswer(problem, `答案: ${value.join(',')}`).answer;
  }
  const record = asRecord(value);
  if (
    problem.type === ProblemType.Subjective &&
    record &&
    typeof record.content === 'string'
  ) {
    return {
      content: record.content.trim(),
      pics: Array.isArray(record.pics)
        ? record.pics.filter((item): item is string => typeof item === 'string')
        : [],
    };
  }
  return null;
}

function normalizeConfidence(value: unknown): number | null {
  const numeric =
    typeof value === 'string'
      ? Number(value.trim().replace(/%$/, ''))
      : Number(value);
  if (!Number.isFinite(numeric)) return null;
  const normalized =
    typeof value === 'string' && value.trim().endsWith('%')
      ? numeric / 100
      : numeric > 1 && numeric <= 100
        ? numeric / 100
        : numeric;
  return Math.max(0, Math.min(1, normalized));
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

function proposalKey(id: string): string {
  return `ai:proposal:${id}`;
}

function outcomeKey(id: string): string {
  return `ai:proposal-outcome:${id}`;
}

function parseStoredProposal(value: JsonValue): AnswerProposal | null {
  const record = asRecord(value);
  return record &&
    typeof record.id === 'string' &&
    typeof record.problemId === 'string' &&
    (record.status === 'ready' || record.status === 'failed')
    ? (record as unknown as AnswerProposal)
    : null;
}

function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function sameAnswer(left: AnswerValue | null, right: AnswerValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
