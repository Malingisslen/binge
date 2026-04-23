import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Inställningar',
  description: 'Hantera dina strömningstjänster, kostnader, smak-kalibrering och kontoinställningar.',
  robots: { index: false, follow: false },
};

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
