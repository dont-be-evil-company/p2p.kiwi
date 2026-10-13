import { error } from '@sveltejs/kit';
import { fetchScreenshots, loadScreenshot } from '$lib/screenshots';
import type { EntryGenerator, PageLoad } from './$types';

export const entries: EntryGenerator = async () => {
	const docs = await fetchScreenshots();
	return docs.map((doc) => ({ slug: doc.slug }));
};

export const load: PageLoad = async ({ params }) => {
	const slug = params.slug.replace(/[^a-z0-9-_]/gi, '');
	const doc = await loadScreenshot(slug);
	if (!doc) {
		error(404, 'Not found');
	}
	return {
		metadata: doc.metadata,
		content: doc.default
	};
};
