'use client';

import { useEffect, useState } from 'react';
import {
  subscribeToSession,
  subscribeToParticipants,
  subscribeToSwipes,
} from '@/lib/firebase/sessions';
import type { SessionParticipant, SessionSwipe, TogetherSession } from '@/types';

export function useSession(sessionId: string | null) {
  const [session, setSession] = useState<TogetherSession | null>(null);
  const [participants, setParticipants] = useState<SessionParticipant[]>([]);
  const [swipes, setSwipes] = useState<SessionSwipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!sessionId) { setLoading(false); return; }
    setLoading(true);
    setNotFound(false);

    const unsubs: Array<() => void> = [];
    let gotSession = false;

    unsubs.push(subscribeToSession(sessionId, s => {
      gotSession = true;
      setSession(s);
      if (!s) setNotFound(true);
      setLoading(false);
    }));
    unsubs.push(subscribeToParticipants(sessionId, setParticipants));
    unsubs.push(subscribeToSwipes(sessionId, setSwipes));

    // Timeout-baserad notFound om sessionen aldrig dyker upp
    const t = setTimeout(() => {
      if (!gotSession) { setLoading(false); setNotFound(true); }
    }, 5000);

    return () => {
      unsubs.forEach(fn => fn());
      clearTimeout(t);
    };
  }, [sessionId]);

  return { session, participants, swipes, loading, notFound };
}

const STORAGE_PREFIX = 'binge-session-pid-';

export function getStoredParticipantId(sessionId: string): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(STORAGE_PREFIX + sessionId);
}

export function storeParticipantId(sessionId: string, pid: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_PREFIX + sessionId, pid);
}

export function clearStoredParticipantId(sessionId: string): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_PREFIX + sessionId);
}
