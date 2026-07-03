// Pure helpers for the subscription advisor.
//
// Extracted from useSubscriptionAdvisor.ts so unit tests can import them
// without pulling in Firebase/React Query/Auth dependencies.

import { isEndedStatus } from '@/lib/airingState';

// Hoistad till lib/calendar/nextAir (instant week 2026-07) — re-exporteras
// här så befintliga imports + tester fortsätter fungera oförändrat.
export { getNextAirInfo } from '@/lib/calendar/nextAir';
import type {
  TMDBTVShow,
  ProviderAdvisory,
  ActivePause,
  WatchlistItem,
  WillSeePerProviderRow,
  CoverageOption,
} from '@/types';

// A1/X1: "allt laddat?"-aggregering för rådgivaren. Rådgivaren är klar först
// när (a) watchlist-snapshoten från Firestore landat OCH (b) varje registrerad
// TMDB-detaljquery avgjorts (data eller fel). Utan watchlist-gaten rapporterar
// useQueries([]) "klar" innan items ens hunnit registrera sina queries, och
// sidan renderar definitiv rådgivning på noll data som sedan flippar medan
// queries strömmar in. Per query gäller isLoading-semantiken (isPending &&
// isFetching): cached data blockerar inte (stale-while-revalidate), och
// error-queries räknas som avgjorda så hasError-flödet kan ta över.
export function aggregateAdvisorLoading(
  watchlistLoading: boolean,
  queries: ReadonlyArray<{ isPending: boolean; isFetching: boolean }>,
): boolean {
  if (watchlistLoading) return true;
  return queries.some(q => q.isPending && q.isFetching);
}

// 'mina'-TV delas på progress: påbörjade serier är följer-ankare (driver
// prenumerations-råd inom lookahead-fönstret), ej påbörjade behandlas som
// vill se-ankare ("upcoming" — hindrar paus-råd men får inget datumfönster).
// Bevarar exakt beteendet från när ej påbörjade serier låg i vill_se-statusen.
// == null (inte falsy): säsong 0/Specials är giltig progress.
export function splitTvByProgress(
  items: WatchlistItem[],
): { started: WatchlistItem[]; unstarted: WatchlistItem[] } {
  const started: WatchlistItem[] = [];
  const unstarted: WatchlistItem[] = [];
  for (const item of items) {
    (item.lastWatchedSeason == null ? unstarted : started).push(item);
  }
  return { started, unstarted };
}

// Härleder en tjänsts rådgivar-status ur redan-beräknade signaler. Extraherad
// verbatim ur useSubscriptionAdvisor-hookkroppen (BIN-411) så precedensen får
// egna regressionstester utan att montera Firebase/React Query.
//
// Precedensen är avsiktlig och får INTE kollapsas:
//   active   — något följt airar inom 30 dagar (driver "nu"-nudges)
//   upcoming — airar inom lookahead-fönstret ELLER har ett vill_se-ankare
//              (två oberoende signaler, medvetet separata grenar)
//   free     — 0-kostnad: SVT via isFree, ad-finansierad AVOD (Pluto TV) via
//              cost 0 — aldrig en "pausa & spara"-kandidat (BIN-410)
//   pause    — betald tjänst utan aktivitet → paus-kandidat
//
// Options-objekt (inte positionella booleans): hasUpcomingShow och
// hasWillSeeAnchor landar båda på 'upcoming', så en positionsförväxling vore en
// tyst scoring-bugg som TypeScript inte fångar (BIN-411 stakeholder-villkor #6).
// isFree || (defaultMonthlyCost ?? 0) === 0 bevaras ordagrant — nullish (inte
// falsy) coalescing, och OR-av-två-villkor.
export function deriveProviderStatus(input: {
  hasActiveShow: boolean;
  hasUpcomingShow: boolean;
  hasWillSeeAnchor: boolean;
  isFree?: boolean;
  defaultMonthlyCost?: number;
}): ProviderAdvisory['status'] {
  if (input.hasActiveShow) return 'active';
  else if (input.hasUpcomingShow) return 'upcoming';
  else if (input.hasWillSeeAnchor) return 'upcoming';
  else if (input.isFree || (input.defaultMonthlyCost ?? 0) === 0) return 'free';
  else return 'pause';
}

