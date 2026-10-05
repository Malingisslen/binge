import type { Metadata } from 'next';
import { PageHeader } from '@/components/layout/PageHeader';
import CostCalculator from '@/components/pricing/CostCalculator';

export const dynamic = 'force-static';

// Kalkylatorn (Malins val 1A, 2026-10-05). Indexerbar och i sitemapen. Rubriken och
// introtexten — med "listpris, kan avvika" — står i den statiska HTML:en (#26:s
// villkor 3, #28:s villkor 12); listan och summan är klientkomponenten.

const URL = 'https://binge.nu/streamingkostnad/';
const TITLE = 'Vad kostar din streaming? Räkna ut din månadskostnad';
const DESCRIPTION =
  'Kryssa i streamingtjänsterna du betalar för och se vad de kostar per månad och per år, med ordinarie svenska listpriser. Se om ett paket blir billigare.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: URL },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: URL,
    siteName: 'Binge.nu',
    locale: 'sv_SE',
    type: 'website',
  },
};

export default function StreamingkostnadPage() {
  return (
    <div>
      <PageHeader
        crumb="Kalkylator"
        title="Vad kostar din streaming?"
        standfirst="Kryssa i det du betalar för. Ordinarie priser (listpris, kan avvika)."
      />
      <CostCalculator />
    </div>
  );
}
