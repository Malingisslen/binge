'use client';

import ProviderDot from '@/components/ui/ProviderDot';
import SrOnlyTableHeader from '@/components/ui/SrOnlyTableHeader';
import { pluralSv } from '@/lib/utils';
import { rankCoverageOptions } from '@/hooks/useSubscriptionAdvisor.helpers';
import type { WillSeePerProviderRow } from '@/types';

// BIN-87 — coverage optimizer. Inversen av rådgivaren: vilken EJ-tecknad betald
// flatrate-tjänst låser upp mest av användarens Vill se? "Skaffa Max (149 kr) →
// lås upp 7 titlar." Datat (per-tjänst-räkningar) kommer redan från advisorns
// willSeeByProvider — ingen ny TMDB-hämtning.

// Visar de bästa kandidaterna; fler än så blir brus på en beslutsyta.
const MAX_OPTIONS = 4;

function breakdown(tv: number, movie: number): string {
  return [
    tv > 0 ? pluralSv(tv, 'serie', 'serier') : null,
    movie > 0 ? pluralSv(movie, 'film', 'filmer') : null,
  ].filter(Boolean).join(' · ');
}

export default function CoverageOptimizer({ rows }: { rows: WillSeePerProviderRow[] }) {
  const options = rankCoverageOptions(rows).slice(0, MAX_OPTIONS);
  if (options.length === 0) return null;

  return (
    <div className="mb-[14px]">
      <div className="flex items-baseline justify-between mb-[6px]">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.5px] text-ink-3">
          Lås upp mest av din Vill se
        </h2>
        <span className="text-xxs text-ink-3">ej tecknade tjänster</span>
      </div>
      <div className="bg-surface border border-rule rounded-sm overflow-hidden">
        <table className="w-full border-collapse">
          <SrOnlyTableHeader columns={['Tjänst', 'Låser upp', 'Månadskostnad', 'Pris per titel']} />
          <tbody>
            {options.map((o, i) => {
              const detail = breakdown(o.tvCount, o.movieCount);
              return (
                <tr key={o.providerId} className="border-b border-rule-2 last:border-b-0">
                  {/* Accent-stripe på första cellen, inte <tr> — border-collapse
                      ignorerar border-left på rader. */}
                  <td className={`px-3 py-[7px] whitespace-nowrap ${i === 0 ? 'border-l-[3px] border-l-acc-deep' : ''}`}>
                    <span className="inline-flex items-center gap-[6px]">
                      <ProviderDot color={o.color} size={7} />
                      <span className={`text-xs ${i === 0 ? 'font-semibold text-ink' : 'text-ink-2'}`}>
                        Skaffa {o.providerName}
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-[7px] text-xs text-ink-2">
                    lås upp {pluralSv(o.titleCount, 'titel', 'titlar')}
                    {detail ? <span className="text-ink-3"> ({detail})</span> : null}
                  </td>
                  <td className="px-3 py-[7px] text-xxs text-ink-3 text-right whitespace-nowrap tabular-nums">
                    {o.monthlyCost} kr/mån
                  </td>
                  <td className="px-3 py-[7px] text-xxs text-ink-3 text-right whitespace-nowrap tabular-nums">
                    ≈{o.krPerTitle} kr/titel
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
