/**
 * Fråga Binge LLM-fallback callable (BIN-176). Runs ONLY when the deterministic
 * parser returned nothing — translates a fuzzy sentence into an AskFilter.
 *
 * Cost controls (the 25 SEK/mån cap matters): 24h query cache + a global daily
 * request ceiling (askBingeBudget, like the OMDb backfill) + a per-user daily limit
 * (anti-abuse). Auth required — the LLM is a spend, gated to accounts. The model's
 * output is sanitized by parseLogic.validateAndClampFilter before it leaves here.
 *
 * NEEDS: `firebase functions:secrets:set GEMINI_API_KEY` + a functions deploy.
 * Until deployed, the client falls back gracefully (catches and shows the help state).
 */

import { createHash } from 'node:crypto';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { normalizeQuery, buildGeminiBody, extractFilterJson, type AskFilter } from './parseLogic';
import { stockholmDayId } from './logic';

const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');

const MODEL = 'gemini-2.5-flash';          // Flash, not Lite — Lite failed the accuracy gate
const DAILY_CAP = 2000;                     // global cost ceiling
const PER_USER_DAILY = 25;                  // anti-abuse
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

function hashQuery(norm: string): string {
  return createHash('sha256').update(norm).digest('hex').slice(0, 32);
}

export const askBingeParse = onCall({ region: 'europe-west1', secrets: [GEMINI_API_KEY] }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Logga in för att använda AI-tolkning.');

  const raw = (request.data as { query?: unknown } | undefined)?.query;
  if (typeof raw !== 'string' || raw.trim().length === 0 || raw.length > 200) {
    throw new HttpsError('invalid-argument', 'Ogiltig sökfråga.');
  }

  const norm = normalizeQuery(raw);
  const db = getFirestore();
  const cacheRef = db.collection('askBingeCache').doc(hashQuery(norm));

  // 1) 24h cache — free dedup of identical normalized queries.
  const cached = await cacheRef.get();
  if (cached.exists) {
    const d = cached.data();
    if (d && typeof d.checkedAt === 'number' && Date.now() - d.checkedAt < CACHE_TTL_MS) {
      return { filter: (d.filter ?? {}) as AskFilter, cached: true };
    }
  }

  // 2) per-user daily limit. (Checked before the global ceiling: on the common
  // path per-user exhaustion short-circuits before touching the shared global doc.
  // Edge: if the global cap is hit right after, the user loses one slot for a call
  // that never ran — acceptable at a 2000/day ceiling that rarely fires.)
  const day = stockholmDayId();
  const throttleRef = db.collection('users').doc(uid).collection('askBingeMeta').doc('throttle');
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(throttleRef);
    const data = snap.data();
    const count = data?.day === day ? Number(data.count ?? 0) : 0;
    if (count >= PER_USER_DAILY) {
      throw new HttpsError('resource-exhausted', 'Du har nått dagens gräns för AI-tolkning. Prova igen imorgon.');
    }
    tx.set(throttleRef, { day, count: count + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });

  // 3) global daily ceiling — reserve a slot before spending the API call.
  const budgetRef = db.collection('askBingeBudget').doc(day);
  const allowed = await db.runTransaction(async (tx) => {
    const b = await tx.get(budgetRef);
    const count = b.exists ? Number(b.get('count') ?? 0) : 0;
    if (count >= DAILY_CAP) return false;
    tx.set(budgetRef, { count: count + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return true;
  });
  if (!allowed) throw new HttpsError('resource-exhausted', 'AI-tolkning är tillfälligt otillgänglig. Prova igen senare.');

  // 4) call Gemini; sanitize the output.
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new HttpsError('failed-precondition', 'AI-tolkning är inte konfigurerad.');

  let filter: AskFilter | null = null;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(buildGeminiBody(norm)), signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    );
    if (res.ok) filter = extractFilterJson(await res.json());
  } catch {
    filter = null;
  }

  const result = filter ?? {};
  // Cache only a non-empty result: a transient model failure (→ {}) must stay
  // retryable rather than poisoning the cache for 24h.
  if (Object.keys(result).length > 0) {
    await cacheRef.set({ filter: result, checkedAt: Date.now() });
  }
  return { filter: result, cached: false };
});
