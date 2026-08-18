/**
 * BIN-565 — finish the `streamingOffers` doc-id migration instead of paying for it
 * on every read, forever.
 *
 * WHY THIS EXISTS
 * BIN-523 moved the doc id from a bare `${tmdbId}` to `${mediaType}_${tmdbId}`, because
 * movie 123 and TV 123 shared one document and showed each other's "where to watch" rows.
 * The old documents were left to disappear opportunistically: the refresh cron deletes a
 * bare doc as a SIDE EFFECT of writing its namespaced replacement (index.ts, the
 * `legacyRef.delete()` block). Both readers therefore still fall back to the bare id, and
 * both header comments call that fallback transitional.
 *
 * It is not transitional. #27 Database Administrator's re-put critique (2026-08-17)
 * measured why, and withdrew its own earlier ruling to say so:
 *
 *   `isIntentTitle` requires status `vill_se` / `mina` — NOT `sedd`. The moment a user
 *   marks a title watched, or removes it, `readWorkSet()`'s collectionGroup scan stops
 *   seeing it, and the ~9-titles/day cron never visits it again. Its bare doc, if it has
 *   one, sits there permanently. That is every completed watch, not a rare edge case.
 *
 * So neither of the two shapes the ticket proposed works. A work-set gate is circular (the
 * client cannot know whether ANYONE tracks a title). A dated cutoff never converges,
 * because the population is drained by chance rather than by elapsed time and its
 * un-drained members are permanent.
 *
 * WHAT THIS DOES INSTEAD
 * Finishes the migration. Each cron invocation re-keys a bounded number of remaining
 * bare-id docs onto their namespaced id and deletes the bare one. Pure Firestore copying —
 * NO vendor calls, so it costs nothing against the 300/month MOTN cap and little against
 * the 25 SEK/month Blaze ceiling. When no bare docs remain it does nothing, forever.
 *
 * Only once that is proven empty may the fallback reads be deleted (#27's criteria 4–5,
 * and #18 Community Manager's V1). They are NOT removed in the same change: the fallback
 * is what keeps a legitimately-legacy title's offers alive, and #18 measured what losing
 * them looks like — the provider logos still render (they come from TMDB), so the page
 * looks completely normal while `CheapestPathVerdict` silently returns null and the
 * "Billigast: hyr för X kr" line, the leaving-soon chip and the affiliate link all vanish.
 * Nobody files a bug against a page that looks fine.
 *
 * SHAPE
 * Firestore access is an injected PORT, exactly like `tmdbTosSweep/runSweep.ts` (BIN-566)
 * and for the same reason: `index.ts` imports firebase-admin, which is not installed in
 * the root toolchain, so anything a test must import has to be admin-free. Everything
 * Firestore-shaped lives in the port; everything this migration DECIDES lives here.
 */

// `parseMediaTypeFromDocId` is deliberately NOT imported: a bare id carries no media type
// by construction, so it could only ever return null here. `readExisting()` uses it because
// its ids may be namespaced; ours never are. Named so nobody "restores" it as a fallback.
import { mediaTypeDocId, resolveTmdbId } from '../shared/mediaTypeDocId';

/** One scanned doc, flattened to what the decision needs. */
export interface BackfillScanDoc {
  /** The document id as stored — bare `123` or namespaced `movie_123`. */
  readonly id: string;
  /** The `mediaType` field, which may be missing or junk on old docs. */
  readonly mediaType: unknown;
  /** The `tmdbId` field, same caveat. */
  readonly tmdbId: unknown;
}

/** One doc to migrate: where it is now, where it goes. */
export interface BackfillTarget {
  readonly fromId: string;
  readonly toId: string;
  readonly mediaType: 'movie' | 'tv';
  readonly tmdbId: number;
}

export interface BackfillLogger {
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
}

/**
 * The injected Firestore port. Deliberately primitive — one method per real operation,
 * so a port implementation has nowhere to hide a decision.
 */
export interface BackfillIo {
  /** Max docs to migrate in ONE invocation. Bounds runtime on a large population. */
  readonly perRunLimit: number;
  readonly log: BackfillLogger;
  /**
   * Every doc in `streamingOffers`, id + the two fields needed to classify it. The caller
   * already performs this scan for `readExisting()`, so passing that snapshot through
   * costs nothing extra.
   */
  scanAll(): Promise<readonly BackfillScanDoc[]>;
  /** Full field map of one doc. `undefined` when it vanished between scan and read. */
  readDoc(id: string): Promise<Record<string, unknown> | undefined>;
  /** True when a doc with this id already exists. */
  exists(id: string): Promise<boolean>;
  /**
   * Write the namespaced doc. Does NOT touch the bare one — the ORDER of the two is a
   * safety property, so it belongs to the orchestrator where a test can observe it.
   *
   * It used to be one `migrate()` method that did both, and the test that claimed to pin
   * the order could not: with both operations inside one opaque async function, reversing
   * them in the port left the suite fully green. The test review measured that by actually
   * reversing it (2026-08-17). A port method that decides something is a port method that
   * hides it.
   */
  writeNamespaced(target: BackfillTarget, data: Record<string, unknown>): Promise<void>;
  /** Delete a bare doc. Used both to finish a migration and to retire a superseded one. */
  deleteBare(id: string): Promise<void>;
}

/** A bare id is all digits. `movie_123` / `tv_123` are the namespaced form. */
export function isBareDocId(id: string): boolean {
  return /^[0-9]+$/.test(id);
}

