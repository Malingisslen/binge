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
  aggregateHouseholdSoon,
  applyHouseholdVote,
  buildHouseholdContribution,
  buildSoonProviderIds,
  composeHouseholdContribution,
  currentHouseholdVotes,
  householdContributionNeedsWrite,
  householdSoonNeedsRefresh,
  householdVoteMonthKey,
  type HouseholdBaseContent,
  type HouseholdContribution,
  type HouseholdSoonOverview,
  type HouseholdVote,
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
//
// ADR 0026: "nytt inom 30 dagar" skrivs bara när medlemmen tryckt Dela i den
// samtyckesvy som nämner det. En delare från före fältet ser needsReshare tills
// hen delar om; röster är ett eget, aktivt val och skrivs bara via setVote.

export type HouseholdStatus = 'loading' | 'gated' | 'active' | 'error';

export function useGroupHousehold(groupId: string): {
  status: HouseholdStatus;
  contributions: HouseholdContribution[];
  /** Dela, både första gången och vid omdelning: skriver bidraget med soon-flaggan. */
  optIn: () => Promise<void>;
  optOut: () => Promise<void>;
  busy: boolean;
  /** False medan payloaden byggs (watchlist/profil laddar) — gate:a Dela-knappen
   *  på detta så ett klick aldrig tyst no-op:ar (xhigh-review 2026-07-05). */
  ready: boolean;
  /** Delar, men delade innan "nytt inom 30 dagar" fanns i samtycket. */
  needsReshare: boolean;
  /** Mina röster den här månaden, kanoniska provider-id. */
  myVotes: Record<number, HouseholdVote>;
  /** "N av M har något nytt inom 30 dagar"; null tills hushållet är laddat. */
  soon: HouseholdSoonOverview | null;
  /** Sätt (eller ta bort med null) min röst på en tjänst. Ogiltiga värden skrivs aldrig. */
  setVote: (providerId: number, vote: HouseholdVote | null) => Promise<void>;
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

  const built = useMemo((): { base: HouseholdBaseContent; soon: number[] } | null => {
    if (!user || watchlistLoading) return null;
    return {
      base: buildHouseholdContribution(
        user.myProviders ?? [],
        user.providerCosts ?? {},
        user.providerTiers ?? {},
        user.providerCampaigns ?? {},
        items,
      ),
      soon: buildSoonProviderIds(items, new Date()),
    };
  }, [user, items, watchlistLoading]);

  const own = useMemo(
    () => (uid && contributions ? contributions.find(c => c.uid === uid) : undefined),
    [contributions, uid],
  );
  // Röster läses ur senaste kända egna bidrag, även före nästa snapshot, så två snabba
  // röster inte skriver över varandra.
  const ownRef = useRef<HouseholdContribution | undefined>(undefined);
  useEffect(() => { ownRef.current = own; }, [own]);
  const voteChain = useRef<Promise<void>>(Promise.resolve());

  const optIn = useCallback(async () => {
    if (!uid || !built) return;
    setBusy(true);
    try {
      const content = composeHouseholdContribution(built.base, ownRef.current, {
        monthKey: householdVoteMonthKey(new Date()),
        soon: built.soon,
        optInSoon: true,
      });
      await setHouseholdContribution(groupId, uid, content);
      setEpoch(e => e + 1);
    } finally {
      setBusy(false);
    }
  }, [groupId, uid, built]);

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

  const setVote = useCallback((providerId: number, vote: HouseholdVote | null): Promise<void> => {
    const run = async () => {
      const current = ownRef.current;
      // Rösta kräver ett eget bidrag (share-to-see) och en byggd payload: hela bidraget
      // skrivs om i samma setDoc så updatedAt förblir en sann färskhetsstämpel.
      if (!uid || !built || !current) return;
      // Röster visas med namn, vilket bara den nya samtyckestexten säger: en äldre delare
      // får inte rösta förrän hen delat igen.
      if (current.soonProviderIds === undefined) return;
      const monthKey = householdVoteMonthKey(new Date());
      const composed = composeHouseholdContribution(built.base, current, { monthKey, soon: built.soon });
      const next = applyHouseholdVote(composed, monthKey, providerId, vote);
      if (!next) return;
      if (!householdContributionNeedsWrite(next, current, monthKey)) return;
      await setHouseholdContribution(groupId, uid, next);
      ownRef.current = { ...current, ...next, votes: next.votes, votesMonth: next.votesMonth };
    };
    const p = voteChain.current.then(run, run);
    voteChain.current = p.catch(() => {});
    return p;
  }, [groupId, uid, built]);

  // Visit-refresh med dirty-check — en write per besök, bara vid verklig diff.
  const refreshedThisVisit = useRef(false);
  useEffect(() => {
    if (!uid || !built || !own || refreshedThisVisit.current) return;
    const now = new Date();
    const monthKey = householdVoteMonthKey(now);
    const next = composeHouseholdContribution(built.base, own, { monthKey, soon: built.soon });
    if (!householdContributionNeedsWrite(next, own, monthKey) && !householdSoonNeedsRefresh(own, now.getTime())) return;
    refreshedThisVisit.current = true;
    setHouseholdContribution(groupId, uid, next).catch(() => {});
  }, [uid, groupId, built, own]);

  const status: HouseholdStatus = failed
    ? 'error'
    : denied
      ? 'gated'
      : contributions == null
        ? 'loading'
        : 'active';

  const myVotes = useMemo(
    () => (own ? Object.fromEntries(currentHouseholdVotes(own, householdVoteMonthKey(new Date()))) : {}),
    [own],
  );
  const soon = useMemo(
    () => (status === 'active' && contributions ? aggregateHouseholdSoon(contributions, new Date()) : null),
    [status, contributions],
  );

  return {
    status,
    contributions: contributions ?? [],
    optIn,
    optOut,
    busy,
    ready: built != null,
    needsReshare: status === 'active' && own != null && own.soonProviderIds === undefined,
    myVotes,
    soon,
    setVote,
  };
}
