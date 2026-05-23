'use client';

import { SegmentError } from '@/components/layout/SegmentError';

export default function SeriesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <SegmentError
      error={error}
      reset={reset}
      scope="app:series"
      heading="Kunde inte ladda serien"
      body="Kunde inte hämta seriedata. Försök igen om en stund."
    />
  );
}
