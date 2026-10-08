'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { useSignedOutRedirect } from '@/hooks/useSignedOutRedirect';
import { SWEDISH_PROVIDERS } from '@/lib/tmdb/providers';
import { resolveEffectiveMonthlyCost } from '@/lib/advisor/effectiveCost';
import { isEstimatedMonthlyCost } from '@/lib/advisor/costEstimate';
import { computeGuestCost } from '@/lib/advisor/guestCost';
import {
  GUEST_PRICED_PROVIDERS,
  loadGuestSelection,
  saveGuestSelection,
  type GuestSelection,
} from '@/lib/guestProviders';
import { formatKr } from '@/lib/formatKr';
import { trackEvent } from '@/lib/analytics';
import GuestBundleBox, { joinNames } from '@/components/pricing/GuestBundleBox';
import MoneyFigure from '@/components/ui/MoneyFigure';
import { Button, buttonClass } from '@/components/ui/Button';
import { cardClass } from '@/components/ui/Card';
import { eyebrowClass } from '@/components/ui/Eyebrow';

// /streamingkostnad/ — den interaktiva delen. Rubriken och introtexten renderas av
// sidans serverkomponent så att de står i den statiska HTML:en.
//
// Valet läses ur sessionStorage först efter montering: servern har ingen lagring,
// och en förifylld första rendering hade inte matchat den statiska HTML:en.

// Gratis- och reklamtjänsterna har ingen rad; de nämns på en rad under listan.
const FREE_NAMES = SWEDISH_PROVIDERS
  .filter(p => p.type === 'flatrate' && (p.isFree || p.isAds))
  .map(p => p.name);

// Desktop: tjänst | nivå | pris. Phone: tjänst | pris, with the tier below.
const ROW_COLUMNS = 'grid-cols-[minmax(0,1fr)_5.5rem] sm:grid-cols-[minmax(0,1fr)_minmax(0,13rem)_5.5rem]';

export default function CostCalculator() {
  const { uid } = useAuth();
  const goToLogin = useSignedOutRedirect();
  const [selection, setSelection] = useState<GuestSelection>({});
  const [now] = useState(() => new Date());
  const totalTracked = useRef(false);

  useEffect(() => {
    setSelection(loadGuestSelection());
  }, []);

  const update = (next: GuestSelection) => {
    setSelection(next);
    saveGuestSelection(next);
  };

  const toggle = (id: number) => {
    const next = { ...selection };
    if (id in next) delete next[id];
    else next[id] = null;
    update(next);
  };

  // En vald nivå kryssar också i tjänsten.
  const chooseTier = (id: number, tierId: string) => update({ ...selection, [id]: tierId || null });

  const result = useMemo(() => computeGuestCost(selection, now), [selection, now]);

  useEffect(() => {
    if (result.paidCount > 0 && !totalTracked.current) {
      totalTracked.current = true;
      trackEvent('price_check_total_shown', { surface: 'calculator', paidCount: result.paidCount });
    }
  }, [result.paidCount]);

  const providerTiers: Record<number, string> = {};
  for (const [id, tier] of Object.entries(selection)) if (tier) providerTiers[Number(id)] = tier;
  const settings = { providerTiers };

  const saveAndSignIn = () => {
    saveGuestSelection(selection);
    trackEvent('price_check_save_clicked', { paidCount: result.paidCount });
    goToLogin();
  };

  return (
    <div className="mt-6">
      {/* Fixed columns, so the tier picker and the price start at the same place on
          every row (plan round 2, decision 4). On phones the tier gets a row of its own. */}
      <div
        aria-hidden="true"
        className={`hidden sm:grid ${ROW_COLUMNS} px-3 py-1.5 border-t border-rule-2 ${eyebrowClass({ className: 'bg-bg-2' })}`}
      >
        <span>Tjänst</span>
        <span>Nivå</span>
        <span className="text-right">Pris/mån</span>
      </div>
      <ul className="divide-y divide-rule-2 border-y border-rule-2 bg-surface">
        {GUEST_PRICED_PROVIDERS.map(p => {
          const checked = p.id in selection;
          const cost = resolveEffectiveMonthlyCost(p.id, settings, now);
          const estimated = checked && isEstimatedMonthlyCost(p.id, settings, now);
          return (
            <li key={p.id} className={`grid ${ROW_COLUMNS} items-center gap-x-3 gap-y-1 px-3 py-2 text-sm`}>
              <label className="flex items-center gap-2 min-w-0 cursor-pointer">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(p.id)}
                  className="accent-acc-deep"
                />
                <span className={checked ? 'text-ink font-medium' : 'text-ink-2'}>{p.name}</span>
              </label>
              {p.tiers && p.tiers.length > 0 && (
                <select
                  aria-label={`Nivå för ${p.name}`}
                  value={selection[p.id] ?? ''}
                  onChange={e => chooseTier(p.id, e.target.value)}
                  className="select col-span-2 row-start-2 sm:col-span-1 sm:row-start-1 sm:col-start-2 w-full min-w-0"
                >
                  <option value="">Vet inte</option>
                  {p.tiers.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.kind === 'sport' ? `${t.name} (sport)` : t.name}
                    </option>
                  ))}
                </select>
              )}
              <span className="col-start-2 row-start-1 sm:col-start-3 flex flex-col items-end tabular-nums">
                <span className={checked ? 'font-semibold text-ink' : 'text-ink-3'}>
                  {cost == null ? '–' : `${formatKr(cost)} kr`}
                </span>
                {estimated && <span className="text-xxs text-ink-3">uppskattat</span>}
              </span>
            </li>
          );
        })}
      </ul>

      {FREE_NAMES.length > 0 && (
        <p className="text-xs text-ink-3 mt-2">
          {joinNames(FREE_NAMES)} är gratis och står inte med.
        </p>
      )}

      {result.bundle && (
        <div className="mt-4">
          <GuestBundleBox suggestion={result.bundle} estimated={result.bundleEstimated} />
        </div>
      )}

      <p className="text-sm mt-4">
        <Link href="/streamingpriser/" className="text-ink-2 underline">
          Se alla priser och prisändringar
        </Link>
      </p>

      <div
        data-testid="cost-bar"
        className={cardClass('sticky bottom-0 max-[980px]:bottom-[calc(64px_+_env(safe-area-inset-bottom,0px))] z-20 mt-6 px-3 py-2.5 flex flex-wrap items-center justify-between gap-3')}
      >
        <div className="flex-1 min-w-[12rem] max-w-[360px]" aria-live="polite">
          {result.paidCount > 0 ? (
            // The rows above are the receipt's lines, so the bar shows the total only.
            <MoneyFigure monthlyKr={result.totalKr} estimated={result.estimated} size="md" />
          ) : (
            <p className="text-sm text-ink-2 m-0">Kryssa i en tjänst för att se summan.</p>
          )}
        </div>
        {uid ? (
          <Link href="/settings/" className={buttonClass({ variant: 'ghost', size: 'sm' })}>
            Ändra dina tjänster
          </Link>
        ) : (
          <Button
            type="button"
            onClick={saveAndSignIn}
            disabled={result.paidCount === 0}
            variant="acc" size="sm" className="disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Logga in och spara
          </Button>
        )}
      </div>
    </div>
  );
}
