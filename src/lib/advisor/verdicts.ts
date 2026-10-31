import { localIsoDate } from '@/lib/utils';
import type { AdvisorResult, BundleSuggestion, PrimaryAction } from '@/types';
import { rotationPlan } from './rotationPlan';
import { rotationInputsFromAdvisor } from './rotationInputs';

// Presentation-only verdicts for the advisor page. Every amount here is copied from
// what the engine already computed (monthlyCost, savingKr, primaryAction); nothing
// is summed or priced again, so the page cannot disagree with the engine.

/** Pause length when the service has no known next air date; same default as the numbered steps. */
const DEFAULT_PAUSE_DAYS = 30;

export type ServiceVerdict =
  | { kind: 'keep'; reason: 'free' | 'watching' | 'coming'; nextAirDate: string | null }
  | { kind: 'pause'; monthlyCost: number; resumeAt: string; resumeIsAirDate: boolean }
  /** startDate null: paused with no resume date set. */
  | { kind: 'rotate-in'; startDate: string | null; alreadyPaused: boolean };

export interface ServiceCardData {
  providerId: number;
  providerName: string;
  shortName: string;
  color: string;
  monthlyCost: number | null;
  verdict: ServiceVerdict;
}

function addDaysIso(today: Date, days: number): string {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);
  return localIsoDate(d);
}

function monthStartIso(today: Date, monthOffset: number): string {
  return localIsoDate(new Date(today.getFullYear(), today.getMonth() + monthOffset, 1));
}

/**
 * One verdict per service. Empty under the pause floor: with too few titles every
 * service looks unused, so no card may say "Pausa".
 */
export function serviceVerdicts(advisor: AdvisorResult, today: Date): ServiceCardData[] {
  if (!advisor.pauseAdviceReady) return [];

  const pausesById = new Map(advisor.activePauses.map(p => [p.providerId, p]));
  const plan = rotationPlan(rotationInputsFromAdvisor(advisor));
  const scheduledOffset = new Map<number, number>();
  for (const m of plan.months) {
    if (m.provider && !scheduledOffset.has(m.provider.providerId)) scheduledOffset.set(m.provider.providerId, m.monthOffset);
  }

  const cards: ServiceCardData[] = advisor.providers.map(p => {
    const base = {
      providerId: p.providerId,
      providerName: p.providerName,
      shortName: p.shortName,
      color: p.color,
      monthlyCost: p.monthlyCost,
    };
    const paused = pausesById.get(p.providerId);
    if (paused) {
      return { ...base, verdict: { kind: 'rotate-in', startDate: paused.resumeAt, alreadyPaused: true } };
    }
    const cost = p.monthlyCost ?? 0;
    if (p.status === 'pause' && cost > 0) {
      return {
        ...base,
        verdict: {
          kind: 'pause',
          monthlyCost: cost,
          resumeAt: p.nextAirDate ?? addDaysIso(today, DEFAULT_PAUSE_DAYS),
          resumeIsAirDate: p.nextAirDate != null,
        },
      };
    }
    const offset = scheduledOffset.get(p.providerId);
    if (p.status === 'upcoming' && offset != null && offset >= 1) {
      return { ...base, verdict: { kind: 'rotate-in', startDate: monthStartIso(today, offset), alreadyPaused: false } };
    }
    const reason = p.status === 'active' ? 'watching' : p.status === 'upcoming' ? 'coming' : 'free';
    return { ...base, verdict: { kind: 'keep', reason, nextAirDate: p.nextAirDate } };
  });

  // A pause on a service the fan-out did not return (e.g. a TMDB gap) is still the
  // user's own decision and belongs on the page.
  const listed = new Set(advisor.providers.map(p => p.providerId));
  for (const pause of advisor.activePauses) {
    if (listed.has(pause.providerId)) continue;
    cards.push({
      providerId: pause.providerId,
      providerName: pause.providerName,
      shortName: pause.shortName,
      color: pause.color,
      monthlyCost: pause.monthlyCost,
      verdict: { kind: 'rotate-in', startDate: pause.resumeAt, alreadyPaused: true },
    });
  }
  return cards;
}

export type HeroVerdict =
  | { kind: 'pause'; providerId: number; providerName: string; monthlyCost: number; resumeAt: string; resumeIsAirDate: boolean }
  | { kind: 'bundle'; suggestion: BundleSuggestion }
  | { kind: 'catchup'; providerId: number; providerName: string; unfinishedCount: number; monthlyCost: number }
  | { kind: 'subscribe'; providerId: number; providerName: string; showCount: number; nearestAirDate: string | null }
  | { kind: 'idle'; nextCheckDate: string | null; pausedNames: string[] };

/** Largest saving first; the engine's own savingKr is compared, never recomputed. */
function bestBundle(suggestions: BundleSuggestion[]): BundleSuggestion | null {
  let best: BundleSuggestion | null = null;
  for (const s of suggestions) if (!best || s.savingKr > best.savingKr) best = s;
  return best;
}

function fromPrimary(action: PrimaryAction, pausedNames: string[], today: Date): HeroVerdict | null {
  switch (action.kind) {
    case 'pause':
      return {
        kind: 'pause',
        providerId: action.providerId,
        providerName: action.providerName,
        monthlyCost: action.monthlyCost,
        resumeAt: action.nextAirDate ?? addDaysIso(today, DEFAULT_PAUSE_DAYS),
        resumeIsAirDate: action.nextAirDate != null,
      };
    case 'catchup':
      return { kind: 'catchup', providerId: action.providerId, providerName: action.providerName, unfinishedCount: action.unfinishedCount, monthlyCost: action.monthlyCost };
    case 'subscribe':
      return { kind: 'subscribe', providerId: action.providerId, providerName: action.providerName, showCount: action.showCount, nearestAirDate: action.nearestAirDate };
    case 'needs-library':
      return null;
    case 'idle':
      return { kind: 'idle', nextCheckDate: action.nextCheckDate, pausedNames };
  }
}

/**
 * The single answer at the top of the page. A pause beats a bundle because it is
 * the user's own library speaking; a bundle beats catch-up and subscribe advice
 * because it is money on the table. Null under the pause floor: the page shows
 * the "add what you follow" state there instead of an answer.
 */
export function heroVerdict(advisor: AdvisorResult, today: Date): HeroVerdict | null {
  if (!advisor.pauseAdviceReady) return null;
  const pausedNames = advisor.activePauses.map(p => p.providerName);
  if (advisor.primaryAction.kind === 'pause') return fromPrimary(advisor.primaryAction, pausedNames, today);
  const bundle = bestBundle(advisor.bundleSuggestions);
  if (bundle) return { kind: 'bundle', suggestion: bundle };
  return fromPrimary(advisor.primaryAction, pausedNames, today);
}
