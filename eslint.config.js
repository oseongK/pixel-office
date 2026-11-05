import js from '@eslint/js';
import globals from 'globals';
import html from 'eslint-plugin-html';

export default [
  { ignores: ['node_modules/', 'test-results/', 'playwright-report/'] },
  js.configs.recommended,
  {
    files: ['**/*.html'],
    plugins: { html },
    languageOptions: { globals: globals.browser, sourceType: 'script' },
  },
  {
    files: ['**/*.js'],
    languageOptions: { globals: { ...globals.node }, sourceType: 'module' },
  },
  {
    files: ['tests/e2e.spec.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
