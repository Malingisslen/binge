'use client';

import { useStreamingLeaving } from '@/hooks/useStreamingLeaving';
import { leavingCoversMonth, leavingInMonth, parseVartDetMonth } from '@/lib/seo/vartDet';

// The leaving rollup is a Firestore document the build cannot read, so the count
// is filled in when the page opens; the page says so under the table. A failed
// read, or a rollup that does not reach the month's end, shows "–" rather than 0.
export default function VartDetLeavingCount({ providerId, monthId }: { providerId: number; monthId: string }) {
  const { entries, loading, error, today } = useStreamingLeaving(providerId);
  const month = parseVartDetMonth(monthId);
  if (loading || error || !month || !leavingCoversMonth(today, month)) return <>–</>;
  return <>{leavingInMonth(entries, month)}</>;
}
