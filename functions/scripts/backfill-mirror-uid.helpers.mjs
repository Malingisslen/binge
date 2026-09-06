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
