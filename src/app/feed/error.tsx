'use client';

import { SegmentError } from '@/components/layout/SegmentError';

export default function FeedError({
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
      scope="app:feed"
      heading="Kunde inte ladda flödet"
      body="Försök igen eller ladda om sidan."
    />
  );
}
