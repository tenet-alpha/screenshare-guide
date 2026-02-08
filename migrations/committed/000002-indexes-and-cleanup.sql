--! Previous: sha1:c32d1d1ce147c4b584c53bb52e3f77492da15bb4
--! Hash: sha1:772759677230bff30e4490fcf0538d0e3b8001bd
--! Message: indexes-and-cleanup

-- Add indexes for common query patterns

-- Sessions: lookup by template, filter by status, find expired
CREATE INDEX IF NOT EXISTS idx_sessions_template_id ON sessions(template_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at);

-- Recordings: lookup by session
CREATE INDEX IF NOT EXISTS idx_recordings_session_id ON recordings(session_id);

-- Frame samples: lookup by session, order by capture time
CREATE INDEX IF NOT EXISTS idx_frame_samples_session_id ON frame_samples(session_id);
CREATE INDEX IF NOT EXISTS idx_frame_samples_captured_at ON frame_samples(captured_at);

-- Templates: lookup by name (for template auto-update)
CREATE INDEX IF NOT EXISTS idx_templates_name ON templates(name);
