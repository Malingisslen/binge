'use client';

import { usePauseHistory, type PauseHistoryEntry } from '@/hooks/usePauseHistory';
import { useAuth } from '@/hooks/useAuth';
import { formatSwedishDate, daysBetween, pluralSv, localIsoDate } from '@/lib/utils';
import type { AdvisorResult, ActivePause } from '@/types';

// Höger spalt på Streamingrådgivaren. Stackar under main content på mobil.
// Block (i ordning):
//   1. Sparat hittills (kumulativ siffra för förtroende)
//   2. Senaste sparbesluten (3 senaste från pauseHistory)
//   3. Nästa översyn (datum härlett ur primaryAction)
//   4. Så fungerar pausen (statisk helper-text för trust)

interface Props {
  advisor: AdvisorResult;
  activePauses: ActivePause[];
}

function pickNextReviewDate(advisor: AdvisorResult): { date: string | null; rationale: string } {
  const a = advisor.primaryAction;
  switch (a.kind) {
    case 'pause':
      return {
        date: a.nextAirDate,
        rationale: a.nextAirDate
          ? `När ${a.providerName} har nya avsnitt igen`
          : 'När din situation ändras',
      };
    case 'catchup':
      return {
        date: null,
        rationale: 'När du är ikapp på dina pågående serier',
      };
    case 'subscribe':
      return {
        date: a.nearestAirDate,
        rationale: a.nearestAirDate
          ? `När första nya avsnittet kommer på ${a.providerName}`
          : 'När en titel du följer börjar streama',
      };
    case 'idle':
    default:
      return {
        date: a.nextCheckDate,
        rationale: 'När något ändras i din följ-lista',
      };
  }
}

function monthsSince(date: Date | null | undefined): number {
  if (!date) return 0;
  const iso = localIsoDate(date);
  const days = daysBetween(iso);
  return Math.max(1, Math.floor(days / 30));
}

const BLOCK = 'bg-surface border border-rule rounded-sm px-[14px] py-[12px]';
const HEAD = 'text-[10px] uppercase tracking-[0.5px] text-ink-3 font-bold mb-[8px]';

export default function SavingsSidebar({ advisor, activePauses }: Props) {
  const { user } = useAuth();
  const { history, totalSaved: historicalSaved } = usePauseHistory();

  const activeSaved = activePauses.reduce((sum, p) => sum + p.savingsSoFar, 0);
  const totalSaved = historicalSaved + activeSaved;
  const accountMonths = monthsSince(user?.createdAt ?? null);

  const recent: PauseHistoryEntry[] = history.slice(0, 3);
  const { date: nextReviewDate, rationale: nextReviewRationale } = pickNextReviewDate(advisor);

  return (
    <aside className="flex flex-col gap-[14px]">
      {/* Sparat hittills */}
      <div className={BLOCK}>
        <h3 className={HEAD}>Sparat hittills</h3>
        <div className="text-[24px] font-bold text-season-done tabular-nums leading-none mb-[6px]">
          {totalSaved} kr
        </div>
        <p className="text-[11px] text-ink-3 leading-[1.45]">
          {accountMonths > 0
            ? `Sedan du började använda Streamingrådgivaren för ${pluralSv(accountMonths, 'månad', 'månader')} sedan.`
            : 'Sedan du började använda Streamingrådgivaren.'}
        </p>
      </div>

      {/* Senaste sparbesluten */}
      <div className={BLOCK}>
        <h3 className={HEAD}>Senaste sparbesluten</h3>
        {recent.length === 0 ? (
          <p className="text-[11px] text-ink-3 leading-[1.45]">
            Inga avslutade pauser än. När du återupptar en pausad tjänst dyker den upp här med ett spar-belopp.
          </p>
        ) : (
          <div>
            {recent.map(e => (
              <div key={e.id} className="flex items-baseline justify-between py-[5px] border-b border-rule-2 last:border-b-0">
                <div className="min-w-0 mr-2">
                  <div className="text-[11px] font-semibold text-ink truncate">
                    Pausade {e.providerShortName}
                  </div>
                  <div className="text-[10px] text-ink-3">
                    {formatSwedishDate(e.pausedAt)} · {pluralSv(e.durationDays, 'dag', 'dagar')}
                  </div>
                </div>
                <div className="text-[11px] font-bold text-season-done tabular-nums whitespace-nowrap">
                  +{e.savedAmount} kr
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Nästa översyn */}
      <div className={BLOCK}>
        <h3 className={HEAD}>Nästa översyn</h3>
        {nextReviewDate ? (
          <>
            <div className="text-[18px] font-bold text-ink tabular-nums leading-none mb-[4px]">
              {formatSwedishDate(nextReviewDate)}
            </div>
            <p className="text-[11px] text-ink-3 leading-[1.45]">{nextReviewRationale}</p>
          </>
        ) : (
          <p className="text-[12px] text-ink-2 leading-[1.45]">{nextReviewRationale}</p>
        )}
      </div>

      {/* Så fungerar pausen */}
      <div className={BLOCK}>
        <h3 className={HEAD}>Så fungerar pausen</h3>
        <p className="text-[12px] text-ink-2 leading-[1.5]">
          När du <strong className="text-ink">pausar</strong> en tjänst säger du upp den hos streamingbolaget själv — vi markerar den som pausad här och påminner dig när det är dags att starta om.
        </p>
      </div>
    </aside>
  );
}
