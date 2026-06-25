'use client';

import AuthGuard from '@/components/AuthGuard';
import { useAuth } from '@/hooks/useAuth';
import { usePageMeta } from '@/hooks/usePageMeta';
import { PageHeader } from '@/components/layout/PageHeader';
import { TMDB_ATTRIBUTION_EN } from '@/lib/tmdb/attribution';
import { ProfileSection } from '@/components/settings/ProfileSection';
import { UsernameSection } from '@/components/settings/UsernameSection';
import { ProvidersSection } from '@/components/settings/ProvidersSection';
import { BibliotekSection } from '@/components/settings/BibliotekSection';
import { DisplaySection } from '@/components/settings/DisplaySection';
import { ContentFilterSection } from '@/components/settings/ContentFilterSection';
import { NotificationsSection } from '@/components/settings/NotificationsSection';
import { TasteDataSection } from '@/components/settings/TasteDataSection';
import { DataExportSection } from '@/components/settings/DataExportSection';
import { DeleteAccountSection } from '@/components/settings/DeleteAccountSection';
import { SettingsSection } from '@/components/settings/SettingsSection';
import Link from 'next/link';

export default function SettingsPage() {
  return <AuthGuard><SettingsContent /></AuthGuard>;
}

function SettingsContent() {
  const { user } = useAuth();
  // X5/S2: dokumenttiteln blev generisk vid klient-navigering trots statisk
  // segment-metadata — sätt den klient-sidigt också.
  usePageMeta({ title: 'Inställningar' });
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
        <BibliotekSection />
        <DisplaySection />
        <ContentFilterSection />
        <NotificationsSection />
        <TasteDataSection />
        <SettingsSection title="Importera">
          <p className="text-xs text-ink-3 mb-2">Ta med din historik från Letterboxd eller IMDb (CSV).</p>
          <Link href="/settings/import/" className="btn btn-ghost btn-sm">Importera från CSV</Link>
        </SettingsSection>
        <DataExportSection />
        <DeleteAccountSection />

        <div className="text-xxs text-ink-3 mt-4">{TMDB_ATTRIBUTION_EN}</div>
      </div>
    </>
  );
}
