'use client';

import { SegmentError } from '@/components/layout/SegmentError';

export default function MovieError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <SegmentError
      error={error}
      reset={reset}
      scope="app:movie"
      heading="Kunde inte ladda filmen"
      body="Något gick fel när filmen skulle laddas. Försök igen om en stund."
    />
  );
}
