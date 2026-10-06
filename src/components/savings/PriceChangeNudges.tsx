'use client';

import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import ProviderDot from '@/components/ui/ProviderDot';
import { useAuth } from '@/hooks/useAuth';
import { computePriceChangeNudges, priceChangeText } from '@/lib/advisor/priceChangeNudges';

// Prisvakten (paket L): "din tjänst ändrar pris" i Rådgivaren, samma kortform som
// CampaignExpiryNudges. Ett 'noticed'-datum får aldrig läsas som "från och med" —
// det är dagen Binge såg priset, inte dagen det började gälla.

const DISMISSED_KEY = 'binge:priceChangeDismissed';

function readDismissed(): string[] {
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

function writeDismissed(keys: string[]) {
  try {
    window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(keys));
  } catch {
    // Privat läge eller blockerad lagring: raden kommer tillbaka vid nästa besök.
  }
}

export default function PriceChangeNudges() {
  const { user } = useAuth();
  const now = useMemo(() => new Date(), []);
  // localStorage läses efter mount, så serverrenderingen och första klientrenderingen
  // är lika.
  const [dismissed, setDismissed] = useState<string[] | null>(null);
  useEffect(() => setDismissed(readDismissed()), []);

  const rows = useMemo(
    () =>
      computePriceChangeNudges(
        {
          myProviders: user?.myProviders,
          providerTiers: user?.providerTiers,
          providerPauses: user?.providerPauses,
        },
        now,
      ),
    [user?.myProviders, user?.providerTiers, user?.providerPauses, now],
  );

  if (dismissed === null) return null;
  const visible = rows.filter(r => !dismissed.includes(r.key));
  if (visible.length === 0) return null;

  const dismiss = (key: string) => {
    const next = [...dismissed, key];
    setDismissed(next);
    writeDismissed(next);
  };

  return (
    <div className="mb-4 space-y-2">
      {visible.map(r => {
        const text = priceChangeText(r);
        return (
          <div
            key={r.key}
            className="flex items-start gap-2 bg-surface border border-rule border-l-[3px] border-l-acc-deep rounded-sm px-3 py-2 text-xs"
          >
            <span className="mt-[5px]"><ProviderDot color={r.color} size={7} /></span>
            <div className="min-w-0 flex-1">
              <p className="text-ink">{text.lead}</p>
              <p className="text-ink-3 mt-[2px]">
                {text.note}{' '}
                <a
                  href={r.change.source.split(' ')[0]}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-acc-deep"
                >
                  Källa
                </a>
              </p>
            </div>
            <button
              type="button"
              onClick={() => dismiss(r.key)}
              aria-label="Dölj"
              className="shrink-0 bg-transparent border-none p-1 text-ink-3 hover:text-ink cursor-pointer"
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
