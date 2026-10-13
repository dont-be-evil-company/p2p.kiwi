import { fetchScreenshots } from '$lib/screenshots';
import type { PageLoad } from './$types';

export const load: PageLoad = async () => {
	const screenshots = await fetchScreenshots();
	return { screenshots };
};
