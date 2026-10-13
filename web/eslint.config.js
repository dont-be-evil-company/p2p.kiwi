import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import tsEslint from 'typescript-eslint';
export default [
	...tsEslint.configs.recommended,
	prettier,
	...svelte.configs.prettier,
	{
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: 'module',
			parser: svelte.parser,
			parserOptions: {
				parser: tsEslint.parser,
				extraFileExtensions: ['.svelte']
			}
		}
	},
	{
		ignores: ['node_modules/**', 'build/**', '.svelte-kit/**', 'vite-plugins/**']
	}
];
