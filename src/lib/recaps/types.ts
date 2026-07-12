// BIN-185 — spoiler-safe catch-up recaps. Shared types for the `recaps/{tmdbId}_{s}_{e}`
// public-read cache, consumed by both the offline /recap batch (writer) and the client (reader).
// Spec: docs/superpowers/specs/2026-07-12-bin185-spoiler-safe-recaps-design.md

export const RECAP_SCHEMA_VERSION = 1;

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
  /** The Swedish recap, plain text, covering the story UP TO AND INCLUDING (season, episode). */
  text: string;
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
