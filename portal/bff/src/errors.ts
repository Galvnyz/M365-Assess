// Structured error contract shared with the OpenAPI `Error` schema
// (05-programming.md §3): stable `code`, client-safe `message`, optional
// `details`, and the request `correlationId`. Never leaks stack traces.

export const ErrorCodes = {
  /** No route matches the method and path. */
  routeNotFound: "request.not_found",
  validationFailed: "request.validation_failed",
  internalError: "server.internal_error",
  /** Same value as RbacErrorCodes.forbidden, so every 403 carries one code. */
  forbidden: "auth.forbidden",
  /** The route exists but the resource it names does not. */
  notFound: "resource.not_found",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export interface ErrorDetail {
  readonly field?: string;
  readonly reason?: string;
  readonly [key: string]: unknown;
}

export interface ErrorBody {
  readonly code: string;
  readonly message: string;
  readonly details?: ErrorDetail[];
  readonly correlationId: string;
}

export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: ErrorDetail[];

  constructor(code: string, message: string, status = 500, details?: ErrorDetail[]) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function toErrorBody(error: AppError, correlationId: string): ErrorBody {
  const body: ErrorBody = {
    code: error.code,
    message: error.message,
    correlationId,
  };
  return error.details === undefined ? body : { ...body, details: error.details };
}

export function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }
  return new AppError(ErrorCodes.internalError, "Internal server error", 500);
}
