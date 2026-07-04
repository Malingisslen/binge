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
  const { user, updateProviders, setProviderCost, setProviderRenewalDay, updateProviderTier, setProviderCampaign } = useAuth();
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
  const total = totalMonthlyCost(selected, user.providerCosts ?? {}, user.providerTiers ?? {}, user.providerCampaigns ?? {});

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
          <p className="text-[11px] text-ink-3 mb-2 leading-snug">
            Väljer du en nivå följer priset tjänstens aktuella listpris — det uppdateras automatiskt när tjänsten
            ändrar sitt. Väljer du <span className="whitespace-nowrap">&quot;Egen kostnad…&quot;</span> gäller beloppet du själv skriver in.
          </p>
          <div className="space-y-[2px]">
            {selectedProviders.map(provider => {
              const selectedTierId = user.providerTiers?.[provider.id];
              const hasTiers = (provider.tiers?.length ?? 0) > 0;
              const isCustom = hasTiers && !selectedTierId;
              const fg = readableTextColor(provider.color);
              const renewalDay = user.providerRenewalDays?.[provider.id];
              return (
                <div key={provider.id}>
                <div className="flex items-center gap-[10px] py-[3px]">
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
                      className="select max-w-[180px]"
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
                <ProviderCampaignRow
                  campaign={user.providerCampaigns?.[provider.id]}
                  onSave={(c) => setProviderCampaign(provider.id, c)
                    .then(() => toast('Kampanjpris sparat'))
                    .catch(() => toast('Kunde inte spara kampanjen. Försök igen.'))}
                  onClear={() => setProviderCampaign(provider.id, null)
                    .then(() => toast('Kampanjpris borttaget'))
                    .catch(() => toast('Kunde inte ta bort kampanjen.'))}
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

// BIN-417 — per-provider tidsbegränsad kampanj. Sparar RÅTT { monthlyCost, endDate }
// (aldrig ett resolvat pris); resolveEffectiveMonthlyCost auto-återgår till
// ordinariepriset efter slutdatumet. type="date" ger alltid YYYY-MM-DD.
type Campaign = { monthlyCost: number; endDate: string };

function ProviderCampaignRow({
  campaign,
  onSave,
  onClear,
}: {
  campaign: Campaign | undefined;
  onSave: (c: Campaign) => Promise<void> | void;
  onClear: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cost, setCost] = useState('');
  const [endDate, setEndDate] = useState('');

  const startEdit = () => {
    setCost(campaign?.monthlyCost != null ? String(campaign.monthlyCost) : '');
    setEndDate(campaign?.endDate ?? '');
    setEditing(true);
  };

  const parsedCost = parseInt(cost, 10);
  const valid = !isNaN(parsedCost) && parsedCost > 0 && /^\d{4}-\d{2}-\d{2}$/.test(endDate);

  const save = async () => {
    if (!valid || saving) return;
    // Await the write before leaving edit mode: user.providerCampaigns (the view
    // row's source) only updates after Firestore round-trips, so flipping early
    // would flash the pre-edit value. onSave swallows its own errors (toast).
    setSaving(true);
    await onSave({ monthlyCost: parsedCost, endDate });
    setSaving(false);
    setEditing(false);
  };

  if (!editing) {
    return (
      <div className="flex items-center gap-2 pl-[64px] pb-[4px] text-[11px]">
        {campaign ? (
          <>
            <span className="text-ink-3">
              Kampanj:{' '}
              <span className="text-ink font-semibold tabular-nums">{campaign.monthlyCost} kr</span>{' '}
              t.o.m. {campaign.endDate}
            </span>
            <button type="button" onClick={startEdit} className="text-acc-deep bg-transparent border-none p-0 cursor-pointer">Ändra</button>
            <button type="button" onClick={onClear} className="text-ink-3 bg-transparent border-none p-0 cursor-pointer">Ta bort</button>
          </>
        ) : (
          <button type="button" onClick={startEdit} className="text-ink-3 bg-transparent border-none p-0 cursor-pointer hover:text-acc-deep">
            + Lägg till kampanjpris
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 pl-[64px] pb-[5px] text-[11px] flex-wrap">
      <span className="text-ink-3">Kampanjpris</span>
      <input
        type="number"
        min="1"
        step="1"
        placeholder="kr/mån"
        value={cost}
        onChange={e => setCost(e.target.value)}
        aria-label="Kampanjpris per månad"
        className="w-[70px] px-1 py-[1px] text-xs border border-rule rounded-sm bg-surface text-ink font-[inherit] outline-none text-right"
      />
      <span className="text-ink-3">t.o.m.</span>
      <input
        type="date"
        value={endDate}
        onChange={e => setEndDate(e.target.value)}
        aria-label="Kampanjens slutdatum"
        className="px-1 py-[1px] text-xs border border-rule rounded-sm bg-surface text-ink font-[inherit] outline-none"
      />
      <button
        type="button"
        onClick={save}
        disabled={!valid || saving}
        className="text-acc-deep font-semibold bg-transparent border-none p-0 cursor-pointer disabled:text-ink-3 disabled:cursor-default"
      >
        {saving ? 'Sparar…' : 'Spara'}
      </button>
      <button type="button" onClick={() => setEditing(false)} disabled={saving} className="text-ink-3 bg-transparent border-none p-0 cursor-pointer disabled:opacity-50">Avbryt</button>
    </div>
  );
}
