'use client';

import { useEffect, useState } from 'react';
import { buildPriceRows, sortPriceRows, type PriceRow, type PriceSort } from '@/lib/priceTableRows';
import { formatPriceDay, priceFreshness } from '@/lib/priceFreshness';
import { formatKr } from '@/lib/formatKr';
import { cardClass } from '@/components/ui/Card';
import { thClass } from '@/components/ui/tableHead';

// /streamingpriser/ — tabellen. Kontrolldatumet jämförs mot klientens klocka efter
// montering (#28:s villkor 10): den statiska HTML:en byggs en gång och kan inte
// veta vilken dag den läses. Före monteringen visas bara datumet.

function CheckedCell({ date, now }: { date: string | undefined; now: Date | null }) {
  if (!now) return <>{formatPriceDay(date)}</>;
  const f = priceFreshness(date, now);
  if (f.kind === 'unverified') return <>–</>;
  return (
    <>
      {formatPriceDay(f.date)}
      {f.kind === 'stale' && <span className="block text-xxs text-warn-ink">kan vara inaktuell</span>}
    </>
  );
}

export default function PriceTable({ rows = buildPriceRows() }: { rows?: PriceRow[] }) {
  const [sort, setSort] = useState<PriceSort>('provider');
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
  }, []);

  const sorted = sortPriceRows(rows, sort);
  const sortButton = (mode: PriceSort, label: string) => (
    <button
      type="button"
      aria-pressed={sort === mode}
      onClick={() => setSort(mode)}
      className={`px-2 py-[3px] text-xs rounded-sm border cursor-pointer ${
        sort === mode ? 'border-ink bg-ink text-bg' : 'border-rule bg-surface text-ink-2'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="mt-6">
      <div className="flex items-center gap-2 mb-2" role="group" aria-label="Sortering">
        {sortButton('provider', 'Per tjänst')}
        {sortButton('cheapest', 'Billigast först')}
      </div>
      <div className={cardClass('overflow-x-auto')}>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>
              <th scope="col" className={thClass('text-left px-3')}>Tjänst</th>
              <th scope="col" className={thClass('text-left px-3')}>Nivå</th>
              <th scope="col" className={thClass('text-right px-3')}>kr/mån</th>
              <th scope="col" className={thClass('text-left px-3')}>Kontrollerat</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(r => (
              <tr key={r.key} className="border-t border-rule-2 align-top">
                <td className="px-3 py-[6px] text-ink">{r.providerName}</td>
                <td className="px-3 py-[6px] text-ink-2">
                  {r.tierName ?? '–'}
                  {r.sport && <span className="chip ml-2">sport</span>}
                </td>
                <td className="px-3 py-[6px] text-right tabular-nums font-semibold text-ink">{formatKr(r.kr)}</td>
                <td className="px-3 py-[6px] text-xs text-ink-2 tabular-nums whitespace-nowrap">
                  <CheckedCell date={r.verifiedDate} now={now} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
