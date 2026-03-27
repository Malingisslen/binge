'use client';

import AuthGuard from '@/components/AuthGuard';
import { useAuth } from '@/hooks/useAuth';
import { SWEDISH_PROVIDERS } from '@/lib/tmdb/providers';

export default function SettingsPage() {
  return <AuthGuard><SettingsContent /></AuthGuard>;
}

function SettingsContent() {
  const { user, signOut, updateProviders } = useAuth();

  const flatrateProviders = SWEDISH_PROVIDERS.filter(p => p.type === 'flatrate');

  if (!user) return null;

  return (
    <div>
      <h1 className="text-md font-bold text-text-primary mb-3">Inställningar</h1>

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

      <div className="bg-surface border border-border-main rounded-sm mb-[14px]">
        <div className="px-3 py-[6px] border-b border-border-light">
          <span className="text-sm font-bold text-text-secondary">Mina streamingtjänster</span>
        </div>
        <div className="px-3 py-2">
          <p className="text-xs text-text-muted mb-2">
            Välj vilka tjänster du prenumererar på. Dessa markeras i hela appen.
          </p>
          <div className="space-y-[2px]">
            {flatrateProviders.map(provider => {
              const isSelected = user.myProviders.includes(provider.id);
              return (
                <label key={provider.id} className="flex items-center gap-2 py-[3px] cursor-pointer text-base">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => {
                      const updated = isSelected
                        ? user.myProviders.filter(id => id !== provider.id)
                        : [...user.myProviders, provider.id];
                      updateProviders(updated);
                    }}
                    className="accent-accent w-[14px] h-[14px]"
                  />
                  <span
                    className="w-[8px] h-[8px] rounded-full inline-block"
                    style={{ background: provider.color }}
                  />
                  {provider.name}
                </label>
              );
            })}
          </div>
        </div>
      </div>

      <div className="text-xxs text-text-muted mt-4">
        This product uses the TMDB API but is not endorsed or certified by TMDB.
      </div>
    </div>
  );
}
