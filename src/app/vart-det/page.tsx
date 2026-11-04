import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LATEST_VART_DET_MONTH } from '@/lib/seo/vartDet';

export const dynamic = 'force-static';

// The bare address has no content of its own; the month page is the canonical one.
export const metadata: Metadata = { robots: { index: false, follow: true } };

export default function VartDetIndexPage() {
  redirect(`/vart-det/${LATEST_VART_DET_MONTH}/`);
}
