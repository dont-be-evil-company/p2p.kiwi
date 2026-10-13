import { error } from '@sveltejs/kit';
import { fetchDocs, loadDoc } from '$lib/docs';
import type { EntryGenerator, PageLoad } from './$types';

export const entries: EntryGenerator = async () => {
	const docs = await fetchDocs();
	return docs.map((doc) => ({ slug: doc.slug }));
};

export const load: PageLoad = async ({ params }) => {
	const slug = params.slug.replace(/[^a-z0-9-_]/gi, '');
	const doc = await loadDoc(slug);
	if (!doc) {
		error(404, 'Not found');
	}
	return {
		metadata: doc.metadata,
		content: doc.default
	};
};
