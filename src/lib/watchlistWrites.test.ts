import { describe, it, expect } from 'vitest';
import {
  buildStatusUpdate, normalizeTags, resolveCurrentWatchedAt, canAutoStampWatchedAt,
  MAX_TAGS_PER_ITEM, MAX_TAG_LENGTH,
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
