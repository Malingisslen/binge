import { describe, it, expect } from 'vitest';
import { SWEDISH_PROVIDERS } from './providers';
// functions/ cannot import client source, so the server keeps a copy; importing both
// here is what sees them drift (same technique as providerNames.parity.test.ts).
import { PROVIDER_PAID } from '../../../functions/src/shared/providerPaid';

describe('PROVIDER_PAID parity (BIN-1449)', () => {
  it('copies every client provider, its aliases and which of its prices are above zero', () => {
    const client = Object.fromEntries(SWEDISH_PROVIDERS.map(p => [p.id, {
      aliases: p.aliases ?? [],
      hasDefault: p.defaultMonthlyCost != null,
      defaultPaid: (p.defaultMonthlyCost ?? 0) > 0,
      tiers: Object.fromEntries((p.tiers ?? []).map(t => [t.id, t.cost > 0])),
    }]));
    expect(PROVIDER_PAID).toEqual(client);
  });
});
