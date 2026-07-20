// BIN-185 — recap upload (P3). The ONLY writer of the public-read `recaps/{tmdbId}_{s}_{e}` /
// `recaps/{tmdbId}_season_{n}` cache. Run locally with a least-privilege service-account key;
// never in CI.
//
//   GOOGLE_APPLICATION_CREDENTIALS=/abs/path/recaps-writer.json \
//     node functions/scripts/recap-upload.mjs [--force] path/to/generated-recaps.json
//
// Input: a JSON array of generated recaps, TWO entry kinds in the same batch file:
//   Boundary (default): { tmdbId, season, episode, text, textFull?, model, sources: [{name,url,license}] }
//   Season   (kind:'season'): { kind: 'season', tmdbId, season, episodeCount, text, model, sources: [...] }
// (I — Claude — produce this in-session per show, sourced from CC BY-SA wikis ≤ the boundary,
// paraphrased not copied, spot-checked. See docs/recaps/RUNBOOK.md.)
//
// The script does a FINAL structural + plain-text validation before every write, then writes
// recaps/{id}. Invalid entries are skipped and logged; a `--unsourced <tmdbId> <title> <reason>`
// mode appends to docs/recaps/unsourced-shows.json instead. NOTE: the validation below MUST mirror
// src/lib/recaps/sanitize.ts::validateRecapText (the client re-validates on read — that's the
// user-facing gate; this is the write-side gate). Keep the two in sync.
//
// Season docs are WRITTEN ONCE, never rewritten by the ordinary flow (a completed season's
// recap doesn't change) — skipped if already present unless `--force`. They're also refused
// unless every episode 1..episodeCount for that season already has a boundary doc (in this
// batch or previously indexed) — a season doc claiming to cover episodes that were never
// actually recapped is worse than no season doc (Security condition, BIN-185 redesign).
//
// `--season-only`: BIN-185 follow-up for shows whose source ONLY ever had a whole-season (or
// whole-series) summary, never a per-episode breakdown — so no boundary docs can exist for that
// season at all. Pass this flag to allow a season doc with ZERO backing boundary docs (never a
// PARTIAL mix — that stays refused regardless of the flag). Written with `episodeCoverage:
// 'none'` instead of `'full'`, and its season number is recorded in the per-show index's
// `seasonOnlySeasons` so the client can offer it WITHOUT waiting for the panel to open (see
// src/hooks/useRecap.ts). If a per-episode source is found later and full coverage becomes
// available, the upload REFUSES the upgrade without `--force` — see `seasonUploadDecision` in
// recap-upload.helpers.mjs for the exact tier-transition rules.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import {
  invalidRecapReason,
  invalidSeasonRecapReason,
  recapDocId,
  seasonRecapDocId,
  recapIndexDocId,
  missingEpisodesForSeason,
  seasonUploadDecision,
} from './recap-upload.helpers.mjs';

const UNSOURCED_PATH = resolve('docs/recaps/unsourced-shows.json');

/**
 * Merge the batch's boundary keys ("s_e") — and/or season-only season numbers — into the
 * per-show coverage index `recaps/{tmdbId}_index` ({ boundaries: [...], seasonOnlySeasons: [...]
 * } sorted). The client reads it with a direct doc get to find the exact-or-nearest-earlier
 * covered boundary (the fallback recap) AND which seasons have season-only coverage (BIN-185
 * follow-up) — never a Firestore query. The doc id can't collide with recap ids (int_int_int).
 * Returns the merged boundaries array — the season-completeness guard below reuses it instead of
 * a second read. Safe to call with an empty `boundaryKeys` (a pure season-only batch has none).
 */
async function updateIndex(db, tmdbId, boundaryKeys, seasonOnlySeasonsToAdd = [], seasonOnlySeasonsToRemove = []) {
  const ref = db.doc(`recaps/${recapIndexDocId(tmdbId)}`);
  const snap = await ref.get();
  const existingBoundaries = snap.exists && Array.isArray(snap.data().boundaries) ? snap.data().boundaries : [];
  const existingSeasonOnly = snap.exists && Array.isArray(snap.data().seasonOnlySeasons) ? snap.data().seasonOnlySeasons : [];
  const mergedBoundaries = [...new Set([...existingBoundaries, ...boundaryKeys])]
    .filter((k) => /^\d+_\d+$/.test(k))
    .sort((a, b) => {
      const [as, ae] = a.split('_').map(Number);
      const [bs, be] = b.split('_').map(Number);
      return as - bs || ae - be;
    });
  const removeSet = new Set(seasonOnlySeasonsToRemove);
  const mergedSeasonOnly = [...new Set([...existingSeasonOnly, ...seasonOnlySeasonsToAdd])]
    .filter((s) => Number.isInteger(s) && s >= 1 && !removeSet.has(s))
    .sort((a, b) => a - b);
  await ref.set({
    tmdbId: Number(tmdbId), boundaries: mergedBoundaries, seasonOnlySeasons: mergedSeasonOnly,
    updatedAt: FieldValue.serverTimestamp(),
  });
  console.log(`index updated: recaps/${recapIndexDocId(tmdbId)} (${mergedBoundaries.length} boundaries, ${mergedSeasonOnly.length} season-only)`);
  return mergedBoundaries;
}

