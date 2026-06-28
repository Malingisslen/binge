// functions/src/cineasterna/index.ts
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import { fetchCatalog } from './api';
import { resolveTmdbId } from './resolve';
import { detectRot } from './parse';
import { resolveBatch } from './resolveBatch';
import type { CatalogDoc, CineasternaTitle } from './types';

const TMDB_API_KEY = defineSecret('TMDB_API_KEY');
const ADMIN_UID = defineSecret('ADMIN_UID');

/** Number of TMDB /find calls to run concurrently (rate-limit headroom). */
const CONCURRENCY = 6;

/** Write imdbMap to Firestore after every N newly-resolved entries to survive timeouts. */
const CHECKPOINT_INTERVAL = 50;

/**
 * Resolve a batch of unknown titles with bounded concurrency.
 * Mutates `imdbMap` in-place and writes incremental checkpoints to Firestore.
 */
async function resolveUnknown(
  titles: CineasternaTitle[],
  imdbMap: Record<string, number | 'NOT_FOUND' | null>,
  mapRef: FirebaseFirestore.DocumentReference,
): Promise<void> {
  // Loop + checkpoint logic (incl. the BIN-146 cross-vs-exact-multiple guard) lives in
  // the pure, tested resolveBatch helper. This wrapper injects the real resolver and
  // the Firestore checkpoint write.
  await resolveBatch({
    titles,
    imdbMap,
    resolve: (imdbId) => resolveTmdbId(imdbId),
    checkpoint: async (newlyResolved) => {
      await mapRef.set({ map: imdbMap });
      logger.info('cineasterna: imdbMap checkpoint', { resolved: newlyResolved });
    },
    concurrency: CONCURRENCY,
    checkpointInterval: CHECKPOINT_INTERVAL,
  });
}

export const cineasternaCatalogSync = onSchedule(
  { schedule: 'every 168 hours', region: 'europe-west1', timeoutSeconds: 300, memory: '512MiB', secrets: [TMDB_API_KEY, ADMIN_UID] },
  async () => {
    const db = getFirestore();
    const ref = db.collection('cineasternaCatalog').doc('current');

    const titles = await fetchCatalog();

    // BIN-146: fetchCatalog returns [] on ANY failure (handshake, non-200, parse).
    // The rot guard's baseline is 0 on a cold/first run, so an empty scrape would
    // slip through and write an empty catalog — which then pins the baseline at 0
    // and lets empty results keep slipping through (a silently-dead badge). Treat
    // empty as a hard failure regardless of baseline: keep the old catalog + alert.
    if (titles.length === 0) {
      logger.error('cineasterna: empty catalog fetch — refusing overwrite');
      const adminUid = process.env.ADMIN_UID;
      if (adminUid) {
        await db.collection('users').doc(adminUid).collection('notifications').add({
          kind: 'system', title: 'Cineasterna-synk misslyckades',
          body: 'Hämtade 0 titlar (tomt svar). Behöll gammal katalog — kontrollera API:t.',
          actionUrl: '/insikter', read: false, createdAt: FieldValue.serverTimestamp(),
        });
      }
      return;
    }

    const prev = (await ref.get()).data() as CatalogDoc | undefined;

    // Rot guard on RAW count — a silently-truncated upstream response is caught here
    // before we even attempt resolution.
    if (detectRot(prev?.rawCount ?? 0, titles.length)) {
      logger.error('cineasterna: rot detected on raw count, refusing overwrite', {
        prevRaw: prev?.rawCount, nowRaw: titles.length,
      });
      const adminUid = process.env.ADMIN_UID;
      if (adminUid) {
        await db.collection('users').doc(adminUid).collection('notifications').add({
          kind: 'system', title: 'Cineasterna-synk misslyckades',
          body: `Hämtade ${titles.length} råtitlar (förra: ${prev?.rawCount}). Behöll gammal katalog — kontrollera API:t.`,
          actionUrl: '/insikter', read: false, createdAt: FieldValue.serverTimestamp(),
        });
      }
      return;
    }

    // Reuse prior imdb->tmdb resolutions to avoid re-hitting TMDB for known titles.
    // Map values:
    //   number      → resolved (terminal, cacheable)
    //   'NOT_FOUND' → confirmed absent from TMDB (terminal, cacheable — don't retry)
    //   null        → prior transient error (retry this run)
    //   undefined   → never attempted (resolve this run)
    const mapRef = db.collection('cineasternaCatalog').doc('imdbMap');
    const imdbMap = ((await mapRef.get()).data()?.map ?? {}) as Record<string, number | 'NOT_FOUND' | null>;

    // Resolve unknown/previously-failed titles with bounded concurrency + incremental checkpoints.
    await resolveUnknown(titles, imdbMap, mapRef);

    // Build final id list — only numeric resolutions go into the catalog.
    const tmdbIds: number[] = [];
    const rental: CatalogDoc['rental'] = {};
    for (const t of titles) {
      const resolved = imdbMap[t.imdbId];
      if (typeof resolved !== 'number') continue; // null (transient) or 'NOT_FOUND' → skip
      tmdbIds.push(resolved);
      if (t.rentable && t.rentalAmount != null && t.rentalCurrency) {
        rental[String(resolved)] = { amount: t.rentalAmount, currency: t.rentalCurrency };
      }
    }

    // Rot guard on RESOLVED count — catches mapping-layer regressions.
    if (detectRot(prev?.count ?? 0, tmdbIds.length)) {
      logger.error('cineasterna: rot detected on resolved count, refusing overwrite', {
        prev: prev?.count, now: tmdbIds.length,
      });
      const adminUid = process.env.ADMIN_UID;
      if (adminUid) {
        await db.collection('users').doc(adminUid).collection('notifications').add({
          kind: 'system', title: 'Cineasterna-synk misslyckades',
          body: `Löste ${tmdbIds.length} titlar (förra: ${prev?.count}). Behöll gammal katalog — kontrollera API:t.`,
          actionUrl: '/insikter', read: false, createdAt: FieldValue.serverTimestamp(),
        });
      }
      return;
    }

    const doc: CatalogDoc = {
      tmdbIds,
      rental,
      count: tmdbIds.length,
      rawCount: titles.length,
      updatedAt: Date.now(),
    };
    await ref.set(doc);
    // Final checkpoint of the full imdbMap (captures any last partial chunk).
    await mapRef.set({ map: imdbMap });
    logger.info('cineasterna: catalog written', { count: tmdbIds.length, rawCount: titles.length });
  },
);
