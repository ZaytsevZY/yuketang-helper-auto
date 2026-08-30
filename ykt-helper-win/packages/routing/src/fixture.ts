import type {
  DomainNetworkEntry,
  NetworkEntry,
  NetworkFixture,
} from '@ykt/contracts';

import { isRawNetworkEntry, NormalizerPipeline } from './normalizer.js';

export function createNetworkFixture(
  entries: readonly NetworkEntry[],
): NetworkFixture {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    entries,
  };
}

export function parseNetworkFixture(text: string): NetworkFixture {
  const value: unknown = JSON.parse(text);
  if (!isFixture(value))
    throw new Error('Unsupported or invalid network fixture.');
  return value;
}

export function replayNetworkFixture(
  fixture: NetworkFixture,
  pipeline = new NormalizerPipeline(),
): readonly DomainNetworkEntry[] {
  let sequence =
    fixture.entries.reduce(
      (maximum, entry) => Math.max(maximum, entry.sequence),
      0,
    ) + 1;

  return fixture.entries.filter(isRawNetworkEntry).flatMap((entry) =>
    pipeline.normalize(entry).map((draft) => ({
      ...draft,
      id: `replay-${sequence}`,
      sequence: sequence++,
      timestamp: entry.timestamp,
      source: 'fixture' as const,
    })),
  );
}

function isFixture(value: unknown): value is NetworkFixture {
  if (!value || typeof value !== 'object') return false;
  const fixture = value as Partial<NetworkFixture>;
  return (
    fixture.version === 1 &&
    typeof fixture.exportedAt === 'string' &&
    Array.isArray(fixture.entries) &&
    fixture.entries.every(isNetworkEntryShape)
  );
}

function isNetworkEntryShape(value: unknown): value is NetworkEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<NetworkEntry>;
  return (
    typeof entry.id === 'string' &&
    typeof entry.sequence === 'number' &&
    typeof entry.timestamp === 'string' &&
    (entry.kind === 'http' ||
      entry.kind === 'websocket' ||
      entry.kind === 'domain')
  );
}
