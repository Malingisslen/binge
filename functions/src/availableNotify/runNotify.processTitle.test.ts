import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * BIN-1060. A source-scanning guard over ONE property of `processTitle`, and only that
 * one: its first `await` is the `io.fetchSeFlatrate` call, with nothing awaited above it.
 *
 * Why that property is load-bearing. `src/test/rules/available-notify-orchestrator.test.ts`
 * ("loopens form") is the assertion that sees the per-title loop being turned into a
 * `Promise.all` — a change invisible to every other test there while multiplying this
 * job's TMDB request rate by the number of watched titles. It observes the event itself:
 * a controllable promise resolved INSIDE the `fetchSeFlatrate` double when title 1's
 * fetch happens, awaited before asserting that title 2 has not been fetched.
 *
 * That observation is decisive only because a `map()` over the titles would drive both
 * of them into the double in ONE synchronous burst — which holds exactly while nothing
 * is awaited before the fetch. Insert an `await` above it (a cache check, a permission
 * check, an early per-title read) and the sibling test stays green while the reasoning
 * under it is gone: a reintroduced `Promise.all` would then race microtask scheduling
 * instead of failing deterministically. It would degrade SILENTLY, which is the family
 * this repo keeps getting bitten by.
 *
 * Scope: this pins `processTitle`'s own preamble. It says nothing about the outer
 * `for…of` in `runAvailableNotify` — that loop is what the sibling test asserts directly.
 *
 * It lives here rather than beside the test it protects because the rules tests under
 * `src/test/rules` run only under `npm run test:rules` (emulator + Java on PATH), while a
 * test file under `functions/src` runs with `npm test`. A guard against a silent
 * degradation must not itself be the skippable one.
 */

// From the repo root, the way the sibling source scans resolve their targets
// (src/lib/watchlistDocKey.test.ts) — vitest runs with cwd at the root.
const SOURCE_PATH = join(process.cwd(), 'functions', 'src', 'availableNotify', 'runNotify.ts');

/**
 * Blank out line comments, block comments and string/template literals, replacing each
 * character with a space so every surviving index still lines up with the input.
 *
 * The guard scans for the keyword `await`, and the word occurs in prose — the sibling
 * test's own explanation says "before this `await` resumes". A raw keyword search over a
 * segment that happens to carry no such comment today would be green by accident and
 * would redden on the next comment somebody writes: a broken regex that reads like a
 * production finding.
 */
export function blankCommentsAndStrings(src: string): string {
  const out = src.split('');
  let i = 0;
  const blankTo = (end: number) => {
    for (let k = i; k < end && k < out.length; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === '//') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? src.length : end;
      blankTo(stop);
      i = stop;
      continue;
    }
    if (two === '/*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      blankTo(stop);
      i = stop;
      continue;
    }
    const quote = src[i];
    if (quote === '"' || quote === '\'' || quote === '`') {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === quote) { j += 1; break; }
        j += 1;
      }
      blankTo(j);
      i = j;
      continue;
    }
    i += 1;
  }
  return out.join('');
}

/**
 * The body of `processTitle`, brace-balanced, read from the file rather than pasted in.
 * A hand-copied body drifts from the source silently and would never catch a regression —
 * it would only ever prove that the copy still says what the copy says.
 *
 * Throws rather than returning empty when the declaration is not found: a guard that
 * quietly finds nothing to check is the shape that reports PASS forever.
 */
export function processTitleBody(src: string): string {
  const decl = 'async function processTitle(';
  const at = src.indexOf(decl);
  if (at === -1) {
    throw new Error(
      `BIN-1060 guard: "${decl}" not found in runNotify.ts. If the function was renamed or its `
      + 'signature reformatted, update this guard — do not delete it.',
    );
  }
  const blanked = blankCommentsAndStrings(src);
  const open = blanked.indexOf('{', at);
  if (open === -1) throw new Error('BIN-1060 guard: no opening brace after processTitle(');
  let depth = 0;
  for (let i = open; i < blanked.length; i++) {
    if (blanked[i] === '{') depth += 1;
    else if (blanked[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  throw new Error('BIN-1060 guard: processTitle body is not brace-balanced');
}

/** Index of the first `await` KEYWORD in a body, ignoring comments and string literals. */
export function firstAwaitIndex(body: string): number {
  return blankCommentsAndStrings(body).search(/\bawait\b/);
}

/** True when the `await` at `at` is immediately followed by the fetch call. */
function awaitsTheFetch(body: string, at: number): boolean {
  return /^\s*io\.fetchSeFlatrate\s*\(/.test(body.slice(at + 'await'.length));
}

describe('processTitle — the invariant the sequential-loop test rests on', () => {
  const source = readFileSync(SOURCE_PATH, 'utf8');

  it('the FIRST await in processTitle is the io.fetchSeFlatrate call', () => {
    const body = processTitleBody(source);
    const at = firstAwaitIndex(body);
    expect(at, 'processTitle awaits nothing at all — the sibling test cannot observe entry')
      .toBeGreaterThan(-1);
    expect(
      awaitsTheFetch(body, at),
      'An await was inserted before io.fetchSeFlatrate. src/test/rules/available-notify-orchestrator.test.ts '
      + '("loopens form") stays green either way, but it no longer proves the per-title loop is sequential: '
      + 'a Promise.all would race microtask scheduling instead of failing. Move the new await below the fetch, '
      + 'or replace that test with one that does not depend on this ordering.',
    ).toBe(true);
  });

  it('an await STATEMENT inserted above the fetch moves the first-await index', () => {
    // The positive control. A guard that never reddens is not a guard, and this is the
    // exact mutation the ticket is about, applied in memory so the reaction is proven
    // without a mutated file on disk.
    //
    // It proves this fixture's shape and no more. A source scan has blind spots, and this
    // one has a measured one: `blankCommentsAndStrings` treats a template literal as a
    // single span, so an `await` written inside `${…}` above the anchor is blanked and not
    // seen. Filed as BIN-1069. Nothing here claims the scan catches every shape.
    const body = processTitleBody(source);
    const at = firstAwaitIndex(body);
    const mutated = `${body.slice(0, at)}await Promise.resolve();\n  ${body.slice(at)}`;
    expect(awaitsTheFetch(mutated, firstAwaitIndex(mutated))).toBe(false);
  });

  it('an await written in a COMMENT above the fetch does not trip the guard', () => {
    // The negative control, and the reason blankCommentsAndStrings exists. Without it
    // this fixture reports a defect that is not there.
    const body = processTitleBody(source);
    const at = firstAwaitIndex(body);
    const withProse = `${body.slice(0, at)}// nothing is await-ed above this line\n  ${body.slice(at)}`;
    expect(awaitsTheFetch(withProse, firstAwaitIndex(withProse))).toBe(true);
  });

  it('the guard reads the real declaration, and says so when the anchor is gone', () => {
    // The failure mode of a source scan is its own regex, not the production code
    // (BIN-1048/852). If the anchor stops matching, this must throw a named error rather
    // than silently scan nothing and pass.
    const renamed = source.replace('async function processTitle(', 'async function renamed(');
    expect(() => processTitleBody(renamed)).toThrow(/not found in runNotify\.ts/);
  });
});
