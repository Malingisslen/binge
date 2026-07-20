// BIN-185 — pure, firebase-admin-free logic shared by recap-upload.mjs. Split out so it can be
// unit-tested by the root vitest runner (recap-upload.mjs itself imports firebase-admin, which
// root `npm ci` doesn't install — the same functions-test-import gotcha as functions/src).
// NOTE: invalidTextReason mirrors src/lib/recaps/sanitize.ts::validateRecapText (the client
// re-validates on read — that's the user-facing gate; this is the write-side gate). Keep in sync.

export const MAX_RECAP_CHARS = 4000;
const HTML_TAG = /<\/?[a-zA-Z][^>]*>/;
const MARKDOWN_LINK = /!?\[[^\]]*\]\([^)]*\)/;
const URL_LIKE = /(https?:\/\/|\bwww\.|\b[a-z0-9-]+\.[a-z]{2,}\/\S)/i;
const CODE_FENCE = /```/;
const INJECTION_PHRASE = /(ignore\s+(all\s+)?previous|disregard\s+(all\s+)?previous|strunta\s+i\s+(tidigare|föregående)|you\s+are\s+now|reveal\s+the\s+(system\s+)?prompt)/i;
const ROLE_MARKER = /(^|\n)\s*(system|assistant|user|användare)\s*:/i;
const CC_BY_SA = /^CC BY-SA/i;

/** Mirror of validateRecapText (src/lib/recaps/sanitize.ts). Returns a reason string or null. */
export function invalidTextReason(text) {
  if (typeof text !== 'string' || text.trim().length === 0) return 'empty';
  if (text.length > MAX_RECAP_CHARS) return `too long (>${MAX_RECAP_CHARS})`;
  if (HTML_TAG.test(text)) return 'html/tag';
  if (MARKDOWN_LINK.test(text)) return 'markdown link';
  if (URL_LIKE.test(text)) return 'url';
  if (CODE_FENCE.test(text)) return 'code fence';
  if (INJECTION_PHRASE.test(text) || ROLE_MARKER.test(text)) return 'injection meta-string';
  return null;
}

/** Validate the shared fields (sources, text) any recap entry needs. Returns a reason or null. */
export function invalidCommonReason(r) {
  const textReason = invalidTextReason(r.text);
  if (textReason) return `text: ${textReason}`;
  if (r.textFull !== undefined) {
    const fullReason = invalidTextReason(r.textFull);
    if (fullReason) return `textFull: ${fullReason}`;
  }
  if (!Array.isArray(r.sources) || r.sources.length === 0) return 'no sources (CC BY-SA attribution required)';
  for (const s of r.sources) {
    if (typeof s?.name !== 'string' || !s.name) return 'source missing name';
    if (typeof s?.url !== 'string' || !/^https?:\/\//i.test(s.url)) return 'source url not http(s)';
    if (typeof s?.license !== 'string' || !CC_BY_SA.test(s.license)) return `source not CC BY-SA (${s?.license})`;
  }
  return null;
}

/** Validate one BOUNDARY recap entry structurally + attribution + text. Returns a reason or null. */
export function invalidRecapReason(r) {
  if (!Number.isInteger(r?.tmdbId) || !Number.isInteger(r?.season) || !Number.isInteger(r?.episode)) return 'bad key';
  if (r.season < 1 || r.episode < 1) return 'bad season/episode';
  if (r.textFull !== undefined && typeof r.textFull !== 'string') return 'textFull must be a string if present';
  return invalidCommonReason(r);
}

/** Validate one SEASON recap entry (kind:'season'). Returns a reason or null. */
export function invalidSeasonRecapReason(r) {
  if (!Number.isInteger(r?.tmdbId) || !Number.isInteger(r?.season)) return 'bad key';
  if (r.season < 1) return 'bad season';
  if (!Number.isInteger(r?.episodeCount) || r.episodeCount < 1) return 'episodeCount required (completeness guard)';
  return invalidCommonReason(r);
}

export const recapDocId = (tmdbId, s, e) => `${tmdbId}_${s}_${e}`;
export const seasonRecapDocId = (tmdbId, s) => `${tmdbId}_season_${s}`;
export const recapIndexDocId = (tmdbId) => `${tmdbId}_index`;

/**
 * Which episodes 1..episodeCount are MISSING from the covered boundary-key set, for the
 * season-completeness guard (Security condition, BIN-185 redesign — a season doc claiming to
 * cover episodes that were never actually recapped is worse than no season doc). Empty array =
 * fully covered = the season doc write is allowed. `coveredKeys` are "s_e" strings from the
 * per-show index — only keys for the requested `season` count; another season's keys never do.
 */
export function missingEpisodesForSeason(coveredKeys, season, episodeCount) {
  const covered = new Set(coveredKeys);
  const missing = [];
  for (let e = 1; e <= episodeCount; e++) {
    if (!covered.has(`${season}_${e}`)) missing.push(e);
  }
  return missing;
}

/**
 * BIN-185 follow-up — season-only-sourced shows: decide whether a season-doc upload is allowed
 * and which `episodeCoverage` tier to stamp it with. Pure so the coverage-tier decision (a real
 * write-safety gate, not just cosmetic) is unit-tested independent of firebase-admin.
 *
 * Rules (in order):
 *  - A PARTIAL mix (some but not all episodes covered) is NEVER allowed, `--season-only` or not —
 *    only fully-covered or genuinely-zero-covered seasons may get a doc (Security condition,
 *    original BIN-185 redesign: a doc claiming coverage it doesn't have is worse than no doc).
 *  - Zero coverage requires the explicit `seasonOnlyFlag` (the `--season-only` CLI flag) — a
 *    forgotten flag must refuse, not silently write an empty-source doc.
 *  - `existingCoverage` is `null` (no doc yet), `'full'`, or `'none'`. Without `--force`, any
 *    existing doc blocks a rewrite. A TIER CHANGE — 'none'→'full' (an upgrade: a per-episode
 *    source was found later) OR 'full'→'none' (a downgrade: e.g. `--season-only` passed by
 *    mistake alongside `--force` for an already-fully-covered season) — gets its OWN refusal
 *    message naming which direction, symmetric in both directions, so an operator is never left
 *    guessing why a routine-looking write was skipped (DBA condition, generalized by test review
 *    2026-07-20: neither direction may ever happen silently).
 */
export function seasonUploadDecision({ missingCount, episodeCount, seasonOnlyFlag, existingCoverage, force }) {
  const wouldBeCoverage = missingCount === 0
    ? 'full'
    : (missingCount === episodeCount && seasonOnlyFlag ? 'none' : null);
  if (wouldBeCoverage === null) {
    return {
      allow: false,
      reason: missingCount === episodeCount
        ? 'no boundary docs at all for this season — pass --season-only if the source is genuinely season-level only'
        : `missing boundary docs for ${missingCount} episode(s) — a season doc needs full coverage first`,
    };
  }
  const tierChange = existingCoverage !== null && existingCoverage !== wouldBeCoverage
    ? (existingCoverage === 'none' ? 'upgraded' : 'downgraded')
    : null;
  if (existingCoverage !== null && !force) {
    if (tierChange === 'upgraded') {
      return { allow: false, reason: "existing season doc is season-only (episodeCoverage:'none') but full per-episode coverage now exists — use --force to upgrade it" };
    }
    if (tierChange === 'downgraded') {
      return { allow: false, reason: "DOWNGRADE: existing season doc has FULL per-episode coverage but this upload would replace it with a season-only (episodeCoverage:'none') doc — use --force only if this is genuinely intentional" };
    }
    return { allow: false, reason: 'already exists (use --force to refresh)' };
  }
  return { allow: true, coverage: wouldBeCoverage, upgraded: tierChange === 'upgraded', downgraded: tierChange === 'downgraded' };
}
