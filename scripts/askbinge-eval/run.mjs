#!/usr/bin/env node
// BIN-176 — "Ask Binge" accuracy eval. Calls Gemini Flash-Lite as a query-parser
// against the gold set and grades sentence -> structured-filter translation.
//
// Usage:
//   GEMINI_API_KEY=xxx node scripts/askbinge-eval/run.mjs
//   GEMINI_API_KEY=xxx node scripts/askbinge-eval/run.mjs --model gemini-2.5-flash-lite --limit 20
//
// Flags:
//   --model <id>   Gemini model (default gemini-2.5-flash-lite)
//   --limit <n>    only run the first n cases (smoke test)
//   --json         dump raw per-case results as JSON to stdout (for diffing runs)
//   --concurrency <n>  parallel requests (default 2; use 1 on free-tier keys)
//   --fields a,b,c     score only these fields (default: all)
//
// Exit code: 0 if strict exact-match rate >= PASS_BAR, else 1 (CI-friendly).
// No dependencies — bare `node` (>= 18 for global fetch).

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { RESPONSE_SCHEMA, SYSTEM_PROMPT, SCORED_FIELDS, MOODS, GENRES } from './schema.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PASS_BAR = 0.85; // strict exact-match rate to consider Gemini Flash-Lite "good enough"

// --- CLI ---
const argv = process.argv.slice(2);
const getFlag = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const MODEL = getFlag('--model', 'gemini-2.5-flash-lite');
const LIMIT = Number(getFlag('--limit', '0')) || 0;
// Free-tier Gemini keys have a low RPM cap; bursting at 4 causes 429s that the
// retries can't fully absorb. Default to 2 (paid keys can pass --concurrency 8).
const CONCURRENCY = Number(getFlag('--concurrency', '2')) || 2;
const EMIT_JSON = argv.includes('--json');
// Restrict scored fields, e.g. --fields mediaType,genreIds,mood,runtimeMax,providerIds,myProvidersOnly,originalLanguage
// Use to evaluate a narrower LLM scope (the dimensions worth delegating to the model,
// with the rest handled as UI controls). Default: all fields.
const FIELDS_FLAG = getFlag('--fields', '');
const SCORED = FIELDS_FLAG ? FIELDS_FLAG.split(',').map((s) => s.trim()).filter(Boolean) : SCORED_FIELDS;

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('✗ GEMINI_API_KEY is not set. Get a key at https://aistudio.google.com/apikey and run:\n  GEMINI_API_KEY=xxx node scripts/askbinge-eval/run.mjs');
  process.exit(2);
}

// Mood -> genre-id set (mirrors src/lib/moodLens.ts) for tolerant grading.
const MOOD_GENRES = {
  mysig: [35, 10751, 10749, 16],
  spanning: [53, 80, 9648, 28, 10759],
  skratta: [35],
  tankvard: [18, 99, 36, 10752],
  skrack: [27],
};

// --- Gemini call ---
async function parseQuery(query) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: query }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0,
    },
  };
  for (let attempt = 0; attempt < 4; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      if (attempt === 3) throw e;
      await sleep(500 * (attempt + 1));
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt === 3) throw new Error(`HTTP ${res.status} after retries`);
      const retryAfter = Number(res.headers.get('retry-after')) || (attempt + 1) * 2;
      await sleep(retryAfter * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('empty model response');
    return JSON.parse(text);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Grading ---
const isArrayField = (f) => f === 'genreIds' || f === 'providerIds';
const present = (v) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0);

const VALID_RUNTIME = new Set([30, 60, 90, 120]);
/**
 * Drop fields whose value means "no constraint" — the production filter mapping
 * treats these identically to an omitted field, so the grader must too:
 *   mediaType:'all', voteAverageMin:0, runtimeMax∉{30,60,90,120}, false booleans,
 *   empty arrays. Without this, a model that emits defaults is unfairly penalised.
 */
function normalizeOutput(o) {
  if (!o || typeof o !== 'object') return o ?? {};
  const n = { ...o };
  if (n.mediaType === 'all') delete n.mediaType;
  if (n.sortBy === 'popularity.desc') delete n.sortBy; // TMDB default sort = no constraint
  if (n.voteAverageMin === 0) delete n.voteAverageMin;
  if (typeof n.runtimeMax === 'number' && !VALID_RUNTIME.has(n.runtimeMax)) delete n.runtimeMax;
  if (n.myProvidersOnly === false) delete n.myProvidersOnly;
  if (n.excludeSeen === false) delete n.excludeSeen;
  if (Array.isArray(n.genreIds) && n.genreIds.length === 0) delete n.genreIds;
  if (Array.isArray(n.providerIds) && n.providerIds.length === 0) delete n.providerIds;
  return n;
}

function setsEqual(a = [], b = []) {
  const sa = new Set(a), sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const x of sa) if (!sb.has(x)) return false;
  return true;
}

// Strict per-field correctness. Returns 'tp'|'tn'|'fp'|'fn'|'wrong'.
function gradeFieldStrict(field, gold, got) {
  const g = present(gold), m = present(got);
  if (!g && !m) return 'tn';
  if (!g && m) return 'fp';
  if (g && !m) return 'fn';
  const ok = isArrayField(field) ? setsEqual(gold, got) : String(gold) === String(got);
  return ok ? 'tp' : 'wrong';
}

