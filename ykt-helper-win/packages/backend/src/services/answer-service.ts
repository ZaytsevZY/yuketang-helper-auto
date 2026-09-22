import {
  ProblemType,
  type AnswerValue,
  type Problem,
  type SubjectiveAnswer,
  type ValidationResult,
} from '@ykt/contracts';

import { toLegacyProblemType } from '../domain/problem-type.js';

export interface AnswerPayload {
  problemId: string;
  problemType: number;
  dt: number;
  result: SubmissionAnswerValue;
}

export interface SubjectiveSubmissionAnswer {
  content: string;
  pics: readonly { pic: string }[];
  videos: readonly never[];
}

export type SubmissionAnswerValue =
  readonly string[] | SubjectiveSubmissionAnswer;

export type SubmissionPlan =
  | { route: 'answer'; payload: AnswerPayload }
  | { route: 'retry'; payload: { problems: readonly AnswerPayload[] } };

export interface SubmissionPlanInput {
  problem: Problem;
  answer: AnswerValue;
  now: number;
  startTime: number | null;
  endTime: number | null;
  forceRetry?: boolean;
  retryDtOffsetMs?: number;
}

export class AnswerService {
  validateFormat(
    problem: Problem,
    input: string | AnswerValue,
  ): ValidationResult {
    const answer = normalizeAnswer(problem.type, input);
    const issues = answer
      ? validateNormalizedAnswer(problem, answer)
      : ['answer format is not supported'];
    return {
      valid: issues.length === 0,
      issues,
      normalizedAnswer: answer,
    };
  }
}

export function parseManualAnswer(
  type: Problem['type'],
  content: string,
): AnswerValue | null {
  if (
    type === ProblemType.SingleChoice ||
    type === ProblemType.MultipleChoice ||
    type === ProblemType.Poll
  ) {
    const value = content.trim().toUpperCase();
    const parts =
      value.includes(',') || /\s/.test(value)
        ? value.split(/[\s,]+/)
        : value.split('');
    return [...new Set(parts.filter(Boolean))].sort();
  }
  if (type === ProblemType.FillBlank) {
    return content
      .split('\n')
      .map((part) => part.trim())
      .filter(Boolean);
  }
  if (type === ProblemType.Subjective) {
    return { content: subjectiveContent(content), pics: [] };
  }
  return null;
}

export function planSubmission(input: SubmissionPlanInput): SubmissionPlan {
  const legacyType = toLegacyProblemType(input.problem.type);
  if (legacyType === null)
    throw new Error('Unknown problem type cannot be submitted.');

  const retry =
    input.forceRetry === true ||
    (input.endTime !== null && input.now >= input.endTime);
  const base = {
    problemId: input.problem.id,
    problemType: legacyType,
    result: submissionAnswer(input.answer),
  };

  if (!retry) {
    return { route: 'answer', payload: { ...base, dt: input.now } };
  }

  const offset = Math.max(0, input.retryDtOffsetMs ?? 2_000);
  const dt =
    input.startTime !== null
      ? input.startTime + offset
      : input.endTime !== null
        ? Math.max(0, input.endTime - Math.max(offset, 5_000))
        : Math.max(0, input.now - offset);
  return { route: 'retry', payload: { problems: [{ ...base, dt }] } };
}

function subjectiveContent(input: string): string {
  const content = input.trim();
  try {
    const parsed: unknown = JSON.parse(content);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      typeof (parsed as Record<string, unknown>).content === 'string'
    ) {
      return ((parsed as Record<string, unknown>).content as string).trim();
    }
  } catch {
    // Plain text is the primary manual-input path.
  }
  return content;
}

function submissionAnswer(answer: AnswerValue): SubmissionAnswerValue {
  if (isStringArrayAnswer(answer)) return answer;
  return {
    content: answer.content,
    pics: answer.pics.length
      ? answer.pics.map((pic) => ({ pic }))
      : [{ pic: '' }],
    videos: [],
  };
}

function normalizeAnswer(
  type: Problem['type'],
  input: string | AnswerValue,
): AnswerValue | null {
  if (typeof input === 'string') return parseManualAnswer(type, input);
  if (isStringArrayAnswer(input)) {
    if (type === ProblemType.Subjective || type === ProblemType.Unknown) {
      return null;
    }
    const values = input.map((value) => value.trim()).filter(Boolean);
    return type === ProblemType.FillBlank
      ? values
      : [...new Set(values.map((value) => value.toUpperCase()))].sort();
  }
  if (isSubjectiveAnswer(input) && type === ProblemType.Subjective) {
    return { content: input.content.trim(), pics: [...input.pics] };
  }
  return null;
}

function validateNormalizedAnswer(
  problem: Problem,
  answer: AnswerValue,
): readonly string[] {
  if (!isStringArrayAnswer(answer)) {
    return answer.content.length > 0 || answer.pics.length > 0
      ? []
      : ['subjective answer is empty'];
  }

  if (answer.length === 0) return ['answer is empty'];
  if (
    (problem.type === ProblemType.SingleChoice ||
      problem.type === ProblemType.Poll) &&
    answer.length !== 1
  ) {
    return ['exactly one option is required'];
  }
  if (
    problem.type === ProblemType.FillBlank &&
    problem.blanks.length > 0 &&
    answer.length !== problem.blanks.length
  ) {
    return [`expected ${problem.blanks.length} blank answers`];
  }
  if (
    problem.type !== ProblemType.FillBlank &&
    answer.some((value) => !/^[A-Z]$/.test(value))
  ) {
    return ['choice answers must use option letters'];
  }
  if (
    problem.type !== ProblemType.FillBlank &&
    problem.options.length > 0 &&
    answer.some((value) => value.charCodeAt(0) - 65 >= problem.options.length)
  ) {
    return ['answer references an unavailable option'];
  }
  return [];
}

function isSubjectiveAnswer(value: AnswerValue): value is SubjectiveAnswer {
  return !isStringArrayAnswer(value);
}

function isStringArrayAnswer(value: AnswerValue): value is readonly string[] {
  return Array.isArray(value);
}
