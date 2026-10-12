import {
	categories as fallbackCategories,
	navigationItems as fallbackItems
} from '$lib/data/navigation';
import type { Database } from '$lib/server/db';
import { listCategories } from '$lib/server/services/categories';
import { listSearchEngines } from '$lib/server/services/search-engines';
import { buildCategoryWorkbench } from '$lib/server/services/category-workbench';
import { loadAdminContentSummary } from '$lib/server/services/admin-content';

import { listTags } from '$lib/server/services/tags';
import type { HomeModule } from '$lib/types/content';

export type AdminDataSource = 'database' | 'fallback';

async function tableCount(database: Database, table: string): Promise<number> {
	const allowedTables = new Set(['items', 'categories', 'tags', 'users', 'submissions']);
	if (!allowedTables.has(table)) throw new Error('Unsupported overview table.');

	const { results } = await database
		.prepare(`SELECT COUNT(*) AS count FROM ${table}`)
		.all<{ count: number }>();
	return results[0]?.count ?? 0;
}

export async function loadAdminOverview(database: Database) {
	const [items, categories, tags, users, pending, summary, recent] = await Promise.all([
		tableCount(database, 'items'),
		tableCount(database, 'categories'),
		tableCount(database, 'tags'),
		tableCount(database, 'users'),
		database
			.prepare("SELECT COUNT(*) AS count FROM submissions WHERE status = 'pending'")
			.all<{ count: number }>(),
		loadAdminContentSummary(database),
		database
			.prepare(
				'SELECT id, title, type, status, visibility, updated_at FROM items ORDER BY updated_at DESC, id DESC LIMIT 6'
			)
			.all<{
				id: number;
				title: string;
				type: string;
				status: string;
				visibility: string;
				updated_at: string;
			}>()
	]);
	const health = await Promise.allSettled([
		database
			.prepare(
				"SELECT COUNT(*) AS count FROM hot_sources WHERE is_enabled = 1 AND last_error IS NOT NULL AND last_error <> ''"
			)
			.all<{ count: number }>(),
		database
			.prepare('SELECT status, started_at FROM cron_runs ORDER BY started_at DESC, id DESC LIMIT 1')
			.all<{ status: string; started_at: string }>()
	]);
	return {
		items,
		categories,
		tags,
		users,
		submissions: pending.results[0]?.count ?? 0,
		summary,
		recent: recent.results.map((row) => ({
			id: row.id,
			title: row.title,
			type: row.type,
			status: row.status,
			visibility: row.visibility,
			updatedAt: row.updated_at
		})),
		health: {
			hotErrors: health[0].status === 'fulfilled' ? (health[0].value.results[0]?.count ?? 0) : null,
			lastRun: health[1].status === 'fulfilled' ? (health[1].value.results[0] ?? null) : null,
			cronAvailable: health[1].status === 'fulfilled'
		},
		source: 'database' as const
	};
}

export function fallbackAdminOverview() {
	const tags = new Set(fallbackItems.flatMap((item) => item.tags.map((tag) => tag.slug)));
	return {
		items: fallbackItems.length,
		categories: fallbackCategories.length,
		tags: tags.size,
		users: 0,
		submissions: 0,
		summary: {
			total: fallbackItems.length,
			published: fallbackItems.length,
			draft: 0,
			private: 0,
			types: {}
		},
		recent: [] as Array<{
			id: number;
			title: string;
			type: string;
			status: string;
			visibility: string;
			updatedAt: string;
		}>,
		health: {
			hotErrors: null as number | null,
			lastRun: null as { status: string; started_at: string } | null,
			cronAvailable: false
		},
		source: 'fallback' as const
	};
}

