import type { ContentType } from '$lib/types/content';

export const managedCategoryTypes = [
	{ value: 'site', label: '网址' },
	{ value: 'post', label: '文章' }
] as const;

export function isManagedCategoryType(type: string): type is Extract<ContentType, 'site' | 'post'> {
	return type === 'site' || type === 'post';
}
