import { pgTable, text, timestamp, boolean, integer, jsonb, uuid } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

/**
 * Templates define reusable instruction sets for screenshare sessions.
 * Each template has a series of steps that guide users through tasks.
 */
export const templates = pgTable("templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  // Steps are stored as JSON array: [{ instruction: string, successCriteria: string }]
  steps: jsonb("steps").$type<TemplateStep[]>().notNull().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * Sessions are individual screenshare instances created from templates.
 * Each session has a unique token for URL access.
 */
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  token: text("token").notNull().unique(), // nanoid token for URL
  templateId: uuid("template_id").references(() => templates.id).notNull(),
  status: text("status", { enum: ["pending", "active", "completed", "expired"] }).notNull().default("pending"),
  currentStep: integer("current_step").notNull().default(0),
  // Metadata about the session
  metadata: jsonb("metadata").$type<SessionMetadata>(),
  // One-time use enforcement
  usedAt: timestamp("used_at"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * Recordings store chunks of screen capture data in R2.
 * Each recording belongs to a session.
 */
export const recordings = pgTable("recordings", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").references(() => sessions.id).notNull(),
  // R2 storage key for the recording chunk
  storageKey: text("storage_key").notNull(),
  // Chunk ordering
  chunkIndex: integer("chunk_index").notNull(),
  // Duration in milliseconds
  durationMs: integer("duration_ms"),
  // File size in bytes
  sizeBytes: integer("size_bytes"),
  // MIME type (video/webm, etc.)
  mimeType: text("mime_type").notNull().default("video/webm"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Frame samples for AI analysis.
 * Stores individual frames extracted from recordings for vision analysis.
 */
export const frameSamples = pgTable("frame_samples", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").references(() => sessions.id).notNull(),
  // R2 storage key for the frame image
  storageKey: text("storage_key").notNull(),
  // Timestamp within the session when frame was captured
  capturedAt: timestamp("captured_at").notNull(),
  // AI analysis result
  analysisResult: jsonb("analysis_result").$type<FrameAnalysis>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Relations
export const templatesRelations = relations(templates, ({ many }) => ({
  sessions: many(sessions),
}));

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
  template: one(templates, {
    fields: [sessions.templateId],
    references: [templates.id],
  }),
  recordings: many(recordings),
  frameSamples: many(frameSamples),
}));

export const recordingsRelations = relations(recordings, ({ one }) => ({
  session: one(sessions, {
    fields: [recordings.sessionId],
    references: [sessions.id],
  }),
}));

export const frameSamplesRelations = relations(frameSamples, ({ one }) => ({
  session: one(sessions, {
    fields: [frameSamples.sessionId],
    references: [sessions.id],
  }),
}));

// TypeScript types for JSON columns
export interface TemplateStep {
  instruction: string;
  successCriteria: string;
  hints?: string[];
}

export interface SessionMetadata {
  userAgent?: string;
  ipAddress?: string;
  completedSteps?: number[];
  totalDurationMs?: number;
}

export interface FrameAnalysis {
  description: string;
  detectedElements: string[];
  matchesSuccessCriteria: boolean;
  confidence: number;
  suggestedAction?: string;
}
