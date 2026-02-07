import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { trpcHandler } from "./trpc-adapter";
import { websocketHandler } from "./websocket";
import { securityHeaders, validateContentType } from "./middleware/security";
import { standardRateLimit } from "./middleware/rate-limit";
import { logger, generateRequestId, logRequest } from "./lib/logger";

const PORT = process.env.PORT || 3001;

// Parse CORS origins from environment (comma-separated)
const corsOrigins = process.env.CORS_ORIGIN?.split(",").map((o) => o.trim()) || [
  "http://localhost:3000",
];

const app = new Elysia()
  // Request ID and timing
  .derive(({ request }) => {
    const requestId = generateRequestId();
    const startTime = Date.now();
    return { requestId, startTime };
  })

  // Security headers
  .use(securityHeaders)

  // Content type validation
  .use(validateContentType)

  // Enable CORS for frontend
  .use(
    cors({
      origin: corsOrigins,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      credentials: true,
      allowedHeaders: ["Content-Type", "Authorization", "X-Request-ID"],
      exposeHeaders: [
        "X-RateLimit-Limit",
        "X-RateLimit-Remaining",
        "X-RateLimit-Reset",
      ],
    })
  )

  // Rate limiting
  .use(standardRateLimit)

  // Request logging
  .onAfterHandle(({ request, set, requestId, startTime }) => {
    const duration = Date.now() - (startTime ?? Date.now());
    const status = typeof set.status === "number" ? set.status : 200;
    logRequest(requestId ?? "unknown", request.method, new URL(request.url).pathname, status, duration);
  })

  // Error handling with logging
  .onError(({ error, request, set, requestId, startTime }) => {
    const duration = Date.now() - (startTime ?? Date.now());
    const status = typeof set.status === "number" ? set.status : 500;
    const err = error as Error;

    logRequest(
      requestId ?? "unknown",
      request.method,
      new URL(request.url).pathname,
      status,
      duration,
      err
    );

    // Return structured error response
    return {
      error: err.name || "Error",
      message: err.message || "An unexpected error occurred",
      requestId: requestId ?? "unknown",
    };
  })

  // Health check (bypass rate limiting)
  .get("/health", ({ requestId }) => ({
    status: "ok",
    timestamp: new Date().toISOString(),
    requestId,
  }))

  // tRPC handler for all CRUD operations
  .all("/trpc/*", trpcHandler)

  // WebSocket handler for real-time AI guidance
  .use(websocketHandler)

  .listen(PORT);

logger.info(
  {
    port: PORT,
    corsOrigins,
    nodeEnv: process.env.NODE_ENV,
    visionProvider: process.env.VISION_PROVIDER || "azure",
    ttsProvider: process.env.TTS_PROVIDER || "elevenlabs",
  },
  "Server started"
);

logger.info({ endpoint: `http://localhost:${PORT}/trpc` }, "tRPC endpoint");
logger.info({ endpoint: `ws://localhost:${PORT}/ws` }, "WebSocket endpoint");

export type App = typeof app;
