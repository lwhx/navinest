import type { Database, DatabaseStatement } from '$lib/server/db';
import { validateExternalTarget } from '$lib/server/safe-target';

type Ref = { type: string; slug: string };
type Category = Ref & {
	parent: Ref | null;
	name: string;
	icon: string | null;
	description: string | null;
	sortOrder: number;
	isVisible: boolean;
};
type Tag = Ref & { name: string; description: string | null };
type Item = Ref & {
	title: string;
	category: Ref | null;
	summary: string | null;
	content: string | null;
	status: string;
	visibility: string;
	sortOrder: number;
	isFeatured: boolean;
	publishedAt: string | null;
	tags: Ref[];
	meta: Record<string, string | null>;
};
export type SiteBackup = {
	format: 'navinest-backup';
	version: 1;
	generatedAt?: string;
	categories: Category[];
	tags: Tag[];
	items: Item[];
	homeModules: Array<{
		type: string;
		title: string;
		config: Record<string, unknown>;
		sortOrder: number;
		isEnabled: boolean;
	}>;
	searchEngines: Array<{
		groupKey: string;
		name: string;
		key: string;
		urlTemplate: string;
		placeholder: string | null;
		sortOrder: number;
		isEnabled: boolean;
	}>;
	hotSources: Array<{
		name: string;
		type: string;
		url: string;
		headers: Record<string, string>;
		parser: Record<string, string>;
		cacheTtl: number;
		isEnabled: boolean;
	}>;
	settings: Record<string, unknown>;
};
type Row = Record<string, unknown>;
const key = (r: Ref) => `${r.type}:${r.slug}`;
async function rows(db: Database, sql: string) {
	return (await db.prepare(sql).all<Row>()).results;
}
export async function exportSiteBackup(db: Database, now = new Date()): Promise<SiteBackup> {
	const [cr, tr, ir, mr, rr, hr, sr, xr] = await Promise.all([
		rows(
			db,
			`SELECT c.*,p.type parent_type,p.slug parent_slug FROM categories c LEFT JOIN categories p ON p.id=c.parent_id ORDER BY c.id`
		),
		rows(db, 'SELECT * FROM tags ORDER BY id'),
		rows(
			db,
			`SELECT i.*,c.type category_type,c.slug category_slug FROM items i LEFT JOIN categories c ON c.id=i.category_id ORDER BY i.id`
		),
		rows(
			db,
			'SELECT im.*,i.type item_type,i.slug item_slug FROM item_meta im JOIN items i ON i.id=im.item_id'
		),
		rows(
			db,
			'SELECT i.type item_type,i.slug item_slug,t.type tag_type,t.slug tag_slug FROM item_tags r JOIN items i ON i.id=r.item_id JOIN tags t ON t.id=r.tag_id'
		),
		rows(db, 'SELECT * FROM home_modules ORDER BY id'),
		rows(db, 'SELECT * FROM search_engines ORDER BY id'),
		rows(db, 'SELECT * FROM hot_sources ORDER BY id')
	]);
	const settingsRows = await rows(db, 'SELECT key,value_json FROM settings ORDER BY key');
	const meta = new Map<string, Record<string, string | null>>(),
		tags = new Map<string, Ref[]>();
	for (const r of mr) {
		const k = `${r.item_type}:${r.item_slug}`,
			v = meta.get(k) ?? {};
		v[String(r.meta_key)] = r.meta_value === null ? null : String(r.meta_value);
		meta.set(k, v);
	}
	for (const r of rr) {
		const k = `${r.item_type}:${r.item_slug}`,
			v = tags.get(k) ?? [];
		v.push({ type: String(r.tag_type), slug: String(r.tag_slug) });
		tags.set(k, v);
	}
	return {
		format: 'navinest-backup',
		version: 1,
		generatedAt: now.toISOString(),
		categories: cr.map((r) => ({
			type: String(r.type),
			slug: String(r.slug),
			parent: r.parent_slug ? { type: String(r.parent_type), slug: String(r.parent_slug) } : null,
			name: String(r.name),
			icon: r.icon === null ? null : String(r.icon),
			description: r.description === null ? null : String(r.description),
			sortOrder: Number(r.sort_order),
			isVisible: Number(r.is_visible) === 1
		})),
		tags: tr.map((r) => ({
			type: String(r.type),
			slug: String(r.slug),
			name: String(r.name),
			description: r.description === null ? null : String(r.description)
		})),
		items: ir.map((r) => {
			const ref = { type: String(r.type), slug: String(r.slug) },
				k = key(ref);
			return {
				...ref,
				title: String(r.title),
				category: r.category_slug
					? { type: String(r.category_type), slug: String(r.category_slug) }
					: null,
				summary: r.summary === null ? null : String(r.summary),
				content: r.content === null ? null : String(r.content),
				status: String(r.status),
				visibility: String(r.visibility),
				sortOrder: Number(r.sort_order),
				isFeatured: Number(r.is_featured) === 1,
				publishedAt: r.published_at === null ? null : String(r.published_at),
				tags: tags.get(k) ?? [],
				meta: meta.get(k) ?? {}
			};
		}),
		homeModules: hr.map((r) => ({
			type: String(r.type),
			title: String(r.title),
			config: JSON.parse(String(r.config_json)),
			sortOrder: Number(r.sort_order),
			isEnabled: Number(r.is_enabled) === 1
		})),
		searchEngines: sr.map((r) => ({
			groupKey: String(r.group_key),
			name: String(r.name),
			key: String(r.key),
			urlTemplate: String(r.url_template),
			placeholder: r.placeholder === null ? null : String(r.placeholder),
			sortOrder: Number(r.sort_order),
			isEnabled: Number(r.is_enabled) === 1
		})),
		hotSources: xr.map((r) => ({
			name: String(r.name),
			type: String(r.type),
			url: String(r.url),
			headers: JSON.parse(String(r.headers_json)),
			parser: JSON.parse(String(r.parser_json)),
			cacheTtl: Number(r.cache_ttl),
			isEnabled: Number(r.is_enabled) === 1
		})),
		settings: Object.fromEntries(
			settingsRows.map((r) => [String(r.key), JSON.parse(String(r.value_json))])
		)
	};
}
export function validateSiteBackup(
	value: unknown
): { valid: true; data: SiteBackup } | { valid: false; errors: string[] } {
	const errors: string[] = [];
	if (!value || typeof value !== 'object' || Array.isArray(value))
		return { valid: false, errors: ['备份必须是 JSON 对象。'] };
	const b = value as Partial<SiteBackup>;
	if (b.format !== 'navinest-backup' || b.version !== 1) errors.push('备份格式或版本不受支持。');
	for (const name of [
		'categories',
		'tags',
		'items',
		'homeModules',
		'searchEngines',
		'hotSources'
	] as const)
		if (!Array.isArray(b[name])) errors.push(`${name} 必须是数组。`);
	if (!b.settings || typeof b.settings !== 'object' || Array.isArray(b.settings))
		errors.push('settings 必须是对象。');
	if (errors.length) return { valid: false, errors };
	const data = b as SiteBackup,
		cs = new Set(data.categories.map(key)),
		ts = new Set(data.tags.map(key));
	const duplicateKeys = (values: Ref[], label: string) => {
		const seen = new Set<string>();
		for (const value of values) {
			if (
				!value ||
				typeof value.type !== 'string' ||
				typeof value.slug !== 'string' ||
				!value.type.trim() ||
				!value.slug.trim()
			) {
				errors.push(`${label}包含无效的 type 或 slug。`);
				continue;
			}
			const naturalKey = key(value);
			if (seen.has(naturalKey)) errors.push(`${label}自然键重复：${naturalKey}`);
			seen.add(naturalKey);
		}
	};
	duplicateKeys(data.categories, '分类');
	duplicateKeys(data.tags, '标签');
	duplicateKeys(data.items, '内容');
	const searchKeys = new Set<string>();
	for (const engine of data.searchEngines) {
		if (!engine || typeof engine.key !== 'string' || !engine.key.trim())
			errors.push('搜索源包含无效 key。');
		else if (searchKeys.has(engine.key)) errors.push(`搜索源 key 重复：${engine.key}`);
		else searchKeys.add(engine.key);
	}
	for (const source of data.hotSources) {
		if (!source || typeof source.url !== 'string' || !validateExternalTarget(source.url).valid)
			errors.push(`热榜源必须使用安全公网 URL：${source?.name ?? '未知来源'}`);
		if (source?.type !== 'json' && source?.type !== 'rss')
			errors.push(`热榜源类型无效：${source?.type}`);
	}
	for (const c of data.categories)
		if (c.parent && !cs.has(key(c.parent))) errors.push(`父分类不存在：${key(c.parent)}`);
	for (const i of data.items) {
		if (i.category && !cs.has(key(i.category))) errors.push(`内容分类不存在：${key(i.category)}`);
		for (const t of i.tags) if (!ts.has(key(t))) errors.push(`内容标签不存在：${key(t)}`);
	}
	return errors.length ? { valid: false, errors } : { valid: true, data };
}
export async function restoreSiteBackup(db: Database, input: unknown) {
	const checked = validateSiteBackup(input);
	if (!checked.valid) throw new Error(checked.errors.join('\n'));
	const b = checked.data,
		s: DatabaseStatement[] = [];
	for (const sql of [
		'DELETE FROM home_modules',
		'DELETE FROM search_engines',
		'DELETE FROM hot_sources',
		'DELETE FROM settings'
	])
		s.push(db.prepare(sql));
	for (const c of b.categories)
		s.push(
			db
				.prepare(
					'INSERT INTO categories(type,name,slug,icon,description,sort_order,is_visible) VALUES(?,?,?,?,?,?,?) ON CONFLICT(type,slug) DO UPDATE SET name=excluded.name,icon=excluded.icon,description=excluded.description,sort_order=excluded.sort_order,is_visible=excluded.is_visible'
				)
				.bind(c.type, c.name, c.slug, c.icon, c.description, c.sortOrder, c.isVisible ? 1 : 0)
		);
	for (const c of b.categories)
		if (c.parent)
			s.push(
				db
					.prepare(
						'UPDATE categories SET parent_id=(SELECT id FROM categories WHERE type=? AND slug=?) WHERE type=? AND slug=?'
					)
					.bind(c.parent.type, c.parent.slug, c.type, c.slug)
			);
	for (const t of b.tags)
		s.push(
			db
				.prepare(
					'INSERT INTO tags(type,name,slug,description) VALUES(?,?,?,?) ON CONFLICT(type,slug) DO UPDATE SET name=excluded.name,description=excluded.description'
				)
				.bind(t.type, t.name, t.slug, t.description)
		);
	for (const i of b.items) {
		s.push(
			db
				.prepare(
					'INSERT INTO items(type,category_id,title,slug,summary,content,status,visibility,sort_order,is_featured,published_at) VALUES(?,(SELECT id FROM categories WHERE type=? AND slug=?),?,?,?,?,?,?,?,?,?) ON CONFLICT(type,slug) DO UPDATE SET category_id=excluded.category_id,title=excluded.title,summary=excluded.summary,content=excluded.content,status=excluded.status,visibility=excluded.visibility,sort_order=excluded.sort_order,is_featured=excluded.is_featured,published_at=excluded.published_at'
				)
				.bind(
					i.type,
					i.category?.type ?? '',
					i.category?.slug ?? '',
					i.title,
					i.slug,
					i.summary,
					i.content,
					i.status,
					i.visibility,
					i.sortOrder,
					i.isFeatured ? 1 : 0,
					i.publishedAt
				)
		);
		s.push(
			db
				.prepare(
					'DELETE FROM item_meta WHERE item_id=(SELECT id FROM items WHERE type=? AND slug=?)'
				)
				.bind(i.type, i.slug),
			db
				.prepare(
					'DELETE FROM item_tags WHERE item_id=(SELECT id FROM items WHERE type=? AND slug=?)'
				)
				.bind(i.type, i.slug)
		);
		for (const [mk, mv] of Object.entries(i.meta))
			s.push(
				db
					.prepare(
						'INSERT INTO item_meta(item_id,meta_key,meta_value) VALUES((SELECT id FROM items WHERE type=? AND slug=?),?,?)'
					)
					.bind(i.type, i.slug, mk, mv)
			);
		for (const t of i.tags)
			s.push(
				db
					.prepare(
						'INSERT INTO item_tags(item_id,tag_id) VALUES((SELECT id FROM items WHERE type=? AND slug=?),(SELECT id FROM tags WHERE type=? AND slug=?))'
					)
					.bind(i.type, i.slug, t.type, t.slug)
			);
	}
	for (const m of b.homeModules)
		s.push(
			db
				.prepare(
					'INSERT INTO home_modules(type,title,config_json,sort_order,is_enabled) VALUES(?,?,?,?,?)'
				)
				.bind(m.type, m.title, JSON.stringify(m.config), m.sortOrder, m.isEnabled ? 1 : 0)
		);
	for (const e of b.searchEngines)
		s.push(
			db
				.prepare(
					'INSERT INTO search_engines(group_key,name,key,url_template,placeholder,sort_order,is_enabled) VALUES(?,?,?,?,?,?,?)'
				)
				.bind(
					e.groupKey,
					e.name,
					e.key,
					e.urlTemplate,
					e.placeholder,
					e.sortOrder,
					e.isEnabled ? 1 : 0
				)
		);
	for (const h of b.hotSources)
		s.push(
			db
				.prepare(
					'INSERT INTO hot_sources(name,type,url,headers_json,parser_json,cache_ttl,is_enabled) VALUES(?,?,?,?,?,?,?)'
				)
				.bind(
					h.name,
					h.type,
					h.url,
					JSON.stringify(h.headers),
					JSON.stringify(h.parser),
					h.cacheTtl,
					h.isEnabled ? 1 : 0
				)
		);
	for (const [k, v] of Object.entries(b.settings))
		s.push(
			db.prepare('INSERT INTO settings(key,value_json) VALUES(?,?)').bind(k, JSON.stringify(v))
		);
	const batch = (db as Database & { batch?: (x: DatabaseStatement[]) => Promise<unknown> }).batch;
	if (!batch) throw new Error('数据库不支持原子恢复。');
	await batch.call(db, s);
	return { categories: b.categories.length, tags: b.tags.length, items: b.items.length };
}
