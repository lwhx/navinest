PRAGMA foreign_keys = ON;

CREATE INDEX IF NOT EXISTS idx_messages_user_read_created
ON messages(user_id, is_read, created_at DESC, id DESC);
