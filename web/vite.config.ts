import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { inlineShikiCodeblocks } from './vite-plugins/inline-shiki-codeblocks.js';

export default defineConfig({
	plugins: [inlineShikiCodeblocks(), sveltekit(), tailwindcss()]
});
