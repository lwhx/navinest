-- 公开分享页：用户可以选择一个自定义地址对外展示自己的自定义导航（仅展示启用中的链接）。
ALTER TABLE users ADD COLUMN share_slug TEXT;
ALTER TABLE users ADD COLUMN share_enabled INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_share_slug ON users(share_slug) WHERE share_slug IS NOT NULL;
