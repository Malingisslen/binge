/**
 * Besök ur Cloudflare Web Analytics (cookiefri räkning i webbläsaren), lästa med
 * en GraphQL-fråga per anrop. Allt här är aggregat: dagssummor, toppsidor och
 * hänvisande värdar. Hemligheterna läses ur miljön i readTraffic och når aldrig
 * svaret eller loggen.
 */

import { logger } from 'firebase-functions/v2';
import type { RangeInfo, TrafficData } from './types';

export const CLOUDFLARE_GRAPHQL = 'https://api.cloudflare.com/client/v4/graphql';
export const TRAFFIC_TOP_N = 10;
/**
 * Dagen beaconen gick live på binge.nu (BIN-1457). Före den räknade Cloudflare
 * automatiskt besökare utanför EU, mest robotar, så de dagarna frågas aldrig:
 * ett intervall klipps vid den här dagen och en jämförelse bakåt över den vägras.
 */
export const TRAFFIC_SINCE = '2026-10-29';

/** En lyckad läsning utan rader, och ett intervall helt före TRAFFIC_SINCE. */
export const EMPTY_TRAFFIC: TrafficData = { visits: 0, pageViews: 0, daily: [], topPages: [], topReferrers: [] };

/** One row of rumPageloadEventsAdaptiveGroups, as the three sub-queries return it. */
export interface RumRow {
  count: number;
  sum: { visits: number };
  dimensions: { date?: string; requestPath?: string; refererHost?: string };
}

export interface RumResponse {
  data?: {
    viewer?: {
      accounts?: { daily?: RumRow[]; pages?: RumRow[]; referrers?: RumRow[] }[];
    };
  } | null;
  errors?: { message: string }[] | null;
}

const DAY_MS = 86_400_000;

/**
 * Cloudflare filters on an instant: the whole last day needs `lt` the day after it.
 * The start never precedes TRAFFIC_SINCE; a range ending before it gives lt <= geq.
 */
export function trafficWindow(range: RangeInfo): { geq: string; lt: string } {
  const toMs = Date.parse(`${range.to}T00:00:00Z`);
  const from = range.from < TRAFFIC_SINCE ? TRAFFIC_SINCE : range.from;
  return {
    geq: `${from}T00:00:00Z`,
    lt: `${new Date(toMs + DAY_MS).toISOString().slice(0, 10)}T00:00:00Z`,
  };
}

export function buildTrafficQuery(accountTag: string, siteTag: string, range: RangeInfo): {
  query: string;
  variables: Record<string, string | number>;
} {
  const { geq, lt } = trafficWindow(range);
  const query = `query ($accountTag: string, $siteTag: string, $geq: Time, $lt: Time, $top: Int) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      daily: rumPageloadEventsAdaptiveGroups(
        limit: 400,
        filter: { siteTag: $siteTag, datetime_geq: $geq, datetime_lt: $lt },
        orderBy: [date_ASC]
      ) { count sum { visits } dimensions { date } }
      pages: rumPageloadEventsAdaptiveGroups(
        limit: $top,
        filter: { siteTag: $siteTag, datetime_geq: $geq, datetime_lt: $lt },
        orderBy: [count_DESC]
      ) { count sum { visits } dimensions { requestPath } }
      referrers: rumPageloadEventsAdaptiveGroups(
        limit: $top,
        filter: { siteTag: $siteTag, datetime_geq: $geq, datetime_lt: $lt },
        orderBy: [sum_visits_DESC]
      ) { count sum { visits } dimensions { refererHost } }
    }
  }
}`;
  return { query, variables: { accountTag, siteTag, geq, lt, top: TRAFFIC_TOP_N } };
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Pure: the three row lists → the response field. Totals are summed from the daily rows. */
export function summarizeTraffic(rows: {
  daily: RumRow[];
  pages: RumRow[];
  referrers: RumRow[];
}): TrafficData {
  const daily = rows.daily
    .filter((r) => typeof r.dimensions.date === 'string')
    .map((r) => ({ date: r.dimensions.date as string, visits: num(r.sum?.visits), pageViews: num(r.count) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return {
    visits: daily.reduce((a, d) => a + d.visits, 0),
    pageViews: daily.reduce((a, d) => a + d.pageViews, 0),
    daily,
    topPages: rows.pages
      .map((r) => ({ path: r.dimensions.requestPath ?? '', pageViews: num(r.count) }))
      .filter((p) => p.pageViews > 0)
      .slice(0, TRAFFIC_TOP_N),
    // "" är ett direktbesök eller en hänvisare webbläsaren inte skickade; klienten sätter etiketten.
    topReferrers: rows.referrers
      .map((r) => ({ host: r.dimensions.refererHost ?? '', visits: num(r.sum?.visits) }))
      .filter((p) => p.visits > 0)
      .slice(0, TRAFFIC_TOP_N),
  };
}

/**
 * null = inte hämtat: hemligheter saknas, nätet svarade fel, eller GraphQL gav fel.
 * Svaret blir då delvis (api.ts). Loggen får aldrig token eller fråga, bara statusen.
 */
export async function readTraffic(range: RangeInfo): Promise<TrafficData | null> {
  const token = process.env.CF_ANALYTICS_TOKEN || '';
  const accountTag = process.env.CF_ACCOUNT_ID || '';
  const siteTag = process.env.CF_SITE_TAG || '';
  if (!token || !accountTag || !siteTag) {
    logger.error('readTraffic: Cloudflare secrets not configured');
    return null;
  }
  // Helt före beaconen: inget mättes, så svaret är en mätt nolla, inte ett fel.
  if (range.to < TRAFFIC_SINCE) return EMPTY_TRAFFIC;
  try {
    const res = await fetch(CLOUDFLARE_GRAPHQL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildTrafficQuery(accountTag, siteTag, range)),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      logger.error('readTraffic: Cloudflare GraphQL HTTP error', { status: res.status });
      return null;
    }
    const body = (await res.json()) as RumResponse;
    const account = body.data?.viewer?.accounts?.[0];
    if (body.errors?.length || !account) {
      logger.error('readTraffic: Cloudflare GraphQL errors', { messages: body.errors?.map((e) => e.message) ?? [] });
      return null;
    }
    return summarizeTraffic({
      daily: account.daily ?? [],
      pages: account.pages ?? [],
      referrers: account.referrers ?? [],
    });
  } catch (err) {
    logger.error('readTraffic failed', err);
    return null;
  }
}
