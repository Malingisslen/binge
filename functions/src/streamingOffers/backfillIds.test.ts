// BIN-565 — the streamingOffers id migration.
//
// The decisive cases here are the ones where the two proposals the ticket carried would
// have behaved differently from what shipped: a title that LEFT the work set (every
// completed watch), and a bare doc whose namespaced twin already exists.

import { describe, it, expect, vi } from 'vitest';
import {
  isBareDocId, targetFor, pendingTargets, unattributableBareIds, runIdBackfill,
  type BackfillScanDoc, type BackfillIo, type BackfillTarget,
} from './backfillIds';

const scan = (id: string, mediaType: unknown, tmdbId: unknown): BackfillScanDoc =>
  ({ id, mediaType, tmdbId });

function makeIo(
  docs: readonly BackfillScanDoc[],
  opts: { existing?: Set<string>; data?: Record<string, Record<string, unknown>>; perRunLimit?: number } = {},
) {
  const existing = opts.existing ?? new Set<string>();
  const migrated: { target: BackfillTarget; data: Record<string, unknown> }[] = [];
  const dropped: string[] = [];
  // Every port call in the order the orchestrator made it. The two write/delete steps are
  // separate methods precisely so this sequence is observable — as one `migrate()` doing
  // both, a reversed implementation passed every test in this file (test review,
  // 2026-08-17).
  const calls: string[] = [];
  const io: BackfillIo = {
    perRunLimit: opts.perRunLimit ?? 100,
    log: { info: vi.fn(), warn: vi.fn() },
    scanAll: async () => docs,
    readDoc: async (id) => opts.data?.[id] ?? { tmdbId: Number(id), offers: [] },
    exists: async (id) => existing.has(id),
    writeNamespaced: async (target, data) => {
      calls.push(`write:${target.toId}`);
      migrated.push({ target, data });
    },
    deleteBare: async (id) => {
      calls.push(`delete:${id}`);
      dropped.push(id);
    },
  };
  return { io, migrated, dropped, calls };
}

describe('isBareDocId', () => {
  it('separates the two id shapes', () => {
    expect(isBareDocId('123')).toBe(true);
    expect(isBareDocId('movie_123')).toBe(false);
    expect(isBareDocId('tv_123')).toBe(false);
  });
});

describe('targetFor', () => {
  it('re-keys a bare doc onto its namespaced id', () => {
    expect(targetFor(scan('123', 'movie', 123)))
      .toEqual({ fromId: '123', toId: 'movie_123', mediaType: 'movie', tmdbId: 123 });
  });

  it('leaves an already-namespaced doc alone', () => {
    expect(targetFor(scan('movie_123', 'movie', 123))).toBeNull();
  });

  it('refuses a bare doc with no usable mediaType — guessing would recreate BIN-523', () => {
    // A bare id carries no type, so there is nothing to recover it from. A movie and a TV
    // show can share the number; the wrong guess silently hands one title the other's
    // offers, which is the exact defect the id change was made to fix.
    expect(targetFor(scan('123', undefined, 123))).toBeNull();
    expect(targetFor(scan('123', 'film', 123))).toBeNull();
    expect(targetFor(scan('123', '', 123))).toBeNull();
  });

  it('recovers tmdbId from the doc id when the field is junk', () => {
    expect(targetFor(scan('123', 'tv', undefined))?.toId).toBe('tv_123');
    expect(targetFor(scan('123', 'tv', 'not-a-number'))?.toId).toBe('tv_123');
  });
});

describe('pendingTargets / unattributableBareIds', () => {
  const docs = [
    scan('movie_1', 'movie', 1),
    scan('2', 'movie', 2),
    scan('3', undefined, 3),
    scan('tv_4', 'tv', 4),
    scan('5', 'tv', 5),
  ];

  it('picks only the bare docs that can be attributed', () => {
    expect(pendingTargets(docs).map((t) => t.toId)).toEqual(['movie_2', 'tv_5']);
  });

  it('reports the unattributable ones separately rather than dropping them', () => {
    expect(unattributableBareIds(docs)).toEqual(['3']);
  });
});

