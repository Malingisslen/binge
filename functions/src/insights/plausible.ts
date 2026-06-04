/**
 * Minimal Plausible Stats API (v1) client — server-side only.
 *
 * Reads PLAUSIBLE_API_KEY + PLAUSIBLE_SITE_ID from the environment (bound as
 * function secrets). If either is missing, every call short-circuits and the
 * caller gets `null` so the dashboard degrades gracefully instead of erroring.
 *
 * Docs: https://plausible.io/docs/stats-api
 */

import type { PlausibleData, RangeInfo } from './types';

const BASE = 'https://plausible.io/api/v1/stats';

/** Map our range presets to a Plausible `period` (+ optional explicit date). */
function plausiblePeriod(range: RangeInfo): { period: string; date?: string } {
  switch (range.preset) {
    case '24h':
      return { period: 'day' };
    case '7d':
      return { period: '7d' };
    case '30d':
      return { period: '30d' };
    case '90d':
    case 'custom':
      // Plausible has no native 90d; use a custom date range.
      return { period: 'custom', date: `${range.from},${range.to}` };
    default:
      return { period: '30d' };
  }
}

interface PlausibleEnv {
  apiKey: string;
  siteId: string;
}

function readEnv(): PlausibleEnv | null {
  const apiKey = process.env.PLAUSIBLE_API_KEY;
  const siteId = process.env.PLAUSIBLE_SITE_ID;
  if (!apiKey || !siteId) return null;
  return { apiKey, siteId };
}

async function get(
  env: PlausibleEnv,
  path: string,
  params: Record<string, string>,
): Promise<unknown> {
  const qs = new URLSearchParams({ site_id: env.siteId, ...params });
  const res = await fetch(`${BASE}/${path}?${qs}`, {
    headers: { Authorization: `Bearer ${env.apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`Plausible ${path} ${res.status}`);
  }
  return res.json();
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Aggregate `events` count for a single custom event name. */
async function eventCount(
  env: PlausibleEnv,
  base: { period: string; date?: string },
  name: string,
): Promise<number> {
  try {
    const json = (await get(env, 'aggregate', {
      ...base,
      metrics: 'events',
      filters: `event:name==${name}`,
    })) as { results?: { events?: { value?: number } } };
    return num(json.results?.events?.value);
  } catch {
    return 0;
  }
}

/** Breakdown a custom event by one of its props; returns label→count map. */
async function eventPropBreakdown(
  env: PlausibleEnv,
  base: { period: string; date?: string },
  name: string,
  prop: string,
): Promise<Record<string, number>> {
  try {
    const json = (await get(env, 'breakdown', {
      ...base,
      property: `event:props:${prop}`,
      metrics: 'events',
      filters: `event:name==${name}`,
      limit: '100',
    })) as { results?: Array<Record<string, unknown>> };
    const out: Record<string, number> = {};
    for (const row of json.results ?? []) {
      const key = String(row[prop] ?? '');
      out[key] = num(row.events);
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Fetch the full PlausibleData bundle for a range. Returns null when Plausible
 * is unconfigured; individual sub-calls that fail degrade to empty/zero so a
 * single flaky endpoint never sinks the whole dashboard.
 */
export async function fetchPlausible(range: RangeInfo): Promise<PlausibleData | null> {
  const env = readEnv();
  if (!env) return null;

  const base = plausiblePeriod(range);

  try {
    const [aggregate, visitorsSeries, signupsSeries, topPages, topReferrers, methodMap, onboardingMap] =
      await Promise.all([
        get(env, 'aggregate', {
          ...base,
          metrics: 'visitors,pageviews,visit_duration,bounce_rate',
        }).catch(() => ({})),
        get(env, 'timeseries', { ...base, metrics: 'visitors' }).catch(() => ({ results: [] })),
        get(env, 'timeseries', { ...base, metrics: 'events', filters: 'event:name==signed_up' }).catch(
          () => ({ results: [] }),
        ),
        get(env, 'breakdown', {
          ...base,
          property: 'event:page',
          metrics: 'visitors',
          limit: '10',
        }).catch(() => ({ results: [] })),
        get(env, 'breakdown', {
          ...base,
          property: 'visit:referrer',
          metrics: 'visitors',
          limit: '10',
        }).catch(() => ({ results: [] })),
        eventPropBreakdown(env, base, 'signed_in', 'method'),
        eventPropBreakdown(env, base, 'onboarding_completed', 'step_reached'),
      ]);

    const agg = (aggregate as { results?: Record<string, { value?: number }> }).results ?? {};

    const [signedUp, titleAdded, reviewCreated, advisorPause, donateClicked] = await Promise.all([
      eventCount(env, base, 'signed_up'),
      eventCount(env, base, 'title_added_watchlist'),
      eventCount(env, base, 'review_created'),
      eventCount(env, base, 'advisor_pause_taken'),
      eventCount(env, base, 'donate_clicked'),
    ]);

    const seriesRows = (visitorsSeries as { results?: Array<Record<string, unknown>> }).results ?? [];
    const signupRows = (signupsSeries as { results?: Array<Record<string, unknown>> }).results ?? [];
    const pageRows = (topPages as { results?: Array<Record<string, unknown>> }).results ?? [];
    const refRows = (topReferrers as { results?: Array<Record<string, unknown>> }).results ?? [];

    const onboardingFunnel = Object.entries(onboardingMap)
      .map(([step, count]) => ({ step: Number(step), count }))
      .filter((s) => Number.isFinite(s.step))
      .sort((a, b) => a.step - b.step);

    return {
      visitors: num(agg.visitors?.value),
      pageviews: num(agg.pageviews?.value),
      avgVisitDurationSec: num(agg.visit_duration?.value),
      bounceRatePct: num(agg.bounce_rate?.value),
      visitorsTimeseries: seriesRows.map((r) => ({ date: String(r.date), visitors: num(r.visitors) })),
      topPages: pageRows.map((r) => ({ page: String(r.page), visitors: num(r.visitors) })),
      topReferrers: refRows.map((r) => ({ referrer: String(r.referrer), visitors: num(r.visitors) })),
      goals: {
        signed_up: signedUp,
        title_added_watchlist: titleAdded,
        review_created: reviewCreated,
        advisor_pause_taken: advisorPause,
        donate_clicked: donateClicked,
      },
      signupsTimeseries: signupRows.map((r) => ({ date: String(r.date), count: num(r.events) })),
      onboardingFunnel,
      signinMethodSplit: {
        google: num(methodMap.google),
        email: num(methodMap.email),
      },
    };
  } catch {
    return null;
  }
}
