import { priceChangesNewestFirst } from '@/lib/priceTableRows';
import { formatPriceMonth } from '@/lib/priceFreshness';
import { formatKr } from '@/lib/formatKr';

// "Prisändringar" på /streamingpriser/ — nyast först, ur PRICE_CHANGES i
// providers.ts. Datumet märks efter vad det mäter: "från" när tjänsten själv
// angett när priset gällde, "upptäckt" när en priskontroll i Binge såg det.

export default function PriceChangeLog() {
  const changes = priceChangesNewestFirst();
  if (changes.length === 0) return null;
  return (
    <section aria-labelledby="prisandringar" className="mt-8">
      <h2 id="prisandringar" className="text-xl font-semibold text-ink mb-1">Prisändringar</h2>
      <p className="text-xs text-ink-3 mb-2">
        Från: när tjänsten själv anger att priset gällde. Upptäckt: när Binge såg det nya
        priset, ändringen kan ha skett tidigare.
      </p>
      <ul className="divide-y divide-rule-2 border-y border-rule-2 bg-surface">
        {changes.map(c => (
          <li
            key={`${c.date}-${c.providerId}-${c.tierId ?? ''}`}
            className="flex flex-wrap items-baseline gap-x-3 px-3 py-[6px] text-sm"
          >
            <span className="text-xs text-ink-3 w-[8.5rem] shrink-0">
              {c.dateKind === 'effective' ? 'från' : 'upptäckt'} {formatPriceMonth(c.date)}
            </span>
            <span className="flex-1 min-w-0 text-ink">
              {c.providerName}{c.tierName ? ` ${c.tierName}` : ''}
            </span>
            <span className="tabular-nums text-ink-2">
              {formatKr(c.fromKr)} → <strong className="text-ink">{formatKr(c.toKr)} kr/mån</strong>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
