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
 * The last significant character of a completed VALUE — after one of these a `/` divides,
 * it does not open a regex. Identifiers and numbers, a closing `)` or `]`, and the closing
 * delimiter of a string, a template literal or a regex literal, which this scanner records
 * as `"`, `` ` `` and `/` respectively.
 *
 * The three delimiters are here because leaving them out is the SILENT direction: `` `a` / 2 ``
 * would open a regex that then blanks everything to the end of the line, swallowing an
 * `await` written after it and leaving the guard green. That is the failure this whole file
 * exists to prevent, so it must not be reintroduced by the fix for it.
 */
const DIVIDES_AFTER = /[A-Za-z0-9_$)\]`"/]/;

/** Keywords after which a `/` opens a regex literal even though they are word characters. */
const REGEX_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'do', 'else',
  'case', 'yield', 'await',
]);

function opensRegex(lastSig: string, lastWord: string): boolean {
  if (lastSig === '') return true;
  if (DIVIDES_AFTER.test(lastSig)) return REGEX_KEYWORDS.has(lastWord);
  return true;
}

/**
 * Blank out line comments, block comments, string literals, regex literals and the TEXT of
 * template literals, replacing each character with a space so every surviving index still
 * lines up with the input. What sits inside a `${…}` interpolation is code and survives.
 *
 * The guard scans for the keyword `await`, and the word occurs in prose — the sibling
 * test's own explanation says "before this `await` resumes". A raw keyword search over a
 * segment that happens to carry no such comment today would be green by accident and
 * would redden on the next comment somebody writes: a broken regex that reads like a
 * production finding.
 *
 * WHAT THIS DOES NOT SEE, named rather than implied (BIN-1069, BIN-1048/852's family — the
 * failure mode of a source scan is its own lexer, and the dangerous one is the scan that
 * claims to have no blind spots):
 *
 * - Whether a `/` opens a regex or divides is decided from the preceding token, the way
 *   every lexer without a parser decides it. See DIVIDES_AFTER for the set. `f(x)/re/.test(y)`
 *   is read as division, so an `await` written between those two slashes stays visible
 *   rather than being blanked. That direction is the safe one — it reddens the guard rather
 *   than silencing it.
 * - `}` is the case that set genuinely cannot settle: after a block `/` opens a regex, after
 *   an object literal it divides, and this scanner takes the regex reading. So
 *   `({ a: 1 }) / 2` is fine (the `)` decides it) but a bare `{…} / 2` is not, and that one
 *   IS the silencing direction. No such expression exists in `processTitle`.
 * - An identifier spelled with a unicode escape (`await`) is not the keyword `await`
 *   to this scan, and V8 would run it as one.
 */