// Tolerant correctness for the whole case: mood<->genre equivalence + vote ±0.5.
// Used only to report an upper-bound; strict is the headline number.
function tolerantCaseMatch(expected, got) {
  const exp = { ...expected }, out = { ...(got || {}) };
  // mood expressed as equivalent genreIds (or vice versa) counts as a match.
  const reconcileMood = (a, b) => {
    if (a.mood && !b.mood && b.genreIds) {
      const set = new Set(MOOD_GENRES[a.mood] || []);
      if ((b.genreIds || []).some((id) => set.has(id))) { delete a.mood; delete b.genreIds; }
    }
  };
  reconcileMood(exp, out);
  reconcileMood(out, exp);
  for (const f of SCORED) {
    if (f === 'voteAverageMin' && present(exp[f]) && present(out[f])) {
      if (Math.abs(Number(exp[f]) - Number(out[f])) <= 0.5) continue;
    }
    if (gradeFieldStrict(f, exp[f], out[f]) !== 'tp' && gradeFieldStrict(f, exp[f], out[f]) !== 'tn') return false;
  }
  return true;
}

function fmtPct(n) { return `${(n * 100).toFixed(1)}%`; }

// --- Run ---
async function main() {
  const raw = JSON.parse(await readFile(join(HERE, 'queries.json'), 'utf8'));
  let cases = raw.cases;
  if (LIMIT > 0) cases = cases.slice(0, LIMIT);

  console.error(`Ask Binge eval · model=${MODEL} · ${cases.length} cases · concurrency=${CONCURRENCY}\n`);

  const results = [];
  const fieldStats = Object.fromEntries(SCORED.map((f) => [f, { tp: 0, tn: 0, fp: 0, fn: 0, wrong: 0 }]));

  // simple concurrency pool
  let cursor = 0;
  async function worker() {
    while (cursor < cases.length) {
      const c = cases[cursor++];
      let got = null, error = null;
      try { got = normalizeOutput(await parseQuery(c.query)); }
      catch (e) { error = String(e.message || e); }

      const fieldVerdicts = {};
      let allTpTn = true;
      if (!error) {
        for (const f of SCORED) {
          const v = gradeFieldStrict(f, c.expected[f], got[f]);
          fieldStats[f][v]++;
          fieldVerdicts[f] = v;
          if (v !== 'tp' && v !== 'tn') allTpTn = false;
        }
      } else {
        allTpTn = false;
      }
      const strictMatch = !error && allTpTn;
      const tolerantMatch = !error && tolerantCaseMatch(c.expected, got);
      results.push({ id: c.id, query: c.query, expected: c.expected, got, error, strictMatch, tolerantMatch, fieldVerdicts });
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  results.sort((a, b) => a.id - b.id);

  // --- Report ---
  const strict = results.filter((r) => r.strictMatch).length;
  const tolerant = results.filter((r) => r.tolerantMatch).length;
  const errors = results.filter((r) => r.error).length;

  for (const r of results) {
    if (r.error) { console.error(`✗ #${r.id} ERROR  "${r.query}" — ${r.error}`); continue; }
    const mark = r.strictMatch ? '✓' : (r.tolerantMatch ? '≈' : '✗');
    let line = `${mark} #${r.id}  "${r.query}"`;
    if (!r.strictMatch) {
      const bad = SCORED.filter((f) => !['tp', 'tn'].includes(r.fieldVerdicts[f]))
        .map((f) => `${f}[${r.fieldVerdicts[f]}] gold=${JSON.stringify(r.expected[f] ?? null)} got=${JSON.stringify(r.got[f] ?? null)}`);
      line += `\n      ${bad.join('\n      ')}`;
    }
    console.error(line);
  }

  console.error('\n── Per-field (precision / recall / F1) ──');
  for (const f of SCORED) {
    const s = fieldStats[f];
    const correct = s.tp;
    const predicted = s.tp + s.fp + s.wrong;
    const goldCount = s.tp + s.fn + s.wrong;
    const prec = predicted ? correct / predicted : 1;
    const rec = goldCount ? correct / goldCount : 1;
    const f1 = prec + rec ? (2 * prec * rec) / (prec + rec) : 1;
    console.error(`  ${f.padEnd(16)} P=${fmtPct(prec)}  R=${fmtPct(rec)}  F1=${fmtPct(f1)}  (tp=${s.tp} fp=${s.fp} fn=${s.fn} wrong=${s.wrong})`);
  }

  const n = results.length;
  console.error('\n── Summary ──');
  console.error(`  Strict exact-match:   ${strict}/${n}  ${fmtPct(strict / n)}`);
  console.error(`  Tolerant exact-match: ${tolerant}/${n}  ${fmtPct(tolerant / n)}  (mood≈genre, vote ±0.5)`);
  if (errors) console.error(`  API errors:           ${errors}`);
  console.error(`  Pass bar:             ${fmtPct(PASS_BAR)} strict`);
  console.error(`  Verdict:              ${strict / n >= PASS_BAR ? 'PASS — Flash-Lite is accurate enough to build on' : 'BELOW BAR — tune prompt / try a larger model before building'}`);

  if (EMIT_JSON) console.log(JSON.stringify({ model: MODEL, n, strict, tolerant, errors, results }, null, 2));

  process.exit(strict / n >= PASS_BAR ? 0 : 1);
}

main().catch((e) => { console.error('Fatal:', e); process.exit(2); });
