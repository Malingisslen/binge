// BIN-655 — the parity matrix for `buildAddWrite`.
//
// The split replaced one skewed function (`addItem` + a `countsAsViewing` boolean) with
// two entry points over ONE builder. #27 Database Administrator approved it and named
// the risk in the same breath: you can swap a skewed function for two that DRIFT. This
// file is the answer to that. It is not a snapshot — every expectation is a literal
// key set, captured from the behaviour that shipped before the split, so a mutation to
// any single guard names WHICH cell moved rather than reddening one opaque blob.
//
// The contract under test, and it is deliberately narrow:
//   INTENT GATES EXACTLY TWO THINGS —
//     1. whether `rewatchFields` applies at all;
//     2. the OVERWRITE half of the `sedd` watchedAt branch.
//   Everything else is identical on both paths, INCLUDING stamping a title's first
//   watch date. A bulk import of a film the user has never seen still deserves one.
//
// This is the code every CSV import and every onboarding run executes, writing to every
// title in every library. A behaviour change here is silent and retroactive.

import { describe, it, expect, beforeAll } from 'vitest';
import { buildAddWrite, outcomeOfAddWrite, type AddWriteContext, type WriteIntent } from './watchlistWrites';
import type { WatchlistItem, WatchStatus } from '@/types';
import type { WatchlistAddPayload } from '@/lib/watchlist/buildAddPayload';

// A sentinel rather than a Date: `serverTimestamp()` returns an opaque Firestore
// FieldValue in production, and asserting on identity proves the builder passed the
// injected function's result through rather than inventing a client clock. A client
// `new Date()` here would be a real bug — clock skew writes the wrong month into
// Dagbok and the monthly activity counters.
const TS = Symbol('serverTimestamp') as unknown as object;

const VIS = { effectiveVisibility: 'private' as const, isPublic: false };

function ctx(over: Partial<AddWriteContext> = {}): AddWriteContext {
  return {
    current: undefined,
    snapshotSettled: true,
    listenerFailed: false,
    visibilityFields: VIS,
    serverTimestamp: () => TS,
    ...over,
  };
}

function payload(over: Partial<WatchlistAddPayload> = {}): WatchlistAddPayload {
  return {
    tmdbId: 42,
    mediaType: 'movie',
    status: 'sedd',
    title: 'The Matrix',
    posterPath: null,
    releaseYear: 1999,
    ...over,
  };
}

function stored(over: Partial<WatchlistItem> = {}): WatchlistItem {
  return {
    tmdbId: 42,
    mediaType: 'movie',
    status: 'sedd',
    rating: null,
    notes: null,
    title: 'The Matrix',
    posterPath: null,
    releaseYear: 1999,
    totalSeasons: null,
    lastWatchedSeason: null,
    lastWatchedEpisode: null,
    dropped: false,
    rewatchCount: 2,
    providers: [],
    subscriptionProviders: null,
    providersCheckedAt: null,
    visibility: null,
    genreIds: [],
    tmdbStatus: null,
    addedAt: new Date('2020-01-01'),
    updatedAt: new Date('2020-01-01'),
    watchedAt: new Date('2019-04-02'),
    ...over,
  } as WatchlistItem;
}

const keys = (o: Record<string, unknown>) => Object.keys(o).sort();
const BOTH: WriteIntent[] = ['bulk', 'viewing'];

// ── The matrix ─────────────────────────────────────────────────────────────────────
//
// Each row is a real situation with a name, its context, and the EXACT stamp keys the
// write may carry. "Stamp keys" = everything the builder decides; the payload's own
// fields pass through untouched and are asserted separately below, so a row that
// changes a stamp cannot hide behind forty carried-over keys.

const STAMPS = [
  'addedAt', 'updatedAt', 'watchedAt', 'rewatchCount',
  'tmdbFieldsRefreshedAt', 'providersCheckedAt', 'ratedAt',
  'effectiveVisibility', 'isPublic', 'dropped',
] as const;

const stampsOf = (o: Record<string, unknown>) =>
  STAMPS.filter(k => k in o).sort();

interface Row {
  name: string;
  item: WatchlistAddPayload;
  ctx: AddWriteContext;
  /** Stamps expected on the BULK path. */
  bulk: string[];
  /** Stamps expected on the VIEWING path. Equal to `bulk` except where intent may act. */
  viewing: string[];
}

