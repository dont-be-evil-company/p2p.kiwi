import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { inlineShikiCodeblocks } from './vite-plugins/inline-shiki-codeblocks.js';
import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { mdsvex } from 'mdsvex';
import rehypeSlug from 'rehype-slug';
import { getMdsvexShikiHighlighter } from '@dont-be-evil-company/mdsvex-shiki';

const highlighter = await getMdsvexShikiHighlighter({
	displayLang: true,
	displayPath: true
});

export default defineConfig({
	plugins: [
		inlineShikiCodeblocks(),
		sveltekit({
			preprocess: [
				vitePreprocess(),
				mdsvex({
					highlight: { highlighter },
					extension: '.md',
					rehypePlugins: [rehypeSlug]
				})
			],
			adapter: adapter(),
			extensions: ['.svelte', '.svx', '.mdx', '.md']
		}),
		tailwindcss()
	]
});
