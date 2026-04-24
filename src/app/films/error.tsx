'use client';

import { SegmentError } from '@/components/layout/SegmentError';

export default function FilmsError({
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
      scope="app:films"
      heading="Kunde inte ladda filmen"
      body="TMDB svarade inte som förväntat. Försök igen om en stund."
    />
  );
}
