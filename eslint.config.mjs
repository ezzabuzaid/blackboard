import zukhruf, {
  noUnassignedImport,
  reactRouterOnlyThrowError,
} from '@zukhruf/eslint';
import modernNode from '@zukhruf/eslint/modern-node';
import { defineConfig } from 'eslint/config';

export default defineConfig([
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
  // modern-node is for code that runs on Node. apps/web and packages/* are React
  // browser bundles with a DOM lib: MDN marks Error.isError "Limited
  // availability", so a fix there can throw in a browser.
  {
    ignores: ['apps/web/**', 'packages/**'],
    plugins: { 'modern-node': modernNode },
    extends: ['modern-node/recommended'],
    rules: {
      // The API runs on the node:24 image of deploy/dokploy/Dockerfile.
      // Uint8Array.prototype.toHex and fromHex need Node 26.
      'unicorn/prefer-uint8array-hex': 'off',
    },
  },
]);
