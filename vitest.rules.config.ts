import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: {
    // BIN-655: the emulator suite may now import production modules (buildAddWrite, so
    // the rules are tested against the payload the app actually writes rather than a
    // hand-typed shape — a hand-typed shape can only prove that the shape somebody
    // typed is legal, which is exactly the check that missed `notes`). Those modules
    // use `@/` paths, and without this the import fails at COLLECTION time: vitest
    // reports the file as failed but still prints a green "Tests N passed" line for
    // the ones that did load, which reads as a pass at a glance.
    tsconfigPaths: true,
  },
  test: {
    environment: 'node', globals: true,
    include: ['src/test/rules/**/*.test.ts'],
    testTimeout: 20000,
  },
});
