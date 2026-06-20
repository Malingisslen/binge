// functions/src/cineasterna/index.ts
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import { fetchCatalog } from './api';
import { resolveTmdbId } from './resolve';
import { detectRot } from './parse';
import type { CatalogDoc } from './types';

const TMDB_API_KEY = defineSecret('TMDB_API_KEY');
const ADMIN_UID = defineSecret('ADMIN_UID');

export const cineasternaCatalogSync = onSchedule(
  { schedule: 'every 168 hours', region: 'europe-west1', timeoutSeconds: 300, memory: '512MiB', secrets: [TMDB_API_KEY, ADMIN_UID] },
  async () => {
    const db = getFirestore();
    const ref = db.collection('cineasternaCatalog').doc('current');

    const titles = await fetchCatalog();
    const prev = (await ref.get()).data() as CatalogDoc | undefined;

    // Reuse prior imdb->tmdb resolutions to avoid re-hitting TMDB for known titles.
    const mapRef = db.collection('cineasternaCatalog').doc('imdbMap');
    const imdbMap = ((await mapRef.get()).data()?.map ?? {}) as Record<string, number | null>;

    const tmdbIds: number[] = [];
    const rental: CatalogDoc['rental'] = {};
    for (const t of titles) {
      let tmdbId = imdbMap[t.imdbId];
      if (tmdbId === undefined) { tmdbId = await resolveTmdbId(t.imdbId); imdbMap[t.imdbId] = tmdbId; }
      if (tmdbId == null) continue;
      tmdbIds.push(tmdbId);
      if (t.rentable && t.rentalAmount != null && t.rentalCurrency) {
        rental[String(tmdbId)] = { amount: t.rentalAmount, currency: t.rentalCurrency };
      }
    }

    if (detectRot(prev?.count ?? 0, tmdbIds.length)) {
      logger.error('cineasterna: rot detected, refusing overwrite', { prev: prev?.count, now: tmdbIds.length });
      const adminUid = process.env.ADMIN_UID;
      if (adminUid) {
        await db.collection('users').doc(adminUid).collection('notifications').add({
          kind: 'system', title: 'Cineasterna-synk misslyckades',
          body: `Hämtade ${tmdbIds.length} titlar (förra: ${prev?.count}). Behöll gammal katalog — kontrollera API:t.`,
          actionUrl: '/insikter', read: false, createdAt: FieldValue.serverTimestamp(),
        });
      }
      return;
    }

    const doc: CatalogDoc = { tmdbIds, rental, count: tmdbIds.length, updatedAt: Date.now() };
    await ref.set(doc);
    await mapRef.set({ map: imdbMap });
    logger.info('cineasterna: catalog written', { count: tmdbIds.length });
  },
);
