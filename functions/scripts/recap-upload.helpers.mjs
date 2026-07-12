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
