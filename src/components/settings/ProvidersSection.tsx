'use client';

import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/contexts/ToastContext';
import { SWEDISH_PROVIDERS } from '@/lib/tmdb/providers';
import { CollapsibleSection } from './CollapsibleSection';

/**
 * Stor sektion för att välja streamingtjänster, prenumerationsnivå och
 * kostnad per tjänst. Collapsible — default-öppen första gången (när
 * myProviders är tom).
 */
export function ProvidersSection() {
  const { user, updateProviders, updateProviderCosts, updateProviderTier } = useAuth();
  const { show: toast } = useToast();
  if (!user) return null;

  const flatrateProviders = SWEDISH_PROVIDERS.filter(p => p.type === 'flatrate');

  return (
    <CollapsibleSection title="Mina streamingtjänster" defaultOpen={user.myProviders.length === 0}>
      <p className="text-xs text-text-muted mb-2">
        Välj vilka tjänster du prenumererar på och vilken nivå. Dessa markeras i hela appen.
      </p>
      <div className="space-y-[2px]">
        {flatrateProviders.map(provider => {
          const isSelected = user.myProviders.includes(provider.id);
          const selectedTierId = user.providerTiers?.[provider.id];
          const hasTiers = (provider.tiers?.length ?? 0) > 0;
          const isCustom = isSelected && hasTiers && !selectedTierId;
          return (
            <div key={provider.id} className="flex items-center gap-2 py-[3px]">
              <label className="flex items-center gap-2 cursor-pointer text-base flex-1 min-w-0">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => {
                    const updated = isSelected
                      ? user.myProviders.filter(id => id !== provider.id)
                      : [...user.myProviders, provider.id];
                    updateProviders(updated);
                    toast('Tjänster uppdaterade');
                  }}
                  className="accent-accent w-[14px] h-[14px]"
                />
                <span
                  className="w-[8px] h-[8px] rounded-full inline-block shrink-0"
                  style={{ background: provider.color }}
                />
                <span className="truncate">{provider.name}</span>
              </label>
              {isSelected && hasTiers && (
                <select
                  value={selectedTierId ?? ''}
                  onChange={e => {
                    const val = e.target.value;
                    updateProviderTier(provider.id, val === '' ? null : val);
                    toast('Prenumeration uppdaterad');
                  }}
                  className="px-1 py-[1px] text-xs border border-border-main rounded-sm bg-surface text-text-primary font-[inherit] outline-none max-w-[160px]"
                >
                  <option value="">Egen kostnad…</option>
                  {provider.tiers!.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.name} — {t.cost} kr
                    </option>
                  ))}
                </select>
              )}
              {isSelected && (!hasTiers || isCustom) && (
                <input
                  type="number"
                  min="0"
                  step="1"
                  placeholder="kr/mån"
                  defaultValue={user.providerCosts?.[provider.id] ?? ''}
                  onBlur={e => {
                    const val = parseInt(e.target.value, 10);
                    const costs = { ...user.providerCosts };
                    if (isNaN(val) || val <= 0) delete costs[provider.id];
                    else costs[provider.id] = val;
                    updateProviderCosts(costs);
                  }}
                  className="w-[70px] px-1 py-[1px] text-xs border border-border-main rounded-sm bg-surface text-text-primary font-[inherit] outline-none text-right"
                />
              )}
              {isSelected && hasTiers && !isCustom && (
                <span className="w-[70px] text-right text-xs text-text-muted tabular-nums">
                  {user.providerCosts?.[provider.id] ?? 0} kr
                </span>
              )}
            </div>
          );
        })}
      </div>
      {Object.keys(user.providerCosts ?? {}).length > 0 && (
        <div className="mt-2 pt-2 border-t border-border-light">
          <div className="text-xs text-text-secondary font-semibold">
            Totalt: {Object.values(user.providerCosts).reduce((sum, v) => sum + v, 0)} kr/mån
          </div>
        </div>
      )}
    </CollapsibleSection>
  );
}
