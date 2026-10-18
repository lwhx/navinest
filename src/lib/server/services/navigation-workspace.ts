import type { Database, DatabaseStatement } from '$lib/server/db';
import type {
	NavigationData,
	NavigationMutation,
	NavigationPlan,
	NavigationReceipt
} from '$lib/custom-navigation-workspace';
import { NAVIGATION_BATCH_LIMIT } from '$lib/custom-navigation-workspace';
import { categoryInput, linkInput, customNavigationVersion } from './custom-navigation';
import { backupDigest, jsonChunks, bytes } from './site-backup-state';

export class NavigationWorkspaceError extends Error {
	constructor(
		message: string,
		public status = 400,
		public uncertain = false
	) {
		super(message);
	}
}
const specs = [
	{ table: 'custom_categories', columns: 'id,parent_id,name,icon,sort_order,updated_at' },
	{
		table: 'custom_links',
		columns: 'id,category_id,title,url,icon_url,summary,sort_order,status,updated_at'
	}
] as const;
const object = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === 'object' && !Array.isArray(v);
const positive = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;
function fail(message: string, status = 400): never {
	throw new NavigationWorkspaceError(message, status);
}
function digestValue(value: unknown): asserts value is string {
	if (typeof value !== 'string' || !/^[a-f\d]{64}$/.test(value)) fail('请重新核对当前操作。', 428);
}
function receiptKey(userId: number, runId: unknown) {
	if (typeof runId !== 'string' || !/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(runId))
		fail('操作批次无效。');
	return `user:navigation:${userId}:${runId}`;
}
export async function navigationReceipt(
	db: Database,
	userId: number,
	runId: unknown
): Promise<NavigationReceipt | null> {
	const raw = (
		await db
			.prepare('SELECT value_json FROM settings WHERE key=?')
			.bind(receiptKey(userId, runId))
			.all<{ value_json: string }>()
	).results[0];
	if (!raw) return null;
	try {
		const r = JSON.parse(raw.value_json) as NavigationReceipt;
		if (
			!['completed', 'cancelled'].includes(r.status) ||
			!/^[a-f\d]{64}$/.test(r.digest) ||
			!Number.isSafeInteger(r.affected) ||
			r.affected < 0 ||
			r.affected > 500 ||
			!Number.isFinite(Date.parse(r.completedAt))
		)
			throw new Error();
		return r;
	} catch {
		throw new NavigationWorkspaceError('操作记录异常，请保留批次并核对。', 503, true);
	}
}
function match(r: NavigationReceipt, digest: string) {
	if (r.digest !== digest)
		throw new NavigationWorkspaceError('批次与当前操作不一致，请核对原批次。', 409, true);
	return r;
}
export async function cancelNavigationMutation(
	db: Database,
	userId: number,
	input: Record<string, unknown>
) {
	digestValue(input.digest);
	const r: NavigationReceipt = {
		digest: input.digest,
		status: 'cancelled',
		affected: 0,
		completedAt: new Date().toISOString()
	};
	await db
		.prepare('INSERT INTO settings(key,value_json) VALUES(?,?) ON CONFLICT(key) DO NOTHING')
		.bind(receiptKey(userId, input.runId), JSON.stringify(r))
		.all();
	const stored = await navigationReceipt(db, userId, input.runId);
	if (!stored) throw new NavigationWorkspaceError('尚未确认取消结果，请再次核对。', 503, true);
	return match(stored, input.digest);
}
async function state(db: Database, userId: number) {
	const snapshot = await Promise.all(
		specs.map(async (spec) => ({
			...spec,
			rows: (
				await db
					.prepare(
						`SELECT json_array(${spec.columns}) value FROM ${spec.table} WHERE user_id=? ORDER BY id LIMIT 20001`
					)
					.bind(userId)
					.all<{ value: string }>()
			).results.map((r) => r.value)
		}))
	);
	if (
		snapshot.some((s) => s.rows.length > 20000) ||
		snapshot.reduce((n, s) => n + s.rows.reduce((n, r) => n + bytes(r), 0), 0) > 8 * 1024 * 1024
	)
		fail('导航数据超过在线核对范围，尚未修改。', 413);
	try {
		if (snapshot.reduce((n, s) => n + Math.max(1, jsonChunks(s.rows, 400000).length), 0) > 20)
			throw new Error();
	} catch {
		fail('导航数据超过在线核对范围，尚未修改。', 413);
	}
	const navigation: NavigationData = {
		categories: snapshot[0].rows
			.map((raw) => {
				const r = JSON.parse(raw);
				return { id: r[0], name: r[2], icon: r[3], sortOrder: r[4] };
			})
			.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id),
		links: snapshot[1].rows
			.map((raw) => {
				const r = JSON.parse(raw);
				return {
					id: r[0],
					categoryId: r[1],
					title: r[2],
					url: r[3],
					summary: r[5],
					sortOrder: r[6],
					status: r[7]
				};
			})
			.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
	};
	return { snapshot, navigation };
}
function normalize(value: unknown, navigation: NavigationData): NavigationMutation {
	if (!object(value)) fail('操作内容无效。');
	const linkIds = new Set(navigation.links.map((l) => l.id)),
		categoryIds = new Set(navigation.categories.map((c) => c.id));
	const category = (id: unknown) => {
		if (id !== null && (!positive(id) || !categoryIds.has(id)))
			fail('分类不存在或不属于当前账号。', 404);
		return id as number | null;
	};
	const owned = (id: unknown, kind: 'link' | 'category') => {
		if (!positive(id) || !(kind === 'link' ? linkIds : categoryIds).has(id))
			fail('记录不存在或不属于当前账号。', 404);
		return id;
	};
	const ids = (value: unknown) => {
		if (
			!Array.isArray(value) ||
			!value.length ||
			value.length > NAVIGATION_BATCH_LIMIT ||
			new Set(value).size !== value.length
		)
			fail('每批请选择 1–500 条不同的链接。');
		return value.map((id) => owned(id, 'link')).sort((a, b) => a - b);
	};
	if (value.kind === 'link-save' || value.kind === 'category-save') {
		const kind = value.kind,
			id = value.id === null ? null : owned(value.id, kind === 'link-save' ? 'link' : 'category'),
			data = value.data;
		if (
			!object(data) ||
			!Number.isSafeInteger(data.sortOrder) ||
			Math.abs(Number(data.sortOrder)) > 1e12
		)
			fail('排序必须是范围内的整数。');
		if (kind === 'category-save') {
			if (typeof data.name !== 'string' || (data.icon !== null && typeof data.icon !== 'string'))
				fail('分类信息格式无效。');
			return {
				kind,
				id,
				data: categoryInput({
					name: data.name,
					icon: data.icon as string | null,
					sortOrder: Number(data.sortOrder)
				})
			};
		}
		if (
			typeof data.title !== 'string' ||
			typeof data.url !== 'string' ||
			data.url.length > 2048 ||
			(data.summary !== null && (typeof data.summary !== 'string' || data.summary.length > 300)) ||
			!['active', 'inactive'].includes(String(data.status))
		)
			fail('链接信息格式无效；网址最多 2048 字符，摘要最多 300 字符。');
		return {
			kind,
			id,
			data: linkInput({
				title: data.title,
				url: data.url,
				summary: data.summary as string | null,
				status: data.status as 'active' | 'inactive',
				categoryId: category(data.categoryId),
				sortOrder: Number(data.sortOrder)
			})
		};
	}
	if (value.kind === 'link-delete') return { kind: value.kind, ids: ids(value.ids) };
	if (value.kind === 'category-delete')
		return { kind: value.kind, id: owned(value.id, 'category') };
	if (value.kind === 'link-bulk') {
		if (!['move', 'active', 'inactive'].includes(String(value.change))) fail('批量操作无效。');
		return {
			kind: value.kind,
			ids: ids(value.ids),
			change: value.change as 'move' | 'active' | 'inactive',
			...(value.change === 'move' ? { categoryId: category(value.categoryId) } : {})
		};
	}
	if (value.kind === 'move') {
		if (
			!['link', 'category'].includes(String(value.resource)) ||
			(value.direction !== -1 && value.direction !== 1)
		)
			fail('排序操作无效。');
		return {
			kind: value.kind,
			resource: value.resource as 'link' | 'category',
			id: owned(value.id, value.resource as 'link' | 'category'),
			direction: value.direction
		};
	}
	fail('不支持的操作。');
}
export async function prepareNavigationMutation(db: Database, userId: number, input: unknown) {
	if (!object(input)) fail('操作内容无效。');
	digestValue(input.version);
	const { snapshot, navigation } = await state(db, userId);
	if ((await customNavigationVersion(navigation)) !== input.version)
		fail('导航数据已变化，草稿和勾选已保留。请刷新列表并重新核对。', 409);
	const mutation = normalize(input.mutation, navigation),
		writes: DatabaseStatement[] = [];
	let title: string,
		detail = '',
		items: NavigationPlan['items'];
	const run = (sql: string, ...values: Parameters<DatabaseStatement['bind']>) =>
		writes.push(db.prepare(sql).bind(...values));
	if (mutation.kind === 'category-save') {
		const { id, data: d } = mutation;
		title = id ? '保存分类' : '添加分类';
		items = [{ id: id ?? 0, title: d.name }];
		if (id)
			run(
				'UPDATE custom_categories SET name=?,icon=?,sort_order=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND id=?',
				d.name,
				d.icon,
				d.sortOrder,
				userId,
				id
			);
		else
			run(
				'INSERT INTO custom_categories(user_id,name,icon,sort_order) VALUES(?,?,?,?)',
				userId,
				d.name,
				d.icon,
				d.sortOrder
			);
	} else if (mutation.kind === 'link-save') {
		const { id, data: d } = mutation;
		title = id ? '保存链接' : '添加链接';
		items = [{ id: id ?? 0, title: d.title, url: d.url }];
		if (id)
			run(
				'UPDATE custom_links SET category_id=?,title=?,url=?,summary=?,sort_order=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND id=?',
				d.categoryId,
				d.title,
				d.url,
				d.summary,
				d.sortOrder,
				d.status,
				userId,
				id
			);
		else
			run(
				'INSERT INTO custom_links(user_id,category_id,title,url,summary,sort_order,status) VALUES(?,?,?,?,?,?,?)',
				userId,
				d.categoryId,
				d.title,
				d.url,
				d.summary,
				d.sortOrder,
				d.status
			);
	} else if (mutation.kind === 'category-delete') {
		title = '删除分类';
		items = [
			{ id: mutation.id, title: navigation.categories.find((c) => c.id === mutation.id)!.name }
		];
		const count = navigation.links.filter((l) => l.categoryId === mutation.id).length;
		detail = `只删除此分类；其中 ${count} 条链接保留并移至未分类，子分类解除父级关联。分类删除后无法撤销。`;
		run('DELETE FROM custom_categories WHERE user_id=? AND id=?', userId, mutation.id);
	} else if (mutation.kind === 'move') {
		const list = mutation.resource === 'link' ? navigation.links : navigation.categories;
		const current = list.find((l) => l.id === mutation.id)!;
		const peers =
			mutation.resource === 'link'
				? navigation.links.filter(
						(l) => l.categoryId === ('categoryId' in current ? current.categoryId : null)
					)
				: list;
		const index = peers.findIndex((l) => l.id === mutation.id),
			other = peers[index + mutation.direction];
		if (!other) fail('已经位于当前分类的边界，请刷新列表。', 409);
		const order = list.map((l) => l.id),
			a = order.indexOf(mutation.id),
			b = order.indexOf(other.id);
		[order[a], order[b]] = [order[b], order[a]];
		const table = mutation.resource === 'link' ? 'custom_links' : 'custom_categories';
		for (const chunk of jsonChunks(
			order.map((id, index) => ({ id, sort: (index + 1) * 10 })),
			400000
		))
			run(
				`UPDATE ${table} SET sort_order=(SELECT value->>'$.sort' FROM json_each(?) WHERE value->>'$.id'=${table}.id),updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND id IN(SELECT value->>'$.id' FROM json_each(?))`,
				chunk,
				userId,
				chunk
			);
		title = mutation.direction === -1 ? '上移' : '下移';
		detail = mutation.resource === 'link' ? '调整同分类内的相邻链接顺序。' : '调整分类顺序。';
		items = [current, other].map((r) => ({ id: r.id, title: 'title' in r ? r.title : r.name }));
	} else {
		const ids = mutation.ids;
		items = navigation.links
			.filter((l) => ids.includes(l.id))
			.map((l) => ({ id: l.id, title: l.title, url: l.url }));
		const selection = JSON.stringify(ids);
		if (mutation.kind === 'link-delete') {
			title = '删除所选链接';
			detail = '仅删除下列已勾选链接，包含其他页面和筛选条件下保留的勾选；删除后无法撤销。';
			run(
				'DELETE FROM custom_links WHERE user_id=? AND id IN(SELECT value FROM json_each(?))',
				userId,
				selection
			);
		} else if (mutation.change === 'move') {
			title = '移动所选链接';
			detail = `目标分类：${mutation.categoryId === null ? '未分类' : navigation.categories.find((c) => c.id === mutation.categoryId)!.name + ' #' + mutation.categoryId}。包含跨页保留的勾选。`;
			run(
				'UPDATE custom_links SET category_id=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND id IN(SELECT value FROM json_each(?))',
				mutation.categoryId ?? null,
				userId,
				selection
			);
		} else {
			title = mutation.change === 'active' ? '启用所选链接' : '停用所选链接';
			detail = '只修改所列链接的状态，标题、网址和分类保留。包含跨页保留的勾选。';
			run(
				'UPDATE custom_links SET status=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND id IN(SELECT value FROM json_each(?))',
				mutation.change,
				userId,
				selection
			);
		}
	}
	const generatedAt =
		typeof input.previewAt === 'string' ? input.previewAt : new Date().toISOString();
	if (!Number.isFinite(Date.parse(generatedAt))) fail('核对时间无效。');
	const digest = await backupDigest({ userId, mutation, snapshot, generatedAt });
	return {
		plan: {
			digest,
			generatedAt,
			title,
			detail,
			items,
			affected: items.length
		} satisfies NavigationPlan,
		snapshot,
		writes,
		mutation
	};
}
export async function commitNavigationMutation(db: Database, userId: number, input: unknown) {
	if (!object(input)) fail('操作内容无效。');
	digestValue(input.digest);
	if (input.confirmed !== true) fail('请先核对并确认操作。', 428);
	const key = receiptKey(userId, input.runId),
		prior = await navigationReceipt(db, userId, input.runId);
	if (prior) return match(prior, input.digest);
	const { plan, snapshot, writes } = await prepareNavigationMutation(db, userId, input);
	if (plan.digest !== input.digest) fail('操作内容或导航状态已变化，请重新核对。', 409);
	const age = Date.now() - Date.parse(plan.generatedAt);
	if (age > 15 * 60000 || age < -60000) fail('核对已过期，请重新操作。', 409);
	const batch = (db as Database & { batch?: (s: DatabaseStatement[]) => Promise<unknown> }).batch;
	if (!batch) fail('当前数据库不支持整批提交，尚未修改。', 503);
	const guards = snapshot.flatMap((spec) => {
		const chunks = jsonChunks(spec.rows, 400000);
		return (chunks.length ? chunks : ['[]']).map((chunk) =>
			db
				.prepare(
					`SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM settings WHERE key=?) AND (SELECT COUNT(*) FROM ${spec.table} WHERE user_id=?)=? AND NOT EXISTS(SELECT 1 FROM json_each(?) expected WHERE NOT EXISTS(SELECT 1 FROM ${spec.table} WHERE user_id=? AND id=json_extract(expected.value,'$[0]') AND json_array(${spec.columns})=expected.value)) THEN 1 ELSE json('NAVIGATION_STATE_CHANGED') END ok`
				)
				.bind(key, userId, spec.rows.length, chunk, userId)
		);
	});
	const receipt: NavigationReceipt = {
		digest: input.digest,
		status: 'completed',
		affected: plan.affected,
		completedAt: new Date().toISOString()
	};
	try {
		await batch.call(db, [
			...guards,
			...writes,
			db
				.prepare('INSERT INTO settings(key,value_json) VALUES(?,?)')
				.bind(key, JSON.stringify(receipt))
		]);
	} catch {
		try {
			const done = await navigationReceipt(db, userId, input.runId);
			if (done) return match(done, input.digest);
		} catch {
			/* Preserve uncertainty. */
		}
		throw new NavigationWorkspaceError('结果尚未确认，请先核对此批次，不要直接重试。', 503, true);
	}
	return receipt;
}
