'use client';

import { SegmentError } from '@/components/layout/SegmentError';

export default function SearchError({
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
      scope="app:search"
      heading="Sökningen misslyckades"
      body="Sökningen gick inte fram. Försök med en annan sökterm eller vänta en stund."
    />
  );
}
