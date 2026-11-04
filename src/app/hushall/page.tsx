'use client';

import AuthGuard from '@/components/AuthGuard';
import HouseholdPageClient from '@/components/pages/HouseholdPageClient';

export default function HouseholdPage() {
  return <AuthGuard><HouseholdPageClient /></AuthGuard>;
}
