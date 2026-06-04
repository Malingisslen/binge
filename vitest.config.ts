import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Native Vite support for tsconfig `paths` — no extra plugin needed.
    tsconfigPaths: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // Frontend tests live under src/. The pure (firebase-free) Cloud Function
    // aggregation helpers under functions/src are also unit-tested here so they
    // run with the existing root toolchain — functions/ has no test runner of
    // its own. Only *.test.ts files are matched, never the firebase-importing
    // function entrypoints.
    include: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'functions/src/**/*.{test,spec}.ts',
    ],
    exclude: ['node_modules', '.next', 'out'],
    css: false,
  },
});
