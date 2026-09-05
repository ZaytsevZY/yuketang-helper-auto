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
  readonly baseUrl: string;
  readonly model: string;
  readonly visionModel: string;
  readonly ocrModel: string;
  readonly translationModel: string;
  readonly models: readonly AiModelInfo[];
  readonly discoveredAt: string;
}

export interface AiProfileView extends AiProfileConfig {
  readonly hasApiKey: boolean;
}

export interface ConnectAiProfileInput {
  readonly baseUrl: string;
  readonly apiKey: string;
}

export interface UpdateAiProfileSelectionInput {
  readonly id: string;
  readonly model: string;
  readonly visionModel: string;
  readonly ocrModel: string;
  readonly translationModel: string;
}

export interface GenerateAnswerProposalInput {
  readonly problemId: string;
  readonly imageUrls?: readonly string[];
  readonly customPrompt?: string;
}

export interface AnswerProposal {
  readonly problemId: string;
  readonly answer: AnswerValue | null;
  readonly explanation: string;
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
