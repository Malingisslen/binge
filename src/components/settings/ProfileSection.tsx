'use client';

import { useAuth } from '@/hooks/useAuth';
import { SettingsCard } from './SettingsCard';

export function ProfileSection() {
  const { user, signOut } = useAuth();
  if (!user) return null;

  return (
    <SettingsCard title="Profil">
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
    </SettingsCard>
  );
}
