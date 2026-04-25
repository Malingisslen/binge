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
        <h2 className="text-[11px] font-bold uppercase tracking-[0.5px] text-text-muted">
          Din Vill se per tjänst
        </h2>
        <span className="text-xxs text-text-muted">
          {pluralSv(rows.length, 'tjänst', 'tjänster')}
        </span>
      </div>
      <div className="bg-surface border border-border-main rounded-sm overflow-hidden">
        <table className="w-full border-collapse">
          <SrOnlyTableHeader columns={['Prenumererar', 'Tjänst', 'Antal titlar', 'Månadskostnad', 'Status']} />
          <tbody>
            {rows.map(row => (
              <tr key={row.providerId} className="border-b border-border-light last:border-b-0">
                <td className="px-3 py-[6px] whitespace-nowrap w-[24px]">
                  {row.isSubscribed ? (
                    <Check size={12} className="text-[#2e7d32]" />
                  ) : null}
                </td>
                <td className="px-2 py-[6px] whitespace-nowrap">
                  <span className="inline-flex items-center gap-[6px]">
                    <ProviderDot color={row.color} size={7} />
                    <span className={`text-xs ${row.isSubscribed ? 'font-semibold text-text-primary' : 'text-text-secondary'}`}>
                      {row.providerName}
                    </span>
                  </span>
                </td>
                <td className="px-3 py-[6px] text-xs text-text-secondary">
                  {formatBreakdown(row.tvCount, row.movieCount)}
                </td>
                <td className="px-3 py-[6px] text-xxs text-text-muted text-right whitespace-nowrap">
                  {row.monthlyCost != null && row.monthlyCost > 0
                    ? `${row.monthlyCost} kr/mån`
                    : '—'}
                </td>
                <td className="px-3 py-[6px] text-right whitespace-nowrap w-[80px]">
                  {!row.isSubscribed && (
                    <span className="text-xxs text-accent">Ej tecknad</span>
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
