import type { Database } from '$lib/server/db';

export type UserProfileInput = {
	displayName: string;
	email: string | null;
	avatarFileId: number | null;
	coverFileId: number | null;
};
export class UserProfileError extends Error {
	constructor(
		message: string,
		public readonly field?: string,
		public readonly status: 400 | 409 = 400
	) {
		super(message);
		this.name = 'UserProfileError';
	}
}
function fileId(value: unknown, field: string, errors: Record<string, string>) {
	if (value === null || value === undefined || value === '') return null;
	const id = Number(value);
	if (!Number.isInteger(id) || id <= 0) {
		errors[field] = '文件 ID 必须是正整数。';
		return null;
	}
	return id;
}
export function validateUserProfileInput(input: Record<string, unknown>) {
	const errors: Record<string, string> = {};
	const displayName = typeof input.displayName === 'string' ? input.displayName.trim() : '';
	if (!displayName) errors.displayName = '显示名称不能为空。';
	else if (displayName.length > 80) errors.displayName = '显示名称不能超过 80 个字符。';
	const email =
		typeof input.email === 'string' && input.email.trim() ? input.email.trim().toLowerCase() : null;
	if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = '请输入有效的邮箱地址。';
	const data: UserProfileInput = {
		displayName,
		email,
		avatarFileId: fileId(input.avatarFileId, 'avatarFileId', errors),
		coverFileId: fileId(input.coverFileId, 'coverFileId', errors)
	};
	return Object.keys(errors).length
		? { valid: false as const, errors }
		: { valid: true as const, data };
}
async function validateOwnedFile(
	database: Database,
	userId: number,
	id: number | null,
	field: string
) {
	if (!id) return;
	const row = (
		await database
			.prepare("SELECT id FROM files WHERE id=? AND user_id=? AND bucket='FILES' LIMIT 1")
			.bind(id, userId)
			.all<{ id: number }>()
	).results[0];
	if (!row) throw new UserProfileError('文件不存在或不属于当前用户。', field);
}
export async function updateUserProfile(
	database: Database,
	userId: number,
	input: UserProfileInput
) {
	await Promise.all([
		validateOwnedFile(database, userId, input.avatarFileId, 'avatarFileId'),
		validateOwnedFile(database, userId, input.coverFileId, 'coverFileId')
	]);
	try {
		const saved = (
			await database
				.prepare(
					`UPDATE users SET display_name=?,email=?,avatar_file_id=?,cover_file_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?
            AND (? IS NULL OR EXISTS(SELECT 1 FROM files WHERE id=? AND user_id=? AND bucket='FILES'))
            AND (? IS NULL OR EXISTS(SELECT 1 FROM files WHERE id=? AND user_id=? AND bucket='FILES')) RETURNING id`
				)
				.bind(
					input.displayName,
					input.email,
					input.avatarFileId,
					input.coverFileId,
					userId,
					input.avatarFileId,
					input.avatarFileId,
					userId,
					input.coverFileId,
					input.coverFileId,
					userId
				)
				.all<{ id: number }>()
		).results[0];
		if (!saved) throw new UserProfileError('所选图片已失效，请重新选择后保存。');
	} catch (error) {
		if (error instanceof Error && /UNIQUE constraint/i.test(error.message))
			throw new UserProfileError('邮箱已被其他用户使用。', 'email', 409);
		throw error;
	}
}
export async function getUserProfile(database: Database, userId: number) {
	return (
		(
			await database
				.prepare(
					'SELECT id,email,username,display_name,role,avatar_file_id,cover_file_id FROM users WHERE id=? LIMIT 1'
				)
				.bind(userId)
				.all<{
					id: number;
					email: string | null;
					username: string;
					display_name: string;
					role: string;
					avatar_file_id: number | null;
					cover_file_id: number | null;
				}>()
		).results[0] ?? null
	);
}