const MATRIX: Row[] = [
  {
    // A genuinely new title, snapshot landed. The only row that stamps everything:
    // it is the one write that really did denormalize fresh TMDB data.
    name: 'new add, settled, providers supplied',
    item: payload({ providers: [8], subscriptionProviders: [8] }),
    ctx: ctx(),
    bulk: ['addedAt', 'dropped', 'effectiveVisibility', 'isPublic', 'providersCheckedAt', 'tmdbFieldsRefreshedAt', 'updatedAt', 'watchedAt'],
    viewing: ['addedAt', 'dropped', 'effectiveVisibility', 'isPublic', 'providersCheckedAt', 'tmdbFieldsRefreshedAt', 'updatedAt', 'watchedAt'],
  },
  {
    // BIN-814: only the broad list supplied → the providers stamp stays ABSENT, so
    // the title-page repair is not gated out for 60 days on a half-filled group.
    name: 'new add, only the broad provider list',
    item: payload({ providers: [8] }),
    ctx: ctx(),
    bulk: ['addedAt', 'dropped', 'effectiveVisibility', 'isPublic', 'tmdbFieldsRefreshedAt', 'updatedAt', 'watchedAt'],
    viewing: ['addedAt', 'dropped', 'effectiveVisibility', 'isPublic', 'tmdbFieldsRefreshedAt', 'updatedAt', 'watchedAt'],
  },
  {
    // THE row the split is about. A re-mark of an already-'sedd' film: bulk restores
    // it and counts nothing; a human "Sedd igen" counts AND re-dates. This is the
    // only cell in the matrix where the two columns differ.
    name: 're-mark of a sedd film (the rewatch cell)',
    item: payload(),
    ctx: ctx({ current: stored() }),
    bulk: ['dropped', 'effectiveVisibility', 'isPublic', 'updatedAt'],
    viewing: ['dropped', 'effectiveVisibility', 'isPublic', 'rewatchCount', 'updatedAt', 'watchedAt'],
  },
  {
    // A tracked film that is NOT sedd. Intent must change nothing: the re-date gates
    // on the counted OUTCOME, so intent here would otherwise stomp a user-authored
    // date while counting nothing — incoherent, and watchedAt is unrecoverable.
    name: 're-mark of a vill_se film, written as vill_se',
    item: payload({ status: 'vill_se' as WatchStatus }),
    ctx: ctx({ current: stored({ status: 'vill_se' }) }),
    bulk: ['dropped', 'effectiveVisibility', 'isPublic', 'updatedAt'],
    viewing: ['dropped', 'effectiveVisibility', 'isPublic', 'updatedAt'],
  },
  {
    // A tracked film with NO stored date, marked sedd. Both paths stamp the FIRST
    // date — this is the disjunct intent does not gate, and the reason a bulk CSV
    // import of an unseen film still gets a date.
    name: 'tracked film with no watchedAt, marked sedd',
    item: payload(),
    ctx: ctx({ current: stored({ status: 'vill_se', watchedAt: null }) }),
    bulk: ['dropped', 'effectiveVisibility', 'isPublic', 'updatedAt', 'watchedAt'],
    viewing: ['dropped', 'effectiveVisibility', 'isPublic', 'updatedAt', 'watchedAt'],
  },
  {
    // COLD LOAD. `current` is undefined for every title, so a re-mark is
    // indistinguishable from a new add. addedAt still stamps (a doc with no date
    // sorts nowhere and never recovers); the three STRICT gates say nothing.
    name: 'cold load — snapshot has not settled',
    item: payload({ providers: [8], subscriptionProviders: [8] }),
    ctx: ctx({ snapshotSettled: false }),
    bulk: ['addedAt', 'dropped', 'effectiveVisibility', 'isPublic', 'updatedAt'],
    viewing: ['addedAt', 'dropped', 'effectiveVisibility', 'isPublic', 'updatedAt'],
  },
  {
    // BIN-601 — a DEAD listener is not a cold load. Stamping addedAt here would
    // rewrite the real add date of a title that may be years old. Unrecoverable.
    name: 'dead listener — addedAt is withheld too',
    item: payload({ providers: [8], subscriptionProviders: [8] }),
    ctx: ctx({ snapshotSettled: false, listenerFailed: true }),
    bulk: ['dropped', 'effectiveVisibility', 'isPublic', 'updatedAt'],
    viewing: ['dropped', 'effectiveVisibility', 'isPublic', 'updatedAt'],
  },
  {
    // BIN-349 — a changed rating stamps ratedAt; see the next row for the control.
    name: 're-mark carrying a CHANGED rating',
    item: payload({ rating: 5 }),
    ctx: ctx({ current: stored({ status: 'vill_se', rating: 3 }) }),
    bulk: ['dropped', 'effectiveVisibility', 'isPublic', 'ratedAt', 'updatedAt'],
    viewing: ['dropped', 'effectiveVisibility', 'isPublic', 'ratedAt', 'updatedAt'],
  },
  {
    // …and the same rating must NOT bump recency. Without this the "din senaste 5★"
    // anchor would re-fire on every ordinary re-mark.
    name: 're-mark carrying the UNCHANGED rating',
    item: payload({ rating: 3 }),
    ctx: ctx({ current: stored({ status: 'vill_se', rating: 3 }) }),
    bulk: ['dropped', 'effectiveVisibility', 'isPublic', 'updatedAt'],
    viewing: ['dropped', 'effectiveVisibility', 'isPublic', 'updatedAt'],
  },
  {
    // BIN-595 — a title the user HID keeps its own visibility. Writing the profile
    // default here would republish it on nothing more than a status change.
    name: 're-mark of a title with a per-item visibility override',
    item: payload({ status: 'vill_se' as WatchStatus }),
    ctx: ctx({ current: stored({ status: 'vill_se', visibility: 'private' }) }),
    bulk: ['dropped', 'updatedAt'],
    viewing: ['dropped', 'updatedAt'],
  },
  {
    // A series. 'sedd' is the terminal FILM status, so a TV write lands as 'mina'
    // and can never be a rewatch — intent is inert by construction.
    name: 'series re-mark, written as mina',
    item: payload({ mediaType: 'tv', status: 'mina' as WatchStatus }),
    ctx: ctx({ current: stored({ mediaType: 'tv', status: 'mina' }) }),
    bulk: ['dropped', 'effectiveVisibility', 'isPublic', 'updatedAt'],
    viewing: ['dropped', 'effectiveVisibility', 'isPublic', 'updatedAt'],
  },
];

