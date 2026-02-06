import { z } from "zod";
import { router, publicProcedure } from "../trpc";
import type { TemplateStep } from "@screenshare-guide/db";

// Validation schemas
const templateStepSchema = z.object({
  instruction: z.string().min(1),
  successCriteria: z.string().min(1),
  hints: z.array(z.string()).optional(),
});

const createTemplateSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  steps: z.array(templateStepSchema).min(1),
});

const updateTemplateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  steps: z.array(templateStepSchema).optional(),
});

export const templateRouter = router({
  /**
   * Create a new template
   */
  create: publicProcedure
    .input(createTemplateSchema)
    .mutation(async ({ ctx, input }) => {
      const template = await ctx.db
        .insertInto("templates")
        .values({
          name: input.name,
          description: input.description ?? null,
          steps: JSON.stringify(input.steps),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      return template;
    }),

  /**
   * Get all templates
   */
  list: publicProcedure.query(async ({ ctx }) => {
    return ctx.db
      .selectFrom("templates")
      .selectAll()
      .orderBy("created_at", "asc")
      .execute();
  }),

  /**
   * Get a single template by ID
   */
  get: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const template = await ctx.db
        .selectFrom("templates")
        .selectAll()
        .where("id", "=", input.id)
        .executeTakeFirst();

      if (!template) {
        throw new Error("Template not found");
      }

      return template;
    }),

  /**
   * Update a template
   */
  update: publicProcedure
    .input(updateTemplateSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;

      const set: Record<string, any> = { updated_at: new Date() };
      if (updates.name !== undefined) set.name = updates.name;
      if (updates.description !== undefined) set.description = updates.description;
      if (updates.steps !== undefined) set.steps = JSON.stringify(updates.steps);

      const template = await ctx.db
        .updateTable("templates")
        .set(set)
        .where("id", "=", id)
        .returningAll()
        .executeTakeFirst();

      if (!template) {
        throw new Error("Template not found");
      }

      return template;
    }),

  /**
   * Delete a template
   */
  delete: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const template = await ctx.db
        .deleteFrom("templates")
        .where("id", "=", input.id)
        .returningAll()
        .executeTakeFirst();

      if (!template) {
        throw new Error("Template not found");
      }

      return { success: true };
    }),
});
