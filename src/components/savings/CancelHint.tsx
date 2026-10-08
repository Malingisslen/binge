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
// Utan kontrollerad länk säger raden var uppsägningen görs i stället (Malins val
// 2026-10-08), så ingen betald tjänst står utan besked.

export const MANAGE_URL_STALE_DAYS = 60;

interface Props {
  providerId: number;
  billingDay: number | undefined;
  now: Date;
}

export default function CancelHint({ providerId, billingDay, now }: Props) {
  const provider = getProvider(providerId);
  // A free service has nothing to cancel.
  if (provider?.isFree) return null;
  const url = provider?.manageUrl &&
    priceFreshness(provider.manageUrlVerifiedDate, now, MANAGE_URL_STALE_DAYS).kind === 'fresh'
    ? provider.manageUrl
    : undefined;
  const charge = billingDay != null ? formatPriceDay(toIsoDate(nextAvoidableCharge(billingDay, now))) : null;
  const before = charge ? ` före dragningen ${charge}` : '';
  const label = url ? `Säg upp${before}` : `Säg upp i tjänstens kontoinställningar${before}`;
  return url ? (
    <a href={url} target="_blank" rel="noopener noreferrer" className="block text-xxs text-acc-deep no-underline">
      {label} ›
    </a>
  ) : (
    <span className="block text-xxs text-ink-3">{label}</span>
  );
}
