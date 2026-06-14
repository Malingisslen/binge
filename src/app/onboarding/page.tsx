'use client';

import dynamic from 'next/dynamic';
import AuthGuard from '@/components/AuthGuard';

const OnboardingFlow = dynamic(
  () => import('@/components/onboarding/OnboardingFlow').then(m => m.OnboardingFlow),
  { ssr: false },
);

export default function OnboardingPage() {
  return (
    <AuthGuard>
      <OnboardingFlow />
    </AuthGuard>
  );
}
