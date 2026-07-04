'use client';

import ProviderDot from '@/components/ui/ProviderDot';
import JustWatchCredit from '@/components/ui/JustWatchCredit';
import { getProvider } from '@/lib/tmdb/providers';
import { pluralSv } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { useListCheapestPlan, type ListPlanItem } from '@/hooks/useListCheapestPlan';

// BIN-416 — "Billigaste sättet att se listan": renders the pure cheapestListPlan
// optimizer over a curated list's titles. Every kr shown is a subscription cost
// we actually know (the user's tier/custom/catalog default, 0 if already owned);
// rent/buy is only ever COUNTED, never priced (TMDB exposes rent/buy availability
// but not price). See src/lib/advisor/listOptimizer.ts for the honesty contract.
//
// Gated to logged-in users: the incremental-cost reasoning ("0 kr — du har den")
// only means something with the viewer's own provider set, and it keeps the
// per-title lite fan-out from firing for anonymous crawlers of a public list.
//
// Surface note (BIN-416): wired to curated list pages first (the lower-risk
// starting surface). Group watchlists are the follow-up once Malin picks the
// second surface.

// A shorter list has no "cheapest way" story worth a panel.
const MIN_TITLES = 2;

function providerName(id: number): string {
  return getProvider(id)?.name ?? 'Okänd tjänst';
}

function CostLabel({ kr }: { kr: number | null }) {
  if (kr == null) return null;
  if (kr === 0) return <span className="text-ink-3">0 kr — ingår i en tjänst du har</span>;
  return <span className="tabular-nums">{kr} kr/mån</span>;
}

export default function ListCheapestPlanPanel({ items }: { items: ListPlanItem[] }) {
  const { uid } = useAuth();
  const enabled = !!uid && items.length >= MIN_TITLES;
  const { plan, isLoading, hasError, uncheckableCount } = useListCheapestPlan(items, { enabled });

  // Silent when gated off, too small, or nothing to say — never a broken/empty box.
  if (!enabled) return null;
  if (isLoading) {
    return (
      <div className="mt-3 mb-[14px]">
        <SectionHeader />
        <div className="bg-surface border border-rule rounded-sm px-3 py-[10px] text-xs text-ink-3">
          Räknar ut billigaste vägen…
        </div>
      </div>
    );
  }
  if (hasError || !plan) return null;

  const { bestSingle, fullPlan, savingKr, naiveMonthlyKr, streamableCount, totalTitles } = plan;

  const nothingStreams = streamableCount === 0;
  // Show the full-bundle row only when it's a genuinely different, multi-service
  // plan than the best single — otherwise the single already tells the whole story.
  const showBundle = !nothingStreams && fullPlan.serviceIds.length > 1;

  // Remainder counts come from the plan's fullPlan (whole-list view): rent/buy
  // COUNTED, never priced; unavailable = no SE path at all.
  const rentCount = fullPlan.rentCount;
  const unavailableCount = fullPlan.unavailableCount;

  return (
    <div className="mt-3 mb-[14px]">
      <SectionHeader />
      <div className="bg-surface border border-rule rounded-sm overflow-hidden">
        {/* Best single — the headline, accent-striped. */}
        <div className="px-3 py-[9px] border-l-[3px] border-l-acc-deep border-b border-rule-2">
          {nothingStreams || bestSingle.providerId == null ? (
            <div className="text-xs text-ink-2">
              Inga av titlarna finns på en streamingtjänst i Sverige just nu.
            </div>
          ) : (
            <div className="flex items-baseline justify-between gap-3">
              <span className="inline-flex items-center gap-[6px] min-w-0">
                <ProviderDot color={getProvider(bestSingle.providerId)?.color ?? '#888'} size={7} />
                <span className="text-xs text-ink truncate">
                  <span className="font-semibold">{bestSingle.providerName}</span>{' '}
                  <span className="text-ink-2">
                    täcker {bestSingle.coveredCount} av {totalTitles}
                  </span>
                </span>
              </span>
              <span className="text-xs text-ink shrink-0">
                <CostLabel kr={bestSingle.monthlyKr} />
              </span>
            </div>
          )}
        </div>

        {/* Cheapest full-coverage bundle + the saving vs subscribing to everything. */}
        {showBundle && (
          <div className="px-3 py-[9px] border-b border-rule-2 last:border-b-0">
            <div className="flex items-baseline justify-between gap-3">
              <span className="inline-flex items-center gap-[6px] flex-wrap min-w-0">
                <span className="text-xxs uppercase tracking-[0.5px] text-ink-3 shrink-0">Hela listan</span>
                {fullPlan.serviceIds.map((id) => (
                  <span key={id} className="inline-flex items-center gap-[4px]">
                    <ProviderDot color={getProvider(id)?.color ?? '#888'} size={6} />
                    <span className="text-xs text-ink-2">{providerName(id)}</span>
                  </span>
                ))}
              </span>
              <span className="text-xs text-ink shrink-0 tabular-nums">{fullPlan.monthlyKr} kr/mån</span>
            </div>
            {savingKr > 0 && (
              <div className="text-xxs text-acc-deep mt-[3px]">
                Spara {savingKr} kr/mån mot att teckna alla var för sig ({naiveMonthlyKr} kr)
              </div>
            )}
          </div>
        )}

        {/* Honest remainder: counted, never priced. */}
        {(rentCount > 0 || unavailableCount > 0 || uncheckableCount > 0) && (
          <div className="px-3 py-[7px] text-xxs text-ink-3">
            {[
              rentCount > 0 ? `${pluralSv(rentCount, 'titel', 'titlar')} går att hyra/köpa` : null,
              unavailableCount > 0 ? `${unavailableCount} saknas i Sverige` : null,
              uncheckableCount > 0 ? `${pluralSv(uncheckableCount, 'titel', 'titlar')} kunde inte kontrolleras just nu` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>
        )}
      </div>
      <JustWatchCredit className="mt-[6px]" />
    </div>
  );
}

function SectionHeader() {
  return (
    <div className="flex items-baseline justify-between mb-[6px]">
      <h2 className="text-[11px] font-bold uppercase tracking-[0.5px] text-ink-3">
        Billigaste sättet att se listan
      </h2>
      <span className="text-xxs text-ink-3">för dina tjänster</span>
    </div>
  );
}
