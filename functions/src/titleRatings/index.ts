import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import { parseOmdbRatings, isFresh } from './parse';
import type { RatingsDoc } from './types';

const OMDB_API_KEY = defineSecret('OMDB_API_KEY');
const TTL_DAYS = 45;
const IMDB_RE = /^tt\d{6,}$/;

export const titleRatings = onCall(
  { region: 'europe-west1', secrets: [OMDB_API_KEY] },
  async (request): Promise<RatingsDoc> => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Logga in.');
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
    let ratings;
    try {
      const res = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=${key}`);
      if (!res.ok) throw new Error(`OMDb HTTP ${res.status}`);
      ratings = parseOmdbRatings(await res.json());
    } catch (err) {
      logger.warn(`titleRatings: OMDb fetch failed for ${imdbId}`, err);
      // Serve stale rather than failing the UI, if we have it.
      if (snap.exists) return snap.data() as RatingsDoc;
      throw new HttpsError('unavailable', 'Betyg kunde inte hämtas.');
    }

    const doc: RatingsDoc = { imdbId, checkedAt: now, ...ratings };
    await ref.set(doc);
    return doc;
  },
);
