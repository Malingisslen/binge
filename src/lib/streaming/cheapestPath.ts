// BIN-174 — "Billigaste vägen ikväll": a per-title priority cascade that turns
// the raw provider grid into one decisive verdict, personalised to what the
// viewer already pays for. Pure logic over data Binge already holds (owned
// services, SE availability, rent offers, free-via-library). The UI hero line
// that renders this lives on the title pages; this module is the testable core.
//
// Cascade (cheapest / least-friction first):
//   1. free_public  — gratis på public service (SVT/UR): 0 kr, ingen bindning
//   2. owned        — ingår i en tjänst användaren redan betalar för
//   3. free_library — gratis via bibliotek (Cineasterna/Viddla), kostar ett lån
//   4. rent         — billigaste hyra
//   5. subscribe    — ingen ägd väg → föreslå billigaste abonnemang
//   6. unavailable  — varken stream, hyra eller bibliotek i SE

import type { Offer } from './offers';
import { canonicalProviderId, getProvider } from '@/lib/tmdb/providers';

export type CheapestPathKind =
  | 'free_public'
  | 'owned'
  | 'free_library'
  | 'rent'
  | 'subscribe'
  | 'unavailable';

export interface CheapestPathVerdict {
  kind: CheapestPathKind;
  // Provider the verdict points at (canonical id). null for library/unavailable.
  providerId: number | null;
  // Pris för rent-rungen (kr); null för övriga.
  priceAmount: number | null;
  priceCurrency: string | null;
  // Återstående lån för free_library-rungen (self-reported budget); null annars.
  loansLeft: number | null;
}

export interface CheapestPathInput {
  // Kanoniska provider-ids där titeln finns på flatrate/free (subscription-väg).
  subscriptionProviderIds: number[];
  // Användarens ägda tjänster (myProviders, kanoniseras här).
  ownedProviderIds: number[];
  // Rent/buy-offers (med pris) från MOTN.
  offers: Offer[];
  // Bibliotekstillgång (Cineasterna/Viddla) — null om titeln inte finns där
  // eller användaren inte satt hemkommun. loansLeft = self-reported budget.
  library: { loansLeft: number | null } | null;
}

const verdict = (
  kind: CheapestPathKind,
  extra: Partial<Omit<CheapestPathVerdict, 'kind'>> = {},
): CheapestPathVerdict => ({
  kind,
  providerId: extra.providerId ?? null,
  priceAmount: extra.priceAmount ?? null,
  priceCurrency: extra.priceCurrency ?? null,
  loansLeft: extra.loansLeft ?? null,
});

export function cheapestPath(input: CheapestPathInput): CheapestPathVerdict {
  const subs = Array.from(new Set(input.subscriptionProviderIds.map(canonicalProviderId)));
  const owned = new Set(input.ownedProviderIds.map(canonicalProviderId));

  // 1 — gratis på public service (SVT/UR): bäst, kostar 0 och kräver inget abonnemang.
  const freePublic = subs.filter((id) => getProvider(id)?.isFree === true).sort((a, b) => a - b)[0];
  if (freePublic !== undefined) return verdict('free_public', { providerId: freePublic });

  // 2 — ingår i en tjänst användaren redan har (0 kr marginalkostnad).
  const ownedHit = subs.filter((id) => owned.has(id)).sort((a, b) => a - b)[0];
  if (ownedHit !== undefined) return verdict('owned', { providerId: ownedHit });

  // 3 — gratis via bibliotek (kostar ett lån ur kvoten).
  if (input.library) return verdict('free_library', { loansLeft: input.library.loansLeft });

  // 4 — billigaste hyra (rent). Lägsta pris vinner; oavgjort → lägsta provider-id.
  const rentOffers = input.offers
    .filter((o) => o.type === 'rent' && o.priceAmount != null)
    .sort((a, b) =>
      (a.priceAmount as number) - (b.priceAmount as number)
      || canonicalProviderId(a.providerId) - canonicalProviderId(b.providerId),
    );
  if (rentOffers.length > 0) {
    const o = rentOffers[0];
    return verdict('rent', {
      providerId: canonicalProviderId(o.providerId),
      priceAmount: o.priceAmount,
      priceCurrency: o.priceCurrency,
    });
  }

  // 5 — titeln streamas men användaren äger ingen av tjänsterna → föreslå den
  // billigaste (lägsta defaultMonthlyCost; okänd kostnad → lägsta provider-id).
  if (subs.length > 0) {
    const cheapestSub = subs
      .slice()
      .sort((a, b) =>
        (getProvider(a)?.defaultMonthlyCost ?? Number.POSITIVE_INFINITY)
        - (getProvider(b)?.defaultMonthlyCost ?? Number.POSITIVE_INFINITY)
        || a - b,
      )[0];
    return verdict('subscribe', { providerId: cheapestSub });
  }

  // 6 — ingen väg alls i SE.
  return verdict('unavailable');
}
