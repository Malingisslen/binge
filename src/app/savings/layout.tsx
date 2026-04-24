import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Streamingrådgivaren',
  description: 'Få en lugn översikt över dina strömningsabonnemang, se vad du kan pausa och spara pengar varje månad.',
};

export default function SavingsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
