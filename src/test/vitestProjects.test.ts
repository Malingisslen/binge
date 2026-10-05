// BIN-1426. `npm test` runs only the `product` project, and the deploy waits for it; the
// `process` project only warns; the emulator suite has a config of its own behind
// `npm run test:rules`. A test file that none of them collects never runs and nothing says so
// (BIN-802), so the split is checked here, inside the project that gates.
import { execFileSync } from 'node:child_process';
import { matchesGlob } from 'node:path';
import { describe, expect, it } from 'vitest';
import config from '../../vitest.config';
import rulesConfig from '../../vitest.rules.config';

type Collector = { name: string; include: string[]; exclude: string[] };
const projects = (config.test?.projects ?? []) as unknown as { test: Collector }[];
const collectors: Collector[] = [
  ...projects.map(({ test }) => test),
  { name: 'rules', include: rulesConfig.test?.include ?? [], exclude: rulesConfig.test?.exclude ?? [] },
];

const TEST_FILE = /\.(test|spec)\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter((file) => TEST_FILE.test(file));

const collectedBy = (file: string) =>
  collectors
    .filter(({ include, exclude }) => include.some((g) => matchesGlob(file, g)) && !exclude.some((g) => matchesGlob(file, g)))
    .map(({ name }) => name);
const orphans = (files: string[]) => files.filter((file) => collectedBy(file).length === 0);

describe('every test file runs in exactly one place', () => {
  it('reads the real file list and the real configs', () => {
    expect(collectedBy('src/test/vitestProjects.test.ts')).toEqual(['product']);
    expect(tracked).toContain('src/test/vitestProjects.test.ts');
    expect(collectedBy('src/test/rules/firestore-rules.test.ts')).toEqual(['rules']);
    expect(tracked).toContain('src/test/rules/firestore-rules.test.ts');
  });

  // `product` and `process` both exclude src/test/rules/, so a file there that the emulator
  // config does not match is collected by nothing, and must not be exempted.
  it('counts a file in the emulator directory that the emulator config misses as an orphan', () => {
    const missed = ['src/test/rules/x.spec.ts', 'src/test/rules/x.test.tsx'];
    expect(orphans(missed)).toEqual(missed);
  });

  it('collects every tracked test file', () => {
    expect(orphans(tracked)).toEqual([]);
  });

  it('never collects a file in two places', () => {
    expect(tracked.filter((file) => collectedBy(file).length > 1)).toEqual([]);
  });

  // They sit under docs/org/ beside the process tests, but they read firestore.rules and the
  // client's id builder: a red one is a write production would refuse. Moving them to
  // `process` still satisfies "exactly one place", so they are pinned by name.
  it.each(['docs/org/rules-doc-id-symmetry.test.mjs', 'docs/org/rules-id-client-symmetry.test.mjs'])(
    'keeps the rules parity test %s in the project that gates the deploy',
    (file) => {
      expect(tracked).toContain(file);
      expect(collectedBy(file)).toEqual(['product']);
    },
  );
});
