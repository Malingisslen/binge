'use client';

import { SegmentError } from '@/components/layout/SegmentError';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <SegmentError error={error} reset={reset} scope="app:root" />;
}
