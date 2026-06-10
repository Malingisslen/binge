'use client';

import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { useState, useEffect, type ReactNode } from 'react';
import { LoadingView } from '@/components/ui/LoadingView';

export default function AuthGuard({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  if (!mounted || loading) {
    // X2/G6: designad loading-state — AuthGuard är första synliga tillstånd
    // på varje inloggad sida, så bar "Laddar…"-text syntes överallt.
    return <LoadingView label="Laddar…" />;
  }

  if (!user) {
    return null;
  }

  return <>{children}</>;
}