function appendUnsourced(tmdbId, title, reason) {
  const list = existsSync(UNSOURCED_PATH) ? JSON.parse(readFileSync(UNSOURCED_PATH, 'utf8')) : [];
  if (!list.some((x) => x.tmdbId === tmdbId)) {
    list.push({ tmdbId: Number(tmdbId), title: String(title), reason: String(reason), checkedAt: new Date().toISOString() });
    writeFileSync(UNSOURCED_PATH, JSON.stringify(list, null, 2) + '\n');
  }
  console.log(`logged unsourced: ${tmdbId} "${title}" (${reason})`);
}

// v1: single-episode-style text. v2 (2026-07-12, story-so-far redesign): self-contained
// cumulative `text` + optional `textFull` + season docs. Mirrors src/lib/recaps/types.ts::RECAP_SCHEMA_VERSION.
const RECAP_SCHEMA_VERSION = 2;

async function main() {
  let args = process.argv.slice(2);
  if (args[0] === '--unsourced') {
    const [, tmdbId, title, ...reason] = args;
    const id = Number(tmdbId);
    if (!Number.isInteger(id)) { console.error('--unsourced needs an integer tmdbId'); process.exit(1); }
    appendUnsourced(id, title, reason.join(' '));
    return;
  }
  // --force: overwrite a season doc that already exists (ordinarily written once). Has no
  // effect on boundary docs, which are always overwritten (that's how a regeneration pass works).
  const force = args.includes('--force');
  args = args.filter((a) => a !== '--force');
  // --season-only: BIN-185 follow-up — allow a season doc for a season with ZERO backing
  // boundary docs (the source only ever had whole-season-level prose). See seasonUploadDecision.
  const seasonOnly = args.includes('--season-only');
  args = args.filter((a) => a !== '--season-only');
  // --index-only <recaps.json>: (re)build the coverage index from a batch file without
  // rewriting the recap docs (backfill for batches uploaded before indexing existed).
  const indexOnly = args[0] === '--index-only';
  const inputPath = indexOnly ? args[1] : args[0];
  if (!inputPath) { console.error('usage: node functions/scripts/recap-upload.mjs [--force] [--season-only] [--index-only] <recaps.json> | --unsourced <tmdbId> <title> <reason>'); process.exit(1); }
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('GOOGLE_APPLICATION_CREDENTIALS is not set — point it at the least-privilege recaps-writer service-account key.');
    process.exit(1);
  }

  const recaps = JSON.parse(readFileSync(resolve(inputPath), 'utf8'));
  if (!Array.isArray(recaps)) { console.error('input must be a JSON array of recap objects'); process.exit(1); }

  const validBoundary = [];
  const validSeason = [];
  for (const r of recaps) {
    if (r?.kind === 'season') {
      const reason = invalidSeasonRecapReason(r);
      if (reason) { console.warn(`SKIP season ${r?.tmdbId}_season_${r?.season}: ${reason}`); continue; }
      validSeason.push(r);
    } else {
      const reason = invalidRecapReason(r);
      if (reason) { console.warn(`SKIP ${r?.tmdbId}_${r?.season}_${r?.episode}: ${reason}`); continue; }
      validBoundary.push(r);
    }
  }
  console.log(`${validBoundary.length}/${recaps.length} boundary recaps valid, ${validSeason.length} season recaps valid; ${indexOnly ? 'indexing only…' : 'uploading…'}`);
  if (validBoundary.length === 0 && validSeason.length === 0) return;

  initializeApp({ credential: applicationDefault() });
  const db = getFirestore();

  if (!indexOnly && validBoundary.length > 0) {
    // Chunk into batches (Firestore commit ceiling is 500; leave headroom).
    for (let i = 0; i < validBoundary.length; i += 400) {
      const batch = db.batch();
      for (const r of validBoundary.slice(i, i + 400)) {
        // Combined output is always CC BY-SA 4.0 (3.0 → 4.0 is one-way compatible); the per-source
        // licences are preserved in sources[].license for accurate attribution.
        const outLicense = 'CC BY-SA 4.0';
        const doc = {
          tmdbId: r.tmdbId, season: r.season, episode: r.episode,
          text: r.text, lang: 'sv', model: String(r.model ?? 'claude-sonnet-5'),
          sources: r.sources.map((s) => ({ name: s.name, url: s.url, license: s.license })),
          license: outLicense, generatedAt: FieldValue.serverTimestamp(), schemaVersion: RECAP_SCHEMA_VERSION,
        };
        if (typeof r.textFull === 'string' && r.textFull.length > 0) doc.textFull = r.textFull;
        batch.set(db.doc(`recaps/${recapDocId(r.tmdbId, r.season, r.episode)}`), doc);
      }
      await batch.commit();
      console.log(`committed ${Math.min(i + 400, validBoundary.length)}/${validBoundary.length}`);
    }
  }

  // Maintain the per-show coverage index (grouped in case a file spans multiple shows).
  // CRITICAL: the client surfaces recaps ONLY via this index — if this step fails after
  // the recap docs committed, those recaps are invisible until it succeeds. Fail LOUDLY
  // with the exact recovery command. Do NOT run concurrent uploads for the same show
  // (the read-merge-set below is not transactional; the last writer wins).
  const byShow = new Map();
  for (const r of validBoundary) {
    if (!byShow.has(r.tmdbId)) byShow.set(r.tmdbId, []);
    byShow.get(r.tmdbId).push(`${r.season}_${r.episode}`);
  }
  const coveredByShow = new Map();
  for (const [tmdbId, keys] of byShow) {
    try {
      const merged = await updateIndex(db, tmdbId, keys);
      coveredByShow.set(tmdbId, merged);
    } catch (e) {
      console.error(`INDEX WRITE FAILED for ${tmdbId} — the uploaded recaps are INVISIBLE to clients until indexed.`);
      console.error(`Recover with: node functions/scripts/recap-upload.mjs --index-only ${inputPath}`);
      console.error(e);
      process.exit(2);
    }
  }

  // Season docs: only after the index reflects this batch, so a season doc's completeness
  // check sees boundary docs uploaded in the SAME run. Written once — skipped if already
  // present unless --force (season regen is non-deterministic; an accidental rerun must not
  // silently overwrite a season doc with different LLM output).
  for (const r of validSeason) {
    if (indexOnly) continue; // --index-only never writes recap/season docs (no season-only doc can predate this feature to backfill)
    let covered = coveredByShow.get(r.tmdbId);
    if (!covered) {
      // Not touched by the boundary-upload loop above (this batch has season entries for a
      // show with no boundary entries in it). Fetch once and cache — without this, every
      // season entry for the same uncached show re-reads the identical index doc.
      const snap = await db.doc(`recaps/${recapIndexDocId(r.tmdbId)}`).get();
      covered = snap.exists && Array.isArray(snap.data().boundaries) ? snap.data().boundaries : [];
      coveredByShow.set(r.tmdbId, covered);
    }
    const missing = missingEpisodesForSeason(covered, r.season, r.episodeCount);
    const ref = db.doc(`recaps/${seasonRecapDocId(r.tmdbId, r.season)}`);
    const existingSnap = await ref.get();
    const existingCoverage = existingSnap.exists ? (existingSnap.data().episodeCoverage ?? 'full') : null;
    const decision = seasonUploadDecision({
      missingCount: missing.length, episodeCount: r.episodeCount,
      seasonOnlyFlag: seasonOnly, existingCoverage, force,
    });
    if (!decision.allow) {
      console.warn(`SKIP season ${r.tmdbId}_season_${r.season}: ${decision.reason}`);
      continue;
    }
    await ref.set({
      tmdbId: r.tmdbId, season: r.season,
      text: r.text, lang: 'sv', model: String(r.model ?? 'claude-sonnet-5'),
      sources: r.sources.map((s) => ({ name: s.name, url: s.url, license: s.license })),
      license: 'CC BY-SA 4.0', generatedAt: FieldValue.serverTimestamp(), schemaVersion: RECAP_SCHEMA_VERSION,
      episodeCoverage: decision.coverage,
    });
    if (decision.upgraded) {
      console.log(`season doc UPGRADED from season-only to full coverage: recaps/${seasonRecapDocId(r.tmdbId, r.season)}`);
      // The season is no longer season-only — prune the now-stale entry so the client's cheap
      // pre-open signal doesn't keep pointing at a season that's actually fully covered now.
      await updateIndex(db, r.tmdbId, [], [], [r.season]);
    }
    if (decision.downgraded) {
      console.log(`season doc DOWNGRADED from full to season-only coverage: recaps/${seasonRecapDocId(r.tmdbId, r.season)} — verify this was intentional`);
    }
    if (decision.coverage === 'none') {
      // Record it in the index so the client can offer this season WITHOUT the user opening the
      // panel first (see src/hooks/useRecap.ts) — the boundary-upload loop above never touches
      // this show's index if the batch has no boundary entries for it at all.
      await updateIndex(db, r.tmdbId, [], [r.season]);
    }
    console.log(`season doc written: recaps/${seasonRecapDocId(r.tmdbId, r.season)}`);
  }

  console.log('done.');
}

main().catch((e) => { console.error(e); process.exit(1); });
