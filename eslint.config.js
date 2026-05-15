import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'artifacts/**',
      'coverage/**',
      'src-tauri/target/**',
      'src-tauri/gen/**',
      'node_modules/**',
      '**/*.tsbuildinfo',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    },
  },
  {
    files: ['scripts/**/*.ts', 'tests/**/*.ts', 'vite.config.ts', 'vitest.config.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['eslint.config.js'],
    languageOptions: {
      parserOptions: {
        projectService: false,
      },
    },
    extends: [tseslint.configs.disableTypeChecked],
  },
);
