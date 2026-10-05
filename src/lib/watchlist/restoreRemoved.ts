import type { MediaType } from '@/types';

// UX-6 ("Ångra" after "Ta bort"). Removing a title deletes three documents: the
// library row and its owner-only tags and notes siblings. `RemovedTitle` is what
// removeItem read from the local cache just before deleting them; it lives only in the
// toast's closure and is never stored anywhere.
export interface RemovedTitle {
  mediaType: MediaType;
  tmdbId: number;
  docId: string;
  /** removalGenRef's value for this title right after this removal bumped it. */
  removalGen: number;
  item: Record<string, unknown>;
  tags: Record<string, unknown> | null;
  notes: Record<string, unknown> | null;
}

export interface RestoreWrites {
  item: Record<string, unknown>;
  tags: Record<string, unknown> | null;
  notes: Record<string, unknown> | null;
}

// Pure, so the rules suite can prove the exact documents the client writes are
// accepted on create (src/test/rules/firestore-rules.test.ts, "BIN-1430").
//
// The library row goes back exactly as it was read, with one exception: a legacy row
// can still carry an inline non-null `notes` (BIN-505 moved notes to watchlistNotes),
// and the rules refuse that key on create. It is moved to the notes document rather
// than dropped, unless a notes document already existed, which then wins as it does
// everywhere else in the app.
export function buildRestoreWrites(removed: RemovedTitle): RestoreWrites {
  const { notes: inlineNote, ...rest } = removed.item;
  const item = inlineNote == null ? removed.item : rest;
  let notes = removed.notes;
  if (notes == null && typeof inlineNote === 'string' && inlineNote.length > 0) {
    notes = { note: inlineNote, mediaType: removed.mediaType };
  }
  return { item, tags: removed.tags, notes };
}
