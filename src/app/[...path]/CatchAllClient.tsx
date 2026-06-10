'use client';

import Link from 'next/link';
import DynamicRouter from '@/components/pages/DynamicRouter';
import { NotFound } from '@/components/ui/NotFound';

export default function CatchAllClient() {
  return (
    <DynamicRouter
      fallback={
        // B11: okända URL:er ska få den designade 404-vyn, inte rå text.
        <NotFound
          crumb="404"
          title="Sidan hittades inte"
          body="Länken kan vara felaktig eller så har sidan flyttats."
          action={<Link href="/" className="btn btn-acc btn-sm no-underline">Till startsidan</Link>}
        />
      }
    />
  );
}
