// BIN-185 — spoiler-safe catch-up recaps. Shared types for the `recaps/{tmdbId}_{s}_{e}`
// public-read cache, consumed by both the offline /recap batch (writer) and the client (reader).
// Licensing/source decision: docs/org/adr/0011-bin185-recap-cc-by-sa.md

// v1: single-episode-style `text` only. v2 (2026-07-12, story-so-far redesign): `text` is a
// self-contained cumulative "story so far" (not just the boundary episode's own plot), plus an
// optional `textFull` (fuller this-season-so-far recap) and the new per-season `SeasonRecapDoc`.
export const RECAP_SCHEMA_VERSION = 2;

/**
 * One CC BY-SA-compatible source a recap was built from (attribution + share-alike).
 * Every source MUST be CC BY-SA-compatible — verified at generation time; an
 * all-rights-reserved source is never ingested (it would break the licence posture).
 */
export interface RecapSource {
  /** Display name, e.g. 'Wikipedia', 'Wookieepedia'. */
  name: string;
  /** The exact article URL used (CC BY-SA requires a link to the source). */
  url: string;
  /** The source's licence, e.g. 'CC BY-SA 4.0' / 'CC BY-SA 3.0'. */
  license: string;
}

/**
 * A cached recap for one (show, season, episode) boundary — identical for every user
 * at that boundary. Contains NO personal data. `text` is plain-text only (sanitised).
 * `generatedAt` is a Firestore Timestamp on the wire; the client mapper converts to Date.
 */
export interface RecapDoc {
  tmdbId: number;
  season: number;
  episode: number;
  /** The Swedish recap, plain text, covering the story UP TO AND INCLUDING (season, episode).
   * Self-contained "story so far" (schemaVersion >= 2) — briefly re-grounds ongoing threads
   * before the newest developments, never assumes the reader remembers prior episodes. */
  text: string;
  /** Optional fuller "this season, up to my episode" recap for the "Visa säsongens
   * sammanfattning" disclosure — same boundary, more detail. Absent on v1 docs and on any
   * doc not yet regenerated under v2. */
  textFull?: string;
  lang: 'sv';
  /** Generating model, e.g. 'claude-sonnet-5'. */
  model: string;
  /** Every source used (≥1), all CC BY-SA-compatible. */
  sources: RecapSource[];
  /** The output licence — latest-compatible CC BY-SA across the sources (default 'CC BY-SA 4.0'). */
  license: string;
  generatedAt: Date;
  schemaVersion: number;
}

/**
 * A cached full recap of one COMPLETED season — `recaps/{tmdbId}_season_{season}`. Written
 * once per season (never rewritten in the ordinary flow; regenerate via the documented
 * purge/--force path only). Powers the "Visa tidigare säsonger" disclosure. Never generated
 * for the user's CURRENT (in-progress) season — that's covered by the boundary doc's
 * `textFull` instead, which respects the exact episode boundary.
 */
export interface SeasonRecapDoc {
  tmdbId: number;
  season: number;
  /** The Swedish recap of the whole season, plain text. */
  text: string;
  lang: 'sv';
  model: string;
  sources: RecapSource[];
  license: string;
  generatedAt: Date;
  schemaVersion: number;
}
