import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite-plus'

export default defineConfig({
  plugins: [
    svelte({
      include: /\.svelte($|\?)/,
      compilerOptions: {
        runes: true,
      },
    }),
  ],
  fmt: {
    singleQuote: true,
    semi: false,
    printWidth: 100,
    ignorePatterns: [
      '**/*.d.ts',
      '.vale/**',
      'build/**',
      'dist/**',
      'out/**',
      'src/i18n/i18n-svelte.ts',
      'src/i18n/i18n-types.ts',
      'src/i18n/i18n-util.*',
    ],
  },
  lint: {
    ignorePatterns: [
      '**/*.d.ts',
      '.vale/**',
      'build/**',
      'dist/**',
      'out/**',
      'src/i18n/i18n-svelte.ts',
      'src/i18n/i18n-types.ts',
      'src/i18n/i18n-util.*',
    ],
    options: {
      typeAware: false,
      typeCheck: false,
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    server: {
      deps: {
        inline: ['sdp-compact', 'sdp-transform', 'fflate', 'ts-mls'],
      },
    },
  },
})
