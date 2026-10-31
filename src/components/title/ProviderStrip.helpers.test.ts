import { describe, expect, it } from 'vitest';
import type { TMDBProvider } from '@/types';
import type { Offer } from '@/lib/streaming/offers';
import { buildProviderRows } from './ProviderStrip.helpers';

const p = (id: number, name: string): TMDBProvider => ({ provider_id: id, provider_name: name, logo_path: `/${id}.png` });
const NETFLIX = p(8, 'Netflix');
const DISNEY = p(337, 'Disney Plus');
const SVT = p(1, 'SVT Play');
const APPLE = p(2, 'Apple TV');
const none = { flatrate: [], free: [], ads: [], rent: [], buy: [] };
const offer = (providerId: number, type: Offer['type'], extra: Partial<Offer> = {}): Offer => ({
  providerId, type, link: `https://x/${providerId}/${type}`, priceAmount: null, priceCurrency: null, leaving: null, ...extra,
});
const NOW = Date.parse('2026-10-31T12:00:00');

describe('buildProviderRows', () => {
  it('lists every service in subscription, free, ads order when the viewer is unknown', () => {
    const { main } = buildProviderRows({ ...none, flatrate: [NETFLIX, DISNEY], free: [SVT] }, [], [], NOW);
    expect(main.map(r => [r.name, r.label, r.kind])).toEqual([
      ['Netflix', 'Ingår', 'sub'],
      ['Disney+', 'Ingår', 'sub'],
      ['SVT Play', 'Gratis', 'free'],
    ]);
  });

  it('moves a service the viewer has first and labels it "Du har"', () => {
    const { main } = buildProviderRows({ ...none, flatrate: [NETFLIX, DISNEY] }, [], [337], NOW);
    expect(main.map(r => [r.name, r.label, r.kind])).toEqual([
      ['Disney+', 'Du har', 'mine'],
      ['Netflix', 'Ingår', 'sub'],
    ]);
  });

  it('shows a service only once when TMDB lists it as both subscription and free', () => {
    const { main } = buildProviderRows({ ...none, flatrate: [SVT], free: [SVT] }, [], [], NOW);
    expect(main).toHaveLength(1);
    expect(main[0].kind).toBe('sub');
  });

  it('prices rent and buy from the matching offer type only', () => {
    const offers = [
      offer(2, 'subscription'),
      offer(2, 'rent', { priceAmount: 39, priceCurrency: 'SEK' }),
      offer(2, 'buy', { priceAmount: 99, priceCurrency: 'SEK' }),
    ];
    const { rentBuy } = buildProviderRows({ ...none, rent: [APPLE], buy: [APPLE] }, offers, [], NOW);
    expect(rentBuy.map(r => r.label)).toEqual(['Hyr 39 kr', 'Köp 99 kr']);
  });

  it('shows plain "Hyr" when no rent price is known, never the price of another offer type', () => {
    const offers = [offer(2, 'buy', { priceAmount: 99, priceCurrency: 'SEK' })];
    const { rentBuy } = buildProviderRows({ ...none, rent: [APPLE] }, offers, [], NOW);
    expect(rentBuy[0].label).toBe('Hyr');
  });

  it('gives a service without an offer no link', () => {
    const { main } = buildProviderRows({ ...none, flatrate: [NETFLIX] }, [], [], NOW);
    expect(main[0].link).toBeNull();
  });

  it('carries the leaving-soon note', () => {
    const offers = [offer(8, 'subscription', { leaving: '2026-11-05' })];
    const { main } = buildProviderRows({ ...none, flatrate: [NETFLIX] }, offers, [], NOW);
    expect(main[0].leaving).toMatch(/^lämnar/);
  });
});
