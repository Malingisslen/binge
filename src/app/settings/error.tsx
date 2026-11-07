'use client';

import { SegmentError } from '@/components/layout/SegmentError';

export default function SettingsError({
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
      scope="app:settings"
      heading="Kunde inte ladda inställningarna"
      body="Dina val är inte borttagna. Försök igen om en stund, eller kontrollera anslutningen."
    />
  );
}
