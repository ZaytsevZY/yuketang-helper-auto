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

export interface ProblemContext {
  id: string;
  lessonId: string;
  type: 'single-choice' | 'multiple-choice' | 'text' | 'unknown';
  prompt: string;
  options: readonly string[];
}

export interface AnswerInput {
  problemId: string;
  answer: string | readonly string[];
  idempotencyKey?: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: readonly string[];
}

export interface SubmissionResult {
  problemId: string;
  status: 'submitted' | 'rejected';
  submittedAt: string;
}
