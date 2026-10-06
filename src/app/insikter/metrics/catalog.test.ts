import { describe, it, expect } from 'vitest';
import { METRICS, METRIC_KEYS } from './catalog';

// BIN-1438 / #26: händelseräkningen räknar händelser, inte personer eller besök. En etikett
// med "besök" på ett händelsemått lovar något källan inte kan mäta.
describe('event-based metric labels', () => {
  const eventKeys = METRIC_KEYS.filter((k) => METRICS[k].source === 'events');

  it('the event-based roster covers the eventStats tiles', () => {
    expect(eventKeys).toEqual(expect.arrayContaining([
      'signupsTrend', 'onboardingFunnel', 'signinMethodSplit', 'providerClicks',
      'providerClicksByType', 'shareClicks', 'shareClicksBySurface', 'priceCheckTotals',
      'priceCheckSaves', 'advisorPauses',
    ]));
  });

  it.each(eventKeys)('%s has no "besök" in its label', (key) => {
    expect(METRICS[key].label.toLowerCase()).not.toContain('besök');
  });
});
