'use client';

import { useAuth } from '@/hooks/useAuth';
import { SettingsSection } from './SettingsSection';

export function ProfileSection() {
  const { user, signOut } = useAuth();
  if (!user) return null;

  return (
    <SettingsSection title="Profil">
      <div className="text-base">
        <span className="text-ink-3 text-xs mr-2">Namn:</span>
        {user.displayName}
      </div>
      <div className="text-base mt-1">
        <span className="text-ink-3 text-xs mr-2">E-post:</span>
        {user.email}
      </div>
      <button onClick={signOut} className="btn btn-ghost btn-sm mt-3">
        Logga ut
      </button>
    </SettingsSection>
  );
}
