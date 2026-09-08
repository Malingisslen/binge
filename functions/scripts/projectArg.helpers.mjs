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
