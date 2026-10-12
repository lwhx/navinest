import type { ContentType } from '$lib/types/content';

type HomeCategory = { slug: string; type?: ContentType };

export function canShowHomeCategory(category: HomeCategory): boolean {
	// Retire the seeded sections without deleting their data or disabling normal article categories.
	return (
		category.type !== 'book' &&
		category.type !== 'bulletin' &&
		!['bookshelf', 'notes', 'announcements'].includes(category.slug)
	);
}
