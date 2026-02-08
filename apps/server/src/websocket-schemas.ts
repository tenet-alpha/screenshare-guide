import { z } from "zod";

// Max frame payload size: 2MB base64 (~1.5MB image)
const MAX_FRAME_SIZE = 2 * 1024 * 1024;

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("frame"),
    imageData: z.string().max(MAX_FRAME_SIZE, "Frame too large"),
  }),
  z.object({
    type: z.literal("linkClicked"),
    step: z.number().int().min(0).max(20),
  }),
  z.object({
    type: z.literal("audioComplete"),
  }),
  z.object({
    type: z.literal("ping"),
  }),
  z.object({
    type: z.literal("requestHint"),
  }),
  z.object({
    type: z.literal("skipStep"),
  }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;
