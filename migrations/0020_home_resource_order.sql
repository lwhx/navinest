-- Move only the old default ranking below recommendation/category modules.
-- Keep custom sort orders, enabled flags and module JSON untouched.
UPDATE home_modules
SET sort_order = 100, updated_at = CURRENT_TIMESTAMP
WHERE type = 'ranking' AND title = '排行榜' AND sort_order = 15;
