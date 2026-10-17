CREATE TABLE IF NOT EXISTS ai_service_calls (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 provider_id INTEGER REFERENCES ai_providers(id) ON DELETE SET NULL,
 provider_name TEXT,
 model TEXT,
 origin TEXT NOT NULL CHECK(origin IN ('test','submission')),
 stage TEXT NOT NULL CHECK(stage IN ('configuration','webpage','generation')),
 outcome TEXT NOT NULL CHECK(outcome IN ('success','failed','skipped')),
 error_code TEXT,
 duration_ms INTEGER NOT NULL,
 ai_duration_ms INTEGER,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ai_calls_created ON ai_service_calls(created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_ai_calls_provider ON ai_service_calls(provider_id,created_at DESC,id DESC);
