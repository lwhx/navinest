-- 批次标识：后台群发通知时把同一批消息归组，便于统计已读和整批撤回。
ALTER TABLE messages ADD COLUMN batch_id TEXT;
CREATE INDEX IF NOT EXISTS idx_messages_batch ON messages(batch_id);
