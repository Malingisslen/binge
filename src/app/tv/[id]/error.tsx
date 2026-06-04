'use client';

import { SegmentError } from '@/components/layout/SegmentError';

export default function TVError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <SegmentError
      error={error}
      reset={reset}
      scope="app:tv"
      heading="Kunde inte ladda serien"
      body="Något gick fel när serien skulle laddas. Försök igen om en stund."
    />
  );
}
