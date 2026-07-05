'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useWatchlist } from '@/hooks/useWatchlist';
import {
  deleteHouseholdContribution,
  setHouseholdContribution,
  subscribeToGroupHousehold,
} from '@/lib/firebase/groups';
import {
  buildHouseholdContribution,
  contributionContentEquals,
  type HouseholdContribution,
} from '@/lib/advisor/householdAggregate';

// BIN-184 — Hushålls-state för en grupp. Opt-in-status härleds ur Firestore-
// reglernas share-to-see-gate (ADR 0010): en icke-delande medlem får
// permission-denied på household-collectionen → 'gated'. Ingen separat
// opt-in-flagga behöver persisteras eller hållas i sync.
//
// Visit-refresh (DBA-krav): när panelen är aktiv och det egna bidraget avviker
// från det aktuella innehållet (kostnad ändrad, backlog flyttad) skrivs det om
// — EN gång per besök, alltid dirty-checkat, aldrig medan watchlisten laddar
// (annars skulle en tom items-array skriva bort verklig aktivitetsdata).

export type HouseholdStatus = 'loading' | 'gated' | 'active' | 'error';

export function useGroupHousehold(groupId: string): {
  status: HouseholdStatus;
  contributions: HouseholdContribution[];
  optIn: () => Promise<void>;
  optOut: () => Promise<void>;
  busy: boolean;
  /** False medan payloaden byggs (watchlist/profil laddar) — gate:a Dela-knappen
   *  på detta så ett klick aldrig tyst no-op:ar (xhigh-review 2026-07-05). */
  ready: boolean;
} {
  const { uid, user } = useAuth();
  const { items, loading: watchlistLoading } = useWatchlist();
  const [contributions, setContributions] = useState<HouseholdContribution[] | null>(null);
  const [denied, setDenied] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  // Bump för att riva + återstarta prenumerationen efter opt-in/opt-out
  // (rules-utfallet ändras av skrivningen, inte av något snapshot-event).
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    if (!uid) return;
    setDenied(false);
    setFailed(false);
    setContributions(null);
    return subscribeToGroupHousehold(
      groupId,
      cs => setContributions(cs),
      () => setDenied(true), // permission-denied = inte opt-in (share-to-see)
      () => setFailed(true), // annat fel = visa felläge, ALDRIG opt-in-gaten
    );
  }, [groupId, uid, epoch]);

  const ownContent = useMemo(() => {
    if (!user || watchlistLoading) return null;
    return buildHouseholdContribution(
      user.myProviders ?? [],
      user.providerCosts ?? {},
      user.providerTiers ?? {},
      user.providerCampaigns ?? {},
      items,
    );
  }, [user, items, watchlistLoading]);

  const optIn = useCallback(async () => {
    if (!uid || !ownContent) return;
    setBusy(true);
    try {
      await setHouseholdContribution(groupId, uid, ownContent);
      setEpoch(e => e + 1);
    } finally {
      setBusy(false);
    }
  }, [groupId, uid, ownContent]);

  const optOut = useCallback(async () => {
    if (!uid) return;
    setBusy(true);
    try {
      await deleteHouseholdContribution(groupId, uid);
      setContributions(null);
      setEpoch(e => e + 1);
    } finally {
      setBusy(false);
    }
  }, [groupId, uid]);

  // Visit-refresh med dirty-check — en write per besök, bara vid verklig diff.
  const refreshedThisVisit = useRef(false);
  useEffect(() => {
    if (!uid || !ownContent || !contributions || refreshedThisVisit.current) return;
    const own = contributions.find(c => c.uid === uid);
    if (!own || contributionContentEquals(ownContent, own)) return;
    refreshedThisVisit.current = true;
    setHouseholdContribution(groupId, uid, ownContent).catch(() => {});
  }, [uid, groupId, ownContent, contributions]);

  const status: HouseholdStatus = failed
    ? 'error'
    : denied
      ? 'gated'
      : contributions == null
        ? 'loading'
        : 'active';
  return { status, contributions: contributions ?? [], optIn, optOut, busy, ready: ownContent != null };
}
