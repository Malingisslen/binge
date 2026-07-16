'use client';

import { useQuery } from '@tanstack/react-query';
import { fsdb } from '@/lib/firebase/db';
import { getPublicProfileCard } from '@/lib/firebase/publicProfile';
import { useAuth } from '@/contexts/AuthContext';
import { useFollowing } from '@/hooks/useFollow';
import { useBlockedUsers } from '@/hooks/useBlockedUsers';

/**
 * BIN-97 — "vänner som sett detta" social proof.
 *
 * Bounded, cachad fan-out över de N personer man följer: läser deras
 * watchlist-item för titeln. Firestore-reglerna (firestore.rules:144-155)
 * släpper BARA igenom public-items (+ friends-tier vid ömsesidig vänskap) —
 * privata items OCH icke-existerande items ger permission-denied (reglerna
 * nekar läsning när resource==null). Promise.allSettled filtrerar därför
 * automatiskt ner till exakt de följda som har en publikt synlig post för
 * titeln. Ingen regeländring behövs; integritetsgränsen hålls server-side.
 *
 * Kostnadsdisciplin (25 SEK/mån-taket): hård cap på MAX_FANOUT följda, och
 * profil-läsning sker BARA för de som faktiskt har titeln (inte alla 30).
 * Per-titel-data persisteras aldrig (localStorage-taket), så varje besök
 * re-läser — därför cap + staleTime, inte obegränsad fan-out.
 */

const MAX_FANOUT = 30;

export interface FriendWhoSaw {
  uid: string;
  status: string;
  rating: number | null;
  displayName: string;
  username: string | null;
  photoURL: string | null;
}

export function useFriendsWhoSaw(tmdbId: number | null) {
  const { uid } = useAuth();
  const { followingUids } = useFollowing();
  const { blockedUids } = useBlockedUsers();
  // Exkludera blockerade följda — de ska inte dyka upp som "vänner som sett
  // detta" (integritet på UX-nivå; reglerna är säkerhetsgränsen). Sedan hård cap.
  const capped = followingUids.filter(u => !blockedUids.has(u)).slice(0, MAX_FANOUT);

  return useQuery({
    // capped.join(',') (inte array-referensen) → stabil nyckel, ingen refetch-
    // storm vid re-render eller snabb follow/unfollow-cykel.
    queryKey: ['friends-saw', tmdbId, capped.join(',')],
    enabled: !!uid && tmdbId != null && capped.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<FriendWhoSaw[]> => {
      if (tmdbId == null) return [];
      const { db, doc, getDoc } = await fsdb();
      const settled = await Promise.allSettled(
        capped.map(async (followedUid): Promise<FriendWhoSaw | null> => {
          const snap = await getDoc(doc(db, 'users', followedUid, 'watchlist', String(tmdbId)));
          if (!snap.exists()) return null;
          const data = snap.data() as { status?: string; rating?: number | null };
          // Profil-läsning först här — bara för de som faktiskt har titeln.
          // BIN-505: läs display-fält från publicProfiles-projektionen (jag följer
          // dem + titeln är läsbar → projektionen är läsbar). users/{uid} är
          // ägar-låst. null → behåll fallback-namn.
          let displayName = 'Okänd', username: string | null = null, photoURL: string | null = null;
          const card = await getPublicProfileCard(followedUid);
          if (card) {
            displayName = card.displayName || 'Okänd';
            username = card.username;
            photoURL = card.photoURL;
          }
          return {
            uid: followedUid,
            status: data.status ?? '',
            rating: data.rating ?? null,
            displayName,
            username,
            photoURL,
          };
        }),
      );

      return settled
        .flatMap(r => (r.status === 'fulfilled' && r.value ? [r.value] : []))
        // Sett först, sedan högst betyg — starkaste social proof överst.
        .sort((a, b) => {
          const aSeen = a.status === 'sedd' ? 1 : 0;
          const bSeen = b.status === 'sedd' ? 1 : 0;
          if (aSeen !== bSeen) return bSeen - aSeen;
          return (b.rating ?? 0) - (a.rating ?? 0);
        });
    },
  });
}
