import { fetchDocs } from '$lib/docs';
import type { PageLoad } from './$types';

export const load: PageLoad = async () => {
	const docs = await fetchDocs();
	return { docs };
};
