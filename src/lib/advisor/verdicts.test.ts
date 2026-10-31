import { describe, it, expect } from 'vitest';
import type { ActivePause, AdvisorResult, BundleSuggestion, ProviderAdvisory } from '@/types';
import { heroVerdict, serviceVerdicts } from './verdicts';

const TODAY = new Date(2026, 9, 15); // 15 Oct 2026, local

function provider(over: Partial<ProviderAdvisory> & { providerId: number }): ProviderAdvisory {
  return {
    providerName: `P${over.providerId}`, shortName: `P${over.providerId}`, color: 'x',
    shows: [], monthlyCost: 100, status: 'active', nextAirDate: null,
    ...over,
  };
}

function pause(providerId: number, resumeAt: string | null): ActivePause {
  return {
    providerId, providerName: `P${providerId}`, shortName: `P${providerId}`, color: 'x',
    pausedAt: '2026-10-01', resumeAt, monthlyCost: 100, savingsSoFar: 50,
  };
}

function bundle(savingKr: number, name = 'Paket'): BundleSuggestion {
  return {
    bundle: { id: name, name, vendor: 'V', monthlyKr: 200, includedProviderIds: [1], verifiedDate: '2026-07-07', url: 'https://example.test' },
    replacedProviderIds: [1], replacedNames: ['A'], currentKr: 200 + savingKr, bundleKr: 200, bindingMonths: 0,
    startFeeKr: 0, startFeeMonthlyKr: 0, commitmentTotalKr: null, savingKr,
    bonusProviderIds: [], bonusNames: [], downgradeProviderIds: [], downgradeNames: [], stale: false,
  };
}

function advisor(over: Partial<AdvisorResult> = {}): AdvisorResult {
  return {
    providers: [], subscribeAdvice: [], willSeeByProvider: [], monthlySavings: 0, totalMonthlyCost: 0,
    totalMonthlyCostEstimated: false, isLoading: false, hasError: false, hasConfiguredProviders: true,
    primaryAction: { kind: 'idle', nextCheckDate: null }, secondaryAction: null, pauseAdviceReady: true,
    activePauses: [], mostUsedProvider: null, unfinishedTmdbIds: new Set<number>(),
    endedCaughtUpTmdbIds: new Set<number>(), bundleSuggestions: [],
    ...over,
  };
}

function willSee(providerId: number, tvCount: number) {
  return { providerId, providerName: `P${providerId}`, shortName: `P${providerId}`, color: 'x', isSubscribed: true, monthlyCost: 100, tvCount, movieCount: 0 };
}

describe('serviceVerdicts', () => {
  it('returns nothing for an empty library', () => {
    expect(serviceVerdicts(advisor(), TODAY)).toEqual([]);
  });

  it('returns nothing under the pause floor, even for a service the engine calls pausable', () => {
    const a = advisor({ pauseAdviceReady: false, providers: [provider({ providerId: 1, status: 'pause' })] });
    expect(serviceVerdicts(a, TODAY)).toEqual([]);
  });

  it('keeps a service with something airing', () => {
    const [card] = serviceVerdicts(advisor({ providers: [provider({ providerId: 1, status: 'active', nextAirDate: '2026-10-20' })] }), TODAY);
    expect(card.verdict).toEqual({ kind: 'keep', reason: 'watching', nextAirDate: '2026-10-20' });
  });

  it('keeps a free service', () => {
    const [card] = serviceVerdicts(advisor({ providers: [provider({ providerId: 1, status: 'free', monthlyCost: 0 })] }), TODAY);
    expect(card.verdict).toMatchObject({ kind: 'keep', reason: 'free' });
  });

  it('keeps an upcoming service that the rotation plan takes first', () => {
    const a = advisor({
      providers: [provider({ providerId: 1, status: 'upcoming' })],
      willSeeByProvider: [willSee(1, 3)],
    });
    expect(serviceVerdicts(a, TODAY)[0].verdict).toMatchObject({ kind: 'keep', reason: 'coming' });
  });

  it('pauses an unused paid service until its next air date', () => {
    const a = advisor({ providers: [provider({ providerId: 1, status: 'pause', monthlyCost: 169, nextAirDate: '2026-12-01' })] });
    expect(serviceVerdicts(a, TODAY)[0].verdict).toEqual({ kind: 'pause', monthlyCost: 169, resumeAt: '2026-12-01', resumeIsAirDate: true });
  });

  it('pauses for 30 days when there is no next air date', () => {
    const a = advisor({ providers: [provider({ providerId: 1, status: 'pause', monthlyCost: 169 })] });
    expect(serviceVerdicts(a, TODAY)[0].verdict).toEqual({ kind: 'pause', monthlyCost: 169, resumeAt: '2026-11-14', resumeIsAirDate: false });
  });

  it('does not offer a pause on a service with no known cost', () => {
    const a = advisor({ providers: [provider({ providerId: 1, status: 'pause', monthlyCost: null })] });
    expect(serviceVerdicts(a, TODAY)[0].verdict.kind).toBe('keep');
  });

  it('rotates in the service the plan schedules after another one, from the first of that month', () => {
    const a = advisor({
      providers: [provider({ providerId: 1, status: 'upcoming' }), provider({ providerId: 2, status: 'upcoming' })],
      willSeeByProvider: [willSee(1, 5), willSee(2, 2)],
    });
    const byId = new Map(serviceVerdicts(a, TODAY).map(c => [c.providerId, c.verdict]));
    expect(byId.get(1)).toMatchObject({ kind: 'keep' });
    expect(byId.get(2)).toEqual({ kind: 'rotate-in', startDate: '2026-11-01', alreadyPaused: false });
  });

  it('shows a paused service as rotating in on its resume date', () => {
    const a = advisor({
      providers: [provider({ providerId: 1, status: 'pause' })],
      activePauses: [pause(1, '2026-12-01')],
    });
    expect(serviceVerdicts(a, TODAY)[0].verdict).toEqual({ kind: 'rotate-in', startDate: '2026-12-01', alreadyPaused: true });
  });

  it('keeps a pause without a resume date visible, and a pause the fan-out missed', () => {
    const a = advisor({
      providers: [provider({ providerId: 1, status: 'active' })],
      activePauses: [pause(7, null)],
    });
    const cards = serviceVerdicts(a, TODAY);
    expect(cards.map(c => c.providerId)).toEqual([1, 7]);
    expect(cards[1].verdict).toEqual({ kind: 'rotate-in', startDate: null, alreadyPaused: true });
  });
});

