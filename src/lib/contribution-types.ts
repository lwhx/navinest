export type ContributionType = 'site' | 'post';

export function isContributionType(value: unknown): value is ContributionType {
	return value === 'site' || value === 'post';
}
