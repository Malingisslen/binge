'use client';

import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { useState, useEffect, type ReactNode } from 'react';

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
    return <div className="text-sm text-text-muted py-4">Laddar…</div>;
  }

  if (!user) {
    return null;
  }

  return <>{children}</>;
}
