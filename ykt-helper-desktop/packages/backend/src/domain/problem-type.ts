import { ProblemType } from '@ykt/contracts';

const LEGACY_TYPES = new Map<number, ProblemType>([
  [1, ProblemType.SingleChoice],
  [2, ProblemType.MultipleChoice],
  [3, ProblemType.Poll],
  [4, ProblemType.FillBlank],
  [5, ProblemType.Subjective],
]);

export function fromLegacyProblemType(value: unknown): ProblemType {
  const numeric = typeof value === 'string' ? Number(value) : value;
  return typeof numeric === 'number'
    ? (LEGACY_TYPES.get(numeric) ?? ProblemType.Unknown)
    : ProblemType.Unknown;
}

export function toLegacyProblemType(type: ProblemType): number | null {
  for (const [legacy, current] of LEGACY_TYPES) {
    if (current === type) return legacy;
  }
  return null;
}
