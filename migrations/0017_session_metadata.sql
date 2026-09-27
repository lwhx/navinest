PRAGMA foreign_keys = ON;

ALTER TABLE user_sessions ADD COLUMN user_agent TEXT;
ALTER TABLE user_sessions ADD COLUMN ip_address TEXT;

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_seen
ON user_sessions(user_id, last_seen_at DESC);
