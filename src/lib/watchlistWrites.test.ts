import { describe, it, expect } from 'vitest';
import {
  buildStatusUpdate, normalizeTags, resolveCurrentWatchedAt, canAutoStampWatchedAt,
  shouldStampVisibility, planQuickRateWrite, rewatchFields, MAX_TAGS_PER_ITEM, MAX_TAG_LENGTH,
} from './watchlistWrites';

// A stand-in for the serverTimestamp() sentinel — the helper just passes it
// through, so any recognisable value works.
const TS = '__server_ts__';
const base = { now: TS, visFields: {} };

describe('buildStatusUpdate', () => {
  it('always sets status and updatedAt', () => {
    const p = buildStatusUpdate('vill_se', base);
    expect(p.status).toBe('vill_se');
    expect(p.updatedAt).toBe(TS);
  });

  // BIN-35 — the core of the fix: clearing the legacy dropped flag.
  it('writes dropped:false for every non-avbruten status (clears legacy flag)', () => {
    for (const s of ['vill_se', 'mina', 'sedd'] as const) {
      expect(buildStatusUpdate(s, base).dropped).toBe(false);
    }
  });

  it('does NOT write dropped when status is avbruten', () => {
    expect('dropped' in buildStatusUpdate('avbruten', base)).toBe(false);
  });

  it('sets watchedAt only for sedd (and only when none is stored)', () => {
    expect(buildStatusUpdate('sedd', { ...base, currentWatchedAt: null }).watchedAt).toBe(TS);
    expect('watchedAt' in buildStatusUpdate('mina', { ...base, currentWatchedAt: null })).toBe(false);
    expect('watchedAt' in buildStatusUpdate('vill_se', { ...base, currentWatchedAt: null })).toBe(false);
  });

  // BIN-91 — backdating.
  it('uses watchedAtOverride for sedd when provided (updatedAt stays now)', () => {
    const OVERRIDE = '__backdated__';
    const p = buildStatusUpdate('sedd', { ...base, currentWatchedAt: null, watchedAtOverride: OVERRIDE });
    expect(p.watchedAt).toBe(OVERRIDE);
    expect(p.updatedAt).toBe(TS); // write-time is always now, not the override
  });

  it('falls back to now when watchedAtOverride is absent or explicitly undefined', () => {
    expect(buildStatusUpdate('sedd', { ...base, currentWatchedAt: null }).watchedAt).toBe(TS);
    // The context passes `undefined` literally (watchedAt ? … : undefined) — pin that.
    expect(
      buildStatusUpdate('sedd', { ...base, currentWatchedAt: null, watchedAtOverride: undefined }).watchedAt,
    ).toBe(TS);
  });

  it('ignores watchedAtOverride for non-sedd statuses (no watchedAt key)', () => {
    expect('watchedAt' in buildStatusUpdate('mina', { ...base, watchedAtOverride: '__x__' })).toBe(false);
  });

  // ── BIN-593 — watchedAt is user-authored data ────────────────────────────────
  // Malin, 2026-07-25: "har man manuellt justerat 'sett' ska det bara ändras om
  // man själv manuellt ändrar igen". These writes merge, so "leave it alone"
  // means the key must be ABSENT — a null would destroy the stored date.

  it('BIN-593: does NOT re-stamp watchedAt when the title already has one', () => {
    const STORED = new Date('2019-04-02T00:00:00Z');
    // The headline data-loss case: re-marking an already-seen film (a rewatch)
    // must not overwrite a date the user backdated via WatchedDateEditor.
    const p = buildStatusUpdate('sedd', {
      ...base, currentStatus: 'sedd', currentWatchedAt: STORED,
    });
    expect('watchedAt' in p).toBe(false);
    // …while the rewatch itself is still recorded.
    expect(p.rewatchCount).toBe(1);
  });

  it('BIN-593: a stored watch date never, on its own, counts as a rewatch', () => {
    // Guards against re-broadening isRewatch to "a date exists ⇒ seen before".
    // That looks right until you remember this same ticket stopped a status change
    // from CLEARING the date: a mis-click leaves one behind too. Undo the mis-click,
    // watch the film for real later, and the broader rule renders "x2" on a film
    // seen once — permanently, since rewatchCount is editable nowhere.
    const p = buildStatusUpdate('sedd', {
      ...base, currentStatus: 'vill_se', currentRewatchCount: 1,
      currentWatchedAt: new Date('2019-04-02T00:00:00Z'),
    });
    expect('rewatchCount' in p).toBe(false);
    // …and the date is still protected — that half is the ticket.
    expect('watchedAt' in p).toBe(false);
  });

  it('BIN-593: a sedd re-mark of a DATELESS title supplies the first date (and still counts the rewatch)', () => {
    // The combination the other cases miss: already 'sedd' but carrying no date —
    // a legacy doc, or one created in the cold-load window (BIN-596). Both halves
    // of the write must fire, and the stamp must not be suppressed just because
    // the title was already sedd.
    const p = buildStatusUpdate('sedd', {
      ...base, currentStatus: 'sedd', currentRewatchCount: 0, currentWatchedAt: null,
    });
    expect(p.watchedAt).toBe(TS);
    expect(p.rewatchCount).toBe(1);
  });

  it('BIN-593: a manual override still wins over a stored date', () => {
    const p = buildStatusUpdate('sedd', {
      ...base, currentWatchedAt: new Date('2019-04-02T00:00:00Z'), watchedAtOverride: '__picked__',
    });
    expect(p.watchedAt).toBe('__picked__');
  });

  it('BIN-593: stays SILENT when the current date is unknown (cold load)', () => {
    // undefined ≠ null. During a cold load the caller cannot tell a new title from
    // one carrying a backdated date, and stamping there is unrecoverable — so the
    // key is omitted. `base` deliberately carries no currentWatchedAt at all, which
    // is the same unknown state reached via an absent key.
    expect('watchedAt' in buildStatusUpdate('sedd', base)).toBe(false);
    expect('watchedAt' in buildStatusUpdate('sedd', { ...base, currentWatchedAt: undefined })).toBe(false);
  });

  it('BIN-593: leaving sedd omits watchedAt entirely (the date survives the status change)', () => {
    // Honest scope: buildStatusUpdate NEVER wrote the destructive `watchedAt: null`
    // — that lived in addItem, and its own test in WatchlistContext.test.tsx covers
    // it. So this passes on pre-BIN-593 code too. It is here to pin the OTHER half
    // of the same invariant: this function must not start writing one either.
    //
    // Consumers must therefore gate on `status` rather than on the date's presence.
    // They defend against this survival; they don't depend on it.
    for (const s of ['vill_se', 'mina', 'avbruten'] as const) {
      const p = buildStatusUpdate(s, { ...base, currentStatus: 'sedd', currentWatchedAt: new Date('2019-04-02T00:00:00Z') });
      expect('watchedAt' in p).toBe(false);
    }
  });

  it('increments rewatchCount only when re-marking sedd over sedd', () => {
    expect(buildStatusUpdate('sedd', { ...base, currentStatus: 'sedd', currentRewatchCount: 2 }).rewatchCount).toBe(3);
    // First time to sedd (from another status) → no rewatch increment.
    expect('rewatchCount' in buildStatusUpdate('sedd', { ...base, currentStatus: 'vill_se' })).toBe(false);
    // Non-sedd status never increments.
    expect('rewatchCount' in buildStatusUpdate('mina', { ...base, currentStatus: 'sedd' })).toBe(false);
  });

  it('defaults rewatchCount from 0 when current count is undefined', () => {
    expect(buildStatusUpdate('sedd', { ...base, currentStatus: 'sedd' }).rewatchCount).toBe(1);
  });

  it('merges visibility fields when provided', () => {
    const p = buildStatusUpdate('mina', { ...base, visFields: { isPublic: true, effectiveVisibility: 'public' } });
    expect(p.isPublic).toBe(true);
    expect(p.effectiveVisibility).toBe('public');
  });
});

