'use client';

import AuthGuard from '@/components/AuthGuard';
import { useAuth } from '@/hooks/useAuth';
import { ProfileSection } from '@/components/settings/ProfileSection';
import { UsernameSection } from '@/components/settings/UsernameSection';
import { ProvidersSection } from '@/components/settings/ProvidersSection';
import { DisplaySection } from '@/components/settings/DisplaySection';
import { ContentFilterSection } from '@/components/settings/ContentFilterSection';
import { TasteDataSection } from '@/components/settings/TasteDataSection';
import { DataExportSection } from '@/components/settings/DataExportSection';
import { DeleteAccountSection } from '@/components/settings/DeleteAccountSection';

export default function SettingsPage() {
  return <AuthGuard><SettingsContent /></AuthGuard>;
}

function SettingsContent() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <div>
      <h1 className="text-[18px] font-bold text-text-primary mb-3">Inställningar</h1>

      <ProfileSection />
      <UsernameSection />
      <ProvidersSection />
      <DisplaySection />
      <ContentFilterSection />
      <TasteDataSection />
      <DataExportSection />
      <DeleteAccountSection />

      <div className="text-xxs text-text-muted mt-4">
        This product uses the TMDB API but is not endorsed or certified by TMDB.
      </div>
    </div>
  );
}
