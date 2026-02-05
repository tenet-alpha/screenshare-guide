import { z } from "zod";
import { router, publicProcedure } from "../index";
import { templates, type TemplateStep } from "@screenshare-guide/db";
import { eq } from "drizzle-orm";

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
      const [template] = await ctx.db
        .insert(templates)
        .values({
          name: input.name,
          description: input.description,
          steps: input.steps as TemplateStep[],
        })
        .returning();

      return template;
    }),

  /**
   * Get all templates
   */
  list: publicProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(templates).orderBy(templates.createdAt);
  }),

  /**
   * Get a single template by ID
   */
  get: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [template] = await ctx.db
        .select()
        .from(templates)
        .where(eq(templates.id, input.id));

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

      const [template] = await ctx.db
        .update(templates)
        .set({
          ...updates,
          steps: updates.steps as TemplateStep[] | undefined,
          updatedAt: new Date(),
        })
        .where(eq(templates.id, id))
        .returning();

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
      const [template] = await ctx.db
        .delete(templates)
        .where(eq(templates.id, input.id))
        .returning();

      if (!template) {
        throw new Error("Template not found");
      }

      return { success: true };
    }),
});
