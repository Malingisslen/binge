import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Kom igång',
  description: 'Sätt upp ditt Binge-konto på 60 sekunder — välj streamingtjänster och lägg till din första titel.',
  robots: { index: false, follow: false },
};

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
