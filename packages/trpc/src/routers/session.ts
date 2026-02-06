import { z } from "zod";
import { router, publicProcedure } from "../trpc";
import { sessions, templates, type SessionMetadata } from "@screenshare-guide/db";
import { eq, and, gt } from "drizzle-orm";
import { nanoid } from "nanoid";

// Default session expiry: 24 hours
const DEFAULT_EXPIRY_HOURS = 24;

const createSessionSchema = z.object({
  templateId: z.string().uuid(),
  expiryHours: z.number().min(1).max(168).optional(), // 1 hour to 1 week
  metadata: z
    .object({
      userAgent: z.string().optional(),
      ipAddress: z.string().optional(),
    })
    .optional(),
});

const updateSessionSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["pending", "active", "completed", "expired"]).optional(),
  currentStep: z.number().min(0).optional(),
  metadata: z
    .object({
      completedSteps: z.array(z.number()).optional(),
      totalDurationMs: z.number().optional(),
    })
    .optional(),
});

export const sessionRouter = router({
  /**
   * Create a new session with a unique token
   */
  create: publicProcedure
    .input(createSessionSchema)
    .mutation(async ({ ctx, input }) => {
      // Verify template exists
      const [template] = await ctx.db
        .select()
        .from(templates)
        .where(eq(templates.id, input.templateId));

      if (!template) {
        throw new Error("Template not found");
      }

      // Generate unique token (12 characters, URL-safe)
      const token = nanoid(12);

      // Calculate expiry time
      const expiryHours = input.expiryHours ?? DEFAULT_EXPIRY_HOURS;
      const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);

      const [session] = await ctx.db
        .insert(sessions)
        .values({
          token,
          templateId: input.templateId,
          expiresAt,
          metadata: input.metadata as SessionMetadata,
        })
        .returning();

      return {
        ...session,
        // Include the shareable URL path
        shareUrl: `/s/${token}`,
      };
    }),

  /**
   * Get session by token (for public access via share link)
   */
  getByToken: publicProcedure
    .input(z.object({ token: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const [session] = await ctx.db
        .select()
        .from(sessions)
        .where(eq(sessions.token, input.token));

      if (!session) {
        throw new Error("Session not found");
      }

      // Check if expired
      if (new Date() > session.expiresAt) {
        // Update status to expired if not already
        if (session.status !== "expired") {
          await ctx.db
            .update(sessions)
            .set({ status: "expired", updatedAt: new Date() })
            .where(eq(sessions.id, session.id));
        }
        throw new Error("Session has expired");
      }

      // Check if already used (one-time use)
      if (session.usedAt && session.status === "completed") {
        throw new Error("Session has already been used");
      }

      // Get template data
      const [template] = await ctx.db
        .select()
        .from(templates)
        .where(eq(templates.id, session.templateId));

      return {
        ...session,
        template,
      };
    }),

  /**
   * Get session by ID (for admin/internal use)
   */
  get: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [session] = await ctx.db
        .select()
        .from(sessions)
        .where(eq(sessions.id, input.id));

      if (!session) {
        throw new Error("Session not found");
      }

      const [template] = await ctx.db
        .select()
        .from(templates)
        .where(eq(templates.id, session.templateId));

      return {
        ...session,
        template,
      };
    }),

  /**
   * List all sessions (with optional filtering)
   */
  list: publicProcedure
    .input(
      z
        .object({
          templateId: z.string().uuid().optional(),
          status: z.enum(["pending", "active", "completed", "expired"]).optional(),
          includeExpired: z.boolean().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      let query = ctx.db.select().from(sessions);

      // Note: Drizzle doesn't chain where clauses the same way
      // For MVP, we'll fetch all and filter in JS
      const allSessions = await query.orderBy(sessions.createdAt);

      return allSessions.filter((session) => {
        if (input?.templateId && session.templateId !== input.templateId) {
          return false;
        }
        if (input?.status && session.status !== input.status) {
          return false;
        }
        if (!input?.includeExpired && session.status === "expired") {
          return false;
        }
        return true;
      });
    }),

  /**
   * Start a session (mark as active, record first use)
   */
  start: publicProcedure
    .input(z.object({ token: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [session] = await ctx.db
        .select()
        .from(sessions)
        .where(eq(sessions.token, input.token));

      if (!session) {
        throw new Error("Session not found");
      }

      if (session.status === "expired" || new Date() > session.expiresAt) {
        throw new Error("Session has expired");
      }

      if (session.usedAt) {
        throw new Error("Session has already been started");
      }

      const [updated] = await ctx.db
        .update(sessions)
        .set({
          status: "active",
          usedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(sessions.id, session.id))
        .returning();

      return updated;
    }),

  /**
   * Update session progress
   */
  update: publicProcedure
    .input(updateSessionSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, metadata: newMetadata, ...updates } = input;

      // Get existing session for metadata merge
      const [existing] = await ctx.db
        .select()
        .from(sessions)
        .where(eq(sessions.id, id));

      if (!existing) {
        throw new Error("Session not found");
      }

      // Merge metadata
      const mergedMetadata = newMetadata
        ? { ...(existing.metadata || {}), ...newMetadata }
        : existing.metadata;

      const [session] = await ctx.db
        .update(sessions)
        .set({
          ...updates,
          metadata: mergedMetadata as SessionMetadata,
          updatedAt: new Date(),
        })
        .where(eq(sessions.id, id))
        .returning();

      return session;
    }),

  /**
   * Complete a session
   */
  complete: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        totalDurationMs: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select()
        .from(sessions)
        .where(eq(sessions.id, input.id));

      if (!existing) {
        throw new Error("Session not found");
      }

      const [session] = await ctx.db
        .update(sessions)
        .set({
          status: "completed",
          metadata: {
            ...(existing.metadata || {}),
            totalDurationMs: input.totalDurationMs,
          } as SessionMetadata,
          updatedAt: new Date(),
        })
        .where(eq(sessions.id, input.id))
        .returning();

      return session;
    }),
});
