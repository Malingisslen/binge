import { describe, it, expect } from 'vitest';
import { PRICE_CHANGES, SWEDISH_PROVIDERS, getProvider } from './providers';
import { parseIsoDay } from '@/lib/priceFreshness';

// Prisdatan som /streamingpriser/ visar (#28:s villkor 11). Prisagenten får skriva
// både priceVerifiedDate och PRICE_CHANGES (docs/price-agent-runbook.md), så de här
// spärrarna är den mekaniska kontrollen — inte promptens goda vilja.

// Prisagenten stämplar svenska datum, och CI går i UTC. Dagens datum läses därför i
// Stockholmstid, annars blir ett datum satt strax efter svensk midnatt "i framtiden".
function todayLocal(): Date {
  const [y, m, d] = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' })
    .format(new Date()).split('-').map(Number);
  return new Date(y, m - 1, d);
}

describe('priceVerifiedDate', () => {
  const dated = SWEDISH_PROVIDERS.filter(p => p.priceVerifiedDate !== undefined);

  it('is set on at least one provider (the guards below are not vacuous)', () => {
    expect(dated.length).toBeGreaterThan(0);
  });

  it('is a valid YYYY-MM-DD and never in the future', () => {
    const today = todayLocal();
    for (const p of dated) {
      const d = parseIsoDay(p.priceVerifiedDate);
      expect(d, `${p.name}: malformed priceVerifiedDate ${p.priceVerifiedDate}`).not.toBeNull();
      expect(d!.getTime(), `${p.name}: priceVerifiedDate ${p.priceVerifiedDate} is in the future`)
        .toBeLessThanOrEqual(today.getTime());
    }
  });

  it('the future-date check bites on a literal tomorrow', () => {
    const t = todayLocal();
    const tomorrow = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1);
    const iso = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    expect(parseIsoDay(iso)!.getTime()).toBeGreaterThan(t.getTime());
  });
});

describe('PRICE_CHANGES', () => {
  it('is non-empty (the guards below are not vacuous)', () => {
    expect(PRICE_CHANGES.length).toBeGreaterThan(0);
  });

  it('every row names a known canonical provider and an existing tier (or null for an untiered one)', () => {
    for (const c of PRICE_CHANGES) {
      const p = getProvider(c.providerId);
      expect(p, `unknown provider ${c.providerId}`).toBeDefined();
      expect(p!.id, `provider ${c.providerId} is an alias, use the canonical id`).toBe(c.providerId);
      if (c.tierId === null) {
        expect(p!.tiers ?? [], `${p!.name} has tiers; a change needs a tierId`).toHaveLength(0);
      } else {
        expect(p!.tiers?.some(t => t.id === c.tierId), `${p!.name} has no tier '${c.tierId}'`).toBe(true);
      }
    }
  });

  it('every row has a valid, non-future date, a source and two positive prices that differ', () => {
    const today = todayLocal();
    for (const c of PRICE_CHANGES) {
      const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(c.date);
      expect(m, `bad date ${c.date}`).not.toBeNull();
      const first = new Date(Number(m![1]), Number(m![2]) - 1, m![3] ? Number(m![3]) : 1);
      expect(first.getTime(), `future date ${c.date}`).toBeLessThanOrEqual(today.getTime());
      expect(c.source.trim().length).toBeGreaterThan(0);
      expect(c.fromKr).toBeGreaterThan(0);
      expect(c.toKr).toBeGreaterThan(0);
      expect(c.toKr).not.toBe(c.fromKr);
    }
  });

  it("each tier's newest logged price is the catalog's current price (the log cannot contradict the table)", () => {
    const newest = new Map<string, (typeof PRICE_CHANGES)[number]>();
    for (const c of PRICE_CHANGES) {
      const key = `${c.providerId}:${c.tierId}`;
      const prev = newest.get(key);
      if (!prev || c.date >= prev.date) newest.set(key, c);
    }
    for (const c of newest.values()) {
      const p = getProvider(c.providerId)!;
      const current = c.tierId === null ? p.defaultMonthlyCost : p.tiers!.find(t => t.id === c.tierId)!.cost;
      expect(current, `${p.name} ${c.tierId}: log says ${c.toKr}, catalog says ${current}`).toBe(c.toKr);
    }
  });
});

describe('manageUrl (Säg upp-länken)', () => {
  const linked = SWEDISH_PROVIDERS.filter(p => p.manageUrl !== undefined);

  it('is set on at least one provider (the guards below are not vacuous)', () => {
    expect(linked.length).toBeGreaterThan(0);
  });

  it('is an https address on a provider that is paid for, with a valid, non-future verification date', () => {
    const today = todayLocal();
    for (const p of linked) {
      expect(new URL(p.manageUrl!).protocol, p.name).toBe('https:');
      expect(p.isFree, p.name).not.toBe(true);
      const verified = parseIsoDay(p.manageUrlVerifiedDate);
      expect(verified, `${p.name} manageUrlVerifiedDate`).not.toBeNull();
      expect(verified!.getTime(), p.name).toBeLessThanOrEqual(today.getTime());
    }
  });

  it('is a plain link: no query string or fragment, so no tracking or affiliate parameters', () => {
    for (const p of linked) {
      const url = new URL(p.manageUrl!);
      expect(url.search, p.name).toBe('');
      expect(url.hash, p.name).toBe('');
    }
  });

  it('never carries a verification date without a link', () => {
    for (const p of SWEDISH_PROVIDERS) {
      if (p.manageUrlVerifiedDate !== undefined) expect(p.manageUrl, p.name).toBeDefined();
    }
  });
});
