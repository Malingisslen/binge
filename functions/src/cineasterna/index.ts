// functions/src/cineasterna/index.ts
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import { fetchCatalog } from './api';
import { resolveTmdbId } from './resolve';
import { detectRot } from './parse';
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
  // Only titles we haven't yet cached a terminal result for need resolution.
  const unknown = titles.filter((t) => {
    const cached = imdbMap[t.imdbId];
    return cached === undefined || cached === null;
    // cached === number or === 'NOT_FOUND' → skip (terminal result already stored)
  });

  let newlyResolved = 0;

  // Process in chunks of CONCURRENCY (simple batched approach — readable, predictable).
  for (let i = 0; i < unknown.length; i += CONCURRENCY) {
    const chunk = unknown.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map((t) => resolveTmdbId(t.imdbId)));
    for (let j = 0; j < chunk.length; j++) {
      const result = results[j];
      imdbMap[chunk[j].imdbId] = result ?? null;
      if (result !== null) newlyResolved++;
    }

    // Checkpoint every CHECKPOINT_INTERVAL newly-resolved titles.
    if (newlyResolved > 0 && newlyResolved % CHECKPOINT_INTERVAL === 0) {
      await mapRef.set({ map: imdbMap });
      logger.info('cineasterna: imdbMap checkpoint', { resolved: newlyResolved });
    }
  }
}

export const cineasternaCatalogSync = onSchedule(
  { schedule: 'every 168 hours', region: 'europe-west1', timeoutSeconds: 300, memory: '512MiB', secrets: [TMDB_API_KEY, ADMIN_UID] },
  async () => {
    const db = getFirestore();
    const ref = db.collection('cineasternaCatalog').doc('current');

    const titles = await fetchCatalog();
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
