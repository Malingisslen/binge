'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/contexts/ToastContext';
import { SWEDISH_PROVIDERS, canonicalProviderId, type SwedishProvider } from '@/lib/tmdb/providers';
import { useDebouncedCommit } from '@/hooks/useDebouncedCommit';
import { isValidBillingDay, daysUntilRenewal } from '@/lib/renewal';
import { trackEvent } from '@/lib/analytics';
import { SettingsSection } from './SettingsSection';
import {
  readableTextColor,
  splitProviders,
  totalMonthlyCost,
} from './ProvidersSection.helpers';

const FLATRATE = SWEDISH_PROVIDERS.filter(p => p.type === 'flatrate');

export function ProvidersSection() {
  const { user, updateProviders, setProviderCost, setProviderRenewalDay, updateProviderTier } = useAuth();
  const { show: toast } = useToast();

  const savedProviders = useMemo(() => user?.myProviders ?? [], [user?.myProviders]);
  const [selected, setSelected] = useState<number[]>(savedProviders);
  const [pendingSave, setPendingSave] = useState(false);
  const addMoreRef = useRef<HTMLDivElement>(null);

  // Debounced commit of the (expensive, group-cascading) provider set.
  const { schedule } = useDebouncedCommit<number[]>(async (ids) => {
    try {
      await updateProviders(ids);
      trackEvent('providers_selected', { count: ids.length });
    } finally {
      setPendingSave(false);
    }
  }, 700);

  // Keep local state in sync if myProviders changes elsewhere (other tab, onboarding).
  useEffect(() => { setSelected(savedProviders); }, [savedProviders]);

  if (!user) return null;

  const toggle = (providerId: number) => {
    const canon = canonicalProviderId(providerId);
    const has = selected.some(id => canonicalProviderId(id) === canon);
    const next = has
      ? selected.filter(id => canonicalProviderId(id) !== canon)
      : [...selected, providerId];
    setSelected(next);
    setPendingSave(true);
    schedule(next);
  };

  const { selected: selectedProviders, available } = splitProviders(FLATRATE, selected);
  const total = totalMonthlyCost(selected, user.providerCosts ?? {});

  const tile = (p: SwedishProvider, isSelected: boolean) => {
    const fg = readableTextColor(p.color);
    return (
      <button
        key={p.id}
        type="button"
        aria-pressed={isSelected}
        onClick={() => toggle(p.id)}
        className="relative h-[46px] rounded-md flex items-center justify-center text-center text-[12px] font-bold px-2 transition-colors"
        style={
          isSelected
            ? { background: p.color, color: fg === 'white' ? 'white' : 'var(--ink)' }
            : { border: `1.5px solid ${p.color}`, color: 'var(--ink)' }
        }
      >
        {p.shortName}
        {isSelected && <span aria-hidden="true" className="absolute top-1 right-1.5 text-[10px]">✓</span>}
      </button>
    );
  };

  return (
    <SettingsSection title="Mina streamingtjänster" collapsible defaultOpen={savedProviders.length === 0}>
      {selectedProviders.length > 0 ? (
        <>
          <div className="text-[10px] uppercase tracking-[0.14em] text-ink-3 mb-2">
            Dina tjänster · {selectedProviders.length}
          </div>
          <div className="grid grid-cols-4 gap-[7px] mb-4">
            {selectedProviders.map(p => tile(p, true))}
            {available.length > 0 && (
              <button
                type="button"
                aria-label="Lägg till fler tjänster"
                onClick={() => addMoreRef.current?.scrollIntoView({ behavior: 'smooth' })}
                className="h-[46px] rounded-md flex items-center justify-center border-[1.5px] border-dashed border-rule text-ink-3 text-[20px] leading-none transition-colors hover:border-ink-3 hover:text-ink"
              >
                +
              </button>
            )}
          </div>
        </>
      ) : (
        <p className="text-xs text-ink-3 mb-3">
          Välj tjänsterna du prenumererar på — de markeras i hela appen.
        </p>
      )}

      {available.length > 0 && (
        <div ref={addMoreRef}>
          <div className="text-[10px] uppercase tracking-[0.14em] text-ink-3 mb-2">Lägg till fler</div>
          <div className="grid grid-cols-4 gap-[7px] mb-4">
            {available.map(p => tile(p, false))}
          </div>
        </div>
      )}

      {selectedProviders.length > 0 && (
        <div className="border-t border-rule-2 pt-3">
          <div className="text-[10px] uppercase tracking-[0.14em] text-ink-3 mb-2">Nivå &amp; kostnad</div>
          <div className="space-y-[2px]">
            {selectedProviders.map(provider => {
              const selectedTierId = user.providerTiers?.[provider.id];
              const hasTiers = (provider.tiers?.length ?? 0) > 0;
              const isCustom = hasTiers && !selectedTierId;
              const fg = readableTextColor(provider.color);
              const renewalDay = user.providerRenewalDays?.[provider.id];
              return (
                <div key={provider.id} className="flex items-center gap-[10px] py-[3px]">
                  <span
                    className="rounded-sm px-2 py-[1px] text-[11px] font-semibold min-w-[54px] text-center"
                    style={{ background: provider.color, color: fg === 'white' ? 'white' : 'var(--ink)' }}
                  >
                    {provider.shortName}
                  </span>
                  <span className="flex-1 text-[11px] text-ink-3">
                    {renewalDay != null ? `förnyas om ${daysUntilRenewal(renewalDay, new Date())} d` : ''}
                  </span>
                  {hasTiers ? (
                    <select
                      value={selectedTierId ?? ''}
                      onChange={e => {
                        const val = e.target.value;
                        updateProviderTier(provider.id, val === '' ? null : val);
                        toast('Prenumeration uppdaterad');
                      }}
                      className="px-1 py-[1px] text-xs border border-rule rounded-sm bg-surface text-ink font-[inherit] outline-none max-w-[180px]"
                    >
                      <option value="">Egen kostnad…</option>
                      {provider.tiers!.map(t => (
                        <option key={t.id} value={t.id}>{t.name} — {t.cost} kr</option>
                      ))}
                    </select>
                  ) : null}
                  {(!hasTiers || isCustom) && (
                    <input
                      type="number"
                      min="0"
                      step="1"
                      placeholder="kr/mån"
                      defaultValue={user.providerCosts?.[provider.id] ?? ''}
                      onBlur={e => {
                        const val = parseInt(e.target.value, 10);
                        const cost = isNaN(val) || val <= 0 ? null : val;
                        // Funktionell merge mot senaste state (inte render-snapshot)
                        // + felhantering — annars tappas en kostnad tyst om man
                        // tabbar vidare, eller om skrivningen failar offline.
                        setProviderCost(provider.id, cost).catch(() =>
                          toast('Kunde inte spara kostnaden. Försök igen om en stund.'),
                        );
                      }}
                      className="w-[70px] px-1 py-[1px] text-xs border border-rule rounded-sm bg-surface text-ink font-[inherit] outline-none text-right"
                    />
                  )}
                  <input
                    type="number"
                    min="1"
                    max="28"
                    step="1"
                    placeholder="dag"
                    aria-label={`Faktureringsdag för ${provider.name} (1–28)`}
                    title="Faktureringsdag i månaden (1–28) — för förnyelse-nedräkning"
                    defaultValue={renewalDay ?? ''}
                    onBlur={e => {
                      const val = parseInt(e.target.value, 10);
                      const day = isValidBillingDay(val) ? val : null;
                      // Samma härdning som kostnaden: funktionell merge + felhantering.
                      setProviderRenewalDay(provider.id, day).catch(() =>
                        toast('Kunde inte spara förnyelsedagen. Försök igen om en stund.'),
                      );
                    }}
                    className="w-[48px] px-1 py-[1px] text-xs border border-rule rounded-sm bg-surface text-ink font-[inherit] outline-none text-right"
                  />
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between mt-3 border-t border-rule-2 pt-[10px]">
            <span className="text-[11px] text-ink-3">
              {pendingSave ? 'Sparar…' : '✓ Sparat automatiskt'}
            </span>
            <span className="text-[13px] font-bold tabular-nums">{total} kr/mån</span>
          </div>
        </div>
      )}
    </SettingsSection>
  );
}
