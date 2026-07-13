-- Keep the reference-style popular sites module directly below the search hero.
UPDATE home_modules
SET sort_order = 15,
    updated_at = CURRENT_TIMESTAMP
WHERE type = 'ranking'
  AND title = '排行榜';
