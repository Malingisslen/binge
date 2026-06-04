import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node', globals: true,
    include: ['src/test/rules/**/*.test.ts'],
    testTimeout: 20000,
  },
});
