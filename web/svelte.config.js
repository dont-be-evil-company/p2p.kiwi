import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { mdsvex } from 'mdsvex';
import rehypeSlug from 'rehype-slug';
import { getMdsvexShikiHighlighter } from '@mistweaverco/mdsvex-shiki';

const highlighter = await getMdsvexShikiHighlighter({
	displayLanguage: true,
	displayPath: true
});

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: [
		vitePreprocess(),
		mdsvex({
			highlight: { highlighter },
			extension: '.md',
			rehypePlugins: [rehypeSlug]
		})
	],

	kit: {
		adapter: adapter()
	},

	extensions: ['.svelte', '.svx', '.mdx', '.md']
};

export default config;
