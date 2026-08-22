// BIN-565 — the streamingOffers id migration.
//
// The decisive cases here are the ones where the two proposals the ticket carried would
// have behaved differently from what shipped: a title that LEFT the work set (every
// completed watch), and a bare doc whose namespaced twin already exists.

import { describe, it, expect, vi } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
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

describe('V7 — no writer may reintroduce a bare id (#27 binding criterion)', () => {
  // The migration cleans up the past. This is the guard against the FUTURE: the whole
  // defect returns the moment some new code path writes `streamingOffers/123` again, and
  // BIN-523 proved that failure is invisible — a movie quietly showing a TV show's
  // offers looks like data, not like a bug.
  //
  // Asserted against the real writers rather than against a fixture, because a fixture
  // only proves the fixture. Every `.doc(...)` on this collection must derive its id from
  // `mediaTypeDocId` or `streamingOffersDocId`; a bare interpolation is the regression.

  // The collection name in ANY quote style. Every scan below was single-quote-only for one
  // round, so `db.collection("streamingOffers").doc(id).set(...)` in a new module — the
  // exact BIN-523 cross-title shape this guard exists for — was invisible to all three of
  // them with the full suite green. Nothing in eslint.config.mjs enforces quote style, so
  // that is ordinary variation, not a contrived mutant (test review, 2026-08-17). A
  // module-scoped `const COL = 'streamingOffers'` was already caught by the bound-ref
  // scan; the quote character was the whole hole.
  const COL = `['"\`]streamingOffers['"\`]`;

  it('every streamingOffers doc-id expression in the writer is namespaced', async () => {
    // Resolved from the repo root, not from `import.meta.url` — vite rewrites the latter
    // during transform, so it does not point at the source file on disk.
    const src = await readFile(
      join(process.cwd(), 'functions/src/streamingOffers/index.ts'), 'utf8',
    );
    expect(src.length, 'writer source must be readable').toBeGreaterThan(1000);
    // Pull every `collection('streamingOffers')...doc(<expr>)` and every `col.doc(<expr>)`
    // in this module, and require the expression to name an id helper — or to be a
    // variable that one produced (`target.toId`/`target.fromId` come from `targetFor`,
    // which is itself pinned above).
    // BOTH shapes this module uses. The first version matched only `col.doc(...)` — the
    // migration's own alias — while its comment claimed to cover every write. The module's
    // PRIMARY writer is `db.collection('streamingOffers').doc(...)`, the very site BIN-523
    // was filed about, and mutating THAT to a bare id left the suite 19/19 green. The code
    // review measured it. A guard that covers only the code shipped alongside it is the
    // easiest kind to believe and the least useful kind to have.
    const matches = [
      ...src.matchAll(/\bcol\.doc\(([^)]*)\)/g),
      ...src.matchAll(new RegExp(`collection\\(${COL}\\)\\s*\\.doc\\(([^)]*)\\)`, 'g')),
    ];

    // Floor, and a SPECIFIC one: a zero-match regex proves nothing, and neither does one
    // that quietly stops matching the primary writer while the alias keeps the count
    // non-zero. If either shape is renamed, this fails loudly instead of thinning out.
    expect(matches.length).toBeGreaterThanOrEqual(4);
    expect(
      new RegExp(`collection\\(${COL}\\)`).test(src),
      'the primary writer moved or was renamed — re-point this guard before trusting it',
    ).toBe(true);

    // WRITES must be namespaced. DELETES may address a bare id on purpose — that is how
    // the old document gets retired, both in the refresh cron's legacy cleanup and in the
    // migration's own `deleteBare`. A guard that forbade bare ids outright would forbid the
    // only mechanism that removes them, which is the opposite of what BIN-565 is for.
    //
    // Classified by the operation that FOLLOWS the id, read from the source rather than
    // assumed: the first version of this test looked only at the expression and would have
    // failed the legitimate delete at index.ts:330 the moment it widened past `col.`.
    const ALLOWED_WRITE_ID = /mediaTypeDocId|streamingOffersDocId|target\.toId/;
    const offenders: string[] = [];
    let writesChecked = 0;
    for (const m of matches) {
      const expr = m[1].trim();
      const after = src.slice(m.index + m[0].length, m.index + m[0].length + 160);
      // The leading `\)?` matters: `[^)]*` stops at the FIRST close-paren, so a nested
      // call like `.doc(streamingOffersDocId(a, b))` leaves the outer `)` sitting at the
      // head of `after`. Without it the PRIMARY writer classified as "not a write" and
      // this loop inspected one call instead of two — caught by the writesChecked floor
      // below, which is exactly why that floor is a specific number and not `> 0`.
      const isDelete = /^\s*\)?\s*\.\s*delete\s*\(\)/.test(after);
      const isWrite = /^\s*\)?\s*\.\s*(set|update|create)\s*\(/.test(after);
      if (isDelete && !isWrite) continue; // deliberate retirement of a legacy doc
      if (!isWrite) continue;             // a read (.get()) cannot corrupt anything
      writesChecked += 1;
      if (!ALLOWED_WRITE_ID.test(expr)) offenders.push(expr);
    }

    // Second floor: if no WRITE was classified, the guard is inspecting nothing even
    // though the match count looked healthy.
    expect(writesChecked, 'no streamingOffers write reached the check').toBeGreaterThanOrEqual(2);

    // The INDIRECT shape, and it is not hypothetical — this file already uses it for
    // `legacyRef`'s delete, so it is the idiom a future author would copy:
    //
    //   const ref = db.collection('streamingOffers').doc(String(tmdbId));
    //   await ref.set(...);
    //
    // Nothing above catches that: the write is chained off a VARIABLE, not off `.doc()`.
    // The test review proved it by adding exactly that and getting a fully green suite.
    // So bind-then-write is checked separately: any `const|let X = ...doc(<expr>)` whose
    // name is later `.set`/`.update`/`.create`d must have used an id helper.
    const bound = [...src.matchAll(
      // `col\b` is ANCHORED. Unanchored, `col` also matched the first three letters of
      // `collection(`, so this scanned bound refs on `motnBudget` and `priceHistory` too.
      // Harmless today, but a future `budgetRef.set(...)` would have failed as a "bare
      // streamingOffers WRITE" — a guard firing on the wrong collection (integration
      // review, 2026-08-17).
      new RegExp(
        // `[^;]`, NOT `[^;\n]`. The cross-file scan below was widened for exactly this
        // reason and this one was left behind for a round — and it is the only scan that
        // covers index.ts at all, since the cross-file walk skips that file by design. A
        // bound ref whose chain is broken across lines, one reformat away from what
        // `legacyRef` already looks like, was invisible here with the suite fully green
        // (integration review, 2026-08-17). The `;` terminator is what stops the
        // alternation running past `const col = db.collection('streamingOffers');`, so
        // widening this does not start matching refs on other collections.
        // `(?:db\s*\.\s*)?` — the whitespace is load-bearing. `(?:db\.)?` required the dot
        // to touch `db`, so `const ref = db\n  .collection(…)` — the very break this fix
        // was about — still did not match, and my first attempt at this widening was
        // measured GREEN against that exact probe. Two separate newline holes in one
        // regex; the `[^;]` one was only the visible half.
        `\\b(?:const|let)\\s+(\\w+)\\s*=\\s*(?:db\\s*\\.\\s*)?(?:col\\b|collection\\(${COL}\\))[^;]*?\\.doc\\(([^;]*?)\\)\\s*;`,
        'g',
      ),
    )];
    for (const m of bound) {
      const [, name, expr] = m;
      const writesThroughRef = new RegExp(`\\b${name}\\s*\\.\\s*(set|update|create)\\s*\\(`).test(src);
      if (writesThroughRef && !ALLOWED_WRITE_ID.test(expr)) offenders.push(`${name} = .doc(${expr})`);
    }
    // `legacyRef` is the one bound ref on THIS collection today and it is delete-only, so
    // this must find it while flagging nothing — a zero would mean the pattern stopped
    // matching. It used to also match `budgetRef` and `histRef`, on two other collections;
    // the anchored `col\b` above is what narrowed it to the collection this guard owns.
    expect(bound.length, 'bound-ref scan matched nothing — re-check the pattern').toBeGreaterThanOrEqual(1);

    expect(offenders, `bare streamingOffers WRITE id(s): ${offenders.join(', ')}`).toEqual([]);
  });

  it('no OTHER file under functions/src writes to streamingOffers', async () => {
    // V7 promises "a future writer is caught structurally". The scan above reads ONE file,
    // so a writer added in a NEW file would be invisible to it — the promise would be
    // broader than the guard, which is the defect class this whole ticket is about
    // (integration review, 2026-08-17).
    //
    // Closed by asserting the collection has exactly one writing module. If that stops
    // being true, this fails and whoever added the second one is told to bring it under
    // the guard rather than discovering the gap after a silent cross-title mix-up.
    const root = join(process.cwd(), 'functions/src');
    const files = (await readdir(root, { recursive: true, withFileTypes: true }))
      .filter((d) => d.isFile() && d.name.endsWith('.ts') && !d.name.endsWith('.test.ts'))
      .map((d) => join(d.parentPath ?? root, d.name));
    expect(files.length, 'no source files found — the walk broke').toBeGreaterThan(10);

    const writers: string[] = [];
    for (const file of files) {
      if (file.endsWith(join('streamingOffers', 'index.ts'))) continue; // the guarded one
      const body = await readFile(file, 'utf8');
      // The mutation must attach to a streamingOffers REF, not merely exist somewhere in
      // the same module. The first version required only "collection('streamingOffers')
      // appears" AND "some .set( appears", which flagged weeklyDigest — a pure reader
      // (`db.getAll(...)`) that happens to write to OTHER collections. A guard that cries
      // wolf on the one honest reader is a guard someone deletes.
      //
      // Two shapes, mirroring the single-file scan above: chained directly off the
      // collection, or bound to a name that is later mutated.
      // Anchored on `.doc(...)`, and spanning NEWLINES — `[^;\n]` was the bug. A long
      // chain broken across lines is this repo's own dominant idiom (availableNotify does
      // exactly that), so the first version could not see the shape it was most likely to
      // meet. The reviewer proved it with a three-line probe module and got zero writers.
      //
      // Widening to `[\s\S]` alone would be wrong the other way: it re-flags weeklyDigest,
      // whose `.doc(k)` sits a couple of hundred characters from an unrelated `map.set(`.
      // Anchoring the mutation to the REF is what separates a writer from a reader.
      const chained =
        new RegExp(
          `collection\\(\\s*${COL}\\s*\\)\\s*\\.\\s*doc\\([^;]*?\\)\\s*\\.\\s*(?:set|update|create)\\s*\\(`,
        ).test(body);
      // `(?:dbs*.s*)?` here too. The widening was decided a round earlier and landed on
      // only TWO of its three sites; this one kept `(?:db.)?` while the comment above
      // claimed the bound branch spans newlines. Measured: `const ref = db` / newline /
      // `.collection(...)` / `.doc(x);` then `ref.set(...)` in any module OTHER than
      // index.ts escaped all five scans — a bare-id write reaching main with the suite
      // green (integration review, 2026-08-18). A partially-landed fix whose comment says
      // otherwise is worse than no fix: it reads as covered.
      const boundNames = [...body.matchAll(
        new RegExp(`\\b(?:const|let)\\s+(\\w+)\\s*=\\s*(?:db\\s*\\.\\s*)?collection\\(\\s*${COL}\\s*\\)[^;]*`, 'g'),
      )].map((m) => m[1]);
      const boundWrite = boundNames.some((name) =>
        new RegExp(`\\b${name}\\b\\s*(?:\\.\\s*doc\\([^;]*?\\))?\\s*\\.\\s*(?:set|update|create)\\s*\\(`).test(body));
      if (chained || boundWrite) writers.push(file);
    }
    expect(
      writers,
      'a second streamingOffers writer appeared — bring it under the V7 guard above',
    ).toEqual([]);
  });

  it('no TWO-HOP bound write exists — the other shape this guard cannot see', async () => {
    // Honest limit number two, pinned rather than pretended away.
    //
    // Every bound-ref scan above follows exactly ONE hop: `const ref = <collection>.doc(x)`
    // then `ref.set(...)`. A two-hop chain slips through:
    //
    //   const c = db.collection('streamingOffers');
    //   const ref = c.doc(String(tmdbId));
    //   await ref.set({ tmdbId });
    //
    // The test review spliced exactly that into index.ts and got 24/24 green while a
    // genuine bare id was written — the BIN-523 cross-title defect, reintroduced past the
    // guard built to stop it (2026-08-17).
    //
    // NOT fixed by widening the regex again, and that is a decision rather than fatigue.
    // Widening after widening has opened a NEW hole the next reviewer found: the
    // single-quote-only scan, the newline-excluding character class, `db.` needing to
    // touch the dot, and a decided widening that landed on only two of its three sites.
    // No count in this sentence on purpose — a number in a comment goes stale the moment
    // the list grows, which is exactly what happened to the one that used to sit here.
    //
    // A regex cannot follow a binding chain; the tool that can is an AST rule, filed as
    // BIN-931 with the measured hole history that argues for it. That ticket, not another
    // widening, is the next move. Until then the shape is ASSERTED ABSENT, so the day
    // someone writes it this goes red and names what is missing — the same contract as
    // the batch-write test below.
    const root = join(process.cwd(), 'functions/src');
    const files = (await readdir(root, { recursive: true, withFileTypes: true }))
      .filter((d) => d.isFile() && d.name.endsWith('.ts') && !d.name.endsWith('.test.ts'))
      .map((d) => join(d.parentPath ?? root, d.name));
    expect(files.length, 'no source files found — the walk broke').toBeGreaterThan(10);

    const offenders: string[] = [];
    for (const file of files) {
      const body = await readFile(file, 'utf8');
      if (!new RegExp(COL).test(body)) continue;
      // Hop 1: a name bound to the bare collection, with NO `.doc()` of its own.
      const cols = [...body.matchAll(
        new RegExp(`\\b(?:const|let)\\s+(\\w+)\\s*=\\s*(?:db\\s*\\.\\s*)?collection\\(\\s*${COL}\\s*\\)\\s*;`, 'g'),
      )].map((m) => m[1]);
      for (const c of cols) {
        // Hop 2: a name bound to `<that>.doc(expr)`, later mutated.
        const refs = [...body.matchAll(
          new RegExp(`\\b(?:const|let)\\s+(\\w+)\\s*=\\s*${c}\\s*\\.\\s*doc\\(([^;]*?)\\)\\s*;`, 'g'),
        )];
        for (const [, refName, expr] of refs) {
          const writes = new RegExp(`\\b${refName}\\s*\\.\\s*(?:set|update|create)\\s*\\(`).test(body);
          if (writes && !/mediaTypeDocId|streamingOffersDocId|target\.toId/.test(expr)) {
            offenders.push(`${file}: ${refName} = ${c}.doc(${expr})`);
          }
        }
      }
    }
    expect(
      offenders,
      'a two-hop bound bare write appeared — the scans above do NOT follow binding chains',
    ).toEqual([]);
  });

  it('no batch write exists — the one shape this guard genuinely cannot see', async () => {
    // Honest limit, pinned as a test so it cannot quietly become a false claim of safety.
    // A `batch.set(col.doc(id), data)` passes the ref as an ARGUMENT, so neither the
    // chained scan nor the bound-ref scan classifies it as a write. Rather than pretend
    // to cover it, this asserts the shape is ABSENT from the module — so the day someone
    // adds one, this goes red and they are told the guard needs widening, instead of the
    // guard silently waving it through.
    // Over the SAME file walk as the cross-file test above, not just this module. Read
    // only `index.ts`, the escape hatch was pinned for one file while the sentence it
    // prints speaks for the whole collection — so `const wb = db.batch()` in a NEW module
    // passed every scan (integration review, 2026-08-17).
    const root = join(process.cwd(), 'functions/src');
    const files = (await readdir(root, { recursive: true, withFileTypes: true }))
      .filter((d) => d.isFile() && d.name.endsWith('.ts') && !d.name.endsWith('.test.ts'))
      .map((d) => join(d.parentPath ?? root, d.name));
    expect(files.length, 'no source files found — the walk broke').toBeGreaterThan(10);

    // …but only the files that touch THIS collection. Batching is a normal Firestore
    // idiom and other modules use it heavily (tmdbTosSweep clears in ≤500-write batches);
    // flagging those would make this guard fire on code it has no opinion about, and a
    // guard that cries wolf is a guard someone deletes. Scoped by mentioning the
    // collection at all — coarse on purpose in THIS direction, since the cost of a false
    // positive here is one comment and the cost of a false negative is BIN-523 again.
    const bodies = await Promise.all(files.map((f) => readFile(f, 'utf8')));
    const src = bodies.filter((b) => new RegExp(COL).test(b)).join('\n');
    expect(src.length, 'no file mentions the collection — the scope filter broke')
      .toBeGreaterThan(1000);

    // Keyed on the BINDING, not on a hoped-for variable name. The first version matched
    // only refs literally called `batch`/`bulkWriter`, so `const wb = db.batch();
    // wb.set(col.doc(String(id)), …)` sailed through all three scans with zero offenders
    // AND zero batch matches — the reviewer ran exactly that (integration review,
    // 2026-08-17). Now the binding site is found first, then writes through its name.
    const batchBindings = [...src.matchAll(/\b(?:const|let)\s+(\w+)\s*=\s*[\w.]*\.?(?:batch|bulkWriter)\s*\(\)/g)]
      .map((m) => m[1]);
    const batchWrites = [
      ...src.matchAll(/\b(?:batch|bulkWriter)\s*\.\s*(?:set|update|create)\s*\(/g),
      ...batchBindings.flatMap((name) =>
        [...src.matchAll(new RegExp(`\\b${name}\\s*\\.\\s*(?:set|update|create)\\s*\\(`, 'g'))]),
    ];
    expect(
      batchWrites.map((m) => m[0]),
      'a batch write appeared — the V7 guard above does NOT check it; widen it or check by hand',
    ).toEqual([]);
  });

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
