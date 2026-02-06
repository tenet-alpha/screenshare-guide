import { z } from "zod";
import { router, publicProcedure } from "../trpc";
import type { FrameAnalysis } from "@screenshare-guide/db";

const createRecordingSchema = z.object({
  sessionId: z.string().uuid(),
  storageKey: z.string().min(1),
  chunkIndex: z.number().min(0),
  durationMs: z.number().optional(),
  sizeBytes: z.number().optional(),
  mimeType: z.string().optional(),
});

const createFrameSampleSchema = z.object({
  sessionId: z.string().uuid(),
  storageKey: z.string().min(1),
  capturedAt: z.string().datetime(),
  analysisResult: z
    .object({
      description: z.string(),
      detectedElements: z.array(z.string()),
      matchesSuccessCriteria: z.boolean(),
      confidence: z.number().min(0).max(1),
      suggestedAction: z.string().optional(),
    })
    .optional(),
});

export const recordingRouter = router({
  /**
   * Register a new recording chunk
   */
  create: publicProcedure
    .input(createRecordingSchema)
    .mutation(async ({ ctx, input }) => {
      // Verify session exists
      const session = await ctx.db
        .selectFrom("sessions")
        .selectAll()
        .where("id", "=", input.sessionId)
        .executeTakeFirst();

      if (!session) {
        throw new Error("Session not found");
      }

      const recording = await ctx.db
        .insertInto("recordings")
        .values({
          session_id: input.sessionId,
          storage_key: input.storageKey,
          chunk_index: input.chunkIndex,
          duration_ms: input.durationMs ?? null,
          size_bytes: input.sizeBytes ?? null,
          mime_type: input.mimeType ?? "video/webm",
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      return recording;
    }),

  /**
   * Get all recordings for a session
   */
  listBySession: publicProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .selectFrom("recordings")
        .selectAll()
        .where("session_id", "=", input.sessionId)
        .orderBy("chunk_index", "asc")
        .execute();
    }),

  /**
   * Create a frame sample record
   */
  createFrameSample: publicProcedure
    .input(createFrameSampleSchema)
    .mutation(async ({ ctx, input }) => {
      const frameSample = await ctx.db
        .insertInto("frame_samples")
        .values({
          session_id: input.sessionId,
          storage_key: input.storageKey,
          captured_at: new Date(input.capturedAt),
          analysis_result: input.analysisResult
            ? JSON.stringify(input.analysisResult)
            : null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      return frameSample;
    }),

  /**
   * Update frame sample with analysis result
   */
  updateFrameAnalysis: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        analysisResult: z.object({
          description: z.string(),
          detectedElements: z.array(z.string()),
          matchesSuccessCriteria: z.boolean(),
          confidence: z.number().min(0).max(1),
          suggestedAction: z.string().optional(),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const frameSample = await ctx.db
        .updateTable("frame_samples")
        .set({
          analysis_result: JSON.stringify(input.analysisResult),
        })
        .where("id", "=", input.id)
        .returningAll()
        .executeTakeFirst();

      if (!frameSample) {
        throw new Error("Frame sample not found");
      }

      return frameSample;
    }),

  /**
   * Get frame samples for a session
   */
  listFramesBySession: publicProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .selectFrom("frame_samples")
        .selectAll()
        .where("session_id", "=", input.sessionId)
        .orderBy("captured_at", "asc")
        .execute();
    }),
});
