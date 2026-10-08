'use client';

import AuthGuard from '@/components/AuthGuard';
import { useAuth } from '@/hooks/useAuth';
import { usePageMeta } from '@/hooks/usePageMeta';
import { PageHeader } from '@/components/layout/PageHeader';
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
import { SettingsNav, type SettingsNavItem } from '@/components/settings/SettingsNav';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { buttonClass } from '@/components/ui/Button';

const SECTIONS: readonly SettingsNavItem[] = [
  { id: 'konto', label: 'Konto' },
  { id: 'tjanster', label: 'Tjänster och bibliotek' },
  { id: 'visning', label: 'Utseende' },
  { id: 'notiser', label: 'Notiser' },
  { id: 'data', label: 'Din data' },
  { id: 'radera', label: 'Ta bort konto', danger: true },
];

function Group({ id, visibleHeading = true, children }: { id: string; visibleHeading?: boolean; children: ReactNode }) {
  const label = SECTIONS.find(s => s.id === id)!.label;
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-28 mb-8 last:mb-0">
      <h2 id={`${id}-h`} className={visibleHeading ? 'text-xl font-bold text-ink mb-3 pb-2 border-b border-rule' : 'sr-only'}>
        {label}
      </h2>
      {children}
    </section>
  );
}

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
        standfirst="Konto, tjänster, utseende, notiser och din data."
      />

      <div className="mt-7 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-10">
        <SettingsNav items={SECTIONS} />
        <div className="min-w-0 max-w-3xl">
          <Group id="konto">
            <ProfileSection />
            <UsernameSection />
          </Group>
          <Group id="tjanster">
            <ProvidersSection />
            <BibliotekSection />
          </Group>
          <Group id="visning">
            <DisplaySection />
            <ContentFilterSection />
          </Group>
          <Group id="notiser" visibleHeading={false}>
            <NotificationsSection />
          </Group>
          <Group id="data">
            <TasteDataSection />
            <SettingsSection title="Importera">
              <p className="text-xs text-ink-3 mb-2">Ta med din historik från Letterboxd eller IMDb (CSV).</p>
              <Link href="/settings/import/" className={buttonClass({ variant: 'ghost', size: 'sm' })}>Importera från CSV</Link>
            </SettingsSection>
            <DataExportSection />
          </Group>
          <Group id="radera" visibleHeading={false}>
            <DeleteAccountSection />
          </Group>
        </div>
      </div>
    </>
  );
}
