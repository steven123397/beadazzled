import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier/flat';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist', 'node_modules', 'src-tauri/target', 'src-tauri/gen', 'target', '.upstream'],
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    rules: {
      eqeqeq: ['error', 'always'],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportDefaultDeclaration',
          message: 'Use named exports; default exports are reserved for framework entry points.',
        },
      ],
    },
  },
  {
    // Framework entry points require a default export.
    files: ['vite.config.ts', 'vitest.config.ts', 'playwright.config.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  prettierConfig
);