describe('buildAddWrite — the parity matrix (BIN-655)', () => {
  it.each(MATRIX)('$name — bulk', (row) => {
    expect(stampsOf(buildAddWrite(row.item, 'bulk', row.ctx))).toEqual(row.bulk);
  });

  it.each(MATRIX)('$name — viewing', (row) => {
    expect(stampsOf(buildAddWrite(row.item, 'viewing', row.ctx))).toEqual(row.viewing);
  });

  it('the matrix is not empty and has no duplicate rows', () => {
    // `it.each([])` registers ZERO tests and reports no error, so an emptied matrix
    // would make every assertion above vanish silently. The names are the identity —
    // a copy-pasted row would pad the count without testing anything new.
    expect(MATRIX.length).toBeGreaterThanOrEqual(11);
    expect(new Set(MATRIX.map(r => r.name)).size).toBe(MATRIX.length);
  });

  it('EXACTLY ONE row in the matrix distinguishes the two paths', () => {
    // The contract, asserted as a property rather than trusted per row. If a future
    // change makes intent matter somewhere else, this fails and names the row — which
    // is the drift #27 warned about, caught at the moment it is introduced.
    const differing = MATRIX.filter(r => JSON.stringify(r.bulk) !== JSON.stringify(r.viewing));
    expect(differing.map(r => r.name)).toEqual(['re-mark of a sedd film (the rewatch cell)']);
  });

  it('and it differs by the counter and the re-date, nothing else', () => {
    const row = MATRIX.find(r => r.bulk.join() !== r.viewing.join())!;
    const extra = row.viewing.filter(k => !row.bulk.includes(k));
    const missing = row.bulk.filter(k => !row.viewing.includes(k));
    expect(extra.sort()).toEqual(['rewatchCount', 'watchedAt']);
    expect(missing).toEqual([]);
  });
});

