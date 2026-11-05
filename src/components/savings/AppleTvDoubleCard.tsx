'use client';

import { formatKr } from '@/lib/formatKr';
import { getProvider } from '@/lib/tmdb/providers';
import { appleTvOverlap, APPLE_TV_PLUS_ID } from '@/lib/advisor/appleTvOverlap';
import { priceFreshness } from '@/lib/priceFreshness';
import { MANAGE_URL_STALE_DAYS } from '@/components/savings/CancelHint';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { cardClass } from '@/components/ui/Card';
import { useAuth } from '@/hooks/useAuth';

// Pengatext godkänd av Malin 2026-11-05. "Ingen bindningstid" gäller Apples
// månadsabonnemang; kortet visas bara för den som har Apple TV+ inlagt.
export default function AppleTvDoubleCard() {
  const { user } = useAuth();
  if (!user) return null;
  const now = new Date();
  const overlap = appleTvOverlap(user.myProviders ?? [], user);
  if (!overlap) return null;

  const apple = getProvider(APPLE_TV_PLUS_ID);
  const url = apple?.manageUrl &&
    priceFreshness(apple.manageUrlVerifiedDate, now, MANAGE_URL_STALE_DAYS).kind === 'fresh'
    ? apple.manageUrl
    : undefined;

  return (
    <section className={cardClass('px-4 py-4 mb-3.5')} aria-labelledby="apple-tv-double-q">
      <Eyebrow as="h2" size="xs" id="apple-tv-double-q">Den här månaden</Eyebrow>
      <p className="text-xl font-semibold text-ink mt-1.5">Du betalar Apple TV två gånger</p>
      <p className="text-sm text-ink-2 mt-1.5">
        Ditt Viaplay-paket ({overlap.viaplayTierName}) har redan Apple TV+ med. Säg upp Apple TV+ hos Apple så
        sparar du {formatKr(overlap.appleTvKr)} kr/mån. Apple har ingen bindningstid på månadsabonnemang, så du kan
        säga upp direkt.
      </p>
      <p className="text-xs text-ink-3 mt-1">Summan nedan räknar Apple TV+ en gång.</p>
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="inline-block mt-3 px-3.5 py-2 bg-acc-deep text-on-acc text-sm font-semibold no-underline">
          Säg upp Apple TV+
        </a>
      ) : (
        <p className="text-xs text-ink-2 mt-2">Säg upp i Apples kontoinställningar under Prenumerationer.</p>
      )}
    </section>
  );
}
