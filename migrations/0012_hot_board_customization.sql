ALTER TABLE hot_sources ADD COLUMN slug TEXT;
ALTER TABLE hot_sources ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE hot_sources ADD COLUMN icon TEXT NOT NULL DEFAULT '热';
ALTER TABLE hot_sources ADD COLUMN accent_color TEXT NOT NULL DEFAULT '#e5484d';
ALTER TABLE hot_sources ADD COLUMN surface_color TEXT NOT NULL DEFAULT '#fff7f7';
ALTER TABLE hot_sources ADD COLUMN display_limit INTEGER NOT NULL DEFAULT 20;
ALTER TABLE hot_sources ADD COLUMN layout TEXT NOT NULL DEFAULT 'list';
ALTER TABLE hot_sources ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hot_sources ADD COLUMN show_description INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hot_sources ADD COLUMN last_error TEXT;
ALTER TABLE hot_sources ADD COLUMN last_success_at TEXT;

UPDATE hot_sources
SET slug = 'board-' || id
WHERE slug IS NULL OR trim(slug) = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_hot_sources_slug ON hot_sources(slug);
CREATE INDEX IF NOT EXISTS idx_hot_sources_enabled_order ON hot_sources(is_enabled, sort_order, id);