describe('buildAddWrite — what intent may never touch', () => {
  it('carries the payload fields through untouched on both paths', () => {
    // The matrix asserts on STAMPS only, so this is what stops a guard from quietly
    // dropping or rewriting a caller-supplied field and going unnoticed.
    const item = payload({ rating: 4, genreIds: [28], tmdbStatus: 'Released', totalSeasons: null });
    for (const intent of BOTH) {
      const out = buildAddWrite(item, intent, ctx({ current: stored({ status: 'vill_se' }) }));
      for (const [k, v] of Object.entries(item)) expect(out[k]).toEqual(v);
    }
  });

  it('never writes an intent field into the document', () => {
    // firestore.rules' isValidWatchlistItem uses a hasOnly allowlist, so a stray key
    // either lands as junk or fails the whole merge-write with permission-denied.
    // That already happened once, with `notes`. The old boolean was a second
    // parameter for this reason; now there is no second parameter at all.
    for (const intent of BOTH) {
      const out = buildAddWrite(payload(), intent, ctx());
      expect(keys(out)).not.toContain('countsAsViewing');
      expect(keys(out)).not.toContain('intent');
    }
  });

  it('strips an inline note on both paths (BIN-505 is a privacy invariant)', () => {
    // Off-type on purpose: `WatchlistAddPayload` no longer accepts `notes`, which
    // stops every type-checked caller. This runtime strip is for the ones types
    // cannot reach — a cast, plain JS, a future refactor that widens the signature.
    const withNote = { ...payload(), notes: 'hemlig' } as WatchlistAddPayload;
    for (const intent of BOTH) {
      expect(keys(buildAddWrite(withNote, intent, ctx()))).not.toContain('notes');
    }
  });

  it('strips inline tags on both paths (BIN-164/BIN-894 is the same privacy invariant)', () => {
    // Off-type on purpose, exactly like the note above: `WatchlistAddPayload` no longer
    // accepts `tags` either. This is the likelier accident of the two — WatchlistContext
    // JOINS tags onto every item in memory, so a caller that spreads a row it read from
    // the context is holding populated tags without having typed the word.
    // `hasOnly` has no `tags` key, so one landing here is permission-denied for the
    // whole doc, not a quiet extra field.
    const withTags = { ...payload(), tags: ['med mamma'] } as WatchlistAddPayload;
    for (const intent of BOTH) {
      expect(keys(buildAddWrite(withTags, intent, ctx()))).not.toContain('tags');
    }
  });

  it('uses the INJECTED clock for every stamp, never a client Date', () => {
    // Identity, not shape. A client `new Date()` would typecheck and read fine, and
    // silently write the wrong month into Dagbok and the monthly activity counters
    // for anyone with a skewed clock.
    const out = buildAddWrite(
      payload({ rating: 5, providers: [8], subscriptionProviders: [8] }),
      'viewing',
      ctx(),
    );
    for (const k of ['addedAt', 'updatedAt', 'watchedAt', 'tmdbFieldsRefreshedAt', 'providersCheckedAt', 'ratedAt']) {
      expect(out[k]).toBe(TS);
    }
  });
});

