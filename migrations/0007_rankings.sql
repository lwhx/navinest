PRAGMA foreign_keys = ON;

CREATE INDEX IF NOT EXISTS idx_stats_daily_date_item
ON stats_daily(date, item_id);

CREATE INDEX IF NOT EXISTS idx_stats_daily_item_date
ON stats_daily(item_id, date);
