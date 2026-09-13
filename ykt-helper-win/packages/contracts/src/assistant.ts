import type { AnswerValue } from './dto.js';

type AiModelValue = string | number | boolean | null | readonly string[];

export interface AiModelInfo {
  readonly [key: string]: AiModelValue;
  readonly id: string;
  readonly name: string;
  readonly ownedBy: string;
  readonly created: number | null;
  readonly inputModalities: readonly string[];
  readonly outputModalities: readonly string[];
  readonly supportedParameters: readonly string[];
  readonly contextWindow: number | null;
  readonly outputLimit: number | null;
}

type AiProfileValue = AiModelValue | readonly AiModelInfo[];

export interface AiProfileConfig {
  readonly [key: string]: AiProfileValue;
  readonly id: string;
  readonly name: string;
  readonly providerId: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly visionModel: string;
  readonly ocrModel: string;
  readonly translationModel: string;
  readonly temperature: number | null;
  readonly models: readonly AiModelInfo[];
  readonly discoveredAt: string;
}

export interface AiProfileView extends AiProfileConfig {
  readonly hasApiKey: boolean;
}

export interface ConnectAiProfileInput {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly providerId?: string;
}

export interface UpdateAiProfileSelectionInput {
  readonly id: string;
  readonly model: string;
  readonly visionModel: string;
  readonly ocrModel: string;
  readonly translationModel: string;
  readonly temperature: number | null;
}

export interface GenerateAnswerProposalInput {
  readonly problemId?: string;
  readonly contextId?: string;
  readonly imageUrls?: readonly string[];
  readonly imageSource?: 'slide' | 'browser-page';
  readonly captureCurrentPage?: boolean;
  readonly customPrompt?: string;
  readonly sessionId?: string;
  readonly retry?: boolean;
}

export interface AnswerProposal {
  readonly id: string;
  readonly sessionId: string;
  readonly problemId: string;
  readonly status: 'ready' | 'failed';
  readonly answer: AnswerValue | null;
  readonly explanation: string;
  readonly confidence: number | null;
  readonly failureReason: string | null;
  readonly validationIssues: readonly string[];
  readonly rawText: string;
  readonly profileId: string;
  readonly model: string;
  readonly contextSources: readonly string[];
  readonly createdAt: string;
}

export interface RecognizeSlideInput {
  readonly imageUrl: string;
}

export interface TranslateTextInput {
  readonly text: string;
  readonly targetLanguage: string;
}

export interface GeneratedTextResult {
  readonly text: string;
  readonly profileId: string;
  readonly model: string;
}
