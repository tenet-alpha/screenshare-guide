import { z } from "zod";
import { router, publicProcedure } from "../index";
import { recordings, frameSamples, sessions, type FrameAnalysis } from "@screenshare-guide/db";
import { eq } from "drizzle-orm";

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
      const [session] = await ctx.db
        .select()
        .from(sessions)
        .where(eq(sessions.id, input.sessionId));

      if (!session) {
        throw new Error("Session not found");
      }

      const [recording] = await ctx.db
        .insert(recordings)
        .values({
          sessionId: input.sessionId,
          storageKey: input.storageKey,
          chunkIndex: input.chunkIndex,
          durationMs: input.durationMs,
          sizeBytes: input.sizeBytes,
          mimeType: input.mimeType ?? "video/webm",
        })
        .returning();

      return recording;
    }),

  /**
   * Get all recordings for a session
   */
  listBySession: publicProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(recordings)
        .where(eq(recordings.sessionId, input.sessionId))
        .orderBy(recordings.chunkIndex);
    }),

  /**
   * Create a frame sample record
   */
  createFrameSample: publicProcedure
    .input(createFrameSampleSchema)
    .mutation(async ({ ctx, input }) => {
      const [frameSample] = await ctx.db
        .insert(frameSamples)
        .values({
          sessionId: input.sessionId,
          storageKey: input.storageKey,
          capturedAt: new Date(input.capturedAt),
          analysisResult: input.analysisResult as FrameAnalysis,
        })
        .returning();

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
      const [frameSample] = await ctx.db
        .update(frameSamples)
        .set({
          analysisResult: input.analysisResult as FrameAnalysis,
        })
        .where(eq(frameSamples.id, input.id))
        .returning();

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
        .select()
        .from(frameSamples)
        .where(eq(frameSamples.sessionId, input.sessionId))
        .orderBy(frameSamples.capturedAt);
    }),
});
