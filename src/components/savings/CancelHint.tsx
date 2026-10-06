'use client';

import { getProvider } from '@/lib/tmdb/providers';
import { nextAvoidableCharge } from '@/lib/renewal';
import { formatPriceDay, priceFreshness } from '@/lib/priceFreshness';
import { toIsoDate } from '@/lib/utils';

// "Säg upp rätt" (paket L): länk till tjänstens egen uppsägningssida och, när
// användaren angett faktureringsdag, nästa dragning en uppsägning kan hinna före.
// Datumet är användarens egen faktureringsdag, inte tjänstens regel, så texten säger
// "före dragningen", aldrig en sista dag. En länk som ingen kontrollerat på
// MANAGE_URL_STALE_DAYS dagar visas inte: en död uppsägningslänk är värre än ingen.

export const MANAGE_URL_STALE_DAYS = 60;

interface Props {
  providerId: number;
  billingDay: number | undefined;
  now: Date;
}

export default function CancelHint({ providerId, billingDay, now }: Props) {
  const provider = getProvider(providerId);
  const url = provider?.manageUrl &&
    priceFreshness(provider.manageUrlVerifiedDate, now, MANAGE_URL_STALE_DAYS).kind === 'fresh'
    ? provider.manageUrl
    : undefined;
  const charge = billingDay != null ? formatPriceDay(toIsoDate(nextAvoidableCharge(billingDay, now))) : null;
  if (!url && !charge) return null;
  const label = charge ? `Säg upp före dragningen ${charge}` : 'Säg upp';
  return url ? (
    <a href={url} target="_blank" rel="noopener noreferrer" className="block text-xxs text-acc-deep no-underline">
      {label} ›
    </a>
  ) : (
    <span className="block text-xxs text-ink-3">{label}</span>
  );
}
