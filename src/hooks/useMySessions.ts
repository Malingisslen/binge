'use client';

import { useEffect, useState } from 'react';
import { getTrackedSessions, clearStoredParticipantId, isSessionExpired, type TrackedSession } from '@/hooks/useSession';
import {
  subscribeToSession,
  subscribeToSwipes,
} from '@/lib/firebase/sessions';
import { indexSwipes } from '@/lib/together/matching';
import type { SessionSwipe, TogetherSession } from '@/types';

export interface MySessionSummary {
  sessionId: string;
  participantId: string;
  hostName: string;
  status: TogetherSession['status'];
  totalCandidates: number;
  pendingCount: number;
  updatedAt: Date;
}

export function useMySessions(): MySessionSummary[] {
  const [tracked, setTracked] = useState<TrackedSession[]>([]);
  const [sessions, setSessions] = useState<Record<string, TogetherSession | null>>({});
  const [swipes, setSwipes] = useState<Record<string, SessionSwipe[]>>({});

  // Load tracked list on mount (client-only).
  useEffect(() => {
    setTracked(getTrackedSessions());
  }, []);

  useEffect(() => {
    const unsubs: Array<() => void> = [];
    for (const t of tracked) {
      unsubs.push(subscribeToSession(t.sessionId, s => {
        setSessions(prev => ({ ...prev, [t.sessionId]: s }));
        if (s === null) {
          // Dokument raderat eller existerar inte — städa lokalt.
          clearStoredParticipantId(t.sessionId);
        }
      }));
      unsubs.push(subscribeToSwipes(t.sessionId, sw => {
        setSwipes(prev => ({ ...prev, [t.sessionId]: sw }));
      }));
    }
    return () => unsubs.forEach(fn => fn());
  }, [tracked]);

  return tracked
    .map(t => {
      const s = sessions[t.sessionId];
      if (!s || s.status !== 'active') return null;
      if (isSessionExpired(s)) return null;

      // Per medietyp, inte per nummer: en röstad film 42 dolde annars en
      // oröstad serie 42 ur "kvar att svepa"-räknaren. (BIN-569)
      const votesFor = indexSwipes(swipes[t.sessionId] ?? []);
      const pendingCount = s.candidates.filter(c => !votesFor(c)[t.participantId]).length;

      const summary: MySessionSummary = {
        sessionId: t.sessionId,
        participantId: t.participantId,
        hostName: s.hostName,
        status: s.status,
        totalCandidates: s.candidates.length,
        pendingCount,
        updatedAt: s.updatedAt,
      };
      return summary;
    })
    .filter((x): x is MySessionSummary => x !== null)
    .sort((a, b) => b.pendingCount - a.pendingCount || b.updatedAt.getTime() - a.updatedAt.getTime());
}