describe('buildAddWrite — the coherence invariant (BIN-641)', () => {
  // "wherever this counts, the caller must ALSO re-date" — the code says it, and this
  // is what holds it. The counted rewatch is the app's only permanent, un-editable
  // write AND the only one that overwrites a user-authored date; a count without a
  // fresh date is the half-feature Malin rejected, and a re-date without a count is
  // an unrecoverable stomp for nothing.
  const CASES: Array<{ name: string; ctx: AddWriteContext; item?: WatchlistAddPayload }> = [
    { name: 'sedd re-mark', ctx: ctx({ current: stored() }) },
    { name: 'first viewing', ctx: ctx() },
    { name: 'cold load', ctx: ctx({ snapshotSettled: false }) },
    { name: 'dead listener', ctx: ctx({ listenerFailed: true }) },
    { name: 'tracked but vill_se', ctx: ctx({ current: stored({ status: 'vill_se' }) }) },
    { name: 'no stored date', ctx: ctx({ current: stored({ status: 'vill_se', watchedAt: null }) }) },
    { name: 'series', ctx: ctx({ current: stored({ mediaType: 'tv', status: 'mina' }) }), item: payload({ mediaType: 'tv', status: 'mina' as WatchStatus }) },
  ];

  it.each(CASES)('$name — a count is never written without a re-date', (c) => {
    for (const intent of BOTH) {
      const out = buildAddWrite(c.item ?? payload(), intent, c.ctx);
      if ('rewatchCount' in out) expect(out).toHaveProperty('watchedAt');
    }
  });

  it.each(CASES)('$name — the BULK path counts nothing, ever', (c) => {
    // BIN-599 in test form, and now structural: the quick-rate modal used to reach
    // the counting path and inflate a permanent counter once per pass.
    expect(buildAddWrite(c.item ?? payload(), 'bulk', c.ctx)).not.toHaveProperty('rewatchCount');
  });

  it('a cold load counts nothing and re-dates nothing, even asked to', () => {
    // `current` is undefined for every title during a cold load, so the count cannot
    // be computed — and because the re-date gates on the counted OUTCOME rather than
    // on the intent, it follows automatically. Neither is user-fixable.
    const out = buildAddWrite(payload(), 'viewing', ctx({ snapshotSettled: false }));
    expect(out).not.toHaveProperty('rewatchCount');
    expect(out).not.toHaveProperty('watchedAt');
  });

  // BIN-978 — the half the coherence cases above cannot reach. They all ask "does a
  // count arrive without a re-date?", and they build the count the only legitimate way:
  // by letting `rewatchFields` derive it. The question here is the mirror image — can a
  // count the caller SUPPLIED buy a re-date? — and nothing pinned it: mutating the gate
  // to `'rewatchCount' in rewatch || 'rewatchCount' in item` left both suites at 88/88.
  //
  // `watchedAt` is user-authored (Malin, 2026-07-25) and a stomped date is gone — the
  // date picker can restore a MISSING one, never a replaced one. So the boundary that
  // matters is not "may the key ride along" (BIN-928 decided it may, at the type level)
  // but "may it decide anything". It may not.
  //
  // The cast is the point, not a shortcut: `buildAddPayload`'s `ServerOwned` set keeps
  // `rewatchCount` off `WatchlistAddPayload`, so the only ways this value can appear at
  // runtime are the ones types cannot reach — a cast, plain JS, or a future refactor
  // widening the signature. Deliberately NOT fixed by widening the type here; that would
  // reopen the boundary BIN-928 decided to keep closed.
  const forged = (over: Partial<WatchlistAddPayload> = {}) =>
    ({ ...payload(over), rewatchCount: 9 } as WatchlistAddPayload);

  it.each(BOTH)('%s — a caller-supplied rewatchCount does not re-date a stored watchedAt', (intent) => {
    // Tracked, NOT currently 'sedd', so `rewatchFields` derives nothing on either path —
    // and the stored date exists, so `canAutoStampWatchedAt` refuses too. Under the
    // merged-payload mutant the forged key alone would be enough.
    const out = buildAddWrite(forged(), intent, ctx({ current: stored({ status: 'vill_se' }) }));
    expect(out).not.toHaveProperty('watchedAt');
  });

  it('and the same forged payload cannot re-date on the bulk path even from a sedd title', () => {
    // The one case where a REAL rewatch would re-date — except the bulk path never counts,
    // so the only `rewatchCount` present is the caller's. It must still change nothing.
    const out = buildAddWrite(forged(), 'bulk', ctx({ current: stored() }));
    expect(out).not.toHaveProperty('watchedAt');
    // The key itself still rides through untouched — that is BIN-928's decided boundary,
    // and this assertion is what stops a later "fix" from silently moving it.
    expect(out.rewatchCount).toBe(9);
  });

  it('BIN-1024 — but it DOES buy the caller a rewatch REPORT, and that is the open half', () => {
    // The other consequence of the same key. `buildAddWrite` refuses to let a supplied
    // `rewatchCount` re-date `watchedAt` (the three rows above); `outcomeOfAddWrite` reads
    // `'rewatchCount' in write`, which is the FINISHED payload, so the key rides in through
    // `...itemFields` and the outcome says a rewatch was counted when nothing was.
    //
    // `outcomeOfAddWrite` is what gates the "Sedd igen" sentence the user reads. So the
    // report is wrong even though the stored data is right — one key, two consequences,
    // and BIN-978 only closed the one with teeth.
    //
    // This test does NOT change that. BIN-928 decided against a runtime strip and the
    // JSDoc explains why (the strip beside it is a PRIVACY boundary, and folding an
    // unrelated invariant in would leave neither reason legible). The protection is at the
    // type level. What was missing was anything that FAILS if the type level stops
    // holding, and this is it: widen `WatchlistAddPayload` to admit the key and this row
    // is where a reviewer meets the decision.
    const out = buildAddWrite(forged(), 'bulk', ctx({ current: stored() }));
    expect(outcomeOfAddWrite(out as unknown as Record<string, unknown>)).toEqual({ countedRewatch: true });
  });

  it('control — an honest bulk write reports no rewatch, so the row above is not vacuous', () => {
    const out = buildAddWrite(payload(), 'bulk', ctx({ current: stored() }));
    expect(outcomeOfAddWrite(out as unknown as Record<string, unknown>)).toEqual({ countedRewatch: false });
  });

  it('control — a genuine counted rewatch DOES re-date, so the three above are not vacuous', () => {
    const out = buildAddWrite(payload(), 'viewing', ctx({ current: stored() }));
    expect(out.rewatchCount).toBe(3);
    expect(out.watchedAt).toBe(TS);
  });

  it('increments from the STORED count, and from 0 when it is missing', () => {
    // The `?? 0` default is the part that carries risk, not the comparison — an
    // off-by-one here is permanent, since rewatchCount is editable nowhere.
    expect(buildAddWrite(payload(), 'viewing', ctx({ current: stored({ rewatchCount: 7 }) })).rewatchCount).toBe(8);
    expect(
      buildAddWrite(payload(), 'viewing', ctx({ current: stored({ rewatchCount: null as unknown as number }) })).rewatchCount,
    ).toBe(1);
  });
});

