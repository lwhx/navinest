PRAGMA foreign_keys = ON;

CREATE INDEX IF NOT EXISTS idx_custom_categories_user_sort
ON custom_categories(user_id, sort_order, id);

CREATE INDEX IF NOT EXISTS idx_custom_links_user_sort
ON custom_links(user_id, sort_order, id);

CREATE INDEX IF NOT EXISTS idx_custom_links_user_category
ON custom_links(user_id, category_id);
