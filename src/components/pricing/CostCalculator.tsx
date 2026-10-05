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

// /streamingkostnad/ — den interaktiva delen. Rubriken och introtexten renderas av
// sidans serverkomponent så att de står i den statiska HTML:en.
//
// Valet läses ur sessionStorage först efter montering: servern har ingen lagring,
// och en förifylld första rendering hade inte matchat den statiska HTML:en.

// Gratis- och reklamtjänsterna har ingen rad; de nämns på en rad under listan.
const FREE_NAMES = SWEDISH_PROVIDERS
  .filter(p => p.type === 'flatrate' && (p.isFree || p.isAds))
  .map(p => p.name);

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
      <ul className="divide-y divide-rule-2 border-y border-rule-2 bg-surface">
        {GUEST_PRICED_PROVIDERS.map(p => {
          const checked = p.id in selection;
          const cost = resolveEffectiveMonthlyCost(p.id, settings, now);
          const estimated = checked && isEstimatedMonthlyCost(p.id, settings, now);
          return (
            <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
              <label className="flex items-center gap-2 flex-1 min-w-[9rem] cursor-pointer">
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
                  className="text-xs border border-rule rounded-sm bg-surface text-ink px-1 py-[3px] max-w-[13rem]"
                >
                  <option value="">Vet inte</option>
                  {p.tiers.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.kind === 'sport' ? `${t.name} (sport)` : t.name}
                    </option>
                  ))}
                </select>
              )}
              <span className="flex flex-col items-end w-[5.5rem] shrink-0 tabular-nums">
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
        className="sticky bottom-0 max-[980px]:bottom-[calc(64px_+_env(safe-area-inset-bottom,0px))] z-20 mt-6 bg-surface border border-rule rounded-sm px-3 py-[10px] flex flex-wrap items-center justify-between gap-3"
      >
        <p className="text-sm text-ink m-0 tabular-nums" aria-live="polite">
          {result.paidCount > 0 ? (
            <>
              <strong>{formatKr(result.totalKr)} kr per månad</strong>
              {' · '}
              {formatKr(result.yearlyKr)} kr per år
              {result.estimated && <span className="text-ink-3"> · uppskattat</span>}
            </>
          ) : (
            <span className="text-ink-2">Kryssa i en tjänst för att se summan.</span>
          )}
        </p>
        {uid ? (
          <Link href="/settings/" className="btn btn-ghost btn-sm">
            Ändra dina tjänster
          </Link>
        ) : (
          <button
            type="button"
            onClick={saveAndSignIn}
            disabled={result.paidCount === 0}
            className="btn btn-acc btn-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Logga in och spara
          </button>
        )}
      </div>
    </div>
  );
}
