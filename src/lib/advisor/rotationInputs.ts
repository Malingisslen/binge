import type { AdvisorResult } from '@/types';
import type { RotationProviderInput } from './rotationPlan';

// Shared by the planner card and the per-service verdicts so both read the same
// backlog per service; a second mapping would let the card and the plan disagree.
export function rotationInputsFromAdvisor(advisor: AdvisorResult): RotationProviderInput[] {
  const map = new Map<number, RotationProviderInput>();
  for (const p of advisor.providers) {
    const unfinished = p.shows.filter(s => advisor.unfinishedTmdbIds.has(s.tmdbId)).length;
    map.set(p.providerId, {
      providerId: p.providerId,
      providerName: p.providerName,
      shortName: p.shortName,
      color: p.color,
      monthlyCost: p.monthlyCost ?? 0,
      backlogCount: unfinished,
      isFree: (p.monthlyCost ?? 0) === 0,
    });
  }
  for (const r of advisor.willSeeByProvider) {
    const willSee = r.tvCount + r.movieCount;
    const existing = map.get(r.providerId);
    if (existing) {
      existing.backlogCount += willSee;
    } else {
      map.set(r.providerId, {
        providerId: r.providerId,
        providerName: r.providerName,
        shortName: r.shortName,
        color: r.color,
        monthlyCost: r.monthlyCost ?? 0,
        backlogCount: willSee,
        isFree: (r.monthlyCost ?? 0) === 0,
      });
    }
  }
  return [...map.values()];
}
