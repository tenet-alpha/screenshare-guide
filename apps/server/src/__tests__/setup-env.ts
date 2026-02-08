/**
 * Test environment setup.
 * Loaded via bunfig.toml preload before any test file.
 * Ensures DATABASE_URL is available for modules that check it at import time.
 */
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/screenshare";
}
