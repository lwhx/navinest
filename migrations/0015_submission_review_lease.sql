ALTER TABLE submissions ADD COLUMN review_token TEXT;
ALTER TABLE submissions ADD COLUMN review_started_at TEXT;
CREATE INDEX IF NOT EXISTS idx_submissions_review_lease ON submissions(status, review_started_at, review_token);
