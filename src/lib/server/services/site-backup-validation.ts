import type { SiteBackup } from './site-backup';
import { validateExternalTarget } from '$lib/server/safe-target';
const kinds = ['site', 'post', 'app', 'book', 'bulletin'];
export const backupKey = (r: { type: string; slug: string }) => r.type + ':' + r.slug;
export function validateSiteBackup(
	value: unknown
): { valid: true; data: SiteBackup } | { valid: false; errors: string[] } {
	const errors: string[] = [];
	const issue = (path: string, text: string) => {
		if (errors.length < 100) errors.push(`${path}：${text}`);
	};
	const object = (v: unknown): v is Record<string, unknown> =>
		!!v && typeof v === 'object' && !Array.isArray(v);
	if (!object(value)) return { valid: false, errors: ['备份必须是 JSON 对象。'] };
	if (value.format !== 'navinest-backup' || value.version !== 1)
		issue('备份', '格式或版本不受支持');
	for (const field of ['categories', 'tags', 'items', 'homeModules', 'searchEngines', 'hotSources'])
		if (!Array.isArray(value[field])) issue(field, '必须是数组');
	if (!object(value.settings)) issue('settings', '必须是对象');
	if (errors.length) return { valid: false, errors };
	function text(v: unknown, path: string, nullable = false, fallback?: string) {
		if (v === undefined && fallback !== undefined) return fallback;
		if (nullable && v == null) return null;
		if (typeof v !== 'string' || (!nullable && !v.trim())) {
			issue(path, nullable ? '必须是字符串或 null' : '必须是非空字符串');
			return nullable ? null : '';
		}
		return v;
	}
	function number(v: unknown, path: string, fallback = 0) {
		if (v === undefined) return fallback;
		if (!Number.isSafeInteger(v)) {
			issue(path, '必须是整数');
			return fallback;
		}
		return v as number;
	}
	function bool(v: unknown, path: string, fallback = true) {
		if (v === undefined) return fallback;
		if (typeof v !== 'boolean') {
			issue(path, '必须是布尔值');
			return fallback;
		}
		return v;
	}
	function ref(v: unknown, path: string) {
		if (!object(v)) {
			issue(path, '必须包含 type 和 slug');
			return { type: '', slug: '' };
		}
		const type = text(v.type, path + '.type')!,
			slug = text(v.slug, path + '.slug')!;
		if (!kinds.includes(type)) issue(path + '.type', '内容类型无效');
		return { type, slug };
	}
	function dict(v: unknown, path: string, strings = false) {
		if (!object(v)) {
			issue(path, '必须是 JSON 对象');
			return {};
		}
		if (strings)
			for (const [k, x] of Object.entries(v))
				if (typeof x !== 'string') issue(path + '.' + k, '必须是字符串');
		return v;
	}
	function list(
		name: string,
		map: (r: Record<string, unknown>, path: string, index: number) => unknown
	) {
		return (value as Record<string, unknown[]>)[name].flatMap((r, i) => {
			const path = `${name}[${i + 1}]`;
			if (!object(r)) {
				issue(path, '必须是对象');
				return [];
			}
			return [map(r, path, i)];
		});
	}
	const categories = list('categories', (r, p) => ({
		...ref(r, p),
		name: text(r.name, p + '.name'),
		parent: r.parent == null ? null : ref(r.parent, p + '.parent'),
		icon: text(r.icon, p + '.icon', true),
		description: text(r.description, p + '.description', true),
		sortOrder: number(r.sortOrder, p + '.sortOrder'),
		isVisible: bool(r.isVisible, p + '.isVisible')
	}));
	const tags = list('tags', (r, p) => ({
		...ref(r, p),
		name: text(r.name, p + '.name'),
		description: text(r.description, p + '.description', true)
	}));
	const items = list('items', (r, p) => {
		const meta = dict(r.meta ?? {}, p + '.meta');
		for (const [k, v] of Object.entries(meta))
			if (typeof v !== 'string' && v !== null) issue(p + '.meta.' + k, '必须是字符串或 null');
		const itemTags = r.tags ?? [];
		if (!Array.isArray(itemTags)) issue(p + '.tags', '必须是数组');
		const status = text(r.status, p + '.status', false, 'published'),
			visibility = text(r.visibility, p + '.visibility', false, 'public');
		if (!['draft', 'published', 'archived', 'pending'].includes(status!))
			issue(p + '.status', '内容状态无效');
		if (!['public', 'private', 'unlisted'].includes(visibility!))
			issue(p + '.visibility', '可见性无效');
		return {
			...ref(r, p),
			title: text(r.title, p + '.title'),
			category: r.category == null ? null : ref(r.category, p + '.category'),
			summary: text(r.summary, p + '.summary', true),
			content: text(r.content, p + '.content', true),
			status,
			visibility,
			sortOrder: number(r.sortOrder, p + '.sortOrder'),
			isFeatured: bool(r.isFeatured, p + '.isFeatured', false),
			publishedAt: text(r.publishedAt, p + '.publishedAt', true),
			tags: Array.isArray(itemTags) ? itemTags.map((t, i) => ref(t, `${p}.tags[${i + 1}]`)) : [],
			meta
		};
	});
	const homeModules = list('homeModules', (r, p) => ({
		type: text(r.type, p + '.type'),
		title: text(r.title, p + '.title'),
		config: dict(r.config ?? {}, p + '.config'),
		sortOrder: number(r.sortOrder, p + '.sortOrder'),
		isEnabled: bool(r.isEnabled, p + '.isEnabled')
	}));
	const searchEngines = list('searchEngines', (r, p) => {
		const template = text(r.urlTemplate, p + '.urlTemplate')!;
		if (
			template &&
			template !== '/search?q={query}' &&
			!validateExternalTarget(template.replaceAll('{query}', 'test').replaceAll('%s', 'test')).valid
		)
			issue(p + '.urlTemplate', '必须是站内 /search?q={query} 或有效的公网 HTTP/HTTPS 地址模板');
		return {
			groupKey: text(r.groupKey, p + '.groupKey'),
			name: text(r.name, p + '.name'),
			key: text(r.key, p + '.key'),
			urlTemplate: template,
			placeholder: text(r.placeholder, p + '.placeholder', true),
			sortOrder: number(r.sortOrder, p + '.sortOrder'),
			isEnabled: bool(r.isEnabled, p + '.isEnabled')
		};
	});
	const hotSources = list('hotSources', (r, p, index) => {
		const type = text(r.type, p + '.type')!,
			url = text(r.url, p + '.url')!,
			slug = text(r.slug, p + '.slug', false, `board-${index + 1}`)!;
		if (!['json', 'rss', 'html'].includes(type)) issue(p + '.type', '只支持 JSON、RSS 和 HTML');
		if (!validateExternalTarget(url).valid) issue(p + '.url', '必须是安全公网 URL');
		if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) issue(p + '.slug', '标识无效');
		const headers = dict(r.headers ?? {}, p + '.headers', true),
			parser = dict(r.parser ?? {}, p + '.parser', true);
		for (const key of Object.keys(headers))
			if (
				['authorization', 'cookie', 'proxy-authorization', 'x-api-key'].includes(key.toLowerCase())
			)
				issue(p + '.headers', '请求头不能包含凭据');
		const accentColor = text(r.accentColor, p + '.accentColor', false, '#e5484d')!,
			surfaceColor = text(r.surfaceColor, p + '.surfaceColor', false, '#fff7f7')!;
		if (!/^#[0-9a-f]{6}$/i.test(accentColor) || !/^#[0-9a-f]{6}$/i.test(surfaceColor))
			issue(p, '颜色必须为 #RRGGBB');
		const layout = text(r.layout, p + '.layout', false, 'list');
		if (!['list', 'compact', 'columns'].includes(layout!)) issue(p + '.layout', '布局无效');
		const cacheTtl = number(r.cacheTtl, p + '.cacheTtl', 900),
			displayLimit = number(r.displayLimit, p + '.displayLimit', 20);
		if (cacheTtl < 60 || cacheTtl > 86400) issue(p + '.cacheTtl', '必须为 60 到 86400 秒');
		if (displayLimit < 5 || displayLimit > 50) issue(p + '.displayLimit', '必须为 5 到 50');
		return {
			name: text(r.name, p + '.name'),
			type,
			url,
			headers,
			parser,
			cacheTtl,
			isEnabled: bool(r.isEnabled, p + '.isEnabled'),
			slug,
			description: text(r.description, p + '.description', true) ?? '',
			icon: text(r.icon, p + '.icon', false, '热'),
			accentColor,
			surfaceColor,
			displayLimit,
			layout,
			sortOrder: number(r.sortOrder, p + '.sortOrder'),
			showDescription: bool(r.showDescription, p + '.showDescription', false)
		};
	});
	// Every malformed record was reported before building reference maps.
	if (errors.length) return { valid: false, errors };
	const data = {
		format: 'navinest-backup',
		version: 1,
		generatedAt: typeof value.generatedAt === 'string' ? value.generatedAt : undefined,
		categories,
		tags,
		items,
		homeModules,
		searchEngines,
		hotSources,
		settings: value.settings
	} as SiteBackup;
	function unique<T>(values: T[], key: (v: T) => string, path: string) {
		const seen = new Set<string>();
		for (const row of values) {
			const k = key(row);
			if (seen.has(k)) issue(path, `自然键重复：${k}`);
			seen.add(k);
		}
		return seen;
	}
	const cs = unique(data.categories, backupKey, 'categories'),
		ts = unique(data.tags, backupKey, 'tags');
	unique(data.items, backupKey, 'items');
	unique(data.searchEngines, (r) => r.key, 'searchEngines');
	unique(data.hotSources, (r) => r.slug!, 'hotSources');
	const parents = new Map(
		data.categories.map((c) => [backupKey(c), c.parent ? backupKey(c.parent) : null])
	);
	const visited = new Set<string>();
	for (const c of data.categories) {
		if (c.parent && (!cs.has(backupKey(c.parent)) || c.parent.type !== c.type))
			issue('categories ' + backupKey(c), '父分类不存在或类型不一致');
		const seen = new Set<string>();
		let k: string | null = backupKey(c);
		while (k !== null && parents.has(k) && !visited.has(k)) {
			if (seen.has(k)) {
				issue('categories ' + backupKey(c), '父分类形成循环');
				break;
			}
			seen.add(k);
			k = parents.get(k) ?? null;
		}
		for (const key of seen) visited.add(key);
	}
	for (const item of data.items) {
		if (item.category && (!cs.has(backupKey(item.category)) || item.category.type !== item.type))
			issue('items ' + backupKey(item), '分类不存在或类型不一致');
		unique(item.tags, backupKey, 'items ' + backupKey(item) + '.tags');
		for (const tag of item.tags)
			if (!ts.has(backupKey(tag)) || tag.type !== item.type)
				issue('items ' + backupKey(item), '标签不存在或类型不一致');
	}
	return errors.length ? { valid: false, errors } : { valid: true, data };
}
