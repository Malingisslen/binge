import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Integritetspolicy',
  description: 'Så hanterar Binge.nu dina personuppgifter enligt GDPR.',
};

export default function IntegritetLayout({ children }: { children: React.ReactNode }) {
  return children;
}
