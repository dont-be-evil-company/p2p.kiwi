import { redirect } from '@sveltejs/kit';
import { DOWNLOAD_URLS } from '$lib/downloads';

export function load() {
	redirect(302, DOWNLOAD_URLS.LINUX_APPIMAGE_X86_64);
}
