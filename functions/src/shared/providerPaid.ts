/**
 * BIN-1449 — which services cost money, for the monthly bill notice. Hand-copied
 * from SWEDISH_PROVIDERS in the client's `src/lib/tmdb/providers.ts` (functions/
 * cannot import client source); `src/lib/tmdb/providerPaid.parity.test.ts` fails the
 * moment the two disagree. Only whether a price is above zero is copied, never the
 * price, so a monthly price update does not touch this file.
 *
 * `tiers` maps each tier id to whether that tier costs money. `defaultPaid` is the
 * same for the catalog's default price.
 */
export interface PaidEntry {
  aliases: readonly number[];
  /** The catalog has a default price; without one a campaign has nothing to replace. */
  hasDefault: boolean;
  defaultPaid: boolean;
  tiers: Readonly<Record<string, boolean>>;
}

export const PROVIDER_PAID: Readonly<Record<number, PaidEntry>> = {
  8: { aliases: [175], hasDefault: true, defaultPaid: true, tiers: { basic: true, standard: true, premium: true } },
  119: { aliases: [], hasDefault: true, defaultPaid: true, tiers: {} },
  337: { aliases: [], hasDefault: true, defaultPaid: true, tiers: { ads: true, standard: true, premium: true } },
  384: { aliases: [1899, 1825], hasDefault: true, defaultPaid: true, tiers: { ads: true, standard: true, premium: true } },
  76: { aliases: [], hasDefault: true, defaultPaid: true, tiers: { reklam: true, standard: true, medium: true, total: true } },
  520: { aliases: [493], hasDefault: true, defaultPaid: false, tiers: {} },
  489: { aliases: [1944, 1759], hasDefault: true, defaultPaid: true, tiers: { 'plus-ads': true, plus: true, 'sport-bas': true, 'sport-fotboll': true, 'sport-hockey': true, sport: true } },
  350: { aliases: [2243], hasDefault: true, defaultPaid: true, tiers: {} },
  510: { aliases: [], hasDefault: true, defaultPaid: true, tiers: { ads: true, standard: true, sport: true } },
  323: { aliases: [1968, 283], hasDefault: true, defaultPaid: true, tiers: { fan: true, megafan: true } },
  431: { aliases: [1773, 531], hasDefault: true, defaultPaid: true, tiers: { ads: true, standard: true, premium: true } },
  335: { aliases: [188], hasDefault: true, defaultPaid: true, tiers: { lite: true, student: true, solo: true, family: true } },
  521: { aliases: [497], hasDefault: true, defaultPaid: true, tiers: {} },
  300: { aliases: [], hasDefault: true, defaultPaid: false, tiers: {} },
  538: { aliases: [], hasDefault: true, defaultPaid: false, tiers: {} },
  11: { aliases: [], hasDefault: true, defaultPaid: true, tiers: {} },
  435: { aliases: [], hasDefault: true, defaultPaid: true, tiers: { bas: true, standard: true, premium: true } },
  578: { aliases: [517], hasDefault: false, defaultPaid: false, tiers: {} },
  35: { aliases: [], hasDefault: false, defaultPaid: false, tiers: {} },
  3: { aliases: [], hasDefault: false, defaultPaid: false, tiers: {} },
  2: { aliases: [], hasDefault: false, defaultPaid: false, tiers: {} },
  426: { aliases: [], hasDefault: false, defaultPaid: false, tiers: {} },
  423: { aliases: [], hasDefault: false, defaultPaid: false, tiers: {} },
};

const CANONICAL = new Map<number, number>();
for (const [id, entry] of Object.entries(PROVIDER_PAID)) {
  CANONICAL.set(Number(id), Number(id));
  for (const alias of entry.aliases) CANONICAL.set(alias, Number(id));
}

/** The catalog id for a provider or one of its aliases; null when unknown. */
export function canonicalPaidId(id: number): number | null {
  return CANONICAL.get(id) ?? null;
}
