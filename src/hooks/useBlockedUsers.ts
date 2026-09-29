'use client';

import { useCallback, useEffect, useState } from 'react';
import { fsdb, lazySubscribe } from '@/lib/firebase/db';
import { useAuth } from '@/hooks/useAuth';
import { blockUserAndEndFriendship } from '@/lib/firebase/friends';

/**
 * Block-system för UGC-moderering.
 *
 * Data-model: `users/{uid}/blocked/{targetUid}` — en subcollection som
 * lyssnas upp med onSnapshot så blockeringar märks direkt i UI.
 *
 * Filtrering sker klient-side i review/feed/follow-listor eftersom vi
 * inte vill att Firestore ska behöva joina block-data i varje query.
 * Det är en hygien-nivå som räcker för v1 — inte en säkerhetsgräns.
 * En hård gräns kräver server-side filter, vilket vi gör när vi flyttar
 * review-läsning till en Cloud Function.
 *
 * Returnerar:
 * - blockedUids: Set<string> — snabb lookup
 * - isBlocked(uid): helper
 * - blockUser(uid): skapar blockdoc och avslutar vänskapen (BIN-1349)
 * - unblockUser(uid): tar bort blockdoc
 */
export function useBlockedUsers() {
  const { uid } = useAuth();
  const [blockedUids, setBlockedUids] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!uid) {
      setBlockedUids(new Set());
      return;
    }
    return lazySubscribe(({ db, collection, onSnapshot }) =>
      onSnapshot(collection(db, 'users', uid, 'blocked'), snap => {
        setBlockedUids(new Set(snap.docs.map(d => d.id)));
      }));
  }, [uid]);

  const isBlocked = useCallback(
    (targetUid: string) => blockedUids.has(targetUid),
    [blockedUids],
  );

  // BIN-1349: blockeringen avslutar också vänskapen — se blockUserAndEndFriendship.
  const blockUser = useCallback(
    async (targetUid: string): Promise<{ endedFriendship: boolean }> => {
      if (!uid || targetUid === uid) return { endedFriendship: false };
      return blockUserAndEndFriendship(uid, targetUid);
    },
    [uid],
  );

  const unblockUser = useCallback(
    async (targetUid: string) => {
      if (!uid) return;
      const { db, doc, deleteDoc } = await fsdb();
      await deleteDoc(doc(db, 'users', uid, 'blocked', targetUid));
    },
    [uid],
  );

  return { blockedUids, isBlocked, blockUser, unblockUser };
}
