'use client';

import { SegmentError } from '@/components/layout/SegmentError';

export default function CatchAllError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <SegmentError
      error={error}
      reset={reset}
      scope="app:dynamic"
      heading="Kunde inte ladda sidan"
      body="Något gick fel. Försök igen, eller gå tillbaka till startsidan."
    />
  );
}
