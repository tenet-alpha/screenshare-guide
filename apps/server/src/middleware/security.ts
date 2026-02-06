/**
 * Security Middleware
 * 
 * Provides security headers and protections similar to Helmet.
 */

import { Elysia } from "elysia";

/**
 * Security headers middleware
 */
export const securityHeaders = new Elysia({ name: "security-headers" })
  .onAfterHandle(({ set }) => {
    // Prevent clickjacking
    set.headers["X-Frame-Options"] = "DENY";

    // Prevent MIME type sniffing
    set.headers["X-Content-Type-Options"] = "nosniff";

    // Enable XSS filter (legacy browsers)
    set.headers["X-XSS-Protection"] = "1; mode=block";

    // Referrer policy
    set.headers["Referrer-Policy"] = "strict-origin-when-cross-origin";

    // Permissions policy (disable dangerous features)
    set.headers["Permissions-Policy"] =
      "camera=(), microphone=(), geolocation=(), payment=()";

    // HSTS (only in production with HTTPS)
    if (process.env.NODE_ENV === "production") {
      set.headers["Strict-Transport-Security"] =
        "max-age=31536000; includeSubDomains";
    }
  });

/**
 * Input sanitization - strips potential XSS from string inputs
 */
export function sanitizeInput(input: unknown): unknown {
  if (typeof input === "string") {
    // Remove potential script tags and event handlers
    return input
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/on\w+\s*=\s*["'][^"']*["']/gi, "")
      .replace(/javascript:/gi, "");
  }

  if (Array.isArray(input)) {
    return input.map(sanitizeInput);
  }

  if (input && typeof input === "object") {
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>).map(([key, value]) => [
        key,
        sanitizeInput(value),
      ])
    );
  }

  return input;
}

/**
 * Validate content type for JSON requests
 */
export const validateContentType = new Elysia({ name: "validate-content-type" })
  .onBeforeHandle(({ request, set }) => {
    // Only check for POST/PUT/PATCH requests
    if (!["POST", "PUT", "PATCH"].includes(request.method)) {
      return;
    }

    const contentType = request.headers.get("content-type");
    
    // Skip for FormData/multipart (file uploads)
    if (contentType?.includes("multipart/form-data")) {
      return;
    }

    // Require JSON content type for other requests with body
    if (contentType && !contentType.includes("application/json")) {
      set.status = 415;
      return { error: "Unsupported Media Type", message: "Content-Type must be application/json" };
    }
  });