describe('heroVerdict', () => {
  it('answers with the engine’s pause, using the next air date as the resume date', () => {
    const a = advisor({ primaryAction: { kind: 'pause', providerId: 8, providerName: 'Netflix', shortName: 'Netflix', color: 'x', monthlyCost: 169, nextAirDate: '2026-12-01' } });
    expect(heroVerdict(a, TODAY)).toEqual({ kind: 'pause', providerId: 8, providerName: 'Netflix', monthlyCost: 169, resumeAt: '2026-12-01', resumeIsAirDate: true });
  });

  it('falls back to a 30-day pause without a next air date', () => {
    const a = advisor({ primaryAction: { kind: 'pause', providerId: 8, providerName: 'Netflix', shortName: 'Netflix', color: 'x', monthlyCost: 169, nextAirDate: null } });
    expect(heroVerdict(a, TODAY)).toMatchObject({ kind: 'pause', resumeAt: '2026-11-14', resumeIsAirDate: false });
  });

  it('puts a pause ahead of a bundle', () => {
    const a = advisor({
      primaryAction: { kind: 'pause', providerId: 8, providerName: 'Netflix', shortName: 'Netflix', color: 'x', monthlyCost: 169, nextAirDate: null },
      bundleSuggestions: [bundle(58)],
    });
    expect(heroVerdict(a, TODAY)?.kind).toBe('pause');
  });

  it('offers the bundle with the largest saving when there is no pause', () => {
    const a = advisor({ bundleSuggestions: [bundle(20, 'Liten'), bundle(90, 'Stor'), bundle(50, 'Mellan')] });
    const hero = heroVerdict(a, TODAY);
    expect(hero).not.toBeNull();
    expect(hero?.kind).toBe('bundle');
    if (hero?.kind === 'bundle') expect(hero.suggestion.bundle.name).toBe('Stor');
  });

  it('passes catch-up and subscribe through', () => {
    expect(heroVerdict(advisor({ primaryAction: { kind: 'catchup', providerId: 1, providerName: 'A', shortName: 'A', color: 'x', unfinishedCount: 3, monthlyCost: 100 } }), TODAY))
      .toMatchObject({ kind: 'catchup', unfinishedCount: 3 });
    expect(heroVerdict(advisor({ primaryAction: { kind: 'subscribe', providerId: 1, providerName: 'A', shortName: 'A', color: 'x', showCount: 2, nearestAirDate: '2026-11-02', monthlyCost: 100 } }), TODAY))
      .toMatchObject({ kind: 'subscribe', showCount: 2 });
  });

  it('is idle for an empty library and names the paused services', () => {
    expect(heroVerdict(advisor(), TODAY)).toEqual({ kind: 'idle', nextCheckDate: null, pausedNames: [] });
    expect(heroVerdict(advisor({ activePauses: [pause(1, null)], primaryAction: { kind: 'idle', nextCheckDate: '2026-11-01' } }), TODAY))
      .toEqual({ kind: 'idle', nextCheckDate: '2026-11-01', pausedNames: ['P1'] });
  });

  it('gives no answer under the pause floor, not even a pause the engine proposed', () => {
    const pauseAction = { kind: 'pause' as const, providerId: 8, providerName: 'Netflix', shortName: 'Netflix', color: 'x', monthlyCost: 169, nextAirDate: null };
    expect(heroVerdict(advisor({ pauseAdviceReady: false, primaryAction: pauseAction, bundleSuggestions: [bundle(58)] }), TODAY)).toBeNull();
  });
});
