/**
 * Session Cleanup
 *
 * Periodically purges expired sessions and their associated data.
 * Runs every hour. Deletes sessions that expired more than 24 hours ago
 * (gives a grace period for any in-flight uploads or final data persistence).
 */

import { db } from "@screenshare-guide/db";
import { log } from "./logger";

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const GRACE_PERIOD_MS = 24 * 60 * 60 * 1000; // 24 hours after expiry

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Delete expired sessions and their dependent rows.
 * Returns the number of sessions deleted.
 */
export async function cleanupExpiredSessions(): Promise<number> {
  const cutoff = new Date(Date.now() - GRACE_PERIOD_MS);

  try {
    // Find expired sessions past the grace period
    const expiredSessions = await db
      .selectFrom("sessions")
      .select("id")
      .where("expires_at", "<", cutoff)
      .execute();

    if (expiredSessions.length === 0) {
      return 0;
    }

    const ids = expiredSessions.map((s) => s.id);

    // Delete dependent rows first (FK constraints)
    await db
      .deleteFrom("frame_samples")
      .where("session_id", "in", ids)
      .execute();

    await db
      .deleteFrom("recordings")
      .where("session_id", "in", ids)
      .execute();

    // Delete the sessions
    const result = await db
      .deleteFrom("sessions")
      .where("id", "in", ids)
      .execute();

    const count = result.length;

    log.info("Expired sessions cleaned up", {
      deleted: count,
      cutoffDate: cutoff.toISOString(),
    });

    return count;
  } catch (error) {
    log.error("Session cleanup failed", error as Error);
    return 0;
  }
}

/**
 * Start the periodic cleanup timer.
 * Runs immediately once, then every CLEANUP_INTERVAL_MS.
 */
export function startSessionCleanup(): void {
  // Run once on startup (after a short delay to let DB connect)
  setTimeout(() => {
    cleanupExpiredSessions().catch(() => {});
  }, 10_000);

  // Then run periodically
  cleanupTimer = setInterval(() => {
    cleanupExpiredSessions().catch(() => {});
  }, CLEANUP_INTERVAL_MS);

  log.info("Session cleanup scheduled", {
    intervalMs: CLEANUP_INTERVAL_MS,
    gracePeriodMs: GRACE_PERIOD_MS,
  });
}

/**
 * Stop the cleanup timer (for tests/shutdown).
 */
export function stopSessionCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}
