// run-rules-tests.mjs — the wrapper behind `npm run test:rules`.
//
// NO SHEBANG, deliberately. Vite's shebang stripper is LF-only, so once git hands this
// file CRLF endings the SSR prelude lands in FRONT of the shebang and rolldown refuses
// the whole module with an invalid-character parse error. BIN-891 recorded the quiet
// version of that (a sibling module dropped out of the suite unnoticed); here it took
// this file's own self-test down, loudly. Nothing invokes the script directly —
// package.json runs it through `node` — so the line bought nothing and cost that.
//
// WHAT IT GUARDS. `npm test` does NOT run the Firestore rules suite:
// `vitest.config.ts` excludes `src/test/rules/**`, which runs only against a real
// emulator behind this command. `firestore.rules` is the most security-sensitive
// surface in the repo, and this command is its entire proof — plus the `rules-tests`
// job in `deploy.yml` that the hosting deploy gates on via `needs:`.
//
// So the failure this closes is not "the tests went red". It is a run that LOOKS
// green while having proved nothing. Two ways in:
//
//   • the emulator never starts (a neighbouring project holds port 8080), so the
//     script inside `emulators:exec` never runs at all, and
//   • vitest reports a healthy summary while its actual test count has collapsed —
//     a file that quietly left the include globs, a `describe.each([])` that
//     registers zero tests and is reported as PASS, an import error that fails one
//     file while the rest still print a green line.
//
// MEASURED 2026-09-10, before this file existed, with port 8080 held by another
// repo's emulator: `npm run test:rules` exited 1, on firebase-tools 15.26.0 AND on
// the 14.27.0 the deploy workflow pins. So the exit code was not lying at that
// moment — the ticket's own reproduction did not reproduce. What is missing is the
// second half: nothing anywhere asserted that any test RAN. That is what MIN below
// is, and it is why the count is read from the JSON reporter rather than from the
// exit code alone.
//
// WHY A LITERAL FLOOR AND NOT A FRACTION. A fraction of the suite's own size is
// satisfied by the shrunken suite that caused it; a floor derived by scanning the
// suite's source for `describe`/`it` cannot see `describe.each([])`, which is the
// exact silent-zero this exists for. A literal is the only form a shrink cannot
// satisfy. Raise it by hand when the suite grows; LOWERING it is a deliberate act
// that shows up in a diff and has to be explained there.
//
// PORT POLICY: a taken port is a HARD FAILURE, with `--port <n>` as the explicit way
// out. Automatic port selection was rejected: a green run must never be able to hide
// which port and which rules file it used, and that is the whole subject here. The
// generated config is DERIVED from the repo's own firebase.json — never a hand-kept
// second copy, which is the way two files drift apart.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

// Raise by hand when the suite grows. Derive the current count rather than trusting any
// number written here: npm run test:rules -- --port 8123
//
// BIN-1165, 2026-09-12: raised 500 → 556, which is what `numTotalTests` reported on the
// commit that added the sessions hostName tests. The value is the suite's measured size,
// not a margin below it, so removing a single test fails the floor — that is the point.
export const MIN_TESTS = 556;

const VITEST_ARGS = ['run', '--config', 'vitest.rules.config.ts'];

// Relative, and free of spaces, because it travels inside the single shell word the
// emulator runs. node_modules is gitignored, so the report leaves no trace in a diff.
const REPORT_REL = 'node_modules/.cache/rules-report.json';

/**
 * The whole decision, as a pure function, so the self-test can drive every branch
 * with fabricated input and never needs an emulator.
 *
 * `count` is `numTotalTests` from vitest's JSON reporter, or null when the report
 * could not be read or parsed. null is a FAILURE, never "no floor was broken" —
 * an unreadable report and a healthy run must not produce the same verdict.
 */
export function verdict({ exitCode, count, min = MIN_TESTS }) {
  if (exitCode !== 0) {
    return { ok: false, reason: 'child-failed', message: `Regeltesterna avslutade med ${exitCode}.` };
  }
  if (count === null || count === undefined || !Number.isInteger(count)) {
    return {
      ok: false,
      reason: 'unreadable-report',
      message: 'Vitests JSON-rapport gick inte att lasa. En korning utan lasbart antal '
        + 'raknas som misslyckad — annars ar "korde inget" och "allt gront" samma utfall.',
    };
  }
  if (count < min) {
    return {
      ok: false,
      reason: 'below-floor',
      message: `Bara ${count} test kordes; golvet ar ${min}. Sviten har krympt, eller en `
        + 'testfil har lamnat include-monstret. Sank golvet bara medvetet, i en egen diff.',
    };
  }
  return { ok: true, reason: 'passed', message: `${count} regeltest kordes.` };
}

/** True when the emulator output says the port was already held. */
export function looksLikePortTaken(output) {
  return /port taken|is not open on localhost/i.test(String(output ?? ''));
}

