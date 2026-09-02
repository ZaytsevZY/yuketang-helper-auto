import type { LessonEvent } from '@ykt/contracts';

export * from './active/client.js';
export * from './active/host-adapter.js';
export * from './active/http-transport.js';
export * from './active/lesson-websocket.js';
export * from './active/session-manager.js';
export * from './active/types.js';
export * from './fixture.js';
export * from './normalizer.js';
export * from './recorder.js';
export * from './redactor.js';

export interface RoutingService {
  events(lessonId: string): AsyncIterable<LessonEvent>;
}

export class EmptyRoutingService implements RoutingService {
  async *events(_lessonId: string): AsyncIterable<LessonEvent> {
    // M0 has no browser observer or active network client.
  }
}
