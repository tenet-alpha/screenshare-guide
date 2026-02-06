--! Previous: -
--! Hash: sha1:c32d1d1ce147c4b584c53bb52e3f77492da15bb4

-- Initial schema: creates all tables for screenshare-guide

-- gen_random_uuid() is built-in since PostgreSQL 14, no extension needed

CREATE TABLE IF NOT EXISTS templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  template_id uuid NOT NULL REFERENCES templates(id),
  status text NOT NULL DEFAULT 'pending',
  current_step integer NOT NULL DEFAULT 0,
  metadata jsonb,
  used_at timestamp,
  expires_at timestamp NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recordings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id),
  storage_key text NOT NULL,
  chunk_index integer NOT NULL,
  duration_ms integer,
  size_bytes integer,
  mime_type text NOT NULL DEFAULT 'video/webm',
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS frame_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id),
  storage_key text NOT NULL,
  captured_at timestamp NOT NULL,
  analysis_result jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);
