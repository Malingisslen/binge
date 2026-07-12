// BIN-185 — recap upload (P3). The ONLY writer of the public-read `recaps/{tmdbId}_{s}_{e}`
// cache. Run locally with a least-privilege service-account key; never in CI.
//
//   GOOGLE_APPLICATION_CREDENTIALS=/abs/path/recaps-writer.json \
//     node functions/scripts/recap-upload.mjs path/to/generated-recaps.json
//
// Input: a JSON array of generated recaps, each:
//   { tmdbId, season, episode, text, model, sources: [{ name, url, license }] }
// (I — Claude — produce this in-session per show, sourced from CC BY-SA wikis ≤ the boundary,
// paraphrased not copied, spot-checked. See docs/recaps/RUNBOOK.md.)
//
// The script does a FINAL structural + plain-text validation before every write, then writes
// recaps/{id}. Invalid entries are skipped and logged; a `--unsourced <tmdbId> <title> <reason>`
// mode appends to docs/recaps/unsourced-shows.json instead. NOTE: the validation below MUST mirror
// src/lib/recaps/sanitize.ts::validateRecapText (the client re-validates on read — that's the
// user-facing gate; this is the write-side gate). Keep the two in sync.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const MAX_RECAP_CHARS = 4000;
const HTML_TAG = /<\/?[a-zA-Z][^>]*>/;
const MARKDOWN_LINK = /!?\[[^\]]*\]\([^)]*\)/;
const URL_LIKE = /(https?:\/\/|\bwww\.|\b[a-z0-9-]+\.[a-z]{2,}\/\S)/i;
const CODE_FENCE = /```/;
const INJECTION_PHRASE = /(ignore\s+(all\s+)?previous|disregard\s+(all\s+)?previous|strunta\s+i\s+(tidigare|föregående)|you\s+are\s+now|reveal\s+the\s+(system\s+)?prompt)/i;
const ROLE_MARKER = /(^|\n)\s*(system|assistant|user|användare)\s*:/i;

/** Mirror of validateRecapText (src/lib/recaps/sanitize.ts). Returns a reason string or null. */
function invalidTextReason(text) {
  if (typeof text !== 'string' || text.trim().length === 0) return 'empty';
  if (text.length > MAX_RECAP_CHARS) return `too long (>${MAX_RECAP_CHARS})`;
  if (HTML_TAG.test(text)) return 'html/tag';
  if (MARKDOWN_LINK.test(text)) return 'markdown link';
  if (URL_LIKE.test(text)) return 'url';
  if (CODE_FENCE.test(text)) return 'code fence';
  if (INJECTION_PHRASE.test(text) || ROLE_MARKER.test(text)) return 'injection meta-string';
  return null;
}

const CC_BY_SA = /^CC BY-SA/i;

/** Validate one recap entry structurally + attribution + text. Returns a reason or null. */
function invalidRecapReason(r) {
  if (!Number.isInteger(r?.tmdbId) || !Number.isInteger(r?.season) || !Number.isInteger(r?.episode)) return 'bad key';
  if (r.season < 1 || r.episode < 1) return 'bad season/episode';
  const textReason = invalidTextReason(r.text);
  if (textReason) return `text: ${textReason}`;
  if (!Array.isArray(r.sources) || r.sources.length === 0) return 'no sources (CC BY-SA attribution required)';
  for (const s of r.sources) {
    if (typeof s?.name !== 'string' || !s.name) return 'source missing name';
    if (typeof s?.url !== 'string' || !/^https?:\/\//i.test(s.url)) return 'source url not http(s)';
    if (typeof s?.license !== 'string' || !CC_BY_SA.test(s.license)) return `source not CC BY-SA (${s?.license})`;
  }
  return null;
}

const recapDocId = (tmdbId, s, e) => `${tmdbId}_${s}_${e}`;
const recapIndexDocId = (tmdbId) => `${tmdbId}_index`;
const UNSOURCED_PATH = resolve('docs/recaps/unsourced-shows.json');

/**
 * Merge the batch's boundary keys ("s_e") into the per-show coverage index
 * `recaps/{tmdbId}_index` ({ boundaries: [...] } sorted). The client reads it with a
 * direct doc get to find the exact-or-nearest-earlier covered boundary (the fallback
 * recap) — never a Firestore query. The doc id can't collide with recap ids (int_int_int).
 */
async function updateIndex(db, tmdbId, boundaryKeys) {
  const ref = db.doc(`recaps/${recapIndexDocId(tmdbId)}`);
  const snap = await ref.get();
  const existing = snap.exists && Array.isArray(snap.data().boundaries) ? snap.data().boundaries : [];
  const merged = [...new Set([...existing, ...boundaryKeys])]
    .filter((k) => /^\d+_\d+$/.test(k))
    .sort((a, b) => {
      const [as, ae] = a.split('_').map(Number);
      const [bs, be] = b.split('_').map(Number);
      return as - bs || ae - be;
    });
  await ref.set({ tmdbId: Number(tmdbId), boundaries: merged, updatedAt: FieldValue.serverTimestamp() });
  console.log(`index updated: recaps/${recapIndexDocId(tmdbId)} (${merged.length} boundaries)`);
}

function appendUnsourced(tmdbId, title, reason) {
  const list = existsSync(UNSOURCED_PATH) ? JSON.parse(readFileSync(UNSOURCED_PATH, 'utf8')) : [];
  if (!list.some((x) => x.tmdbId === tmdbId)) {
    list.push({ tmdbId: Number(tmdbId), title: String(title), reason: String(reason), checkedAt: new Date().toISOString() });
    writeFileSync(UNSOURCED_PATH, JSON.stringify(list, null, 2) + '\n');
  }
  console.log(`logged unsourced: ${tmdbId} "${title}" (${reason})`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--unsourced') {
    const [, tmdbId, title, ...reason] = args;
    const id = Number(tmdbId);
    if (!Number.isInteger(id)) { console.error('--unsourced needs an integer tmdbId'); process.exit(1); }
    appendUnsourced(id, title, reason.join(' '));
    return;
  }
  // --index-only <recaps.json>: (re)build the coverage index from a batch file without
  // rewriting the recap docs (backfill for batches uploaded before indexing existed).
  const indexOnly = args[0] === '--index-only';
  const inputPath = indexOnly ? args[1] : args[0];
  if (!inputPath) { console.error('usage: node functions/scripts/recap-upload.mjs [--index-only] <recaps.json> | --unsourced <tmdbId> <title> <reason>'); process.exit(1); }
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('GOOGLE_APPLICATION_CREDENTIALS is not set — point it at the least-privilege recaps-writer service-account key.');
    process.exit(1);
  }

  const recaps = JSON.parse(readFileSync(resolve(inputPath), 'utf8'));
  if (!Array.isArray(recaps)) { console.error('input must be a JSON array of recap objects'); process.exit(1); }

  const valid = [];
  for (const r of recaps) {
    const reason = invalidRecapReason(r);
    if (reason) { console.warn(`SKIP ${r?.tmdbId}_${r?.season}_${r?.episode}: ${reason}`); continue; }
    valid.push(r);
  }
  console.log(`${valid.length}/${recaps.length} recaps valid; ${indexOnly ? 'indexing only…' : 'uploading…'}`);
  if (valid.length === 0) return;

  initializeApp({ credential: applicationDefault() });
  const db = getFirestore();

  if (!indexOnly) {
    // Chunk into batches (Firestore commit ceiling is 500; leave headroom).
    for (let i = 0; i < valid.length; i += 400) {
      const batch = db.batch();
      for (const r of valid.slice(i, i + 400)) {
        // Combined output is always CC BY-SA 4.0 (3.0 → 4.0 is one-way compatible); the per-source
        // licences are preserved in sources[].license for accurate attribution.
        const outLicense = 'CC BY-SA 4.0';
        batch.set(db.doc(`recaps/${recapDocId(r.tmdbId, r.season, r.episode)}`), {
          tmdbId: r.tmdbId, season: r.season, episode: r.episode,
          text: r.text, lang: 'sv', model: String(r.model ?? 'claude-sonnet-5'),
          sources: r.sources.map((s) => ({ name: s.name, url: s.url, license: s.license })),
          license: outLicense, generatedAt: FieldValue.serverTimestamp(), schemaVersion: 1,
        });
      }
      await batch.commit();
      console.log(`committed ${Math.min(i + 400, valid.length)}/${valid.length}`);
    }
  }

  // Maintain the per-show coverage index (grouped in case a file spans multiple shows).
  // CRITICAL: the client surfaces recaps ONLY via this index — if this step fails after
  // the recap docs committed, those recaps are invisible until it succeeds. Fail LOUDLY
  // with the exact recovery command. Do NOT run concurrent uploads for the same show
  // (the read-merge-set below is not transactional; the last writer wins).
  const byShow = new Map();
  for (const r of valid) {
    if (!byShow.has(r.tmdbId)) byShow.set(r.tmdbId, []);
    byShow.get(r.tmdbId).push(`${r.season}_${r.episode}`);
  }
  for (const [tmdbId, keys] of byShow) {
    try {
      await updateIndex(db, tmdbId, keys);
    } catch (e) {
      console.error(`INDEX WRITE FAILED for ${tmdbId} — the uploaded recaps are INVISIBLE to clients until indexed.`);
      console.error(`Recover with: node functions/scripts/recap-upload.mjs --index-only ${inputPath}`);
      console.error(e);
      process.exit(2);
    }
  }
  console.log('done.');
}

main().catch((e) => { console.error(e); process.exit(1); });