describe('no writer may reintroduce a bare id (#27 binding criterion)', () => {
  // The migration cleans up the past. The guard against the FUTURE is a lint rule:
  // `binge/no-bare-streaming-offers-id` (eslint-rules/, tested in
  // eslint-rules/no-bare-streaming-offers-id.test.mjs). The whole defect returns the moment
  // some new code path writes `streamingOffers/123` again, and BIN-523 proved that failure
  // is invisible — a movie quietly showing a TV show's offers looks like data, not like a
  // bug.
  //
  // BIN-931 replaced the regex source scans that used to live here. They read the tree as
  // TEXT, so every review round found a shape they could not see and each widening opened
  // the next hole; two shapes — a two-hop binding chain and a ref passed to `batch.set()` —
  // were reachable by no regex at all and were merely ASSERTED ABSENT. The lint rule
  // resolves identifiers through ESLint's scope analysis, so those two are ordinary cases
  // for it. Its own test drives the repo's real eslint config, so "the rule is wired in"
  // and "the rule works" are one measurement.
  //
  // What stays HERE is the half that is about this module rather than about call sites:
  // the id helper itself must not be able to emit a bare id.

  it('the id helper never produces a bare id for a valid media type', async () => {
    // The other half: even if every call site uses the helper, the helper itself must not
    // be able to emit a bare id. Guards the case where someone "simplifies" it.
    const { mediaTypeDocId } = await import('../shared/mediaTypeDocId');
    for (const mediaType of ['movie', 'tv'] as const) {
      for (const id of [1, 123, 999999]) {
        expect(isBareDocId(mediaTypeDocId(mediaType, id))).toBe(false);
      }
    }
  });
});

