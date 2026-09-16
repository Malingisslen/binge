// BIN-1107 — the `--project <id>` contract, shared by every script under functions/scripts/
// that opens a Firestore.
//
// WHY THIS EXISTS. An `initializeApp` call whose credential is an application-default one,
// and which names no project id, takes whatever quota project the machine was last set up
// for. If that is not the project the operator meant, the reads SUCCEED against someone
// else's database and the output is indistinguishable from a healthy run with nothing to
// do. That is not hypothetical: on 2026-09-06 the first dry run of backfill-mirror-uid.mjs
// printed `0 scanned, 0 rows` against a machine whose ADC pointed elsewhere. The real
// number was three.
//
// Such a call is deliberately not spelled out anywhere in this file. The guard in the
// accompanying test reads the ARGUMENT of each call it finds under this directory — and
// names the file when it finds one it cannot read — so a header quoting a call would be
// taken for a call rather than for an explanation of one.
//
// WHY IT IS A SEPARATE MODULE. The scripts themselves import firebase-admin, which the
// root `npm ci` does not install, so nothing in them can run under the root vitest. The
// refusal has to live somewhere a test can CALL it rather than source-scan it — a scan
// matches a sibling branch and survives the mutation that deletes the return.
//
// It is one module rather than a copy per script for the reason this repo keeps relearning:
// the same rule written in N places drifts, and nothing fails when it does.

/**
 * The project id named by `--project <id>`, or undefined when the caller named none.
 *
 * A value starting with `--` is treated as absent, not as the id: `--apply --project`
 * would otherwise aim the run at a project literally called `--apply`.
 */
export function projectFrom(argv) {
  const i = argv.indexOf('--project');
  const value = i === -1 ? undefined : argv[i + 1];
  return value && !value.startsWith('--') ? value : undefined;
}

/**
 * Why a run that is about to open a Firestore must not start, or null when it may.
 *
 * Callers that never open one (recap-upload.mjs's `--unsourced` mode only appends to a
 * local JSON file) must not consult this — demanding a project from a run that opens no
 * database would refuse a command that is entirely safe.
 */
export function projectRefusal(argv) {
  if (!projectFrom(argv)) {
    return 'refusing to guess: pass --project <id> (e.g. --project binge-nu)';
  }
  return null;
}

/**
 * `argv` without the `--project` flag and its value, so a POSITIONAL read further down
 * does not pick up either token. A script that reads `args[0]` as a file path gets the
 * path the operator typed rather than the string `--project`.
 *
 * BIN-1117. This lived inline in recap-upload.mjs, where no test could call it — the
 * same reason `projectRefusal` was moved here one line up, applied one line further in.
 *
 * Two behaviours worth naming, because both are decisions rather than fallout:
 *
 * 1. **No `--project` returns argv unchanged.** The inline version indexed without
 *    guarding, so an absent flag gave `-1` and the surrounding slice arithmetic dropped
 *    the last token while duplicating another. Nothing reached it, because every caller
 *    gated on `projectRefusal` first — and moving the code here is precisely what removes
 *    that caller discipline.
 * 2. **A following token that looks like a flag is not consumed**, the same test
 *    `projectFrom` applies to decide it is not an id. So the two functions read one
 *    argv the same way instead of two ways, and a real flag is never eaten as a value.
 *
 * Every occurrence goes, not only the first. `projectFrom` answers from the FIRST one, so
 * a repeated flag already has a decided project; leaving the later pair in place would put
 * `--project` back into the positional slot this function exists to clear.
 */
export function stripProjectArgs(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== '--project') {
      out.push(argv[i]);
      continue;
    }
    const value = argv[i + 1];
    if (value !== undefined && !value.startsWith('--')) i += 1;
  }
  return out;
}
