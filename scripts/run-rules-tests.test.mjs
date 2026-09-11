// Self-test for the rules-test wrapper (BIN-1137).
//
// Run: npm test
//
// Every case here drives the decision through fabricated input. That is deliberate:
// the thing being proved is that the wrapper REFUSES a run it cannot vouch for, and
// an emulator would have to be broken on purpose to produce those states. The pure
// `verdict()` boundary is what makes them reachable at all.
//
// Three mutations must fail this file. They are named next to the cases they belong
// to, so a future reader can re-run them rather than trust this sentence:
//   1. drop the `count < min` branch          → "a shrunken suite" goes green
//   2. drop the `count === null` branch       → "an unreadable report" goes green
//   3. return ok on a non-zero exit code      → "the child failed" goes green

import { test, expect, describe } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  verdict, looksLikePortTaken, describePortHolder, buildAltConfig, parsePort, MIN_TESTS,
} from './run-rules-tests.mjs';

describe('verdict', () => {
  test('a healthy run above the floor passes', () => {
    expect(verdict({ exitCode: 0, count: MIN_TESTS + 13 })).toMatchObject({ ok: true, reason: 'passed' });
  });

  // Mutation 3: `if (exitCode !== 0)` removed.
  test('a non-zero exit fails even when the count is healthy', () => {
    expect(verdict({ exitCode: 1, count: MIN_TESTS + 13 })).toMatchObject({ ok: false, reason: 'child-failed' });
  });

  // Mutation 1: the floor comparison removed. This is the silent-zero: the emulator
  // started, vitest ran, exited 0, and registered nothing.
  test('exit 0 with zero tests fails', () => {
    expect(verdict({ exitCode: 0, count: 0 })).toMatchObject({ ok: false, reason: 'below-floor' });
  });
  test('one test below the floor fails', () => {
    expect(verdict({ exitCode: 0, count: MIN_TESTS - 1 })).toMatchObject({ ok: false, reason: 'below-floor' });
  });
  test('exactly the floor passes', () => {
    expect(verdict({ exitCode: 0, count: MIN_TESTS })).toMatchObject({ ok: true });
  });

  // Mutation 2: the null branch removed. An unreadable report and a healthy run must
  // never produce the same verdict — that equivalence IS the defect class.
  test('an unreadable report fails rather than passing for lack of a number', () => {
    expect(verdict({ exitCode: 0, count: null })).toMatchObject({ ok: false, reason: 'unreadable-report' });
  });
  test('a non-integer count fails', () => {
    expect(verdict({ exitCode: 0, count: '513' })).toMatchObject({ ok: false, reason: 'unreadable-report' });
  });

  test('the floor is a literal, not derived from the run it is judging', () => {
    // A floor computed from the same run it grades is satisfied by any run at all.
    // Pinned on the declaration so a rename on the other side fails here.
    expect(Number.isInteger(MIN_TESTS)).toBe(true);
    expect(verdict({ exitCode: 0, count: 1, min: MIN_TESTS })).toMatchObject({ ok: false });
  });
});

describe('looksLikePortTaken', () => {
  test('recognises the CLI wording', () => {
    expect(looksLikePortTaken('Error: Could not start Firestore Emulator, port taken.')).toBe(true);
    expect(looksLikePortTaken('! firestore: Port 8080 is not open on localhost (127.0.0.1)')).toBe(true);
  });
  test('does not fire on an ordinary test failure', () => {
    expect(looksLikePortTaken('Tests  2 failed | 511 passed')).toBe(false);
  });
  test('tolerates no output at all', () => {
    expect(looksLikePortTaken(undefined)).toBe(false);
  });
});