describe('runIdBackfill', () => {
  it('migrates a bare doc and reports the tally', async () => {
    const { io, migrated, dropped } = makeIo([scan('7', 'movie', 7)], {
      data: { '7': { tmdbId: 7, mediaType: 'movie', offers: [{ provider: 'x' }] } },
    });
    const tally = await runIdBackfill(io);

    expect(migrated).toHaveLength(1);
    expect(migrated[0].target.toId).toBe('movie_7');
    // The whole document travels, not a reconstruction of it.
    expect(migrated[0].data).toEqual({ tmdbId: 7, mediaType: 'movie', offers: [{ provider: 'x' }] });
    // The bare doc IS deleted — that is the second half of a migration, not a separate
    // event. `droppedSuperseded` counts only the OTHER case (target already existed), so
    // it stays 0 here. Before the port was split this test asserted `dropped` was empty,
    // which was true only because one opaque `migrate()` hid the delete inside itself.
    expect(dropped).toEqual(['7']);
    expect(tally).toMatchObject({ bareFound: 1, migrated: 1, droppedSuperseded: 0 });
  });

  it('drops a bare doc WITHOUT overwriting an existing namespaced one', async () => {
    // The namespaced doc is authoritative: the refresh cron keeps it current, and both
    // readers prefer it. Copying older bare data over it would move the collection
    // backwards — a title would show stale offers because we "finished" a migration.
    const { io, migrated, dropped } = makeIo([scan('7', 'movie', 7)], {
      existing: new Set(['movie_7']),
    });
    const tally = await runIdBackfill(io);

    expect(migrated).toEqual([]);
    expect(dropped).toEqual(['7']);
    expect(tally).toMatchObject({ migrated: 0, droppedSuperseded: 1 });
  });

  it('THE CASE THE OLD PROPOSALS GOT WRONG: a title that left the work set still migrates', async () => {
    // #27's re-put critique. `isIntentTitle` requires vill_se/mina, not sedd — so the
    // moment a user marks a title watched it leaves readWorkSet()'s scan and the ~9/day
    // cron never visits it again. Under a work-set gate this doc is invisible forever;
    // under a dated cutoff it is skipped once the date passes. This migration does not
    // consult the work set at all, which is exactly why it terminates.
    const { io, migrated } = makeIo([scan('42', 'tv', 42)]);
    await runIdBackfill(io);
    expect(migrated.map((m) => m.target.toId)).toEqual(['tv_42']);
  });

  it('leaves an unattributable bare doc in place and WARNS about it', async () => {
    const { io, migrated, dropped } = makeIo([scan('9', undefined, 9)]);
    const tally = await runIdBackfill(io);

    expect(migrated).toEqual([]);
    expect(dropped).toEqual([]);
    expect(tally.unattributable).toEqual(['9']);
    // Loud, not silent: these are the only docs the migration can never finish, so they
    // are the only reason the fallback reads might have to stay.
    expect(io.log.warn).toHaveBeenCalled();
  });

  it('does NOT report complete while an attributable bare doc remains', async () => {
    const { io } = makeIo([scan('9', 'movie', 9)], { perRunLimit: 0 });
    expect((await runIdBackfill(io)).complete).toBe(false);
  });

  it('reports complete only when no bare doc is left to act on', async () => {
    const { io } = makeIo([scan('movie_1', 'movie', 1), scan('tv_2', 'tv', 2)]);
    const tally = await runIdBackfill(io);
    expect(tally).toMatchObject({ bareFound: 0, migrated: 0, complete: true });
  });

  it('SAYS SO in the log when nothing is left — the terminal state is not silent', async () => {
    // BIN-932. `complete` reaches a human through the log and nowhere else: the caller
    // discards the tally. The tally line is gated on `bareFound > 0`, so the one run that
    // actually matters — the one that finally finds nothing — used to log less than a run
    // with work to do. It is the run that opens #27's criteria 4–5, removing the reader
    // fallbacks, and a person may go looking for it long after it happened.
    const { io } = makeIo([scan('movie_1', 'movie', 1), scan('tv_2', 'tv', 2)]);
    await runIdBackfill(io);
    expect(io.log.info)
      .toHaveBeenCalledWith('streamingOffers id backfill complete — no bare docs remain');
  });

  it('does NOT claim nothing is left while an unattributable bare doc sits there', async () => {
    // The other direction, so the line above cannot be silenced by making it unconditional.
    // An unattributable doc keeps `bareFound` above zero while `complete` is still true, and
    // those docs are the whole reason the fallbacks might have to STAY. A "no bare docs
    // remain" line printed over one of them is a false all-clear on the single decision this
    // module's log exists to inform.
    const { io } = makeIo([scan('9', undefined, 9)]);
    await runIdBackfill(io);

    const terminal = (io.log.info as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .filter((c) => String(c[0]).includes('no bare docs remain'));
    expect(terminal).toEqual([]);
  });

  it('an unattributable doc does not block completeness — it is a separate signal', async () => {
    // Deliberate: those docs can never be migrated, so waiting for them would mean the
    // flag never flips and the fallback could never be retired. They are surfaced by
    // `unattributable` and the warning instead. A reader of the audit must weigh both.
    const { io } = makeIo([scan('9', undefined, 9)]);
    const tally = await runIdBackfill(io);
    expect(tally.complete).toBe(true);
    expect(tally.unattributable).toEqual(['9']);
  });

  it('caps work per run and says how much is left', async () => {
    const docs = [scan('1', 'movie', 1), scan('2', 'movie', 2), scan('3', 'movie', 3)];
    const { io, migrated } = makeIo(docs, { perRunLimit: 2 });
    await runIdBackfill(io);

    expect(migrated).toHaveLength(2);
    expect(io.log.info).toHaveBeenCalledWith(
      'streamingOffers id backfill capped for this run',
      expect.objectContaining({ remaining: 1 }),
    );
  });

  it('does NOT report "capped" when a doc merely vanished — the cap is the gate', async () => {
    // The log line is this migration's only human channel: it is what a person reads to
    // decide whether the reader fallbacks may finally be removed. Gated on
    // `targets.length > migrated + droppedSuperseded` it fired on a run that processed
    // everything it had, because a vanished doc is skipped without being acted on
    // (integration review, 2026-08-17). A false "still work left" here delays a removal
    // that is already safe.
    const { io } = makeIo([scan('7', 'movie', 7)], { perRunLimit: 100 });
    io.readDoc = async () => undefined; // vanished between scan and read
    await runIdBackfill(io);

    const capped = (io.log.info as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .filter((c) => String(c[0]).includes('capped'));
    expect(capped).toEqual([]);
  });

  it('DOES report "capped" when the run genuinely hit its limit', async () => {
    // The other direction, so the gate cannot be silenced outright.
    const { io } = makeIo(
      [scan('1', 'movie', 1), scan('2', 'movie', 2), scan('3', 'movie', 3)],
      { perRunLimit: 2 },
    );
    await runIdBackfill(io);
    expect(io.log.info).toHaveBeenCalledWith(
      'streamingOffers id backfill capped for this run',
      expect.objectContaining({ remaining: 1 }),
    );
  });

  it('skips a doc that vanished between the scan and the read', async () => {
    const { io, migrated } = makeIo([scan('7', 'movie', 7)]);
    io.readDoc = async () => undefined;
    const tally = await runIdBackfill(io);

    expect(migrated).toEqual([]);
    expect(tally.migrated).toBe(0);
  });

  it('writes the namespaced doc BEFORE deleting the bare one', async () => {
    // Order is the whole safety property: delete-then-write loses the document outright
    // if the run dies between the two. Write-then-delete leaves a harmless duplicate the
    // next pass retires through the already-exists branch.
    //
    // This asserts the real SEQUENCE, recorded by the fake port. The first version could
    // not: the port had one `migrate()` doing both operations, so reversing them inside
    // it left the whole suite green while the test's name and comment claimed the order
    // was pinned. Splitting the port is what made the claim checkable (test review,
    // 2026-08-17).
    const { io, calls } = makeIo([scan('7', 'movie', 7)]);
    await runIdBackfill(io);
    expect(calls).toEqual(['write:movie_7', 'delete:7']);
  });

  it('a superseded bare doc is deleted with NO write at all', async () => {
    // The other sequence that must hold: when the namespaced doc already exists, nothing
    // may be written over it. Asserted on the call log rather than on a counter, so a
    // write that happened and was then overwritten cannot hide.
    const { io, calls } = makeIo([scan('7', 'movie', 7)], { existing: new Set(['movie_7']) });
    await runIdBackfill(io);
    expect(calls).toEqual(['delete:7']);
  });
});
