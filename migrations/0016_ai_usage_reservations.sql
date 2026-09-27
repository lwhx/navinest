ALTER TABLE ai_usage_events ADD COLUMN reservation_token TEXT;
ALTER TABLE ai_usage_events ADD COLUMN status TEXT NOT NULL DEFAULT 'completed';
ALTER TABLE ai_usage_events ADD COLUMN finished_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_usage_reservation_token ON ai_usage_events(reservation_token) WHERE reservation_token IS NOT NULL;
