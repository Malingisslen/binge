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
    // Force a UTC+ timezone so date-logic tests are a real regression guard.
    // CI runs on UTC runners where local==UTC, which hides any revert to
    // toISOString()-style UTC date handling (the BIN-39 off-by-one bug). Pinning
    // Europe/Stockholm here makes `npm test` exercise the offset everywhere —
    // dev machines AND CI — instead of relying on a per-workflow env var.
    env: { TZ: 'Europe/Stockholm' },
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
    exclude: ['node_modules', '.next', 'out', 'src/test/rules/**'],
    css: false,
  },
});
