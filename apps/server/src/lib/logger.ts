/**
 * Structured Logger
 * 
 * Provides a centralized, structured logging solution using pino.
 * Supports log levels, request ID tracking, and sensitive data redaction.
 */

import pino from "pino";

// Sensitive field patterns to redact
const REDACT_PATTERNS = [
  "*.apiKey",
  "*.api_key",
  "*.accessToken",
  "*.access_token",
  "*.secretKey",
  "*.secret_key",
  "*.password",
  "*.token",
  "*.authorization",
  "*.Authorization",
  "headers.authorization",
  "headers.Authorization",
  "headers.x-api-key",
  "body.password",
  "body.apiKey",
  "body.token",
  "connectionString",
  "*.connectionString",
];

// Determine log level from environment
const getLogLevel = (): string => {
  const level = process.env.LOG_LEVEL?.toLowerCase();
  if (level && ["trace", "debug", "info", "warn", "error", "fatal"].includes(level)) {
    return level;
  }
  return process.env.NODE_ENV === "production" ? "info" : "debug";
};

// Create base logger
export const logger = pino({
  level: getLogLevel(),
  redact: {
    paths: REDACT_PATTERNS,
    censor: "[REDACTED]",
  },
  transport:
    process.env.NODE_ENV !== "production"
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss",
            ignore: "pid,hostname",
          },
        }
      : undefined,
  formatters: {
    level: (label) => ({ level: label }),
  },
  base: {
    service: "screenshare-guide",
  },
});

// Request context type
export interface RequestContext {
  requestId: string;
  method?: string;
  path?: string;
  userAgent?: string;
  ip?: string;
}

// Create a child logger with request context
export function createRequestLogger(ctx: RequestContext) {
  return logger.child({
    requestId: ctx.requestId,
    method: ctx.method,
    path: ctx.path,
  });
}

// Generate unique request ID
let requestCounter = 0;
export function generateRequestId(): string {
  const timestamp = Date.now().toString(36);
  const counter = (++requestCounter % 0xffffff).toString(36).padStart(4, "0");
  return `${timestamp}-${counter}`;
}

// Log levels as convenience functions
export const log = {
  trace: (msg: string, data?: object) => logger.trace(data, msg),
  debug: (msg: string, data?: object) => logger.debug(data, msg),
  info: (msg: string, data?: object) => logger.info(data, msg),
  warn: (msg: string, data?: object) => logger.warn(data, msg),
  error: (msg: string, error?: Error | object) => {
    if (error instanceof Error) {
      logger.error(
        {
          err: {
            message: error.message,
            name: error.name,
            stack: error.stack,
          },
        },
        msg
      );
    } else {
      logger.error(error, msg);
    }
  },
  fatal: (msg: string, error?: Error | object) => {
    if (error instanceof Error) {
      logger.fatal(
        {
          err: {
            message: error.message,
            name: error.name,
            stack: error.stack,
          },
        },
        msg
      );
    } else {
      logger.fatal(error, msg);
    }
  },
};

// HTTP request logging helper
export function logRequest(
  requestId: string,
  method: string,
  path: string,
  statusCode: number,
  durationMs: number,
  error?: Error
) {
  const data = {
    requestId,
    method,
    path,
    statusCode,
    durationMs,
  };

  if (error) {
    logger.error({ ...data, err: { message: error.message, stack: error.stack } }, "Request failed");
  } else if (statusCode >= 500) {
    logger.error(data, "Request error");
  } else if (statusCode >= 400) {
    logger.warn(data, "Request client error");
  } else {
    logger.info(data, "Request completed");
  }
}

// WebSocket logging helper
export function logWebSocket(
  event: "open" | "message" | "close" | "error",
  token: string,
  details?: object
) {
  const data = { event, token: token.substring(0, 4) + "...", ...details };

  switch (event) {
    case "open":
      logger.info(data, "WebSocket connection opened");
      break;
    case "close":
      logger.info(data, "WebSocket connection closed");
      break;
    case "error":
      logger.error(data, "WebSocket error");
      break;
    case "message":
      logger.debug(data, "WebSocket message received");
      break;
  }
}

// AI provider logging helper
export function logAI(
  provider: string,
  operation: string,
  durationMs?: number,
  error?: Error
) {
  const data = { provider, operation, durationMs };

  if (error) {
    logger.error(
      { ...data, err: { message: error.message, stack: error.stack } },
      "AI operation failed"
    );
  } else {
    logger.debug(data, "AI operation completed");
  }
}

export default logger;
