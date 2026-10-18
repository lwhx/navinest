import type { Database, DatabaseStatement } from '$lib/server/db';
import type { SiteBackup } from './site-backup';
import { jsonChunks } from './site-backup-state';
import { portableSettingsScope } from '$lib/server/runtime-settings';
export function backupWrites(
	db: Database,
	b: SiteBackup,
	replace: Set<string>
): DatabaseStatement[] {
	const result: DatabaseStatement[] = [];
	const each = (values: unknown[], sql: string, repeats = 1) => {
		for (const chunk of jsonChunks(values, 900_000))
			result.push(db.prepare(sql).bind(...Array(repeats).fill(chunk)));
	};
	each(
		b.categories,
		`INSERT INTO categories(type,name,slug,icon,description,sort_order,is_visible)
	 SELECT value->>'$.type',value->>'$.name',value->>'$.slug',value->>'$.icon',value->>'$.description',value->>'$.sortOrder',value->>'$.isVisible' FROM json_each(?) WHERE true
	 ON CONFLICT(type,slug) DO UPDATE SET name=excluded.name,icon=excluded.icon,description=excluded.description,sort_order=excluded.sort_order,is_visible=excluded.is_visible`
	);
	each(
		b.categories,
		`UPDATE categories SET parent_id=(SELECT parent.id FROM json_each(?) draft LEFT JOIN categories parent ON parent.type=draft.value->>'$.parent.type' AND parent.slug=draft.value->>'$.parent.slug' WHERE categories.type=draft.value->>'$.type' AND categories.slug=draft.value->>'$.slug')
	 WHERE EXISTS(SELECT 1 FROM json_each(?) draft WHERE categories.type=draft.value->>'$.type' AND categories.slug=draft.value->>'$.slug')`,
		2
	);
	each(
		b.tags,
		`INSERT INTO tags(type,name,slug,description) SELECT value->>'$.type',value->>'$.name',value->>'$.slug',value->>'$.description' FROM json_each(?) WHERE true ON CONFLICT(type,slug) DO UPDATE SET name=excluded.name,description=excluded.description`
	);
	each(
		b.items,
		`INSERT INTO items(type,category_id,title,slug,summary,content,status,visibility,sort_order,is_featured,published_at)
	 SELECT draft.value->>'$.type',c.id,draft.value->>'$.title',draft.value->>'$.slug',draft.value->>'$.summary',draft.value->>'$.content',draft.value->>'$.status',draft.value->>'$.visibility',draft.value->>'$.sortOrder',draft.value->>'$.isFeatured',draft.value->>'$.publishedAt'
	 FROM json_each(?) draft LEFT JOIN categories c ON c.type=draft.value->>'$.category.type' AND c.slug=draft.value->>'$.category.slug' WHERE true
	 ON CONFLICT(type,slug) DO UPDATE SET category_id=excluded.category_id,title=excluded.title,summary=excluded.summary,content=excluded.content,status=excluded.status,visibility=excluded.visibility,sort_order=excluded.sort_order,is_featured=excluded.is_featured,published_at=excluded.published_at`
	);
	for (const table of ['item_meta', 'item_tags'])
		each(
			b.items,
			`DELETE FROM ${table} WHERE item_id IN(SELECT i.id FROM json_each(?) draft JOIN items i ON i.type=draft.value->>'$.type' AND i.slug=draft.value->>'$.slug')`
		);
	each(
		b.items,
		`INSERT INTO item_meta(item_id,meta_key,meta_value) SELECT i.id,m.key,m.value FROM json_each(?) draft JOIN items i ON i.type=draft.value->>'$.type' AND i.slug=draft.value->>'$.slug' JOIN json_each(draft.value,'$.meta') m`
	);
	each(
		b.items,
		`INSERT INTO item_tags(item_id,tag_id) SELECT i.id,t.id FROM json_each(?) draft JOIN items i ON i.type=draft.value->>'$.type' AND i.slug=draft.value->>'$.slug' JOIN json_each(draft.value,'$.tags') tag JOIN tags t ON t.type=tag.value->>'$.type' AND t.slug=tag.value->>'$.slug'`
	);
	if (replace.has('homeModules')) {
		result.push(db.prepare('DELETE FROM home_modules'));
		each(
			b.homeModules.map((m) => ({ ...m, configJson: JSON.stringify(m.config) })),
			`INSERT INTO home_modules(type,title,config_json,sort_order,is_enabled) SELECT value->>'$.type',value->>'$.title',value->>'$.configJson',value->>'$.sortOrder',value->>'$.isEnabled' FROM json_each(?)`
		);
	}
	if (replace.has('searchEngines')) {
		result.push(db.prepare('DELETE FROM search_engines'));
		each(
			b.searchEngines,
			`INSERT INTO search_engines(group_key,name,key,url_template,placeholder,sort_order,is_enabled) SELECT value->>'$.groupKey',value->>'$.name',value->>'$.key',value->>'$.urlTemplate',value->>'$.placeholder',value->>'$.sortOrder',value->>'$.isEnabled' FROM json_each(?)`
		);
	}
	if (replace.has('hotSources')) {
		result.push(db.prepare('DELETE FROM hot_sources'));
		each(
			b.hotSources.map((h) => ({
				...h,
				headersJson: JSON.stringify(h.headers),
				parserJson: JSON.stringify(h.parser)
			})),
			`INSERT INTO hot_sources(name,type,url,headers_json,parser_json,cache_ttl,is_enabled,slug,description,icon,accent_color,surface_color,display_limit,layout,sort_order,show_description)
		 SELECT value->>'$.name',value->>'$.type',value->>'$.url',value->>'$.headersJson',value->>'$.parserJson',value->>'$.cacheTtl',value->>'$.isEnabled',value->>'$.slug',value->>'$.description',value->>'$.icon',value->>'$.accentColor',value->>'$.surfaceColor',value->>'$.displayLimit',value->>'$.layout',value->>'$.sortOrder',value->>'$.showDescription' FROM json_each(?)`
		);
	}
	if (replace.has('settings')) {
		result.push(db.prepare('DELETE FROM settings' + portableSettingsScope));
		each(
			Object.entries(b.settings).map(([key, value]) => ({ key, valueJson: JSON.stringify(value) })),
			`INSERT INTO settings(key,value_json) SELECT value->>'$.key',value->>'$.valueJson' FROM json_each(?)`
		);
	}
	return result;
}
