import { describe, it, expect } from 'vitest';
import { billPauses, buildMonthlyBill, type BillMonth } from './monthlyBill';
import { migrateStatus } from '@/lib/watchStatus.migration';
import { resolveEffectiveMonthlyCost } from './effectiveCost';
import { canonicalUniqueProviders } from '@/lib/tmdb/providers';
import { flattenEpisodeProgress } from '@/lib/diary';
import type { WatchlistItem } from '@/types';
// functions/ cannot import client source, so the bell notice decides on its own copy
// of the rule; running both over the same users is what sees them drift (BIN-1449).
import {
  activePauses, episodeCheckedOff, filmCheckedOff, hasPaidService, previousStockholmMonth, showDocIds,
  type BillPause, type BillUser,
} from '../../../functions/src/monthlyBillNotify/logic';

const month = previousStockholmMonth(new Date('2026-10-01T07:00:00Z'));
const clientMonth: BillMonth = {
  startMs: month.startMs, endMs: month.endMs, name: month.name, firstDay: month.firstDay, lastDay: month.lastDay,
};
const inSeptember = new Date('2026-09-15T20:00:00Z');
const inOctober = new Date('2026-10-02T20:00:00Z');

// Viaplay 76 (paid), Max 384 (paid, alias 1899), SVT Play 520 (free).
interface Fixture {
  user: BillUser & { providerCampaigns?: Record<string, { monthlyCost: number; endDate: string }> };
  history?: BillPause[];
  watchlist?: { id: string; mediaType: 'movie' | 'tv'; tmdbId: number; status: string; dropped?: boolean; watchedAt: Date | null; providers: number[] }[];
  progress?: { id: string; seasons: Record<string, Record<string, { watched: boolean; watchedAt: Date }>> }[];
}

const ts = (d: Date) => ({ toDate: () => d, toMillis: () => d.getTime() });

/** The server's decision, step for step as handleUser in functions/src/monthlyBillNotify/index.ts takes it. */
function serverNotifies(f: Fixture): boolean {
  const user = f.user;
  if (!Array.isArray(user.myProviders) || user.myProviders.length === 0) return false;
  const pauses = [...activePauses(user), ...(f.history ?? [])];
  if (!hasPaidService(user, pauses, month)) return false;
  const rows = f.watchlist ?? [];
  if (rows.some(r => filmCheckedOff({ ...r, watchedAt: r.watchedAt ?? undefined }, month))) return true;
  return (f.progress ?? []).some(p => {
    if (!episodeCheckedOff(p, month)) return false;
    return showDocIds(p.id).some(id => rows.find(r => r.id === id)?.mediaType === 'tv');
  });
}

/** The client's decision: Rådgivaren shows the card exactly when the bill is not null. */
function clientShowsBill(f: Fixture): boolean {
  const user = f.user;
  // Status normalised the way WatchlistContext's docToItem does for every row.
  const items = (f.watchlist ?? []).map(r => ({
    tmdbId: r.tmdbId, mediaType: r.mediaType, watchedAt: r.watchedAt,
    ...migrateStatus(r.status, r.mediaType, r.dropped),
    providers: r.providers, subscriptionProviders: r.providers,
  }) as unknown as WatchlistItem);
  const episodes = flattenEpisodeProgress((f.progress ?? []).map(p => ({
    id: p.id,
    seasons: Object.fromEntries(Object.entries(p.seasons).map(([s, eps]) => [s,
      Object.fromEntries(Object.entries(eps).map(([e, ep]) => [e, { watched: ep.watched, watchedAt: ts(ep.watchedAt) }]))])),
  })));
  const priceDate = new Date(month.endMs - 1);
  const active = Object.fromEntries(Object.entries(user.providerPauses ?? {}).map(([id, p]) => [id, { pausedAt: p.pausedAt as string }]));
  const pauses = billPauses(active, f.history ?? []);
  const bill = buildMonthlyBill({
    items,
    episodes,
    ownedProviderIds: canonicalUniqueProviders((user.myProviders as number[]) ?? []),
    costFor: id => resolveEffectiveMonthlyCost(id, {
      providerTiers: user.providerTiers ?? {},
      providerCosts: user.providerCosts ?? {},
      providerCampaigns: user.providerCampaigns ?? {},
    }, priceDate) ?? 0,
    pauses,
    month: clientMonth,
  });
  return bill != null;
}

const viaplayShow = { id: 'tv_1', mediaType: 'tv' as const, tmdbId: 1, status: 'tittar', watchedAt: null, providers: [76] };
const episodeOn = (id: string, at: Date, watched = true) => ({ id, seasons: { '1': { '1': { watched, watchedAt: at } } } });
const seenFilm = (at: Date, status = 'sedd') => ({ id: 'movie_10', mediaType: 'movie' as const, tmdbId: 10, status, watchedAt: at, providers: [76] });

