import type { Metadata } from 'next';
import InsikterClient from './InsikterClient';

// Real static route (not the catch-all): set noindex explicitly in the prerendered
// HTML head so the internal dashboard is never indexed even before hydration.
export const metadata: Metadata = {
  title: 'Insikter (internt) — Binge',
  robots: { index: false, follow: false },
};

export default function InsikterPage() {
  return <InsikterClient />;
}
