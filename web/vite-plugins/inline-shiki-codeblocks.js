import { getMdsvexShikiHighlighter } from '@mistweaverco/mdsvex-shiki';

const highlighterOptions = {
	displayLanguage: true,
	displayPath: true,
	shikiOptions: {
		langs: /** @type {const} */ (['bash', 'yaml', 'json', 'javascript', 'powershell'])
	}
};

/** @type {Awaited<ReturnType<typeof getMdsvexShikiHighlighter>> | undefined} */
let highlight;

async function getHighlight() {
	if (!highlight) {
		const fn = await getMdsvexShikiHighlighter(highlighterOptions);
		highlight = fn;
	}
	return highlight;
}

/**
 * Unescapes a template literal source string, replacing escaped backticks and
 * escaped `${` sequences with their unescaped counterparts.
 * @param {string} raw - The raw template literal source string.
 * @returns {string} The unescaped template literal source string.
 */
function unescapeCodeTemplateSource(raw) {
	return raw.replace(/\\`/g, '`').replace(/\\\$\{/g, '${');
}

const blockRe = /<CodeBlock[\s\S]*?lang="([^"]+)"([\s\S]*?)code=\{`([\s\S]*?)`\}\s*\/>/g;

/**
 * Inlines {@mistweaverco/mdsvex-shiki} output at build time so pre-rendered HTML
 * contains real highlights.
 * @returns {import('vite').Plugin}
 */
export function inlineShikiCodeblocks() {
	return {
		name: 'inline-shiki-codeblocks',
		async transform(code, id) {
			if (!id.endsWith('.svelte')) return null;
			if (!code.includes('<CodeBlock')) return null;

			const h = await getHighlight();
			const matches = [...code.matchAll(blockRe)];
			if (matches.length === 0) return null;

			const replacements = [];
			for (const match of matches) {
				const [full, lang, between, raw] = match;
				const metaMatch = /meta="([^"]*)"/.exec(between);
				const meta = metaMatch ? metaMatch[1] : undefined;
				const source = unescapeCodeTemplateSource(raw);
				const html = await h(source, lang, meta);
				const htmlExpr = '{@html ' + JSON.stringify(html) + '}';
				const replacement = htmlExpr;
				replacements.push({
					index: match.index,
					len: full.length,
					replacement
				});
			}

			replacements.sort((a, b) => b.index - a.index);
			let out = code;
			for (const { index, len, replacement } of replacements) {
				out = out.slice(0, index) + replacement + out.slice(index + len);
			}

			out = out.replace(/^\s*import CodeBlock from '\$lib\/CodeBlock\.svelte';\n?/m, '');
			out = out.replace(/^\s*import CodeBlock from "\$lib\/CodeBlock\.svelte";\n?/m, '');

			return { code: out, map: null };
		}
	};
}
