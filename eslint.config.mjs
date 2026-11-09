import zukhruf, {
  noUnassignedImport,
  reactRouterOnlyThrowError,
} from '@zukhruf/eslint';

export default [
  { ignores: ['**/dist', '**/build', '**/test-output', '.sdk-it'] },
  ...zukhruf.configs.base,
  ...zukhruf.configs.tests,
  {
    files: ['packages/*/src/test-setup.ts'],
    rules: {
      'import-x/no-unassigned-import': [
        'error',
        noUnassignedImport({ allow: ['@testing-library/jest-dom/vitest'] }),
      ],
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/only-throw-error': [
        'error',
        reactRouterOnlyThrowError(),
      ],
    },
  },
];
