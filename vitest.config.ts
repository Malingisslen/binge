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
      // recap-upload.mjs's pure logic lives in an admin-free sibling module so it can run here
      // too — the script itself imports firebase-admin and is never matched by this glob.
      'functions/scripts/**/*.{test,spec}.mjs',
    ],
    exclude: ['node_modules', '.next', 'out', 'src/test/rules/**'],
    css: false,
    // Report-only coverage (BIN-525): `npm run test:coverage` / CI's non-blocking
    // step. Deliberately NO `thresholds` — a blocking coverage floor is a founder
    // decision, explicitly deferred. Baseline at introduction (2026-07-16) is
    // recorded in the CI step comment.
    coverage: {
      provider: 'v8',
      // Cover the frontend source, including untested files, so the number is
      // honest — not just "coverage of files that happen to be imported by tests".
      // functions/src is deliberately NOT included: its firebase-admin-importing
      // entrypoints are untestable in the root toolchain (only their pure
      // `logic.ts`/helper siblings run here) and fail the coverage remap with 30
      // noisy PARSE_ERROR traces, silently skewing the denominator.
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        '**/*.{test,spec}.{ts,tsx}',
        '**/*.d.ts',
        'src/test/**',
        // Emulator-only rules tests are excluded from `npm test` (see `exclude`
        // above), so their helpers shouldn't count against unit coverage either.
      ],
      reporter: ['text-summary'],
    },
  },
});