export function findTopPausable(
  providers: ProviderAdvisory[],
  userPausedSet: Set<number>,
): ProviderAdvisory | undefined {
  return providers
    .filter(p => p.status === 'pause' && !userPausedSet.has(p.providerId) && (p.monthlyCost ?? 0) > 0)
    .sort((a, b) => (b.monthlyCost ?? 0) - (a.monthlyCost ?? 0))[0];
}

// Threshold 3 = "påbörjat flera serier" — undviker att tjata om enstaka påbörjade titlar.
export const CATCHUP_THRESHOLD = 3;

// "Behind" = användaren har börjat titta MEN det finns aireade avsnitt
// hen inte sett. Ej börjat → inte behind. Ikapp på allt aireat → inte behind
// (även om showen är "Returning Series" och nya avsnitt är på väg).
// Användaren ser tillbaka-felet i Streamingrådgivaren när vi räknar
// "påbörjade" som "behind", så denna funktion är källan till sanning.
export function isUserBehindOnAired(item: WatchlistItem, show: TMDBTVShow): boolean {
  // == null (inte falsy): säsong 0 (Specials) är giltig progress och får inte
  // kollapsas ihop med "ej börjat" (L3).
  if (item.lastWatchedSeason == null) return false;
  const last = show.last_episode_to_air;
  if (!last) return false;
  const userS = item.lastWatchedSeason ?? 0;
  const userE = item.lastWatchedEpisode ?? 0;
  if (userS < last.season_number) return true;
  if (userS === last.season_number && userE < last.episode_number) return true;
  return false;
}

// Ikapp PÅ en avslutad/inställd serie. Kräver POSITIVT bevis på ikapp-läge,
// inte bara "inte känd som bakom": serien måste vara påbörjad, ha aireade
// avsnitt att vara ikapp mot (last_episode_to_air), användaren inte ligga efter
// dem, OCH showen vara Ended/Canceled. Utan last_episode_to_air vet vi inte att
// någon är ikapp — då får serien inte klassas som avslutad (annars göms en
// serie man ligger flera säsonger efter på under collapsed "Avslutade").
// Biblioteket använder detta (via endedCaughtUpTmdbIds) för att flytta avslutade
// serier rätt även när lazy-backfillad tmdbStatus saknas.
export function isCaughtUpOnEndedShow(item: WatchlistItem, show: TMDBTVShow): boolean {
  if (item.lastWatchedSeason == null) return false; // ej påbörjad
  if (!show.last_episode_to_air) return false;      // ingen aired-data → ikapp ej bevisbart
  if (isUserBehindOnAired(item, show)) return false; // ligger efter
  return isEndedStatus(show.status);
}

export function findCatchupCandidate(
  providers: ProviderAdvisory[],
  unfinishedIds: Set<number>,
  userPausedSet: Set<number>,
): { provider: ProviderAdvisory; unfinishedCount: number } | undefined {
  return providers
    // BIN-17: nudga catchup för ALLA betalda tjänster med tillräckligt med
    // backlog — inte bara 'active' (något airar inom 30 dagar). En tjänst där
    // du har 3+ opåbörjade/halvsedda serier men inget airar snart (status
    // 'pause'/'upcoming') är precis "du betalar men tittar inte → ta ikapp
    // eller pausa", rådgivarens kärnvärde. Gratistjänster ('free') exkluderas:
    // ingen kostnad att rättfärdiga.
    .filter(p => p.status !== 'free')
    // BIN-51: en tjänst användaren REDAN pausat ska aldrig bli ett
    // catchup-nudge. Att be någon "ta ikapp på X" när X är medvetet pausad
    // (sparläge) är motsägelsefullt — paus betyder "jag tar igen det senare".
    // Samma userPausedSet som findTopPausable exkluderar.
    .filter(p => !userPausedSet.has(p.providerId))
    .map(p => ({
      provider: p,
      unfinishedCount: p.shows.filter(s => unfinishedIds.has(s.tmdbId)).length,
    }))
    .filter(x => x.unfinishedCount >= CATCHUP_THRESHOLD)
    .sort((a, b) => b.unfinishedCount - a.unfinishedCount)[0];
}

