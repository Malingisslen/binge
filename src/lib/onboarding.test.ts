import { describe, it, expect } from 'vitest';
import { needsOnboarding } from './onboarding';

// BIN-1293: frågan inloggningssidan och offline-remsan ställer, på ett ställe.
describe('needsOnboarding', () => {
  it('ett nytt konto utan tjänster och utan klarmarkering ska dit', () => {
    expect(needsOnboarding({ myProviders: [] })).toBe(true);
  });

  it('ett konto som gått igenom onboardingen ska inte dit', () => {
    expect(needsOnboarding({ onboardingCompletedAt: new Date(0), myProviders: [] })).toBe(false);
  });

  it('ett äldre konto med tjänster men utan klarmarkering ska inte dit', () => {
    expect(needsOnboarding({ myProviders: [8] })).toBe(false);
  });

  it('en profil som inte gick att läsa kan inte påstå något', () => {
    expect(needsOnboarding(null)).toBe(false);
    expect(needsOnboarding(undefined)).toBe(false);
  });
});
