'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { getProvider } from '@/lib/tmdb/providers';
import { computeGuestCost } from '@/lib/advisor/guestCost';
import { loadGuestSelection, saveGuestSelection, type GuestSelection } from '@/lib/guestProviders';
import { trackEvent } from '@/lib/analytics';
import GuestBundleBox from '@/components/pricing/GuestBundleBox';
import MoneyFigure from '@/components/ui/MoneyFigure';
import { cardClass } from '@/components/ui/Card';

// Startsidans gästdemo (Malins val 3B). Monteras bara i den gren av HomePageClient
// där auth löst till utloggad — aldrig i den förrenderade auth-laddningsgrenen och
// aldrig för inloggade.
//
// Valet delar sessionStorage-nyckel med kalkylatorn, så "Visa mer" öppnar den med
// samma tjänster ikryssade. Har besökaren redan valt fler tjänster där ingår de i
// summan här också.

export const DEMO_PROVIDER_IDS = [8, 384, 337, 76, 489, 119] as const;

export default function GuestCostDemo() {
  const [selection, setSelection] = useState<GuestSelection>({});
  const [now] = useState(() => new Date());
  const totalTracked = useRef(false);

  useEffect(() => {
    setSelection(loadGuestSelection());
  }, []);

  const toggle = (id: number) => {
    const next = { ...selection };
    if (id in next) delete next[id];
    else next[id] = null;
    setSelection(next);
    saveGuestSelection(next);
  };

  const result = useMemo(() => computeGuestCost(selection, now), [selection, now]);

  useEffect(() => {
    if (result.paidCount > 0 && !totalTracked.current) {
      totalTracked.current = true;
      trackEvent('price_check_total_shown', { surface: 'home', paidCount: result.paidCount });
    }
  }, [result.paidCount]);

  return (
    <section className="max-w-[1000px] mx-auto px-4 pt-8" aria-labelledby="guest-cost-heading">
      <div className={cardClass('px-4 py-3')}>
        <h2 id="guest-cost-heading" className="text-xl font-semibold text-ink m-0">
          Vad betalar du för streaming?
        </h2>
        <p className="text-sm text-ink-2 mt-1 mb-3">Tryck på dem du har.</p>
        <div className="flex flex-wrap gap-2">
          {DEMO_PROVIDER_IDS.map(id => {
            const p = getProvider(id);
            if (!p) return null;
            const on = id in selection;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(id)}
                className={`px-3 py-[6px] text-sm rounded border cursor-pointer ${
                  on ? 'border-acc-deep bg-acc-soft text-ink font-medium' : 'border-rule bg-surface text-ink-2'
                }`}
              >
                {p.name}
              </button>
            );
          })}
          <Link
            href="/streamingkostnad/"
            className="px-3 py-[6px] text-sm rounded border border-rule text-ink-2 no-underline"
          >
            Fler
          </Link>
        </div>

        {result.paidCount > 0 && (
          <div className="mt-3 flex flex-col gap-2">
            <div aria-live="polite" className="max-w-[360px]">
              <MoneyFigure monthlyKr={result.totalKr} estimated={result.estimated} lines={result.lines} />
            </div>
            {result.bundle && (
              <GuestBundleBox suggestion={result.bundle} estimated={result.bundleEstimated} compact />
            )}
            <Link href="/streamingkostnad/" className="text-sm text-ink-2 underline self-start">
              Visa mer
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}

