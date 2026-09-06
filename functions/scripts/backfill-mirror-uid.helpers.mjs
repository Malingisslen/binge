// BIN-1063 steg 2 — ren, firebase-admin-fri logik delad med backfill-mirror-uid.mjs.
// Utbruten precis som recap-upload.helpers.mjs: sjalva skriptet importerar
// firebase-admin, som rotens `npm ci` inte installerar, sa den koden kan inte kora
// under rotens vitest. Det som gar att prova utan Firestore bor darfor har.

export const COLLECTIONS = ['friends', 'friendRequestsSent'];

/**
 * The rows this migration must touch, given a page of documents.
 *
 * Split out from the IO so it can be tested without firebase-admin. A row is a
 * candidate when it has no `uid` at all, or carries one that disagrees with its
 * own document id — the second case matters because a stray value could predate
 * this change. Normalising to the document id is always correct: the id IS the uid.
 */
export function candidates(docs) {
  return docs.filter((d) => d.data.uid !== d.id);
}

/** The single field this migration writes. Nothing else may appear here. */
export function patchFor(doc) {
  return { uid: doc.id };
}

/**
 * The project id the run must target, taken from `--project <id>`.
 *
 * Undefined means the caller did not name one, and the caller must refuse: an
 * Application Default credential carries whatever quota project the machine was
 * set up for, so an unnamed run can open another project's database, succeed, and
 * report zero rows.
 */
export function projectFrom(argv) {
  const i = argv.indexOf('--project');
  const value = i === -1 ? undefined : argv[i + 1];
  return value && !value.startsWith('--') ? value : undefined;
}

/**
 * Why this run must not start, or null when it may.
 *
 * The refusals live here rather than inline in main() so a test can CALL them.
 */
export function refusalFor(argv) {
  if (!argv.includes('--apply') && !argv.includes('--dry-run')) {
    return 'refusing to guess: pass --dry-run or --apply';
  }
  // Both flags together WRITES: apply is read on its own, so a command that says
  // dry-run would write. On a whole-population writer the operator's intent has to
  // be unambiguous.
  if (argv.includes('--apply') && argv.includes('--dry-run')) {
    return 'refusing to guess: --dry-run and --apply are mutually exclusive';
  }
  if (!projectFrom(argv)) {
    return 'refusing to guess: pass --project <id> (e.g. --project binge-nu)';
  }
  return null;
}

/**
 * A Firestore Timestamp rendered for the log.
 *
 * It defines no toString, so String(t) is `[object Object]` — and that line is the
 * operator's only record of what the row held going in.
 */
export function stampText(value) {
  if (value && typeof value.toDate === 'function') return value.toDate().toISOString();
  return String(value);
}