// BIN-593 — the shared tri-state rule. Both write paths (buildStatusUpdate and
// WatchlistContext.addItem) go through these, so the rule cannot drift apart.
describe('resolveCurrentWatchedAt + canAutoStampWatchedAt', () => {
  const D = new Date('2019-04-02T00:00:00Z');

  it('reports the stored date when the title is in the snapshot', () => {
    expect(resolveCurrentWatchedAt({ watchedAt: D }, true)).toBe(D);
    // Found-but-dateless is KNOWN-absent, whether or not the snapshot settled.
    expect(resolveCurrentWatchedAt({ watchedAt: null }, true)).toBe(null);
    expect(resolveCurrentWatchedAt({ watchedAt: null }, false)).toBe(null);
  });

  it('distinguishes a genuinely new title (null) from a cold load (undefined)', () => {
    expect(resolveCurrentWatchedAt(undefined, true)).toBe(null);
    expect(resolveCurrentWatchedAt(undefined, false)).toBeUndefined();
  });

  it('permits an automatic stamp ONLY for known-absent', () => {
    expect(canAutoStampWatchedAt(null)).toBe(true);
    expect(canAutoStampWatchedAt(D)).toBe(false);
    // The load-bearing one: unknown is not permission. A `== null` here would
    // reopen the cold-load stomp that BIN-593 exists to close.
    expect(canAutoStampWatchedAt(undefined)).toBe(false);
  });
});