describe('describePortHolder', () => {
  // The message this builds is the difference between a developer killing the right
  // process and killing a NEIGHBOURING project's emulator. It is a hand-rolled scan of
  // `netstat -ano` output, so the runner is injectable and every branch is driven with a
  // fabricated table here — the real command's format is not this file's to assert.
  const table = [
    '  Proto  Local Address          Foreign Address        State           PID',
    '  TCP    127.0.0.1:8080         0.0.0.0:0              LISTENING       15100',
    '  TCP    127.0.0.1:9099         0.0.0.0:0              LISTENING       4242',
    '  TCP    127.0.0.1:61000        127.0.0.1:8080         ESTABLISHED     15100',
  ].join(String.fromCharCode(10));

  test('names the PID of the listening process', () => {
    expect(describePortHolder(8080, () => table)).toContain('PID 15100');
  });

  test('a different port on the same table gets its own PID', () => {
    expect(describePortHolder(9099, () => table)).toContain('PID 4242');
  });

  // The left boundary is load-bearing: without it, asking about port 80 matches the
  // `:8080` row and reports a stranger's PID as the holder of a port nobody took.
  test('a port that is only a prefix of another does not match it', () => {
    const out = describePortHolder(80, () => table);
    expect(out).not.toContain('PID');
    expect(out).toContain('ingen lyssnande process');
  });

  // An ESTABLISHED row is not a holder. Only LISTENING is.
  test('an established connection alone is not reported as the holder', () => {
    const established = '  TCP    127.0.0.1:5555         127.0.0.1:8080         ESTABLISHED     999';
    expect(describePortHolder(5555, () => established)).toContain('ingen lyssnande process');
  });

  test('no output at all falls back rather than throwing', () => {
    expect(describePortHolder(8080, () => '')).toContain('ingen lyssnande process');
    expect(describePortHolder(8080, () => null)).toContain('ingen lyssnande process');
  });

  test('the message points at the escape hatch, not at killing the process', () => {
    const out = describePortHolder(8080, () => table);
    expect(out).toContain('--port');
    expect(out).toContain('INTE');
  });
});

describe('buildAltConfig', () => {
  test('derives the rules path from firebase.json and makes it absolute', () => {
    const cfg = buildAltConfig(8123);
    // Absolute, so no second copy of the rules file can drift out of sync.
    expect(cfg.firestore.rules).toMatch(/^[A-Za-z]:\/|^\//);
    expect(cfg.firestore.rules.endsWith('firestore.rules')).toBe(true);
    expect(cfg.emulators.firestore.port).toBe(8123);
    expect(cfg.emulators.ui.enabled).toBe(false);
  });
});

describe('parsePort', () => {
  test('absent means the configured port', () => {
    expect(parsePort([])).toBe(null);
  });
  test('reads the number after the flag', () => {
    expect(parsePort(['--port', '8123'])).toBe(8123);
  });
  test('refuses a non-port rather than silently falling back', () => {
    expect(() => parsePort(['--port', 'nope'])).toThrow();
    expect(() => parsePort(['--port'])).toThrow();
    expect(() => parsePort(['--port', '99999'])).toThrow();
  });
});

// `main()` is not exercised by any case above — every one of them drives a pure
// boundary. So the spärr that keeps this wrapper on the pinned CLI is deletable with
// the whole file green unless something pins the call itself (BIN-852's shape).
//
// The anchor is the CALL, not the flag: `--no-install` also appears in the comment
// six lines above it, so `toContain('--no-install')` alone would be satisfied by the
// prose and survive the mutation that removes the flag from the argument list.
//
// Two mutations must fail this case:
//   1. drop `'--no-install'` from the args   → npx silently fetches latest on a miss
//   2. rename `npx` to something else        → the pinned global is no longer what runs
describe('main() runs the emulator CLI through npx with --no-install', () => {
  const HERE = join(fileURLToPath(import.meta.url), '..');
  const SOURCE = readFileSync(join(HERE, 'run-rules-tests.mjs'), 'utf8');

  test('the spawn call carries the flag as its first argument', () => {
    expect(SOURCE).toContain("spawnSync('npx', ['--no-install', ...args]");
  });
});