export function findIdleNextCheckDate(
  providers: ProviderAdvisory[],
  activePauses: ActivePause[],
): string | null {
  const candidates: string[] = [];
  for (const p of providers) if (p.nextAirDate) candidates.push(p.nextAirDate);
  for (const ap of activePauses) if (ap.resumeAt) candidates.push(ap.resumeAt);
  candidates.sort();
  return candidates[0] ?? null;
}

// Vilka tmdb-ids rådgivaren ska hämta TV-detaljer för: following-TV +
// vill_se-TV (filmer har redan providers lagrade). Tom lista när enabled=false
// så useQueries registrerar NOLL queries (ingen TMDB-fan-out) på bibliotekssidor
// där rådgivarens output inte används.
export function advisorTmdbIds(
  enabled: boolean,
  followingTV: WatchlistItem[],
  willSeeItems: WatchlistItem[],
): number[] {
  if (!enabled) return [];
  return Array.from(new Set([
    ...followingTV.map(i => i.tmdbId),
    ...willSeeItems.filter(i => i.mediaType === 'tv').map(i => i.tmdbId),
  ]));
}

export function isWithinDays(dateStr: string | null, days: number): boolean {
  if (!dateStr) return false;
  const target = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const windowEnd = new Date(now);
  windowEnd.setDate(windowEnd.getDate() + days);
  return target >= now && target <= windowEnd;
}

// BIN-87 — coverage optimizer ("vilken tjänst låser upp mest av din Vill se").
// Inversen av rådgivaren: den vanliga rådgivaren resonerar om tjänster du REDAN
// har; den här rankar EJ-tecknade betalda flatrate-tjänster efter hur många
// vill_se/följer-titlar var och en skulle låsa upp. Tar willSeeByProvider-raderna
// (redan flatrate-filtrerade + per-tjänst-räknade i hooken) så ingen ny TMDB-
// hämtning behövs. Gratis-tjänster (monthlyCost 0/null, t.ex. SVT Play) hoppas
// över — det finns inget att "skaffa". Rankning: mest täckning först, sedan
// lägst kr/titel (billigast per upplåst titel) som tiebreak.
export function rankCoverageOptions(rows: WillSeePerProviderRow[]): CoverageOption[] {
  const options: CoverageOption[] = [];
  for (const r of rows) {
    if (r.isSubscribed) continue;                          // bara ej-tecknade
    if (r.monthlyCost == null || r.monthlyCost <= 0) continue; // bara betalda
    const titleCount = r.tvCount + r.movieCount;
    if (titleCount <= 0) continue;                         // måste låsa upp något
    options.push({
      providerId: r.providerId,
      providerName: r.providerName,
      shortName: r.shortName,
      color: r.color,
      monthlyCost: r.monthlyCost,
      titleCount,
      tvCount: r.tvCount,
      movieCount: r.movieCount,
      krPerTitle: Math.round(r.monthlyCost / titleCount),
    });
  }
  options.sort((a, b) => {
    if (b.titleCount !== a.titleCount) return b.titleCount - a.titleCount; // mest täckning
    if (a.krPerTitle !== b.krPerTitle) return a.krPerTitle - b.krPerTitle; // billigast/titel
    return a.providerName.localeCompare(b.providerName, 'sv');             // stabil ordning
  });
  return options;
}
