import zukhruf from '@zukhruf/eslint';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['**/dist', '**/test-output', '.sdk-it'] },
  // zukhruf/tests has no parser of its own: zukhruf/base brings one, and this
  // repo does not turn base on.
  tseslint.configs.base,
  ...zukhruf.configs.tests,
];
