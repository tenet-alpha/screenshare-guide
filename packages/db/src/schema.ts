import type { ColumnType, Generated, Insertable, Selectable, Updateable } from "kysely";

// ─── JSON column types ──────────────────────────────────────────────

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

// ─── Table interfaces ───────────────────────────────────────────────

export interface TemplatesTable {
  id: Generated<string>;
  name: string;
  description: string | null;
  steps: ColumnType<TemplateStep[], string | TemplateStep[], string | TemplateStep[]>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface SessionsTable {
  id: Generated<string>;
  token: string;
  template_id: string;
  status: Generated<string>;
  current_step: Generated<number>;
  metadata: ColumnType<SessionMetadata | null, string | SessionMetadata | null, string | SessionMetadata | null>;
  used_at: Date | null;
  expires_at: Date;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface RecordingsTable {
  id: Generated<string>;
  session_id: string;
  storage_key: string;
  chunk_index: number;
  duration_ms: number | null;
  size_bytes: number | null;
  mime_type: Generated<string>;
  created_at: Generated<Date>;
}

// ─── Database interface ─────────────────────────────────────────────

export interface Database {
  templates: TemplatesTable;
  sessions: SessionsTable;
  recordings: RecordingsTable;
}

// ─── Convenience row types ──────────────────────────────────────────

export type Template = Selectable<TemplatesTable>;
export type NewTemplate = Insertable<TemplatesTable>;
export type TemplateUpdate = Updateable<TemplatesTable>;

export type Session = Selectable<SessionsTable>;
export type NewSession = Insertable<SessionsTable>;
export type SessionUpdate = Updateable<SessionsTable>;

export type Recording = Selectable<RecordingsTable>;
export type NewRecording = Insertable<RecordingsTable>;
export type RecordingUpdate = Updateable<RecordingsTable>;
