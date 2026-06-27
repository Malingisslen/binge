/**
 * BIN-178 — "vad försvinner" rollup. onSchedule daily (europe-west1). Reads the
 * shared streamingOffers docs, collapses them into ONE small public doc
 * streamingLeaving/current keyed by provider (titles whose subscription offer
 * leaves within ~45 days), so the /forsvinner/[provider] landing page reads a
 * single doc client-side instead of scanning the whole offers collection.
 *
 * Stores only {tmdbId, mediaType, leaving} per title — the client enriches names/
 * posters via TMDB (offer docs carry no title). No TMDB calls here; one paginated
 * read of streamingOffers + one write. Admin SDK; streamingLeaving needs a
 * public-read rule (titles already public catalog data) + client-never-write.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { buildLeavingRollup, type RollupDoc } from './logic';

const PAGE_SIZE = 2000;

async function readOfferDocs(): Promise<RollupDoc[]> {
  const db = getFirestore();
  const out: RollupDoc[] = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    let q = db.collection('streamingOffers').select('mediaType', 'offers').orderBy('__name__').limit(PAGE_SIZE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;
    for (const d of snap.docs) {
      const offers = (d.get('offers') as RollupDoc['offers'] | undefined) ?? [];
      out.push({ tmdbId: Number(d.id), mediaType: d.get('mediaType') === 'tv' ? 'tv' : 'movie', offers });
    }
    if (snap.size < PAGE_SIZE) break;
    cursor = snap.docs[snap.docs.length - 1];
  }
  return out;
}

export const leavingRollup = onSchedule(
  { schedule: 'every 24 hours', region: 'europe-west1', timeoutSeconds: 300, memory: '256MiB' },
  async () => {
    const db = getFirestore();
    const today = new Date().toISOString().slice(0, 10);

    let docs: RollupDoc[];
    try {
      docs = await readOfferDocs();
    } catch (err) {
      logger.error('leavingRollup: streamingOffers read failed', err);
      return;
    }

    const rollup = buildLeavingRollup(docs, today);
    const providerCount = Object.keys(rollup.byProvider).length;
    const titleCount = Object.values(rollup.byProvider).reduce((n, list) => n + list.length, 0);

    await db.collection('streamingLeaving').doc('current').set({
      byProvider: rollup.byProvider,
      today,
      generatedAt: FieldValue.serverTimestamp(),
    });

    logger.info('leavingRollup done', { offerDocs: docs.length, providers: providerCount, titles: titleCount });
  },
);
