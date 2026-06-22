'use client';

import { useMemo } from 'react';
import ProviderDot from '@/components/ui/ProviderDot';
import { rotationPlan, type RotationProviderInput } from '@/lib/advisor/rotationPlan';
import type { AdvisorResult } from '@/types';

/**
 * BIN-92 — rotationsplanerare. Visar en månad-för-månad-plan ("ta X i juni,
 * Y i juli") byggd på Streamingrådgivarens befintliga per-provider-backlog +
 * kostnadsmodell. Ren logik bor i src/lib/advisor/rotationPlan.ts (testad);
 * här mappar vi advisor-resultatet → input och renderar tidslinjen.
 *
 * Plum-tokens (cal-*) för tidspositionering per designsystemet — inte saffran
 * (som är CTA/live). Renderas bara när rotation faktiskt är ett val (≥2 betalda
 * tjänster med backlog) — annars finns inget att rotera mellan.
 */

const HORIZON = 4;

function buildInputs(advisor: AdvisorResult): RotationProviderInput[] {
  const map = new Map<number, RotationProviderInput>();
  for (const p of advisor.providers) {
    const unfinished = p.shows.filter(s => advisor.unfinishedTmdbIds.has(s.tmdbId)).length;
    map.set(p.providerId, {
      providerId: p.providerId,
      providerName: p.providerName,
      shortName: p.shortName,
      color: p.color,
      monthlyCost: p.monthlyCost ?? 0,
      backlogCount: unfinished,
      isFree: (p.monthlyCost ?? 0) === 0,
    });
  }
  for (const r of advisor.willSeeByProvider) {
    const willSee = r.tvCount + r.movieCount;
    const existing = map.get(r.providerId);
    if (existing) {
      existing.backlogCount += willSee;
    } else {
      map.set(r.providerId, {
        providerId: r.providerId,
        providerName: r.providerName,
        shortName: r.shortName,
        color: r.color,
        monthlyCost: r.monthlyCost ?? 0,
        backlogCount: willSee,
        isFree: (r.monthlyCost ?? 0) === 0,
      });
    }
  }
  return [...map.values()];
}

// "Denna månad", "Nästa månad", sedan svenska månadsnamn för offset 2+.
function monthLabel(offset: number, base: Date): string {
  if (offset === 0) return 'Denna månad';
  if (offset === 1) return 'Nästa månad';
  const d = new Date(base.getFullYear(), base.getMonth() + offset, 1);
  return d.toLocaleDateString('sv-SE', { month: 'long' });
}

export default function RotationPlanner({ advisor, now }: { advisor: AdvisorResult; now?: Date }) {
  const inputs = useMemo(() => buildInputs(advisor), [advisor]);
  const plan = useMemo(() => rotationPlan(inputs, { horizonMonths: HORIZON }), [inputs]);

  const scheduled = plan.months.filter(m => m.provider);
  // Rotation är bara meningsfullt om det finns minst två betalda tjänster att
  // växla mellan — annars är det bara "ha den här tjänsten".
  if (scheduled.length < 2) return null;

  const base = now ?? new Date();

  return (
    <div className="bg-surface border border-border-main rounded-sm px-[14px] py-[12px] mb-3">
      <h2 className="text-[10px] uppercase tracking-[0.5px] text-text-muted font-bold mb-[4px]">
        Rotationsplan — en tjänst i taget
      </h2>
      <p className="text-xs text-text-secondary mb-[10px]">
        Rotera istället för att ha allt samtidigt: {plan.totalCost} kr över {scheduled.length} månader röjer{' '}
        {plan.totalBacklogCleared} titlar/avsnitt i din kö.
      </p>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {plan.months.map(m => (
          <div
            key={m.monthOffset}
            className="flex-shrink-0 rounded-sm border px-[10px] py-[8px] min-w-[120px]"
            style={{
              borderColor: m.provider ? 'var(--cal-deep)' : 'var(--rule)',
              background: m.provider ? 'var(--cal-soft)' : 'var(--bg-2)',
            }}
          >
            <div className="text-[10px] uppercase tracking-[0.5px] text-text-muted font-bold capitalize">
              {monthLabel(m.monthOffset, base)}
            </div>
            {m.provider ? (
              <>
                <div className="flex items-center gap-[6px] mt-[6px]">
                  <ProviderDot color={m.provider.color} size={9} />
                  <span className="text-[13px] font-medium text-text-primary">{m.provider.shortName}</span>
                </div>
                <div className="text-[11px] text-text-muted mt-[3px]">
                  {m.cost} kr · {m.backlogCleared} i kö
                </div>
              </>
            ) : (
              <div className="text-[12px] text-text-muted mt-[8px]">paus — spara</div>
            )}
          </div>
        ))}
      </div>

      {plan.alwaysFree.length > 0 && (
        <p className="text-[11px] text-text-muted mt-[8px]">
          Gratis hela tiden: {plan.alwaysFree.map(f => f.shortName).join(', ')}.
        </p>
      )}
    </div>
  );
}
