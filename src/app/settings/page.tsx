'use client';

import AuthGuard from '@/components/AuthGuard';
import { useAuth } from '@/hooks/useAuth';
import { ProfileSection } from '@/components/settings/ProfileSection';
import { UsernameSection } from '@/components/settings/UsernameSection';
import { ProvidersSection } from '@/components/settings/ProvidersSection';
import { DisplaySection } from '@/components/settings/DisplaySection';
import { ContentFilterSection } from '@/components/settings/ContentFilterSection';
import { NotificationsSection } from '@/components/settings/NotificationsSection';
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
    <>
      <header>
        <div className="crumb">Inställningar</div>
        <h1 className="page-h1">Inställningar</h1>
        <p className="stand">
          Profil, tjänster, smak-data, notiser, export och radering — allt på ett ställe.
        </p>
      </header>

      <div style={{ marginTop: 28 }}>
        <ProfileSection />
      <UsernameSection />
      <ProvidersSection />
      <DisplaySection />
      <ContentFilterSection />
      <NotificationsSection />
      <TasteDataSection />
      <DataExportSection />
      <DeleteAccountSection />

        <div className="text-xxs text-text-muted mt-4">
          This product uses the TMDB API but is not endorsed or certified by TMDB.
        </div>
      </div>
    </>
  );
}
