import nextPlugin from '@next/eslint-plugin-next';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/coverage/**',
      '**/next-env.d.ts',
      'prototype/**',
      'review/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: [
      'apps/web/app/**/*.{ts,tsx}',
      'apps/web/components/**/*.{ts,tsx}',
      'apps/web/lib/**/*.{ts,tsx}',
      'apps/web/middleware.ts',
    ],
    plugins: {
      '@next/next': nextPlugin,
    },
    settings: {
      next: { rootDir: 'apps/web' },
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },
  {
    files: ['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['apps/**/tests/**/*.{ts,tsx}', 'packages/**/tests/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
);