export function blankCommentsAndStrings(src: string): string {
  const out = src.split('');
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' ';
  };

  // `code` is both the top level and each `${…}` interpolation; `template` is the literal
  // text between them. An interpolation frame counts its OWN braces, so the `}` that closes
  // it is told apart from the ones inside an object literal written in the interpolation.
  const stack: Array<{ kind: 'code' | 'template'; depth: number }> = [{ kind: 'code', depth: 0 }];
  let lastSig = '';
  let lastWord = '';
  let i = 0;

  while (i < src.length) {
    const top = stack[stack.length - 1];

    if (top.kind === 'template') {
      if (src[i] === '\\') { blank(i, i + 2); i += 2; continue; }
      if (src[i] === '$' && src[i + 1] === '{') {
        blank(i, i + 2);
        stack.push({ kind: 'code', depth: 0 });
        lastSig = '{';
        lastWord = '';
        i += 2;
        continue;
      }
      if (src[i] === '`') {
        blank(i, i + 1);
        stack.pop();
        lastSig = '`';
        lastWord = '';
        i += 1;
        continue;
      }
      blank(i, i + 1);
      i += 1;
      continue;
    }

    const two = src.slice(i, i + 2);
    if (two === '//') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? src.length : end;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (two === '/*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }

    const ch = src[i];
    if (ch === '"' || ch === '\'') {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        // A quote left unclosed on its line ends there. Running on to the next quote
        // anywhere below blanks real code — that was BIN-1069's second seam.
        if (src[j] === '\n') break;
        if (src[j] === ch) { j += 1; break; }
        j += 1;
      }
      blank(i, j);
      i = j;
      lastSig = '"';
      lastWord = '';
      continue;
    }
    if (ch === '`') {
      blank(i, i + 1);
      stack.push({ kind: 'template', depth: 0 });
      i += 1;
      continue;
    }
    if (ch === '/' && opensRegex(lastSig, lastWord)) {
      let j = i + 1;
      let inClass = false;
      while (j < src.length) {
        const c = src[j];
        if (c === '\\') { j += 2; continue; }
        if (c === '\n') break;
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) { j += 1; break; }
        j += 1;
      }
      blank(i, j);
      i = j;
      lastSig = '/';
      lastWord = '';
      continue;
    }

    if (ch === '{') {
      top.depth += 1;
    } else if (ch === '}') {
      if (top.depth === 0 && stack.length > 1) {
        blank(i, i + 1);
        stack.pop();
        lastSig = '}';
        lastWord = '';
        i += 1;
        continue;
      }
      top.depth -= 1;
    }

    if (!/\s/.test(ch)) {
      lastSig = ch;
      lastWord = /[A-Za-z0-9_$]/.test(ch) ? lastWord + ch : '';
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
    // without a mutated file on disk. The shapes this scan still cannot see are named in
    // `blankCommentsAndStrings`'s own docblock.
    //
    // It goes through `expectSeenAt` for the reason that helper's docblock gives: its own
    // title says the index MOVES, and until BIN-1069 nothing in its body checked where it
    // moved to. Measured: with `firstAwaitIndex` stubbed to return -1 — the guard destroyed
    // outright — this test stayed green while six of its seven siblings reddened.
    expectSeenAt('await Promise.resolve();');
  });

  it('an await written in a COMMENT above the fetch does not trip the guard', () => {
    // The negative control, and the reason blankCommentsAndStrings exists. Without it
    // this fixture reports a defect that is not there.
    const body = processTitleBody(source);
    const at = firstAwaitIndex(body);
    const withProse = `${body.slice(0, at)}// nothing is await-ed above this line\n  ${body.slice(at)}`;
    expect(awaitsTheFetch(withProse, firstAwaitIndex(withProse))).toBe(true);
  });

  /**
   * Insert `mutation` immediately above the real first await and assert the scan finds the
   * await INSIDE the mutation — at that exact index, not merely somewhere.
   *
   * Asserting only `awaitsTheFetch(...) === false` is not enough, and this file learned that
   * the hard way: a blanker broken badly enough to blank the rest of the body returns -1
   * from `firstAwaitIndex`, and `awaitsTheFetch(body, -1)` is false too. The weaker
   * assertion is satisfied by "the guard reddens correctly" and by "the guard is destroyed"
   * alike, so a mutation that destroys the scan survives it. Pinning the index separates them.
   *
   * The mutant is asserted present before AND after the run, per this repo's mutation rule.
   */
  const expectSeenAt = (mutation: string) => {
    const body = processTitleBody(source);
    const at = firstAwaitIndex(body);
    // The baseline comes from the same function under test, so it has to be checked or the
    // comparison below can be satisfied by two equal nonsense values. Measured: with
    // `firstAwaitIndex` stubbed to return -1, the expected index becomes `-1 + 0` for any
    // mutation whose `await` sits at offset 0, and the assertion passed against a scan that
    // finds nothing anywhere. This line is what makes a destroyed scan fail every fixture.
    expect(at, 'the real body has no await at all — every fixture below is meaningless')
      .toBeGreaterThan(-1);
    const mutated = `${body.slice(0, at)}${mutation}\n  ${body.slice(at)}`;
    expect(mutated, 'mutant absent before the run').toContain(mutation);
    expect(firstAwaitIndex(mutated)).toBe(at + mutation.indexOf('await'));
    expect(awaitsTheFetch(mutated, firstAwaitIndex(mutated))).toBe(false);
    expect(mutated, 'mutant absent after the run').toContain(mutation);
  };

  it('an await inside a ${…} INTERPOLATION above the fetch trips the guard', () => {
    // BIN-1069's first seam, measured. `${…}` holds code, so an await written there runs
    // before the fetch exactly as a statement would — and a blanker that treats the whole
    // template as one string never sees it. That is the silent direction: the guard stays
    // green while the invariant it exists for is gone.
    expectSeenAt('const label = `${await lookupName(tmdbId)}`;');
  });

  it('an await in a TEMPLATE literal\'s text above the fetch stays invisible', () => {
    // The interpolation fix must not cost the text case: template TEXT is still text.
    const body = processTitleBody(source);
    const at = firstAwaitIndex(body);
    const quiet = `${body.slice(0, at)}const note = \`nothing is await-ed here\`;\n  ${body.slice(at)}`;
    expect(firstAwaitIndex(quiet)).toBe(at + 'const note = `nothing is await-ed here`;\n  '.length);
    expect(awaitsTheFetch(quiet, firstAwaitIndex(quiet))).toBe(true);
  });

  it('a regex literal carrying a quote does not blank the code after it', () => {
    // BIN-1069's second seam. `/'/` used to open the quote branch, which then ran on to the
    // next quote anywhere below and blanked real code on the way — including this await.
    expectSeenAt('const q = /\'/; await Promise.resolve();');
  });

  it('a DIVISION is not mistaken for a regex, so the await after it is still seen', () => {
    // The fix for the seam above must not open one in the other direction. Reading `/` as
    // always-opens-a-regex blanks from the division to the end of the line — swallowing
    // this await and silencing the guard (BIN-852/1048's shape).
    expectSeenAt('const n = (a) / (b); await Promise.resolve();');
  });

  it('a division after a TEMPLATE LITERAL is not mistaken for a regex either', () => {
    // The first fix for the division case listed identifiers, numbers, `)` and `]` but not
    // the delimiters that close a value: a backtick, a quote, a regex's own slash. So
    // `` `abc` / 2 `` opened a regex that blanked to the end of the line and swallowed the
    // await after it — the guard reported healthy. Found by the test review of this very
    // batch, with a probe, not by reading. Both remaining delimiters are pinned below.
    expectSeenAt('const x = `abc` / 2; await Promise.resolve();');
  });

  it('a division after a STRING literal is not mistaken for a regex either', () => {
    // The slash must sit IMMEDIATELY after the closing quote. A first draft of this test
    // wrote `'abc'.length / 2`, where the preceding token is an identifier — so it passed
    // against the delimiter-blind version too and proved nothing about the quote.
    expectSeenAt("const y = 'abc' / 2; await Promise.resolve();");
  });

  it('the guard reads the real declaration, and says so when the anchor is gone', () => {
    // The failure mode of a source scan is its own regex, not the production code
    // (BIN-1048/852). If the anchor stops matching, this must throw a named error rather
    // than silently scan nothing and pass.
    const renamed = source.replace('async function processTitle(', 'async function renamed(');
    expect(() => processTitleBody(renamed)).toThrow(/not found in runNotify\.ts/);
  });
});
