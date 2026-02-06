/**
 * Custom Error Types
 * 
 * Provides typed errors with error codes for consistent error handling.
 */

export enum ErrorCode {
  // General errors
  INTERNAL_ERROR = "INTERNAL_ERROR",
  VALIDATION_ERROR = "VALIDATION_ERROR",
  NOT_FOUND = "NOT_FOUND",
  UNAUTHORIZED = "UNAUTHORIZED",
  FORBIDDEN = "FORBIDDEN",
  RATE_LIMITED = "RATE_LIMITED",

  // Session errors
  SESSION_NOT_FOUND = "SESSION_NOT_FOUND",
  SESSION_EXPIRED = "SESSION_EXPIRED",
  SESSION_ALREADY_USED = "SESSION_ALREADY_USED",
  SESSION_ALREADY_STARTED = "SESSION_ALREADY_STARTED",

  // Template errors
  TEMPLATE_NOT_FOUND = "TEMPLATE_NOT_FOUND",

  // Storage errors
  STORAGE_ERROR = "STORAGE_ERROR",
  STORAGE_NOT_CONFIGURED = "STORAGE_NOT_CONFIGURED",

  // AI errors
  AI_PROVIDER_ERROR = "AI_PROVIDER_ERROR",
  AI_NOT_CONFIGURED = "AI_NOT_CONFIGURED",
}

export interface ErrorDetails {
  code: ErrorCode;
  message: string;
  statusCode: number;
  details?: Record<string, unknown>;
}

/**
 * Base application error with error code
 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    statusCode: number = 500,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;

    // Maintain proper stack trace
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON(): ErrorDetails {
    return {
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      details: this.details,
    };
  }
}

/**
 * Validation error (400)
 */
export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(ErrorCode.VALIDATION_ERROR, message, 400, details);
    this.name = "ValidationError";
  }
}

/**
 * Not found error (404)
 */
export class NotFoundError extends AppError {
  constructor(resource: string, identifier?: string) {
    const message = identifier
      ? `${resource} with ID '${identifier}' not found`
      : `${resource} not found`;
    super(ErrorCode.NOT_FOUND, message, 404);
    this.name = "NotFoundError";
  }
}

/**
 * Unauthorized error (401)
 */
export class UnauthorizedError extends AppError {
  constructor(message: string = "Unauthorized") {
    super(ErrorCode.UNAUTHORIZED, message, 401);
    this.name = "UnauthorizedError";
  }
}

/**
 * Forbidden error (403)
 */
export class ForbiddenError extends AppError {
  constructor(message: string = "Forbidden") {
    super(ErrorCode.FORBIDDEN, message, 403);
    this.name = "ForbiddenError";
  }
}

/**
 * Rate limit error (429)
 */
export class RateLimitError extends AppError {
  public readonly retryAfter: number;

  constructor(retryAfter: number = 60) {
    super(ErrorCode.RATE_LIMITED, "Too many requests", 429, { retryAfter });
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
  }
}

/**
 * Session-specific errors
 */
export class SessionError extends AppError {
  constructor(code: ErrorCode, message: string) {
    super(code, message, code === ErrorCode.SESSION_NOT_FOUND ? 404 : 400);
    this.name = "SessionError";
  }

  static notFound(token?: string): SessionError {
    return new SessionError(ErrorCode.SESSION_NOT_FOUND, "Session not found");
  }

  static expired(): SessionError {
    return new SessionError(ErrorCode.SESSION_EXPIRED, "Session has expired");
  }

  static alreadyUsed(): SessionError {
    return new SessionError(
      ErrorCode.SESSION_ALREADY_USED,
      "Session has already been used"
    );
  }

  static alreadyStarted(): SessionError {
    return new SessionError(
      ErrorCode.SESSION_ALREADY_STARTED,
      "Session has already been started"
    );
  }
}

/**
 * Storage-specific errors
 */
export class StorageError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(ErrorCode.STORAGE_ERROR, message, 500, details);
    this.name = "StorageError";
  }

  static notConfigured(): StorageError {
    return new StorageError("Storage is not configured");
  }
}

/**
 * AI provider-specific errors
 */
export class AIError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(ErrorCode.AI_PROVIDER_ERROR, message, 500, details);
    this.name = "AIError";
  }

  static notConfigured(provider: string): AIError {
    return new AIError(`AI provider '${provider}' is not configured`);
  }
}

/**
 * Convert any error to an AppError
 */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    return new AppError(
      ErrorCode.INTERNAL_ERROR,
      error.message,
      500,
      { originalError: error.name }
    );
  }

  return new AppError(
    ErrorCode.INTERNAL_ERROR,
    "An unexpected error occurred",
    500
  );
}

/**
 * Check if error is a specific error code
 */
export function isErrorCode(error: unknown, code: ErrorCode): boolean {
  return error instanceof AppError && error.code === code;
}
