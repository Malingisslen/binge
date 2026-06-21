import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import { parseOmdbRatings, isFresh } from './parse';
import type { RatingsDoc } from './types';

const OMDB_API_KEY = defineSecret('OMDB_API_KEY');
const TTL_DAYS = 45;
const IMDB_RE = /^tt\d{6,}$/;
const DAILY_CAP = 900; // global OMDb calls/day ceiling (free tier is 1000/day)

function today(): string { return new Date().toISOString().slice(0, 10); }

export const titleRatings = onCall(
  { region: 'europe-west1', secrets: [OMDB_API_KEY] },
  async (request): Promise<RatingsDoc> => {
    // Public backfill: no auth. Clients read the cached doc directly; this runs
    // only on a cache miss to populate it, behind a hard global daily cap.
    const imdbId = String((request.data as { imdbId?: unknown })?.imdbId ?? '');
    if (!IMDB_RE.test(imdbId)) throw new HttpsError('invalid-argument', 'Ogiltigt IMDb-id.');

    const db = getFirestore();
    const ref = db.collection('titleRatings').doc(imdbId);
    const now = Date.now();

    const snap = await ref.get();
    if (snap.exists) {
      const cached = snap.data() as RatingsDoc;
      if (isFresh(cached.checkedAt, now, TTL_DAYS)) return cached;
    }

    const key = process.env.OMDB_API_KEY;
    if (!key) throw new HttpsError('internal', 'OMDB_API_KEY saknas.');

    // Reserve a slot in the global daily budget BEFORE spending an OMDb call.
    const budgetRef = db.collection('omdbBudget').doc(today());
    const allowed = await db.runTransaction(async (tx) => {
      const b = await tx.get(budgetRef);
      const count = b.exists ? Number(b.get('count') ?? 0) : 0;
      if (count >= DAILY_CAP) return false;
      tx.set(budgetRef, { count: count + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return true;
    });
    if (!allowed) {
      if (snap.exists) return snap.data() as RatingsDoc; // serve stale rather than nothing
      throw new HttpsError('resource-exhausted', 'Betygskvoten för dagen är slut.');
    }

    let ratings;
    try {
      const res = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=${key}`);
      if (!res.ok) throw new Error(`OMDb HTTP ${res.status}`);
      const json = (await res.json()) as Record<string, unknown>;
      if (json.Response !== 'True') {
        const errStr = typeof json.Error === 'string' ? json.Error : '';
        // genuine not-found → cache all-null (terminal). transient → throw (don't cache).
        if (!/not found|incorrect imdb/i.test(errStr)) throw new Error(`OMDb transient: ${errStr}`);
      }
      ratings = parseOmdbRatings(json);
    } catch (err) {
      logger.warn(`titleRatings: OMDb fetch failed for ${imdbId}`, err);
      if (snap.exists) return snap.data() as RatingsDoc;
      throw new HttpsError('unavailable', 'Betyg kunde inte hämtas.');
    }

    const doc: RatingsDoc = { imdbId, checkedAt: now, ...ratings };
    await ref.set(doc);
    return doc;
  },
);
