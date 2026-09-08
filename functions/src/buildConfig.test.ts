// BIN-1110. The two halves of the functions type-checking contract, pinned.
//
// WHAT WENT WRONG. `functions/tsconfig.json` had `include: ["src"]` and no `exclude`, so
// every `*.test.ts` under `src` was compiled into `lib/` and shipped to Cloud Functions.
// Two costs. Test code rode along in the deployed bundle. And the test files had to obey
// the BUILD's `module: commonjs`, where `import.meta` is a compile error — which vitest
// transpiles happily, so the whole suite stayed green and the failure surfaced only at
// `firebase deploy --only functions`, by hand, last of all. It did: a source-scanning test
// used `fileURLToPath(import.meta.url)` and the deploy fell over.
//
// WHY THIS FILE EXISTS. Excluding the tests from the build is the easy half. The dangerous
// half is what happens to the type-checking that leaves with them: before BIN-1110 the
// build was the ONLY thing reading those files, and the root `tsc` cannot help — the root
// tsconfig.json excludes `functions` outright. Dropping the exclude without a replacement
// would have traded a loud failure for a silent one, which is strictly worse.
//
// So this asserts BOTH halves and would fail on either being undone.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = join(fileURLToPath(import.meta.url), '..');
const FUNCTIONS = join(HERE, '..');
const REPO = join(FUNCTIONS, '..');

const readJson = (p: string) =>
  JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown> & {
    compilerOptions?: Record<string, unknown>;
    include?: string[];
    exclude?: string[];
    scripts?: Record<string, string>;
  };

describe('the functions BUILD does not compile test files', () => {
  // BOTH suffixes the runner collects. `vitest.config.ts` includes
  // `functions/src/**/*.{test,spec}.ts`, so a `.spec.ts` file is a test file by the
  // runner's own definition — and an exclude covering only `.test.ts` would ship exactly
  // the kind of file it meant to leave behind, one suffix over. There are none today,
  // which is what makes closing it cheap rather than what makes it unnecessary.
  it('tsconfig.json excludes every suffix the runner collects', () => {
    const cfg = readJson(join(FUNCTIONS, 'tsconfig.json'));
    expect(cfg.exclude).toContain('src/**/*.test.ts');
    expect(cfg.exclude).toContain('src/**/*.spec.ts');
  });

  // The build must still emit — `noEmit` here would produce an empty lib/ and a deploy that
  // silently ships nothing rather than failing.
  it('the build config still emits into lib/', () => {
    const cfg = readJson(join(FUNCTIONS, 'tsconfig.json'));
    expect(cfg.compilerOptions?.outDir).toBe('lib');
    expect(cfg.compilerOptions?.noEmit).toBeUndefined();
  });
});

describe('the test files are still type-checked, on the path commits actually take', () => {
  // The replacement config. It must READ the tests (no exclude) and never WRITE — an
  // outDir here would race the build's own lib/.
  it('tsconfig.typecheck.json reads src with nothing excluded, and emits nothing', () => {
    const cfg = readJson(join(FUNCTIONS, 'tsconfig.typecheck.json'));
    expect(cfg.include).toEqual(['src']);
    expect(cfg.exclude).toEqual([]);
    expect(cfg.compilerOptions?.noEmit).toBe(true);
  });

  // The difference that makes the two configs necessary rather than merely tidy: vitest
  // runs these files as ESM, so `import.meta` is legal there and an error in the build.
  it('the typecheck config reads the tests as the ESM vitest runs', () => {
    const cfg = readJson(join(FUNCTIONS, 'tsconfig.typecheck.json'));
    expect(cfg.compilerOptions?.module).toBe('es2022');
  });

  // BOTH configs, and the order is not decorative. The BUILD config is the only one that
  // reads the shipped sources as CommonJS, where `import.meta` is an error; the typecheck
  // config reads them as ESM, where it is legal. Running only the second would let an
  // `import.meta` in a PRODUCTION file pass every gate and fail at `firebase deploy`, by
  // hand, last of all — BIN-1110's own failure moved one file class over. That is exactly
  // what this batch did until the integration reviewer measured it.
  it('functions/package.json runs BOTH configs under `typecheck`', () => {
    const pkg = readJson(join(FUNCTIONS, 'package.json'));
    expect(pkg.scripts?.typecheck).toBe(
      'tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.typecheck.json',
    );
  });

  // The half that matters most, and the one BIN-776's class is about: a check nothing runs
  // is not a check. `pr-checks.yml` fires on `pull_request`, which in this repo means
  // dependabot alone — every human commit goes straight to main. So the wiring that counts
  // is lefthook's.
  //
  // What this actually guarantees, stated rather than implied: the text was not deleted or
  // reworded. It is a source scan, so a block commented out line by line satisfies it —
  // measured, not supposed. Proving the command RUNS would mean invoking lefthook itself,
  // and nothing cheaper exists; the same limit is already accepted for the workflow-map
  // guard and for the refusal wiring under functions/scripts.
  it('lefthook pre-commit NAMES it, not only pr-checks.yml', () => {
    const lefthook = readFileSync(join(REPO, 'lefthook.yml'), 'utf8');
    expect(lefthook).toMatch(
      /typecheck-functions:[\s\S]*?run: npm --prefix functions run typecheck/,
    );
    expect(lefthook).toMatch(/typecheck-functions:[\s\S]*?- "functions\/\*\*\/\*\.ts"/);
  });

  // The other wiring, and the one this batch nearly broke. pr-checks.yml's step ran a bare
  // `tsc` from functions/, which reads tsconfig.json — the config now taught to skip test
  // files. Left alone, the commit that stopped SHIPPING test code would also have stopped
  // CHECKING it on dependabot's path, which is the only path that workflow fires on. A bare
  // `tsc` must never come back here.
  it('pr-checks.yml runs the named script, never a bare tsc', () => {
    const wf = readFileSync(join(REPO, '.github', 'workflows', 'pr-checks.yml'), 'utf8');
    expect(wf).toMatch(/name: Typecheck functions[\s\S]*?run: npm run typecheck/);
    expect(wf).not.toMatch(/name: Typecheck functions[\s\S]*?run: npx tsc --noEmit/);
  });
});
