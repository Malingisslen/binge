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
      // The blast-radius router (docs/org/route.mjs) decides whether a stakeholder panel is
      // convened and whether a sprint may pick a ticket up at all, so its tests belong in the
      // suite everything else runs in — its own `--selftest` flag is wired to no gate (BIN-802).
      'docs/org/**/*.{test,spec}.mjs',
      // BIN-850: the release-path guards under scripts/ — check-public-env.mjs (the linter
      // that exists because NEXT_PUBLIC_FCM_VAPID_KEY was missing from the production build
      // for three months, BIN-849) and check-workflow-map.mjs. They had tests, and `npm test`
      // ran neither: BIN-802's "a test file outside the include globs is silently never run"
      // in a second directory. They were covered in CI by a bespoke `node --test` step
      // (BIN-838); that step is removed in the same commit as this line, so the two must
      // move together. scripts-self-tests-present.test.mjs replaces its MIN floor.
      'scripts/**/*.{test,spec}.mjs',
      // BIN-931: the custom ESLint rule that structurally forbids a bare streamingOffers
      // doc id. It replaced a set of regex source scans that lived in
      // functions/src/streamingOffers/backfillIds.test.ts and ran with the suite, so its
      // replacement has to run with the suite too — added here rather than left to be
      // discovered later, which is BIN-802's "a test file outside the include globs is
      // silently never run by `npm test` while passing when invoked by hand".
      'eslint-rules/**/*.{test,spec}.mjs',
      // BIN-1009: the PostToolUse hooks. `freshness.mjs` is the mechanism that CREATES
      // WORK ORDERS — it stamps `.claude/state/workflow-map-stale.json`, and CLAUDE.md
      // tells the next session to re-trace the flows it names. A false positive there
      // sends a session to re-trace a file nobody edited; BIN-790 is the ticket filed
      // about it. (A count of past incidents stood here and was struck — two of the ids
      // it named were the opposite failure, a correct flag left unread.) It had no test
      // at all, and could not have one: it ran its CLI at import and called
      // process.exit(0), so importing it from a test killed the runner.
      // Added here in the SAME commit that guards its entry point, because the widening is
      // only provably non-silent once a matching file exists — BIN-802's second half.
      '.claude/hooks/**/*.{test,spec}.mjs',
    ],
    exclude: ['node_modules', '.next', 'out', 'src/test/rules/**'],
    css: false,
    // Report-only coverage (BIN-525). Deliberately NO `thresholds` — a blocking
    // coverage floor is a founder decision, explicitly deferred.
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
