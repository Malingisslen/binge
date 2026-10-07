'use client';

// BIN-1449 — "Din streaming i september": last month's cost per service, per
// episode or film checked off in Binge. Receipt form, Malin's choice A (2026-10-07),
// drawn like MoneyFigure so money reads the same everywhere. States facts only: no
// verdict words and no warning colour on a line (#24's condition).

import { formatKr } from '@/lib/formatKr';
import ProviderDot from '@/components/ui/ProviderDot';
import { cardClass } from '@/components/ui/Card';
import { getProvider, getProviderColor } from '@/lib/tmdb/providers';
import { billLineText, billTotalText, type MonthlyBill } from '@/lib/advisor/monthlyBill';

export default function MonthlyBillCard({ bill }: { bill: MonthlyBill }) {
  const month = bill.month.name;
  const total = billTotalText(bill);
  return (
    <section className={cardClass('mb-[14px] p-3 flex flex-col gap-2 min-w-0')} aria-labelledby="monthly-bill-title" data-testid="monthly-bill">
      <h2 id="monthly-bill-title" className="m-0 text-base font-extrabold text-ink">Din streaming i {month}</h2>
      <div className="border-t-2 border-ink pt-2 flex flex-col gap-2 tabular-nums">
        <ul className="m-0 p-0 list-none flex flex-col gap-2">
          {bill.lines.map(line => (
            <li key={line.providerId} className="flex flex-col gap-[1px] min-w-0">
              <span className="flex justify-between gap-3 text-sm font-bold text-ink">
                <span className="inline-flex items-center gap-[7px] min-w-0">
                  <ProviderDot color={getProviderColor(line.providerId)} size={8} />
                  <span className="truncate">{getProvider(line.providerId)?.shortName ?? String(line.providerId)}</span>
                </span>
                <span className="shrink-0">{formatKr(line.costKr)} kr</span>
              </span>
              <span className="text-xs text-ink-2">{billLineText(line, month)}</span>
            </li>
          ))}
        </ul>
        <p className="m-0 flex justify-between items-baseline gap-3 border-t border-dashed border-rule pt-2">
          <span className="text-sm font-bold text-ink">Totalt i {month}</span>
          <span className="text-4xl font-extrabold tracking-[-0.02em] leading-none text-ink">{formatKr(bill.totalKr)} kr</span>
        </p>
        <p className="m-0 flex justify-between gap-3 text-xs text-ink-2">
          <span>{total.count}</span>
          {total.perItem && <span>{total.perItem}</span>}
        </p>
      </div>
      <p className="m-0 text-xxs text-ink-3">
        Räknat på det du bockat av i Binge under {month} och dina priser i Binge. Finns en serie på flera av dina tjänster räknas den mot en av dem.
      </p>
    </section>
  );
}
