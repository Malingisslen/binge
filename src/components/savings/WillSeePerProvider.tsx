'use client';

import { Check } from 'lucide-react';
import ProviderDot from '@/components/ui/ProviderDot';
import SrOnlyTableHeader from '@/components/ui/SrOnlyTableHeader';
import { pluralSv } from '@/lib/utils';
import type { WillSeePerProviderRow } from '@/types';

function formatBreakdown(tv: number, movie: number): string {
  const total = pluralSv(tv + movie, 'titel', 'titlar');
  const parts = [
    tv > 0 ? pluralSv(tv, 'serie', 'serier') : null,
    movie > 0 ? pluralSv(movie, 'film', 'filmer') : null,
  ].filter(Boolean);
  return parts.length > 0 ? `${total} (${parts.join(' · ')})` : total;
}

export default function WillSeePerProvider({ rows }: { rows: WillSeePerProviderRow[] }) {
  if (rows.length === 0) return null;

  return (
    <div className="mb-[14px]">
      <div className="flex items-baseline justify-between mb-[6px]">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.5px] text-ink-3">
          Din Vill se per tjänst
        </h2>
        <span className="text-xxs text-ink-3">
          {pluralSv(rows.length, 'tjänst', 'tjänster')}
        </span>
      </div>
      <div className="bg-surface border border-rule rounded-sm overflow-hidden">
        <table className="w-full border-collapse">
          <SrOnlyTableHeader columns={['Prenumererar', 'Tjänst', 'Antal titlar', 'Månadskostnad', 'Status']} />
          <tbody>
            {rows.map(row => (
              <tr key={row.providerId} className="border-b border-rule-2 last:border-b-0">
                <td className="px-3 py-[6px] whitespace-nowrap w-[24px]">
                  {row.isSubscribed ? (
                    <Check size={12} className="text-season-done" />
                  ) : null}
                </td>
                <td className="px-2 py-[6px] whitespace-nowrap">
                  <span className="inline-flex items-center gap-[6px]">
                    <ProviderDot color={row.color} size={7} />
                    <span className={`text-xs ${row.isSubscribed ? 'font-semibold text-ink' : 'text-ink-2'}`}>
                      {row.providerName}
                    </span>
                  </span>
                </td>
                <td className="px-3 py-[6px] text-xs text-ink-2">
                  {formatBreakdown(row.tvCount, row.movieCount)}
                </td>
                <td className="px-3 py-[6px] text-xxs text-ink-3 text-right whitespace-nowrap">
                  {row.monthlyCost != null && row.monthlyCost > 0
                    ? `${row.monthlyCost} kr/mån`
                    : '—'}
                </td>
                <td className="px-3 py-[6px] text-right whitespace-nowrap w-[80px]">
                  {!row.isSubscribed && (
                    <span className="text-xxs text-acc-deep">Ej tecknad</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
