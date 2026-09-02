export interface RuntimeStatus {
  state: 'stopped' | 'running';
  version: string;
  capabilities: readonly string[];
}

export interface Lesson {
  id: string;
  title: string;
  status: 'upcoming' | 'active' | 'ended';
}

export const ProblemType = {
  SingleChoice: 'single-choice',
  MultipleChoice: 'multiple-choice',
  Poll: 'poll',
  FillBlank: 'fill-blank',
  Subjective: 'subjective',
  Unknown: 'unknown',
} as const;

export type ProblemType = (typeof ProblemType)[keyof typeof ProblemType];

export interface SubjectiveAnswer {
  content: string;
  pics: readonly string[];
}

export type AnswerValue = readonly string[] | SubjectiveAnswer;

export interface Problem {
  id: string;
  lessonId: string;
  presentationId: string;
  slideId: string;
  type: ProblemType;
  prompt: string;
  options: readonly string[];
  blanks: readonly string[];
  result: AnswerValue | null;
}

export interface Slide {
  id: string;
  index: number;
  title: string;
  imageUrl: string | null;
  problem: Problem | null;
}

export interface Presentation {
  id: string;
  lessonId: string;
  title: string;
  width: number | null;
  height: number | null;
  slides: readonly Slide[];
}

export interface ProblemContext extends Problem {
  status: 'locked' | 'available' | 'answered' | 'expired';
  unlockedAt: number | null;
  deadlineAt: number | null;
}

export interface AnswerInput {
  problemId: string;
  answer: string | AnswerValue;
  idempotencyKey?: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: readonly string[];
  normalizedAnswer: AnswerValue | null;
}

export interface SubmissionResult {
  problemId: string;
  status: 'submitted' | 'rejected';
  submittedAt: string;
}