// BIN-595 — a per-title privacy override must survive a status change.
describe('shouldStampVisibility', () => {
  it('refuses to re-stamp an item that carries an explicit override', () => {
    // The bug: addItem wrote the PROFILE default over a title's own override, which
    // WOULD republish a title the user had hidden on nothing more than a status
    // change. Conditional, not past tense — no released version shipped a UI for the
    // override, so no real data ever reached that state. This pins the guard for it.
    expect(shouldStampVisibility({ visibility: 'private' })).toBe(false);
    expect(shouldStampVisibility({ visibility: 'friends' })).toBe(false);
    expect(shouldStampVisibility({ visibility: 'public' })).toBe(false);
  });

  it('still stamps an item with no override (the A4.3 lazy-on-write re-assert)', () => {
    // Must not regress: this is how pre-cascade docs get the denormalised fields.
    expect(shouldStampVisibility({ visibility: null })).toBe(true);
  });

  it('stamps a title we have not loaded — same as the six sibling mutators do today', () => {
    // Deliberately NOT a "stay silent when unsure" guard. An earlier version was,
    // and it was reverted: the override it protected has never been reachable, while
    // a doc landing with no effectiveVisibility is missing from the owner's own
    // public profile (the tier queries match that field by equality). This keeps
    // `undefined` behaving exactly as `current?.visibility == null` already does
    // everywhere else, so BIN-598 can tighten all seven writers at once.
    expect(shouldStampVisibility(undefined)).toBe(true);
  });
});

// BIN-164 — tag normalization (owner-only watchlistTags store).
describe('normalizeTags', () => {
  it('trims, collapses internal whitespace, and drops empties', () => {
    expect(normalizeTags(['  mysrys  ', 'med   mamma', '   ', ''])).toEqual(['mysrys', 'med mamma']);
  });

  it('dedups case-insensitively (sv-SE) keeping first-seen display casing', () => {
    expect(normalizeTags(['Mysrys', 'mysrys', 'MYSRYS'])).toEqual(['Mysrys']);
    // sv-SE folding: Å/å collapse to one tag.
    expect(normalizeTags(['Åter', 'åter'])).toEqual(['Åter']);
  });

  it('truncates each tag to MAX_TAG_LENGTH chars (and re-trims the cut edge)', () => {
    const long = 'a'.repeat(MAX_TAG_LENGTH + 10);
    expect(normalizeTags([long])).toEqual(['a'.repeat(MAX_TAG_LENGTH)]);
    // A truncation that lands on a space must not leave a trailing space.
    const cut = 'a'.repeat(MAX_TAG_LENGTH - 1) + ' extra';
    expect(normalizeTags([cut])).toEqual(['a'.repeat(MAX_TAG_LENGTH - 1)]);
  });

  it('rejects tags whose folded form collides with a reserved label', () => {
    const reserved = new Set(['drama', 'komedi']);
    expect(normalizeTags(['Drama', 'mysig', 'KOMEDI'], reserved)).toEqual(['mysig']);
  });

  it('caps the list at MAX_TAGS_PER_ITEM', () => {
    const many = Array.from({ length: MAX_TAGS_PER_ITEM + 5 }, (_, i) => `t${i}`);
    expect(normalizeTags(many)).toHaveLength(MAX_TAGS_PER_ITEM);
    expect(normalizeTags(many)[0]).toBe('t0');
  });

  it('returns [] for all-empty input', () => {
    expect(normalizeTags(['', '   ', '\t'])).toEqual([]);
  });
});

