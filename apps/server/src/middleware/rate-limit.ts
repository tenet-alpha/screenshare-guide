/**
 * Rate Limiting Middleware
 * 
 * Provides configurable rate limiting using an in-memory store.
 * For production, consider using Redis for distributed rate limiting.
 */

import { Elysia } from "elysia";
import { RateLimitError } from "../lib/errors";
import { log } from "../lib/logger";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitConfig {
  windowMs: number;      // Time window in milliseconds
  maxRequests: number;   // Max requests per window
  keyGenerator?: (request: Request) => string;
  skip?: (request: Request) => boolean;
}

// In-memory rate limit store
const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up expired entries periodically
const CLEANUP_INTERVAL = 60000; // 1 minute
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt < now) {
      rateLimitStore.delete(key);
    }
  }
}, CLEANUP_INTERVAL);

/**
 * Default key generator: uses IP address or X-Forwarded-For
 */
function defaultKeyGenerator(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  
  // In development, use a constant key
  return "localhost";
}

/**
 * Check rate limit for a key
 */
function checkRateLimit(
  key: string,
  config: RateLimitConfig
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  let entry = rateLimitStore.get(key);

  // Create new entry or reset if window expired
  if (!entry || entry.resetAt < now) {
    entry = {
      count: 0,
      resetAt: now + config.windowMs,
    };
    rateLimitStore.set(key, entry);
  }

  entry.count++;
  
  const remaining = Math.max(0, config.maxRequests - entry.count);
  const allowed = entry.count <= config.maxRequests;

  return { allowed, remaining, resetAt: entry.resetAt };
}

/**
 * Create rate limiting middleware
 */
export function createRateLimiter(config: RateLimitConfig) {
  const keyGenerator = config.keyGenerator || defaultKeyGenerator;
  const skip = config.skip || (() => false);

  return new Elysia({ name: `rate-limit-${config.maxRequests}/${config.windowMs}` })
    .onBeforeHandle(({ request, set }) => {
      // Skip if configured to skip
      if (skip(request)) {
        return;
      }

      const key = keyGenerator(request);
      const { allowed, remaining, resetAt } = checkRateLimit(key, config);

      // Set rate limit headers
      set.headers["X-RateLimit-Limit"] = config.maxRequests.toString();
      set.headers["X-RateLimit-Remaining"] = remaining.toString();
      set.headers["X-RateLimit-Reset"] = Math.ceil(resetAt / 1000).toString();

      if (!allowed) {
        const retryAfter = Math.ceil((resetAt - Date.now()) / 1000);
        set.headers["Retry-After"] = retryAfter.toString();
        
        log.warn("Rate limit exceeded", { key, remaining, resetAt });

        set.status = 429;
        return {
          error: "Too Many Requests",
          message: "Rate limit exceeded. Please try again later.",
          retryAfter,
        };
      }
    });
}

/**
 * Preset rate limiters
 */

// Standard API rate limit: 100 requests per minute
export const standardRateLimit = createRateLimiter({
  windowMs: 60000,
  maxRequests: 100,
});

// Strict rate limit for sensitive operations: 10 requests per minute
export const strictRateLimit = createRateLimiter({
  windowMs: 60000,
  maxRequests: 10,
});

// Generous rate limit for read operations: 300 requests per minute
export const generousRateLimit = createRateLimiter({
  windowMs: 60000,
  maxRequests: 300,
  skip: (request) => request.method === "GET",
});

// WebSocket connection rate limit: 5 connections per minute
export const wsConnectionRateLimit = createRateLimiter({
  windowMs: 60000,
  maxRequests: 5,
});

/**
 * Session-specific rate limiter for AI operations
 * Limits are per session token
 */
export function createSessionRateLimiter(maxRequests: number, windowMs: number) {
  return createRateLimiter({
    windowMs,
    maxRequests,
    keyGenerator: (request) => {
      const url = new URL(request.url);
      const token = url.pathname.split("/").pop() || "unknown";
      return `session:${token}`;
    },
  });
}

// AI analysis rate limit: 30 analyses per minute per session
export const aiAnalysisRateLimit = createSessionRateLimiter(30, 60000);