/**
 * Decide what a scanned bare doc becomes.
 *
 * Returns null when the doc cannot be attributed to a media type at all — the same case
 * `readExisting()` already skips. A bare doc whose `mediaType` field is missing or junk is
 * genuinely unattributable: the id carries no type, so there is nothing to recover it
 * from. Guessing would be worse than leaving it, because a movie and a TV show can share
 * the numeric id and the wrong guess silently gives one title the other's offers — the
 * exact defect BIN-523 was filed about.
 */
export function targetFor(doc: BackfillScanDoc): BackfillTarget | null {
  if (!isBareDocId(doc.id)) return null;

  // Deliberately NOT `parseMediaTypeFromDocId(doc.id)` as a fallback: a bare id has no
  // type in it by definition, so that call can only ever return null here. Spelled out
  // because `readExisting()` DOES use it, on ids that may be namespaced.
  const field = doc.mediaType;
  const mediaType = field === 'movie' || field === 'tv' ? field : null;
  if (mediaType === null) return null;

  const tmdbId = resolveTmdbId(doc.tmdbId as number | string | null | undefined, doc.id);
  if (!Number.isFinite(tmdbId)) return null;

  return { fromId: doc.id, toId: mediaTypeDocId(mediaType, tmdbId), mediaType, tmdbId };
}

/** Every bare doc in the scan that can be migrated, in scan order. */
export function pendingTargets(docs: readonly BackfillScanDoc[]): BackfillTarget[] {
  const out: BackfillTarget[] = [];
  for (const doc of docs) {
    const target = targetFor(doc);
    if (target) out.push(target);
  }
  return out;
}

/** Bare docs that exist but cannot be attributed — reported, never silently ignored. */
export function unattributableBareIds(docs: readonly BackfillScanDoc[]): string[] {
  return docs.filter((d) => isBareDocId(d.id) && targetFor(d) === null).map((d) => d.id);
}

export interface BackfillTally {
  /** Bare docs seen in this scan, whether or not they were touched. */
  readonly bareFound: number;
  /** Bare docs re-keyed onto a namespaced id. */
  readonly migrated: number;
  /** Bare docs deleted because the namespaced doc already existed. */
  readonly droppedSuperseded: number;
  /** Bare docs left alone because nothing can say which title they belong to. */
  readonly unattributable: readonly string[];
  /** True when no bare doc remains that this run could act on. */
  readonly complete: boolean;
}

/**
 * Run one migration pass.
 *
 * `complete` is the signal the fallback reads may finally be deleted — but it is a
 * statement about THIS scan, not a proof. #27's criterion 4 asks for an exhaustive query
 * against the live collection before that removal, which is a separate, deliberate step by
 * a human. It must never be read as the proof itself.
 *
 * It reaches a human through the log line below and NOWHERE else — the caller discards this
 * return value. Said plainly because the first version of this comment claimed the flag fed
 * "the cron's audit record", and it did not: it was computed, returned and dropped. Logging
 * it is what made the sentence true (code review, 2026-08-17).
 */
export async function runIdBackfill(io: BackfillIo): Promise<BackfillTally> {
  const docs = await io.scanAll();
  const targets = pendingTargets(docs);
  const unattributable = unattributableBareIds(docs);
  const bareFound = targets.length + unattributable.length;

  let migrated = 0;
  let droppedSuperseded = 0;

  for (const target of targets.slice(0, io.perRunLimit)) {
    // The namespaced doc may already exist — the cron writes it whenever the title is in
    // the work set, and that write does not always reach the bare-doc delete (it only
    // fires after a successful vendor refresh). The namespaced doc is authoritative in
    // that case: it is the one both readers prefer and the one the refresh keeps current.
    // Overwriting it with older bare data would move the collection BACKWARDS.
    if (await io.exists(target.toId)) {
      await io.deleteBare(target.fromId);
      droppedSuperseded += 1;
      continue;
    }

    const data = await io.readDoc(target.fromId);
    if (data === undefined) continue; // vanished between scan and read; nothing to move

    // WRITE FIRST, DELETE SECOND, and the order is the whole safety property. Reversed,
    // a run that dies between the two loses the document outright. This way it leaves a
    // duplicate, which the `exists` branch above retires on the next pass.
    //
    // The two steps are separate port calls precisely so this order is observable to a
    // test. As one `migrate()` method it was not, and the test that claimed to pin it
    // passed against a reversed implementation (test review, 2026-08-17).
    await io.writeNamespaced(target, data);
    await io.deleteBare(target.fromId);
    migrated += 1;
  }

  const complete = targets.length === 0;

  if (bareFound > 0) {
    io.log.info('streamingOffers id backfill', {
      bareFound, migrated, droppedSuperseded, unattributable: unattributable.length, complete,
    });
  }
  if (unattributable.length > 0) {
    // Loud, not silent: these are the only docs the migration can never finish, so they
    // are also the only reason the fallback reads might have to stay. A count buried in an
    // info line would let "we are done" and "we gave up on some" read the same.
    io.log.warn('streamingOffers bare docs with no usable mediaType — cannot be migrated', {
      ids: unattributable.slice(0, 20), total: unattributable.length,
    });
  }
  // Gated on the CAP, not on "fewer acted than targeted". Those differ: a doc that
  // vanished between the scan and the read is skipped without being acted on, so the old
  // `targets.length > migrated + droppedSuperseded` test logged "capped for this run,
  // remaining: 1" on a run that processed everything it had. This log line is the
  // migration's only human channel — the number a person reads to decide whether the
  // reader fallbacks may go — so a false "still work left" is worse here than elsewhere
  // (integration review, 2026-08-17).
  if (targets.length > io.perRunLimit) {
    io.log.info('streamingOffers id backfill capped for this run', {
      remaining: targets.length - io.perRunLimit, perRunLimit: io.perRunLimit,
    });
  }

  return { bareFound, migrated, droppedSuperseded, unattributable, complete };
}
