PRAGMA foreign_keys = ON;

DELETE FROM footprints
WHERE id NOT IN (
	SELECT MAX(id)
	FROM footprints
	GROUP BY user_id, item_id
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_footprints_user_item
ON footprints(user_id, item_id);

CREATE INDEX IF NOT EXISTS idx_footprints_user_visited
ON footprints(user_id, visited_at DESC);

CREATE INDEX IF NOT EXISTS idx_favorites_user_created
ON favorites(user_id, created_at DESC);
