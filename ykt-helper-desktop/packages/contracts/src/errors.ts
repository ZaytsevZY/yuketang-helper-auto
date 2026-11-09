export const ErrorCode = {
  InvalidArgument: 'INVALID_ARGUMENT',
  NotAuthenticated: 'NOT_AUTHENTICATED',
  NotFound: 'NOT_FOUND',
  NotImplemented: 'NOT_IMPLEMENTED',
  PermissionDenied: 'PERMISSION_DENIED',
  Conflict: 'CONFLICT',
  NetworkError: 'NETWORK_ERROR',
  InternalError: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface YuketangErrorData {
  code: ErrorCode;
  message: string;
  details?: Readonly<Record<string, unknown>>;
}

export class YuketangError extends Error {
  readonly code: ErrorCode;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(data: YuketangErrorData) {
    super(data.message);
    this.name = 'YuketangError';
    this.code = data.code;
    this.details = data.details;
  }
}
