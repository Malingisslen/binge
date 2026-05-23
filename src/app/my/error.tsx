'use client';

import { SegmentError } from '@/components/layout/SegmentError';

export default function MyError({
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
      scope="app:my"
      heading="Kunde inte ladda din lista"
      body="Försök igen om en stund. Om det upprepas — kontrollera anslutningen."
    />
  );
}
