'use client';

// BIN-174 — "Billigaste vägen ikväll": one decisive line on a title page that
// resolves "var ser jag den här billigast just nu?", personalised to what the
// viewer already pays for. Renders the priority-cascade verdict from
// `cheapestPath()` (owned sub → free via library → cheapest rent → suggest).

import { cheapestPath } from '@/lib/streaming/cheapestPath';
import type { Offer } from '@/lib/streaming/offers';
import { getProvider } from '@/lib/tmdb/providers';

export function CheapestPathVerdict({
  subscriptionProviderIds,
  ownedProviderIds,
  offers,
  libraryAvailable,
}: {
  subscriptionProviderIds: number[];
  ownedProviderIds: number[];
  offers: Offer[];
  libraryAvailable: boolean;
}) {
  const v = cheapestPath({
    subscriptionProviderIds,
    ownedProviderIds,
    offers,
    library: libraryAvailable ? { loansLeft: null } : null,
  });

  if (v.kind === 'unavailable') return null;

  const name = v.providerId != null ? getProvider(v.providerId)?.name ?? '' : '';
  let text: string;
  // Free/owned = the decisive "good answer" → saffron (acc = "avgörande").
  // Rent/subscribe = a cost the viewer must weigh → neutral surface.
  let positive = false;

  switch (v.kind) {
    case 'free_public':
      text = `Gratis på ${name}`;
      positive = true;
      break;
    case 'owned':
      text = `Ingår i din ${name}`;
      positive = true;
      break;
    case 'free_library':
      text = 'Gratis via biblioteket';
      positive = true;
      break;
    case 'rent':
      text = `Billigast: hyr för ${v.priceAmount} kr på ${name}`;
      break;
    case 'subscribe': {
      // Render the price FROM the verdict (BIN-322): priceAmount is the cheapest
      // non-sport tier; tierLabel flags a sub-listpris entry (ads/Basic). Do NOT
      // recompute from defaultMonthlyCost — that printed a higher price than the
      // title actually needs (the bug this fixed).
      if (v.priceAmount != null) {
        text = v.tierLabel
          ? `Billigaste väg: ${name} från ${v.priceAmount} kr/mån (${v.tierLabel})`
          : `Billigaste väg: ${name} ${v.priceAmount} kr/mån`;
      } else {
        text = `Finns på ${name}`;
      }
      break;
    }
    default:
      return null;
  }

  // Every kind except free_library names a provider; if TMDB handed us a
  // provider id we don't catalog, `name` is empty and the sentence would read
  // "Gratis på " / "Ingår i din " etc. Suppress rather than show a broken line.
  if (v.kind !== 'free_library' && !name) return null;

  return (
    <div
      className={`rounded-sm px-2 py-1 text-[13px] font-semibold ${
        positive ? 'bg-acc-soft text-acc-deep' : 'bg-bg-2 text-ink-2'
      }`}
      style={{ marginBottom: 8 }}
    >
      {text}
    </div>
  );
}
