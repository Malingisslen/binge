'use client';

import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { useState, useEffect, type ReactNode } from 'react';
import { LoadingView } from '@/components/ui/LoadingView';

export default function AuthGuard({ children }: { children: ReactNode }) {
  // Gatear på uid — inte user — eftersom profilen laddas parallellt med
  // auth-beskedet. Med user-gating skulle en inloggad användare redirectas
  // till /login under den RTT profilen tar att landa.
  const { uid, loading } = useAuth();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!loading && !uid) {
      router.push('/login');
    }
  }, [uid, loading, router]);

  if (!mounted || loading) {
    // X2/G6: designad loading-state — AuthGuard är första synliga tillstånd
    // på varje inloggad sida, så bar "Laddar…"-text syntes överallt.
    return <LoadingView label="Laddar…" />;
  }

  if (!uid) {
    return null;
  }

  return <>{children}</>;
}
