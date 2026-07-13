PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS cron_runs (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	cron TEXT NOT NULL,
	scheduled_at TEXT NOT NULL,
	started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	finished_at TEXT,
	status TEXT NOT NULL DEFAULT 'running',
	total_sources INTEGER NOT NULL DEFAULT 0,
	succeeded_sources INTEGER NOT NULL DEFAULT 0,
	failed_sources INTEGER NOT NULL DEFAULT 0,
	result_json TEXT NOT NULL DEFAULT '[]',
	error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_cron_runs_started ON cron_runs(started_at DESC, id DESC);