export function fallbackAdminItems() {
	const categories = fallbackAdminCategories().categories;
	return {
		items: fallbackItems.map((item, index) => {
			const category = categories.find((entry) => entry.name === item.category);
			return {
				id: index + 1,
				type: item.type,
				title: item.title,
				slug: item.slug,
				category: category ? { id: category.id, name: category.name, slug: category.slug } : null,
				categoryId: category?.id ?? null,
				authorId: null,
				summary: item.summary ?? null,
				content: null,
				coverFileId: null,
				iconFileId: null,
				isFeatured: false,
				sortOrder: (index + 1) * 10,
				tags: item.tags,
				meta: {},
				publishedAt: null,
				createdAt: '',
				status: 'published',
				visibility: 'public',
				updatedAt: '本地示例'
			};
		}),
		categories,
		tags: fallbackAdminTags().tags,
		files: [],
		source: 'fallback' as const
	};
}

export async function loadAdminCategories(database: Database) {
	const [categories, usage] = await Promise.all([
		listCategories(database, { visibleOnly: false }),
		database
			.prepare(
				'SELECT category_id, COUNT(*) AS count FROM items WHERE category_id IS NOT NULL GROUP BY category_id'
			)
			.all<{ category_id: number; count: number }>()
	]);
	return {
		categories,
		workbench: buildCategoryWorkbench(
			categories,
			usage.results.map((row) => ({ categoryId: row.category_id, count: row.count }))
		),
		source: 'database' as const
	};
}

export function fallbackAdminCategories() {
	const categories = fallbackCategories.map((category, index) => ({
		id: index + 1,
		type: fallbackItems.find((item) => item.category === category.name)?.type ?? 'site',
		parentId: null,
		name: category.name,
		slug: category.slug,
		icon: category.icon ?? null,
		description: null,
		isVisible: true,
		sortOrder: (index + 1) * 10,
		createdAt: '本地示例',
		updatedAt: '本地示例'
	}));
	return {
		categories,
		workbench: buildCategoryWorkbench(categories, []),
		source: 'fallback' as const
	};
}

export async function loadAdminTags(database: Database) {
	return { tags: await listTags(database), source: 'database' as const };
}

export function fallbackAdminTags() {
	const tags = new Map<
		string,
		{
			id: number;
			type: (typeof fallbackItems)[number]['type'];
			name: string;
			slug: string;
			description: null;
			createdAt: string;
			updatedAt: string;
		}
	>();
	for (const item of fallbackItems) {
		for (const tag of item.tags) {
			if (!tags.has(tag.slug)) {
				tags.set(tag.slug, {
					id: tags.size + 1,
					type: item.type,
					name: tag.name,
					slug: tag.slug,
					description: null,
					createdAt: '本地示例',
					updatedAt: '本地示例'
				});
			}
		}
	}

	return { tags: [...tags.values()], source: 'fallback' as const };
}

type HomeModuleRow = {
	id: number;
	type: HomeModule['type'];
	title: string;
	config_json: string;
	sort_order: number;
	is_enabled: number;
	created_at: string;
	updated_at: string;
};

export async function loadAdminHomeModules(database: Database) {
	const { results } = await database
		.prepare(
			'SELECT id, type, title, config_json, sort_order, is_enabled, created_at, updated_at FROM home_modules ORDER BY sort_order, title'
		)
		.all<HomeModuleRow>();
	return {
		modules: results.map((row) => ({
			id: row.id,
			type: row.type,
			title: row.title,
			config: JSON.parse(row.config_json) as Record<string, unknown>,
			sortOrder: row.sort_order,
			isEnabled: row.is_enabled === 1,
			createdAt: row.created_at,
			updatedAt: row.updated_at
		})),
		source: 'database' as const
	};
}

export async function loadAdminSearchEngines(database: Database) {
	return { searchEngines: await listSearchEngines(database, false), source: 'database' as const };
}

export function fallbackAdminHomeModules() {
	return { modules: [], source: 'fallback' as const };
}

export function fallbackAdminSearchEngines() {
	return { searchEngines: [], source: 'fallback' as const };
}
