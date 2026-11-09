/**
 * HTTP endpoint behind the hosting rewrite /api/insights.
 *
 * Auth: Authorization: Bearer <firebaseIdToken> → verified, then users/{uid}.isAdmin must be true.
 * No static shared token is accepted: one in a URL ends up in browser history and referrers.
 *
 * On success: reads insights/daily (1 read), the askBingeStats and eventStats day docs in
 * the range, the dated history, and the Cloudflare Web Analytics aggregates (traffic.ts),
 * and merges them into an InsightsData JSON response. Never does heavy Firestore work
 * per request.
 */

import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';
import { readAskBingeStats } from './askbinge';
import { readEventStats } from './eventStats';
import { computeWindowDeltas, pickBaselineId } from './window';
import { historyIds, toHistoryPoint } from './history';
import { readTraffic, TRAFFIC_SINCE } from './traffic';
import { failedSources } from './failed';
import { stockholmDayId } from '../askbinge/logic';
import type { HistoryPoint, InsightsData, RangeInfo, RollupData } from './types';

// Cloudflare Web Analytics (traffic.ts). Read-only analytics token; the values are
// bound to the function and never echoed in a response or a log line.
const CF_ANALYTICS_TOKEN = defineSecret('CF_ANALYTICS_TOKEN');
const CF_ACCOUNT_ID = defineSecret('CF_ACCOUNT_ID');
const CF_SITE_TAG = defineSecret('CF_SITE_TAG');

/** Returns true if the bearer token authenticates an authorized caller. */
async function isAuthorized(token: string): Promise<boolean> {
  if (!token) return false;

  try {
    const decoded = await getAuth().verifyIdToken(token);
    const snap = await getFirestore().collection('users').doc(decoded.uid).get();
    return snap.exists && snap.data()?.isAdmin === true;
  } catch {
    return false;
  }
}

function parseRange(q: Record<string, unknown>): RangeInfo {
  const presetRaw = String(q.range ?? '30d');
  const presets: RangeInfo['preset'][] = ['24h', '7d', '30d', '90d', 'custom'];
  const preset = (presets as string[]).includes(presetRaw)
    ? (presetRaw as RangeInfo['preset'])
    : '30d';
  const dayMs = 86400000;
  // BIN-343: key the dashboard range by Stockholm-local day, in lockstep with the
  // askBinge writers (stats/throttle/budget) so the "today" boundary matches the doc
  // the writer just created — otherwise late-night events drop off the dashboard.
  const isoDay = stockholmDayId;
  const now = new Date();

  if (preset === 'custom') {
    const from = String(q.from ?? '');
    const to = String(q.to ?? '');
    if (from && to) return { preset, from, to };
    // Fall through to a 30d default if custom dates are missing.
  }
  const days: Record<string, number> = { '24h': 1, '7d': 7, '30d': 30, '90d': 90 };
  const span = days[preset] ?? 30;
  return {
    preset: preset === 'custom' ? '30d' : preset,
    from: isoDay(new Date(now.getTime() - span * dayMs)),
    to: isoDay(now),
  };
}

async function readRollup(): Promise<RollupData | null> {
  try {
    const snap = await getFirestore().collection('insights').doc('daily').get();
    return snap.exists ? (snap.data() as RollupData) : null;
  } catch (err) {
    logger.error('readRollup failed', err);
    return null;
  }
}

/**
 * The ids in the insights collection, from listDocuments() — the call the rollup's
 * retention sweep already makes. Not an `orderBy(documentId, 'desc')` query: that
 * needs a __name__ DESCENDING index, and without it every call failed with
 * FAILED_PRECONDITION in production. One listing serves both the baseline and the
 * history read. null = the listing failed.
 */
async function listInsightIds(): Promise<string[] | null> {
  try {
    const refs = await getFirestore().collection('insights').listDocuments();
    return refs.map((r) => r.id);
  } catch (err) {
    logger.error('listInsightIds failed', err);
    return null;
  }
}

/** Baseline snapshot for the window (`pickBaselineId`). */
async function readBaseline(
  ids: readonly string[],
  from: string,
): Promise<{ data: RollupData; date: string } | null> {
  const col = getFirestore().collection('insights');
  try {
    const id = pickBaselineId(ids, from);
    if (!id) return null; // no dated history yet
    const doc = await col.doc(id).get();
    if (!doc.exists) return null;
    return { data: doc.data() as RollupData, date: doc.id };
  } catch (err) {
    logger.error('readBaseline failed', err);
    return null;
  }
}

/**
 * The dated snapshots inside the range, as curve points. Only `totals` and
 * `activeUsers` are selected and only named fields are copied (history.ts), so
 * nothing but aggregates leaves the function. Capped by HISTORY_READ_LIMIT reads.
 */
async function readHistory(ids: readonly string[], range: RangeInfo): Promise<HistoryPoint[] | null> {
  const col = getFirestore().collection('insights');
  const wanted = historyIds(ids, range.from, range.to);
  if (wanted.length === 0) return [];
  try {
    const snaps = await getFirestore().getAll(
      ...wanted.map((id) => col.doc(id)),
      { fieldMask: ['totals', 'activeUsers'] },
    );
    return snaps
      .map((s) => (s.exists ? toHistoryPoint(s.id, s.data()) : null))
      .filter((p): p is HistoryPoint => p !== null)
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch (err) {
    logger.error('readHistory failed', err);
    return null;
  }
}

export const apiInsights = onRequest(
  {
    region: 'europe-west1',
    secrets: [CF_ANALYTICS_TOKEN, CF_ACCOUNT_ID, CF_SITE_TAG],
    cors: false,
  },
  async (req, res) => {
    const authHeader = (req.headers.authorization as string) || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

    if (!(await isAuthorized(token))) {
      res.status(401).json({ success: false, error: 'Ogiltig behörighet.' });
      return;
    }

    const range = parseRange(req.query as Record<string, unknown>);

    const ids = await listInsightIds();
    const [rollup, eventStats, baseline, history, askBinge, traffic] = await Promise.all([
      readRollup(),
      readEventStats(range),
      ids ? readBaseline(ids, range.from) : Promise.resolve(null),
      ids ? readHistory(ids, range) : Promise.resolve(null),
      readAskBingeStats(range),
      readTraffic(range),
    ]);

    const window = rollup
      ? computeWindowDeltas(rollup, baseline?.data ?? null, baseline?.date ?? null, range.from)
      : null;

    // Ett intervall utan eventStats-dokument är "inte mätt", inget fel — bara ett läsfel
    // räknas (failed.ts).
    const failed = failedSources({ rollup, eventsFailed: eventStats.failed, history, traffic });

    const data: InsightsData = {
      generatedAt: new Date().toISOString(),
      range,
      rollup,
      events: eventStats.events,
      eventsSince: eventStats.eventsSince,
      askBinge,
      window,
      history,
      traffic,
      trafficSince: TRAFFIC_SINCE,
      failed,
      partial: failed.length > 0,
    };

    res.set('Cache-Control', 'private, max-age=300');
    res.json({ success: true, data });
  },
);
