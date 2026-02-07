import { z } from "zod";
import { router, publicProcedure } from "../trpc";
import type { SessionMetadata } from "@screenshare-guide/db";
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

// Hardcoded Instagram Audience Proof template
const INSTAGRAM_PROOF_TEMPLATE = {
  name: "Instagram Audience Proof",
  description: "Verify Instagram audience metrics via live screen analysis",
  steps: [
    {
      instruction: "Open your Meta Business Suite",
      successCriteria:
        "Meta Business Suite home page is visible. Extract the Instagram handle/username shown on the page.",
      hints: [],
    },
    {
      instruction: "Navigate to Insights",
      successCriteria:
        "The Insights page is visible showing engagement and reach metrics.",
      hints: [],
    },
    {
      instruction: "Capture audience metrics",
      successCriteria:
        "Extract the Reach number, Non-followers count, and Followers count from the Insights page. All three metrics must be found.",
      hints: [],
    },
  ],
};

export const sessionRouter = router({
  /**
   * Create a proof session for Instagram audience verification.
   * Finds or creates the hardcoded template, then creates a session with 24h expiry.
   */
  createProof: publicProcedure.mutation(async ({ ctx }) => {
    // Find or create the hardcoded template
    let template = await ctx.db
      .selectFrom("templates")
      .selectAll()
      .where("name", "=", INSTAGRAM_PROOF_TEMPLATE.name)
      .executeTakeFirst();

    if (!template) {
      template = await ctx.db
        .insertInto("templates")
        .values({
          name: INSTAGRAM_PROOF_TEMPLATE.name,
          description: INSTAGRAM_PROOF_TEMPLATE.description,
          steps: JSON.stringify(INSTAGRAM_PROOF_TEMPLATE.steps),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    }

    const token = nanoid(12);
    const expiresAt = new Date(Date.now() + DEFAULT_EXPIRY_HOURS * 60 * 60 * 1000);

    const session = await ctx.db
      .insertInto("sessions")
      .values({
        token,
        template_id: template.id,
        expires_at: expiresAt,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return {
      shareUrl: `/s/${token}`,
      token,
      sessionId: session.id,
      template: {
        id: template.id,
        name: template.name,
        steps: typeof template.steps === "string"
          ? JSON.parse(template.steps)
          : template.steps,
      },
    };
  }),

  /**
   * Create a new session with a unique token
   */
  create: publicProcedure
    .input(createSessionSchema)
    .mutation(async ({ ctx, input }) => {
      // Verify template exists
      const template = await ctx.db
        .selectFrom("templates")
        .selectAll()
        .where("id", "=", input.templateId)
        .executeTakeFirst();

      if (!template) {
        throw new Error("Template not found");
      }

      // Generate unique token (12 characters, URL-safe)
      const token = nanoid(12);

      // Calculate expiry time
      const expiryHours = input.expiryHours ?? DEFAULT_EXPIRY_HOURS;
      const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);

      const session = await ctx.db
        .insertInto("sessions")
        .values({
          token,
          template_id: input.templateId,
          expires_at: expiresAt,
          metadata: input.metadata ? JSON.stringify(input.metadata) : null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

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
      const session = await ctx.db
        .selectFrom("sessions")
        .selectAll()
        .where("token", "=", input.token)
        .executeTakeFirst();

      if (!session) {
        throw new Error("Session not found");
      }

      // Check if expired
      if (new Date() > session.expires_at) {
        // Update status to expired if not already
        if (session.status !== "expired") {
          await ctx.db
            .updateTable("sessions")
            .set({ status: "expired", updated_at: new Date() })
            .where("id", "=", session.id)
            .execute();
        }
        throw new Error("Session has expired");
      }

      // Check if already used (one-time use)
      if (session.used_at && session.status === "completed") {
        throw new Error("Session has already been used");
      }

      // Get template data
      const template = await ctx.db
        .selectFrom("templates")
        .selectAll()
        .where("id", "=", session.template_id)
        .executeTakeFirst();

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
      const session = await ctx.db
        .selectFrom("sessions")
        .selectAll()
        .where("id", "=", input.id)
        .executeTakeFirst();

      if (!session) {
        throw new Error("Session not found");
      }

      const template = await ctx.db
        .selectFrom("templates")
        .selectAll()
        .where("id", "=", session.template_id)
        .executeTakeFirst();

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
      let query = ctx.db
        .selectFrom("sessions")
        .selectAll()
        .orderBy("created_at", "asc");

      if (input?.templateId) {
        query = query.where("template_id", "=", input.templateId);
      }
      if (input?.status) {
        query = query.where("status", "=", input.status);
      }
      if (!input?.includeExpired) {
        query = query.where("status", "!=", "expired");
      }

      return query.execute();
    }),

  /**
   * Start a session (mark as active, record first use)
   */
  start: publicProcedure
    .input(z.object({ token: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const session = await ctx.db
        .selectFrom("sessions")
        .selectAll()
        .where("token", "=", input.token)
        .executeTakeFirst();

      if (!session) {
        throw new Error("Session not found");
      }

      if (session.status === "expired" || new Date() > session.expires_at) {
        throw new Error("Session has expired");
      }

      if (session.used_at) {
        throw new Error("Session has already been started");
      }

      const updated = await ctx.db
        .updateTable("sessions")
        .set({
          status: "active",
          used_at: new Date(),
          updated_at: new Date(),
        })
        .where("id", "=", session.id)
        .returningAll()
        .executeTakeFirstOrThrow();

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
      const existing = await ctx.db
        .selectFrom("sessions")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();

      if (!existing) {
        throw new Error("Session not found");
      }

      // Merge metadata
      const mergedMetadata = newMetadata
        ? { ...(existing.metadata || {}), ...newMetadata }
        : existing.metadata;

      const set: Record<string, any> = { updated_at: new Date() };
      if (updates.status !== undefined) set.status = updates.status;
      if (updates.currentStep !== undefined) set.current_step = updates.currentStep;
      set.metadata = mergedMetadata ? JSON.stringify(mergedMetadata) : null;

      const session = await ctx.db
        .updateTable("sessions")
        .set(set)
        .where("id", "=", id)
        .returningAll()
        .executeTakeFirstOrThrow();

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
      const existing = await ctx.db
        .selectFrom("sessions")
        .selectAll()
        .where("id", "=", input.id)
        .executeTakeFirst();

      if (!existing) {
        throw new Error("Session not found");
      }

      const mergedMetadata = {
        ...(existing.metadata || {}),
        totalDurationMs: input.totalDurationMs,
      } as SessionMetadata;

      const session = await ctx.db
        .updateTable("sessions")
        .set({
          status: "completed",
          metadata: JSON.stringify(mergedMetadata),
          updated_at: new Date(),
        })
        .where("id", "=", input.id)
        .returningAll()
        .executeTakeFirstOrThrow();

      return session;
    }),
});
