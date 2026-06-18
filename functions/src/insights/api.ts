/**
 * HTTP endpoint behind the hosting rewrite /api/insights.
 *
 * Auth — either is accepted:
 *   1. Authorization: Bearer <firebaseIdToken>  → verified, then users/{uid}.isAdmin must be true.
 *   2. Authorization: Bearer <INSIGHTS_TOKEN>    → matches the secret (URL-token fallback).
 *
 * On success: reads insights/daily (1 read), fetches Plausible live, merges into
 * an InsightsData JSON response. Never does heavy Firestore work per request.
 */

import * as crypto from 'crypto';
import { getFirestore, FieldPath } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';
import { fetchPlausible } from './plausible';
import { computeWindowDeltas } from './window';
import type { InsightsData, RangeInfo, RollupData } from './types';

const INSIGHTS_TOKEN = defineSecret('INSIGHTS_TOKEN');
const PLAUSIBLE_API_KEY = defineSecret('PLAUSIBLE_API_KEY');
const PLAUSIBLE_SITE_ID = defineSecret('PLAUSIBLE_SITE_ID');

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  const len = Math.max(bufA.length, bufB.length, 1);
  const padA = Buffer.alloc(len);
  const padB = Buffer.alloc(len);
  bufA.copy(padA);
  bufB.copy(padB);
  return crypto.timingSafeEqual(padA, padB) && bufA.length === bufB.length;
}

/** Returns true if the bearer token authenticates an authorized caller. */
async function isAuthorized(token: string): Promise<boolean> {
  if (!token) return false;

  // 1. URL-token fallback.
  const expected = process.env.INSIGHTS_TOKEN || '';
  if (expected && safeEqual(token, expected)) return true;

  // 2. Firebase ID token of an admin user.
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
  const isoDay = (d: Date) => d.toISOString().slice(0, 10);
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
 * Baseline snapshot for the window: newest dated snapshot on or before `from`.
 * Date ids ("2026-…") sort before the live "daily" doc ("d"), so a `<= {date}`
 * bound excludes "daily" naturally. If history doesn't reach `from`, fall back
 * to the oldest dated snapshot (the dashboard then shows a "sedan {datum}" note).
 */
async function readBaseline(
  from: string,
): Promise<{ data: RollupData; date: string } | null> {
  const col = getFirestore().collection('insights');
  try {
    let snap = await col
      .where(FieldPath.documentId(), '<=', from)
      .orderBy(FieldPath.documentId(), 'desc')
      .limit(1)
      .get();
    if (snap.empty) {
      snap = await col.orderBy(FieldPath.documentId(), 'asc').limit(1).get();
    }
    if (snap.empty) return null;
    const doc = snap.docs[0];
    if (doc.id === 'daily') return null; // only the live doc exists — no history yet
    return { data: doc.data() as RollupData, date: doc.id };
  } catch (err) {
    logger.error('readBaseline failed', err);
    return null;
  }
}

export const apiInsights = onRequest(
  {
    region: 'europe-west1',
    secrets: [INSIGHTS_TOKEN, PLAUSIBLE_API_KEY, PLAUSIBLE_SITE_ID],
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

    const [rollup, plausible, baseline] = await Promise.all([
      readRollup(),
      fetchPlausible(range),
      readBaseline(range.from),
    ]);

    const window = rollup
      ? computeWindowDeltas(rollup, baseline?.data ?? null, baseline?.date ?? null, range.from)
      : null;

    const data: InsightsData = {
      generatedAt: new Date().toISOString(),
      range,
      rollup,
      plausible,
      window,
      partial: rollup === null || rollup.partial || plausible === null,
    };

    res.set('Cache-Control', 'private, max-age=300');
    res.json({ success: true, data });
  },
);
