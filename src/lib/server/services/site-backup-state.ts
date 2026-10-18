import type { Database, DatabaseStatement } from '$lib/server/db';
import type { SiteBackup } from './site-backup';
import { portableSettingsScope } from '$lib/server/runtime-settings';

// Only site configuration/content columns: runtime counters and private account data stay outside.
const specs = [
	{
		table: 'categories',
		keys: ['id'],
		columns: [
			'id',
			'type',
			'parent_id',
			'name',
			'slug',
			'icon',
			'description',
			'sort_order',
			'is_visible'
		]
	},
	{ table: 'tags', keys: ['id'], columns: ['id', 'type', 'name', 'slug', 'description'] },
	{
		table: 'items',
		keys: ['id'],
		columns: [
			'id',
			'type',
			'category_id',
			'author_id',
			'title',
			'slug',
			'summary',
			'content',
			'cover_file_id',
			'icon_file_id',
			'status',
			'visibility',
			'sort_order',
			'is_featured',
			'published_at'
		]
	},
	{
		table: 'item_meta',
		keys: ['item_id', 'meta_key'],
		columns: ['item_id', 'meta_key', 'meta_value']
	},
	{ table: 'item_tags', keys: ['item_id', 'tag_id'], columns: ['item_id', 'tag_id'] },
	{
		table: 'home_modules',
		keys: ['id'],
		columns: ['id', 'type', 'title', 'config_json', 'sort_order', 'is_enabled']
	},
	{
		table: 'search_engines',
		keys: ['id'],
		columns: [
			'id',
			'group_key',
			'name',
			'key',
			'url_template',
			'placeholder',
			'sort_order',
			'is_enabled'
		]
	},
	{
		table: 'hot_sources',
		keys: ['id'],
		columns: [
			'id',
			'name',
			'type',
			'url',
			'headers_json',
			'parser_json',
			'cache_ttl',
			'is_enabled',
			'slug',
			'description',
			'icon',
			'accent_color',
			'surface_color',
			'display_limit',
			'layout',
			'sort_order',
			'show_description'
		]
	},
	{ table: 'settings', keys: ['key'], columns: ['key', 'value_json'] }
] as const;
export type BackupState = Array<{ table: string; rows: string[] }>;
// Link diagnostics are runtime state, not portable site configuration.
const scope = (table: string) => (table === 'settings' ? portableSettingsScope : '');
export const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
// Stay below D1's per-value size; parameters, not interpolated input, carry data.
export function jsonChunks(values: unknown[], maximum = 900_000): string[] {
	const result: string[] = [];
	let chunk: string[] = [],
		size = 2;
	for (const value of values) {
		const text = JSON.stringify(value),
			length = bytes(text) + 1;
		if (length > 1_800_000) throw new Error('单条站点记录过大，无法进行在线恢复。');
		if (size + length > maximum && chunk.length) {
			result.push('[' + chunk.join(',') + ']');
			chunk = [];
			size = 2;
		}
		chunk.push(text);
		size += length;
	}
	if (chunk.length) result.push('[' + chunk.join(',') + ']');
	return result;
}
export async function readBackupState(db: Database): Promise<BackupState> {
	const state: BackupState = [];
	for (const spec of specs) {
		const rows = (
			await db
				.prepare(
					`SELECT json_array(${spec.columns.join(',')}) value FROM ${spec.table}${scope(spec.table)} ORDER BY ${spec.keys.join(',')}`
				)
				.all<{ value: string }>()
		).results;
		state.push({ table: spec.table, rows: rows.map((r) => r.value) });
	}
	return state;
}
export function stateGuards(db: Database, state: BackupState): DatabaseStatement[] {
	return specs.flatMap((spec, index) => {
		const rows = state[index].rows.map((r) => JSON.parse(r) as unknown[]);
		const chunks = jsonChunks(rows);
		return (chunks.length ? chunks : ['[]']).map((chunk) =>
			db
				.prepare(
					`SELECT CASE WHEN (SELECT COUNT(*) FROM ${spec.table}${scope(spec.table)})=?
		 AND NOT EXISTS(SELECT 1 FROM json_each(?) expected WHERE NOT EXISTS(SELECT 1 FROM ${spec.table}
		 WHERE ${spec.keys.map((k) => `${spec.table}.${k}=json_extract(expected.value,'$[${(spec.columns as readonly string[]).indexOf(k)}]')`).join(' AND ')}
		 AND json_array(${spec.columns.join(',')})=expected.value))
		 THEN 1 ELSE json('NAVINEST_BACKUP_STATE_CHANGED') END ok`
				)
				.bind(rows.length, chunk)
		);
	});
}
export async function backupDigest(value: unknown) {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableJson(value)));
	return [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, '0')).join('');
}
export function stableJson(value: unknown): string {
	if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
	if (value && typeof value === 'object')
		return (
			'{' +
			Object.keys(value)
				.sort()
				.map((k) => JSON.stringify(k) + ':' + stableJson((value as Record<string, unknown>)[k]))
				.join(',') +
			'}'
		);
	return JSON.stringify(value) ?? 'null';
}
export function portableBackup(
	state: BackupState,
	now = new Date(),
	tolerateInvalid = false
): SiteBackup {
	const data = Object.fromEntries(
		specs.map((spec, index) => [
			spec.table,
			state[index].rows.map((raw) => {
				const values = JSON.parse(raw) as unknown[];
				return Object.fromEntries(spec.columns.map((c, i) => [c, values[i]]));
			})
		])
	);
	const parse = (raw: unknown) => {
		try {
			return JSON.parse(String(raw));
		} catch {
			if (tolerateInvalid) return { $invalidStoredJson: String(raw) };
			throw new Error('现有站点配置包含损坏的 JSON。');
		}
	};
	const ref = (r: Record<string, unknown> | undefined) =>
		r ? { type: String(r.type), slug: String(r.slug) } : null;
	const category = new Map(data.categories.map((r) => [r.id, r])),
		tags = new Map(data.tags.map((r) => [r.id, r]));
	const metaByItem = new Map<unknown, Record<string, string | null>>(),
		tagsByItem = new Map<unknown, Array<{ type: string; slug: string }>>();
	for (const m of data.item_meta) {
		const record = metaByItem.get(m.item_id) ?? Object.create(null);
		record[String(m.meta_key)] = m.meta_value as string | null;
		metaByItem.set(m.item_id, record);
	}
	for (const t of data.item_tags) {
		const tag = ref(tags.get(t.tag_id));
		if (tag) {
			const values = tagsByItem.get(t.item_id) ?? [];
			values.push(tag);
			tagsByItem.set(t.item_id, values);
		}
	}
	return {
		format: 'navinest-backup',
		version: 1,
		generatedAt: now.toISOString(),
		categories: data.categories.map((r) => ({
			...ref(r)!,
			parent: ref(category.get(r.parent_id)),
			name: String(r.name),
			icon: r.icon as string | null,
			description: r.description as string | null,
			sortOrder: Number(r.sort_order),
			isVisible: r.is_visible === 1
		})),
		tags: data.tags.map((r) => ({
			...ref(r)!,
			name: String(r.name),
			description: r.description as string | null
		})),
		items: data.items.map((r) => ({
			...ref(r)!,
			title: String(r.title),
			category: ref(category.get(r.category_id)),
			summary: r.summary as string | null,
			content: r.content as string | null,
			status: String(r.status),
			visibility: String(r.visibility),
			sortOrder: Number(r.sort_order),
			isFeatured: r.is_featured === 1,
			publishedAt: r.published_at as string | null,
			tags: tagsByItem.get(r.id) ?? [],
			meta: metaByItem.get(r.id) ?? {}
		})),
		homeModules: data.home_modules.map((r) => ({
			type: String(r.type),
			title: String(r.title),
			config: parse(r.config_json),
			sortOrder: Number(r.sort_order),
			isEnabled: r.is_enabled === 1
		})),
		searchEngines: data.search_engines.map((r) => ({
			groupKey: String(r.group_key),
			name: String(r.name),
			key: String(r.key),
			urlTemplate: String(r.url_template),
			placeholder: r.placeholder as string | null,
			sortOrder: Number(r.sort_order),
			isEnabled: r.is_enabled === 1
		})),
		hotSources: data.hot_sources.map((r) => ({
			name: String(r.name),
			type: String(r.type),
			url: String(r.url),
			headers: parse(r.headers_json),
			parser: parse(r.parser_json),
			cacheTtl: Number(r.cache_ttl),
			isEnabled: r.is_enabled === 1,
			slug: r.slug == null ? undefined : String(r.slug),
			description: String(r.description ?? ''),
			icon: String(r.icon ?? '热'),
			accentColor: String(r.accent_color ?? '#e5484d'),
			surfaceColor: String(r.surface_color ?? '#fff7f7'),
			displayLimit: Number(r.display_limit ?? 20),
			layout: (r.layout ?? 'list') as 'list' | 'compact' | 'columns',
			sortOrder: Number(r.sort_order ?? 0),
			showDescription: r.show_description === 1
		})),
		settings: Object.fromEntries(data.settings.map((r) => [String(r.key), parse(r.value_json)]))
	};
}
