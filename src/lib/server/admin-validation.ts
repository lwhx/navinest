import { searchSourcePreview } from '$lib/search-source';
import { validateExternalTarget } from '$lib/server/safe-target';
import type { ContentType } from '$lib/types/content';
import {
	searchRecommendations,
	SEARCH_RECOMMENDATION_LIMIT,
	SEARCH_RECOMMENDATION_LENGTH
} from '$lib/search';

const CONTENT_TYPES = new Set<ContentType>(['site', 'post', 'app', 'book', 'bulletin']);
const ITEM_STATUSES = new Set(['draft', 'published']);
const VISIBILITIES = new Set(['public', 'private']);
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KEY_PATTERN = SLUG_PATTERN;
const HOME_MODULE_TYPES = new Set(['search', 'content', 'hot', 'ranking', 'custom_html', 'links']);

export type ValidationResult<T> =
	{ valid: true; data: T } | { valid: false; errors: Record<string, string> };

export type CategoryInput = {
	type: ContentType;
	parentId: number | null;
	name: string;
	slug: string;
	icon: string | null;
	description: string | null;
	sortOrder: number;
	isVisible: boolean;
};

export type TagInput = {
	type: ContentType;
	name: string;
	slug: string;
	description: string | null;
};

export type ItemInput = {
	type: ContentType;
	categoryId: number | null;
	iconFileId: number | null;
	coverFileId: number | null;
	title: string;
	slug: string;
	summary: string | null;
	content: string | null;
	status: 'draft' | 'published';
	visibility: 'public' | 'private';
	sortOrder: number;
	isFeatured: boolean;
	tagIds: number[];
	meta: Record<string, string>;
};

export type HomeModuleInput = {
	type: 'search' | 'content' | 'hot' | 'ranking' | 'custom_html' | 'links';
	title: string;
	config: Record<string, unknown>;
	sortOrder: number;
	isEnabled: boolean;
};

export type SearchEngineInput = {
	groupKey: string;
	name: string;
	key: string;
	urlTemplate: string;
	placeholder: string | null;
	sortOrder: number;
	isEnabled: boolean;
};

type InputRecord = Record<string, unknown>;

function text(
	input: InputRecord,
	field: string,
	errors: Record<string, string>,
	options: { required?: boolean; maximum: number }
): string | null {
	const raw = input[field];
	const value = typeof raw === 'string' ? raw.trim() : '';

	if (!value) {
		if (options.required) errors[field] = '此字段不能为空。';
		return null;
	}

	if (value.length > options.maximum) {
		errors[field] = `此字段不能超过 ${options.maximum} 个字符。`;
	}

	return value;
}

function contentType(value: unknown, errors: Record<string, string>): ContentType {
	if (typeof value === 'string' && CONTENT_TYPES.has(value as ContentType)) {
		return value as ContentType;
	}

	errors.type = '请选择有效的内容类型。';
	return 'site';
}

function slug(input: InputRecord, errors: Record<string, string>): string {
	const value = text(input, 'slug', errors, { required: true, maximum: 100 }) ?? '';
	if (value && !SLUG_PATTERN.test(value)) {
		errors.slug = 'Slug 只能包含小写字母、数字和单个连字符。';
	}
	return value;
}

function integer(
	value: unknown,
	field: string,
	errors: Record<string, string>,
	options: { nullable?: boolean; minimum?: number; maximum?: number } = {}
): number | null {
	if ((value === null || value === undefined || value === '') && options.nullable) return null;

	const parsed = typeof value === 'number' ? value : Number(value);
	if (!Number.isInteger(parsed)) {
		errors[field] = '请输入整数。';
		return options.nullable ? null : 0;
	}

	if (options.minimum !== undefined && parsed < options.minimum) {
		errors[field] = `数值不能小于 ${options.minimum}。`;
	}
	if (options.maximum !== undefined && parsed > options.maximum) {
		errors[field] = `数值不能大于 ${options.maximum}。`;
	}

	return parsed;
}

function boolean(value: unknown, fallback = false): boolean {
	if (typeof value === 'boolean') return value;
	if (typeof value === 'number') return value === 1;
	if (typeof value === 'string') return ['1', 'true', 'on', 'yes'].includes(value.toLowerCase());
	return fallback;
}

