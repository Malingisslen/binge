'use client';

import { SegmentError } from '@/components/layout/SegmentError';

export default function GruppError({
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
      scope="app:grupper"
      heading="Kunde inte ladda gruppen"
      body="Ett fel uppstod när vi läste gruppdatan. Om det upprepas — kontrollera att du fortfarande är medlem."
    />
  );
}
