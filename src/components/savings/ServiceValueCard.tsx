'use client';

// BIN-182 — "Behåll eller säg upp?": end-of-month per-service value verdict from
// what the user actually watched, priced at their own subscription cost.
// Distinct from ProvidersByValue (kr per *followed* series) — this measures
// *value received this month* (kr/film, kr/h). Films-this-month lens.

import ProviderDot from '@/components/ui/ProviderDot';
import SrOnlyTableHeader from '@/components/ui/SrOnlyTableHeader';
import { pluralSv } from '@/lib/utils';
import { getProvider, getProviderColor } from '@/lib/tmdb/providers';
import { useServiceValue } from '@/hooks/useServiceValue';

export default function ServiceValueCard({ nowMs }: { nowMs: number }) {
  const { rows, monthLabel } = useServiceValue(nowMs);

  // Only paid services the user owns are meaningful here (free/0-kr services
  // can't be "dead weight"). If none, render nothing.
  const paid = rows.filter(r => r.monthlyCost > 0);
  if (paid.length === 0) return null;

  // Worst value first (dead-weight, then highest kr/film) — eye lands on the cut.
  const sorted = [...paid].sort((a, b) => {
    if (a.isDeadWeight !== b.isDeadWeight) return a.isDeadWeight ? -1 : 1;
    return (b.krPerTitle ?? 0) - (a.krPerTitle ?? 0);
  });

  return (
    <div className="mb-[14px]">
      <div className="flex items-baseline justify-between mb-[6px]">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.5px] text-ink-3">Behåll eller säg upp?</h2>
        <span className="text-xxs text-ink-3">Värde i {monthLabel} · film du sett</span>
      </div>
      {/* BIN-527: a followed serie som finns på flera tjänster räknas bara mot EN — hedge
          eftersom TMDB:s tillgänglighetsdata är per titel, inte per säsong/avsnitt. */}
      <p className="text-xxs text-ink-3 mb-[6px]">
        En serie du följer räknas mot en tjänst — inte alla den råkar finnas på.
      </p>
      <div className="bg-surface border border-rule rounded-sm overflow-hidden">
        <table className="w-full border-collapse">
          <SrOnlyTableHeader columns={['Tjänst', 'Sett', 'Månadskostnad', 'Värde']} />
          <tbody>
            {sorted.map(r => {
              const name = getProvider(r.providerId)?.shortName ?? String(r.providerId);
              const valueText = r.isDeadWeight
                ? 'inget sett'
                : r.krPerHour != null
                  ? `${r.krPerHour} kr/h`
                  : r.krPerTitle != null
                    ? `${r.krPerTitle} kr/film`
                    : '—';
              return (
                <tr key={r.providerId} className="border-b border-rule-2 last:border-b-0">
                  <td className="px-3 py-[6px] whitespace-nowrap">
                    <span className="inline-flex items-center gap-[6px]">
                      <ProviderDot color={getProviderColor(r.providerId)} size={7} />
                      <span className="text-xs font-semibold text-ink">{name}</span>
                    </span>
                  </td>
                  <td className="px-3 py-[6px] text-xs text-ink-2 tabular-nums">
                    {pluralSv(r.titlesWatched, 'film', 'filmer')}
                  </td>
                  <td className="px-3 py-[6px] text-xs text-ink-2 text-right whitespace-nowrap tabular-nums">
                    {r.monthlyCost} kr/mån
                  </td>
                  <td className={`px-3 py-[6px] text-xs text-right whitespace-nowrap tabular-nums ${r.isDeadWeight ? 'text-danger font-semibold' : 'text-ink-2'}`}>
                    {valueText}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
