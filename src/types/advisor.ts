import type { MediaType } from './domain';

// Subscription advisor — beräknad rekommendations-state för
// Streamingrådgivaren (se src/hooks/useSubscriptionAdvisor.ts).

export type AdvisorStatus = 'active' | 'upcoming' | 'pause' | 'free';

export interface AdvisedShow {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  posterPath: string | null;
  nextAirDate: string | null;
  nextEpisodeCode: string | null;
  isEnded: boolean;
  releaseDate: string | null;
  providerIds: number[];
}

export interface WillSeePerProviderRow {
  providerId: number;
  providerName: string;
  shortName: string;
  color: string;
  isSubscribed: boolean;
  monthlyCost: number | null;
  tvCount: number;
  movieCount: number;
}

// Coverage optimizer (BIN-87): en rankad rekommendation om vilken EJ-tecknad
// betald flatrate-tjänst som låser upp mest av användarens Vill se.
export interface CoverageOption {
  providerId: number;
  providerName: string;
  shortName: string;
  color: string;
  monthlyCost: number; // > 0 (gratis-tjänster exkluderas — inget att "skaffa")
  titleCount: number;  // tvCount + movieCount
  tvCount: number;
  movieCount: number;
  krPerTitle: number;  // monthlyCost / titleCount, avrundat — pris per upplåst titel
}

export interface ProviderBase {
  providerId: number;
  providerName: string;
  shortName: string;
  color: string;
  shows: AdvisedShow[];
}

export interface ProviderAdvisory extends ProviderBase {
  monthlyCost: number | null;
  status: AdvisorStatus;
  nextAirDate: string | null;
}

export interface SubscribeAdvisory extends ProviderBase {
  nearestAirDate: string | null;
}

export interface ActivePause {
  providerId: number;
  providerName: string;
  shortName: string;
  color: string;
  pausedAt: string;
  resumeAt: string | null;
  monthlyCost: number;
  savingsSoFar: number;
}

export type PrimaryAction =
  | { kind: 'pause'; providerId: number; providerName: string; shortName: string; color: string; monthlyCost: number; nextAirDate: string | null }
  | { kind: 'catchup'; providerId: number; providerName: string; shortName: string; color: string; unfinishedCount: number; monthlyCost: number }
  | { kind: 'subscribe'; providerId: number; providerName: string; shortName: string; color: string; showCount: number; nearestAirDate: string | null; monthlyCost: number }
  | { kind: 'idle'; nextCheckDate: string | null };

export interface MostUsedProvider {
  providerId: number;
  providerName: string;
  shortName: string;
  color: string;
  followCount: number;
  willSeeCount: number;
}

export interface AdvisorResult {
  providers: ProviderAdvisory[];
  subscribeAdvice: SubscribeAdvisory[];
  willSeeByProvider: WillSeePerProviderRow[];
  monthlySavings: number;
  totalMonthlyCost: number;
  isLoading: boolean;
  // true om en eller flera TMDB-queries misslyckades. Widget ska rendera en
  // specifik empty-state istället för att bara visa en blank panel.
  hasError: boolean;
  primaryAction: PrimaryAction;
  // När primaryAction är pause kan vi också ha en catchup-kandidat — visas
  // som mindre framträdande andra-kort så besparing alltid hamnar överst.
  secondaryAction: Extract<PrimaryAction, { kind: 'catchup' }> | null;
  activePauses: ActivePause[];
  // Provider med flest titlar i Följer + Vill se. null om användaren inte
  // har några anchor-titlar alls.
  mostUsedProvider: MostUsedProvider | null;
  // tmdbIds för Följer-serier där användaren börjat titta MEN har osedda
  // aireade avsnitt. Används av WatchlistPage's ?status=behind-filter så
  // catchup-länken matchar siffran på Streamingrådgivar-kortet.
  unfinishedTmdbIds: Set<number>;
  // tmdbIds för Följer-serier där användaren är ikapp PÅ en avslutad/inställd
  // serie. /my/series använder det för att sortera avslutade serier till
  // "Avslutade" även när lazy-backfillad tmdbStatus saknas (librarySubState).
  endedCaughtUpTmdbIds: Set<number>;
}
