import Link from 'next/link';
import { PageHeader } from '@/components/layout/PageHeader';
import PriceTable from '@/components/pricing/PriceTable';
import PriceChangeLog from '@/components/pricing/PriceChangeLog';

export const dynamic = 'force-static';

// Prissidan (Malins val 2A, 2026-10-05). noindex via layout.tsx, utanför sitemapen,
// footern och /guider/ tills noindex lyfts (#26:s villkor 2 och 4).

export default function StreamingpriserPage() {
  return (
    <div>
      <PageHeader
        crumb="Priser"
        title="Streamingpriser i Sverige"
        standfirst="Ordinarie månadspris, inga kampanjer."
      />
      <p className="text-sm mt-3">
        <Link href="/streamingkostnad/" className="text-ink-2 underline">
          Räkna på dina tjänster
        </Link>
      </p>
      <PriceTable />
      <PriceChangeLog />
    </div>
  );
}
