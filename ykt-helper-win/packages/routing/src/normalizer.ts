import type {
  DomainNetworkEntry,
  HttpNetworkEntry,
  NetworkEntry,
  WebSocketNetworkEntry,
} from '@ykt/contracts';

export interface DomainEventDraft {
  eventType: string;
  summary: string;
  data: unknown;
}

export interface EventNormalizer {
  readonly id: string;
  normalize(
    entry: HttpNetworkEntry | WebSocketNetworkEntry,
  ): readonly DomainEventDraft[];
}

export class NormalizerPipeline {
  constructor(
    private readonly normalizers: readonly EventNormalizer[] = [
      new YuketangEventNormalizer(),
    ],
  ) {}

  normalize(
    entry: HttpNetworkEntry | WebSocketNetworkEntry,
  ): readonly Omit<
    DomainNetworkEntry,
    'id' | 'sequence' | 'timestamp' | 'source'
  >[] {
    return this.normalizers.flatMap((normalizer) =>
      normalizer.normalize(entry).map((draft) => ({
        ...draft,
        normalizerId: normalizer.id,
        sourceEntryId: entry.id,
        kind: 'domain' as const,
      })),
    );
  }
}

export class YuketangEventNormalizer implements EventNormalizer {
  readonly id = 'yuketang-keywords-v1';

  normalize(
    entry: HttpNetworkEntry | WebSocketNetworkEntry,
  ): readonly DomainEventDraft[] {
    const content = searchableContent(entry).toLowerCase();
    const mapping = EVENT_MAPPINGS.find(({ keywords }) =>
      keywords.some((keyword) => content.includes(keyword)),
    );
    if (!mapping) return [];

    return [
      {
        eventType: mapping.eventType,
        summary: `${mapping.label}（由 ${entry.kind === 'http' ? 'HTTP' : 'WebSocket'} 记录推断）`,
        data: {
          transport: entry.kind,
          url: entry.url,
          direction: entry.kind === 'websocket' ? entry.direction : undefined,
        },
      },
    ];
  }
}

const EVENT_MAPPINGS = [
  {
    eventType: 'lesson.checkin',
    label: '课堂签到事件',
    keywords: ['checkin', 'check-in', 'sign_in'],
  },
  {
    eventType: 'presentation.updated',
    label: '课件事件',
    keywords: ['presentation', '/slide', 'slides'],
  },
  {
    eventType: 'problem.published',
    label: '题目事件',
    keywords: ['problem', 'question'],
  },
] as const;

function searchableContent(
  entry: HttpNetworkEntry | WebSocketNetworkEntry,
): string {
  if (entry.kind === 'http') return `${entry.url}\n${entry.body ?? ''}`;
  return `${entry.url}\n${entry.payload ?? ''}`;
}

export function isRawNetworkEntry(
  entry: NetworkEntry,
): entry is HttpNetworkEntry | WebSocketNetworkEntry {
  return entry.kind !== 'domain';
}
