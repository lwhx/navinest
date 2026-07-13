import { fail, json } from '@sveltejs/kit';
import { DatabaseUnavailableError } from '$lib/server/db';
import type { ValidationResult } from '$lib/server/admin-validation';
import { AdminWriteError } from '$lib/server/services/admin-write';

export type MutationValues = Record<string, string | string[]>;

function strings(formData: FormData): MutationValues {
	const values: MutationValues = {};
	for (const [key, value] of formData.entries()) {
		if (typeof value !== 'string') continue;
		const current = values[key];
		if (current === undefined) values[key] = value;
		else values[key] = Array.isArray(current) ? [...current, value] : [current, value];
	}
	return values;
}

export function categoryFormInput(formData: FormData) {
	return {
		...Object.fromEntries(formData),
		isVisible: formData.has('isVisible')
	};
}

export function tagFormInput(formData: FormData) {
	return Object.fromEntries(formData);
}

export function configurationFormInput(formData: FormData) {
	return { ...Object.fromEntries(formData), isEnabled: formData.has('isEnabled') };
}

export function itemFormInput(formData: FormData) {
	return {
		...Object.fromEntries(formData),
		iconFileId: formData.get('iconFileId'),
		coverFileId: formData.get('coverFileId'),
		isFeatured: formData.has('isFeatured'),
		tagIds: formData.getAll('tagIds'),
		meta: {
			site_url: formData.get('site_url'),
			site_type: formData.get('site_type'),
			app_platform: formData.get('app_platform'),
			app_download_url: formData.get('app_download_url'),
			book_score: formData.get('book_score'),
			book_author: formData.get('book_author'),
			book_download_url: formData.get('book_download_url')
		}
	};
}

export function invalidAction<T>(
	validation: Extract<ValidationResult<T>, { valid: false }>,
	formData: FormData
) {
	return fail(400, {
		success: false as const,
		message: '请检查表单中的错误。',
		errors: validation.errors,
		values: strings(formData)
	});
}

function isConstraintError(error: unknown): boolean {
	return (
		error instanceof Error &&
		/UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE/i.test(error.message)
	);
}

export function mutationActionError(error: unknown, formData: FormData) {
	if (error instanceof DatabaseUnavailableError) {
		return fail(503, {
			success: false as const,
			message: '数据库当前不可用。',
			errors: {},
			values: strings(formData)
		});
	}
	if (error instanceof AdminWriteError) {
		return fail(error.status, {
			success: false as const,
			message: error.message,
			errors: error.field ? { [error.field]: error.message } : {},
			values: strings(formData)
		});
	}
	if (isConstraintError(error)) {
		return fail(409, {
			success: false as const,
			message: 'Slug 已存在，请使用其他值。',
			errors: { slug: '同一内容类型下的 Slug 必须唯一。' },
			values: strings(formData)
		});
	}

	console.error('Administrator mutation failed', error);
	return fail(500, {
		success: false as const,
		message: '保存失败，请稍后重试。',
		errors: {},
		values: strings(formData)
	});
}

export function mutationApiError(error: unknown): Response {
	if (error instanceof DatabaseUnavailableError) {
		return json({ error: 'Database unavailable' }, { status: 503 });
	}
	if (error instanceof AdminWriteError) {
		return json({ error: error.message, field: error.field ?? null }, { status: error.status });
	}
	if (isConstraintError(error)) {
		return json({ error: 'Slug already exists', field: 'slug' }, { status: 409 });
	}

	console.error('Administrator API mutation failed', error);
	return json({ error: 'Internal server error' }, { status: 500 });
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
	try {
		const body: unknown = await request.json();
		if (body && typeof body === 'object' && !Array.isArray(body)) {
			return body as Record<string, unknown>;
		}
	} catch {
		// Report malformed JSON through the same mutation error contract.
	}

	throw new AdminWriteError('请求正文必须是 JSON 对象。');
}

export function validationApiError<T>(validation: Extract<ValidationResult<T>, { valid: false }>) {
	return json({ error: 'Validation failed', fields: validation.errors }, { status: 400 });
}

export function parsePositiveId(value: string): number | null {
	const id = Number(value);
	return Number.isInteger(id) && id > 0 ? id : null;
}