function idList(value: unknown, errors: Record<string, string>): number[] {
	let values: unknown[];
	if (Array.isArray(value)) {
		values = value;
	} else if (typeof value === 'string' && value.trim()) {
		values = value.split(',');
	} else if (value === null || value === undefined || value === '') {
		return [];
	} else {
		values = [value];
	}

	const ids = values.map((entry) => Number(entry));
	if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
		errors.tagIds = '标签 ID 必须是正整数。';
		return [];
	}

	return [...new Set(ids)];
}

function metadata(value: unknown, type: ContentType, errors: Record<string, string>) {
	const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
	const allowed: Record<ContentType, Set<string>> = {
		site: new Set(['site_url', 'site_type']),
		post: new Set(),
		app: new Set(['app_platform', 'app_download_url']),
		book: new Set(['book_score', 'book_author', 'book_download_url']),
		bulletin: new Set()
	};
	const result: Record<string, string> = {};

	for (const [key, raw] of Object.entries(source)) {
		const value = typeof raw === 'string' ? raw.trim() : '';
		if (!value) continue;
		if (!allowed[type].has(key)) {
			errors.meta = `内容类型 ${type} 不支持扩展字段 ${key}。`;
			continue;
		}

		if (value.length > 2_000) {
			errors[`meta.${key}`] = '扩展字段不能超过 2000 个字符。';
			continue;
		}

		if (key.endsWith('_url')) {
			const target = validateExternalTarget(value);
			if (!target.valid) {
				errors[`meta.${key}`] = '请输入有效的公网 HTTP/HTTPS 地址。';
				continue;
			}
		}

		result[key] = value;
	}

	if (type === 'site' && !result.site_url) {
		errors['meta.site_url'] = '网址内容必须提供目标地址。';
	}

	return result;
}

export function validateCategoryInput(input: InputRecord): ValidationResult<CategoryInput> {
	const errors: Record<string, string> = {};
	const data: CategoryInput = {
		type: contentType(input.type, errors),
		parentId: integer(input.parentId, 'parentId', errors, { nullable: true, minimum: 1 }),
		name: text(input, 'name', errors, { required: true, maximum: 80 }) ?? '',
		slug: slug(input, errors),
		icon: text(input, 'icon', errors, { maximum: 100 }),
		description: text(input, 'description', errors, { maximum: 500 }),
		sortOrder:
			integer(input.sortOrder ?? 0, 'sortOrder', errors, {
				minimum: -100_000,
				maximum: 100_000
			}) ?? 0,
		isVisible: boolean(input.isVisible, true)
	};

	return Object.keys(errors).length > 0 ? { valid: false, errors } : { valid: true, data };
}

export function validateTagInput(input: InputRecord): ValidationResult<TagInput> {
	const errors: Record<string, string> = {};
	const data: TagInput = {
		type: contentType(input.type, errors),
		name: text(input, 'name', errors, { required: true, maximum: 80 }) ?? '',
		slug: slug(input, errors),
		description: text(input, 'description', errors, { maximum: 500 })
	};

	return Object.keys(errors).length > 0 ? { valid: false, errors } : { valid: true, data };
}

export function validateItemInput(input: InputRecord): ValidationResult<ItemInput> {
	const errors: Record<string, string> = {};
	const type = contentType(input.type, errors);
	const status =
		typeof input.status === 'string' && ITEM_STATUSES.has(input.status)
			? (input.status as ItemInput['status'])
			: 'draft';
	const visibility =
		typeof input.visibility === 'string' && VISIBILITIES.has(input.visibility)
			? (input.visibility as ItemInput['visibility'])
			: 'public';
	if (input.status !== undefined && !ITEM_STATUSES.has(String(input.status))) {
		errors.status = '请选择有效的发布状态。';
	}
	if (input.visibility !== undefined && !VISIBILITIES.has(String(input.visibility))) {
		errors.visibility = '请选择有效的可见性。';
	}

	const data: ItemInput = {
		type,
		categoryId: integer(input.categoryId, 'categoryId', errors, { nullable: true, minimum: 1 }),
		iconFileId: integer(input.iconFileId, 'iconFileId', errors, { nullable: true, minimum: 1 }),
		coverFileId: integer(input.coverFileId, 'coverFileId', errors, { nullable: true, minimum: 1 }),
		title: text(input, 'title', errors, { required: true, maximum: 160 }) ?? '',
		slug: slug(input, errors),
		summary: text(input, 'summary', errors, { maximum: 500 }),
		content: text(input, 'content', errors, { maximum: 100_000 }),
		status,
		visibility,
		sortOrder:
			integer(input.sortOrder ?? 0, 'sortOrder', errors, {
				minimum: -100_000,
				maximum: 100_000
			}) ?? 0,
		isFeatured: boolean(input.isFeatured),
		tagIds: idList(input.tagIds, errors),
		meta: metadata(input.meta, type, errors)
	};

	return Object.keys(errors).length > 0 ? { valid: false, errors } : { valid: true, data };
}

