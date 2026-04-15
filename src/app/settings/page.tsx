'use client';

import { useState, useMemo } from 'react';
import { Search, ChevronDown, ChevronUp } from 'lucide-react';
import AuthGuard from '@/components/AuthGuard';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/contexts/ToastContext';
import { SWEDISH_PROVIDERS } from '@/lib/tmdb/providers';
import { COUNTRIES, COMMON_FILTER_COUNTRIES, getCountryName } from '@/lib/tmdb/countries';

export default function SettingsPage() {
  return <AuthGuard><SettingsContent /></AuthGuard>;
}

function SettingsContent() {
  const { user, signOut, updateProviders, updateDefaultView, updateProviderCosts, updateHideNonLatinTitles, updateHiddenCountries } = useAuth();
  const { show: toast } = useToast();

  const flatrateProviders = SWEDISH_PROVIDERS.filter(p => p.type === 'flatrate');

  if (!user) return null;

  return (
    <div>
      <h1 className="text-[18px] font-bold text-text-primary mb-3">Inställningar</h1>

      <div className="bg-surface border border-border-main rounded-sm mb-[14px]">
        <div className="px-3 py-[6px] border-b border-border-light">
          <span className="text-sm font-bold text-text-secondary">Profil</span>
        </div>
        <div className="px-3 py-2">
          <div className="text-base">
            <span className="text-text-muted text-xs mr-2">Namn:</span>
            {user.displayName}
          </div>
          <div className="text-base mt-1">
            <span className="text-text-muted text-xs mr-2">E-post:</span>
            {user.email}
          </div>
          <button
            onClick={signOut}
            className="mt-3 px-3 py-[3px] border border-border-main rounded-sm text-xs font-[inherit] cursor-pointer bg-surface text-text-secondary hover:bg-surface-hover"
          >
            Logga ut
          </button>
        </div>
      </div>

      <UsernameSection />

      <CollapsibleSection title="Mina streamingtjänster" defaultOpen={user.myProviders.length === 0}>
          <p className="text-xs text-text-muted mb-2">
            Välj vilka tjänster du prenumererar på. Dessa markeras i hela appen.
          </p>
          <div className="space-y-[2px]">
            {flatrateProviders.map(provider => {
              const isSelected = user.myProviders.includes(provider.id);
              return (
                <div key={provider.id} className="flex items-center gap-2 py-[3px]">
                  <label className="flex items-center gap-2 cursor-pointer text-base flex-1">
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
                      className="w-[8px] h-[8px] rounded-full inline-block"
                      style={{ background: provider.color }}
                    />
                    {provider.name}
                  </label>
                  {isSelected && (
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

      <div className="bg-surface border border-border-main rounded-sm mb-[14px]">
        <div className="px-3 py-[6px] border-b border-border-light">
          <span className="text-sm font-bold text-text-secondary">Visning</span>
        </div>
        <div className="px-3 py-2">
          <p className="text-xs text-text-muted mb-2">Standardvy för listor.</p>
          <div className="flex gap-2">
            {(['table', 'grid'] as const).map(v => (
              <button
                key={v}
                onClick={() => { updateDefaultView(v); toast('Inställning sparad'); }}
                className={`px-3 py-[3px] border rounded-sm text-xs font-[inherit] cursor-pointer ${
                  user.defaultView === v
                    ? 'bg-accent text-white border-accent'
                    : 'bg-surface text-text-secondary border-border-main hover:bg-surface-hover'
                }`}
              >
                {v === 'table' ? 'Tabell' : 'Rutnät'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <ContentFilterSection
        user={user}
        updateHideNonLatinTitles={updateHideNonLatinTitles}
        updateHiddenCountries={updateHiddenCountries}
        toast={toast}
      />

      <DeleteAccountSection />

      <div className="text-xxs text-text-muted mt-4">
        This product uses the TMDB API but is not endorsed or certified by TMDB.
      </div>
    </div>
  );
}

function UsernameSection() {
  const { user, updateUsername, updateBio, updateIsPublic } = useAuth();
  const { show: toast } = useToast();
  const [usernameInput, setUsernameInput] = useState(user?.username ?? '');
  const [bioInput, setBioInput] = useState(user?.bio ?? '');
  const [saving, setSaving] = useState(false);

  if (!user) return null;

  const handleSaveUsername = async () => {
    const { validateUsername, isUsernameAvailable } = await import('@/lib/firebase/username');
    const error = validateUsername(usernameInput);
    if (error) { toast(error); return; }
    if (usernameInput === user.username) return;
    const available = await isUsernameAvailable(usernameInput);
    if (!available) { toast('Användarnamnet är redan taget'); return; }
    setSaving(true);
    try {
      await updateUsername(usernameInput);
      toast('Användarnamn sparat');
    } catch { toast('Något gick fel'); }
    setSaving(false);
  };

  return (
    <div className="bg-surface border border-border-main rounded-sm mb-[14px]">
      <div className="px-3 py-[6px] border-b border-border-light">
        <span className="text-sm font-bold text-text-secondary">Publik profil</span>
      </div>
      <div className="px-3 py-2 space-y-2">
        <div>
          <label className="text-xs text-text-muted block mb-[2px]">Användarnamn</label>
          <div className="flex gap-2">
            <input
              value={usernameInput}
              onChange={e => setUsernameInput(e.target.value.toLowerCase())}
              placeholder="filmnerden"
              maxLength={20}
              className="flex-1 px-2 py-[3px] text-xs border border-border-main rounded-sm bg-surface text-text-primary font-[inherit] outline-none"
            />
            <button
              onClick={handleSaveUsername}
              disabled={saving || usernameInput === (user.username ?? '')}
              className="px-3 py-[3px] border-none rounded-sm text-xs font-[inherit] cursor-pointer bg-accent text-white disabled:opacity-50"
            >
              Spara
            </button>
          </div>
          {user.username && (
            <div className="text-xxs text-text-muted mt-[2px]">binge.nu/user/{user.username}</div>
          )}
        </div>
        <div>
          <label className="text-xs text-text-muted block mb-[2px]">Bio</label>
          <textarea
            value={bioInput}
            onChange={e => setBioInput(e.target.value)}
            onBlur={() => { if (bioInput !== user.bio) { updateBio(bioInput); toast('Bio sparad'); } }}
            placeholder="Berätta lite om dig..."
            maxLength={160}
            rows={2}
            className="w-full px-2 py-1 text-xs border border-border-main rounded-sm bg-surface text-text-primary font-[inherit] resize-none outline-none"
          />
        </div>
        <label className="flex items-center gap-2 cursor-pointer text-base">
          <input
            type="checkbox"
            checked={user.isPublic}
            onChange={e => { updateIsPublic(e.target.checked); toast(e.target.checked ? 'Profil publik' : 'Profil privat'); }}
            className="accent-accent w-[14px] h-[14px]"
          />
          Visa min profil publikt
        </label>
      </div>
    </div>
  );
}

function ContentFilterSection({
  user,
  updateHideNonLatinTitles,
  updateHiddenCountries,
  toast,
}: {
  user: import('@/types').UserProfile;
  updateHideNonLatinTitles: (hide: boolean) => void;
  updateHiddenCountries: (countries: string[]) => void;
  toast: (msg: string) => void;
}) {
  const [countrySearch, setCountrySearch] = useState('');
  const hiddenSet = useMemo(() => new Set(user.hiddenCountries), [user.hiddenCountries]);

  const toggleCountry = (code: string) => {
    const next = hiddenSet.has(code)
      ? user.hiddenCountries.filter(c => c !== code)
      : [...user.hiddenCountries, code];
    updateHiddenCountries(next);
    toast(hiddenSet.has(code)
      ? `${getCountryName(code)} visas igen`
      : `${getCountryName(code)} dolt`);
  };

  const remainingCountries = useMemo(() => {
    const commonSet = new Set(COMMON_FILTER_COUNTRIES);
    let list = COUNTRIES.filter(c => !commonSet.has(c.code));
    if (countrySearch) {
      const q = countrySearch.toLowerCase();
      list = list.filter(c => c.name.toLowerCase().includes(q));
    }
    return list;
  }, [countrySearch]);

  return (
    <div className="bg-surface border border-border-main rounded-sm mb-[14px]">
      <div className="px-3 py-[6px] border-b border-border-light">
        <span className="text-sm font-bold text-text-secondary">Innehållsfilter</span>
      </div>
      <div className="px-3 py-2">
        <label className="flex items-center gap-2 cursor-pointer text-base">
          <input
            type="checkbox"
            checked={user.hideNonLatinTitles}
            onChange={e => { updateHideNonLatinTitles(e.target.checked); toast(e.target.checked ? 'Filter aktiverat' : 'Filter avaktiverat'); }}
            className="accent-accent w-[14px] h-[14px]"
          />
          Dölj titlar med icke-latinska alfabet
        </label>
        <p className="text-xs text-text-muted mt-1 ml-[22px] mb-3">
          Filtrerar bort titlar på t.ex. koreanska, ryska eller thailändska från utforska och rekommendationer.
        </p>

        <div className="text-xs font-semibold text-text-secondary mb-[6px]">Dölj innehåll från länder</div>
        <p className="text-xs text-text-muted mb-2">
          Filtrera bort filmer och serier från specifika länder i utforska, trender och rekommendationer.
        </p>

        <div className="grid grid-cols-3 gap-x-2 gap-y-[2px] mb-2">
          {COMMON_FILTER_COUNTRIES.map(code => (
            <label key={code} className="flex items-center gap-[6px] cursor-pointer text-base py-[2px]">
              <input
                type="checkbox"
                checked={hiddenSet.has(code)}
                onChange={() => toggleCountry(code)}
                className="accent-accent w-[14px] h-[14px]"
              />
              {getCountryName(code)}
            </label>
          ))}
        </div>

        <div className="border-t border-border-light pt-2">
          <div className="flex items-center gap-[5px] px-2 py-[3px] bg-page border border-border-main rounded-sm mb-[6px]">
            <Search size={12} className="text-text-muted shrink-0" />
            <input
              type="text"
              placeholder="Sök land..."
              value={countrySearch}
              onChange={e => setCountrySearch(e.target.value)}
              className="bg-transparent border-none text-text-primary text-xs font-[inherit] outline-none w-full placeholder:text-text-muted"
            />
          </div>
          <div className="max-h-[200px] overflow-y-auto space-y-[1px]">
            {remainingCountries.map(c => (
              <label key={c.code} className="flex items-center gap-[6px] cursor-pointer text-base py-[2px]">
                <input
                  type="checkbox"
                  checked={hiddenSet.has(c.code)}
                  onChange={() => toggleCountry(c.code)}
                  className="accent-accent w-[14px] h-[14px]"
                />
                {c.name}
              </label>
            ))}
            {remainingCountries.length === 0 && (
              <div className="text-xs text-text-muted py-1">Inga träffar</div>
            )}
          </div>
        </div>

        {user.hiddenCountries.length > 0 && (
          <div className="mt-2 pt-2 border-t border-border-light text-xs text-text-muted">
            {user.hiddenCountries.length} {user.hiddenCountries.length === 1 ? 'land dolt' : 'länder dolda'}
          </div>
        )}
      </div>
    </div>
  );
}

function DeleteAccountSection() {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { deleteAccount } = useAuth();
  const { show: toast } = useToast();

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteAccount();
    } catch (err: unknown) {
      const msg = err instanceof Error && err.message.includes('requires-recent-login')
        ? 'Du måste logga in igen innan du kan ta bort ditt konto.'
        : 'Något gick fel. Försök igen.';
      toast(msg);
      setDeleting(false);
      setConfirming(false);
    }
  };

  return (
    <div className="bg-surface border border-red-200 rounded-sm mb-[14px]">
      <div className="px-3 py-[6px] border-b border-red-100">
        <span className="text-sm font-bold text-red-600">Ta bort konto</span>
      </div>
      <div className="px-3 py-2">
        <p className="text-xs text-text-muted mb-2">
          All data raderas permanent — watchlist, betyg, avsnittsprogress och inställningar.
        </p>
        {!confirming ? (
          <button
            onClick={() => setConfirming(true)}
            className="px-3 py-[3px] border border-red-300 rounded-sm text-xs font-[inherit] cursor-pointer bg-surface text-red-600 hover:bg-red-50"
          >
            Ta bort mitt konto
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="px-3 py-[3px] border-none rounded-sm text-xs font-[inherit] cursor-pointer bg-red-600 text-white disabled:opacity-50"
            >
              {deleting ? 'Raderar...' : 'Ja, ta bort permanent'}
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="px-3 py-[3px] border border-border-main rounded-sm text-xs font-[inherit] cursor-pointer bg-surface text-text-secondary"
            >
              Avbryt
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function CollapsibleSection({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-surface border border-border-main rounded-sm mb-[14px]">
      <div
        className="flex items-center justify-between px-3 py-[6px] border-b border-border-light cursor-pointer hover:bg-surface-hover/50"
        onClick={() => setOpen(!open)}
      >
        <span className="text-sm font-bold text-text-secondary">{title}</span>
        {open ? <ChevronUp size={14} className="text-text-muted" /> : <ChevronDown size={14} className="text-text-muted" />}
      </div>
      {open && <div className="px-3 py-2">{children}</div>}
    </div>
  );
}
