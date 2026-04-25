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
  secondaryAction: PrimaryAction | null;
  activePauses: ActivePause[];
  // Provider med flest titlar i Följer + Vill se. null om användaren inte
  // har några anchor-titlar alls.
  mostUsedProvider: MostUsedProvider | null;
}