export function validateHomeModuleInput(input: InputRecord): ValidationResult<HomeModuleInput> {
	const errors: Record<string, string> = {};
	const rawType = String(input.type ?? '');
	const type = HOME_MODULE_TYPES.has(rawType) ? rawType : 'content';
	if (!HOME_MODULE_TYPES.has(rawType)) errors.type = '请选择有效的模块类型。';
	let config: Record<string, unknown> = {};
	try {
		const source =
			typeof input.configJson === 'string' && input.configJson.trim() ? input.configJson : '{}';
		const parsed: unknown = JSON.parse(source);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
		config = parsed as Record<string, unknown>;
	} catch {
		errors.configJson = '配置必须是有效的 JSON 对象。';
	}
	if (type === 'content' && typeof input.categorySlug === 'string') {
		const slug = input.categorySlug.trim();
		if (!SLUG_PATTERN.test(slug) || slug.length > 100)
			errors.categorySlug = '请选择有效的资源分类。';
		else config = { ...config, categorySlug: slug };
	}
	if (type === 'search') {
		const field =
			typeof input.recommendedSearchesText === 'string' ? 'recommendedSearchesText' : 'configJson';
		const words =
			field === 'recommendedSearchesText'
				? (input.recommendedSearchesText as string)
						.split(/\r?\n/)
						.map((word) => word.trim())
						.filter(Boolean)
				: config.recommendedSearches;
		if (words !== undefined) {
			if (
				!Array.isArray(words) ||
				words.length > SEARCH_RECOMMENDATION_LIMIT ||
				words.some(
					(word) =>
						typeof word !== 'string' ||
						!word.trim() ||
						word.trim().length > SEARCH_RECOMMENDATION_LENGTH
				)
			)
				errors[field] =
					`推荐搜索词最多 ${SEARCH_RECOMMENDATION_LIMIT} 个，每个不超过 ${SEARCH_RECOMMENDATION_LENGTH} 个字符。`;
			else config = { ...config, recommendedSearches: searchRecommendations(words) };
		}
	}
	const data: HomeModuleInput = {
		type: type as HomeModuleInput['type'],
		title: text(input, 'title', errors, { required: true, maximum: 100 }) ?? '',
		config,
		sortOrder:
			integer(input.sortOrder ?? 0, 'sortOrder', errors, { minimum: -100_000, maximum: 100_000 }) ??
			0,
		isEnabled: boolean(input.isEnabled, true)
	};
	return Object.keys(errors).length > 0 ? { valid: false, errors } : { valid: true, data };
}

export function validateSearchEngineInput(input: InputRecord): ValidationResult<SearchEngineInput> {
	const errors: Record<string, string> = {};
	const key = text(input, 'key', errors, { required: true, maximum: 80 }) ?? '';
	if (key && !KEY_PATTERN.test(key)) errors.key = 'Key 只能包含小写字母、数字和单个连字符。';
	const urlTemplate = text(input, 'urlTemplate', errors, { required: true, maximum: 2_000 }) ?? '';
	if (urlTemplate) {
		const preview = searchSourcePreview(urlTemplate, '导航巢');
		if (!preview.valid) errors.urlTemplate = preview.error;
	}
	const data: SearchEngineInput = {
		groupKey: text(input, 'groupKey', errors, { required: true, maximum: 80 }) ?? '',
		name: text(input, 'name', errors, { required: true, maximum: 80 }) ?? '',
		key,
		urlTemplate,
		placeholder: text(input, 'placeholder', errors, { maximum: 160 }),
		sortOrder:
			integer(input.sortOrder ?? 0, 'sortOrder', errors, { minimum: -100_000, maximum: 100_000 }) ??
			0,
		isEnabled: boolean(input.isEnabled, true)
	};
	return Object.keys(errors).length > 0 ? { valid: false, errors } : { valid: true, data };
}