// ── The split cannot be un-split by accident ────────────────────────────────────────
//
// #27's sixth condition. Two entry points only help while there are only two: a
// caller that reintroduces a boolean-flagged `addItem`, or reaches the counting path
// from a bulk surface, puts BIN-599's class of bug straight back. Source-scanning
// rather than type-level, because the failure it guards is a NEW function nobody has
// typed yet — and because "the flag is gone" is a claim about the whole tree, which no
// single module can make about itself.

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(e.name) ? [full] : [];
  });
}

describe('BIN-655 — the flag is gone and stays gone', () => {
  const files = sourceFiles(SRC);

  // BIN-937: two assertions below each used to re-read the WHOLE src/ tree with
  // readFileSync, so each one paid for its own full-tree pass of pure I/O inside vitest's
  // 5s default. Under load (parallel workers, another suite, a background run) that ran
  // out twice at 5000ms while passing in five other full runs the same evening — and a
  // timeout in a RATCHET test reads exactly like the regression it exists to catch, which
  // is the expensive part. Read once, share the result. The assertions themselves are
  // untouched; only where they read from changed.
  const source = new Map<string, string>();
  beforeAll(() => {
    for (const f of files) source.set(f, readFileSync(f, 'utf8'));
  });

  // A miss means the cache and the file list disagree — the one way this caching could
  // turn a real assertion into a vacuous one, by silently matching nothing. Throwing is
  // what keeps "read from the cache" as strong as "read from disk".
  const read = (f: string): string => {
    const s = source.get(f);
    if (s === undefined) throw new Error(`BIN-937: no cached source for ${f}`);
    return s;
  };

  it('finds a real source tree, so the assertions below are not vacuous', () => {
    // A walk that returns nothing makes every `expect` in this block trivially true —
    // the silent-pass this whole ticket is about, one level up.
    expect(files.length).toBeGreaterThan(200);
    expect(files.some(f => f.endsWith('WatchlistContext.tsx'))).toBe(true);
    // …and the same question asked of the CACHE the heavy assertions actually read, not
    // just of the list they iterate. An empty or short cache would make both of them pass
    // on nothing, which is the identical silent-pass one layer further in.
    expect(source.size).toBe(files.length);
    expect(read(files.find(f => f.endsWith('WatchlistContext.tsx'))!).length).toBeGreaterThan(0);
  });

  it('neither entry point takes a second parameter', () => {
    // useMarkSeen still takes `countsAsViewing` — that is a HUMAN hook choosing between
    // two human gestures ("Sedd" vs "Sedd igen"), and it now selects a FUNCTION rather
    // than travelling into one. What must never come back is an options argument on the
    // WRITE, because that is the shape whose default a new caller can forget, and it is
    // what let BIN-599 and BIN-641 happen at the call site twice.
    //
    // Read off the declared signatures rather than searched for: a one-parameter
    // function cannot be handed a flag, and TypeScript enforces that for every existing
    // caller — but only while the signature stays one parameter. This is the part the
    // compiler cannot defend against, because widening it is legal.
    //
    // The RETURN type is deliberately not pinned: BIN-895 changed it from
    // `Promise<void>` to `Promise<TitleWriteOutcome>` so the write can report what it
    // actually wrote, and that is the OPPOSITE direction — an answer coming back, not
    // intent going in. What this guard owns is the parameter list, so it matches any
    // return type and keeps asserting the one thing that matters.
    const ctxSrc = readFileSync(join(SRC, 'contexts', 'WatchlistContext.tsx'), 'utf8');
    for (const name of ['upsertTitle', 'logViewing']) {
      const decl = new RegExp(`^\\s*${name}: \\(([^)]*)\\) => Promise<[^;]+>;`, 'm').exec(ctxSrc);
      expect(decl, `${name} is not declared on WatchlistState`).not.toBeNull();
      expect(decl![1].split(',')).toHaveLength(1);
      expect(decl![1]).not.toContain('countsAsViewing');
    }
  });

  it('nothing calls a watchlist addItem any more', () => {
    // `addItemToList` (the user-lists feature) is a different function on a different
    // collection and is deliberately not matched.
    //
    // Matches a CALL, not a mention. Several files still discuss `addItem` in prose —
    // it is what these guards were written for, and the history is worth keeping — and
    // a guard that reddened on the word would push the next person to delete the
    // explanation rather than the code.
    // `\??\.?` covers the optional-chaining shape too (`ctx.addItem?.(x)`), which the
    // plain call pattern misses. None exists today; a guard that only catches the
    // spelling you happened to think of is the kind that reads as coverage.
    //
    // This file excludes ITSELF. The self-match is the CODE EXAMPLE in the comment
    // above, not the regex literal (test review, 2026-08-14 traced it — an earlier
    // version of this comment named the wrong mechanism). Named explicitly rather than
    // filtered by `.test.ts`, so the guard keeps covering every other test file.
    // Known residual, written down rather than left to be rediscovered: a real
    // `addItem(...)` call added anywhere ELSE in this same file would also slip past,
    // because the exemption is whole-file. Narrowing it to the comment line would trade
    // that for a guard nobody can read.
    const offenders = files
      .filter((f) => !f.endsWith('watchlistWrites.addWrite.test.ts'))
      .filter((f) => /\baddItem\s*\??\.?\s*\(/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('and the context no longer OFFERS one', () => {
    // The other half: a call site can only exist if something exposes it. This reads
    // the TYPE, so a re-added member fails here before any caller shows up.
    const ctxSrc = readFileSync(join(SRC, 'contexts', 'WatchlistContext.tsx'), 'utf8');
    // Both bounds are asserted found: `indexOf` returns -1 for a missing needle, and
    // `slice(n, -1)` silently returns almost the whole file — a rename would leave this
    // test green while it stopped reading the interface at all (security review,
    // 2026-08-14: the closing bound said `const WatchlistCtx`, which matches nothing —
    // the symbol is `WatchlistContext`).
    const from = ctxSrc.indexOf('interface WatchlistState');
    const to = ctxSrc.indexOf('const WatchlistContext = createContext');
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    const state = ctxSrc.slice(from, to);
    expect(state.length).toBeGreaterThan(200); // the slice really found the interface
    expect(state).not.toMatch(/^\s*addItem\s*[?:]/m);
    // …and the two that replaced it ARE offered, so this cannot pass by reading the
    // wrong slice of the file.
    expect(state).toMatch(/^\s*upsertTitle:/m);
    expect(state).toMatch(/^\s*logViewing:/m);
  });

  it('only useMarkSeen reaches the counting entry point', () => {
    // The narrow list is the point: every OTHER surface is replaying data, and a bulk
    // caller on the counting path is BIN-599 exactly. A new mark-seen surface adds
    // itself here deliberately, in a diff a reviewer reads. Prose mentions are excluded
    // the same way as above — a name followed by `(`, `,` or `}` is a use, not a story.
    const callers = files
      .filter((f) => !/\.test\.tsx?$/.test(f))
      .filter((f) => /\blogViewing\s*[(,}]/.test(read(f)))
      .map((f) => f.split(/[\\/]/).slice(-2).join('/'))
      .sort();
    expect(callers).toEqual([
      'contexts/WatchlistContext.tsx', // where it is defined
      'hooks/useMarkSeen.ts',          // "Sedd" / "Sedd igen", both film branches
    ]);
  });
});
