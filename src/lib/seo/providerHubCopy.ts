// SEO-7 — landing-page copy for /provider/{id}/, built from the provider catalog
// so it states only what SWEDISH_PROVIDERS says (free flag, cheapest usable tier).
// Pure: the page client and its test read it without Firebase.

import { cheapestEntertainmentTierFrom, type SwedishProvider } from '@/lib/tmdb/providers';

export interface ProviderHubCopy {
  /** H1 — the query a Swedish visitor types ("streama på Netflix"). */
  h1: string;
  /** One paragraph under the H1. */
  standfirst: string;
}

export function providerHubCopy(provider: SwedishProvider): ProviderHubCopy {
  const { name } = provider;
  const h1 = `Streama på ${name} i Sverige`;
  const tail = `Här är de populäraste filmerna och serierna på ${name} just nu, och vad som är nytt.`;

  if (provider.isFree) {
    return { h1, standfirst: `${name} är gratis att använda i Sverige. ${tail}` };
  }
  if (provider.isAds) {
    return { h1, standfirst: `${name} är gratis med reklam i Sverige. ${tail}` };
  }
  const { cost } = cheapestEntertainmentTierFrom(provider);
  const price = Number.isFinite(cost) && cost > 0 ? `${name} kostar från ${cost} kr i månaden. ` : '';
  return { h1, standfirst: `${price}${tail}` };
}
