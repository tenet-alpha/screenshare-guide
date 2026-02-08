/**
 * Redis-backed Session Store
 *
 * Persists WebSocket session state in Redis for production resilience.
 * Falls back to an in-memory Map when REDIS_URL is not set (dev mode).
 *
 * Session state is serialized as JSON with a 24-hour TTL.
 */

import { log } from "./logger";

// Re-declare the SessionState shape here to avoid circular imports.
// This must stay in sync with the canonical definition in websocket.ts.
import type { ProofStep } from "@screenshare-guide/protocol";

export interface SessionState {
  sessionId: string;
  templateId: string;
  platform: string;
  currentStep: number;
  totalSteps: number;
  steps: ProofStep[];
  status: "waiting" | "analyzing" | "completed";
  lastAnalysisTime: number;
  consecutiveSuccesses: number;
  linkClicked: Record<number, boolean>;
  allExtractedData: Array<{ label: string; value: string }>;
  extractionVotes: Record<string, Record<string, number>>;
  lastSpokenAction: string | null;
  lastInstructionTime: number;
  linkClickedTime: number;
  pendingSuggestedAction: string | null;
  // Anti-forgery: interaction challenges
  activeChallenge: {
    id: string;
    instruction: string;
    successCriteria: string;
    issuedAt: number;
    timeoutMs: number;
  } | null;
  challengeResults: Array<{
    challengeId: string;
    step: number;
    passed: boolean;
    responseTimeMs: number;
  }>;
  challengeIssued: boolean;
  // Anti-forgery: trust signals
  trustSignals: {
    urlVerifiedCount: number;
    urlNotVerifiedCount: number;
    framesAnalyzed: number;
    sessionStartedAt: number;
    displaySurface: string | null;
    clientPlatform: string;
  };
}

// ─── Session Store Interface ────────────────────────────────────────

export interface SessionStore {
  get(token: string): Promise<SessionState | null>;
  set(token: string, state: SessionState): Promise<void>;
  delete(token: string): Promise<void>;
  /** Gracefully close the backing connection (no-op for in-memory). */
  quit(): Promise<void>;
}

// ─── Redis Implementation ───────────────────────────────────────────

const SESSION_TTL_SECONDS = 24 * 60 * 60; // 24 hours
const KEY_PREFIX = "sg:session:";

function createRedisStore(redisUrl: string): SessionStore {
  // Dynamic import so the ioredis dependency is only loaded when needed
  const Redis = require("ioredis") as typeof import("ioredis").default;
  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    retryStrategy(times: number) {
      if (times > 5) return null; // stop retrying
      return Math.min(times * 200, 2000);
    },
    // TLS support for rediss:// URLs is handled automatically by ioredis
  });

  redis.on("connect", () => {
    log.info("Redis connected");
  });

  redis.on("error", (err: Error) => {
    log.error("Redis connection error", err);
  });

  return {
    async get(token: string): Promise<SessionState | null> {
      const raw = await redis.get(`${KEY_PREFIX}${token}`);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as SessionState;
      } catch {
        log.warn("Failed to parse session from Redis", { token: token.substring(0, 4) });
        return null;
      }
    },

    async set(token: string, state: SessionState): Promise<void> {
      const json = JSON.stringify(state);
      await redis.set(`${KEY_PREFIX}${token}`, json, "EX", SESSION_TTL_SECONDS);
    },

    async delete(token: string): Promise<void> {
      await redis.del(`${KEY_PREFIX}${token}`);
    },

    async quit(): Promise<void> {
      await redis.quit();
    },
  };
}

// ─── In-Memory Fallback ─────────────────────────────────────────────

function createMemoryStore(): SessionStore {
  const map = new Map<string, SessionState>();

  return {
    async get(token: string): Promise<SessionState | null> {
      return map.get(token) ?? null;
    },

    async set(token: string, state: SessionState): Promise<void> {
      map.set(token, state);
    },

    async delete(token: string): Promise<void> {
      map.delete(token);
    },

    async quit(): Promise<void> {
      map.clear();
    },
  };
}

// ─── Factory ────────────────────────────────────────────────────────

/**
 * Create a session store. Uses Redis when REDIS_URL is set, otherwise
 * falls back to an in-memory Map (suitable for local development).
 */
export function createSessionStore(): SessionStore {
  const redisUrl = process.env.REDIS_URL;

  if (redisUrl) {
    log.info("Using Redis session store");
    return createRedisStore(redisUrl);
  }

  log.info("REDIS_URL not set — using in-memory session store (dev mode)");
  return createMemoryStore();
}
