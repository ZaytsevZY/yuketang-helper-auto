import type { BrowserEnvironment, Lesson, Presentation } from '@ykt/contracts';

export interface BrowserCredentials {
  cookieHeader: string;
  bearerToken: string | null;
  userId: string | null;
}

export interface SessionCredentialSource {
  load(environment: BrowserEnvironment): Promise<BrowserCredentials>;
}

export interface ActiveUser {
  id: string;
  name: string;
}

export interface ActiveLesson extends Lesson {
  classroomId: string | null;
  presentationId: string | null;
}

export interface CheckinResult {
  lessonToken: string;
  expiresAt: number | null;
}

export interface ActiveHttpRequest {
  method: 'GET' | 'POST';
  url: string;
  headers: Readonly<Record<string, string>>;
  body: string | null;
}

export interface ActiveHttpResponse {
  status: number;
  headers: Readonly<Record<string, string>>;
  body: unknown;
}

export interface ActiveHttpTransport {
  request(request: ActiveHttpRequest): Promise<ActiveHttpResponse>;
}

export interface HostAdapter {
  environment: BrowserEnvironment;
  origin: string;
  webSocketUrl: string;
  userUrl: string;
  onLessonUrl: string;
  checkinUrl: string;
  answerUrl: string;
  retryUrl: string;
  presentationUrl(presentationId: string): string;
  parseUser(value: unknown): ActiveUser;
  parseLessons(value: unknown): readonly ActiveLesson[];
  parseCheckin(value: unknown, now: number): CheckinResult;
  parsePresentation(
    value: unknown,
    lessonId: string,
    presentationId: string,
  ): Presentation;
}
