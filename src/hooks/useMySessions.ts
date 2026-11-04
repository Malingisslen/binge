'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { getTrackedSessions, clearStoredParticipantId, isSessionExpired, type TrackedSession } from '@/hooks/useSession';
import {
  listHostedSessions,
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
  const { uid } = useAuth();
  const [local, setLocal] = useState<TrackedSession[]>([]);
  const [hosted, setHosted] = useState<TrackedSession[]>([]);
  const [sessions, setSessions] = useState<Record<string, TogetherSession | null>>({});
  const [swipes, setSwipes] = useState<Record<string, SessionSwipe[]>>({});

  // Load tracked list on mount (client-only).
  useEffect(() => {
    setLocal(getTrackedSessions());
  }, []);

  // Värdens deltagar-id är uid:t (createSession), så en värd kan hitta sina egna
  // pågående sessioner även utan lokal spårning, t.ex. på en ny enhet.
  useEffect(() => {
    if (!uid) { setHosted([]); return; }
    let cancelled = false;
    listHostedSessions(uid)
      .then(list => {
        if (cancelled) return;
        setHosted(list
          .filter(s => s.status === 'active' && !isSessionExpired(s))
          .map(s => ({ sessionId: s.id, participantId: uid, joinedAt: s.createdAt.getTime() })));
      })
      .catch(() => { if (!cancelled) setHosted([]); });
    return () => { cancelled = true; };
  }, [uid]);

  const tracked = useMemo(() => {
    const seen = new Set(local.map(t => t.sessionId));
    return [...local, ...hosted.filter(h => !seen.has(h.sessionId))];
  }, [local, hosted]);

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
