ALTER TABLE hot_sources ADD COLUMN refresh_token TEXT;
ALTER TABLE hot_sources ADD COLUMN refresh_started_at TEXT;
CREATE INDEX IF NOT EXISTS idx_hot_sources_refresh_lease ON hot_sources(refresh_token, refresh_started_at);