/**
 * Who is holding the port. The message this feeds is the difference between a
 * developer fixing the right thing and one guessing: on a multi-project machine the
 * usual holder is a NEIGHBOURING repo's emulator, which must not be killed.
 */
export function describePortHolder(port, runner = defaultNetstat) {
  const rows = runner();
  const line = String(rows ?? '')
    .split(/\r?\n/)
    .find((l) => new RegExp(`[:.]${port}\\s`).test(l) && /LISTEN/i.test(l));
  if (!line) return `Port ${port} verkar upptagen, men ingen lyssnande process gick att hitta.`;
  const pid = line.trim().split(/\s+/).pop();
  return `Port ${port} halls av PID ${pid} — sannolikt ett annat repos \`firebase emulators\`. `
    + `Doda den INTE om den tillhor ett annat projekt; kor i stallet mot en ledig port:\n`
    + `  npm run test:rules -- --port 8123`;
}

function defaultNetstat() {
  const r = spawnSync('netstat', ['-ano'], { encoding: 'utf8' });
  return r.stdout ?? '';
}

/**
 * Derive a throwaway emulator config from the repo's own firebase.json, with the
 * rules path made absolute so nothing about which rules file runs can drift.
 */
export function buildAltConfig(port, repo = REPO) {
  const base = JSON.parse(readFileSync(join(repo, 'firebase.json'), 'utf8'));
  const firestore = { ...base.firestore, rules: join(repo, base.firestore.rules).replace(/\\/g, '/') };
  return {
    firestore,
    emulators: {
      ...base.emulators,
      firestore: { ...(base.emulators?.firestore ?? {}), port },
      ui: { enabled: false },
    },
  };
}

export function parsePort(argv) {
  const i = argv.indexOf('--port');
  if (i === -1) return null;
  const raw = argv[i + 1];
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`--port vill ha ett portnummer, fick ${JSON.stringify(raw)}.`);
  }
  return n;
}

function main(argv) {
  const port = parsePort(argv);
  const reportDir = join(REPO, 'node_modules', '.cache');
  const reportPath = join(REPO, REPORT_REL);
  mkdirSync(reportDir, { recursive: true });
  if (existsSync(reportPath)) rmSync(reportPath);

  // The inner command is one shell word for `emulators:exec`, so it is quoted here and
  // written with paths that carry no spaces. It cost a run to learn why: unquoted, the
  // outer shell splits it and the firebase CLI answers `unknown option '--reporter=json'`
  // — it had claimed vitest's flags as its own.
  //
  // BOTH reporters. `--reporter=json` alone REPLACES the default one, so a RED rules
  // suite printed a single "JSON report written to ..." line and no failing test name —
  // on the one surface `deploy.yml`'s hosting job gates on, with the detail left in a
  // gitignored file nobody is pointed at.
  const inner = ['npx', 'vitest', ...VITEST_ARGS, '--reporter=default', '--reporter=json',
    `--outputFile=${REPORT_REL}`].join(' ');

  const args = ['firebase', 'emulators:exec', '--only', 'firestore',
    '--project', 'demo-binge-rules'];
  let configPath = null;
  if (port !== null) {
    configPath = join(reportDir, `firebase.alt-${port}.json`);
    writeFileSync(configPath, JSON.stringify(buildAltConfig(port), null, 2));
    args.push('--config', configPath.replace(/\\/g, '/'));
  }
  args.push(`"${inner}"`);

  // `--no-install`: utan den hamtar npx TYST senaste firebase-tools fran registret
  // nar PATH-uppslaget missar. `deploy.yml` installerar en pinnad version globalt och
  // nycklar emulator-cachen pa den, sa en sadan hamtning gor bade pinningen och
  // cachenyckeln verkningslosa utan att nagot blir rott. Med flaggan avslutar npx
  // med en felkod i stallet. En maskin utan firebase-tools far alltsa ett hart fel
  // har, inte en installation.
  const run = spawnSync('npx', ['--no-install', ...args], { cwd: REPO, encoding: 'utf8', shell: true });
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  process.stdout.write(output);

  let count = null;
  try { count = JSON.parse(readFileSync(reportPath, 'utf8')).numTotalTests ?? null; }
  catch { count = null; }

  const v = verdict({ exitCode: run.status ?? 1, count });
  if (v.ok) {
    process.stdout.write(`\n[rules] ${v.message}\n`);
    return 0;
  }
  process.stderr.write(`\n[rules] ${v.message}\n`);
  if (looksLikePortTaken(output)) {
    process.stderr.write(`[rules] ${describePortHolder(port ?? 8080)}\n`);
  }
  return 1;
}

// Entry-point guard, for the reason BIN-802 recorded: without it, importing anything
// from here runs the CLI — eating the test runner's argv and exiting the process with
// no output, which reads as vitest hanging rather than as an error.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)));
}
