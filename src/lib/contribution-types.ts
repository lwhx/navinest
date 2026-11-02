export type ContributionType = 'site' | 'post';

/** Webpage facts captured by the enrichment fetch, shown as evidence in the UI. */
export type ContributionSnapshot = {
	fetchedUrl: string;
	title: string;
	description: string;
	excerpt: string;
	siteName: string;
	iconUrl?: string;
	fetchedAt: string;
};
/** AI-authored draft fields derived from a snapshot; every field stays user-controlled. */
export type ContributionSuggestion = {
	title: string;
	summary: string;
	content: string;
	tags: string[];
	categoryId?: number | null;
	categoryName?: string | null;
	categoryReason?: string;
};

export function isContributionType(value: unknown): value is ContributionType {
	return value === 'site' || value === 'post';
}
