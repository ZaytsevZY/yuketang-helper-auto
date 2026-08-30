import type { LessonEvent } from '@ykt/contracts';

export interface RoutingService {
  events(lessonId: string): AsyncIterable<LessonEvent>;
}

export class EmptyRoutingService implements RoutingService {
  async *events(_lessonId: string): AsyncIterable<LessonEvent> {
    // M0 has no browser observer or active network client.
  }
}
