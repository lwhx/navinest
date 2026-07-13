PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS user_sessions (
	token_hash TEXT PRIMARY KEY,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	expires_at TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS login_attempts (
	attempt_key TEXT PRIMARY KEY,
	failed_count INTEGER NOT NULL DEFAULT 0,
	window_started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	locked_until TEXT,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expiry ON user_sessions(expires_at);
