'use client';

import { formatKr } from '@/lib/formatKr';
import type { PauseHistoryEntry } from '@/hooks/usePauseHistory';
import { formatSwedishDate, pluralSv } from '@/lib/utils';
import type { AdvisorResult } from '@/types';
import { cardClass } from '@/components/ui/Card';
import { eyebrowClass } from '@/components/ui/Eyebrow';

// Höger spalt på Streamingrådgivaren. Stackar under main content på mobil.
// Block (i ordning):
//   1. Senaste sparbesluten (3 senaste från pauseHistory)
//   2. Nästa översyn (datum härlett ur primaryAction)
//   3. Så fungerar pausen (statisk helper-text för trust)

interface Props {
  advisor: AdvisorResult;
  history: PauseHistoryEntry[];
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
    case 'needs-library':
      return {
        date: null,
        rationale: 'När du har lagt till det du följer',
      };
    case 'idle':
    default:
      return {
        date: a.nextCheckDate,
        rationale: 'När något ändras i din följ-lista',
      };
  }
}

const BLOCK = cardClass('px-3.5 py-3');
const HEAD = eyebrowClass({ className: 'mb-2' });

export default function SavingsSidebar({ advisor, history }: Props) {

  const recent: PauseHistoryEntry[] = history.slice(0, 3);
  const { date: nextReviewDate, rationale: nextReviewRationale } = pickNextReviewDate(advisor);

  return (
    <aside className="flex flex-col gap-3.5">
      {/* Senaste sparbesluten */}
      <div className={BLOCK}>
        <h3 className={HEAD}>Senaste sparbesluten</h3>
        {recent.length === 0 ? (
          <p className="text-xs text-ink-3 leading-[1.45]">
            Inga avslutade pauser än. När du återupptar en pausad tjänst dyker den upp här med ett spar-belopp.
          </p>
        ) : (
          <div>
            {recent.map(e => (
              <div key={e.id} className="flex items-baseline justify-between py-1.5 border-b border-rule-2 last:border-b-0">
                <div className="min-w-0 mr-2">
                  <div className="text-xs font-semibold text-ink truncate">
                    Pausade {e.providerShortName}
                  </div>
                  <div className="text-xxs text-ink-3">
                    {formatSwedishDate(e.pausedAt)} · {pluralSv(e.durationDays, 'dag', 'dagar')}
                  </div>
                </div>
                <div className="text-xs font-bold text-season-done tabular-nums whitespace-nowrap">
                  +{formatKr(e.savedAmount)} kr
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
            <div className="text-xl font-bold text-ink tabular-nums leading-none mb-1">
              {formatSwedishDate(nextReviewDate)}
            </div>
            <p className="text-xs text-ink-3 leading-[1.45]">{nextReviewRationale}</p>
          </>
        ) : (
          <p className="text-sm text-ink-2 leading-[1.45]">{nextReviewRationale}</p>
        )}
      </div>

      {/* Så fungerar pausen */}
      <div className={BLOCK}>
        <h3 className={HEAD}>Så fungerar pausen</h3>
        <p className="text-sm text-ink-2 leading-[1.5]">
          När du <strong className="text-ink">pausar</strong> en tjänst säger du upp den hos streamingbolaget själv — vi markerar den som pausad här och påminner dig när det är dags att starta om.
        </p>
      </div>
    </aside>
  );
}