const CASES: Record<string, { fixture: Fixture; notifies: boolean }> = {
  'paid service, episode of a library show checked off in the month': {
    fixture: { user: { myProviders: [76] }, watchlist: [viaplayShow], progress: [episodeOn('tv_1', inSeptember)] }, notifies: true,
  },
  'film marked sedd in the month': {
    fixture: { user: { myProviders: [76] }, watchlist: [seenFilm(inSeptember)] }, notifies: true,
  },
  'film with a September date that is no longer sedd': {
    fixture: { user: { myProviders: [76] }, watchlist: [seenFilm(inSeptember, 'vill_se')] }, notifies: false,
  },
  'episode checked off in October only': {
    fixture: { user: { myProviders: [76] }, watchlist: [viaplayShow], progress: [episodeOn('tv_1', inOctober)] }, notifies: false,
  },
  'episode with a September date but unchecked': {
    fixture: { user: { myProviders: [76] }, watchlist: [viaplayShow], progress: [episodeOn('tv_1', inSeptember, false)] }, notifies: false,
  },
  'episode of a show no longer in the library': {
    fixture: { user: { myProviders: [76] }, progress: [episodeOn('tv_1', inSeptember)] }, notifies: false,
  },
  'nothing checked off': {
    fixture: { user: { myProviders: [76] }, watchlist: [viaplayShow] }, notifies: false,
  },
  'only a free service': {
    fixture: { user: { myProviders: [520] }, watchlist: [{ ...viaplayShow, providers: [520] }], progress: [episodeOn('tv_1', inSeptember)] }, notifies: false,
  },
  'own price of 0 kr': {
    fixture: { user: { myProviders: [76], providerCosts: { '76': 0 } }, watchlist: [viaplayShow], progress: [episodeOn('tv_1', inSeptember)] }, notifies: false,
  },
  'a 0 kr campaign the client ignores': {
    fixture: {
      user: { myProviders: [76], providerCampaigns: { '76': { monthlyCost: 0, endDate: '2026-12-31' } } },
      watchlist: [viaplayShow], progress: [episodeOn('tv_1', inSeptember)],
    },
    notifies: true,
  },
  'free service with a 49 kr campaign running to the month\'s end': {
    fixture: {
      user: { myProviders: [520], providerCampaigns: { '520': { monthlyCost: 49, endDate: '2026-12-31' } } },
      watchlist: [{ ...viaplayShow, providers: [520] }], progress: [episodeOn('tv_1', inSeptember)],
    },
    notifies: true,
  },
  'free service whose campaign ended inside the month': {
    fixture: {
      user: { myProviders: [520], providerCampaigns: { '520': { monthlyCost: 49, endDate: '2026-09-20' } } },
      watchlist: [{ ...viaplayShow, providers: [520] }], progress: [episodeOn('tv_1', inSeptember)],
    },
    notifies: false,
  },
  'rental service with no price and a 49 kr campaign': {
    fixture: {
      user: { myProviders: [426], providerCampaigns: { '426': { monthlyCost: 49, endDate: '2026-12-31' } } },
      watchlist: [{ ...seenFilm(inSeptember), providers: [426] }],
    },
    notifies: false,
  },
  'rental service with an own price of 49 kr': {
    fixture: { user: { myProviders: [426], providerCosts: { '426': 49 } }, watchlist: [{ ...seenFilm(inSeptember), providers: [426] }] },
    notifies: true,
  },
  'legacy film row stored as watched': {
    fixture: { user: { myProviders: [76] }, watchlist: [seenFilm(inSeptember, 'watched')] }, notifies: true,
  },
  'film marked sedd but flagged dropped': {
    fixture: { user: { myProviders: [76] }, watchlist: [{ ...seenFilm(inSeptember), dropped: true }] }, notifies: false,
  },
  'episode of a show stored under a legacy bare id': {
    fixture: { user: { myProviders: [76] }, watchlist: [{ ...viaplayShow, id: '1' }], progress: [episodeOn('tv_1', inSeptember)] }, notifies: true,
  },
  'service owned under an alias id': {
    fixture: { user: { myProviders: [1899] }, watchlist: [{ ...viaplayShow, providers: [384] }], progress: [episodeOn('tv_1', inSeptember)] }, notifies: true,
  },
  'active pause since before the month': {
    fixture: {
      user: { myProviders: [76], providerPauses: { '76': { pausedAt: '2026-08-20' } } },
      watchlist: [viaplayShow], progress: [episodeOn('tv_1', inSeptember)],
    },
    notifies: false,
  },
  'pause in history that covered the whole month': {
    fixture: {
      user: { myProviders: [76] }, history: [{ providerId: 76, pausedAt: '2026-08-20', resumedAt: '2026-10-01' }],
      watchlist: [viaplayShow], progress: [episodeOn('tv_1', inSeptember)],
    },
    notifies: false,
  },
  'pause that ended inside the month': {
    fixture: {
      user: { myProviders: [76] }, history: [{ providerId: 76, pausedAt: '2026-08-20', resumedAt: '2026-09-10' }],
      watchlist: [viaplayShow], progress: [episodeOn('tv_1', inSeptember)],
    },
    notifies: true,
  },
  'one service paused, another paid, episode on the paused one': {
    fixture: {
      user: { myProviders: [76, 384], providerPauses: { '76': { pausedAt: '2026-08-20' } } },
      watchlist: [viaplayShow], progress: [episodeOn('tv_1', inSeptember)],
    },
    notifies: true,
  },
};

describe('monthly bill notice parity with the bill in Rådgivaren (BIN-1449)', () => {
  for (const [name, { fixture, notifies }] of Object.entries(CASES)) {
    it(name, () => {
      expect(clientShowsBill(fixture)).toBe(notifies);
      expect(serverNotifies(fixture)).toBe(notifies);
    });
  }
});
