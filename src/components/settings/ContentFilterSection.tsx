'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/contexts/ToastContext';
import { COUNTRIES, COMMON_FILTER_COUNTRIES, getCountryName } from '@/lib/tmdb/countries';
import { SettingsSection } from './SettingsSection';

export function ContentFilterSection() {
  const { user, updateHideNonLatinTitles, updateHiddenCountries } = useAuth();
  const { show: toast } = useToast();
  const [countrySearch, setCountrySearch] = useState('');

  const hiddenSet = useMemo(
    () => new Set(user?.hiddenCountries ?? []),
    [user?.hiddenCountries],
  );

  const remainingCountries = useMemo(() => {
    const commonSet = new Set(COMMON_FILTER_COUNTRIES);
    let list = COUNTRIES.filter(c => !commonSet.has(c.code));
    if (countrySearch) {
      const q = countrySearch.toLowerCase();
      list = list.filter(c => c.name.toLowerCase().includes(q));
    }
    return list;
  }, [countrySearch]);

  if (!user) return null;

  // BIN-308: vänta in skrivningen innan "sparad"-toast; visa fel-toast om den
  // misslyckas (annars ser användaren "dolt" trots tappad skrivning).
  const toggleCountry = async (code: string) => {
    const wasHidden = hiddenSet.has(code);
    const next = wasHidden
      ? user.hiddenCountries.filter(c => c !== code)
      : [...user.hiddenCountries, code];
    try {
      await updateHiddenCountries(next);
      toast(wasHidden ? `${getCountryName(code)} visas igen` : `${getCountryName(code)} dolt`);
    } catch {
      toast('Kunde inte spara. Försök igen om en stund.');
    }
  };

  return (
    <SettingsSection title="Innehållsfilter" collapsible defaultOpen={false}>
      <label className="flex items-center gap-2 cursor-pointer text-base">
          <input
            type="checkbox"
            checked={user.hideNonLatinTitles}
            onChange={async e => {
              const checked = e.target.checked;
              try {
                await updateHideNonLatinTitles(checked);
                toast(checked ? 'Filter aktiverat' : 'Filter avaktiverat');
              } catch { toast('Kunde inte spara. Försök igen om en stund.'); }
            }}
            className="accent-acc-deep w-[14px] h-[14px]"
          />
          Dölj titlar med icke-latinska alfabet
        </label>
        <p className="text-xs text-ink-3 mt-1 ml-[22px] mb-3">
          Filtrerar bort titlar på t.ex. koreanska, ryska eller thailändska från utforska och rekommendationer.
        </p>

        <div className="text-xs font-semibold text-ink-2 mb-[6px]">Dölj innehåll från länder</div>
        <p className="text-xs text-ink-3 mb-2">
          Filtrera bort filmer och serier från specifika länder i utforska, trender och rekommendationer.
        </p>

        <div className="grid grid-cols-3 gap-x-2 gap-y-[2px] mb-2">
          {COMMON_FILTER_COUNTRIES.map(code => (
            <label key={code} className="flex items-center gap-[6px] cursor-pointer text-base py-[2px]">
              <input
                type="checkbox"
                checked={hiddenSet.has(code)}
                onChange={() => void toggleCountry(code)}
                className="accent-acc-deep w-[14px] h-[14px]"
              />
              {getCountryName(code)}
            </label>
          ))}
        </div>

        <div className="border-t border-rule-2 pt-2">
          <div className="flex items-center gap-[5px] px-2 py-[3px] bg-bg border border-rule rounded-sm mb-[6px]">
            <Search size={12} className="text-ink-3 shrink-0" />
            <input
              type="text"
              placeholder="Sök land…"
              value={countrySearch}
              onChange={e => setCountrySearch(e.target.value)}
              className="bg-transparent border-none text-ink text-xs font-[inherit] outline-none w-full placeholder:text-ink-3"
            />
          </div>
          <div className="max-h-[200px] overflow-y-auto space-y-[1px]">
            {remainingCountries.map(c => (
              <label key={c.code} className="flex items-center gap-[6px] cursor-pointer text-base py-[2px]">
                <input
                  type="checkbox"
                  checked={hiddenSet.has(c.code)}
                  onChange={() => void toggleCountry(c.code)}
                  className="accent-acc-deep w-[14px] h-[14px]"
                />
                {c.name}
              </label>
            ))}
            {remainingCountries.length === 0 && (
              <div className="text-xs text-ink-3 py-1">Inga träffar.</div>
            )}
          </div>
        </div>

      {user.hiddenCountries.length > 0 && (
        <div className="mt-2 pt-2 border-t border-rule-2 text-xs text-ink-3">
          {user.hiddenCountries.length} {user.hiddenCountries.length === 1 ? 'land dolt' : 'länder dolda'}
        </div>
      )}
    </SettingsSection>
  );
}
