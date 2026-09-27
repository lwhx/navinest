export type ValidationOutcome<T> =
	{ valid: true; data: T } | { valid: false; errors: Record<string, string> };

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;

export function normalizeUsername(value: unknown): string {
	return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function normalizeEmail(value: unknown): string {
	return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function usernameError(username: string): string | null {
	if (!username) return '用户名不能为空。';
	if (!USERNAME_PATTERN.test(username))
		return '用户名需为 3–32 位的字母、数字、点、下划线或连字符，并以字母或数字开头。';
	return null;
}

export function displayNameError(displayName: string): string | null {
	if (!displayName) return '显示名称不能为空。';
	if (displayName.length > 80) return '显示名称不能超过 80 个字符。';
	return null;
}

export function emailError(email: string): string | null {
	if (!email) return null;
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '请输入有效的邮箱地址。';
	if (email.length > 160) return '邮箱不能超过 160 个字符。';
	return null;
}

export function passwordError(password: string, required: boolean): string | null {
	if (!password) return required ? '请设置密码。' : null;
	if (password.length < MIN_PASSWORD_LENGTH) return `密码至少 ${MIN_PASSWORD_LENGTH} 个字符。`;
	if (password.length > MAX_PASSWORD_LENGTH) return `密码不能超过 ${MAX_PASSWORD_LENGTH} 个字符。`;
	return null;
}
