'use client';

import { useEffect, useState } from 'react';
import {
  subscribeToSession,
  subscribeToParticipants,
  subscribeToSwipes,
} from '@/lib/firebase/sessions';
import { isSessionExpired } from '@/lib/sessionTiming';
import type { SessionParticipant, SessionSwipe, TogetherSession } from '@/types';

// Re-export för existerande callers (useMySessions imports från useSession).
export { isSessionExpired } from '@/lib/sessionTiming';

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

  const expired = isSessionExpired(session);

  return { session, participants, swipes, loading, notFound, expired };
}

const STORAGE_PREFIX = 'binge-session-pid-';
const MY_SESSIONS_KEY = 'binge-my-sessions';
const MAX_TRACKED = 20;

export function getStoredParticipantId(sessionId: string): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(STORAGE_PREFIX + sessionId);
}

export function storeParticipantId(sessionId: string, pid: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_PREFIX + sessionId, pid);
  const list = getTrackedSessions().filter(s => s.sessionId !== sessionId);
  list.unshift({ sessionId, participantId: pid, joinedAt: Date.now() });
  localStorage.setItem(MY_SESSIONS_KEY, JSON.stringify(list.slice(0, MAX_TRACKED)));
}

export function clearStoredParticipantId(sessionId: string): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_PREFIX + sessionId);
  const list = getTrackedSessions().filter(s => s.sessionId !== sessionId);
  localStorage.setItem(MY_SESSIONS_KEY, JSON.stringify(list));
}

export interface TrackedSession {
  sessionId: string;
  participantId: string;
  joinedAt: number;
}

export function getTrackedSessions(): TrackedSession[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(MY_SESSIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TrackedSession[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
