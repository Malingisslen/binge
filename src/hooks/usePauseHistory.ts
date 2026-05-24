'use client';

import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query, type DocumentData } from 'firebase/firestore';
import { useAuth } from './useAuth';
import { db } from '@/lib/firebase/config';

// Avslutade sparbeslut för Streamingrådgivarens "Sparat hittills"- och
// "Senaste sparbesluten"-block. Subcollectionen skrivs av resumeProvider
// (i AuthContext) varje gång användaren tar av en paus. Vi lyssnar realtid
// så sidebaren uppdateras direkt utan refresh.

export interface PauseHistoryEntry {
  id: string;
  providerId: number;
  providerShortName: string;
  pausedAt: string;          // ISO yyyy-mm-dd
  resumedAt: string;         // ISO yyyy-mm-dd
  monthlyCost: number;       // snapshot vid resume
  durationDays: number;
  savedAmount: number;       // round(cost * days / 30)
}

export interface UsePauseHistoryResult {
  history: PauseHistoryEntry[];
  totalSaved: number;
  isLoading: boolean;
}

export function usePauseHistory(): UsePauseHistoryResult {
  const { uid } = useAuth();
  const [history, setHistory] = useState<PauseHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!uid) {
      setHistory([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const ref = collection(db, 'users', uid, 'pauseHistory');
    // orderBy createdAt desc → nyast först. Listan trimmas av konsumenten
    // (sidebaren visar bara top 3).
    const q = query(ref, orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(
      q,
      snap => {
        const list: PauseHistoryEntry[] = snap.docs.map(d => {
          const data = d.data() as DocumentData;
          return {
            id: d.id,
            providerId: Number(data.providerId),
            providerShortName: String(data.providerShortName ?? ''),
            pausedAt: String(data.pausedAt ?? ''),
            resumedAt: String(data.resumedAt ?? ''),
            monthlyCost: Number(data.monthlyCost ?? 0),
            durationDays: Number(data.durationDays ?? 0),
            savedAmount: Number(data.savedAmount ?? 0),
          };
        });
        setHistory(list);
        setIsLoading(false);
      },
      err => {
        // Tysta loggar — vi har inget UI för fel här. Returnerar tom lista
        // så sidebaren bara visar "Inga sparbeslut än" istället för crash.
        console.error('usePauseHistory listen error', err);
        setHistory([]);
        setIsLoading(false);
      },
    );
    return () => unsub();
  }, [uid]);

  const totalSaved = history.reduce((sum, e) => sum + e.savedAmount, 0);
  return { history, totalSaved, isLoading };
}
