PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ai_providers (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL,
	base_url TEXT NOT NULL,
	model TEXT NOT NULL,
	api_key_ciphertext TEXT NOT NULL,
	api_key_iv TEXT NOT NULL,
	key_hint TEXT NOT NULL,
	timeout_ms INTEGER NOT NULL DEFAULT 30000,
	max_source_chars INTEGER NOT NULL DEFAULT 8000,
	system_prompt TEXT NOT NULL,
	is_enabled INTEGER NOT NULL DEFAULT 0,
	test_status TEXT NOT NULL DEFAULT 'untested',
	tested_at TEXT,
	test_error TEXT,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_providers_name ON ai_providers(name);
CREATE INDEX IF NOT EXISTS idx_ai_providers_enabled ON ai_providers(is_enabled, id);

CREATE TABLE IF NOT EXISTS ai_usage_events (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER NOT NULL,
	action TEXT NOT NULL,
	provider_id INTEGER,
	success INTEGER NOT NULL DEFAULT 0,
	error_code TEXT,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
	FOREIGN KEY (provider_id) REFERENCES ai_providers(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_user_created
ON ai_usage_events(user_id, created_at DESC, id DESC);
