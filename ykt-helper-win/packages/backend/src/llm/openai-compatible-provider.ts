import type { AiModelInfo } from '@ykt/contracts';

import type {
  AiProviderCompletionRequest,
  AiProviderDiscoveryRequest,
  AiProviderPlugin,
} from './provider.js';
import { OPENAI_COMPATIBLE_PROVIDER_ID } from './provider.js';

type Fetcher = typeof fetch;

export class OpenAiCompatibleProvider implements AiProviderPlugin {
  readonly id = OPENAI_COMPATIBLE_PROVIDER_ID;

  constructor(private readonly fetcher: Fetcher = fetch) {}

  async discoverModels(
    request: AiProviderDiscoveryRequest,
  ): Promise<readonly AiModelInfo[]> {
    const response = await this.fetcher(`${request.baseUrl}/models`, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${request.apiKey}`,
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

  async complete(request: AiProviderCompletionRequest): Promise<string> {
    const response = await this.fetcher(`${request.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${request.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        temperature: request.temperature ?? 1,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      throw new Error(`AI 接口请求失败：HTTP ${response.status}`);
    }
    const content = responseContent(await response.json());
    if (!content) throw new Error('AI 接口未返回文本内容。');
    return content;
  }
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

function responseContent(value: unknown): string | null {
  const choices = asRecord(value)?.choices;
  if (!Array.isArray(choices)) return null;
  const content = asRecord(asRecord(choices[0])?.message)?.content;
  return typeof content === 'string' ? content : null;
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
