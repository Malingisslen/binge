'use client';

import ProviderDot from '@/components/ui/ProviderDot';
import SrOnlyTableHeader from '@/components/ui/SrOnlyTableHeader';
import { pluralSv } from '@/lib/utils';
import { daysUntilRenewal } from '@/lib/renewal';
import { useAuth } from '@/hooks/useAuth';
import type { ProviderAdvisory, ActivePause } from '@/types';

// "Dina tjänster" sorterad efter kr/aktiv-serie — ersätter den gamla
// KPI-3-griden. Bäst valuta överst, sämst nedanför så ögat naturligt
// landar på "vad ska jag kanske kapa".
//
// V1-heuristik: aktiv-räknaren = p.shows.length (alla följda titlar på
// tjänsten). Korrekt sub-state-filter ('aktiv' + 'ikapp', ej 'avslutad')
// är en uppföljning — kräver TMDB-status per show.

interface Row {
  providerId: number;
  providerShortName: string;
  color: string;
  activeCount: number;
  monthlyCost: number;
  krPerShow: number | null;   // null när kostnad = 0 eller inga aktiva
  isFree: boolean;
}

interface Props {
  providers: ProviderAdvisory[];
  activePauses: ActivePause[];
}

const RED_THRESHOLD = 80;  // kr/serie över detta = röd
const GREEN_THRESHOLD = 10; // kr/serie under detta = grön (men inte gratis)

export default function ProvidersByValue({ providers, activePauses }: Props) {
  const { user } = useAuth();
  if (providers.length === 0) return null;

  const renewalDays = user?.providerRenewalDays ?? {};
  const userPausedSet = new Set(activePauses.map(p => p.providerId));

  const rows: Row[] = providers
    .filter(p => !userPausedSet.has(p.providerId))
    .map(p => {
      const cost = p.monthlyCost ?? 0;
      const count = p.shows.length;
      const krPerShow = cost > 0 && count > 0 ? cost / count : null;
      return {
        providerId: p.providerId,
        providerShortName: p.shortName,
        color: p.color,
        activeCount: count,
        monthlyCost: cost,
        krPerShow,
        isFree: cost === 0,
      };
    });

  // Sortera ascending på kr/serie — bäst valuta överst. Gratis (kr=0) får
  // sortvärde -1 så de hamnar allra först. Tjänster utan aktiva shows
  // (krPerShow=null) hamnar sist eftersom vi inte kan ranka dem.
  rows.sort((a, b) => {
    const av = a.isFree ? -1 : (a.krPerShow ?? Infinity);
    const bv = b.isFree ? -1 : (b.krPerShow ?? Infinity);
    return av - bv;
  });

  return (
    <div className="mb-[14px]">
      <div className="flex items-baseline justify-between mb-[6px]">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.5px] text-text-muted">Dina tjänster</h2>
        <span className="text-xxs text-text-muted">Sorterat efter kostnad per aktiv serie</span>
      </div>
      <div className="bg-surface border border-border-main rounded-sm overflow-hidden">
        <table className="w-full border-collapse">
          <SrOnlyTableHeader columns={['Tjänst', 'Aktiva serier', 'Månadskostnad', 'Kostnad per aktiv serie']} />
          <tbody>
            {rows.map(row => {
              const renewalDay = renewalDays[row.providerId];
              const krCellClass = row.isFree
                ? 'text-text-muted'
                : row.krPerShow != null && row.krPerShow >= RED_THRESHOLD
                  ? 'text-danger font-semibold'
                  : row.krPerShow != null && row.krPerShow <= GREEN_THRESHOLD
                    ? 'text-season-done font-semibold'
                    : 'text-text-secondary font-semibold';
              return (
                <tr key={row.providerId} className="border-b border-border-light last:border-b-0">
                  <td className="px-3 py-[6px] whitespace-nowrap">
                    <span className="inline-flex items-center gap-[6px]">
                      <ProviderDot color={row.color} size={7} />
                      <span className="text-xs font-semibold text-text-primary">{row.providerShortName}</span>
                    </span>
                  </td>
                  <td className="px-3 py-[6px] text-xs text-text-secondary tabular-nums">
                    {pluralSv(row.activeCount, 'aktiv', 'aktiva')}
                  </td>
                  <td className="px-3 py-[6px] text-xs text-text-secondary text-right whitespace-nowrap tabular-nums">
                    {row.isFree ? '0 kr' : `${row.monthlyCost} kr/mån`}
                    {renewalDay != null && !row.isFree && (
                      <span className="block text-xxs text-text-muted">förnyas om {daysUntilRenewal(renewalDay, new Date())} d</span>
                    )}
                  </td>
                  <td className={`px-3 py-[6px] text-xs text-right whitespace-nowrap tabular-nums ${krCellClass}`}>
                    {row.isFree
                      ? 'gratis'
                      : row.krPerShow != null
                        ? `${row.krPerShow.toFixed(1).replace('.', ',')} kr/serie`
                        : '—'}
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
