// Stable error envelope (PRD B §8): {"error":{"code","message","requestId"}}.
// Messages are fixed per code: no stack traces, SQL, env names or account existence leak out.

export const ERROR_CODES = {
  BAD_REQUEST: { status: 400, message: 'Bad request' },
  INVALID_JSON: { status: 400, message: 'Request body is not valid JSON' },
  VALIDATION_FAILED: { status: 400, message: 'Request validation failed' },
  UNAUTHORIZED: { status: 401, message: 'Authentication required' },
  FORBIDDEN: { status: 403, message: 'Forbidden' },
  NOT_FOUND: { status: 404, message: 'Not found' },
  METHOD_NOT_ALLOWED: { status: 405, message: 'Method not allowed' },
  PAYLOAD_TOO_LARGE: { status: 413, message: 'Request body too large' },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, message: 'Content-Type must be application/json' },
  RATE_LIMITED: { status: 429, message: 'Too many requests' },
  INTERNAL: { status: 500, message: 'Internal server error' },
  NOT_READY: { status: 503, message: 'Service not ready' },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

/** Field-level validation detail: the path and rule only, never the submitted value. */
export interface FieldIssue {
  readonly path: string;
  readonly rule: string;
}

export interface ErrorBody {
  readonly error: {
    readonly code: ErrorCode;
    readonly message: string;
    readonly requestId: string;
    readonly fields?: readonly FieldIssue[];
  };
}

/** Throw from handlers for expected failures; anything else becomes INTERNAL. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly fields: readonly FieldIssue[] | undefined;

  constructor(code: ErrorCode, fields?: readonly FieldIssue[]) {
    super(ERROR_CODES[code].message);
    this.name = 'AppError';
    this.code = code;
    this.fields = fields;
  }
}

export function errorBody(
  code: ErrorCode,
  requestId: string,
  fields?: readonly FieldIssue[],
): ErrorBody {
  return {
    error: {
      code,
      message: ERROR_CODES[code].message,
      requestId,
      ...(fields !== undefined && fields.length > 0 ? { fields } : {}),
    },
  };
}
