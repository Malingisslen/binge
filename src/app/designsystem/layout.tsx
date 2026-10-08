import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Designsystemet',
  // A working page for the team, not for search: noindex, outside the sitemap and the menus.
  robots: { index: false, follow: false },
};

export default function DesignsystemLayout({ children }: { children: React.ReactNode }) {
  return children;
}
