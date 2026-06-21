import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import { parseOmdbRatings, isFresh } from './parse';
import type { RatingsDoc } from './types';

const OMDB_API_KEY = defineSecret('OMDB_API_KEY');
const TTL_DAYS = 45;
const IMDB_RE = /^tt\d{6,}$/;

/** OMDb "not found" error strings that are genuine permanent misses. */
const OMDB_NOT_FOUND_RE = /not found|incorrect imdb/i;

/** Rate-limit: max calls that actually hit OMDb, per user, per window. */
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_CAP = 100;

export const titleRatings = onCall(
  { region: 'europe-west1', secrets: [OMDB_API_KEY] },
  async (request): Promise<RatingsDoc> => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Logga in.');
    const uid = request.auth.uid;
    const imdbId = String((request.data as { imdbId?: unknown })?.imdbId ?? '');
    if (!IMDB_RE.test(imdbId)) throw new HttpsError('invalid-argument', 'Ogiltigt IMDb-id.');

    const db = getFirestore();
    const ref = db.collection('titleRatings').doc(imdbId);
    const now = Date.now();

    // --- Cache check (early return — does NOT consume rate-limit budget) ---
    const snap = await ref.get();
    if (snap.exists) {
      const cached = snap.data() as RatingsDoc;
      if (isFresh(cached.checkedAt, now, TTL_DAYS)) return cached;
    }

    // --- Per-user rate limit (only for cache-miss paths that will hit OMDb) ---
    // windowStart is stored as a plain epoch-millisecond number so arithmetic
    // works without Timestamp.toMillis() conversions (FieldValue.serverTimestamp()
    // returns a Timestamp object at read-time, not a number, which would make
    // `now - windowStart` evaluate to NaN and silently bypass the cap check).
    const rlRef = db.collection('titleRatingsRateLimit').doc(uid);
    await db.runTransaction(async (tx) => {
      const rlSnap = await tx.get(rlRef);
      const raw = rlSnap.data() as { count?: number; windowStart?: number } | undefined;
      const windowStart: number = raw?.windowStart ?? 0;
      const count: number = raw?.count ?? 0;

      if (now - windowStart < RATE_LIMIT_WINDOW_MS && count >= RATE_LIMIT_CAP) {
        throw new HttpsError(
          'resource-exhausted',
          'För många betygsförfrågningar — försök igen senare.',
        );
      }

      const newWindow = now - windowStart >= RATE_LIMIT_WINDOW_MS;
      if (newWindow) {
        tx.set(rlRef, { count: 1, windowStart: now });
      } else {
        tx.set(rlRef, { count: count + 1, windowStart }, { merge: false });
      }
    });

    // --- OMDb fetch ---
    const key = process.env.OMDB_API_KEY;
    if (!key) throw new HttpsError('internal', 'OMDB_API_KEY saknas.');

    let json: Record<string, unknown>;
    try {
      const res = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=${key}`);
      if (!res.ok) throw new Error(`OMDb HTTP ${res.status}`);
      json = (await res.json()) as Record<string, unknown>;
    } catch (err) {
      logger.warn(`titleRatings: OMDb fetch failed for ${imdbId}`, err);
      if (snap.exists) return snap.data() as RatingsDoc;
      throw new HttpsError('unavailable', 'Betyg kunde inte hämtas just nu.');
    }

    // --- M1a: inspect Response before caching ---
    if (json.Response !== 'True') {
      const errMsg = typeof json.Error === 'string' ? json.Error : '';
      if (OMDB_NOT_FOUND_RE.test(errMsg)) {
        // Genuine permanent miss — cache the all-null result for 45 days.
        logger.info(`titleRatings: OMDb not found for ${imdbId} ("${errMsg}"), caching null result`);
        const doc: RatingsDoc = {
          imdbId,
          checkedAt: now,
          imdb: null,
          rottenTomatoes: null,
          metacritic: null,
        };
        await ref.set(doc);
        return doc;
      }

      // Transient error (rate-limit, invalid key, outage, etc.) — do NOT cache.
      logger.warn(`titleRatings: OMDb transient error for ${imdbId}: "${errMsg}"`);
      if (snap.exists) return snap.data() as RatingsDoc;
      throw new HttpsError('unavailable', 'Betyg kunde inte hämtas just nu.');
    }

    // Response === 'True' — parse and cache as before.
    const ratings = parseOmdbRatings(json);
    const doc: RatingsDoc = { imdbId, checkedAt: now, ...ratings };
    await ref.set(doc);
    return doc;
  },
);
