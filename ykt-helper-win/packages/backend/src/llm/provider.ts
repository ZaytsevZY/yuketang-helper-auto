import type { AiModelInfo } from '@ykt/contracts';

export const OPENAI_COMPATIBLE_PROVIDER_ID = 'openai-compatible';

export interface AiProviderDiscoveryRequest {
  readonly baseUrl: string;
  readonly apiKey: string;
}

export interface AiProviderCompletionRequest extends AiProviderDiscoveryRequest {
  readonly model: string;
  readonly messages: readonly unknown[];
  readonly temperature?: number;
  readonly signal?: AbortSignal;
}

export interface AiProviderPlugin {
  readonly id: string;
  discoverModels(
    request: AiProviderDiscoveryRequest,
  ): Promise<readonly AiModelInfo[]>;
  complete(request: AiProviderCompletionRequest): Promise<string>;
}
