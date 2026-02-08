import { z } from "zod";
import { router, publicProcedure, authenticatedProcedure } from "../trpc";
import type { SessionMetadata } from "@screenshare-guide/db";
import { nanoid } from "nanoid";
import {
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
  type SASProtocol,
} from "@azure/storage-blob";

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

/**
 * Generate an Azure Blob Storage SAS URL for uploading a recording.
 * Returns null if Azure Storage is not configured (env vars missing).
 */
function generateUploadSasUrl(
  sessionId: string
): { uploadUrl: string; blobUrl: string } | null {
  const containerName = process.env.AZURE_STORAGE_CONTAINER || "recordings";
  const blobName = `recordings/${sessionId}.webm`;

  // Try connection string first
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (connectionString) {
    try {
      const blobServiceClient =
        BlobServiceClient.fromConnectionString(connectionString);
      const containerClient =
        blobServiceClient.getContainerClient(containerName);
      const blockBlobClient = containerClient.getBlockBlobClient(blobName);

      // Extract credential from the service client for SAS generation
      // With connection string, we need to parse account name and key
      const accountName = connectionString
        .split(";")
        .find((p) => p.startsWith("AccountName="))
        ?.split("=")[1];
      const accountKey = connectionString
        .split(";")
        .find((p) => p.startsWith("AccountKey="))
        ?.split("=")
        .slice(1)
        .join("=");

      if (!accountName || !accountKey) return null;

      const sharedKeyCredential = new StorageSharedKeyCredential(
        accountName,
        accountKey
      );

      const startsOn = new Date();
      const expiresOn = new Date(startsOn.getTime() + 10 * 60 * 1000); // 10 minutes

      const sasToken = generateBlobSASQueryParameters(
        {
          containerName,
          blobName,
          permissions: BlobSASPermissions.parse("cw"), // create + write
          startsOn,
          expiresOn,
          protocol: "https" as SASProtocol,
        },
        sharedKeyCredential
      ).toString();

      return {
        uploadUrl: `${blockBlobClient.url}?${sasToken}`,
        blobUrl: blockBlobClient.url,
      };
    } catch {
      return null;
    }
  }

  // Try account name + key
  const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
  const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY;

  if (!accountName || !accountKey) return null;

  try {
    const sharedKeyCredential = new StorageSharedKeyCredential(
      accountName,
      accountKey
    );
    const blobServiceClient = new BlobServiceClient(
      `https://${accountName}.blob.core.windows.net`,
      sharedKeyCredential
    );
    const containerClient =
      blobServiceClient.getContainerClient(containerName);
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    const startsOn = new Date();
    const expiresOn = new Date(startsOn.getTime() + 10 * 60 * 1000); // 10 minutes

    const sasToken = generateBlobSASQueryParameters(
      {
        containerName,
        blobName,
        permissions: BlobSASPermissions.parse("cw"), // create + write
        startsOn,
        expiresOn,
        protocol: "https" as SASProtocol,
      },
      sharedKeyCredential
    ).toString();

    return {
      uploadUrl: `${blockBlobClient.url}?${sasToken}`,
      blobUrl: blockBlobClient.url,
    };
  } catch {
    return null;
  }
}

import { INSTAGRAM_PROOF_TEMPLATE, PROOF_TEMPLATES } from "@screenshare-guide/protocol";

export const sessionRouter = router({
  /**
   * Create a proof session for audience verification.
   * Accepts an optional platform (default "instagram").
   * Finds or creates the template, then creates a session with 24h expiry.
   */
  createProof: authenticatedProcedure
    .input(z.object({ platform: z.string().optional() }).optional())
    .mutation(async ({ ctx, input }) => {
    const platform = input?.platform ?? "instagram";
    const proofTemplate = PROOF_TEMPLATES[platform];
    if (!proofTemplate) {
      throw new Error(`Unknown platform: ${platform}`);
    }

    // Find or create the template
    let template = await ctx.db
      .selectFrom("templates")
      .selectAll()
      .where("name", "=", proofTemplate.name)
      .executeTakeFirst();

    const expectedSteps = JSON.stringify(proofTemplate.steps);

    if (!template) {
      template = await ctx.db
        .insertInto("templates")
        .values({
          name: proofTemplate.name,
          description: proofTemplate.description,
          steps: expectedSteps,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    } else {
      // Update steps if the hardcoded definition has changed
      const currentSteps = typeof template.steps === "string" ? template.steps : JSON.stringify(template.steps);
      if (currentSteps !== expectedSteps) {
        template = await ctx.db
          .updateTable("templates")
          .set({ steps: expectedSteps, updated_at: new Date() })
          .where("id", "=", template.id)
          .returningAll()
          .executeTakeFirstOrThrow();
      }
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
        description: template.description,
        completionMessage: proofTemplate.completionMessage,
        steps: typeof template.steps === "string"
          ? JSON.parse(template.steps)
          : template.steps,
      },
    };
  }),

  /**
   * Create a new session with a unique token
   */
  create: authenticatedProcedure
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
      let template = await ctx.db
        .selectFrom("templates")
        .selectAll()
        .where("id", "=", session.template_id)
        .executeTakeFirst();

      // Auto-update template if the hardcoded definition has changed
      // (mirrors the logic in createProof to keep templates fresh)
      if (template) {
        const knownTemplate = Object.values(PROOF_TEMPLATES).find(
          (t) => t.name === template!.name
        );
        if (knownTemplate) {
          const expectedSteps = JSON.stringify(knownTemplate.steps);
          const currentSteps = typeof template.steps === "string"
            ? template.steps
            : JSON.stringify(template.steps);
          if (currentSteps !== expectedSteps) {
            template = await ctx.db
              .updateTable("templates")
              .set({ steps: expectedSteps, updated_at: new Date() })
              .where("id", "=", template.id)
              .returningAll()
              .executeTakeFirstOrThrow();
          }
        }
      }

      return {
        ...session,
        template: template
          ? {
              ...template,
              steps:
                typeof template.steps === "string"
                  ? JSON.parse(template.steps)
                  : template.steps,
            }
          : undefined,
      };
    }),

  /**
   * Get session by ID (for admin/internal use)
   */
  get: authenticatedProcedure
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
        template: template
          ? {
              ...template,
              steps:
                typeof template.steps === "string"
                  ? JSON.parse(template.steps)
                  : template.steps,
            }
          : undefined,
      };
    }),

  /**
   * List all sessions (with optional filtering)
   */
  list: authenticatedProcedure
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
  update: authenticatedProcedure
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
  complete: authenticatedProcedure
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

  /**
   * Get a presigned Azure Blob Storage SAS URL for uploading a session recording.
   * Returns null if Azure Storage is not configured — recording is optional.
   */
  getUploadUrl: authenticatedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      return generateUploadSasUrl(input.sessionId);
    }),
});
