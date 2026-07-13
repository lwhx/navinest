PRAGMA foreign_keys = ON;

CREATE INDEX IF NOT EXISTS idx_submissions_user_created
ON submissions(user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_submissions_status_created
ON submissions(status, created_at ASC, id ASC);
