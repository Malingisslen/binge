// COST-2: existence tracking for the owner-only watchlistTags / watchlistNotes docs, so
// removing a title skips the delete of a sibling doc that is known not to exist.

interface SnapshotLike {
  docs: { id: string }[];
  metadata?: { fromCache?: boolean };
}

/**
 * Every doc id in the snapshot — only when the server has confirmed it. A cache-only
 * snapshot (offline, or the persistent cache answering first) can lack a doc another
 * device wrote, so it counts as unknown (null).
 */
export function knownDocIds(snap: SnapshotLike): Set<string> | null {
  if (snap.metadata?.fromCache !== false) return null;
  return new Set(snap.docs.map(d => d.id));
}

/** Unknown counts as "may exist": the caller then deletes, as before COST-2. */
export function mayExist(known: Set<string> | null, docId: string): boolean {
  return known == null || known.has(docId);
}
