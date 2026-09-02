import {
  ErrorCode,
  YuketangError,
  type AnswerInput,
  type ProblemContext,
  type ValidationResult,
} from '@ykt/contracts';

import type { LessonRepository } from '../repositories/lesson-repository.js';
import { AnswerService } from './answer-service.js';
import { systemClock, type Clock } from '../workflows/lesson-state-machine.js';

export class ProblemService {
  constructor(
    private readonly repository: LessonRepository,
    private readonly clock: Clock = systemClock,
    private readonly answers = new AnswerService(),
  ) {}

  getProblem(problemId: string): ProblemContext {
    const match = this.repository.findProblem(problemId);
    const problem = match?.session.getProblemContext(
      problemId,
      this.clock.now(),
    );
    if (!problem) {
      throw new YuketangError({
        code: ErrorCode.NotFound,
        message: `Problem ${problemId} was not found.`,
      });
    }
    return problem;
  }

  validateAnswer(input: AnswerInput): ValidationResult {
    return this.answers.validate(
      this.getProblem(input.problemId),
      input.answer,
    );
  }
}
