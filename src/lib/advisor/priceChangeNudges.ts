// Prisvakten i Rådgivaren (paket L, beslut 7): en rad per prisändring i
// PRICE_CHANGES som gäller en tjänst OCH nivå användaren har. Ren — `now` skickas in.
//
// Nivån måste matcha uttryckligen: en tjänst med nivåer där användaren inte valt
// nivå får ingen rad, för "du har den" vore då en gissning. En tjänst utan nivåer
// matchar raderna med `tierId: null`. Pausade tjänster hoppas över, de betalas inte.
//
// Fönstret: en rad visas tills PRICE_CHANGE_SHOW_DAYS dagar efter sitt datum. Ett
// 'YYYY-MM'-datum räknas från månadens första dag. Raderna har aldrig ett framtida
// datum (providers.priceData.test.ts), så texten talar alltid i dåtid.

import { formatKr } from '@/lib/formatKr';
import { formatPriceDay, formatPriceMonth } from '@/lib/priceFreshness';
import { getProvider, PRICE_CHANGES, type PriceChange } from '@/lib/tmdb/providers';

export const PRICE_CHANGE_SHOW_DAYS = 60;

export interface PriceChangeNudge {
  /** Stabil nyckel för att kunna dölja raden. */
  key: string;
  providerId: number;
  providerName: string;
  tierName: string | null;
  color: string;
  change: PriceChange;
  /** (toKr − fromKr) × 12, negativt vid en sänkning. */
  yearlyDiffKr: number;
}

const DATE = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/;

function changeDay(date: string): Date | null {
  const m = DATE.exec(date);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, m[3] ? Number(m[3]) : 1);
}

export function priceChangeKey(c: PriceChange): string {
  return `${c.providerId}-${c.tierId ?? ''}-${c.date}`;
}

export function computePriceChangeNudges(
  user: {
    myProviders?: number[];
    providerTiers?: Record<number, string>;
    providerPauses?: Record<number, unknown>;
  },
  now: Date,
  changes: PriceChange[] = PRICE_CHANGES,
): PriceChangeNudge[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const owned = new Set(
    (user.myProviders ?? []).map(id => getProvider(id)?.id).filter((id): id is number => id != null),
  );
  const rows: PriceChangeNudge[] = [];
  for (const c of changes) {
    const provider = getProvider(c.providerId);
    if (!provider || !owned.has(provider.id)) continue;
    if (user.providerPauses?.[provider.id]) continue;
    if (c.fromKr === c.toKr) continue;

    let tierName: string | null = null;
    if (c.tierId === null) {
      if (provider.tiers?.length) continue;
    } else {
      if (user.providerTiers?.[provider.id] !== c.tierId) continue;
      tierName = provider.tiers?.find(t => t.id === c.tierId)?.name ?? null;
      if (tierName === null) continue;
    }

    const day = changeDay(c.date);
    if (!day) continue;
    const ageDays = Math.round((today.getTime() - day.getTime()) / 86_400_000);
    if (ageDays > PRICE_CHANGE_SHOW_DAYS) continue;

    rows.push({
      key: priceChangeKey(c),
      providerId: provider.id,
      providerName: provider.name,
      tierName,
      color: provider.color,
      change: c,
      yearlyDiffKr: (c.toKr - c.fromKr) * 12,
    });
  }
  // Nyast först.
  rows.sort((a, b) => b.change.date.localeCompare(a.change.date));
  return rows;
}

function formatChangeDate(date: string): string {
  return date.length > 7 ? formatPriceDay(date) : formatPriceMonth(date);
}

export function priceChangeText(n: PriceChangeNudge): { lead: string; note: string } {
  const c = n.change;
  const name = n.tierName ? `${n.providerName} ${n.tierName}` : n.providerName;
  const raised = c.toKr > c.fromKr;
  const prices = `${formatKr(c.fromKr)} till ${formatKr(c.toKr)} kr/mån`;
  const year = `${formatKr(Math.abs(n.yearlyDiffKr))} kr ${raised ? 'mer' : 'mindre'} om året`;
  const when = formatChangeDate(c.date);
  if (c.dateKind === 'noticed') {
    return {
      lead: `${name} har ${raised ? 'höjt' : 'sänkt'} priset från ${prices}. Det blir ${year}.`,
      note: `Binge såg det nya priset ${when}. Ändringen kan ha skett tidigare.`,
    };
  }
  const verb = raised ? 'höjdes' : 'sänktes';
  return {
    lead: `Priset för ${name} ${verb} från ${prices} ${c.date.length > 7 ? 'den' : 'i'} ${when}. Det blir ${year}.`,
    note: 'Datumet kommer från tjänsten själv.',
  };
}
