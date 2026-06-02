'use client';

import AuthGuard from '@/components/AuthGuard';
import { useAuth } from '@/hooks/useAuth';
import { PageHeader } from '@/components/layout/PageHeader';
import { TMDB_ATTRIBUTION_EN } from '@/lib/tmdb/attribution';
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
      <PageHeader
        crumb="Inställningar"
        title="Inställningar"
        standfirst="Profil, tjänster, smak-data, notiser, export och radering — allt på ett ställe."
      />

      <div className="mt-7">
        <ProfileSection />
        <UsernameSection />
        <ProvidersSection />
        <DisplaySection />
        <ContentFilterSection />
        <NotificationsSection />
        <TasteDataSection />
        <DataExportSection />
        <DeleteAccountSection />

        <div className="text-xxs text-ink-3 mt-4">{TMDB_ATTRIBUTION_EN}</div>
      </div>
    </>
  );
}
