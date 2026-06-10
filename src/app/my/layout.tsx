import type { Metadata } from 'next';

export const metadata: Metadata = {
  // Fallback för /my-segment utan egen layout-titel — undervyerna
  // (series/films/vill-se/avbrutna/all/lists/friends) sätter egna (X5/B16).
  // OBS: en ren sträng-titel här NOLLAR root-layoutens title.template för
  // alla undersegment (Next.js-mergeregel) — det var därför "Vänner" m.fl.
  // saknade "— Binge.nu"-suffixet. Template måste återanges explicit.
  title: { default: 'Bibliotek', template: '%s — Binge.nu' },
  description: 'Ditt bibliotek — Följer, Vill se, Sedda och Avbrutna.',
  // Privata sidor — indexera inte.
  robots: { index: false, follow: false },
};

export default function MyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