// BIN-611 — the QuickRateModal decision BIN-599 fixed, now testable on its own.
describe('planQuickRateWrite', () => {
  it('adds an untracked title as seen', () => {
    expect(planQuickRateWrite(null)).toBe('add-as-seen');
    expect(planQuickRateWrite(undefined)).toBe('add-as-seen');
  });

  // The BIN-599 guard: an already-'sedd' film must NOT get a second status
  // write, because updateStatus reads sedd → sedd as a rewatch and bumps
  // rewatchCount permanently. Rating the same film twice in one pass must stay
  // rating-only, or the count inflates once per pass.
  it('never re-writes the status of a film already marked sedd', () => {
    expect(planQuickRateWrite({ status: 'sedd' })).toBe('rating-only');
  });

  it('promotes a tracked-but-unseen film to sedd', () => {
    for (const status of ['vill_se', 'mina', 'avbruten'] as const) {
      expect(planQuickRateWrite({ status })).toBe('rating-and-status');
    }
  });

  // The three outcomes are mutually exclusive and total — a fourth value, or two
  // inputs collapsing onto one verdict, is what would let the modal's branch fall
  // through to the wrong write. (The modal's own use of the verdict is asserted in
  // QuickRateModal.test.tsx; this file cannot see it.)
  it('maps the three input shapes onto three distinct verdicts', () => {
    const verdicts = [
      planQuickRateWrite(null),
      planQuickRateWrite({ status: 'sedd' }),
      planQuickRateWrite({ status: 'vill_se' }),
    ];
    expect(new Set(verdicts).size).toBe(3);
    expect(verdicts.every(v => ['add-as-seen', 'rating-and-status', 'rating-only'].includes(v))).toBe(true);
  });
});

// BIN-641 — the rewatch fields, shared by buildStatusUpdate and addItem so the
// two write paths cannot drift on either the transition rule or the increment.
describe('rewatchFields', () => {
  it('counts one more on a sedd → sedd write', () => {
    expect(rewatchFields('sedd', 'sedd', 2)).toEqual({ rewatchCount: 3 });
  });

  // The default is the risky half — an absent count must start at 1, not NaN.
  it('starts at 1 when no count is stored', () => {
    expect(rewatchFields('sedd', 'sedd', undefined)).toEqual({ rewatchCount: 1 });
    expect(rewatchFields('sedd', 'sedd', null)).toEqual({ rewatchCount: 1 });
  });

  it('returns nothing for a FIRST viewing', () => {
    for (const from of ['vill_se', 'mina', 'avbruten'] as const) {
      expect(rewatchFields('sedd', from, 5)).toEqual({});
    }
  });

  // Unknown library state (cold load) must not guess — the count is editable
  // nowhere, so under-counting is the only safe direction.
  it('returns nothing when the current status is unknown', () => {
    expect(rewatchFields('sedd', undefined, 5)).toEqual({});
    expect(rewatchFields('sedd', null, 5)).toEqual({});
  });

  // Film-only by construction: a TV write lands as 'mina', never 'sedd'.
  // Guards the EQUALITY-form regression: `status === currentStatus` would pass
  // every case above, because each holds one operand at 'sedd'.
  it('is not merely status === currentStatus', () => {
    expect(rewatchFields('mina', 'mina', 5)).toEqual({});
    expect(rewatchFields('vill_se', 'vill_se', 5)).toEqual({});
  });

  it('returns nothing for any non-sedd write', () => {
    for (const to of ['vill_se', 'mina', 'avbruten'] as const) {
      expect(rewatchFields(to, 'sedd', 5)).toEqual({});
    }
  });
});
